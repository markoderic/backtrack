/**
 * How big the student made the slide on the live screen, remembered on this device
 * (localStorage, never sent anywhere). One value per layout (globals.css, "student live lecture"):
 *
 * - wide (laptop, slide beside the sidebar): the sidebar's share of the window width. The sidebar
 *   holds the notebook, so a wider sidebar is a smaller slide and more room for notes.
 * - narrow (phone, stacked): the slide's size as a share of its full size. The notebook below it
 *   takes the room the slide gives up.
 *
 * null is the default: the slide exactly as it is without any resizing.
 */
export type SlideSize = { wide: number | null; narrow: number | null };

export const SLIDE_SIZE_KEY = "backtrack:slide-size";

/** The sidebar's share of the width: 260 px at least (its default can not get smaller), 60% at most. */
export const SIDE_MAX = 0.6;
/** The sidebar never leaves the slide less than this (px). */
export const STAGE_MIN = 240;
/** The slide on a phone: from 35% of its full size up to its full size. */
export const NARROW_MIN = 0.35;
export const NARROW_MAX = 1;
/** The sidebar's own width before any resizing: clamp(260px, 20vw, 380px) (globals.css). */
export const SIDE_MIN_PX = 260;
export const defaultSidePx = (windowWidth: number) => Math.min(Math.max(SIDE_MIN_PX, windowWidth * 0.2), 380);

const isShare = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

export function readSlideSize(): SlideSize {
  try {
    const raw = window.localStorage.getItem(SLIDE_SIZE_KEY);
    if (!raw) return { wide: null, narrow: null };
    const v = JSON.parse(raw) as Record<string, unknown>;
    return {
      wide: isShare(v?.wide, 0, 1) ? v.wide : null,
      narrow: isShare(v?.narrow, NARROW_MIN, NARROW_MAX) ? v.narrow : null,
    };
  } catch {
    // Storage is blocked or the value is broken: the default size.
    return { wide: null, narrow: null };
  }
}

export function writeSlideSize(size: SlideSize): void {
  try {
    if (size.wide === null && size.narrow === null) window.localStorage.removeItem(SLIDE_SIZE_KEY);
    else window.localStorage.setItem(SLIDE_SIZE_KEY, JSON.stringify(size));
  } catch {
    // Storage is blocked or full: the size holds for this visit only.
  }
}

/** The sidebar width (px) a share gives in a window this wide, within its limits. */
export function sidePx(share: number | null, windowWidth: number): number {
  const lo = SIDE_MIN_PX;
  const hi = Math.max(lo, Math.min(windowWidth * SIDE_MAX, windowWidth - 32 - 24 - STAGE_MIN));
  const want = share === null ? defaultSidePx(windowWidth) : share * windowWidth;
  return Math.round(Math.min(Math.max(want, lo), hi));
}

/** The sidebar's limits (px) in a window this wide: [smallest, largest]. */
export function sideRange(windowWidth: number): [number, number] {
  return [SIDE_MIN_PX, Math.max(SIDE_MIN_PX, Math.min(windowWidth * SIDE_MAX, windowWidth - 32 - 24 - STAGE_MIN))];
}

export const clampNarrow = (s: number) => Math.min(Math.max(s, NARROW_MIN), NARROW_MAX);
