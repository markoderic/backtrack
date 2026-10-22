import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const maybeSingle = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
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
vi.mock("./Projector", () => ({
  Projector: (props: Record<string, unknown>) => <div data-testid="projector">{JSON.stringify(props)}</div>,
}));

import { PresentBody } from "./present-body";

const params = Promise.resolve({ lectureId: "l1" });
const lecture = {
  id: "l1",
  course_id: "c1",
  code: "482916",
  status: "live",
  current_slide: 3,
  slide_count: 10,
};

beforeEach(() => {
  maybeSingle.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://backtrack-ebon-sigma.vercel.app/");
});

describe("PresentBody", () => {
  it("sends a signed out visitor to /teach", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(PresentBody({ params })).rejects.toThrow("REDIRECT:/teach");
  });

  it("is a 404 when the lecture is not the teacher's", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(PresentBody({ params })).rejects.toThrow("NOT_FOUND");
  });

  it("is a 404 for a malformed uuid in the url", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } });
    await expect(PresentBody({ params })).rejects.toThrow("NOT_FOUND");
  });

  it("throws on any other query error", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: "42P01", message: "lectures broke" } });
    await expect(PresentBody({ params })).rejects.toThrow("lectures broke");
  });

  it("gives the projector the lecture, with the site address cleaned up", async () => {
    maybeSingle.mockResolvedValue({ data: lecture, error: null });
    render(await PresentBody({ params }));
    expect(JSON.parse(screen.getByTestId("projector").textContent!)).toEqual({
      lectureId: "l1",
      code: "482916",
      siteAddress: "backtrack-ebon-sigma.vercel.app",
      initialSlide: 3,
      slideCount: 10,
    });
  });

  it("shows that an ended lecture has ended, with a link back to the course", async () => {
    maybeSingle.mockResolvedValue({ data: { ...lecture, status: "ended", code: null }, error: null });
    render(await PresentBody({ params }));
    expect(screen.queryByTestId("projector")).not.toBeInTheDocument();
    expect(screen.getByText("This lecture has ended.")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/teach/c/c1");
  });
});
