// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ signOut: vi.fn(), revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({ auth: { signOut: h.signOut } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { signOut } from "./actions";

beforeEach(() => {
  h.signOut.mockReset();
  h.revalidatePath.mockReset();
});

describe("signOut", () => {
  it("ends the session on the server and goes home", async () => {
    h.signOut.mockResolvedValue({ error: null });
    await expect(signOut()).rejects.toThrow("REDIRECT:/");
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.revalidatePath).toHaveBeenCalledWith("/teach", "layout");
  });

  it("says so, and stays, when Supabase can't end the session", async () => {
    h.signOut.mockResolvedValue({ error: { message: "network" } });
    await expect(signOut()).resolves.toEqual({ error: "Couldn't sign out. Try again." });
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("treats a thrown error the same way", async () => {
    h.signOut.mockRejectedValue(new Error("offline"));
    await expect(signOut()).resolves.toEqual({ error: "Couldn't sign out. Try again." });
  });
});
