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
const LECTURE_C = "cccccccc-cccc-cccc-cccc-000000000003";

const marko = { sub: MARKO, email: "dericm@miamioh.edu", app_metadata: { provider: "google" } };
const other = { sub: OTHER, email: "other@miamioh.edu", app_metadata: { provider: "google" } };
const student = (n: number): Claims => ({
  sub: `44444444-4444-4444-4444-${String(n).padStart(12, "0")}`,
  is_anonymous: true,
  app_metadata: { provider: "anonymous" },
});

type Row = {
  lecture_date: string;
  lecture_name: string;
  slide_number: number;
  first_line: string;
  lost_taps: number;
  students: number;
};

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
  `);
});

async function addLecture(id: string, o: { course?: string; name?: string; date: string; startedAt: string; slides?: number }) {
  const count = o.slides ?? 10;
  await db.query(
    `insert into public.lectures (id, course_id, name, status, slide_count, lecture_date, started_at, ended_at)
     values ($1, $2, $3, 'ended', $4, $5, $6::timestamptz, $6::timestamptz + interval '50 minutes')`,
    [id, o.course ?? MARKO_COURSE, o.name ?? "Lecture", count, o.date, o.startedAt],
  );
  await db.query(
    `insert into public.slides (lecture_id, number, image_path, first_line)
     select $1::uuid, g, $1::text || '/' || g || '.webp', 'Slide ' || g from generate_series(1, $2::int) g`,
    [id, count],
  );
}

const addTap = (lecture: string, anon: Claims, slide: number, o: { kind?: string; undone?: boolean } = {}) =>
  db.query(
    `insert into public.lost_taps (id, lecture_id, anon_id, kind, tapped_on_slide, slide_number, undone, tapped_at)
     values ($1, $2, $3, $4, $5, $5, $6, now())`,
    [tapId(), lecture, anon.sub, o.kind ?? "lost", slide, o.undone ?? false],
  );

const exportRows = (claims: Claims | null, course = MARKO_COURSE) =>
  as(db, claims, async () =>
    (
      await db.query<Row>(
        "select lecture_date::text as lecture_date, lecture_name, slide_number, first_line, lost_taps, students from public.course_export($1)",
        [course],
      )
    ).rows,
  );

describe("course_export", () => {
  beforeEach(async () => {
    await addLecture(LECTURE_A, { name: "Lecture 1, Oct 19", date: "2026-10-19", startedAt: "2026-10-19 14:05+00" });
  });

  it("returns one row per slide with zeros filled in", async () => {
    const r = await exportRows(marko);
    expect(r).toHaveLength(10);
    expect(r.map((x) => x.slide_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.every((x) => x.lost_taps === 0 && x.students === 0)).toBe(true);
    expect(r[0]).toEqual({
      lecture_date: "2026-10-19",
      lecture_name: "Lecture 1, Oct 19",
      slide_number: 1,
      first_line: "Slide 1",
      lost_taps: 0,
      students: 0,
    });
  });

  it("counts taps and different students on the slide", async () => {
    await addTap(LECTURE_A, student(1), 4);
    await addTap(LECTURE_A, student(1), 4);
    await addTap(LECTURE_A, student(2), 4);
    await addTap(LECTURE_A, student(2), 7);
    const r = await exportRows(marko);
    expect(r[3]).toMatchObject({ slide_number: 4, lost_taps: 3, students: 2 });
    expect(r[6]).toMatchObject({ slide_number: 7, lost_taps: 1, students: 1 });
    expect(r[4]).toMatchObject({ slide_number: 5, lost_taps: 0, students: 0 });
  });

  it("still exports an archived course, with the same numbers", async () => {
    await addTap(LECTURE_A, student(1), 4);
    const before = await exportRows(marko);
    await as(db, marko, () => db.query("update public.courses set archived = true where id = $1", [MARKO_COURSE]));
    expect(await exportRows(marko)).toEqual(before);
    expect(before[3]).toMatchObject({ slide_number: 4, lost_taps: 1, students: 1 });
  });

  it("changes no number for a save or an undone tap", async () => {
    await addTap(LECTURE_A, student(1), 4, { kind: "save" });
    await addTap(LECTURE_A, student(2), 4, { undone: true });
    await addTap(LECTURE_A, student(3), 4, { kind: "save", undone: true });
    const r = await exportRows(marko);
    expect(r.every((x) => x.lost_taps === 0 && x.students === 0)).toBe(true);
    await addTap(LECTURE_A, student(4), 4);
    expect((await exportRows(marko))[3]).toMatchObject({ lost_taps: 1, students: 1 });
  });

  it("red and yellow marks (0020) and an I'm lost taken back never count; only the lost tap does (batch L)", async () => {
    // s1 is lost on slide 4 and drew two red marks; s2 saved slide 4 with a yellow mark; s3 took I'm
    // lost back on slide 4 (K1: the tap is undone) and keeps a red mark there.
    await addTap(LECTURE_A, student(1), 4);
    await addTap(LECTURE_A, student(3), 4, { undone: true });
    for (const [who, kind] of [
      [student(1), "lost"],
      [student(1), "lost"],
      [student(2), "save"],
      [student(3), "lost"],
    ] as const) {
      await db.query(
        `insert into public.slide_marks (lecture_id, anon_id, slide_number, x, y, w, h, kind) values ($1, $2, 4, 0.1, 0.1, 0.2, 0.2, $3)`,
        [LECTURE_A, who.sub, kind],
      );
    }
    const r = await exportRows(marko);
    expect(r[3]).toMatchObject({ slide_number: 4, lost_taps: 1, students: 1 });
    expect(r.reduce((sum, x) => sum + x.lost_taps, 0)).toBe(1);
    // The one lecture CSV reads lecture_slide_stats: the same numbers.
    const stats = await as(db, marko, async () =>
      (await db.query<{ slide_number: number; taps: number; students: number }>("select slide_number, taps, students from public.lecture_slide_stats($1) where taps > 0", [LECTURE_A])).rows,
    );
    expect(stats).toEqual([{ slide_number: 4, taps: 1, students: 1 }]);
  });

  it("counts a tap on the slide it was moved to", async () => {
    await addTap(LECTURE_A, student(1), 4);
    await db.query("update public.lost_taps set slide_number = 2");
    const r = await exportRows(marko);
    expect(r[3].lost_taps).toBe(0);
    expect(r[1]).toMatchObject({ slide_number: 2, lost_taps: 1, students: 1 });
  });

  it("orders by date, then start time, then slide, and leaves out other courses", async () => {
    // Inserted newest first on purpose; two lectures share a day.
    await addLecture(LECTURE_C, { name: "Afternoon", date: "2026-10-19", startedAt: "2026-10-19 19:00+00", slides: 2 });
    await addLecture(LECTURE_B, { name: "Early", date: "2026-10-12", startedAt: "2026-10-12 14:05+00", slides: 2 });
    await addLecture("cccccccc-cccc-cccc-cccc-000000000009", {
      course: OTHER_COURSE,
      name: "Not mine",
      date: "2026-10-01",
      startedAt: "2026-10-01 14:05+00",
      slides: 2,
    });
    const r = await exportRows(marko);
    expect(r.map((x) => `${x.lecture_date} ${x.lecture_name} ${x.slide_number}`)).toEqual([
      "2026-10-12 Early 1",
      "2026-10-12 Early 2",
      ...Array.from({ length: 10 }, (_, i) => `2026-10-19 Lecture 1, Oct 19 ${i + 1}`),
      "2026-10-19 Afternoon 1",
      "2026-10-19 Afternoon 2",
    ]);
  });

  it("gives a lecture without a slide row an empty first line instead of dropping the slide", async () => {
    await db.query("delete from public.slides where number = 3");
    const r = await exportRows(marko);
    expect(r).toHaveLength(10);
    expect(r[2]).toMatchObject({ slide_number: 3, first_line: "" });
  });

  it("leaves out a live lecture, rows and taps both, and keeps the ended ones", async () => {
    await addLecture(LECTURE_B, { name: "Live now", date: "2026-10-21", startedAt: "2026-10-21 14:05+00", slides: 3 });
    await db.query("update public.lectures set status = 'live', code = '123456', ended_at = null where id = $1", [LECTURE_B]);
    await addTap(LECTURE_B, student(1), 2);
    await addTap(LECTURE_A, student(1), 2);
    const r = await exportRows(marko);
    expect(r).toHaveLength(10);
    expect(r.every((x) => x.lecture_name === "Lecture 1, Oct 19")).toBe(true);
    expect(r[1]).toMatchObject({ slide_number: 2, lost_taps: 1, students: 1 });
  });

  it("returns no rows while the only lecture is live, and includes it once it has ended", async () => {
    await db.query("update public.lectures set status = 'live', code = '123456', ended_at = null where id = $1", [LECTURE_A]);
    expect(await exportRows(marko)).toEqual([]);
    await db.query("update public.lectures set status = 'ended', code = null, ended_at = now() where id = $1", [LECTURE_A]);
    expect(await exportRows(marko)).toHaveLength(10);
  });

  it("raises for another teacher, for a student and for a course that does not exist", async () => {
    await expect(exportRows(other)).rejects.toMatchObject({ code: "42501" });
    await expect(exportRows(student(1))).rejects.toMatchObject({ code: "42501" });
    await expect(exportRows(marko, "dddddddd-dddd-dddd-dddd-dddddddddddd")).rejects.toMatchObject({ code: "42501" });
  });

  it("is not callable when signed out", async () => {
    await expect(exportRows(null)).rejects.toMatchObject({ code: "42501" });
  });

  it("still raises for a non-owner when the course has a live lecture", async () => {
    await addLecture(LECTURE_B, { name: "Live now", date: "2026-10-21", startedAt: "2026-10-21 14:05+00", slides: 3 });
    await db.query("update public.lectures set status = 'live', code = '123456', ended_at = null where id = $1", [LECTURE_B]);
    await expect(exportRows(other)).rejects.toMatchObject({ code: "42501" });
    await expect(exportRows(student(1))).rejects.toMatchObject({ code: "42501" });
  });

  it("keeps the grants: authenticated can run it, anon cannot", async () => {
    const q = async (role: string) =>
      (await db.query<{ ok: boolean }>(`select has_function_privilege('${role}', 'public.course_export(uuid)', 'execute') as ok`)).rows[0].ok;
    expect(await q("authenticated")).toBe(true);
    expect(await q("anon")).toBe(false);
  });
});

describe("seed_demo_semester", () => {
  const seed = (claims: Claims | null, course = MARKO_COURSE, count?: number) =>
    as(db, claims, () =>
      count === undefined
        ? db.query("select public.seed_demo_semester($1)", [course])
        : db.query("select public.seed_demo_semester($1, $2)", [course, count]),
    );

  const lectures = async () =>
    (
      await db.query<{
        id: string;
        name: string;
        lecture_date: string;
        dow: number;
        status: string;
        code: string | null;
        slide_count: number;
        current_slide: number;
        started_at: string;
        ended_at: string | null;
        eastern_start: string;
      }>(
        `select id, name, lecture_date::text as lecture_date, extract(dow from lecture_date)::int as dow, status, code,
                slide_count, current_slide, started_at::text as started_at, ended_at::text as ended_at,
                to_char(started_at at time zone 'America/New_York', 'YYYY-MM-DD HH24:MI') as eastern_start
         from public.lectures where course_id = $1 order by lecture_date, started_at`,
        [MARKO_COURSE],
      )
    ).rows;

  it("makes 8 ended lectures of 10 slides on past Mondays and Wednesdays", async () => {
    await seed(marko);
    const l = await lectures();
    expect(l).toHaveLength(8);
    const today = (await db.query<{ d: string }>("select public.eastern_date(now())::text as d")).rows[0].d;
    for (const x of l) {
      expect([1, 3]).toContain(x.dow);
      expect(x.lecture_date < today).toBe(true);
      expect(x.status).toBe("ended");
      expect(x.code).toBeNull();
      expect(x.ended_at).not.toBeNull();
      expect(x.slide_count).toBe(10);
      expect(x.current_slide).toBeGreaterThanOrEqual(1);
      expect(x.eastern_start).toBe(`${x.lecture_date} 10:05`);
    }
    expect(new Set(l.map((x) => x.lecture_date)).size).toBe(8);
    // Four weeks, two a week, the most recent one within the last week.
    const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
    expect(days(l[0].lecture_date, l[7].lecture_date)).toBeLessThanOrEqual(26);
    expect(days(l[7].lecture_date, today)).toBeLessThanOrEqual(7);
  });

  it("names them Lecture 1, Sep 14 style, oldest first, with no leading zero", async () => {
    await seed(marko);
    const l = await lectures();
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    l.forEach((x, i) => {
      const [, m, d] = x.lecture_date.split("-").map(Number);
      expect(x.name).toBe(`Lecture ${i + 1}, ${MONTHS[m - 1]} ${d}`);
    });
  });

  it("gives every lecture 10 slides with ACC 221 first lines and the shared placeholder image", async () => {
    await seed(marko);
    const slides = (
      await db.query<{ lecture_id: string; number: number; first_line: string; image_path: string }>(
        "select s.lecture_id, s.number, s.first_line, s.image_path from public.slides s order by s.lecture_id, s.number",
      )
    ).rows;
    expect(slides).toHaveLength(80);
    expect(slides.every((s) => s.image_path === "demo/placeholder.webp")).toBe(true);
    expect(slides.every((s) => s.first_line.length > 0 && s.first_line.length <= 200)).toBe(true);
    const first = slides.filter((s) => s.number === 1).map((s) => s.first_line);
    expect(first).toHaveLength(8);
    first.forEach((f) => expect(f.startsWith("Week ")).toBe(true));
    expect(new Set(first).size).toBe(8);
    expect(slides.some((s) => s.first_line === "Where we left off")).toBe(true);
    // Not the same ten lines in every lecture.
    const byLecture = new Map<string, string>();
    for (const s of slides) byLecture.set(s.lecture_id, (byLecture.get(s.lecture_id) ?? "") + "|" + s.first_line);
    expect(new Set(byLecture.values()).size).toBe(8);
  });

  it("adds 20 to 35 fake participants per lecture with random ids", async () => {
    await seed(marko);
    const r = (
      await db.query<{ lecture_id: string; c: number }>(
        "select lecture_id, count(*)::int as c from public.participants group by lecture_id",
      )
    ).rows;
    expect(r).toHaveLength(8);
    for (const x of r) {
      expect(x.c).toBeGreaterThanOrEqual(20);
      expect(x.c).toBeLessThanOrEqual(35);
    }
    const ids = (await db.query<{ anon_id: string }>("select anon_id from public.participants")).rows;
    expect(new Set(ids.map((i) => i.anon_id)).size).toBe(ids.length);
    // None of them is a real user.
    const users = (await db.query<{ c: number }>("select count(*)::int as c from auth.users u join public.participants p on p.anon_id = u.id")).rows[0];
    expect(users.c).toBe(0);
  });

  it("makes taps with notes, undone rows and saves, from people who joined", async () => {
    await seed(marko);
    const q = async (sql: string) => (await db.query<{ c: number }>(sql)).rows[0].c;
    expect(await q("select count(*)::int as c from public.lost_taps where kind = 'lost' and not undone")).toBeGreaterThan(100);
    expect(await q("select count(*)::int as c from public.lost_taps where kind = 'lost' and undone")).toBeGreaterThan(0);
    expect(await q("select count(*)::int as c from public.lost_taps where kind = 'save'")).toBeGreaterThan(0);
    const notes = (await db.query<{ note: string }>("select distinct note from public.lost_taps where note is not null")).rows.map((r) => r.note);
    expect(notes).toEqual(
      expect.arrayContaining([
        "what's the difference between deferral and accrual",
        "too fast",
        "why is wages payable a credit",
      ]),
    );
    // Every tap is by a participant of its lecture, on a real slide, with slide_number = tapped_on_slide.
    expect(
      await q(
        `select count(*)::int as c from public.lost_taps t
         where not exists (select 1 from public.participants p where p.lecture_id = t.lecture_id and p.anon_id = t.anon_id)
            or t.slide_number <> t.tapped_on_slide or t.slide_number not between 1 and 10`,
      ),
    ).toBe(0);
    // Taps fall inside the lecture, so the semester looks real.
    expect(
      await q(
        `select count(*)::int as c from public.lost_taps t join public.lectures l on l.id = t.lecture_id
         where t.tapped_at < l.started_at or t.tapped_at > l.ended_at`,
      ),
    ).toBe(0);
  });

  it("has a few hot slides per lecture, and the export counts only lost taps that are not undone", async () => {
    await seed(marko);
    const r = await exportRows(marko);
    expect(r).toHaveLength(80);
    const rawLost = (
      await db.query<{ c: number }>("select count(*)::int as c from public.lost_taps where kind = 'lost' and not undone")
    ).rows[0].c;
    expect(r.reduce((sum, x) => sum + x.lost_taps, 0)).toBe(rawLost);
    expect(r.every((x) => x.students <= x.lost_taps)).toBe(true);
    // Date order, oldest lecture first.
    expect(r[0].lecture_name.startsWith("Lecture 1,")).toBe(true);
    expect(r[79].lecture_name.startsWith("Lecture 8,")).toBe(true);
    // Per lecture a couple of slides stand out and slide 1 is never a problem.
    for (let k = 0; k < 8; k++) {
      const part = r.slice(k * 10, k * 10 + 10);
      expect(part[0].lost_taps).toBe(0);
      const sorted = [...part].sort((a, b) => b.students - a.students);
      expect(sorted[0].students).toBeGreaterThanOrEqual(5);
      expect(sorted[0].students).toBeGreaterThan(sorted[5].students);
    }
  });

  it("is repeatable: two empty courses get the same counts", async () => {
    const OTHER2 = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
    await db.query("insert into public.courses (id, teacher_id, name) values ($1, $2, 'ACC 221')", [OTHER2, MARKO]);
    await seed(marko, MARKO_COURSE);
    await seed(marko, OTHER2);
    const a = await exportRows(marko, MARKO_COURSE);
    const b = await exportRows(marko, OTHER2);
    expect(b.map((x) => [x.slide_number, x.lost_taps, x.students])).toEqual(a.map((x) => [x.slide_number, x.lost_taps, x.students]));
  });

  it("makes the number of lectures asked for", async () => {
    await seed(marko, MARKO_COURSE, 3);
    expect(await lectures()).toHaveLength(3);
  });

  it("rejects a count under 1 or over 30", async () => {
    await expect(seed(marko, MARKO_COURSE, 0)).rejects.toMatchObject({ code: "22023" });
    await expect(seed(marko, MARKO_COURSE, 31)).rejects.toMatchObject({ code: "22023" });
    expect(await lectures()).toHaveLength(0);
  });

  it("raises on a second call and keeps the first semester", async () => {
    await seed(marko);
    await expect(seed(marko)).rejects.toThrow(/already has lectures/);
    expect(await lectures()).toHaveLength(8);
  });

  it("refuses a course that already has any lecture", async () => {
    await addLecture(LECTURE_A, { name: "Real one", date: "2026-10-19", startedAt: "2026-10-19 14:05+00", slides: 2 });
    await expect(seed(marko)).rejects.toThrow(/already has lectures/);
    expect(await lectures()).toHaveLength(1);
  });

  it("is owner only: another teacher, a student and a signed out caller are refused", async () => {
    await expect(seed(other)).rejects.toMatchObject({ code: "42501" });
    await expect(seed(student(1))).rejects.toMatchObject({ code: "42501" });
    await expect(seed(null)).rejects.toMatchObject({ code: "42501" });
    await expect(seed(marko, "dddddddd-dddd-dddd-dddd-dddddddddddd")).rejects.toMatchObject({ code: "42501" });
    expect(await lectures()).toHaveLength(0);
  });

  it("leaves the caller's random() sequence alone (no setseed, no draws)", async () => {
    await db.query("select setseed(0.5)");
    const expected = (await db.query<{ r: number }>("select random() as r from generate_series(1, 3)")).rows.map((r) => r.r);
    await db.query("select setseed(0.5)");
    await seed(marko);
    const after = (await db.query<{ r: number }>("select random() as r from generate_series(1, 3)")).rows.map((r) => r.r);
    expect(after).toEqual(expected);
  });
});
