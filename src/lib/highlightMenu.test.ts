import { describe, it, expect } from "vitest";
import { menuTop, MENU_HEIGHT } from "./highlightMenu";

const SLIDE = 500;
const rect = (y: number, h: number) => ({ x: 0.1, y, w: 0.3, h });

describe("menuTop", () => {
  it("goes just under the box when there is room", () => {
    // The box ends at 150 px; 8 px gap.
    expect(menuTop(rect(0.1, 0.2), SLIDE)).toBeCloseTo(158);
  });

  it("goes above the box when there is no room below", () => {
    // The box runs from 400 to 480 px: no room under it, plenty above.
    expect(menuTop(rect(0.8, 0.16), SLIDE)).toBeCloseTo(400 - 8 - MENU_HEIGHT);
  });

  it("stays inside the slide against the box's bottom edge when there is no room above or below", () => {
    // A box covering nearly the whole slide.
    const top = menuTop(rect(0.02, 0.96), SLIDE);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top + MENU_HEIGHT).toBeLessThanOrEqual(SLIDE);
  });

  it("never leaves the slide, even when the slide is shorter than the menu", () => {
    expect(menuTop(rect(0.1, 0.5), 30)).toBe(0);
    expect(menuTop(rect(0.1, 0.5), 0)).toBe(0);
  });
});
