"use client";

import { useEffect, useRef } from "react";

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
 * The slide strip: one dot per slide from 1 to the slide the teacher is on (it only grows
 * as the teacher moves; there is no total). Every dot is a real button with a 44 px touch
 * target that shows its slide. A red dot is an I'm lost spot, an open dot a spot saved for
 * yourself (it drops in when it is new), a ring marks the slide being viewed, and a short
 * ink bar under the dot marks the live slide (the teacher's playhead). A long lecture
 * scrolls sideways, and the slide being viewed is kept in sight.
 */
export function SlideStrip({ live, viewing, spots, onPick }: Props) {
  const count = Math.max(live, 0);
  const numbers = Array.from({ length: count }, (_, i) => i + 1);
  const listRef = useRef<HTMLOListElement>(null);

  // Keeps the viewed dot in sight when it changes or the strip grows (it starts at the live end).
  useEffect(() => {
    const list = listRef.current;
    const here = list?.querySelector<HTMLElement>("[aria-current]");
    if (!list || !here) return;
    const max = list.scrollWidth - list.clientWidth;
    if (max <= 0) return;
    const box = list.getBoundingClientRect();
    const dot = here.getBoundingClientRect();
    // Centered in the strip where it can be.
    const target = list.scrollLeft + (dot.left - box.left) - (box.width - dot.width) / 2;
    list.scrollLeft = Math.min(max, Math.max(0, target));
  }, [viewing, count]);

  return (
    <nav aria-label="Slides" data-strip="" className="min-w-0 flex-initial">
      <ol
        ref={listRef}
        className="flex max-w-full overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {numbers.map((n) => {
          const isLive = n === live;
          const isViewing = n === viewing;
          const kind = spots.get(n);
          const label = `Slide ${n}${isLive ? ", live" : ""}${isViewing ? ", viewing" : ""}${
            kind === "lost" ? ", lost" : kind === "save" ? ", saved" : ""
          }`;
          return (
            <li key={n} className="relative size-11 shrink-0">
              {/* The track line through the dots, from the first to the live one. */}
              {count > 1 && (
                <span
                  aria-hidden
                  className={`absolute top-1/2 -mt-px h-0.5 bg-strip ${n === 1 ? "left-1/2" : "left-0"} ${
                    isLive ? "right-1/2" : "right-0"
                  }`}
                />
              )}
              <button
                type="button"
                aria-label={label}
                aria-current={isViewing ? "true" : undefined}
                data-live={isLive ? "" : undefined}
                onClick={() => onPick(n)}
                className="press absolute inset-0 flex cursor-pointer items-center justify-center rounded-md hover:bg-surface/70 focus-ring focus-visible:outline-offset-[-2px]"
              >
                {isViewing && (
                  <span
                    aria-hidden
                    data-here=""
                    className="absolute left-1/2 top-1/2 -ml-3 -mt-3 size-6 rounded-full border-[1.5px] border-ink bg-bg"
                  />
                )}
                {kind ? (
                  <span
                    // A new key when the kind changes, so the dot drops in again.
                    key={kind}
                    aria-hidden
                    data-spot={kind}
                    className={`relative size-2.5 animate-dot-drop rounded-full ${
                      kind === "lost" ? "bg-lost" : "border-[1.5px] border-ink bg-bg"
                    }`}
                  />
                ) : (
                  <span aria-hidden data-dot="" className="relative size-1.5 rounded-full bg-secondary" />
                )}
                {isLive && (
                  // The teacher's playhead: a short ink bar under the live dot.
                  <span
                    aria-hidden
                    data-playhead=""
                    className="absolute bottom-1 left-1/2 -ml-2 h-[3px] w-4 rounded-full bg-ink"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
