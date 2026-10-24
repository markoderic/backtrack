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
    insert into public.lectures (id, course_id, name, code, status, current_slide, slide_count, lecture_date) values
      ('${LECTURE_A}', '${MARKO_COURSE}', 'Lecture 1, Oct 26', '${CODE_A}', 'live', 2, 10, '2026-10-26'),
      ('${LECTURE_B}', '${OTHER_COURSE}', 'Cells, Oct 26', '${CODE_B}', 'live', 1, 4, '2026-10-26');
    insert into public.slides (lecture_id, number, image_path, first_line) values
      ('${LECTURE_A}', 1, '${LECTURE_A}/1.webp', 'Welcome'),
      ('${LECTURE_A}', 2, '${LECTURE_A}/2.webp', 'Agenda'),
      ('${LECTURE_B}', 1, '${LECTURE_B}/1.webp', 'Cells');
  `);
  await join(s1, CODE_A);
  await join(s2, CODE_A);
});

const join = (claims: Claims, code: string) =>
  as(db, claims, () => db.query("select public.join_lecture($1)", [code]));

const rows = <T extends object>(claims: Claims | null, sql: string, params: unknown[] = []) =>
  as(db, claims, async () => (await db.query<T>(sql, params)).rows);

/** Inserts a tap as the student and returns its id. */
async function tap(claims: Claims, slide: number, o: { kind?: string; note?: string } = {}): Promise<string> {
  const id = tapId();
  await as(db, claims, () =>
    db.query(
      `insert into public.lost_taps (id, lecture_id, anon_id, kind, tapped_on_slide, slide_number, note, tapped_at)
       values ($1, $2, $3, $4, $5, $5, $6, now())`,
      [id, LECTURE_A, claims.sub, o.kind ?? "lost", slide, o.note ?? null],
    ),
  );
  return id;
}

const stats = (claims: Claims | null) =>
  rows<Stat>(claims, "select slide_number, taps, students from public.lecture_slide_stats($1) order by slide_number", [
    LECTURE_A,
  ]);

const countOn = async (claims: Claims, slide: number) =>
  (await stats(claims)).find((r) => r.slide_number === slide)!;

describe("my spots: the data the page reads", () => {
  it("a student reads their own rows and no one else's, notes included", async () => {
    await tap(s1, 3, { note: "mine" });
    await tap(s2, 4, { note: "theirs" });
    const mine = await rows<{ slide_number: number; note: string }>(
      s1,
      "select slide_number, note from public.lost_taps where lecture_id = $1 and undone = false",
      [LECTURE_A],
    );
    expect(mine).toEqual([{ slide_number: 3, note: "mine" }]);
  });

  it("an undone row is left out when the page filters undone = false", async () => {
    const keep = await tap(s1, 3);
    const gone = await tap(s1, 5);
    await as(db, s1, () => db.query("update public.lost_taps set undone = true where id = $1", [gone]));
    const shown = await rows<{ id: string }>(
      s1,
      "select id from public.lost_taps where lecture_id = $1 and undone = false",
      [LECTURE_A],
    );
    expect(shown.map((r) => r.id)).toEqual([keep]);
  });

  it("a saved spot is the student's own, and it never counts in the stats", async () => {
    await tap(s1, 3, { kind: "save" });
    const mine = await rows<{ kind: string }>(s1, "select kind from public.lost_taps where lecture_id = $1", [LECTURE_A]);
    expect(mine).toEqual([{ kind: "save" }]);
    expect((await countOn(s1, 3)).students).toBe(0);
    expect(await rows(marko, "select id from public.lost_taps where lecture_id = $1", [LECTURE_A])).toEqual([]);
  });

  it("a student reads the lecture and its first lines, and a stranger reads nothing", async () => {
    const lectures = await rows<{ name: string; lecture_date: string; slide_count: number }>(
      s1,
      "select name, lecture_date::text as lecture_date, slide_count from public.lectures",
    );
    expect(lectures).toEqual([{ name: "Lecture 1, Oct 26", lecture_date: "2026-10-26", slide_count: 10 }]);
    const lines = await rows<{ number: number; first_line: string }>(
      s1,
      "select number, first_line from public.slides where lecture_id = $1 order by number",
      [LECTURE_A],
    );
    expect(lines).toEqual([
      { number: 1, first_line: "Welcome" },
      { number: 2, first_line: "Agenda" },
    ]);
    expect(await rows(stranger, "select id from public.lectures")).toEqual([]);
    expect(await rows(stranger, "select number from public.slides")).toEqual([]);
  });

  it("the lectures a student joined stay readable after the lecture ends, and only theirs", async () => {
    await as(db, marko, () => db.query("select public.end_lecture($1)", [LECTURE_A]));
    const joined = await rows<{ name: string; status: string }>(
      s1,
      `select l.name, l.status
       from public.participants p join public.lectures l on l.id = p.lecture_id
       order by l.lecture_date desc`,
    );
    expect(joined).toEqual([{ name: "Lecture 1, Oct 26", status: "ended" }]);
    expect((await stats(s1)).length).toBe(10);
  });

  it("archiving the course changes nothing a student reads on My spots", async () => {
    await as(db, marko, () => db.query("select public.end_lecture($1)", [LECTURE_A]));
    const read = async () => ({
      lectures: await rows(s1, "select id, name, status from public.lectures"),
      slides: await rows(s1, "select number, first_line from public.slides where lecture_id = $1 order by number", [LECTURE_A]),
      taps: await rows(s1, "select id, kind, note, slide_number from public.lost_taps order by id"),
      stats: await stats(s1),
    });
    const before = await read();
    await as(db, marko, () => db.query("update public.courses set archived = true"));
    expect(await read()).toEqual(before);
    expect(before.lectures).toHaveLength(1);
  });
});

describe("my spots: move the marker and edit the note", () => {
  it("after the move the count is on slide 6, not 7", async () => {
    const id = await tap(s1, 7);
    expect((await countOn(s1, 7)).students).toBe(1);
    const moved = await rows(s1, "update public.lost_taps set slide_number = 6 where id = $1 returning id", [id]);
    expect(moved).toHaveLength(1);
    expect(await countOn(s1, 6)).toMatchObject({ taps: 1, students: 1 });
    expect(await countOn(s1, 7)).toMatchObject({ taps: 0, students: 0 });
  });

  it("the slide that was tapped on never changes", async () => {
    const id = await tap(s1, 7);
    await as(db, s1, () => db.query("update public.lost_taps set slide_number = 6 where id = $1", [id]));
    const [row] = await rows<{ tapped_on_slide: number; slide_number: number }>(
      s1,
      "select tapped_on_slide, slide_number from public.lost_taps where id = $1",
      [id],
    );
    expect(row).toEqual({ tapped_on_slide: 7, slide_number: 6 });
  });

  it("the marker can not go below slide 1 or later than the slide tapped on", async () => {
    const id = await tap(s1, 1);
    await expect(
      as(db, s1, () => db.query("update public.lost_taps set slide_number = 0 where id = $1", [id])),
    ).rejects.toThrow();
    await expect(
      as(db, s1, () => db.query("update public.lost_taps set slide_number = 2 where id = $1", [id])),
    ).rejects.toThrow();
    expect((await countOn(s1, 1)).students).toBe(1);
  });

  it("a student can not move or edit another student's row (no row is changed)", async () => {
    const id = await tap(s1, 7, { note: "mine" });
    const moved = await rows(s2, "update public.lost_taps set slide_number = 6 where id = $1 returning id", [id]);
    const edited = await rows(s2, "update public.lost_taps set note = 'hacked' where id = $1 returning id", [id]);
    expect(moved).toEqual([]);
    expect(edited).toEqual([]);
    const [row] = await rows<{ slide_number: number; note: string }>(
      s1,
      "select slide_number, note from public.lost_taps where id = $1",
      [id],
    );
    expect(row).toEqual({ slide_number: 7, note: "mine" });
  });

  it("a student edits their own note, up to 2000 characters (0020; it was 140)", async () => {
    const id = await tap(s1, 7);
    const saved = await rows(s1, "update public.lost_taps set note = $2 where id = $1 returning id", [id, "x".repeat(2000)]);
    expect(saved).toHaveLength(1);
    await expect(
      as(db, s1, () => db.query("update public.lost_taps set note = $2 where id = $1", [id, "x".repeat(2001)])),
    ).rejects.toThrow();
    const cleared = await rows(s1, "update public.lost_taps set note = null where id = $1 returning id", [id]);
    expect(cleared).toHaveLength(1);
  });
});
