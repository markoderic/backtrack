"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A plain dialog for the teacher screens (the course card's Edit details and Rename): a white panel
 * over the dimmed page, rendered into document.body above everything (fixed, z-50), like the
 * Delete lecture confirm. Esc or a press on the dimmed page closes it; Tab stays inside while it is
 * open; the keyboard starts on the element marked data-autofocus (else the first one it can reach)
 * and goes back to `returnFocusTo` when it closes. The panel scrolls inside itself on a short
 * window, so its buttons are always reachable.
 */
export function Dialog({
  open,
  onClose,
  title,
  returnFocusTo,
  children,
  wide = false,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  returnFocusTo: RefObject<HTMLElement | null>;
  children: ReactNode;
  /** The details form needs more room than a one-field rename. */
  wide?: boolean;
  testId?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      const root = panel.current;
      if (!root || root.contains(document.activeElement)) return;
      const first = root.querySelector<HTMLElement>("[data-autofocus]") ?? root.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      returnFocusTo.current?.focus();
    }
  }, [open, returnFocusTo]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      // Esc in a time or color field belongs to the field (it closes the browser's own picker).
      const t = e.target;
      if (t instanceof HTMLInputElement && (t.type === "time" || t.type === "color" || t.type === "date")) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => !(el instanceof HTMLInputElement && el.type === "radio" && !el.checked),
    );
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
      data-testid={testId ? `${testId}-backdrop` : undefined}
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-ink/30 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        onKeyDown={onKeyDown}
        className={
          "flex max-h-full max-w-full animate-pop-in flex-col gap-4 overflow-y-auto rounded-md border border-hairline bg-surface p-6 shadow-popover " +
          (wide ? "w-160" : "w-110")
        }
      >
        <h2 id={titleId} className="type-title text-ink">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
