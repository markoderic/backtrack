// @vitest-environment node
// 0020 as a migration: it applies on top of 0001 to 0019, runs twice, copies the highlights
// already on taps into slide_marks (and keeps them in step afterwards), raises the note to the
// teacher from 140 to 2000 characters, and adds slide_marks to Realtime where Realtime is.
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import { newDb, as, type Claims } from "./harness";

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations/0020_notebook_and_marks.sql");
const sql0020 = readFileSync(FILE, "utf8");
const before0020 = (files: string[]) => files.filter((f) => !f.startsWith("0020_"));

const MARKO = "11111111-1111-1111-1111-111111111111";
const COURSE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LIVE = "cccccccc-cccc-cccc-cccc-000000000001";
const ENDED = "cccccccc-cccc-cccc-cccc-000000000002";
const google = { provider: "google" };
const marko: Claims = { sub: MARKO, email: "dericm@miamioh.edu", app_metadata: google };
const student = (n: number): Claims => ({
  sub: `44444444-4444-4444-4444-${String(n).padStart(12, "0")}`,
  is_anonymous: true,
  app_metadata: { provider: "anonymous" },
});
const s1 = student(1);
const s2 = student(2);
const tap = (n: number) => `99999999-9999-9999-9999-${String(n).padStart(12, "0")}`;

let db: PGlite;

afterEach(async () => {
  await db.close();
});

async function setup(order?: (files: string[]) => string[]) {
  db = await newDb(order);
  await db.exec(`
    insert into auth.users (id, email) values ('${MARKO}', 'dericm@miamioh.edu');
    insert into public.teachers (id, email, display_name) values ('${MARKO}', 'dericm@miamioh.edu', 'Marko');
    insert into public.courses (id, teacher_id, name) values ('${COURSE}', '${MARKO}', 'IMS 452');
    insert into public.lectures (id, course_id, name, code, status, current_slide, slide_count) values
      ('${LIVE}', '${COURSE}', 'Lecture 1', '482916', 'live', 3, 10),
      ('${ENDED}', '${COURSE}', 'Lecture 0', '615243', 'live', 3, 10);
  `);
  for (const s of [s1, s2]) {
    await as(db, s, () => db.query("select public.join_lecture($1)", ["482916"]));
    await as(db, s, () => db.query("select public.join_lecture($1)", ["615243"]));
  }
}

const q = <T extends object = Record<string, unknown>>(claims: Claims | null, text: string, params: unknown[] = []) =>
  as(db, claims, async () => {
    const res = await db.query<T>(text, params);
    return { rows: res.rows, affected: res.affectedRows ?? 0 };
  });

type MarkRow = { id: string; anon_id: string; lecture_id: string; slide_number: number; x: number; y: number; w: number; h: number; kind: string };
const marks = async () =>
  (await db.query<MarkRow>("select id, anon_id, lecture_id, slide_number, x, y, w, h, kind from public.slide_marks order by id")).rows;
const hl = async (id: string) =>
  (await db.query<{ hl_x: number | null }>("select hl_x from public.lost_taps where id = $1", [id])).rows[0].hl_x;

/** A tap as the student sends it, with or without a highlight. */
const sendTap = (claims: Claims, id: string, o: { kind?: "lost" | "save"; slide?: number; rect?: [number, number, number, number]; lecture?: string } = {}) => {
  const [x, y, w, h] = o.rect ?? [null, null, null, null];
  return q(
    claims,
    `insert into public.lost_taps (id, lecture_id, anon_id, kind, tapped_on_slide, slide_number, hl_x, hl_y, hl_w, hl_h, tapped_at)
     values ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, now()) on conflict (id) do nothing`,
    [id, o.lecture ?? LIVE, claims.sub, o.kind ?? "lost", o.slide ?? 2, x, y, w, h],
  );
};

