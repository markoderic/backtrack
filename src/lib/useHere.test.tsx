import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

type Cb = (payload: unknown) => void;
/** A fake Realtime channel per topic, so the here channel and the lecture channel stay apart. */
function fakeChannel(topic: string) {
  const ch = {
    topic: `realtime:${topic}`,
    handlers: {} as Record<string, Cb>,
    status: null as ((s: string) => void) | null,
    presence: {} as Record<string, unknown[]>,
    on: vi.fn((type: string, filter: { event?: string }, cb: Cb) => {
      ch.handlers[type === "postgres_changes" ? `pg:${filter.event}` : type] = cb;
      return ch;
    }),
    subscribe: vi.fn((cb: (s: string) => void) => {
      ch.status = cb;
      return ch;
    }),
    track: vi.fn(async () => "ok"),
    presenceState: vi.fn(() => ch.presence),
  };
  return ch;
}
type Fake = ReturnType<typeof fakeChannel>;

const h = vi.hoisted(() => ({
  channels: [] as unknown[],
  open: [] as { topic: string }[],
  makeChannel: vi.fn(),
  removeChannel: vi.fn(),
  setAuth: vi.fn(async () => {}),
  single: vi.fn(),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({
    channel: (name: string, ...rest: unknown[]) => {
      h.makeChannel(name, ...rest);
      const ch = fakeChannel(name);
      h.channels.push(ch);
      return ch;
    },
    getChannels: () => h.open,
    removeChannel: h.removeChannel,
    realtime: { setAuth: h.setAuth },
    from: () => ({ select: () => ({ eq: () => ({ single: h.single }) }) }),
  }),
}));

import { useHereCount, useTrackHere, hereChannel, reopenDelay, TRACK_SPREAD_MS } from "./useHere";
import { useLiveLecture } from "./useLiveLecture";

const LECTURE = "11111111-1111-1111-1111-111111111111";
const flush = () => act(async () => {});
const channelFor = (name: string) => (h.channels as Fake[]).find((c) => c.topic === `realtime:${name}`);
const here = () => channelFor(`here-${LECTURE}`)!;

