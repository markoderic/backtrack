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

/**
 * The secondary button: white with a hairline border, the same Button type as the primary one,
 * 44 px tall (a touch target on its own). For every action that is not the one main action, in
 * place of underlined text links.
 */
export const buttonSecondaryClass =
  "press focus-ring inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-md border border-hairline bg-surface px-3 " +
  "type-button whitespace-nowrap text-ink hover:border-strip hover:bg-bg disabled:cursor-default disabled:text-secondary";

/** The primary look at the secondary size (44 px), for a main action inside a panel (Save note). */
export const buttonPrimarySmallClass =
  "press focus-ring inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-md bg-ink px-4 " +
  "type-button whitespace-nowrap text-surface hover:bg-ink-hover disabled:cursor-default disabled:bg-strip";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function ButtonPrimary({ className = "", type = "button", ...props }: ButtonProps) {
  return <button type={type} className={`${buttonPrimaryClass} ${className}`} {...props} />;
}

type LinkProps = ComponentProps<typeof Link>;

/** The same look on a link, for a primary action that navigates (Home's Join a class). */
export function ButtonPrimaryLink({ className = "", ...props }: LinkProps) {
  return <Link className={`${buttonPrimaryClass} ${className}`} {...props} />;
}
