// @vitest-environment node
// 0014: column grants. Every write the app makes still works; everything else is refused.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newDb, as, type Claims } from "./harness";

const MARKO = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const NEWBIE = "33333333-3333-3333-3333-333333333333";
const MARKO_COURSE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_COURSE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const LIVE = "cccccccc-cccc-cccc-cccc-000000000001";
const NEW_LECTURE = "dddddddd-dddd-dddd-dddd-000000000001";
const CODE = "482916";
const TAP = "99999999-9999-9999-9999-000000000001";

const google = { provider: "google" };
const marko = { sub: MARKO, email: "dericm@miamioh.edu", app_metadata: google };
const other = { sub: OTHER, email: "other@miamioh.edu", app_metadata: google };
const newbie = { sub: NEWBIE, email: "newbie@miamioh.edu", app_metadata: google };
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
      ('${OTHER}', 'other@miamioh.edu'),
      ('${NEWBIE}', 'newbie@miamioh.edu');
    insert into public.teachers (id, email, display_name) values
      ('${MARKO}', 'dericm@miamioh.edu', 'Marko'),
      ('${OTHER}', 'other@miamioh.edu', 'Other');
    insert into public.courses (id, teacher_id, name) values
      ('${MARKO_COURSE}', '${MARKO}', 'IMS 452'),
      ('${OTHER_COURSE}', '${OTHER}', 'BIO 121');
    insert into public.lectures (id, course_id, name, code, status, current_slide, slide_count) values
      ('${LIVE}', '${MARKO_COURSE}', 'Lecture 1, Oct 26', '${CODE}', 'live', 1, 3);
    insert into public.slides (lecture_id, number, image_path, first_line) values
      ('${LIVE}', 1, '${LIVE}/1.webp', 'Welcome'),
      ('${LIVE}', 2, '${LIVE}/2.webp', ''),
      ('${LIVE}', 3, '${LIVE}/3.webp', '');
  `);
});

const q = <T extends object = Record<string, unknown>>(claims: Claims | null, sql: string, params: unknown[] = []) =>
  as(db, claims, async () => {
    const res = await db.query<T>(sql, params);
    return { rows: res.rows, affected: res.affectedRows ?? 0 };
  });
const one = async <T extends object>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const denied = /permission denied/i;

describe("every write the app makes still works", () => {
  it("sign in: a new teacher's row is added, a returning teacher's row is left alone", async () => {
    const insert = "insert into public.teachers (id, email) values ($1, $2) on conflict (id) do nothing";
    await q(newbie, insert, [NEWBIE, "newbie@miamioh.edu"]);
    await q(marko, insert, [MARKO, "dericm@miamioh.edu"]);
    const read = "select display_name from public.teachers where id = $1";
    expect((await q(newbie, read, [NEWBIE])).rows).toEqual([{ display_name: null }]);
    expect((await q(marko, read, [MARKO])).rows).toEqual([{ display_name: "Marko" }]);
  });

  it("setup: save_setup saves the name and the courses", async () => {
    await q(newbie, "insert into public.teachers (id, email) values ($1, $2) on conflict (id) do nothing", [NEWBIE, "newbie@miamioh.edu"]);
    const r = await q<{ ok: boolean }>(newbie, "select public.save_setup('Lin', array['ACC 221', 'ACC 222']) as ok");
    expect(r.rows[0].ok).toBe(true);
    expect((await db.query("select name from public.courses where teacher_id = $1", [NEWBIE])).rows).toHaveLength(2);
  });

  it("Settings: the teacher renames themselves, adds, renames, archives and unarchives a course", async () => {
    expect((await q(marko, "update public.teachers set display_name = 'Marko D' where id = $1 returning id", [MARKO])).rows).toHaveLength(1);
    await q(marko, "insert into public.courses (teacher_id, name) values ($1, 'IMS 228')", [MARKO]);
    expect((await q(marko, "update public.courses set name = 'IMS 452 Senior' where id = $1 returning id", [MARKO_COURSE])).rows).toHaveLength(1);
    expect((await q(marko, "update public.courses set archived = true where id = $1 returning id", [MARKO_COURSE])).rows).toHaveLength(1);
    expect((await q(marko, "update public.courses set archived = false where id = $1 returning id", [MARKO_COURSE])).rows).toHaveLength(1);
    expect(await one("select name, archived from public.courses where id = $1", [MARKO_COURSE])).toEqual({
      name: "IMS 452 Senior",
      archived: false,
    });
  });

  it("start lecture, move slides, rename, end and delete", async () => {
    await db.query("insert into storage.objects (bucket_id, name, owner) values ('slides', $1, $2)", [`${NEW_LECTURE}/1.webp`, MARKO]);
    const started = await q<{ code: string }>(marko, "select * from public.start_lecture($1, $2, 'Lecture 2', $3::jsonb)", [
      NEW_LECTURE,
      MARKO_COURSE,
      JSON.stringify([{ number: 1, image_path: `${NEW_LECTURE}/1.webp`, first_line: "" }]),
    ]);
    expect(started.rows[0].code).toMatch(/^[1-9][0-9]{5}$/);
    // The projector: update current_slide where status is live and the slide is the one on
    // screen, read it back. slide_version (0015) is not in the grant; its trigger still counts it up.
    expect(
      (
        await q(
          marko,
          "update public.lectures set current_slide = 2 where id = $1 and status = 'live' and current_slide = 1 returning current_slide, slide_version::text as slide_version",
          [LIVE],
        )
      ).rows,
    ).toEqual([{ current_slide: 2, slide_version: "1" }]);
    expect((await q(marko, "update public.lectures set name = 'Renamed' where id = $1 returning id", [LIVE])).rows).toHaveLength(1);
    await q(marko, "select public.end_lecture($1)", [LIVE]);
    expect(await one("select status, code from public.lectures where id = $1", [LIVE])).toEqual({ status: "ended", code: null });
    const del = await q<{ course_id: string }>(marko, "select * from public.delete_lecture($1)", [LIVE]);
    expect(del.rows[0].course_id).toBe(MARKO_COURSE);
  });

  it("students: join, tap (and a resend), Undo, move, note, highlight, save", async () => {
    expect((await q(student, "select public.join_lecture($1) as id", [CODE])).rows).toEqual([{ id: LIVE }]);
    const insert = `insert into public.lost_taps (id, lecture_id, anon_id, kind, tapped_on_slide, slide_number, tapped_at)
      values ($1, $2, auth.uid(), $3, 2, 2, now()) on conflict (id) do nothing`;
    await q(student, insert, [TAP, LIVE, "lost"]);
    await q(student, insert, [TAP, LIVE, "lost"]);
    await q(student, insert, ["99999999-9999-9999-9999-000000000002", LIVE, "save"]);
    const upd = (set: string) => q(student, `update public.lost_taps set ${set} where id = $1 returning id`, [TAP]);
    expect((await upd("note = 'too fast'")).rows).toHaveLength(1);
    expect((await upd("hl_x = 0.1, hl_y = 0.1, hl_w = 0.5, hl_h = 0.2")).rows).toHaveLength(1);
    expect((await upd("slide_number = 1")).rows).toHaveLength(1);
    expect((await upd("undone = true")).rows).toHaveLength(1);
    expect((await upd("undone = false")).rows).toHaveLength(1);
    expect(await one("select note, slide_number, undone, hl_w from public.lost_taps where id = $1", [TAP])).toEqual({
      note: "too fast",
      slide_number: 1,
      undone: false,
      hl_w: 0.5,
    });
  });

  it("reads are untouched: stats, export, header", async () => {
    await q(student, "select public.join_lecture($1)", [CODE]);
    expect((await q(marko, "select * from public.lecture_slide_stats($1)", [LIVE])).rows).toHaveLength(3);
    expect((await q(student, "select * from public.lecture_header($1)", [LIVE])).rows).toHaveLength(1);
    expect((await q(marko, "select * from public.course_export($1)", [MARKO_COURSE])).rows).toEqual([]);
    expect((await q(student, "select number from public.slides")).rows).toHaveLength(3);
  });

  it("the demo semester seed still fills an empty course", async () => {
    await q(other, "select public.seed_demo_semester($1, 2)", [OTHER_COURSE]);
    expect((await db.query("select 1 from public.lectures where course_id = $1", [OTHER_COURSE])).rows).toHaveLength(2);
  });
});

describe("0014 and 0015 in either order", () => {
  it("gives the same grants when 0015 (slide_version, save_setup) ran before 0014", async () => {
    await db.close();
    db = await newDb((files) => {
      const i14 = files.findIndex((f) => f.startsWith("0014_"));
      const i15 = files.findIndex((f) => f.startsWith("0015_"));
      const swapped = [...files];
      [swapped[i14], swapped[i15]] = [files[i15], files[i14]];
      return swapped;
    });
    await db.exec(`
      insert into auth.users (id, email) values ('${MARKO}', 'dericm@miamioh.edu'), ('${NEWBIE}', 'newbie@miamioh.edu');
      insert into public.teachers (id, email, display_name) values ('${MARKO}', 'dericm@miamioh.edu', 'Marko');
      insert into public.courses (id, teacher_id, name) values ('${MARKO_COURSE}', '${MARKO}', 'IMS 452');
      insert into public.lectures (id, course_id, name, code, status, current_slide, slide_count) values
        ('${LIVE}', '${MARKO_COURSE}', 'Lecture 1, Oct 26', '${CODE}', 'live', 1, 3);
    `);
    expect(
      (await q(marko, "update public.lectures set current_slide = 3 where id = $1 returning slide_version::text as slide_version", [LIVE])).rows,
    ).toEqual([{ slide_version: "1" }]);
    await expect(q(marko, "update public.lectures set slide_version = 99 where id = $1", [LIVE])).rejects.toThrow(denied);
    await expect(q(marko, "update public.lectures set status = 'ended' where id = $1", [LIVE])).rejects.toThrow(denied);
    await q(newbie, "insert into public.teachers (id, email) values ($1, $2) on conflict (id) do nothing", [NEWBIE, "newbie@miamioh.edu"]);
    expect((await q<{ ok: boolean }>(newbie, "select public.save_setup('Lin', array['ACC 221']) as ok")).rows).toEqual([{ ok: true }]);
  });
});

describe("everything else is refused", () => {
  it("teachers: only the name, never the email, id or created_at; no delete", async () => {
    for (const set of ["email = 'evil@miamioh.edu'", "created_at = now()", `id = '${NEWBIE}'`]) {
      await expect(q(marko, `update public.teachers set ${set} where id = $1`, [MARKO]), set).rejects.toThrow(denied);
    }
    await expect(q(marko, "delete from public.teachers where id = $1", [MARKO])).rejects.toThrow(denied);
    expect(await one("select email from public.teachers where id = $1", [MARKO])).toEqual({ email: "dericm@miamioh.edu" });
  });

  it("courses: only name, archived, the slide access setting and the details", async () => {
    for (const set of [`teacher_id = '${OTHER}'`, "created_at = now()", `id = '${NEWBIE}'`]) {
      await expect(q(marko, `update public.courses set ${set} where id = $1`, [MARKO_COURSE]), set).rejects.toThrow(denied);
    }
  });

  it("lectures: only name and current_slide; no direct insert or delete", async () => {
    for (const set of [
      "status = 'ended'",
      "code = '111111'",
      "slide_count = 99",
      "ended_at = now()",
      "started_at = now()",
      "lecture_date = '2020-01-01'",
      `course_id = '${OTHER_COURSE}'`,
      `id = '${NEW_LECTURE}'`,
      "slide_version = 1000",
    ]) {
      await expect(q(marko, `update public.lectures set ${set} where id = $1`, [LIVE]), set).rejects.toThrow(denied);
    }
    await expect(
      q(marko, "insert into public.lectures (id, course_id, name, code, status, slide_count) values ($1, $2, 'x', '222222', 'live', 1)", [
        NEW_LECTURE,
        MARKO_COURSE,
      ]),
    ).rejects.toThrow(denied);
    await expect(q(marko, "delete from public.lectures where id = $1", [LIVE])).rejects.toThrow(denied);
    expect(await one("select status, code, slide_count from public.lectures where id = $1", [LIVE])).toEqual({
      status: "live",
      code: CODE,
      slide_count: 3,
    });
  });

  it("slides: the owner can no longer rewrite image_path (or anything else), insert or delete", async () => {
    await expect(
      q(marko, "update public.slides set image_path = 'ffffffff-ffff-ffff-ffff-ffffffffffff/1.webp' where lecture_id = $1", [LIVE]),
    ).rejects.toThrow(denied);
    await expect(q(marko, "update public.slides set first_line = 'x' where lecture_id = $1", [LIVE])).rejects.toThrow(denied);
    await expect(
      q(marko, "insert into public.slides (lecture_id, number, image_path) values ($1, 4, 'x/4.webp')", [LIVE]),
    ).rejects.toThrow(denied);
    await expect(q(marko, "delete from public.slides where lecture_id = $1", [LIVE])).rejects.toThrow(denied);
    expect(await one("select image_path from public.slides where lecture_id = $1 and number = 1", [LIVE])).toEqual({
      image_path: `${LIVE}/1.webp`,
    });
  });

  it("participants and taps: no direct join, no deleting a tap", async () => {
    await expect(
      q(student, "insert into public.participants (lecture_id, anon_id) values ($1, auth.uid())", [LIVE]),
    ).rejects.toThrow(denied);
    await q(student, "select public.join_lecture($1)", [CODE]);
    await q(
      student,
      "insert into public.lost_taps (id, lecture_id, anon_id, tapped_on_slide, slide_number, tapped_at) values ($1, $2, auth.uid(), 1, 1, now())",
      [TAP, LIVE],
    );
    await expect(q(student, "delete from public.lost_taps where id = $1", [TAP])).rejects.toThrow(denied);
    await expect(q(student, "delete from public.participants where lecture_id = $1", [LIVE])).rejects.toThrow(denied);
  });

  it("no truncate on any app table, for teachers, students or anon", async () => {
    for (const t of ["teachers", "courses", "lectures", "slides", "participants", "lost_taps"]) {
      await expect(q(marko, `truncate public.${t} cascade`), t).rejects.toThrow(denied);
      await expect(q(null, `truncate public.${t} cascade`), t).rejects.toThrow(denied);
    }
  });

  it("anon has no update anywhere", async () => {
    await expect(q(null, "update public.teachers set display_name = 'x'")).rejects.toThrow(denied);
    await expect(q(null, "update public.courses set name = 'x'")).rejects.toThrow(denied);
    await expect(q(null, "update public.lectures set name = 'x'")).rejects.toThrow(denied);
  });
});