beforeEach(() => {
  vi.useFakeTimers();
  h.channels = [];
  h.open = [];
  [h.makeChannel, h.removeChannel, h.setAuth].forEach((m) => m.mockClear());
  h.single.mockReset().mockResolvedValue({ data: { current_slide: 3, status: "live", slide_version: 1 }, error: null });
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useTrackHere (a student on the live lecture page)", () => {
  it("waits a random 0 to 3 s, then tracks an empty payload on here-<id>, with no key of its own", async () => {
    renderHook(() => useTrackHere(LECTURE, true));
    await flush();
    expect(h.makeChannel).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(0.5 * TRACK_SPREAD_MS - 1));
    expect(h.makeChannel).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    await flush();
    expect(h.makeChannel).toHaveBeenCalledTimes(1);
    // Only the topic: no presence key (the server picks one), nothing else in the config.
    expect(h.makeChannel.mock.calls[0]).toEqual([hereChannel(LECTURE)]);
    expect(here().track).not.toHaveBeenCalled();
    await act(async () => here().status!("SUBSCRIBED"));
    expect(here().track).toHaveBeenCalledTimes(1);
    expect(here().track).toHaveBeenCalledWith({});
    // It binds no presence listener.
    expect(here().on.mock.calls.map((c) => c[0])).not.toContain("presence");
  });

  it("tracks again after a rejoin", async () => {
    renderHook(() => useTrackHere(LECTURE, true));
    await act(async () => vi.advanceTimersByTime(TRACK_SPREAD_MS));
    await flush();
    await act(async () => here().status!("SUBSCRIBED"));
    act(() => here().status!("CHANNEL_ERROR"));
    await act(async () => here().status!("SUBSCRIBED"));
    expect(here().track).toHaveBeenCalledTimes(2);
  });

  it("stops tracking for good after a system error (a presence limit)", async () => {
    renderHook(() => useTrackHere(LECTURE, true));
    await act(async () => vi.advanceTimersByTime(TRACK_SPREAD_MS));
    await flush();
    await act(async () => here().status!("SUBSCRIBED"));
    act(() => here().handlers.system({ status: "error", message: "Too many presence messages per second", extension: "system" }));
    await act(async () => here().status!("SUBSCRIBED"));
    expect(here().track).toHaveBeenCalledTimes(1);
  });

  it("does nothing when not enabled, and closes its channel when it unmounts", async () => {
    const off = renderHook(() => useTrackHere(LECTURE, false));
    await act(async () => vi.advanceTimersByTime(TRACK_SPREAD_MS));
    expect(h.makeChannel).not.toHaveBeenCalled();
    off.unmount();
    const on = renderHook(() => useTrackHere(LECTURE, true));
    await act(async () => vi.advanceTimersByTime(TRACK_SPREAD_MS));
    await flush();
    on.unmount();
    expect(h.removeChannel).toHaveBeenCalledWith(here());
  });

  it("opens nothing when it unmounts during its random wait", async () => {
    const { unmount } = renderHook(() => useTrackHere(LECTURE, true));
    unmount();
    await act(async () => vi.advanceTimersByTime(TRACK_SPREAD_MS));
    expect(h.makeChannel).not.toHaveBeenCalled();
  });

  it("keeps the slide updates flowing when the here channel errors and closes", async () => {
    const { result } = renderHook(() => {
      useTrackHere(LECTURE, true);
      return useLiveLecture(LECTURE, 3);
    });
    await act(async () => vi.advanceTimersByTime(TRACK_SPREAD_MS));
    await flush();
    const slides = channelFor(`lecture-${LECTURE}`)!;
    expect(slides).toBeDefined();
    expect(slides).not.toBe(here());
    await act(async () => slides.status!("SUBSCRIBED"));
    await act(async () => here().status!("SUBSCRIBED"));
    // The server refuses presence and closes the here channel.
    act(() => here().handlers.system({ status: "error", message: "Too many presence messages per second" }));
    act(() => here().status!("CLOSED"));
    expect(h.removeChannel).not.toHaveBeenCalledWith(slides);
    act(() => slides.handlers["pg:UPDATE"]({ new: { current_slide: 4, status: "live", slide_version: 2 } }));
    expect(result.current.state).toMatchObject({ live: 4, conn: "live" });
  });
});

