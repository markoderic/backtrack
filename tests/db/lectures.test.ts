// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { newDb, as, type Claims } from "./harness";

const MARKO = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const MARKO_COURSE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_COURSE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const marko = { sub: MARKO, email: "dericm@miamioh.edu", app_metadata: { provider: "google" } };
const other = { sub: OTHER, email: "other@miamioh.edu", app_metadata: { provider: "google" } };
const anonymous = { sub: "44444444-4444-4444-4444-444444444444", is_anonymous: true, app_metadata: { provider: "anonymous" } };

let db: PGlite;
let n = 0;

afterEach(async () => {
  await db.close();
});

beforeEach(async () => {
  n = 0;
  db = await newDb();
  await db.exec(`
    insert into auth.users (id, email) values
      ('${MARKO}', 'dericm@miamioh.edu'),
      ('${OTHER}', 'other@miamioh.edu');
    insert into public.teachers (id, email) values
      ('${MARKO}', 'dericm@miamioh.edu'),
      ('${OTHER}', 'other@miamioh.edu');
    insert into public.courses (id, teacher_id, name) values
      ('${MARKO_COURSE}', '${MARKO}', 'IMS 452'),
      ('${OTHER_COURSE}', '${OTHER}', 'BIO 121');
  `);
});

const newId = () => `cccccccc-cccc-cccc-cccc-${String(++n).padStart(12, "0")}`;

const slidesFor = (lectureId: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    image_path: `${lectureId}/${i + 1}.webp`,
    first_line: i === 0 ? "Welcome" : "",
  }));

type Started = { lecture_id: string; code: string };
type StartOpts = { id?: string; course?: string; name?: string; slides?: unknown; count?: number; uploaded?: boolean };

const callStart = async (id: string, opts: StartOpts) =>
  (
    await db.query<Started>("select * from public.start_lecture($1, $2, $3, $4::jsonb)", [
      id,
      opts.course ?? MARKO_COURSE,
      opts.name ?? "Lecture 1, Oct 26",
      JSON.stringify(opts.slides === undefined ? slidesFor(id, opts.count ?? 3) : opts.slides),
    ])
  ).rows[0];

/** Puts the images of these slides in the slides bucket, as the app uploads them before it starts. */
async function upload(slides: unknown) {
  if (!Array.isArray(slides)) return;
  for (const s of slides) {
    const path = (s as { image_path?: unknown } | null)?.image_path;
    if (typeof path === "string") {
      await db.query("insert into storage.objects (bucket_id, name, owner) values ('slides', $1, $2)", [path, MARKO]);
    }
  }
}

function start(claims: Claims | null, opts: StartOpts = {}) {
  const id = opts.id ?? newId();
  return (async () => {
    if (opts.uploaded !== false) await upload(opts.slides === undefined ? slidesFor(id, opts.count ?? 3) : opts.slides);
    return as(db, claims, () => callStart(id, opts));
  })();
}

// Mirrors the random expression inside start_lecture so a test can predict
// which codes it will try, using setseed to make random() repeatable.
const PREDICT = "(100000 + floor(random() * 900000)::int)::text";
async function predictCodes(seed: number, count: number) {
  await db.query("select setseed($1)", [seed]);
  const res = await db.query<{ c: string }>(`select ${PREDICT} as c from generate_series(1, $1)`, [count]);
  return res.rows.map((r) => r.c);
}

async function seedLiveLecture(code: string) {
  const id = newId();
  await db.query(
    "insert into public.lectures (id, course_id, name, code, status, slide_count) values ($1, $2, 'seed', $3, 'live', 1)",
    [id, OTHER_COURSE, code],
  );
  return id;
}