describe("on top of production (0001 to 0019)", () => {
  it("copies every highlight on a tap that is not undone, with the tap's id, slide, kind and box; nothing else", async () => {
    await setup(before0020);
    await sendTap(s1, tap(1), { rect: [0.1, 0.2, 0.3, 0.4] }); // lost with a highlight
    await sendTap(s1, tap(2), { kind: "save", slide: 3, rect: [0.5, 0.5, 0.5, 0.5] }); // save with a highlight
    await sendTap(s2, tap(3), { rect: [0.1, 0.1, 0.1, 0.1] }); // undone below
    await sendTap(s2, tap(4)); // no highlight
    await sendTap(s2, tap(5), { slide: 3, rect: [0.2, 0.2, 0.2, 0.2] }); // moved one slide earlier below
    await q(s2, "update public.lost_taps set undone = true where id = $1", [tap(3)]);
    await q(s2, "update public.lost_taps set slide_number = 2 where id = $1", [tap(5)]);
    // The table is not there yet.
    await expect(db.query("select 1 from public.slide_marks")).rejects.toThrow(/does not exist/);

    await db.exec(sql0020);
    const rows = await marks();
    expect(rows.map((r) => [r.id, r.anon_id, r.slide_number, r.kind])).toEqual([
      [tap(1), s1.sub, 2, "lost"],
      [tap(2), s1.sub, 3, "save"],
      [tap(5), s2.sub, 2, "lost"],
    ]);
    expect(rows[0].x).toBeCloseTo(0.1);
    expect(rows[0].y).toBeCloseTo(0.2);
    expect(rows[0].w).toBeCloseTo(0.3);
    expect(rows[0].h).toBeCloseTo(0.4);
    // The taps keep their highlight columns as they were.
    expect(await hl(tap(1))).toBeCloseTo(0.1);
    expect(await hl(tap(3))).toBeCloseTo(0.1);
  });

  it("runs twice: no error, no second copy, same policies and triggers", async () => {
    await setup(before0020);
    await sendTap(s1, tap(1), { rect: [0.1, 0.2, 0.3, 0.4] });
    await db.exec(sql0020);
    const shape = async () => ({
      policies: (await db.query("select tablename, policyname, cmd, qual, with_check from pg_policies where tablename in ('slide_marks', 'notebook_notes', 'lost_taps') order by 1, 2")).rows,
      triggers: (await db.query("select tgname from pg_trigger where not tgisinternal order by 1")).rows,
      checks: (await db.query("select conname, pg_get_constraintdef(oid) as d from pg_constraint where conrelid in ('public.lost_taps'::regclass, 'public.slide_marks'::regclass, 'public.notebook_notes'::regclass) order by 1")).rows,
      grants: (await db.query("select table_name, column_name, privilege_type, grantee from information_schema.column_privileges where table_name in ('slide_marks', 'notebook_notes') order by 1, 2, 3, 4")).rows,
    });
    const first = await shape();
    await db.exec(sql0020);
    expect(await shape()).toEqual(first);
    expect((await marks()).map((r) => r.id)).toEqual([tap(1)]);
  });

  it("nobody can call the trigger functions or my_slide_marks without signing in", async () => {
    await setup();
    const can = async (role: string, fn: string) =>
      (await db.query<{ ok: boolean }>("select has_function_privilege($1, $2, 'execute') as ok", [role, fn])).rows[0].ok;
    for (const fn of [
      "public.notebook_notes_touch()",
      "public.slide_marks_touch()",
      "public.slide_marks_limit()",
      "public.lost_taps_copy_mark()",
      "public.slide_marks_clear_tap()",
    ]) {
      expect(await can("authenticated", fn), fn).toBe(false);
      expect(await can("anon", fn), fn).toBe(false);
    }
    expect(await can("anon", "public.my_slide_marks(uuid)")).toBe(false);
    expect(await can("authenticated", "public.my_slide_marks(uuid)")).toBe(true);
    expect(await can("authenticated", "public.save_notebook_note(uuid, int, text)")).toBe(true);
  });

  it("the full migration list (with 0020) can take 0020 again", async () => {
    await setup();
    await expect(db.exec(sql0020)).resolves.toBeTruthy();
  });
});

