"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { buttonPrimarySmallClass, buttonSecondaryClass } from "@/components/ButtonPrimary";
import { Icon } from "@/components/Icon";
import type { Rect } from "@/lib/rect";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { HighlightLayer } from "../../l/[lectureId]/HighlightLayer";
import { NOTE_MAX } from "../../l/[lectureId]/LostButton";
import type { Spot } from "../group";
import { formatClock } from "../time";

export type { Spot } from "../group";

/** The quiet counter shows only from this many characters on (as on the live screen). */
const NOTE_COUNTER_FROM = 120;

type Props = {
  lectureId: string;
  spot: Spot;
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
   * student the slides, so the page says so in their place. The note and the spot stay.
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
  onNoteSaved: (note: string | null) => void;
  /** Called after the spot's mark was saved (a box) or cleared (null). */
  onHighlightSaved?: (rect: Rect | null) => void;
  /** Called after the rows were updated. Resolves when the counts were read again. */
  onMoved: (newSlide: number) => Promise<void>;
  /** Called after the spot was removed (its rows are marked undone, like Undo). */
  onRemoved?: () => void;
  onBack: () => void;
  /** Open the spot before or after this one in the list. Missing at either end. */
  onPrevSpot?: () => void;
  onNextSpot?: () => void;
};

/** The line about other students, or null when there is nothing to say. */
export function countLine(kind: Spot["kind"], students: number): string | null {
  if (kind === "lost") {
    if (students >= 2) return `${students} people got lost here`;
    if (students === 1) return "Only you got lost here";
    return null;
  }
  if (students >= 2) return `${students} people got lost on this slide`;
  if (students === 1) return "1 person got lost on this slide";
  return null;
}

/** "Lost at 10:41" or "Saved for later at 10:52". */
export function whenLine(spot: Pick<Spot, "kind" | "tappedAt">): string {
  const at = formatClock(spot.tappedAt);
  const what = spot.kind === "lost" ? "Lost" : "Saved for later";
  return at ? `${what} at ${at}` : what;
}

/** The look of a saved mark: lost is red on its tint, a save is an ink outline. */
export function highlightClass(kind: Spot["kind"], thin = false): string {
  if (kind === "lost") return `rounded-xs ${thin ? "border" : "border-2"} border-lost bg-lost-tint mix-blend-multiply`;
  return `rounded-xs ${thin ? "border" : "border-[1.5px]"} border-ink`;
}

/** Said in place of the slide once the course's time for students to see it is over. */
export const NO_LONGER_AVAILABLE = "This slide is no longer available.";

const NO_HIGHLIGHT = { hl_x: null, hl_y: null, hl_w: null, hl_h: null };

/** 36 px icon buttons (a 44 px hit area on a touch screen), for browsing the slides. */
const iconButton =
  "press touch-target relative flex size-9 shrink-0 items-center justify-center rounded-md text-ink hover:bg-surface focus-ring " +
  "disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent";

/** The 44 px white back arrow at the top left (spot → the lecture's list → all lectures). */
export const backButtonClass = `${buttonSecondaryClass} size-11 shrink-0 px-0`;

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex animate-fade-in items-center gap-2 type-small text-ink">
      <Icon name="alert" size={18} />
      {children}
    </p>
  );
}

/**
 * One spot: its slide, how many got lost on it, the note, the mark and the marker. The note
 * and Mark the spot work as on the live screen: Add a note opens a 3 line field (Enter saves,
 * Shift+Enter is a new line, Esc drops it); Mark the spot takes one drag on the slide and saves
 * it when you let go, and Clear mark takes it off.
 */
