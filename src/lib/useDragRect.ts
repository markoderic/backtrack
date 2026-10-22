"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from "react";
import { containedBox, rectFromDrag, type Box, type Rect } from "./rect";

/** Style that puts a div exactly over the slide inside its layer (the whole layer until the slide's place is known). */
export function slideBoxStyle(box: Box | null): CSSProperties {
  return box
    ? { left: box.left, top: box.top, width: box.width, height: box.height }
    : { left: 0, top: 0, width: "100%", height: "100%" };
}

type Options = {
  /** The element that takes the pointer. It covers the slide image exactly (the image is object-contain inside it). */
  layerRef: RefObject<HTMLElement | null>;
  /** The slide image, to find where the slide is drawn inside the layer. */
  imageRef: RefObject<HTMLImageElement | null>;
  /** Whether a touch can start a drag. A mouse or pen always can (D9). */
  touch: boolean;
  /** Called with the box when a drag ends on one (a click gives none). */
  onRect: (rect: Rect) => void;
  /** Called when a press starts, before the drag. A caller closes what was open. */
  onStart?: () => void;
};

type Drag = { pointerId: number; start: { x: number; y: number }; layerLeft: number; layerTop: number; box: Box };

/**
 * Drag on a slide to draw a rectangle. Returns where the slide is inside the layer
 * (for placing things over it), the box being drawn right now, and the handlers
 * to put on the layer.
 */
export function useDragRect({ layerRef, imageRef, touch, onRect, onStart }: Options) {
  const [box, setBox] = useState<Box | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const drag = useRef<Drag | null>(null);
  const onRectRef = useRef(onRect);
  const onStartRef = useRef(onStart);
  useEffect(() => {
    onRectRef.current = onRect;
    onStartRef.current = onStart;
  });

  const measure = useCallback(() => {
    const layer = layerRef.current;
    if (!layer) return null;
    const r = layer.getBoundingClientRect();
    const img = imageRef.current;
    return {
      layerLeft: r.left,
      layerTop: r.top,
      box: containedBox(r.width, r.height, img?.naturalWidth ?? 0, img?.naturalHeight ?? 0),
    };
  }, [layerRef, imageRef]);

  // Keeps the slide's place current: the window resizes, the image loads, the layer changes size.
  useEffect(() => {
    const update = () => {
      const m = measure();
      if (!m) return;
      setBox((prev) =>
        prev && prev.left === m.box.left && prev.top === m.box.top && prev.width === m.box.width && prev.height === m.box.height
          ? prev
          : m.box,
      );
    };
    update();
    const img = imageRef.current;
    img?.addEventListener("load", update);
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (layerRef.current) observer?.observe(layerRef.current);
    return () => {
      img?.removeEventListener("load", update);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [measure, layerRef, imageRef]);

  const point = (d: Drag, e: PointerEvent) => ({ x: e.clientX - d.layerLeft - d.box.left, y: e.clientY - d.layerTop - d.box.top });

  function onPointerDown(e: PointerEvent) {
    onStartRef.current?.();
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.pointerType === "touch" && !touch) return;
    const m = measure();
    if (!m) return;
    const d: Drag = { pointerId: e.pointerId, start: { x: 0, y: 0 }, layerLeft: m.layerLeft, layerTop: m.layerTop, box: m.box };
    const start = point(d, e);
    // A press in the black bar beside the slide starts nothing.
    if (start.x < 0 || start.y < 0 || start.x > m.box.width || start.y > m.box.height) return;
    d.start = start;
    drag.current = d;
    setDraft(null);
    try {
      layerRef.current?.setPointerCapture?.(e.pointerId);
    } catch {
      // The pointer is already gone. The drag just ends at the next event.
    }
  }

  function onPointerMove(e: PointerEvent) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    setDraft(rectFromDrag(d.start, point(d, e), d.box));
  }

  function onPointerUp(e: PointerEvent) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setDraft(null);
    const rect = rectFromDrag(d.start, point(d, e), d.box);
    if (rect) onRectRef.current(rect);
  }

  function onPointerCancel(e: PointerEvent) {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current = null;
    setDraft(null);
  }

  /**
   * Ends a drag that is going on without a box (the caller stopped taking drags mid-way, so
   * the pointerup may never come here): no draft is left drawn, and the pointer is let go.
   */
  const cancel = useCallback(() => {
    const d = drag.current;
    drag.current = null;
    setDraft(null);
    if (!d) return;
    try {
      layerRef.current?.releasePointerCapture?.(d.pointerId);
    } catch {
      // Already released.
    }
  }, [layerRef]);

  return { box, draft, cancel, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } };
}
