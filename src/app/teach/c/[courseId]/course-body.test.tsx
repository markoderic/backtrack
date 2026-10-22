import { describe, it, expect, vi, beforeEach } from "vitest";

const maybeSingle = vi.fn();
const lectures = vi.fn();
const getUser = vi.fn();
const eqCalls: [string, string, unknown][] = [];
const orderCalls: [string, unknown][] = [];
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser },
    from: (table: string) => {
      const chain = {
        order: (column: string, options: unknown) => {
          orderCalls.push([column, options]);
          return chain;
        },
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(lectures()).then(resolve, reject),
        maybeSingle,
        eq: (column: string, value: unknown) => {
          eqCalls.push([table, column, value]);
          return chain;
        },
      };
      return { select: () => chain };
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
}));

import { renderToStaticMarkup } from "react-dom/server";
import { CourseBody } from "./course-body";

const params = Promise.resolve({ courseId: "c1" });

beforeEach(() => {
  eqCalls.length = 0;
  orderCalls.length = 0;
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

  it("shows Live now: Resume for a live lecture and lists ended ones as past", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "c1", name: "IMS 452" }, error: null });
    lectures.mockResolvedValue({
      data: [
        { id: "l2", name: "Lecture 2, Oct 26", status: "live", lecture_date: "2026-10-26" },
        { id: "l1", name: "Lecture 1, Oct 19", status: "ended", lecture_date: "2026-10-19" },
      ],
      error: null,
    });
    const html = renderToStaticMarkup(await CourseBody({ params }));
    expect(html).toContain('href="/teach/l/l2/present"');
    expect(html).toContain("Live now: Resume");
    expect(html).toContain("Lecture 1, Oct 19");
    expect(html).not.toContain("No lectures yet.");
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
    expect(html).toContain("No lectures yet.");
    expect(html).not.toContain("Live now");
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

  it("offers no export with only a live lecture, or with no lectures", async () => {
    course();
    lectures.mockResolvedValue({
      data: [{ id: "l1", name: "Lecture 1, Oct 26", status: "live", lecture_date: "2026-10-26" }],
      error: null,
    });
    const live = renderToStaticMarkup(await CourseBody({ params }));
    expect(live).not.toContain("Export semester CSV");
    expect(live).toContain("Live now: Resume");
    expect(live).toContain("No lectures yet.");

    lectures.mockResolvedValue({ data: [], error: null });
    expect(renderToStaticMarkup(await CourseBody({ params }))).not.toContain("/export");
  });

  it("keeps Live now: Resume next to the past lectures and the export", async () => {
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
});
