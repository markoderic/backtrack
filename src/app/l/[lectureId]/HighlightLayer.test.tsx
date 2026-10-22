import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act, waitFor } from "@testing-library/react";
import { useRef } from "react";
import type { QueueOp, SendResult } from "@/lib/tapQueue";
import { HighlightLayer, MENU_HEIGHT } from "./HighlightLayer";
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

function Stage({
  viewing = 3,
  onChoose,
  natural,
}: {
  viewing?: number;
  onChoose: (h: unknown) => void;
  natural?: [number, number];
}) {
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
        alt={`Slide ${viewing}`}
      />
      <HighlightLayer viewing={viewing} imageRef={ref} onChoose={onChoose} />
    </div>
  );
}

const layer = () => document.querySelector("[data-highlight-layer]") as HTMLElement;
const menu = () => screen.queryByRole("group", { name: "Highlight" });
const mouse = { pointerType: "mouse", button: 0, pointerId: 1 };

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
  it("shows nothing until the student drags", () => {
    render(<Stage onChoose={vi.fn()} />);
    expect(menu()).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Highlight" })).not.toBeInTheDocument();
  });

  it("a mouse drag draws a dashed box and opens the menu with I'm lost and Save this (the note comes after, in the saved line)", () => {
    const { container } = render(<Stage onChoose={vi.fn()} />);
    drag([300, 200], [100, 100]);
    const m = within(menu()!);
    expect(m.getByRole("button", { name: "I'm lost" })).toBeInTheDocument();
    expect(m.getByRole("button", { name: "Save this" })).toBeInTheDocument();
    expect(m.getAllByRole("button")).toHaveLength(2);
    expect(m.queryByRole("textbox")).not.toBeInTheDocument();
    expect((container.querySelector("[data-highlight-box]") as HTMLElement).className).toContain("border-dashed");
    const box = container.querySelector("[data-highlight-box]") as HTMLElement;
    expect(box.style.left).toBe("10%");
    expect(box.style.top).toBe("20%");
    expect(box.style.width).toBe("20%");
    expect(box.style.height).toBe("20%");
  });

  describe("where the menu goes", () => {
    // The slide is 1000 x 500 px; the menu is one row, MENU_HEIGHT tall.
    const top = () => parseFloat((menu() as HTMLElement).style.top);
    const insideSlide = () => {
      expect(top()).toBeGreaterThanOrEqual(0);
      expect(top() + MENU_HEIGHT).toBeLessThanOrEqual(500);
    };

    it("goes under a small box high on the slide", () => {
      render(<Stage onChoose={vi.fn()} />);
      drag([100, 100], [300, 200]);
      expect(top()).toBe(208);
      insideSlide();
    });

    it("goes above a small box low on the slide", () => {
      render(<Stage onChoose={vi.fn()} />);
      drag([100, 400], [300, 480]);
      expect(top()).toBeLessThan(400);
      insideSlide();
    });

    it("stays inside the slide for a box that covers the whole slide", () => {
      render(<Stage onChoose={vi.fn()} />);
      drag([0, 0], [1000, 500]);
      insideSlide();
    });

    it("stays inside the slide for a tall box with no room above or below", () => {
      render(<Stage onChoose={vi.fn()} />);
      drag([100, 50], [300, 450]);
      insideSlide();
    });

    it("stays inside the slide when the slide is shorter than the menu", () => {
      mockLayerSize(1000, 40);
      render(<Stage onChoose={vi.fn()} />);
      drag([100, 5], [300, 35]);
      expect(top()).toBe(0);
    });

    it("lines the menu up with the box's left edge, and keeps it from running off the right edge", () => {
      render(<Stage onChoose={vi.fn()} />);
      drag([100, 100], [300, 200]);
      const spacer = menu()!.firstElementChild as HTMLElement;
      expect(spacer.style.flexBasis).toBe("10%");
      expect(spacer.className).toMatch(/\bshrink\b/);
      expect(spacer.className).toMatch(/\bmin-w-0\b/);
    });

    it("lets the buttons be used: the menu is selectable text with a normal cursor", () => {
      render(<Stage onChoose={vi.fn()} />);
      drag([100, 100], [300, 200]);
      expect(menu()!.className).toContain("select-text");
      expect(menu()!.className).toContain("cursor-auto");
    });
  });

  it("a pen drag starts a highlight too", () => {
    render(<Stage onChoose={vi.fn()} />);
    drag([100, 100], [300, 200], { pointerType: "pen", button: 0, pointerId: 2 });
    expect(menu()).toBeInTheDocument();
  });

  it("draws the box while the mouse is still down", () => {
    const { container } = render(<Stage onChoose={vi.fn()} />);
    fireEvent.pointerDown(layer(), { ...mouse, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(layer(), { ...mouse, clientX: 300, clientY: 200 });
    expect(container.querySelector("[data-highlight-box]")).toBeInTheDocument();
    expect(menu()).not.toBeInTheDocument();
  });

  it("Save this hands over kind save and the rect, and closes the menu", () => {
    const onChoose = vi.fn();
    const { container } = render(<Stage onChoose={onChoose} />);
    drag([300, 200], [100, 100]);
    fireEvent.click(within(menu()!).getByRole("button", { name: "Save this" }));
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith({ kind: "save", rect: { x: 0.1, y: 0.2, w: 0.2, h: 0.2 } });
    expect(menu()).not.toBeInTheDocument();
    expect(container.querySelector("[data-highlight-box]")).not.toBeInTheDocument();
  });

  it("I'm lost hands over kind lost and the rect", () => {
    const onChoose = vi.fn();
    render(<Stage onChoose={onChoose} />);
    drag([100, 100], [300, 200]);
    fireEvent.click(within(menu()!).getByRole("button", { name: "I'm lost" }));
    expect(onChoose).toHaveBeenCalledWith({ kind: "lost", rect: { x: 0.1, y: 0.2, w: 0.2, h: 0.2 } });
  });

  it("draws a chosen box in its kind's look: lost tint and red border, or an ink border for a save", () => {
    const rect = { x: 0.1, y: 0.2, w: 0.2, h: 0.2 };
    const { container, rerender } = render(<Stage onChoose={vi.fn()} />);
    const ref = { current: null };
    rerender(<HighlightLayer viewing={3} imageRef={ref} onChoose={vi.fn()} chosen={{ kind: "lost", rect }} />);
    let box = container.querySelector("[data-highlight-box]") as HTMLElement;
    expect(box.className).toContain("border-lost");
    expect(box.className).toContain("bg-lost-tint");
    expect(box.style.left).toBe("10%");
    rerender(<HighlightLayer viewing={3} imageRef={ref} onChoose={vi.fn()} chosen={{ kind: "save", rect }} />);
    box = container.querySelector("[data-highlight-box]") as HTMLElement;
    expect(box.className).toContain("border-ink");
    expect(box.className).not.toContain("border-dashed");
    expect(box.className).not.toContain("bg-lost-tint");
  });

  it("a plain click on the slide does nothing", () => {
    const onChoose = vi.fn();
    render(<Stage onChoose={onChoose} />);
    drag([100, 100], [100, 100]);
    expect(menu()).not.toBeInTheDocument();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("a 5 by 5 px drag is a click", () => {
    const onChoose = vi.fn();
    render(<Stage onChoose={onChoose} />);
    drag([100, 100], [105, 105]);
    expect(menu()).not.toBeInTheDocument();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("Escape cancels without choosing", () => {
    const onChoose = vi.fn();
    render(<Stage onChoose={onChoose} />);
    drag([100, 100], [300, 200]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(menu()).not.toBeInTheDocument();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("a press outside the slide cancels", () => {
    const onChoose = vi.fn();
    render(
      <>
        <button type="button">Elsewhere</button>
        <Stage onChoose={onChoose} />
      </>,
    );
    drag([100, 100], [300, 200]);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }), { ...mouse });
    expect(menu()).not.toBeInTheDocument();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("a click on the slide while the menu is open cancels it", () => {
    render(<Stage onChoose={vi.fn()} />);
    drag([100, 100], [300, 200]);
    drag([700, 400], [700, 400]);
    expect(menu()).not.toBeInTheDocument();
  });

  it("pressing inside the menu does not cancel it", () => {
    render(<Stage onChoose={vi.fn()} />);
    drag([100, 100], [300, 200]);
    fireEvent.pointerDown(within(menu()!).getByRole("button", { name: "Save this" }), { ...mouse });
    expect(menu()).toBeInTheDocument();
  });

  it("a second drag replaces the first", () => {
    const onChoose = vi.fn();
    render(<Stage onChoose={onChoose} />);
    drag([100, 100], [300, 200]);
    drag([500, 250], [900, 450]);
    fireEvent.click(within(menu()!).getByRole("button", { name: "Save this" }));
    expect(onChoose).toHaveBeenCalledWith({ kind: "save", rect: { x: 0.5, y: 0.5, w: 0.4, h: 0.4 } });
  });

  it("clamps a drag that leaves the slide", () => {
    const onChoose = vi.fn();
    render(<Stage onChoose={onChoose} />);
    drag([800, 250], [1400, 900]);
    fireEvent.click(within(menu()!).getByRole("button", { name: "Save this" }));
    expect(onChoose).toHaveBeenCalledWith({ kind: "save", rect: { x: 0.8, y: 0.5, w: 0.2, h: 0.5 } });
  });

  it("drops the highlight when the slide on screen changes", () => {
    const onChoose = vi.fn();
    const { rerender } = render(<Stage viewing={3} onChoose={onChoose} />);
    drag([100, 100], [300, 200]);
    expect(menu()).toBeInTheDocument();
    rerender(<Stage viewing={4} onChoose={onChoose} />);
    expect(menu()).not.toBeInTheDocument();
    rerender(<Stage viewing={3} onChoose={onChoose} />);
    expect(menu()).not.toBeInTheDocument();
  });

  it("measures against the drawn slide, not the black bars around it", () => {
    // A square slide in a 1000 x 500 layer is drawn 500 x 500, starting 250 px from the left.
    const onChoose = vi.fn();
    render(<Stage natural={[800, 800]} onChoose={onChoose} />);
    drag([300, 100], [500, 300]);
    fireEvent.click(within(menu()!).getByRole("button", { name: "Save this" }));
    expect(onChoose).toHaveBeenCalledWith({ kind: "save", rect: { x: 0.1, y: 0.2, w: 0.4, h: 0.4 } });
  });

  it("a drag that starts in the black bar highlights nothing", () => {
    render(<Stage natural={[800, 800]} onChoose={vi.fn()} />);
    drag([100, 100], [400, 300]);
    expect(menu()).not.toBeInTheDocument();
  });

  it("has no keyboard shortcut for highlighting", () => {
    render(<Stage onChoose={vi.fn()} />);
    for (const key of ["h", "H", "l", "s", "Enter", " "]) fireEvent.keyDown(window, { key });
    expect(menu()).not.toBeInTheDocument();
  });

  describe("on a touch screen", () => {
    function coarse(matches: boolean) {
      window.matchMedia = vi.fn().mockReturnValue({
        matches,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as typeof window.matchMedia;
    }
    afterEach(() => {
      // @ts-expect-error jsdom has no matchMedia; the tests that need it set one.
      delete window.matchMedia;
    });
    const touch = { pointerType: "touch", button: 0, pointerId: 3 };

    it("shows a Highlight button, and a touch drag does nothing until it is on", () => {
      coarse(true);
      render(<Stage onChoose={vi.fn()} />);
      const toggle = screen.getByRole("button", { name: "Highlight" });
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      drag([100, 100], [300, 200], touch);
      expect(menu()).not.toBeInTheDocument();
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-pressed", "true");
      drag([100, 100], [300, 200], touch);
      expect(menu()).toBeInTheDocument();
    });

    it("leaves the page scrolling alone until the button is on", () => {
      coarse(true);
      render(<Stage onChoose={vi.fn()} />);
      expect(layer().style.touchAction).not.toBe("none");
      fireEvent.click(screen.getByRole("button", { name: "Highlight" }));
      expect(layer().style.touchAction).toBe("none");
    });

    it("turns off again", () => {
      coarse(true);
      render(<Stage onChoose={vi.fn()} />);
      const toggle = screen.getByRole("button", { name: "Highlight" });
      fireEvent.click(toggle);
      fireEvent.click(toggle);
      drag([100, 100], [300, 200], touch);
      expect(menu()).not.toBeInTheDocument();
    });

    it("has no Highlight button with a mouse", () => {
      coarse(false);
      render(<Stage onChoose={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "Highlight" })).not.toBeInTheDocument();
    });
  });
});

describe("HighlightLayer with the I'm lost bar", () => {
  const send = vi.fn<(op: QueueOp) => Promise<SendResult>>();
  beforeEach(() => {
    localStorage.clear();
    send.mockReset();
    send.mockResolvedValue("ok");
  });

  function Screen({ viewing = 3 }: { viewing?: number }) {
    const ref = useRef<HTMLImageElement>(null);
    const add = useRef<((h: never) => void) | null>(null);
    return (
      <div>
        <div style={{ position: "relative" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={ref} src="https://signed/3.webp" alt={`Slide ${viewing}`} />
          <HighlightLayer viewing={viewing} imageRef={ref} onChoose={(h) => add.current?.(h as never)} />
        </div>
        <LostButton
          lectureId={LECTURE}
          viewing={viewing}
          send={send}
          loadOwn={async () => []}
          onSpots={() => {}}
          onAddReady={(fn) => {
            add.current = fn as never;
          }}
        />
      </div>
    );
  }

  const choose = (name: string) => fireEvent.click(within(menu()!).getByRole("button", { name }));

  it("Save this queues an insert with kind save and the rect, on the slide being viewed", async () => {
    render(<Screen viewing={5} />);
    drag([300, 200], [100, 100]);
    choose("Save this");
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const op = send.mock.calls[0][0];
    expect(op).toMatchObject({
      op: "insert",
      tap: { kind: "save", tappedOnSlide: 5, rect: { x: 0.1, y: 0.2, w: 0.2, h: 0.2 } },
    });
    expect(screen.getByText("Saved slide 5, just for you")).toBeInTheDocument();
  });

  it("I'm lost from the menu queues kind lost with the rect, and the note added after goes on that tap", async () => {
    render(<Screen viewing={5} />);
    drag([100, 100], [300, 200]);
    choose("I'm lost");
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const insert = send.mock.calls[0][0];
    expect(insert).toMatchObject({
      op: "insert",
      tap: { kind: "lost", tappedOnSlide: 5, rect: { x: 0.1, y: 0.2, w: 0.2, h: 0.2 } },
    });
    expect(screen.getByText("Saved slide 5")).toBeInTheDocument();
    const field = screen.getByRole("textbox", { name: "Add a note" });
    fireEvent.change(field, { target: { value: " why " } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    if (insert.op !== "insert") throw new Error("expected an insert");
    expect(send.mock.calls[1][0]).toEqual({ op: "update", id: insert.tap.id, patch: { note: "why" } });
    expect(screen.getByText("Note saved:")).toBeInTheDocument();
  });

  it("Undo takes the highlight back", async () => {
    render(<Screen />);
    drag([100, 100], [300, 200]);
    choose("Save this");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.queryByText("Saved slide 3")).not.toBeInTheDocument());
    const ops = send.mock.calls.map((c) => c[0]);
    // Either the insert never left the queue, or it left and an undone update followed.
    if (ops.length > 0) expect(ops[ops.length - 1]).toMatchObject({ op: "update", patch: { undone: true } });
  });

  it("a plain click on the slide queues nothing", async () => {
    render(<Screen />);
    drag([100, 100], [100, 100]);
    await act(async () => {});
    expect(send).not.toHaveBeenCalled();
    expect(screen.queryByText(/Saved slide/)).not.toBeInTheDocument();
  });

  it("the plain I'm lost button still queues a plain tap with no kind and no rect", async () => {
    render(<Screen viewing={5} />);
    const button = screen.getAllByRole("button", { name: "I'm lost" })[0];
    fireEvent.click(button);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const op = send.mock.calls[0][0];
    expect(op.op === "insert" && op.tap).not.toHaveProperty("rect");
    expect(op.op === "insert" && op.tap).not.toHaveProperty("kind");
  });
});
