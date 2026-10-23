"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HighlightBoxes } from "@/components/HighlightBoxes";
import { buttonSecondaryClass } from "@/components/ButtonPrimary";
import { Icon } from "@/components/Icon";
import type { Rect } from "@/lib/rect";

/** Every student's box, translucent: where most people pointed comes out darkest (Figma 34:862). */
const BOX = "rounded-xs bg-lost/20";
/** The shape a slide is drawn at until its image says otherwise. */
const WIDE = 16 / 9;

type Props = {
  number: number;
  firstLine: string;
  /** The signed image url, once there is one. Until then (or with no image) a blank slide. */
  url?: string;
  /** Every counted Mark the spot box on this slide. */
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
 * The selected slide, large, with every student's Mark the spot box on it. It fills the
 * panel's width at the slide's own shape (the last image's shape until this one loads, so
 * nothing below jumps); pressing it opens the slide bigger still, over the page. The big view
 * is a modal dialog: Esc, Close or a press on the dimmed page close it, Tab stays on Close (also
 * after a click on the slide inside it), the page behind does not scroll, and focus goes back
 * to the slide.
 */
export function SlideFocus({ number, firstLine, url, rects, marksLabel, onOpen, ratio: guess, onRatio }: Props) {
  const [open, setOpen] = useState(false);
  const [own, setOwn] = useState<number | null>(null);
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
      <HighlightBoxes rects={rects} boxClassName={BOX} />
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
      <HighlightBoxes rects={rects} boxClassName={BOX} />
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
