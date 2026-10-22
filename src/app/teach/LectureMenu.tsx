"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { DeleteLectureDialog } from "./DeleteLecture";

/** The menu items: 44 px tall rows, Small strong, a quiet reason line under one that is off. */
const itemClass =
  "flex min-h-11 w-full flex-col items-start justify-center rounded-sm px-3 py-1.5 text-left type-small-strong text-ink outline-hidden " +
  "transition-colors duration-(--dur-fast) ease-out hover:bg-bg focus-visible:bg-bg " +
  "focus-visible:shadow-[inset_0_0_0_2px_var(--color-ink)] aria-disabled:cursor-default aria-disabled:text-secondary aria-disabled:hover:bg-transparent";

const GAP = 4;
const EDGE = 8;

type Place = { top?: number; bottom?: number; right: number };

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
  const [place, setPlace] = useState<Place | null>(null);
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const startAt = useRef<"first" | "last">("first");
  const ids = useId();
  const menuId = `${ids}-menu`;
  const placed = place !== null;

  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  function show(at: "first" | "last") {
    startAt.current = at;
    setOpen(true);
  }

  function close(refocus: boolean) {
    setOpen(false);
    setPlace(null);
    if (refocus) trigger.current?.focus();
  }

  // Under the button, right edges lined up; above the button when there is no room below.
  function measure() {
    if (!trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const h = menu.current?.offsetHeight ?? 0;
    const right = Math.max(EDGE, window.innerWidth - r.right);
    const roomBelow = window.innerHeight - r.bottom - GAP - EDGE;
    setPlace(
      h > roomBelow && r.top - GAP - EDGE > roomBelow
        ? { bottom: window.innerHeight - r.top + GAP, right }
        : { top: r.bottom + GAP, right },
    );
  }

  useLayoutEffect(() => {
    if (open) measure();
  }, [open]);

  // The keyboard goes into the menu once it is placed.
  useEffect(() => {
    if (!open || !place) return;
    const list = items();
    (startAt.current === "last" ? list[list.length - 1] : list[0])?.focus({ preventScroll: true });
    // Only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, placed]);

  // A press anywhere else closes it; a scroll or a resize carries it along with its button.
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (menu.current?.contains(t) || trigger.current?.contains(t)) return;
      close(false);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("touchstart", outside);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("touchstart", outside);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      show(e.key === "ArrowUp" ? "last" : "first");
    }
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => list[(i + list.length) % list.length]?.focus({ preventScroll: true });
    if (e.key === "ArrowDown") {
      e.preventDefault();
      go(at + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      go(at - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      go(0);
    } else if (e.key === "End") {
      e.preventDefault();
      go(list.length - 1);
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
