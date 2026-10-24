import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { NotebookNote } from "./notebookApi";
import type { Loaded, WriteResult } from "./schemaCheck";
import { NOTEBOOK_RETRY_MS, useNotebook } from "./useNotebook";

const LECTURE = "11111111-1111-1111-1111-111111111111";
const settle = () => act(async () => {});
type Load = () => Promise<Loaded<NotebookNote[]>>;
const note = (slide: number, body: string): NotebookNote => ({ slide, body, updatedAt: "x" });

beforeEach(() => localStorage.clear());

describe("useNotebook", () => {
  it("shows what the database has, with text not saved yet on top of it", async () => {
    let finish: (r: WriteResult) => void = () => {};
    const save = vi.fn<(s: number, b: string) => Promise<WriteResult>>(() => new Promise<WriteResult>((r) => (finish = r)));
    const load = vi.fn<Load>(async () => ({ status: "ok", data: [note(2, "two"), note(3, "old three")] }));
    const { result } = renderHook(() => useNotebook(LECTURE, { save, load }));
    await settle();
    expect(result.current.textOf(2)).toBe("two");
    act(() => result.current.set(3, "new three"));
    void result.current.flush();
    // A read while the save is out: the typed text stays.
    await act(async () => void (await result.current.reload()));
    expect(result.current.textOf(3)).toBe("new three");
    await act(async () => finish("ok"));
    expect(result.current.stateOf(3)).toBe("saved");
    expect([...result.current.slides].sort()).toEqual([2, 3]);
  });

  it("a read taken before a save landed does not bring the old text back", async () => {
    let finishLoad: (v: Loaded<NotebookNote[]>) => void = () => {};
    const load = vi
      .fn<Load>()
      .mockResolvedValueOnce({ status: "ok", data: [note(4, "old")] })
      .mockImplementationOnce(() => new Promise((r) => (finishLoad = r)));
    const save = vi.fn<(s: number, b: string) => Promise<WriteResult>>(async () => "ok");
    const { result } = renderHook(() => useNotebook(LECTURE, { save, load }));
    await settle();
    let reading: Promise<void> = Promise.resolve();
    act(() => {
      reading = result.current.reload();
    });
    act(() => result.current.set(4, "new"));
    await act(async () => result.current.flush());
    await act(async () => {
      finishLoad({ status: "ok", data: [note(4, "old")] });
      await reading;
    });
    expect(result.current.textOf(4)).toBe("new");
  });

  it("a note deleted elsewhere (My spots) goes on the next read", async () => {
    const load = vi.fn<Load>().mockResolvedValueOnce({ status: "ok", data: [note(5, "five")] }).mockResolvedValue({ status: "ok", data: [] });
    const { result } = renderHook(() => useNotebook(LECTURE, { save: vi.fn(async () => "ok" as const), load }));
    await settle();
    expect(result.current.slides.has(5)).toBe(true);
    await act(async () => result.current.reload());
    expect(result.current.textOf(5)).toBe("");
    expect(result.current.slides.size).toBe(0);
  });

  it("before 0020 (missing): device mode, the text kept on the device, nothing sent", async () => {
    const save = vi.fn<(s: number, b: string) => Promise<WriteResult>>(async () => "missing");
    const load = vi.fn<Load>(async () => ({ status: "missing" }));
    const { result } = renderHook(() => useNotebook(LECTURE, { save, load }));
    await settle();
    expect(result.current.mode).toBe("device");
    act(() => result.current.set(1, "here only"));
    await act(async () => result.current.flush());
    expect(save).not.toHaveBeenCalled();
    expect(result.current.stateOf(1)).toBe("missing");
    expect(JSON.parse(localStorage.getItem(`backtrack:notebook:${LECTURE}`) ?? "{}")).toEqual({ "1": "here only" });
  });
});

