import { Activity, Component, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import type { Rect } from "@/lib/rect";
import type { QueueOp, SendResult } from "@/lib/tapQueue";
import { LostButton, NOTE_SAVE_MS, UNDO_MS, UNTOGGLE_GUARD_MS, type LegacyMarks, type Spot } from "./LostButton";

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
  let legacy: LegacyMarks | undefined;
  const onMarkingChange = vi.fn();
  const base: Props = {
    lectureId: LECTURE,
    viewing: 7,
    send,
    loadOwn,
    onSpots,
    onMarkingChange,
    onMarkReady: (m) => (legacy = m),
    ...over,
  };
  const view = render(<LostButton {...base} />);
  // The slides that have a dot (one per slide, however many rows it has).
  const lastSpots = () => [...new Set((onSpots.mock.lastCall?.[0] ?? []).map((x) => x.slide))].sort((a, b) => a - b);
  const show = (more: Partial<Props>) => view.rerender(<LostButton {...base} {...more} />);
  return {
    ...view,
    send,
    onSpots,
    loadOwn,
    lastSpots,
    show,
    onMarkingChange,
    mark: (r: Rect) => act(() => legacy?.add(r)),
    clearMark: (id: string) => act(() => legacy?.clear(id)),
  };
}

const press = () => fireEvent.click(screen.getByRole("button", { name: "I'm lost" }));
const checked = (n = 7) => screen.getByRole("button", { name: `Lost on slide ${n}` });
const undo = () => fireEvent.click(screen.getByRole("button", { name: "Undo" }));
const settle = () => act(async () => {});
// The note to the teacher: a line typed on the page, only on a slide where the student is lost.
const noteField = () => screen.getByRole("textbox", { name: /^Note for the teacher/ }) as HTMLTextAreaElement;
const noNoteField = () => screen.queryByRole("textbox", { name: /^Note for the teacher/ });
const typeNote = (text: string) => fireEvent.change(noteField(), { target: { value: text } });
// Enter saves the note now (it also saves by itself after a pause, and on blur).
const saveNote = () => fireEvent.keyDown(noteField(), { key: "Enter" });
const undoButton = () => screen.queryByRole("button", { name: "Undo" });
const markTool = () => screen.getByRole("button", { name: "Mark" });
const saveToggle = () => screen.getByRole("button", { name: /^(Save this|Saved for you)$/ });
const line = () => document.querySelector("[data-panel-line]") as HTMLElement;
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
  it("is the I'm lost button, Save this and the Mark tool, and nothing else until one is pressed (no note box, no Save note)", async () => {
    setup();
    await settle();
    expect(screen.getAllByRole("button").map((b) => b.textContent || b.getAttribute("aria-label"))).toEqual([
      "I'm lost",
      "Save this",
      "Mark",
    ]);
    // The Mark tool is there without Save this or I'm lost (a toggle, off).
    expect(markTool()).toHaveAttribute("aria-pressed", "false");
    expect(saveToggle()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(undoButton()).not.toBeInTheDocument();
  });

  it("checks the button right away (Lost on slide 7), before the send has resolved, with the spot's tools", async () => {
    const send = vi.fn<Send>(() => new Promise<SendResult>(() => {}));
    setup({ send });
    await settle();
    press();
    // Straight away, in the same tick as the press: the send has not even started.
    expect(checked()).toHaveAttribute("aria-pressed", "true");
    expect(undoButton()).toBeInTheDocument();
    expect(markTool()).toBeInTheDocument();
    // The note to the teacher comes with it.
    expect(noteField()).toBeInTheDocument();
    // Save this is not offered on a slide that is already lost (it is in My spots already).
    expect(screen.getByRole("button", { name: "Save this" })).toBeDisabled();
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
    it("a second press on the same slide right after the first records nothing and takes nothing back", async () => {
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
      const { send } = setup({ loadOwn: vi.fn(async () => [{ id: "a", slide: 7, kind: "lost" as const }]) });
      await settle();
      expect(checked()).toBeInTheDocument();
      expect(send).not.toHaveBeenCalled();
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
      expect(screen.getByRole("button", { name: "I'm lost" })).toHaveAttribute("aria-pressed", "false");
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

    it("goes away 10 seconds after the tap, and the tap stays saved", async () => {
      vi.useFakeTimers();
      const { send, lastSpots } = setup();
      await settle();
      press();
      await settle();
      await act(async () => vi.advanceTimersByTime(UNDO_MS - 100));
      expect(undoButton()).toBeInTheDocument();
      await act(async () => vi.advanceTimersByTime(100));
      expect(undoButton()).not.toBeInTheDocument();
      // Still saved: checked, its dot, its tools, and nothing taken back.
      expect(checked()).toBeInTheDocument();
      expect(lastSpots()).toEqual([7]);
      expect(markTool()).toBeInTheDocument();
      expect(ops(send).map((o) => o.op)).toEqual(["insert"]);
      // The Saved line goes with it.
      expect(line()).not.toHaveTextContent("Saved slide 7");
    });

    it("stays the full 10 seconds when another slide comes on screen, and then names its slide (Undo slide 7)", async () => {
      vi.useFakeTimers();
      const { show, send, lastSpots } = setup();
      await settle();
      press();
      await settle();
      await act(async () => vi.advanceTimersByTime(3000));
      show({ viewing: 8 });
      expect(undoButton()).not.toBeInTheDocument();
      const other = screen.getByRole("button", { name: "Undo slide 7" });
      expect(line()).toHaveTextContent("Saved");
      // Slide 8 is untouched: its own I'm lost.
      expect(screen.getByRole("button", { name: "I'm lost" })).toHaveAttribute("aria-pressed", "false");
      await act(async () => vi.advanceTimersByTime(UNDO_MS - 3000 - 100));
      expect(other).toBeInTheDocument();
      // It undoes the tap it belongs to, on slide 7, from slide 8.
      fireEvent.click(other);
      await settle();
      const [insert, update] = ops(send);
      if (insert.op !== "insert") throw new Error("expected an insert");
      expect(insert.tap.tappedOnSlide).toBe(7);
      expect(update).toEqual({ op: "update", id: insert.tap.id, patch: { undone: true } });
      expect(lastSpots()).toEqual([]);
      expect(screen.queryByRole("button", { name: /^Undo/ })).not.toBeInTheDocument();
      show({ viewing: 7 });
      expect(screen.getByRole("button", { name: "I'm lost" })).toBeInTheDocument();
    });

    it("on another slide, ends at its 10 seconds like on its own slide", async () => {
      vi.useFakeTimers();
      const { show } = setup();
      await settle();
      press();
      show({ viewing: 8 });
      await act(async () => vi.advanceTimersByTime(UNDO_MS));
      expect(screen.queryByRole("button", { name: /^Undo/ })).not.toBeInTheDocument();
      show({ viewing: 7 });
      expect(checked()).toBeInTheDocument();
      expect(undoButton()).not.toBeInTheDocument();
    });

    it("prefers the slide on screen: a tap on slide 8 after one on slide 7 shows plain Undo for 8, then Undo slide 7 comes back on 9", async () => {
      vi.useFakeTimers();
      const { show, send } = setup();
      await settle();
      press();
      show({ viewing: 8 });
      press();
      expect(undoButton()).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Undo slide 7" })).not.toBeInTheDocument();
      show({ viewing: 7 });
      // On 7, its own Undo.
      expect(undoButton()).toBeInTheDocument();
      show({ viewing: 9 });
      // On a third slide, the newest.
      expect(screen.getByRole("button", { name: "Undo slide 8" })).toBeInTheDocument();
      await settle();
      expect(ops(send).filter((o) => o.op === "insert")).toHaveLength(2);
    });

    it("each tap gets its own 10 seconds", async () => {
      vi.useFakeTimers();
      setup();
      await settle();
      fireEvent.click(screen.getByRole("button", { name: "Save this" }));
      await act(async () => vi.advanceTimersByTime(6000));
      press();
      await act(async () => vi.advanceTimersByTime(6000));
      // 12 s after the save, 6 s after I'm lost: Undo is there for the I'm lost.
      expect(undoButton()).toBeInTheDocument();
      await act(async () => vi.advanceTimersByTime(4000));
      expect(undoButton()).not.toBeInTheDocument();
    });

    describe("when Next hides the page and shows it again (Activity)", () => {
      function inActivity() {
        // A small database: the taps that were sent, without the undone ones.
        const rows = new Map<string, Row>();
        const send = vi.fn<Send>(async (op) => {
          if (op.op === "insert") rows.set(op.tap.id, { id: op.tap.id, slide: op.tap.tappedOnSlide, kind: op.tap.kind ?? "lost" });
          else if (op.patch.undone) rows.delete(op.id);
          return "ok";
        });
        const props: Props = { lectureId: LECTURE, viewing: 7, send, loadOwn: vi.fn(async () => [...rows.values()]), onSpots: vi.fn() };
        const at = (mode: "visible" | "hidden") => (
          <Activity mode={mode}>
            <LostButton {...props} />
          </Activity>
        );
        const view = render(at("visible"));
        return { hide: () => view.rerender(at("hidden")), showAgain: () => view.rerender(at("visible")) };
      }

      it("keeps the 10 seconds from the tap: the time left runs out after the page comes back", async () => {
        vi.useFakeTimers();
        const page = inActivity();
        await settle();
        press();
        await act(async () => vi.advanceTimersByTime(2000));
        page.hide();
        await act(async () => vi.advanceTimersByTime(3000));
        page.showAgain();
        await settle();
        expect(undoButton()).toBeInTheDocument();
        await act(async () => vi.advanceTimersByTime(UNDO_MS - 5000 - 100));
        expect(undoButton()).toBeInTheDocument();
        await act(async () => vi.advanceTimersByTime(100));
        expect(undoButton()).not.toBeInTheDocument();
        expect(checked()).toBeInTheDocument();
      });

      it("drops Undo at once when its 10 seconds ran out while the page was hidden", async () => {
        vi.useFakeTimers();
        const page = inActivity();
        await settle();
        press();
        page.hide();
        await act(async () => vi.advanceTimersByTime(UNDO_MS + 2000));
        page.showAgain();
        await settle();
        expect(undoButton()).not.toBeInTheDocument();
        expect(checked()).toBeInTheDocument();
      });
    });

    it("is not offered on rows saved before (loaded), only on a tap made here", async () => {
      setup({
        loadOwn: vi.fn(async () => [
          { id: "a", slide: 7, kind: "lost" as const },
          { id: "c", slide: 7, kind: "save" as const },
        ]),
      });
      await settle();
      expect(checked()).toBeInTheDocument();
      expect(undoButton()).not.toBeInTheDocument();
    });

    it("takes back only the kind it undoes: I'm lost on a saved slide, then Undo, leaves the save", async () => {
      const { send } = setup({ loadOwn: vi.fn(async () => [{ id: "c", slide: 7, kind: "save" as const }]) });
      await settle();
      press();
      await settle();
      undo();
      await settle();
      const [lostInsert, update] = ops(send);
      if (lostInsert.op !== "insert") throw new Error("expected an insert");
      expect(update).toEqual({ op: "update", id: lostInsert.tap.id, patch: { undone: true } });
      expect(ops(send)).toHaveLength(2);
      // The save on the same slide stays (loaded, so no Undo for it).
      expect(screen.getByRole("button", { name: "I'm lost" })).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("button", { name: "Saved for you" })).toHaveAttribute("aria-pressed", "true");
      expect(undoButton()).not.toBeInTheDocument();
    });
  });

  describe("note to the teacher", () => {
    it("is only on a slide where the student is lost: a small line typed on the page, no box and no Save button", async () => {
      setup();
      await settle();
      expect(noNoteField()).not.toBeInTheDocument();
      // Not on a saved-for-you slide either (that is the notebook's job).
      fireEvent.click(screen.getByRole("button", { name: "Save this" }), { detail: 1 });
      expect(noNoteField()).not.toBeInTheDocument();
      fireEvent.click(undoButton()!, { detail: 1 });
      press();
      const field = noteField();
      expect(field.tagName).toBe("TEXTAREA");
      expect(field).toHaveAttribute("placeholder", "Note for the teacher");
      // The notebook look: Newsreader italic on ruled lines, no border box.
      expect(field.className).toContain("type-note");
      expect(field.className).toContain("bg-ruled");
      expect(field.className).toContain("border-0");
      expect(screen.queryByRole("button", { name: /Save note/ })).not.toBeInTheDocument();
      // At the end of the panel: under the buttons and the line with Undo, so nothing above it moves.
      expect(line().compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      undo();
      expect(noNoteField()).not.toBeInTheDocument();
    });

    it("goes into the page's slot (the top of the notebook) when the page gives one", async () => {
      const slot = document.createElement("div");
      document.body.appendChild(slot);
      setup({ noteSlot: slot });
      await settle();
      press();
      expect(slot.querySelector("textarea")).toBe(noteField());
      slot.remove();
    });

    it("saves by itself a moment after the typing pauses: an update of the tap, the text kept as typed, and a quiet Saved", async () => {
      vi.useFakeTimers();
      const { send, onSpots } = setup();
      await settle();
      press();
      await settle();
      noteField().focus();
      fireEvent.focus(noteField());
      typeNote("why is this a credit ");
      await act(async () => vi.advanceTimersByTime(NOTE_SAVE_MS - 100));
      expect(ops(send).filter((o) => o.op === "update")).toEqual([]);
      typeNote("why is this a credit  ");
      await act(async () => vi.advanceTimersByTime(NOTE_SAVE_MS));
      const [insert, update] = ops(send);
      if (insert.op !== "insert") throw new Error("expected an insert");
      expect(update).toEqual({ op: "update", id: insert.tap.id, patch: { note: "why is this a credit" } });
      expect(ops(send).filter((o) => o.op === "insert")).toHaveLength(1);
      // The field keeps what was typed (a trailing space too), so typing on is not disturbed.
      expect(noteField()).toHaveValue("why is this a credit  ");
      expect(document.querySelector("[data-note-saved]")).toHaveTextContent("Saved");
      expect(onSpots.mock.lastCall?.[0][0]).toMatchObject({ slide: 7, note: "why is this a credit" });
      await act(async () => vi.advanceTimersByTime(2000));
      expect(document.querySelector("[data-note-saved]")).toBeNull();
      // Nothing new: no second save.
      await act(async () => vi.advanceTimersByTime(NOTE_SAVE_MS * 3));
      expect(ops(send).filter((o) => o.op === "update")).toHaveLength(1);
    });

    it("Enter saves at once (Shift+Enter is a new line), and so does leaving the field", async () => {
      const { send } = setup();
      await settle();
      press();
      await settle();
      typeNote("first");
      fireEvent.keyDown(noteField(), { key: "Enter", shiftKey: true });
      await settle();
      expect(ops(send).filter((o) => o.op === "update")).toEqual([]);
      fireEvent.keyDown(noteField(), { key: "Enter" });
      await settle();
      expect(ops(send).filter((o) => o.op === "update")).toEqual([expect.objectContaining({ patch: { note: "first" } })]);
      typeNote("second");
      fireEvent.blur(noteField());
      await settle();
      expect(ops(send).filter((o) => o.op === "update").map((o) => (o.op === "update" ? o.patch : null))).toEqual([
        { note: "first" },
        { note: "second" },
      ]);
    });

    it("takes up to noteMax (2000 once the database has 0020), counted and cut by whole characters, never half an emoji", async () => {
      const { send } = setup({ noteMax: 2000 });
      await settle();
      press();
      await settle();
      const long = "d".repeat(700);
      typeNote(long);
      expect(noteField()).toHaveValue(long);
      expect(screen.queryByText(/left$/)).not.toBeInTheDocument();
      // No maxLength (it counts halves of an emoji); the page cuts by whole characters.
      expect(noteField()).not.toHaveAttribute("maxLength");
      typeNote("😀".repeat(1985));
      expect(screen.getByText("15 left")).toBeInTheDocument();
      expect(noteField()).toHaveAccessibleDescription("15 left");
      typeNote("d".repeat(1999) + "😀😀😀");
      expect(Array.from(noteField().value)).toHaveLength(2000);
      expect(noteField().value.endsWith("d😀")).toBe(true);
      saveNote();
      await settle();
      const update = ops(send).find((o) => o.op === "update");
      if (!update || update.op !== "update") throw new Error("expected an update");
      expect(update.patch.note).toBe("d".repeat(1999) + "😀");
    });

    it("cuts at 140 without noteMax (the database before 0020)", async () => {
      setup();
      await settle();
      press();
      typeNote("e".repeat(700));
      expect(noteField().value).toHaveLength(140);
      typeNote("a".repeat(119));
      expect(screen.queryByText(/left$/)).not.toBeInTheDocument();
      typeNote("a".repeat(130));
      expect(screen.getByText("10 left")).toBeInTheDocument();
    });

    it("shows the saved note, and a changed one is sent; emptied, it is taken off; unchanged, nothing is sent", async () => {
      const { send } = setup({ loadOwn: vi.fn(async () => [{ id: "a", slide: 7, kind: "lost" as const, note: "old" }]) });
      await settle();
      expect(noteField()).toHaveValue("old");
      typeNote("old");
      saveNote();
      await settle();
      expect(send).not.toHaveBeenCalled();
      typeNote("new");
      saveNote();
      await settle();
      expect(ops(send)).toEqual([{ op: "update", id: "a", patch: { note: "new" } }]);
      typeNote("  ");
      saveNote();
      await settle();
      expect(ops(send)[1]).toEqual({ op: "update", id: "a", patch: { note: "" } });
      expect(status()).toHaveTextContent("Note removed.");
    });

    it("keeps its slide while it has the focus when the slide changes, saves there, then goes with the focus", async () => {
      const { send, show } = setup();
      await settle();
      press();
      await settle();
      noteField().focus();
      fireEvent.focus(noteField());
      typeNote("half a tho");
      show({ viewing: 8 });
      expect(noteField()).toHaveValue("half a tho");
      expect(noteField()).toHaveAccessibleName("Note for the teacher, slide 7");
      expect(document.querySelector("[data-note-slide]")).toHaveTextContent("Slide 7");
      // The button is for slide 8 now.
      expect(screen.getByRole("button", { name: "I'm lost" })).toBeInTheDocument();
      typeNote("half a thought");
      fireEvent.blur(noteField());
      await settle();
      const [insert, update] = ops(send);
      if (insert.op !== "insert") throw new Error("expected an insert");
      expect(insert.tap.tappedOnSlide).toBe(7);
      expect(update).toEqual({ op: "update", id: insert.tap.id, patch: { note: "half a thought" } });
      // Slide 8 is not lost: no line there.
      expect(noNoteField()).not.toBeInTheDocument();
    });

    it("a note that ends up on a slide with no I'm lost (the tap did not save) is given back, and once edited records I'm lost with it, in one insert", async () => {
      vi.useFakeTimers();
      let results: SendResult[] = ["rejected"];
      const send = vi.fn<Send>(async () => results.shift() ?? "ok");
      const { lastSpots } = setup({ send });
      await settle();
      press();
      typeNote("lost on the timing part");
      saveNote();
      await act(async () => vi.advanceTimersByTime(0));
      // The tap and the note on it were refused: the note is back in its line, the slide is not lost.
      expect(lastSpots()).toEqual([]);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(noteField()).toHaveValue("lost on the timing part");
      // Given back, it does not save by itself (the database just said no): no loop.
      await act(async () => vi.advanceTimersByTime(NOTE_SAVE_MS * 4));
      expect(send).toHaveBeenCalledTimes(1);
      results = [];
      typeNote("lost on the timing part!");
      await act(async () => vi.advanceTimersByTime(NOTE_SAVE_MS));
      const inserts = ops(send).filter((o) => o.op === "insert");
      expect(inserts).toHaveLength(2);
      const last = inserts[1];
      if (last.op !== "insert") throw new Error("expected an insert");
      // An I'm lost (no kind) with the note, in one go.
      expect(last.tap.kind).toBeUndefined();
      expect(last.tap).toMatchObject({ tappedOnSlide: 7, note: "lost on the timing part!" });
      expect(checked()).toBeInTheDocument();
    });

    it("taking I'm lost back while a note is typed saves the note on the tap first, and Undo brings both back", async () => {
      vi.useFakeTimers();
      const { send } = setup({ loadOwn: vi.fn(async () => [{ id: "a", slide: 7, kind: "lost" as const }]) });
      await settle();
      typeNote("ask about this");
      fireEvent.click(checked(), { detail: 1 });
      await act(async () => vi.advanceTimersByTime(0));
      expect(ops(send)).toEqual([
        { op: "update", id: "a", patch: { note: "ask about this" } },
        { op: "update", id: "a", patch: { undone: true } },
      ]);
      expect(noNoteField()).not.toBeInTheDocument();
      // The draft does not come back and make the slide lost again.
      await act(async () => vi.advanceTimersByTime(NOTE_SAVE_MS * 3));
      expect(ops(send).filter((o) => o.op === "insert")).toEqual([]);
      undo();
      await act(async () => vi.advanceTimersByTime(0));
      expect(noteField()).toHaveValue("ask about this");
    });

    it("Undo of I'm lost with a note being typed sends neither, and the note does not come back as a new I'm lost", async () => {
      vi.useFakeTimers();
      const send = vi.fn<Send>(async () => "offline");
      setup({ send });
      await settle();
      press();
      typeNote("hello");
      undo();
      await act(async () => vi.advanceTimersByTime(NOTE_SAVE_MS * 3));
      expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toEqual([]);
      expect(noNoteField()).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "I'm lost" })).toBeInTheDocument();
    });

    it("a note being typed when the panel goes (Next hides the page) is saved first", async () => {
      const { send, unmount } = setup();
      await settle();
      press();
      await settle();
      typeNote("before I go");
      unmount();
      const queued = JSON.parse(localStorage.getItem(KEY) ?? "[]") as QueueOp[];
      const sent = [...ops(send), ...queued];
      expect(sent.some((o) => o.op === "update" && o.patch.note === "before I go")).toBe(true);
    });

    for (const result of ["rejected", "limited"] as const) {
      it(`gives the note back in its line when the ${result} tap it was sent with does not save`, async () => {
        const send = vi.fn<Send>(async () => result);
        const { lastSpots } = setup({ send });
        await settle();
        press();
        typeNote("my note");
        saveNote();
        await settle();
        expect(lastSpots()).toEqual([]);
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect(noteField()).toHaveValue("my note");
        // One insert only, never retried.
        expect(send).toHaveBeenCalledTimes(1);
      });
    }
  });

  describe("the Mark tool", () => {
    it("is always there and turns marking on and off, with no tap needed", async () => {
      const { onMarkingChange, show, send } = setup();
      await settle();
      fireEvent.click(markTool(), { detail: 1 });
      expect(onMarkingChange).toHaveBeenLastCalledWith(true);
      show({ marking: true });
      expect(markTool()).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(markTool(), { detail: 1 });
      expect(onMarkingChange).toHaveBeenLastCalledWith(false);
      await settle();
      expect(send).not.toHaveBeenCalled();
    });

    it("shows a yellow swatch, and a red one on a slide where the student is lost", async () => {
      setup();
      await settle();
      expect(markTool().querySelector("[data-swatch]")).toHaveAttribute("data-swatch", "save");
      press();
      expect(markTool().querySelector("[data-swatch]")).toHaveAttribute("data-swatch", "lost");
    });

    it("Undo leaves the tool as it is", async () => {
      const { onMarkingChange, show } = setup();
      await settle();
      press();
      show({ marking: true });
      undo();
      expect(onMarkingChange).not.toHaveBeenCalled();
    });
  });

  describe("marks before migration 0020 (one per slide, on the slide's spot)", () => {
    it("a box on a lost slide is saved at once as an update of the tap", async () => {
      const { send, mark, onSpots } = setup();
      await settle();
      press();
      await settle();
      mark(RECT);
      await settle();
      const [insert, update] = ops(send);
      if (insert.op !== "insert") throw new Error("expected an insert");
      expect(update).toEqual({ op: "update", id: insert.tap.id, patch: { rect: RECT } });
      expect(onSpots.mock.lastCall?.[0][0]).toMatchObject({ slide: 7, rect: RECT });
      expect(status()).toHaveTextContent("Marked.");
    });

    it("a box on a slide with no spot saves the slide just for the student, with the box, in one insert", async () => {
      const { send, mark } = setup();
      await settle();
      mark(RECT);
      await settle();
      expect(ops(send)).toEqual([{ op: "insert", tap: expect.objectContaining({ tappedOnSlide: 7, kind: "save", rect: RECT }) }]);
      expect(saveToggle()).toHaveAccessibleName("Saved for you");
    });

    it("a second box replaces the first (there is one per slide before 0020)", async () => {
      const { send, mark } = setup({ loadOwn: vi.fn(async () => [{ id: "a", slide: 7, kind: "lost" as const, rect: RECT }]) });
      await settle();
      const next = { x: 0.5, y: 0.5, w: 0.2, h: 0.2 };
      mark(next);
      await settle();
      expect(ops(send)).toEqual([{ op: "update", id: "a", patch: { rect: next } }]);
    });

    it("Delete sends rect null on that row", async () => {
      const { send, clearMark, onSpots } = setup({ loadOwn: vi.fn(async () => [{ id: "a", slide: 7, kind: "lost" as const, rect: RECT }]) });
      await settle();
      clearMark("a");
      await settle();
      expect(ops(send)).toEqual([{ op: "update", id: "a", patch: { rect: null } }]);
      expect(onSpots.mock.lastCall?.[0][0]).not.toHaveProperty("rect");
      expect(status()).toHaveTextContent("Mark deleted.");
    });
  });

  describe("taking a tap back (pressing it again)", () => {
    it("the checked Lost on slide 7 takes the tap back: undone, Removed with Undo, and the button is I'm lost again", async () => {
      vi.useFakeTimers();
      const onLostChange = vi.fn();
      const { send, lastSpots } = setup({ onLostChange });
      await settle();
      press();
      await settle();
      expect(onLostChange).toHaveBeenLastCalledWith(7, true);
      await act(async () => vi.advanceTimersByTime(UNTOGGLE_GUARD_MS));
      fireEvent.click(checked(), { detail: 1 });
      await settle();
      const [insert, update] = ops(send);
      if (insert.op !== "insert") throw new Error("expected an insert");
      expect(update).toEqual({ op: "update", id: insert.tap.id, patch: { undone: true } });
      expect(screen.getByRole("button", { name: "I'm lost" })).toHaveAttribute("aria-pressed", "false");
      expect(lastSpots()).toEqual([]);
      expect(line()).toHaveTextContent("Removed");
      expect(undoButton()).toBeInTheDocument();
      expect(status()).toHaveTextContent("Removed.");
      expect(onLostChange).toHaveBeenLastCalledWith(7, false);
    });

    it("works any time while the lecture is live, on a tap from before this screen too", async () => {
      const onLostChange = vi.fn();
      const { send } = setup({ onLostChange, loadOwn: vi.fn(async () => [{ id: "a", slide: 7, kind: "lost" as const, note: "why", rect: RECT }]) });
      await settle();
      fireEvent.click(checked(), { detail: 1 });
      await settle();
      expect(ops(send)).toEqual([{ op: "update", id: "a", patch: { undone: true } }]);
      expect(screen.getByRole("button", { name: "I'm lost" })).toBeInTheDocument();
      expect(onLostChange).toHaveBeenCalledWith(7, false);
    });

    it("Undo after Removed brings the same row back (undone false) with its note, and the slide is lost again", async () => {
      const onLostChange = vi.fn();
      const { send, lastSpots } = setup({ onLostChange, loadOwn: vi.fn(async () => [{ id: "a", slide: 7, kind: "lost" as const, note: "why" }]) });
      await settle();
      fireEvent.click(checked(), { detail: 1 });
      await settle();
      undo();
      await settle();
      expect(ops(send)).toEqual([
        { op: "update", id: "a", patch: { undone: true } },
        // The slide and kind ride along (never sent), so a reload while it waits can show the spot.
        { op: "update", id: "a", patch: { undone: false }, spot: { slide: 7, kind: "lost", note: "why" } },
      ]);
      expect(checked()).toBeInTheDocument();
      expect(lastSpots()).toEqual([7]);
      expect(noteField()).toHaveValue("why");
      expect(onLostChange).toHaveBeenLastCalledWith(7, true);
      expect(status()).toHaveTextContent("Undone.");
    });

    it("a tap that has not gone out yet is still taken back with an update, so Undo can bring it back", async () => {
      const send = vi.fn<Send>(async () => "offline");
      setup({ send });
      await settle();
      fireEvent.click(screen.getByRole("button", { name: "I'm lost" }));
      // A moment later (past the guard against a quick second tap).
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2 * UNTOGGLE_GUARD_MS);
      fireEvent.click(checked(), { detail: 1 });
      const queued = JSON.parse(localStorage.getItem(KEY) ?? "[]") as QueueOp[];
      expect(queued.map((o) => (o.op === "insert" ? "insert" : o.patch))).toEqual(["insert", { undone: true }]);
      undo();
      const again = JSON.parse(localStorage.getItem(KEY) ?? "[]") as QueueOp[];
      expect(again.map((o) => (o.op === "insert" ? "insert" : o.patch))).toEqual(["insert", { undone: true }, { undone: false }]);
      expect(checked()).toBeInTheDocument();
    });

    describe("Undo of Removed still waiting in the queue when the page loads again (offline)", () => {
      it("a sent tap: the slide is still lost, the marks turn red, and I'm lost adds no second row", async () => {
        localStorage.setItem(
          KEY,
          JSON.stringify([
            { op: "update", id: "a", patch: { undone: true } },
            { op: "update", id: "a", patch: { undone: false } },
          ]),
        );
        const onLostChange = vi.fn();
        const send = vi.fn<Send>(async () => "offline");
        setup({ send, onLostChange, loadOwn: vi.fn(async () => [{ id: "a", slide: 7, kind: "lost" as const }]) });
        await settle();
        await settle();
        expect(checked()).toBeInTheDocument();
        expect(onLostChange).toHaveBeenCalledWith(7, true);
        // A press now takes it back (no second I'm lost on the slide).
        vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
        fireEvent.click(checked(), { detail: 1 });
        const queued = JSON.parse(localStorage.getItem(KEY) ?? "[]") as QueueOp[];
        expect(queued.filter((o) => o.op === "insert")).toHaveLength(0);
      });

      it("a tap never sent: the slide is still lost", async () => {
        const tap = { id: "b", tappedOnSlide: 7, tappedAt: "2026-10-26T14:00:00.000Z" };
        localStorage.setItem(
          KEY,
          JSON.stringify([
            { op: "insert", tap },
            { op: "update", id: "b", patch: { undone: true } },
            { op: "update", id: "b", patch: { undone: false } },
          ]),
        );
        const onLostChange = vi.fn();
        setup({ send: vi.fn<Send>(async () => "offline"), onLostChange, loadOwn: vi.fn(async () => null) });
        await settle();
        await settle();
        expect(checked()).toBeInTheDocument();
        expect(onLostChange).toHaveBeenCalledWith(7, true);
      });

      it("a sent tap the read can not show (offline): the slide and kind the update carries bring it back", async () => {
        localStorage.setItem(
          KEY,
          JSON.stringify([
            { op: "update", id: "a", patch: { undone: true } },
            { op: "update", id: "a", patch: { undone: false }, spot: { slide: 7, kind: "lost" } },
          ]),
        );
        setup({ send: vi.fn<Send>(async () => "offline"), loadOwn: vi.fn(async () => null) });
        await settle();
        await settle();
        expect(checked()).toBeInTheDocument();
      });

      it("Removed, Undo (still queued), Removed again: not lost after a reload, and the page is never told it is (K1 re-review N2)", async () => {
        localStorage.setItem(
          KEY,
          JSON.stringify([
            { op: "update", id: "a", patch: { undone: true } },
            { op: "update", id: "a", patch: { undone: false }, spot: { slide: 7, kind: "lost" } },
            { op: "update", id: "a", patch: { undone: true } },
          ]),
        );
        const onLostChange = vi.fn();
        // Offline, and a read that has the row (the first take-back never went out).
        setup({ send: vi.fn<Send>(async () => "offline"), onLostChange, loadOwn: vi.fn(async () => [{ id: "a", slide: 7, kind: "lost" as const }]) });
        await settle();
        await settle();
        expect(screen.getByRole("button", { name: "I'm lost" })).toBeInTheDocument();
        expect(onLostChange).not.toHaveBeenCalledWith(7, true);
      });

      it("a fresh read taken while the bring-back waits (undone true already in) keeps the slide lost", async () => {
        // The database: a is undone (the take-back went), the bring-back is offline.
        const send = vi.fn<Send>(async (op) => (op.op === "update" && op.patch.undone === false ? "offline" : "ok"));
        let rows: Row[] = [{ id: "a", slide: 7, kind: "lost" }];
        const loadOwn = vi.fn(async () => rows);
        setup({ send, loadOwn });
        await settle();
        fireEvent.click(checked(), { detail: 1 });
        await settle();
        rows = [];
        undo();
        await settle();
        expect(checked()).toBeInTheDocument();
        Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
        act(() => {
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await settle();
        expect(loadOwn).toHaveBeenCalledTimes(2);
        expect(checked()).toBeInTheDocument();
      });
    });

    it("Removed and its Undo last 10 seconds, also on another slide (Undo slide 7)", async () => {
      vi.useFakeTimers();
      const { show } = setup({ loadOwn: vi.fn(async () => [{ id: "a", slide: 7, kind: "lost" as const }]) });
      await settle();
      fireEvent.click(checked(), { detail: 1 });
      await act(async () => vi.advanceTimersByTime(4000));
      show({ viewing: 8 });
      expect(screen.getByRole("button", { name: "Undo slide 7" })).toBeInTheDocument();
      expect(line()).toHaveTextContent("Removed");
      await act(async () => vi.advanceTimersByTime(UNDO_MS - 4000));
      expect(screen.queryByRole("button", { name: /^Undo/ })).not.toBeInTheDocument();
    });

    it("the Undo of the tap gives way to the Undo of taking it back", async () => {
      vi.useFakeTimers();
      const { send } = setup();
      await settle();
      press();
      await act(async () => vi.advanceTimersByTime(UNTOGGLE_GUARD_MS));
      fireEvent.click(checked(), { detail: 1 });
      expect(screen.getAllByRole("button", { name: /^Undo/ })).toHaveLength(1);
      undo();
      await settle();
      // Brought back, not undone twice.
      expect(checked()).toBeInTheDocument();
      expect(ops(send).map((o) => (o.op === "insert" ? "insert" : o.patch))).toEqual(["insert", { undone: true }, { undone: false }]);
    });

    it("a double click on I'm lost records once and takes nothing back", async () => {
      const { send } = setup();
      await settle();
      fireEvent.click(screen.getByRole("button", { name: "I'm lost" }), { detail: 1 });
      fireEvent.click(checked(), { detail: 2 });
      await settle();
      expect(ops(send).map((o) => o.op)).toEqual(["insert"]);
      expect(checked()).toBeInTheDocument();
    });

    it("Saved for you, pressed again, unsaves the slide the same way", async () => {
      const { send, lastSpots } = setup({ loadOwn: vi.fn(async () => [{ id: "c", slide: 7, kind: "save" as const }]) });
      await settle();
      expect(saveToggle()).toHaveAccessibleName("Saved for you");
      expect(saveToggle()).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(saveToggle(), { detail: 1 });
      await settle();
      expect(ops(send)).toEqual([{ op: "update", id: "c", patch: { undone: true } }]);
      expect(saveToggle()).toHaveAccessibleName("Save this");
      expect(saveToggle()).toHaveAttribute("aria-pressed", "false");
      expect(lastSpots()).toEqual([]);
      expect(line()).toHaveTextContent("Removed");
      undo();
      expect(saveToggle()).toHaveAccessibleName("Saved for you");
    });

    it("taking back I'm lost on a saved slide leaves the save", async () => {
      const onLostChange = vi.fn();
      const { send } = setup({
        onLostChange,
        loadOwn: vi.fn(async () => [
          { id: "a", slide: 7, kind: "lost" as const },
          { id: "c", slide: 7, kind: "save" as const },
        ]),
      });
      await settle();
      fireEvent.click(checked(), { detail: 1 });
      await settle();
      expect(ops(send)).toEqual([{ op: "update", id: "a", patch: { undone: true } }]);
      expect(saveToggle()).toHaveAccessibleName("Saved for you");
      expect(onLostChange).toHaveBeenCalledWith(7, false);
    });

    it("tells the page a slide is no longer lost when its tap is refused", async () => {
      const onLostChange = vi.fn();
      setup({ onLostChange, send: vi.fn<Send>(async () => "rejected") });
      await settle();
      press();
      await settle();
      expect(onLostChange.mock.calls).toEqual([
        [7, true],
        [7, false],
      ]);
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
      expect(line()).toHaveTextContent("Saved slide 7, just for you");
      expect(screen.getByRole("button", { name: "I'm lost" })).toHaveAttribute("aria-pressed", "false");
      expect(screen.queryByRole("button", { name: "Save this" })).not.toBeInTheDocument();
      expect(saveToggle()).toHaveAccessibleName("Saved for you");
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
      expect(saveToggle()).toHaveAccessibleName("Saved for you");
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
      const { send, lastSpots, onSpots } = setup();
      const onSpotsLast = () => onSpots.mock.lastCall?.[0][0];
      await settle();
      expect(ops(send)[0]).toEqual({ op: "insert", tap });
      expect(lastSpots()).toEqual([7]);
      expect(checked()).toBeInTheDocument();
      expect(noteField()).toHaveValue("kept");
      expect(onSpotsLast()).toMatchObject({ id: tap.id, rect: RECT });
    });

    it("shows a note still waiting in the queue on a row loaded from the database", async () => {
      localStorage.setItem(KEY, JSON.stringify([{ op: "update", id: "a", patch: { note: "newer" } }]));
      setup({
        send: vi.fn<Send>(async () => "offline"),
        loadOwn: vi.fn(async () => [{ id: "a", slide: 7, kind: "lost" as const, note: "older" }]),
      });
      await settle();
      expect(noteField()).toHaveValue("newer");
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

  describe("reading the rows again (My spots may have changed them)", () => {
    function inActivity(loadOwn: () => Promise<Row[] | null>) {
      const onSpots = vi.fn<(s: Spot[]) => void>();
      const props: Props = { lectureId: LECTURE, viewing: 7, send: okSend(), loadOwn, onSpots };
      const at = (mode: "visible" | "hidden") => (
        <Activity mode={mode}>
          <LostButton {...props} />
        </Activity>
      );
      const view = render(at("visible"));
      return { onSpots, hide: () => view.rerender(at("hidden")), showAgain: () => view.rerender(at("visible")) };
    }

    it("when the page is shown again, a mark cleared in My spots is gone (the bug from hand test 3)", async () => {
      vi.useFakeTimers();
      let rows: Row[] = [{ id: "a", slide: 7, kind: "lost", rect: RECT }];
      const loadOwn = vi.fn(async () => rows);
      const page = inActivity(loadOwn);
      await settle();
      expect(page.onSpots.mock.lastCall?.[0][0]).toMatchObject({ id: "a", rect: RECT });
      page.hide();
      await act(async () => vi.advanceTimersByTime(1000));
      // In My spots: Clear mark.
      rows = [{ id: "a", slide: 7, kind: "lost" }];
      page.showAgain();
      await settle();
      expect(loadOwn).toHaveBeenCalledTimes(2);
      expect(page.onSpots.mock.lastCall?.[0]).toEqual([{ id: "a", slide: 7, kind: "lost" }]);
      expect(checked()).toBeInTheDocument();
    });

    it("when the page is shown again, a spot removed in My spots is gone and I'm lost is back", async () => {
      vi.useFakeTimers();
      let rows: Row[] = [{ id: "a", slide: 7, kind: "lost" }];
      const page = inActivity(vi.fn(async () => rows));
      await settle();
      expect(checked()).toBeInTheDocument();
      page.hide();
      await act(async () => vi.advanceTimersByTime(1000));
      rows = [];
      page.showAgain();
      await settle();
      expect(screen.getByRole("button", { name: "I'm lost" })).toHaveAttribute("aria-pressed", "false");
    });

    it("keeps a tap made here a moment ago that the read does not have yet, and what still waits in the queue", async () => {
      const send = vi.fn<Send>(async (op) => (op.op === "insert" && op.tap.kind === "save" ? "offline" : "ok"));
      const loadOwn = vi.fn(async () => [] as Row[]);
      const { lastSpots, show } = setup({ send, loadOwn });
      await settle();
      press();
      show({ viewing: 8 });
      fireEvent.click(screen.getByRole("button", { name: "Save this" }));
      await settle();
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await settle();
      expect(loadOwn).toHaveBeenCalledTimes(2);
      expect(lastSpots()).toEqual([7, 8]);
    });

    it("reads the rows again when the window gets the focus back and when the connection comes back", async () => {
      let rows: Row[] = [{ id: "a", slide: 7, kind: "lost" }];
      const loadOwn = vi.fn(async () => rows);
      const { show } = setup({ loadOwn });
      await settle();
      rows = [];
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      await settle();
      expect(screen.getByRole("button", { name: "I'm lost" })).toHaveAttribute("aria-pressed", "false");
      rows = [{ id: "a", slide: 7, kind: "lost" }];
      show({ reconnects: 1 });
      await settle();
      expect(checked()).toBeInTheDocument();
      expect(loadOwn).toHaveBeenCalledTimes(3);
    });

    it("when the tab is shown again, reads the rows again", async () => {
      let rows: Row[] = [{ id: "a", slide: 7, kind: "lost" }];
      const loadOwn = vi.fn(async () => rows);
      setup({ loadOwn });
      await settle();
      rows = [];
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await settle();
      expect(screen.getByRole("button", { name: "I'm lost" })).toHaveAttribute("aria-pressed", "false");
    });
  });

  it("shows idle content (Reconnecting…) under the buttons while there is no message, with Undo still at its end", async () => {
    setup({ idle: <p>Reconnecting…</p> });
    await settle();
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
    press();
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
    expect(undoButton()).toBeInTheDocument();
  });

  it("shows the page's notice (a mark that did not save) as an alert in the line", async () => {
    const { show } = setup();
    await settle();
    show({ notice: { n: 1, text: "Too many marks on this slide." } });
    expect(screen.getByRole("alert")).toHaveTextContent("Too many marks on this slide.");
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

    it("when the slide changes under focus on Undo, Undo keeps the focus (it now names its slide), and no tap is made", async () => {
      const { send, show } = setup();
      await settle();
      press();
      await settle();
      const button = screen.getByRole("button", { name: "Undo" });
      button.focus();
      show({ viewing: 8 });
      expect(screen.getByRole("button", { name: "Undo slide 7" })).toBe(button);
      expect(button).toHaveFocus();
      await settle();
      expect(ops(send).filter((o) => o.op === "insert")).toHaveLength(1);
      expect(screen.getByRole("button", { name: "I'm lost" })).not.toHaveFocus();
    });

    for (const result of ["rejected", "limited"] as const) {
      it(`keeps the note box and its focus, and leaves I'm lost alone, when a ${result} tap goes while a note is typed`, async () => {
        let finish: (r: SendResult) => void = () => {};
        const send = vi.fn<Send>(() => new Promise<SendResult>((r) => (finish = r)));
        setup({ send });
        await settle();
        press();
        await settle();
        noteField().focus();
        fireEvent.focus(noteField());
        typeNote("hel");
        await act(async () => finish(result));
        expect(noteField()).toHaveValue("hel");
        expect(noteField()).toHaveFocus();
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "I'm lost" })).not.toHaveFocus();
      });
    }

    it("when Undo's 10 seconds run out under focus, focus goes to the panel, never to I'm lost", async () => {
      vi.useFakeTimers();
      setup();
      await settle();
      press();
      undoButton()!.focus();
      await act(async () => vi.advanceTimersByTime(UNDO_MS));
      expect(undoButton()).not.toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Slide 7" })).toHaveFocus();
    });

    it("lets Tab move between the tools (focus is never pulled back while it moves)", async () => {
      setup();
      await settle();
      press();
      const mark = markTool();
      const undoNow = undoButton()!;
      mark.focus();
      fireEvent.blur(mark, { relatedTarget: undoNow });
      undoNow.focus();
      await settle();
      expect(undoNow).toHaveFocus();
      fireEvent.blur(undoNow, { relatedTarget: noteField() });
      noteField().focus();
      await settle();
      expect(noteField()).toHaveFocus();
    });

    it("a double click on Save this saves once and does not unsave (the second click lands on Saved for you)", async () => {
      const { send, onMarkingChange } = setup();
      await settle();
      fireEvent.click(screen.getByRole("button", { name: "Save this" }), { detail: 1 });
      // The second click of the double click lands on whatever is under the pointer now.
      fireEvent.click(saveToggle(), { detail: 2 });
      fireEvent.click(undoButton()!, { detail: 2 });
      await settle();
      expect(ops(send).map((o) => o.op)).toEqual(["insert"]);
      expect(onMarkingChange).not.toHaveBeenCalled();
      expect(saveToggle()).toHaveAccessibleName("Saved for you");
      // A real click on Undo still works.
      fireEvent.click(undoButton()!, { detail: 1 });
      expect(screen.getByRole("button", { name: "Save this" })).toBeInTheDocument();
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
