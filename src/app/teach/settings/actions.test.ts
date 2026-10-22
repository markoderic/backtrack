// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  signOut: vi.fn(),
  getUser: vi.fn(),
  select: vi.fn(),
  revalidatePath: vi.fn(),
  tables: [] as string[],
  updates: [] as unknown[],
  eqs: [] as [string, unknown][],
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { signOut: h.signOut, getUser: h.getUser },
    from: (table: string) => {
      h.tables.push(table);
      return {
        update: (payload: unknown) => {
          h.updates.push(payload);
          const chain = {
            eq: (c: string, v: unknown) => {
              h.eqs.push([c, v]);
              return chain;
            },
            select: h.select,
          };
          return chain;
        },
      };
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { saveName, signOut } from "./actions";

beforeEach(() => {
  h.signOut.mockReset();
  h.revalidatePath.mockReset();
  h.getUser.mockReset().mockResolvedValue({ data: { user: { id: "u1", email: "lcarter@miamioh.edu" } } });
  h.select.mockReset().mockResolvedValue({ data: [{ id: "u1" }], error: null });
  h.tables.length = 0;
  h.updates.length = 0;
  h.eqs.length = 0;
});

describe("saveName", () => {
  it("saves the trimmed name to the signed in teacher's own row and refreshes the teacher pages", async () => {
    await expect(saveName("  Dr. Linda Carter  ")).resolves.toBeNull();
    expect(h.tables).toEqual(["teachers"]);
    expect(h.updates).toEqual([{ display_name: "Dr. Linda Carter" }]);
    expect(h.eqs).toEqual([["id", "u1"]]);
    expect(h.revalidatePath).toHaveBeenCalledWith("/teach", "layout");
  });

  it("refuses a blank name without touching the database", async () => {
    await expect(saveName("   ")).resolves.toEqual({ error: "Your name must be 1 to 80 characters." });
    expect(h.getUser).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
  });

  it("refuses a name over 80 characters, and takes exactly 80", async () => {
    await expect(saveName("a".repeat(81))).resolves.toEqual({ error: "Your name must be 1 to 80 characters." });
    expect(h.updates).toEqual([]);
    await expect(saveName("a".repeat(80))).resolves.toBeNull();
  });

  it("refuses when nobody is signed in, or the account isn't a Miami one", async () => {
    h.getUser.mockResolvedValue({ data: { user: null } });
    await expect(saveName("Linda")).resolves.toEqual({ error: "You're signed out. Sign in again to change your name." });
    h.getUser.mockResolvedValue({ data: { user: { id: "u2", email: "x@gmail.com" } } });
    await expect(saveName("Linda")).resolves.toEqual({ error: "You're signed out. Sign in again to change your name." });
    expect(h.updates).toEqual([]);
  });

  it("treats an update that matched no row as a failure", async () => {
    h.select.mockResolvedValue({ data: [], error: null });
    await expect(saveName("Linda")).resolves.toEqual({ error: "Could not save your name." });
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("reports a database error", async () => {
    h.select.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(saveName("Linda")).resolves.toEqual({ error: "Could not save your name." });
  });
});

describe("signOut", () => {
  it("ends this device's session on the server and goes home", async () => {
    h.signOut.mockResolvedValue({ error: null });
    await expect(signOut()).rejects.toThrow("REDIRECT:/");
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
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
