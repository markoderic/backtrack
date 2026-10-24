import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyMarkOp, MarkQueue, type LiveMark, type MarkOp, type MarkSendResult } from "./markQueue";
import { THROTTLED_TRIES } from "./tapQueue";

const LECTURE = "11111111-1111-1111-1111-111111111111";
const KEY = `backtrack:marks:${LECTURE}`;
const RECT = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
const mark = (id: string, slide = 7, over: Partial<LiveMark> = {}): LiveMark => ({ id, slide, rect: RECT, kind: "save", ...over });
type Send = (op: MarkOp) => Promise<MarkSendResult>;

beforeEach(() => {
  localStorage.clear();
});

describe("MarkQueue", () => {
  it("keeps changes in order in localStorage, so a mark made offline survives a reload", async () => {
    const q = new MarkQueue(LECTURE);
    q.add(mark("a"));
    q.kind(7, "lost");
    expect(new MarkQueue(LECTURE).pending()).toEqual([
      { op: "add", mark: { ...mark("a"), kind: "lost" } },
      { op: "kind", slide: 7, kind: "lost" },
    ]);
  });

  it("sends one at a time, removes what went, and stops at offline", async () => {
    const q = new MarkQueue(LECTURE);
    q.add(mark("a"));
    q.add(mark("b"));
    const send = vi.fn<Send>().mockResolvedValueOnce("ok").mockResolvedValueOnce("offline");
    const res = await q.flush(send);
    expect(res.sent).toEqual([{ op: "add", mark: mark("a") }]);
    expect(q.pending()).toEqual([{ op: "add", mark: mark("b") }]);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toHaveLength(1);
  });

  it("a note typed in bursts is one op, and a note on a mark not sent yet goes into its add", () => {
    const q = new MarkQueue(LECTURE);
    q.add(mark("a"));
    q.note("a", "h");
    q.note("a", "hello");
    expect(q.pending()).toEqual([{ op: "add", mark: { ...mark("a"), note: "hello" } }]);
    q.note("b", "x");
    q.note("b", "xy");
    expect(q.pending().filter((o) => o.op === "note")).toEqual([{ op: "note", id: "b", note: "xy" }]);
  });

  it("a mark deleted before it was sent is simply taken out; one already sent gets a delete", () => {
    const q = new MarkQueue(LECTURE);
    q.add(mark("a"));
    q.note("a", "x");
    q.delete("a");
    expect(q.pending()).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
    q.note("b", "x");
    q.delete("b");
    expect(q.pending()).toEqual([{ op: "delete", id: "b" }]);
  });

  it("a mark being sent right now can not be taken out: its delete and note go after it", async () => {
    const q = new MarkQueue(LECTURE);
    q.add(mark("a"));
    let finish: (r: MarkSendResult) => void = () => {};
    const send = vi.fn<Send>((op) => (op.op === "add" ? new Promise((r) => (finish = r)) : Promise.resolve("ok")));
    const run = q.flush(send);
    await Promise.resolve();
    await Promise.resolve();
    q.note("a", "late");
    q.delete("a");
    finish("ok");
    await run;
    expect(send.mock.calls.map((c) => c[0].op)).toEqual(["add", "delete"]);
  });

  it("a slide's kind changes the adds still waiting and replaces an older kind op for that slide", () => {
    const q = new MarkQueue(LECTURE);
    q.add(mark("a", 7));
    q.add(mark("b", 8));
    q.kind(7, "lost");
    q.kind(7, "save");
    expect(q.pending()).toEqual([
      { op: "add", mark: mark("a", 7) },
      { op: "add", mark: mark("b", 8) },
      { op: "kind", slide: 7, kind: "save" },
    ]);
  });

  it("drops a refused add with everything queued for it, and reports why", async () => {
    const q = new MarkQueue(LECTURE);
    q.add(mark("a"));
    q.delete("x");
    const send = vi.fn<Send>(async (op) => (op.op === "add" ? "slide_full" : "ok"));
    const res = await q.flush(send);
    expect(res.refused).toEqual([{ op: { op: "add", mark: mark("a") }, result: "slide_full" }]);
    expect(q.pending()).toEqual([]);
  });

  it("waits after a throttled op and drops it after a few tries", async () => {
    vi.useFakeTimers();
    try {
      const q = new MarkQueue(LECTURE);
      q.add(mark("a"));
      const send = vi.fn<Send>(async () => "throttled");
      const first = await q.flush(send);
      expect(first.retryIn).toBeGreaterThan(0);
      for (let i = 1; i < THROTTLED_TRIES; i++) {
        vi.advanceTimersByTime(60_000);
        await q.flush(send);
      }
      expect(send).toHaveBeenCalledTimes(THROTTLED_TRIES);
      expect(q.pending()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores what it can not read in storage", () => {
    localStorage.setItem(KEY, JSON.stringify([{ op: "add", mark: { id: "a" } }, { op: "kind", slide: 2, kind: "lost" }, "x"]));
    expect(new MarkQueue(LECTURE).pending()).toEqual([{ op: "kind", slide: 2, kind: "lost" }]);
    localStorage.setItem(KEY, "{");
    expect(new MarkQueue(LECTURE).pending()).toEqual([]);
  });
});

describe("MarkQueue and another page (batch K2: My spots sends what the live screen left)", () => {
  const ok = () => vi.fn<(op: MarkOp) => Promise<MarkSendResult>>(async () => "ok");

  it("never sends again an op another page sent meanwhile (a mark deleted in My spots does not come back)", async () => {
    const live = new MarkQueue(LECTURE);
    live.add(mark("a"));
    // My spots (its own queue on the same key) sends it, then the student deletes the mark there.
    const spots = new MarkQueue(LECTURE);
    await spots.flush(ok());
    spots.delete("a");
    await spots.flush(ok());
    expect(localStorage.getItem(KEY)).toBeNull();
    // Back on the live screen (kept alive, hidden): nothing left to send.
    expect(live.pending()).toEqual([]);
    const send = ok();
    await live.flush(send);
    expect(send).not.toHaveBeenCalled();
  });

  it("takes ops another page added, and keeps its own changes on top", async () => {
    const live = new MarkQueue(LECTURE);
    const spots = new MarkQueue(LECTURE);
    spots.add(mark("b", 4));
    live.add(mark("c", 5));
    expect(live.pending().map((o) => (o.op === "add" ? o.mark.id : o.op))).toEqual(["b", "c"]);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toHaveLength(2);
  });

  it("with storage blocked it works from memory and never drops its own ops", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    const q = new MarkQueue(LECTURE);
    q.add(mark("d"));
    expect(q.pending()).toHaveLength(1);
    const send = ok();
    await q.flush(send);
    expect(send).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});

describe("applyMarkOp", () => {
  it("adds, notes, deletes and turns a slide's marks red or yellow", () => {
    const m = new Map<string, LiveMark>();
    applyMarkOp(m, { op: "add", mark: mark("a", 7) });
    applyMarkOp(m, { op: "add", mark: mark("b", 8) });
    applyMarkOp(m, { op: "note", id: "a", note: "why" });
    applyMarkOp(m, { op: "kind", slide: 7, kind: "lost" });
    expect(m.get("a")).toEqual({ ...mark("a", 7), note: "why", kind: "lost" });
    expect(m.get("b")?.kind).toBe("save");
    applyMarkOp(m, { op: "note", id: "a", note: "  " });
    expect(m.get("a")).not.toHaveProperty("note");
    applyMarkOp(m, { op: "delete", id: "a" });
    expect([...m.keys()]).toEqual(["b"]);
  });
});
