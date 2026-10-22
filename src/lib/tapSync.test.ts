import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushLeftoverTaps, rejectedKey } from "./tapSync";
import type { QueueOp, SendResult } from "./tapQueue";

const LECTURE = "11111111-1111-1111-1111-111111111111";
const QUEUE_KEY = `backtrack:queue:${LECTURE}`;
const tap = (n: number) => ({
  id: `00000000-0000-0000-0000-00000000000${n}`,
  tappedOnSlide: n,
  tappedAt: "2026-10-26T14:00:00.000Z",
});
const leave = (...ops: QueueOp[]) => localStorage.setItem(QUEUE_KEY, JSON.stringify(ops));
const send = (result: SendResult) => vi.fn<(op: QueueOp) => Promise<SendResult>>(async () => result);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("flushLeftoverTaps", () => {
  it("names the rejected key per lecture", () => {
    expect(rejectedKey(LECTURE)).toBe(`backtrack:rejected:${LECTURE}`);
  });

  it("sends the ops a closed page left in localStorage and empties the queue", async () => {
    leave({ op: "insert", tap: tap(3) }, { op: "update", id: tap(3).id, patch: { note: "x" } });
    const s = send("ok");
    expect(await flushLeftoverTaps(LECTURE, s)).toEqual({ sent: 2, rejected: [] });
    expect(s.mock.calls.map((c) => c[0].op)).toEqual(["insert", "update"]);
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "null")).toEqual([]);
    expect(sessionStorage.getItem(rejectedKey(LECTURE))).toBeNull();
  });

  it("sets backtrack:rejected:<lectureId> when an op is rejected", async () => {
    leave({ op: "insert", tap: tap(3) });
    const result = await flushLeftoverTaps(LECTURE, send("rejected"));
    expect(result.rejected).toHaveLength(1);
    expect(sessionStorage.getItem(`backtrack:rejected:${LECTURE}`)).toBe("1");
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "null")).toEqual([]);
  });

  it.each(["limited", "capped"] as const)("drops a %s tap without the lecture had ended note", async (r) => {
    leave({ op: "insert", tap: tap(3) });
    const result = await flushLeftoverTaps(LECTURE, send(r));
    expect(result.rejected).toHaveLength(1);
    expect(sessionStorage.getItem(rejectedKey(LECTURE))).toBeNull();
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "null")).toEqual([]);
  });

  it("still notes a real refusal next to a limited one", async () => {
    leave({ op: "insert", tap: tap(3) }, { op: "insert", tap: tap(4) });
    const s = vi.fn<(op: QueueOp) => Promise<SendResult>>().mockResolvedValueOnce("limited").mockResolvedValueOnce("rejected");
    await flushLeftoverTaps(LECTURE, s);
    expect(sessionStorage.getItem(rejectedKey(LECTURE))).toBe("1");
  });

  it("leaves the ops queued when still offline", async () => {
    leave({ op: "insert", tap: tap(3) });
    expect(await flushLeftoverTaps(LECTURE, send("offline"))).toEqual({ sent: 0, rejected: [] });
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]")).toHaveLength(1);
  });

  it("leaves the ops queued, with no note, when the server turns them away for now (401 or 429)", async () => {
    leave({ op: "insert", tap: tap(3) });
    const result = await flushLeftoverTaps(LECTURE, send("throttled"));
    expect(result).toMatchObject({ sent: 0, rejected: [], retryIn: 2000 });
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]")).toHaveLength(1);
    expect(sessionStorage.getItem(rejectedKey(LECTURE))).toBeNull();
  });

  it("does nothing for a lecture with no leftovers", async () => {
    const s = send("ok");
    expect(await flushLeftoverTaps(LECTURE, s)).toEqual({ sent: 0, rejected: [] });
    expect(s).not.toHaveBeenCalled();
  });

  it("still reports a rejection when sessionStorage throws", async () => {
    leave({ op: "insert", tap: tap(3) });
    const spy = vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      const result = await flushLeftoverTaps(LECTURE, send("rejected"));
      expect(result.rejected).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});
