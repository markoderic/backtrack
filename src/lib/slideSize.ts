/**
 * How big the student made the slide on the live screen, remembered on this device
 * (localStorage, never sent anywhere). One value per layout (globals.css, "student live lecture"),
 * each the slide's size as a share of its full size:
 *
 * - wide (laptop): the full size is the largest slide that leaves room for the I'm lost panel and
 *   the strip under it and the notebook's default width beside it.
 * - narrow (phone, stacked): the full size is the slide as it always was.
 *
 * The panel, the strip and the note to the teacher keep one size at every slide size (Marko, hand
 * test 4); only the slide and the notebook change. null is the default: the full size.
 */
export type SlideSize = { wide: number | null; narrow: number | null };

export const SLIDE_SIZE_KEY = "backtrack:slide-size";

/** The smallest slide: 35% of its full size (still usable), up to its full size. */
export const SCALE_MIN = 0.35;
export const SCALE_MAX = 1;
/** Kept for the phone code paths that named them. */
export const NARROW_MIN = SCALE_MIN;
export const NARROW_MAX = SCALE_MAX;

const isScale = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= SCALE_MIN && v <= SCALE_MAX;

/**
 * Reads the remembered sizes. The laptop size is stored as `wideScale` (batch M); the old `wide` value
 * (the sidebar's share of the window, before batch M) means something else and is not read.
 */
export function readSlideSize(): SlideSize {
  try {
    const raw = window.localStorage.getItem(SLIDE_SIZE_KEY);
    if (!raw) return { wide: null, narrow: null };
    const v = JSON.parse(raw) as Record<string, unknown>;
    return {
      wide: isScale(v?.wideScale) ? v.wideScale : null,
      narrow: isScale(v?.narrow) ? v.narrow : null,
    };
  } catch {
    // Storage is blocked or the value is broken: the default size.
    return { wide: null, narrow: null };
  }
}

export function writeSlideSize(size: SlideSize): void {
  try {
    if (size.wide === null && size.narrow === null) window.localStorage.removeItem(SLIDE_SIZE_KEY);
    else window.localStorage.setItem(SLIDE_SIZE_KEY, JSON.stringify({ wideScale: size.wide, narrow: size.narrow }));
  } catch {
    // Storage is blocked or full: the size holds for this visit only.
  }
}

export const clampScale = (s: number) => Math.min(Math.max(s, SCALE_MIN), SCALE_MAX);
export const clampNarrow = clampScale;

/** The notebook goes under the slide (laptop) once there is at least this much room under the strip (px). */
export const NOTES_UNDER_MIN = 96;
