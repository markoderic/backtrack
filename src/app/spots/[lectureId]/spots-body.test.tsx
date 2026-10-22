import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getUser = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({ auth: { getUser }, from }),
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
  [getUser, maybeSingle, eq, select, from].forEach((m) => m.mockClear());
  getUser.mockResolvedValue({ data: { user: { id: "s1" } } });
  maybeSingle.mockResolvedValue({
    data: { name: "Lecture 3, Oct 26", lecture_date: "2026-10-26", slide_count: 12 },
    error: null,
  });
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

  it("reads the lecture name, date and slide count of this lecture", async () => {
    await SpotsBody({ params });
    expect(from).toHaveBeenCalledWith("lectures");
    expect(select).toHaveBeenCalledWith("name, lecture_date, slide_count");
    expect(eq).toHaveBeenCalledWith("id", "l1");
  });

  it("hands the view the lecture and the user", async () => {
    render(await SpotsBody({ params }));
    expect(JSON.parse(screen.getByTestId("view").textContent!)).toEqual({
      lectureId: "l1",
      userId: "s1",
      lectureName: "Lecture 3, Oct 26",
      lectureDate: "2026-10-26",
      slideCount: 12,
    });
  });
});