describe("start_lecture", () => {
  it("creates a live lecture with a 6 digit code and its slides", async () => {
    const id = newId();
    const started = await start(marko, { id, name: "  Lecture 7, Oct 26  ", count: 4 });
    expect(started.lecture_id).toBe(id);
    expect(started.code).toMatch(/^[1-9][0-9]{5}$/);

    const lecture = (
      await db.query<{ course_id: string; name: string; code: string; status: string; current_slide: number; slide_count: number }>(
        "select course_id, name, code, status, current_slide, slide_count from public.lectures where id = $1",
        [id],
      )
    ).rows[0];
    expect(lecture).toEqual({
      course_id: MARKO_COURSE,
      name: "Lecture 7, Oct 26",
      code: started.code,
      status: "live",
      current_slide: 1,
      slide_count: 4,
    });

    const slides = await db.query<{ number: number; image_path: string; first_line: string }>(
      "select number, image_path, first_line from public.slides where lecture_id = $1 order by number",
      [id],
    );
    expect(slides.rows.map((s) => s.number)).toEqual([1, 2, 3, 4]);
    expect(slides.rows[0]).toEqual({ number: 1, image_path: `${id}/1.webp`, first_line: "Welcome" });
    expect(slides.rows[1].first_line).toBe("");
  });

  it("accepts jpg paths and slides sent out of order", async () => {
    const id = newId();
    await start(marko, {
      id,
      slides: [
        { number: 2, image_path: `${id}/2.jpg`, first_line: "b" },
        { number: 1, image_path: `${id}/1.jpg`, first_line: "a" },
      ],
    });
    const rows = await db.query<{ number: number }>("select number from public.slides where lecture_id = $1 order by number", [id]);
    expect(rows.rows.map((r) => r.number)).toEqual([1, 2]);
  });

  it("never gives two live lectures the same code", async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 8; i++) codes.add((await start(marko, { count: 1 })).code);
    expect(codes.size).toBe(8);
  });

  it("retries on a collision and returns the first free code", async () => {
    const [a, b, c, free] = await predictCodes(0.42, 4);
    expect(new Set([a, b, c, free]).size).toBe(4);
    for (const code of [a, b, c]) await seedLiveLecture(code);

    await db.query("select setseed(0.42)");
    const started = await start(marko);
    expect(started.code).toBe(free);
  });

  it("gives up with a clear error after 20 collisions and creates nothing", async () => {
    const codes = await predictCodes(0.7, 20);
    for (const code of new Set(codes)) await seedLiveLecture(code);
    const before = (await db.query("select 1 from public.lectures")).rows.length;

    await db.query("select setseed(0.7)");
    await expect(start(marko)).rejects.toThrow(/free lecture code/i);
    expect((await db.query("select 1 from public.lectures")).rows).toHaveLength(before);
  });

  it("frees the code when the lecture ends", async () => {
    await db.query("select setseed(0.31)");
    const first = await start(marko, { count: 1 });

    await db.query("select setseed(0.31)");
    const second = await start(marko, { count: 1 });
    expect(second.code).not.toBe(first.code);

    await as(db, marko, () => db.query("select public.end_lecture($1)", [first.lecture_id]));

    await db.query("select setseed(0.31)");
    const third = await start(marko, { count: 1 });
    expect(third.code).toBe(first.code);
  });

  it("rejects another teacher starting a lecture in my course", async () => {
    await expect(start(other, { course: MARKO_COURSE })).rejects.toThrow(/own/i);
    expect((await db.query("select 1 from public.lectures")).rows).toHaveLength(0);
  });

  it("rejects a course that does not exist", async () => {
    await expect(start(marko, { course: "dddddddd-dddd-dddd-dddd-dddddddddddd" })).rejects.toThrow(/own/i);
  });

  it("rejects an anonymous user and a signed out caller", async () => {
    await expect(start(anonymous)).rejects.toThrow();
    await expect(start(null)).rejects.toThrow();
    expect((await db.query("select 1 from public.lectures")).rows).toHaveLength(0);
  });

  it("rejects empty, non array and misnumbered slides and creates nothing", async () => {
    const id = newId();
    const bad: unknown[] = [
      [],
      {},
      "nope",
      null,
      [{ number: 2, image_path: `${id}/2.webp`, first_line: "" }],
      [
        { number: 1, image_path: `${id}/1.webp`, first_line: "" },
        { number: 3, image_path: `${id}/3.webp`, first_line: "" },
      ],
      [
        { number: 1, image_path: `${id}/1.webp`, first_line: "" },
        { number: 1, image_path: `${id}/1.webp`, first_line: "" },
      ],
      [{ number: 1, first_line: "" }],
      [{ number: "1", image_path: `${id}/1.webp`, first_line: "" }],
      [{ number: 1, image_path: "someone-elses-lecture/1.webp", first_line: "" }],
      ["not an object"],
    ];
    for (const slides of bad) {
      await expect(start(marko, { id, slides }), JSON.stringify(slides)).rejects.toThrow(/slides/i);
    }
    expect((await db.query("select 1 from public.lectures")).rows).toHaveLength(0);
    expect((await db.query("select 1 from public.slides")).rows).toHaveLength(0);
  });

  it("rejects a blank lecture name", async () => {
    await expect(start(marko, { name: "   " })).rejects.toThrow(/name/i);
  });

  it("rejects reusing an existing lecture id", async () => {
    const id = newId();
    await start(marko, { id });
    await expect(start(marko, { id })).rejects.toThrow(/duplicate|already/i);
  });
});

