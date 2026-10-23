import { Activity, Component, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import type { Rect } from "@/lib/rect";
import type { QueueOp, SendResult } from "@/lib/tapQueue";
import { LostButton, NOTE_MAX, UNDO_MS, type Spot } from "./LostButton";

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
const noteField = () => screen.getByRole("textbox", { name: /Your note/ }) as HTMLTextAreaElement;
const typeNote = (text: string) => fireEvent.change(noteField(), { target: { value: text } });
const saveButton = () => screen.getByRole("button", { name: "Save note" });
const saveNote = () => fireEvent.click(saveButton());
const undoButton = () => screen.queryByRole("button", { name: "Undo" });
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
  it("is the I'm lost button, Save this and the note box, and nothing else until one is pressed", async () => {
    setup();
    await settle();
    expect(screen.getAllByRole("button").map((b) => b.textContent || b.getAttribute("aria-label"))).toEqual([
      "I'm lost",
      "Save this",
      "Save note",
    ]);
    expect(noteField()).toHaveAttribute("placeholder", "Add a note");
    expect(saveButton()).toBeDisabled();
    expect(undoButton()).not.toBeInTheDocument();
  });

  it("checks the button right away (Lost on slide 7), before the send has resolved, with the spot's tools", async () => {
    const send = vi.fn<Send>(() => new Promise<SendResult>(() => {}));
    setup({ send });
    await settle();
    press();
    // Straight away, in the same tick as the press: the send has not even started.
    expect(checked()).toHaveAttribute("aria-disabled", "true");
    expect(undoButton()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark the spot" })).toBeInTheDocument();
    // The note box stays where it was.
    expect(noteField()).toBeInTheDocument();
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
      expect(screen.getByRole("button", { name: "Mark the spot" })).toBeInTheDocument();
      expect(ops(send).map((o) => o.op)).toEqual(["insert"]);
      // Mark the spot takes the whole row once Undo has gone.
      expect(screen.getByRole("button", { name: "Mark the spot" }).className).toContain("col-span-2");
    });

    it("goes away when another slide comes on screen (the Saved line closes), and does not come back", async () => {
      vi.useFakeTimers();
      const { show } = setup();
      await settle();
      press();
      show({ viewing: 8 });
      expect(undoButton()).not.toBeInTheDocument();
      await act(async () => vi.advanceTimersByTime(1000));
      show({ viewing: 7 });
      expect(checked()).toBeInTheDocument();
      expect(undoButton()).not.toBeInTheDocument();
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
        const props: Props = { lectureId: LECTURE, viewing: 7, send: okSend(), loadOwn: vi.fn(async () => [] as Row[]), onSpots: vi.fn() };
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
      expect(screen.getByRole("button", { name: "I'm lost" })).not.toHaveAttribute("aria-disabled");
      expect(screen.getByText("Saved slide 7, just for you")).toBeInTheDocument();
      expect(undoButton()).not.toBeInTheDocument();
    });
  });

  describe("note", () => {
    it("is a box that is always there, under I'm lost and Save this: 2 lines, 140 characters, Add a note, with Save note", async () => {
      setup();
      await settle();
      const field = noteField();
      expect(field.tagName).toBe("TEXTAREA");
      expect(field).toHaveAttribute("rows", "2");
      expect(field).toHaveAttribute("maxLength", String(NOTE_MAX));
      expect(field).toHaveAttribute("placeholder", "Add a note");
      // Under I'm lost and Save this in the panel.
      const save = screen.getByRole("button", { name: "Save this" });
      expect(save.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // Notes are in Geist (type-body), not the italic serif.
      expect(field.className).toContain("type-body");
      expect(field.className).not.toContain("type-note");
      // Still there after a tap, and after Undo.
      press();
      expect(noteField()).toBeInTheDocument();
      undo();
      expect(noteField()).toBeInTheDocument();
    });

    it("shows a quiet counter only near the limit", async () => {
      setup();
      await settle();
      typeNote("a".repeat(119));
      expect(screen.queryByText(/left$/)).not.toBeInTheDocument();
      typeNote("a".repeat(130));
      expect(screen.getByText("10 left")).toBeInTheDocument();
    });

    it("after a tap, Save note queues a note update for that tap, keeps the note in the box, and says Note saved.", async () => {
      const { send, onSpots } = setup();
      await settle();
      press();
      await settle();
      typeNote("  why is this a credit  ");
      saveNote();
      await settle();
      const [insert, update] = ops(send);
      if (insert.op !== "insert") throw new Error("expected an insert");
      expect(update).toEqual({ op: "update", id: insert.tap.id, patch: { note: "why is this a credit" } });
      expect(ops(send).filter((o) => o.op === "insert")).toHaveLength(1);
      expect(noteField()).toHaveValue("why is this a credit");
      expect(saveButton()).toBeDisabled();
      expect(status()).toHaveTextContent("Note saved.");
      expect(onSpots.mock.lastCall?.[0][0]).toMatchObject({ slide: 7, note: "why is this a credit" });
    });

    it("on a slide with no tap yet, a note records I'm lost on that slide with the note, in one insert, and Undo takes it back", async () => {
      const onTap = vi.fn();
      const { send, lastSpots } = setup({ onTap });
      await settle();
      typeNote("lost on the timing part");
      fireEvent.keyDown(noteField(), { key: "Enter" });
      await settle();
      expect(ops(send)).toEqual([
        { op: "insert", tap: expect.objectContaining({ tappedOnSlide: 7, note: "lost on the timing part" }) },
      ]);
      const [op] = ops(send);
      if (op.op !== "insert") throw new Error("expected an insert");
      // An I'm lost (no kind), not a save.
      expect(op.tap.kind).toBeUndefined();
      expect(onTap).toHaveBeenCalledWith("lost");
      expect(checked()).toBeInTheDocument();
      expect(lastSpots()).toEqual([7]);
      expect(noteField()).toHaveValue("lost on the timing part");
      expect(status()).toHaveTextContent("Saved slide 7. Note saved.");
      undo();
      await settle();
      expect(ops(send)[1]).toEqual({ op: "update", id: op.tap.id, patch: { undone: true } });
      expect(lastSpots()).toEqual([]);
      expect(screen.getByRole("button", { name: "I'm lost" })).not.toHaveAttribute("aria-disabled");
    });

    it("on a saved-for-you slide, the note goes on the save (no I'm lost)", async () => {
      const { send } = setup();
      await settle();
      fireEvent.click(screen.getByRole("button", { name: "Save this" }));
      await settle();
      typeNote("keep for the exam");
      saveNote();
      await settle();
      const [insert, update] = ops(send);
      if (insert.op !== "insert") throw new Error("expected an insert");
      expect(insert.tap.kind).toBe("save");
      expect(update).toEqual({ op: "update", id: insert.tap.id, patch: { note: "keep for the exam" } });
      expect(screen.getByRole("button", { name: "I'm lost" })).not.toHaveAttribute("aria-disabled");
    });

    it("Enter saves, Shift+Enter does not, Esc drops the changes", async () => {
      const { send } = setup();
      await settle();
      press();
      await settle();
      typeNote("first");
      fireEvent.keyDown(noteField(), { key: "Enter", shiftKey: true });
      expect(ops(send).filter((o) => o.op === "update")).toEqual([]);
      fireEvent.keyDown(noteField(), { key: "Escape" });
      expect(noteField()).toHaveValue("");
      expect(saveButton()).toBeDisabled();
      typeNote("second");
      fireEvent.keyDown(noteField(), { key: "Enter" });
      await settle();
      expect(ops(send).filter((o) => o.op === "update")).toEqual([expect.objectContaining({ patch: { note: "second" } })]);
    });

    it("shows a saved note in the box, and saving a changed one sends the new text", async () => {
      const { send } = setup({ loadOwn: vi.fn(async () => [{ id: "a", slide: 7, kind: "lost" as const, note: "old" }]) });
      await settle();
      expect(noteField()).toHaveValue("old");
      typeNote("new");
      saveNote();
      await settle();
      expect(ops(send)).toEqual([{ op: "update", id: "a", patch: { note: "new" } }]);
      expect(noteField()).toHaveValue("new");
    });

    it("emptying a saved note and saving takes it off", async () => {
      const { send } = setup({ loadOwn: vi.fn(async () => [{ id: "a", slide: 7, kind: "lost" as const, note: "old" }]) });
      await settle();
      typeNote("  ");
      saveNote();
      await settle();
      expect(ops(send)).toEqual([{ op: "update", id: "a", patch: { note: "" } }]);
      expect(status()).toHaveTextContent("Note removed.");
      expect(noteField()).toHaveValue("");
    });

    it("saving an unchanged or blank note sends nothing (Save note stays off)", async () => {
      const { send } = setup({ loadOwn: vi.fn(async () => [{ id: "a", slide: 7, kind: "lost" as const, note: "same" }]) });
      await settle();
      typeNote("same");
      expect(saveButton()).toBeDisabled();
      fireEvent.keyDown(noteField(), { key: "Enter" });
      await settle();
      expect(send).not.toHaveBeenCalled();
      // A blank box on a slide with no spot records nothing either.
      const other = setup({ viewing: 3 });
      await settle();
      fireEvent.change(within(other.container).getByRole("textbox"), { target: { value: "   " } });
      fireEvent.keyDown(within(other.container).getByRole("textbox"), { key: "Enter" });
      await settle();
      expect(other.send).not.toHaveBeenCalled();
    });

    it("keeps a note being typed when the slide changes, and saves it on the slide it was for", async () => {
      const { send, show } = setup();
      await settle();
      press();
      await settle();
      typeNote("half a tho");
      show({ viewing: 8 });
      expect(noteField()).toHaveValue("half a tho");
      expect(noteField()).toHaveAccessibleName("Your note on slide 7");
      expect(screen.getByText("Note for slide 7")).toBeInTheDocument();
      // The button is for slide 8 now.
      expect(screen.getByRole("button", { name: "I'm lost" })).not.toHaveAttribute("aria-disabled");
      typeNote("half a thought");
      saveNote();
      await settle();
      const [insert, update] = ops(send);
      if (insert.op !== "insert") throw new Error("expected an insert");
      expect(insert.tap.tappedOnSlide).toBe(7);
      expect(update).toEqual({ op: "update", id: insert.tap.id, patch: { note: "half a thought" } });
      // Back to slide 8's own box.
      expect(noteField()).toHaveValue("");
      expect(noteField()).toHaveAccessibleName("Your note");
    });

    it("a note started on a slide with no tap, sent after the teacher moved on, records I'm lost on the slide it was started on", async () => {
      const { send, show } = setup();
      await settle();
      typeNote("what was that formula");
      show({ viewing: 8 });
      fireEvent.keyDown(noteField(), { key: "Enter" });
      await settle();
      const [op] = ops(send);
      if (op.op !== "insert") throw new Error("expected an insert");
      expect(op.tap).toMatchObject({ tappedOnSlide: 7, note: "what was that formula" });
      expect(ops(send)).toHaveLength(1);
      // Slide 8 is untouched.
      expect(screen.getByRole("button", { name: "I'm lost" })).not.toHaveAttribute("aria-disabled");
    });

    it("a box left as it was follows the new slide", async () => {
      const { show } = setup({ loadOwn: vi.fn(async () => [{ id: "a", slide: 7, kind: "lost" as const, note: "seven" }]) });
      await settle();
      typeNote("seven");
      show({ viewing: 8 });
      expect(noteField()).toHaveValue("");
      expect(noteField()).toHaveAccessibleName("Your note");
    });

    it("Undo after a note on an unsent tap sends neither", async () => {
      const send = vi.fn<Send>(async () => "offline");
      setup({ send });
      await settle();
      press();
      await settle();
      typeNote("hello");
      saveNote();
      await settle();
      undo();
      await settle();
      expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toEqual([]);
    });

    it("gives back a note saved on a new tap whose insert is then refused (the dropped update carried it)", async () => {
      let finish: (r: SendResult) => void = () => {};
      const send = vi.fn<Send>((op) => (op.op === "insert" ? new Promise<SendResult>((r) => (finish = r)) : Promise.resolve("ok")));
      setup({ send });
      await settle();
      press();
      await settle();
      typeNote("saved after the tap");
      saveNote();
      expect(noteField()).toHaveValue("saved after the tap");
      await act(async () => finish("limited"));
      await settle();
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(noteField()).toHaveValue("saved after the tap");
      expect(saveButton()).toBeEnabled();
    });

    it("shows a short Note saved line under the box (Note saved on slide 7 when it went to another slide), gone after 3 s", async () => {
      vi.useFakeTimers();
      const { show } = setup();
      await settle();
      typeNote("on seven");
      show({ viewing: 8 });
      fireEvent.keyDown(noteField(), { key: "Enter" });
      expect(document.querySelector("[data-noted]")).toHaveTextContent("Note saved on slide 7");
      await act(async () => vi.advanceTimersByTime(3000));
      expect(document.querySelector("[data-noted]")).toBeNull();
      typeNote("on eight");
      fireEvent.keyDown(noteField(), { key: "Enter" });
      expect(document.querySelector("[data-noted]")).toHaveTextContent(/^Note saved$/);
    });

    it("ties the counter to the box for a screen reader while it shows", async () => {
      setup();
      await settle();
      typeNote("a".repeat(119));
      expect(noteField()).not.toHaveAttribute("aria-describedby");
      typeNote("a".repeat(130));
      expect(noteField()).toHaveAccessibleDescription("10 left");
    });

    for (const result of ["rejected", "limited"] as const) {
      it(`puts the note back in the box when the ${result} tap it was sent with does not save`, async () => {
        const send = vi.fn<Send>(async () => result);
        const { lastSpots } = setup({ send });
        await settle();
        typeNote("my note");
        saveNote();
        await settle();
        expect(lastSpots()).toEqual([]);
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect(noteField()).toHaveValue("my note");
        expect(saveButton()).toBeEnabled();
        // One insert only, never retried.
        expect(send).toHaveBeenCalledTimes(1);
      });
    }
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
      expect(noteField()).toHaveValue("kept");
      expect(screen.getByRole("button", { name: "Clear mark" })).toBeInTheDocument();
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
      it(`keeps the note box and its focus, and leaves I'm lost alone, when a ${result} tap goes while a note is typed`, async () => {
        let finish: (r: SendResult) => void = () => {};
        const send = vi.fn<Send>(() => new Promise<SendResult>((r) => (finish = r)));
        setup({ send });
        await settle();
        press();
        await settle();
        noteField().focus();
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
      const mark = screen.getByRole("button", { name: "Mark the spot" });
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

    it("a double click on Save this does not land on Undo or Mark the spot, which take its place", async () => {
      const { send, onMarkingChange } = setup();
      await settle();
      fireEvent.click(screen.getByRole("button", { name: "Save this" }), { detail: 1 });
      // The second click of the double click lands on whatever is under the pointer now.
      fireEvent.click(undoButton()!, { detail: 2 });
      fireEvent.click(screen.getByRole("button", { name: "Mark the spot" }), { detail: 2 });
      await settle();
      expect(ops(send).map((o) => o.op)).toEqual(["insert"]);
      expect(onMarkingChange).not.toHaveBeenCalledWith(true);
      expect(screen.getByText("Saved slide 7, just for you")).toBeInTheDocument();
      // A real click still works.
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
