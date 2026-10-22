"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { ImLostButton } from "@/components/ImLostButton";
import type { Rect } from "@/lib/rect";
import { TapQueue, type PendingTap, type QueueOp, type SendResult } from "@/lib/tapQueue";
import { markRejected } from "@/lib/tapSync";

/** The saved line (and with it Undo) stays this long, or until the next slide. Typing a note holds it open. */
export const UNDO_WINDOW_MS = 10000;
const LECTURE_ENDED = "This one didn't save because the lecture had ended.";
const CHANGE_FAILED = "That change didn't save.";

type Props = {
  lectureId: string;
  /** The slide on screen. A tap records this one. */
  viewing: number;
  /** Sends one queued op to the database. */
  send: (op: QueueOp) => Promise<SendResult>;
  /** The student's rows already saved for this lecture, or null while offline. A row without kind is lost. */
  loadOwn: () => Promise<{ id: string; slide: number; kind?: Kind }[] | null>;
  /** Called with every row that is not undone (one entry per tap), whenever they change. */
  onSpots: (spots: Spot[]) => void;
  /** Called right after a tap or a highlight is recorded, with its kind. */
  onTap?: (kind: Kind) => void;
  /** Called with what the saved line is about (slide, kind and the highlight box, if any), or null when it closes. */
  onBarChange?: (bar: { slide: number; kind: Kind; rect?: Rect } | null) => void;
  /** Goes up each time the live connection comes back. */
  reconnects?: number;
  /**
   * Gives the page this button's flush. flush(true) is for a lecture that is ending:
   * a refusal then sets the rejected key for the spots page. The page may wait on it.
   */
  onFlushReady?: (flush: (ending?: boolean) => Promise<void>) => void;
  /**
   * Gives the page a way to save a highlighted tap (from the box drawn on the slide)
   * on the slide on screen. It goes through the same queue, bar and Undo as the button.
   */
  onAddReady?: (add: (highlight: { kind: "lost" | "save"; rect: Rect; note?: string }) => void) => void;
  /** Shown in the saved row while it has nothing else to say (the page puts Reconnecting… here). */
  idle?: ReactNode;
};

type Kind = "lost" | "save";
export type Spot = { slide: number; kind: Kind };
type Bar = { id: string; slide: number; note: string; saved: boolean; kind: Kind; rect?: Rect };

function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Pages that are not https (and old browsers) have no randomUUID.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Taps in a queue that have not been taken back, as id to slide and kind. */
function pendingTaps(ops: QueueOp[]): Map<string, Spot> {
  const taps = new Map<string, Spot>();
  for (const op of ops) {
    if (op.op === "insert") taps.set(op.tap.id, { slide: op.tap.tappedOnSlide, kind: op.tap.kind ?? "lost" });
    else if (op.patch.undone) taps.delete(op.id);
  }
  return taps;
}

/**
 * The I'm lost button (in its 104 px row) and, under it, the saved row that says
 * what was saved. A press is written to a queue (kept in localStorage) and shown at
 * once, before any animation; the queue is sent in the background and sent again
 * when the connection comes back. The saved line ("Saved slide 7 · Add a note ·
 * Undo") stays for 10 seconds or until the slide changes, and longer while a note
 * is being typed: Enter sends the note, Esc drops it. Its row is always reserved,
 * so nothing moves.
 */
