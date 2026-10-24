import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyError, classifyThrown } from "./lostTapApi";
import { classifyWrite, isMissingSchema, type Loaded, type WriteResult } from "./schemaCheck";

/**
 * The student's private notebook: one note per slide of a lecture, in the notebook_notes table of
 * migration 0020. Only the student who wrote a note can read it; no teacher can, ever. Before 0020
 * has run, a read says { status: "missing" } and a save says "missing".
 */

/** The longest notebook note (notebook_notes.body's check). */
export const NOTEBOOK_MAX = 20000;

export type NotebookNote = { slide: number; body: string; updatedAt: string };

/** The student's notebook notes of one lecture, by slide. */
export async function loadNotebook(supabase: SupabaseClient, lectureId: string): Promise<Loaded<NotebookNote[]>> {
  try {
    // Row level security gives only the signed in student's own rows (no teacher policy at all).
    const { data, error, status } = await supabase
      .from("notebook_notes")
      .select("slide_number, body, updated_at")
      .eq("lecture_id", lectureId)
      .order("slide_number");
    if (error) {
      if (isMissingSchema(error)) return { status: "missing" };
      if (classifyError(error, status) === "offline") return { status: "offline" };
      throw new Error(error.message);
    }
    return {
      status: "ok",
      data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        slide: Number(r.slide_number),
        body: String(r.body ?? ""),
        updatedAt: String(r.updated_at ?? ""),
      })),
    };
  } catch (e) {
    classifyThrown(e); // throws unless the network is down
    return { status: "offline" };
  }
}

/**
 * Saves the note of one slide in one call (save_notebook_note): adds it or replaces its text; an
 * empty (or only spaces) text removes it. Any time, for a lecture the student joined. Text past
 * 20000 characters is cut, so a paste never fails the whole save.
 */
export async function saveNotebookNote(
  supabase: SupabaseClient,
  lectureId: string,
  slide: number,
  body: string,
): Promise<WriteResult> {
  try {
    return classifyWrite(
      await supabase.rpc("save_notebook_note", {
        p_lecture_id: lectureId,
        p_slide_number: slide,
        p_body: Array.from(body).slice(0, NOTEBOOK_MAX).join(""),
      }),
    );
  } catch (e) {
    return classifyThrown(e);
  }
}

/**
 * The student's notebook notes of every lecture they joined, as (lecture, slide) pairs: only which
 * slides have a note, for the counts on My lectures. Before 0020 it says { status: "missing" }.
 */
export async function loadNotebookSlides(supabase: SupabaseClient): Promise<Loaded<{ lectureId: string; slide: number }[]>> {
  try {
    // Row level security gives only the signed in student's own rows; a note with no text has no row.
    const { data, error, status } = await supabase.from("notebook_notes").select("lecture_id, slide_number");
    if (error) {
      if (isMissingSchema(error)) return { status: "missing" };
      if (classifyError(error, status) === "offline") return { status: "offline" };
      throw new Error(error.message);
    }
    return {
      status: "ok",
      data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({ lectureId: String(r.lecture_id), slide: Number(r.slide_number) })),
    };
  } catch (e) {
    classifyThrown(e); // throws unless the network is down
    return { status: "offline" };
  }
}

/** Where one slide's note is: waiting for the pause, being sent, saved, or why it is not. */
export type NoteState = "pending" | "saving" | "saved" | "offline" | "failed" | "missing";

/** localStorage key of the notebook text of a lecture that is not saved yet, by slide. */
export const notebookKey = (lectureId: string) => `backtrack:notebook:${lectureId}`;

/**
 * The text kept on the device under a key: { "7": "text" }. Anything unreadable is left out; null
 * when storage can not be read at all (blocked).
 */
function readStored(key: string): Map<number, string> | null {
  const out = new Map<number, string>();
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return out;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return out;
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const slide = Number(k);
      if (Number.isInteger(slide) && slide >= 1 && typeof v === "string") out.set(slide, v);
    }
  } catch {
    // A broken value: nothing kept.
  }
  return out;
}

/** Writes the map under the key; false when storage is blocked or full. */
function writeStored(key: string, map: ReadonlyMap<number, string>): boolean {
  try {
    if (map.size === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(Object.fromEntries(map)));
    return true;
  } catch {
    return false;
  }
}

type SaverOptions = {
  /** Saves one slide's text (saveNotebookNote with the client and lecture filled in). */
  save: (slide: number, body: string) => Promise<WriteResult>;
  /** How long typing must pause before a save. */
  delayMs?: number;
  /** Told each time a slide's state changes. */
  onState?: (slide: number, state: NoteState) => void;
  /** Told when save threw instead of answering (a bug, not the network). The text is kept. */
  onError?: (error: unknown) => void;
  /**
   * Keeps the text that is not saved yet on the device (localStorage, notebookKey), so it survives a
   * reload, a closed tab or the page being thrown away while hidden. A new saver with the same key
   * starts with what was left there and sends it with its first flush.
   */
  storageKey?: string;
};

/**
 * Saves notebook notes while the student types, without a save button: each change waits for a
 * pause (debounce), then the latest text of that slide is sent. flush() sends everything at once
 * (on blur, a slide change or the page being hidden). Text that did not save, for any reason
 * (offline, a login that needs a moment, a refusal, 0020 not there yet, or a bug), is never
 * dropped: it stays in pending() and goes again with the next change or flush. Only the newest
 * text of a slide is ever sent, one save per slide at a time. pending() also has the text of a save
 * that is still out, until the database says it is saved.
 *
 * With a storageKey, the device copy is shared with other pages of the same lecture (My spots, and
 * the live screen that Next keeps alive, hidden, meanwhile). When another page changed a slide's text
 * there since this saver last looked, that page's version wins: newer text is taken over, and text it
 * already saved is not sent again (it would undo an edit made there).
 */
