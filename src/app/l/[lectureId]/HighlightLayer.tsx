"use client";

import { useEffect, useRef, type RefObject } from "react";
import { HighlightBoxes } from "@/components/HighlightBoxes";
import type { Rect } from "@/lib/rect";
import { slideBoxStyle, useDragRect } from "@/lib/useDragRect";

export type Highlight = { kind: "lost" | "save"; rect: Rect };

type Props = {
  /** The slide image this layer sits over. */
  imageRef: RefObject<HTMLImageElement | null>;
  /** Mark the spot is on: a drag (mouse, pen or finger) draws a box, and letting go saves it. */
  marking: boolean;
  /** What is being marked, for the short instruction shown while marking. */
  markingKind?: Highlight["kind"];
  /** The box the student let go on. */
  onMark: (rect: Rect) => void;
  /** Esc while marking. */
  onCancel: () => void;
  /** The mark already on this slide's spot, drawn in its kind's look. */
  shown?: Highlight | null;
};

/**
 * Sits over the slide image. It takes nothing until Mark the spot is on (the I'm lost
 * panel turns it on after a tap); the slide then takes a drag with a mouse, a pen or a
 * finger, draws a dashed box, and saves it the moment the drag ends. A click, or a drag
 * under 2% of the slide in both directions, saves nothing and leaves marking on. Esc
 * stops marking. There is no keyboard shortcut. A saved mark is drawn in its kind's look.
 */
export function HighlightLayer({ imageRef, marking, markingKind = "lost", onMark, onCancel, shown = null }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  const { box, draft, handlers } = useDragRect({
    layerRef,
    imageRef,
    touch: marking,
    onRect: (rect) => {
      if (marking) onMark(rect);
    },
  });

  useEffect(() => {
    if (!marking) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancelRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [marking]);

  return (
    <div
      ref={layerRef}
      data-highlight-layer=""
      data-marking={marking ? "" : undefined}
      className={`absolute inset-0 select-none rounded-sm ${
        marking ? "outline-2 -outline-offset-2 outline-ink outline-dashed" : "pointer-events-none"
      }`}
      // While marking, a finger drags instead of scrolling the page.
      style={marking ? { touchAction: "none", cursor: "crosshair" } : undefined}
      {...(marking ? handlers : {})}
    >
      {/* The box of the slide itself, so the rects are fractions of the slide and not of the space around it. */}
      <div className="absolute" style={slideBoxStyle(box)}>
        {draft ? (
          // Dashed while the drag goes on.
          <HighlightBoxes rects={[draft]} boxClassName="rounded-xs border-[1.5px] border-dashed border-ink bg-ink/5" />
        ) : shown ? (
          <HighlightBoxes
            rects={[shown.rect]}
            boxClassName={
              shown.kind === "lost"
                ? "rounded-xs border-2 border-lost bg-lost-tint mix-blend-multiply animate-fade-in"
                : "rounded-xs border-[1.5px] border-ink animate-fade-in"
            }
          />
        ) : null}
      </div>
      {marking && !draft && (
        <p
          data-mark-hint=""
          className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 animate-pop-in rounded-md bg-ink px-3 py-1.5 type-small-strong whitespace-nowrap text-surface shadow-popover"
        >
          {markingKind === "lost" ? "Drag over the part you lost" : "Drag over the part to keep"}
        </p>
      )}
    </div>
  );
}
