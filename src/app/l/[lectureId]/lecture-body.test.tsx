import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getUser = vi.fn();
const rpc = vi.fn();
const maybeSingle = vi.fn();
const select = vi.fn(() => ({ eq: () => ({ maybeSingle }) }));
const from = vi.fn(() => ({ select }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({ auth: { getUser }, rpc, from }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("./StudentLecture", () => ({
  StudentLecture: (props: Record<string, unknown>) => <div data-testid="student">{JSON.stringify(props)}</div>,
}));

import { LectureBody } from "./lecture-body";

const params = Promise.resolve({ lectureId: "l1" });

beforeEach(() => {
  [getUser, rpc, maybeSingle, select, from].forEach((m) => m.mockClear());
  getUser.mockResolvedValue({ data: { user: { id: "s1" } } });
  rpc.mockResolvedValue({ data: [{ lecture_name: "Lecture 3, Oct 26", course_name: "IMS 452" }], error: null });
  maybeSingle.mockResolvedValue({ data: { current_slide: 7, status: "live" }, error: null });
});

describe("LectureBody", () => {
  it("sends a visitor with no session to /join", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(LectureBody({ params })).rejects.toThrow("REDIRECT:/join");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends someone who has not joined to /join", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(LectureBody({ params })).rejects.toThrow("REDIRECT:/join");
  });

  it("sends a malformed lecture id to /join", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } });
    await expect(LectureBody({ params })).rejects.toThrow("REDIRECT:/join");
  });

  it("throws on any other header error", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42883", message: "header broke" } });
    await expect(LectureBody({ params })).rejects.toThrow("header broke");
  });

  it("throws when the lecture query fails", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: "42P01", message: "lectures broke" } });
    await expect(LectureBody({ params })).rejects.toThrow("lectures broke");
  });

  it("sends someone whose lecture row is not visible to /join", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(LectureBody({ params })).rejects.toThrow("REDIRECT:/join");
  });

  it("sends an ended lecture to its spot", async () => {
    maybeSingle.mockResolvedValue({ data: { current_slide: 7, status: "ended" }, error: null });
    await expect(LectureBody({ params })).rejects.toThrow("REDIRECT:/spots/l1");
  });

  it("shows the student screen with the names and the live slide, and never reads slide_count", async () => {
    render(await LectureBody({ params }));
    expect(JSON.parse(screen.getByTestId("student").textContent!)).toEqual({
      lectureId: "l1",
      lectureName: "Lecture 3, Oct 26",
      courseName: "IMS 452",
      initialSlide: 7,
    });
    expect(rpc).toHaveBeenCalledWith("lecture_header", { p_lecture_id: "l1" });
    expect(from).toHaveBeenCalledWith("lectures");
    expect(select).toHaveBeenCalledWith("current_slide, status");
  });
});
