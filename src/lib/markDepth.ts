import type { Rect } from "./rect";

/**
 * How many boxes cover the most covered point of a slide: 1 when none overlap, 40 when forty
 * students drew over the same title. Edges that only touch do not overlap. The deepest point of a
 * set of boxes always sits at one box's left edge, so only those are tried: for each, the boxes
 * that cover that x, swept top to bottom.
 */
export function overlapDepth(rects: readonly Rect[]): number {
  let best = 0;
  for (const at of rects) {
    const x = at.x;
    const events: [number, number][] = [];
    for (const r of rects) {
      if (r.x <= x && x < r.x + r.w) {
        events.push([r.y, 1], [r.y + r.h, -1]);
      }
    }
    // An end before a start at the same y: boxes that only touch are not stacked.
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let depth = 0;
    for (const [, d] of events) {
      depth += d;
      if (depth > best) best = depth;
    }
  }
  return best;
}

/** A box's opacity when it is the only one: about the look of the student's own red mark. */
export const LONE_BOX_OPACITY = 0.85;
/** The faintest a box gets in a crowd: a single student's box is still there to see. */
export const MIN_BOX_OPACITY = 0.25;

/**
 * The opacity of each box on a slide whose boxes stack `depth` deep. The more boxes pile up, the
 * lower each one's opacity, so a stack darkens step by step instead of turning solid at once
 * (where most people pointed comes out darkest). How dark a stack can get is bounded by how the
 * boxes are drawn (HighlightBoxes in SlideFocus: the stack is never darker than one full mark),
 * so the text under even forty boxes stays as readable as under one student's mark.
 */
export function boxOpacity(depth: number): number {
  if (depth <= 1) return LONE_BOX_OPACITY;
  const a = 1 - (1 - LONE_BOX_OPACITY) ** (1 / depth);
  return Math.max(MIN_BOX_OPACITY, Math.round(a * 100) / 100);
}
