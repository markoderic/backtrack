import { describe, it, expect, vi, beforeEach } from "vitest";

const maybeSingle = vi.fn();
const lectures = vi.fn();
const getUser = vi.fn();
const teacherRow = vi.fn();
const participants = vi.fn();
const exportRows = vi.fn();
const rpcCalls: [string, unknown][] = [];
const inCalls: [string, string, unknown][] = [];
const eqCalls: [string, string, unknown][] = [];
const orderCalls: [string, unknown][] = [];
const selectCalls: [string, string][] = [];
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser },
    rpc: (name: string, args: unknown) => {
      rpcCalls.push([name, args]);
      return { range: () => Promise.resolve(exportRows()) };
    },
    from: (table: string) => {
      const chain = {
        order: (column: string, options: unknown) => {
          if (table === "lectures") orderCalls.push([column, options]);
          return chain;
        },
        range: () => Promise.resolve(participants()),
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(lectures()).then(resolve, reject),
        maybeSingle: table === "teachers" ? teacherRow : maybeSingle,
        eq: (column: string, value: unknown) => {
          eqCalls.push([table, column, value]);
          return chain;
        },
        in: (column: string, value: unknown) => {
          inCalls.push([table, column, value]);
          return chain;
        },
      };
      return {
        select: (columns: string) => {
          selectCalls.push([table, columns]);
          return chain;
        },
      };
    },
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  useRouter: () => ({ refresh: () => {} }),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { CourseBody } from "./course-body";

