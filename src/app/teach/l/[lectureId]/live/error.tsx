"use client";

import { useRouter } from "next/navigation";

// A safety net for anything that goes wrong that the page does not handle itself.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-4">
      <p className="text-2xl">Something went wrong.</p>
      <button
        type="button"
        onClick={() => {
          // Reads the page on the server again, then draws it again.
          router.refresh();
          reset();
        }}
        className="self-start border border-current px-6 py-3"
      >
        Reload
      </button>
    </main>
  );
}
