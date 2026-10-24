"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadNotebook,
  NotebookSaver,
  notebookKey,
  saveNotebookNote,
  type NotebookNote,
  type NoteState,
} from "./notebookApi";
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
  /** How long typing must pause before a save. */
  delayMs?: number;
};

/**
 * The student's private notebook of one lecture: one note per slide, typed straight on the page
 * and saved by itself (NotebookSaver: after a pause, and at once on blur, a slide change, or the
 * page being hidden). Text that is not saved yet is kept on the device first, so a closed tab, a
 * page thrown away while hidden or a lost connection never loses what was typed; it goes out with
 * the next save. Before migration 0020 the notebook stays on the device only.
 *
 * The notes are read when the page is shown (again: Next keeps the page alive while My spots is open,
 * where a note can change). What waits on the device always wins over what the read says.
 */
export function useNotebook(lectureId: string, { save, load, delayMs = 800 }: Options = {}) {
  const [mode, setMode] = useState<NotebookMode>("unknown");
  const [texts, setTexts] = useState<ReadonlyMap<number, string>>(new Map());
  const [states, setStates] = useState<ReadonlyMap<number, NoteState>>(new Map());
  const mounted = useRef(false);
  const missing = useRef(false);
  const saveRef = useRef(save);
  const loadRef = useRef(load);
  useEffect(() => {
    saveRef.current = save;
    loadRef.current = load;
  });
  // Saves that came back ok while a read was out: the read may not have them yet.
  const reads = useRef(0);
  const savedDuring = useRef(new Map<number, string>());

  const saverRef = useRef<NotebookSaver | null>(null);
  // Made on first use, in the browser, never while rendering: it reads localStorage.
  const saver = useCallback(
    () =>
      (saverRef.current ??= new NotebookSaver({
        delayMs,
        storageKey: notebookKey(lectureId),
        save: async (slide, body) => {
          // Before 0020 nothing is sent again: the text stays on the device.
          if (missing.current) return "missing";
          const result = await (saveRef.current ?? ((s, b) => saveNotebookNote(createBrowserSupabase(), lectureId, s, b)))(slide, body);
          if (result === "missing") missing.current = true;
          if (result === "ok" && reads.current > 0) savedDuring.current.set(slide, body);
          return result;
        },
        onState: (slide, state) => {
          if (!mounted.current) return;
          setStates((m) => (m.get(slide) === state ? m : new Map(m).set(slide, state)));
          if (state === "missing") setMode("device");
          else if (state === "saved") setMode("table");
        },
        // A bug, not the network: the text is kept and the lecture goes on.
        onError: (e) => console.error(e),
      })),
    [lectureId, delayMs],
  );

  const reload = useCallback(async () => {
    reads.current += 1;
    try {
      let res: Loaded<NotebookNote[]>;
      try {
        res = await (loadRef.current ?? (() => loadNotebook(createBrowserSupabase(), lectureId)))();
      } catch (e) {
        // Not the network: a bug. The page keeps the notes it shows.
        console.error(e);
        return;
      }
      if (!mounted.current) return;
      if (res.status === "missing") {
        missing.current = true;
        setMode("device");
        return;
      }
      if (res.status === "offline") return;
      const next = new Map<number, string>();
      for (const n of res.data) next.set(n.slide, n.body);
      for (const [slide, body] of savedDuring.current) next.set(slide, body);
      // Text not saved yet is newer than anything the database has.
      for (const [slide, body] of saver().pending()) next.set(slide, body);
      setTexts(next);
      setMode("table");
    } finally {
      reads.current -= 1;
      if (reads.current === 0) savedDuring.current.clear();
    }
  }, [lectureId, saver]);

  useEffect(() => {
    mounted.current = true;
    const s = saver();
    // What waited on the device from the last visit shows right after the first paint (storage is only
    // there in the browser), then goes out; then the notes are read.
    void Promise.resolve().then(() => {
      if (!mounted.current) return;
      const left = s.pending();
      if (left.size > 0) {
        setTexts((prev) => {
          const next = new Map(prev);
          for (const [slide, body] of left) next.set(slide, body);
          return next;
        });
      }
      void s.flush();
      void reload();
    });
    // The page is going away or into the background: keep the text on the device first, then send it.
    const away = () => {
      s.persist();
      void s.flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") away();
    };
    const onOnline = () => void s.flush();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", away);
    window.addEventListener("online", onOnline);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", away);
      window.removeEventListener("online", onOnline);
      // Hidden by Next (Activity) or gone: the same as the page going away.
      away();
    };
  }, [saver, reload]);

  /** The student typed on a slide: this is its whole text now. */
  const set = useCallback(
    (slide: number, body: string) => {
      setTexts((m) => new Map(m).set(slide, body));
      saver().set(slide, body);
    },
    [saver],
  );

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