const params = Promise.resolve({ courseId: "c1" });
// Text and href of every link to a lecture page, in order.
const links = (html: string) =>
  [...html.matchAll(/<a [^>]*href="(\/teach\/l\/[^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[2], m[1].replace(/&amp;/g, "&")]);

beforeEach(() => {
  eqCalls.length = 0;
  selectCalls.length = 0;
  orderCalls.length = 0;
  inCalls.length = 0;
  rpcCalls.length = 0;
  teacherRow.mockReset().mockResolvedValue({ data: { display_name: "Linda Carter" }, error: null });
  participants.mockReset().mockResolvedValue({ data: [], error: null });
  exportRows.mockReset().mockResolvedValue({ data: [], error: null });
  maybeSingle.mockReset();
  lectures.mockReset();
  lectures.mockResolvedValue({ data: [], error: null });
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
});

describe("CourseBody", () => {
  it("sends a signed out visitor to /teach", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(CourseBody({ params })).rejects.toThrow("REDIRECT:/teach");
  });

  it("is a 404 when there is no row and no error", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(CourseBody({ params })).rejects.toThrow("NOT_FOUND");
  });

  it("is a 404 for a malformed uuid in the url", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } });
    await expect(CourseBody({ params })).rejects.toThrow("NOT_FOUND");
  });

  it("throws on any other query error instead of showing a 404", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: "42P01", message: 'relation "courses" does not exist' } });
    await expect(CourseBody({ params })).rejects.toThrow(/does not exist/);
  });

  it("throws when the lectures query fails", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "c1", name: "IMS 452" }, error: null });
    lectures.mockResolvedValue({ data: null, error: { message: "lectures broke" } });
    await expect(CourseBody({ params })).rejects.toThrow("lectures broke");
  });

  it("shows Live now with Resume, Data and End class for a live lecture and lists ended ones as past", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "c1", name: "IMS 452" }, error: null });
    lectures.mockResolvedValue({
      data: [
        { id: "l2", name: "Lecture 2, Oct 26", status: "live", lecture_date: "2026-10-26" },
        { id: "l1", name: "Lecture 1, Oct 19", status: "ended", lecture_date: "2026-10-19" },
      ],
      error: null,
    });
    const html = renderToStaticMarkup(await CourseBody({ params }));
    expect(html).toContain("Live now");
    expect(html).toContain("Lecture 2, Oct 26");
    expect(links(html).filter(([, href]) => href.startsWith("/teach/l/l2"))).toEqual([
      ["Resume", "/teach/l/l2/present"],
      ["Data", "/teach/l/l2/live"],
      ["End class", "/teach/l/l2/live?end=1"],
    ]);
    expect(html).toContain("Lecture 1, Oct 19");
    expect(html).not.toContain("No lectures yet");
    expect(html).not.toContain('href="/teach/l/l1/present"');
  });

  it("asks only for a course and lectures that belong to the signed in teacher", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "c1", name: "IMS 452" }, error: null });
    await CourseBody({ params });
    expect(eqCalls).toContainEqual(["courses", "id", "c1"]);
    expect(eqCalls).toContainEqual(["courses", "teacher_id", "u1"]);
    expect(eqCalls).toContainEqual(["lectures", "course_id", "c1"]);
  });

  it("says there are no lectures yet when there are none", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "c1", name: "IMS 452" }, error: null });
    const html = renderToStaticMarkup(await CourseBody({ params }));
    expect(html).toContain("No lectures yet");
    expect(html).toContain("Start one when class begins. Past lectures and their data collect here.");
    expect(html).not.toContain("Live now");
    expect(html).not.toContain("Past lectures<");
  });

  const course = () => maybeSingle.mockResolvedValue({ data: { id: "c1", name: "IMS 452" }, error: null });

  it("lists ended lectures newest first by lecture date, then start time", async () => {
    course();
    await CourseBody({ params });
    expect(orderCalls).toEqual([
      ["lecture_date", { ascending: false }],
      ["started_at", { ascending: false }],
    ]);
  });

  it("links each past lecture to its page with its name and date", async () => {
    course();
    lectures.mockResolvedValue({
      data: [
        { id: "l3", name: "Lecture 3, Oct 21", status: "ended", lecture_date: "2026-10-21" },
        { id: "l2", name: "Lecture 2, Oct 19", status: "ended", lecture_date: "2026-10-19" },
      ],
      error: null,
    });
    const html = renderToStaticMarkup(await CourseBody({ params }));
    expect(html).toContain('href="/teach/l/l3"');
    expect(html).toContain('href="/teach/l/l2"');
    expect(html.indexOf("/teach/l/l3")).toBeLessThan(html.indexOf("/teach/l/l2"));
    expect(html).toContain("Lecture 3, Oct 21");
    expect(html).toMatch(/Oct 21/);
    expect(html).toMatch(/Oct 19/);
  });

  it("shows the date without a time zone shift", async () => {
    course();
    lectures.mockResolvedValue({
      data: [{ id: "l1", name: "First", status: "ended", lecture_date: "2026-01-01" }],
      error: null,
    });
    expect(renderToStaticMarkup(await CourseBody({ params }))).toContain("Jan 1");
  });

  it("offers the semester CSV when the course has an ended lecture", async () => {
    course();
    lectures.mockResolvedValue({
      data: [{ id: "l1", name: "Lecture 1, Oct 19", status: "ended", lecture_date: "2026-10-19" }],
      error: null,
    });
    const html = renderToStaticMarkup(await CourseBody({ params }));
    expect(html).toContain('href="/teach/c/c1/export"');
    expect(html).toContain("Export semester CSV");
  });

  it("an archived course still opens, with its past lectures and the CSV, and no Start lecture", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "c1", name: "IMS 452", archived: true }, error: null });
    lectures.mockResolvedValue({
      data: [{ id: "l1", name: "Lecture 1, Oct 19", status: "ended", lecture_date: "2026-10-19" }],
      error: null,
    });
    const html = renderToStaticMarkup(await CourseBody({ params }));
    expect(html).toContain('data-testid="course-archived"');
    expect(html).toContain(">Archived</span>");
    expect(html).toMatch(/<a [^>]*href="\/teach\/settings"[^>]*>Unarchive in Settings<\/a>/);
    expect(html).not.toContain("Start lecture");
    expect(html).not.toContain('href="/teach/c/c1/start"');
    expect(html).toContain('href="/teach/l/l1"');
    expect(html).toContain('href="/teach/c/c1/export"');
  });

  it("a course in use shows Start lecture and no Archived line", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "c1", name: "IMS 452", archived: false }, error: null });
    const html = renderToStaticMarkup(await CourseBody({ params }));
    expect(html).toContain('href="/teach/c/c1/start"');
    expect(html).not.toContain("course-archived");
  });

  it("offers no export with only a live lecture, or with no lectures", async () => {
    course();
    lectures.mockResolvedValue({
      data: [{ id: "l1", name: "Lecture 1, Oct 26", status: "live", lecture_date: "2026-10-26" }],
      error: null,
    });
    const live = renderToStaticMarkup(await CourseBody({ params }));
    expect(live).not.toContain("Export semester CSV");
    expect(live).toContain("Live now");
    expect(live).toContain('href="/teach/l/l1/present"');
    expect(live).toContain("No lectures yet");

    lectures.mockResolvedValue({ data: [], error: null });
    expect(renderToStaticMarkup(await CourseBody({ params }))).not.toContain("/export");
  });

  it("keeps the live lecture row next to the past lectures and the export", async () => {
    course();
    lectures.mockResolvedValue({
      data: [
        { id: "l2", name: "Lecture 2, Oct 26", status: "live", lecture_date: "2026-10-26" },
        { id: "l1", name: "Lecture 1, Oct 19", status: "ended", lecture_date: "2026-10-19" },
      ],
      error: null,
    });
    const html = renderToStaticMarkup(await CourseBody({ params }));
    expect(html).toContain('href="/teach/l/l2/present"');
    expect(html).toContain('href="/teach/l/l1"');
    expect(html).toContain('href="/teach/c/c1/export"');
  });

  it("shows the course code as the heading with the rest of the name under it, and Start lecture", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "c1", name: "ACC 221 Intro to Financial Accounting" }, error: null });
    const html = renderToStaticMarkup(await CourseBody({ params }));
    expect(html).toMatch(/<h1[^>]*>ACC 221<\/h1>/);
    expect(html).toContain("Intro to Financial Accounting");
    expect(html).toMatch(/<a [^>]*href="\/teach\/c\/c1\/start"[^>]*>Start lecture<\/a>/);
    // Top bar: Courses / ACC 221, and the teacher's name.
    expect(html).toMatch(/<a [^>]*href="\/teach"[^>]*>Courses<\/a>/);
    expect(html).toMatch(/aria-current="page"[^>]*>ACC 221</);
    expect(html).toContain("Linda Carter");
  });

  it("shows joined, lost taps and the most lost slide of each past lecture, from the teacher's own reads", async () => {
    course();
    lectures.mockResolvedValue({
      data: [
        { id: "l2", name: "Week 8", status: "ended", lecture_date: "2026-10-21", started_at: "2026-10-21T14:00:00Z", slide_count: 3 },
        { id: "l1", name: "Week 7", status: "ended", lecture_date: "2026-10-14", started_at: "2026-10-14T14:00:00Z", slide_count: 2 },
      ],
      error: null,
    });
    // course_export: oldest lecture first, one row per slide.
    exportRows.mockResolvedValue({
      data: [
        { lecture_date: "2026-10-14", lecture_name: "Week 7", slide_number: 1, first_line: "Intro", lost_taps: 0, students: 0 },
        { lecture_date: "2026-10-14", lecture_name: "Week 7", slide_number: 2, first_line: "Closing entries", lost_taps: 4, students: 3 },
        { lecture_date: "2026-10-21", lecture_name: "Week 8", slide_number: 1, first_line: "Welcome", lost_taps: 5, students: 2 },
        { lecture_date: "2026-10-21", lecture_name: "Week 8", slide_number: 2, first_line: "Accrual example", lost_taps: 3, students: 3 },
        { lecture_date: "2026-10-21", lecture_name: "Week 8", slide_number: 3, first_line: "Wrap up", lost_taps: 0, students: 0 },
      ],
      error: null,
    });
    participants.mockResolvedValue({
      data: [{ lecture_id: "l1" }, { lecture_id: "l2" }, { lecture_id: "l2" }, { lecture_id: "l2" }],
      error: null,
    });
    const html = renderToStaticMarkup(await CourseBody({ params }));
    expect(rpcCalls).toEqual([["course_export", { p_course_id: "c1" }]]);
    expect(inCalls).toContainEqual(["participants", "lecture_id", ["l2", "l1"]]);
    const text = html.replace(/<[^>]+>/g, "|");
    // Week 8: 3 joined, 8 lost taps, most lost slide 2 (more students beat more taps, D3).
    expect(text).toMatch(/Week 8\|+3\|+ joined\|+8\|+ lost taps\|+Most lost: slide \|+2\|+Accrual example/);
    // Week 7: 1 joined, 4 lost taps, slide 2.
    expect(text).toMatch(/Week 7\|+1\|+ joined\|+4\|+ lost taps\|+Most lost: slide \|+2\|+Closing entries/);
  });

  it("leaves the numbers out instead of failing when they cannot be read", async () => {
    course();
    lectures.mockResolvedValue({
      data: [{ id: "l1", name: "Week 7", status: "ended", lecture_date: "2026-10-14", slide_count: 2 }],
      error: null,
    });
    exportRows.mockResolvedValue({ data: null, error: { message: "nope" } });
    participants.mockResolvedValue({ data: null, error: { message: "nope" } });
    const html = renderToStaticMarkup(await CourseBody({ params }));
    expect(html).toContain('href="/teach/l/l1"');
    expect(html).not.toContain(" joined");
    expect(html).not.toContain(" lost taps");
  });

  it("shows five past lectures and the number of the rest", async () => {
    course();
    lectures.mockResolvedValue({
      data: Array.from({ length: 8 }, (_, i) => ({
        id: `l${8 - i}`,
        name: `Week ${8 - i}`,
        status: "ended",
        lecture_date: `2026-10-${String(21 - i).padStart(2, "0")}`,
        slide_count: 1,
      })),
      error: null,
    });
    const html = renderToStaticMarkup(await CourseBody({ params }));
    expect(html).toContain('href="/teach/l/l8"');
    expect(html).toContain('href="/teach/l/l4"');
    expect(html).not.toContain('href="/teach/l/l3"');
    expect(html).toMatch(/<button[^>]*>3(<!-- -->)? more<\/button>/);
  });
});

