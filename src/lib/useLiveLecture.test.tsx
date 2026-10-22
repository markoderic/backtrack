import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

type Handler = (payload: { new: Record<string, unknown> }) => void;
const channel = {
  filter: null as unknown,
  update: null as Handler | null,
  status: null as ((s: string) => void) | null,
  on: vi.fn(),
  subscribe: vi.fn(),
};
channel.on.mockImplementation((_type: string, filter: unknown, cb: Handler) => {
  channel.filter = filter;
  channel.update = cb;
  return channel;
});
channel.subscribe.mockImplementation((cb: (s: string) => void) => {
  channel.status = cb;
  return channel;
});

const single = vi.fn();
const eq = vi.fn(() => ({ single }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
const makeChannel = vi.fn(() => channel);
const removeChannel = vi.fn();
// Realtime getting the user's token; resolves at once unless a test holds it.
const setAuth = vi.fn(async () => {});
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({ from, channel: makeChannel, removeChannel, realtime: { setAuth } }),
}));

import { useLiveLecture } from "./useLiveLecture";

const LECTURE = "11111111-1111-1111-1111-111111111111";
const row = (current_slide: number, status = "live") => ({ data: { current_slide, status }, error: null });

beforeEach(() => {
  channel.filter = null;
  channel.update = null;
  channel.status = null;
  [single, eq, select, from, makeChannel, removeChannel, setAuth].forEach((m) => m.mockClear());
  setAuth.mockImplementation(async () => {});
  single.mockResolvedValue(row(3));
  setVisibility("visible");
});

function setVisibility(v: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
}

