"use client";

import { useRouter } from "next/navigation";
import { useShownAgain } from "@/lib/useShownAgain";

/**
 * Reads the page's server data again when Back (or a link) shows a page Next kept alive.
 * Without it the course page and the dashboard come back as they were: no Live now row for a
 * class just started, or a Live now row (with no Delete) for a class just ended.
 */
export function RefreshOnReturn() {
  const router = useRouter();
  useShownAgain(() => router.refresh());
  return null;
}