describe("CourseBody, Delete lecture", () => {
  const twoLectures = () => {
    maybeSingle.mockResolvedValue({ data: { id: "c1", name: "IMS 228" }, error: null });
    lectures.mockResolvedValue({
      data: [
        { id: "l2", name: "Live one", status: "live", lecture_date: "2026-10-22" },
        { id: "l1", name: "System check, Oct 22", status: "ended", lecture_date: "2026-10-22" },
      ],
      error: null,
    });
  };

  it("says Lecture deleted. after a delete brought the teacher back (?deleted=1)", async () => {
    twoLectures();
    const html = renderToStaticMarkup(await CourseBody({ params, searchParams: Promise.resolve({ deleted: "1" }) }));
    expect(html).toMatch(/<p role="status"[^>]*>Lecture deleted\.<\/p>/);
  });

  it("keeps the status line empty (but present) otherwise", async () => {
    twoLectures();
    const html = renderToStaticMarkup(await CourseBody({ params, searchParams: Promise.resolve({}) }));
    expect(html).toMatch(/<p role="status"[^>]*data-testid="course-status"[^>]*><\/p>/);
    expect(html).not.toContain("Lecture deleted.");
  });

  it("gives the past rows and the live row each a ⋯ menu (Delete in it waits for the end of a live class)", async () => {
    twoLectures();
    const html = renderToStaticMarkup(await CourseBody({ params }));
    expect(html).toContain('aria-label="More for System check, Oct 22"');
    expect(html).toContain('aria-label="More for Live one"');
    // No hover-only Delete on the rows any more.
    expect(html).not.toContain('aria-label="Delete System check, Oct 22"');
  });
});

