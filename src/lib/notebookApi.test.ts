import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WriteResult } from "./schemaCheck";
import {
  NOTEBOOK_SAVE_RETRY_MS,
  NotebookSaver,
  loadNotebook,
  loadNotebookSlides,
  notebookKey,
  saveNotebookNote,
  type NoteState,
} from "./notebookApi";

type Res = { data?: unknown; error: { code?: string; message: string } | null; status?: number };

const LECTURE = "11111111-1111-1111-1111-111111111111";

let calls: [string, ...unknown[]][] = [];
let result: Res | (() => Promise<Res>) = { data: [], error: null, status: 200 };
function chain(): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) {
    c[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return c;
    };
  }
  c.then = (ok: (v: Res) => unknown, bad: (e: unknown) => unknown) =>
    (typeof result === "function" ? result() : Promise.resolve(result)).then(ok, bad);
  return c;
}
const client = {
  from: (t: string) => (calls.push(["from", t]), chain()),
  rpc: (fn: string, args: unknown) => (calls.push(["rpc", fn, args]), chain()),
} as unknown as SupabaseClient;

beforeEach(() => {
  calls = [];
  result = { data: [], error: null, status: 200 };
});

describe("loadNotebook", () => {
  it("reads the notes of one lecture by slide", async () => {
    result = {
      data: [
        { slide_number: 2, body: "slope", updated_at: "2026-10-26T14:00:00Z" },
        { slide_number: 5, body: "limits", updated_at: "2026-10-26T14:05:00Z" },
      ],
      error: null,
    };
    expect(await loadNotebook(client, LECTURE)).toEqual({
      status: "ok",
      data: [
        { slide: 2, body: "slope", updatedAt: "2026-10-26T14:00:00Z" },
        { slide: 5, body: "limits", updatedAt: "2026-10-26T14:05:00Z" },
      ],
    });
    expect(calls).toEqual([
      ["from", "notebook_notes"],
      ["select", "slide_number, body, updated_at"],
      ["eq", "lecture_id", LECTURE],
      ["order", "slide_number"],
    ]);
  });

  it("says missing before 0020 and offline without a connection; throws on anything else", async () => {
    result = { data: null, error: { code: "PGRST205", message: "Could not find the table" }, status: 404 };
    expect(await loadNotebook(client, LECTURE)).toEqual({ status: "missing" });
    result = { data: null, error: { code: "42P01", message: "relation does not exist" }, status: 404 };
    expect(await loadNotebook(client, LECTURE)).toEqual({ status: "missing" });
    result = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(await loadNotebook(client, LECTURE)).toEqual({ status: "offline" });
    result = { data: null, error: { code: "XX000", message: "boom" }, status: 400 };
    await expect(loadNotebook(client, LECTURE)).rejects.toThrow("boom");
  });
});

describe("loadNotebookSlides", () => {
  it("reads which slides of which lectures have a note (no text), for the counts", async () => {
    result = { data: [{ lecture_id: LECTURE, slide_number: 4 }], error: null };
    expect(await loadNotebookSlides(client)).toEqual({ status: "ok", data: [{ lectureId: LECTURE, slide: 4 }] });
    expect(calls).toEqual([
      ["from", "notebook_notes"],
      ["select", "lecture_id, slide_number"],
    ]);
    result = { data: null, error: { code: "PGRST205", message: "Could not find the table" }, status: 404 };
    expect(await loadNotebookSlides(client)).toEqual({ status: "missing" });
  });
});

describe("saveNotebookNote", () => {
  it("saves one slide's text with save_notebook_note", async () => {
    result = { data: "2026-10-26T14:00:00Z", error: null, status: 200 };
    expect(await saveNotebookNote(client, LECTURE, 3, "chain rule")).toBe("ok");
    expect(calls).toEqual([["rpc", "save_notebook_note", { p_lecture_id: LECTURE, p_slide_number: 3, p_body: "chain rule" }]]);
  });

  it("cuts the text at 20000 characters (whole characters, never half an emoji)", async () => {
    await saveNotebookNote(client, LECTURE, 3, "😀".repeat(20005));
    const body = (calls[0][2] as { p_body: string }).p_body;
    expect(Array.from(body)).toHaveLength(20000);
  });

  it("says missing before 0020, offline, or rejected", async () => {
    result = { data: null, error: { code: "PGRST202", message: "Could not find the function" }, status: 404 };
    expect(await saveNotebookNote(client, LECTURE, 3, "x")).toBe("missing");
    result = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(await saveNotebookNote(client, LECTURE, 3, "x")).toBe("offline");
    result = { data: null, error: { code: "42501", message: "new row violates row-level security policy" }, status: 403 };
    expect(await saveNotebookNote(client, LECTURE, 3, "x")).toBe("rejected");
  });
});

