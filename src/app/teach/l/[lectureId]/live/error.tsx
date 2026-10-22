"use client";

import { useRouter } from "next/navigation";
import { ButtonPrimary } from "@/components/ButtonPrimary";

// A safety net for anything that goes wrong that the page does not handle itself.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  return (
    <main className="flex min-h-screen w-full animate-rise-in flex-col items-center justify-center gap-6 bg-bg p-4 text-center">
      <p className="type-title text-ink">Something went wrong.</p>
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
