"use client";

import { useEffect, useRef } from "react";

type Props = {
  /** The slide the teacher is on. The strip never goes past it. */
  live: number;
  /** The slide the student is looking at. */
  viewing: number;
  /** Slides where this student has a row that is not undone. */
  spotSlides: Set<number>;
  onPick: (n: number) => void;
};

/**
 * A row of slide numbers from 1 to the live slide. The viewed slide is filled in
 * and the strip scrolls to it; the live slide has its own red dot; a slide the
 * student marked has a small dot below its number.
 */
export function SlideStrip({ live, viewing, spotSlides, onPick }: Props) {
  const nav = useRef<HTMLElement>(null);
  const viewed = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const strip = nav.current;
    const item = viewed.current;
    if (!strip || !item) return;
    strip.scrollLeft = item.offsetLeft - strip.clientWidth / 2 + item.offsetWidth / 2;
  }, [viewing, live]);

  const numbers = Array.from({ length: Math.max(live, 0) }, (_, i) => i + 1);
  return (
    <nav ref={nav} aria-label="Slides" className="overflow-x-auto">
      <ol className="flex w-max gap-2">
        {numbers.map((n) => {
          const isLive = n === live;
          const isViewing = n === viewing;
          const isSpot = spotSlides.has(n);
          const label = `Slide ${n}${isLive ? ", live" : ""}${isViewing ? ", viewing" : ""}${isSpot ? ", saved" : ""}`;
          return (
            <li key={n}>
              <button
                ref={isViewing ? viewed : undefined}
                type="button"
                aria-label={label}
                aria-current={isViewing ? "true" : undefined}
                data-live={isLive ? "" : undefined}
                onClick={() => onPick(n)}
                className={`relative flex h-10 min-w-10 items-center justify-center border px-2 ${
                  isViewing ? "border-white bg-white text-black" : "border-white/50"
                }`}
              >
                {n}
                {isLive && (
                  <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />
                )}
                {isSpot && (
                  <span
                    aria-hidden
                    data-spot=""
                    className="absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-yellow-400"
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
