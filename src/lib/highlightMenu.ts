import type { Rect } from "./rect";

/** The menu is 46 px tall (one row of two items, padding, border); a little extra keeps it clear of the edge. */
export const MENU_HEIGHT = 52;
const MENU_GAP = 8;

/**
 * Where the menu's top edge goes, in px from the top of the slide: under the box if
 * there is room, else above it, else inside the slide against the box's bottom edge.
 * It never leaves the slide, so both buttons are always on screen.
 */
export function menuTop(rect: Rect, slideHeight: number): number {
  const top = rect.y * slideHeight;
  const bottom = (rect.y + rect.h) * slideHeight;
  const lowest = Math.max(0, slideHeight - MENU_HEIGHT);
  if (bottom + MENU_GAP + MENU_HEIGHT <= slideHeight) return bottom + MENU_GAP;
  if (top - MENU_GAP - MENU_HEIGHT >= 0) return top - MENU_GAP - MENU_HEIGHT;
  return Math.min(lowest, Math.max(0, bottom - MENU_HEIGHT - MENU_GAP));
}
