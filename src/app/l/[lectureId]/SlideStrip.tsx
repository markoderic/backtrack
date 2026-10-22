"use client";

import type { CSSProperties } from "react";

export type SpotKind = "lost" | "save";

type Props = {
  /** The slide the teacher is on. The strip never goes past it. */
  live: number;
  /** The slide the student is looking at. */
  viewing: number;
  /** Slides where this student has a row that is not undone, and what kind. Lost wins over save. */
  spots: ReadonlyMap<number, SpotKind>;
  onPick: (n: number) => void;
};

/**
 * The slide strip from the design: a line that runs from slide 1 to the slide the
 * teacher is on and ends at the teacher's playhead (the ink bar). It only grows as
 * the teacher moves; there is no total. Each slide is a 40 px segment (28 on a
 * phone) that shrinks if the lecture runs past the width. A red dot is an I'm lost
 * spot, an open dot a spot saved for yourself (it drops in when it is new), and a
 * ring marks the slide being viewed when that is not the live one. Every segment
 * is a button that shows its slide.
 */
export function SlideStrip({ live, viewing, spots, onPick }: Props) {
  const count = Math.max(live, 0);
  const numbers = Array.from({ length: count }, (_, i) => i + 1);
  // 40 per slide plus the playhead's overhang; it never grows past that, and shrinks when there is less room.
  const style = { maxWidth: `calc(var(--seg) * ${count} + 2px)` } as CSSProperties;

  return (
    <nav
      aria-label="Slides"
      data-strip=""
      className="relative h-6 min-w-0 flex-1 [--seg:28px] sm:[--seg:40px]"
      style={style}
    >
      {/* The track line, from the left end to the playhead. */}
      <span aria-hidden className="absolute left-0 right-0.5 top-[11px] h-0.5 bg-strip" />
      <ol className="absolute inset-y-0 left-0 right-0.5 flex">
        {numbers.map((n) => {
          const isLive = n === live;
          const isViewing = n === viewing;
          const kind = spots.get(n);
          const label = `Slide ${n}${isLive ? ", live" : ""}${isViewing ? ", viewing" : ""}${
            kind === "lost" ? ", lost" : kind === "save" ? ", saved" : ""
          }`;
          return (
            <li key={n} className="relative h-full min-w-0 flex-1">
              <button
                type="button"
                aria-label={label}
                aria-current={isViewing ? "true" : undefined}
                data-live={isLive ? "" : undefined}
                onClick={() => onPick(n)}
                // On a touch screen the hit area reaches 10 px above and below the 24 px strip (44 tall), no change to the look.
                className="press absolute inset-0 cursor-pointer rounded-xs focus-ring focus-visible:outline-offset-0 pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-2.5 pointer-coarse:after:content-['']"
              >
                {isViewing && !isLive && (
                  <span
                    aria-hidden
                    data-here=""
                    className="absolute left-1/2 top-1/2 -ml-2 -mt-2 size-4 rounded-full border-[1.5px] border-ink bg-bg"
                  />
                )}
                {kind && (
                  <span
                    // A new key when the kind changes, so the dot drops in again.
                    key={kind}
                    aria-hidden
                    data-spot={kind}
                    className={`absolute left-1/2 top-1/2 -ml-1 -mt-1 size-2 animate-dot-drop rounded-full ${
                      kind === "lost" ? "bg-lost" : "border-[1.5px] border-ink bg-bg"
                    }`}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ol>
      {/* The teacher's playhead at the end of the line. */}
      <span
        aria-hidden
        data-playhead=""
        className="pointer-events-none absolute right-[0.5px] top-px h-[22px] w-[3px] rounded-full bg-ink"
      />
    </nav>
  );
}
