"use client";

import { ErrorScreen } from "@/components/ErrorScreen";

// A safety net for every page without its own error.tsx (Home, Join, Privacy): anything that goes
// wrong that the page does not handle itself.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen reset={reset} />;
}
