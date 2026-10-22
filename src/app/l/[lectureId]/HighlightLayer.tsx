"use client";

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { HighlightBoxes } from "@/components/HighlightBoxes";
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
};

const pct = (n: number) => `${Math.round(n * 1e6) / 1e4}%`;

/**
 * Sits over the slide image. A drag with a mouse or pen draws a box and opens a
 * small menu by it: I'm lost, Save this, and an optional note. On a touch screen
 * a small Highlight button turns drawing on first, so the page still scrolls. A
 * click, or a drag under 2% of the slide in both directions, does nothing. Esc or
 * a press anywhere else cancels. There is no keyboard shortcut.
 */
export function HighlightLayer({ viewing, imageRef, onChoose }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<{ rect: Rect; slide: number } | null>(null);
  const [note, setNote] = useState("");
  const [touchOn, setTouchOn] = useState(false);
  const [coarse, setCoarse] = useState(false);

  // A box drawn on another slide is not this slide's.
  if (pending && pending.slide !== viewing) {
    setPending(null);
    setNote("");
  }

  function cancel() {
    setPending(null);
    setNote("");
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
    const text = note.trim();
    onChoose({ kind, rect: pending.rect, ...(text ? { note: text } : {}) });
    cancel();
  }

  const shown = draft ?? pending?.rect ?? null;
  const placeBelow = pending ? pending.rect.y + pending.rect.h <= 0.7 : true;
  const centre = pending ? pending.rect.x + pending.rect.w / 2 : 0;

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
        {/* The box of the slide itself, so the rects are fractions of the slide and not of the black bars. */}
        <div className="absolute" style={slideBoxStyle(box)}>
          {shown && <HighlightBoxes rects={[shown]} />}
          {pending && (
            <div
              ref={menuRef}
              role="group"
              aria-label="Highlight"
              className="absolute z-10 flex w-64 max-w-full flex-col gap-2 border border-white bg-black p-2 text-white"
              style={{
                left: pct(centre),
                transform: `translateX(-${pct(centre)})`,
                ...(placeBelow
                  ? { top: `calc(${pct(pending.rect.y + pending.rect.h)} + 0.5rem)` }
                  : { bottom: `calc(${pct(1 - pending.rect.y)} + 0.5rem)` }),
              }}
            >
              <input
                type="text"
                maxLength={140}
                placeholder="Add a note. Optional"
                aria-label="Note, optional"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="h-10 min-w-0 border border-white bg-transparent px-2"
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => choose("lost")} className="h-10 flex-1 border border-white px-3">
                  I&apos;m lost
                </button>
                <button type="button" onClick={() => choose("save")} className="h-10 flex-1 border border-white px-3">
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
          className={`absolute bottom-2 right-2 z-10 border border-white px-3 py-2 text-sm ${touchOn ? "bg-white text-black" : "bg-black text-white"}`}
        >
          Highlight
        </button>
      )}
    </>
  );
}