export class NotebookSaver {
  private readonly save: SaverOptions["save"];
  private readonly delayMs: number;
  private readonly onState?: SaverOptions["onState"];
  private readonly onError?: SaverOptions["onError"];
  private readonly storageKey?: string;
  /** Text not sent yet, by slide. */
  private readonly waiting = new Map<number, string>();
  /** Text that is out right now, by slide (not saved until the database says so). */
  private readonly inFlight = new Map<number, string>();
  /** The text this saver last saw saved, by slide, so its copy on the device can go. */
  private readonly saved = new Map<number, string>();
  /** The slides this saver had text for: only these are ever changed in the device copy. */
  private readonly touched = new Set<number>();
  /** The device copy as this saver last read or wrote it; null when storage can not be used. */
  private seen: Map<number, string> | null = null;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly sending = new Map<number, Promise<void>>();

  constructor({ save, delayMs = 800, onState, onError, storageKey }: SaverOptions) {
    this.save = save;
    this.delayMs = delayMs;
    this.onState = onState;
    this.onError = onError;
    this.storageKey = storageKey;
    if (storageKey) {
      const stored = readStored(storageKey);
      this.seen = stored;
      for (const [slide, body] of stored ?? []) {
        this.waiting.set(slide, body);
        this.touched.add(slide);
      }
    }
  }

  /**
   * Takes the device copy's changes made by another page since this saver last looked: newer text
   * becomes this saver's waiting text; a slide whose text is gone from there (that page saved it)
   * is not sent again from here.
   */
  private sync(): void {
    if (!this.storageKey || this.seen === null) return;
    const stored = readStored(this.storageKey);
    if (stored === null) return;
    for (const slide of new Set([...stored.keys(), ...this.seen.keys()])) {
      const now = stored.get(slide);
      const before = this.seen.get(slide);
      if (now === before) continue;
      if (now === undefined) {
        if (this.waiting.get(slide) === before) this.waiting.delete(slide);
      } else {
        this.waiting.set(slide, now);
        this.touched.add(slide);
      }
    }
    this.seen = stored;
  }

  /** The student typed: this is the slide's whole text now. */
  set(slide: number, body: string): void {
    this.sync();
    this.waiting.set(slide, body);
    this.touched.add(slide);
    this.persist();
    this.onState?.(slide, "pending");
    clearTimeout(this.timers.get(slide));
    this.timers.set(
      slide,
      setTimeout(() => {
        this.timers.delete(slide);
        void this.send(slide);
      }, this.delayMs),
    );
  }

  /** Sends every slide's waiting text now, and resolves once all of them are done. */
  async flush(): Promise<void> {
    this.sync();
    for (const [slide, timer] of this.timers) {
      clearTimeout(timer);
      this.timers.delete(slide);
    }
    await Promise.all([...new Set([...this.waiting.keys(), ...this.sending.keys()])].map((slide) => this.send(slide)));
  }

  /**
   * The text that is not saved yet, by slide: what is out right now and what waits (the newer
   * waiting text wins), for the page to show and keep on the device.
   */
  pending(): ReadonlyMap<number, string> {
    this.sync();
    return new Map([...this.inFlight, ...this.waiting]);
  }

  /**
   * Writes the text that is not saved yet to the device now (the page calls it when it is hidden,
   * before it flushes). Only this saver's slides change there: a slide saved since leaves, a slide
   * another tab or page wrote newer text for stays as it is.
   */
  persist(): void {
    if (!this.storageKey) return;
    const stored = readStored(this.storageKey);
    if (stored === null) {
      this.seen = null;
      return;
    }
    const pending = this.pending();
    let changed = false;
    for (const slide of this.touched) {
      const text = pending.get(slide);
      if (text !== undefined) {
        if (stored.get(slide) !== text) {
          stored.set(slide, text);
          changed = true;
        }
      } else if (stored.has(slide) && stored.get(slide) === this.saved.get(slide)) {
        stored.delete(slide);
        changed = true;
      }
    }
    if (changed) this.seen = writeStored(this.storageKey, stored) ? stored : null;
    else if (this.seen !== null) this.seen = stored;
  }

  /** Stops the timers (the page is going). Waiting text stays in pending() and on the device. */
  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.persist();
  }

  private send(slide: number): Promise<void> {
    const busy = this.sending.get(slide);
    // One save of a slide at a time; the newest text goes once the one in flight is back.
    if (busy) return busy.then(() => (this.waiting.has(slide) ? this.send(slide) : undefined));
    const body = this.waiting.get(slide);
    if (body === undefined) return Promise.resolve();
    this.waiting.delete(slide);
    this.inFlight.set(slide, body);
    this.onState?.(slide, "saving");
    const run = this.save(slide, body)
      .catch((e: unknown) => {
        this.onError?.(e);
        return "rejected" as const;
      })
      .then((result) => {
        this.sending.delete(slide);
        this.inFlight.delete(slide);
        if (result === "ok") {
          this.saved.set(slide, body);
          this.persist();
          if (!this.waiting.has(slide)) this.onState?.(slide, "saved");
          return;
        }
        // Kept for the next try, unless newer text came in meanwhile.
        if (!this.waiting.has(slide)) this.waiting.set(slide, body);
        this.persist();
        this.onState?.(slide, result === "offline" || result === "throttled" ? "offline" : result === "missing" ? "missing" : "failed");
      });
    this.sending.set(slide, run);
    return run;
  }
}
