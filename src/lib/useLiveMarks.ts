"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyMarkOp, type LiveMark, type MarkOp, type MarkSendResult } from "./markQueue";
import { loadMyMarks, makeMarkSend, MARKS_PER_SLIDE, type MarkKind } from "./marksApi";
import { newId } from "./newId";
import type { Rect } from "./rect";
import type { Loaded } from "./schemaCheck";
import { sharedMarkQueue } from "./sharedQueues";
import { createBrowserSupabase } from "./supabase/browser";

/**
 * Where marks live: "table" once slide_marks answered (migration 0020), "legacy" when it is not
 * there (the page then keeps the one highlight on the tap), "unknown" until the first answer.
 */
export type MarksMode = "unknown" | "table" | "legacy";

export const TOO_MANY_MARKS = "Too many marks on this slide.";
export const TOO_MANY_MARKS_LECTURE = "Too many marks in this lecture.";
export const MARK_FAILED = "That mark didn't save.";
/** The window's focus reads the marks again at most this often. */
const FOCUS_READ_MS = 2000;

type Options = {
  /** Goes up each time the live connection comes back: send what waits and read the marks again. */
  reconnects?: number;
  /** For tests: sends one op. Defaults to slide_marks through supabase-js. */
  send?: (op: MarkOp) => Promise<MarkSendResult>;
  /** For tests: reads the student's own marks. Defaults to my_slide_marks. */
  load?: () => Promise<Loaded<LiveMark[]>>;
};

function defaultLoad(lectureId: string) {
  return async (): Promise<Loaded<LiveMark[]>> => {
    const res = await loadMyMarks(createBrowserSupabase(), lectureId);
    if (res.status !== "ok") return res;
    return {
      status: "ok",
      data: res.data.map((m) => {
        const mark: LiveMark = { id: m.id, slide: m.slide, rect: m.rect, kind: m.kind };
        if (m.note) mark.note = m.note;
        return mark;
      }),
    };
  };
}

/**
 * The student's own marks on the live screen, from slide_marks: several per slide, each with a
 * private note. A change shows at once and goes through a queue kept in localStorage, so it
 * survives going offline or a reload. The marks are read again whenever the screen could be out of
 * date: when Next shows the page again (Activity, e.g. back from My spots: its effects run again),
 * when the tab or the window is shown again, when the connection comes back and when the browser is
 * back online. What is still waiting in the queue is laid over what the database says.
 */
