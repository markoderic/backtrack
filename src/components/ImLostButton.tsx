"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type MouseEvent, type Ref } from "react";
import { Icon } from "./Icon";

/** How long the press look holds before the checked look shows (Parts: scale 0.96 for 120 ms). */
export const PRESS_MS = 120;

type Phase = "default" | "pressed" | "checked";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "type"> & {
  /**
   * This slide already has an I'm lost from this student: the button shows "Lost on slide N"
   * with a check and takes no second tap (Undo, next to it, gives the button back).
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
 * While checked it is aria-disabled, not disabled, so keyboard focus stays on it and a
 * second press does nothing. Only the look lives here: what a press records is up to onClick.
 */
export function ImLostButton({ checked = false, slide, onClick, className = "", ...props }: Props) {
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
    // One tap per slide: a checked button takes no second one.
    if (checked) return;
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
      aria-disabled={checked || undefined}
      // Named for its state at once, also during the 120 ms press look.
      aria-label={checked ? checkedLabel : undefined}
      onClick={onPress}
      className={
        "flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-md border px-6 type-button whitespace-nowrap " +
        "focus-ring transition-[background-color,color,border-color,scale,outline-color] duration-(--dur-fast) ease-out " +
        (shown === "checked"
          ? "cursor-default border-lost bg-lost-tint text-lost-hover"
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
