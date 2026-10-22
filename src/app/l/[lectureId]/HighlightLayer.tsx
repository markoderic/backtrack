"use client";

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { HighlightBoxes } from "@/components/HighlightBoxes";
import { menuTop } from "@/lib/highlightMenu";
import type { Rect } from "@/lib/rect";
import { slideBoxStyle, useDragRect } from "@/lib/useDragRect";

export type Highlight = { kind: "lost" | "save"; rect: Rect; note?: string };

type Props = {
  /** The slide on screen. A highlight not yet chosen is dropped when it changes. */
  viewing: number;
  /** The slide image this layer sits over. */
  imageRef: RefObject<HTMLImageElement | null>;
  /** The student picked I'm lost or Save this for the box they drew. */
  onChoose: (highlight: Highlight) => void;
  /** A box that was just chosen on this slide, drawn in its kind's look while its saved line shows. */
  chosen?: { kind: Highlight["kind"]; rect: Rect } | null;
};

const pct = (n: number) => `${Math.round(n * 1e6) / 1e4}%`;

/**
 * Sits over the slide image. A drag with a mouse or pen draws a dashed box and opens
 * a small menu under it: I'm lost or Save this (a note can be added in the saved
 * line after). On a touch screen
 * a small Highlight button turns drawing on first, so the page still scrolls. A
 * click, or a drag under 2% of the slide in both directions, does nothing. Esc or
 * a press anywhere else cancels. There is no keyboard shortcut.
 */
export function HighlightLayer({ viewing, imageRef, onChoose, chosen = null }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<{ rect: Rect; slide: number } | null>(null);
  const [touchOn, setTouchOn] = useState(false);
  const [coarse, setCoarse] = useState(false);

  // A box drawn on another slide is not this slide's.
  if (pending && pending.slide !== viewing) setPending(null);

  function cancel() {
    setPending(null);
  }

  const { box, draft, handlers } = useDragRect({
    layerRef,
    imageRef,
    touch: touchOn,
    onStart: cancel,
    onRect: (rect) => setPending({ rect, slide: viewing }),
  });

  // Phones and tablets get the Highlight button. Reading the screen is left to after the first render.
  useEffect(() => {
    const query = typeof window.matchMedia === "function" ? window.matchMedia("(pointer: coarse)") : null;
    if (!query) return;
    const update = () => setCoarse(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (!pending) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") cancel();
    }
    function onPointerDown(e: globalThis.PointerEvent) {
      const target = e.target as Node | null;
      if (target && (layerRef.current?.contains(target) || menuRef.current?.contains(target))) return;
      cancel();
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
    // A device that touches is a touch screen, even if it also has a mouse.
    if (e.pointerType === "touch") setCoarse(true);
    handlers.onPointerDown(e);
  }

  function choose(kind: Highlight["kind"]) {
    if (!pending) return;
    onChoose({ kind, rect: pending.rect });
    cancel();
  }

  const drawing = draft ?? pending?.rect ?? null;
  const item =
    "press flex items-center gap-2 rounded-sm px-3.5 py-2 type-small-strong text-ink whitespace-nowrap " +
    "hover:bg-bg focus-ring focus-visible:outline-offset-0";

  return (
    <>
      <div
        ref={layerRef}
        data-highlight-layer=""
        className="absolute inset-0 select-none"
        style={{ touchAction: touchOn ? "none" : undefined, cursor: "crosshair" }}
        onPointerDown={onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
      >
        {/* The box of the slide itself, so the rects are fractions of the slide and not of the space around it. */}
        <div className="absolute" style={slideBoxStyle(box)}>
          {drawing ? (
            // Dashed until they choose.
            <HighlightBoxes rects={[drawing]} boxClassName="rounded-xs border-[1.5px] border-dashed border-ink bg-ink/5" />
          ) : chosen ? (
            <HighlightBoxes
              rects={[chosen.rect]}
              boxClassName={
                chosen.kind === "lost"
                  ? "rounded-xs border-2 border-lost bg-lost-tint mix-blend-multiply animate-fade-in"
                  : "rounded-xs border-[1.5px] border-ink animate-fade-in"
              }
            />
          ) : null}
          {pending && (
            // A full width row at the menu's height: the spacer puts the menu under the box's left
            // edge and shrinks when the menu would run past the slide's right edge.
            <div
              ref={menuRef}
              role="group"
              aria-label="Highlight"
              className="pointer-events-none absolute left-0 right-0 z-10 flex cursor-auto select-text"
              style={{ top: menuTop(pending.rect, box?.height ?? 0) }}
            >
              <div aria-hidden className="min-w-0 shrink" style={{ flexBasis: pct(pending.rect.x) }} />
              <div className="pointer-events-auto flex shrink-0 animate-pop-in items-center rounded-md border border-hairline bg-surface p-1 shadow-popover origin-top-left">
                <button type="button" onClick={() => choose("lost")} className={item}>
                  <span aria-hidden className="size-2 rounded-full bg-lost" />
                  I&apos;m lost
                </button>
                <span aria-hidden className="h-5 w-px bg-hairline" />
                <button type="button" onClick={() => choose("save")} className={item}>
                  <span aria-hidden className="size-2 rounded-full border-[1.5px] border-ink" />
                  Save this
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {coarse && (
        <button
          type="button"
          aria-pressed={touchOn}
          onClick={() => {
            setTouchOn((on) => !on);
            cancel();
          }}
          className={`press absolute bottom-2 right-2 z-10 rounded-md border px-3 py-1.5 type-small-strong focus-ring ${
            touchOn ? "border-ink bg-ink text-surface" : "border-hairline bg-surface text-ink"
          }`}
        >
          Highlight
        </button>
      )}
    </>
  );
}