describe("NotebookSaver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function make(results: WriteResult[] = []) {
    const save = vi.fn<(slide: number, body: string) => Promise<WriteResult>>(async () => results.shift() ?? "ok");
    const states: [number, NoteState][] = [];
    const saver = new NotebookSaver({ save, delayMs: 800, onState: (s, st) => states.push([s, st]) });
    return { save, saver, states };
  }

  it("saves once the typing pauses, only the newest text", async () => {
    const { save, saver, states } = make();
    saver.set(2, "c");
    await vi.advanceTimersByTimeAsync(500);
    saver.set(2, "ch");
    await vi.advanceTimersByTimeAsync(500);
    saver.set(2, "chain");
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(800);
    expect(save.mock.calls).toEqual([[2, "chain"]]);
    expect(states.at(-1)).toEqual([2, "saved"]);
    expect(saver.pending().size).toBe(0);
  });

  it("keeps each slide apart", async () => {
    const { save, saver } = make();
    saver.set(2, "two");
    saver.set(3, "three");
    await vi.advanceTimersByTimeAsync(800);
    expect(save.mock.calls).toEqual([
      [2, "two"],
      [3, "three"],
    ]);
  });

  it("flush sends everything now and waits for it", async () => {
    const { save, saver } = make();
    saver.set(2, "two");
    saver.set(4, "four");
    await saver.flush();
    expect(save.mock.calls).toEqual([
      [2, "two"],
      [4, "four"],
    ]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("sends one save of a slide at a time, then the newest text", async () => {
    let finish: (r: WriteResult) => void = () => {};
    const save = vi.fn<(slide: number, body: string) => Promise<WriteResult>>(() => new Promise<WriteResult>((r) => (finish = r)));
    const saver = new NotebookSaver({ save, delayMs: 800 });
    saver.set(2, "first");
    await vi.advanceTimersByTimeAsync(800);
    saver.set(2, "second");
    saver.set(2, "third");
    const flushed = saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
    finish("ok");
    await vi.advanceTimersByTimeAsync(0);
    expect(save.mock.calls.map((c) => c[1])).toEqual(["first", "third"]);
    finish("ok");
    await flushed;
    expect(saver.pending().size).toBe(0);
  });

  it("keeps text that could not go out (offline) for the next flush", async () => {
    const { save, saver, states } = make(["offline", "ok"]);
    saver.set(2, "kept");
    await vi.advanceTimersByTimeAsync(800);
    expect(states.at(-1)).toEqual([2, "offline"]);
    expect(saver.pending().get(2)).toBe("kept");
    await saver.flush();
    expect(save.mock.calls).toEqual([
      [2, "kept"],
      [2, "kept"],
    ]);
    expect(states.at(-1)).toEqual([2, "saved"]);
    expect(saver.pending().size).toBe(0);
  });

  it("keeps refused text (and text before 0020) for the next try, and says why", async () => {
    const { save, saver, states } = make(["rejected", "missing", "ok", "ok"]);
    saver.set(2, "no");
    await vi.advanceTimersByTimeAsync(800);
    expect(states.at(-1)).toEqual([2, "failed"]);
    saver.set(3, "not yet");
    await vi.advanceTimersByTimeAsync(800);
    expect(states.at(-1)).toEqual([3, "missing"]);
    expect([...saver.pending()]).toEqual([
      [2, "no"],
      [3, "not yet"],
    ]);
    await saver.flush();
    expect(save.mock.calls.slice(2)).toEqual([
      [2, "no"],
      [3, "not yet"],
    ]);
    expect(saver.pending().size).toBe(0);
  });

  it("a save that throws (a bug) keeps the text and reports the error", async () => {
    const boom = new Error("boom");
    const save = vi.fn<(slide: number, body: string) => Promise<WriteResult>>(async () => {
      throw boom;
    });
    const onError = vi.fn();
    const states: NoteState[] = [];
    const saver = new NotebookSaver({ save, onError, onState: (_s, st) => states.push(st) });
    saver.set(2, "kept");
    await saver.flush();
    expect(onError).toHaveBeenCalledWith(boom);
    expect(states.at(-1)).toBe("failed");
    expect(saver.pending().get(2)).toBe("kept");
  });

  it("newer text typed while a failing save is out wins over the failed one", async () => {
    let finish: (r: WriteResult) => void = () => {};
    const save = vi.fn<(slide: number, body: string) => Promise<WriteResult>>(() => new Promise<WriteResult>((r) => (finish = r)));
    const saver = new NotebookSaver({ save, delayMs: 800 });
    saver.set(2, "old");
    await vi.advanceTimersByTimeAsync(800);
    saver.set(2, "new");
    finish("rejected");
    await vi.advanceTimersByTimeAsync(0);
    expect(saver.pending().get(2)).toBe("new");
    saver.dispose();
  });

  it("dispose stops the timers and keeps the waiting text", async () => {
    const { save, saver } = make();
    saver.set(2, "left");
    saver.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
    expect(saver.pending().get(2)).toBe("left");
  });

  describe("text that is out (batch K2: J re-review N1)", () => {
    it("pending() has the text of a save that is still out, until the database says it is saved", async () => {
      let finish: (r: WriteResult) => void = () => {};
      const save = vi.fn<(slide: number, body: string) => Promise<WriteResult>>(() => new Promise<WriteResult>((r) => (finish = r)));
      const saver = new NotebookSaver({ save });
      saver.set(2, "in flight");
      const flushed = saver.flush();
      expect(save).toHaveBeenCalledTimes(1);
      expect(saver.pending().get(2)).toBe("in flight");
      // Newer typing wins over the text that is out.
      saver.set(2, "newer");
      expect(saver.pending().get(2)).toBe("newer");
      finish("ok");
      await flushed;
      expect(saver.pending().get(2)).toBe("newer");
      await vi.advanceTimersByTimeAsync(800);
      expect(save.mock.calls.map((c) => c[1])).toEqual(["in flight", "newer"]);
      expect(saver.pending().get(2)).toBe("newer");
      finish("ok");
      await vi.advanceTimersByTimeAsync(0);
      expect(saver.pending().size).toBe(0);
    });

    it("a save that is out and then fails stays in pending()", async () => {
      let finish: (r: WriteResult) => void = () => {};
      const save = vi.fn<(slide: number, body: string) => Promise<WriteResult>>(() => new Promise<WriteResult>((r) => (finish = r)));
      const saver = new NotebookSaver({ save });
      saver.set(3, "kept");
      const flushed = saver.flush();
      expect([...saver.pending()]).toEqual([[3, "kept"]]);
      finish("offline");
      await flushed;
      expect([...saver.pending()]).toEqual([[3, "kept"]]);
    });
  });

  describe("on the device (storageKey)", () => {
    const KEY = notebookKey(LECTURE);
    const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "null") as Record<string, string> | null;
    beforeEach(() => localStorage.clear());

    it("keeps typed text on the device at once, and takes it off once saved", async () => {
      let finish: (r: WriteResult) => void = () => {};
      const save = vi.fn<(slide: number, body: string) => Promise<WriteResult>>(() => new Promise<WriteResult>((r) => (finish = r)));
      const saver = new NotebookSaver({ save, storageKey: KEY });
      saver.set(4, "chain rule");
      expect(stored()).toEqual({ "4": "chain rule" });
      const flushed = saver.flush();
      // Out, not saved: still on the device.
      expect(stored()).toEqual({ "4": "chain rule" });
      finish("ok");
      await flushed;
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("a new saver starts with what was left on the device and sends it with its first flush", async () => {
      localStorage.setItem(KEY, JSON.stringify({ "5": "left over", x: "junk", "0": "no slide 0", "6": 7 }));
      const save = vi.fn<(slide: number, body: string) => Promise<WriteResult>>(async () => "ok");
      const saver = new NotebookSaver({ save, storageKey: KEY });
      expect([...saver.pending()]).toEqual([[5, "left over"]]);
      await saver.flush();
      expect(save.mock.calls).toEqual([[5, "left over"]]);
      expect(stored()?.["5"]).toBeUndefined();
    });

    it("keeps text that did not save (offline) on the device", async () => {
      const save = vi.fn<(slide: number, body: string) => Promise<WriteResult>>(async () => "offline");
      const saver = new NotebookSaver({ save, storageKey: KEY });
      saver.set(2, "offline text");
      await saver.flush();
      expect(stored()).toEqual({ "2": "offline text" });
    });

    it("another page's newer text on the device wins: it is taken over and sent, never the old text", async () => {
      const save = vi.fn<(slide: number, body: string) => Promise<WriteResult>>(async () => "ok");
      const a = new NotebookSaver({ save, storageKey: KEY });
      a.set(2, "from the live screen");
      // My spots (another saver) has newer text for slide 2 (and slide 3) that it has not sent yet.
      localStorage.setItem(KEY, JSON.stringify({ "2": "from my spots", "3": "other slide" }));
      expect(a.pending().get(2)).toBe("from my spots");
      await a.flush();
      expect(save.mock.calls).toEqual([
        [2, "from my spots"],
        [3, "other slide"],
      ]);
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("text another page already saved is not sent again from here (an edit made there is not undone)", async () => {
      const offline = vi.fn<(slide: number, body: string) => Promise<WriteResult>>(async () => "offline");
      // The live screen, offline, kept slide 4's text on the device and is then hidden (Next keeps it alive).
      const live = new NotebookSaver({ save: offline, storageKey: KEY });
      live.set(4, "old text");
      await live.flush();
      expect(live.pending().get(4)).toBe("old text");
      // My spots, back online: sends what was left, then the student edits it there and it saves.
      const ok = vi.fn<(slide: number, body: string) => Promise<WriteResult>>(async () => "ok");
      const spots = new NotebookSaver({ save: ok, storageKey: KEY });
      await spots.flush();
      spots.set(4, "edited in My spots");
      await spots.flush();
      expect(localStorage.getItem(KEY)).toBeNull();
      // Back on the live screen: nothing to send.
      expect(live.pending().size).toBe(0);
      await live.flush();
      expect(offline).toHaveBeenCalledTimes(1);
    });

    it("persist() writes what is out, so a page thrown away while hidden loses nothing", async () => {
      const save = vi.fn<(slide: number, body: string) => Promise<WriteResult>>(() => new Promise<WriteResult>(() => {}));
      const saver = new NotebookSaver({ save, storageKey: KEY });
      // The first write fails (storage full for a moment).
      const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
        throw new Error("full");
      });
      saver.set(2, "typed");
      expect(localStorage.getItem(KEY)).toBeNull();
      void saver.flush();
      saver.persist();
      expect(stored()).toEqual({ "2": "typed" });
      setItem.mockRestore();
    });

    it("works with storage blocked (the text stays in memory)", async () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      const save = vi.fn<(slide: number, body: string) => Promise<WriteResult>>(async () => "offline");
      const saver = new NotebookSaver({ save, storageKey: KEY });
      saver.set(2, "memory");
      await saver.flush();
      expect(saver.pending().get(2)).toBe("memory");
      vi.restoreAllMocks();
    });

    it("a slide held by this open and by one that went before is merged with the saved note once", () => {
      // A closed tab left slide 7 typed blind on the device.
      localStorage.setItem(KEY, JSON.stringify({ "7": "left" }));
      localStorage.setItem(`${KEY}:blind`, JSON.stringify([7]));
      const save = vi.fn<(slide: number, body: string) => Promise<WriteResult>>(async () => "ok");
      const saver = new NotebookSaver({ save, storageKey: KEY });
      const open = saver.hold();
      saver.set(7, "left, and more", open, true);
      saver.release(open, new Map([[7, "saved"]]));
      expect(saver.pending().get(7)).toBe("saved\nleft, and more");
    });
  });

  it("text that did not go out for want of a connection is sent again by itself after 2, then 5 s (R7)", async () => {
    const { save, saver, states } = make(["offline", "offline", "ok"]);
    saver.set(2, "kept");
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toEqual([2, "offline"]);
    await vi.advanceTimersByTimeAsync(NOTEBOOK_SAVE_RETRY_MS[0]);
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(NOTEBOOK_SAVE_RETRY_MS[1]);
    expect(save.mock.calls).toEqual([
      [2, "kept"],
      [2, "kept"],
      [2, "kept"],
    ]);
    expect(states.at(-1)).toEqual([2, "saved"]);
    // Saved: no more tries.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).toHaveBeenCalledTimes(3);
  });

  it("a refusal is not tried again by itself (it would be refused again)", async () => {
    const { save, saver } = make(["rejected"]);
    saver.set(2, "no");
    await vi.advanceTimersByTimeAsync(800);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