describe("CourseBody: Students can see slides until", () => {
  it("shows the setting with the course's choice and date", async () => {
    maybeSingle.mockResolvedValue({
      data: { id: "c1", name: "IMS 452", archived: false, student_access: "semester", semester_end: "2026-12-11" },
      error: null,
    });
    const html = renderToStaticMarkup(await CourseBody({ params }));
    expect(html).toContain("Students can see slides until");
    expect(html).toMatch(/<option value="semester" selected="">End of semester<\/option>/);
    expect(html).toContain('value="2026-12-11"');
    expect(selectCalls.filter(([t]) => t === "courses")).toEqual([
      ["courses", "id, name, archived, student_access, semester_end"],
    ]);
  });

  it("before migration 0016 reads the course again without the new columns and leaves the setting out", async () => {
    maybeSingle
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column courses.student_access does not exist" } })
      .mockResolvedValueOnce({ data: { id: "c1", name: "IMS 452", archived: false }, error: null });
    const html = renderToStaticMarkup(await CourseBody({ params }));
    expect(selectCalls.filter(([t]) => t === "courses").map(([, c]) => c)).toEqual([
      "id, name, archived, student_access, semester_end",
      "id, name, archived",
    ]);
    expect(html).toContain("No lectures yet");
    expect(html).not.toContain("Students can see slides until");
  });

  it("a malformed uuid is still a 404 without a second read", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } });
    await expect(CourseBody({ params })).rejects.toThrow("NOT_FOUND");
    expect(selectCalls.filter(([t]) => t === "courses")).toHaveLength(1);
  });
});
