import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

type Handler = (payload: unknown) => void;
const channel = {
  filters: [] as unknown[],
  insert: null as Handler | null,
  status: null as ((s: string) => void) | null,
  on: vi.fn(),
  subscribe: vi.fn(),
};
channel.on.mockImplementation((_type: string, filter: unknown, cb: Handler) => {
  channel.filters.push(filter);
  channel.insert = cb;
  return channel;
});
channel.subscribe.mockImplementation((cb: (s: string) => void) => {
  channel.status = cb;
  return channel;
});

const eq = vi.fn();
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
const makeChannel = vi.fn(() => channel);
const removeChannel = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({ from, channel: makeChannel, removeChannel }),
}));

import { useJoinedCount } from "./useJoinedCount";

const LECTURE = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  channel.filters = [];
  channel.insert = null;
  channel.status = null;
  [eq, select, from, makeChannel, removeChannel].forEach((m) => m.mockClear());
  eq.mockResolvedValue({ count: 4, error: null });
});

describe("useJoinedCount", () => {
  it("counts the participants of the lecture", async () => {
    const { result } = renderHook(() => useJoinedCount(LECTURE));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(4));
    expect(from).toHaveBeenCalledWith("participants");
    expect(select).toHaveBeenCalledWith("lecture_id", { count: "exact", head: true });
    expect(eq).toHaveBeenCalledWith("lecture_id", LECTURE);
  });

  it("listens for participant inserts of this lecture only", async () => {
    renderHook(() => useJoinedCount(LECTURE));
    expect(channel.on).toHaveBeenCalledWith(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "participants", filter: `lecture_id=eq.${LECTURE}` },
      expect.any(Function),
    );
    expect(channel.subscribe).toHaveBeenCalled();
    await waitFor(() => expect(eq).toHaveBeenCalled());
  });

  it("adds one for every insert", async () => {
    const { result } = renderHook(() => useJoinedCount(LECTURE));
    await waitFor(() => expect(result.current).toBe(4));
    act(() => channel.insert?.({ new: { lecture_id: LECTURE } }));
    act(() => channel.insert?.({ new: { lecture_id: LECTURE } }));
    expect(result.current).toBe(6);
  });

  it("counts again every time the channel reports SUBSCRIBED", async () => {
    const { result } = renderHook(() => useJoinedCount(LECTURE));
    await waitFor(() => expect(result.current).toBe(4));
    const before = eq.mock.calls.length;
    eq.mockResolvedValue({ count: 9, error: null });
    await act(async () => channel.status?.("SUBSCRIBED"));
    await waitFor(() => expect(result.current).toBe(9));
    expect(eq.mock.calls.length).toBe(before + 1);
    await act(async () => channel.status?.("CHANNEL_ERROR"));
    expect(eq.mock.calls.length).toBe(before + 1);
  });

  it("removes the channel when it unmounts", async () => {
    const { unmount } = renderHook(() => useJoinedCount(LECTURE));
    await waitFor(() => expect(eq).toHaveBeenCalled());
    expect(removeChannel).not.toHaveBeenCalled();
    unmount();
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });

  it("throws when the count query fails", async () => {
    eq.mockResolvedValue({ count: null, error: { message: "count broke" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => {
      try {
        return useJoinedCount(LECTURE);
      } catch (e) {
        return e as Error;
      }
    });
    await waitFor(() => expect(result.current).toBeInstanceOf(Error));
    expect((result.current as unknown as Error).message).toBe("count broke");
    spy.mockRestore();
  });
});
