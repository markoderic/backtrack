"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { HighlightBoxes } from "@/components/HighlightBoxes";
import { Icon } from "@/components/Icon";
import { menuTop } from "@/app/l/[lectureId]/HighlightLayer";
import type { Rect } from "@/lib/rect";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { slideBoxStyle, useDragRect } from "@/lib/useDragRect";
import { useSlideImages } from "@/lib/useSlideImages";
import { formatClock } from "../time";

export type Spot = {
  id: string;
  kind: "lost" | "save";
  /** The slide the marker is on now. Moving the marker changes this. */
  slideNumber: number;
  note: string | null;
  tappedAt: string;
  /** The part of the slide the student highlighted, as fractions of it. */
  rect?: Rect | null;
};

type Props = {
  lectureId: string;
  spot: Spot;
  /** The first line of the spot's slide, for the heading. */
  firstLine?: string;
  /** How many different students are lost on the spot's slide. */
  students: number;
  /** Only used to stop the next arrow on the last slide. It is never shown. */
  slideCount: number;
  /**
   * The lecture's live slide while it is live. Browsing stops there, never past it (D10):
   * a student only knows the slides up to the live one. Null once the lecture has ended.
   */
  liveSlide?: number | null;
  onNoteSaved: (note: string | null) => void;
  /** Called after the row's highlight was changed. */
  onHighlightSaved?: (rect: Rect) => void;
  /** Called after the row was updated. Resolves when the counts were read again. */
  onMoved: (newSlide: number) => Promise<void>;
  /** Called after the spot was removed (the row is marked undone, like Undo). */
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
export function whenLine(spot: Spot): string {
  const at = formatClock(spot.tappedAt);
  const what = spot.kind === "lost" ? "Lost" : "Saved for later";
  return at ? `${what} at ${at}` : what;
}

/** The look of a saved highlight: lost is red on its tint, a save is an ink outline. */
export function highlightClass(kind: Spot["kind"], thin = false): string {
  if (kind === "lost") return `rounded-xs ${thin ? "border" : "border-2"} border-lost bg-lost-tint mix-blend-multiply`;
  return `rounded-xs ${thin ? "border" : "border-[1.5px]"} border-ink`;
}

const NO_HIGHLIGHT = { hl_x: null, hl_y: null, hl_w: null, hl_h: null };

const pct = (n: number) => `${Math.round(n * 1e6) / 1e4}%`;

/** Underlined text actions (Change highlight, Move to slide 6, Remove). */
const action =
  "press rounded-xs type-small-strong text-ink underline underline-offset-2 hover:text-secondary focus-ring " +
  "disabled:cursor-default disabled:opacity-40 disabled:hover:text-ink";
/** 36 px icon buttons. */
const iconButton =
  "press flex size-9 shrink-0 items-center justify-center rounded-md text-ink hover:bg-surface focus-ring " +
  "disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent";

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex animate-fade-in items-center gap-2 type-small text-ink">
      <Icon name="alert" size={18} />
      {children}
    </p>
  );
}

/**
 * Over the spot's slide: a drag with a mouse or pen draws a dashed box right away, as in
 * class (D9); a touch only once Highlight is pressed, so the page still scrolls on a phone.
 * The box then waits for Keep highlight or Cancel. Esc or a press anywhere else cancels.
 */
