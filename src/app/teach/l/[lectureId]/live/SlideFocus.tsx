"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { HighlightBoxes } from "@/components/HighlightBoxes";
import { buttonSecondaryClass } from "@/components/ButtonPrimary";
import { Icon } from "@/components/Icon";
import type { Rect } from "@/lib/rect";

/** Every student's box, translucent: where most people pointed comes out darkest (Figma 34:862). */
const BOX = "rounded-xs bg-lost/20";

type Props = {
  number: number;
  firstLine: string;
  /** The signed image url, once there is one. Until then (or with no image) a blank slide. */
  url?: string;
  /** Every counted Mark the spot box on this slide. */
  rects: Rect[];
  /** "3 marked the spot", or nothing, for the big view's caption. */
  marksLabel: string | null;
};

/** The slide while its image is not there: a blank slide of the usual shape with its first line. */
function Blank({ firstLine }: { firstLine: string }) {
  return (
    <div className="flex aspect-video w-full items-center justify-center bg-surface p-6">
      {firstLine && <span className="line-clamp-2 text-center type-small text-secondary">{firstLine}</span>}
    </div>
  );
}

/**
 * The selected slide, large, with every student's Mark the spot box on it. It fills the
 * panel's width; pressing it opens the slide bigger still, over the page (a modal dialog:
 * Esc, Close or a press on the dimmed page close it, and focus goes back to the slide).
 */
export function SlideFocus({ number, firstLine, url, rects, marksLabel }: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  useEffect(() => {
    if (open) closeButton.current?.focus();
  }, [open]);

  // Esc closes; Tab stays on Close, the one control in the dialog.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      e.preventDefault();
      closeButton.current?.focus();
    }
  }

  const slide = (big: boolean) => (
    <div
      className={`relative overflow-hidden rounded-sm bg-surface shadow-slide ${big ? "inline-block max-w-full" : "w-full"}`}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={big ? `Slide ${number}` : ""}
          draggable={false}
          className={big ? "block h-auto max-h-[calc(100dvh-160px)] w-auto max-w-full" : "block h-auto w-full"}
        />
      ) : (
        <div className={big ? "w-[min(1280px,calc(100vw-64px))]" : "w-full"}>
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
        onClick={() => setOpen(true)}
        className="group press focus-ring relative block w-full cursor-zoom-in rounded-sm text-left"
      >
        {slide(false)}
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
              onKeyDown={onKeyDown}
              className="flex max-h-full max-w-full animate-pop-in flex-col gap-4 rounded-md bg-bg p-4 shadow-popover sm:p-6"
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
              <div className="flex min-h-0 justify-center">{slide(true)}</div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
