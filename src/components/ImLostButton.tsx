"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import { Icon } from "./Icon";

/** How long the press look holds before Saved shows (Parts: scale 0.96 for 120 ms). */
export const PRESS_MS = 120;
/** How long Saved (ring and check) shows before the button goes back to Default. */
export const SAVED_MS = 2000;

type Phase = "default" | "pressed" | "saved";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "type"> & {
  /** Overrides the look, for showing one state on its own. Left out, the button runs its own press then Saved. */
  phase?: Phase;
};

/**
 * The I'm lost button from Parts: an 88 round red button. Hover and press darken it
 * (lost-hover); a press scales it to 0.96 for 120 ms, then it shows Saved (a red
 * ring with a check) for 2 s and goes back to Default. With reduced motion there is
 * no scale, the Saved state still shows. Focus is a 2px ink ring 5px out.
 *
 * Only the look lives here. What a press records is up to onClick (LostButton).
 * Its name stays "I'm lost" in every state.
 */
export function ImLostButton({ phase: forced, onClick, className = "", ...props }: Props) {
  const [phase, setPhase] = useState<Phase>("default");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const list = timers.current;
    return () => list.forEach(clearTimeout);
  }, []);

  const shown = forced ?? phase;

  return (
    <button
      type="button"
      aria-label="I'm lost"
      data-phase={shown}
      onClick={(e) => {
        timers.current.forEach(clearTimeout);
        setPhase("pressed");
        timers.current = [
          setTimeout(() => setPhase("saved"), PRESS_MS),
          setTimeout(() => setPhase("default"), PRESS_MS + SAVED_MS),
        ];
        onClick?.(e);
      }}
      className={
        "flex size-22 shrink-0 items-center justify-center rounded-full type-button " +
        "focus-ring focus-visible:outline-offset-[5px] " +
        "transition-[background-color,scale] duration-(--dur-fast) ease-out " +
        (shown === "saved"
          ? // The ring and check pop in on the spring (fade only with reduced motion).
            "animate-pop-in border-2 border-lost bg-transparent text-ink"
          : shown === "pressed"
            ? "bg-lost-hover text-surface motion-safe:scale-96"
            : "bg-lost text-surface hover:bg-lost-hover active:bg-lost-hover motion-safe:active:scale-96") +
        ` ${className}`
      }
      {...props}
    >
      {shown === "saved" ? <Icon name="check" size={28} /> : <span aria-hidden>I&apos;m lost</span>}
    </button>
  );
}
