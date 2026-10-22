import Link from "next/link";

/** The quiet footer link to the Privacy page (Small, secondary). Placed by the page, not positioned here. */
export function PrivacyLink({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/privacy"
      className={`press focus-ring inline-block rounded-xs type-small text-secondary hover:text-ink ${className}`}
    >
      Privacy
    </Link>
  );
}
