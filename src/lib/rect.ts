/** A highlight: a rectangle stored as fractions of the slide, not selected text. */
export type Rect = { x: number; y: number; w: number; h: number };

/** A drag under this fraction of the slide, in both directions, is a click (D9). */
const MIN_DRAG = 0.02;

const f32 = Math.fround;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** True when the database check on lost_taps would accept the four hl_ values (they are float4 there). */
function fits(start: number, size: number): boolean {
  return start >= 0 && size > 0 && f32(f32(start) + f32(size)) <= 1;
}

/** True for four finite fractions that lie inside the slide. */
export function isRect(v: unknown): v is Rect {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (![r.x, r.y, r.w, r.h].every((n) => typeof n === "number" && Number.isFinite(n))) return false;
  const { x, y, w, h } = r as Rect;
  return x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1 && y + h <= 1;
}

/** One axis of a drag: where it starts and how long it is, both as fractions of the slide. */
function axis(a: number, b: number, length: number): { start: number; size: number } | null {
  const lo = clamp01(Math.min(a, b) / length);
  const hi = clamp01(Math.max(a, b) / length);
  let start = lo;
  let size = hi - lo;
  // A thin drag is widened to the smallest highlight, so the database always gets a size above 0.
  if (size < MIN_DRAG) {
    size = MIN_DRAG;
    start = Math.min(start, 1 - MIN_DRAG);
  }
  start = round4(start);
  size = round4(size);
  // Four decimals can still add up to a hair over 1 once the database stores them as float4.
  while (size > 0 && !fits(start, size)) size = round4(size - 0.0001);
  return size > 0 ? { start, size } : null;
}

/**
 * The box a drag draws, as fractions of the slide. Points are in pixels from the
 * slide's top left. Any drag direction works, and a point outside the slide is
 * moved to its edge. Returns null when the drag is under 2% of the slide in both
 * directions (a click). A side under 2% in only one direction grows to 2%.
 */
export function rectFromDrag(
  start: { x: number; y: number },
  end: { x: number; y: number },
  box: { width: number; height: number },
): Rect | null {
  if (!(box.width > 0) || !(box.height > 0)) return null;
  const dx = Math.abs(clamp01(start.x / box.width) - clamp01(end.x / box.width));
  const dy = Math.abs(clamp01(start.y / box.height) - clamp01(end.y / box.height));
  if (dx < MIN_DRAG && dy < MIN_DRAG) return null;
  const ax = axis(start.x, end.x, box.width);
  const ay = axis(start.y, end.y, box.height);
  if (!ax || !ay) return null;
  return { x: ax.start, y: ay.start, w: ax.size, h: ay.size };
}
