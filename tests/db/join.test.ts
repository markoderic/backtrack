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
    insert into public.courses (id, teacher_id, name) values
      ('${MARKO_COURSE}', '${MARKO}', 'IMS 452'),
      ('${OTHER_COURSE}', '${OTHER}', 'BIO 121');
    insert into public.lectures (id, course_id, name, code, status, current_slide, slide_count) values
      ('${LECTURE_A}', '${MARKO_COURSE}', 'Lecture 1, Oct 26', '${CODE_A}', 'live', 2, 3),
      ('${LECTURE_B}', '${OTHER_COURSE}', 'Cells, Oct 26', '${CODE_B}', 'live', 1, 2);
    insert into public.slides (lecture_id, number, image_path) values
      ('${LECTURE_A}', 1, '${LECTURE_A}/1.webp'),
      ('${LECTURE_A}', 2, '${LECTURE_A}/2.webp'),
      ('${LECTURE_A}', 3, '${LECTURE_A}/3.webp'),
      ('${LECTURE_B}', 1, '${LECTURE_B}/1.webp'),
      ('${LECTURE_B}', 2, '${LECTURE_B}/2.webp');
  `);
});

const join = (claims: Claims | null, code: string | null) =>
  as(db, claims, async () => (await db.query<{ join_lecture: string }>("select public.join_lecture($1) as join_lecture", [code])).rows[0].join_lecture);

const rows = <T extends object>(claims: Claims | null, sql: string, params: unknown[] = []) =>
  as(db, claims, async () => (await db.query<T>(sql, params)).rows);

const participantCount = async () =>
  Number((await db.query<{ n: string }>("select count(*) as n from public.participants")).rows[0].n);

describe("join_lecture", () => {
  it("returns the lecture id and records the participant", async () => {
    expect(await join(s1, CODE_A)).toBe(LECTURE_A);
    const stored = await db.query<{ lecture_id: string; anon_id: string }>(
      "select lecture_id, anon_id from public.participants",
    );
    expect(stored.rows).toEqual([{ lecture_id: LECTURE_A, anon_id: s1.sub }]);
  });

  it("trims the code", async () => {
    expect(await join(s1, `  ${CODE_A} \n`)).toBe(LECTURE_A);
  });

  it("raises not_found for a code that no lecture has", async () => {
    await expect(join(s1, "999999")).rejects.toThrow("not_found");
    expect(await participantCount()).toBe(0);
  });

  it("raises not_found for blank, short, long and null codes", async () => {
    for (const bad of ["", "   ", "48291", "4829160", "abcdef", null]) {
      await expect(join(s1, bad)).rejects.toThrow("not_found");
    }
    expect(await participantCount()).toBe(0);
  });

  it("raises the same not_found for the code of an ended lecture", async () => {
    await as(db, marko, () =>
      db.query("update public.lectures set status = 'ended', ended_at = now() where id = $1", [LECTURE_A]),
    );
    await expect(join(s1, CODE_A)).rejects.toThrow("not_found");
    expect(await participantCount()).toBe(0);
  });

  it("joining twice gives one participant row", async () => {
    expect(await join(s1, CODE_A)).toBe(LECTURE_A);
    expect(await join(s1, CODE_A)).toBe(LECTURE_A);
    expect(await participantCount()).toBe(1);
  });

  it("counts two different students as two rows", async () => {
    await join(s1, CODE_A);
    await join(s2, CODE_A);
    expect(await participantCount()).toBe(2);
  });

  it("is not callable signed out", async () => {
    await expect(join(null, CODE_A)).rejects.toThrow(/permission denied/i);
    expect(await participantCount()).toBe(0);
  });

  it("needs a user id even for an authenticated role", async () => {
    await expect(join({ sub: "" }, CODE_A)).rejects.toThrow();
    expect(await participantCount()).toBe(0);
  });
});

describe("joined_lecture", () => {
  const joined = (claims: Claims | null, id: string) =>
    as(db, claims, async () => (await db.query<{ j: boolean }>("select public.joined_lecture($1) as j", [id])).rows[0].j);

  it("is true only for the lecture the caller joined", async () => {
    await join(s1, CODE_A);
    expect(await joined(s1, LECTURE_A)).toBe(true);
    expect(await joined(s1, LECTURE_B)).toBe(false);
    expect(await joined(s2, LECTURE_A)).toBe(false);
  });

  it("is not callable signed out", async () => {
    await expect(joined(null, LECTURE_A)).rejects.toThrow(/permission denied/i);
  });
});

describe("what a student can read", () => {
  it("an anonymous user who has not joined sees no lectures and no slides", async () => {
    expect(await rows(s1, "select id from public.lectures")).toHaveLength(0);
    expect(await rows(s1, "select number from public.slides")).toHaveLength(0);
  });

  it("a participant sees their lecture and its slides but not another lecture's", async () => {
    await join(s1, CODE_A);
    expect(await rows(s1, "select id from public.lectures")).toEqual([{ id: LECTURE_A }]);
    const slides = await rows<{ lecture_id: string; number: number }>(
      s1,
      "select lecture_id, number from public.slides order by number",
    );
    expect(slides.map((s) => s.number)).toEqual([1, 2, 3]);
    expect(new Set(slides.map((s) => s.lecture_id))).toEqual(new Set([LECTURE_A]));
    expect(await rows(s1, "select id from public.lectures where id = $1", [LECTURE_B])).toHaveLength(0);
  });

  it("another student who did not join the same lecture still sees nothing", async () => {
    await join(s1, CODE_A);
    expect(await rows(s2, "select id from public.lectures")).toHaveLength(0);
  });

  it("a participant still sees the lecture and slides after it ends", async () => {
    await join(s1, CODE_A);
    await as(db, marko, () =>
      db.query("update public.lectures set status = 'ended', ended_at = now() where id = $1", [LECTURE_A]),
    );
    const seen = await rows<{ status: string }>(s1, "select status from public.lectures");
    expect(seen).toEqual([{ status: "ended" }]);
    expect(await rows(s1, "select number from public.slides")).toHaveLength(3);
  });

  it("a participant cannot change the lecture or its slides", async () => {
    await join(s1, CODE_A);
    const changed = await as(db, s1, async () =>
      (await db.query("update public.lectures set current_slide = 3 where id = $1", [LECTURE_A])).affectedRows,
    );
    expect(changed).toBe(0);
    const slideChanged = await as(db, s1, async () =>
      (await db.query("update public.slides set first_line = 'x' where lecture_id = $1", [LECTURE_A])).affectedRows,
    );
    expect(slideChanged).toBe(0);
    const current = await db.query<{ current_slide: number }>("select current_slide from public.lectures where id = $1", [LECTURE_A]);
    expect(current.rows[0].current_slide).toBe(2);
  });

  it("joining does not change what the teachers see", async () => {
    await join(s1, CODE_A);
    expect(await rows(marko, "select id from public.lectures")).toEqual([{ id: LECTURE_A }]);
    expect(await rows(other, "select id from public.lectures")).toEqual([{ id: LECTURE_B }]);
  });
});

describe("participants table", () => {
  it("a student sees only their own row", async () => {
    await join(s1, CODE_A);
    await join(s2, CODE_A);
    expect(await rows(s1, "select anon_id from public.participants")).toEqual([{ anon_id: s1.sub }]);
    expect(await rows(s2, "select anon_id from public.participants")).toEqual([{ anon_id: s2.sub }]);
  });

  it("the teacher sees the participants of their own lecture and the other teacher sees none", async () => {
    await join(s1, CODE_A);
    await join(s2, CODE_A);
    await join(student(3), CODE_B);
    const mine = await rows<{ anon_id: string }>(marko, "select anon_id from public.participants order by anon_id");
    expect(mine.map((r) => r.anon_id)).toEqual([s1.sub, s2.sub]);
    const theirs = await rows<{ anon_id: string }>(other, "select anon_id from public.participants");
    expect(theirs.map((r) => r.anon_id)).toEqual([student(3).sub]);
  });

  it("a teacher with no lecture of that class sees nothing of it", async () => {
    await join(s1, CODE_A);
    const count = await rows(other, "select 1 from public.participants where lecture_id = $1", [LECTURE_A]);
    expect(count).toHaveLength(0);
  });

  it("nobody can insert, update or delete a participant directly", async () => {
    await join(s1, CODE_A);
    for (const claims of [s1, s2, marko]) {
      await expect(
        as(db, claims, () =>
          db.query("insert into public.participants (lecture_id, anon_id) values ($1, $2)", [LECTURE_A, claims.sub]),
        ),
      ).rejects.toThrow();
    }
    const updated = await as(db, s1, async () =>
      (await db.query("update public.participants set joined_at = now() - interval '1 day'")).affectedRows,
    );
    expect(updated).toBe(0);
    const deleted = await as(db, s1, async () => (await db.query("delete from public.participants")).affectedRows);
    expect(deleted).toBe(0);
    expect(await participantCount()).toBe(1);
  });

  it("is removed with the lecture", async () => {
    await join(s1, CODE_A);
    await db.query("delete from public.courses where id = $1", [MARKO_COURSE]);
    expect(await participantCount()).toBe(0);
  });
});

describe("lecture_header", () => {
  const header = (claims: Claims | null, id: string) =>
    rows<{ lecture_name: string; course_name: string }>(claims, "select * from public.lecture_header($1)", [id]);

  it("gives a participant the lecture and course names", async () => {
    await join(s1, CODE_A);
    expect(await header(s1, LECTURE_A)).toEqual([{ lecture_name: "Lecture 1, Oct 26", course_name: "IMS 452" }]);
  });

  it("gives a participant nothing for a lecture they did not join", async () => {
    await join(s1, CODE_A);
    expect(await header(s1, LECTURE_B)).toHaveLength(0);
  });

  it("gives a student who has not joined nothing", async () => {
    expect(await header(s2, LECTURE_A)).toHaveLength(0);
  });

  it("gives the owning teacher the names and another teacher nothing", async () => {
    expect(await header(marko, LECTURE_A)).toHaveLength(1);
    expect(await header(other, LECTURE_A)).toHaveLength(0);
  });

  it("still works once the lecture has ended", async () => {
    await join(s1, CODE_A);
    await as(db, marko, () =>
      db.query("update public.lectures set status = 'ended', ended_at = now() where id = $1", [LECTURE_A]),
    );
    expect(await header(s1, LECTURE_A)).toHaveLength(1);
  });

  it("is not callable signed out", async () => {
    await expect(header(null, LECTURE_A)).rejects.toThrow(/permission denied/i);
  });
});

describe("slides storage for students", () => {
  const putObject = (name: string) =>
    db.query("insert into storage.objects (bucket_id, name) values ('slides', $1)", [name]);
  const names = async (claims: Claims | null) =>
    (await rows<{ name: string }>(claims, "select name from storage.objects order by name")).map((r) => r.name);

  beforeEach(async () => {
    await putObject(`${LECTURE_A}/1.webp`);
    await putObject(`${LECTURE_B}/1.webp`);
  });

  it("a joined student can read their lecture's images and not another lecture's", async () => {
    await join(s1, CODE_A);
    expect(await names(s1)).toEqual([`${LECTURE_A}/1.webp`]);
  });

  it("an anonymous user who has not joined can read nothing", async () => {
    expect(await names(s1)).toEqual([]);
    await join(s2, CODE_A);
    expect(await names(s1)).toEqual([]);
  });

  it("a joined student keeps the images after the lecture ends", async () => {
    await join(s1, CODE_A);
    await as(db, marko, () =>
      db.query("update public.lectures set status = 'ended', ended_at = now() where id = $1", [LECTURE_A]),
    );
    expect(await names(s1)).toEqual([`${LECTURE_A}/1.webp`]);
  });

  it("teachers still read only their own lecture's images", async () => {
    expect(await names(marko)).toEqual([`${LECTURE_A}/1.webp`]);
    expect(await names(other)).toEqual([`${LECTURE_B}/1.webp`]);
  });

  it("does not blow up on object names whose first folder is not a uuid", async () => {
    await putObject("not-a-uuid/1.webp");
    await putObject("loose.webp");
    await join(s1, CODE_A);
    expect(await names(s1)).toEqual([`${LECTURE_A}/1.webp`]);
  });
});
