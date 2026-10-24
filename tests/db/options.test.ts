// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newDb, as, type Claims } from "./harness";

// 0019: red, orange, pink and any #rrggbb color; "Students can see slides until" a week after
// each class, a number of days after each class (access_days) or a date (access_until).

const MARKO = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const COURSE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LECTURE = "cccccccc-cccc-cccc-cccc-000000000001";
const CODE = "482916";

const marko: Claims = { sub: MARKO, email: "dericm@miamioh.edu", app_metadata: { provider: "google" } };
const other: Claims = { sub: OTHER, email: "other@miamioh.edu", app_metadata: { provider: "google" } };
const student = (n: number): Claims => ({
  sub: `44444444-4444-4444-4444-${String(n).padStart(12, "0")}`,
  is_anonymous: true,
  app_metadata: { provider: "anonymous" },
});
const s1 = student(1);
const stranger = student(2); // never joins

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
      ('${LECTURE}', '${COURSE}', 'Lecture 1', '${CODE}', 'live', 1, 2, current_date);
    insert into public.slides (lecture_id, number, image_path, first_line) values
      ('${LECTURE}', 1, '${LECTURE}/1.webp', 'Welcome'),
      ('${LECTURE}', 2, '${LECTURE}/2.webp', 'Agenda');
    insert into storage.objects (bucket_id, name, owner) values
      ('slides', '${LECTURE}/1.webp', '${MARKO}'),
      ('slides', '${LECTURE}/2.webp', '${MARKO}');
  `);
  await as(db, s1, () => db.query("select public.join_lecture($1)", [CODE]));
});

const OPTIONS = "color, student_access, semester_end::text as semester_end, access_days, access_until::text as access_until";
const row = async () =>
  (await db.query<Record<string, unknown>>(`select ${OPTIONS} from public.courses where id = $1`, [COURSE])).rows[0];

/** One update as the superuser (no grants or policies), so only the checks can refuse it. */
const set = (assignments: string) => db.query(`update public.courses set ${assignments} where id = $1`, [COURSE]);

/** What a user can read: slide rows and slide images. */
async function sees(claims: Claims) {
  return as(db, claims, async () => ({
    slides: (await db.query("select number from public.slides where lecture_id = $1", [LECTURE])).rows.length,
    images: (await db.query("select name from storage.objects where bucket_id = 'slides'")).rows.length,
  }));
}

/** Ends the lecture as if it had been on `daysAgo` days ago (the date, the start and the end). */
async function endedDaysAgo(daysAgo: number) {
  await db.query(
    `update public.lectures
     set status = 'ended', code = null,
         lecture_date = current_date - $2::int,
         started_at = now() - make_interval(days => $2::int, hours => 1),
         ended_at = now() - make_interval(days => $2::int)
     where id = $1`,
    [LECTURE, daysAgo],
  );
}

const ALL = { slides: 2, images: 2 };
const NONE = { slides: 0, images: 0 };

describe("colors", () => {
  it("the eight names from 0018 still work", async () => {
    for (const ok of ["slate", "blue", "indigo", "plum", "teal", "green", "olive", "ochre"]) {
      await set(`color = '${ok}'`);
      expect((await row()).color).toBe(ok);
    }
  });

  it("red, orange, pink and any lowercase #rrggbb work", async () => {
    for (const ok of ["red", "orange", "pink", "#2f6db5", "#000000", "#ffffff", "#c8371f"]) {
      await set(`color = '${ok}'`);
      expect((await row()).color).toBe(ok);
    }
    await set("color = null");
    expect((await row()).color).toBeNull();
  });

  it("anything else is refused", async () => {
    for (const bad of ["Red", "lost", "", "custom", "#2F6DB5", "#fff", "#12345g", "2f6db5", "#2f6db5 ", "rgb(1,2,3)"]) {
      await expect(set(`color = '${bad}'`), bad).rejects.toThrow(/courses_color_check/);
    }
  });
});

describe("the slide access choice", () => {
  it("every course still starts on 'semester' with no custom days or date", async () => {
    expect(await row()).toMatchObject({ student_access: "semester", access_days: null, access_until: null });
  });

  it("the three choices from 0016 still work", async () => {
    for (const ok of ["semester", "30d", "always"]) {
      await set(`student_access = '${ok}'`);
      expect((await row()).student_access).toBe(ok);
    }
  });

  it("a week, custom days with its number, and custom date with its date work", async () => {
    await set("student_access = '7d'");
    expect((await row()).student_access).toBe("7d");
    await set("student_access = 'custom_days', access_days = 1");
    await set("student_access = 'custom_days', access_days = 365");
    expect(await row()).toMatchObject({ student_access: "custom_days", access_days: 365 });
    await set("student_access = 'custom_date', access_until = '2027-03-03', access_days = null");
    expect(await row()).toMatchObject({ student_access: "custom_date", access_until: "2027-03-03", access_days: null });
  });

  it("refuses an unknown choice, a custom choice without its value, and values out of range", async () => {
    for (const bad of ["forever", "custom", "14d", ""]) {
      await expect(set(`student_access = '${bad}'`), bad).rejects.toThrow(/courses_student_access_check/);
    }
    await expect(set("student_access = 'custom_days'")).rejects.toThrow(/courses_access_custom_check/);
    await expect(set("student_access = 'custom_date'")).rejects.toThrow(/courses_access_custom_check/);
    // A date does not stand in for days, nor days for a date.
    await expect(set("student_access = 'custom_days', access_until = '2027-03-03'")).rejects.toThrow(
      /courses_access_custom_check/,
    );
    for (const days of [0, -1, 366]) {
      await expect(set(`access_days = ${days}`), String(days)).rejects.toThrow(/courses_access_days_check/);
    }
    for (const day of ["1999-12-31", "2101-01-01"]) {
      await expect(set(`access_until = '${day}'`), day).rejects.toThrow(/courses_access_until_check/);
    }
    // Clearing the number while the choice still needs it is refused too.
    await set("student_access = 'custom_days', access_days = 10");
    await expect(set("access_days = null")).rejects.toThrow(/courses_access_custom_check/);
  });
});

describe("who can change them", () => {
  const SET =
    "update public.courses set color = '#2f6db5', student_access = 'custom_days', access_days = 14, access_until = null where id = $1 returning id";

  it("the teacher, on their own course", async () => {
    expect(await as(db, marko, async () => (await db.query(SET, [COURSE])).rows)).toHaveLength(1);
    expect(await row()).toMatchObject({ color: "#2f6db5", student_access: "custom_days", access_days: 14 });
    const date = await as(
      db,
      marko,
      async () =>
        (
          await db.query(
            "update public.courses set student_access = 'custom_date', access_days = null, access_until = '2027-03-03' where id = $1 returning id",
            [COURSE],
          )
        ).rows,
    );
    expect(date).toHaveLength(1);
    expect(await row()).toMatchObject({ student_access: "custom_date", access_until: "2027-03-03", access_days: null });
  });

  it("not another teacher, not a joined student, not a visitor", async () => {
    expect(await as(db, other, async () => (await db.query(SET, [COURSE])).rows)).toHaveLength(0);
    expect(await as(db, s1, async () => (await db.query(SET, [COURSE])).rows)).toHaveLength(0);
    await expect(as(db, null, () => db.query(SET, [COURSE]))).rejects.toThrow(/permission denied/);
    for (const column of ["access_days = 3", "access_until = '2027-01-01'"]) {
      expect(
        await as(db, other, async () => (await db.query(`update public.courses set ${column} where id = $1 returning id`, [COURSE])).rows),
        column,
      ).toHaveLength(0);
    }
    expect(await row()).toEqual({
      color: null,
      student_access: "semester",
      semester_end: null,
      access_days: null,
      access_until: null,
    });
  });

  it("the other teacher does not even see the new columns' values", async () => {
    await set("student_access = 'custom_days', access_days = 14");
    const rows = await as(db, other, async () => (await db.query("select access_days, access_until from public.courses")).rows);
    expect(rows).toEqual([]);
  });

  it("anon still can not call the access function", async () => {
    await expect(as(db, null, () => db.query("select public.student_can_see_lecture($1)", [LECTURE]))).rejects.toThrow();
  });
});

describe("what a joined student sees after class, for each choice", () => {
  it("a live lecture: every choice shows every slide; a stranger sees none", async () => {
    for (const assignments of [
      "student_access = '7d'",
      "student_access = 'custom_days', access_days = 1",
      "student_access = 'custom_date', access_until = '2020-01-01', access_days = null",
    ]) {
      await set(assignments);
      expect(await sees(s1), assignments).toEqual(ALL);
      expect(await sees(stranger), assignments).toEqual(NONE);
    }
  });

  it("30 days: 29 days after class yes, 31 no", async () => {
    await set("student_access = '30d'");
    await endedDaysAgo(29);
    expect(await sees(s1)).toEqual(ALL);
    await endedDaysAgo(31);
    expect(await sees(s1)).toEqual(NONE);
  });

  it("a week: 6 days after class yes, 8 no", async () => {
    await set("student_access = '7d'");
    await endedDaysAgo(6);
    expect(await sees(s1)).toEqual(ALL);
    await endedDaysAgo(8);
    expect(await sees(s1)).toEqual(NONE);
    expect(await sees(stranger)).toEqual(NONE);
  });

  it("custom days: 14 days, 13 after class yes, 15 no; 1 day, the next day no", async () => {
    await set("student_access = 'custom_days', access_days = 14");
    await endedDaysAgo(13);
    expect(await sees(s1)).toEqual(ALL);
    await endedDaysAgo(15);
    expect(await sees(s1)).toEqual(NONE);
    await set("access_days = 1");
    await endedDaysAgo(2);
    expect(await sees(s1)).toEqual(NONE);
    await set("access_days = 365");
    await endedDaysAgo(300);
    expect(await sees(s1)).toEqual(ALL);
  });

  it("custom date: through the whole day, gone two days after it, for old and new lectures alike", async () => {
    await endedDaysAgo(100);
    // Today in Eastern time, as the rule reads it (current_date is the session's zone, which can be a day off).
    await set("student_access = 'custom_date', access_until = public.eastern_date(now())");
    expect(await sees(s1)).toEqual(ALL);
    await set("access_until = public.eastern_date(now()) + 30");
    expect(await sees(s1)).toEqual(ALL);
    await set("access_until = public.eastern_date(now()) - 2");
    expect(await sees(s1)).toEqual(NONE);
    // Unlike End of semester, a date before the lecture is not skipped: it is the end for every lecture.
    await endedDaysAgo(0);
    expect(await sees(s1)).toEqual(NONE);
  });

  it("end of semester and always behave as before", async () => {
    await endedDaysAgo(10);
    await set("student_access = 'semester', semester_end = current_date + 5");
    expect(await sees(s1)).toEqual(ALL);
    await set("semester_end = current_date - 2");
    expect(await sees(s1)).toEqual(NONE);
    await set("student_access = 'always', semester_end = null");
    await endedDaysAgo(2000);
    expect(await sees(s1)).toEqual(ALL);
  });

  it("the teacher always reads their own slides, whatever the choice", async () => {
    await set("student_access = 'custom_date', access_until = '2020-01-01'");
    await endedDaysAgo(10);
    expect(await sees(marko)).toEqual(ALL);
    expect(await sees(other)).toEqual(NONE);
  });
});

describe("the file itself", () => {
  it("runs twice and changes no row", async () => {
    await set("color = '#2f6db5', student_access = 'custom_days', access_days = 14");
    const before = await row();
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const sql = readFileSync(path.resolve(__dirname, "../../supabase/migrations/0019_course_options.sql"), "utf8");
    await db.exec(sql);
    expect(await row()).toEqual(before);
    await expect(set("color = 'Red'")).rejects.toThrow(/courses_color_check/);
  });

  it("keeps every course's color and choice from before (applied over 0018 with data in it)", async () => {
    // A fresh database up to 0018, with a course using every old value, then 0019 on top.
    await db.close();
    db = await newDb((files) => files.filter((f) => !f.startsWith("0019_")));
    await db.exec(`
      insert into auth.users (id, email) values ('${MARKO}', 'dericm@miamioh.edu');
      insert into public.teachers (id, email) values ('${MARKO}', 'dericm@miamioh.edu');
      insert into public.courses (id, teacher_id, name, color, student_access, semester_end) values
        ('${COURSE}', '${MARKO}', 'IMS 452', 'teal', '30d', null),
        ('dddddddd-dddd-dddd-dddd-dddddddddddd', '${MARKO}', 'ACC 221', 'ochre', 'semester', '2026-12-11'),
        ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '${MARKO}', 'BIO 121', null, 'always', null);
    `);
    const all = async () =>
      (await db.query("select name, color, student_access, semester_end::text as semester_end from public.courses order by name")).rows;
    const before = await all();
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    await db.exec(readFileSync(path.resolve(__dirname, "../../supabase/migrations/0019_course_options.sql"), "utf8"));
    expect(await all()).toEqual(before);
    expect((await db.query("select count(*)::int as n from public.courses where access_days is null and access_until is null")).rows[0]).toEqual({ n: 3 });
  });
});
