import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NOTES_UNDER_MIN, SLIDE_SIZE_KEY, readSlideSize, writeSlideSize } from "@/lib/slideSize";
import { SplitHandle, UNDER_SLIDE_PX } from "./SplitHandle";

/** The handle inside the lecture screen it sizes, with a slide 400 px tall. */
async function setup() {
  const view = render(
    <div data-lecture="">
      <div data-lecture-slide="" />
      <SplitHandle />
    </div>,
  );
  const slide = view.container.querySelector("[data-lecture-slide]") as HTMLElement;
  vi.spyOn(slide, "getBoundingClientRect").mockReturnValue({ height: 400, width: 711, top: 0, left: 0, right: 711, bottom: 400, x: 0, y: 0, toJSON: () => ({}) });
  const lecture = view.container.querySelector("[data-lecture]") as HTMLElement;
  // The remembered size is read right after the first paint.
  await act(async () => {});
  return { ...view, lecture, handle: () => screen.getByRole("separator", { name: "Slide size" }) };
}

function layout(wide: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: wide, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

const stored = () => JSON.parse(localStorage.getItem(SLIDE_SIZE_KEY) ?? "null") as { wideScale: number | null; narrow: number | null } | null;

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SplitHandle on a phone (stacked: the notebook under the slide)", () => {
  beforeEach(() => layout(false));

  it("is a horizontal separator at 100% (the slide as it always was), with nothing set on the screen", async () => {
    const { handle, lecture } = await setup();
    expect(handle()).toHaveAttribute("aria-orientation", "horizontal");
    expect(handle()).toHaveAttribute("aria-valuenow", "100");
    expect(handle()).toHaveAttribute("aria-valuemin", "35");
    expect(handle()).toHaveAttribute("aria-valuemax", "100");
    expect(lecture.style.getPropertyValue("--slide-scale")).toBe("");
    expect(localStorage.getItem(SLIDE_SIZE_KEY)).toBeNull();
    // The grip is clearly visible (secondary gray), and ink while hovered, focused or dragged.
    const grip = handle().querySelector("[data-grip]")!;
    expect(grip.className).toContain("bg-secondary");
    expect(grip.className).not.toContain("bg-strip");
    expect(grip.className).toContain("group-hover:bg-ink");
  });

  it("dragging it up makes the slide smaller (its height follows the pointer), and the size is remembered", async () => {
    const { handle, lecture } = await setup();
    fireEvent.pointerDown(handle(), { pointerType: "touch", pointerId: 1, clientX: 100, clientY: 500 });
    fireEvent.pointerMove(handle(), { pointerType: "touch", pointerId: 1, clientX: 100, clientY: 400 });
    // 400 px tall, 100 px up: 75%.
    expect(lecture.style.getPropertyValue("--slide-scale")).toBe("0.75");
    expect(handle()).toHaveAttribute("aria-valuenow", "75");
    expect(localStorage.getItem(SLIDE_SIZE_KEY)).toBeNull();
    fireEvent.pointerUp(handle(), { pointerType: "touch", pointerId: 1 });
    expect(stored()).toEqual({ wideScale: null, narrow: 0.75 });
    // Never smaller than 35%, never bigger than its own size.
    fireEvent.pointerDown(handle(), { pointerType: "touch", pointerId: 1, clientX: 100, clientY: 400 });
    fireEvent.pointerMove(handle(), { pointerType: "touch", pointerId: 1, clientX: 100, clientY: -2000 });
    expect(handle()).toHaveAttribute("aria-valuenow", "35");
    fireEvent.pointerMove(handle(), { pointerType: "touch", pointerId: 1, clientX: 100, clientY: 4000 });
    expect(handle()).toHaveAttribute("aria-valuenow", "100");
    fireEvent.pointerUp(handle(), { pointerType: "touch", pointerId: 1 });
  });

  it("the arrow keys make it smaller (Up, Left) and bigger (Down, Right); Home and End go to the ends", async () => {
    const { handle, lecture } = await setup();
    fireEvent.keyDown(handle(), { key: "ArrowUp" });
    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    expect(handle()).toHaveAttribute("aria-valuenow", "90");
    fireEvent.keyDown(handle(), { key: "ArrowDown" });
    expect(handle()).toHaveAttribute("aria-valuenow", "95");
    fireEvent.keyDown(handle(), { key: "Home" });
    expect(lecture.style.getPropertyValue("--slide-scale")).toBe("0.35");
    fireEvent.keyDown(handle(), { key: "End" });
    expect(handle()).toHaveAttribute("aria-valuenow", "100");
    expect(stored()).toEqual({ wideScale: null, narrow: 1 });
    // Other keys do nothing (no shortcuts).
    fireEvent.keyDown(handle(), { key: "l" });
    expect(handle()).toHaveAttribute("aria-valuenow", "100");
  });

  it("starts at the size this device remembers; a double click puts the slide back to its own size", async () => {
    localStorage.setItem(SLIDE_SIZE_KEY, JSON.stringify({ wide: null, narrow: 0.6 }));
    const { handle, lecture } = await setup();
    expect(handle()).toHaveAttribute("aria-valuenow", "60");
    expect(lecture.style.getPropertyValue("--slide-scale")).toBe("0.6");
    fireEvent.doubleClick(handle());
    expect(lecture.style.getPropertyValue("--slide-scale")).toBe("");
    expect(localStorage.getItem(SLIDE_SIZE_KEY)).toBeNull();
  });
});

