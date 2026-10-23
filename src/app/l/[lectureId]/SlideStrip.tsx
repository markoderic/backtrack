"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent } from "react";

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

/** A dot's name, said by a screen reader and shown in its tooltip: "Slide 9, you got lost here". */
export function dotLabel(n: number, isLive: boolean, isViewing: boolean, kind: SpotKind | undefined): string {
  const parts = [`Slide ${n}`];
  if (isLive) parts.push("live");
  if (isViewing) parts.push("you are here");
  if (kind === "lost") parts.push("you got lost here");
  else if (kind === "save") parts.push("you saved this");
  return parts.join(", ");
}

const reducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Focus that came from the keyboard (a click focuses the dot too, but the pointer already shows the tip). */
function focusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

/** Where the strip should scroll so the dot on screen and the live dot are both in view (or, if they can't be, the one on screen, centered). */
export function stripTarget(o: { scrollLeft: number; view: number; max: number; here: [number, number]; live: [number, number] }): number {
  const lo = Math.min(o.here[0], o.live[0]);
  const hi = Math.max(o.here[1], o.live[1]);
  let target: number;
  if (hi - lo <= o.view) {
    // Both fit: move only as far as needed.
    if (lo >= o.scrollLeft && hi <= o.scrollLeft + o.view) target = o.scrollLeft;
    else if (lo < o.scrollLeft) target = lo;
    else target = hi - o.view;
  } else {
    target = o.here[0] - (o.view - (o.here[1] - o.here[0])) / 2;
  }
  return Math.min(o.max, Math.max(0, target));
}

/**
 * The slide strip: one dot per slide from 1 to the slide the teacher is on (it only grows
 * as the teacher moves; there is no total). Every dot is a real button with a 44 px touch
 * target that shows its slide. A red dot is an I'm lost spot, an open dot a spot saved for
 * yourself (it drops in when it is new), a ring marks the slide being viewed, and a short
 * ink bar under the dot marks the live slide (the teacher's playhead). Hovering or focusing
 * a dot shows a small tooltip with its name ("Slide 9, you got lost here"). A long lecture
 * scrolls sideways, smoothly, keeping the dot on screen and the live dot in view.
 */
export function SlideStrip({ live, viewing, spots, onPick }: Props) {
  const count = Math.max(live, 0);
  const numbers = Array.from({ length: count }, (_, i) => i + 1);
  const listRef = useRef<HTMLOListElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const firstScroll = useRef(true);
  // The dot whose tooltip shows, and its center from the strip's left edge.
  const [tip, setTip] = useState<{ n: number; x: number } | null>(null);

  // Keeps the dot on screen and the live dot in view when either changes (it starts at the live end).
  useEffect(() => {
    const list = listRef.current;
    const here = list?.querySelector<HTMLElement>("[aria-current]");
    if (!list || !here) return;
    // The first look (the page opening) jumps; later changes scroll smoothly.
    const smooth = !firstScroll.current && !reducedMotion();
    firstScroll.current = false;
    const max = list.scrollWidth - list.clientWidth;
    if (max <= 0) return;
    const box = list.getBoundingClientRect();
    const span = (el: Element): [number, number] => {
      const r = el.getBoundingClientRect();
      return [list.scrollLeft + r.left - box.left, list.scrollLeft + r.right - box.left];
    };
    const liveDot = list.querySelector("[data-live]");
    const hereSpan = span(here);
    const target = stripTarget({
      scrollLeft: list.scrollLeft,
      view: list.clientWidth,
      max,
      here: hereSpan,
      live: liveDot ? span(liveDot) : hereSpan,
    });
    if (Math.abs(target - list.scrollLeft) < 1) return;
    if (typeof list.scrollTo === "function") list.scrollTo({ left: target, behavior: smooth ? "smooth" : "auto" });
    else list.scrollLeft = target;
  }, [viewing, count]);

  // The tooltip stays inside the window: centered on its dot where it can be.
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el) return;
    el.style.translate = "";
    const r = el.getBoundingClientRect();
    const room = document.documentElement.clientWidth || window.innerWidth;
    let shift = 0;
    if (r.width > 0 && r.left < 8) shift = 8 - r.left;
    else if (r.width > 0 && r.right > room - 8) shift = room - 8 - r.right;
    if (shift) el.style.translate = `calc(-50% + ${shift}px) 0`;
  }, [tip]);

  function showTip(n: number, button: HTMLElement) {
    const nav = navRef.current;
    if (!nav) return;
    const b = button.getBoundingClientRect();
    setTip({ n, x: b.left + b.width / 2 - nav.getBoundingClientRect().left });
  }
  const hideTip = (n: number) => setTip((t) => (t && t.n === n ? null : t));

  const tipLabel = tip && tip.n <= count ? dotLabel(tip.n, tip.n === live, tip.n === viewing, spots.get(tip.n)) : null;

  return (
    <nav ref={navRef} aria-label="Slides" data-strip="" className="relative min-w-0 flex-initial">
      <ol
        ref={listRef}
        onScroll={() => setTip(null)}
        // Esc puts the tooltip away (WCAG 1.4.13); the dot keeps its focus.
        onKeyDown={(e) => {
          if (e.key === "Escape") setTip(null);
        }}
        className="flex max-w-full overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {numbers.map((n) => {
          const isLive = n === live;
          const isViewing = n === viewing;
          const kind = spots.get(n);
          const label = dotLabel(n, isLive, isViewing, kind);
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
                onPointerEnter={(e: PointerEvent<HTMLButtonElement>) => {
                  if (e.pointerType !== "touch") showTip(n, e.currentTarget);
                }}
                onPointerLeave={() => hideTip(n)}
                onFocus={(e: FocusEvent<HTMLButtonElement>) => {
                  if (focusVisible(e.currentTarget)) showTip(n, e.currentTarget);
                }}
                onBlur={() => hideTip(n)}
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
      {tip && tipLabel && (
        // The dot's name over it (the button already has it as its name, so a screen reader hears it once).
        <span
          ref={tipRef}
          key={tip.n}
          aria-hidden
          data-strip-tip=""
          style={{ left: tip.x }}
          className="pointer-events-none absolute bottom-full z-20 mb-1 -translate-x-1/2 animate-pop-in rounded-md bg-ink px-2 py-1 type-caption whitespace-nowrap text-surface shadow-popover"
        >
          {tipLabel}
        </span>
      )}
    </nav>
  );
}
