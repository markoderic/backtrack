"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import { clampScale, NOTES_UNDER_MIN, readSlideSize, SCALE_MAX, SCALE_MIN, writeSlideSize, type SlideSize } from "@/lib/slideSize";

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

/** Keyboard steps: 5% of the slide's full size. */
const STEP = 0.05;

/**
 * What sits under the slide on a laptop, at one size always (globals.css): 8 px, the I'm lost panel
 * (156: I'm lost 48, Save this and Mark 44, the Undo line 40, gaps 24), 8 px, the strip (44).
 */
export const UNDER_SLIDE_PX = 216;
/** The gap between the rows of the lecture grid on a laptop. */
const ROW_GAP_PX = 16;

/** The size as css variables on the lecture screen (globals.css reads them); null takes a variable off. */
function apply(el: HTMLElement | null, size: SlideSize) {
  if (!el) return;
  if (size.wide === null) el.style.removeProperty("--slide-scale-wide");
  else el.style.setProperty("--slide-scale-wide", String(size.wide));
  if (size.narrow === null) el.style.removeProperty("--slide-scale");
  else el.style.setProperty("--slide-scale", String(size.narrow));
}

/**
 * Where the notebook goes on a laptop (data-notes on the lecture screen, globals.css). "side": beside
 * the slide, the whole height (the slide is big and fills the height with the panel and the strip under
 * it). "under": once the slide is small enough to leave NOTES_UNDER_MIN px under the strip, the
 * notebook moves under the panel and the strip and takes the whole width there, so no empty band is
 * left under the slide (Marko, hand test 4). Measured from the slide's own height, which does not
 * depend on where the notebook is, so it never flips back and forth.
 */
export function placeNotes(el: HTMLElement | null, wide: boolean) {
  if (!el) return;
  if (!wide) {
    el.removeAttribute("data-notes");
    return;
  }
  const slide = el.querySelector<HTMLElement>("[data-lecture-slide]");
  const style = window.getComputedStyle(el);
  const inner = el.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
  const room = inner - (slide?.getBoundingClientRect().height ?? 0) - UNDER_SLIDE_PX - ROW_GAP_PX;
  const place = room >= NOTES_UNDER_MIN ? "under" : "side";
  if (el.getAttribute("data-notes") !== place) el.setAttribute("data-notes", place);
}

/**
 * The handle that sizes the slide: drag it (mouse, pen or finger) or use the arrow keys on it to make
 * the slide smaller (more room for notes) or bigger again, from 35% of its full size to all of it. Only
 * the slide and the notebook change; I'm lost, Save this, Mark, the Undo line, the note to the teacher
 * and the strip keep their size (Marko, hand test 4). On a laptop it is a vertical bar at the slide's
 * right edge (it follows the slide's edge as it is dragged); on a phone a horizontal bar above the
 * notebook. The size is remembered on this device, one per layout; a double click puts the slide back
 * to its full size.
 *
 * A focusable separator (role separator, aria-valuenow is the slide's share of its full size in percent).
 * Its keys only work while it has the focus: Left or Up makes the slide smaller, Right or Down bigger,
 * Home the smallest, End the biggest.
 */
export function SplitHandle() {
  const ref = useRef<HTMLDivElement>(null);
  const wide = useSyncExternalStore(subscribeWide, isWide, () => true);
  const width = useSyncExternalStore(subscribeWide, windowWidth, () => 1440);
  const [size, setSize] = useState<SlideSize>({ wide: null, narrow: null });
  const sizeRef = useRef(size);
  const wideRef = useRef(wide);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; scale: number; width: number; height: number } | null>(null);

  const container = () => ref.current?.closest<HTMLElement>("[data-lecture]") ?? null;

  // `place` false while dragging: the notebook's place is measured once the drag ends (no layout per
  // pointer move, and the notebook does not jump under the pointer mid-drag).
  const set = useCallback((next: SlideSize, save: boolean, place = true) => {
    sizeRef.current = next;
    setSize(next);
    const el = ref.current?.closest<HTMLElement>("[data-lecture]") ?? null;
    apply(el, next);
    if (place) placeNotes(el, wideRef.current);
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
  // Another layout or window size: the notebook's place is measured again. Also whenever the slide
  // changes size by itself (a slide of another shape, the window's height).
  useEffect(() => {
    wideRef.current = wide;
    const el = container();
    placeNotes(el, wide);
    if (!el || typeof ResizeObserver === "undefined") return;
    // Not while the handle is dragged: the notebook moves once the drag ends.
    const observer = new ResizeObserver(() => {
      if (!drag.current) placeNotes(el, wideRef.current);
    });
    observer.observe(el);
    const slide = el.querySelector("[data-lecture-slide]");
    if (slide) observer.observe(slide);
    return () => observer.disconnect();
  }, [wide, width]);

  const scale = (wide ? size.wide : size.narrow) ?? SCALE_MAX;
  const now = Math.round(scale * 100);

  /** Bigger (+1) or smaller (-1) by a step, or to an end. */
  function step(dir: 1 | -1, toEnd = false) {
    const cur = sizeRef.current;
    const was = (wide ? cur.wide : cur.narrow) ?? SCALE_MAX;
    const s = toEnd ? (dir > 0 ? SCALE_MAX : SCALE_MIN) : clampScale(Math.round((was + dir * STEP) * 100) / 100);
    set(wide ? { ...cur, wide: s } : { ...cur, narrow: s }, true);
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
      scale: (wide ? cur.wide : cur.narrow) ?? SCALE_MAX,
      width: box?.width || 1,
      height: box?.height || 1,
    };
    setDragging(true);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const cur = sizeRef.current;
    if (wide) {
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
    placeNotes(container(), wide);
  }

  return (
    <div
      ref={ref}
      role="separator"
      tabIndex={0}
      aria-label="Slide size"
      aria-orientation={wide ? "vertical" : "horizontal"}
      aria-valuenow={now}
      aria-valuemin={Math.round(SCALE_MIN * 100)}
      aria-valuemax={Math.round(SCALE_MAX * 100)}
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
      onDoubleClick={() => set(wide ? { ...sizeRef.current, wide: null } : { ...sizeRef.current, narrow: null }, true)}
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
