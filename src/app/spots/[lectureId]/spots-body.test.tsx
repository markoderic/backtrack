import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getUser = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({ auth: { getUser }, from, rpc }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("./SpotsView", () => ({
  SpotsView: (props: Record<string, unknown>) => <div data-testid="view">{JSON.stringify(props)}</div>,
}));

import { SpotsBody } from "./spots-body";

const params = Promise.resolve({ lectureId: "l1" });

beforeEach(() => {
  [getUser, maybeSingle, eq, select, from, rpc].forEach((m) => m.mockClear());
  getUser.mockResolvedValue({ data: { user: { id: "s1" } } });
  maybeSingle.mockResolvedValue({
    data: {
      name: "Lecture 3, Oct 26",
      lecture_date: "2026-10-26",
      slide_count: 12,
      status: "ended",
      current_slide: 9,
      ended_at: "2026-10-26T15:55:00Z",
    },
    error: null,
  });
  rpc.mockResolvedValue({ data: [{ lecture_name: "Lecture 3, Oct 26", course_name: "CSE 274" }], error: null });
});

describe("SpotsBody", () => {
  it("sends a visitor with no session to /join", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(SpotsBody({ params })).rejects.toThrow("REDIRECT:/join");
    expect(from).not.toHaveBeenCalled();
  });

  it("sends someone who did not join the lecture (no row) to /join", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(SpotsBody({ params })).rejects.toThrow("REDIRECT:/join");
  });

  it("sends a malformed lecture id to /join", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } });
    await expect(SpotsBody({ params })).rejects.toThrow("REDIRECT:/join");
  });

  it("throws on any other error, so the error page shows", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: "42P01", message: "lectures broke" } });
    await expect(SpotsBody({ params })).rejects.toThrow("lectures broke");
  });

  it("reads the lecture name, date, slide count, status, live slide and end of this lecture", async () => {
    await SpotsBody({ params });
    expect(from).toHaveBeenCalledWith("lectures");
    expect(select).toHaveBeenCalledWith("name, lecture_date, slide_count, status, current_slide, ended_at");
    expect(eq).toHaveBeenCalledWith("id", "l1");
  });

  it("reads the course name with lecture_header", async () => {
    await SpotsBody({ params });
    expect(rpc).toHaveBeenCalledWith("lecture_header", { p_lecture_id: "l1" });
  });

  it("throws when lecture_header fails, so the error page shows", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "header broke" } });
    await expect(SpotsBody({ params })).rejects.toThrow("header broke");
  });

  it("hands the view an ended lecture: when it ended, and no live slide", async () => {
    render(await SpotsBody({ params }));
    expect(JSON.parse(screen.getByTestId("view").textContent!)).toEqual({
      lectureId: "l1",
      userId: "s1",
      courseName: "CSE 274",
      lectureName: "Lecture 3, Oct 26",
      lectureDate: "2026-10-26",
      endedAt: "2026-10-26T15:55:00Z",
      slideCount: 12,
      liveSlide: null,
    });
  });

  it("hands the view a live lecture's live slide, so browsing stops there", async () => {
    maybeSingle.mockResolvedValue({
      data: { name: "L", lecture_date: "2026-10-26", slide_count: 12, status: "live", current_slide: 5, ended_at: null },
      error: null,
    });
    render(await SpotsBody({ params }));
    const props = JSON.parse(screen.getByTestId("view").textContent!);
    expect(props.liveSlide).toBe(5);
    expect(props.endedAt).toBeNull();
    expect(props.slideCount).toBe(12);
  });
});
