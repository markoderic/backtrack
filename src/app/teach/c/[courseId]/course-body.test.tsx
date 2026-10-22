import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { CourseBody } from "./course-body";

const params = Promise.resolve({ courseId: "c1" });

beforeEach(() => {
  maybeSingle.mockReset();
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
});