export function useLiveMarks(lectureId: string, { reconnects = 0, send, load }: Options = {}) {
  const [mode, setMode] = useState<MarksMode>("unknown");
  const [shown, setShown] = useState<ReadonlyMap<string, LiveMark>>(new Map());
  const [problem, setProblem] = useState<{ n: number; text: string } | null>(null);

  // One queue per lecture for the whole page (sharedQueues): the live screen (also while hidden) and My
  // spots use the same one, so no op is sent twice or out of order. Made on first use, in the browser.
  const queue = useCallback(() => sharedMarkQueue(lectureId), [lectureId]);
  // What the database holds as far as this screen knows: the last read, plus every op sent since.
  const base = useRef(new Map<string, LiveMark>());
  // The ops sent while a read was out, so the read's answer can be brought up to date.
  const sentLog = useRef<MarkOp[]>([]);
  const reads = useRef(0);
  const mounted = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendRef = useRef(send);
  const loadRef = useRef(load);
  useEffect(() => {
    sendRef.current = send;
    loadRef.current = load;
  });
  const sender = useMemo(() => {
    let made: ((op: MarkOp) => Promise<MarkSendResult>) | null = null;
    return async (op: MarkOp) => {
      // The client is made when a mark is sent, not while rendering.
      const send = sendRef.current ?? (made ??= makeMarkSend(createBrowserSupabase(), lectureId));
      const result = await send(op);
      // Into what the database holds the moment it says ok: the queue drops the op at once, so a
      // redraw before the whole run ends must still show it (a mark, its note, a delete).
      if (result === "ok") {
        applyMarkOp(base.current, op);
        if (reads.current > 0) sentLog.current.push(op);
      }
      return result;
    };
  }, [lectureId]);

  const refresh = useCallback(() => {
    const next = new Map(base.current);
    for (const op of queue().pending()) applyMarkOp(next, op);
    setShown(next);
  }, [queue]);

  const say = useCallback((text: string) => setProblem((p) => ({ n: (p?.n ?? 0) + 1, text })), []);

  const flushRef = useRef<() => Promise<void>>(async () => {});
  const flush = useCallback(async () => {
    let result;
    try {
      result = await queue().flush(sender);
    } catch (e) {
      // Not the network (that is "offline"): a bug. The marks wait in the queue; the lecture goes on.
      console.error(e);
      return;
    }
    const { refused, retryIn } = result;
    if (refused.some((r) => r.result === "missing")) setMode("legacy");
    // A kind op refused is not the student's doing (the next reconcile sends it again); the rest is said.
    const said = refused.filter((r) => r.op.op !== "kind");
    if (said.some((r) => r.result === "slide_full")) say(TOO_MANY_MARKS);
    else if (said.some((r) => r.result === "lecture_full")) say(TOO_MANY_MARKS_LECTURE);
    else if (said.length > 0) say(MARK_FAILED);
    if (retryIn !== undefined && mounted.current) {
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        void flushRef.current();
      }, retryIn);
    }
    if (mounted.current) refresh();
  }, [queue, sender, refresh, say]);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const reload = useCallback(async () => {
    reads.current += 1;
    const from = sentLog.current.length;
    try {
      let res: Loaded<LiveMark[]>;
      try {
        res = await (loadRef.current ?? defaultLoad(lectureId))();
      } catch (e) {
        // Not the network: a bug. The screen keeps the marks it has; the lecture goes on.
        console.error(e);
        return;
      }
      if (!mounted.current) return;
      if (res.status === "missing") {
        setMode("legacy");
        return;
      }
      if (res.status === "offline") return;
      const next = new Map(res.data.map((m) => [m.id, m] as const));
      // Sent after the read went out: the read may not have them yet.
      for (const op of sentLog.current.slice(from)) applyMarkOp(next, op);
      base.current = next;
      setMode("table");
      refresh();
    } finally {
      reads.current -= 1;
      if (reads.current === 0) sentLog.current = [];
    }
  }, [lectureId, refresh]);

  useEffect(() => {
    mounted.current = true;
    // What waited from the last visit shows at once (storage is only there in the browser), then
    // it is sent and the marks are read.
    refresh();
    void Promise.resolve().then(() => {
      if (!mounted.current) return;
      void flush();
      void reload();
    });
    const again = () => {
      void flush();
      void reload();
    };
    // Back to the tab fires both visibilitychange and focus: one read for both (at most every 2 s).
    // My spots in a second window beside this one: coming back to this window reads again too.
    let lastBack = 0;
    const onBack = () => {
      if (Date.now() - lastBack < FOCUS_READ_MS) return;
      lastBack = Date.now();
      again();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onBack();
    };
    const onFocus = onBack;
    window.addEventListener("online", again);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      window.removeEventListener("online", again);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = null;
    };
  }, [refresh, flush, reload]);

  // Each time the connection comes back, once: Next showing the page again runs this effect again
  // with the same count, and the mount effect has already read then.
  const reconnectsDone = useRef(0);
  useEffect(() => {
    if (reconnects <= reconnectsDone.current) return;
    reconnectsDone.current = reconnects;
    void Promise.resolve().then(() => {
      void flush();
      void reload();
    });
  }, [reconnects, flush, reload]);

  const marks = useMemo(() => [...shown.values()], [shown]);

  /** Adds a mark on a slide. Returns its id, or null when the slide already has the most marks it can. */
  const add = useCallback(
    (slide: number, rect: Rect, kind: MarkKind): string | null => {
      let onSlide = 0;
      for (const m of shown.values()) if (m.slide === slide) onSlide++;
      if (onSlide >= MARKS_PER_SLIDE) {
        say(TOO_MANY_MARKS);
        return null;
      }
      const id = newId();
      queue().add({ id, slide, rect, kind });
      setProblem(null);
      refresh();
      void flush();
      return id;
    },
    [shown, queue, refresh, flush, say],
  );

  const remove = useCallback(
    (id: string) => {
      queue().delete(id);
      refresh();
      void flush();
    },
    [queue, refresh, flush],
  );

  const setNote = useCallback(
    (id: string, note: string) => {
      queue().note(id, note);
      refresh();
      void flush();
    },
    [queue, refresh, flush],
  );

  /** Every mark on the slide turns red (the student is lost there) or yellow (no longer). */
  const setKind = useCallback(
    (slide: number, kind: MarkKind) => {
      queue().kind(slide, kind);
      refresh();
      void flush();
    },
    [queue, refresh, flush],
  );

  /**
   * Takes marks off the screen that the database already took away (0020's trigger deletes the
   * copy of a tap's old highlight when the tap is undone). Nothing is sent.
   */
  const forget = useCallback(
    (ids: Iterable<string>) => {
      let changed = false;
      for (const id of ids) changed = base.current.delete(id) || changed;
      if (changed) refresh();
    },
    [refresh],
  );

  /** The line under the panel goes back to normal (another slide, a tap). */
  const clearProblem = useCallback(() => setProblem(null), []);

  return { mode, marks, problem, clearProblem, add, remove, setNote, setKind, forget, flush, reload };
}

export type LiveMarks = ReturnType<typeof useLiveMarks>;
