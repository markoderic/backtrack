/* eslint-disable @next/next/no-img-element -- a fixed-size local SVG; next/image adds nothing here. */

type MarkProps = {
  /** Rendered size in px. Parts: 48 (mark alone), 52 (lockup L), 26 (lockup S), 22 (student top bar). */
  size?: number;
  className?: string;
};

/** The logo mark: the red spot behind the ink playhead (public/brand/logo-mark.svg). Decorative. */
export function LogoMark({ size = 48, className = "" }: MarkProps) {
  return (
    <img
      src="/brand/logo-mark.svg"
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={`block shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

const LOCKUP = {
  L: { mark: 52, gap: "gap-3", type: "type-wordmark-l" },
  S: { mark: 26, gap: "gap-2", type: "type-wordmark-s" },
} as const;

type LockupProps = {
  /** L for Home (mark 52, wordmark 52), S for page corners (mark 26, wordmark 20). */
  size?: keyof typeof LOCKUP;
  className?: string;
};

/** Mark + "backtrack" wordmark. Its accessible text is "backtrack". */
export function LogoLockup({ size = "L", className = "" }: LockupProps) {
  const s = LOCKUP[size];
  return (
    <span className={`flex w-fit items-center ${s.gap} ${className}`}>
      <LogoMark size={s.mark} />
      <span className={`${s.type} whitespace-nowrap text-ink`}>backtrack</span>
    </span>
  );
}