describe("useLiveLecture", () => {
  it("reads the lecture and follows its current slide", async () => {
    const { result } = renderHook(() => useLiveLecture(LECTURE));
    expect(result.current.state).toBeNull();
    await waitFor(() => expect(result.current.state).toMatchObject({ live: 3, viewing: 3, following: true, conn: "live" }));
    expect(from).toHaveBeenCalledWith("lectures");
    expect(select).toHaveBeenCalledWith("current_slide, status");
    expect(eq).toHaveBeenCalledWith("id", LECTURE);
  });

  it("starts from the slide it is given without waiting for the read", async () => {
    const { result } = renderHook(() => useLiveLecture(LECTURE, 5));
    expect(result.current.state).toMatchObject({ live: 5, viewing: 5 });
    await waitFor(() => expect(single).toHaveBeenCalled());
  });

  it("opens the channel only once Realtime has the user's token", async () => {
    let giveToken: () => void = () => {};
    setAuth.mockImplementation(() => new Promise<void>((r) => (giveToken = r)));
    renderHook(() => useLiveLecture(LECTURE, 3));
    await act(async () => {});
    expect(setAuth).toHaveBeenCalled();
    expect(makeChannel).not.toHaveBeenCalled();
    await act(async () => giveToken());
    expect(makeChannel).toHaveBeenCalledTimes(1);
    expect(makeChannel).toHaveBeenCalledWith(`lecture-${LECTURE}`);
  });

  it("opens no channel when it unmounts before the token arrives", async () => {
    let giveToken: () => void = () => {};
    setAuth.mockImplementation(() => new Promise<void>((r) => (giveToken = r)));
    const { unmount } = renderHook(() => useLiveLecture(LECTURE, 3));
    unmount();
    await act(async () => giveToken());
    expect(makeChannel).not.toHaveBeenCalled();
  });

  it("listens for updates of this lecture row only", async () => {
    const { result } = renderHook(() => useLiveLecture(LECTURE));
    await waitFor(() => expect(result.current.state).not.toBeNull());
    expect(channel.filter).toEqual({ event: "UPDATE", schema: "public", table: "lectures", filter: `id=eq.${LECTURE}` });
  });

  it("moves to the new live slide when the teacher changes it", async () => {
    const { result } = renderHook(() => useLiveLecture(LECTURE));
    await waitFor(() => expect(result.current.state).not.toBeNull());
    act(() => channel.update?.({ new: { current_slide: 4, status: "live" } }));
    expect(result.current.state).toMatchObject({ live: 4, viewing: 4 });
  });

  it("does not move a student who went back", async () => {
    const { result } = renderHook(() => useLiveLecture(LECTURE));
    await waitFor(() => expect(result.current.state).not.toBeNull());
    act(() => result.current.back());
    act(() => channel.update?.({ new: { current_slide: 4, status: "live" } }));
    expect(result.current.state).toMatchObject({ live: 4, viewing: 2, following: false });
    act(() => result.current.forward());
    expect(result.current.state).toMatchObject({ viewing: 3, following: false });
    act(() => result.current.jumpToLive());
    expect(result.current.state).toMatchObject({ viewing: 4, following: true });
  });

  it("goTo moves the view to a slide, never past live, and following again at live", async () => {
    const { result } = renderHook(() => useLiveLecture(LECTURE));
    await waitFor(() => expect(result.current.state).not.toBeNull());
    act(() => channel.update?.({ new: { current_slide: 6, status: "live" } }));
    act(() => result.current.goTo(2));
    expect(result.current.state).toMatchObject({ live: 6, viewing: 2, following: false });
    act(() => result.current.goTo(9));
    expect(result.current.state).toMatchObject({ viewing: 6, following: true });
  });

  it("ends when an update says the lecture ended", async () => {
    const { result } = renderHook(() => useLiveLecture(LECTURE));
    await waitFor(() => expect(result.current.state).not.toBeNull());
    act(() => channel.update?.({ new: { current_slide: 3, status: "ended" } }));
    expect(result.current.state?.ended).toBe(true);
  });

  it("ends when the first read finds the lecture already ended", async () => {
    single.mockResolvedValue(row(3, "ended"));
    const { result } = renderHook(() => useLiveLecture(LECTURE, 3));
    await waitFor(() => expect(result.current.state?.ended).toBe(true));
  });

  it("reads the lecture again every time the channel reports SUBSCRIBED", async () => {
    const { result } = renderHook(() => useLiveLecture(LECTURE));
    await waitFor(() => expect(result.current.state).not.toBeNull());
    const before = single.mock.calls.length;
    single.mockResolvedValue(row(6));
    await act(async () => channel.status?.("SUBSCRIBED"));
    await waitFor(() => expect(result.current.state).toMatchObject({ live: 6, viewing: 6 }));
    expect(single.mock.calls.length).toBe(before + 1);
  });

  it("a plain refetch does not move a student who went back", async () => {
    const { result } = renderHook(() => useLiveLecture(LECTURE));
    await waitFor(() => expect(result.current.state).not.toBeNull());
    act(() => result.current.back());
    single.mockResolvedValue(row(6));
    await act(async () => channel.status?.("SUBSCRIBED"));
    await waitFor(() => expect(result.current.state?.live).toBe(6));
    expect(result.current.state).toMatchObject({ viewing: 2, following: false });
  });

  it.each(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"])("shows reconnecting on %s", async (status) => {
    const { result } = renderHook(() => useLiveLecture(LECTURE));
    await waitFor(() => expect(result.current.state).not.toBeNull());
    act(() => channel.status?.(status));
    expect(result.current.state?.conn).toBe("reconnecting");
  });

  it("jumps to the live slide when the channel comes back", async () => {
    const { result } = renderHook(() => useLiveLecture(LECTURE));
    await waitFor(() => expect(result.current.state).not.toBeNull());
    act(() => result.current.back());
    act(() => channel.status?.("CHANNEL_ERROR"));
    single.mockResolvedValue(row(8));
    await act(async () => channel.status?.("SUBSCRIBED"));
    await waitFor(() => expect(result.current.state).toMatchObject({ conn: "live", live: 8, viewing: 8, following: true }));
  });

  it("removes the channel when it unmounts", async () => {
    const { result, unmount } = renderHook(() => useLiveLecture(LECTURE));
    await waitFor(() => expect(result.current.state).not.toBeNull());
    unmount();
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });

  it("does not react to channel status after it unmounts", async () => {
    const { result, unmount } = renderHook(() => useLiveLecture(LECTURE));
    await waitFor(() => expect(result.current.state).not.toBeNull());
    unmount();
    const calls = single.mock.calls.length;
    await act(async () => channel.status?.("SUBSCRIBED"));
    expect(single.mock.calls.length).toBe(calls);
  });

  describe("when a read fails", () => {
    const failed = { data: null, error: { message: "Failed to fetch" } };

    async function dropAndFailOnce() {
      const hook = renderHook(() => useLiveLecture(LECTURE, 3));
      await act(async () => {});
      act(() => hook.result.current.back());
      act(() => channel.status?.("CHANNEL_ERROR"));
      single.mockResolvedValue(failed);
      await act(async () => channel.status?.("SUBSCRIBED"));
      return hook;
    }

    const wait = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));

    it("stays on Reconnecting without throwing, retries after 1, 2 and 4 seconds, then jumps to live", async () => {
      vi.useFakeTimers();
      try {
        const { result } = await dropAndFailOnce();
        expect(result.current.state).toMatchObject({ conn: "reconnecting", viewing: 2, following: false });
        const calls = single.mock.calls.length;

        await wait(999);
        expect(single.mock.calls.length).toBe(calls);
        await wait(1);
        expect(single.mock.calls.length).toBe(calls + 1);
        expect(result.current.state?.conn).toBe("reconnecting");

        await wait(1999);
        expect(single.mock.calls.length).toBe(calls + 1);
        await wait(1);
        expect(single.mock.calls.length).toBe(calls + 2);
        expect(result.current.state?.conn).toBe("reconnecting");

        single.mockResolvedValue(row(8));
        await wait(4000);
        expect(result.current.state).toEqual({ live: 8, viewing: 8, following: true, conn: "live", ended: false });

        // Nothing is left to retry: the next read is the 20 second check.
        const done = single.mock.calls.length;
        await wait(19999);
        expect(single.mock.calls.length).toBe(done);
        await wait(1);
        expect(single.mock.calls.length).toBe(done + 1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("waits no longer than 10 seconds between retries", async () => {
      vi.useFakeTimers();
      try {
        await dropAndFailOnce();
        for (const delay of [1000, 2000, 4000, 8000, 10000, 10000]) {
          const before = single.mock.calls.length;
          await wait(delay - 1);
          expect(single.mock.calls.length).toBe(before);
          await wait(1);
          expect(single.mock.calls.length).toBe(before + 1);
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it("treats a read that throws like a failed read", async () => {
      vi.useFakeTimers();
      try {
        const { result } = await dropAndFailOnce();
        single.mockRejectedValue(new TypeError("Failed to fetch"));
        await wait(1000);
        expect(result.current.state?.conn).toBe("reconnecting");
        single.mockResolvedValue(row(5));
        await wait(2000);
        expect(result.current.state).toMatchObject({ conn: "live", viewing: 5 });
      } finally {
        vi.useRealTimers();
      }
    });

    it("stops retrying when it unmounts", async () => {
      vi.useFakeTimers();
      try {
        const { unmount } = await dropAndFailOnce();
        unmount();
        const calls = single.mock.calls.length;
        await wait(60000);
        expect(single.mock.calls.length).toBe(calls);
      } finally {
        vi.useRealTimers();
      }
    });

    it("shows nothing but keeps trying when the very first read fails", async () => {
      vi.useFakeTimers();
      try {
        single.mockResolvedValue(failed);
        const { result } = renderHook(() => useLiveLecture(LECTURE));
        await act(async () => {});
        expect(result.current.state).toBeNull();
        single.mockResolvedValue(row(4));
        await wait(1000);
        expect(result.current.state).toMatchObject({ live: 4, viewing: 4, conn: "live" });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("while the lecture is live, it checks again", () => {
    const wait = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    async function started() {
      const hook = renderHook(() => useLiveLecture(LECTURE, 3));
      await wait(0);
      return { ...hook, reads: single.mock.calls.length };
    }

    it("every 20 seconds, and ends when that read finds the lecture ended", async () => {
      const { result, reads } = await started();
      await wait(19999);
      expect(single.mock.calls.length).toBe(reads);
      single.mockResolvedValue(row(3, "ended"));
      await wait(1);
      expect(single.mock.calls.length).toBe(reads + 1);
      expect(result.current.state?.ended).toBe(true);
    });

    it("every 20 seconds, with one small read of current_slide and status, following a slide the channel missed", async () => {
      const { result, reads } = await started();
      single.mockResolvedValue(row(5));
      await wait(20000);
      expect(single.mock.calls.length).toBe(reads + 1);
      expect(select).toHaveBeenLastCalledWith("current_slide, status");
      expect(result.current.state).toMatchObject({ live: 5, viewing: 5, ended: false });
      await wait(20000);
      expect(single.mock.calls.length).toBe(reads + 2);
    });

    it("counts the 20 seconds from the last read", async () => {
      const { reads } = await started();
      await wait(15000);
      await act(async () => channel.status?.("SUBSCRIBED"));
      expect(single.mock.calls.length).toBe(reads + 1);
      await wait(19999);
      expect(single.mock.calls.length).toBe(reads + 1);
      await wait(1);
      expect(single.mock.calls.length).toBe(reads + 2);
    });

    it("when the page becomes visible, and ends when that read finds the lecture ended", async () => {
      const { result, reads } = await started();
      single.mockResolvedValue(row(3, "ended"));
      setVisibility("hidden");
      await act(async () => document.dispatchEvent(new Event("visibilitychange")));
      expect(single.mock.calls.length).toBe(reads);
      setVisibility("visible");
      await act(async () => document.dispatchEvent(new Event("visibilitychange")));
      expect(single.mock.calls.length).toBe(reads + 1);
      expect(result.current.state?.ended).toBe(true);
    });

    it.each(["focus", "online"])("on window %s", async (event) => {
      const { result, reads } = await started();
      single.mockResolvedValue(row(3, "ended"));
      await act(async () => window.dispatchEvent(new Event(event)));
      expect(single.mock.calls.length).toBe(reads + 1);
      expect(result.current.state?.ended).toBe(true);
    });

    it("once only when focus and visible come together", async () => {
      const { reads } = await started();
      let finish: (v: unknown) => void = () => {};
      single.mockReturnValue(new Promise((r) => (finish = r)));
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("focus"));
      });
      expect(single.mock.calls.length).toBe(reads + 1);
      await act(async () => finish(row(3)));
    });

    it("when asked to (recheck), and ends when that read finds the lecture ended", async () => {
      const { result, reads } = await started();
      single.mockResolvedValue(row(3, "ended"));
      await act(async () => result.current.recheck());
      expect(single.mock.calls.length).toBe(reads + 1);
      expect(result.current.state?.ended).toBe(true);
    });

    it("never once it has ended", async () => {
      const { result } = await started();
      act(() => channel.update?.({ new: { current_slide: 3, status: "ended" } }));
      expect(result.current.state?.ended).toBe(true);
      const reads = single.mock.calls.length;
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new Event("online"));
        result.current.recheck();
      });
      await wait(60000);
      expect(single.mock.calls.length).toBe(reads);
    });

    it("never after it unmounts", async () => {
      const { unmount } = await started();
      unmount();
      const reads = single.mock.calls.length;
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new Event("online"));
      });
      await wait(60000);
      expect(single.mock.calls.length).toBe(reads);
    });

    it("keeps checking when a read never comes back", async () => {
      const { result, reads } = await started();
      single.mockReturnValueOnce(new Promise(() => {}));
      await wait(20000);
      expect(single.mock.calls.length).toBe(reads + 1);
      // Focus a few seconds later waits for that read; 20 seconds on, a new read goes out.
      await act(async () => window.dispatchEvent(new Event("focus")));
      expect(single.mock.calls.length).toBe(reads + 1);
      single.mockResolvedValue(row(3, "ended"));
      await wait(20000);
      expect(single.mock.calls.length).toBe(reads + 2);
      expect(result.current.state?.ended).toBe(true);
    });

    it("a read that started before a Realtime slide change does not take the slide back", async () => {
      const { result } = await started();
      let finish: (v: unknown) => void = () => {};
      single.mockReturnValueOnce(new Promise((r) => (finish = r)));
      await act(async () => window.dispatchEvent(new Event("focus")));
      act(() => channel.update?.({ new: { current_slide: 5, status: "live" } }));
      await act(async () => finish(row(4)));
      expect(result.current.state).toMatchObject({ live: 5, viewing: 5 });
    });

    it("the read after the channel comes back keeps a newer Realtime slide and still says live", async () => {
      const { result } = await started();
      act(() => channel.status?.("CHANNEL_ERROR"));
      let finish: (v: unknown) => void = () => {};
      single.mockReturnValueOnce(new Promise((r) => (finish = r)));
      await act(async () => channel.status?.("SUBSCRIBED"));
      act(() => channel.update?.({ new: { current_slide: 5, status: "live" } }));
      await act(async () => finish(row(4)));
      expect(result.current.state).toMatchObject({ live: 5, viewing: 5, conn: "live" });
    });

    it("while the channel is down, the 20 second check updates live but keeps Reconnecting and the student's place", async () => {
      const { result } = await started();
      act(() => result.current.back());
      act(() => channel.status?.("CHANNEL_ERROR"));
      single.mockResolvedValue(row(6));
      await wait(20000);
      expect(result.current.state).toMatchObject({ live: 6, viewing: 2, following: false, conn: "reconnecting" });
      // The channel coming back is what says live again and jumps to the live slide.
      await act(async () => channel.status?.("SUBSCRIBED"));
      expect(result.current.state).toMatchObject({ live: 6, viewing: 6, following: true, conn: "live" });
    });

    it("a failed 20 second check with the channel up shows Reconnecting, and the next good read says live without moving a student who went back", async () => {
      const { result } = await started();
      act(() => result.current.back());
      single.mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch" } });
      await wait(20000);
      expect(result.current.state).toMatchObject({ viewing: 2, following: false, conn: "reconnecting" });
      // The retry a second later works: live again, and the student stays on slide 2.
      single.mockResolvedValue(row(5));
      await wait(1000);
      expect(result.current.state).toEqual({ live: 5, viewing: 2, following: false, conn: "live", ended: false });
      // Later reads keep them there too.
      single.mockResolvedValue(row(6));
      await wait(20000);
      expect(result.current.state).toEqual({ live: 6, viewing: 2, following: false, conn: "live", ended: false });
    });

    it("a failed check followed by the channel dropping still jumps to live once the channel is back", async () => {
      const { result } = await started();
      act(() => result.current.back());
      single.mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch" } });
      await wait(20000);
      act(() => channel.status?.("CHANNEL_ERROR"));
      single.mockResolvedValue(row(7));
      await act(async () => channel.status?.("SUBSCRIBED"));
      expect(result.current.state).toMatchObject({ live: 7, viewing: 7, following: true, conn: "live" });
    });

    it("keeps the newest read when an older one comes back last", async () => {
      const { result } = await started();
      let older: (v: unknown) => void = () => {};
      let newer: (v: unknown) => void = () => {};
      single.mockReturnValueOnce(new Promise((r) => (older = r))).mockReturnValueOnce(new Promise((r) => (newer = r)));
      await act(async () => channel.status?.("SUBSCRIBED"));
      await act(async () => channel.status?.("SUBSCRIBED"));
      await act(async () => newer(row(6)));
      await act(async () => older(row(4)));
      expect(result.current.state).toMatchObject({ live: 6, viewing: 6 });
    });

    it("adds no second channel", async () => {
      await started();
      await act(async () => document.dispatchEvent(new Event("visibilitychange")));
      await wait(40000);
      expect(makeChannel).toHaveBeenCalledTimes(1);
    });
  });
});
