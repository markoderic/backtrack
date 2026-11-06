"use client";

import { useState } from "react";
import { buttonPrimarySmallClass } from "@/components/ButtonPrimary";
import { Icon } from "@/components/Icon";
import { resumeLecture } from "./lecture-actions";
import { RESUME_FAILED_ERROR } from "./delete-lecture-copy";

/** A redirect is how the action says it worked (Next is already going to the projector). */
function isRedirect(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

/**
 * Opens an ended lecture again (the resumeLecture server action), for the Resume lecture button and
 * the ⋯ menu's Resume lecture. On success the action goes to the projector, so this only comes
 * back with an error.
 */
export function useResumeLecture(lectureId: string) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function resume() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await resumeLecture(lectureId);
      if (result?.error) setError(result.error);
    } catch (e) {
      if (!isRedirect(e)) setError(RESUME_FAILED_ERROR);
    } finally {
      setPending(false);
    }
  }
  return { pending, error, resume };
}

/**
 * Resume lecture on a past lecture's page (black, the main thing to do there): the lecture goes
 * live again with a new code, on the slide it was on, and the projector opens. For a teacher who
 * keeps one deck for the whole semester.
 */
export function ResumeLecture({ lectureId }: { lectureId: string }) {
  const { pending, error, resume } = useResumeLecture(lectureId);
  return (
    <div className="flex flex-col items-start gap-2">
      <button type="button" disabled={pending} aria-busy={pending || undefined} onClick={() => void resume()} className={buttonPrimarySmallClass}>
        {pending ? "Resuming" : "Resume lecture"}
      </button>
      {error && (
        <p role="alert" className="flex animate-fade-in items-center gap-2 type-small text-ink">
          <Icon name="alert" size={18} />
          {error}
        </p>
      )}
    </div>
  );
}
