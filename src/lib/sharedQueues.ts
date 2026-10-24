import { MarkQueue } from "./markQueue";
import { NotebookSaver, notebookKey } from "./notebookApi";
import type { WriteResult } from "./schemaCheck";
import { TapQueue } from "./tapQueue";

/**
 * One tap queue, one mark queue and one notebook saver per lecture, for the whole page (module
 * level), whichever screen asks: the live screen (also while Next keeps it alive, hidden) and My
 * spots use the same one. So a change made on one screen is never sent again, out of order, by the
 * other: per slide and per op, the order the student made them is the order they reach the
 * database. localStorage keeps them across reloads and closed tabs as before.
 */
const taps = new Map<string, TapQueue>();
const marks = new Map<string, MarkQueue>();
const notebooks = new Map<string, SharedNotebook>();

export function sharedTapQueue(lectureId: string): TapQueue {
  let q = taps.get(lectureId);
  if (!q) {
    q = new TapQueue(lectureId);
    taps.set(lectureId, q);
  }
  return q;
}

export function sharedMarkQueue(lectureId: string): MarkQueue {
  let q = marks.get(lectureId);
  if (!q) {
    q = new MarkQueue(lectureId);
    marks.set(lectureId, q);
  }
  return q;
}

/** A lecture's notebook saver, and whether its table is known to be missing (before 0020). */
type SharedNotebook = { saver: NotebookSaver; missing: boolean };

/**
 * The lecture's notebook saver. Each open of the notebook holds what it types until its own read of
 * the saved notes answers (useNotebook: hold, release). It sends with `save` (save_notebook_note, from the page that uses
 * it), and nothing more once the database said the table is not there.
 */
export function sharedNotebookSaver(lectureId: string, save: (slide: number, body: string) => Promise<WriteResult>): NotebookSaver {
  let entry = notebooks.get(lectureId);
  if (!entry) {
    const made: SharedNotebook = {
      missing: false,
      saver: new NotebookSaver({
        storageKey: notebookKey(lectureId),
        save: async () => "offline",
        // A bug, not the network: the text is kept and the lecture goes on.
        onError: (e) => console.error(e),
      }),
    };
    entry = made;
    notebooks.set(lectureId, made);
  }
  const shared = entry;
  const send = save;
  shared.saver.setSave(async (slide, body) => {
    // Before 0020 nothing is sent again: the text stays on the device.
    if (shared.missing) return "missing";
    const result = await send(slide, body);
    if (result === "missing") shared.missing = true;
    return result;
  });
  return shared.saver;
}

/** Whether the lecture's notebook table is known to be missing (before 0020). */
export function notebookMissing(lectureId: string): boolean {
  return notebooks.get(lectureId)?.missing ?? false;
}

export function markNotebookMissing(lectureId: string): void {
  const entry = notebooks.get(lectureId);
  if (entry) entry.missing = true;
}

/** For tests: forget every shared queue and saver (the next one reads localStorage again). */
export function forgetSharedQueues(): void {
  for (const n of notebooks.values()) n.saver.halt();
  taps.clear();
  marks.clear();
  notebooks.clear();
}
