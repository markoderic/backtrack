"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { buttonSecondaryClass } from "@/components/ButtonPrimary";
import { Icon } from "@/components/Icon";
import { ImLostButton, ignoreHeldEnter } from "@/components/ImLostButton";
import { NotebookField, isSendKey } from "@/components/NotebookField";
import { newId } from "@/lib/newId";
import { LEGACY_NOTE_MAX, cutNote, noteCounterFrom, noteLength } from "@/lib/noteLimit";
import type { Rect } from "@/lib/rect";
import { sharedTapQueue } from "@/lib/sharedQueues";
import { TapQueue, isTapLimit, type PendingTap, type QueueOp, type SendResult } from "@/lib/tapQueue";
import { markRejected } from "@/lib/tapSync";
import { useShownAgain } from "@/lib/useShownAgain";

/**
 * Undo is offered this long after a tap or after taking one back, also once the student has moved
 * to another slide ("Undo slide 7" then). The tap itself stays saved; My spots can remove it later.
 */
export const UNDO_MS = 10_000;
/**
 * A press on the checked I'm lost (or Saved for you) takes the tap back, but not this soon after
 * the press that made it: a quick second tap meant as one press records once and takes nothing back.
 */
export const UNTOGGLE_GUARD_MS = 600;
/** A tap made on this screen this recently is kept when a fresh read does not have it yet. */
const FRESH_MS = 5000;
/** The window's focus reads the rows again at most this often. */
const FOCUS_READ_MS = 2000;
/** The note to the teacher saves by itself this long after the typing pauses (and at once on blur or Enter). */
export const NOTE_SAVE_MS = 800;
/** "Saved" stays this long after the note to the teacher saved. */
const NOTE_SAVED_MS = 2000;
const LECTURE_ENDED = "This one didn't save because the lecture had ended.";
const CHANGE_FAILED = "That change didn't save.";
/** A tap the server kept turning away (login gone, or too many requests), dropped after a few tries. */
const TAP_FAILED = "This one didn't save. Try again.";
const TOO_MANY = "Too many taps. Try again in a minute.";
const TOO_MANY_LECTURE = "Too many taps in this lecture.";

type Kind = "lost" | "save";
/**
 * One of the student's rows that is not undone: its slide, kind, and the note and mark on it. The mark
 * (rect) is the one highlight a tap had before migration 0020; the page only uses it while the
 * database has no slide_marks (marks then live in their own table).
 */
export type Spot = { id: string; slide: number; kind: Kind; note?: string; rect?: Rect };

/**
 * The marks before migration 0020: one per slide, on the slide's spot (lost_taps.hl_*). add puts the
 * box on the slide's spot, or saves the slide (Save this) with it when it has none; clear takes it off.
 */
export type LegacyMarks = { add: (rect: Rect) => void; clear: (id: string) => void };

/** An Undo on offer: of a tap made here ("tap"), or of taking a tap back ("removed"). */
type UndoEntry = { key: string; type: "tap" | "removed"; kind: Kind; slide: number; ids: string[]; spots: Spot[]; at: number };

