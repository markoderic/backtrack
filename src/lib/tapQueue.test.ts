import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { TapQueue, THROTTLED_TRIES, throttledDelay, type PendingTap, type QueueOp, type SendResult } from "./tapQueue";

const LECTURE = "11111111-1111-1111-1111-111111111111";
const KEY = `backtrack:queue:${LECTURE}`;

const tap = (n: number, extra: Partial<PendingTap> = {}): PendingTap => ({
  id: `00000000-0000-0000-0000-00000000000${n}`,
  tappedOnSlide: n,
  tappedAt: "2026-10-26T14:00:00.000Z",
  ...extra,
});
const sender = (...results: SendResult[]) => {
  const send = vi.fn<(op: QueueOp) => Promise<SendResult>>(async () => results.shift() ?? "ok");
  return send;
};

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("TapQueue", () => {
  it("keeps the tap when the send is offline", async () => {
    const q = new TapQueue(LECTURE);
    q.enqueue(tap(3));
    const result = await q.flush(sender("offline"));
    expect(result).toEqual({ sent: 0, rejected: [] });
    expect(q.pending()).toEqual([{ op: "insert", tap: tap(3) }]);
  });

  it("empties the queue when the send is ok and counts what it sent", async () => {
    const q = new TapQueue(LECTURE);
    q.enqueue(tap(3));
    q.enqueue(tap(4));
    const send = sender();
    const result = await q.flush(send);
    expect(result).toEqual({ sent: 2, rejected: [] });
    expect(q.pending()).toEqual([]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("returns a rejected op in rejected and removes it", async () => {
    const q = new TapQueue(LECTURE);
    q.enqueue(tap(3));
    const result = await q.flush(sender("rejected"));
    expect(result).toEqual({ sent: 0, rejected: [{ op: "insert", tap: tap(3) }] });
    expect(q.pending()).toEqual([]);
  });

  it("goes on past a rejected op to the next one", async () => {
    const q = new TapQueue(LECTURE);
    q.enqueue(tap(3));
    q.enqueue(tap(4));
    const result = await q.flush(sender("rejected", "ok"));
    expect(result.sent).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(q.pending()).toEqual([]);
  });

  it("drops the queued updates of an insert that was rejected", async () => {
    const q = new TapQueue(LECTURE);
    q.enqueue(tap(3));
    q.update(tap(3).id, { note: "hello" });
    const send = sender("rejected");
    const result = await q.flush(send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.rejected).toEqual([{ op: "insert", tap: tap(3) }]);
    expect(q.pending()).toEqual([]);
  });

  it("stops at the first offline so order is kept", async () => {
    const q = new TapQueue(LECTURE);
    q.enqueue(tap(3));
    q.enqueue(tap(4));
    const send = sender("ok", "offline");
    const result = await q.flush(send);
    expect(result.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(q.pending()).toEqual([{ op: "insert", tap: tap(4) }]);
  });

  describe("throttled sends (401 or 429)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("waits 2, 4 then 8 seconds between tries and sends nothing before the wait is over", async () => {
      vi.useFakeTimers();
      const q = new TapQueue(LECTURE);
      q.enqueue(tap(3));
      const send = sender("throttled", "throttled", "throttled");
      expect(await q.flush(send)).toEqual({ sent: 0, rejected: [], retryIn: 2000 });
      vi.advanceTimersByTime(1500);
      expect(await q.flush(send)).toEqual({ sent: 0, rejected: [], retryIn: 500 });
      expect(send).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(500);
      expect((await q.flush(send)).retryIn).toBe(4000);
      vi.advanceTimersByTime(4000);
      expect((await q.flush(send)).retryIn).toBe(8000);
      expect(send).toHaveBeenCalledTimes(3);
      expect(q.pending()).toEqual([{ op: "insert", tap: tap(3) }]);
      expect(THROTTLED_TRIES).toBe(4);
      expect(throttledDelay(10)).toBe(30000);
    });

    it("drops the op (and its queued updates) after the last try, and sends the taps behind it", async () => {
      vi.useFakeTimers();
      const q = new TapQueue(LECTURE);
      q.enqueue(tap(3));
      q.update(tap(3).id, { note: "hello" });
      q.enqueue(tap(4));
      const send = sender("throttled", "throttled", "throttled", "throttled", "ok");
      for (const wait of [2000, 4000, 8000]) {
        expect((await q.flush(send)).retryIn).toBe(wait);
        vi.advanceTimersByTime(wait);
      }
      const result = await q.flush(send);
      expect(result).toEqual({ sent: 1, rejected: [], gaveUp: [{ op: "insert", tap: tap(3) }] });
      expect(send.mock.calls.map((c) => c[0])).toEqual([
        ...Array(4).fill({ op: "insert", tap: tap(3) }),
        { op: "insert", tap: tap(4) },
      ]);
      expect(q.pending()).toEqual([]);
      expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toEqual([]);
    });

    it("sends a throttled op normally once the server takes it, then the rest", async () => {
      vi.useFakeTimers();
      const q = new TapQueue(LECTURE);
      q.enqueue(tap(3));
      q.enqueue(tap(4));
      const send = sender("throttled", "ok", "ok");
      expect((await q.flush(send)).retryIn).toBe(2000);
      vi.advanceTimersByTime(2000);
      expect(await q.flush(send)).toEqual({ sent: 2, rejected: [] });
      expect(q.pending()).toEqual([]);
    });
  });

  it("sends an update queued behind an offline insert after it, never before", async () => {
    const q = new TapQueue(LECTURE);
    q.enqueue(tap(3));
    q.update(tap(3).id, { undone: true });
    const first = sender("offline");
    await q.flush(first);
    expect(first.mock.calls.map((c) => c[0].op)).toEqual(["insert"]);
    const second = sender();
    await q.flush(second);
    expect(second.mock.calls.map((c) => c[0])).toEqual([
      { op: "insert", tap: tap(3) },
      { op: "update", id: tap(3).id, patch: { undone: true } },
    ]);
    expect(q.pending()).toEqual([]);
  });

  it("cancel on an unsent insert returns true, removes its updates and the next flush sends nothing", async () => {
    const q = new TapQueue(LECTURE);
    q.enqueue(tap(3));
    q.update(tap(3).id, { note: "x" });
    q.enqueue(tap(4));
    expect(q.cancel(tap(3).id)).toBe(true);
    const send = sender();
    const result = await q.flush(send);
    expect(send.mock.calls.map((c) => c[0])).toEqual([{ op: "insert", tap: tap(4) }]);
    expect(result.sent).toBe(1);
  });

  it("cancel with nothing queued sends nothing", async () => {
    const q = new TapQueue(LECTURE);
    q.enqueue(tap(3));
    expect(q.cancel(tap(3).id)).toBe(true);
    const send = sender();
    await q.flush(send);
    expect(send).not.toHaveBeenCalled();
  });

  it("cancel on a tap that was already sent returns false", async () => {
    const q = new TapQueue(LECTURE);
    q.enqueue(tap(3));
    await q.flush(sender());
    expect(q.cancel(tap(3).id)).toBe(false);
    expect(q.cancel("not-a-tap")).toBe(false);
  });

  it("cancel on an insert that is being sent right now returns false and leaves it queued", async () => {
    const q = new TapQueue(LECTURE);
    q.enqueue(tap(3));
    let finish: (r: SendResult) => void = () => {};
    const send = vi.fn((op: QueueOp) =>
      op.op === "insert" ? new Promise<SendResult>((resolve) => (finish = resolve)) : Promise.resolve<SendResult>("ok"),
    );
    const flushing = q.flush(send);
    await Promise.resolve(); // let the run start: the insert is now out
    expect(q.cancel(tap(3).id)).toBe(false);
    expect(q.pending()).toHaveLength(1);
    q.update(tap(3).id, { undone: true });
    finish("ok");
    // The same run picks up the update queued while the insert was in flight.
    expect(await flushing).toEqual({ sent: 2, rejected: [] });
    expect(send.mock.calls.map((c) => c[0].op)).toEqual(["insert", "update"]);
    expect(q.pending()).toEqual([]);
  });

  it("two flushes at once send each op once", async () => {
    const q = new TapQueue(LECTURE);
    q.enqueue(tap(3));
    const send = vi.fn(async () => "ok" as SendResult);
    await Promise.all([q.flush(send), q.flush(send)]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends a tap queued right after a flush of an empty queue started", async () => {
    const q = new TapQueue(LECTURE);
    const send = sender();
    void q.flush(send); // like the flush on mount, not awaited
    q.enqueue(tap(3));
    const result = await q.flush(send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.sent).toBe(1);
    expect(q.pending()).toEqual([]);
  });

  it("starts a new run for a tap queued after the last run finished", async () => {
    const q = new TapQueue(LECTURE);
    await q.flush(sender());
    q.enqueue(tap(3));
    const send = sender();
    await q.flush(send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends an op queued while a flush is running in the same flush", async () => {
    const q = new TapQueue(LECTURE);
    q.enqueue(tap(3));
    const seen: string[] = [];
    const send = vi.fn(async (op: QueueOp) => {
      seen.push(op.op === "insert" ? `insert ${op.tap.tappedOnSlide}` : `update`);
      if (seen.length === 1) q.enqueue(tap(4));
      return "ok" as SendResult;
    });
    const result = await q.flush(send);
    expect(seen).toEqual(["insert 3", "insert 4"]);
    expect(result.sent).toBe(2);
  });

  it("lets an error from send through and keeps the op", async () => {
    const q = new TapQueue(LECTURE);
    q.enqueue(tap(3));
    await expect(q.flush(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(q.pending()).toHaveLength(1);
    const send = sender();
    await q.flush(send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  describe("storage", () => {
    it("saves to backtrack:queue:<lectureId> and a new queue restores it", () => {
      const q = new TapQueue(LECTURE);
      q.enqueue(tap(3));
      q.update(tap(3).id, { note: "n" });
      expect(JSON.parse(localStorage.getItem(KEY) ?? "null")).toEqual([
        { op: "insert", tap: tap(3) },
        { op: "update", id: tap(3).id, patch: { note: "n" } },
      ]);
      expect(new TapQueue(LECTURE).pending()).toEqual(q.pending());
    });

    it("keeps one queue per lecture", () => {
      new TapQueue(LECTURE).enqueue(tap(3));
      expect(new TapQueue("22222222-2222-2222-2222-222222222222").pending()).toEqual([]);
    });

    it("writes the empty queue after a flush", async () => {
      const q = new TapQueue(LECTURE);
      q.enqueue(tap(3));
      await q.flush(sender());
      expect(new TapQueue(LECTURE).pending()).toEqual([]);
    });

    it("keeps working in memory when localStorage throws on every call", async () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("full");
      });
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
        throw new Error("denied");
      });
      const q = new TapQueue(LECTURE);
      q.enqueue(tap(3));
      q.update(tap(3).id, { note: "n" });
      expect(q.pending()).toHaveLength(2);
      expect(q.cancel(tap(3).id)).toBe(true);
      q.enqueue(tap(4));
      const send = sender();
      const result = await q.flush(send);
      expect(result.sent).toBe(1);
      expect(q.pending()).toEqual([]);
    });

    it("keeps working when reaching window.localStorage itself throws", () => {
      const spy = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
        throw new Error("blocked");
      });
      const q = new TapQueue(LECTURE);
      q.enqueue(tap(3));
      expect(q.pending()).toHaveLength(1);
      spy.mockRestore();
    });

    it("ignores stored data that is not a queue", () => {
      for (const bad of ["not json", "{}", "null", '[{"op":"nope"}]', '[{"op":"insert"}]']) {
        localStorage.setItem(KEY, bad);
        expect(new TapQueue(LECTURE).pending()).toEqual([]);
      }
    });

    it("keeps the valid ops among bad ones", () => {
      localStorage.setItem(KEY, JSON.stringify([{ op: "insert", tap: tap(3) }, { op: "x" }, null]));
      expect(new TapQueue(LECTURE).pending()).toEqual([{ op: "insert", tap: tap(3) }]);
    });
  });
});

describe("TapQueue highlights", () => {
  const RECT = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };

  it("keeps the kind and rect of an insert, in memory and after a reload", () => {
    const q = new TapQueue(LECTURE);
    q.enqueue(tap(3, { kind: "save", rect: RECT }));
    const want = [{ op: "insert", tap: tap(3, { kind: "save", rect: RECT }) }];
    expect(q.pending()).toEqual(want);
    expect(new TapQueue(LECTURE).pending()).toEqual(want);
  });

  it("hands the kind and rect to send", async () => {
    const q = new TapQueue(LECTURE);
    q.enqueue(tap(3, { kind: "save", rect: RECT }));
    const send = sender();
    await q.flush(send);
    expect(send).toHaveBeenCalledWith({ op: "insert", tap: tap(3, { kind: "save", rect: RECT }) });
  });

  it("keeps an update that changes the rect, in memory and after a reload", () => {
    const q = new TapQueue(LECTURE);
    q.update("abc", { rect: RECT });
    const want = [{ op: "update", id: "abc", patch: { rect: RECT } }];
    expect(q.pending()).toEqual(want);
    expect(new TapQueue(LECTURE).pending()).toEqual(want);
  });

  it("still loads an op saved before kind and rect existed", () => {
    localStorage.setItem(KEY, JSON.stringify([{ op: "insert", tap: tap(3) }, { op: "update", id: "x", patch: { undone: true } }]));
    expect(new TapQueue(LECTURE).pending()).toEqual([
      { op: "insert", tap: tap(3) },
      { op: "update", id: "x", patch: { undone: true } },
    ]);
  });

  it("drops a stored op with a bad kind or a malformed rect", () => {
    const bad = [
      { op: "insert", tap: { ...tap(3), kind: "star" } },
      { op: "insert", tap: { ...tap(4), rect: { x: 0.1, y: 0.2, w: 0.3 } } },
      { op: "insert", tap: { ...tap(5), rect: { x: 0.9, y: 0.2, w: 0.3, h: 0.1 } } },
      { op: "insert", tap: { ...tap(6), rect: "big" } },
      { op: "update", id: "x", patch: { rect: { x: -1, y: 0, w: 0.1, h: 0.1 } } },
      { op: "update", id: "x", patch: { rect: null } },
    ];
    localStorage.setItem(KEY, JSON.stringify([...bad, { op: "insert", tap: tap(7, { kind: "lost", rect: RECT }) }]));
    expect(new TapQueue(LECTURE).pending()).toEqual([{ op: "insert", tap: tap(7, { kind: "lost", rect: RECT }) }]);
  });

  it("cancel takes out a highlight insert and its rect updates", () => {
    const q = new TapQueue(LECTURE);
    const t = tap(3, { kind: "save", rect: RECT });
    q.enqueue(t);
    q.update(t.id, { rect: { x: 0, y: 0, w: 0.5, h: 0.5 } });
    expect(q.cancel(t.id)).toBe(true);
    expect(q.pending()).toEqual([]);
  });
});
