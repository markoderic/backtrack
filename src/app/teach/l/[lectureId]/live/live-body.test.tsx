import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

const maybeSingle = vi.fn();
const slidesQuery = vi.fn();
const getUser = vi.fn();
const teacherRow = vi.fn();
const selects: [string, string][] = [];
const eqCalls: [string, string, unknown][] = [];
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser },
    from: (table: string) => {
      const chain = {
        maybeSingle: table === "teachers" ? teacherRow : maybeSingle,
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
vi.mock("./LectureData", () => ({
  LectureData: (props: Record<string, unknown>) => <div data-testid="data">{JSON.stringify(props)}</div>,
}));

import { LiveBody } from "./live-body";

const params = Promise.resolve({ lectureId: "l1" });
const noSearch = Promise.resolve({});
const lecture = {
  id: "l1",
  course_id: "c1",
  name: "Lecture 1, Oct 26",
  code: "482916",
  courses: { teacher_id: "u1", name: "ACC 221 Intro to Financial Accounting" },
  status: "live",
  current_slide: 2,
  slide_count: 3,
};

beforeEach(() => {
  cleanup();
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
  teacherRow.mockReset();
  teacherRow.mockResolvedValue({ data: { display_name: "Linda Carter" }, error: null });
});

describe("LiveBody", () => {
  it("sends a signed out visitor to /teach", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(LiveBody({ params, searchParams: noSearch })).rejects.toThrow("REDIRECT:/teach");
  });

  it("is a 404 when the lecture is not the teacher's", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(LiveBody({ params, searchParams: noSearch })).rejects.toThrow("NOT_FOUND");
  });

  it("asks only for a lecture of the signed in teacher's own courses, so a joined student gets a 404", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(LiveBody({ params, searchParams: noSearch })).rejects.toThrow("NOT_FOUND");
    expect(selects[0]).toEqual(["lectures", expect.stringContaining("courses!inner(teacher_id, name)")]);
    expect(eqCalls).toContainEqual(["lectures", "id", "l1"]);
    expect(eqCalls).toContainEqual(["lectures", "courses.teacher_id", "u1"]);
    expect(slidesQuery).not.toHaveBeenCalled();
  });

  it("is a 404 for a malformed uuid in the url", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } });
    await expect(LiveBody({ params, searchParams: noSearch })).rejects.toThrow("NOT_FOUND");
  });

  it("throws on any other query error", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: "42P01", message: "lectures broke" } });
    await expect(LiveBody({ params, searchParams: noSearch })).rejects.toThrow("lectures broke");
  });

  it("throws when the slides cannot be read", async () => {
    maybeSingle.mockResolvedValue({ data: lecture, error: null });
    slidesQuery.mockResolvedValue({ data: null, error: { message: "slides broke" } });
    await expect(LiveBody({ params, searchParams: noSearch })).rejects.toThrow("slides broke");
  });

  it("gives the live data view the lecture name, code, every slide with its first line and the current slide", async () => {
    maybeSingle.mockResolvedValue({ data: lecture, error: null });
    render(await LiveBody({ params, searchParams: noSearch }));
    expect(eqCalls).toContainEqual(["slides", "lecture_id", "l1"]);
    expect(JSON.parse(screen.getByTestId("data").textContent!)).toEqual({
      lectureId: "l1",
      mode: "live",
      lectureName: "Lecture 1, Oct 26",
      slides: [
        { number: 1, first_line: "Intro" },
        { number: 2, first_line: "" },
        { number: 3, first_line: "Joins" },
      ],
      initialCurrentSlide: 2,
      courseId: "c1",
      code: "482916",
      confirmEndOnLoad: false,
      teacherId: "u1",
    });
  });

  it("puts the teacher top bar above it: Courses / course code / lecture name, and the teacher's name", async () => {
    maybeSingle.mockResolvedValue({ data: lecture, error: null });
    render(await LiveBody({ params, searchParams: noSearch }));
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs).toHaveTextContent("Courses/ACC 221/Lecture 1, Oct 26");
    expect(within(crumbs).getByRole("link", { name: "ACC 221" })).toHaveAttribute("href", "/teach/c/c1");
    expect(screen.getByText("Linda Carter")).toBeInTheDocument();
    expect(selects).toContainEqual(["lectures", expect.stringContaining("courses!inner(teacher_id, name)")]);
  });

  it("still shows the data when the teacher's name can not be read", async () => {
    maybeSingle.mockResolvedValue({ data: lecture, error: null });
    teacherRow.mockRejectedValue(new Error("nope"));
    render(await LiveBody({ params, searchParams: noSearch }));
    expect(screen.getByTestId("data")).toBeInTheDocument();
    expect(screen.queryByText("Linda Carter")).not.toBeInTheDocument();
  });

  const shown = async (status: string, search: Promise<{ end?: string | string[] }>) => {
    maybeSingle.mockResolvedValue({ data: { ...lecture, status }, error: null });
    render(await LiveBody({ params, searchParams: search }));
    return JSON.parse(screen.getByTestId("data").textContent!);
  };

  it("asks the data view to open the End lecture confirm for ?end=1 on a live lecture", async () => {
    expect((await shown("live", Promise.resolve({ end: "1" }))).confirmEndOnLoad).toBe(true);
  });

  it("does not for other values", async () => {
    expect((await shown("live", Promise.resolve({ end: "0" }))).confirmEndOnLoad).toBe(false);
    cleanup();
    expect((await shown("live", Promise.resolve({ end: ["1", "2"] }))).confirmEndOnLoad).toBe(false);
  });

  it("sends an ended lecture to its past lecture page, which has its own heading, also with ?end=1", async () => {
    maybeSingle.mockResolvedValue({ data: { ...lecture, status: "ended" }, error: null });
    await expect(LiveBody({ params, searchParams: noSearch })).rejects.toThrow("REDIRECT:/teach/l/l1");
    await expect(LiveBody({ params, searchParams: Promise.resolve({ end: "1" }) })).rejects.toThrow(
      "REDIRECT:/teach/l/l1",
    );
    expect(slidesQuery).not.toHaveBeenCalled();
  });
});
