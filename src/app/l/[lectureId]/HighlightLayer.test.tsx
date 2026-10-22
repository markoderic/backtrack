import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useRef, useState } from "react";
import type { Rect } from "@/lib/rect";
import type { QueueOp, SendResult } from "@/lib/tapQueue";
import { HighlightLayer, type Highlight } from "./HighlightLayer";
import { LostButton } from "./LostButton";

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
  markingKind?: Highlight["kind"];
  onMark?: (r: Rect) => void;
  onCancel?: () => void;
  shown?: Highlight | null;
  natural?: [number, number];
};

function Stage({ marking = true, markingKind, onMark = vi.fn(), onCancel = vi.fn(), shown, natural }: StageProps) {
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
        onMark={onMark}
        onCancel={onCancel}
        shown={shown}
      />
    </div>
  );
}

const layer = () => document.querySelector("[data-highlight-layer]") as HTMLElement;
const boxes = () => document.querySelectorAll("[data-highlight-box]");
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

  it("draws a dashed box while the drag goes on, and hides the instruction under it", () => {
    render(<Stage />);
    fireEvent.pointerDown(layer(), { ...mouse, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(layer(), { ...mouse, clientX: 300, clientY: 200 });
    const box = boxes()[0] as HTMLElement;
    expect(box.className).toContain("border-dashed");
    expect(screen.queryByText("Drag over the part you lost")).not.toBeInTheDocument();
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
    expect(boxes()).toHaveLength(1);
    rerender(<Stage marking={false} onMark={onMark} />);
    expect(boxes()).toHaveLength(0);
    expect(release).toHaveBeenCalledWith(1);
    // Marking again: a move without a new press draws nothing, and the old press saves nothing.
    rerender(<Stage onMark={onMark} />);
    fireEvent.pointerMove(layer(), { ...mouse, clientX: 400, clientY: 300 });
    expect(boxes()).toHaveLength(0);
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

  it("draws a saved mark in its kind's look: lost tint and red border, or an ink border for a save", () => {
    const rect = { x: 0.1, y: 0.2, w: 0.2, h: 0.2 };
    const { rerender } = render(<Stage marking={false} shown={{ kind: "lost", rect }} />);
    let box = boxes()[0] as HTMLElement;
    expect(box.className).toContain("border-lost");
    expect(box.className).toContain("bg-lost-tint");
    expect(box.style.left).toBe("10%");
    rerender(<Stage marking={false} shown={{ kind: "save", rect }} />);
    box = boxes()[0] as HTMLElement;
    expect(box.className).toContain("border-ink");
    expect(box.className).not.toContain("border-dashed");
    expect(box.className).not.toContain("bg-lost-tint");
  });

  it("has no keyboard shortcut for marking", () => {
    const onMark = vi.fn();
    render(<Stage marking={false} onMark={onMark} />);
    for (const key of ["h", "H", "m", "l", "s", "Enter", " "]) fireEvent.keyDown(window, { key });
    expect(onMark).not.toHaveBeenCalled();
    expect(screen.queryByText(/Drag over/)).not.toBeInTheDocument();
  });
});

describe("HighlightLayer with the I'm lost panel", () => {
  // The page's wiring, in small: the panel turns marking on, the layer takes the drag, the panel saves the box.
  function Page({ send }: { send: (op: QueueOp) => Promise<SendResult> }) {
    const ref = useRef<HTMLImageElement>(null);
    const markRef = useRef<((r: Rect) => void) | null>(null);
    const [marking, setMarking] = useState(false);
    return (
      <>
        <div style={{ position: "relative" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={ref} src="https://signed/7.webp" alt="Slide 7" />
          <HighlightLayer imageRef={ref} marking={marking} onMark={(r) => markRef.current?.(r)} onCancel={() => setMarking(false)} />
        </div>
        <LostButton
          lectureId={LECTURE}
          viewing={7}
          send={send}
          loadOwn={async () => []}
          onSpots={() => {}}
          marking={marking}
          onMarkingChange={setMarking}
          onMarkReady={(m) => (markRef.current = m)}
        />
      </>
    );
  }
  const settle = () => act(async () => {});

  beforeEach(() => {
    localStorage.clear();
  });

  it("I'm lost, Mark the spot, drag: the tap then the box as an update of that tap, and marking ends", async () => {
    const send = vi.fn<(op: QueueOp) => Promise<SendResult>>(async () => "ok");
    render(<Page send={send} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "I'm lost" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Mark the spot" }));
    expect(screen.getByText("Drag over the part you lost")).toBeInTheDocument();
    drag([100, 100], [300, 200], finger);
    await settle();
    const [insert, update] = send.mock.calls.map((c) => c[0]);
    if (insert.op !== "insert") throw new Error("expected an insert");
    expect(insert.tap).not.toHaveProperty("rect");
    expect(update).toEqual({ op: "update", id: insert.tap.id, patch: { rect: { x: 0.1, y: 0.2, w: 0.2, h: 0.2 } } });
    expect(screen.queryByText(/Drag over/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear mark" })).toBeInTheDocument();
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

  it("a drag on the slide before any tap queues nothing", async () => {
    const send = vi.fn<(op: QueueOp) => Promise<SendResult>>(async () => "ok");
    render(<Page send={send} />);
    await settle();
    drag([100, 100], [300, 200]);
    await settle();
    expect(send).not.toHaveBeenCalled();
  });
});