export function LostButton({
  lectureId,
  viewing,
  send,
  loadOwn,
  onSpots,
  reconnects = 0,
  onFlushReady,
  onAddReady,
  onTap,
  onBarChange,
  idle,
}: Props) {
  const [taps, setTaps] = useState<ReadonlyMap<string, Spot>>(new Map());
  const [bar, setBar] = useState<Bar | null>(null);
  // Goes up when the highlight menu saves an I'm lost, so the button shows Saved too.
  const [savedSignal, setSavedSignal] = useState(0);
  const [lastViewing, setLastViewing] = useState(viewing);
  // The saved line whose note field has focus, if any.
  const [focusedBar, setFocusedBar] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [fatal, setFatal] = useState<Error | null>(null);

  const queueRef = useRef<TapQueue | null>(null);
  const sendRef = useRef(send);
  const loadOwnRef = useRef(loadOwn);
  const onSpotsRef = useRef(onSpots);
  const onBarChangeRef = useRef(onBarChange);
  const mounted = useRef(false);
  const loaded = useRef(false);
  const loading = useRef(false);
  const takenBack = useRef(new Set<string>());
  useEffect(() => {
    sendRef.current = send;
    loadOwnRef.current = loadOwn;
    onSpotsRef.current = onSpots;
    onBarChangeRef.current = onBarChange;
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

  const flush = useCallback(async (ending = false) => {
    try {
      const { rejected: refused } = await queue().flush((op) => sendRef.current(op));
      if (refused.length === 0) return;
      // The page is going (or gone): nobody is here to show it, so leave a note for the spots page.
      if (ending || !mounted.current) markRejected(lectureId);
      if (!mounted.current) return;
      const gone = dropTaps(refused.flatMap((op) => (op.op === "insert" ? [op.tap.id] : [])));
      setBar((b) => (b && gone.has(b.id) ? null : b));
      setRejected(gone.size > 0 ? LECTURE_ENDED : CHANGE_FAILED);
    } catch (e) {
      fail(e);
    }
  }, [queue, lectureId, dropTaps, fail]);

  useEffect(() => {
    onFlushReady?.(flush);
  }, [onFlushReady, flush]);

  const loadSaved = useCallback(async () => {
    if (loaded.current || loading.current) return;
    loading.current = true;
    try {
      const rows = await loadOwnRef.current();
      if (!mounted.current || rows === null) return; // offline: try again on the next trigger
      loaded.current = true;
      setTaps((prev) => {
        const next = new Map(prev);
        for (const r of rows) if (!takenBack.current.has(r.id)) next.set(r.id, { slide: r.slide, kind: r.kind ?? "lost" });
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
        for (const [id, spot] of left) if (!takenBack.current.has(id)) next.set(id, spot);
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
    onSpotsRef.current([...taps.values()]);
  }, [taps]);

  // A note being typed (not sent yet) holds the saved line open: the field has focus, or holds real text.
  const typing = !!bar && !bar.saved && (bar.note.trim() !== "" || focusedBar === bar.id);
  const barId = bar?.id;

  // The next slide closes the saved line, unless a note is being typed.
  if (viewing !== lastViewing) {
    setLastViewing(viewing);
    if (bar && !typing) setBar(null);
  }

  // The saved line closes itself after 10 seconds, which ends the Undo window.
  // Typing holds it; sending or dropping the note starts the 10 seconds over.
  useEffect(() => {
    if (!barId || typing) return;
    const timer = setTimeout(() => setBar(null), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [barId, typing]);

  const barSlide = bar?.slide;
  const barKind = bar?.kind;
  const barRect = bar?.rect;
  useEffect(() => {
    onBarChangeRef.current?.(barSlide !== undefined && barKind ? { slide: barSlide, kind: barKind, rect: barRect } : null);
  }, [barSlide, barKind, barRect]);

  function record(extra: Pick<PendingTap, "kind" | "rect" | "note"> = {}) {
    const id = newId();
    const kind = extra.kind ?? "lost";
    // Recorded and queued first; everything you see follows.
    queue().enqueue({ id, tappedOnSlide: viewing, tappedAt: new Date().toISOString(), ...extra });
    setTaps((prev) => new Map(prev).set(id, { slide: viewing, kind }));
    setRejected(null);
    // A note that came with the tap is already on it.
    setBar({ id, slide: viewing, note: extra.note ?? "", saved: !!extra.note, kind, rect: extra.rect });
    void flush();
    onTap?.(kind);
  }

  // The page calls this from the highlight menu. It always reads the slide on screen now.
  useEffect(() => {
    onAddReady?.((h) => {
      record({ kind: h.kind, rect: h.rect, ...(h.note ? { note: h.note } : {}) });
      // I'm lost from the menu gives the button its Saved look too. Save this leaves it as it is.
      if (h.kind === "lost") setSavedSignal((n) => n + 1);
    });
  });

  if (fatal) throw fatal;

  function press() {
    record();
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
    setBar({ ...bar, note, saved: true });
    void flush();
  }

  // Esc drops the note (not the tap).
  function onNoteKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape" && bar) {
      e.preventDefault();
      setBar({ ...bar, note: "" });
    }
  }

  const message = bar ? `Saved slide ${bar.slide}${bar.kind === "save" ? ", just for you" : ""}` : "";

  return (
    <>
      <div className="flex h-26 w-full shrink-0 items-center justify-center">
        <ImLostButton onClick={press} savedSignal={savedSignal} />
      </div>
      <div data-bar className="flex h-20 w-full shrink-0 items-center justify-center sm:h-10">
        {bar ? (
          <div
            key={bar.id}
            className="flex max-w-full animate-rise-in flex-wrap items-center justify-center gap-x-4 gap-y-2 max-sm:w-75"
          >
            <p role="status" className="order-1 whitespace-nowrap type-small-strong text-ink">
              {message}
            </p>
            <div className="order-3 h-8 border-b border-hairline py-1 transition-colors duration-(--dur-fast) focus-within:border-ink max-sm:w-full sm:order-2 sm:w-60">
              {bar.saved ? (
                <p className="truncate type-note text-ink" title={bar.note}>
                  <span className="sr-only">Note saved: </span>
                  {bar.note}
                </p>
              ) : (
                <form onSubmit={saveNote}>
                  <input
                    type="text"
                    maxLength={140}
                    placeholder="Add a note"
                    aria-label="Add a note"
                    enterKeyHint="send"
                    value={bar.note}
                    onChange={(e) => setBar({ ...bar, note: e.target.value })}
                    onKeyDown={onNoteKeyDown}
                    onFocus={() => setFocusedBar(bar.id)}
                    onBlur={() => setFocusedBar(null)}
                    className="block h-6 w-full min-w-0 bg-transparent type-note text-ink outline-hidden placeholder:text-secondary"
                  />
                </form>
              )}
            </div>
            <button
              type="button"
              onClick={undo}
              className="press order-2 rounded-xs type-small-strong text-ink underline hover:text-secondary focus-ring sm:order-3"
            >
              Undo
            </button>
          </div>
        ) : rejected ? (
          <p role="alert" className="flex animate-fade-in items-center gap-2 type-small text-ink">
            <Icon name="alert" size={18} />
            {rejected}
          </p>
        ) : (
          idle
        )}
      </div>
    </>
  );
}
