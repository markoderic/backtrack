import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifySend, classifyThrown, makeSend, loadOwnTaps } from "./lostTapApi";

const LECTURE = "11111111-1111-1111-1111-111111111111";
const USER = "44444444-4444-4444-4444-000000000001";
const TAP = { id: "99999999-9999-9999-9999-000000000001", tappedOnSlide: 7, tappedAt: "2026-10-26T14:00:00.000Z" };

describe("classifySend", () => {
  it("is ok when there is no error", () => {
    expect(classifySend({ error: null, status: 201 })).toBe("ok");
    expect(classifySend({ error: null })).toBe("ok");
  });

  it("is rejected for a Postgres or RLS error with a code", () => {
    expect(classifySend({ error: { code: "42501", message: "new row violates row-level security policy" }, status: 403 })).toBe("rejected");
    expect(classifySend({ error: { code: "23514", message: "check constraint" }, status: 400 })).toBe("rejected");
    expect(classifySend({ error: { code: "22P02", message: "bad uuid" }, status: 400 })).toBe("rejected");
  });

  it("is offline when fetch failed: status 0 and no code", () => {
    expect(classifySend({ error: { code: "", message: "TypeError: Failed to fetch" }, status: 0 })).toBe("offline");
  });

  it("is offline when there is an error with no code and no status", () => {
    expect(classifySend({ error: { message: "Failed to fetch" } })).toBe("offline");
    expect(classifySend({ error: { code: "", message: "Failed to fetch" } })).toBe("offline");
  });

  it("is offline for a server error even when it has a code", () => {
    expect(classifySend({ error: { code: "XX000", message: "internal" }, status: 500 })).toBe("offline");
    expect(classifySend({ error: { code: "", message: "bad gateway" }, status: 502 })).toBe("offline");
    expect(classifySend({ error: { code: "PGRST000", message: "no connection" }, status: 503 })).toBe("offline");
  });

  it("is throttled for an expired or gone login or a rate limit: retried a few times, then dropped", () => {
    expect(classifySend({ error: { code: "PGRST301", message: "JWT expired" }, status: 401 })).toBe("throttled");
    expect(classifySend({ error: { code: "", message: "slow down" }, status: 429 })).toBe("throttled");
    expect(classifySend({ error: { message: "slow down", status: 429 } })).toBe("throttled");
  });

  it("is limited for the tap limit error, whatever the status, so it is dropped and never retried", () => {
    expect(classifySend({ error: { code: "BT429", message: "Too many taps. Try again in a minute." }, status: 400 })).toBe("limited");
    expect(classifySend({ error: { code: "BT429", message: "Too many taps." }, status: 500 })).toBe("limited");
    expect(classifySend({ error: { code: "BT429", message: "Too many taps in this lecture." }, status: 400 })).toBe("capped");
  });

  it("is rejected for a 4xx with no code", () => {
    expect(classifySend({ error: { message: "nope" }, status: 400 })).toBe("rejected");
  });
});

describe("classifyThrown", () => {
  it("is offline for a fetch TypeError", () => {
    expect(classifyThrown(new TypeError("Failed to fetch"))).toBe("offline");
  });

  it("throws anything else on", () => {
    const boom = new Error("boom");
    expect(() => classifyThrown(boom)).toThrow(boom);
    expect(() => classifyThrown("string")).toThrow();
  });
});

function fakeSupabase(over: {
  upsert?: () => Promise<unknown>;
  eq?: () => Promise<unknown>;
  session?: unknown;
  select?: () => Promise<unknown>;
} = {}) {
  const upsert = vi.fn(over.upsert ?? (async () => ({ error: null, status: 201 })));
  const eqUpdate = vi.fn(over.eq ?? (async () => ({ error: null, status: 204 })));
  const update = vi.fn(() => ({ eq: eqUpdate }));
  const eqUndone = vi.fn(over.select ?? (async () => ({ data: [], error: null, status: 200 })));
  const eqAnon = vi.fn(() => ({ eq: eqUndone }));
  const eqLecture = vi.fn(() => ({ eq: eqAnon }));
  const select = vi.fn(() => ({ eq: eqLecture }));
  const from = vi.fn(() => ({ upsert, update, select }));
  const getSession = vi.fn(async () => ("session" in over ? over.session : { data: { session: { user: { id: USER } } }, error: null }));
  const supabase = { from, auth: { getSession } } as unknown as SupabaseClient;
  return { supabase, from, upsert, update, eqUpdate, select, eqLecture, eqAnon, eqUndone, getSession };
}

