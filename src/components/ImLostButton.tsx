"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type MouseEvent, type Ref } from "react";
import { Icon } from "./Icon";

/** How long the press look holds before the checked look shows (Parts: scale 0.96 for 120 ms). */
export const PRESS_MS = 120;

type Phase = "default" | "pressed" | "checked";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "type"> & {
  /**
   * This slide already has an I'm lost from this student: the button shows "Lost on slide N" with a
   * check (aria-pressed). A press on it then goes to onClick too, which takes the I'm lost back.
   */
  checked?: boolean;
  /** The slide on screen, for the checked label. */
  slide?: number;
  /** The button itself, so focus can come back to it after Undo. */
  ref?: Ref<HTMLButtonElement>;
};

/**
 * The I'm lost button: a full width red button with the shape, radius and height of the
 * Join button (48 px, radius md). Hover and press darken it; a press scales it to 0.96 for
 * 120 ms, then the checked look pops in ("Lost on slide 7" with a check, red tinted) and
 * stays for as long as that slide has the tap. With reduced motion there is no scale; the
 * checked look still shows.
 *
 * It is a toggle (aria-pressed): a press while checked also calls onClick, which takes the tap
 * back (batch K1). The second click of a double click (detail 2 and up) never reaches onClick,
 * so a fast double press can not record and take back in one go. Only the look lives here.
 */
/**
 * Enter held down repeats, and each repeat is a click (detail 0): it would take the tap back and record
 * it again. A repeated Enter does nothing; a new press of the key still works.
 */
export function ignoreHeldEnter(e: KeyboardEvent<HTMLElement>) {
  if (e.repeat && e.key === "Enter") e.preventDefault();
}

export function ImLostButton({ checked = false, slide, onClick, onKeyDown, className = "", ...props }: Props) {
  const [pressed, setPressed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const shown: Phase = pressed ? "pressed" : checked ? "checked" : "default";
  const checkedLabel = slide !== undefined ? `Lost on slide ${slide}` : "Lost on this slide";

  function onPress(e: MouseEvent<HTMLButtonElement>) {
    // The second click of a double click lands on the button it just changed: ignore it.
    if (e.detail > 1) return;
    if (checked) {
      onClick?.(e);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setPressed(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setPressed(false);
    }, PRESS_MS);
    onClick?.(e);
  }

  return (
    <button
      type="button"
      data-phase={shown}
      aria-pressed={checked}
      // Named for its state at once, also during the 120 ms press look.
      aria-label={checked ? checkedLabel : undefined}
      onClick={onPress}
      onKeyDown={(e) => {
        ignoreHeldEnter(e);
        onKeyDown?.(e);
      }}
      className={
        "flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-md border px-6 type-button whitespace-nowrap " +
        "focus-ring transition-[background-color,color,border-color,scale,outline-color] duration-(--dur-fast) ease-out " +
        (shown === "checked"
          ? "border-lost bg-lost-tint text-lost-hover hover:bg-surface motion-safe:active:scale-96"
          : shown === "pressed"
            ? "border-transparent bg-lost-hover text-surface motion-safe:scale-96"
            : "border-transparent bg-lost text-surface hover:bg-lost-hover active:bg-lost-hover motion-safe:active:scale-96") +
        ` ${className}`
      }
      {...props}
    >
      {shown === "checked" ? (
        // The check and label pop in on the spring (fade only with reduced motion).
        <span key="checked" className="flex animate-pop-in items-center gap-2">
          <Icon name="check" size={20} />
          {checkedLabel}
        </span>
      ) : (
        <span key="default">I&apos;m lost</span>
      )}
    </button>
  );
}
