// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newDb, as, type Claims } from "./harness";

const MARKO = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const COURSE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_COURSE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ENDED = "cccccccc-cccc-cccc-cccc-000000000001";
const LIVE = "cccccccc-cccc-cccc-cccc-000000000002";
const OTHERS = "cccccccc-cccc-cccc-cccc-000000000003";

const marko = { sub: MARKO, email: "dericm@miamioh.edu", app_metadata: { provider: "google" } };
const other = { sub: OTHER, email: "other@miamioh.edu", app_metadata: { provider: "google" } };
const student: Claims = { sub: "44444444-4444-4444-4444-000000000001", is_anonymous: true, app_metadata: { provider: "anonymous" } };

let db: PGlite;
afterEach(async () => {
  await db.close();
});
beforeEach(async () => {
  db = await newDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${MARKO}', 'dericm@miamioh.edu'), ('${OTHER}', 'other@miamioh.edu');
    insert into public.teachers (id, email) values ('${MARKO}', 'dericm@miamioh.edu'), ('${OTHER}', 'other@miamioh.edu');
    insert into public.courses (id, teacher_id, name) values ('${COURSE}', '${MARKO}', 'IMS 228'), ('${OTHER_COURSE}', '${OTHER}', 'BIO 121');
    insert into public.lectures (id, course_id, name, code, status, current_slide, slide_count, ended_at) values
      ('${ENDED}', '${COURSE}', 'Semester deck', null, 'ended', 7, 300, now()),
      ('${LIVE}', '${COURSE}', 'Live one', '482916', 'live', 1, 2, null),
      ('${OTHERS}', '${OTHER_COURSE}', 'Cells', null, 'ended', 1, 1, now());
    insert into public.participants (lecture_id, anon_id) values ('${ENDED}', '${student.sub}');
    insert into public.lost_taps (lecture_id, anon_id, kind, tapped_on_slide, slide_number, note, tapped_at) values
      ('${ENDED}', '${student.sub}', 'lost', 5, 5, 'too fast', now());
  `);
});

type Row = { lecture_id: string; code: string };
const resume = (claims: Claims | null, id: string) =>
  as(db, claims, async () => (await db.query<Row>("select * from public.resume_lecture($1)", [id])).rows);
const lecture = async (id: string) =>
  (await db.query<{ status: string; code: string | null; ended_at: string | null; current_slide: number; name: string }>(
    "select status, code, ended_at, current_slide, name from public.lectures where id = $1",
    [id],
  )).rows[0];

describe("resume_lecture", () => {
  it("opens the owner's ended lecture again: live, a new code, on the slide it was on, its taps kept", async () => {
    const rows = await resume(marko, ENDED);
    expect(rows).toHaveLength(1);
    expect(rows[0].lecture_id).toBe(ENDED);
    expect(rows[0].code).toMatch(/^[1-9][0-9]{5}$/);
    const l = await lecture(ENDED);
    expect(l).toMatchObject({ status: "live", code: rows[0].code, ended_at: null, current_slide: 7, name: "Semester deck" });
    const taps = await db.query<{ n: number }>("select count(*)::int as n from public.lost_taps where lecture_id = $1", [ENDED]);
    expect(taps.rows[0].n).toBe(1);
  });

  it("lets a student who joined before join again with the new code", async () => {
    const [{ code }] = await resume(marko, ENDED);
    const joined = await as(db, student, async () => (await db.query("select * from public.join_lecture($1)", [code])).rows);
    expect(joined).toHaveLength(1);
    const p = await db.query<{ n: number }>("select count(*)::int as n from public.participants where lecture_id = $1", [ENDED]);
    expect(p.rows[0].n).toBe(1);
  });

  it("can end again and resume again, with a fresh code each time", async () => {
    const [{ code: first }] = await resume(marko, ENDED);
    await as(db, marko, () => db.query("select public.end_lecture($1)", [ENDED]));
    expect(await lecture(ENDED)).toMatchObject({ status: "ended", code: null });
    const [{ code: second }] = await resume(marko, ENDED);
    expect(second).toMatch(/^[1-9][0-9]{5}$/);
    expect((await lecture(ENDED)).status).toBe("live");
    expect(typeof first).toBe("string");
  });

  it("changes nothing on a lecture that is already live and gives back its code", async () => {
    expect(await resume(marko, LIVE)).toEqual([{ lecture_id: LIVE, code: "482916" }]);
    expect((await lecture(LIVE)).code).toBe("482916");
  });

  // Mirrors the random expression in resume_lecture, as lectures.test.ts does for start_lecture.
  const PREDICT = "(100000 + floor(random() * 900000)::int)::text";
  const predict = async (seed: number, count: number) => {
    await db.query("select setseed($1)", [seed]);
    return (await db.query<{ c: string }>(`select ${PREDICT} as c from generate_series(1, $1)`, [count])).rows.map((r) => r.c);
  };
  const seedLive = (code: string) =>
    db.query(
      "insert into public.lectures (id, course_id, name, code, status, slide_count) values (gen_random_uuid(), $1, 'seed', $2, 'live', 1)",
      [OTHER_COURSE, code],
    );

  it("skips a code another live lecture has and takes the next free one", async () => {
    const [a, b, free] = await predict(0.42, 3);
    expect(new Set([a, b, free, "482916"]).size).toBe(4);
    await seedLive(a);
    await seedLive(b);
    await db.query("select setseed(0.42)");
    expect((await resume(marko, ENDED))[0].code).toBe(free);
  });

  it("gives up with a clear error after 20 taken codes and leaves the lecture ended", async () => {
    const codes = await predict(0.7, 20);
    for (const code of new Set(codes)) if (code !== "482916") await seedLive(code);
    await db.query("select setseed(0.7)");
    await expect(resume(marko, ENDED)).rejects.toThrow(/free lecture code/i);
    expect(await lecture(ENDED)).toMatchObject({ status: "ended", code: null });
  });

  it("is the owner's only: another teacher, a student and a signed out caller are refused", async () => {
    await expect(resume(other, ENDED)).rejects.toThrow(/Not allowed/);
    await expect(resume(marko, OTHERS)).rejects.toThrow(/Not allowed/);
    await expect(resume(student, ENDED)).rejects.toThrow(/Not allowed/);
    await expect(resume(null, ENDED)).rejects.toThrow(/permission denied/i);
    expect((await lecture(ENDED)).status).toBe("ended");
    expect((await lecture(OTHERS)).status).toBe("ended");
  });
});