describe("makeSend", () => {
  it("upserts an insert with the browser made id and ignoreDuplicates, as the signed in user", async () => {
    const f = fakeSupabase();
    const result = await makeSend(f.supabase, LECTURE)({ op: "insert", tap: TAP });
    expect(result).toBe("ok");
    expect(f.from).toHaveBeenCalledWith("lost_taps");
    expect(f.upsert).toHaveBeenCalledWith(
      {
        id: TAP.id,
        lecture_id: LECTURE,
        anon_id: USER,
        kind: "lost",
        tapped_on_slide: 7,
        slide_number: 7,
        tapped_at: TAP.tappedAt,
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
  });

  it("sends a note that was on the tap", async () => {
    const f = fakeSupabase();
    await makeSend(f.supabase, LECTURE)({ op: "insert", tap: { ...TAP, note: "why" } });
    expect((f.upsert.mock.calls as unknown as [Record<string, unknown>][])[0][0]).toMatchObject({ note: "why" });
  });

  it("sends the kind and the four hl_ values of a highlight, and never a rect column", async () => {
    const f = fakeSupabase();
    const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    await makeSend(f.supabase, LECTURE)({ op: "insert", tap: { ...TAP, kind: "save", rect } });
    const row = (f.upsert.mock.calls as unknown as [Record<string, unknown>][])[0][0];
    expect(row).toMatchObject({ kind: "save", hl_x: 0.1, hl_y: 0.2, hl_w: 0.3, hl_h: 0.4, slide_number: 7, tapped_on_slide: 7 });
    expect(row).not.toHaveProperty("rect");
  });

  it("sends a plain tap as kind lost with no hl_ values", async () => {
    const f = fakeSupabase();
    await makeSend(f.supabase, LECTURE)({ op: "insert", tap: TAP });
    const row = (f.upsert.mock.calls as unknown as [Record<string, unknown>][])[0][0];
    expect(row.kind).toBe("lost");
    expect(Object.keys(row).some((k) => k.startsWith("hl_"))).toBe(false);
  });

  it("sends an update that has a rect as the four hl_ values", async () => {
    const f = fakeSupabase();
    const result = await makeSend(f.supabase, LECTURE)({ op: "update", id: TAP.id, patch: { rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } } });
    expect(result).toBe("ok");
    expect(f.update).toHaveBeenCalledWith({ hl_x: 0.1, hl_y: 0.2, hl_w: 0.3, hl_h: 0.4 });
    expect(f.eqUpdate).toHaveBeenCalledWith("id", TAP.id);
  });

  it("keeps the other patch fields next to the hl_ values", async () => {
    const f = fakeSupabase();
    await makeSend(f.supabase, LECTURE)({ op: "update", id: TAP.id, patch: { note: "x", rect: { x: 0, y: 0, w: 1, h: 1 } } });
    expect(f.update).toHaveBeenCalledWith({ note: "x", hl_x: 0, hl_y: 0, hl_w: 1, hl_h: 1 });
  });

  it("updates by id with the patch", async () => {
    const f = fakeSupabase();
    const result = await makeSend(f.supabase, LECTURE)({ op: "update", id: TAP.id, patch: { undone: true } });
    expect(result).toBe("ok");
    expect(f.update).toHaveBeenCalledWith({ undone: true });
    expect(f.eqUpdate).toHaveBeenCalledWith("id", TAP.id);
    expect(f.getSession).not.toHaveBeenCalled();
  });

  it("maps an RLS rejection to rejected and a failed fetch to offline", async () => {
    const rls = fakeSupabase({ upsert: async () => ({ error: { code: "42501", message: "rls" }, status: 403 }) });
    expect(await makeSend(rls.supabase, LECTURE)({ op: "insert", tap: TAP })).toBe("rejected");
    const down = fakeSupabase({ upsert: async () => ({ error: { code: "", message: "TypeError: Failed to fetch" }, status: 0 }) });
    expect(await makeSend(down.supabase, LECTURE)({ op: "insert", tap: TAP })).toBe("offline");
    const updateDown = fakeSupabase({ eq: async () => ({ error: { code: "", message: "Failed to fetch" }, status: 0 }) });
    expect(await makeSend(updateDown.supabase, LECTURE)({ op: "update", id: TAP.id, patch: { note: "x" } })).toBe("offline");
  });

  it("maps a thrown fetch TypeError to offline and throws other errors", async () => {
    const down = fakeSupabase({
      upsert: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(await makeSend(down.supabase, LECTURE)({ op: "insert", tap: TAP })).toBe("offline");
    const broken = fakeSupabase({
      upsert: async () => {
        throw new Error("boom");
      },
    });
    await expect(makeSend(broken.supabase, LECTURE)({ op: "insert", tap: TAP })).rejects.toThrow("boom");
  });

  it("is offline when the session cannot be read because the network is down", async () => {
    const f = fakeSupabase({ session: { data: { session: null }, error: { status: 0, code: "", message: "fetch failed" } } });
    expect(await makeSend(f.supabase, LECTURE)({ op: "insert", tap: TAP })).toBe("offline");
    expect(f.upsert).not.toHaveBeenCalled();
  });

  it("throws when there is no session at all", async () => {
    const f = fakeSupabase({ session: { data: { session: null }, error: null } });
    await expect(makeSend(f.supabase, LECTURE)({ op: "insert", tap: TAP })).rejects.toThrow(/signed in/i);
    expect(f.upsert).not.toHaveBeenCalled();
  });
});

describe("loadOwnTaps", () => {
  it("reads this student's rows that are not undone, with their kind", async () => {
    const f = fakeSupabase({
      select: async () => ({
        data: [
          { id: "a", slide_number: 3, kind: "lost" },
          { id: "b", slide_number: 7, kind: "save" },
        ],
        error: null,
        status: 200,
      }),
    });
    expect(await loadOwnTaps(f.supabase, LECTURE)).toEqual([
      { id: "a", slide: 3, kind: "lost" },
      { id: "b", slide: 7, kind: "save" },
    ]);
    expect(f.from).toHaveBeenCalledWith("lost_taps");
    expect(f.select).toHaveBeenCalledWith("id, slide_number, kind");
    expect(f.eqLecture).toHaveBeenCalledWith("lecture_id", LECTURE);
    expect(f.eqAnon).toHaveBeenCalledWith("anon_id", USER);
    expect(f.eqUndone).toHaveBeenCalledWith("undone", false);
  });

  it("asks only for the signed in user's own rows (a teacher who joined their own lecture gets theirs only)", async () => {
    const f = fakeSupabase({ session: { data: { session: { user: { id: "teacher-id" } } }, error: null } });
    await loadOwnTaps(f.supabase, LECTURE);
    expect(f.eqAnon).toHaveBeenCalledWith("anon_id", "teacher-id");
  });

  it("gives no rows and asks nothing when nobody is signed in", async () => {
    const f = fakeSupabase({ session: { data: { session: null }, error: null } });
    expect(await loadOwnTaps(f.supabase, LECTURE)).toEqual([]);
    expect(f.from).not.toHaveBeenCalled();
  });

  it("gives null when the session can not be read offline, and throws any other session error", async () => {
    const offline = fakeSupabase({ session: { data: { session: null }, error: { message: "Failed to fetch" } } });
    expect(await loadOwnTaps(offline.supabase, LECTURE)).toBeNull();
    const broken = fakeSupabase({ session: { data: { session: null }, error: { code: "x", message: "bad session", status: 400 } } });
    await expect(loadOwnTaps(broken.supabase, LECTURE)).rejects.toThrow("bad session");
  });

  it("gives null when the network is down so the caller can try again", async () => {
    const f = fakeSupabase({ select: async () => ({ data: null, error: { code: "", message: "Failed to fetch" }, status: 0 }) });
    expect(await loadOwnTaps(f.supabase, LECTURE)).toBeNull();
  });

  it("throws any other error", async () => {
    const f = fakeSupabase({ select: async () => ({ data: null, error: { code: "42501", message: "denied" }, status: 403 }) });
    await expect(loadOwnTaps(f.supabase, LECTURE)).rejects.toThrow("denied");
  });

  it("gives null when fetch throws", async () => {
    const f = fakeSupabase({
      select: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(await loadOwnTaps(f.supabase, LECTURE)).toBeNull();
  });
});
