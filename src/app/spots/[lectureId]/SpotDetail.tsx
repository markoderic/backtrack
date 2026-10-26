"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { buttonPrimarySmallClass, buttonSecondaryClass } from "@/components/ButtonPrimary";
import { Icon } from "@/components/Icon";
import { NotebookField, SavedState, isSendKey } from "@/components/NotebookField";
import { makeSend } from "@/lib/lostTapApi";
import { NOTEBOOK_MAX, type NoteState } from "@/lib/notebookApi";
import type { Rect } from "@/lib/rect";
import { LEGACY_NOTE_MAX, cutNote, noteCounterFrom, noteLength } from "@/lib/noteLimit";
import { sharedTapQueue } from "@/lib/sharedQueues";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { QueueOp } from "@/lib/tapQueue";
import { HighlightLayer, type ShownMark } from "../../l/[lectureId]/HighlightLayer";
import { markLookClass, useSlideSample, type MarkTone } from "@/lib/slideTone";
import { MarkPopover } from "../../l/[lectureId]/MarkPopover";
import type { Spot } from "../group";
import { formatClock } from "../time";

export type { Spot } from "../group";

/** What a slide in My spots is: an I'm lost, a save, only marks, or only a notebook note. */
export type SpotKindShown = "lost" | "save" | "mark" | "note";

/** The marks of the slide in the detail (migration 0020), and how to change them. */
export type DetailMarks = {
  /** The slide's marks, colored as the slide is (red where the student is lost). */
  list: ShownMark[];
  add: (rect: Rect) => void;
  remove: (id: string) => void;
  setNote: (id: string, text: string) => void;
  /** A mark that did not save, said under the buttons. */
  problem: string | null;
};

/** The student's notebook note of the slide, saved by itself (useNotebook on the page). */
export type DetailNotebook = { text: string; state: NoteState | null; onChange: (text: string) => void; onFlush: () => void };

type Props = {
  lectureId: string;
  /** The slide's I'm lost or save (its rows), or null for a slide with only marks or a notebook note. */
  spot: Spot | null;
  /** The slide, when there is no spot (a slide with only marks or a note). */
  slideNumber?: number;
  /** What the slide is, when there is no spot: "mark" (only marks) or "note" (only a notebook note). */
  kind?: "mark" | "note";
  /** The first line of the spot's slide, for the heading. */
  firstLine?: string;
  /** How many different students are lost on the spot's slide. */
  students: number;
  /**
   * Only used to stop the next arrow on the last slide, once the lecture has ended. It is never
   * shown, and it is null while the lecture is live (the page never gets the total then, D10).
   */
  slideCount: number | null;
  /** The signed image url of a slide (one set for the whole page), undefined until it is known. */
  urlFor: (n: number) => string | undefined;
  /**
   * The course's time for students to see the slides is over: the database no longer gives this
   * student the slides, so the page says so in their place. The notes and the spot stay.
   */
  expired?: boolean;
  /** Told which slide is on screen, so the page preloads the next one. */
  onViewingChange?: (n: number) => void;
  /** Where keyboard focus goes when the spot opens: the heading, or the spot arrow that was used. */
  focusOnOpen?: "heading" | "prev" | "next";
  /**
   * The lecture's live slide while it is live. Browsing stops there, never past it (D10):
   * a student only knows the slides up to the live one. Null once the lecture has ended.
   */
  liveSlide?: number | null;
  /** Called after the note to the teacher was saved (null: no note any more). */
  onNoteSaved: (note: string | null) => void;
  /** The longest note to the teacher: 2000 once the database has migration 0020, else 140 (useTeacherNoteMax). */
  noteMax?: number;
  /**
   * The slide's marks once the database has migration 0020 (several, each with a note). Without it
   * (before 0020) a spot has its one mark on its row: Mark the spot and Clear mark.
   */
  marks?: DetailMarks | null;
  /** The slide's notebook note (any spot). Without it, no notebook (before the page has one). */
  notebook?: DetailNotebook | null;
  /** Called after the spot's one mark (before 0020) was saved (a box) or cleared (null). */
  onHighlightSaved?: (rect: Rect | null) => void;
  /**
   * Remove. "tap": the I'm lost or save was taken back here (its rows are marked undone, like Undo;
   * the marks and notes stay). "all": a slide with only marks or a note: the page deletes them.
   */
  onRemoved?: (what: "tap" | "all") => void;
  onBack: () => void;
  /** Open the spot before or after this one in the list. Missing at either end. */
  onPrevSpot?: () => void;
  onNextSpot?: () => void;
};

