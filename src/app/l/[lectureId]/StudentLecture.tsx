"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { InfoButton } from "@/components/InfoButton";
import { useLiveLecture } from "@/lib/useLiveLecture";
import { useSlideImages } from "@/lib/useSlideImages";

type Props = {
  lectureId: string;
  lectureName: string;
  courseName: string;
  /** The live slide the server read, so the first paint is already right. */
  initialSlide: number;
};

// No student component reads or shows the slide count: the screen only knows
// the slide the teacher is on and the ones before it. No keyboard shortcuts.
export function StudentLecture({ lectureId, lectureName, courseName, initialSlide }: Props) {
  const router = useRouter();
  const { state, back, forward, jumpToLive } = useLiveLecture(lectureId, initialSlide);
  const { urlFor } = useSlideImages(lectureId, state?.viewing);

  const ended = state?.ended ?? false;
  useEffect(() => {
    if (ended) router.replace(`/spots/${lectureId}`);
  }, [ended, lectureId, router]);

  const viewing = state?.viewing ?? initialSlide;
  const url = state ? urlFor(viewing) : undefined;
  const behind = state !== null && !state.following && state.viewing < state.live;

  return (
    <div className="fixed inset-0 flex flex-col bg-black text-white">
      <header className="flex items-start justify-between gap-3 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm">{courseName}</p>
          <p className="truncate">{lectureName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-red-500" />
            LIVE
          </span>
          <InfoButton />
        </div>
      </header>

      {state?.conn === "reconnecting" && (
        <p role="status" className="bg-white px-3 py-2 text-center text-black">
          Reconnecting...
        </p>
      )}

      <div className="relative min-h-0 flex-1">
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`Slide ${viewing}`} className="absolute inset-0 h-full w-full object-contain" />
        )}
      </div>

      <footer className="flex flex-col gap-3 p-3">
        {behind && (
          <button type="button" onClick={jumpToLive} className="w-full border border-white px-4 py-3">
            Jump to live, slide {state.live}
          </button>
        )}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={back}
            disabled={!state || state.viewing <= 1}
            className="min-w-24 border border-white px-4 py-3 disabled:opacity-40"
          >
            Back
          </button>
          <span className="text-2xl">{viewing}</span>
          <button
            type="button"
            onClick={forward}
            disabled={!state || state.viewing >= state.live}
            className="min-w-24 border border-white px-4 py-3 disabled:opacity-40"
          >
            Forward
          </button>
        </div>
      </footer>
    </div>
  );
}
