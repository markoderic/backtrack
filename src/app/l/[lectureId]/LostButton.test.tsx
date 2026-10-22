import { Component, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { QueueOp, SendResult } from "@/lib/tapQueue";
import { LostButton, UNDO_WINDOW_MS, type Spot } from "./LostButton";

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
  const onSpots = vi.fn<(s: Spot[]) => void>();
  const loadOwn = vi.fn(async () => [] as { id: string; slide: number; kind?: "lost" | "save" }[] | null);
  const view = render(
    <LostButton lectureId={LECTURE} viewing={7} send={send} loadOwn={loadOwn} onSpots={onSpots} {...over} />,
  );
  // The slides that have a dot (one per slide, however many rows it has).
  const lastSpots = () => [...new Set((onSpots.mock.lastCall?.[0] ?? []).map((x) => x.slide))].sort((a, b) => a - b);
  return { ...view, send, onSpots, loadOwn, lastSpots };
}

const press = () => fireEvent.click(screen.getByRole("button", { name: "I'm lost" }));
const undo = () => fireEvent.click(screen.getByRole("button", { name: "Undo" }));
const settle = () => act(async () => {});
const noteField = () => screen.getByRole("textbox", { name: "Add a note" });
const typeNote = (text: string) => fireEvent.change(noteField(), { target: { value: text } });
// Enter in the note field submits its form.
const sendNote = () => fireEvent.submit(noteField().closest("form") as HTMLFormElement);
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

  describe("10 second window", () => {
    it("is 10 seconds", () => {
      expect(UNDO_WINDOW_MS).toBe(10000);
    });

    it("closes the bar and the Undo button after 10 seconds", async () => {
      vi.useFakeTimers();
      setup();
      await settle();
      press();
      await act(async () => vi.advanceTimersByTime(9999));
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
      await act(async () => vi.advanceTimersByTime(10000));
      expect(lastSpots()).toEqual([7]);
    });

    it("a new tap starts a new window and the old Undo no longer applies", async () => {
      vi.useFakeTimers();
      const { send } = setup({ viewing: 7 });
      await settle();
      press();
      await act(async () => vi.advanceTimersByTime(6000));
      press();
      await act(async () => vi.advanceTimersByTime(6000));
      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
      await act(async () => vi.advanceTimersByTime(4000));
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
      expect(ops(send).filter((o) => o.op === "insert")).toHaveLength(2);
    });

    it("stays open while a note is being typed, and 10 seconds after it is sent", async () => {
      vi.useFakeTimers();
      setup();
      await settle();
      press();
      await act(async () => vi.advanceTimersByTime(9000));
      typeNote("the second step");
      await act(async () => vi.advanceTimersByTime(30000));
      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
      sendNote();
      await act(async () => vi.advanceTimersByTime(9999));
      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
      await act(async () => vi.advanceTimersByTime(1));
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    });

    it("Esc drops the note being typed and the 10 seconds start over", async () => {
      vi.useFakeTimers();
      const { send } = setup();
      await settle();
      press();
      typeNote("never mind");
      await act(async () => vi.advanceTimersByTime(20000));
      fireEvent.keyDown(noteField(), { key: "Escape" });
      expect(noteField()).toHaveValue("");
      await act(async () => vi.advanceTimersByTime(9999));
      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
      await act(async () => vi.advanceTimersByTime(1));
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
      // The tap stays, no note went out.
      expect(ops(send).map((o) => o.op)).toEqual(["insert"]);
    });

    it("a focused empty note field holds the line open; blurring it lets the 10 seconds run", async () => {
      vi.useFakeTimers();
      setup();
      await settle();
      press();
      fireEvent.focus(noteField());
      await act(async () => vi.advanceTimersByTime(30000));
      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
      fireEvent.blur(noteField());
      await act(async () => vi.advanceTimersByTime(9999));
      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
      await act(async () => vi.advanceTimersByTime(1));
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    });

    it("spaces alone in an unfocused field do not hold the line open", async () => {
      vi.useFakeTimers();
      setup();
      await settle();
      press();
      typeNote("   ");
      await act(async () => vi.advanceTimersByTime(10000));
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    });

    it("closes on the next slide, but not while a note is being typed", async () => {
      const { rerender, send, loadOwn, onSpots, lastSpots } = setup({ viewing: 7 });
      await settle();
      press();
      rerender(<LostButton lectureId={LECTURE} viewing={8} send={send} loadOwn={loadOwn} onSpots={onSpots} />);
      expect(screen.queryByText("Saved slide 7")).not.toBeInTheDocument();
      press();
      expect(screen.getByText("Saved slide 8")).toBeInTheDocument();
      typeNote("hm");
      rerender(<LostButton lectureId={LECTURE} viewing={9} send={send} loadOwn={loadOwn} onSpots={onSpots} />);
      expect(screen.getByText("Saved slide 8")).toBeInTheDocument();
      // The dots stay either way.
      expect(lastSpots()).toEqual([7, 8]);
    });
  });

  describe("note", () => {
    it("is the saved line: Saved slide 7, a one line Add a note field limited to 140 characters, Undo, and no Save button", async () => {
      setup();
      await settle();
      press();
      const input = screen.getByPlaceholderText("Add a note");
      expect(input).toBe(noteField());
      expect(input).toHaveAttribute("maxLength", "140");
      expect(input.tagName).toBe("INPUT");
      expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
      const line = screen.getByText("Saved slide 7").parentElement as HTMLElement;
      expect(line).toContainElement(input);
      expect(line).toContainElement(screen.getByRole("button", { name: "Undo" }));
    });

    it("Enter queues a note update for the tap and sends it", async () => {
      const { send } = setup();
      await settle();
      press();
      await settle();
      typeNote("  the second step  ");
      sendNote();
      await settle();
      const [insert, update] = ops(send);
      if (insert.op !== "insert") throw new Error("expected an insert");
      expect(update).toEqual({ op: "update", id: insert.tap.id, patch: { note: "the second step" } });
      expect(screen.getByText("Note saved:")).toBeInTheDocument();
      expect(screen.getByText("the second step")).toBeInTheDocument();
      expect(screen.queryByPlaceholderText("Add a note")).not.toBeInTheDocument();
    });

    it("Enter does nothing for a blank note", async () => {
      const { send } = setup();
      await settle();
      press();
      await settle();
      sendNote();
      typeNote("   ");
      sendNote();
      await settle();
      expect(send).toHaveBeenCalledTimes(1);
      expect(noteField()).toBeInTheDocument();
    });

    it("Undo after a note on an unsent tap sends neither", async () => {
      const send = vi.fn<Send>(async () => "offline");
      setup({ send });
      await settle();
      press();
      await settle();
      typeNote("x");
      sendNote();
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

    it("tells the page each time the database refuses a send, so it can check whether the lecture ended", async () => {
      const onRejected = vi.fn();
      setup({ send: vi.fn<Send>(async () => "rejected"), onRejected });
      await settle();
      expect(onRejected).not.toHaveBeenCalled();
      press();
      await settle();
      expect(onRejected).toHaveBeenCalledTimes(1);
      press();
      await settle();
      expect(onRejected).toHaveBeenCalledTimes(2);
    });

    it("does not tell the page about a send that went through or is only offline", async () => {
      const onRejected = vi.fn();
      setup({ send: vi.fn<Send>().mockResolvedValueOnce("ok").mockResolvedValue("offline"), onRejected });
      await settle();
      press();
      await settle();
      press();
      await settle();
      expect(onRejected).not.toHaveBeenCalled();
    });

    it("does not tell the page about a refusal in the flush it runs while leaving", async () => {
      const onRejected = vi.fn();
      let flush: ((ending?: boolean) => Promise<void>) | undefined;
      const send = vi.fn<Send>().mockResolvedValueOnce("offline").mockResolvedValue("rejected");
      setup({ send, onRejected, onFlushReady: (f) => (flush = f) });
      await settle();
      press();
      await settle();
      await act(async () => flush?.(true));
      expect(send).toHaveBeenCalledTimes(2);
      expect(onRejected).not.toHaveBeenCalled();
    });
  });

  describe("a server that keeps turning a tap away (401 login gone, 429 too many requests)", () => {
    const TAP_FAILED = "This one didn't save. Try again.";

    it("tries again after 2, 4 and 8 seconds, then drops it with a notice, and later taps still save", async () => {
      vi.useFakeTimers();
      const onRejected = vi.fn();
      let first: string | undefined;
      const send = vi.fn<Send>(async (op) => {
        if (op.op !== "insert") return "ok";
        first ??= op.tap.id;
        return op.tap.id === first ? "throttled" : "ok";
      });
      const { lastSpots } = setup({ send, onRejected });
      await settle();
      press();
      await settle();
      expect(send).toHaveBeenCalledTimes(1);
      expect(lastSpots()).toEqual([7]);
      // A second tap waits behind the first, and does not cut the wait short.
      press();
      await settle();
      expect(send).toHaveBeenCalledTimes(1);
      await act(async () => vi.advanceTimersByTime(2000));
      expect(send).toHaveBeenCalledTimes(2);
      await act(async () => vi.advanceTimersByTime(4000));
      expect(send).toHaveBeenCalledTimes(3);
      expect(screen.queryByText(TAP_FAILED)).not.toBeInTheDocument();
      await act(async () => vi.advanceTimersByTime(8000));
      // The 4th try is the last: the first tap is dropped and the second one goes out.
      const inserts = send.mock.calls.map((c) => c[0]).filter((o) => o.op === "insert");
      expect(inserts).toHaveLength(5);
      expect(new Set(inserts.map((o) => (o.op === "insert" ? o.tap.id : "")))).toHaveProperty("size", 2);
      expect(screen.getByRole("alert")).toHaveTextContent(TAP_FAILED);
      expect(lastSpots()).toEqual([7]); // the second tap's dot stays
      expect(onRejected).not.toHaveBeenCalled();
      expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toEqual([]);
      // Nothing is left to retry.
      await act(async () => vi.advanceTimersByTime(60000));
      expect(send.mock.calls.filter((c) => c[0].op === "insert")).toHaveLength(5);
    });

    it("stops trying when the page goes away", async () => {
      vi.useFakeTimers();
      const send = vi.fn<Send>(async () => "throttled");
      const { unmount } = setup({ send });
      await settle();
      press();
      await settle();
      unmount();
      await act(async () => vi.advanceTimersByTime(60000));
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  describe("taps over the limit (too many from one student)", () => {
    const TOO_MANY = "Too many taps. Try again in a minute.";

    it("says too many taps, takes the dot away, sends it once and never again", async () => {
      const send = vi.fn<Send>(async () => "limited");
      const { lastSpots } = setup({ send });
      await settle();
      press();
      await settle();
      expect(screen.getByRole("alert")).toHaveTextContent(TOO_MANY);
      expect(screen.queryByText(REJECTED)).not.toBeInTheDocument();
      expect(lastSpots()).toEqual([]);
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
      expect(send).toHaveBeenCalledTimes(1);
      // Dropped from the queue: nothing is left to send on reconnect or online.
      expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toEqual([]);
      await act(async () => window.dispatchEvent(new Event("online")));
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("does not ask the page to check for the end, and leaves no note for the spots page", async () => {
      sessionStorage.clear();
      const onRejected = vi.fn();
      let flush: ((ending?: boolean) => Promise<void>) | undefined;
      setup({ send: vi.fn<Send>(async () => "limited"), onRejected, onFlushReady: (f) => (flush = f) });
      await settle();
      press();
      await settle();
      expect(onRejected).not.toHaveBeenCalled();
      await act(async () => flush?.(true));
      expect(sessionStorage.getItem(`backtrack:rejected:${LECTURE}`)).toBeNull();
    });

    it("says so differently for the 300 taps a lecture limit", async () => {
      setup({ send: vi.fn<Send>(async () => "capped") });
      await settle();
      press();
      await settle();
      expect(screen.getByRole("alert")).toHaveTextContent("Too many taps in this lecture.");
      expect(screen.queryByText(TOO_MANY)).not.toBeInTheDocument();
      expect(screen.queryByText(REJECTED)).not.toBeInTheDocument();
    });

    it("a later tap that saves clears the message", async () => {
      const send = vi.fn<Send>().mockResolvedValueOnce("limited").mockResolvedValue("ok");
      setup({ send });
      await settle();
      press();
      await settle();
      expect(screen.getByText(TOO_MANY)).toBeInTheDocument();
      press();
      await settle();
      expect(screen.queryByText(TOO_MANY)).not.toBeInTheDocument();
      expect(screen.getByText("Saved slide 7")).toBeInTheDocument();
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

    it("sets the key when the page leaves after a tap was refused while it was open", async () => {
      sessionStorage.clear();
      let flush: ((ending?: boolean) => Promise<void>) | undefined;
      setup({ send: vi.fn<Send>(async () => "rejected"), onFlushReady: (f) => (flush = f) });
      await settle();
      press();
      await settle();
      expect(screen.getByText(REJECTED)).toBeInTheDocument();
      expect(sessionStorage.getItem(`backtrack:rejected:${LECTURE}`)).toBeNull();
      // Nothing is left in the queue for the leaving flush to refuse.
      await act(async () => flush?.(true));
      expect(sessionStorage.getItem(`backtrack:rejected:${LECTURE}`)).toBe("1");
    });

    it("does not set the key on leaving when only an update was refused", async () => {
      sessionStorage.clear();
      let flush: ((ending?: boolean) => Promise<void>) | undefined;
      const send = vi.fn<Send>(async (op) => (op.op === "update" ? "rejected" : "ok"));
      setup({ send, onFlushReady: (f) => (flush = f) });
      await settle();
      press();
      await settle();
      undo();
      await settle();
      await act(async () => flush?.(true));
      expect(sessionStorage.getItem(`backtrack:rejected:${LECTURE}`)).toBeNull();
    });

    it("notes a tap refused while open before waiting on the leaving flush, which may never come back in time", async () => {
      sessionStorage.clear();
      let flush: ((ending?: boolean) => Promise<void>) | undefined;
      // The first tap is refused while the page is open; the second one's send hangs.
      const send = vi.fn<Send>().mockResolvedValueOnce("rejected").mockImplementation(() => new Promise<SendResult>(() => {}));
      setup({ send, onFlushReady: (f) => (flush = f) });
      await settle();
      press();
      await settle();
      expect(screen.getByText(REJECTED)).toBeInTheDocument();
      press();
      await settle();
      // Not awaited: the leaving flush is stuck behind the hung send.
      void act(() => {
        void flush?.(true);
      });
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

  it("puts the button alone in its 104 px row, centered, above the saved row", async () => {
    const { container } = setup();
    await settle();
    const row = screen.getByRole("button", { name: "I'm lost" }).parentElement as HTMLElement;
    expect(row.children).toHaveLength(1);
    expect(row.className).toMatch(/\bh-26\b/);
    expect(row.className).toContain("justify-center");
    const bar = container.querySelector("[data-bar]") as HTMLElement;
    expect(row.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows idle content (Reconnecting…) in the saved row only while there is nothing else to say", async () => {
    setup({ idle: <p>Reconnecting…</p> });
    await settle();
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
    press();
    expect(screen.queryByText("Reconnecting…")).not.toBeInTheDocument();
    expect(screen.getByText("Saved slide 7")).toBeInTheDocument();
  });

  it("tells the page about each tap only after the tap is in the queue", async () => {
    // The send never finishes, so the op stays in the queue (localStorage) and we can see it was there first.
    const send = vi.fn<Send>(() => new Promise<SendResult>(() => {}));
    const queuedWhenTold: number[] = [];
    const onTap = vi.fn(() => {
      queuedWhenTold.push(JSON.parse(localStorage.getItem(KEY) ?? "[]").length);
    });
    setup({ send, onTap });
    await settle();
    press();
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap).toHaveBeenCalledWith("lost");
    expect(queuedWhenTold).toEqual([1]);
  });

  it("shows Saved on the button right after a press (ring and check)", async () => {
    vi.useFakeTimers();
    setup();
    await settle();
    press();
    const button = screen.getByRole("button", { name: "I'm lost" });
    expect(button).toHaveAttribute("data-phase", "pressed");
    await act(async () => vi.advanceTimersByTime(120));
    expect(button).toHaveAttribute("data-phase", "saved");
    await act(async () => vi.advanceTimersByTime(2000));
    expect(button).toHaveAttribute("data-phase", "default");
  });

  describe("from the highlight menu", () => {
    const RECT = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    function withAdd(over: Partial<Parameters<typeof LostButton>[0]> = {}) {
      let add: ((h: { kind: "lost" | "save"; rect: typeof RECT }) => void) | undefined;
      const onBarChange = vi.fn();
      const onTap = vi.fn();
      const view = setup({ onAddReady: (a) => (add = a), onBarChange, onTap, ...over });
      return { ...view, add: (kind: "lost" | "save") => act(() => add?.({ kind, rect: RECT })), onBarChange, onTap };
    }

    it("I'm lost gives the button its Saved look and reports the box for the slide", async () => {
      vi.useFakeTimers();
      const { add, onBarChange, onTap } = withAdd();
      await settle();
      add("lost");
      expect(screen.getByRole("button", { name: "I'm lost" })).toHaveAttribute("data-phase", "saved");
      expect(screen.getByText("Saved slide 7")).toBeInTheDocument();
      expect(onBarChange).toHaveBeenLastCalledWith({ slide: 7, kind: "lost", rect: RECT });
      expect(onTap).toHaveBeenCalledWith("lost");
      await act(async () => vi.advanceTimersByTime(2000));
      expect(screen.getByRole("button", { name: "I'm lost" })).toHaveAttribute("data-phase", "default");
    });

    it("Save this leaves the button as it is and says it is just for you", async () => {
      const { add, onBarChange, onTap, lastSpots, onSpots } = withAdd();
      await settle();
      add("save");
      expect(screen.getByRole("button", { name: "I'm lost" })).toHaveAttribute("data-phase", "default");
      expect(screen.getByText("Saved slide 7, just for you")).toBeInTheDocument();
      expect(onBarChange).toHaveBeenLastCalledWith({ slide: 7, kind: "save", rect: RECT });
      expect(onTap).toHaveBeenCalledWith("save");
      expect(lastSpots()).toEqual([7]);
      expect(onSpots.mock.lastCall?.[0]).toEqual([{ slide: 7, kind: "save" }]);
    });

    it("reports null when the saved line goes (Undo)", async () => {
      const { add, onBarChange } = withAdd();
      await settle();
      add("lost");
      undo();
      expect(onBarChange).toHaveBeenLastCalledWith(null);
    });
  });

  describe("screen readers and keyboard", () => {
    it("says each save in a status line that is always there, a new line per tap even on the same slide", async () => {
      setup();
      await settle();
      const status = screen.getByRole("status");
      expect(status).toHaveTextContent(/^$/);
      press();
      expect(screen.getByRole("status")).toBe(status);
      expect(status).toHaveTextContent("Saved slide 7.");
      const first = status.firstElementChild;
      press();
      expect(status).toHaveTextContent("Saved slide 7.");
      expect(status.firstElementChild).not.toBe(first);
    });

    it("says the note was saved, and says nothing once the line is gone", async () => {
      setup();
      await settle();
      press();
      typeNote("too fast");
      sendNote();
      expect(screen.getByRole("status")).toHaveTextContent("Saved slide 7. Note saved.");
      undo();
      expect(screen.getByRole("status")).toHaveTextContent(/^$/);
    });

    it("puts focus back on I'm lost after Undo, so it never falls to the page", async () => {
      setup();
      await settle();
      press();
      const button = screen.getByRole("button", { name: "Undo" });
      act(() => button.focus());
      undo();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "I'm lost" }));
    });

    it("puts focus back on I'm lost after Enter sends the note", async () => {
      setup();
      await settle();
      press();
      act(() => noteField().focus());
      typeNote("too fast");
      sendNote();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "I'm lost" }));
    });

    it("puts focus back on I'm lost when the saved line closes by itself while Undo has focus", async () => {
      vi.useFakeTimers();
      setup();
      await settle();
      press();
      act(() => screen.getByRole("button", { name: "Undo" }).focus());
      await act(async () => {
        vi.advanceTimersByTime(UNDO_WINDOW_MS);
      });
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "I'm lost" }));
    });

    it("leaves focus alone when it went somewhere else first", async () => {
      const { container } = render(<button type="button">Elsewhere</button>);
      setup();
      await settle();
      press();
      act(() => screen.getByRole("button", { name: "Undo" }).focus());
      const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
      act(() => elsewhere.focus());
      undo();
      expect(document.activeElement).toBe(elsewhere);
      expect(container).toBeTruthy();
    });
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