describe("the note to the teacher: 140 before, 2000 after", () => {
  const note = (len: number, id: string) =>
    q(s1, "update public.lost_taps set note = $2 where id = $1", [id, "n".repeat(len)]);

  it("refuses 141 characters before 0020 and takes up to 2000 after it, keeping the notes there", async () => {
    await setup(before0020);
    await sendTap(s1, tap(1));
    await note(140, tap(1));
    await expect(note(141, tap(1))).rejects.toMatchObject({ code: "23514" });
    await db.exec(sql0020);
    expect(
      (await db.query<{ n: number }>("select length(note) as n from public.lost_taps where id = $1", [tap(1)])).rows[0].n,
    ).toBe(140);
    await note(141, tap(1));
    await note(2000, tap(1));
    await expect(note(2001, tap(1))).rejects.toMatchObject({ code: "23514" });
    // A new tap can carry the long note too.
    await q(
      s1,
      "insert into public.lost_taps (id, lecture_id, anon_id, tapped_on_slide, slide_number, note, tapped_at) values ($1, $2, $3, 2, 2, $4, now())",
      [tap(2), LIVE, s1.sub, "n".repeat(2000)],
    );
    // One check on note, the wider one.
    const checks = (
      await db.query<{ conname: string; d: string }>(
        "select conname, pg_get_constraintdef(oid) as d from pg_constraint where conrelid = 'public.lost_taps'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ '\\mnote\\M'",
      )
    ).rows;
    expect(checks).toHaveLength(1);
    expect(checks[0].conname).toBe("lost_taps_note_check");
    expect(checks[0].d).toContain("2000");
  });

  it("stops before changing anything if another check limits the note", async () => {
    await setup(before0020);
    await db.exec("alter table public.lost_taps add constraint lost_taps_short_note check (length(note) <= 140)");
    await expect(db.exec(sql0020)).rejects.toThrow(/Stopped: lost_taps has a check on note/);
    await expect(db.query("select 1 from public.slide_marks")).rejects.toThrow(/does not exist/);
    await expect(db.query("select 1 from public.notebook_notes")).rejects.toThrow(/does not exist/);
  });
});

