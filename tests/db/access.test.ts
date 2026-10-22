// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newDb, as, type Claims } from "./harness";

// 0016 + 0017: "Students can see slides until" (end of semester, 30 days after class, always),
// enforced on the slides rows and on the slide images in storage.

const MARKO = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const COURSE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_COURSE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
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
    insert into public.courses (id, teacher_id, name) values ('${COURSE}', '${MARKO}', 'IMS 452'), ('${OTHER_COURSE}', '${OTHER}', 'BIO 121');
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

/** What a user can read: slide rows, slide images, and the function itself. */
async function sees(claims: Claims) {
  return as(db, claims, async () => ({
    slides: (await db.query("select number from public.slides where lecture_id = $1", [LECTURE])).rows.length,
    images: (await db.query("select name from storage.objects where bucket_id = 'slides'")).rows.length,
  }));
}

const fn = (claims: Claims) =>
  as(db, claims, async () =>
    (await db.query<{ ok: boolean }>("select public.student_can_see_lecture($1) as ok", [LECTURE])).rows[0].ok,
  );

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

async function setAccess(access: string, semesterEnd: string | null = null) {
  await db.query("update public.courses set student_access = $2, semester_end = $3::date where id = $1", [
    COURSE,
    access,
    semesterEnd,
  ]);
}

const ALL = { slides: 2, images: 2 };
const NONE = { slides: 0, images: 0 };

describe("the setting itself", () => {
  it("every course starts on 'semester' with no date of its own", async () => {
    const r = await db.query("select student_access, semester_end from public.courses where id = $1", [COURSE]);
    expect(r.rows[0]).toEqual({ student_access: "semester", semester_end: null });
  });

  it("only the three choices and a sane date are accepted", async () => {
    await expect(setAccess("forever")).rejects.toThrow();
    await expect(setAccess("semester", "1999-01-01")).rejects.toThrow();
  });

  it("the teacher changes it on their own course; nobody else can", async () => {
    const set = (claims: Claims) =>
      as(db, claims, async () =>
        (
          await db.query(
            "update public.courses set student_access = '30d', semester_end = '2026-12-18' where id = $1 returning id",
            [COURSE],
          )
        ).rows.length,
      );
    expect(await set(other)).toBe(0);
    expect(await set(s1)).toBe(0);
    expect(await set(marko)).toBe(1);
    const r = await db.query("select student_access, semester_end::text as semester_end from public.courses where id = $1", [COURSE]);
    expect(r.rows[0]).toEqual({ student_access: "30d", semester_end: "2026-12-18" });
  });

  it("students and visitors can not call the function directly as anon", async () => {
    await expect(as(db, null, () => db.query("select public.student_can_see_lecture($1)", [LECTURE]))).rejects.toThrow();
  });
});

describe("a live lecture", () => {
  it("every joined student sees every slide and image, whatever the setting", async () => {
    for (const [access, end] of [
      ["semester", null],
      ["semester", "2020-05-15"],
      ["30d", null],
      ["always", null],
    ] as const) {
      await setAccess(access, end);
      expect(await sees(s1), `${access} ${end}`).toEqual(ALL);
      expect(await fn(s1)).toBe(true);
    }
  });

  it("a stranger sees nothing", async () => {
    expect(await sees(stranger)).toEqual(NONE);
    expect(await fn(stranger)).toBe(false);
  });
});

describe("end of semester", () => {
  it("inside the window (the teacher's date is still ahead) the student sees the slides", async () => {
    await endedDaysAgo(10);
    await db.query("update public.courses set semester_end = current_date + 5 where id = $1", [COURSE]);
    expect(await sees(s1)).toEqual(ALL);
  });

  it("the last day still counts; two days after it the slides and images are gone", async () => {
    await endedDaysAgo(10);
    await db.query("update public.courses set semester_end = current_date where id = $1", [COURSE]);
    expect(await sees(s1)).toEqual(ALL);
    await db.query("update public.courses set semester_end = current_date - 2 where id = $1", [COURSE]);
    expect(await sees(s1)).toEqual(NONE);
    expect(await fn(s1)).toBe(false);
  });

  it("with no date, a lecture from an earlier semester (May 15 or Dec 18 passed) is gone", async () => {
    // About 400 days ago: its semester's end (May 15 or Dec 18 after that day) has passed.
    await endedDaysAgo(400);
    expect(await sees(s1)).toEqual(NONE);
  });

  it("with no date, today's lecture stays until this semester's end", async () => {
    await endedDaysAgo(0);
    expect(await sees(s1)).toEqual(ALL);
  });

  it("a date before the lecture itself is ignored for that lecture (the usual end applies)", async () => {
    await endedDaysAgo(0);
    await setAccess("semester", "2020-05-15");
    expect(await sees(s1)).toEqual(ALL);
  });
});

describe("30 days after each class", () => {
  it("29 days after the class the slides are there; 31 days after they are gone", async () => {
    await setAccess("30d");
    await endedDaysAgo(29);
    expect(await sees(s1)).toEqual(ALL);
    await endedDaysAgo(31);
    expect(await sees(s1)).toEqual(NONE);
  });
});

describe("always", () => {
  it("never ends, even for a lecture years old", async () => {
    await setAccess("always");
    await endedDaysAgo(2000);
    expect(await sees(s1)).toEqual(ALL);
    expect(await fn(s1)).toBe(true);
  });
});

describe("what stays after the window closes", () => {
  beforeEach(async () => {
    await as(db, s1, () =>
      db.query(
        `insert into public.lost_taps (id, lecture_id, anon_id, kind, tapped_on_slide, slide_number, note, tapped_at)
         values ('99999999-9999-9999-9999-000000000001', $1, $2, 'lost', 2, 2, 'what is this', now())`,
        [LECTURE, s1.sub],
      ),
    );
    await setAccess("30d");
    await endedDaysAgo(40);
  });

  it("the student still reads the lecture, their own spot and its note", async () => {
    expect(await sees(s1)).toEqual(NONE);
    const read = await as(db, s1, async () => ({
      lectures: (await db.query("select name from public.lectures")).rows,
      taps: (await db.query("select slide_number, note from public.lost_taps")).rows,
    }));
    expect(read).toEqual({ lectures: [{ name: "Lecture 1" }], taps: [{ slide_number: 2, note: "what is this" }] });
  });

  it("the teacher still reads every slide row and image of their own lecture", async () => {
    expect(await sees(marko)).toEqual(ALL);
  });

  it("another teacher reads none of them", async () => {
    expect(await sees(other)).toEqual(NONE);
  });

  it("the teacher's CSV is unchanged", async () => {
    const csv = await as(db, marko, async () => (await db.query("select * from public.course_export($1)", [COURSE])).rows);
    expect(csv).toHaveLength(2);
  });
});
