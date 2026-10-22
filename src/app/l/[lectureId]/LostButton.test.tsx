import { Component, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import type { Rect } from "@/lib/rect";
import type { QueueOp, SendResult } from "@/lib/tapQueue";
import { LostButton, NOTE_MAX, type Spot } from "./LostButton";

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
const RECT: Rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };

type Send = (op: QueueOp) => Promise<SendResult>;
type Row = { id: string; slide: number; kind?: "lost" | "save"; note?: string; rect?: Rect };
const okSend = () => vi.fn<Send>(async () => "ok");
type Props = Parameters<typeof LostButton>[0];

function setup(over: Partial<Props> = {}) {
  const send = (over.send as ReturnType<typeof okSend> | undefined) ?? okSend();
  const onSpots = vi.fn<(s: Spot[]) => void>();
  const loadOwn = vi.fn(async () => [] as Row[] | null);
  let mark: ((rect: Rect) => void) | undefined;
  const onMarkingChange = vi.fn();
  const base: Props = {
    lectureId: LECTURE,
    viewing: 7,
    send,
    loadOwn,
    onSpots,
    onMarkingChange,
    onMarkReady: (m) => (mark = m),
    ...over,
  };
  const view = render(<LostButton {...base} />);
  // The slides that have a dot (one per slide, however many rows it has).
  const lastSpots = () => [...new Set((onSpots.mock.lastCall?.[0] ?? []).map((x) => x.slide))].sort((a, b) => a - b);
  const show = (more: Partial<Props>) => view.rerender(<LostButton {...base} {...more} />);
  return { ...view, send, onSpots, loadOwn, lastSpots, show, onMarkingChange, mark: (r: Rect) => act(() => mark?.(r)) };
}

