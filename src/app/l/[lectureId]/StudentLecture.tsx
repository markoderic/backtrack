"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { InfoButton } from "@/components/InfoButton";
import { loadOwnTaps, makeSend } from "@/lib/lostTapApi";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { QueueOp } from "@/lib/tapQueue";
import { useLiveLecture } from "@/lib/useLiveLecture";
import { useSlideImages } from "@/lib/useSlideImages";
import { HighlightLayer, type Highlight } from "./HighlightLayer";
import { LostButton } from "./LostButton";
import { SlideStrip } from "./SlideStrip";

const END_FLUSH_MS = 3000;

type Props = {
  lectureId: string;
  lectureName: string;
  courseName: string;
  /** The live slide the server read, so the first paint is already right. */
  initialSlide: number;
};

// No student component reads or shows the slide count: the screen only knows
// the slide the teacher is on and the ones before it (the strip runs 1 to live).
// No keyboard shortcuts, I'm lost included: it is only the button.
export function StudentLecture({ lectureId, lectureName, courseName, initialSlide }: Props) {
  const router = useRouter();
  const { state, back, forward, jumpToLive, goTo } = useLiveLecture(lectureId, initialSlide);
  const { urlFor } = useSlideImages(lectureId, state?.viewing);

  // The client is made when a tap is sent, not while rendering.
  const send = useMemo(() => (op: QueueOp) => makeSend(createBrowserSupabase(), lectureId)(op), [lectureId]);
  const loadOwn = useMemo(() => () => loadOwnTaps(createBrowserSupabase(), lectureId), [lectureId]);
  const [spots, setSpots] = useState<Set<number>>(new Set());

  // Counts the times the live connection came back, so the queue is sent again then.
  const conn = state?.conn;
  const [lastConn, setLastConn] = useState(conn);
  const [reconnects, setReconnects] = useState(0);
  if (conn !== lastConn) {
    setLastConn(conn);
    if (lastConn === "reconnecting" && conn === "live") setReconnects((n) => n + 1);
  }

  // A tap still waiting (made offline, or just before the end) is sent before leaving,
  // so it is not lost with this screen. If that takes over 3 seconds, leave anyway:
  // what is left stays in the queue for the spots page.
  const flushRef = useRef<((ending?: boolean) => Promise<void>) | null>(null);
  const onFlushReady = useCallback((flush: (ending?: boolean) => Promise<void>) => {
    flushRef.current = flush;
  }, []);
  // The highlight menu saves through the same queue, bar and Undo as the button.
  const addRef = useRef<((h: Highlight) => void) | null>(null);
  const onAddReady = useCallback((add: (h: Highlight) => void) => {
    addRef.current = add;
  }, []);
  const imageRef = useRef<HTMLImageElement>(null);
  const ended = state?.ended ?? false;
  useEffect(() => {
    if (!ended) return;
    let left = false;
    const leave = () => {
      if (left) return;
      left = true;
      clearTimeout(bound);
      router.replace(`/spots/${lectureId}`);
    };
    const bound = setTimeout(leave, END_FLUSH_MS);
    void (flushRef.current?.(true) ?? Promise.resolve()).then(leave);
    return () => {
      left = true;
      clearTimeout(bound);
    };
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
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imageRef}
              src={url}
              alt={`Slide ${viewing}`}
              draggable={false}
              className="absolute inset-0 h-full w-full object-contain"
            />
            <HighlightLayer viewing={viewing} imageRef={imageRef} onChoose={(h) => addRef.current?.(h)} />
          </>
        )}
      </div>

      <footer className="flex flex-col gap-3 p-3">
        {behind && (
          <button type="button" onClick={jumpToLive} className="w-full border border-white px-4 py-3">
            Jump to live, slide {state.live}
          </button>
        )}
        <SlideStrip live={state?.live ?? initialSlide} viewing={viewing} spotSlides={spots} onPick={goTo} />
        <LostButton
          key={lectureId}
          lectureId={lectureId}
          viewing={viewing}
          send={send}
          loadOwn={loadOwn}
          onSpots={setSpots}
          reconnects={reconnects}
          onFlushReady={onFlushReady}
          onAddReady={onAddReady}
          before={
            <>
              <button
                type="button"
                onClick={back}
                disabled={!state || state.viewing <= 1}
                className="min-w-20 border border-white px-3 py-3 disabled:opacity-40"
              >
                Back
              </button>
              <span className="min-w-8 text-center text-2xl">{viewing}</span>
            </>
          }
          after={
            <button
              type="button"
              onClick={forward}
              disabled={!state || state.viewing >= state.live}
              className="min-w-20 border border-white px-3 py-3 disabled:opacity-40"
            >
              Forward
            </button>
          }
        />
      </footer>
    </div>
  );
}
