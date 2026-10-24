"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadNotebook, saveNotebookNote, type NotebookHold, type NotebookNote, type NoteState } from "./notebookApi";
import { markNotebookMissing, sharedNotebookSaver } from "./sharedQueues";
import type { Loaded, WriteResult } from "./schemaCheck";
import { createBrowserSupabase } from "./supabase/browser";

/**
 * Where the notebook lives: "table" once notebook_notes answered (migration 0020), "device" when it
 * is not there (the text then stays on this device only), "unknown" until the first answer.
 */
export type NotebookMode = "unknown" | "table" | "device";

type Options = {
  /** For tests: saves one slide's text. Defaults to save_notebook_note. */
  save?: (slide: number, body: string) => Promise<WriteResult>;
  /** For tests: reads the student's notes of the lecture. Defaults to notebook_notes. */
  load?: () => Promise<Loaded<NotebookNote[]>>;
};

/** While an open has not read the saved notes, it reads again after these waits (then every 30 s). */
export const NOTEBOOK_RETRY_MS = [2000, 5000, 15000, 30000];

/**
 * The student's private notebook of one lecture: one note per slide, typed straight on the page
 * and saved by itself (NotebookSaver: after a pause, and at once on blur, a slide change, or the
 * page being hidden). Text that is not saved yet is kept on the device first, so a closed tab, a
 * page thrown away while hidden or a lost connection never loses what was typed; it goes out with
 * the next save. Before migration 0020 the notebook stays on the device only.
 *
 * Each open (a page shown; Next showing a kept page again is a new open) reads the saved notes, and
 * holds what is typed in it until that read answers: nothing typed over an empty looking field ever
 * replaces a saved note (it goes after it). While the read has not answered it is tried again (back
 * online, the tab shown again, the window focused, and on a timer), and the status says the text is
 * on this device. What waits on the device always wins over what a read says.
 */