describe("a highlight saved on a tap after 0020 (an open tab from before) is kept in step", () => {
  it("follows the highlight being saved, changed, moved, cleared and the tap undone", async () => {
    await setup();
    await sendTap(s1, tap(1));
    expect(await marks()).toEqual([]);
    await q(s1, "update public.lost_taps set hl_x = 0.1, hl_y = 0.1, hl_w = 0.2, hl_h = 0.2 where id = $1", [tap(1)]);
    expect((await marks()).map((r) => [r.id, r.slide_number, r.kind])).toEqual([[tap(1), 2, "lost"]]);
    await q(s1, "update public.lost_taps set hl_x = 0.5 where id = $1", [tap(1)]);
    expect((await marks())[0].x).toBeCloseTo(0.5);
    // Moving the tap one slide earlier moves its mark and keeps the box.
    await q(s1, "update public.lost_taps set slide_number = 1 where id = $1", [tap(1)]);
    expect((await marks())[0]).toMatchObject({ slide_number: 1 });
    expect((await marks())[0].x).toBeCloseTo(0.5);
    // A note alone does nothing to the mark.
    await q(s1, "update public.lost_taps set note = 'hi' where id = $1", [tap(1)]);
    expect(await marks()).toHaveLength(1);
    // Clear mark.
    await q(s1, "update public.lost_taps set hl_x = null, hl_y = null, hl_w = null, hl_h = null where id = $1", [tap(1)]);
    expect(await marks()).toEqual([]);
    // Marked again, then the tap is undone.
    await q(s1, "update public.lost_taps set hl_x = 0.1, hl_y = 0.1, hl_w = 0.2, hl_h = 0.2 where id = $1", [tap(1)]);
    expect(await marks()).toHaveLength(1);
    await q(s1, "update public.lost_taps set undone = true where id = $1", [tap(1)]);
    expect(await marks()).toEqual([]);
  });

  it("a tap sent with its highlight (made offline) gets its mark; a save's mark stays hidden from the teacher", async () => {
    await setup();
    await sendTap(s1, tap(1), { rect: [0.1, 0.1, 0.2, 0.2] });
    await sendTap(s1, tap(2), { kind: "save", slide: 3, rect: [0.1, 0.1, 0.2, 0.2] });
    expect((await marks()).map((r) => [r.id, r.kind])).toEqual([
      [tap(1), "lost"],
      [tap(2), "save"],
    ]);
    expect((await q<{ id: string }>(marko, "select id from public.slide_marks")).rows).toEqual([{ id: tap(1) }]);
  });

  it("is saved even when the student already has 30 marks on that slide (the tap is the one counted)", async () => {
    await setup();
    await db.query(
      "insert into public.slide_marks (lecture_id, anon_id, slide_number, x, y, w, h) select $1, $2, 2, 0.1, 0.1, 0.1, 0.1 from generate_series(1, 30)",
      [LIVE, s1.sub],
    );
    await sendTap(s1, tap(1), { rect: [0.1, 0.1, 0.2, 0.2] });
    await q(s1, "update public.lost_taps set hl_x = 0.3 where id = $1", [tap(1)]);
    expect((await marks()).filter((r) => r.id === tap(1))).toHaveLength(1);
  });

  it("never touches another student's mark that has the same id", async () => {
    await setup();
    await sendTap(s1, tap(1));
    await q(s2, "insert into public.slide_marks (id, lecture_id, slide_number, x, y, w, h) values ($1, $2, 5, 0.1, 0.1, 0.1, 0.1)", [tap(1), LIVE]);
    await q(s1, "update public.lost_taps set hl_x = 0.5, hl_y = 0.5, hl_w = 0.2, hl_h = 0.2 where id = $1", [tap(1)]);
    await q(s1, "update public.lost_taps set undone = true where id = $1", [tap(1)]);
    expect((await marks()).map((r) => [r.id, r.anon_id, r.slide_number])).toEqual([[tap(1), s2.sub, 5]]);
  });

  it("deleting the copied mark clears the tap's highlight, so running 0020 again does not bring it back", async () => {
    await setup(before0020);
    await sendTap(s1, tap(1), { rect: [0.1, 0.1, 0.2, 0.2] });
    await sendTap(s1, tap(2), { rect: [0.1, 0.1, 0.2, 0.2] });
    await db.exec(sql0020);
    expect((await q(s1, "delete from public.slide_marks where id = $1", [tap(1)])).affected).toBe(1);
    expect(await hl(tap(1))).toBeNull();
    expect(await hl(tap(2))).toBeCloseTo(0.1);
    await db.exec(sql0020);
    expect((await marks()).map((r) => r.id)).toEqual([tap(2)]);
    // The tap itself, its kind and its note are untouched.
    const row = (await db.query<{ undone: boolean; kind: string }>("select undone, kind from public.lost_taps where id = $1", [tap(1)])).rows[0];
    expect(row).toEqual({ undone: false, kind: "lost" });
  });

  it("deleting a lecture still works, taking its taps, marks and notebook with it", async () => {
    await setup();
    await sendTap(s1, tap(1), { lecture: ENDED, rect: [0.1, 0.1, 0.2, 0.2] });
    await q(s1, "insert into public.slide_marks (lecture_id, slide_number, x, y, w, h, kind) values ($1, 2, 0.1, 0.1, 0.1, 0.1, 'lost')", [ENDED]);
    await q(s1, "select public.save_notebook_note($1, 2, 'notes')", [ENDED]);
    await sendTap(s1, tap(2), { rect: [0.1, 0.1, 0.2, 0.2] });
    await db.exec(`update public.lectures set status = 'ended', code = null, ended_at = now() where id = '${ENDED}'`);
    await as(db, marko, () => db.query("select * from public.delete_lecture($1)", [ENDED]));
    expect((await marks()).map((r) => r.id)).toEqual([tap(2)]);
    expect((await db.query("select * from public.notebook_notes")).rows).toEqual([]);
    expect(await hl(tap(2))).toBeCloseTo(0.1);
  });
});

describe("Realtime", () => {
  it("adds slide_marks to supabase_realtime when the publication is there, once, with the whole old row for deletes", async () => {
    await setup();
    // Here (no Realtime) the file skipped it.
    expect((await db.query("select * from pg_publication_tables where tablename = 'slide_marks'")).rows).toEqual([]);
    await db.exec("create publication supabase_realtime");
    await db.exec(sql0020);
    await db.exec(sql0020);
    const tables = (await db.query<{ tablename: string }>("select tablename from pg_publication_tables where pubname = 'supabase_realtime'")).rows;
    expect(tables).toEqual([{ tablename: "slide_marks" }]);
    const identity = (await db.query<{ r: string }>("select relreplident as r from pg_class where oid = 'public.slide_marks'::regclass")).rows[0].r;
    expect(identity).toBe("f");
  });

  it("the notebook is not in Realtime", async () => {
    await setup();
    await db.exec("create publication supabase_realtime");
    await db.exec(sql0020);
    expect((await db.query("select * from pg_publication_tables where tablename = 'notebook_notes'")).rows).toEqual([]);
  });
});
