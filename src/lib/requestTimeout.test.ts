import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { REQUEST_TIMEOUT_MS, timed } from "./requestTimeout";
import { loadNotebook, saveNotebookNote } from "./notebookApi";
import { addMark, deleteMark, loadLostMarks, loadMyMarks, setSlideMarksKind } from "./marksApi";
import { makeSend } from "./lostTapApi";

const LECTURE = "11111111-1111-1111-1111-111111111111";
const MARK = "77777777-7777-7777-7777-000000000001";

/**
 * A fetch that never answers, as on a half-dead connection: it only ends when the request is
 * aborted (then it fails the way a browser's fetch does).
 */
function hangingFetch() {
  const started = vi.fn();
  const fetch = (_input: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      started();
      init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
    });
  return { fetch, started };
}

/** A real supabase-js client whose requests all hang. */
function hangingClient() {
  const { fetch, started } = hangingFetch();
  const client = createClient("https://example.supabase.co", "anon-key", {
    global: { fetch: fetch as typeof globalThis.fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { client, started };
}

/** Lets the timers run until the promise settles, and says what it gave. */
async function settleAfter<T>(p: Promise<T>, ms: number): Promise<{ done: boolean; value?: T }> {
  let done = false;
  let value: T | undefined;
  void p.then((v) => {
    done = true;
    value = v;
  });
  await vi.advanceTimersByTimeAsync(ms);
  return { done, value };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("timed", () => {
  it("passes a builder's answer through and leaves no timer behind", async () => {
    const abortSignal = vi.fn(function (this: unknown) {
      return Promise.resolve("answer");
    });
    expect(await timed({ then: () => undefined, abortSignal } as unknown as PromiseLike<string>)).toBe("answer");
    expect(abortSignal).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("runs a plain promise (a test double without abortSignal) as it is", async () => {
    expect(await timed(Promise.resolve(3))).toBe(3);
  });
});

describe("a database request that hangs counts as offline after 15 s (K2 re-review R7)", () => {
  it("a notebook read", async () => {
    const { client, started } = hangingClient();
    const read = loadNotebook(client, LECTURE);
    expect((await settleAfter(read, REQUEST_TIMEOUT_MS - 1)).done).toBe(false);
    expect(started).toHaveBeenCalled();
    expect(await settleAfter(read, 1)).toEqual({ done: true, value: { status: "offline" } });
  });

  it("a notebook save", async () => {
    const { client } = hangingClient();
    const save = saveNotebookNote(client, LECTURE, 3, "typed");
    expect((await settleAfter(save, REQUEST_TIMEOUT_MS - 1)).done).toBe(false);
    expect(await settleAfter(save, 1)).toEqual({ done: true, value: "offline" });
  });

  it("mark reads and writes", async () => {
    const { client } = hangingClient();
    const rect = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    const all = Promise.all([
      loadMyMarks(client, LECTURE),
      loadLostMarks(client, LECTURE),
      addMark(client, { id: MARK, lectureId: LECTURE, slide: 2, rect, kind: "save" }),
      setSlideMarksKind(client, LECTURE, 2, "lost"),
      deleteMark(client, MARK),
    ]);
    expect((await settleAfter(all, REQUEST_TIMEOUT_MS - 1)).done).toBe(false);
    expect(await settleAfter(all, 1)).toEqual({
      done: true,
      value: [{ status: "offline" }, { status: "offline" }, "offline", "offline", "offline"],
    });
  });

  it("a tap change (Undo, take back, a note)", async () => {
    const { client } = hangingClient();
    const send = makeSend(client, LECTURE)({ op: "update", id: MARK, patch: { undone: true } });
    expect((await settleAfter(send, REQUEST_TIMEOUT_MS - 1)).done).toBe(false);
    expect(await settleAfter(send, 1)).toEqual({ done: true, value: "offline" });
  });
});
