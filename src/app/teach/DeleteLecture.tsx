"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ButtonPrimary, buttonSecondaryClass } from "@/components/ButtonPrimary";
import { Icon } from "@/components/Icon";
import { deleteLecture } from "./lecture-actions";
import { DELETE_FAILED_ERROR } from "./delete-lecture-copy";

type DialogProps = {
  lectureId: string;
  lectureName: string;
  open: boolean;
  onClose: () => void;
  /** Where the keyboard goes back to when the confirm closes (the button that opened it). */
  returnFocusTo: RefObject<HTMLElement | null>;
};

/**
 * The Delete lecture confirm: one plain dialog (nothing to type). "Delete lecture" deletes for
 * good, "Keep it", Esc or a press on the dimmed page closes it. It is rendered into document.body
 * above everything (fixed, z-50), so no stacking context on the page can sit on top of its buttons
 * (the f27789f trap). The delete itself is the deleteLecture server action, which goes back to the
 * course page with "Lecture deleted." when it worked. Opened by the page's Delete lecture button
 * and by Delete in a lecture row's ⋯ menu.
 */
export function DeleteLectureDialog({ lectureId, lectureName, open, onClose, returnFocusTo }: DialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);
  const ids = useId();
  const titleId = `${ids}-title`;
  const textId = `${ids}-text`;

  // Back on the trigger after the confirm closes, so the keyboard keeps its place.
  useEffect(() => {
    if (!open && returnFocus.current) {
      returnFocus.current = false;
      returnFocusTo.current?.focus();
    }
  }, [open, returnFocusTo]);

  function close() {
    if (pending) return;
    returnFocus.current = true;
    setError(null);
    onClose();
  }

  async function confirm() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      // On success the action redirects to the course page, so this only comes back with an error.
      const result = await deleteLecture(lectureId);
      if (result?.error) setError(result.error);
    } catch (e) {
      // A redirect is how the action says it worked (Next is already going to the course page);
      // anything else is a real failure.
      if (!isRedirect(e)) setError(DELETE_FAILED_ERROR);
    } finally {
      setPending(false);
    }
  }

  // Esc closes; Tab stays inside the confirm while it is open.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab" || !dialog.current) return;
    const items = Array.from(dialog.current.querySelectorAll<HTMLElement>("button:not([disabled])"));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      data-testid="delete-lecture-backdrop"
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-ink/30 p-4"
      onMouseDown={(e) => {
        // A press on the dimmed page (not inside the confirm) closes it, like Keep it.
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        onKeyDown={onKeyDown}
        className="flex w-100 max-w-full animate-pop-in flex-col gap-3 rounded-md border border-hairline bg-surface p-6 shadow-popover"
      >
        <h2 id={titleId} className="type-title text-ink">
          Delete this lecture?
        </h2>
        <div id={textId} className="flex flex-col gap-1">
          <p className="type-lecture break-words text-ink">{lectureName}</p>
          <p className="type-small text-secondary">This deletes the lecture and its data for good.</p>
        </div>
        {error && (
          <p role="alert" className="flex animate-fade-in items-center gap-2 type-small text-ink">
            <Icon name="alert" size={18} />
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-4 pt-2">
          <ButtonPrimary disabled={pending} onClick={() => void confirm()} className="h-11! w-auto!">
            {pending ? "Deleting…" : "Delete lecture"}
          </ButtonPrimary>
          <button type="button" autoFocus disabled={pending} onClick={close} className={buttonSecondaryClass}>
            Keep it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Delete lecture on the past lecture page: a white button and its confirm. */
export function DeleteLecture({ lectureId, lectureName }: { lectureId: string; lectureName: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={trigger} type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className={buttonSecondaryClass}>
        Delete lecture
      </button>
      <DeleteLectureDialog
        lectureId={lectureId}
        lectureName={lectureName}
        open={open}
        onClose={() => setOpen(false)}
        returnFocusTo={trigger}
      />
    </>
  );
}

/** Next's redirect() throws an error whose digest starts with NEXT_REDIRECT. */
function isRedirect(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}
