"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HighlightBoxes } from "@/components/HighlightBoxes";
import { buttonSecondaryClass } from "@/components/ButtonPrimary";
import { Icon } from "@/components/Icon";
import type { Rect } from "@/lib/rect";
import { boxOpacity, glowOpacity, overlapDepth } from "@/lib/markDepth";
import { glowStep, markLook, useSlideSample, type MarkTone } from "@/lib/slideTone";

/**
 * Every student's red mark, in the student's red, with no border (batch L), in the look that shows on
 * the part of the slide under it (batch M, lib/slideTone):
 * - light: the highlighter red (--color-mark-lost). The boxes stack inside their own layer with darken,
 *   so a pile only gets more opaque, never darker than one full mark; the layer is multiplied over the
 *   slide (the text under it stays readable, globals.test.ts).
 * - dark: the glow red (--color-mark-lost-glow). The same in reverse: lighten inside the layer (a pile
 *   is never brighter than one full glow), the layer screened over the slide; one layer per strength
 *   step (0.1), at the step its boxes allow (white text 4.5:1, lib/slideTone).
 * - edge (the slide could not be measured, or a mid gray): the red fill at 30% for the whole pile
 *   (darken inside an isolated layer at 30%), and each box's 2 px inner edge in the lost red on top,
 *   at full strength alone and never under 0.7 in a crowd (glowOpacity), so every box shows.
 * Each box's opacity drops as more boxes stack up on the slide (boxOpacity; glowOpacity for the glow,
 * which keeps a higher floor so it shows on black), so where most people pointed comes out strongest
 * step by step, and a box drawn alone among many is still there to see.
 */
const LOOKS = {
  light: { box: "rounded-xs bg-mark-lost mix-blend-darken", layer: "isolate mix-blend-multiply" },
  dark: { box: "rounded-xs bg-mark-lost-glow mix-blend-lighten", layer: "isolate mix-blend-screen" },
  edge: { box: "rounded-xs bg-mark-lost mix-blend-darken", layer: "isolate opacity-30" },
} as const;
const EDGE_RING = "rounded-xs inset-ring-2 inset-ring-lost";
/** The shape a slide is drawn at until its image says otherwise. */
const WIDE = 16 / 9;

type Props = {
  number: number;
  firstLine: string;
  /** The signed image url, once there is one. Until then (or with no image) a blank slide. */
  url?: string;
  /** Every red mark shown on this slide (each one a box). */
  rects: Rect[];
  /** "3 highlights", or nothing, for the big view's caption. */
  marksLabel: string | null;
  /** Called when the big view opens (the data view pins the slide then, so it never swaps). */
  onOpen?: () => void;
  /** The shape to draw the slide at until its image loads (the last slide's shape). */
  ratio?: number;
  /** Told the image's own shape once it loads. */
  onRatio?: (ratio: number) => void;
};

/** The slide while its image is not there: a blank slide with its first line. */
function Blank({ firstLine }: { firstLine: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface p-6">
      {firstLine && <span className="line-clamp-2 text-center type-small text-secondary">{firstLine}</span>}
    </div>
  );
}

/**
 * The selected slide, large, with every student's red mark on it. It fills the
 * panel's width at the slide's own shape (the last image's shape until this one loads, so
 * nothing below jumps); pressing it opens the slide bigger still, over the page. The big view
 * is a modal dialog: Esc, Close or a press on the dimmed page close it, Tab stays on Close (also
 * after a click on the slide inside it), the page behind does not scroll, and focus goes back
 * to the slide.
 */
