import type { Rect } from "@/lib/rect";

/** A fraction as a css percentage, without float noise (0.3 * 100 is 30.000000000000004). */
const pct = (n: number) => `${Math.round(n * 1e6) / 1e4}%`;

type Props = {
  rects: Rect[];
  /** Classes for each box. The default is translucent, so boxes that overlap get darker. */
  boxClassName?: string;
};

/**
 * Draws highlights as boxes over the slide. Put it inside a positioned box that is
 * exactly the size of the slide image: the rects are fractions of that box. It
 * never takes a click, so the slide under it still does.
 */
export function HighlightBoxes({ rects, boxClassName = "border border-red-500 bg-red-500/25" }: Props) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {rects.map((r, i) => (
        <div
          key={i}
          data-highlight-box=""
          className={`absolute ${boxClassName}`}
          style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }}
        />
      ))}
    </div>
  );
}
