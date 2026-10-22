import type { CSSProperties } from "react";

/** The exported brand icons in public/brand (24x24 on a 1.6 stroke). */
export const ICON_NAMES = [
  "info",
  "theme",
  "back",
  "forward",
  "check",
  "close",
  "upload",
  "download",
  "alert",
  "edit",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

type Props = {
  name: IconName;
  /** Rendered size in px. The design uses icons at 20 (18 in the join message, 28 in the saved I'm lost). */
  size?: number;
  /** Gives the icon a name for screen readers. Without it the icon is decorative. */
  label?: string;
  className?: string;
};

/**
 * One of the exported icon files. The file is used as a mask and painted with the
 * current text color, so icons follow the color tokens (text-ink, text-secondary ...)
 * and will follow the dark theme later. Default color is ink.
 */
export function Icon({ name, size = 20, label, className = "" }: Props) {
  const url = `url(/brand/${name}.svg)`;
  const style: CSSProperties = {
    width: size,
    height: size,
    WebkitMaskImage: url,
    maskImage: url,
    WebkitMaskSize: "100% 100%",
    maskSize: "100% 100%",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
  };
  return (
    <span
      data-icon={name}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      className={`inline-block shrink-0 bg-current ${className}`}
      style={style}
    />
  );
}
