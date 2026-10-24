import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SLIDE_SIZE_KEY, readSlideSize, sidePx, writeSlideSize } from "@/lib/slideSize";
import { SplitHandle } from "./SplitHandle";

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

const stored = () => JSON.parse(localStorage.getItem(SLIDE_SIZE_KEY) ?? "null") as { wide: number | null; narrow: number | null } | null;

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
    expect(stored()).toEqual({ wide: null, narrow: 0.75 });
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
    expect(stored()).toEqual({ wide: null, narrow: 1 });
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

describe("SplitHandle on a laptop (the notebook in the sidebar beside the slide)", () => {
  beforeEach(() => layout(true));

  it("is a vertical separator; dragging it left widens the sidebar (a smaller slide), within its limits", async () => {
    const { handle, lecture } = await setup();
    expect(handle()).toHaveAttribute("aria-orientation", "vertical");
    // The default sidebar at 1440: 20% = 288 px; the slide's share is 80%.
    expect(handle()).toHaveAttribute("aria-valuenow", "80");
    expect(lecture.style.getPropertyValue("--side-w")).toBe("");
    fireEvent.pointerDown(handle(), { pointerType: "mouse", button: 0, pointerId: 1, clientX: 1124, clientY: 450 });
    fireEvent.pointerMove(handle(), { pointerType: "mouse", pointerId: 1, clientX: 824, clientY: 450 });
    expect(lecture.style.getPropertyValue("--side-w")).toBe("588px");
    fireEvent.pointerUp(handle(), { pointerType: "mouse", pointerId: 1 });
    expect(stored()?.wide).toBeCloseTo(588 / 1440, 5);
    // At most 60% of the window.
    fireEvent.pointerDown(handle(), { pointerType: "mouse", button: 0, pointerId: 1, clientX: 824, clientY: 450 });
    fireEvent.pointerMove(handle(), { pointerType: "mouse", pointerId: 1, clientX: 0, clientY: 450 });
    expect(lecture.style.getPropertyValue("--side-w")).toBe("864px");
    // At least 260 px.
    fireEvent.pointerMove(handle(), { pointerType: "mouse", pointerId: 1, clientX: 1440, clientY: 450 });
    expect(lecture.style.getPropertyValue("--side-w")).toBe("260px");
    fireEvent.pointerUp(handle(), { pointerType: "mouse", pointerId: 1 });
  });

  it("Left makes the slide smaller and Right bigger; a right click does not drag", async () => {
    const { handle, lecture } = await setup();
    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    expect(lecture.style.getPropertyValue("--side-w")).toBe(`${Math.round(288 + 0.02 * 1440)}px`);
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(lecture.style.getPropertyValue("--side-w")).toBe("288px");
    // Never narrower than 260 px (the slide can not take the sidebar's room).
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(lecture.style.getPropertyValue("--side-w")).toBe("260px");
    fireEvent.pointerDown(handle(), { pointerType: "mouse", button: 2, pointerId: 1, clientX: 1124, clientY: 450 });
    fireEvent.pointerMove(handle(), { pointerType: "mouse", pointerId: 1, clientX: 800, clientY: 450 });
    expect(lecture.style.getPropertyValue("--side-w")).toBe("260px");
  });
});

describe("slideSize", () => {
  it("reads nothing broken, and works with storage blocked", () => {
    localStorage.setItem(SLIDE_SIZE_KEY, JSON.stringify({ wide: 3, narrow: 0.1 }));
    expect(readSlideSize()).toEqual({ wide: null, narrow: null });
    localStorage.setItem(SLIDE_SIZE_KEY, "{not json");
    expect(readSlideSize()).toEqual({ wide: null, narrow: null });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readSlideSize()).toEqual({ wide: null, narrow: null });
    expect(() => writeSlideSize({ wide: 0.3, narrow: null })).not.toThrow();
  });

  it("keeps at least 240 px for the slide beside a wide sidebar in a small window", () => {
    expect(sidePx(0.6, 700)).toBe(700 - 32 - 24 - 240);
    expect(sidePx(0.6, 1440)).toBe(864);
    expect(sidePx(null, 1440)).toBe(288);
    expect(sidePx(null, 2400)).toBe(380);
  });
});
