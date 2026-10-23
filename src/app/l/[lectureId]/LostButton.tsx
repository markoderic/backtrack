"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { buttonSecondaryClass } from "@/components/ButtonPrimary";
import { Icon } from "@/components/Icon";
import { ImLostButton } from "@/components/ImLostButton";
import type { Rect } from "@/lib/rect";
import { TapQueue, isTapLimit, type PendingTap, type QueueOp, type SendResult } from "@/lib/tapQueue";
import { markRejected } from "@/lib/tapSync";

/** The longest note (the database's check on lost_taps.note, 0007). */
export const NOTE_MAX = 140;
/** The quiet counter shows only from this many characters on. */
const NOTE_COUNTER_FROM = 120;
/**
 * Undo is offered this long after a tap, and only while the slide it was made on stays on screen
 * (the Saved line closes on the next slide). The tap itself stays saved; My spots can remove it later.
 */
export const UNDO_MS = 10_000;
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

/** The spot a slide's tools and note work on: its I'm lost row, or else its save. */
function spotOn(taps: ReadonlyMap<string, Spot>, slide: number): Spot | null {
  return latest(taps, slide, "lost") ?? latest(taps, slide, "save");
}

/** A note being typed: for which slide, and the text so far. */
type Draft = { slide: number; text: string };

/** The draft says something the slide's spot does not have yet (or the slide has no spot and the draft has words). */
function isDirty(taps: ReadonlyMap<string, Spot>, draft: Draft): boolean {
  const spot = spotOn(taps, draft.slide);
  const text = draft.text.trim();
  return spot ? text !== (spot.note ?? "") : text !== "";
}

/** The second click of a double click (on the button that just took the first one's place). */
const isRepeatClick = (e: MouseEvent) => e.detail > 1;

type FocusTarget = "lost" | "panel";

