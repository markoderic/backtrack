"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { TapQueue, type QueueOp, type SendResult } from "@/lib/tapQueue";

const UNDO_WINDOW_MS = 8000;
const LECTURE_ENDED = "This one didn't save because the lecture had ended.";
const CHANGE_FAILED = "That change didn't save.";

type Props = {
  lectureId: string;
  /** The slide on screen. A tap records this one. */
  viewing: number;
  /** Sends one queued op to the database. */
  send: (op: QueueOp) => Promise<SendResult>;
  /** The student's rows already saved for this lecture, or null while offline. */
  loadOwn: () => Promise<{ id: string; slide: number }[] | null>;
  /** Called with every slide that has a tap that is not undone. */
  onSpots: (spots: Set<number>) => void;
  /** Goes up each time the live connection comes back. */
  reconnects?: number;
  /** Shown in the same row, left and right of the button. */
  before?: ReactNode;
  after?: ReactNode;
};

type Bar = { id: string; slide: number; note: string; saved: boolean };

function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Pages that are not https (and old browsers) have no randomUUID.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Taps in a queue that have not been taken back, as id to slide. */
function pendingTaps(ops: QueueOp[]): Map<string, number> {
  const taps = new Map<string, number>();
  for (const op of ops) {
    if (op.op === "insert") taps.set(op.tap.id, op.tap.tappedOnSlide);
    else if (op.patch.undone) taps.delete(op.id);
  }
  return taps;
}

/**
 * The I'm lost button, and the bar above it that says what was saved. A press is
 * written to a queue (kept in localStorage) and shown at once; the queue is sent
 * in the background and sent again when the connection comes back. The bar holds
 * Undo and an optional note for 8 seconds, in a row of fixed height so nothing
 * moves.
 */
export function LostButton({ lectureId, viewing, send, loadOwn, onSpots, reconnects = 0, before, after }: Props) {
  const [taps, setTaps] = useState<ReadonlyMap<string, number>>(new Map());
  const [bar, setBar] = useState<Bar | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [fatal, setFatal] = useState<Error | null>(null);

  const queueRef = useRef<TapQueue | null>(null);
  const sendRef = useRef(send);
  const loadOwnRef = useRef(loadOwn);
  const onSpotsRef = useRef(onSpots);
  const mounted = useRef(false);
  const loaded = useRef(false);
  const loading = useRef(false);
  const takenBack = useRef(new Set<string>());
  useEffect(() => {
    sendRef.current = send;
    loadOwnRef.current = loadOwn;
    onSpotsRef.current = onSpots;
  });

  // Made on first use, in the browser, never while rendering: the queue reads localStorage.
  const queue = useCallback(() => (queueRef.current ??= new TapQueue(lectureId)), [lectureId]);

  const dropTaps = useCallback((ids: Iterable<string>) => {
    const gone = new Set(ids);
    for (const id of gone) takenBack.current.add(id);
    setTaps((prev) => {
      const next = new Map(prev);
      for (const id of gone) next.delete(id);
      return next;
    });
    return gone;
  }, []);

  const fail = useCallback((e: unknown) => {
    if (mounted.current) setFatal(e instanceof Error ? e : new Error(String(e)));
  }, []);

  const flush = useCallback(async () => {
    try {
      const { rejected: refused } = await queue().flush((op) => sendRef.current(op));
      if (!mounted.current || refused.length === 0) return;
      const gone = dropTaps(refused.flatMap((op) => (op.op === "insert" ? [op.tap.id] : [])));
      setBar((b) => (b && gone.has(b.id) ? null : b));
      setRejected(gone.size > 0 ? LECTURE_ENDED : CHANGE_FAILED);
    } catch (e) {
      fail(e);
    }
  }, [queue, dropTaps, fail]);

  const loadSaved = useCallback(async () => {
    if (loaded.current || loading.current) return;
    loading.current = true;
    try {
      const rows = await loadOwnRef.current();
      if (!mounted.current || rows === null) return; // offline: try again on the next trigger
      loaded.current = true;
      setTaps((prev) => {
        const next = new Map(prev);
        for (const r of rows) if (!takenBack.current.has(r.id)) next.set(r.id, r.slide);
        return next;
      });
    } catch (e) {
      fail(e);
    } finally {
      loading.current = false;
    }
  }, [fail]);

  // On mount: show the taps left over from the last visit, send them, and load the saved rows.
  useEffect(() => {
    mounted.current = true;
    // Taps left from the last visit get their dots back (read after the first render, as storage is only there in the browser).
    void Promise.resolve().then(() => {
      if (!mounted.current) return;
      const left = pendingTaps(queue().pending());
      if (left.size === 0) return;
      setTaps((prev) => {
        const next = new Map(prev);
        for (const [id, slide] of left) if (!takenBack.current.has(id)) next.set(id, slide);
        return next;
      });
    });
    void flush();
    void loadSaved();
    const onOnline = () => {
      void flush();
      void loadSaved();
    };
    window.addEventListener("online", onOnline);
    return () => {
      mounted.current = false;
      window.removeEventListener("online", onOnline);
    };
  }, [queue, flush, loadSaved]);

  useEffect(() => {
    if (reconnects === 0) return;
    void flush();
    void loadSaved();
  }, [reconnects, flush, loadSaved]);

  useEffect(() => {
    onSpotsRef.current(new Set(taps.values()));
  }, [taps]);

  // The bar closes itself, which ends the Undo window. Typing starts the 8 seconds over.
  useEffect(() => {
    if (!bar) return;
    const timer = setTimeout(() => setBar(null), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [bar]);

  if (fatal) throw fatal;

  function press() {
    const id = newId();
    queue().enqueue({ id, tappedOnSlide: viewing, tappedAt: new Date().toISOString() });
    setTaps((prev) => new Map(prev).set(id, viewing));
    setRejected(null);
    setBar({ id, slide: viewing, note: "", saved: false });
    void flush();
  }

  function undo() {
    if (!bar) return;
    // An unsent tap is simply taken out. A sent one gets an update that marks it undone.
    if (!queue().cancel(bar.id)) queue().update(bar.id, { undone: true });
    dropTaps([bar.id]);
    setBar(null);
    void flush();
  }

  function saveNote(e: React.FormEvent) {
    e.preventDefault();
    if (!bar || bar.saved) return;
    const note = bar.note.trim();
    if (!note) return;
    queue().update(bar.id, { note });
    setBar({ ...bar, saved: true });
    void flush();
  }

  return (
    <div className="flex flex-col gap-3">
      <div data-bar className="flex h-20 flex-col justify-center gap-2">
        {bar ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <p role="status">{`Saved slide ${bar.slide}`}</p>
              <button type="button" onClick={undo} className="h-10 border border-white px-4">
                Undo
              </button>
            </div>
            {bar.saved ? (
              <p>Note saved</p>
            ) : (
              <form onSubmit={saveNote} className="flex gap-2">
                <input
                  type="text"
                  maxLength={140}
                  placeholder="What lost you? Optional"
                  aria-label="What lost you? Optional"
                  value={bar.note}
                  onChange={(e) => setBar({ ...bar, note: e.target.value })}
                  className="h-10 min-w-0 flex-1 border border-white bg-transparent px-2"
                />
                <button type="submit" disabled={!bar.note.trim()} className="h-10 border border-white px-4 disabled:opacity-40">
                  Save
                </button>
              </form>
            )}
          </>
        ) : rejected ? (
          <p role="alert">{rejected}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {before}
        <button type="button" onClick={press} className="min-w-0 flex-1 border border-white px-3 py-3">
          I&apos;m lost
        </button>
        {after}
      </div>
    </div>
  );
}
