"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

const GAP = 4;
const EDGE = 8;

/** Where a popup sits: fixed, under (or above) its button, lined up on its right or left edge. */
export type PopupPlace = { top?: number; bottom?: number; right?: number; left?: number };

/**
 * The shared mechanics of a small popup opened by a button (the course card's ⋯ menu, the slide
 * access choices), like the lecture row menu (batch A): it is placed under the button with its
 * right (or left) edge lined up, above the button when there is no room below, and carried along
 * on scroll and resize. A press anywhere else, Back or Forward, or leaving the page closes it, and
 * so does Next hiding the page (a hidden page's effects are cleaned up).
 * `close(false)` is called for all of those: the keyboard is not pulled back to the button.
 */
export function usePopup({
  open,
  close,
  trigger,
  panel,
  align = "right",
}: {
  open: boolean;
  close: (refocus: boolean) => void;
  trigger: RefObject<HTMLElement | null>;
  panel: RefObject<HTMLElement | null>;
  align?: "right" | "left";
}): PopupPlace | null {
  const [place, setPlace] = useState<PopupPlace | null>(null);
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  function measure() {
    if (!trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const h = panel.current?.offsetHeight ?? 0;
    const side =
      align === "right"
        ? { right: Math.max(EDGE, window.innerWidth - r.right) }
        : { left: Math.max(EDGE, Math.min(r.left, window.innerWidth - (panel.current?.offsetWidth ?? 0) - EDGE)) };
    const roomBelow = window.innerHeight - r.bottom - GAP - EDGE;
    setPlace(
      h > roomBelow && r.top - GAP - EDGE > roomBelow
        ? { bottom: window.innerHeight - r.top + GAP, ...side }
        : { top: r.bottom + GAP, ...side },
    );
  }

  // Placed before the first paint: the popup has to be in the page to measure its height.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) measure();
    // Only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Hidden by Next (Back, then Forward again): it comes back closed.
  useEffect(() => () => closeRef.current(false), []);

  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || trigger.current?.contains(t)) return;
      closeRef.current(false);
    };
    const gone = () => closeRef.current(false);
    document.addEventListener("mousedown", outside);
    document.addEventListener("touchstart", outside);
    window.addEventListener("popstate", gone);
    window.addEventListener("pagehide", gone);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("touchstart", outside);
      window.removeEventListener("popstate", gone);
      window.removeEventListener("pagehide", gone);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
    // Only when it opens or closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return open ? place : null;
}

/** ↑ ↓ Home End move the keyboard through `items` (wrapping); true when the key was one of those. */
export function moveFocus(key: string, items: HTMLElement[]): boolean {
  const at = items.indexOf(document.activeElement as HTMLElement);
  const go = (i: number) => items[(i + items.length) % items.length]?.focus({ preventScroll: true });
  if (key === "ArrowDown") go(at + 1);
  else if (key === "ArrowUp") go(at < 0 ? items.length - 1 : at - 1);
  else if (key === "Home") go(0);
  else if (key === "End") go(items.length - 1);
  else return false;
  return true;
}