/**
 * The I'm lost panel: the red I'm lost button, then Save this (or, once the slide on screen
 * has a spot, Mark the spot and, for 10 seconds, Undo), then a note box that is always there.
 * One tap per slide: after I'm lost the button shows "Lost on slide 7" and takes no second
 * tap. Another slide shows that slide's own state.
 *
 * The note box: typing and Enter (or the check button) saves the note on the slide's spot. On a
 * slide with no spot yet it records I'm lost on that slide with the note, in one go. A note being
 * typed stays when the slide changes, and saves on the slide it was started on. Esc drops it.
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
  // The note being typed. It stays when the slide changes, so a note typed while the teacher moves on is not lost.
  const [draft, setDraft] = useState<Draft | null>(null);
  // Taps made on this screen less than 10 s ago, while their slide stayed on screen: these offer Undo.
  const [undoable, setUndoable] = useState<ReadonlySet<string>>(new Set());
  const undoTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // What the status line says last; each one gets a new key so it is read even if the text repeats.
  const [said, setSaid] = useState<{ n: number; text: string } | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [fatal, setFatal] = useState<Error | null>(null);

  const lostRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Where focus goes after an action that takes the focused control away (set by the action).
  const focusNext = useRef<FocusTarget | null>(null);
  // The control in the spot's tools that has focus. If it goes without an action saying where
  // focus goes (the slide changed, Undo's 10 s ran out, or the tap was refused), focus goes to
  // the panel itself, never to I'm lost: an Enter or Space meant for Undo must not record a new tap.
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
    return gone;
  }, []);

  /** A note sent with a new tap that did not save comes back into the box, so it is not lost. */
  const keepNotes = useCallback((dropped: QueueOp[]) => {
    const op = dropped.find((o) => o.op === "insert" && o.tap.note);
    if (!op || op.op !== "insert" || !op.tap.note) return;
    const text = op.tap.note;
    const slide = op.tap.tappedOnSlide;
    setDraft((d) => d ?? { slide, text });
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
        keepNotes(gaveUp);
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
      keepNotes(refused);
      if (gone.size > 0 && !tooMany) refusedTap.current = true;
      const capped = refused.some((op) => limitedOps.current.get(op) === "capped");
      setRejected(tooMany ? (capped ? TOO_MANY_LECTURE : TOO_MANY) : gone.size > 0 ? LECTURE_ENDED : CHANGE_FAILED);
      if (!ending && !tooMany) onRejectedRef.current?.();
    } catch (e) {
      fail(e);
    }
  }, [queue, lectureId, dropTaps, keepNotes, fail]);

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
    const timers = undoTimers.current;
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
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
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

  // Another slide on screen: the Saved line closes and Undo goes with it (the taps stay saved).
  // A note box left as it was (nothing typed) follows the new slide.
  const [shownSlide, setShownSlide] = useState(viewing);
  if (shownSlide !== viewing) {
    setShownSlide(viewing);
    if (undoable.size > 0) setUndoable(new Set());
    if (draft && !isDirty(taps, draft)) setDraft(null);
  }

  const lostSpot = latest(taps, viewing, "lost");
  const saveSpot = latest(taps, viewing, "save");
  // The spot the tools work on: the I'm lost one, or else the save.
  const active = lostSpot ?? saveSpot;
  const canUndo = !!active && undoable.has(active.id);

  /** Offers Undo on a new tap for 10 s. */
  function offerUndo(id: string) {
    setUndoable((s) => new Set(s).add(id));
    const timer = setTimeout(() => {
      undoTimers.current.delete(id);
      setUndoable((s) => {
        if (!s.has(id)) return s;
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }, UNDO_MS);
    undoTimers.current.set(id, timer);
  }

  function record(kind: Kind, slide = viewing, note?: string) {
    const id = newId();
    // Recorded and queued first; everything you see follows.
    const tap: PendingTap = { id, tappedOnSlide: slide, tappedAt: new Date().toISOString() };
    if (kind === "save") tap.kind = "save";
    if (note) tap.note = note;
    queue().enqueue(tap);
    setTaps((prev) => new Map(prev).set(id, note ? { id, slide, kind, note } : { id, slide, kind }));
    setRejected(null);
    // Undo belongs to the Saved line of the slide on screen.
    if (slide === viewing) offerUndo(id);
    say(`Saved slide ${slide}${kind === "save" ? ", just for you" : ""}.${note ? " Note saved." : ""}`);
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

  function undo(e: MouseEvent) {
    if (isRepeatClick(e) || !active || !canUndo) return;
    // Every row of that kind on this slide (a slide can hold two from before this screen took one per slide).
    const ids = [...taps.values()].filter((t) => t.slide === viewing && t.kind === active.kind).map((t) => t.id);
    for (const id of ids) {
      // An unsent tap is simply taken out. A sent one gets an update that marks it undone.
      if (!queue().cancel(id)) queue().update(id, { undone: true });
    }
    dropTaps(ids);
    setUndoable((s) => {
      const next = new Set(s);
      for (const id of ids) next.delete(id);
      return next;
    });
    onMarkingChangeRef.current?.(false);
    say("Undone.");
    // Undo was pressed on purpose: I'm lost is back and takes the focus.
    focusNext.current = "lost";
    void flush();
  }

  // The note box works on the slide its draft was started on, else on the slide on screen.
  const noteSlide = draft?.slide ?? viewing;
  const noteSpot = spotOn(taps, noteSlide);
  const noteText = draft ? draft.text : (noteSpot?.note ?? "");
  const canSaveNote = draft !== null && isDirty(taps, draft);

  function saveNote(e?: FormEvent) {
    e?.preventDefault();
    if (!draft || !isDirty(taps, draft)) {
      setDraft(null);
      return;
    }
    const text = draft.text.trim();
    const spot = spotOn(taps, draft.slide);
    if (spot) {
      change(spot, { note: text });
      say(text ? "Note saved." : "Note removed.");
    } else {
      // No tap on that slide yet: the note is an I'm lost with the note, in one go.
      record("lost", draft.slide, text);
    }
    setDraft(null);
  }

  // Enter saves (Shift+Enter is a new line), Esc drops the changes.
  function onNoteKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      saveNote();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(null);
    }
  }

  function onMarkButton(e: MouseEvent) {
    if (isRepeatClick(e) || !active) return;
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

  // The box grows with its text, from 2 lines up to 4 (then it scrolls).
  useEffect(() => {
    const field = textareaRef.current;
    if (!field) return;
    field.style.height = "";
    if (field.scrollHeight > field.clientHeight) field.style.height = `${field.scrollHeight + 2}px`;
  }, [noteText]);

  useEffect(() => {
    const want = focusNext.current;
    focusNext.current = null;
    if (want) {
      ((want === "lost" ? lostRef.current : panelRef.current) ?? panelRef.current)?.focus();
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

  const counter = draft && draft.text.length >= NOTE_COUNTER_FROM ? NOTE_MAX - draft.text.length : null;
  const otherSlide = draft && draft.slide !== viewing ? draft.slide : null;
  const savedForYou = active?.kind === "save" && !lostSpot;

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      aria-label={`Slide ${viewing}`}
      data-lecture-panel=""
      className="flex min-w-0 flex-col gap-3 rounded-md focus-ring focus-visible:outline-offset-4"
    >
      <ImLostButton ref={lostRef} onClick={pressLost} checked={!!lostSpot} slide={viewing} />
      <div
        data-tools=""
        className="flex flex-col gap-3"
        onFocus={(e) => {
          toolFocus.current = e.target;
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) toolFocus.current = null;
        }}
      >
        {/* One 44 px row, always there: Save this, or once the slide has a spot, Mark the spot and (for 10 s) Undo. */}
        {active ? (
          <div data-spot-row="" className="grid animate-rise-in grid-cols-2 gap-2 select-none">
            <button
              type="button"
              onClick={onMarkButton}
              aria-pressed={marking}
              className={`${buttonSecondaryClass} ${marking ? "border-ink" : ""} ${canUndo ? "" : "col-span-2"}`}
            >
              {marking ? "Stop marking" : active.rect ? "Clear mark" : "Mark the spot"}
            </button>
            {canUndo && (
              <button type="button" onClick={undo} className={buttonSecondaryClass}>
                Undo
              </button>
            )}
          </div>
        ) : (
          <button type="button" onClick={pressSave} className={`${buttonSecondaryClass} w-full select-none`}>
            Save this
          </button>
        )}
        {/* The note box, always there. On a slide with no spot yet, saving a note records I'm lost with it. */}
        <form data-note-box="" onSubmit={saveNote} className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            aria-label={otherSlide !== null ? `Your note on slide ${otherSlide}` : "Your note"}
            placeholder="Add a note"
            rows={2}
            maxLength={NOTE_MAX}
            enterKeyHint="done"
            value={noteText}
            onChange={(e) => setDraft({ slide: noteSlide, text: e.target.value.slice(0, NOTE_MAX) })}
            onKeyDown={onNoteKeyDown}
            className={
              "block h-[66px] max-h-[114px] min-h-[66px] min-w-0 flex-1 resize-none rounded-md border border-hairline bg-surface px-3 py-2 " +
              "type-body text-ink outline-hidden placeholder:text-secondary transition-colors duration-(--dur-fast) ease-out " +
              "hover:border-strip focus:border-ink focus:shadow-[inset_0_0_0_0.5px_var(--color-ink)]"
            }
          />
          <button
            type="submit"
            aria-label="Save note"
            disabled={!canSaveNote}
            className="press focus-ring flex size-11 shrink-0 items-center justify-center rounded-md bg-ink text-surface hover:bg-ink-hover disabled:cursor-default disabled:bg-strip disabled:hover:bg-strip"
          >
            <Icon name="check" size={20} />
          </button>
        </form>
      </div>
      {/* One line under the box, always reserved: a refusal, the note's slide and length, the save, or Reconnecting…. */}
      <div data-panel-line="" className="min-h-5">
        {rejected ? (
          <p role="alert" className="flex animate-fade-in items-start gap-2 type-small text-ink">
            <Icon name="alert" size={18} className="mt-px shrink-0" />
            {rejected}
          </p>
        ) : otherSlide !== null || counter !== null ? (
          <p className="flex gap-3 type-caption text-secondary">
            {otherSlide !== null && <span>Note for slide {otherSlide}</span>}
            {counter !== null && (
              <span data-counter="" className="ml-auto">
                {counter} left
              </span>
            )}
          </p>
        ) : savedForYou ? (
          <p className="flex animate-fade-in items-center gap-2 type-small-strong text-ink">
            <span aria-hidden className="size-2.5 rounded-full border-[1.5px] border-ink" />
            Saved slide {viewing}, just for you
          </p>
        ) : (
          idle
        )}
      </div>
      {/* Always there, so a screen reader says each save, note, mark and Undo (a new line each time). */}
      <p role="status" aria-atomic="false" className="sr-only">
        {said && <span key={said.n}>{said.text}</span>}
      </p>
    </section>
  );
}
