import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const maybeSingle = vi.fn();
const slidesQuery = vi.fn();
const getUser = vi.fn();
const teacherRow = vi.fn();
const joinedCount = vi.fn();
const stats = vi.fn();
const rpcCalls: [string, unknown][] = [];
const selects: [string, string][] = [];
const eqCalls: [string, string, unknown][] = [];
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser },
    rpc: (name: string, args: unknown) => {
      rpcCalls.push([name, args]);
      return Promise.resolve(stats());
    },
    from: (table: string) => {
      const chain = {
        maybeSingle: table === "teachers" ? teacherRow : maybeSingle,
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(joinedCount()).then(resolve, reject),
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
  started_at: "2026-10-19T14:02:00Z",
  ended_at: "2026-10-19T14:55:00Z",
  courses: { teacher_id: "u1", name: "ACC 221 Intro to Financial Accounting" },
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
  rpcCalls.length = 0;
  teacherRow.mockReset().mockResolvedValue({ data: { display_name: "Linda Carter" }, error: null });
  joinedCount.mockReset().mockResolvedValue({ count: 38, error: null });
  stats.mockReset().mockResolvedValue({
    data: [
      { slide_number: 1, taps: 2, students: 2 },
      { slide_number: 2, taps: 0, students: 0 },
      { slide_number: 3, taps: 38, students: 11 },
    ],
    error: null,
  });
});

describe("PastBody", () => {
  it("sends a signed out visitor to /teach", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(PastBody({ params })).rejects.toThrow("REDIRECT:/teach");
  });

  it("asks only for a lecture of the signed in teacher's own courses, so a joined student gets a 404", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(PastBody({ params })).rejects.toThrow("NOT_FOUND");
    expect(selects[0]).toEqual(["lectures", expect.stringContaining("courses!inner(teacher_id")]);
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

  it("shows the data view in past mode with every slide and the course (the date is in the page heading)", async () => {
    maybeSingle.mockResolvedValue({ data: lecture, error: null });
    render(await PastBody({ params }));
    expect(eqCalls).toContainEqual(["slides", "lecture_id", "l1"]);
    expect(JSON.parse(screen.getByTestId("data").textContent!)).toEqual({
      lectureId: "l1",
      mode: "past",
      lectureName: "Lecture 1, Oct 19",
      slides: [
        { number: 1, first_line: "Intro" },
        { number: 2, first_line: "" },
        { number: 3, first_line: "Joins" },
      ],
      courseId: "c1",
      teacherId: "u1",
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

  it("heads the page with the top bar, when it ran and Export this lecture, a white button", async () => {
    maybeSingle.mockResolvedValue({ data: lecture, error: null });
    render(await PastBody({ params }));
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs).toHaveTextContent("Courses/ACC 221/Lecture 1, Oct 19");
    expect(crumbs.querySelector('a[href="/teach/c/c1"]')).toHaveTextContent("ACC 221");
    // On a phone the breadcrumb is hidden; a back link goes to the course instead.
    expect(screen.getByTestId("back-link")).toHaveAttribute("href", "/teach/c/c1");
    expect(screen.getByText("Linda Carter")).toBeInTheDocument();
    // 14:02 to 14:55 UTC is 10:02 to 10:55 in Oxford, Ohio (EDT).
    expect(screen.getByText("Oct 19, 10:02 to 10:55")).toBeInTheDocument();
    const exportLink = screen.getByRole("link", { name: "Export this lecture" });
    expect(exportLink).toHaveAttribute("href", "/teach/l/l1/export");
    expect(exportLink).toHaveAttribute("download");
    expect(exportLink.className).toContain("bg-surface");
    expect(exportLink.className).not.toContain("underline");
  });

  it("leaves joined and lost taps to the data view's summary row: the heading reads no counts", async () => {
    maybeSingle.mockResolvedValue({ data: lecture, error: null });
    render(await PastBody({ params }));
    expect(rpcCalls).toEqual([]);
    expect(eqCalls.filter(([t]) => t === "participants")).toEqual([]);
    expect(screen.queryByText(/joined/)).toBeNull();
    expect(screen.queryByText(/lost tap/)).toBeNull();
  });

  it("offers Delete lecture next to the export", async () => {
    maybeSingle.mockResolvedValue({ data: lecture, error: null });
    render(await PastBody({ params }));
    expect(screen.getByRole("button", { name: "Delete lecture" })).toHaveAttribute("aria-haspopup", "dialog");
  });
});
