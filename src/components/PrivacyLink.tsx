import Link from "next/link";

/** The quiet footer link to the Privacy page (Small, secondary, 44 px tall hit area). Placed by the page, not positioned here. */
export function PrivacyLink({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/privacy"
      className={`press focus-ring inline-block rounded-xs px-3 py-3 type-small text-secondary hover:text-ink ${className}`}
    >
      Privacy
    </Link>
  );
}
