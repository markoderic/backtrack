// @vitest-environment node
// 0020: the private notebook (notebook_notes) and save_notebook_note. A student reads, adds,
// changes and deletes only their own notes, only for a lecture they joined. No teacher can read
// them. Up to 20000 characters a note.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newDb, as, type Claims } from "./harness";

const MARKO = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const COURSE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_COURSE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const LIVE = "cccccccc-cccc-cccc-cccc-000000000001";
const NOT_JOINED = "cccccccc-cccc-cccc-cccc-000000000002";
const OLD = "cccccccc-cccc-cccc-cccc-000000000003";

const google = { provider: "google" };
const marko: Claims = { sub: MARKO, email: "dericm@miamioh.edu", app_metadata: google };
const other: Claims = { sub: OTHER, email: "other@miamioh.edu", app_metadata: google };
const student = (n: number): Claims => ({
  sub: `44444444-4444-4444-4444-${String(n).padStart(12, "0")}`,
  is_anonymous: true,
  app_metadata: { provider: "anonymous" },
});
const s1 = student(1);
const s2 = student(2);

let db: PGlite;

beforeEach(async () => {
  db = await newDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${MARKO}', 'dericm@miamioh.edu'), ('${OTHER}', 'other@miamioh.edu');
    insert into public.teachers (id, email, display_name) values
      ('${MARKO}', 'dericm@miamioh.edu', 'Marko'), ('${OTHER}', 'other@miamioh.edu', 'Other');
    insert into public.courses (id, teacher_id, name) values
      ('${COURSE}', '${MARKO}', 'IMS 452'), ('${OTHER_COURSE}', '${OTHER}', 'BIO 121');
    insert into public.lectures (id, course_id, name, code, status, current_slide, slide_count) values
      ('${LIVE}', '${COURSE}', 'Lecture 1, Oct 26', '482916', 'live', 3, 10),
      ('${NOT_JOINED}', '${COURSE}', 'Lecture 2, Oct 28', '735018', 'live', 1, 10),
      ('${OLD}', '${COURSE}', 'Lecture 0, Oct 21', '615243', 'live', 1, 10);
  `);
  for (const s of [s1, s2]) {
    await as(db, s, () => db.query("select public.join_lecture($1)", ["482916"]));
    await as(db, s, () => db.query("select public.join_lecture($1)", ["615243"]));
  }
  // The old lecture ended a week ago: My spots still lets the student write in the notebook.
  await db.exec(`update public.lectures set status = 'ended', code = null, ended_at = now() - interval '7 days' where id = '${OLD}'`);
});

afterEach(async () => {
  await db.close();
});

const q = <T extends object = Record<string, unknown>>(claims: Claims | null, sql: string, params: unknown[] = []) =>
  as(db, claims, async () => {
    const res = await db.query<T>(sql, params);
    return { rows: res.rows, affected: res.affectedRows ?? 0 };
  });
const save = (claims: Claims, slide: number, body: string, lecture = LIVE) =>
  q<{ at: string | null }>(claims, "select public.save_notebook_note($1, $2, $3) as at", [lecture, slide, body]);
const all = async () =>
  (
    await db.query<{ anon_id: string; lecture_id: string; slide_number: number; body: string }>(
      "select anon_id, lecture_id, slide_number, body from public.notebook_notes order by anon_id, lecture_id, slide_number",
    )
  ).rows;
const denied = /permission denied/i;
const rls = /row-level security/i;

describe("the student's own notebook", () => {
  it("saves a note for a slide, replaces it on the next save (one row a slide) and reads it back", async () => {
    const first = await save(s1, 2, "first try");
    expect(first.rows[0].at).not.toBeNull();
    await save(s1, 2, "  the derivative is the slope  ");
    await save(s1, 3, "slide three");
    expect(await all()).toEqual([
      { anon_id: s1.sub, lecture_id: LIVE, slide_number: 2, body: "  the derivative is the slope  " },
      { anon_id: s1.sub, lecture_id: LIVE, slide_number: 3, body: "slide three" },
    ]);
    const mine = await q(s1, "select slide_number, body from public.notebook_notes where lecture_id = $1 order by slide_number", [LIVE]);
    expect(mine.rows).toEqual([
      { slide_number: 2, body: "  the derivative is the slope  " },
      { slide_number: 3, body: "slide three" },
    ]);
  });

  it("an empty (or only spaces) note removes the row", async () => {
    await save(s1, 2, "something");
    const gone = await save(s1, 2, " \n\t ");
    expect(gone.rows[0].at).toBeNull();
    expect(await all()).toEqual([]);
    // Removing a note that is not there is fine too.
    await expect(save(s1, 5, "")).resolves.toBeTruthy();
  });

  it("works on the table directly too: insert, update the text, delete", async () => {
    await q(s1, "insert into public.notebook_notes (lecture_id, slide_number, body) values ($1, 4, 'direct')", [LIVE]);
    expect((await all())[0]).toMatchObject({ anon_id: s1.sub, slide_number: 4, body: "direct" });
    const upd = await q(s1, "update public.notebook_notes set body = 'changed' where lecture_id = $1 and slide_number = 4", [LIVE]);
    expect(upd.affected).toBe(1);
    const del = await q(s1, "delete from public.notebook_notes where lecture_id = $1 and slide_number = 4", [LIVE]);
    expect(del.affected).toBe(1);
    expect(await all()).toEqual([]);
  });

  it("works after the lecture ended (from My spots)", async () => {
    await save(s1, 1, "after class", OLD);
    await save(s1, 1, "after class, again", OLD);
    expect(await all()).toEqual([{ anon_id: s1.sub, lecture_id: OLD, slide_number: 1, body: "after class, again" }]);
  });

  it("updated_at is the server's time: set on every save, and the student can not write it", async () => {
    await save(s1, 2, "a");
    const before = (await db.query<{ t: string }>("select updated_at::text as t from public.notebook_notes")).rows[0].t;
    await new Promise((r) => setTimeout(r, 5));
    await save(s1, 2, "b");
    const after = (await db.query<{ t: string }>("select updated_at::text as t from public.notebook_notes")).rows[0].t;
    expect(after > before).toBe(true);
    await expect(
      q(s1, "update public.notebook_notes set updated_at = '2000-01-01' where lecture_id = $1", [LIVE]),
    ).rejects.toThrow(denied);
    await expect(
      q(s1, "insert into public.notebook_notes (lecture_id, slide_number, body, updated_at) values ($1, 6, 'x', '2000-01-01')", [LIVE]),
    ).rejects.toThrow(denied);
  });

  it("can not move a note to another slide, lecture or student", async () => {
    await save(s1, 2, "mine");
    await expect(q(s1, "update public.notebook_notes set slide_number = 3 where lecture_id = $1", [LIVE])).rejects.toThrow(denied);
    await expect(q(s1, "update public.notebook_notes set lecture_id = $1", [OLD])).rejects.toThrow(denied);
    await expect(q(s1, "update public.notebook_notes set anon_id = $1", [s2.sub])).rejects.toThrow(denied);
  });
});

describe("20000 characters", () => {
  it("takes a note of exactly 20000 characters and refuses 20001", async () => {
    await save(s1, 2, "a".repeat(20000));
    expect((await all())[0].body).toHaveLength(20000);
    await expect(save(s1, 2, "a".repeat(20001))).rejects.toMatchObject({ code: "23514" });
    await expect(save(s1, 3, "é".repeat(20001))).rejects.toMatchObject({ code: "23514" });
    expect((await all()).map((r) => r.body.length)).toEqual([20000]);
  });
});

describe("only lectures the student joined, only real slides", () => {
  it("refuses a note for a lecture the student did not join", async () => {
    await expect(save(s1, 1, "sneaky", NOT_JOINED)).rejects.toThrow(rls);
    await expect(
      q(s1, "insert into public.notebook_notes (lecture_id, slide_number, body) values ($1, 1, 'x')", [NOT_JOINED]),
    ).rejects.toThrow(rls);
    expect(await all()).toEqual([]);
  });

  it("refuses slide 0 and a slide past the end", async () => {
    await expect(save(s1, 0, "x")).rejects.toBeTruthy();
    await expect(save(s1, 11, "x")).rejects.toThrow(rls);
    await save(s1, 10, "last slide");
    expect((await all()).map((r) => r.slide_number)).toEqual([10]);
  });

  it("refuses a visitor who is not signed in", async () => {
    await expect(q(null, "select * from public.notebook_notes")).rejects.toThrow(denied);
    await expect(q(null, "select public.save_notebook_note($1, 1, 'x')", [LIVE])).rejects.toThrow(denied);
    await expect(q(null, "insert into public.notebook_notes (lecture_id, anon_id, slide_number, body) values ($1, $2, 1, 'x')", [LIVE, s1.sub])).rejects.toThrow(
      denied,
    );
  });
});

describe("nobody else", () => {
  beforeEach(async () => {
    await save(s1, 2, "my private note");
  });

  it("another student can not read, change or delete my note", async () => {
    expect((await q(s2, "select * from public.notebook_notes")).rows).toEqual([]);
    expect((await q(s2, "update public.notebook_notes set body = 'hacked'")).affected).toBe(0);
    expect((await q(s2, "delete from public.notebook_notes")).affected).toBe(0);
    expect(await all()).toEqual([{ anon_id: s1.sub, lecture_id: LIVE, slide_number: 2, body: "my private note" }]);
  });

  it("another student can not write a note in my name", async () => {
    await expect(
      q(s2, "insert into public.notebook_notes (lecture_id, anon_id, slide_number, body) values ($1, $2, 3, 'x')", [LIVE, s1.sub]),
    ).rejects.toThrow(rls);
    // save_notebook_note always writes the caller's own row.
    await save(s2, 2, "s2's own");
    expect((await all()).map((r) => [r.anon_id, r.body])).toEqual([
      [s1.sub, "my private note"],
      [s2.sub, "s2's own"],
    ]);
  });

  it("the teacher of the course can never read the notebook (no rule lets them), nor change or delete it", async () => {
    expect((await q(marko, "select * from public.notebook_notes")).rows).toEqual([]);
    expect((await q(marko, "select count(*)::int as n from public.notebook_notes where lecture_id = $1", [LIVE])).rows).toEqual([
      { n: 0 },
    ]);
    expect((await q(marko, "update public.notebook_notes set body = 'x'")).affected).toBe(0);
    expect((await q(marko, "delete from public.notebook_notes")).affected).toBe(0);
    expect((await q(other, "select * from public.notebook_notes")).rows).toEqual([]);
    // The only policies on the table are the student's own.
    const policies = (
      await db.query<{ policyname: string }>(
        "select policyname from pg_policies where schemaname = 'public' and tablename = 'notebook_notes' order by policyname",
      )
    ).rows.map((r) => r.policyname);
    expect(policies).toEqual([
      "notebook_notes_delete_own",
      "notebook_notes_insert_own",
      "notebook_notes_select_own",
      "notebook_notes_update_own",
    ]);
    expect(await all()).toHaveLength(1);
  });

  it("the teacher reads nothing even after joining their own lecture as a student", async () => {
    await as(db, marko, () => db.query("select public.join_lecture($1)", ["482916"]));
    expect((await q(marko, "select * from public.notebook_notes")).rows).toEqual([]);
  });

  it("no truncate for anyone", async () => {
    await expect(q(marko, "truncate public.notebook_notes")).rejects.toThrow(denied);
    await expect(q(s1, "truncate public.notebook_notes")).rejects.toThrow(denied);
    await expect(q(null, "truncate public.notebook_notes")).rejects.toThrow(denied);
  });
});

describe("deleting the lecture", () => {
  it("takes its notebook notes with it", async () => {
    await save(s1, 1, "gone with the lecture", OLD);
    await save(s1, 1, "stays");
    await as(db, marko, () => db.query("select * from public.delete_lecture($1)", [OLD]));
    expect(await all()).toEqual([{ anon_id: s1.sub, lecture_id: LIVE, slide_number: 1, body: "stays" }]);
  });
});
