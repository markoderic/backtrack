"use client";

import { useEffect, useRef, useState } from "react";
import { HighlightBoxes } from "@/components/HighlightBoxes";
import type { Rect } from "@/lib/rect";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { slideBoxStyle, useDragRect } from "@/lib/useDragRect";
import { useSlideImages } from "@/lib/useSlideImages";

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
  /** How many different students are lost on the spot's slide. */
  students: number;
  /** Only used to stop the next arrow on the last slide. It is never shown. */
  slideCount: number;
  onNoteSaved: (note: string | null) => void;
  /** Called after the row's highlight was changed. */
  onHighlightSaved?: (rect: Rect) => void;
  /** Called after the row was updated. Resolves when the counts were read again. */
  onMoved: (newSlide: number) => Promise<void>;
  onBack: () => void;
};

/** The line about other students, or null when there is nothing to say. */
function countLine(kind: Spot["kind"], students: number): string | null {
  if (kind === "lost") {
    if (students >= 2) return `${students} people got lost here`;
    if (students === 1) return "Only you got lost here";
    return null;
  }
  if (students >= 2) return `${students} people got lost on this slide`;
  if (students === 1) return "1 person got lost on this slide";
  return null;
}

const NO_HIGHLIGHT = { hl_x: null, hl_y: null, hl_w: null, hl_h: null };

/** Takes the pointer over the slide image while the student draws a new highlight. */
function DrawLayer({ imageRef, onRect }: { imageRef: React.RefObject<HTMLImageElement | null>; onRect: (rect: Rect) => void }) {
  const layerRef = useRef<HTMLDivElement>(null);
  // The Highlight button is already pressed, so a touch can draw too.
  const { box, draft, handlers } = useDragRect({ layerRef, imageRef, touch: true, onRect });
  return (
    <div
      ref={layerRef}
      data-highlight-layer=""
      className="absolute inset-0 select-none"
      style={{ touchAction: "none", cursor: "crosshair" }}
      {...handlers}
    >
      <div className="absolute" style={slideBoxStyle(box)}>
        {draft && <HighlightBoxes rects={[draft]} />}
      </div>
    </div>
  );
}

/** One spot: the slide, how many got lost on it, the note, and the marker. */
export function SpotDetail({ lectureId, spot, students, slideCount, onNoteSaved, onHighlightSaved, onMoved, onBack }: Props) {
  // The slide on screen. Browsing moves this; only "Move marker" moves the marker.
  const [viewing, setViewing] = useState(spot.slideNumber);
  const { urlFor } = useSlideImages(lectureId, viewing);
  const url = urlFor(viewing);

  const imageRef = useRef<HTMLImageElement>(null);
  const [rect, setRect] = useState<Rect | null>(spot.rect ?? null);
  const [drawing, setDrawing] = useState(false);
  const [savingHighlight, setSavingHighlight] = useState(false);
  const [highlightError, setHighlightError] = useState(false);
  const [highlightSaved, setHighlightSaved] = useState(false);
  // The highlight belongs to the slide of the spot, so it only shows and changes there.
  const onSpotSlide = viewing === spot.slideNumber;
  if (drawing && !onSpotSlide) setDrawing(false);

  useEffect(() => {
    if (!drawing) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawing(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawing]);

  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState(false);

  const [note, setNote] = useState(spot.note ?? "");
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const noteChanged = note.trim() !== (spot.note ?? "");

  // update(...).select("id") so a row the database refused to change (no error, no row) is not taken for a success.
  async function change(patch: Record<string, number | string | null>): Promise<boolean> {
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

  async function saveNote() {
    if (savingNote || !noteChanged) return;
    setSavingNote(true);
    setNoteError(false);
    setNoteSaved(false);
    const next = note.trim() === "" ? null : note.trim();
    try {
      if (!(await change({ note: next }))) throw new Error("not changed");
      onNoteSaved(next);
      setNote(next ?? "");
      setNoteSaved(true);
    } catch {
      setNoteError(true);
    } finally {
      setSavingNote(false);
    }
  }

  const line = countLine(spot.kind, students);

  return (
    <section className="flex flex-col gap-4">
      <div>
        <button type="button" onClick={onBack} className="border border-current px-4 py-2">
          Back to my spots
        </button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xl">Slide {viewing}</p>
        {viewing !== spot.slideNumber && (
          <button type="button" onClick={() => setViewing(spot.slideNumber)} className="border border-current px-3 py-2">
            Back to slide {spot.slideNumber}
          </button>
        )}
      </div>

      <div className="flex min-h-40 items-center justify-center bg-neutral-100">
        {url && (
          <div className="relative w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={imageRef} src={url} alt={`Slide ${viewing}`} draggable={false} className="h-auto w-full" />
            {onSpotSlide && rect && <HighlightBoxes rects={[rect]} />}
            {onSpotSlide && drawing && <DrawLayer imageRef={imageRef} onRect={(r) => void saveHighlight(r)} />}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          aria-label="Previous slide"
          disabled={viewing <= 1}
          onClick={() => setViewing((v) => v - 1)}
          className="min-w-16 border border-current px-4 py-3 disabled:opacity-40"
        >
          &larr;
        </button>
        <button
          type="button"
          aria-label="Next slide"
          disabled={viewing >= slideCount}
          onClick={() => setViewing((v) => v + 1)}
          className="min-w-16 border border-current px-4 py-3 disabled:opacity-40"
        >
          &rarr;
        </button>
      </div>

      {line && <p className="text-xl font-semibold">{line}</p>}

      <div className="flex flex-col gap-2">
        <label htmlFor="spot-note">Note</label>
        <div className="flex gap-2">
          <input
            id="spot-note"
            type="text"
            maxLength={140}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setNoteSaved(false);
            }}
            className="min-w-0 flex-1 border border-current px-3 py-2"
          />
          <button
            type="button"
            onClick={() => void saveNote()}
            disabled={!noteChanged || savingNote}
            className="border border-current px-4 py-2 disabled:opacity-40"
          >
            Save note
          </button>
        </div>
        {noteSaved && <p role="status">Note saved</p>}
        {noteError && <p role="alert">Could not save the note. Try again.</p>}
      </div>

      {onSpotSlide && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            aria-pressed={drawing}
            onClick={() => {
              setDrawing((d) => !d);
              setHighlightError(false);
              setHighlightSaved(false);
            }}
            className={`self-start border border-current px-4 py-3 ${drawing ? "bg-black text-white" : ""}`}
          >
            {rect ? "Change highlight" : "Highlight"}
          </button>
          {highlightSaved && <p role="status">Highlight saved</p>}
          {highlightError && <p role="alert">Could not save the highlight. Try again.</p>}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void moveMarker()}
          disabled={spot.slideNumber <= 1 || moving}
          className="self-start border border-current px-4 py-3 disabled:opacity-40"
        >
          Move marker one slide earlier
        </button>
        {moveError && <p role="alert">Could not move the marker. Try again.</p>}
      </div>
    </section>
  );
}