export function useNotebook(lectureId: string, { save, load }: Options = {}) {
  const [mode, setMode] = useState<NotebookMode>("unknown");
  const [texts, setTexts] = useState<ReadonlyMap<number, string>>(new Map());
  // The texts as last shown, for set() (what the field showed when the typing started).
  const textsRef = useRef<ReadonlyMap<number, string>>(texts);
  useEffect(() => {
    textsRef.current = texts;
  }, [texts]);
  const [states, setStates] = useState<ReadonlyMap<number, NoteState>>(new Map());
  const mounted = useRef(false);
  const saveRef = useRef(save);
  const loadRef = useRef(load);
  useEffect(() => {
    saveRef.current = save;
    loadRef.current = load;
  });
  // Saves that came back ok while a read was out: the read may not have them yet.
  const reads = useRef(0);
  const savedDuring = useRef(new Map<number, string>());
  // This open's hold: what it types is kept, not sent, until its own read answers (null once it has).
  const hold = useRef<NotebookHold | null>(null);

  // One saver per lecture for the whole page (sharedQueues): the live screen and My spots use the same
  // one, so their saves of a slide never cross. Made on first use, in the browser (it reads localStorage).
  const saver = useCallback(
    () =>
      sharedNotebookSaver(lectureId, (slide, body) =>
        (saveRef.current ?? ((s: number, b: string) => saveNotebookNote(createBrowserSupabase(), lectureId, s, b)))(slide, body),
      ),
    [lectureId],
  );

  /** Reads the saved notes. Returns whether the read answered (ok or missing). */
  const readNotes = useCallback(async (): Promise<boolean> => {
    reads.current += 1;
    try {
      let res: Loaded<NotebookNote[]>;
      try {
        res = await (loadRef.current ?? (() => loadNotebook(createBrowserSupabase(), lectureId)))();
      } catch (e) {
        // Not the network: a bug. The page keeps the notes it shows (and tries again later).
        console.error(e);
        return false;
      }
      if (!mounted.current) return false;
      const s = saver();
      const token = hold.current;
      if (res.status === "missing") {
        // No notebook table: the notes stay on this device (nothing to merge with).
        markNotebookMissing(lectureId);
        if (token) s.release(token, null);
        hold.current = null;
        setMode("device");
        return true;
      }
      // Offline: what is typed stays on the device, held, until a read answers.
      if (res.status === "offline") return false;
      const base = new Map<number, string>();
      for (const n of res.data) base.set(n.slide, n.body);
      // What this open typed before its read goes after the saved text, never over it. Any read also lets
      // go of what an open that went before its read (or a closed tab) left held.
      if (token) s.release(token, base);
      else s.release(Symbol("read"), base);
      hold.current = null;
      const next = new Map(base);
      for (const [slide, body] of savedDuring.current) next.set(slide, body);
      // Text not saved yet is newer than anything the database has.
      for (const [slide, body] of s.pending()) next.set(slide, body);
      setTexts(next);
      setMode("table");
      void s.flush();
      return true;
    } finally {
      reads.current -= 1;
      if (reads.current === 0) savedDuring.current.clear();
    }
  }, [lectureId, saver]);

  useEffect(() => {
    mounted.current = true;
    const s = saver();
    // A new open: it holds what it types until its own read answers.
    const token = s.hold();
    hold.current = token;
    const stop = s.subscribe((slide, state, body) => {
      if (state === "saved" && body !== undefined && reads.current > 0) savedDuring.current.set(slide, body);
      if (!mounted.current) return;
      setStates((m) => (m.get(slide) === state ? m : new Map(m).set(slide, state)));
      if (state === "missing") setMode("device");
      else if (state === "saved") setMode("table");
    });
    // Reads until one answers: now, then back online, shown again, focused, and on a growing timer.
    let tries = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let reading = false;
    const read = async () => {
      if (reading || hold.current !== token || !mounted.current) return;
      reading = true;
      if (retry) clearTimeout(retry);
      retry = null;
      const answered = await readNotes().finally(() => {
        reading = false;
      });
      if (answered || !mounted.current || hold.current !== token) return;
      const wait = NOTEBOOK_RETRY_MS[Math.min(tries, NOTEBOOK_RETRY_MS.length - 1)];
      tries += 1;
      retry = setTimeout(() => void read(), wait);
    };
    // What waited on the device from the last visit shows right after the first paint (storage is only
    // there in the browser), then goes out; then the notes are read.
    void Promise.resolve().then(() => {
      if (!mounted.current) return;
      // Starts from the saver's states (a save that ended while this page was hidden).
      setStates(new Map(s.states()));
      const left = s.pending();
      if (left.size > 0) {
        setTexts((prev) => {
          const next = new Map(prev);
          for (const [slide, body] of left) next.set(slide, body);
          return next;
        });
      }
      void s.flush();
      void read();
    });
    // The page is going away or into the background: keep the text on the device first, then send it.
    const away = () => {
      s.persist();
      void s.flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") away();
      else void read();
    };
    const onOnline = () => {
      void s.flush();
      void read();
    };
    const onFocus = () => void read();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", away);
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      if (retry) clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", away);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
      // Gone before its read answered: its blind text stays held until a later read.
      if (hold.current === token) s.leave(token);
      hold.current = null;
      // Hidden by Next (Activity) or gone: the same as the page going away.
      away();
      stop();
    };
  }, [saver, readNotes]);

  /** The student typed on a slide: this is its whole text now. */
  const set = useCallback(
    (slide: number, body: string) => {
      // Blind: the field looked empty when the typing started (its text is laid after the saved note).
      const blind = (textsRef.current.get(slide) ?? "") === "";
      textsRef.current = new Map(textsRef.current).set(slide, body);
      setTexts((m) => new Map(m).set(slide, body));
      saver().set(slide, body, hold.current ?? undefined, blind);
    },
    [saver],
  );

  /** Reads the saved notes again. */
  const reload = useCallback(async () => {
    await readNotes();
  }, [readNotes]);

  /** Sends what waits now (on blur and on a slide change). */
  const flush = useCallback(() => saver().flush(), [saver]);

  /** The slides with a note that has words in it (a slide with a note is a spot). */
  const slides = useMemo(() => {
    const out = new Set<number>();
    for (const [slide, body] of texts) if (body.trim() !== "") out.add(slide);
    return out;
  }, [texts]);

  const textOf = useCallback((slide: number) => texts.get(slide) ?? "", [texts]);
  const stateOf = useCallback((slide: number): NoteState | null => states.get(slide) ?? null, [states]);

  return { mode, slides, textOf, stateOf, set, flush, reload };
}

export type Notebook = ReturnType<typeof useNotebook>;
