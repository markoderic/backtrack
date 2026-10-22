"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";
import { ButtonPrimary } from "@/components/ButtonPrimary";

/**
 * What every error.tsx shows: one line and Reload, in the design system (page background,
 * Title, the primary button). Reload reads the page on the server again (router.refresh)
 * and draws it again (reset) in one transition, the same as Next's own retry(): reset()
 * alone would draw the same failed server payload again. The error's text is never shown.
 */
export function ErrorScreen({ reset }: { reset: () => void }) {
  const router = useRouter();
  return (
    <main className="flex min-h-dvh w-full animate-page-in flex-col items-center justify-center gap-6 bg-bg p-4 pb-20 text-center text-ink">
      <p className="type-title">Something went wrong.</p>
      <ButtonPrimary
        onClick={() =>
          startTransition(() => {
            router.refresh();
            reset();
          })
        }
      >
        Reload
      </ButtonPrimary>
    </main>
  );
}
