// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newDb, as, type Claims } from "./harness";

const MARKO = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const COURSE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LECTURE = "cccccccc-cccc-cccc-cccc-000000000001";
const ENDED = "cccccccc-cccc-cccc-cccc-000000000002";
const CODE = "482916";

const marko: Claims = { sub: MARKO, email: "dericm@miamioh.edu", app_metadata: { provider: "google" } };
const other: Claims = { sub: OTHER, email: "other@miamioh.edu", app_metadata: { provider: "google" } };
const student: Claims = {
  sub: "44444444-4444-4444-4444-000000000001",
  is_anonymous: true,
  app_metadata: { provider: "anonymous" },
};

let db: PGlite;

afterEach(async () => {
  await db.close();
});

beforeEach(async () => {
  db = await newDb();
  await db.exec(`
    insert into auth.users (id, email) values
      ('${MARKO}', 'dericm@miamioh.edu'),
      ('${OTHER}', 'other@miamioh.edu');
    insert into public.teachers (id, email) values
      ('${MARKO}', 'dericm@miamioh.edu'),
      ('${OTHER}', 'other@miamioh.edu');
  `);
});

const saveSetup = (claims: Claims | null, name: string | null, courses: string[] | null) =>
  as(db, claims, async () =>
    (await db.query<{ ok: boolean }>("select public.save_setup($1, $2) as ok", [name, courses])).rows[0].ok,
  );

const teacher = async (id: string) =>
  (await db.query<{ display_name: string | null }>("select display_name from public.teachers where id = $1", [id])).rows[0];
const courseNames = async (id: string) =>
  (await db.query<{ name: string }>("select name from public.courses where teacher_id = $1 order by name", [id])).rows.map(
    (r) => r.name,
  );

describe("save_setup", () => {
  it("saves the name and the courses together, trimmed, skipping empty ones", async () => {
    expect(await saveSetup(marko, "  Marko Deric ", [" IMS 452 ", "", "  ", "IMS 228"])).toBe(true);
    expect(await teacher(MARKO)).toEqual({ display_name: "Marko Deric" });
    expect(await courseNames(MARKO)).toEqual(["IMS 228", "IMS 452"]);
  });

  it("does nothing the second time, so a double click on Done can't add the courses twice", async () => {
    expect(await saveSetup(marko, "Marko", ["IMS 452"])).toBe(true);
    expect(await saveSetup(marko, "Someone else", ["IMS 452", "IMS 999"])).toBe(false);
    expect(await teacher(MARKO)).toEqual({ display_name: "Marko" });
    expect(await courseNames(MARKO)).toEqual(["IMS 452"]);
  });

  it("saves neither the name nor any course when a course can't be inserted", async () => {
    // A trigger stands in for any failure on the courses insert (a dropped connection, a check).
    await db.exec(`
      create function public.fail_course() returns trigger language plpgsql as $$
      begin
        if new.name = 'BAD' then raise exception 'insert failed'; end if;
        return new;
      end; $$;
      create trigger fail_course before insert on public.courses for each row execute function public.fail_course();
    `);
    await expect(saveSetup(marko, "Marko", ["IMS 452", "BAD"])).rejects.toThrow(/insert failed/);
    expect(await teacher(MARKO)).toEqual({ display_name: null });
    expect(await courseNames(MARKO)).toEqual([]);
  });

  it("refuses a missing name, no courses, a name over 80 or a course over 120, and saves nothing", async () => {
    for (const [name, courses] of [
      ["", ["IMS 452"]],
      [null, ["IMS 452"]],
      ["Marko", []],
      ["Marko", ["", " "]],
      ["Marko", null],
      ["x".repeat(81), ["IMS 452"]],
      ["Marko", ["x".repeat(121)]],
      ["Marko", Array.from({ length: 21 }, (_, i) => `C${i}`)],
    ] as [string | null, string[] | null][]) {
      await expect(saveSetup(marko, name, courses)).rejects.toThrow(/1 to 80/);
    }
    expect(await teacher(MARKO)).toEqual({ display_name: null });
    expect(await courseNames(MARKO)).toEqual([]);
  });

  it("only touches the caller's own row and courses", async () => {
    expect(await saveSetup(other, "Other", ["BIO 121"])).toBe(true);
    expect(await teacher(MARKO)).toEqual({ display_name: null });
    expect(await courseNames(MARKO)).toEqual([]);
    expect(await courseNames(OTHER)).toEqual(["BIO 121"]);
  });

  it("does nothing for a signed in user who is not a teacher, and refuses anon", async () => {
    expect(await saveSetup(student, "Me", ["IMS 452"])).toBe(false);
    expect((await db.query("select 1 from public.courses")).rows).toHaveLength(0);
    await expect(saveSetup(null, "Me", ["IMS 452"])).rejects.toThrow(/Sign in first/);
  });
});