function DrawLayer({
  imageRef,
  touch,
  saving,
  onKeep,
  onPending,
}: {
  imageRef: React.RefObject<HTMLImageElement | null>;
  touch: boolean;
  saving: boolean;
  onKeep: (rect: Rect) => void;
  /** Whether a box is waiting for Keep highlight or Cancel. */
  onPending: (waiting: boolean) => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Rect | null>(null);
  const { box, draft, handlers } = useDragRect({
    layerRef,
    imageRef,
    touch,
    onStart: () => setPending(null),
    onRect: setPending,
  });

  const waiting = pending !== null;
  const onPendingRef = useRef(onPending);
  useEffect(() => {
    onPendingRef.current = onPending;
  });
  useEffect(() => {
    onPendingRef.current(waiting);
  }, [waiting]);
  // Leaving the slide (browsing, moving the marker) ends the wait.
  useEffect(() => () => onPendingRef.current(false), []);

  useEffect(() => {
    if (!pending) return;
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setPending(null);
    }
    function onPointerDown(e: globalThis.PointerEvent) {
      const target = e.target as Node | null;
      if (target && (layerRef.current?.contains(target) || menuRef.current?.contains(target))) return;
      setPending(null);
    }
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [pending]);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    // A press in the menu is the menu's own.
    if (menuRef.current?.contains(e.target as Node)) return;
    handlers.onPointerDown(e);
  }

  const drawing = draft ?? pending;
  const item =
    "press flex items-center rounded-sm px-3.5 py-2 type-small-strong text-ink whitespace-nowrap " +
    "hover:bg-bg focus-ring focus-visible:outline-offset-0 disabled:cursor-default disabled:opacity-40";

  return (
    <div
      ref={layerRef}
      data-highlight-layer=""
      data-pending={pending ? "" : undefined}
      className="absolute inset-0 select-none"
      style={{ touchAction: touch ? "none" : undefined, cursor: "crosshair" }}
      onPointerDown={onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
    >
      <div className="absolute" style={slideBoxStyle(box)}>
        {drawing && (
          <HighlightBoxes rects={[drawing]} boxClassName="rounded-xs border-[1.5px] border-dashed border-ink bg-ink/5" />
        )}
        {pending && (
          // Under the box's left edge; the spacer shrinks so the menu never runs past the slide.
          <div
            ref={menuRef}
            role="group"
            aria-label="Highlight"
            className="pointer-events-none absolute left-0 right-0 z-10 flex cursor-auto"
            style={{ top: menuTop(pending, box?.height ?? 0) }}
          >
            <div aria-hidden className="min-w-0 shrink" style={{ flexBasis: pct(pending.x) }} />
            <div className="pointer-events-auto flex shrink-0 origin-top-left animate-pop-in items-center rounded-md border border-hairline bg-surface p-1 shadow-popover">
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  onKeep(pending);
                  setPending(null);
                }}
                className={item}
              >
                Keep highlight
              </button>
              <button type="button" onClick={() => setPending(null)} className={item}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** One spot: its slide, how many got lost on it, the note, the highlight and the marker. */
export function SpotDetail({
  lectureId,
  spot,
  firstLine,
  students,
  slideCount,
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
  const { urlFor } = useSlideImages(lectureId, viewing);
  const url = urlFor(viewing);
  // While the lecture is live, the last slide a student may see is the live one.
  const lastSlide = liveSlide ?? slideCount;

  const imageRef = useRef<HTMLImageElement>(null);
  const [rect, setRect] = useState<Rect | null>(spot.rect ?? null);
  // Highlight pressed: a touch can draw too (a mouse or pen always can).
  const [drawing, setDrawing] = useState(false);
  const [savingHighlight, setSavingHighlight] = useState(false);
  const [highlightError, setHighlightError] = useState(false);
  const [highlightSaved, setHighlightSaved] = useState(false);
  // A drawn box waits for Keep highlight or Cancel; the Highlight action steps aside meanwhile (design).
  const [boxWaiting, setBoxWaiting] = useState(false);
  // The highlight belongs to the slide of the spot, so it only shows and changes there.
  const onSpotSlide = viewing === spot.slideNumber;
  if (drawing && !onSpotSlide) setDrawing(false);

  useEffect(() => {
    if (!drawing) return;
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setDrawing(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawing]);

  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState(false);

  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState(false);

  const [note, setNote] = useState(spot.note ?? "");
  const [editingNote, setEditingNote] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const noteRef = useRef<HTMLInputElement>(null);
  const editNoteRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (editingNote) noteRef.current?.focus();
    else if (returnFocus.current) editNoteRef.current?.focus();
    returnFocus.current = false;
  }, [editingNote]);

  // update(...).select("id") so a row the database refused to change (no error, no row) is not taken for a success.
  async function change(patch: Record<string, number | string | boolean | null>): Promise<boolean> {
    const { data, error } = await createBrowserSupabase()
      .from("lost_taps")
      .update(patch)
      .eq("id", spot.id)
      .select("id");
    return !error && !!data && data.length > 0;
  }

  async function moveMarker() {
    if (moving || spot.slideNumber <= 1) return;
    setMoving(true);
    setMoveError(false);
    const next = spot.slideNumber - 1;
    try {
      // A highlight is a part of the slide it was drawn on, so it does not come along.
      if (!(await change({ slide_number: next, ...(rect ? NO_HIGHLIGHT : {}) }))) throw new Error("not changed");
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
      if (!(await change({ undone: true }))) throw new Error("not changed");
      onRemoved?.();
    } catch {
      setRemoveError(true);
      setRemoving(false);
    }
  }

  async function saveHighlight(next: Rect) {
    if (savingHighlight) return;
    setSavingHighlight(true);
    setHighlightError(false);
    setHighlightSaved(false);
    try {
      if (!(await change({ hl_x: next.x, hl_y: next.y, hl_w: next.w, hl_h: next.h }))) throw new Error("not changed");
      setRect(next);
      setDrawing(false);
      setHighlightSaved(true);
      onHighlightSaved?.(next);
    } catch {
      setHighlightError(true);
    } finally {
      setSavingHighlight(false);
    }
  }

  function closeNote() {
    returnFocus.current = true;
    setEditingNote(false);
  }

  async function saveNote(e?: FormEvent) {
    e?.preventDefault();
    if (savingNote) return;
    const next = note.trim() === "" ? null : note.trim();
    if (next === (spot.note ?? null)) {
      // Nothing changed: Enter just closes the field.
      setNote(spot.note ?? "");
      closeNote();
      return;
    }
    setSavingNote(true);
    setNoteError(false);
    setNoteSaved(false);
    try {
      if (!(await change({ note: next }))) throw new Error("not changed");
      onNoteSaved(next);
      setNote(next ?? "");
      setNoteSaved(true);
      closeNote();
    } catch {
      setNoteError(true);
    } finally {
      setSavingNote(false);
    }
  }

  function onNoteKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Escape") return;
    // Esc drops what was typed.
    e.preventDefault();
    setNote(spot.note ?? "");
    setNoteError(false);
    closeNote();
  }

  const line = countLine(spot.kind, students);
  const lost = spot.kind === "lost";
  const savedNote = spot.note;

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      <header className="flex h-14 shrink-0 items-center gap-0 px-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to my spots"
          className="press flex items-center gap-1 rounded-md p-2 type-small-strong text-ink hover:bg-surface focus-ring"
        >
          <Icon name="back" />
          My spots
        </button>
        <div className="min-w-0 flex-1" />
        <button
          type="button"
          onClick={onPrevSpot}
          disabled={!onPrevSpot}
          aria-label="Previous spot"
          className="press group flex h-9 items-center gap-0 rounded-md text-ink focus-ring disabled:cursor-default disabled:opacity-30"
        >
          <span className="type-small text-secondary group-enabled:group-hover:text-ink max-sm:sr-only">
            Previous spot
          </span>
          <span className="flex size-9 items-center justify-center rounded-md group-enabled:group-hover:bg-surface">
            <Icon name="back" />
          </span>
        </button>
        <button
          type="button"
          onClick={onNextSpot}
          disabled={!onNextSpot}
          aria-label="Next spot"
          className="press group flex h-9 items-center gap-0 rounded-md text-ink focus-ring disabled:cursor-default disabled:opacity-30"
        >
          <span className="flex size-9 items-center justify-center rounded-md group-enabled:group-hover:bg-surface">
            <Icon name="forward" />
          </span>
          <span className="type-small text-secondary group-enabled:group-hover:text-ink max-sm:sr-only">
            Next spot
          </span>
        </button>
      </header>

      <main className="mx-auto flex w-full max-w-180 animate-rise-in flex-col gap-5 px-4 pb-10 pt-2">
        <div className="flex min-w-0 items-center gap-4">
          <span aria-hidden className={`shrink-0 type-number-l ${lost ? "text-lost" : "text-ink"}`}>
            {spot.slideNumber}
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="break-words type-title text-ink">
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
            {url ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img ref={imageRef} src={url} alt={`Slide ${viewing}`} draggable={false} className="block h-auto w-full" />
                {onSpotSlide && rect && <HighlightBoxes rects={[rect]} boxClassName={highlightClass(spot.kind)} />}
                {onSpotSlide && (
                  <DrawLayer
                    imageRef={imageRef}
                    touch={drawing}
                    saving={savingHighlight}
                    onKeep={(r) => void saveHighlight(r)}
                    onPending={setBoxWaiting}
                  />
                )}
              </>
            ) : (
              <div className="aspect-video w-full" />
            )}
          </div>

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
                <button type="button" onClick={() => setViewing(spot.slideNumber)} className={action}>
                  Back to slide {spot.slideNumber}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          {editingNote ? (
            <form onSubmit={(e) => void saveNote(e)} className="flex flex-col gap-1">
              <label htmlFor="spot-note" className="type-small text-secondary">
                Your note
              </label>
              <div className="h-8 w-full max-w-100 border-b border-hairline py-1 transition-colors duration-(--dur-fast) ease-out focus-within:border-ink">
                <input
                  ref={noteRef}
                  id="spot-note"
                  type="text"
                  maxLength={140}
                  placeholder="Add a note"
                  enterKeyHint="done"
                  value={note}
                  readOnly={savingNote}
                  onChange={(e) => {
                    setNote(e.target.value);
                    setNoteSaved(false);
                  }}
                  onKeyDown={onNoteKeyDown}
                  className="block h-6 w-full min-w-0 bg-transparent type-note text-ink outline-hidden placeholder:text-secondary"
                />
              </div>
            </form>
          ) : savedNote ? (
            <>
              <p className="type-small text-secondary">Your note</p>
              <div className="flex min-w-0 items-center gap-2">
                <p className="min-w-0 break-words type-note text-ink">{savedNote}</p>
                <button
                  ref={editNoteRef}
                  type="button"
                  aria-label="Edit note"
                  onClick={() => setEditingNote(true)}
                  className="press -m-1.5 flex size-7 shrink-0 items-center justify-center rounded-md text-ink hover:bg-surface focus-ring"
                >
                  <Icon name="edit" size={16} />
                </button>
              </div>
            </>
          ) : (
            <button
              ref={editNoteRef}
              type="button"
              onClick={() => setEditingNote(true)}
              className="press self-start rounded-xs type-note text-secondary underline underline-offset-2 hover:text-ink focus-ring"
            >
              Add a note
            </button>
          )}
          {noteSaved && (
            <p role="status" className="sr-only">
              Note saved
            </p>
          )}
          {noteError && <Alert>Could not save the note. Try again.</Alert>}
        </div>

        <div className="flex flex-col gap-3">
          {confirmRemove ? (
            <div className="flex animate-fade-in flex-wrap items-center gap-x-6 gap-y-2">
              <p className="type-small text-ink">Remove this spot?</p>
              <button type="button" onClick={() => void remove()} disabled={removing} className={action}>
                Yes, remove
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmRemove(false);
                  setRemoveError(false);
                }}
                disabled={removing}
                className={action}
              >
                Keep it
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
              {onSpotSlide && !boxWaiting && (
                <button
                  type="button"
                  aria-pressed={drawing}
                  onClick={() => {
                    setDrawing((d) => !d);
                    setHighlightError(false);
                    setHighlightSaved(false);
                  }}
                  className={`${action} aria-pressed:bg-ink aria-pressed:px-1.5 aria-pressed:text-surface aria-pressed:no-underline aria-pressed:hover:text-surface`}
                >
                  {rect ? "Change highlight" : "Highlight"}
                </button>
              )}
              {spot.slideNumber > 1 && (
                <button type="button" onClick={() => void moveMarker()} disabled={moving} className={action}>
                  Move to slide {spot.slideNumber - 1}
                </button>
              )}
              {onRemoved && (
                <button type="button" onClick={() => setConfirmRemove(true)} className={action}>
                  Remove
                </button>
              )}
            </div>
          )}
          {highlightSaved && (
            <p role="status" className="sr-only">
              Highlight saved
            </p>
          )}
          {highlightError && <Alert>Could not save the highlight. Try again.</Alert>}
          {moveError && <Alert>Could not move the marker. Try again.</Alert>}
          {removeError && <Alert>Could not remove the spot. Try again.</Alert>}
        </div>
      </main>
    </div>
  );
}
