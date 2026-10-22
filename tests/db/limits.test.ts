// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newDb, as, type Claims } from "./harness";

// 0012_tap_limits.sql: one student adds at most 20 rows to a lecture in any 60 seconds,
// and 300 in the whole lecture. The error is SQLSTATE BT429, which the app reads as
// "too many taps".

const MARKO = "11111111-1111-1111-1111-111111111111";
const COURSE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LECTURE_A = "cccccccc-cccc-cccc-cccc-000000000001";
const LECTURE_B = "cccccccc-cccc-cccc-cccc-000000000002";

const student = (n: number): Claims => ({
  sub: `44444444-4444-4444-4444-${String(n).padStart(12, "0")}`,
  is_anonymous: true,
  app_metadata: { provider: "anonymous" },
});
const s1 = student(1);
const s2 = student(2);

let db: PGlite;
let n = 0;
const tapId = () => `99999999-9999-9999-9999-${String(++n).padStart(12, "0")}`;

beforeEach(async () => {
  n = 0;
  db = await newDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${MARKO}', 'dericm@miamioh.edu');
    insert into public.teachers (id, email) values ('${MARKO}', 'dericm@miamioh.edu');
    insert into public.courses (id, teacher_id, name) values ('${COURSE}', '${MARKO}', 'IMS 452');
    insert into public.lectures (id, course_id, name, code, status, current_slide, slide_count) values
      ('${LECTURE_A}', '${COURSE}', 'Lecture 1, Oct 26', '482916', 'live', 2, 10),
      ('${LECTURE_B}', '${COURSE}', 'Lecture 2, Oct 28', '735018', 'live', 1, 10);
  `);
  for (const s of [s1, s2]) {
    for (const code of ["482916", "735018"]) await as(db, s, () => db.query("select public.join_lecture($1)", [code]));
  }
});

afterEach(async () => {
  await db.close();
});

/** One tap as the student, the way the app sends it (upsert, on conflict do nothing). */
const tap = (claims: Claims, o: { id?: string; lecture?: string; createdAt?: string } = {}) =>
  as(db, claims, () =>
    db.query(
      `insert into public.lost_taps (id, lecture_id, anon_id, tapped_on_slide, slide_number, tapped_at${o.createdAt ? ", created_at" : ""})
       values ($1, $2, $3, 2, 2, now()${o.createdAt ? `, ${o.createdAt}` : ""})
       on conflict (id) do nothing`,
      [o.id ?? tapId(), o.lecture ?? LECTURE_A, claims.sub],
    ),
  );

/** Rows put in directly (as the owner, so no limit), made `ago` before now. */
const seed = (claims: Claims, count: number, ago: string, lecture = LECTURE_A) =>
  db.query(
    `insert into public.lost_taps (lecture_id, anon_id, tapped_on_slide, slide_number, tapped_at, created_at)
     select $1, $2, 2, 2, now() - $3::interval, now() - $3::interval from generate_series(1, $4)`,
    [lecture, claims.sub, ago, count],
  );

const count = async (claims: Claims, lecture = LECTURE_A) =>
  Number(
    (
      await db.query<{ n: string }>("select count(*) as n from public.lost_taps where anon_id = $1 and lecture_id = $2", [
        claims.sub,
        lecture,
      ])
    ).rows[0].n,
  );

async function refused(p: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; message: string };
  }
  throw new Error("expected the insert to be refused");
}

describe("normal use is not limited", () => {
  it("a few taps, Undo, a note, a moved marker and a re-tap all go through", async () => {
    const first = tapId();
    await tap(s1, { id: first });
    await tap(s1);
    await as(db, s1, () => db.query("update public.lost_taps set undone = true where id = $1", [first]));
    await tap(s1);
    await as(db, s1, () => db.query("update public.lost_taps set note = 'too fast', slide_number = 1 where id = $1", [first]));
    expect(await count(s1)).toBe(3);
  });

  it("20 taps in a minute are fine", async () => {
    for (let i = 0; i < 20; i++) await tap(s1);
    expect(await count(s1)).toBe(20);
  });
});

describe("20 a minute", () => {
  it("refuses the 21st tap within 60 seconds with BT429 and a clear message, and saves nothing", async () => {
    for (let i = 0; i < 20; i++) await tap(s1);
    const e = await refused(tap(s1));
    expect(e.code).toBe("BT429");
    expect(e.message).toBe("Too many taps. Try again in a minute.");
    expect(await count(s1)).toBe(20);
  });

  it("counts only the last 60 seconds", async () => {
    await seed(s1, 20, "61 seconds");
    await tap(s1);
    await seed(s1, 19, "30 seconds");
    await expect(refused(tap(s1))).resolves.toMatchObject({ code: "BT429" });
    expect(await count(s1)).toBe(40);
  });

  it("can not be dodged by sending an old created_at", async () => {
    for (let i = 0; i < 20; i++) await tap(s1, { createdAt: "now() - interval '1 hour'" });
    await expect(refused(tap(s1, { createdAt: "now() - interval '1 hour'" }))).resolves.toMatchObject({ code: "BT429" });
    const old = await db.query<{ n: string }>(
      "select count(*) as n from public.lost_taps where created_at < now() - interval '1 minute'",
    );
    expect(Number(old.rows[0].n)).toBe(0);
  });

  it("is per student and per lecture", async () => {
    for (let i = 0; i < 20; i++) await tap(s1);
    await tap(s2);
    await tap(s1, { lecture: LECTURE_B });
    expect(await count(s2)).toBe(1);
    expect(await count(s1, LECTURE_B)).toBe(1);
  });

  it("a resend of a tap that already saved is not refused, even at the limit", async () => {
    const id = tapId();
    await tap(s1, { id });
    for (let i = 0; i < 19; i++) await tap(s1);
    await tap(s1, { id });
    expect(await count(s1)).toBe(20);
  });
});

describe("300 a lecture", () => {
  it("refuses the 301st row of a lecture with BT429, undone rows included", async () => {
    await seed(s1, 299, "1 hour");
    await db.query(
      "update public.lost_taps set undone = true where id in (select id from public.lost_taps where anon_id = $1 limit 50)",
      [s1.sub],
    );
    await tap(s1);
    const e = await refused(tap(s1));
    expect(e.code).toBe("BT429");
    expect(e.message).toBe("Too many taps in this lecture.");
    expect(await count(s1)).toBe(300);
  });

  it("leaves the student's other lectures and other students alone", async () => {
    await seed(s1, 300, "1 hour");
    await tap(s1, { lecture: LECTURE_B });
    await tap(s2);
    expect(await count(s1, LECTURE_B)).toBe(1);
    expect(await count(s2)).toBe(1);
  });
});

describe("rows not written by the student themselves", () => {
  it("are not limited (the owner's demo seed, a direct insert)", async () => {
    await seed(s1, 400, "10 seconds");
    expect(await count(s1)).toBe(400);
  });
});

describe("the slides bucket", () => {
  it("allows only WebP and JPEG, at most 10 MB", async () => {
    // The bucket row only exists on hosted Supabase (0004 .remote.sql); make it, then run 0012's update again.
    await db.exec("insert into storage.buckets (id, name, public) values ('slides', 'slides', false)");
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(new URL("../../supabase/migrations/0012_tap_limits.sql", import.meta.url), "utf8");
    await db.exec(sql);
    const r = await db.query<{ allowed_mime_types: string[]; file_size_limit: string }>(
      "select allowed_mime_types, file_size_limit from storage.buckets where id = 'slides'",
    );
    expect(r.rows[0].allowed_mime_types).toEqual(["image/webp", "image/jpeg"]);
    expect(Number(r.rows[0].file_size_limit)).toBe(10 * 1024 * 1024);
  });
});