describe("useHereCount (the projector and the data view)", () => {
  it("listens to presence on here-<id>, is never tracked itself, and counts the keys", async () => {
    const { result } = renderHook(() => useHereCount(LECTURE, true));
    await flush();
    expect(h.makeChannel.mock.calls[0]).toEqual([hereChannel(LECTURE)]);
    expect(here().on.mock.calls[0][0]).toBe("presence");
    expect(result.current).toBeNull();
    here().presence = { a: [{}], b: [{}], c: [{}] };
    act(() => here().handlers.presence(undefined));
    expect(result.current).toBe(3);
    here().presence = { a: [{}] };
    act(() => here().handlers.presence(undefined));
    expect(result.current).toBe(1);
    await act(async () => here().status!("SUBSCRIBED"));
    expect(here().track).not.toHaveBeenCalled();
  });

  it("goes back to null while the channel is down", async () => {
    const { result } = renderHook(() => useHereCount(LECTURE, true));
    await flush();
    here().presence = { a: [{}] };
    act(() => here().handlers.presence(undefined));
    act(() => here().status!("CHANNEL_ERROR"));
    expect(result.current).toBeNull();
  });

  it("opens nothing when not enabled (a lecture that ended)", async () => {
    const { result } = renderHook(() => useHereCount(LECTURE, false));
    await flush();
    expect(h.makeChannel).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it("waits for a same-topic channel that is still closing (the projector it came from) before opening its own", async () => {
    h.open = [{ topic: `realtime:here-${LECTURE}` }];
    renderHook(() => useHereCount(LECTURE, true));
    await flush();
    expect(h.makeChannel).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(250));
    expect(h.makeChannel).not.toHaveBeenCalled();
    h.open = [];
    await act(async () => vi.advanceTimersByTime(250));
    await flush();
    expect(h.makeChannel).toHaveBeenCalledTimes(1);
  });

  it("gives up after 5 seconds if that channel never goes, and stays null", async () => {
    h.open = [{ topic: `realtime:here-${LECTURE}` }];
    const { result } = renderHook(() => useHereCount(LECTURE, true));
    await act(async () => vi.advanceTimersByTime(10000));
    expect(h.makeChannel).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it("removes its channel when it unmounts, and ignores a sync after that", async () => {
    const { result, unmount } = renderHook(() => useHereCount(LECTURE, true));
    await flush();
    unmount();
    expect(h.removeChannel).toHaveBeenCalledWith(here());
    here().presence = { a: [{}] };
    here().handlers.presence(undefined);
    expect(result.current).toBeNull();
  });

  it("opens a new channel with a growing wait after the server closes it, and counts again", async () => {
    const { result } = renderHook(() => useHereCount(LECTURE, true));
    await flush();
    const first = here();
    first.presence = { a: [{}], b: [{}] };
    act(() => first.handlers.presence(undefined));
    expect(result.current).toBe(2);
    // One moment over a presence limit: the server closes the channel.
    act(() => first.status!("CLOSED"));
    expect(result.current).toBeNull();
    expect(h.removeChannel).toHaveBeenCalledWith(first);
    // 2 s times 0.75 (Math.random is 0.5 here).
    await act(async () => vi.advanceTimersByTime(1499));
    expect(h.makeChannel).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    await flush();
    expect(h.makeChannel).toHaveBeenCalledTimes(2);
    const second = h.channels[1] as Fake;
    expect(second.topic).toBe(`realtime:here-${LECTURE}`);
    second.presence = { a: [{}], b: [{}], c: [{}] };
    act(() => second.handlers.presence(undefined));
    expect(result.current).toBe(3);
    // The old channel's late callbacks change nothing.
    first.presence = {};
    act(() => first.handlers.presence(undefined));
    expect(result.current).toBe(3);
  });

  it("waits longer after each close in a row, at most a minute, and starts over after a count", async () => {
    renderHook(() => useHereCount(LECTURE, true));
    await flush();
    const closeLatest = () => act(() => (h.channels[h.channels.length - 1] as Fake).status!("CLOSED"));
    const waitFor = async (ms: number) => {
      const before = h.makeChannel.mock.calls.length;
      await act(async () => vi.advanceTimersByTime(ms - 1));
      expect(h.makeChannel.mock.calls.length).toBe(before);
      await act(async () => vi.advanceTimersByTime(1));
      await flush();
      expect(h.makeChannel.mock.calls.length).toBe(before + 1);
    };
    closeLatest();
    await waitFor(1500);
    closeLatest();
    await waitFor(3000);
    closeLatest();
    await waitFor(6000);
    // A sync: the next close waits 2 s (times 0.75) again.
    const latest = h.channels[h.channels.length - 1] as Fake;
    act(() => latest.handlers.presence(undefined));
    closeLatest();
    await waitFor(1500);
  });

  it("the wait never goes past a minute", () => {
    expect(reopenDelay(0, 1)).toBe(2000);
    expect(reopenDelay(3, 1)).toBe(16000);
    expect(reopenDelay(10, 1)).toBe(60000);
    expect(reopenDelay(10, 0)).toBe(30000);
  });

  it("does not open again after it unmounts during the wait", async () => {
    const { unmount } = renderHook(() => useHereCount(LECTURE, true));
    await flush();
    act(() => here().status!("CLOSED"));
    unmount();
    await act(async () => vi.advanceTimersByTime(120000));
    expect(h.makeChannel).toHaveBeenCalledTimes(1);
  });

  it("a channel error or timeout is left to realtime-js to rejoin (no second channel)", async () => {
    renderHook(() => useHereCount(LECTURE, true));
    await flush();
    act(() => here().status!("CHANNEL_ERROR"));
    act(() => here().status!("TIMED_OUT"));
    await act(async () => vi.advanceTimersByTime(120000));
    expect(h.makeChannel).toHaveBeenCalledTimes(1);
  });
});

