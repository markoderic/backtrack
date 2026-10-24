"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import {
  clampNarrow,
  NARROW_MAX,
  NARROW_MIN,
  readSlideSize,
  sidePx,
  sideRange,
  writeSlideSize,
  type SlideSize,
} from "@/lib/slideSize";

/** The wide layout (globals.css: a laptop or anything at least 700 px wide and as wide as tall). */
const WIDE_QUERY = "(min-width: 700px) and (min-aspect-ratio: 1/1)";

function subscribeWide(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const list = window.matchMedia(WIDE_QUERY);
  list.addEventListener?.("change", onChange);
  window.addEventListener("resize", onChange);
  return () => {
    list.removeEventListener?.("change", onChange);
    window.removeEventListener("resize", onChange);
  };
}
const isWide = () => typeof window.matchMedia === "function" && window.matchMedia(WIDE_QUERY).matches;
const windowWidth = () => window.innerWidth;

/** Keyboard steps: 2% of the window for the sidebar, 5% for the slide on a phone. */
const SIDE_STEP = 0.02;
const NARROW_STEP = 0.05;

/** The size as css variables on the lecture screen (globals.css reads them); null takes a variable off. */
function apply(el: HTMLElement | null, size: SlideSize, width: number) {
  if (!el) return;
  if (size.wide === null) el.style.removeProperty("--side-w");
  else el.style.setProperty("--side-w", `${sidePx(size.wide, width)}px`);
  if (size.narrow === null) el.style.removeProperty("--slide-scale");
  else el.style.setProperty("--slide-scale", String(size.narrow));
}

/**
 * The handle between the slide and the notebook: drag it (mouse, pen or finger) or use the arrow
 * keys on it to make the slide smaller (more room for notes) or bigger again. On a laptop it is a
 * vertical bar between the slide and the sidebar (the notebook is in the sidebar); on a phone a
 * horizontal bar above the notebook, under the slide. The size is remembered on this device, one per
 * layout; a double click puts the slide back to its own size. The default is the slide as it always was.
 *
 * A focusable separator (role separator, aria-valuenow is the slide's share in percent). Its keys only
 * work while it has the focus: Left or Up makes the slide smaller, Right or Down bigger, Home the
 * smallest, End the biggest.
 */
export function SplitHandle() {
  const ref = useRef<HTMLDivElement>(null);
  const wide = useSyncExternalStore(subscribeWide, isWide, () => true);
  const width = useSyncExternalStore(subscribeWide, windowWidth, () => 1440);
  const [size, setSize] = useState<SlideSize>({ wide: null, narrow: null });
  const sizeRef = useRef(size);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; side: number; scale: number; height: number } | null>(null);

  const container = () => ref.current?.closest<HTMLElement>("[data-lecture]") ?? null;

  const set = useCallback((next: SlideSize, save: boolean) => {
    sizeRef.current = next;
    setSize(next);
    apply(ref.current?.closest<HTMLElement>("[data-lecture]") ?? null, next, window.innerWidth);
    if (save) writeSlideSize(next);
  }, []);

  // The size this device remembers (read after the first paint: storage is only there in the browser).
  useEffect(() => {
    let on = true;
    void Promise.resolve().then(() => {
      if (on) set(readSlideSize(), false);
    });
    return () => {
      on = false;
    };
  }, [set]);
  // A wider or narrower window: the sidebar keeps its share, within its limits.
  useEffect(() => {
    apply(container(), sizeRef.current, width);
  }, [width]);

  const [lo, hi] = sideRange(width);
  const side = sidePx(size.wide, width);
  const scale = size.narrow ?? NARROW_MAX;
  // The slide's share: of the window beside the sidebar, or of its own full size on a phone.
  const now = wide ? Math.round((100 * (width - side)) / width) : Math.round(scale * 100);
  const min = wide ? Math.round((100 * (width - hi)) / width) : Math.round(NARROW_MIN * 100);
  const max = wide ? Math.round((100 * (width - lo)) / width) : Math.round(NARROW_MAX * 100);

  /** Bigger (+1) or smaller (-1) by a step, or to an end. */
  function step(dir: 1 | -1, toEnd = false) {
    const cur = sizeRef.current;
    if (wide) {
      const w = window.innerWidth;
      const [a, b] = sideRange(w);
      const px = toEnd ? (dir > 0 ? a : b) : sidePx(cur.wide, w) - dir * SIDE_STEP * w;
      set({ ...cur, wide: Math.min(Math.max(px, a), b) / w }, true);
    } else {
      const s = toEnd ? (dir > 0 ? NARROW_MAX : NARROW_MIN) : (cur.narrow ?? NARROW_MAX) + dir * NARROW_STEP;
      set({ ...cur, narrow: clampNarrow(Math.round(s * 100) / 100) }, true);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const smaller = e.key === "ArrowLeft" || e.key === "ArrowUp";
    const bigger = e.key === "ArrowRight" || e.key === "ArrowDown";
    if (smaller || bigger) step(bigger ? 1 : -1);
    else if (e.key === "Home") step(-1, true);
    else if (e.key === "End") step(1, true);
    else return;
    e.preventDefault();
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not every browser (or test) has pointer capture; the moves still come to the handle.
    }
    const slide = container()?.querySelector<HTMLElement>("[data-lecture-slide]");
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      side: sidePx(sizeRef.current.wide, window.innerWidth),
      scale: sizeRef.current.narrow ?? NARROW_MAX,
      height: slide?.getBoundingClientRect().height || 1,
    };
    setDragging(true);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const cur = sizeRef.current;
    if (wide) {
      const w = window.innerWidth;
      const [a, b] = sideRange(w);
      // The handle follows the pointer: the sidebar grows as it moves left.
      const px = Math.min(Math.max(d.side - (e.clientX - d.x), a), b);
      set({ ...cur, wide: px / w }, false);
    } else {
      // The slide's height follows the pointer (its width and height scale together).
      set({ ...cur, narrow: clampNarrow(d.scale * ((d.height + (e.clientY - d.y)) / d.height)) }, false);
    }
  }

  function endDrag() {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    writeSlideSize(sizeRef.current);
  }

  return (
    <div
      ref={ref}
      role="separator"
      tabIndex={0}
      aria-label="Slide size"
      aria-orientation={wide ? "vertical" : "horizontal"}
      aria-valuenow={now}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={`Slide ${now}%`}
      data-split-handle=""
      data-dragging={dragging ? "" : undefined}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => set(wide ? { ...sizeRef.current, wide: null } : { ...sizeRef.current, narrow: null }, true)}
      className="group relative flex touch-none items-center justify-center rounded-md outline-hidden select-none focus-visible:outline-2 focus-visible:outline-ink"
    >
      {/* The grip: a short bar, darker while hovered, focused or dragged. */}
      <span
        aria-hidden
        data-grip=""
        className="rounded-full bg-strip transition-colors duration-(--dur-fast) ease-out group-hover:bg-secondary group-focus-visible:bg-ink group-data-dragging:bg-ink"
      />
    </div>
  );
}