describe("lectures and slides RLS", () => {
  it("lets the owner read their lecture and its slides, and nobody else", async () => {
    const { lecture_id } = await start(marko, { count: 2 });
    const mine = await as(db, marko, async () => ({
      lectures: (await db.query("select id from public.lectures")).rows,
      slides: (await db.query("select number from public.slides")).rows,
    }));
    expect(mine.lectures).toHaveLength(1);
    expect(mine.slides).toHaveLength(2);

    const theirs = await as(db, other, async () => ({
      lectures: (await db.query("select id from public.lectures where id = $1", [lecture_id])).rows,
      slides: (await db.query("select number from public.slides where lecture_id = $1", [lecture_id])).rows,
    }));
    expect(theirs.lectures).toHaveLength(0);
    expect(theirs.slides).toHaveLength(0);

    const anon = await as(db, null, async () => (await db.query("select id from public.lectures")).rows);
    expect(anon).toHaveLength(0);
  });

  it("does not let anyone insert a lecture or slide directly", async () => {
    await expect(
      as(db, marko, () =>
        db.query(
          "insert into public.lectures (id, course_id, name, code, status, slide_count) values ($1, $2, 'x', '123456', 'live', 1)",
          [newId(), MARKO_COURSE],
        ),
      ),
    ).rejects.toThrow(/permission denied/i); // 0014 (row level security refused it before)

    const { lecture_id } = await start(marko, { count: 1 });
    await expect(
      as(db, marko, () => db.query("insert into public.slides (lecture_id, number, image_path) values ($1, 2, 'x')", [lecture_id])),
    ).rejects.toThrow(/permission denied/i);
  });

  it("lets the owner update their lecture but not another teacher's", async () => {
    const { lecture_id } = await start(marko, { count: 3 });
    await as(db, marko, () => db.query("update public.lectures set current_slide = 2 where id = $1", [lecture_id]));
    await as(db, other, () => db.query("update public.lectures set current_slide = 3 where id = $1", [lecture_id]));
    const row = await db.query<{ current_slide: number }>("select current_slide from public.lectures where id = $1", [lecture_id]);
    expect(row.rows[0].current_slide).toBe(2);
  });

  it("does not let a teacher move a lecture into someone else's course", async () => {
    const { lecture_id } = await start(marko, { count: 1 });
    await expect(
      as(db, marko, () => db.query("update public.lectures set course_id = $1 where id = $2", [OTHER_COURSE, lecture_id])),
    ).rejects.toThrow(/permission denied/i); // 0014: only name and current_slide can be updated
  });

  it("does not let anyone update slides directly, the owner included (0014)", async () => {
    const { lecture_id } = await start(marko, { count: 1 });
    await expect(
      as(db, marko, () => db.query("update public.slides set first_line = 'Mine' where lecture_id = $1", [lecture_id])),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      as(db, other, () => db.query("update public.slides set first_line = 'Theirs' where lecture_id = $1", [lecture_id])),
    ).rejects.toThrow(/permission denied/i);
    const row = await db.query<{ first_line: string }>("select first_line from public.slides where lecture_id = $1", [lecture_id]);
    expect(row.rows[0].first_line).toBe("Welcome");
  });

  it("does not let a teacher delete a lecture directly", async () => {
    const { lecture_id } = await start(marko, { count: 1 });
    // 0014 takes the delete privilege away (delete_lecture is the way); RLS refused it before.
    await expect(as(db, marko, () => db.query("delete from public.lectures where id = $1", [lecture_id]))).rejects.toThrow(
      /permission denied/i,
    );
    expect((await db.query("select 1 from public.lectures")).rows).toHaveLength(1);
  });

  it("removes lectures and slides when the course is deleted", async () => {
    await start(marko, { count: 2 });
    await db.query("delete from public.courses where id = $1", [MARKO_COURSE]);
    expect((await db.query("select 1 from public.lectures")).rows).toHaveLength(0);
    expect((await db.query("select 1 from public.slides")).rows).toHaveLength(0);
  });

  it("rejects a code that is not 6 digits starting 1 to 9", async () => {
    for (const code of ["012345", "12345", "1234567", "12a456"]) {
      await expect(seedLiveLecture(code), code).rejects.toThrow(/check|too long|value/i);
    }
  });

  it("owns_lecture is true only for the owner", async () => {
    const { lecture_id } = await start(marko, { count: 1 });
    const q = "select public.owns_lecture($1) as ok";
    expect(await as(db, marko, async () => (await db.query<{ ok: boolean }>(q, [lecture_id])).rows[0].ok)).toBe(true);
    expect(await as(db, other, async () => (await db.query<{ ok: boolean }>(q, [lecture_id])).rows[0].ok)).toBe(false);
    expect(await as(db, marko, async () => (await db.query<{ ok: boolean }>(q, [newId()])).rows[0].ok)).toBe(false);
  });
});

