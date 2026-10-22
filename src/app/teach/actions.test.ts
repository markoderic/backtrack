// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ insert: vi.fn(), revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "lcarter@miamioh.edu" } } }) },
    from: () => ({ insert: h.insert }),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { addCourse } from "./actions";

beforeEach(() => {
  h.insert.mockReset().mockResolvedValue({ error: null });
  h.revalidatePath.mockReset();
});

describe("addCourse", () => {
  it("adds the course for the signed in teacher and refreshes Courses and Settings", async () => {
    await addCourse("  ACC 221  ");
    expect(h.insert).toHaveBeenCalledWith({ teacher_id: "u1", name: "ACC 221" });
    expect(h.revalidatePath).toHaveBeenCalledWith("/teach");
    expect(h.revalidatePath).toHaveBeenCalledWith("/teach/settings");
  });
});