export function SpotDetail({
  spot,
  firstLine,
  students,
  slideCount,
  urlFor,
  expired = false,
  onViewingChange,
  focusOnOpen,
  liveSlide = null,
  onNoteSaved,
  onHighlightSaved,
  onMoved,
  onRemoved,
  onBack,
  onPrevSpot,
  onNextSpot,
}: Props) {
  // The slide on screen. Browsing moves this; only "Move to slide n" moves the marker.
  const [viewing, setViewing] = useState(spot.slideNumber);
  const url = expired ? undefined : urlFor(viewing);
  // While the lecture is live, the last slide a student may see is the live one.
  const lastSlide = liveSlide ?? slideCount ?? spot.slideNumber;
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
  const noteButtonRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();

  const [rect, setRect] = useState<Rect | null>(spot.rect ?? null);
  // Mark the spot is on: the slide takes one drag, saved when it ends.
  const [marking, setMarking] = useState(false);
  const [savingMark, setSavingMark] = useState(false);
  const [markError, setMarkError] = useState(false);
  const [said, setSaid] = useState<{ n: number; text: string } | null>(null);
  const say = (text: string) => setSaid((s) => ({ n: (s?.n ?? 0) + 1, text }));
  // The mark belongs to the slide of the spot, so it only shows and changes there.
  const onSpotSlide = viewing === spot.slideNumber;
  if (marking && !onSpotSlide) setMarking(false);

  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState(false);

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

  const [note, setNote] = useState(spot.note);
  const [draft, setDraft] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState(false);
  const editing = draft !== null;
  const focusAfterNote = useRef<"textarea" | "button" | null>(null);
  useEffect(() => {
    const want = focusAfterNote.current;
    focusAfterNote.current = null;
    if (want === "textarea") textareaRef.current?.focus();
    else if (want === "button") noteButtonRef.current?.focus();
  }, [editing]);
  // The field grows with its text (3 lines at least).
  useEffect(() => {
    const field = textareaRef.current;
    if (!field || draft === null) return;
    field.style.height = "auto";
    if (field.scrollHeight > 0) field.style.height = `${field.scrollHeight + 2}px`;
  }, [draft]);

  /**
   * Updates rows of this spot, then checks every one of them came back changed:
   * update(...).select("id") so a row the database refused (no error, no row) is not taken for a success.
   */
  async function change(ids: string[], patch: Record<string, number | string | boolean | null>): Promise<boolean> {
    const { data, error } = await createBrowserSupabase().from("lost_taps").update(patch).in("id", ids).select("id");
    return !error && !!data && data.length === ids.length;
  }

  async function moveMarker() {
    if (moving || spot.slideNumber <= 1) return;
    setMoving(true);
    setMoveError(false);
    const next = spot.slideNumber - 1;
    try {
      // A mark is a part of the slide it was drawn on, so it does not come along.
      if (!(await change(spot.ids, { slide_number: next, ...(rect ? NO_HIGHLIGHT : {}) }))) throw new Error("not changed");
      setRect(null);
      await onMoved(next);
      setViewing(next);
    } catch {
      setMoveError(true);
    } finally {
      setMoving(false);
    }
  }

  async function remove() {
    if (removing) return;
    setRemoving(true);
    setRemoveError(false);
    try {
      // Marked undone, the same as Undo: it leaves My spots and never counts in the stats.
      if (!(await change(spot.ids, { undone: true }))) throw new Error("not changed");
      onRemoved?.();
    } catch {
      setRemoveError(true);
      setRemoving(false);
    }
  }

  async function saveMark(next: Rect | null) {
    if (savingMark) return;
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
    if (marking) setMarking(false);
    else if (rect) void saveMark(null);
    else setMarking(true);
  }

  function startNote() {
    setMarking(false);
    setNoteError(false);
    focusAfterNote.current = "textarea";
    setDraft(note ?? "");
  }

  function closeNote() {
    focusAfterNote.current = "button";
    setDraft(null);
    setNoteError(false);
  }

  async function saveNote(e?: FormEvent) {
    e?.preventDefault();
    if (savingNote || draft === null) return;
    const next = draft.trim() === "" ? null : draft.trim();
    if (next === note) {
      // Nothing changed: Save just closes the field.
      closeNote();
      return;
    }
    setSavingNote(true);
    setNoteError(false);
    try {
      // A note goes on the main row; an emptied note clears every note on the slide's rows.
      if (!(await change(next === null ? spot.ids : [spot.id], { note: next }))) throw new Error("not changed");
      setNote(next);
      onNoteSaved(next);
      say(next ? "Note saved." : "Note removed.");
      closeNote();
    } catch {
      setNoteError(true);
    } finally {
      setSavingNote(false);
    }
  }

  // Enter saves (Shift+Enter is a new line), Esc drops the changes.
  function onNoteKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void saveNote();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeNote();
    }
  }

  const line = countLine(spot.kind, students);
  const lost = spot.kind === "lost";
  const counter = draft !== null && draft.length >= NOTE_COUNTER_FROM ? NOTE_MAX - draft.length : null;
  const canMark = onSpotSlide && !expired && !!url;

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      <header className="flex h-16 shrink-0 items-center gap-2 px-4">
        <button type="button" onClick={onBack} aria-label="Back to My spots" className={backButtonClass}>
          <Icon name="back" />
        </button>
        <div className="min-w-0 flex-1" />
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

      <main className="mx-auto flex w-full max-w-180 animate-page-in flex-col gap-5 px-4 pb-10 pt-2">
        <div className="flex min-w-0 items-center gap-4">
          <span aria-hidden data-spot-number="" className={`shrink-0 type-number-l ${lost ? "text-lost" : "text-ink"}`}>
            {spot.slideNumber}
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 ref={headingRef} tabIndex={-1} className="break-words type-title text-ink outline-hidden">
              <span className="sr-only">Slide {spot.slideNumber}: </span>
              {firstLine || `Slide ${spot.slideNumber}`}
            </h1>
            <p className="type-small text-secondary">
              {whenLine(spot)}.{line && <> <span>{line}</span>.</>}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="relative w-full overflow-hidden rounded-sm bg-surface shadow-slide">
            {expired ? (
              <div data-slide-gone="" className="flex aspect-video w-full items-center justify-center px-6 text-center">
                <p className="type-body text-secondary">{NO_LONGER_AVAILABLE}</p>
              </div>
            ) : url ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img ref={imageRef} src={url} alt={`Slide ${viewing}`} draggable={false} className="block h-auto w-full" />
                {onSpotSlide && (
                  <HighlightLayer
                    imageRef={imageRef}
                    marking={marking}
                    markingKind={spot.kind}
                    onMark={(r) => void saveMark(r)}
                    onCancel={() => {
                      setMarking(false);
                      markButtonRef.current?.focus();
                    }}
                    shown={rect ? { kind: spot.kind, rect } : null}
                  />
                )}
              </>
            ) : (
              <div className="aspect-video w-full" />
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
                  <button type="button" onClick={() => setViewing(spot.slideNumber)} className={buttonSecondaryClass}>
                    Back to slide {spot.slideNumber}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex w-full max-w-120 flex-col gap-3">
          {editing ? (
            <form onSubmit={(e) => void saveNote(e)} className="flex animate-rise-in flex-col gap-2">
              <label htmlFor={fieldId} className="type-small-strong text-ink">
                Your note
              </label>
              <textarea
                ref={textareaRef}
                id={fieldId}
                rows={3}
                maxLength={NOTE_MAX}
                enterKeyHint="done"
                value={draft}
                readOnly={savingNote}
                onChange={(e) => setDraft(e.target.value.slice(0, NOTE_MAX))}
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
                <button type="submit" disabled={savingNote} className={buttonPrimarySmallClass}>
                  Save note
                </button>
              </div>
            </form>
          ) : (
            note && (
              <div data-note="" className="flex flex-col gap-1 border-t border-hairline pt-3">
                <p className="type-caption text-secondary">Your note</p>
                <p className="break-words whitespace-pre-wrap type-body text-ink">{note}</p>
              </div>
            )
          )}
          {noteError && <Alert>Could not save the note. Try again.</Alert>}

          {confirmRemove ? (
            <div className="flex animate-fade-in flex-wrap items-center gap-x-4 gap-y-3">
              <p className="type-small text-ink">Remove this spot?</p>
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
              {!editing && (
                <button ref={noteButtonRef} type="button" onClick={startNote} className={buttonSecondaryClass}>
                  {note ? "Edit note" : "Add a note"}
                </button>
              )}
              {canMark && !editing && (
                <button
                  ref={markButtonRef}
                  type="button"
                  onClick={onMarkButton}
                  disabled={savingMark}
                  aria-pressed={marking}
                  className={`${buttonSecondaryClass} ${marking ? "border-ink" : ""}`}
                >
                  {marking ? "Stop marking" : rect ? "Clear mark" : "Mark the spot"}
                </button>
              )}
              {spot.slideNumber > 1 && (
                <button type="button" onClick={() => void moveMarker()} disabled={moving} className={buttonSecondaryClass}>
                  Move to slide {spot.slideNumber - 1}
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
          {moveError && <Alert>Could not move the marker. Try again.</Alert>}
          {removeError && <Alert>Could not remove the spot. Try again.</Alert>}
        </div>
        {/* Always there, so a screen reader says each save (a new line each time). */}
        <p role="status" aria-atomic="false" className="sr-only">
          {said && <span key={said.n}>{said.text}</span>}
        </p>
      </main>
    </div>
  );
}
