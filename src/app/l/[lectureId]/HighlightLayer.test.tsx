import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useRef, useState } from "react";
import type { Rect } from "@/lib/rect";
import type { QueueOp, SendResult } from "@/lib/tapQueue";
import { HighlightLayer, type MarkKind, type ShownMark } from "./HighlightLayer";
import { LostButton, type LegacyMarks } from "./LostButton";

const LECTURE = "11111111-1111-1111-1111-111111111111";

/** The layer is 1000 x 500 px at the page's top left. */
function mockLayerSize(width = 1000, height = 500) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    width,
    height,
    toJSON: () => ({}),
  });
}

type StageProps = {
  marking?: boolean;
  markingKind?: MarkKind;
  marks?: ShownMark[];
  selectedId?: string | null;
  onSelect?: (id: string | null, keyboard: boolean) => void;
  onMark?: (r: Rect) => void;
  onCancel?: () => void;
  shown?: { kind: MarkKind; rect: Rect } | null;
  natural?: [number, number];
};

function Stage({ marking = true, markingKind = "lost", marks, selectedId, onSelect, onMark = vi.fn(), onCancel = vi.fn(), shown, natural }: StageProps) {
  const ref = useRef<HTMLImageElement>(null);
  return (
    <div style={{ position: "relative" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={(el) => {
          ref.current = el;
          if (el && natural) {
            Object.defineProperty(el, "naturalWidth", { value: natural[0], configurable: true });
            Object.defineProperty(el, "naturalHeight", { value: natural[1], configurable: true });
          }
        }}
        src="https://signed/3.webp"
        alt="Slide 3"
      />
      <HighlightLayer
        imageRef={ref}
        marking={marking}
        markingKind={markingKind}
        marks={marks}
        selectedId={selectedId}
        onSelect={onSelect}
        onMark={onMark}
        onCancel={onCancel}
        shown={shown}
      />
    </div>
  );
}

const layer = () => document.querySelector("[data-highlight-layer]") as HTMLElement;
const boxes = () => document.querySelectorAll("[data-highlight-box]");
const draftBox = () => document.querySelector("[data-mark-draft]") as HTMLElement | null;
const markButtons = () => screen.queryAllByRole("button", { name: /^Mark \d/ });
const mouse = { pointerType: "mouse", button: 0, pointerId: 1 };
const finger = { pointerType: "touch", button: 0, pointerId: 3 };

function drag(from: [number, number], to: [number, number], init: Record<string, unknown> = mouse) {
  fireEvent.pointerDown(layer(), { ...init, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(layer(), { ...init, clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(layer(), { ...init, clientX: to[0], clientY: to[1] });
}

beforeEach(() => {
  mockLayerSize();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("HighlightLayer", () => {
  it("takes nothing until Mark the spot is on: no drag-first flow, no menu, no hint", () => {
    const onMark = vi.fn();
    render(<Stage marking={false} onMark={onMark} />);
    expect(layer().className).toContain("pointer-events-none");
    drag([100, 100], [300, 200]);
    expect(onMark).not.toHaveBeenCalled();
    expect(boxes()).toHaveLength(0);
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(screen.queryByText(/Drag over/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("while marking, shows a short instruction on the slide and saves the box the moment the drag ends", () => {
    const onMark = vi.fn();
    render(<Stage onMark={onMark} />);
    const hint = screen.getByText("Drag over the part you lost");
    // At the bottom, so it does not cover the slide's title (often the part being marked).
    expect(hint.className).toContain("bottom-3");
    expect(layer()).toHaveAttribute("data-marking");
    expect(layer().style.touchAction).toBe("none");
    drag([100, 100], [300, 200]);
    expect(onMark).toHaveBeenCalledTimes(1);
    expect(onMark).toHaveBeenCalledWith({ x: 0.1, y: 0.2, w: 0.2, h: 0.2 });
  });

  it("says what to drag over for a save", () => {
    render(<Stage markingKind="save" />);
    expect(screen.getByText("Drag over the part to keep")).toBeInTheDocument();
  });

  it("works with a finger (touch) and a pen, not only a mouse", () => {
    const onMark = vi.fn();
    render(<Stage onMark={onMark} />);
    drag([100, 100], [300, 200], finger);
    drag([100, 100], [300, 200], { pointerType: "pen", button: 0, pointerId: 2 });
    expect(onMark).toHaveBeenCalledTimes(2);
  });

  it("draws the box in the highlighter look of its kind while the drag goes on, and hides the instruction under it", () => {
    const { rerender } = render(<Stage />);
    fireEvent.pointerDown(layer(), { ...mouse, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(layer(), { ...mouse, clientX: 300, clientY: 200 });
    expect(draftBox()!.className).toContain("bg-mark-lost");
    expect(draftBox()!.className).toContain("mix-blend-multiply");
    expect(draftBox()!.className).not.toMatch(/border/);
    expect(screen.queryByText("Drag over the part you lost")).not.toBeInTheDocument();
    rerender(<Stage markingKind="save" />);
    expect(draftBox()!.className).toContain("bg-mark");
  });

  it("a plain click, or a 5 by 5 px drag, saves nothing (marking stays on)", () => {
    const onMark = vi.fn();
    render(<Stage onMark={onMark} />);
    drag([100, 100], [100, 100]);
    drag([100, 100], [105, 105]);
    expect(onMark).not.toHaveBeenCalled();
    expect(screen.getByText("Drag over the part you lost")).toBeInTheDocument();
  });

  it("Escape stops marking", () => {
    const onCancel = vi.fn();
    render(<Stage onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("drops a drag that marking ends in the middle of: no dashed box stays, and a later move draws nothing", () => {
    const onMark = vi.fn();
    const release = vi.fn();
    const { rerender } = render(<Stage onMark={onMark} />);
    layer().releasePointerCapture = release;
    fireEvent.pointerDown(layer(), { ...mouse, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(layer(), { ...mouse, clientX: 300, clientY: 200 });
    expect(draftBox()).not.toBeNull();
    rerender(<Stage marking={false} onMark={onMark} />);
    expect(draftBox()).toBeNull();
    expect(release).toHaveBeenCalledWith(1);
    // Marking again: a move without a new press draws nothing, and the old press saves nothing.
    rerender(<Stage onMark={onMark} />);
    fireEvent.pointerMove(layer(), { ...mouse, clientX: 400, clientY: 300 });
    expect(draftBox()).toBeNull();
    fireEvent.pointerUp(layer(), { ...mouse, clientX: 400, clientY: 300 });
    expect(onMark).not.toHaveBeenCalled();
  });

  it("Escape does nothing when not marking", () => {
    const onCancel = vi.fn();
    render(<Stage marking={false} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("clamps a drag that leaves the slide", () => {
    const onMark = vi.fn();
    render(<Stage onMark={onMark} />);
    drag([800, 250], [1400, 900]);
    expect(onMark).toHaveBeenCalledWith({ x: 0.8, y: 0.5, w: 0.2, h: 0.5 });
  });

  it("measures against the drawn slide, not the bars around it", () => {
    // A square slide in a 1000 x 500 layer is drawn 500 x 500, starting 250 px from the left.
    const onMark = vi.fn();
    render(<Stage natural={[800, 800]} onMark={onMark} />);
    drag([300, 100], [500, 300]);
    expect(onMark).toHaveBeenCalledWith({ x: 0.1, y: 0.2, w: 0.4, h: 0.4 });
  });

  it("a drag that starts in the bar beside the slide marks nothing", () => {
    const onMark = vi.fn();
    render(<Stage natural={[800, 800]} onMark={onMark} />);
    drag([100, 100], [400, 300]);
    expect(onMark).not.toHaveBeenCalled();
  });

  it("draws one mark (My spots) as a highlighter: a fill with no border, red tint for lost, yellow for a save", () => {
    const rect = { x: 0.1, y: 0.2, w: 0.2, h: 0.2 };
    const { rerender } = render(<Stage marking={false} shown={{ kind: "lost", rect }} />);
    let box = boxes()[0] as HTMLElement;
    expect(box.className).toContain("bg-mark-lost");
    expect(box.className).toContain("mix-blend-multiply");
    expect(box.className).not.toMatch(/border/);
    expect(box.style.left).toBe("10%");
    rerender(<Stage marking={false} shown={{ kind: "save", rect }} />);
    box = boxes()[0] as HTMLElement;
    expect(box.className).toContain("bg-mark");
    expect(box.className).not.toMatch(/border|bg-mark-lost/);
  });

  describe("several marks", () => {
    const A: ShownMark = { id: "a", rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, kind: "save" };
    const B: ShownMark = { id: "b", rect: { x: 0.5, y: 0.5, w: 0.3, h: 0.2 }, kind: "save", note: "ask about this" };

    it("draws each one as a highlighter button over the slide, numbered, with its note in its name", () => {
      render(<Stage marking={false} marks={[A, B]} />);
      expect(markButtons().map((b) => b.getAttribute("aria-label"))).toEqual(["Mark 1", "Mark 2: ask about this"]);
      const [a, b] = markButtons();
      expect(a).toHaveAttribute("data-highlight-box");
      expect(a.className).toContain("bg-mark");
      expect(a.className).toContain("mix-blend-multiply");
      expect(a.className).not.toMatch(/border/);
      expect(b.style.left).toBe("50%");
      expect(b.style.width).toBe("30%");
      expect(a).toHaveAttribute("aria-haspopup", "dialog");
      expect(a).toHaveAttribute("aria-expanded", "false");
    });

    it("draws red marks on a lost slide, and says so", () => {
      render(<Stage marking={false} marks={[{ ...A, kind: "lost" }]} />);
      const [a] = markButtons();
      expect(a).toHaveAccessibleName("Mark 1, lost");
      expect(a.className).toContain("bg-mark-lost");
      expect(a.className.split(" ")).not.toContain("bg-mark");
    });

    it("a click selects a mark (a click on the selected one lets it go); Enter or Space says keyboard", () => {
      const onSelect = vi.fn();
      const { rerender } = render(<Stage marking={false} marks={[A, B]} onSelect={onSelect} />);
      fireEvent.click(markButtons()[1], { detail: 1 });
      expect(onSelect).toHaveBeenLastCalledWith("b", false);
      rerender(<Stage marking={false} marks={[A, B]} onSelect={onSelect} selectedId="b" />);
      expect(markButtons()[1]).toHaveAttribute("aria-expanded", "true");
      expect(markButtons()[1]).toHaveAttribute("data-selected");
      expect(markButtons()[1].className).toContain("outline-ink");
      fireEvent.click(markButtons()[1], { detail: 1 });
      expect(onSelect).toHaveBeenLastCalledWith(null, false);
      // A keyboard press (Enter or Space) is a click with detail 0.
      fireEvent.click(markButtons()[0], { detail: 0 });
      expect(onSelect).toHaveBeenLastCalledWith("a", true);
    });

    it("a selected red mark gets a red outline", () => {
      render(<Stage marking={false} marks={[{ ...A, kind: "lost" }]} selectedId="a" />);
      expect(markButtons()[0].className).toContain("outline-lost");
    });

    it("can be reached with Tab: the marks are buttons in the page's order", () => {
      render(<Stage marking={false} marks={[A, B]} />);
      for (const b of markButtons()) expect(b.tabIndex).toBe(0);
    });

    it("while marking, a drag over a mark adds another, and a click on a mark selects it", () => {
      const onMark = vi.fn();
      const onSelect = vi.fn();
      render(<Stage marks={[A, B]} onMark={onMark} onSelect={onSelect} markingKind="save" />);
      // The marks let the drag through to the layer.
      for (const b of markButtons()) expect(b.className).toContain("pointer-events-none");
      drag([550, 260], [800, 400]);
      expect(onMark).toHaveBeenCalledTimes(1);
      expect(onSelect).not.toHaveBeenCalled();
      // A click inside B (x 0.5 to 0.8, y 0.5 to 0.7 of the 1000 x 500 slide).
      drag([600, 300], [600, 300]);
      expect(onSelect).toHaveBeenCalledWith("b", false);
      expect(onMark).toHaveBeenCalledTimes(1);
      // A click on no mark selects nothing.
      drag([950, 20], [950, 20]);
      expect(onSelect).toHaveBeenCalledTimes(1);
    });
  });

  it("has no keyboard shortcut for marking", () => {
    const onMark = vi.fn();
    render(<Stage marking={false} onMark={onMark} />);
    for (const key of ["h", "H", "m", "l", "s", "Enter", " "]) fireEvent.keyDown(window, { key });
    expect(onMark).not.toHaveBeenCalled();
    expect(screen.queryByText(/Drag over/)).not.toBeInTheDocument();
  });
});

describe("HighlightLayer with the I'm lost panel, before migration 0020 (one mark on the tap)", () => {
  // The page's wiring, in small: the panel's Mark tool turns marking on, the layer takes the drag, and
  // with no slide_marks table the panel keeps the box on the slide's spot (lost_taps.hl_*).
  function Page({ send }: { send: (op: QueueOp) => Promise<SendResult> }) {
    const ref = useRef<HTMLImageElement>(null);
    const legacy = useRef<LegacyMarks | null>(null);
    const [marking, setMarking] = useState(false);
    return (
      <>
        <div style={{ position: "relative" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={ref} src="https://signed/7.webp" alt="Slide 7" />
          <HighlightLayer imageRef={ref} marking={marking} onMark={(r) => legacy.current?.add(r)} onCancel={() => setMarking(false)} />
        </div>
        <LostButton
          lectureId={LECTURE}
          viewing={7}
          send={send}
          loadOwn={async () => []}
          onSpots={() => {}}
          marking={marking}
          onMarkingChange={setMarking}
          onMarkReady={(m) => (legacy.current = m)}
        />
      </>
    );
  }
  const settle = () => act(async () => {});
  const markTool = () => screen.getByRole("button", { name: "Mark" });

  beforeEach(() => {
    localStorage.clear();
  });

  it("I'm lost, Mark, drag: the tap then the box as an update of that tap, and the tool stays on", async () => {
    const send = vi.fn<(op: QueueOp) => Promise<SendResult>>(async () => "ok");
    render(<Page send={send} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "I'm lost" }));
    await settle();
    fireEvent.click(markTool());
    expect(markTool()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Drag over the part to keep")).toBeInTheDocument();
    drag([100, 100], [300, 200], finger);
    await settle();
    const [insert, update] = send.mock.calls.map((c) => c[0]);
    if (insert.op !== "insert") throw new Error("expected an insert");
    expect(insert.tap).not.toHaveProperty("rect");
    expect(update).toEqual({ op: "update", id: insert.tap.id, patch: { rect: { x: 0.1, y: 0.2, w: 0.2, h: 0.2 } } });
    expect(markTool()).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(markTool());
    expect(screen.queryByText(/Drag over/)).not.toBeInTheDocument();
  });

  it("the plain I'm lost button still queues a plain tap with no kind and no rect", async () => {
    const send = vi.fn<(op: QueueOp) => Promise<SendResult>>(async () => "ok");
    render(<Page send={send} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "I'm lost" }));
    await settle();
    const [op] = send.mock.calls.map((c) => c[0]);
    if (op.op !== "insert") throw new Error("expected an insert");
    expect(op.tap.kind).toBeUndefined();
    expect(op.tap.rect).toBeUndefined();
  });

  it("a drag on the slide does nothing until Mark is on", async () => {
    const send = vi.fn<(op: QueueOp) => Promise<SendResult>>(async () => "ok");
    render(<Page send={send} />);
    await settle();
    drag([100, 100], [300, 200]);
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it("Mark works without Save this or I'm lost: the slide is saved just for the student with the box", async () => {
    const send = vi.fn<(op: QueueOp) => Promise<SendResult>>(async () => "ok");
    render(<Page send={send} />);
    await settle();
    fireEvent.click(markTool());
    drag([100, 100], [300, 200]);
    await settle();
    const [op] = send.mock.calls.map((c) => c[0]);
    expect(op).toMatchObject({ op: "insert", tap: { tappedOnSlide: 7, kind: "save", rect: { x: 0.1, y: 0.2, w: 0.2, h: 0.2 } } });
    expect(screen.getByRole("button", { name: "Saved for you" })).toHaveAttribute("aria-pressed", "true");
  });
});
