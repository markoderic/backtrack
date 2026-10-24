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

/** Where one slide's note is: waiting for the pause, being sent, saved, or why it is not. */
export type NoteState = "pending" | "saving" | "saved" | "offline" | "failed" | "missing";

type SaverOptions = {
  /** Saves one slide's text (saveNotebookNote with the client and lecture filled in). */
  save: (slide: number, body: string) => Promise<WriteResult>;
  /** How long typing must pause before a save. */
  delayMs?: number;
  /** Told each time a slide's state changes. */
  onState?: (slide: number, state: NoteState) => void;
  /** Told when save threw instead of answering (a bug, not the network). The text is kept. */
  onError?: (error: unknown) => void;
};

/**
 * Saves notebook notes while the student types, without a save button: each change waits for a
 * pause (debounce), then the latest text of that slide is sent. flush() sends everything at once
 * (on blur, a slide change or the page being hidden). Text that did not save, for any reason
 * (offline, a login that needs a moment, a refusal, 0020 not there yet, or a bug), is never
 * dropped: it stays in pending() and goes again with the next change or flush. Only the newest
 * text of a slide is ever sent, one save per slide at a time.
 */
export class NotebookSaver {
  private readonly save: SaverOptions["save"];
  private readonly delayMs: number;
  private readonly onState?: SaverOptions["onState"];
  private readonly onError?: SaverOptions["onError"];
  /** Text not saved yet, by slide. */
  private readonly waiting = new Map<number, string>();
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly sending = new Map<number, Promise<void>>();

  constructor({ save, delayMs = 800, onState, onError }: SaverOptions) {
    this.save = save;
    this.delayMs = delayMs;
    this.onState = onState;
    this.onError = onError;
  }

  /** The student typed: this is the slide's whole text now. */
  set(slide: number, body: string): void {
    this.waiting.set(slide, body);
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
    for (const [slide, timer] of this.timers) {
      clearTimeout(timer);
      this.timers.delete(slide);
    }
    await Promise.all([...new Set([...this.waiting.keys(), ...this.sending.keys()])].map((slide) => this.send(slide)));
  }

  /** The text that is not saved yet, by slide (for the page to keep on the device). */
  pending(): ReadonlyMap<number, string> {
    return new Map(this.waiting);
  }

  /** Stops the timers (the page is going). Waiting text stays in pending(). */
  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private send(slide: number): Promise<void> {
    const busy = this.sending.get(slide);
    // One save of a slide at a time; the newest text goes once the one in flight is back.
    if (busy) return busy.then(() => (this.waiting.has(slide) ? this.send(slide) : undefined));
    const body = this.waiting.get(slide);
    if (body === undefined) return Promise.resolve();
    this.waiting.delete(slide);
    this.onState?.(slide, "saving");
    const run = this.save(slide, body)
      .catch((e: unknown) => {
        this.onError?.(e);
        return "rejected" as const;
      })
      .then((result) => {
        this.sending.delete(slide);
        if (result === "ok") {
          if (!this.waiting.has(slide)) this.onState?.(slide, "saved");
          return;
        }
        // Kept for the next try, unless newer text came in meanwhile.
        if (!this.waiting.has(slide)) this.waiting.set(slide, body);
        this.onState?.(slide, result === "offline" || result === "throttled" ? "offline" : result === "missing" ? "missing" : "failed");
      });
    this.sending.set(slide, run);
    return run;
  }
}
