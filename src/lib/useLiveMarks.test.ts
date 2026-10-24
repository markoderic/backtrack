import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MARK_FAILED, useLiveMarks } from "./useLiveMarks";
import type { LiveMark, MarkOp, MarkSendResult } from "./markQueue";

const LECTURE = "11111111-1111-1111-1111-111111111111";
const R = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
const settle = () => act(async () => {});
type Load = () => Promise<{ status: "ok"; data: LiveMark[] }>;

beforeEach(() => localStorage.clear());

describe("useLiveMarks", () => {
  it("keeps a mark whose add was sent earlier in the same flush run on screen while the next op is out", async () => {
    // The reviewer's probe: [A, B] must not become [B] when a third change comes while B's add is out.
    const pending: ((r: MarkSendResult) => void)[] = [];
    const send = vi.fn<(op: MarkOp) => Promise<MarkSendResult>>(() => new Promise<MarkSendResult>((r) => pending.push(r)));
    const load = vi.fn<Load>(async () => ({ status: "ok", data: [] }));
    const { result } = renderHook(() => useLiveMarks(LECTURE, { send, load }));
    await settle();
    let a = "";
    let b = "";
    act(() => {
      a = result.current.add(7, R, "save")!;
    });
    await settle();
    act(() => {
      b = result.current.add(7, { ...R, x: 0.5 }, "save")!;
    });
    await act(async () => pending.shift()!("ok"));
    await settle();
    expect(send).toHaveBeenCalledTimes(2);
    expect(result.current.marks.map((m) => m.id)).toEqual([a, b]);
    act(() => {
      result.current.setKind(7, "lost");
    });
    expect(result.current.marks.map((m) => m.id)).toEqual([a, b]);
    expect(result.current.marks.map((m) => m.kind)).toEqual(["lost", "lost"]);
  });

  it("a delete sent earlier in a run does not bring the mark back while the run goes on", async () => {
    const pending: ((r: MarkSendResult) => void)[] = [];
    const send = vi.fn<(op: MarkOp) => Promise<MarkSendResult>>(() => new Promise<MarkSendResult>((r) => pending.push(r)));
    const load = vi.fn<Load>(async () => ({ status: "ok", data: [{ id: "m1", slide: 7, rect: R, kind: "save" }] }));
    const { result } = renderHook(() => useLiveMarks(LECTURE, { send, load }));
    await settle();
    await settle();
    expect(result.current.marks).toHaveLength(1);
    act(() => result.current.remove("m1"));
    await settle();
    act(() => {
      result.current.add(7, { ...R, x: 0.5 }, "save");
    });
    await act(async () => pending.shift()!("ok"));
    await settle();
    // A third change while the add is out.
    act(() => result.current.setKind(7, "save"));
    expect(result.current.marks.map((m) => m.id)).not.toContain("m1");
  });

  it("a read that comes back during a run keeps what was sent meanwhile", async () => {
    let finishLoad: (v: { status: "ok"; data: LiveMark[] }) => void = () => {};
    const load = vi
      .fn<Load>()
      .mockResolvedValueOnce({ status: "ok", data: [] })
      .mockImplementationOnce(() => new Promise((r) => (finishLoad = r)));
    const send = vi.fn<(op: MarkOp) => Promise<MarkSendResult>>(async () => "ok");
    const { result } = renderHook(() => useLiveMarks(LECTURE, { send, load }));
    await settle();
    act(() => void result.current.reload());
    let a = "";
    act(() => {
      a = result.current.add(7, R, "save")!;
    });
    await settle();
    // The read was taken before the add got in.
    await act(async () => finishLoad({ status: "ok", data: [] }));
    expect(result.current.marks.map((m) => m.id)).toEqual([a]);
  });

  it("says when a note or a delete did not save, not only an add; clearProblem takes the line back", async () => {
    const send = vi.fn(async (op: MarkOp): Promise<MarkSendResult> => (op.op === "note" ? "rejected" : "ok"));
    const load = vi.fn<Load>(async () => ({ status: "ok", data: [{ id: "m1", slide: 7, rect: R, kind: "save" }] }));
    const { result } = renderHook(() => useLiveMarks(LECTURE, { send, load }));
    await settle();
    await settle();
    act(() => result.current.setNote("m1", "x"));
    await settle();
    expect(result.current.problem?.text).toBe(MARK_FAILED);
    act(() => result.current.clearProblem());
    expect(result.current.problem).toBeNull();
  });

  it("reads again when the window gets the focus back (My spots in a window beside it), at most every 2 s", async () => {
    const load = vi.fn<Load>(async () => ({ status: "ok", data: [] }));
    renderHook(() => useLiveMarks(LECTURE, { send: vi.fn(async () => "ok" as const), load }));
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
    });
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
