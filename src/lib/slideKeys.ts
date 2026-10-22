export type SlideKeyAction = "next" | "prev" | "data" | "close";

const NEXT = new Set(["ArrowRight", "PageDown", " ", ".", "n"]);
const PREV = new Set(["ArrowLeft", "PageUp", "b", "p"]);

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
  // Cmd+D, Cmd+P, Ctrl+N and friends belong to the browser. Shift alone is fine.
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (NEXT.has(e.key)) return "next";
  if (PREV.has(e.key)) return "prev";
  if (e.key === "d" || e.key === "D") return "data";
  if (e.key === "Escape") return "close";
  return null;
}

/** Keeps a slide number between 1 and the number of slides. */
export function clampSlide(n: number, count: number): number {
  return Math.min(Math.max(n, 1), count);
}
