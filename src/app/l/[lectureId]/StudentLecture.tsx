"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { InfoButton } from "@/components/InfoButton";
import { LogoMark } from "@/components/Logo";
import { loadOwnTaps, makeSend } from "@/lib/lostTapApi";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { QueueOp } from "@/lib/tapQueue";
import { useLiveLecture } from "@/lib/useLiveLecture";
import { useSlideImages } from "@/lib/useSlideImages";
import { HighlightLayer, type Highlight } from "./HighlightLayer";
import { LostButton, type Spot } from "./LostButton";
import { SlideStrip, type SpotKind } from "./SlideStrip";

const END_FLUSH_MS = 3000;
/** "Loading slide 7" shows only if the image takes longer than this. The next slide is preloaded, so it is rare. */
const LOADING_TEXT_MS = 300;
/** The My spots count is red this long after an I'm lost. */
const COUNT_RED_MS = 2000;
const WIDE = 16 / 9;

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
  const { state, back, forward, jumpToLive, goTo, recheck } = useLiveLecture(lectureId, initialSlide);
  const { urlFor } = useSlideImages(lectureId, state?.viewing);

  // The client is made when a tap is sent, not while rendering.
  const send = useMemo(() => (op: QueueOp) => makeSend(createBrowserSupabase(), lectureId)(op), [lectureId]);
  const loadOwn = useMemo(() => () => loadOwnTaps(createBrowserSupabase(), lectureId), [lectureId]);
  const [spots, setSpots] = useState<Spot[]>([]);
  // One dot per slide: red if any row there is an I'm lost, open if they are all saves.
  const spotKinds = useMemo(() => {
    const kinds = new Map<number, SpotKind>();
    for (const s of spots) if (kinds.get(s.slide) !== "lost") kinds.set(s.slide, s.kind);
    return kinds;
  }, [spots]);

  // The My spots count turns red for 2 s after an I'm lost (a new one starts the 2 s over).
  const [countRed, setCountRed] = useState(0);
  useEffect(() => {
    if (countRed === 0) return;
    const timer = setTimeout(() => setCountRed(0), COUNT_RED_MS);
    return () => clearTimeout(timer);
  }, [countRed]);
  const onTap = useCallback((kind: SpotKind) => {
    if (kind === "lost") setCountRed((n) => n + 1);
  }, []);

  // What the saved line is about: its highlight stays drawn on the slide while it shows.
  const [barInfo, setBarInfo] = useState<{ slide: number; kind: SpotKind; rect?: Highlight["rect"] } | null>(null);

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
  // The slide's own shape, from the image once it loads.
  const [ratio, setRatio] = useState(WIDE);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [slowKey, setSlowKey] = useState<string | null>(null);
  const ended = state?.ended ?? false;
  // Kept in a ref so a re-render (the count turning back from red, the loading text)
  // never restarts the 3 second bound below.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });
  useEffect(() => {
    if (!ended) return;
    let left = false;
    const leave = () => {
      if (left) return;
      left = true;
      clearTimeout(bound);
      routerRef.current.replace(`/spots/${lectureId}`);
    };
    const bound = setTimeout(leave, END_FLUSH_MS);
    void (flushRef.current?.(true) ?? Promise.resolve()).then(leave);
    return () => {
      left = true;
      clearTimeout(bound);
    };
  }, [ended, lectureId]);

  const viewing = state?.viewing ?? initialSlide;
  const url = state ? urlFor(viewing) : undefined;
  const behind = state !== null && !state.following && state.viewing < state.live;
  const reconnecting = state?.conn === "reconnecting";
  const live = state?.live ?? initialSlide;

  // The slide changes at once; the loading text only shows when the image is slow.
  const imageKey = url ?? `slide-${viewing}`;
  useEffect(() => {
    const timer = setTimeout(() => setSlowKey(imageKey), LOADING_TEXT_MS);
    return () => clearTimeout(timer);
  }, [imageKey]);
  const loading = slowKey === imageKey && loadedSrc !== url;

  const chosen = barInfo?.rect && barInfo.slide === viewing ? { kind: barInfo.kind, rect: barInfo.rect } : null;

  // The slide frame is a 16:9 box: the window width less the side padding, never
  // taller than the room left above the controls, centered; the controls are as wide
  // as it. A slide of another shape fits inside it at its own shape (an old 4:3 deck
  // shows the page background on its sides), so the controls never move between decks.
  const room = "max(calc(100cqh - var(--controls)), 96px)";
  const frameWidth = `min(100cqw, calc(${room} * ${WIDE}))`;
  const slideWidth = ratio >= WIDE ? frameWidth : `calc(${frameWidth} * ${ratio / WIDE})`;

  return (
    <div className="fixed inset-0 flex flex-col bg-bg text-ink">
      <header className="flex h-14 shrink-0 items-center gap-2 pl-4 pr-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <LogoMark size={22} />
          {/* Both truncate; the lecture name gives way first (a shrink factor under 1 would let the course overflow). */}
          <p className="min-w-0 truncate type-small-strong text-ink">{courseName}</p>
          <p className="min-w-0 shrink-[4] truncate type-lecture text-secondary max-sm:hidden">{lectureName}</p>
        </div>
        <Link
          href={`/spots/${lectureId}`}
          className="press touch-target relative flex shrink-0 items-center gap-1 rounded-md p-2 whitespace-nowrap hover:bg-surface focus-ring"
        >
          <span className="type-small text-secondary">My spots</span>
          <span
            data-count-red={countRed > 0 ? "" : undefined}
            className={`type-small-strong transition-colors duration-(--dur-slow) ease-out ${
              countRed > 0 ? "text-lost" : "text-ink"
            }`}
          >
            {spots.length}
          </span>
        </Link>
        {/* The popover lines up with the top bar's right edge, past the theme slot. */}
        <InfoButton panelClassName="-right-11" />
        {/* Room for the theme button, which comes with dark mode (not built yet). */}
        <span aria-hidden data-theme-slot="" className="size-9 shrink-0" />
      </header>
      {/* Always there, so a screen reader hears when the connection drops (the line above shows it). */}
      <p role="status" className="sr-only">
        {reconnecting ? "Reconnecting." : ""}
      </p>

      <main
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-6 pt-2 [--controls:264px] sm:px-4 sm:[--controls:224px]"
        style={{ containerType: "size" }}
      >
        <div className="flex h-full flex-col items-center justify-center gap-2">
          <div
            className="flex max-w-full shrink-0 items-center justify-center"
            style={{ width: frameWidth, aspectRatio: WIDE } as CSSProperties}
          >
            <div
              data-slide=""
              className="relative max-w-full shrink-0 rounded-sm bg-surface shadow-slide"
              style={{ width: slideWidth, aspectRatio: ratio } as CSSProperties}
            >
              {url && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    ref={imageRef}
                    src={url}
                    alt={`Slide ${viewing}`}
                    draggable={false}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      setLoadedSrc(img.getAttribute("src"));
                      if (img.naturalWidth > 0 && img.naturalHeight > 0) setRatio(img.naturalWidth / img.naturalHeight);
                    }}
                    className="absolute inset-0 h-full w-full rounded-sm object-contain"
                  />
                  <HighlightLayer
                    viewing={viewing}
                    imageRef={imageRef}
                    onChoose={(h) => addRef.current?.(h)}
                    chosen={chosen}
                  />
                </>
              )}
              {loading && (
                <p className="absolute inset-0 flex animate-fade-in items-center justify-center rounded-sm bg-surface type-small text-secondary">
                  Loading slide {viewing}
                </p>
              )}
            </div>
          </div>

          {/* At least 560 px (or the window) wide, so the saved line never wraps in a short, wide window. */}
          <div className="flex max-w-full shrink-0 flex-col gap-2" style={{ width: `max(${frameWidth}, min(100cqw, 560px))` }}>
            {/* Behind live on a phone, the slide number and Jump to live take a second line, so the strip keeps its room. */}
            <div
              data-controls=""
              className={`flex h-14 w-full items-center gap-3 ${
                behind ? "max-sm:h-auto max-sm:min-h-14 max-sm:flex-wrap max-sm:gap-y-2" : ""
              }`}
            >
              <div className="flex shrink-0">
                <button
                  type="button"
                  aria-label="Back"
                  onClick={back}
                  disabled={!state || state.viewing <= 1}
                  className={arrowClass}
                >
                  <Icon name="back" />
                </button>
                <button
                  type="button"
                  aria-label="Forward"
                  onClick={forward}
                  disabled={!state || state.viewing >= state.live}
                  className={arrowClass}
                >
                  <Icon name="forward" />
                </button>
              </div>
              <SlideStrip live={live} viewing={viewing} spots={spotKinds} onPick={goTo} />
              <div
                className={`flex shrink-0 items-center gap-2 whitespace-nowrap ${
                  behind ? "max-sm:basis-full max-sm:justify-center" : ""
                }`}
              >
                <span data-slide-number="" className="type-number-s text-ink">
                  {viewing}
                </span>
                {behind ? (
                  <button
                    type="button"
                    onClick={jumpToLive}
                    className="press touch-target relative rounded-md border border-ink px-3 py-1.5 type-small-strong text-ink hover:bg-surface focus-ring"
                  >
                    Jump to live, slide {state.live}
                  </button>
                ) : (
                  <span className="type-small text-secondary">{reconnecting ? "reconnecting" : "live"}</span>
                )}
              </div>
            </div>
            <LostButton
              key={lectureId}
              lectureId={lectureId}
              viewing={viewing}
              send={send}
              loadOwn={loadOwn}
              onSpots={setSpots}
              onTap={onTap}
              onBarChange={setBarInfo}
              reconnects={reconnects}
              onFlushReady={onFlushReady}
              onAddReady={onAddReady}
              // A refused tap usually means the lecture ended: read the status now, and
              // if it did, leave the same way as when Realtime says so.
              onRejected={recheck}
              idle={
                reconnecting ? (
                  <p className="animate-fade-in type-small text-secondary">
                    Reconnecting…
                  </p>
                ) : null
              }
            />
          </div>
        </div>
      </main>
    </div>
  );
}

// 36 px as designed; 44 on a touch screen (the two sit side by side, so the box itself grows).
const arrowClass =
  "press flex size-9 items-center justify-center rounded-md text-ink hover:enabled:bg-surface focus-ring disabled:opacity-30 pointer-coarse:size-11";