export function SlideFocus({ number, firstLine, url, rects, marksLabel, onOpen, ratio: guess, onRatio }: Props) {
  const [open, setOpen] = useState(false);
  const [own, setOwn] = useState<number | null>(null);
  // How deep the boxes stack on this slide sets how see-through each one is.
  const depth = useMemo(() => overlapDepth(rects), [rects]);
  // The slide measured: each box takes the look that shows on the part of the slide under it.
  // Only a slide with marks is measured.
  const sample = useSlideSample(rects.length > 0 ? url : undefined);
  const { byTone, glowSteps } = useMemo(() => {
    const out: Record<MarkTone, Rect[]> = { light: [], dark: [], edge: [] };
    // Glowing boxes by strength step (lib/slideTone glowStep), one layer each: a pile in a layer is
    // never stronger than its step, and a box on a dim part never weakens the boxes on black.
    const steps = new Map<number, Rect[]>();
    for (const r of rects) {
      const look = markLook(sample, r, "lost");
      out[look.tone].push(r);
      if (look.tone === "dark") {
        const step = glowStep(look.opacity ?? 1);
        steps.set(step, [...(steps.get(step) ?? []), r]);
      }
    }
    return { byTone: out, glowSteps: [...steps].sort((x, y) => y[0] - x[0]) };
  }, [rects, sample]);
  // On a dark part the glow keeps a higher floor (glowOpacity), so a box alone in a crowd still shows on
  // black. The edge look's rings stay strong (a box in a crowd shows on any color); only its fill fades.
  const opacityOf = (tone: MarkTone) => (tone === "dark" ? glowOpacity(depth) : boxOpacity(depth));
  const boxes = (
    <>
      {(["light", "edge"] as const).map(
        (tone) =>
          byTone[tone].length > 0 && (
            <HighlightBoxes key={tone} tone={tone} rects={byTone[tone]} boxClassName={LOOKS[tone].box} className={LOOKS[tone].layer} opacity={opacityOf(tone)} />
          ),
      )}
      {glowSteps.map(([step, list]) => (
        <HighlightBoxes
          key={`dark-${step}`}
          tone="dark"
          rects={list}
          boxClassName={LOOKS.dark.box}
          className={LOOKS.dark.layer}
          opacity={opacityOf("dark")}
          layerOpacity={step < 1 ? step : undefined}
        />
      ))}
      {byTone.edge.length > 0 && <HighlightBoxes key="edge-ring" tone="edge" counted={false} rects={byTone.edge} boxClassName={EDGE_RING} opacity={glowOpacity(depth)} />}
    </>
  );
  const ratio = own ?? guess ?? WIDE;
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  // While open: focus starts on Close; Esc and Tab are heard on the whole document, so a click
  // on the slide or the title (which moves focus off Close) never lets them reach the page.
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === "Tab") {
        e.preventDefault();
        closeButton.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  const small = (
    <div
      data-testid="slide-box"
      className="relative w-full overflow-hidden rounded-sm bg-surface shadow-slide"
      style={{ aspectRatio: ratio }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          draggable={false}
          onLoad={(e) => {
            const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
            if (w > 0 && h > 0) {
              setOwn(w / h);
              onRatio?.(w / h);
            }
          }}
          className="absolute inset-0 block h-full w-full"
        />
      ) : (
        <Blank firstLine={firstLine} />
      )}
      {boxes}
    </div>
  );

  const big = (
    <div className="relative inline-block max-w-full overflow-hidden rounded-sm bg-surface shadow-slide">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`Slide ${number}`}
          draggable={false}
          className="block h-auto max-h-[calc(100dvh-160px)] w-auto max-w-full"
        />
      ) : (
        <div className="w-[min(1280px,calc(100vw-64px))]" style={{ aspectRatio: ratio }}>
          <Blank firstLine={firstLine} />
        </div>
      )}
      {boxes}
    </div>
  );

  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-testid={`highlights-${number}`}
        aria-haspopup="dialog"
        aria-label={`Enlarge slide ${number}`}
        onClick={() => {
          onOpen?.();
          setOpen(true);
        }}
        className="group press focus-ring relative block w-full cursor-zoom-in rounded-sm text-left"
      >
        {small}
        <span
          aria-hidden
          className="pointer-events-none absolute right-2 bottom-2 rounded-sm bg-surface/90 px-2 py-0.5 type-caption text-ink opacity-0 shadow-popover transition-opacity duration-(--dur-fast) ease-out group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          Enlarge
        </span>
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            data-testid="slide-big-backdrop"
            className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-ink/40 p-4 sm:p-8"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              // A click inside keeps focus in the dialog (not on the page behind).
              tabIndex={-1}
              className="flex max-h-full max-w-full animate-pop-in flex-col gap-4 rounded-md bg-bg p-4 shadow-popover outline-hidden sm:p-6"
            >
              <div className="flex items-center gap-6">
                <p id={titleId} className="min-w-0 flex-1 truncate type-body-strong text-ink">
                  Slide {number}
                  {firstLine && <span className="type-body text-secondary">{`, ${firstLine}`}</span>}
                </p>
                {marksLabel && <p className="shrink-0 type-small text-secondary">{marksLabel}</p>}
                <button ref={closeButton} type="button" onClick={close} className={`${buttonSecondaryClass} h-9! px-3`}>
                  <Icon name="close" size={18} />
                  Close
                </button>
              </div>
              <div className="flex min-h-0 justify-center">{big}</div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