describe("useNotebook: typing before the saved notes are read (K2 review I1)", () => {
  it("text typed while the first read is out never replaces the saved note: it goes after it, and nothing is sent before", async () => {
    let answer: (v: Loaded<NotebookNote[]>) => void = () => {};
    const load = vi.fn<Load>(() => new Promise((r) => (answer = r)));
    const save = vi.fn<(s: number, b: string) => Promise<WriteResult>>(async () => "ok");
    const { result } = renderHook(() => useNotebook(LECTURE, { save, load }));
    await settle();
    act(() => result.current.set(7, "x"));
    await act(async () => result.current.flush());
    expect(save).not.toHaveBeenCalled();
    await act(async () => answer({ status: "ok", data: [note(7, "two pages of notes from before the reload")] }));
    await settle();
    expect(result.current.textOf(7)).toBe("two pages of notes from before the reload\nx");
    expect(save.mock.calls).toEqual([[7, "two pages of notes from before the reload\nx"]]);
  });

  it("a first read that fails offline keeps the typing on the device (not sent); the next read that answers merges it", async () => {
    const load = vi
      .fn<Load>()
      .mockResolvedValueOnce({ status: "offline" } as Loaded<NotebookNote[]>)
      .mockResolvedValue({ status: "ok", data: [note(3, "saved")] });
    const save = vi.fn<(s: number, b: string) => Promise<WriteResult>>(async () => "ok");
    const { result } = renderHook(() => useNotebook(LECTURE, { save, load }));
    await settle();
    act(() => result.current.set(3, "typed offline"));
    await act(async () => result.current.flush());
    expect(save).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(`backtrack:notebook:${LECTURE}`) ?? "{}")).toEqual({ "3": "typed offline" });
    await act(async () => result.current.reload());
    await settle();
    expect(save.mock.calls).toEqual([[3, "saved\ntyped offline"]]);
    expect(result.current.textOf(3)).toBe("saved\ntyped offline");
  });

  it("text typed blind on a visit that ended before the read is still merged on the next visit", async () => {
    const first = renderHook(() => useNotebook(LECTURE, { save: vi.fn(async () => "ok" as const), load: () => new Promise(() => {}) }));
    await settle();
    act(() => first.result.current.set(2, "before the read"));
    first.unmount();
    const { forgetSharedQueues } = await import("./sharedQueues");
    forgetSharedQueues();
    const save = vi.fn<(s: number, b: string) => Promise<WriteResult>>(async () => "ok");
    renderHook(() => useNotebook(LECTURE, { save, load: async () => ({ status: "ok", data: [note(2, "saved")] }) }));
    await settle();
    await settle();
    expect(save.mock.calls).toEqual([[2, "saved\nbefore the read"]]);
  });
});

describe("useNotebook: one saver per lecture for the page (K2 review I3)", () => {
  it("the live screen's save that is out and My spots' newer edit reach the database in order: the newer text wins", async () => {
    const calls: [number, string][] = [];
    const finishes: ((r: WriteResult) => void)[] = [];
    const save = vi.fn<(s: number, b: string) => Promise<WriteResult>>((s, b) => {
      calls.push([s, b]);
      return new Promise<WriteResult>((r) => finishes.push(r));
    });
    const load = async () => ({ status: "ok" as const, data: [] as NotebookNote[] });
    const live = renderHook(() => useNotebook(LECTURE, { save, load }));
    const spots = renderHook(() => useNotebook(LECTURE, { save, load }));
    await settle();
    await settle();
    act(() => live.result.current.set(7, "A"));
    void live.result.current.flush();
    await settle();
    expect(calls).toEqual([[7, "A"]]);
    // In My spots, while "A" is still out: the student edits the same slide.
    act(() => spots.result.current.set(7, "B"));
    void spots.result.current.flush();
    await settle();
    // Only one save of the slide at a time, across both pages.
    expect(calls).toEqual([[7, "A"]]);
    await act(async () => finishes.shift()!("ok"));
    await settle();
    expect(calls).toEqual([
      [7, "A"],
      [7, "B"],
    ]);
    await act(async () => finishes.shift()!("ok"));
    expect(spots.result.current.stateOf(7)).toBe("saved");
    expect(localStorage.getItem(`backtrack:notebook:${LECTURE}`)).toBeNull();
  });
});

