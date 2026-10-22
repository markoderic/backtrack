import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createJoinedCounter, SETTLE_MS } from "./joinedCounter";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createJoinedCounter", () => {
  it("shows what a read brings back", async () => {
    const shown: number[] = [];
    const c = createJoinedCounter(async () => 5, (n) => shown.push(n));
    await c.recount();
    expect(shown).toEqual([5]);
  });

  it("an event for a student the read already counted is one too many only until the recount", async () => {
    // The database has 5 rows, one of them the student whose event arrives after the read.
    const read = vi.fn(async () => 5);
    const shown: number[] = [];
    const c = createJoinedCounter(read, (n) => shown.push(n));
    await c.recount();
    c.joined();
    expect(shown.at(-1)).toBe(6);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(read).toHaveBeenCalledTimes(2);
    expect(shown.at(-1)).toBe(5);
  });

  it("a burst of joins is read once, after the events stop", async () => {
    let rows = 3;
    const read = vi.fn(async () => rows);
    const shown: number[] = [];
    const c = createJoinedCounter(read, (n) => shown.push(n));
    await c.recount();
    for (let i = 0; i < 4; i++) {
      rows++;
      c.joined();
      await vi.advanceTimersByTimeAsync(SETTLE_MS - 100);
    }
    expect(shown.at(-1)).toBe(7);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(2);
    expect(shown.at(-1)).toBe(7);
  });

  it("drops a read that a join event overtook, so the number never steps back while students join", async () => {
    const d = deferred<number>();
    const read = vi.fn(() => d.promise);
    const shown: number[] = [];
    const c = createJoinedCounter(read, (n) => shown.push(n));
    c.settle(4, c.begin());
    const running = c.recount();
    c.joined();
    d.resolve(4); // read before the new row existed
    await running;
    expect(shown).toEqual([4, 5]);
  });

  it("drops a read that finishes after a newer read already settled", async () => {
    const shown: number[] = [];
    const c = createJoinedCounter(async () => 0, (n) => shown.push(n));
    const older = c.begin();
    const newer = c.begin();
    c.settle(9, newer);
    c.settle(8, older);
    expect(shown).toEqual([9]);
  });

  it("keeps the number when a recount fails and tries again with backoff", async () => {
    const read = vi.fn<() => Promise<number>>().mockResolvedValueOnce(2).mockRejectedValueOnce(new Error("x")).mockResolvedValue(6);
    const shown: number[] = [];
    const c = createJoinedCounter(read, (n) => shown.push(n));
    await c.recount();
    c.joined();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(shown.at(-1)).toBe(3);
    await vi.advanceTimersByTimeAsync(999);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(3);
    expect(shown.at(-1)).toBe(6);
  });

  it("shows nothing and reads nothing after stop", async () => {
    const read = vi.fn(async () => 1);
    const shown: number[] = [];
    const c = createJoinedCounter(read, (n) => shown.push(n));
    c.joined();
    c.stop();
    c.joined();
    await vi.advanceTimersByTimeAsync(60000);
    expect(read).not.toHaveBeenCalled();
    expect(shown).toEqual([1]);
  });
});
