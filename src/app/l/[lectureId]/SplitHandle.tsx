"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import type { LectureView } from "@/lib/lectureView";
import {
  clampScale,
  NOTES_UNDER_MIN,
  readSlideSize,
  SCALE_MAX,
  SCALE_MIN,
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

/** Keyboard steps: 5% of the slide's full size; 2% of the window for the Classic sidebar. */
const STEP = 0.05;
const SIDE_STEP = 0.02;

/**
 * What sits under the slide on a laptop, at one size always (globals.css): 8 px, the I'm lost panel
 * (156: I'm lost 48, Save this and Mark 44, the Undo line 40, gaps 24), 8 px, the strip (44). With room
 * for it the panel is two rows (the Undo line beside Save this and Mark: 104) and this is 164; the
 * screen says which in --under.
 */
export const UNDER_SLIDE_PX = 216;
/** The gap between the rows of the lecture grid on a laptop. */
const ROW_GAP_PX = 16;

/**
 * The size as css variables on the lecture screen (globals.css reads them); null takes a variable off.
 * Each layout reads its own: --slide-scale-wide (Notes, laptop), --slide-scale (any layout on a phone),
 * --side-w (Classic, laptop: the sidebar's width in px for this window).
 */
function apply(el: HTMLElement | null, size: SlideSize, width: number) {
  if (!el) return;
  if (size.wide === null) el.style.removeProperty("--slide-scale-wide");
  else el.style.setProperty("--slide-scale-wide", String(size.wide));
  if (size.narrow === null) el.style.removeProperty("--slide-scale");
  else el.style.setProperty("--slide-scale", String(size.narrow));
  if (size.classic === null || size.classic === undefined) el.style.removeProperty("--side-w");
  else el.style.setProperty("--side-w", `${sidePx(size.classic, width)}px`);
}

/**
 * Where the notebook goes on a laptop (data-notes on the lecture screen, globals.css). "side": beside
 * the slide, the whole height (the slide is big and fills the height with the panel and the strip under
 * it). "under": once the slide is small enough to leave NOTES_UNDER_MIN px under the strip, the
 * notebook moves under the panel and the strip and takes the whole width there, so no empty band is
 * left under the slide (Marko, hand test 4). Measured from the slide's own height, which does not
 * depend on where the notebook is, so it never flips back and forth.
 */
export function placeNotes(el: HTMLElement | null, wide: boolean, view: LectureView = "notes") {
  if (!el) return;
  // Only the Notes layout on a laptop moves its notebook (Classic keeps it in the sidebar, Slides only has none).
  if (!wide || view !== "notes") {
    el.removeAttribute("data-notes");
    return;
  }
  const slide = el.querySelector<HTMLElement>("[data-lecture-slide]");
  const style = window.getComputedStyle(el);
  const inner = el.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
  const under = parseFloat(style.getPropertyValue("--under")) || UNDER_SLIDE_PX;
  const room = inner - (slide?.getBoundingClientRect().height ?? 0) - under - ROW_GAP_PX;
  const place = room >= NOTES_UNDER_MIN ? "under" : "side";
  if (el.getAttribute("data-notes") !== place) el.setAttribute("data-notes", place);
}

/**
 * The handle that sizes the slide: drag it (mouse, pen or finger) or use the arrow keys on it to make
 * the slide smaller (more room for notes) or bigger again. The size is remembered on this device, one
 * per layout; a double click puts the slide back to its full size.
 *
 * - Notes layout on a laptop: a vertical bar at the slide's right edge (it follows the slide's edge as
 *   it is dragged), from 35% of the slide's full size to all of it. Only the slide and the notebook
 *   change; I'm lost, Save this, Mark, the Undo line, the note to the teacher and the strip keep their
 *   size (Marko, hand test 4).
 * - Classic layout on a laptop (the K2 layout): a vertical bar between the slide and the sidebar;
 *   dragging it left widens the sidebar (the buttons and the notebook), so the slide gets smaller.
 * - Any layout on a phone: a horizontal bar above the notebook, the slide's height follows it.
 * Slides only has no handle (no notebook to make room for).
 *
 * A focusable separator (role separator, aria-valuenow is the slide's share in percent: of its full
 * size, or of the window beside the Classic sidebar). Its keys only work while it has the focus: Left
 * or Up makes the slide smaller, Right or Down bigger, Home the smallest, End the biggest.
 */
export function SplitHandle({ view = "notes" }: { view?: LectureView } = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const wide = useSyncExternalStore(subscribeWide, isWide, () => true);
  const width = useSyncExternalStore(subscribeWide, windowWidth, () => 1440);
  const [size, setSize] = useState<SlideSize>({ wide: null, narrow: null });
  const sizeRef = useRef(size);
  const wideRef = useRef(wide);
  const viewRef = useRef(view);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; scale: number; side: number; width: number; height: number } | null>(null);
  // Which size this handle changes now.
  const mode: "notes" | "classic" | "narrow" = !wide ? "narrow" : view === "classic" ? "classic" : "notes";

  const container = () => ref.current?.closest<HTMLElement>("[data-lecture]") ?? null;

  // `place` false while dragging: the notebook's place is measured once the drag ends (no layout per
  // pointer move, and the notebook does not jump under the pointer mid-drag).
  const set = useCallback((next: SlideSize, save: boolean, place = true) => {
    sizeRef.current = next;
    setSize(next);
    const el = ref.current?.closest<HTMLElement>("[data-lecture]") ?? null;
    apply(el, next, window.innerWidth);
    if (place) placeNotes(el, wideRef.current, viewRef.current);
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
  // Another layout, view or window size: the Classic sidebar keeps its share (within its limits) and the
  // notebook's place is measured again. Also whenever the slide changes size by itself (a slide of
  // another shape, the window's height).
  useEffect(() => {
    wideRef.current = wide;
    viewRef.current = view;
    const el = container();
    apply(el, sizeRef.current, window.innerWidth);
    placeNotes(el, wide, view);
    if (!el || typeof ResizeObserver === "undefined") return;
    // Not while the handle is dragged: the notebook moves once the drag ends.
    const observer = new ResizeObserver(() => {
      if (!drag.current) placeNotes(el, wideRef.current, viewRef.current);
    });
    observer.observe(el);
    const slide = el.querySelector("[data-lecture-slide]");
    if (slide) observer.observe(slide);
    return () => observer.disconnect();
  }, [wide, width, view]);
  // Gone (Slides only): the notebook's place goes with it.
  useEffect(() => {
    const el = ref.current?.closest<HTMLElement>("[data-lecture]") ?? null;
    return () => el?.removeAttribute("data-notes");
  }, []);

  const scale = (mode === "narrow" ? size.narrow : size.wide) ?? SCALE_MAX;
  const [lo, hi] = sideRange(width);
  const side = sidePx(size.classic, width);
  // The slide's share: of the window beside the Classic sidebar, or of its own full size.
  const now = mode === "classic" ? Math.round((100 * (width - side)) / width) : Math.round(scale * 100);
  const min = mode === "classic" ? Math.round((100 * (width - hi)) / width) : Math.round(SCALE_MIN * 100);
  const max = mode === "classic" ? Math.round((100 * (width - lo)) / width) : Math.round(SCALE_MAX * 100);

  /** Bigger (+1) or smaller (-1) by a step, or to an end. */
  function step(dir: 1 | -1, toEnd = false) {
    const cur = sizeRef.current;
    if (mode === "classic") {
      const w = window.innerWidth;
      const [a, b] = sideRange(w);
      const px = toEnd ? (dir > 0 ? a : b) : sidePx(cur.classic, w) - dir * SIDE_STEP * w;
      set({ ...cur, classic: Math.min(Math.max(px, a), b) / w }, true);
      return;
    }
    const was = (mode === "notes" ? cur.wide : cur.narrow) ?? SCALE_MAX;
    const s = toEnd ? (dir > 0 ? SCALE_MAX : SCALE_MIN) : clampScale(Math.round((was + dir * STEP) * 100) / 100);
    set(mode === "notes" ? { ...cur, wide: s } : { ...cur, narrow: s }, true);
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
    const box = container()?.querySelector<HTMLElement>("[data-lecture-slide]")?.getBoundingClientRect();
    const cur = sizeRef.current;
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      scale: (mode === "narrow" ? cur.narrow : cur.wide) ?? SCALE_MAX,
      side: sidePx(cur.classic, window.innerWidth),
      width: box?.width || 1,
      height: box?.height || 1,
    };
    setDragging(true);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const cur = sizeRef.current;
    if (mode === "classic") {
      const w = window.innerWidth;
      const [a, b] = sideRange(w);
      // The handle follows the pointer: the sidebar grows as it moves left.
      const px = Math.min(Math.max(d.side - (e.clientX - d.x), a), b);
      set({ ...cur, classic: px / w }, false, false);
    } else if (mode === "notes") {
      // The slide's right edge follows the pointer (its width and height scale together).
      set({ ...cur, wide: clampScale(d.scale * ((d.width + (e.clientX - d.x)) / d.width)) }, false, false);
    } else {
      // The slide's height follows the pointer.
      set({ ...cur, narrow: clampScale(d.scale * ((d.height + (e.clientY - d.y)) / d.height)) }, false, false);
    }
  }

  function endDrag() {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    writeSlideSize(sizeRef.current);
    placeNotes(container(), wideRef.current, viewRef.current);
  }

  function reset() {
    const cur = sizeRef.current;
    set(mode === "classic" ? { ...cur, classic: null } : mode === "notes" ? { ...cur, wide: null } : { ...cur, narrow: null }, true);
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
      // Capture lost (or never taken) and the pointer let go elsewhere: the drag ends here too.
      onLostPointerCapture={endDrag}
      onDoubleClick={reset}
      className="group relative flex touch-none items-center justify-center rounded-md outline-hidden select-none focus-visible:outline-2 focus-visible:outline-ink"
    >
      {/* The grip: a short bar, darker while hovered, focused or dragged. */}
      <span
        aria-hidden
        data-grip=""
        className="rounded-full bg-secondary transition-colors duration-(--dur-fast) ease-out group-hover:bg-ink group-focus-visible:bg-ink group-data-dragging:bg-ink"
      />
    </div>
  );
}
