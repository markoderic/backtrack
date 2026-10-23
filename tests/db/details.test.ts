// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newDb, as, type Claims } from "./harness";

// 0018: a course's color, section and meeting days and time (the courses dashboard).

const MARKO = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const COURSE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LECTURE = "cccccccc-cccc-cccc-cccc-000000000001";
const CODE = "482916";

const marko: Claims = { sub: MARKO, email: "dericm@miamioh.edu", app_metadata: { provider: "google" } };
const other: Claims = { sub: OTHER, email: "other@miamioh.edu", app_metadata: { provider: "google" } };
const student: Claims = {
  sub: "44444444-4444-4444-4444-000000000001",
  is_anonymous: true,
  app_metadata: { provider: "anonymous" },
};

const DETAILS = "color, section, meet_days, start_minute, end_minute";
const SET =
  "update public.courses set color = 'teal', section = 'Section B', meet_days = '{1,3,5}', start_minute = 605, end_minute = 660 where id = $1 returning id";

let db: PGlite;

afterEach(async () => {
  await db.close();
});

beforeEach(async () => {
  db = await newDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${MARKO}', 'dericm@miamioh.edu'), ('${OTHER}', 'other@miamioh.edu');
    insert into public.teachers (id, email) values ('${MARKO}', 'dericm@miamioh.edu'), ('${OTHER}', 'other@miamioh.edu');
    insert into public.courses (id, teacher_id, name) values ('${COURSE}', '${MARKO}', 'IMS 452');
    insert into public.lectures (id, course_id, name, code, status, current_slide, slide_count, lecture_date) values
      ('${LECTURE}', '${COURSE}', 'Lecture 1', '${CODE}', 'live', 1, 1, current_date);
  `);
  await as(db, student, () => db.query("select public.join_lecture($1)", [CODE]));
});

const details = async () => (await db.query(`select ${DETAILS} from public.courses where id = $1`, [COURSE])).rows[0];

/** Runs one update as the superuser (no grants or policies), so only the checks can refuse it. */
const set = (assignments: string) => db.query(`update public.courses set ${assignments} where id = $1`, [COURSE]);

describe("course details", () => {
  it("every course starts with no color, section or schedule", async () => {
    expect(await details()).toEqual({
      color: null,
      section: null,
      meet_days: null,
      start_minute: null,
      end_minute: null,
    });
  });

  it("the teacher sets all five on their own course, and clears them again", async () => {
    const rows = await as(db, marko, async () => (await db.query(SET, [COURSE])).rows);
    expect(rows).toHaveLength(1);
    expect(await details()).toEqual({
      color: "teal",
      section: "Section B",
      meet_days: [1, 3, 5],
      start_minute: 605,
      end_minute: 660,
    });
    const cleared = await as(
      db,
      marko,
      async () =>
        (
          await db.query(
            "update public.courses set color = null, section = null, meet_days = null, start_minute = null, end_minute = null where id = $1 returning id",
            [COURSE],
          )
        ).rows,
    );
    expect(cleared).toHaveLength(1);
    expect(await details()).toEqual({
      color: null,
      section: null,
      meet_days: null,
      start_minute: null,
      end_minute: null,
    });
  });

  it("another teacher, a joined student and a visitor change nothing", async () => {
    expect(await as(db, other, async () => (await db.query(SET, [COURSE])).rows)).toHaveLength(0);
    expect(await as(db, student, async () => (await db.query(SET, [COURSE])).rows)).toHaveLength(0);
    await expect(as(db, null, () => db.query(SET, [COURSE]))).rejects.toThrow(/permission denied/);
    expect(await details()).toEqual({
      color: null,
      section: null,
      meet_days: null,
      start_minute: null,
      end_minute: null,
    });
  });

  it("the teacher still can not change the course's owner, id or created_at", async () => {
    for (const assignment of [`teacher_id = '${OTHER}'`, "created_at = now()"]) {
      await expect(
        as(db, marko, () => db.query(`update public.courses set ${assignment} where id = $1`, [COURSE])),
        assignment,
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("the other teacher does not even see the details", async () => {
    const rows = await as(db, other, async () => (await db.query(`select ${DETAILS} from public.courses`)).rows);
    expect(rows).toEqual([]);
  });
});

describe("what the database refuses", () => {
  it("color: the eight names (0019 adds red, orange, pink and #rrggbb: tests/db/options.test.ts)", async () => {
    for (const ok of ["slate", "blue", "indigo", "plum", "teal", "green", "olive", "ochre"]) {
      await set(`color = '${ok}'`);
    }
    for (const bad of ["lost", "", "#C8371F", "Teal"]) {
      await expect(set(`color = '${bad}'`), bad).rejects.toThrow(/courses_color_check/);
    }
  });

  it("section: 1 to 40 characters, not only spaces", async () => {
    await set(`section = '${"x".repeat(40)}'`);
    await expect(set(`section = '${"x".repeat(41)}'`)).rejects.toThrow(/courses_section_check/);
    await expect(set("section = ''")).rejects.toThrow(/courses_section_check/);
    await expect(set("section = '   '")).rejects.toThrow(/courses_section_check/);
  });

  it("meet_days: 1 to 7 days, each 1 (Monday) to 7 (Sunday)", async () => {
    await set("meet_days = '{1,2,3,4,5,6,7}'");
    await set("meet_days = '{2,4}'");
    for (const bad of ["{}", "{0}", "{8}", "{1,NULL}", "{-1,3}"]) {
      await expect(set(`meet_days = '${bad}'`), bad).rejects.toThrow(/courses_meet_days_check/);
    }
  });

  it("times: both or neither, inside the day, and the end after the start", async () => {
    await set("start_minute = 0, end_minute = 1440");
    await set("start_minute = 605, end_minute = 660");
    await set("start_minute = null, end_minute = null");
    await expect(set("start_minute = 605, end_minute = null")).rejects.toThrow(/courses_end_minute_check/);
    await expect(set("start_minute = null, end_minute = 660")).rejects.toThrow(/courses_end_minute_check/);
    await expect(set("start_minute = 660, end_minute = 660")).rejects.toThrow(/courses_end_minute_check/);
    await expect(set("start_minute = 700, end_minute = 660")).rejects.toThrow(/courses_end_minute_check/);
    // Out of the day (either check may be the one that reports it).
    await expect(set("start_minute = 1440, end_minute = 1441")).rejects.toThrow(/courses_(start|end)_minute_check/);
    await expect(set("start_minute = -5, end_minute = 60")).rejects.toThrow(/courses_start_minute_check/);
  });
});

describe("the file itself", () => {
  it("can run twice (add column if not exists) and changes no row", async () => {
    await as(db, marko, () => db.query(SET, [COURSE]));
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const sql = readFileSync(path.resolve(__dirname, "../../supabase/migrations/0018_course_details.sql"), "utf8");
    await db.exec(sql);
    expect(await details()).toMatchObject({ color: "teal" });
  });
});
