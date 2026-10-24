// @vitest-environment node
// 0020: marks (slide_marks). Several boxes a slide, 'lost' or 'save', each with a private note.
// The student does everything on their own marks of lectures they joined (added while live or
// up to 15 minutes after the end, changed or deleted any time); the teacher reads 'lost' marks of
// their own lectures, never a mark's note and never a 'save'. 30 a slide, 300 a lecture.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newDb, as, type Claims } from "./harness";

const MARKO = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const COURSE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_COURSE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const LIVE = "cccccccc-cccc-cccc-cccc-000000000001";
const NOT_JOINED = "cccccccc-cccc-cccc-cccc-000000000002";
const JUST_ENDED = "cccccccc-cccc-cccc-cccc-000000000003";
const ENDED_LONG_AGO = "cccccccc-cccc-cccc-cccc-000000000004";
const OTHERS_LECTURE = "cccccccc-cccc-cccc-cccc-000000000005";

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
let n = 0;
const markId = () => `77777777-7777-7777-7777-${String(++n).padStart(12, "0")}`;

beforeEach(async () => {
  n = 0;
  db = await newDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${MARKO}', 'dericm@miamioh.edu'), ('${OTHER}', 'other@miamioh.edu');
    insert into public.teachers (id, email, display_name) values
      ('${MARKO}', 'dericm@miamioh.edu', 'Marko'), ('${OTHER}', 'other@miamioh.edu', 'Other');
    insert into public.courses (id, teacher_id, name) values
      ('${COURSE}', '${MARKO}', 'IMS 452'), ('${OTHER_COURSE}', '${OTHER}', 'BIO 121');
    insert into public.lectures (id, course_id, name, code, status, current_slide, slide_count) values
      ('${LIVE}', '${COURSE}', 'Lecture 1', '482916', 'live', 3, 20),
      ('${NOT_JOINED}', '${COURSE}', 'Lecture 2', '735018', 'live', 1, 10),
      ('${JUST_ENDED}', '${COURSE}', 'Lecture 3', '615243', 'live', 1, 10),
      ('${ENDED_LONG_AGO}', '${COURSE}', 'Lecture 4', '529731', 'live', 1, 10),
      ('${OTHERS_LECTURE}', '${OTHER_COURSE}', 'Bio 1', '318264', 'live', 1, 10);
  `);
  for (const s of [s1, s2]) {
    for (const code of ["482916", "615243", "529731", "318264"]) {
      await as(db, s, () => db.query("select public.join_lecture($1)", [code]));
    }
  }
  await db.exec(`
    update public.lectures set status = 'ended', code = null, ended_at = now() - interval '10 minutes' where id = '${JUST_ENDED}';
    update public.lectures set status = 'ended', code = null, ended_at = now() - interval '20 minutes' where id = '${ENDED_LONG_AGO}';
  `);
});

afterEach(async () => {
  await db.close();
});

const q = <T extends object = Record<string, unknown>>(claims: Claims | null, sql: string, params: unknown[] = []) =>
  as(db, claims, async () => {
    const res = await db.query<T>(sql, params);
    return { rows: res.rows, affected: res.affectedRows ?? 0 };
  });

type MarkIn = {
  id?: string;
  lecture?: string;
  slide?: number;
  rect?: [number, number, number, number];
  kind?: "lost" | "save";
  note?: string | null;
  anon?: string;
};
/** One mark as the student, the way the app sends it (insert, on conflict do nothing). */
const add = (claims: Claims, m: MarkIn = {}) => {
  const id = m.id ?? markId();
  const [x, y, w, h] = m.rect ?? [0.1, 0.2, 0.3, 0.1];
  return q(
    claims,
    `insert into public.slide_marks (id, lecture_id, anon_id, slide_number, x, y, w, h, kind, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (id) do nothing`,
    [id, m.lecture ?? LIVE, m.anon ?? claims.sub, m.slide ?? 2, x, y, w, h, m.kind ?? "save", m.note ?? null],
  ).then((r) => ({ ...r, id }));
};
const all = async () =>
  (
    await db.query<{ id: string; anon_id: string; lecture_id: string; slide_number: number; kind: string; note: string | null }>(
      "select id, anon_id, lecture_id, slide_number, kind, note from public.slide_marks order by id",
    )
  ).rows;
const count = async (claims: Claims, lecture = LIVE) =>
  Number(
    (
      await db.query<{ n: string }>("select count(*) as n from public.slide_marks where anon_id = $1 and lecture_id = $2", [
        claims.sub,
        lecture,
      ])
    ).rows[0].n,
  );
const denied = /permission denied/i;
const rls = /row-level security/i;

/** Rows put in directly (as the owner, so no limit). */
const seed = (claims: Claims, howMany: number, slide: (i: number) => number, lecture = LIVE) =>
  db.query(
    `insert into public.slide_marks (lecture_id, anon_id, slide_number, x, y, w, h)
     select $1, $2, s.n, 0.1, 0.1, 0.1, 0.1 from unnest($3::int[]) as s(n)`,
    [lecture, claims.sub, Array.from({ length: howMany }, (_, i) => slide(i))],
  );

describe("the student's own marks", () => {
  it("adds several marks on one slide, both kinds, each with its own note, and reads them back with my_slide_marks", async () => {
    const a = await add(s1, { kind: "save", note: "look at this" });
    const b = await add(s1, { kind: "lost", rect: [0.5, 0.5, 0.25, 0.25] });
    const c = await add(s1, { slide: 3 });
    const mine = await q<{ id: string; slide_number: number; kind: string; note: string | null; x: number; w: number }>(
      s1,
      "select id, slide_number, kind, note, x, w from public.my_slide_marks($1)",
      [LIVE],
    );
    expect(mine.rows.map((r) => [r.id, r.slide_number, r.kind, r.note])).toEqual([
      [a.id, 2, "save", "look at this"],
      [b.id, 2, "lost", null],
      [c.id, 3, "save", null],
    ]);
    expect(mine.rows[1].x).toBeCloseTo(0.5);
    expect(mine.rows[1].w).toBeCloseTo(0.25);
  });

  it("my_slide_marks with no lecture gives every lecture's marks, and never another student's", async () => {
    await add(s1, { lecture: LIVE });
    await add(s1, { lecture: JUST_ENDED });
    await add(s2, { lecture: LIVE, note: "s2's note" });
    const mine = await q<{ lecture_id: string; note: string | null }>(s1, "select lecture_id, note from public.my_slide_marks()");
    expect(mine.rows.map((r) => r.lecture_id).sort()).toEqual([LIVE, JUST_ENDED].sort());
    expect(mine.rows.every((r) => r.note === null)).toBe(true);
  });

  it("reads its own marks from the table too (without the note column)", async () => {
    const a = await add(s1, { kind: "save", note: "private" });
    const rows = await q(s1, "select id, slide_number, kind, x, y, w, h, created_at, updated_at from public.slide_marks");
    expect(rows.rows.map((r) => r.id)).toEqual([a.id]);
  });

  it("changes the box, the note and the kind of its own mark; updated_at follows", async () => {
    const a = await add(s1);
    const before = (await db.query<{ t: string }>("select updated_at::text as t from public.slide_marks")).rows[0].t;
    await new Promise((r) => setTimeout(r, 5));
    const upd = await q(s1, "update public.slide_marks set x = 0.4, y = 0.4, w = 0.2, h = 0.2, note = 'new note', kind = 'lost' where id = $1", [
      a.id,
    ]);
    expect(upd.affected).toBe(1);
    const row = (await db.query<{ x: number; note: string; kind: string; t: string }>(
      "select x, note, kind, updated_at::text as t from public.slide_marks",
    )).rows[0];
    expect(row.x).toBeCloseTo(0.4);
    expect(row).toMatchObject({ note: "new note", kind: "lost" });
    expect(row.t > before).toBe(true);
    // Clearing the note.
    await q(s1, "update public.slide_marks set note = null where id = $1", [a.id]);
    expect((await all())[0].note).toBeNull();
  });

  it("deletes its own mark", async () => {
    const a = await add(s1);
    await add(s1);
    expect((await q(s1, "delete from public.slide_marks where id = $1", [a.id])).affected).toBe(1);
    expect(await count(s1)).toBe(1);
  });

  it("a resend of the same mark (same id) adds nothing", async () => {
    const a = await add(s1);
    await add(s1, { id: a.id });
    expect(await count(s1)).toBe(1);
  });

  it("can not move a mark to another slide, lecture or student, or set its times", async () => {
    const a = await add(s1);
    for (const set of ["slide_number = 3", `lecture_id = '${JUST_ENDED}'`, `anon_id = '${s2.sub}'`, "created_at = now()", "updated_at = now()", `id = '${markId()}'`]) {
      await expect(q(s1, `update public.slide_marks set ${set} where id = $1`, [a.id]), set).rejects.toThrow(denied);
    }
    await expect(
      q(s1, `insert into public.slide_marks (lecture_id, slide_number, x, y, w, h, created_at) values ($1, 2, 0.1, 0.1, 0.1, 0.1, now())`, [LIVE]),
    ).rejects.toThrow(denied);
  });
});

describe("what a mark may be", () => {
  it("the box lies inside the slide with a real width and height", async () => {
    for (const rect of [
      [0.1, 0.1, 0, 0.1],
      [0.1, 0.1, 0.1, 0],
      [-0.01, 0.1, 0.1, 0.1],
      [0.1, -0.01, 0.1, 0.1],
      [0.8, 0.1, 0.3, 0.1],
      [0.1, 0.95, 0.1, 0.1],
    ] as [number, number, number, number][]) {
      await expect(add(s1, { rect }), rect.join(",")).rejects.toMatchObject({ code: "23514" });
    }
    await add(s1, { rect: [0, 0, 1, 1] });
    expect(await count(s1)).toBe(1);
  });

  it("kind is 'lost' or 'save'", async () => {
    await expect(q(s1, `insert into public.slide_marks (lecture_id, slide_number, x, y, w, h, kind) values ($1, 2, 0.1, 0.1, 0.1, 0.1, 'other')`, [LIVE])).rejects.toMatchObject({
      code: "23514",
    });
    // Without a kind it is a 'save' (private).
    await q(s1, `insert into public.slide_marks (lecture_id, slide_number, x, y, w, h) values ($1, 2, 0.1, 0.1, 0.1, 0.1)`, [LIVE]);
    expect((await all())[0]).toMatchObject({ kind: "save", anon_id: s1.sub });
  });

  it("a note of 2000 characters is fine, 2001 is refused", async () => {
    const a = await add(s1, { note: "n".repeat(2000) });
    expect((await all())[0].note).toHaveLength(2000);
    await expect(add(s1, { note: "n".repeat(2001) })).rejects.toMatchObject({ code: "23514" });
    await expect(q(s1, "update public.slide_marks set note = $2 where id = $1", [a.id, "n".repeat(2001)])).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("only slides 1 to the slide count", async () => {
    await expect(add(s1, { slide: 0 })).rejects.toBeTruthy();
    await expect(add(s1, { slide: 21 })).rejects.toThrow(rls);
    await add(s1, { slide: 20 });
    expect(await count(s1)).toBe(1);
  });
});

describe("when, and only lectures the student joined", () => {
  it("refuses a mark on a lecture the student did not join", async () => {
    await expect(add(s1, { lecture: NOT_JOINED })).rejects.toThrow(rls);
  });

  it("takes a mark up to 15 minutes after the end, not later", async () => {
    await add(s1, { lecture: JUST_ENDED });
    await expect(add(s1, { lecture: ENDED_LONG_AGO })).rejects.toThrow(rls);
    expect(await count(s1, JUST_ENDED)).toBe(1);
  });

  it("changes and deletes its own marks any time after (My spots), like Remove and Edit note", async () => {
    const a = (await seed(s1, 2, () => 2, ENDED_LONG_AGO), await all());
    expect(a).toHaveLength(2);
    expect((await q(s1, "update public.slide_marks set note = 'later', kind = 'lost' where id = $1", [a[0].id])).affected).toBe(1);
    expect((await q(s1, "delete from public.slide_marks where id = $1", [a[1].id])).affected).toBe(1);
    expect(await all()).toMatchObject([{ id: a[0].id, note: "later", kind: "lost" }]);
  });

  it("refuses a visitor who is not signed in", async () => {
    await expect(q(null, "select id from public.slide_marks")).rejects.toThrow(denied);
    await expect(q(null, "select * from public.my_slide_marks()")).rejects.toThrow(denied);
    await expect(
      q(null, "insert into public.slide_marks (lecture_id, anon_id, slide_number, x, y, w, h) values ($1, $2, 2, 0.1, 0.1, 0.1, 0.1)", [LIVE, s1.sub]),
    ).rejects.toThrow(denied);
  });
});

describe("another student", () => {
  it("can not read, change or delete my marks, nor read their notes", async () => {
    await add(s1, { kind: "lost", note: "mine" });
    await add(s1, { kind: "save", note: "mine too" });
    expect((await q(s2, "select id from public.slide_marks")).rows).toEqual([]);
    expect((await q(s2, "select * from public.my_slide_marks($1)", [LIVE])).rows).toEqual([]);
    expect((await q(s2, "update public.slide_marks set x = 0, note = 'hacked'")).affected).toBe(0);
    expect((await q(s2, "delete from public.slide_marks")).affected).toBe(0);
    expect((await all()).map((r) => r.note)).toEqual(["mine", "mine too"]);
  });

  it("can not add a mark in my name", async () => {
    await expect(add(s2, { anon: s1.sub })).rejects.toThrow(rls);
    expect(await all()).toEqual([]);
  });
});

describe("the teacher", () => {
  beforeEach(async () => {
    await add(s1, { kind: "lost", note: "I'm stuck on this term" });
    await add(s1, { kind: "save", note: "for the exam" });
    await add(s2, { kind: "lost", slide: 3 });
    await add(s1, { kind: "lost", lecture: OTHERS_LECTURE });
  });

  it("reads the 'lost' marks of their own lectures: where the box is and whose, never a 'save'", async () => {
    const rows = await q<{ anon_id: string; slide_number: number; kind: string; lecture_id: string }>(
      marko,
      "select anon_id, slide_number, kind, lecture_id, x, y, w, h, created_at, updated_at from public.slide_marks order by slide_number",
    );
    expect(rows.rows.map((r) => [r.lecture_id, r.anon_id, r.slide_number, r.kind])).toEqual([
      [LIVE, s1.sub, 2, "lost"],
      [LIVE, s2.sub, 3, "lost"],
    ]);
    expect((await q(marko, "select id from public.slide_marks where kind = 'save'")).rows).toEqual([]);
    // The other teacher sees only their own lecture's lost mark.
    expect((await q<{ lecture_id: string }>(other, "select lecture_id from public.slide_marks")).rows).toEqual([
      { lecture_id: OTHERS_LECTURE },
    ]);
  });

  it("can never read a mark's note: not from the table, not with my_slide_marks", async () => {
    await expect(q(marko, "select note from public.slide_marks")).rejects.toThrow(denied);
    await expect(q(marko, "select * from public.slide_marks")).rejects.toThrow(denied);
    await expect(q(marko, "select id from public.slide_marks where note is not null")).rejects.toThrow(denied);
    expect((await q(marko, "select * from public.my_slide_marks($1)", [LIVE])).rows).toEqual([]);
    expect((await q(marko, "select * from public.my_slide_marks()")).rows).toEqual([]);
    // Realtime sends only the columns the role may select: note is not one of them.
    const priv = await db.query<{ note: boolean; x: boolean }>(
      "select has_column_privilege('authenticated', 'public.slide_marks', 'note', 'SELECT') as note, has_column_privilege('authenticated', 'public.slide_marks', 'x', 'SELECT') as x",
    );
    expect(priv.rows[0]).toEqual({ note: false, x: true });
  });

  it("joining their own lecture as a student still shows them no save and no note", async () => {
    await as(db, marko, () => db.query("select public.join_lecture($1)", ["482916"]));
    expect((await q(marko, "select id from public.slide_marks where kind = 'save'")).rows).toEqual([]);
    expect((await q(marko, "select * from public.my_slide_marks($1)", [LIVE])).rows).toEqual([]);
  });

  it("can not change, delete or add students' marks", async () => {
    expect((await q(marko, "update public.slide_marks set x = 0")).affected).toBe(0);
    expect((await q(marko, "delete from public.slide_marks")).affected).toBe(0);
    await expect(add(marko, { anon: s1.sub })).rejects.toThrow(rls);
    expect(await all()).toHaveLength(4);
  });

  it("loses sight of a mark the student turns into a 'save', and sees one turned into 'lost'", async () => {
    const [save] = (await all()).filter((r) => r.kind === "save");
    await q(s1, "update public.slide_marks set kind = 'lost' where id = $1", [save.id]);
    expect((await q(marko, "select id from public.slide_marks where id = $1", [save.id])).rows).toHaveLength(1);
    await q(s1, "update public.slide_marks set kind = 'save' where id = $1", [save.id]);
    expect((await q(marko, "select id from public.slide_marks where id = $1", [save.id])).rows).toHaveLength(0);
  });

  it("no truncate for anyone", async () => {
    await expect(q(marko, "truncate public.slide_marks")).rejects.toThrow(denied);
    await expect(q(s1, "truncate public.slide_marks")).rejects.toThrow(denied);
    await expect(q(null, "truncate public.slide_marks")).rejects.toThrow(denied);
  });
});

describe("30 a slide, 300 a lecture", () => {
  it("refuses the 31st mark on one slide with BT429, and saves nothing", async () => {
    await seed(s1, 29, () => 2);
    await add(s1);
    const e = await add(s1).catch((err: { code?: string; message: string }) => err);
    expect(e).toMatchObject({ code: "BT429", message: "Too many marks on this slide." });
    expect(await count(s1)).toBe(30);
    // Another slide, and another student, are not held back.
    await add(s1, { slide: 3 });
    await add(s2);
    expect(await count(s1)).toBe(31);
  });

  it("a deleted mark frees its place; a resend at the limit is not refused", async () => {
    await seed(s1, 30, () => 2);
    const [first] = await all();
    await add(s1, { id: first.id }); // resend: on conflict do nothing, no error
    await q(s1, "delete from public.slide_marks where id = $1", [first.id]);
    await add(s1);
    expect(await count(s1)).toBe(30);
  });

  it("refuses the 301st mark in a lecture", async () => {
    await seed(s1, 300, (i) => 1 + (i % 20));
    const e = await add(s1, { slide: 5 }).catch((err: { code?: string; message: string }) => err);
    expect(e).toMatchObject({ code: "BT429", message: "Too many marks in this lecture." });
    expect(await count(s1)).toBe(300);
    await add(s1, { lecture: JUST_ENDED });
  });
});
