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
