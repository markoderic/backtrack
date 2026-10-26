import { describe, it, expect } from "vitest";
import { LONE_BOX_OPACITY, MIN_BOX_OPACITY, MIN_GLOW_OPACITY, boxOpacity, glowOpacity, overlapDepth } from "./markDepth";

const r = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("overlapDepth", () => {
  it("is 0 with no boxes and 1 with boxes that do not overlap (touching edges do not count)", () => {
    expect(overlapDepth([])).toBe(0);
    expect(overlapDepth([r(0.1, 0.1, 0.2, 0.2)])).toBe(1);
    expect(overlapDepth([r(0, 0, 0.2, 0.2), r(0.2, 0, 0.2, 0.2), r(0, 0.2, 0.2, 0.2)])).toBe(1);
  });

  it("counts how many boxes cover the most covered point", () => {
    // Three over the title, a fourth far away.
    expect(overlapDepth([r(0.1, 0.1, 0.5, 0.1), r(0.15, 0.12, 0.5, 0.1), r(0.2, 0.05, 0.3, 0.2), r(0.7, 0.7, 0.1, 0.1)])).toBe(3);
    // A chain: each overlaps the next, but never three at one point.
    expect(overlapDepth([r(0, 0, 0.3, 0.1), r(0.2, 0, 0.3, 0.1), r(0.4, 0, 0.3, 0.1)])).toBe(2);
    // Crossing bars: they meet in the middle.
    expect(overlapDepth([r(0.4, 0, 0.2, 1), r(0, 0.4, 1, 0.2)])).toBe(2);
    expect(overlapDepth(Array.from({ length: 40 }, (_, i) => r(0.1 + i * 0.001, 0.1, 0.5, 0.1)))).toBe(40);
  });
});

describe("boxOpacity", () => {
  it("a box alone is about as strong as the student's own mark; more boxes in a stack, fainter each", () => {
    expect(boxOpacity(1)).toBe(LONE_BOX_OPACITY);
    const steps = [1, 2, 3, 5, 8].map(boxOpacity);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeLessThan(steps[i - 1]);
    expect(boxOpacity(40)).toBe(MIN_BOX_OPACITY);
    expect(boxOpacity(300)).toBe(MIN_BOX_OPACITY);
  });

  it("a full stack is about as opaque as one lone box, so a pile of boxes reads like one mark at most, never solid at once", () => {
    for (const depth of [2, 3, 5]) {
      const stacked = 1 - (1 - boxOpacity(depth)) ** depth;
      expect(stacked).toBeGreaterThan(0.8);
      expect(stacked).toBeLessThanOrEqual(0.86);
    }
  });
});

describe("glowOpacity (a dark slide, batch M)", () => {
  it("a lone box glows at full strength; in a crowd each stays at least 0.7 so it shows on black; deeper is never stronger", () => {
    expect(glowOpacity(1)).toBe(1);
    expect(glowOpacity(40)).toBe(MIN_GLOW_OPACITY);
    expect(MIN_GLOW_OPACITY).toBeGreaterThanOrEqual(0.7);
    let last = 1;
    for (let d = 1; d <= 50; d++) {
      const g = glowOpacity(d);
      expect(g).toBeLessThanOrEqual(last);
      expect(g).toBeGreaterThanOrEqual(boxOpacity(d));
      last = g;
    }
  });
});