type Props = {
  lectureId: string;
  /** The slide on screen. A tap records this one. */
  viewing: number;
  /** Sends one queued op to the database. */
  send: (op: QueueOp) => Promise<SendResult>;
  /** The student's rows already saved for this lecture, or null while offline. A row without kind is lost. */
  loadOwn: () => Promise<{ id: string; slide: number; kind?: Kind; note?: string; rect?: Rect }[] | null>;
  /**
   * Called with every row that is not undone (one entry per row), whenever they change. `loaded` is
   * true once the student's rows were read from the database (before that, only what this screen made).
   */
  onSpots: (spots: Spot[], loaded: boolean) => void;
  /**
   * Called once the rows of a take back, or of its Undo, were sent (or the send stopped). The page
   * reads the marks again: 0020's trigger deletes or copies back an old highlight with the tap.
   */
  onTakenBack?: () => void;
  /** Called right after a tap or a save is recorded, with its kind. */
  onTap?: (kind: Kind) => void;
  /** Goes up each time the live connection comes back. */
  reconnects?: number;
  /**
   * Gives the page this panel's flush. flush(true) is for a lecture that is ending:
   * a refusal then sets the rejected key for the spots page. The page may wait on it.
   */
  onFlushReady?: (flush: (ending?: boolean) => Promise<void>) => void;
  /** Whether the Mark tool is on (the page owns it; the slide layer draws). The Mark button toggles it. */
  marking?: boolean;
  onMarkingChange?: (on: boolean) => void;
  /** Gives the page the marks of the time before migration 0020 (one per slide, on the tap). */
  onMarkReady?: (marks: LegacyMarks) => void;
  /**
   * Called when the student's own action makes a slide lost (I'm lost, Undo of a removal) or not
   * lost any more (Undo, pressing the checked button, a tap the database refused). The page turns
   * the slide's marks red or yellow.
   */
  onLostChange?: (slide: number, lost: boolean) => void;
  /** A message from the page to show in the line under the box (a mark that did not save). */
  notice?: { n: number; text: string } | null;
  /**
   * Called when the database refuses a send while the page is open (not in the flush
   * the page runs while leaving). Usually the lecture ended, so the page checks.
   */
  onRejected?: () => void;
  /** Shown under the buttons while there is nothing else to say (the page puts Reconnecting… here). */
  idle?: ReactNode;
  /**
   * The longest note to the teacher: 2000 once the database has migration 0020, else 140
   * (lost_taps.note's check in 0007). The page asks the database (useTeacherNoteMax).
   */
  noteMax?: number;
  /**
   * Where the note to the teacher goes on the page (the top of the notebook area). Without it, the
   * line sits at the end of this panel.
   */
  noteSlot?: HTMLElement | null;
};

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
 * `base` adds rows that are already saved, so a change made offline to one of them shows too. A row
 * taken back (undone true) and then brought back (undone false, Undo of Removed) shows again: from
 * the rows seen so far, from `known` (what the screen showed, for a read that no longer has the row),
 * or from the slide and kind the update carries. Those rows are added to `restored`.
 */
