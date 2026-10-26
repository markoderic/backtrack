"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/**
 * The info button in the top right corner of the student screen. It opens a small
 * popover with how it works; all the help text lives here and nowhere else on the
 * screen. Esc, the button again, or a press anywhere else closes it.
 */
export function InfoButton({ panelClassName = "right-0" }: { panelClassName?: string } = {}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label="Help"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="press touch-target relative flex size-9 items-center justify-center rounded-md text-ink hover:bg-surface focus-ring aria-expanded:bg-surface"
      >
        <Icon name="info" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Help"
          className={`absolute ${panelClassName} top-full z-20 mt-1.5 flex w-80 max-w-[calc(100vw-16px)] animate-pop-in flex-col gap-3 rounded-md border border-hairline bg-surface p-4 text-ink shadow-popover origin-top-right`}
        >
          <p className="type-body-strong">How it works</p>
          <p className="type-small">Lost the thread? Tap I&apos;m lost. The slide is saved and the lecture keeps going. Save this keeps a slide just for you.</p>
          <p className="type-small">
            Turn on Mark and drag over any part of the slide. Yellow marks are just for you. On a slide where you&apos;re lost
            they&apos;re red, and your teacher sees the box but never its note.
          </p>
          <p className="type-small">Tap a mark to add a note or delete it. Tap I&apos;m lost or Saved for you again to take it back.</p>
          <p className="type-small">
            Type notes right on the page. They save by themselves and only you see them. On a slide where you&apos;re lost, the
            note for the teacher is the one your teacher reads. Drag the bar next to the slide to make it smaller or bigger; the notes take the room.
          </p>
          <p className="type-small">Nobody sees your name, not even your teacher. Your spots stay in this browser.</p>
        </div>
      )}
    </div>
  );
}
