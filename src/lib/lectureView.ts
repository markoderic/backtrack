/**
 * The student's layout of the live lecture screen, chosen by the student and remembered on this
 * device (localStorage, never sent anywhere; Marko, Oct 27: "I want the student to be able to choose
 * their view"):
 *
 * - "notes" (the default): the slide with I'm lost, Save this, Mark and the strip right under it, and
 *   the notebook beside it (or under it once the slide is made small).
 * - "slides": no notebook and no size handle; the slide as big as the window allows, the buttons and
 *   the strip under it. The note to the teacher still shows on a lost slide.
 * - "classic": the layout before batch M: a big slide on the left with the strip under it, and a
 *   sidebar on the right with the buttons on top and the notebook under them.
 *
 * One store for the page: every StudentLecture (the live screen is kept alive while My spots shows)
 * reads the same value and hears a change made in another tab.
 */
export type LectureView = "notes" | "slides" | "classic";

export const LECTURE_VIEWS: readonly LectureView[] = ["notes", "slides", "classic"];
export const DEFAULT_VIEW: LectureView = "notes";
export const LECTURE_VIEW_KEY = "backtrack:view";

/** What the menu calls each layout. */
export const VIEW_LABEL: Record<LectureView, string> = {
  notes: "Notes",
  slides: "Slides only",
  classic: "Classic",
};

const isView = (v: unknown): v is LectureView => typeof v === "string" && (LECTURE_VIEWS as readonly string[]).includes(v);

/** The remembered layout, or the default when nothing (or something broken) is stored or storage is blocked. */
export function readLectureView(): LectureView {
  try {
    const v = window.localStorage.getItem(LECTURE_VIEW_KEY);
    return isView(v) ? v : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

const listeners = new Set<() => void>();
// The pick of this visit when storage could not keep it (blocked or full): it still switches, it is
// just not remembered.
let unsaved: LectureView | null = null;

/** Remembers the layout (if storage allows) and tells every screen showing it. */
export function writeLectureView(view: LectureView): void {
  try {
    if (view === DEFAULT_VIEW) window.localStorage.removeItem(LECTURE_VIEW_KEY);
    else window.localStorage.setItem(LECTURE_VIEW_KEY, view);
    unsaved = null;
  } catch {
    unsaved = view;
  }
  for (const l of listeners) l();
}

/** For useSyncExternalStore: this page's picks and another tab's. */
export function subscribeLectureView(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === LECTURE_VIEW_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The layout now: the pick storage could not keep, else what this device remembers. */
export function currentLectureView(): LectureView {
  return unsaved ?? readLectureView();
}

/** Only for tests: forget a pick storage could not keep. */
export function forgetLectureView(): void {
  unsaved = null;
}
