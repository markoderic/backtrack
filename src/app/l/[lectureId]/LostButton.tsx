"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { buttonPrimarySmallClass, buttonSecondaryClass } from "@/components/ButtonPrimary";
import { Icon } from "@/components/Icon";
import { ImLostButton } from "@/components/ImLostButton";
import type { Rect } from "@/lib/rect";
import { TapQueue, isTapLimit, type PendingTap, type QueueOp, type SendResult } from "@/lib/tapQueue";
import { markRejected } from "@/lib/tapSync";

export const NOTE_MAX = 140;
/** The quiet counter shows only from this many characters on. */
const NOTE_COUNTER_FROM = 120;
const LECTURE_ENDED = "This one didn't save because the lecture had ended.";
const CHANGE_FAILED = "That change didn't save.";
/** A tap the server kept turning away (login gone, or too many requests), dropped after a few tries. */
const TAP_FAILED = "This one didn't save. Try again.";
const TOO_MANY = "Too many taps. Try again in a minute.";
const TOO_MANY_LECTURE = "Too many taps in this lecture.";

type Kind = "lost" | "save";
/** One of the student's rows that is not undone: its slide, kind, and the note and mark on it. */
export type Spot = { id: string; slide: number; kind: Kind; note?: string; rect?: Rect };

type Props = {
  lectureId: string;
  /** The slide on screen. A tap records this one. */
  viewing: number;
  /** Sends one queued op to the database. */
  send: (op: QueueOp) => Promise<SendResult>;
  /** The student's rows already saved for this lecture, or null while offline. A row without kind is lost. */
  loadOwn: () => Promise<{ id: string; slide: number; kind?: Kind; note?: string; rect?: Rect }[] | null>;
  /** Called with every row that is not undone (one entry per row), whenever they change. */
  onSpots: (spots: Spot[]) => void;
  /** Called right after a tap or a save is recorded, with its kind. */
  onTap?: (kind: Kind) => void;
  /** Goes up each time the live connection comes back. */
  reconnects?: number;
  /**
   * Gives the page this panel's flush. flush(true) is for a lecture that is ending:
   * a refusal then sets the rejected key for the spots page. The page may wait on it.
   */
  onFlushReady?: (flush: (ending?: boolean) => Promise<void>) => void;
  /** Whether the slide is taking a drag for Mark the spot (the page owns it; the slide layer draws). */
  marking?: boolean;
  onMarkingChange?: (on: boolean) => void;
  /**
   * Gives the page a way to save the box dragged on the slide as the mark of this slide's
   * spot. It is saved at once (an update of the row), with Clear mark to take it back.
   */
  onMarkReady?: (mark: (rect: Rect) => void) => void;
  /**
   * Called when the database refuses a send while the page is open (not in the flush
   * the page runs while leaving). Usually the lecture ended, so the page checks.
   */
  onRejected?: () => void;
  /** Shown under the buttons while there is nothing else to say (the page puts Reconnecting… here). */
  idle?: ReactNode;
};

function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Pages that are not https (and old browsers) have no randomUUID.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A spot with a queued change applied (a note, a mark, or Clear mark). */
function patched(spot: Spot, patch: { note?: string; rect?: Rect | null }): Spot {
  const next = { ...spot };
  if (patch.note !== undefined) {
    if (patch.note.trim() === "") delete next.note;
    else next.note = patch.note;
  }
  if (patch.rect === null) delete next.rect;
  else if (patch.rect) next.rect = patch.rect;
  return next;
}

/**
 * The rows in a queue that have not been taken back, with the queued notes and marks applied.
 * `base` adds rows that are already saved, so a change made offline to one of them shows too.
 */
function pendingSpots(ops: QueueOp[], base: ReadonlyMap<string, Spot> = new Map()): Map<string, Spot> {
  const spots = new Map(base);
  for (const op of ops) {
    if (op.op === "insert") {
      const t = op.tap;
      spots.set(t.id, patched({ id: t.id, slide: t.tappedOnSlide, kind: t.kind ?? "lost" }, { note: t.note, rect: t.rect }));
    } else if (op.patch.undone) spots.delete(op.id);
    else {
      const spot = spots.get(op.id);
      if (spot) spots.set(op.id, patched(spot, op.patch));
    }
  }
  return spots;
}

