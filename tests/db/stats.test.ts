// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newDb, as, type Claims } from "./harness";

const MARKO = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const MARKO_COURSE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_COURSE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const LECTURE_A = "cccccccc-cccc-cccc-cccc-000000000001";
const LECTURE_B = "cccccccc-cccc-cccc-cccc-000000000002";
const CODE_A = "482916";
const CODE_B = "735018";

const marko = { sub: MARKO, email: "dericm@miamioh.edu", app_metadata: { provider: "google" } };
const other = { sub: OTHER, email: "other@miamioh.edu", app_metadata: { provider: "google" } };
const student = (n: number): Claims => ({
  sub: `44444444-4444-4444-4444-${String(n).padStart(12, "0")}`,
  is_anonymous: true,
  app_metadata: { provider: "anonymous" },
});
const s1 = student(1);
const s2 = student(2);
const stranger = student(3); // never joins anything

type Stat = { slide_number: number; taps: number; students: number };

let db: PGlite;
let n = 0;
const tapId = () => `99999999-9999-9999-9999-${String(++n).padStart(12, "0")}`;

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
    insert into public.lectures (id, course_id, name, code, status, current_slide, slide_count) values
      ('${LECTURE_A}', '${MARKO_COURSE}', 'Lecture 1, Oct 26', '${CODE_A}', 'live', 2, 6),
      ('${LECTURE_B}', '${OTHER_COURSE}', 'Cells, Oct 26', '${CODE_B}', 'live', 1, 4);
  `);
  await join(s1, CODE_A);
  await join(s2, CODE_A);
});

const join = (claims: Claims, code: string) =>
  as(db, claims, () => db.query("select public.join_lecture($1)", [code]));

const tap = (claims: Claims, slide: number, o: { kind?: string; note?: string } = {}) =>
  as(db, claims, () =>
    db.query(
      `insert into public.lost_taps (id, lecture_id, anon_id, kind, tapped_on_slide, slide_number, note, tapped_at)
       values ($1, $2, $3, $4, $5, $5, $6, now())`,
      [tapId(), LECTURE_A, claims.sub, o.kind ?? "lost", slide, o.note ?? null],
    ),
  );

const stats = (claims: Claims | null, lecture = LECTURE_A) =>
  as(db, claims, async () =>
    (
      await db.query<Stat>(
        "select slide_number, taps, students from public.lecture_slide_stats($1) order by slide_number",
        [lecture],
      )
    ).rows,
  );

describe("lecture_slide_stats", () => {
  it("returns one row per slide 1 to slide_count with zeros filled in", async () => {
    const r = await stats(marko);
    expect(r.map((x) => x.slide_number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.every((x) => x.taps === 0 && x.students === 0)).toBe(true);
  });

  it("counts one student tapping slide 4 three times as taps 3, students 1", async () => {
    await tap(s1, 4);
    await tap(s1, 4);
    await tap(s1, 4);
    const r = await stats(marko);
    expect(r[3]).toEqual({ slide_number: 4, taps: 3, students: 1 });
    expect(r[2]).toEqual({ slide_number: 3, taps: 0, students: 0 });
  });

  it("counts two students on the same slide as students 2", async () => {
    await tap(s1, 5);
    await tap(s2, 5);
    await tap(s2, 5);
    expect((await stats(marko))[4]).toEqual({ slide_number: 5, taps: 3, students: 2 });
  });

  it("counts a tap moved to an earlier slide on its new slide_number", async () => {
    await tap(s1, 4);
    await as(db, s1, () => db.query("update public.lost_taps set slide_number = 2"));
    const r = await stats(marko);
    expect(r[3]).toEqual({ slide_number: 4, taps: 0, students: 0 });
    expect(r[1]).toEqual({ slide_number: 2, taps: 1, students: 1 });
  });

  it("adds nothing for a save on slide 4 or an undone tap on slide 4", async () => {
    await tap(s1, 4, { kind: "save" });
    await tap(s2, 4);
    await as(db, s2, () => db.query("update public.lost_taps set undone = true where anon_id = $1", [s2.sub]));
    expect((await stats(marko))[3]).toEqual({ slide_number: 4, taps: 0, students: 0 });
  });

  it("lets a student who joined read the counts", async () => {
    await tap(s2, 3);
    expect((await stats(s1))[2]).toEqual({ slide_number: 3, taps: 1, students: 1 });
  });

  it("returns only counts to a student: no notes, ids or anon_ids", async () => {
    await tap(s2, 3, { note: "private note" });
    const r = await as(db, s1, () =>
      db.query("select * from public.lecture_slide_stats($1) limit 1", [LECTURE_A]),
    );
    expect(r.fields.map((f) => f.name)).toEqual(["slide_number", "taps", "students"]);
  });

  it("gives an error to a student who did not join, another teacher and a signed out caller", async () => {
    await expect(stats(stranger)).rejects.toThrow(/not allowed|permission/i);
    await expect(stats(other)).rejects.toThrow(/not allowed|permission/i);
    await expect(stats(marko, LECTURE_B)).rejects.toThrow(/not allowed|permission/i);
    await expect(stats(null)).rejects.toThrow(/permission denied/i);
  });

  it("gives an error for a lecture that does not exist", async () => {
    await expect(stats(marko, "cccccccc-cccc-cccc-cccc-0000000000ff")).rejects.toThrow(/not allowed|permission/i);
  });

  it("still works after the lecture ended", async () => {
    await tap(s1, 2);
    await as(db, marko, () => db.query("select public.end_lecture($1)", [LECTURE_A]));
    expect((await stats(marko))[1]).toEqual({ slide_number: 2, taps: 1, students: 1 });
  });
});

describe("end_lecture", () => {
  const end = (claims: Claims | null, lecture = LECTURE_A) =>
    as(db, claims, () => db.query("select public.end_lecture($1)", [lecture]));
  const lecture = async () =>
    (
      await db.query<{ status: string; code: string | null; ended_at: Date | null }>(
        "select status, code, ended_at from public.lectures where id = $1",
        [LECTURE_A],
      )
    ).rows[0];

  it("lets the owner end it: status ended, ended_at now, code null", async () => {
    await end(marko);
    const l = await lecture();
    expect(l.status).toBe("ended");
    expect(l.code).toBeNull();
    expect(l.ended_at).not.toBeNull();
    expect(Math.abs(Date.now() - new Date(l.ended_at!).getTime())).toBeLessThan(60_000);
  });

  it("gives an error to another teacher and leaves the lecture live", async () => {
    await expect(end(other)).rejects.toThrow(/not allowed/i);
    expect((await lecture()).status).toBe("live");
    expect((await lecture()).code).toBe(CODE_A);
  });

  it("gives an error to a student who joined, a stranger and a signed out caller", async () => {
    await expect(end(s1)).rejects.toThrow(/not allowed/i);
    await expect(end(stranger)).rejects.toThrow(/not allowed/i);
    await expect(end(null)).rejects.toThrow(/permission denied/i);
    expect((await lecture()).status).toBe("live");
  });

  it("does nothing when the lecture already ended, so ended_at keeps its first value", async () => {
    await end(marko);
    const first = (await lecture()).ended_at;
    await end(marko);
    const second = await lecture();
    expect(second.status).toBe("ended");
    expect(second.ended_at).toEqual(first);
  });

  it("makes join_lecture with the old code raise not_found", async () => {
    await end(marko);
    await expect(join(stranger, CODE_A)).rejects.toThrow(/not_found/);
  });

  it("frees the code for the next live lecture", async () => {
    await end(marko);
    await db.query(
      `insert into public.lectures (course_id, name, code, status, slide_count)
       values ('${MARKO_COURSE}', 'Next', '${CODE_A}', 'live', 3)`,
    );
    expect((await db.query("select 1 from public.lectures where code = $1", [CODE_A])).rows).toHaveLength(1);
  });
});
