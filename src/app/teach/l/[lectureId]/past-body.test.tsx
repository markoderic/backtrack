import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const maybeSingle = vi.fn();
const slidesQuery = vi.fn();
const getUser = vi.fn();
const selects: [string, string][] = [];
const eqCalls: [string, string, unknown][] = [];
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser },
    from: (table: string) => {
      const chain = {
        maybeSingle,
        order: slidesQuery,
        eq: (column: string, value: unknown) => {
          eqCalls.push([table, column, value]);
          return chain;
        },
      };
      return {
        select: (columns: string) => {
          selects.push([table, columns]);
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
}));
vi.mock("./live/LectureData", () => ({
  LectureData: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <div>
      <div data-testid="data">{JSON.stringify(props)}</div>
      {children}
    </div>
  ),
}));
vi.mock("./RenameForm", () => ({
  RenameForm: (props: Record<string, unknown>) => <div data-testid="rename">{JSON.stringify(props)}</div>,
}));

import { PastBody } from "./past-body";

const params = Promise.resolve({ lectureId: "l1" });
const lecture = {
  id: "l1",
  course_id: "c1",
  name: "Lecture 1, Oct 19",
  status: "ended",
  lecture_date: "2026-10-19",
  slide_count: 3,
};

beforeEach(() => {
  selects.length = 0;
  eqCalls.length = 0;
  maybeSingle.mockReset();
  slidesQuery.mockReset();
  slidesQuery.mockResolvedValue({
    data: [
      { number: 1, first_line: "Intro" },
      { number: 3, first_line: "Joins" },
    ],
    error: null,
  });
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
});

describe("PastBody", () => {
  it("sends a signed out visitor to /teach", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(PastBody({ params })).rejects.toThrow("REDIRECT:/teach");
  });

  it("asks only for a lecture of the signed in teacher's own courses, so a joined student gets a 404", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(PastBody({ params })).rejects.toThrow("NOT_FOUND");
    expect(selects[0]).toEqual(["lectures", expect.stringContaining("courses!inner(teacher_id)")]);
    expect(eqCalls).toContainEqual(["lectures", "id", "l1"]);
    expect(eqCalls).toContainEqual(["lectures", "courses.teacher_id", "u1"]);
    expect(slidesQuery).not.toHaveBeenCalled();
  });

  it("is a 404 for a malformed uuid in the url", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } });
    await expect(PastBody({ params })).rejects.toThrow("NOT_FOUND");
  });

  it("throws on any other query error", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: "42P01", message: "lectures broke" } });
    await expect(PastBody({ params })).rejects.toThrow("lectures broke");
  });

  it("sends a lecture that is still live to its live data page", async () => {
    maybeSingle.mockResolvedValue({ data: { ...lecture, status: "live" }, error: null });
    await expect(PastBody({ params })).rejects.toThrow("REDIRECT:/teach/l/l1/live");
    expect(slidesQuery).not.toHaveBeenCalled();
  });

  it("throws when the slides cannot be read", async () => {
    maybeSingle.mockResolvedValue({ data: lecture, error: null });
    slidesQuery.mockResolvedValue({ data: null, error: { message: "slides broke" } });
    await expect(PastBody({ params })).rejects.toThrow("slides broke");
  });

  it("shows the data view in past mode with every slide, the date and the course to go back to", async () => {
    maybeSingle.mockResolvedValue({ data: lecture, error: null });
    render(await PastBody({ params }));
    expect(eqCalls).toContainEqual(["slides", "lecture_id", "l1"]);
    expect(JSON.parse(screen.getByTestId("data").textContent!)).toEqual({
      lectureId: "l1",
      mode: "past",
      lectureName: "Lecture 1, Oct 19",
      lectureDate: "2026-10-19",
      slides: [
        { number: 1, first_line: "Intro" },
        { number: 2, first_line: "" },
        { number: 3, first_line: "Joins" },
      ],
      courseId: "c1",
    });
  });

  it("puts the rename field with the current name on the page", async () => {
    maybeSingle.mockResolvedValue({ data: lecture, error: null });
    render(await PastBody({ params }));
    expect(JSON.parse(screen.getByTestId("rename").textContent!)).toEqual({
      lectureId: "l1",
      initialName: "Lecture 1, Oct 19",
    });
  });
});