/** The line about other students, or null when there is nothing to say. */
export function countLine(kind: SpotKindShown, students: number): string | null {
  if (kind === "lost") {
    if (students >= 2) return `${students} people got lost here`;
    if (students === 1) return "Only you got lost here";
    return null;
  }
  if (students >= 2) return `${students} people got lost on this slide`;
  if (students === 1) return "1 person got lost on this slide";
  return null;
}

/** "Lost at 10:41", "Saved for later at 10:52", "You marked this" or "Your notes". */
export function whenLine(spot: { kind: SpotKindShown; tappedAt?: string }): string {
  if (spot.kind === "mark") return "You marked this";
  if (spot.kind === "note") return "Your notes";
  const at = formatClock(spot.tappedAt ?? "");
  const what = spot.kind === "lost" ? "Lost" : "Saved for later";
  return at ? `${what} at ${at}` : what;
}

/**
 * The look of a mark in My spots, as on the live screen: yellow, or red where the student is lost, as a
 * highlighter on a light part of the slide and a glow on a dark part (lib/slideTone), no border.
 */
export function highlightClass(kind: "lost" | "save", tone: MarkTone = "light"): string {
  return `rounded-xs ${markLookClass(kind, tone)}`;
}

/** The small dot that says what a slide is, as in the live screen's strip. */
export function KindDot({ kind, className = "" }: { kind: SpotKindShown; className?: string }) {
  const look =
    kind === "lost"
      ? "bg-lost"
      : kind === "mark"
        ? "border-[1.5px] border-ink bg-mark"
        : kind === "note"
          ? "bg-ink"
          : "border-[1.5px] border-ink bg-bg";
  return <span aria-hidden data-kind-dot={kind} className={`inline-block size-2.5 shrink-0 rounded-full ${look} ${className}`} />;
}

/** Said in place of the slide once the course's time for students to see it is over. */
export const NO_LONGER_AVAILABLE = "This slide is no longer available.";

const NO_HIGHLIGHT = { hl_x: null, hl_y: null, hl_w: null, hl_h: null };

/**
 * What sits above and below the slide in one column, so the slide is sized to leave the buttons on
 * screen (header 64, top 8, the number and title 76, gaps, the arrows row 44, the buttons, bottom 24).
 * Phone: the buttons take two rows (352). From 640: one row (300). From 1024 the buttons and the notes
 * sit beside the slide, so only the header, title and arrows count (236).
 */
const SPOT_ROOM = "[--spot-room:352px] sm:[--spot-room:300px] lg:[--spot-room:236px]";
const WIDE = 16 / 9;

/** 36 px icon buttons (a 44 px hit area on a touch screen), for browsing the slides. */
const iconButton =
  "press touch-target relative flex size-9 shrink-0 items-center justify-center rounded-md text-ink hover:bg-surface focus-ring " +
  "disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent";

/** The 44 px white back arrow at the top left (spot → the lecture's list → all lectures). */
export const backButtonClass = `${buttonSecondaryClass} size-11 shrink-0 px-0`;

/** The note to the teacher saves by itself this long after the typing pauses. */
export const TEACHER_NOTE_SAVE_MS = 800;

function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex animate-fade-in items-center gap-2 type-small text-ink">
      <Icon name="alert" size={18} />
      {children}
    </p>
  );
}

