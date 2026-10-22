"use client";

import { useRouter } from "next/navigation";
import { ButtonPrimary } from "@/components/ButtonPrimary";

// A safety net for anything that goes wrong on the spots pages that they do not handle themselves.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  return (
    <main className="flex min-h-dvh w-full animate-page-in flex-col items-center justify-center gap-6 bg-bg p-4 pb-20 text-ink">
      <p className="type-title">Something went wrong.</p>
      <ButtonPrimary
        onClick={() => {
          // Reads the page on the server again, then draws it again.
          router.refresh();
          reset();
        }}
      >
        Reload
      </ButtonPrimary>
    </main>
  );
}
