"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { DeleteLectureDialog } from "./DeleteLecture";
import { moveFocus, usePopup } from "./usePopup";

/** The menu items: 44 px tall rows, Small strong, a quiet reason line under one that is off. */
const itemClass =
  "flex min-h-11 w-full flex-col items-start justify-center rounded-sm px-3 py-1.5 text-left type-small-strong text-ink outline-hidden " +
  "transition-colors duration-(--dur-fast) ease-out hover:bg-bg focus-visible:bg-bg " +
  "focus-visible:shadow-[inset_0_0_0_2px_var(--color-ink)] aria-disabled:cursor-default aria-disabled:text-secondary aria-disabled:hover:bg-transparent";

/**
 * The ⋯ button at the end of a lecture row (Marko, 2:05 PM: in place of a Delete that only
 * showed on hover). Always visible, 44 px. It opens a small menu:
 * - Download CSV: this lecture's export (an ended lecture; a live one says "When the class ends"),
 * - Resume: back to the projector (a live lecture only, for a projector closed by accident),
 * - Delete: the Delete lecture confirm (an ended lecture; a live one says "End the class first").
 * The menu is rendered into document.body (fixed, z-50), so the row's own animation can never put
 * a later row on top of it (no stacking trap). Keyboard: Enter, Space or ↓ opens it on the first
 * item (↑ on the last), ↑ ↓ Home End move, Esc or Tab closes it with the keyboard back on ⋯.
 * Items that are off stay reachable, so a screen reader hears why.
 */
export function LectureMenu({ lectureId, lectureName, live }: { lectureId: string; lectureName: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const startAt = useRef<"first" | "last">("first");
  const ids = useId();
  const menuId = `${ids}-menu`;

  function show(at: "first" | "last") {
    startAt.current = at;
    setOpen(true);
  }

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }

  // Placed under the button (above it when there is no room below) and carried along on scroll and
  // resize; a press elsewhere, Back or Forward (batch A review M2: Next keeps a visited page alive
  // but hidden, and a hidden page's effects are cleaned up) or leaving the page closes it.
  const place = usePopup({ open, close, trigger, panel: menu });
  const placed = place !== null;

  // The keyboard goes into the menu once it is placed.
  useEffect(() => {
    if (!open || !placed) return;
    const list = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    (startAt.current === "last" ? list[list.length - 1] : list[0])?.focus({ preventScroll: true });
  }, [open, placed]);

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      show(e.key === "ArrowUp" ? "last" : "first");
    }
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const list = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (moveFocus(e.key, list)) {
      e.preventDefault();
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  }

  // A live lecture has no CSV yet and can not be deleted: those items stay, off, with the reason under them.
  const csvReason = `${ids}-csv`;
  const deleteReason = `${ids}-delete`;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={`More for ${lectureName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : show("first"))}
        onKeyDown={onTriggerKeyDown}
        className={
          "press focus-ring flex size-11 shrink-0 items-center justify-center gap-[3px] rounded-md border border-transparent text-ink " +
          "hover:border-hairline hover:bg-surface aria-expanded:border-hairline aria-expanded:bg-surface"
        }
      >
        {/* Three plain dots (CSS circles), the ⋯. */}
        <span aria-hidden className="size-1 rounded-full bg-current" />
        <span aria-hidden className="size-1 rounded-full bg-current" />
        <span aria-hidden className="size-1 rounded-full bg-current" />
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            role="menu"
            aria-label={lectureName}
            data-testid="lecture-menu"
            onKeyDown={onMenuKeyDown}
            style={place ?? { top: 0, right: 0, visibility: "hidden" }}
            className="fixed z-50 flex w-56 animate-pop-in flex-col rounded-md border border-hairline bg-surface p-1.5 shadow-popover"
          >
            {live ? (
              <div role="menuitem" tabIndex={-1} aria-disabled aria-describedby={csvReason} className={itemClass}>
                Download CSV
                <span id={csvReason} className="type-caption text-secondary">
                  When the class ends
                </span>
              </div>
            ) : (
              // A plain link, not next/link: it downloads a file and must not be prefetched as a page.
              <a role="menuitem" tabIndex={-1} href={`/teach/l/${lectureId}/export`} download onClick={() => close(true)} className={itemClass}>
                Download CSV
              </a>
            )}
            {live && (
              <Link role="menuitem" tabIndex={-1} href={`/teach/l/${lectureId}/present`} onClick={() => close(false)} className={itemClass}>
                Resume
              </Link>
            )}
            {live ? (
              <div role="menuitem" tabIndex={-1} aria-disabled aria-describedby={deleteReason} className={itemClass}>
                Delete
                <span id={deleteReason} className="type-caption text-secondary">
                  End the class first
                </span>
              </div>
            ) : (
              <button
                role="menuitem"
                tabIndex={-1}
                type="button"
                aria-haspopup="dialog"
                onClick={() => {
                  close(false);
                  setConfirming(true);
                }}
                className={itemClass}
              >
                Delete
              </button>
            )}
          </div>,
          document.body,
        )}
      {!live && (
        <DeleteLectureDialog
          lectureId={lectureId}
          lectureName={lectureName}
          open={confirming}
          onClose={() => setConfirming(false)}
          returnFocusTo={trigger}
        />
      )}
    </>
  );
}