describe("useNotebook: every open waits for its own read (K2 re-review N1, N2, N4, nit)", () => {
  // Each test says where the lecture's shared saver starts: a fresh one, made from what the device holds.
  beforeEach(async () => {
    const { forgetSharedQueues } = await import("./sharedQueues");
    forgetSharedQueues();
    localStorage.clear();
  });

  it("a second open in the same page load (the saver already read once) holds what it types until its own read: no overwrite", async () => {
    const save = vi.fn<(s: number, b: string) => Promise<WriteResult>>(async () => "ok");
    const first = renderHook(() => useNotebook(LECTURE, { save, load: async () => ({ status: "ok", data: [note(7, "two pages")] }) }));
    await settle();
    await settle();
    expect(first.result.current.textOf(7)).toBe("two pages");
    first.unmount();
    // The same saver (one per lecture for the page) has read once already; nothing of slide 7 is held.
    const { sharedNotebookSaver } = await import("./sharedQueues");
    expect(sharedNotebookSaver(LECTURE, save).isHeld(7)).toBe(false);
    // My spots at the end of class: its read is slow, and the student types in an empty looking field.
    let answer: (v: Loaded<NotebookNote[]>) => void = () => {};
    const second = renderHook(() => useNotebook(LECTURE, { save, load: () => new Promise((r) => (answer = r)) }));
    await settle();
    act(() => second.result.current.set(7, "x"));
    await act(async () => second.result.current.flush());
    expect(save).not.toHaveBeenCalled();
    // Kept on the device meanwhile, and said so.
    expect(second.result.current.stateOf(7)).toBe("offline");
    expect(JSON.parse(localStorage.getItem(`backtrack:notebook:${LECTURE}`) ?? "{}")).toEqual({ "7": "x" });
    await act(async () => answer({ status: "ok", data: [note(7, "two pages")] }));
    await settle();
    expect(save.mock.calls).toEqual([[7, "two pages\nx"]]);
    expect(second.result.current.textOf(7)).toBe("two pages\nx");
  });

  it("a first read that fails offline is tried again when the browser is back online (no reload by hand)", async () => {
    const load = vi
      .fn<Load>()
      .mockResolvedValueOnce({ status: "offline" } as Loaded<NotebookNote[]>)
      .mockResolvedValue({ status: "ok", data: [note(3, "saved")] });
    const save = vi.fn<(s: number, b: string) => Promise<WriteResult>>(async () => "ok");
    const { result } = renderHook(() => useNotebook(LECTURE, { save, load }));
    await settle();
    await settle();
    act(() => result.current.set(3, "typed"));
    expect(result.current.stateOf(3)).toBe("offline");
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await settle();
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(save.mock.calls).toEqual([[3, "saved\ntyped"]]);
  });

  it("while held it reads again when the tab is shown again, on focus, and on a growing timer", async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn<Load>(async () => ({ status: "offline" }) as Loaded<NotebookNote[]>);
      renderHook(() => useNotebook(LECTURE, { save: vi.fn(async () => "ok" as const), load }));
      await act(async () => vi.advanceTimersByTimeAsync(0));
      expect(load).toHaveBeenCalledTimes(1);
      await act(async () => vi.advanceTimersByTimeAsync(NOTEBOOK_RETRY_MS[0]));
      expect(load).toHaveBeenCalledTimes(2);
      await act(async () => vi.advanceTimersByTimeAsync(NOTEBOOK_RETRY_MS[1]));
      expect(load).toHaveBeenCalledTimes(3);
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(load).toHaveBeenCalledTimes(4);
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(load).toHaveBeenCalledTimes(5);
      // Capped at 30 s.
      await act(async () => vi.advanceTimersByTimeAsync(30_000));
      expect(load.mock.calls.length).toBeGreaterThanOrEqual(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it("text the device held for the slide (not blind) is not given the saved note again in front of it (probe P1d)", async () => {
    localStorage.setItem(`backtrack:notebook:${LECTURE}`, JSON.stringify({ "7": "Accrual = earned" }));
    let answer: (v: Loaded<NotebookNote[]>) => void = () => {};
    const save = vi.fn<(s: number, b: string) => Promise<WriteResult>>(async () => "ok");
    const { result } = renderHook(() => useNotebook(LECTURE, { save, load: () => new Promise((r) => (answer = r)) }));
    await settle();
    expect(result.current.textOf(7)).toBe("Accrual = earned");
    save.mockClear();
    act(() => result.current.set(7, "Accrual = earned, not paid"));
    await act(async () => answer({ status: "ok", data: [note(7, "Accrual: earned")] }));
    await settle();
    expect(save.mock.calls.at(-1)).toEqual([7, "Accrual = earned, not paid"]);
    expect(save.mock.calls.some((c) => c[1].includes("Accrual: earned"))).toBe(false);
  });

  it("the saved text is never put in twice when the typed text already holds it", async () => {
    let answer: (v: Loaded<NotebookNote[]>) => void = () => {};
    const save = vi.fn<(s: number, b: string) => Promise<WriteResult>>(async () => "ok");
    const { result } = renderHook(() => useNotebook(LECTURE, { save, load: () => new Promise((r) => (answer = r)) }));
    await settle();
    act(() => result.current.set(7, "intro: saved part, and more"));
    await act(async () => answer({ status: "ok", data: [note(7, "saved part")] }));
    await settle();
    expect(save.mock.calls).toEqual([[7, "intro: saved part, and more"]]);
  });

  it("a save that ends while the page is hidden shows as Saved when the page is shown again", async () => {
    let finish: (r: WriteResult) => void = () => {};
    const save = vi.fn<(s: number, b: string) => Promise<WriteResult>>(() => new Promise<WriteResult>((r) => (finish = r)));
    const load = async () => ({ status: "ok" as const, data: [] as NotebookNote[] });
    const live = renderHook(() => useNotebook(LECTURE, { save, load }));
    await settle();
    await settle();
    act(() => live.result.current.set(7, "A"));
    // Hidden (Activity): the text goes out, and the page is not listening while it lands.
    live.unmount();
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => finish("ok"));
    const shown = renderHook(() => useNotebook(LECTURE, { save, load }));
    await settle();
    expect(shown.result.current.stateOf(7)).toBe("saved");
  });
});