describe("SplitHandle on a laptop (hand test 4: only the slide and the notebook change size)", () => {
  beforeEach(() => layout(true));

  it("is a vertical separator at the slide's edge, at 100%; dragging it left makes the slide smaller (its right edge follows the pointer), 35% at least", async () => {
    const { handle, lecture } = await setup();
    expect(handle()).toHaveAttribute("aria-orientation", "vertical");
    expect(handle()).toHaveAttribute("aria-valuenow", "100");
    expect(handle()).toHaveAttribute("aria-valuemin", "35");
    expect(handle()).toHaveAttribute("aria-valuemax", "100");
    expect(lecture.style.getPropertyValue("--slide-scale-wide")).toBe("");
    // The slide is 711 px wide: 200 px to the left is 511 / 711 of it.
    fireEvent.pointerDown(handle(), { pointerType: "mouse", button: 0, pointerId: 1, clientX: 740, clientY: 450 });
    fireEvent.pointerMove(handle(), { pointerType: "mouse", pointerId: 1, clientX: 540, clientY: 450 });
    expect(Number(lecture.style.getPropertyValue("--slide-scale-wide"))).toBeCloseTo(511 / 711, 5);
    expect(handle()).toHaveAttribute("aria-valuenow", String(Math.round((100 * 511) / 711)));
    fireEvent.pointerUp(handle(), { pointerType: "mouse", pointerId: 1 });
    expect(stored()?.wideScale).toBeCloseTo(511 / 711, 5);
    expect(stored()?.narrow).toBeNull();
    // Never under 35%, never over the full size.
    fireEvent.pointerDown(handle(), { pointerType: "mouse", button: 0, pointerId: 1, clientX: 540, clientY: 450 });
    fireEvent.pointerMove(handle(), { pointerType: "mouse", pointerId: 1, clientX: 0, clientY: 450 });
    expect(lecture.style.getPropertyValue("--slide-scale-wide")).toBe("0.35");
    fireEvent.pointerMove(handle(), { pointerType: "mouse", pointerId: 1, clientX: 2000, clientY: 450 });
    expect(lecture.style.getPropertyValue("--slide-scale-wide")).toBe("1");
    fireEvent.pointerUp(handle(), { pointerType: "mouse", pointerId: 1 });
    // The panel's or the sidebar's width is never set: nothing but the slide is sized.
    expect(lecture.style.getPropertyValue("--side-w")).toBe("");
  });

  it("a lost pointer capture ends the drag: later moves do not resize the slide (review N3)", async () => {
    const { handle, lecture } = await setup();
    fireEvent.pointerDown(handle(), { pointerType: "mouse", button: 0, pointerId: 1, clientX: 740, clientY: 450 });
    fireEvent.pointerMove(handle(), { pointerType: "mouse", pointerId: 1, clientX: 640, clientY: 450 });
    const during = lecture.style.getPropertyValue("--slide-scale-wide");
    expect(during).not.toBe("");
    fireEvent(handle(), new Event("lostpointercapture", { bubbles: true }));
    expect(stored()?.wideScale).toBeCloseTo(Number(during), 5);
    fireEvent.pointerMove(handle(), { pointerType: "mouse", pointerId: 1, clientX: 300, clientY: 450 });
    expect(lecture.style.getPropertyValue("--slide-scale-wide")).toBe(during);
  });

  it("Left makes the slide 5% smaller and Right bigger; Home and End go to the ends; a right click does not drag", async () => {
    const { handle, lecture } = await setup();
    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    expect(lecture.style.getPropertyValue("--slide-scale-wide")).toBe("0.95");
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(lecture.style.getPropertyValue("--slide-scale-wide")).toBe("1");
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(lecture.style.getPropertyValue("--slide-scale-wide")).toBe("1");
    fireEvent.keyDown(handle(), { key: "Home" });
    expect(handle()).toHaveAttribute("aria-valuenow", "35");
    fireEvent.pointerDown(handle(), { pointerType: "mouse", button: 2, pointerId: 1, clientX: 740, clientY: 450 });
    fireEvent.pointerMove(handle(), { pointerType: "mouse", pointerId: 1, clientX: 900, clientY: 450 });
    expect(handle()).toHaveAttribute("aria-valuenow", "35");
    // The phone's size is its own.
    expect(stored()).toEqual({ wideScale: 0.35, narrow: null });
    expect(lecture.style.getPropertyValue("--slide-scale")).toBe("");
  });

  it("an old remembered size (the sidebar's share, before batch M) is not read as a slide size", async () => {
    localStorage.setItem(SLIDE_SIZE_KEY, JSON.stringify({ wide: 0.4, narrow: null }));
    const { handle, lecture } = await setup();
    expect(handle()).toHaveAttribute("aria-valuenow", "100");
    expect(lecture.style.getPropertyValue("--slide-scale-wide")).toBe("");
  });

  describe("where the notebook goes", () => {
    /** The screen 868 px tall inside its 16 px padding, the slide `h` px tall. */
    function sizes(lecture: HTMLElement, slideHeight: () => number) {
      Object.defineProperty(lecture, "clientHeight", { value: 900, configurable: true });
      lecture.style.padding = "16px";
      const slide = lecture.querySelector("[data-lecture-slide]") as HTMLElement;
      vi.spyOn(slide, "getBoundingClientRect").mockImplementation(() => {
        const height = slideHeight();
        return { height, width: height * (16 / 9), top: 16, left: 16, right: 16 + height * (16 / 9), bottom: 16 + height, x: 16, y: 16, toJSON: () => ({}) };
      });
    }

    it("beside the slide while the slide fills the height; under the panel and the strip, the whole width, once it is small (no empty band)", async () => {
      const { handle, lecture } = await setup();
      let h = 868 - UNDER_SLIDE_PX - 16 - 40;
      sizes(lecture, () => h);
      fireEvent.keyDown(handle(), { key: "End" });
      expect(lecture).toHaveAttribute("data-notes", "side");
      // Smaller: NOTES_UNDER_MIN px are left under the strip.
      h = 868 - UNDER_SLIDE_PX - 16 - NOTES_UNDER_MIN;
      fireEvent.keyDown(handle(), { key: "ArrowLeft" });
      expect(lecture).toHaveAttribute("data-notes", "under");
      // Big again: beside it again.
      h = 868 - UNDER_SLIDE_PX;
      fireEvent.keyDown(handle(), { key: "End" });
      expect(lecture).toHaveAttribute("data-notes", "side");
    });

    it("while dragging the notebook stays where it is (no layout per move); it moves once the drag ends (review M6)", async () => {
      // The slide's own resize (ResizeObserver) during the drag does not move it either.
      const seen: (() => void)[] = [];
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(cb: () => void) {
            seen.push(cb);
          }
          observe() {}
          disconnect() {}
        },
      );
      const { handle, lecture } = await setup();
      let h = 868 - UNDER_SLIDE_PX;
      sizes(lecture, () => h);
      fireEvent.keyDown(handle(), { key: "End" });
      expect(lecture).toHaveAttribute("data-notes", "side");
      fireEvent.pointerDown(handle(), { pointerType: "mouse", button: 0, pointerId: 1, clientX: 740, clientY: 450 });
      h = 300;
      fireEvent.pointerMove(handle(), { pointerType: "mouse", pointerId: 1, clientX: 400, clientY: 450 });
      expect(seen.length).toBeGreaterThan(0);
      for (const cb of seen) cb();
      expect(lecture).toHaveAttribute("data-notes", "side");
      fireEvent.pointerUp(handle(), { pointerType: "mouse", pointerId: 1 });
      expect(lecture).toHaveAttribute("data-notes", "under");
      expect(NOTES_UNDER_MIN).toBe(48);
    });

    it("measured again when the window changes, and not on a phone", async () => {
      const { lecture } = await setup();
      sizes(lecture, () => 300);
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      Object.defineProperty(window, "innerWidth", { value: 1300, configurable: true });
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(lecture).toHaveAttribute("data-notes", "under");
      layout(false);
      Object.defineProperty(window, "innerWidth", { value: 600, configurable: true });
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(lecture).not.toHaveAttribute("data-notes");
    });
  });
});

describe("slideSize", () => {
  it("reads nothing broken, and works with storage blocked", () => {
    localStorage.setItem(SLIDE_SIZE_KEY, JSON.stringify({ wideScale: 3, narrow: 0.1 }));
    expect(readSlideSize()).toEqual({ wide: null, narrow: null });
    localStorage.setItem(SLIDE_SIZE_KEY, "{not json");
    expect(readSlideSize()).toEqual({ wide: null, narrow: null });
    localStorage.setItem(SLIDE_SIZE_KEY, JSON.stringify({ wideScale: 0.5, narrow: 0.7 }));
    expect(readSlideSize()).toEqual({ wide: 0.5, narrow: 0.7 });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readSlideSize()).toEqual({ wide: null, narrow: null });
    expect(() => writeSlideSize({ wide: 0.3, narrow: null })).not.toThrow();
  });
});