describe("slides storage policies", () => {
  const upload = (name: string, bucket = "slides") =>
    db.query("insert into storage.objects (bucket_id, name, owner) values ($1, $2, auth.uid())", [bucket, name]);

  it("lets a teacher upload into the slides bucket", async () => {
    await as(db, marko, () => upload(`${newId()}/1.webp`));
    expect((await db.query("select 1 from storage.objects")).rows).toHaveLength(1);
  });

  it("does not let a teacher write into another bucket", async () => {
    await expect(as(db, marko, () => upload(`${newId()}/1.webp`, "avatars"))).rejects.toThrow(/row-level security/i);
  });

  it("rejects an anonymous JWT and a signed out caller", async () => {
    await expect(as(db, anonymous, () => upload(`${newId()}/1.webp`))).rejects.toThrow(/row-level security/i);
    await expect(as(db, null, () => upload(`${newId()}/1.webp`))).rejects.toThrow();
    expect((await db.query("select 1 from storage.objects")).rows).toHaveLength(0);
  });

  it("lets the uploader read their own object before the lecture exists", async () => {
    const name = `${newId()}/1.webp`;
    await as(db, marko, () => upload(name));
    const seen = await as(db, marko, async () => (await db.query("select name from storage.objects")).rows);
    expect(seen).toHaveLength(1);
    const notSeen = await as(db, other, async () => (await db.query("select name from storage.objects")).rows);
    expect(notSeen).toHaveLength(0);
  });

  it("lets the lecture owner read the lecture's objects, and not another teacher", async () => {
    const { lecture_id } = await start(marko, { count: 1 });
    // As if written by the service, so no owner on the row.
    await db.query("update storage.objects set owner = null where name = $1", [`${lecture_id}/1.webp`]);
    const mine = await as(db, marko, async () => (await db.query("select name from storage.objects")).rows);
    expect(mine).toHaveLength(1);
    const theirs = await as(db, other, async () => (await db.query("select name from storage.objects")).rows);
    expect(theirs).toHaveLength(0);
    const anon = await as(db, null, async () => (await db.query("select name from storage.objects")).rows);
    expect(anon).toHaveLength(0);
  });

  it("does not blow up on object names whose first folder is not a uuid", async () => {
    await db.query("insert into storage.objects (bucket_id, name) values ('slides', 'not-a-uuid/1.webp'), ('slides', 'loose.webp')");
    const seen = await as(db, marko, async () => (await db.query("select name from storage.objects")).rows);
    expect(seen).toHaveLength(0);
  });
});

