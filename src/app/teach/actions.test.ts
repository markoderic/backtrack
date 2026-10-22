// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ insert: vi.fn(), rpc: vi.fn(), from: vi.fn(), revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "lcarter@miamioh.edu" } } }) },
    from: (table: string) => {
      h.from(table);
      return { insert: h.insert };
    },
    rpc: h.rpc,
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { addCourse, saveSetup } from "./actions";

beforeEach(() => {
  h.insert.mockReset().mockResolvedValue({ error: null });
  h.rpc.mockReset().mockResolvedValue({ data: true, error: null });
  h.from.mockReset();
  h.revalidatePath.mockReset();
});

const form = (name: string, courses: string[]) => {
  const f = new FormData();
  f.set("name", name);
  for (const c of courses) f.append("course", c);
  return f;
};

describe("saveSetup", () => {
  it("saves the name and courses in one save_setup call, trimmed and without blanks, then goes to /teach", async () => {
    await expect(saveSetup(form("  Marko ", [" IMS 452 ", "", "IMS 228"]))).rejects.toThrow("REDIRECT:/teach");
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("save_setup", { p_name: "Marko", p_courses: ["IMS 452", "IMS 228"] });
    // No separate writes that could half succeed.
    expect(h.from).not.toHaveBeenCalled();
    expect(h.revalidatePath).toHaveBeenCalledWith("/teach");
  });

  it("goes to /teach without an error when setup was already done (a second click)", async () => {
    h.rpc.mockResolvedValue({ data: false, error: null });
    await expect(saveSetup(form("Marko", ["IMS 452"]))).rejects.toThrow("REDIRECT:/teach");
  });

  it("throws (the error page) when the save fails, with nothing half saved", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(saveSetup(form("Marko", ["IMS 452"]))).rejects.toThrow("Could not save your name and courses.");
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("sends a bad form back to setup without calling the database", async () => {
    for (const f of [form("", ["IMS 452"]), form("Marko", []), form("x".repeat(81), ["A"]), form("Marko", ["x".repeat(121)])]) {
      await expect(saveSetup(f)).rejects.toThrow("REDIRECT:/teach/setup");
    }
    await expect(saveSetup(form("Marko", Array.from({ length: 21 }, (_, i) => `C${i}`)))).rejects.toThrow(
      "REDIRECT:/teach/setup",
    );
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("addCourse", () => {
  it("adds the course for the signed in teacher and refreshes Courses and Settings", async () => {
    await addCourse("  ACC 221  ");
    expect(h.insert).toHaveBeenCalledWith({ teacher_id: "u1", name: "ACC 221" });
    expect(h.revalidatePath).toHaveBeenCalledWith("/teach");
    expect(h.revalidatePath).toHaveBeenCalledWith("/teach/settings");
  });
});
