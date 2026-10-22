import { describe, it, expect } from "vitest";
import { containedBox, isRect, rectFromDrag } from "./rect";

const BOX = { width: 1000, height: 500 };

describe("rectFromDrag", () => {
  it("gives fractions of the box for a drag toward the top left", () => {
    expect(rectFromDrag({ x: 300, y: 200 }, { x: 100, y: 100 }, BOX)).toEqual({ x: 0.1, y: 0.2, w: 0.2, h: 0.2 });
  });

  it("gives the same box for a drag in any direction", () => {
    const want = { x: 0.1, y: 0.2, w: 0.2, h: 0.2 };
    expect(rectFromDrag({ x: 100, y: 100 }, { x: 300, y: 200 }, BOX)).toEqual(want);
    expect(rectFromDrag({ x: 300, y: 100 }, { x: 100, y: 200 }, BOX)).toEqual(want);
    expect(rectFromDrag({ x: 100, y: 200 }, { x: 300, y: 100 }, BOX)).toEqual(want);
  });

  it("clamps a drag that ends outside the box", () => {
    expect(rectFromDrag({ x: 800, y: 250 }, { x: 1400, y: 900 }, BOX)).toEqual({ x: 0.8, y: 0.5, w: 0.2, h: 0.5 });
    expect(rectFromDrag({ x: 200, y: 100 }, { x: -50, y: -30 }, BOX)).toEqual({ x: 0, y: 0, w: 0.2, h: 0.2 });
  });

  it("returns null for a 5 by 5 px drag", () => {
    expect(rectFromDrag({ x: 100, y: 100 }, { x: 105, y: 105 }, BOX)).toBeNull();
    expect(rectFromDrag({ x: 100, y: 100 }, { x: 100, y: 100 }, BOX)).toBeNull();
  });

  it("returns null when the box has no size", () => {
    expect(rectFromDrag({ x: 0, y: 0 }, { x: 10, y: 10 }, { width: 0, height: 0 })).toBeNull();
  });

  it("is a highlight when only one direction is at least 2% (the other grows to 2%)", () => {
    expect(rectFromDrag({ x: 100, y: 100 }, { x: 600, y: 100 }, BOX)).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.02 });
  });

  it("keeps a grown side inside the slide", () => {
    const r = rectFromDrag({ x: 100, y: 500 }, { x: 600, y: 500 }, BOX);
    expect(r).toEqual({ x: 0.1, y: 0.98, w: 0.5, h: 0.02 });
  });

  it("never gives a box the database would refuse, even when float32 rounding adds up", () => {
    const f32 = Math.fround;
    for (let sx = 0; sx <= 1000; sx += 7) {
      for (let ex = 0; ex <= 1000; ex += 11) {
        const r = rectFromDrag({ x: sx, y: 10 }, { x: ex, y: 400 }, { width: 997, height: 331 });
        if (!r) continue;
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.w).toBeGreaterThan(0);
        expect(f32(f32(r.x) + f32(r.w))).toBeLessThanOrEqual(1);
        expect(f32(f32(r.y) + f32(r.h))).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("isRect", () => {
  it("accepts four fractions that fit the slide", () => {
    expect(isRect({ x: 0, y: 0, w: 1, h: 1 })).toBe(true);
    expect(isRect({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 })).toBe(true);
  });

  it("accepts a box that touches the edge by a float rounding hair, as the database returns them", () => {
    expect(isRect({ x: Math.fround(0.3333), y: 0, w: Math.fround(0.6667), h: 1 })).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isRect(null)).toBe(false);
    expect(isRect("x")).toBe(false);
    expect(isRect({ x: 0.1, y: 0.2, w: 0.3 })).toBe(false);
    expect(isRect({ x: "0.1", y: 0.2, w: 0.3, h: 0.4 })).toBe(false);
    expect(isRect({ x: -0.1, y: 0.2, w: 0.3, h: 0.4 })).toBe(false);
    expect(isRect({ x: 0.1, y: 0.2, w: 0, h: 0.4 })).toBe(false);
    expect(isRect({ x: 0.9, y: 0.2, w: 0.3, h: 0.4 })).toBe(false);
    expect(isRect({ x: 0.1, y: 0.2, w: 0.3, h: Number.NaN })).toBe(false);
  });
});

describe("containedBox", () => {
  it("centers a square image in a wide box", () => {
    expect(containedBox(1000, 500, 800, 800)).toEqual({ left: 250, top: 0, width: 500, height: 500 });
  });

  it("centers a wide image in a tall box", () => {
    expect(containedBox(400, 600, 1600, 900)).toEqual({ left: 0, top: 187.5, width: 400, height: 225 });
  });

  it("is the whole box when the image has the box's shape", () => {
    expect(containedBox(1000, 500, 2000, 1000)).toEqual({ left: 0, top: 0, width: 1000, height: 500 });
  });

  it("fills the box while the image size is not known", () => {
    expect(containedBox(1000, 500, 0, 0)).toEqual({ left: 0, top: 0, width: 1000, height: 500 });
  });
});
