import { describe, it, expect, vi, beforeEach } from "vitest";

const maybeSingle = vi.fn();
const lectures = vi.fn();
const getUser = vi.fn();
const eqCalls: [string, string, unknown][] = [];
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser },
    from: (table: string) => {
      const chain = {
        order: lectures,
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
});
