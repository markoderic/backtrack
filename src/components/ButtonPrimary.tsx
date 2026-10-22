import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";

/**
 * The primary button from Parts (one per screen): 300x48, ink, radius md, Button type.
 * Hover ink-hover, Disabled strip, Focus a 2px ink ring 4px out. Shrinks to fit a phone.
 * Hover fades the color in 120 ms, the focus ring fades in, and a press scales it to 0.97.
 */
export const buttonPrimaryClass =
  "focus-ring inline-flex h-12 w-75 max-w-full shrink-0 items-center justify-center rounded-md px-6 type-button whitespace-nowrap " +
  "bg-ink text-surface hover:bg-ink-hover disabled:cursor-default disabled:bg-strip disabled:hover:bg-strip " +
  // Motion (shared press utility): hover color 120 ms ease-out, the focus ring fades in, a press scales to 0.97 on
  // the spring (not with reduced motion, not when disabled).
  "press";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function ButtonPrimary({ className = "", type = "button", ...props }: ButtonProps) {
  return <button type={type} className={`${buttonPrimaryClass} ${className}`} {...props} />;
}

type LinkProps = ComponentProps<typeof Link>;

/** The same look on a link, for a primary action that navigates (Home's Join a class). */
export function ButtonPrimaryLink({ className = "", ...props }: LinkProps) {
  return <Link className={`${buttonPrimaryClass} ${className}`} {...props} />;
}