describe("join_lecture and the live code index", () => {
  beforeEach(async () => {
    await db.exec(`
      insert into public.courses (id, teacher_id, name) values ('${COURSE}', '${MARKO}', 'IMS 452');
      insert into public.lectures (id, course_id, name, code, status, current_slide, slide_count) values
        ('${LECTURE}', '${COURSE}', 'Lecture 1, Oct 26', '${CODE}', 'live', 1, 3),
        ('${ENDED}', '${COURSE}', 'Lecture 0, Oct 24', '${CODE}', 'ended', 1, 3);
    `);
  });

  it("the lookup join_lecture runs can use lectures_live_code_text_idx", async () => {
    // The same where clause join_lecture has (char(6) column, text argument). Seq scans are
    // switched off because with two rows the planner would rather read the table anyway.
    await db.exec("set enable_seqscan = off");
    const plan = (
      await db.query<{ "QUERY PLAN": string }>(
        `explain select l.id from public.lectures l
         where l.status = 'live' and l.code = btrim(coalesce($1::text, ''), E' \\t\\r\\n')`,
        [CODE],
      )
    ).rows
      .map((r) => r["QUERY PLAN"])
      .join("\n");
    await db.exec("reset enable_seqscan");
    expect(plan).toMatch(/lectures_live_code_text_idx/);
  });

  it("still joins the live lecture with the code, never the ended one with the same code", async () => {
    const id = await as(db, student, async () =>
      (await db.query<{ id: string | null }>("select public.join_lecture($1) as id", [` ${CODE} `])).rows[0].id,
    );
    expect(id).toBe(LECTURE);
    const wrong = await as(db, student, async () =>
      (await db.query<{ id: string | null }>("select public.join_lecture($1) as id", ["4829160"])).rows[0].id,
    );
    expect(wrong).toBeNull();
  });
});

describe("lectures.slide_version", () => {
  beforeEach(async () => {
    await db.exec(`
      insert into public.courses (id, teacher_id, name) values ('${COURSE}', '${MARKO}', 'IMS 452');
      insert into public.lectures (id, course_id, name, code, status, current_slide, slide_count) values
        ('${LECTURE}', '${COURSE}', 'Lecture 1, Oct 26', '${CODE}', 'live', 1, 3);
    `);
  });

  const version = async () =>
    (await db.query<{ v: string }>("select slide_version::text as v from public.lectures where id = $1", [LECTURE])).rows[0].v;

  it("starts at 0 and counts up on every update, also when the teacher goes back", async () => {
    expect(await version()).toBe("0");
    await as(db, marko, () => db.query("update public.lectures set current_slide = 2 where id = $1", [LECTURE]));
    await as(db, marko, () => db.query("update public.lectures set current_slide = 1 where id = $1", [LECTURE]));
    expect(await version()).toBe("2");
  });

  it("ignores a value the client sends for it", async () => {
    await as(db, marko, () =>
      db.query("update public.lectures set current_slide = 2, slide_version = 1000 where id = $1", [LECTURE]),
    ).catch(() => undefined); // a column grant may refuse it outright, which is fine too
    expect(Number(await version())).toBeLessThanOrEqual(1);
  });

  it("is readable by a student who joined, next to current_slide and status", async () => {
    await as(db, student, () => db.query("select public.join_lecture($1)", [CODE]));
    await as(db, marko, () => db.query("update public.lectures set current_slide = 3 where id = $1", [LECTURE]));
    const row = await as(db, student, async () =>
      (
        await db.query<{ current_slide: number; status: string; slide_version: string }>(
          "select current_slide, status, slide_version::text from public.lectures where id = $1",
          [LECTURE],
        )
      ).rows[0],
    );
    expect(row).toEqual({ current_slide: 3, status: "live", slide_version: "1" });
  });

  it("counts up when end_lecture ends the lecture", async () => {
    await as(db, marko, () => db.query("select public.end_lecture($1)", [LECTURE]));
    expect(await version()).toBe("1");
  });
});
