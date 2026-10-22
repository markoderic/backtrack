/**
 * The projector's only keys: the ones a clicker sends to move the slide. No other key does
 * anything there (Marko, Oct 22: no key binds); Data, End class and Fullscreen are buttons.
 */
export type SlideKeyAction = "next" | "prev";

const NEXT = new Set(["ArrowRight", "PageDown", " "]);
const PREV = new Set(["ArrowLeft", "PageUp"]);

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  if (target.isContentEditable) return true;
  const attr = target.getAttribute("contenteditable");
  return attr !== null && attr !== "false";
}

/** What a key press means on the projector. null means ignore it. */
export function slideKeyAction(e: {
  key: string;
  repeat: boolean;
  target: EventTarget | null;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}): SlideKeyAction | null {
  if (e.repeat || isTyping(e.target)) return null;
  // Cmd+Arrow, Ctrl+Space and friends belong to the browser. Shift alone is fine.
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (NEXT.has(e.key)) return "next";
  if (PREV.has(e.key)) return "prev";
  return null;
}

/** Keeps a slide number between 1 and the number of slides. */
export function clampSlide(n: number, count: number): number {
  return Math.min(Math.max(n, 1), count);
}