/** The latest row of a kind on a slide (a Map keeps the order rows came in). */
function latest(taps: ReadonlyMap<string, Spot>, slide: number, kind: Kind): Spot | null {
  let found: Spot | null = null;
  for (const t of taps.values()) if (t.slide === slide && t.kind === kind) found = t;
  return found;
}

type FocusTarget = "lost" | "note" | "textarea" | "panel";

/**
 * The I'm lost panel: the red I'm lost button, Save this, and, once the slide on screen has
 * a spot, what goes with it: Add a note (a 3 line field, 140 characters, Save note), Mark
 * the spot (drag a box on the slide; it saves when you let go, Clear mark takes it back)
 * and Undo. One tap per slide: after I'm lost the button shows "Lost on slide 7" and takes
 * no second tap until Undo. Another slide shows that slide's own state.
 *
 * A press is written to a queue (kept in localStorage) and shown at once, before any
 * animation; the queue is sent in the background and sent again when the connection
 * comes back. Notes and marks are updates of the same row, through the same queue.
 */
export function LostButton({
  lectureId,
  viewing,
  send,
  loadOwn,
  onSpots,
  reconnects = 0,
  onFlushReady,
  marking = false,
  onMarkingChange,
  onMarkReady,
  onTap,
  onRejected,
  idle,
}: Props) {
  const [taps, setTaps] = useState<ReadonlyMap<string, Spot>>(new Map());
  // The note being written: for which row (and slide), and the text so far. It stays open
  // when the slide changes, so a note typed while the teacher moves on is not lost.
  const [editing, setEditing] = useState<{ id: string; slide: number; draft: string } | null>(null);
  // What the status line says last; each one gets a new key so it is read even if the text repeats.
  const [said, setSaid] = useState<{ n: number; text: string } | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [fatal, setFatal] = useState<Error | null>(null);
  const fieldId = useId();

  const lostRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const noteButtonRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Where focus goes after an action that takes the focused control away (set by the action).
  const focusNext = useRef<FocusTarget | null>(null);
  // The control in the spot's tools that has focus. If it goes without an action saying where
  // focus goes (the slide changed, or the tap was refused), focus goes to the panel itself,
  // never to I'm lost: an Enter or Space meant for Undo must not record a new tap.
  const toolFocus = useRef<HTMLElement | null>(null);

  const queueRef = useRef<TapQueue | null>(null);
  const sendRef = useRef(send);
  const loadOwnRef = useRef(loadOwn);
  const onSpotsRef = useRef(onSpots);
  const onRejectedRef = useRef(onRejected);
  const onMarkingChangeRef = useRef(onMarkingChange);
  const mounted = useRef(false);
  const loaded = useRef(false);
  const loading = useRef(false);
  const takenBack = useRef(new Set<string>());
  // A tap the database refused while the page was open. It is gone from the queue,
  // so the flush on leaving must still tell the spots page.
  const refusedTap = useRef(false);
  // The ops the database refused for the tap limit (send said "limited" or "capped"), and which
  // one. Shared by every caller of a flush run, as two flushes at once get the same run and refusals.
  const limitedOps = useRef(new WeakMap<QueueOp, "limited" | "capped">());
  // The next try after a throttled send (the queue says how long to wait). One at a time.
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<(ending?: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    sendRef.current = send;
    loadOwnRef.current = loadOwn;
    onSpotsRef.current = onSpots;
    onRejectedRef.current = onRejected;
    onMarkingChangeRef.current = onMarkingChange;
  });

  // Made on first use, in the browser, never while rendering: the queue reads localStorage.
  const queue = useCallback(() => (queueRef.current ??= new TapQueue(lectureId)), [lectureId]);

  const say = useCallback((text: string) => setSaid((s) => ({ n: (s?.n ?? 0) + 1, text })), []);

  const dropTaps = useCallback((ids: Iterable<string>) => {
    const gone = new Set(ids);
    for (const id of gone) takenBack.current.add(id);
    setTaps((prev) => {
      const next = new Map(prev);
      for (const id of gone) next.delete(id);
      return next;
    });
    // A note being written for a row that is gone has nothing to go on.
    setEditing((e) => (e && gone.has(e.id) ? null : e));
    return gone;
  }, []);

  const fail = useCallback((e: unknown) => {
    if (mounted.current) setFatal(e instanceof Error ? e : new Error(String(e)));
  }, []);

  const flush = useCallback(async (ending = false) => {
    // Known before the flush starts, so it is noted first: the page leaves after at most
    // 3 seconds, maybe before a slow leaving flush comes back.
    if (ending && refusedTap.current) markRejected(lectureId);
    try {
      const {
        rejected: refused,
        gaveUp = [],
        retryIn,
      } = await queue().flush(async (op) => {
        const result = await sendRef.current(op);
        if (!isTapLimit(result)) return result;
        // Dropped like any refusal (never retried); remembered so the message can say why.
        limitedOps.current.set(op, result);
        return "rejected";
      });
      // Throttled (401 or 429): try again after the wait, while the page is open.
      if (retryIn !== undefined && mounted.current && !ending) {
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          void flushRef.current();
        }, retryIn);
      }
      // Dropped after too many throttled tries: not because the lecture ended, so the page
      // need not check and the spots page gets no note. The taps behind it go on.
      if (gaveUp.length > 0 && mounted.current) {
        const lost = dropTaps(gaveUp.flatMap((op) => (op.op === "insert" ? [op.tap.id] : [])));
        if (refused.length === 0) setRejected(lost.size > 0 ? TAP_FAILED : CHANGE_FAILED);
      }
      if (refused.length === 0) return;
      // Refused only for the tap limit: the lecture did not end, so the page need not check
      // and the spots page gets no "lecture had ended" note.
      const tooMany = refused.every((op) => limitedOps.current.has(op));
      // The page is going (or gone): nobody is here to show it, so leave a note for the spots page.
      if ((ending || !mounted.current) && !tooMany) markRejected(lectureId);
      if (!mounted.current) return;
      const gone = dropTaps(refused.flatMap((op) => (op.op === "insert" ? [op.tap.id] : [])));
      if (gone.size > 0 && !tooMany) refusedTap.current = true;
      const capped = refused.some((op) => limitedOps.current.get(op) === "capped");
      setRejected(tooMany ? (capped ? TOO_MANY_LECTURE : TOO_MANY) : gone.size > 0 ? LECTURE_ENDED : CHANGE_FAILED);
      if (!ending && !tooMany) onRejectedRef.current?.();
    } catch (e) {
      fail(e);
    }
  }, [queue, lectureId, dropTaps, fail]);

  useEffect(() => {
    flushRef.current = flush;
    onFlushReady?.(flush);
  }, [onFlushReady, flush]);

  const loadSaved = useCallback(async () => {
    if (loaded.current || loading.current) return;
    loading.current = true;
    try {
      const rows = await loadOwnRef.current();
      if (!mounted.current || rows === null) return; // offline: try again on the next trigger
      loaded.current = true;
      const saved = new Map<string, Spot>();
      for (const r of rows) {
        if (takenBack.current.has(r.id)) continue;
        const spot: Spot = { id: r.id, slide: r.slide, kind: r.kind ?? "lost" };
        if (r.note) spot.note = r.note;
        if (r.rect) spot.rect = r.rect;
        saved.set(r.id, spot);
      }
      // Changes still in the queue are newer than what the database had.
      const withQueued = pendingSpots(queue().pending(), saved);
      setTaps((prev) => {
        const next = new Map(prev);
        // A row already shown here is the newer one (made or changed on this screen).
        for (const [id, spot] of withQueued) if (!next.has(id) && !takenBack.current.has(id)) next.set(id, spot);
        return next;
      });
    } catch (e) {
      fail(e);
    } finally {
      loading.current = false;
    }
  }, [fail, queue]);

  // On mount: show the taps left over from the last visit, send them, and load the saved rows.
  useEffect(() => {
    mounted.current = true;
    // Taps left from the last visit get their dots back (read after the first render, as storage is only there in the browser).
    void Promise.resolve().then(() => {
      if (!mounted.current) return;
      const left = pendingSpots(queue().pending());
      if (left.size === 0) return;
      setTaps((prev) => {
        const next = new Map(prev);
        for (const [id, spot] of left) if (!takenBack.current.has(id) && !next.has(id)) next.set(id, spot);
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
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = null;
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

  const lostSpot = latest(taps, viewing, "lost");
  const saveSpot = latest(taps, viewing, "save");
  // The spot the tools work on: the I'm lost one, or else the save.
  const active = lostSpot ?? saveSpot;

  function record(kind: Kind) {
    const id = newId();
    // Recorded and queued first; everything you see follows.
    const tap: PendingTap = { id, tappedOnSlide: viewing, tappedAt: new Date().toISOString() };
    if (kind === "save") tap.kind = "save";
    queue().enqueue(tap);
    setTaps((prev) => new Map(prev).set(id, { id, slide: viewing, kind }));
    setRejected(null);
    say(`Saved slide ${viewing}${kind === "save" ? ", just for you" : ""}.`);
    void flush();
    onTap?.(kind);
  }

  // One tap per slide: a second I'm lost (or a second save) on the same slide records nothing.
  function pressLost() {
    if (lostSpot) return;
    record("lost");
  }

  function pressSave() {
    if (lostSpot || saveSpot) return;
    record("save");
  }

  /** Queues a change to a row and shows it at once. */
  function change(spot: Spot, patch: { note?: string; rect?: Rect | null }) {
    queue().update(spot.id, patch);
    setTaps((prev) => {
      const current = prev.get(spot.id);
      return current ? new Map(prev).set(spot.id, patched(current, patch)) : prev;
    });
    void flush();
  }

  function undo() {
    if (!active) return;
    // Every row of that kind on this slide (a slide can hold two from before this screen took one per slide).
    const ids = [...taps.values()].filter((t) => t.slide === viewing && t.kind === active.kind).map((t) => t.id);
    for (const id of ids) {
      // An unsent tap is simply taken out. A sent one gets an update that marks it undone.
      if (!queue().cancel(id)) queue().update(id, { undone: true });
    }
    dropTaps(ids);
    onMarkingChangeRef.current?.(false);
    say("Undone.");
    // Undo was pressed on purpose: I'm lost is back and takes the focus.
    focusNext.current = "lost";
    void flush();
  }

  function startNote() {
    if (!active) return;
    setEditing({ id: active.id, slide: viewing, draft: active.note ?? "" });
    focusNext.current = "textarea";
  }

  function closeNote() {
    // Back to the note button on the same slide; on another slide, to the panel (not I'm lost).
    focusNext.current = editing && editing.slide === viewing ? "note" : "panel";
    setEditing(null);
  }

  function saveNote(e?: FormEvent) {
    e?.preventDefault();
    if (!editing) return;
    const spot = taps.get(editing.id);
    const note = editing.draft.trim();
    if (spot && note !== (spot.note ?? "")) {
      change(spot, { note });
      say(note ? "Note saved." : "Note removed.");
    }
    closeNote();
  }

  // Enter saves (Shift+Enter is a new line), Esc drops the changes.
  function onNoteKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      saveNote();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeNote();
    }
  }

  function onMarkButton() {
    if (!active) return;
    if (marking) {
      onMarkingChangeRef.current?.(false);
    } else if (active.rect) {
      change(active, { rect: null });
      say("Mark cleared.");
    } else {
      onMarkingChangeRef.current?.(true);
    }
  }

  // The page calls this when a drag on the slide ends: the box is this slide's mark, saved now.
  useEffect(() => {
    onMarkReady?.((rect) => {
      if (!active) return;
      change(active, { rect });
      onMarkingChangeRef.current?.(false);
      say("Spot marked.");
    });
  });

  // The field grows with its text (3 lines at least).
  const draft = editing?.draft;
  useEffect(() => {
    const field = textareaRef.current;
    if (!field || draft === undefined) return;
    field.style.height = "auto";
    if (field.scrollHeight > 0) field.style.height = `${field.scrollHeight + 2}px`;
  }, [draft]);

  useEffect(() => {
    const want = focusNext.current;
    focusNext.current = null;
    if (want) {
      const target =
        want === "lost"
          ? lostRef.current
          : want === "note"
            ? noteButtonRef.current
            : want === "textarea"
              ? textareaRef.current
              : panelRef.current;
      (target ?? panelRef.current)?.focus();
      return;
    }
    // Only once the control is really gone: while focus moves on (Tab), the page briefly has none.
    const last = toolFocus.current;
    if (!last || last.isConnected) return;
    toolFocus.current = null;
    const now = document.activeElement;
    if (!now || now === document.body) panelRef.current?.focus();
  });

  if (fatal) throw fatal;

  const note = active?.note;
  const editingHere = editing !== null;
  const counter = editing && editing.draft.length >= NOTE_COUNTER_FROM ? NOTE_MAX - editing.draft.length : null;

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      aria-label={`Slide ${viewing}`}
      data-lecture-panel=""
      className="flex min-w-0 flex-col gap-3 rounded-md focus-ring focus-visible:outline-offset-4"
    >
      <ImLostButton ref={lostRef} onClick={pressLost} checked={!!lostSpot} slide={viewing} />
      {!active && (
        <button type="button" onClick={pressSave} className={`${buttonSecondaryClass} w-full`}>
          Save this
        </button>
      )}
      {(active || editing) && (
        <div
          data-tools=""
          className="flex animate-rise-in flex-col gap-3"
          onFocus={(e) => {
            toolFocus.current = e.target;
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) toolFocus.current = null;
          }}
        >
          {active?.kind === "save" && !lostSpot && (
            <p className="flex items-center gap-2 type-small-strong text-ink">
              <span aria-hidden className="size-2.5 rounded-full border-[1.5px] border-ink" />
              Saved slide {viewing}, just for you
            </p>
          )}
          {editing ? (
            <form onSubmit={saveNote} className="flex flex-col gap-2">
              <label htmlFor={fieldId} className="type-small-strong text-ink">
                {editing.slide === viewing ? "Your note" : `Your note on slide ${editing.slide}`}
              </label>
              <textarea
                ref={textareaRef}
                id={fieldId}
                rows={3}
                maxLength={NOTE_MAX}
                enterKeyHint="done"
                value={editing.draft}
                onChange={(e) => setEditing({ ...editing, draft: e.target.value.slice(0, NOTE_MAX) })}
                onKeyDown={onNoteKeyDown}
                className="block min-h-[5.5rem] w-full resize-none rounded-md border border-hairline bg-surface px-3 py-2 type-body text-ink outline-hidden transition-colors duration-(--dur-fast) focus:border-ink focus:shadow-[inset_0_0_0_0.5px_var(--color-ink)]"
              />
              <div className="flex flex-wrap items-center justify-end gap-2">
                {counter !== null && (
                  <span data-counter="" className="mr-auto type-caption text-secondary">
                    {counter} left
                  </span>
                )}
                <button type="button" onClick={closeNote} className={buttonSecondaryClass}>
                  Cancel
                </button>
                <button type="submit" className={buttonPrimarySmallClass}>
                  Save note
                </button>
              </div>
            </form>
          ) : (
            note && (
              <div data-note="" className="flex flex-col gap-1 border-t border-hairline pt-3">
                <p className="type-caption text-secondary">Your note</p>
                <p className="type-body break-words whitespace-pre-wrap text-ink">{note}</p>
              </div>
            )
          )}
          {active && !editingHere && (
            <div className="grid grid-cols-2 gap-2">
              <button ref={noteButtonRef} type="button" onClick={startNote} className={buttonSecondaryClass}>
                {note ? "Edit note" : "Add a note"}
              </button>
              <button
                type="button"
                onClick={onMarkButton}
                aria-pressed={marking}
                className={`${buttonSecondaryClass} ${marking ? "border-ink" : ""}`}
              >
                {marking ? "Stop marking" : active.rect ? "Clear mark" : "Mark the spot"}
              </button>
              <button type="button" onClick={undo} className={`${buttonSecondaryClass} col-span-2`}>
                Undo
              </button>
            </div>
          )}
        </div>
      )}
      {rejected ? (
        <p role="alert" className="flex animate-fade-in items-start gap-2 type-small text-ink">
          <Icon name="alert" size={18} className="mt-px shrink-0" />
          {rejected}
        </p>
      ) : (
        idle
      )}
      {/* Always there, so a screen reader says each save, note, mark and Undo (a new line each time). */}
      <p role="status" aria-atomic="false" className="sr-only">
        {said && <span key={said.n}>{said.text}</span>}
      </p>
    </section>
  );
}