/**
 * One spot: its slide, how many got lost on it, its marks and notes. Everything saves by itself:
 *
 * - the marks (migration 0020): drawn as on the live screen (several, highlighter yellow or red). Mark
 *   turns on drawing; a mark opens a small popover with its own note and Delete.
 * - the note to the teacher, on a lost spot: a line typed on the page, saved a moment after typing
 *   stops (and at once on Enter or when the field loses the focus).
 * - the notebook note of the slide: typed on the page like the live screen's notebook.
 * - Remove (asked once): takes back the I'm lost or save (the marks turn yellow and stay, as do the
 *   notes); a slide with only marks or a note loses them.
 *
 * Every button stays on screen without scrolling: the slide is sized to the window's height, and from
 * 1024 px the buttons and notes sit beside it. While the lecture is live, Back to lecture (black) goes
 * back into class.
 */
export function SpotDetail({
  lectureId,
  spot,
  slideNumber: slideProp,
  kind: kindProp = "mark",
  firstLine,
  students,
  slideCount,
  urlFor,
  expired = false,
  onViewingChange,
  focusOnOpen,
  liveSlide = null,
  onNoteSaved,
  noteMax = LEGACY_NOTE_MAX,
  marks = null,
  notebook = null,
  onHighlightSaved,
  onRemoved,
  onBack,
  onPrevSpot,
  onNextSpot,
}: Props) {
  const slideNumber = spot?.slideNumber ?? slideProp ?? 1;
  const kind: SpotKindShown = spot?.kind ?? kindProp;
  const lost = kind === "lost";
  // The slide on screen. Browsing moves this; the spot stays on its slide.
  const [viewing, setViewing] = useState(slideNumber);
  // The slide's own shape, from the image once it loads.
  const [ratio, setRatio] = useState(WIDE);
  const url = expired ? undefined : urlFor(viewing);
  // The slide measured, so each mark shows on it (a glow on a dark part, the highlighter on a light one).
  const sample = useSlideSample(url);
  // While the lecture is live, the last slide a student may see is the live one.
  const lastSlide = liveSlide ?? slideCount ?? slideNumber;
  const onViewingRef = useRef(onViewingChange);
  useEffect(() => {
    onViewingRef.current = onViewingChange;
  });
  useEffect(() => {
    onViewingRef.current?.(viewing);
  }, [viewing]);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  // Keyboard focus survives the swap to this spot: the arrow that was used (if it still works), else the heading.
  useEffect(() => {
    const arrow = focusOnOpen === "prev" ? prevRef.current : focusOnOpen === "next" ? nextRef.current : null;
    if (arrow && !arrow.disabled) arrow.focus();
    else if (focusOnOpen) headingRef.current?.focus();
  }, [focusOnOpen]);

  const imageRef = useRef<HTMLImageElement>(null);
  const markButtonRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const counterId = useId();

  const [rect, setRect] = useState<Rect | null>(spot?.rect ?? null);
  // Marking is on: before 0020 the slide takes one drag, saved when it ends; after, every drag adds a mark.
  const [marking, setMarking] = useState(false);
  const [savingMark, setSavingMark] = useState(false);
  const [markError, setMarkError] = useState(false);
  // The mark whose popover is open (0020), and whether it was opened with the keyboard.
  const [selected, setSelected] = useState<{ id: string; keyboard: boolean } | null>(null);
  const [said, setSaid] = useState<{ n: number; text: string } | null>(null);
  const say = (text: string) => setSaid((s) => ({ n: (s?.n ?? 0) + 1, text }));
  // The marks belong to the slide of the spot, so they only show and change there.
  const onSpotSlide = viewing === slideNumber;
  if ((marking || selected) && !onSpotSlide) {
    setMarking(false);
    setSelected(null);
  }

  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState(false);
  const confirmShown = useRef(false);
  // The confirm row takes focus on Keep it; going back puts it on Remove again.
  useEffect(() => {
    if (confirmRemove) keepRef.current?.focus();
    else if (confirmShown.current) removeRef.current?.focus();
    confirmShown.current = confirmRemove;
  }, [confirmRemove]);

  /**
   * Updates rows of this spot, then checks every one of them came back changed:
   * update(...).select("id") so a row the database refused (no error, no row) is not taken for a success.
   */
  async function change(ids: string[], patch: Record<string, number | string | boolean | null>): Promise<boolean> {
    const { data, error } = await createBrowserSupabase().from("lost_taps").update(patch).in("id", ids).select("id");
    return !error && !!data && data.length === ids.length;
  }

  // The note to the teacher (a lost spot): typed on the page, saved by itself. It goes through the
  // lecture's tap queue (shared with the live screen, kept on the device until it is sent), so an
  // offline note is never lost and never crosses a note sent from the live screen.
  const [note, setNote] = useState(spot?.note ?? "");
  const [noteState, setNoteState] = useState<NoteState | null>(null);
  const spotRef = useRef(spot);
  const onNoteSavedRef = useRef(onNoteSaved);
  useEffect(() => {
    spotRef.current = spot;
    onNoteSavedRef.current = onNoteSaved;
  });
  // The text not queued yet, and the pause before it is.
  const noteDirty = useRef<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitNoteRef = useRef<() => Promise<void>>(async () => {});

  async function commitNote() {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = null;
    const typed = noteDirty.current;
    const s = spotRef.current;
    if (typed === null || !s) return;
    noteDirty.current = null;
    const next = typed.trim();
    // A note goes on the main row; an emptied note clears every note on the slide's rows.
    const ids = next === "" ? s.ids : [s.id];
    const queue = sharedTapQueue(lectureId);
    for (const id of ids) queue.update(id, { note: next });
    setNoteState("saving");
    const mine = (op: QueueOp) => op.op === "update" && ids.includes(op.id) && op.patch.note === next;
    let result;
    try {
      result = await queue.flush(makeSend(createBrowserSupabase(), lectureId));
    } catch {
      result = { sent: 0, rejected: [] as QueueOp[] };
    }
    if (result.rejected.some(mine) || result.gaveUp?.some(mine)) {
      // Refused: kept here, and sent again with the next change, Enter or blur.
      noteDirty.current ??= typed;
      setNoteState("failed");
      return;
    }
    // Still waiting (offline): it is on the device and goes with the next flush (here or on the live screen).
    if (queue.pending().some(mine)) {
      setNoteState("offline");
      return;
    }
    onNoteSavedRef.current(next === "" ? null : next);
    setNoteState("saved");
  }
  useEffect(() => {
    commitNoteRef.current = commitNote;
  });
  // Leaving the spot (another spot, back to the list): what was typed goes now.
  useEffect(() => () => void commitNoteRef.current(), []);

  function onNoteValue(value: string) {
    const next = cutNote(value, noteMax);
    setNote(next);
    noteDirty.current = next;
    setNoteState("pending");
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => void commitNoteRef.current(), TEACHER_NOTE_SAVE_MS);
  }

  function onNoteKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (isSendKey(e)) {
      e.preventDefault();
      void commitNote();
    }
  }

  async function remove() {
    if (removing) return;
    setRemoving(true);
    setRemoveError(false);
    try {
      if (spot) {
        // Marked undone, the same as Undo: it leaves My spots and never counts in the stats.
        if (!(await change(spot.ids, { undone: true }))) throw new Error("not changed");
        onRemoved?.("tap");
      } else {
        onRemoved?.("all");
      }
      setConfirmRemove(false);
      setRemoving(false);
      say("Removed.");
    } catch {
      setRemoveError(true);
      setRemoving(false);
    }
  }

  // Before 0020: the spot's one mark on its row.
  async function saveMark(next: Rect | null) {
    if (savingMark || !spot) return;
    setSavingMark(true);
    setMarkError(false);
    try {
      // A new mark goes on the main row; Clear mark takes every mark off the slide's rows.
      const ok = next
        ? await change([spot.id], { hl_x: next.x, hl_y: next.y, hl_w: next.w, hl_h: next.h })
        : await change(spot.ids, NO_HIGHLIGHT);
      if (!ok) throw new Error("not changed");
      setRect(next);
      say(next ? "Spot marked." : "Mark cleared.");
      onHighlightSaved?.(next);
    } catch {
      setMarkError(true);
    } finally {
      setSavingMark(false);
      setMarking(false);
    }
  }

  function onMarkButton() {
    setMarkError(false);
    setSelected(null);
    if (marks) {
      setMarking((m) => !m);
      return;
    }
    if (marking) setMarking(false);
    else if (rect) void saveMark(null);
    else setMarking(true);
  }

  function addMark(r: Rect) {
    if (marks) {
      marks.add(r);
      say("Marked.");
    } else void saveMark(r);
  }

  const shownMarks: ShownMark[] = marks ? marks.list : rect && spot ? [{ id: spot.id, rect, kind: lost ? "lost" : "save" }] : [];
  const selectedIndex = selected ? shownMarks.findIndex((m) => m.id === selected.id) : -1;
  const selectedMark = marks && selectedIndex >= 0 ? shownMarks[selectedIndex] : null;

  const line = countLine(kind, students);
  const counter = noteLength(note) >= noteCounterFrom(noteMax) ? noteMax - noteLength(note) : null;
  const canMark = onSpotSlide && !expired && !!url && (!!marks || !!spot);
  const live = liveSlide !== null;
  // A save's own note from before the notebook (lost_taps.note on a save row): shown as it is.
  const oldSaveNote = spot?.kind === "save" && spot.note ? spot.note : null;
  const keeps = shownMarks.length > 0 || !!notebook?.text.trim();

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      {/* Lined up with the content column below it. */}
      <header className="mx-auto flex h-16 w-full max-w-180 shrink-0 items-center gap-2 px-4 lg:max-w-330 lg:px-8">
        <button type="button" onClick={onBack} aria-label="Back to My spots" className={backButtonClass}>
          <Icon name="back" />
        </button>
        <div className="min-w-0 flex-1" />
        {live && (
          // While the lecture is live: the way back into class, the one black button here.
          <Link href={`/l/${lectureId}`} className={`${buttonPrimarySmallClass} shrink-0`}>
            Back to lecture
          </Link>
        )}
        <button
          ref={prevRef}
          type="button"
          onClick={onPrevSpot}
          disabled={!onPrevSpot}
          aria-label="Previous spot"
          className={`${buttonSecondaryClass} max-sm:w-11 max-sm:px-0`}
        >
          <Icon name="back" />
          <span className="max-sm:sr-only">Previous spot</span>
        </button>
        <button
          ref={nextRef}
          type="button"
          onClick={onNextSpot}
          disabled={!onNextSpot}
          aria-label="Next spot"
          className={`${buttonSecondaryClass} max-sm:w-11 max-sm:px-0`}
        >
          <span className="max-sm:sr-only">Next spot</span>
          <Icon name="forward" />
        </button>
      </header>

      <main className={`mx-auto flex w-full max-w-180 animate-page-in flex-col gap-5 px-4 pb-6 pt-2 lg:max-w-330 lg:px-8 ${SPOT_ROOM}`}>
        <div className="flex min-w-0 items-center gap-4">
          <span aria-hidden data-spot-number="" className={`shrink-0 type-number-l ${lost ? "text-lost" : "text-ink"}`}>
            {slideNumber}
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 ref={headingRef} tabIndex={-1} className="break-words type-title text-ink outline-hidden">
              <span className="sr-only">Slide {slideNumber}: </span>
              {firstLine || `Slide ${slideNumber}`}
            </h1>
            <p className="flex items-center gap-2 type-small text-secondary">
              <KindDot kind={kind} />
              <span>
                {whenLine({ kind, tappedAt: spot?.tappedAt })}.{line && <> <span>{line}</span>.</>}
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-8">
          <div data-spot-stage="" className="flex min-w-0 flex-col gap-2 lg:flex-1">
            {/* As wide as the column, but never so tall that the buttons leave the screen. */}
            <div
              data-spot-slide=""
              className="relative max-w-full"
              style={{ width: `min(100%, max(12rem, calc((100dvh - var(--spot-room)) * ${ratio.toFixed(4)})))` } as CSSProperties}
            >
              <div data-spot-frame="" className="relative w-full overflow-hidden rounded-sm bg-surface shadow-slide">
                {expired ? (
                  <div data-slide-gone="" className="flex aspect-video w-full items-center justify-center px-6 text-center">
                    <p className="type-body text-secondary">{NO_LONGER_AVAILABLE}</p>
                  </div>
                ) : url ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      ref={imageRef}
                      src={url}
                      alt={`Slide ${viewing}`}
                      draggable={false}
                      onLoad={(e) => {
                        const img = e.currentTarget;
                        if (img.naturalWidth > 0 && img.naturalHeight > 0) setRatio(img.naturalWidth / img.naturalHeight);
                      }}
                      className="block h-auto w-full"
                    />
                    {onSpotSlide && (
                      <HighlightLayer
                        imageRef={imageRef}
                        marking={marking}
                        markingKind={lost ? "lost" : "save"}
                        marks={marks ? shownMarks : []}
                        selectedId={selectedMark?.id ?? null}
                        onSelect={(id, keyboard) => {
                          setMarking(false);
                          setSelected(id ? { id, keyboard } : null);
                        }}
                        onMark={addMark}
                        onCancel={() => {
                          setMarking(false);
                          markButtonRef.current?.focus();
                        }}
                        shown={!marks && rect ? { kind: lost ? "lost" : "save", rect } : null}
                        sample={sample}
                      />
                    )}
                  </>
                ) : (
                  <div className="aspect-video w-full" />
                )}
              </div>
              {selectedMark && marks && (
                // Outside the slide's clipping, so it can sit over the edge of a mark near the bottom.
                <MarkPopover
                  key={selectedMark.id}
                  mark={selectedMark}
                  n={selectedIndex + 1}
                  focusNote={selected?.keyboard}
                  onNote={(text) => marks.setNote(selectedMark.id, text)}
                  onDelete={() => {
                    marks.remove(selectedMark.id);
                    setSelected(null);
                    say("Mark deleted.");
                    markButtonRef.current?.focus();
                  }}
                  onClose={(back) => {
                    const id = selectedMark.id;
                    setSelected(null);
                    if (back) (document.querySelector(`[data-mark="${id}"]`) as HTMLElement | null)?.focus();
                  }}
                />
              )}
            </div>

            {!expired && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Previous slide"
                  disabled={viewing <= 1}
                  onClick={() => setViewing((v) => v - 1)}
                  className={`${iconButton} -ml-2`}
                >
                  <Icon name="back" />
                </button>
                {/* Which slide the arrows are on; the number only, never a total. */}
                <p className="min-w-12 text-center type-small text-secondary tabular-nums">Slide {viewing}</p>
                <button
                  type="button"
                  aria-label="Next slide"
                  disabled={viewing >= lastSlide}
                  onClick={() => setViewing((v) => Math.min(v + 1, lastSlide))}
                  className={iconButton}
                >
                  <Icon name="forward" />
                </button>
                {!onSpotSlide && (
                  <div className="flex min-w-0 animate-fade-in items-center pl-3">
                    <button type="button" onClick={() => setViewing(slideNumber)} className={buttonSecondaryClass}>
                      Back to slide {slideNumber}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* The spot's buttons first (right under the slide, or beside it from 1024 px), then the notes. */}
          <div data-spot-side="" className="flex w-full max-w-120 flex-col gap-4 lg:w-96 lg:shrink-0">
            {confirmRemove ? (
              <div className="flex animate-fade-in flex-wrap items-center gap-x-4 gap-y-3">
                <p className="type-small text-ink">
                  {spot ? (keeps ? "Remove this spot? Your marks and notes stay." : "Remove this spot?") : "Remove this spot? Its marks and notes go too."}
                </p>
                <button type="button" onClick={() => void remove()} disabled={removing} className={buttonSecondaryClass}>
                  Yes, remove
                </button>
                <button
                  ref={keepRef}
                  type="button"
                  onClick={() => {
                    setConfirmRemove(false);
                    setRemoveError(false);
                  }}
                  disabled={removing}
                  className={buttonSecondaryClass}
                >
                  Keep it
                </button>
              </div>
            ) : (
              <div data-spot-actions="" className="grid grid-cols-2 gap-2">
                {canMark && (
                  <button
                    ref={markButtonRef}
                    type="button"
                    onClick={onMarkButton}
                    disabled={savingMark}
                    aria-pressed={marking}
                    className={`${buttonSecondaryClass} ${marking ? "border-ink" : ""}`}
                  >
                    {marks ? (
                      <>
                        <span aria-hidden className={`h-3 w-4 shrink-0 rounded-xs ${lost ? "bg-mark-lost" : "bg-mark"}`} />
                        Mark
                      </>
                    ) : marking ? (
                      "Stop marking"
                    ) : rect ? (
                      "Clear mark"
                    ) : (
                      "Mark the spot"
                    )}
                  </button>
                )}
                {onRemoved && (
                  <button ref={removeRef} type="button" onClick={() => setConfirmRemove(true)} className={buttonSecondaryClass}>
                    Remove
                  </button>
                )}
              </div>
            )}
            {markError && <Alert>Could not save the mark. Try again.</Alert>}
            {marks?.problem && <Alert>{marks.problem}</Alert>}
            {removeError && <Alert>Could not remove the spot. Try again.</Alert>}

            {lost && spot && (
              // The note to the teacher: what the teacher reads, typed on the page.
              <div data-teacher-note="" className="flex flex-col gap-1">
                <div className="flex items-start gap-2">
                  <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-lost" />
                  <NotebookField
                    grow
                    rows={1}
                    maxRows={8}
                    aria-label="Note for the teacher"
                    aria-describedby={counter !== null ? counterId : undefined}
                    placeholder="Note for the teacher"
                    value={note}
                    onValue={onNoteValue}
                    onKeyDown={onNoteKeyDown}
                    onBlur={() => void commitNote()}
                    className="flex-1"
                  />
                </div>
                <div className="flex items-center justify-end gap-3 pl-4">
                  {counter !== null && (
                    <span id={counterId} data-counter="" className="mr-auto type-caption text-secondary">
                      {counter} left
                    </span>
                  )}
                  {noteState === "failed" ? (
                    <Alert>Could not save the note. Try again.</Alert>
                  ) : (
                    <SavedState state={noteState} className="h-4" />
                  )}
                </div>
              </div>
            )}

            {oldSaveNote && (
              <div data-note="" className="flex flex-col gap-1 border-t border-hairline pt-3">
                <p className="type-caption text-secondary">Your note</p>
                <p className="break-words whitespace-pre-wrap type-body text-ink">{oldSaveNote}</p>
              </div>
            )}

            {notebook && (
              // The slide's notebook note, typed on the page like the live screen's notebook.
              <div data-spot-notebook="" className="flex flex-col gap-1">
                <NotebookField
                  grow
                  rows={4}
                  maxRows={14}
                  aria-label={`Your notes, slide ${slideNumber}`}
                  placeholder="Your notes"
                  value={notebook.text}
                  onValue={(text) => notebook.onChange(cutNote(text, NOTEBOOK_MAX))}
                  onBlur={notebook.onFlush}
                />
                <SavedState state={notebook.state} className="h-4 text-right" />
              </div>
            )}
          </div>
        </div>
        {/* Always there, so a screen reader says each save (a new line each time). */}
        <p role="status" aria-atomic="false" className="sr-only">
          {said && <span key={said.n}>{said.text}</span>}
        </p>
      </main>
    </div>
  );
}