const press = () => fireEvent.click(screen.getByRole("button", { name: "I'm lost" }));
const checked = (n = 7) => screen.getByRole("button", { name: `Lost on slide ${n}` });
const undo = () => fireEvent.click(screen.getByRole("button", { name: "Undo" }));
const settle = () => act(async () => {});
const noteField = () => screen.getByRole("textbox", { name: /Your note/ });
const typeNote = (text: string) => fireEvent.change(noteField(), { target: { value: text } });
const saveNote = () => fireEvent.click(screen.getByRole("button", { name: "Save note" }));
const ops = (send: ReturnType<typeof okSend>) => send.mock.calls.map((c) => c[0]);
const status = () => screen.getByRole("status");

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LostButton", () => {
  it("is the I'm lost button and Save this, and nothing else until one is pressed", async () => {
    setup();
    await settle();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["I'm lost", "Save this"]);
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("checks the button right away (Lost on slide 7), before the send has resolved, with the spot's tools", async () => {
    const send = vi.fn<Send>(() => new Promise<SendResult>(() => {}));
    setup({ send });
    await settle();
    press();
    // Straight away, in the same tick as the press: the send has not even started.
    expect(checked()).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a note" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark the spot" })).toBeInTheDocument();
    // Save this is not offered on a slide that is already lost (it is in My spots already).
    expect(screen.queryByRole("button", { name: "Save this" })).not.toBeInTheDocument();
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("records the slide being viewed, with a browser made id and time, and no kind or box", async () => {
    const { send } = setup({ viewing: 4 });
    await settle();
    press();
    await settle();
    expect(checked(4)).toBeInTheDocument();
    const [op] = ops(send);
    expect(op).toMatchObject({ op: "insert", tap: { tappedOnSlide: 4 } });
    if (op.op !== "insert") throw new Error("expected an insert");
    expect(op.tap.kind).toBeUndefined();
    expect(op.tap.rect).toBeUndefined();
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
    expect(screen.getByRole("button", { name: "I'm lost" })).not.toHaveAttribute("aria-keyshortcuts");
    expect(screen.queryByText(/^L$/)).not.toBeInTheDocument();
  });

  describe("one tap per slide", () => {
    it("a second press on the same slide records nothing", async () => {
      const { send, lastSpots } = setup();
      await settle();
      press();
      fireEvent.click(checked());
      fireEvent.click(checked());
      await settle();
      expect(ops(send).filter((o) => o.op === "insert")).toHaveLength(1);
      expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toEqual([]);
      expect(lastSpots()).toEqual([7]);
    });

    it("another slide shows the normal button for that slide, and coming back shows it checked again", async () => {
      const { show } = setup();
      await settle();
      press();
      show({ viewing: 8 });
      expect(screen.getByRole("button", { name: "I'm lost" })).not.toHaveAttribute("aria-disabled");
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
      show({ viewing: 7 });
      expect(checked()).toBeInTheDocument();
    });

    it("a slide that already has a saved row (from before, or another visit) is checked on load", async () => {
      setup({ loadOwn: vi.fn(async () => [{ id: "a", slide: 7, kind: "lost" as const }]) });
      await settle();
      expect(checked()).toBeInTheDocument();
      fireEvent.click(checked());
      await settle();
      expect(screen.queryByRole("button", { name: "I'm lost" })).not.toBeInTheDocument();
    });

    it("Undo gives the button back, and a new tap then records again", async () => {
      const { send } = setup();
      await settle();
      press();
      await settle();
      undo();
      press();
      await settle();
      expect(ops(send).filter((o) => o.op === "insert")).toHaveLength(2);
      expect(checked()).toBeInTheDocument();
    });
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
      expect(screen.getByRole("button", { name: "I'm lost" })).not.toHaveAttribute("aria-disabled");
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

    it("is still there later: the checked state stays for the slide (no 10 second window)", async () => {
      vi.useFakeTimers();
      setup();
      await settle();
      press();
      await act(async () => vi.advanceTimersByTime(60_000));
      expect(checked()).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    });

    it("takes back every I'm lost row on the slide, so an old slide with two gets its button back", async () => {
      const { send } = setup({
        loadOwn: vi.fn(async () => [
          { id: "a", slide: 7, kind: "lost" as const },
          { id: "b", slide: 7, kind: "lost" as const },
          { id: "c", slide: 7, kind: "save" as const },
        ]),
      });
      await settle();
      undo();
      await settle();
      expect(ops(send)).toEqual([
        { op: "update", id: "a", patch: { undone: true } },
        { op: "update", id: "b", patch: { undone: true } },
      ]);
      // The save on the same slide stays, and its tools take over.
      expect(screen.getByRole("button", { name: "I'm lost" })).not.toHaveAttribute("aria-disabled");
      expect(screen.getByText("Saved slide 7, just for you")).toBeInTheDocument();
    });
  });

  describe("note", () => {
    it("Add a note is a real button that opens a 3 line field limited to 140 characters, with Save note", async () => {
      setup();
      await settle();
      press();
      const add = screen.getByRole("button", { name: "Add a note" });
      expect(add.className).toContain("border-hairline");
      expect(add.className).not.toContain("underline");
      fireEvent.click(add);
      const field = noteField();
      expect(field.tagName).toBe("TEXTAREA");
      expect(field).toHaveAttribute("rows", "3");
      expect(field).toHaveAttribute("maxLength", String(NOTE_MAX));
      expect(field).toHaveFocus();
      expect(screen.getByRole("button", { name: "Save note" })).toBeInTheDocument();
      // Notes are in Geist (type-body), not the italic serif.
      expect(field.className).toContain("type-body");
      expect(field.className).not.toContain("type-note");
    });

    it("shows a quiet counter only near the limit", async () => {
      setup();
      await settle();
      press();
      fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
      typeNote("a".repeat(119));
      expect(screen.queryByText(/left$/)).not.toBeInTheDocument();
      typeNote("a".repeat(130));
      expect(screen.getByText("10 left")).toBeInTheDocument();
    });

    it("Save note queues a note update for the tap, shows the note as text with Edit note, and says Note saved.", async () => {
      const { send, onSpots } = setup();
      await settle();
      press();
      await settle();
      fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
      typeNote("  why is this a credit  ");
      saveNote();
      await settle();
      const [insert, update] = ops(send);
      if (insert.op !== "insert") throw new Error("expected an insert");
      expect(update).toEqual({ op: "update", id: insert.tap.id, patch: { note: "why is this a credit" } });
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      const shown = document.querySelector("[data-note]") as HTMLElement;
      expect(shown).toHaveTextContent("why is this a credit");
      expect(shown.querySelector(".type-body")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Edit note" })).toHaveFocus();
      expect(status()).toHaveTextContent("Note saved.");
      expect(onSpots.mock.lastCall?.[0][0]).toMatchObject({ slide: 7, note: "why is this a credit" });
    });

    it("Enter saves, Shift+Enter does not, Esc drops the changes", async () => {
      const { send } = setup();
      await settle();
      press();
      await settle();
      fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
      typeNote("first");
      fireEvent.keyDown(noteField(), { key: "Enter", shiftKey: true });
      expect(noteField()).toBeInTheDocument();
      fireEvent.keyDown(noteField(), { key: "Escape" });
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add a note" })).toHaveFocus();
      fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
      expect(noteField()).toHaveValue("");
      typeNote("second");
      fireEvent.keyDown(noteField(), { key: "Enter" });
      await settle();
      expect(ops(send).filter((o) => o.op === "update")).toEqual([
        expect.objectContaining({ patch: { note: "second" } }),
      ]);
    });

    it("Edit note opens the field with the note, and saving it sends the new text", async () => {
      const { send } = setup({ loadOwn: vi.fn(async () => [{ id: "a", slide: 7, kind: "lost" as const, note: "old" }]) });
      await settle();
      expect(screen.getByText("old")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
      expect(noteField()).toHaveValue("old");
      typeNote("new");
      saveNote();
      await settle();
      expect(ops(send)).toEqual([{ op: "update", id: "a", patch: { note: "new" } }]);
      expect(screen.getByText("new")).toBeInTheDocument();
    });

    it("saving an unchanged or blank note sends nothing new", async () => {
      const { send } = setup();
      await settle();
      press();
      await settle();
      fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
      typeNote("   ");
      saveNote();
      await settle();
      expect(ops(send).filter((o) => o.op === "update")).toEqual([]);
      expect(screen.getByRole("button", { name: "Add a note" })).toBeInTheDocument();
    });

    it("keeps a note being typed when the slide changes, and saves it on the slide it was for", async () => {
      const { send, show } = setup();
      await settle();
      press();
      await settle();
      fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
      typeNote("half a tho");
      show({ viewing: 8 });
      expect(noteField()).toHaveValue("half a tho");
      expect(screen.getByText("Your note on slide 7")).toBeInTheDocument();
      // The button is for slide 8 now.
      expect(screen.getByRole("button", { name: "I'm lost" })).not.toHaveAttribute("aria-disabled");
      typeNote("half a thought");
      saveNote();
      await settle();
      const [insert, update] = ops(send);
      if (insert.op !== "insert") throw new Error("expected an insert");
      expect(insert.tap.tappedOnSlide).toBe(7);
      expect(update).toEqual({ op: "update", id: insert.tap.id, patch: { note: "half a thought" } });
    });

    it("Undo after a note on an unsent tap sends neither", async () => {
      const send = vi.fn<Send>(async () => "offline");
      setup({ send });
      await settle();
      press();
      await settle();
      fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
      typeNote("hello");
      saveNote();
      await settle();
      undo();
      await settle();
      expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toEqual([]);
    });
  });

  describe("Mark the spot", () => {
    it("turns marking on, and the box from the slide is saved at once as an update of the tap", async () => {
      const { send, onMarkingChange, mark, show, onSpots } = setup();
      await settle();
      press();
      await settle();
      fireEvent.click(screen.getByRole("button", { name: "Mark the spot" }));
      expect(onMarkingChange).toHaveBeenLastCalledWith(true);
      show({ marking: true });
      expect(screen.getByRole("button", { name: "Stop marking" })).toHaveAttribute("aria-pressed", "true");
      mark(RECT);
      await settle();
      const [insert, update] = ops(send);
      if (insert.op !== "insert") throw new Error("expected an insert");
      expect(update).toEqual({ op: "update", id: insert.tap.id, patch: { rect: RECT } });
      expect(onMarkingChange).toHaveBeenLastCalledWith(false);
      expect(onSpots.mock.lastCall?.[0][0]).toMatchObject({ slide: 7, rect: RECT });
      show({ marking: false });
      expect(screen.getByRole("button", { name: "Clear mark" })).toBeInTheDocument();
      expect(status()).toHaveTextContent("Spot marked.");
    });

    it("Stop marking turns it off without saving anything", async () => {
      const { send, onMarkingChange, show } = setup();
      await settle();
      press();
      await settle();
      show({ marking: true });
      fireEvent.click(screen.getByRole("button", { name: "Stop marking" }));
      expect(onMarkingChange).toHaveBeenLastCalledWith(false);
      expect(ops(send).filter((o) => o.op === "update")).toEqual([]);
    });

    it("Clear mark sends rect null and offers Mark the spot again", async () => {
      const { send } = setup({ loadOwn: vi.fn(async () => [{ id: "a", slide: 7, kind: "lost" as const, rect: RECT }]) });
      await settle();
      const button = screen.getByRole("button", { name: "Clear mark" });
      fireEvent.click(button);
      await settle();
      expect(ops(send)).toEqual([{ op: "update", id: "a", patch: { rect: null } }]);
      expect(screen.getByRole("button", { name: "Mark the spot" })).toBe(button);
      expect(status()).toHaveTextContent("Mark cleared.");
    });

    it("Add a note while marking turns marking off (Stop marking is hidden while the note is open)", async () => {
      const { onMarkingChange, show } = setup();
      await settle();
      press();
      show({ marking: true });
      onMarkingChange.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
      expect(onMarkingChange).toHaveBeenLastCalledWith(false);
    });

    it("Undo while marking turns marking off", async () => {
      const { onMarkingChange, show } = setup();
      await settle();
      press();
      show({ marking: true });
      undo();
      expect(onMarkingChange).toHaveBeenLastCalledWith(false);
    });

    it("does nothing with a box when the slide has no spot", async () => {
      const { send, mark } = setup();
      await settle();
      mark(RECT);
      await settle();
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe("Save this", () => {
    it("records a private save on the slide, says it is just for you, and leaves I'm lost as it is", async () => {
      const onTap = vi.fn();
      const { send, onSpots } = setup({ onTap });
      await settle();
      fireEvent.click(screen.getByRole("button", { name: "Save this" }));
      await settle();
      const [op] = ops(send);
      expect(op).toMatchObject({ op: "insert", tap: { tappedOnSlide: 7, kind: "save" } });
      expect(onTap).toHaveBeenCalledWith("save");
      expect(onSpots.mock.lastCall?.[0]).toEqual([expect.objectContaining({ slide: 7, kind: "save" })]);
      expect(screen.getByText("Saved slide 7, just for you")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "I'm lost" })).not.toHaveAttribute("aria-disabled");
      expect(screen.queryByRole("button", { name: "Save this" })).not.toBeInTheDocument();
      expect(status()).toHaveTextContent("Saved slide 7, just for you.");
    });

    it("I'm lost on a saved slide still records, and its tools then work on the lost tap", async () => {
      const { send } = setup();
      await settle();
      fireEvent.click(screen.getByRole("button", { name: "Save this" }));
      press();
      await settle();
      expect(ops(send).filter((o) => o.op === "insert")).toHaveLength(2);
      expect(checked()).toBeInTheDocument();
      undo();
      await settle();
      const [, lostInsert, update] = ops(send);
      if (lostInsert.op !== "insert") throw new Error("expected an insert");
      expect(update).toEqual({ op: "update", id: lostInsert.tap.id, patch: { undone: true } });
      expect(screen.getByText("Saved slide 7, just for you")).toBeInTheDocument();
    });
  });

  describe("rejected taps", () => {
    it("shows the message, takes the dot away and gives the button back", async () => {
      const send = vi.fn<Send>(async () => "rejected");
      const { lastSpots } = setup({ send });
      await settle();
      press();
      expect(lastSpots()).toEqual([7]);
      await settle();
      expect(lastSpots()).toEqual([]);
      expect(screen.getByText(REJECTED)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "I'm lost" })).not.toHaveAttribute("aria-disabled");
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
      expect(checked()).toBeInTheDocument();
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
      const { show } = setup({ send: vi.fn<Send>().mockResolvedValueOnce("ok").mockResolvedValue("offline"), onRejected });
      await settle();
      press();
      await settle();
      show({ viewing: 8 });
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
      const { lastSpots, show } = setup({ send, onRejected });
      await settle();
      press();
      await settle();
      expect(send).toHaveBeenCalledTimes(1);
      expect(lastSpots()).toEqual([7]);
      // A second tap (on the next slide) waits behind the first, and does not cut the wait short.
      show({ viewing: 8 });
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
      expect(lastSpots()).toEqual([8]); // the second tap's dot stays
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
      expect(checked()).toBeInTheDocument();
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
      expect(checked()).toBeInTheDocument();
      act(() => {
        window.dispatchEvent(new Event("online"));
      });
      await settle();
      expect(send).toHaveBeenCalledTimes(2);
      expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toEqual([]);
    });

    it("sends the pending ops again when the connection comes back (reconnects goes up)", async () => {
      const send = vi.fn<Send>().mockResolvedValueOnce("offline").mockResolvedValue("ok");
      const { show } = setup({ send });
      await settle();
      press();
      await settle();
      show({ reconnects: 1 });
      await settle();
      expect(send).toHaveBeenCalledTimes(2);
    });

    it("restores pending ops from the last visit on mount, with their note and mark, and sends them", async () => {
      const tap = { id: "99999999-9999-9999-9999-000000000009", tappedOnSlide: 7, tappedAt: "2026-10-26T14:00:00.000Z" };
      localStorage.setItem(
        KEY,
        JSON.stringify([
          { op: "insert", tap },
          { op: "update", id: tap.id, patch: { note: "kept" } },
          { op: "update", id: tap.id, patch: { rect: RECT } },
        ]),
      );
      const { send, lastSpots } = setup();
      await settle();
      expect(ops(send)[0]).toEqual({ op: "insert", tap });
      expect(lastSpots()).toEqual([7]);
      expect(checked()).toBeInTheDocument();
      expect(screen.getByText("kept")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Clear mark" })).toBeInTheDocument();
    });

    it("shows a note still waiting in the queue on a row loaded from the database", async () => {
      localStorage.setItem(KEY, JSON.stringify([{ op: "update", id: "a", patch: { note: "newer" } }]));
      setup({
        send: vi.fn<Send>(async () => "offline"),
        loadOwn: vi.fn(async () => [{ id: "a", slide: 7, kind: "lost" as const, note: "older" }]),
      });
      await settle();
      expect(screen.getByText("newer")).toBeInTheDocument();
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
      expect(checked()).toBeInTheDocument();
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
      const { lastSpots, show } = setup({ loadOwn: vi.fn(async () => [{ id: "a", slide: 7 }]) });
      await settle();
      show({ viewing: 8 });
      press();
      expect(lastSpots()).toEqual([7, 8]);
      undo();
      expect(lastSpots()).toEqual([7]);
    });

    it("tries loading again on the online event when the first load was offline", async () => {
      const loadOwn = vi.fn<() => Promise<Row[] | null>>().mockResolvedValueOnce(null);
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
      let resolveLoad: (rows: Row[]) => void = () => {};
      const send = okSend();
      const loadOwn = vi.fn(() => new Promise<Row[] | null>((r) => (resolveLoad = r)));
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

  it("shows idle content (Reconnecting…) under the buttons while there is no message", async () => {
    setup({ idle: <p>Reconnecting…</p> });
    await settle();
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
    press();
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
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

  it("presses the button for 120 ms, then shows it checked with a check", async () => {
    vi.useFakeTimers();
    setup();
    await settle();
    const button = screen.getByRole("button", { name: "I'm lost" });
    press();
    expect(button).toHaveAttribute("data-phase", "pressed");
    // Named for its new state at once.
    expect(checked()).toBe(button);
    await act(async () => vi.advanceTimersByTime(120));
    expect(button).toHaveAttribute("data-phase", "checked");
    expect(button.querySelector('[data-icon="check"]')).not.toBeNull();
  });

  describe("screen readers and keyboard", () => {
    it("says each save in a status line that is always there, a new line each time", async () => {
      const { show } = setup();
      await settle();
      expect(status()).toHaveAttribute("aria-atomic", "false");
      expect(status()).toBeEmptyDOMElement();
      press();
      const first = status().firstElementChild;
      expect(status()).toHaveTextContent("Saved slide 7.");
      show({ viewing: 8 });
      press();
      expect(status()).toHaveTextContent("Saved slide 8.");
      expect(status().firstElementChild).not.toBe(first);
    });

    it("says Undone. after each Undo and puts focus back on I'm lost", async () => {
      setup();
      await settle();
      press();
      const undoButton = screen.getByRole("button", { name: "Undo" });
      undoButton.focus();
      undo();
      expect(status()).toHaveTextContent("Undone.");
      expect(screen.getByRole("button", { name: "I'm lost" })).toHaveFocus();
    });

    it("keeps focus on the button after a press (it stays, checked, and takes no second tap)", async () => {
      setup();
      await settle();
      const button = screen.getByRole("button", { name: "I'm lost" });
      button.focus();
      press();
      expect(checked()).toBe(button);
      expect(button).toHaveFocus();
    });

    it("when the slide changes under focus on Undo, focus goes to the panel, never to I'm lost (no stray tap)", async () => {
      const { send, show } = setup();
      await settle();
      press();
      await settle();
      screen.getByRole("button", { name: "Undo" }).focus();
      show({ viewing: 8 });
      const panel = screen.getByRole("region", { name: "Slide 8" });
      expect(panel).toHaveFocus();
      // A key meant for Undo lands on the panel, which records nothing.
      fireEvent.keyDown(panel, { key: "Enter" });
      fireEvent.keyUp(panel, { key: " " });
      await settle();
      expect(ops(send).filter((o) => o.op === "insert")).toHaveLength(1);
      expect(screen.getByRole("button", { name: "I'm lost" })).not.toHaveFocus();
    });

    for (const result of ["rejected", "limited"] as const) {
      it(`leaves I'm lost alone when a ${result} tap takes the note field away while a note is typed`, async () => {
        let finish: (r: SendResult) => void = () => {};
        const send = vi.fn<Send>(() => new Promise<SendResult>((r) => (finish = r)));
        setup({ send });
        await settle();
        press();
        await settle();
        fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
        expect(noteField()).toHaveFocus();
        typeNote("hel");
        await act(async () => finish(result));
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "I'm lost" })).not.toHaveFocus();
      });
    }

    it("lets Tab move between the tools (focus is never pulled back while it moves)", async () => {
      setup();
      await settle();
      press();
      const add = screen.getByRole("button", { name: "Add a note" });
      const mark = screen.getByRole("button", { name: "Mark the spot" });
      add.focus();
      fireEvent.blur(add, { relatedTarget: mark });
      mark.focus();
      await settle();
      expect(mark).toHaveFocus();
    });

    it("leaves focus alone when it went somewhere else first", async () => {
      const { show, container } = setup();
      await settle();
      press();
      const outside = document.createElement("button");
      document.body.appendChild(outside);
      screen.getByRole("button", { name: "Undo" }).focus();
      outside.focus();
      show({ viewing: 8 });
      expect(outside).toHaveFocus();
      outside.remove();
      expect(container).toBeTruthy();
    });

    it("names the panel by its slide, so a screen reader hears where focus landed", async () => {
      setup({ viewing: 4 });
      await settle();
      expect(within(screen.getByRole("region", { name: "Slide 4" })).getByRole("button", { name: "I'm lost" })).toBeInTheDocument();
    });
  });
});
