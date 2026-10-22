import { Component, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { QueueOp, SendResult } from "@/lib/tapQueue";
import { LostButton } from "./LostButton";

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <p>Caught: {this.state.error.message}</p> : this.props.children;
  }
}

const LECTURE = "11111111-1111-1111-1111-111111111111";
const KEY = `backtrack:queue:${LECTURE}`;
const REJECTED = "This one didn't save because the lecture had ended.";

type Send = (op: QueueOp) => Promise<SendResult>;
const okSend = () => vi.fn<Send>(async () => "ok");

function setup(over: Partial<Parameters<typeof LostButton>[0]> = {}) {
  const send = (over.send as ReturnType<typeof okSend> | undefined) ?? okSend();
  const onSpots = vi.fn<(s: Set<number>) => void>();
  const loadOwn = vi.fn(async () => [] as { id: string; slide: number }[] | null);
  const view = render(
    <LostButton lectureId={LECTURE} viewing={7} send={send} loadOwn={loadOwn} onSpots={onSpots} {...over} />,
  );
  const lastSpots = () => [...(onSpots.mock.lastCall?.[0] ?? [])].sort((a, b) => a - b);
  return { ...view, send, onSpots, loadOwn, lastSpots };
}

const press = () => fireEvent.click(screen.getByRole("button", { name: "I'm lost" }));
const undo = () => fireEvent.click(screen.getByRole("button", { name: "Undo" }));
const settle = () => act(async () => {});
const ops = (send: ReturnType<typeof okSend>) => send.mock.calls.map((c) => c[0]);

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LostButton", () => {
  it("is one I'm lost button and shows nothing else until it is pressed", async () => {
    setup();
    await settle();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByText(/Saved slide/)).not.toBeInTheDocument();
  });

  it("shows Saved slide 7 right away, before the send has resolved", async () => {
    const send = vi.fn<Send>(() => new Promise<SendResult>(() => {}));
    setup({ send });
    await settle();
    press();
    // Straight away, in the same tick as the press: the send has not even started.
    expect(screen.getByText("Saved slide 7")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Saved slide 7")).toBeInTheDocument();
  });

  it("records the slide being viewed, with a browser made id and time", async () => {
    const { send } = setup({ viewing: 4 });
    await settle();
    press();
    await settle();
    expect(screen.getByText("Saved slide 4")).toBeInTheDocument();
    const [op] = ops(send);
    expect(op).toMatchObject({ op: "insert", tap: { tappedOnSlide: 4 } });
    if (op.op !== "insert") throw new Error("expected an insert");
    expect(op.tap.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(new Date(op.tap.tappedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it("works where crypto.randomUUID does not exist", async () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    try {
      const { send } = setup();
      await settle();
      press();
      await settle();
      const [op] = ops(send);
      if (op.op !== "insert") throw new Error("expected an insert");
      expect(op.tap.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("has no keyboard shortcut: keys do nothing and the button shows no key", async () => {
    const { send } = setup();
    await settle();
    for (const key of ["l", "L", " ", "Enter"]) {
      fireEvent.keyDown(window, { key });
      fireEvent.keyDown(document.body, { key });
      fireEvent.keyUp(window, { key });
    }
    expect(send).not.toHaveBeenCalled();
    expect(screen.queryByText(/Saved slide/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I'm lost" })).not.toHaveAttribute("aria-keyshortcuts");
    expect(screen.queryByText(/^L$/)).not.toBeInTheDocument();
  });

  describe("Undo", () => {
    it("on a tap that was already sent queues update undone true", async () => {
      const { send } = setup();
      await settle();
      press();
      await settle();
      undo();
      await settle();
      const [insert, update] = ops(send);
      if (insert.op !== "insert") throw new Error("expected an insert");
      expect(update).toEqual({ op: "update", id: insert.tap.id, patch: { undone: true } });
      expect(send).toHaveBeenCalledTimes(2);
      expect(screen.queryByText("Saved slide 7")).not.toBeInTheDocument();
    });

    it("on a tap that was never sent sends nothing, now or later", async () => {
      const send = vi.fn<Send>(async () => "offline");
      setup({ send });
      await settle();
      press();
      await settle();
      expect(send).toHaveBeenCalledTimes(1);
      undo();
      await settle();
      act(() => {
        window.dispatchEvent(new Event("online"));
      });
      await settle();
      expect(send).toHaveBeenCalledTimes(1);
      expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toEqual([]);
    });

    it("on a tap whose send is still in flight queues the undo to go right after it", async () => {
      let finish: (r: SendResult) => void = () => {};
      const send = vi.fn<Send>((op) => (op.op === "insert" ? new Promise<SendResult>((r) => (finish = r)) : Promise.resolve("ok")));
      setup({ send });
      await settle();
      press();
      await settle();
      undo();
      await act(async () => finish("ok"));
      expect(ops(send as ReturnType<typeof okSend>).map((o) => o.op)).toEqual(["insert", "update"]);
    });

    it("takes the dot away right away", async () => {
      const { lastSpots } = setup({ send: vi.fn<Send>(async () => "offline") });
      await settle();
      press();
      expect(lastSpots()).toEqual([7]);
      undo();
      expect(lastSpots()).toEqual([]);
    });
  });

  describe("8 second window", () => {
    it("closes the bar and the Undo button after 8 seconds", async () => {
      vi.useFakeTimers();
      setup();
      await settle();
      press();
      await act(async () => vi.advanceTimersByTime(7999));
      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
      await act(async () => vi.advanceTimersByTime(1));
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
      expect(screen.queryByText("Saved slide 7")).not.toBeInTheDocument();
    });

    it("keeps the dot after the bar closes", async () => {
      vi.useFakeTimers();
      const { lastSpots } = setup();
      await settle();
      press();
      await act(async () => vi.advanceTimersByTime(8000));
      expect(lastSpots()).toEqual([7]);
    });

    it("a new tap starts a new window and the old Undo no longer applies", async () => {
      vi.useFakeTimers();
      const { send } = setup({ viewing: 7 });
      await settle();
      press();
      await act(async () => vi.advanceTimersByTime(5000));
      press();
      await act(async () => vi.advanceTimersByTime(5000));
      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
      await act(async () => vi.advanceTimersByTime(3000));
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
      expect(ops(send).filter((o) => o.op === "insert")).toHaveLength(2);
    });

    it("gives 8 more seconds while the student types a note", async () => {
      vi.useFakeTimers();
      setup();
      await settle();
      press();
      await act(async () => vi.advanceTimersByTime(7000));
      fireEvent.change(screen.getByPlaceholderText("What lost you? Optional"), { target: { value: "the second step" } });
      await act(async () => vi.advanceTimersByTime(7000));
      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
      await act(async () => vi.advanceTimersByTime(1000));
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    });
  });

  describe("note", () => {
    it("has a one line input limited to 140 characters and a Save button", async () => {
      setup();
      await settle();
      press();
      const input = screen.getByPlaceholderText("What lost you? Optional");
      expect(input).toHaveAttribute("maxLength", "140");
      expect(input.tagName).toBe("INPUT");
      expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    });

    it("Save queues a note update for the tap and sends it", async () => {
      const { send } = setup();
      await settle();
      press();
      await settle();
      fireEvent.change(screen.getByPlaceholderText("What lost you? Optional"), { target: { value: "  the second step  " } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await settle();
      const [insert, update] = ops(send);
      if (insert.op !== "insert") throw new Error("expected an insert");
      expect(update).toEqual({ op: "update", id: insert.tap.id, patch: { note: "the second step" } });
      expect(screen.getByText("Note saved")).toBeInTheDocument();
      expect(screen.queryByPlaceholderText("What lost you? Optional")).not.toBeInTheDocument();
    });

    it("Save does nothing for a blank note", async () => {
      const { send } = setup();
      await settle();
      press();
      await settle();
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      fireEvent.change(screen.getByPlaceholderText("What lost you? Optional"), { target: { value: "   " } });
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("Undo after a note on an unsent tap sends neither", async () => {
      const send = vi.fn<Send>(async () => "offline");
      setup({ send });
      await settle();
      press();
      await settle();
      fireEvent.change(screen.getByPlaceholderText("What lost you? Optional"), { target: { value: "x" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await settle();
      undo();
      act(() => {
        window.dispatchEvent(new Event("online"));
      });
      await settle();
      // Both attempts were the insert, held back by being offline. Neither the note nor a second insert went out.
      expect(ops(send as ReturnType<typeof okSend>).map((o) => o.op)).toEqual(["insert", "insert"]);
      expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toEqual([]);
    });
  });

  describe("rejected taps", () => {
    it("shows the message and takes the dot away", async () => {
      const send = vi.fn<Send>(async () => "rejected");
      const { lastSpots } = setup({ send });
      await settle();
      press();
      expect(lastSpots()).toEqual([7]);
      await settle();
      expect(lastSpots()).toEqual([]);
      expect(screen.getByText(REJECTED)).toBeInTheDocument();
      expect(screen.queryByText("Saved slide 7")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    });

    it("the next tap clears the message", async () => {
      const send = vi.fn<Send>().mockResolvedValueOnce("rejected").mockResolvedValue("ok");
      setup({ send });
      await settle();
      press();
      await settle();
      expect(screen.getByText(REJECTED)).toBeInTheDocument();
      press();
      await settle();
      expect(screen.queryByText(REJECTED)).not.toBeInTheDocument();
      expect(screen.getByText("Saved slide 7")).toBeInTheDocument();
    });

    it("says a change did not save when only an update is rejected", async () => {
      const send = vi.fn<Send>(async (op) => (op.op === "update" ? "rejected" : "ok"));
      setup({ send });
      await settle();
      press();
      await settle();
      undo();
      await settle();
      expect(screen.getByText("That change didn't save.")).toBeInTheDocument();
    });
  });

  describe("offline queue", () => {
    it("keeps an offline tap in localStorage and sends it on the online event", async () => {
      const send = vi.fn<Send>().mockResolvedValueOnce("offline").mockResolvedValue("ok");
      setup({ send });
      await settle();
      press();
      await settle();
      expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toHaveLength(1);
      expect(screen.getByText("Saved slide 7")).toBeInTheDocument();
      act(() => {
        window.dispatchEvent(new Event("online"));
      });
      await settle();
      expect(send).toHaveBeenCalledTimes(2);
      expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toEqual([]);
    });

    it("sends the pending ops again when the connection comes back (reconnects goes up)", async () => {
      const send = vi.fn<Send>().mockResolvedValueOnce("offline").mockResolvedValue("ok");
      const { rerender, loadOwn, onSpots } = setup({ send });
      await settle();
      press();
      await settle();
      rerender(<LostButton lectureId={LECTURE} viewing={7} send={send} loadOwn={loadOwn} onSpots={onSpots} reconnects={1} />);
      await settle();
      expect(send).toHaveBeenCalledTimes(2);
    });

    it("restores pending ops from the last visit on mount and sends them", async () => {
      const tap = { id: "99999999-9999-9999-9999-000000000009", tappedOnSlide: 3, tappedAt: "2026-10-26T14:00:00.000Z" };
      localStorage.setItem(KEY, JSON.stringify([{ op: "insert", tap }]));
      const { send, lastSpots } = setup();
      await settle();
      expect(ops(send)).toEqual([{ op: "insert", tap }]);
      expect(lastSpots()).toEqual([3]);
      expect(screen.queryByText(/Saved slide/)).not.toBeInTheDocument();
    });

    it("works with localStorage blocked", async () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("denied");
      });
      const { send } = setup();
      await settle();
      press();
      await settle();
      expect(screen.getByText("Saved slide 7")).toBeInTheDocument();
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("lets an unexpected error from send through to the error boundary", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const send = vi.fn<Send>(async () => {
        throw new Error("boom");
      });
      render(
        <Boundary>
          <LostButton lectureId={LECTURE} viewing={7} send={send} loadOwn={async () => []} onSpots={() => {}} />
        </Boundary>,
      );
      await settle();
      press();
      await settle();
      expect(screen.getByText("Caught: boom")).toBeInTheDocument();
    });
  });

  describe("when the page goes away", () => {
    it("sets backtrack:rejected:<lectureId> when a send is rejected after it unmounted", async () => {
      sessionStorage.clear();
      let finish: (r: SendResult) => void = () => {};
      const send = vi.fn<Send>(() => new Promise<SendResult>((r) => (finish = r)));
      const { unmount } = setup({ send });
      await settle();
      press();
      await settle();
      unmount();
      await act(async () => finish("rejected"));
      expect(sessionStorage.getItem(`backtrack:rejected:${LECTURE}`)).toBe("1");
    });

    it("hands its flush to the page, which can wait on it, and a rejection then sets the key", async () => {
      sessionStorage.clear();
      let flush: ((ending?: boolean) => Promise<void>) | undefined;
      const send = vi.fn<Send>().mockResolvedValueOnce("offline").mockResolvedValue("rejected");
      setup({ send, onFlushReady: (f) => (flush = f) });
      await settle();
      press();
      await settle();
      await act(async () => flush?.(true));
      expect(send).toHaveBeenCalledTimes(2);
      expect(sessionStorage.getItem(`backtrack:rejected:${LECTURE}`)).toBe("1");
    });

    it("does not set the key for a rejection while the page is still open", async () => {
      sessionStorage.clear();
      setup({ send: vi.fn<Send>(async () => "rejected") });
      await settle();
      press();
      await settle();
      expect(sessionStorage.getItem(`backtrack:rejected:${LECTURE}`)).toBeNull();
    });
  });

  describe("spots", () => {
    it("reports the rows the student already has, from loadOwn", async () => {
      const { lastSpots } = setup({ loadOwn: vi.fn(async () => [{ id: "a", slide: 3 }, { id: "b", slide: 5 }]) });
      await settle();
      expect(lastSpots()).toEqual([3, 5]);
    });

    it("merges a new tap with loaded rows and an undo only takes away its own dot", async () => {
      const { lastSpots } = setup({ loadOwn: vi.fn(async () => [{ id: "a", slide: 7 }]) });
      await settle();
      press();
      expect(lastSpots()).toEqual([7]);
      undo();
      expect(lastSpots()).toEqual([7]);
    });

    it("tries loading again on the online event when the first load was offline", async () => {
      const loadOwn = vi.fn<() => Promise<{ id: string; slide: number }[] | null>>().mockResolvedValueOnce(null);
      loadOwn.mockResolvedValue([{ id: "a", slide: 2 }]);
      const { lastSpots } = setup({ loadOwn });
      await settle();
      expect(lastSpots()).toEqual([]);
      act(() => {
        window.dispatchEvent(new Event("online"));
      });
      await settle();
      expect(lastSpots()).toEqual([2]);
      expect(loadOwn).toHaveBeenCalledTimes(2);
    });

    it("does not bring back a dot for a tap the student undid while the load was running", async () => {
      let resolveLoad: (rows: { id: string; slide: number }[]) => void = () => {};
      const send = okSend();
      const loadOwn = vi.fn(() => new Promise<{ id: string; slide: number }[] | null>((r) => (resolveLoad = r)));
      const { lastSpots } = setup({ send, loadOwn });
      press();
      await settle();
      const [insert] = ops(send);
      if (insert.op !== "insert") throw new Error("expected an insert");
      undo();
      await act(async () => resolveLoad([{ id: insert.tap.id, slide: 7 }]));
      expect(lastSpots()).toEqual([]);
    });
  });

  it("puts what it is given before and after the button", async () => {
    setup({ before: <span>BEFORE</span>, after: <span>AFTER</span> });
    await settle();
    const row = screen.getByRole("button", { name: "I'm lost" }).parentElement as HTMLElement;
    expect(row.textContent).toBe("BEFOREI'm lostAFTER");
  });

  it("keeps a row of the same height before and after a tap", async () => {
    const { container } = setup();
    await settle();
    const bar = container.querySelector("[data-bar]") as HTMLElement;
    const before = bar.className;
    press();
    expect(container.querySelector("[data-bar]")).toBe(bar);
    expect(bar.className).toBe(before);
    expect(bar.className).toMatch(/\bh-\d+/);
  });
});
