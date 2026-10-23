"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/Icon";
import { buttonSecondaryClass } from "@/components/ButtonPrimary";
import { PICKER_HUES, PICKER_SWATCHES, normalizeHex } from "@/lib/courseDetails";
import { fieldClass, labelClass } from "../../ui";
import { usePopup } from "../../usePopup";

/**
 * The Custom color picker of the app's own (batch H fix round 1: Marko disliked the macOS system
 * panels, so no <input type="color">). A button shows the color; it opens a small popover with a
 * grid of 24 swatches (12 hues, a deeper and a lighter shade each) and the hex field.
 * Keyboard: the grid is one Tab stop (the picked swatch, else the first); ← → ↑ ↓ Home End move in
 * it; Enter or Space picks it and closes the popover, back on the button. Tab goes grid, hex field,
 * Done, and round again inside the popover; Esc or Done close it, back on the button. Enter in the
 * hex field closes it too. A press outside closes it.
 */
export function ColorPicker({
  value,
  onChange,
  disabled,
  describedBy,
  invalid,
}: {
  /** What is typed or picked so far (may be partial while typing). */
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  /** The form's error message, when it is about the color. */
  describedBy?: string;
  invalid: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const ids = useId();
  const panelId = `${ids}-panel`;
  const hexId = `${ids}-hex`;
  const hex = normalizeHex(value.startsWith("#") ? value : `#${value}`);
  const pickedAt = hex ? PICKER_SWATCHES.indexOf(hex) : -1;
  const [active, setActive] = useState(Math.max(0, pickedAt));

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }

  const place = usePopup({ open, close, trigger, panel, align: "left" });
  const placed = place !== null;

  // The keyboard starts on the picked swatch (or the first) once the popover is placed.
  useEffect(() => {
    if (!open || !placed) return;
    panel.current?.querySelector<HTMLElement>('[data-swatch-at][tabindex="0"]')?.focus({ preventScroll: true });
  }, [open, placed]);

  const swatches = () => Array.from(panel.current?.querySelectorAll<HTMLElement>("[data-swatch-at]") ?? []);

  function onGridKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const n = PICKER_SWATCHES.length;
    const at = active;
    const to =
      e.key === "ArrowRight"
        ? (at + 1) % n
        : e.key === "ArrowLeft"
          ? (at - 1 + n) % n
          : e.key === "ArrowDown"
            ? Math.min(n - 1, at + PICKER_HUES)
            : e.key === "ArrowUp"
              ? Math.max(0, at - PICKER_HUES)
              : e.key === "Home"
                ? 0
                : e.key === "End"
                  ? n - 1
                  : null;
    if (to === null) return;
    e.preventDefault();
    setActive(to);
    swatches()[to]?.focus({ preventScroll: true });
  }

  function onPanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    // Tab stays inside the popover: the grid's one stop, the hex field, Done.
    e.preventDefault();
    e.stopPropagation();
    const stops = Array.from(panel.current.querySelectorAll<HTMLElement>('[data-swatch-at][tabindex="0"], input, button[data-done]'));
    const at = stops.indexOf(document.activeElement as HTMLElement);
    stops[(at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={hex ? `Pick a color, now ${hex}` : "Pick a color"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-describedby={describedBy}
        data-testid="color-picker-trigger"
        disabled={disabled}
        onClick={() => {
          if (open) return close(false);
          setActive(Math.max(0, pickedAt));
          setOpen(true);
        }}
        className={`${buttonSecondaryClass} ${invalid ? "border-ink" : ""}`}
      >
        <span
          aria-hidden
          className={`size-5 shrink-0 rounded-full border border-hairline ${hex ? "" : "bg-course-rainbow"}`}
          style={hex ? { backgroundColor: hex } : undefined}
        />
        <span className="type-small">{hex ?? "Pick a color"}</span>
        <Icon name="forward" size={18} className="rotate-90 text-secondary" />
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panel}
            id={panelId}
            role="dialog"
            aria-label="Pick a custom color"
            data-testid="color-picker"
            onKeyDown={onPanelKeyDown}
            style={place ?? { top: 0, left: 0, visibility: "hidden" }}
            className="fixed z-50 flex max-w-[calc(100vw-16px)] animate-pop-in flex-col gap-3 rounded-md border border-hairline bg-surface p-3 shadow-popover"
          >
            <div role="group" aria-label="Colors" onKeyDown={onGridKeyDown} className="grid grid-cols-12 gap-1">
              {PICKER_SWATCHES.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  data-swatch-at={i}
                  tabIndex={i === active ? 0 : -1}
                  aria-label={c}
                  aria-pressed={c === hex}
                  onClick={() => {
                    onChange(c);
                    setActive(i);
                    close(true);
                  }}
                  className={
                    "press focus-ring size-6 rounded-full " +
                    (c === hex ? "shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-ink)]" : "")
                  }
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="flex items-end gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor={hexId} className={labelClass}>
                  Custom color
                </label>
                <input
                  id={hexId}
                  value={value}
                  maxLength={7}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="#2f6db5"
                  aria-invalid={invalid ? true : undefined}
                  aria-describedby={describedBy}
                  onChange={(e) => onChange(e.target.value.trim().toLowerCase())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      close(true);
                    }
                  }}
                  className={`${fieldClass} w-32!`}
                />
              </div>
              <button type="button" data-done onClick={() => close(true)} className={buttonSecondaryClass}>
                Done
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
