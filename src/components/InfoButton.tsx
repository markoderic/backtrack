"use client";

import { useEffect, useState } from "react";

/** A help button for a corner of the student screen. Opens a short panel. */
export function InfoButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Help"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-current"
      >
        ?
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Help"
          className="absolute right-0 top-12 z-20 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-3 border border-current bg-black p-4 text-white"
        >
          <p>Tap I&apos;m lost when you lose track. Backtrack saves the slide so you can come back to it after class.</p>
          <p>Nobody sees your name.</p>
          <button type="button" onClick={() => setOpen(false)} className="self-start border border-current px-4 py-2">
            Close
          </button>
        </div>
      )}
    </div>
  );
}
