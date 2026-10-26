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

/** The faintest a glowing box gets (batch M): on a black slide a faint glow is lost in the dark. */
export const MIN_GLOW_OPACITY = 0.7;

/**
 * The opacity of each glowing box (a dark slide, drawn with screen) on a slide whose boxes stack `depth`
 * deep: the same steps as boxOpacity, from MIN_GLOW_OPACITY for a box in a crowd up to a full glow for a
 * box alone, so every box stays visible on black. A pile is never brighter than one full glow (the boxes
 * lighten each other inside their layer), so the text under it stays as readable as under one mark.
 */
export function glowOpacity(depth: number): number {
  const a = boxOpacity(depth);
  const t = (a - MIN_BOX_OPACITY) / (LONE_BOX_OPACITY - MIN_BOX_OPACITY);
  return Math.round((MIN_GLOW_OPACITY + (1 - MIN_GLOW_OPACITY) * t) * 100) / 100;
}