function pendingSpots(
  ops: QueueOp[],
  base: ReadonlyMap<string, Spot> = new Map(),
  known: ReadonlyMap<string, Spot> = new Map(),
  restored: Spot[] = [],
): Map<string, Spot> {
  const spots = new Map(base);
  const removed = new Map<string, Spot>();
  for (const op of ops) {
    if (op.op === "insert") {
      const t = op.tap;
      spots.set(t.id, patched({ id: t.id, slide: t.tappedOnSlide, kind: t.kind ?? "lost" }, { note: t.note, rect: t.rect }));
    } else if (op.patch.undone === true) {
      const spot = spots.get(op.id);
      if (spot) removed.set(op.id, spot);
      spots.delete(op.id);
      // Brought back and then taken back again: it is not lost after all.
      for (let i = restored.length - 1; i >= 0; i--) if (restored[i].id === op.id) restored.splice(i, 1);
    } else if (op.patch.undone === false) {
      const back = removed.get(op.id) ?? spots.get(op.id) ?? known.get(op.id) ?? (op.spot ? { id: op.id, ...op.spot } : undefined);
      if (back) {
        spots.set(op.id, back);
        removed.delete(op.id);
        restored.push(back);
      }
    } else {
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

/** The spot a slide's tools work on: its I'm lost row, or else its save. */
function spotOn(taps: ReadonlyMap<string, Spot>, slide: number): Spot | null {
  return latest(taps, slide, "lost") ?? latest(taps, slide, "save");
}

/**
 * The note to the teacher being typed: for which slide, the text so far, and whether it saves by
 * itself after a pause (typed here; a note given back after a refused tap waits for the next edit).
 */
type Draft = { slide: number; text: string; auto: boolean };

/** The draft says something the slide's I'm lost does not have yet (or the slide is not lost and the draft has words). */
function isDirty(taps: ReadonlyMap<string, Spot>, draft: Draft): boolean {
  const spot = latest(taps, draft.slide, "lost");
  const text = draft.text.trim();
  return spot ? text !== (spot.note ?? "") : text !== "";
}

/** The slides of the lost taps among refused or dropped ops. */
const lostSlidesOf = (dropped: QueueOp[]) =>
  dropped.flatMap((op) => (op.op === "insert" && (op.tap.kind ?? "lost") === "lost" ? [op.tap.tappedOnSlide] : []));

/** The second click of a double click (on the button that just took the first one's place). */
const isRepeatClick = (e: MouseEvent) => e.detail > 1;

type FocusTarget = "lost" | "panel";

/**
 * The I'm lost panel: the red I'm lost button, then Save this and the Mark tool, then a line that
 * says what just happened with Undo for 10 seconds. One tap per slide: after I'm lost the button
 * shows "Lost on slide 7"; pressing it again takes it back. Another slide shows that slide's own state.
 *
 * The note to the teacher: on a slide where the student is lost, a small "Note for the teacher" line
 * (typed straight on the page, like the notebook). It saves by itself a moment after the typing
 * pauses, and at once on Enter or when the field loses the focus: an update of the slide's I'm lost.
 * A note that ends up on a slide with no I'm lost (the tap was taken away meanwhile) records I'm lost
 * with it, in one go (a note to the teacher is an I'm lost). While the field has the focus it stays
 * with its slide when the slide changes, and saves there.
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
  onLostChange,
  onTakenBack,
  notice = null,
  onTap,
  onRejected,
  idle,
  noteMax = LEGACY_NOTE_MAX,
  noteSlot = null,
}: Props) {
  const [taps, setTaps] = useState<ReadonlyMap<string, Spot>>(new Map());
  // The rows as last shown, for the flush (a refusal gives back a note saved on a dropped tap).
  const tapsRef = useRef(taps);
  // The note to the teacher being typed. While its field has the focus it stays with its slide when the
  // slide changes, so a note typed while the teacher moves on is not lost.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [noteFocused, setNoteFocused] = useState(false);
  // Taps made on this screen, and taps taken back, less than 10 s ago: these offer Undo (by entry key).
  const [undos, setUndos] = useState<ReadonlyMap<string, UndoEntry>>(new Map());
  const undoTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // When each Undo ends (ms). Kept apart from the timers: Next hides a page it keeps alive
  // (Activity) by taking its effects down, so the timers stop; on the way back the time left is armed again.
  const undoUntil = useRef(new Map<string, number>());
  const dropUndo = useCallback((key: string) => {
    undoUntil.current.delete(key);
    clearTimeout(undoTimers.current.get(key));
    undoTimers.current.delete(key);
    setUndos((m) => {
      if (!m.has(key)) return m;
      const next = new Map(m);
      next.delete(key);
      return next;
    });
  }, []);
  // When each tap made here was made, and its slide and kind (the untoggle guard, and a fresh read).
  const madeAt = useRef(new Map<string, number>());
  const armUndo = useCallback(
    (id: string, ms: number) => {
      clearTimeout(undoTimers.current.get(id));
      undoTimers.current.set(id, setTimeout(() => dropUndo(id), ms));
    },
    [dropUndo],
  );
  // What the status line says last; each one gets a new key so it is read even if the text repeats.
  const [said, setSaid] = useState<{ n: number; text: string } | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  // A quiet "Saved" by the note to the teacher after it saved (2 s).
  const [noteSaved, setNoteSaved] = useState(0);
  useEffect(() => {
    if (noteSaved === 0) return;
    const timer = setTimeout(() => setNoteSaved(0), NOTE_SAVED_MS);
    return () => clearTimeout(timer);
  }, [noteSaved]);
  const counterId = useId();
  const [fatal, setFatal] = useState<Error | null>(null);

  const lostRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
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
  const onLostChangeRef = useRef(onLostChange);
  const onTakenBackRef = useRef(onTakenBack);
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
    onLostChangeRef.current = onLostChange;
    onTakenBackRef.current = onTakenBack;
  });

  // Made on first use, in the browser, never while rendering: the queue reads localStorage.
  // One queue per lecture for the whole page (sharedQueues), shared with My spots.
  const queue = useCallback(() => (queueRef.current ??= sharedTapQueue(lectureId)), [lectureId]);

  const say = useCallback((text: string) => setSaid((s) => ({ n: (s?.n ?? 0) + 1, text })), []);

  const dropTaps = useCallback((ids: Iterable<string>) => {
    const gone = new Set(ids);
    for (const id of gone) takenBack.current.add(id);
    setTaps((prev) => {
      const next = new Map(prev);
      for (const id of gone) next.delete(id);
      return next;
    });
    // An Undo for a tap that is gone has nothing left to undo.
    setUndos((m) => {
      const stale = [...m.values()].filter((e) => e.type === "tap" && e.ids.every((id) => gone.has(id)));
      if (stale.length === 0) return m;
      const next = new Map(m);
      for (const e of stale) {
        next.delete(e.key);
        undoUntil.current.delete(e.key);
      }
      return next;
    });
    return gone;
  }, []);

  /** Tells the page which of these slides have no I'm lost left once `gone` is taken out. */
  const lostGone = useCallback((slides: Iterable<number>, gone: ReadonlySet<string>) => {
    for (const slide of new Set(slides)) {
      const left = [...tapsRef.current.values()].some((t) => t.slide === slide && t.kind === "lost" && !gone.has(t.id));
      if (!left) onLostChangeRef.current?.(slide, false);
    }
  }, []);

  /**
   * Rows a queued Undo of Removed brings back that this screen is not showing yet (a reload while it
   * waits): their slides are lost again, so the page turns the marks there red.
   */
  const tellRestored = useCallback((restored: Spot[]) => {
    for (const spot of restored) {
      if (spot.kind === "lost" && !tapsRef.current.has(spot.id)) onLostChangeRef.current?.(spot.slide, true);
    }
  }, []);

  /**
   * A note on a new tap that did not save comes back into the box, so it is not lost: sent with the
   * tap, or saved on it after (that update is dropped with the tap).
   */
  const keepNotes = useCallback((dropped: QueueOp[]) => {
    for (const op of dropped) {
      if (op.op !== "insert") continue;
      const text = op.tap.note || tapsRef.current.get(op.tap.id)?.note;
      if (!text) continue;
      const slide = op.tap.tappedOnSlide;
      // Not saved by itself again (the database just said no): it waits for the student's next edit.
      setDraft((d) => d ?? { slide, text, auto: false });
      return;
    }
  }, []);

  const fail = useCallback((e: unknown) => {
    if (mounted.current) setFatal(e instanceof Error ? e : new Error(String(e)));
  }, []);

  // The latest commitNote (it reads this render's rows and draft), for timers, cleanups and the flush.
  const commitRef = useRef<(focused?: boolean) => boolean>(() => false);
  const flush = useCallback(async (ending = false) => {
    // The lecture is ending: a note to the teacher still being typed goes with the rest.
    if (ending) commitRef.current();
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
        lostGone(lostSlidesOf(gaveUp), lost);
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
      lostGone(lostSlidesOf(refused), gone);
      keepNotes(refused);
      if (gone.size > 0 && !tooMany) refusedTap.current = true;
      const capped = refused.some((op) => limitedOps.current.get(op) === "capped");
      setRejected(tooMany ? (capped ? TOO_MANY_LECTURE : TOO_MANY) : gone.size > 0 ? LECTURE_ENDED : CHANGE_FAILED);
      if (!ending && !tooMany) onRejectedRef.current?.();
    } catch (e) {
      fail(e);
    }
  }, [queue, lectureId, dropTaps, lostGone, keepNotes, fail]);

  useEffect(() => {
    flushRef.current = flush;
    onFlushReady?.(flush);
  }, [onFlushReady, flush]);

  /**
   * Reads the student's rows. The first read adds them to what this screen shows. A later one
   * (`fresh`: the page is shown again, e.g. back from My spots, where a spot or its mark may have
   * been removed) replaces them: what the database says, with what still waits in the queue on top,
   * and a tap made here a moment ago that the read may not have yet.
   */
  const loadSaved = useCallback(
    async (fresh = false) => {
      if ((loaded.current && !fresh) || loading.current) return;
      loading.current = true;
      try {
        const rows = await loadOwnRef.current();
        if (!mounted.current || rows === null) return; // offline: try again on the next trigger
        const first = !loaded.current;
        loaded.current = true;
        const saved = new Map<string, Spot>();
        for (const r of rows) {
          if (takenBack.current.has(r.id)) continue;
          const spot: Spot = { id: r.id, slide: r.slide, kind: r.kind ?? "lost" };
          if (r.note) spot.note = r.note;
          if (r.rect) spot.rect = r.rect;
          saved.set(r.id, spot);
        }
        // Changes still in the queue are newer than what the database had. A row brought back by a
        // queued Undo of Removed shows as the screen had it, even though the read no longer has it.
        const restored: Spot[] = [];
        const withQueued = pendingSpots(queue().pending(), saved, tapsRef.current, restored);
        tellRestored(restored);
        if (first) {
          setTaps((prev) => {
            const next = new Map(prev);
            // A row already shown here is the newer one (made or changed on this screen).
            for (const [id, spot] of withQueued) if (!next.has(id) && !takenBack.current.has(id)) next.set(id, spot);
            return next;
          });
          return;
        }
        const now = Date.now();
        const next = new Map<string, Spot>();
        for (const [id, spot] of tapsRef.current) {
          const made = madeAt.current.get(id);
          if (!withQueued.has(id) && made !== undefined && now - made < FRESH_MS) next.set(id, spot);
        }
        for (const [id, spot] of withQueued) if (!takenBack.current.has(id)) next.set(id, spot);
        setTaps(next);
        // An Undo for a tap that is not there any more (removed in My spots) goes with it.
        setUndos((m) => {
          const stale = [...m.values()].filter((e) => e.type === "tap" && !e.ids.some((id) => next.has(id)));
          if (stale.length === 0) return m;
          const kept = new Map(m);
          for (const e of stale) {
            kept.delete(e.key);
            undoUntil.current.delete(e.key);
          }
          return kept;
        });
      } catch (e) {
        fail(e);
      } finally {
        loading.current = false;
      }
    },
    [fail, queue, tellRestored],
  );

  // On mount: show the taps left over from the last visit, send them, and load the saved rows.
  useEffect(() => {
    mounted.current = true;
    const timers = undoTimers.current;
    // Shown again after being hidden: each Undo gets the time it had left, or goes if that ran out.
    for (const [key, until] of undoUntil.current) {
      const left = until - Date.now();
      if (left > 0) armUndo(key, left);
      else dropUndo(key);
    }
    // Taps left from the last visit get their dots back (read after the first render, as storage is only there in the browser).
    void Promise.resolve().then(() => {
      if (!mounted.current) return;
      const restored: Spot[] = [];
      const left = pendingSpots(queue().pending(), new Map(), tapsRef.current, restored);
      tellRestored(restored);
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
      void loadSaved(true);
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
  }, [queue, flush, loadSaved, armUndo, dropUndo, tellRestored]);

  useEffect(() => {
    if (reconnects === 0) return;
    void flush();
    void loadSaved(true);
  }, [reconnects, flush, loadSaved]);

  // Back on screen (Next kept the page alive while My spots was open, or the tab was in the
  // background): read the rows again, so a spot or mark removed there is gone here too.
  useShownAgain(() => {
    void flush();
    void loadSaved(true);
  });
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadSaved(true);
    };
    // My spots in a second window beside this one: back in this window, read again (at most every 2 s).
    let lastFocus = 0;
    const onFocus = () => {
      if (Date.now() - lastFocus < FOCUS_READ_MS) return;
      lastFocus = Date.now();
      void loadSaved(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadSaved]);

  useEffect(() => {
    tapsRef.current = taps;
    onSpotsRef.current([...taps.values()], loaded.current);
  }, [taps]);

  // Another slide on screen: a note to the teacher with nothing new in it, and not being typed in,
  // follows the new slide. Undo stays for its 10 seconds and then names its slide.
  const [shownSlide, setShownSlide] = useState(viewing);
  if (shownSlide !== viewing) {
    setShownSlide(viewing);
    if (draft && !noteFocused && !isDirty(taps, draft)) setDraft(null);
  }

  const lostSpot = latest(taps, viewing, "lost");
  const saveSpot = latest(taps, viewing, "save");

  // The Undo on offer: the newest one for the slide on screen, else the newest one at all.
  const entries = [...undos.values()].sort((a, b) => a.at - b.at);
  const undoEntry = entries.filter((e) => e.slide === viewing).at(-1) ?? entries.at(-1) ?? null;

  /** Offers Undo for 10 s. It takes the place of an older Undo for the same slide and kind. */
  function offerUndo(entry: Omit<UndoEntry, "key" | "at">) {
    const key = newId();
    for (const e of undos.values()) if (e.slide === entry.slide && e.kind === entry.kind) dropUndo(e.key);
    setUndos((m) => {
      const next = new Map(m);
      for (const [k, e] of m) if (e.slide === entry.slide && e.kind === entry.kind) next.delete(k);
      return next.set(key, { ...entry, key, at: Date.now() });
    });
    undoUntil.current.set(key, Date.now() + UNDO_MS);
    armUndo(key, UNDO_MS);
  }

  function record(kind: Kind, slide = viewing, note?: string, rect?: Rect) {
    const id = newId();
    // Recorded and queued first; everything you see follows.
    const tap: PendingTap = { id, tappedOnSlide: slide, tappedAt: new Date().toISOString() };
    if (kind === "save") tap.kind = "save";
    if (note) tap.note = note;
    if (rect) tap.rect = rect;
    const wasLost = !!latest(taps, slide, "lost");
    queue().enqueue(tap);
    madeAt.current.set(id, Date.now());
    const spot: Spot = { id, slide, kind };
    if (note) spot.note = note;
    if (rect) spot.rect = rect;
    setTaps((prev) => new Map(prev).set(id, spot));
    setRejected(null);
    offerUndo({ type: "tap", kind, slide, ids: [id], spots: [spot] });
    say(`Saved slide ${slide}${kind === "save" ? ", just for you" : ""}.${note ? " Note saved." : ""}`);
    void flush();
    onTap?.(kind);
    if (kind === "lost" && !wasLost) onLostChangeRef.current?.(slide, true);
  }

  /** True right after the press that made this slide's spot of that kind (a quick second tap). */
  function justMade(spot: Spot): boolean {
    const made = madeAt.current.get(spot.id);
    return made !== undefined && Date.now() - made < UNTOGGLE_GUARD_MS;
  }

  /**
   * Takes back the slide's I'm lost (or its save): its rows are marked undone, as Undo does, and
   * "Removed" offers Undo for 10 s. Sent as an update even when the tap has not gone out yet, so
   * Undo can bring it back with another update.
   */
  function takeBack(kind: Kind) {
    // A note to the teacher still being typed on this slide goes on the tap first (so Undo brings it back).
    const typed = kind === "lost" && draft?.slide === viewing && isDirty(taps, draft) ? draft.text.trim() : null;
    if (typed !== null) commitNote();
    if (kind === "lost" && draft?.slide === viewing) setDraft(null);
    const rows = [...taps.values()]
      .filter((t) => t.slide === viewing && t.kind === kind)
      .map((t) => (typed !== null && t.kind === "lost" ? patched(t, { note: typed }) : t));
    if (rows.length === 0) return;
    for (const t of rows) queue().update(t.id, { undone: true });
    const gone = dropTaps(rows.map((t) => t.id));
    offerUndo({ type: "removed", kind, slide: viewing, ids: rows.map((t) => t.id), spots: rows });
    if (kind === "lost") lostGone([viewing], gone);
    say("Removed.");
    void flush().then(() => onTakenBackRef.current?.());
  }

  // One tap per slide: I'm lost on a lost slide (the checked button) takes it back instead.
  function pressLost() {
    if (lostSpot) {
      if (!justMade(lostSpot)) takeBack("lost");
      return;
    }
    record("lost");
  }

  function pressSave(e: MouseEvent) {
    if (isRepeatClick(e)) return;
    if (saveSpot) {
      if (!justMade(saveSpot)) takeBack("save");
      return;
    }
    // A lost slide is in My spots already.
    if (lostSpot) return;
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
    const entry = undoEntry;
    if (isRepeatClick(e) || !entry) return;
    dropUndo(entry.key);
    if (entry.type === "tap") {
      // Every row of that kind on its slide (a slide can hold two from before this screen took one per slide).
      const ids = [...taps.values()].filter((t) => t.slide === entry.slide && t.kind === entry.kind).map((t) => t.id);
      for (const id of ids) {
        // An unsent tap is simply taken out. A sent one gets an update that marks it undone.
        if (!queue().cancel(id)) queue().update(id, { undone: true });
      }
      const gone = dropTaps(ids);
      if (entry.kind === "lost") {
        lostGone([entry.slide], gone);
        // A note to the teacher on it goes too: kept, it would make the slide lost again.
        setDraft((d) => (d?.slide === entry.slide ? null : d));
      }
    } else {
      // Taken back a moment ago: the same rows come back (an update each), with their note and mark.
      for (const spot of entry.spots) {
        const hint: { slide: number; kind: Kind; note?: string } = { slide: spot.slide, kind: spot.kind };
        if (spot.note) hint.note = spot.note;
        queue().update(spot.id, { undone: false }, hint);
        takenBack.current.delete(spot.id);
      }
      const wasLost = !!latest(taps, entry.slide, "lost");
      setTaps((prev) => {
        const next = new Map(prev);
        for (const spot of entry.spots) next.set(spot.id, spot);
        return next;
      });
      if (entry.kind === "lost" && !wasLost) onLostChangeRef.current?.(entry.slide, true);
    }
    say("Undone.");
    // Undo was pressed on purpose: I'm lost takes the focus.
    focusNext.current = "lost";
    void flush().then(() => {
      if (entry.type === "removed") onTakenBackRef.current?.();
    });
  }

  // The note to the teacher works on the slide its draft is for, else on the slide on screen.
  const noteSlide = draft?.slide ?? viewing;
  const noteSpot = latest(taps, noteSlide, "lost");
  const noteText = draft ? draft.text : (noteSpot?.note ?? "");
  // Shown on a slide where the student is lost, and while a note is being typed (wherever its slide).
  const showNote = draft !== null || !!lostSpot;

  /**
   * Saves the note to the teacher being typed now: an update of the slide's I'm lost, or, if the slide
   * has none (any more), an I'm lost with the note. Returns whether anything was queued.
   */
  function commitNote(focused = noteFocused): boolean {
    if (!draft) return false;
    const done = draft;
    if (!isDirty(taps, done)) {
      if (!focused && done.slide !== viewing) setDraft(null);
      else if (done.auto) setDraft({ ...done, auto: false });
      return false;
    }
    const text = done.text.trim();
    const spot = latest(taps, done.slide, "lost");
    if (spot) {
      change(spot, { note: text });
      say(text ? "Note saved." : "Note removed.");
    } else {
      // Not lost there (any more): the note is an I'm lost with the note, in one go.
      record("lost", done.slide, text);
    }
    setNoteSaved((n) => n + 1);
    // The text stays as typed (spaces and all) while the field is in use; it is clean now.
    setDraft((d) => (d === done ? (focused ? { ...done, auto: false } : null) : d));
    return true;
  }
  useEffect(() => {
    commitRef.current = commitNote;
  });

  // Saves by itself once the typing pauses.
  useEffect(() => {
    if (!draft?.auto) return;
    const timer = setTimeout(() => commitRef.current(), NOTE_SAVE_MS);
    return () => clearTimeout(timer);
  }, [draft]);

  // The panel goes (Next hides the page, or the lecture screen closes): a note being typed is saved first.
  useEffect(
    () => () => {
      if (commitRef.current()) void flushRef.current();
    },
    [],
  );

  function onNoteValue(value: string) {
    setDraft({ slide: noteSlide, text: cutNote(value, noteMax), auto: true });
  }

  // Enter saves now (Shift+Enter is a new line).
  function onNoteKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (isSendKey(e)) {
      e.preventDefault();
      commitNote();
    }
  }

  function onNoteFocus() {
    setNoteFocused(true);
    // The field keeps its slide while it has the focus, even if the teacher moves on.
    if (!draft) setDraft({ slide: viewing, text: noteText, auto: false });
  }

  function onNoteBlur() {
    setNoteFocused(false);
    if (commitNote(false)) return;
    // Nothing new: the line goes back to the slide on screen.
    setDraft(null);
  }

  // The Mark tool, always there: on, the slide takes drags (each one a mark); off again with a second press.
  function onMarkButton(e: MouseEvent) {
    if (isRepeatClick(e)) return;
    onMarkingChangeRef.current?.(!marking);
  }

  // Before migration 0020 the page keeps one mark per slide on the slide's spot (lost_taps.hl_*).
  useEffect(() => {
    onMarkReady?.({
      add: (rect) => {
        const spot = spotOn(taps, viewing);
        if (spot) {
          change(spot, { rect });
          say("Marked.");
        } else {
          // A slide with no spot yet is saved with the mark (just for the student).
          record("save", viewing, undefined, rect);
        }
      },
      clear: (id) => {
        const spot = taps.get(id);
        if (!spot) return;
        change(spot, { rect: null });
        say("Mark deleted.");
      },
    });
  });

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

  const counter = draft && noteLength(draft.text) >= noteCounterFrom(noteMax) ? noteMax - noteLength(draft.text) : null;
  const otherSlide = draft && draft.slide !== viewing ? draft.slide : null;
  // What the Undo line says, and its button: "Undo" for the slide on screen, "Undo slide 7" for another.
  const undoHere = undoEntry?.slide === viewing;
  const undoText = !undoEntry
    ? null
    : undoEntry.type === "removed"
      ? "Removed"
      : `Saved${undoHere ? ` slide ${undoEntry.slide}` : ""}${undoEntry.kind === "save" ? ", just for you" : ""}`;
  const message = rejected ?? notice?.text ?? null;
  // Remembers which tool has focus, so focus can go to the panel when that tool goes away.
  const trackFocus = {
    onFocus: (e: FocusEvent<HTMLElement>) => {
      toolFocus.current = e.target;
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) toolFocus.current = null;
    },
  };

  // The note to the teacher: a red dot and a line typed straight on the page.
  const noteLine = (
    <div data-teacher-note="" className="flex min-w-0 animate-fade-in items-start gap-2" {...trackFocus}>
      <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-lost" />
      <NotebookField
        grow
        rows={1}
        maxRows={4}
        aria-label={otherSlide !== null ? `Note for the teacher, slide ${otherSlide}` : "Note for the teacher"}
        aria-describedby={counter !== null ? counterId : undefined}
        placeholder="Note for the teacher"
        enterKeyHint="done"
        value={noteText}
        onValue={onNoteValue}
        onKeyDown={onNoteKeyDown}
        onFocus={onNoteFocus}
        onBlur={onNoteBlur}
        className="flex-1"
      />
      {/* A fixed width, so "Saved" coming and going never changes the field's width. */}
      <span className="flex min-h-6 w-16 shrink-0 items-center justify-end gap-2 type-caption text-secondary">
        {otherSlide !== null && <span data-note-slide="">Slide {otherSlide}</span>}
        {counter !== null ? (
          <span id={counterId} data-counter="">
            {counter} left
          </span>
        ) : (
          noteSaved > 0 && (
            // Seen, not read out twice: the status line already says it.
            <span key={noteSaved} aria-hidden data-note-saved="" className="animate-fade-in">
              Saved
            </span>
          )
        )}
      </span>
    </div>
  );

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      aria-label={`Slide ${viewing}`}
      data-lecture-panel=""
      className="flex min-w-0 flex-col gap-3 rounded-md focus-ring focus-visible:outline-offset-4"
    >
      <ImLostButton ref={lostRef} onClick={pressLost} checked={!!lostSpot} slide={viewing} />
      <div data-tools="" className="flex flex-col gap-3" {...trackFocus}>
        {/* One 44 px row, always there: Save this (a toggle: Saved for you) and the Mark tool. */}
        <div data-spot-row="" className="grid grid-cols-2 gap-2 select-none">
          <button
            type="button"
            onClick={pressSave}
            onKeyDown={ignoreHeldEnter}
            aria-pressed={!!saveSpot}
            // A lost slide is in My spots already: nothing to save until the I'm lost is taken back.
            disabled={!!lostSpot && !saveSpot}
            data-save=""
            className={`${buttonSecondaryClass} ${saveSpot ? "border-ink" : ""}`}
          >
            {saveSpot && <span aria-hidden className="size-2.5 shrink-0 rounded-full border-[1.5px] border-ink" />}
            {saveSpot ? "Saved for you" : "Save this"}
          </button>
          <button
            type="button"
            onClick={onMarkButton}
            aria-pressed={marking}
            data-mark-tool=""
            className={marking ? markToolOnClass : buttonSecondaryClass}
          >
            {/* A swatch of the highlighter: red on a slide where the student is lost, else yellow. */}
            <span aria-hidden data-swatch={lostSpot ? "lost" : "save"} className={`h-3 w-4 shrink-0 rounded-xs ${lostSpot ? "bg-mark-lost" : "bg-mark"}`} />
            Mark
          </button>
        </div>
      </div>
      {/* One 40 px line under the buttons, always reserved: a message, what was saved, or Reconnecting…, with
          Undo at its end for 10 s after a tap or after taking one back (on any slide). */}
      <div data-panel-line="" className="flex min-h-10 items-center gap-3" {...trackFocus}>
        <div className="min-w-0 flex-1">
          {message ? (
            <p role="alert" className="flex animate-fade-in items-start gap-2 type-small text-ink">
              <Icon name="alert" size={18} className="mt-px shrink-0" />
              {message}
            </p>
          ) : idle ? (
            idle
          ) : undoText ? (
            <p key={undoEntry?.key} aria-hidden data-undo-line="" className="flex animate-rise-in items-center gap-2 type-small-strong text-ink">
              {undoEntry?.type === "removed" ? null : undoEntry?.kind === "lost" ? (
                <span className="size-2.5 shrink-0 rounded-full bg-lost" />
              ) : (
                <span className="size-2.5 shrink-0 rounded-full border-[1.5px] border-ink" />
              )}
              <span className="truncate">{undoText}</span>
            </p>
          ) : null}
        </div>
        {undoEntry && (
          <button
            key={undoEntry.key}
            type="button"
            onClick={undo}
            data-undo=""
            className="press focus-ring flex h-10 shrink-0 animate-fade-in items-center rounded-md border border-hairline bg-surface px-3 type-button whitespace-nowrap text-ink hover:border-strip hover:bg-bg"
          >
            {undoHere ? "Undo" : `Undo slide ${undoEntry.slide}`}
          </button>
        )}
      </div>
      {/* Always there, so a screen reader says each save, note, mark and Undo (a new line each time). */}
      <p role="status" aria-atomic="false" className="sr-only">
        {said && <span key={said.n}>{said.text}</span>}
      </p>
      {showNote && !noteSlot && noteLine}
      {showNote && noteSlot && createPortal(noteLine, noteSlot)}
    </section>
  );
}

/** The Mark tool while it is on: the secondary button's shape, filled with ink. */
const markToolOnClass =
  "press focus-ring inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-md border border-ink bg-ink px-3 " +
  "type-button whitespace-nowrap text-surface hover:bg-ink-hover";