describe("lecture_date in Eastern time", () => {
  const easternDate = async (at: string) =>
    (await db.query<{ d: string }>("select public.eastern_date($1::timestamptz)::text as d", [at])).rows[0].d;

  it("eastern_date gives the day before when UTC has already rolled over (EDT)", async () => {
    expect(await easternDate("2026-10-22 01:30+00")).toBe("2026-10-21");
  });

  it("eastern_date gives the same day later in the UTC day (EDT)", async () => {
    expect(await easternDate("2026-10-22 05:30+00")).toBe("2026-10-22");
  });

  it("eastern_date follows standard time in winter (EST)", async () => {
    expect(await easternDate("2026-01-15 04:30+00")).toBe("2026-01-14");
    expect(await easternDate("2026-01-15 05:30+00")).toBe("2026-01-15");
  });

  it("eastern_date of a null time is null", async () => {
    expect(await easternDate(null as unknown as string)).toBeNull();
  });

  it("a lecture made by start_lecture gets lecture_date = eastern_date(started_at)", async () => {
    const started = await start(marko);
    const r = await db.query<{ lecture_date: string; expected: string }>(
      "select lecture_date::text, public.eastern_date(started_at)::text as expected from public.lectures where id = $1",
      [started.lecture_id],
    );
    expect(r.rows[0].lecture_date).toBe(r.rows[0].expected);
  });

  it("a lecture inserted without a lecture_date gets the Eastern date by default", async () => {
    await db.query(
      "insert into public.lectures (id, course_id, name, code, status, slide_count) values ($1, $2, 'x', '123456', 'live', 1)",
      [newId(), MARKO_COURSE],
    );
    const r = await db.query<{ same: boolean }>(
      "select lecture_date = public.eastern_date(started_at) as same from public.lectures",
    );
    expect(r.rows).toEqual([{ same: true }]);
  });

  it("the column default is eastern_date(now()), not current_date", async () => {
    const r = await db.query<{ d: string }>(
      `select pg_get_expr(adbin, adrelid) as d
       from pg_attrdef where adrelid = 'public.lectures'::regclass
         and adnum = (select attnum from pg_attribute where attrelid = 'public.lectures'::regclass and attname = 'lecture_date')`,
    );
    expect(r.rows[0].d).toContain("eastern_date");
  });

  it("the migration moves existing lectures to their Eastern date and leaves correct ones alone", async () => {
    const wrong = newId();
    const right = newId();
    await db.query(
      `insert into public.lectures (id, course_id, name, code, status, slide_count, started_at, lecture_date) values
         ($1, $3, 'late', '111111', 'ended', 1, '2026-10-22 01:30+00', '2026-10-22'),
         ($2, $3, 'fine', '222222', 'ended', 1, '2026-10-22 15:00+00', '2026-10-22')`,
      [wrong, right, MARKO_COURSE],
    );
    // Run part 2 of the migration again, as the hosted database will run it once.
    const file = readFileSync(path.resolve(__dirname, "../../supabase/migrations/0009_join_attempts.sql"), "utf8");
    await db.exec(file.slice(file.indexOf("-- Part 2")));
    const r = await db.query<{ id: string; lecture_date: string }>(
      "select id, lecture_date::text from public.lectures where id in ($1, $2)",
      [wrong, right],
    );
    const byId = Object.fromEntries(r.rows.map((x) => [x.id, x.lecture_date]));
    expect(byId[wrong]).toBe("2026-10-21");
    expect(byId[right]).toBe("2026-10-22");
  });
});
