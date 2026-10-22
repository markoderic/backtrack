"use client";

import { useLinkStatus } from "next/link";

/**
 * Put inside a next/link: while the click is on its way to the next page it marks itself with
 * data-pending, so the link can hold its pressed look (`pendingPressClass`) until the page (or its
 * loading skeleton) shows. Nothing to see or read on its own.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden data-pending={pending ? "" : undefined} className="hidden" />;
}

/** The held press of a link with a <LinkPending /> inside: pressed in and a step darker until the next page shows. */
export const pendingPressClass =
  "has-[[data-pending]]:border-strip has-[[data-pending]]:bg-bg motion-safe:has-[[data-pending]]:scale-[0.97]";
