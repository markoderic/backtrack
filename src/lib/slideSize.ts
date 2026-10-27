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
 *
 * - classic (the Classic layout on a laptop, batch N; the K2 layout): the sidebar's share of the window
 *   width, as before batch M. The sidebar holds the buttons and the notebook, so a wider sidebar is a
 *   smaller slide and more room for notes. Absent (or null) is the sidebar's own default width.
 */
export type SlideSize = { wide: number | null; narrow: number | null; classic?: number | null };

export const SLIDE_SIZE_KEY = "backtrack:slide-size";

/** The smallest slide: 35% of its full size (still usable), up to its full size. */
export const SCALE_MIN = 0.35;
export const SCALE_MAX = 1;
/** Kept for the phone code paths that named them. */
export const NARROW_MIN = SCALE_MIN;
export const NARROW_MAX = SCALE_MAX;

const isScale = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= SCALE_MIN && v <= SCALE_MAX;
const isShare = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1;

/**
 * Reads the remembered sizes. The laptop size is stored as `wideScale` (batch M); the old `wide` value
 * (the sidebar's share of the window, before batch M) means something else and is not read.
 */
export function readSlideSize(): SlideSize {
  try {
    const raw = window.localStorage.getItem(SLIDE_SIZE_KEY);
    if (!raw) return { wide: null, narrow: null };
    const v = JSON.parse(raw) as Record<string, unknown>;
    const size: SlideSize = {
      wide: isScale(v?.wideScale) ? v.wideScale : null,
      narrow: isScale(v?.narrow) ? v.narrow : null,
    };
    if (isShare(v?.classicSide)) size.classic = v.classicSide;
    return size;
  } catch {
    // Storage is blocked or the value is broken: the default size.
    return { wide: null, narrow: null };
  }
}

export function writeSlideSize(size: SlideSize): void {
  try {
    const classic = size.classic ?? null;
    if (size.wide === null && size.narrow === null && classic === null) window.localStorage.removeItem(SLIDE_SIZE_KEY);
    else
      window.localStorage.setItem(
        SLIDE_SIZE_KEY,
        JSON.stringify(classic === null ? { wideScale: size.wide, narrow: size.narrow } : { wideScale: size.wide, narrow: size.narrow, classicSide: classic }),
      );
  } catch {
    // Storage is blocked or full: the size holds for this visit only.
  }
}

export const clampScale = (s: number) => Math.min(Math.max(s, SCALE_MIN), SCALE_MAX);
export const clampNarrow = clampScale;

/**
 * The notebook goes under the slide (laptop, Notes layout) once there is at least this much room under
 * the strip (px): five ruled lines. The slide's default size already uses the height it can, so the few
 * px a default slide leaves are not a reason to move the notes (batch N; it was 48 when the panel was taller).
 */
export const NOTES_UNDER_MIN = 120;

/*
 * The Classic sidebar (batch N restores the K2 layout): its width, as a share of the window, from its
 * default clamp(260px, 20vw, 380px) up to 60% of the window, never leaving the slide less than 240 px.
 */
export const SIDE_MAX = 0.6;
export const STAGE_MIN = 240;
export const SIDE_MIN_PX = 260;
export const defaultSidePx = (windowWidth: number) => Math.min(Math.max(SIDE_MIN_PX, windowWidth * 0.2), 380);

/** The Classic sidebar width (px) a share gives in a window this wide, within its limits. */
export function sidePx(share: number | null | undefined, windowWidth: number): number {
  const [lo, hi] = sideRange(windowWidth);
  const want = share === null || share === undefined ? defaultSidePx(windowWidth) : share * windowWidth;
  return Math.round(Math.min(Math.max(want, lo), hi));
}

/** The Classic sidebar's limits (px) in a window this wide: [smallest, largest]. */
export function sideRange(windowWidth: number): [number, number] {
  return [SIDE_MIN_PX, Math.max(SIDE_MIN_PX, Math.min(windowWidth * SIDE_MAX, windowWidth - 32 - 24 - STAGE_MIN))];
}
