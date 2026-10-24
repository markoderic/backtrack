import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { NotebookNote } from "./notebookApi";
import type { Loaded, WriteResult } from "./schemaCheck";
import { useNotebook } from "./useNotebook";

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
