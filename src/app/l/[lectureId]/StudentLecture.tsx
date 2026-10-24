"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buttonSecondaryClass } from "@/components/ButtonPrimary";
import { Icon } from "@/components/Icon";
import { InfoButton } from "@/components/InfoButton";
import { LogoMark } from "@/components/Logo";
import { loadOwnTaps, makeSend } from "@/lib/lostTapApi";
import { useTeacherNoteMax } from "@/lib/noteLimit";
import type { Rect } from "@/lib/rect";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { QueueOp } from "@/lib/tapQueue";
import { useLiveLecture } from "@/lib/useLiveLecture";
import { useTrackHere } from "@/lib/useHere";
import { useSlideImages } from "@/lib/useSlideImages";
import { HighlightLayer } from "./HighlightLayer";
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

/**
 * The student's live lecture screen. One markup, two layouts (globals.css, "student live
 * lecture"): on a laptop or a landscape tablet the slide fills the left (about 80%) with
 * its navigation right under it, and a sidebar on the right holds the lecture, Jump to
 * live, the I'm lost panel and My spots; on a phone or a narrow window it stacks the top
 * bar, the slide, the I'm lost panel and the slide strip.
 *
 * No student component reads or shows the slide count: the screen only knows the slide
 * the teacher is on and the ones before it (the strip runs 1 to live). No keyboard
 * shortcuts, I'm lost included: it is only the button.
 */
export function StudentLecture({ lectureId, lectureName, courseName, initialSlide }: Props) {
  const router = useRouter();
  const { state, back, forward, jumpToLive, goTo, recheck } = useLiveLecture(lectureId, initialSlide);
  const { urlFor } = useSlideImages(lectureId, state?.viewing);

  // The client is made when a tap is sent, not while rendering.
  const send = useMemo(() => (op: QueueOp) => makeSend(createBrowserSupabase(), lectureId)(op), [lectureId]);
  const loadOwn = useMemo(() => () => loadOwnTaps(createBrowserSupabase(), lectureId), [lectureId]);
  const [spots, setSpots] = useState<Spot[]>([]);
  // The note to the teacher: 2000 characters once the database has migration 0020, else 140.
  const noteMax = useTeacherNoteMax();
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
  // Mark the spot: the panel turns it on, the slide takes the drag, the panel saves the box.
  const markRef = useRef<((rect: Rect) => void) | null>(null);
  const onMarkReady = useCallback((mark: (rect: Rect) => void) => {
    markRef.current = mark;
  }, []);
  const [marking, setMarking] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  // The slide's own shape, from the image once it loads.
  const [ratio, setRatio] = useState(WIDE);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [slowKey, setSlowKey] = useState<string | null>(null);
  const ended = state?.ended ?? false;
  // This tab counts in the teacher's "here" while the lecture is live (on its own channel,
  // never the slide channel). My spots does not count.
  useTrackHere(lectureId, !ended);
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

  // Another slide ends marking: the box would belong to the slide just left.
  const [markedSlide, setMarkedSlide] = useState(viewing);
  if (markedSlide !== viewing) {
    setMarkedSlide(viewing);
    if (marking) setMarking(false);
  }

  // The slide changes at once; the loading text only shows when the image is slow.
  const imageKey = url ?? `slide-${viewing}`;
  useEffect(() => {
    const timer = setTimeout(() => setSlowKey(imageKey), LOADING_TEXT_MS);
    return () => clearTimeout(timer);
  }, [imageKey]);
  const loading = slowKey === imageKey && loadedSrc !== url;

  // The spot on the slide on screen (the I'm lost one, or else the save) and its mark.
  const active = useMemo(() => {
    let lost: Spot | null = null;
    let save: Spot | null = null;
    for (const s of spots) {
      if (s.slide !== viewing) continue;
      if (s.kind === "lost") lost = s;
      else save = s;
    }
    return lost ?? save;
  }, [spots, viewing]);
  const shown = active?.rect ? { kind: active.kind, rect: active.rect } : null;
  // One per slide, as on the My spots page (an older lecture may have two rows on one slide).
  const spotCount = spotKinds.size;

  const jumpLabel = state ? `Jump to live, slide ${state.live}` : "";

  // A move the student makes (Back, Forward, a strip dot, Jump to live) slides the new slide in;
  // the teacher moving a following student stays instant. Each move gets a new key, so the
  // slide's content mounts again with the short slide and fade (none with reduced motion).
  const [move, setMove] = useState<{ n: number; dir: "next" | "back"; slide: number; done: boolean } | null>(null);
  const moveTo = (target: number, go: () => void) => {
    if (state && target !== state.viewing && target >= 1 && target <= state.live) {
      const dir = target < state.viewing ? "back" : "next";
      setMove((m) => ({ n: (m?.n ?? 0) + 1, dir, slide: target, done: false }));
    }
    go();
  };
  const moving = move && !move.done && move.slide === viewing ? move.dir : null;
  const onBack = () => moveTo(viewing - 1, back);
  const onForward = () => moveTo(viewing + 1, forward);
  const onJump = () => moveTo(live, jumpToLive);
  const onPick = (n: number) => moveTo(Math.min(Math.max(Math.floor(n), 1), live), () => goTo(n));

  return (
    <div data-lecture="" className="text-ink" style={{ "--slide-ratio": ratio } as CSSProperties}>
      <div data-lecture-side="">
        <div data-lecture-top="">
          <div data-lecture-brand="" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <LogoMark size={22} />
            {/* Both truncate; the lecture name gives way first (a shrink factor under 1 would let the course overflow). */}
            <p className="min-w-0 flex-1 truncate type-small-strong text-ink narrow:flex-initial">{courseName}</p>
            <p
              data-lecture-name=""
              className="min-w-0 shrink-[4] truncate type-lecture text-secondary max-sm:hidden wide:block wide:basis-full"
            >
              {lectureName}
            </p>
          </div>
          <Link
            href={`/spots/${lectureId}`}
            data-lecture-spots=""
            className={`${buttonSecondaryClass} touch-target relative shrink-0 narrow:h-9 wide:w-full`}
          >
            My spots
            <span
              data-count-red={countRed > 0 ? "" : undefined}
              className={`transition-colors duration-(--dur-slow) ease-out ${countRed > 0 ? "text-lost" : "text-ink"}`}
            >
              {spotCount}
            </span>
          </Link>
          <div data-lecture-info="" className="flex shrink-0 justify-end">
            {/* The popover lines up with the right edge (of the top bar, or of the sidebar on a laptop). */}
            <InfoButton panelClassName="right-0" />
          </div>
          {/* The theme button comes with dark mode (not built yet); until then no empty slot at the edge. */}
        </div>
        <LostButton
          key={lectureId}
          lectureId={lectureId}
          viewing={viewing}
          send={send}
          loadOwn={loadOwn}
          onSpots={setSpots}
          onTap={onTap}
          reconnects={reconnects}
          onFlushReady={onFlushReady}
          marking={marking}
          onMarkingChange={setMarking}
          onMarkReady={onMarkReady}
          // A refused tap usually means the lecture ended: read the status now, and
          // if it did, leave the same way as when Realtime says so.
          onRejected={recheck}
          noteMax={noteMax}
          idle={reconnecting ? <p className="animate-fade-in type-small text-secondary">Reconnecting…</p> : null}
        />
        {behind && (
          // On a laptop, at the bottom of the sidebar above My spots: it comes and goes without moving
          // I'm lost, so a double click on it can never land on I'm lost.
          <button
            type="button"
            data-lecture-jump="side"
            onClick={onJump}
            className="press focus-ring flex h-12 w-full items-center justify-center rounded-md bg-ink px-4 type-button text-surface hover:bg-ink-hover"
          >
            {jumpLabel}
          </button>
        )}
      </div>
      {/* Always there, so a screen reader hears when the connection drops (the panel shows it). */}
      <p role="status" className="sr-only">
        {reconnecting ? "Reconnecting." : ""}
      </p>

      <div data-lecture-stage="">
        <div data-lecture-slide="" className="relative shrink-0">
          <div
            data-slide=""
            className="relative w-full overflow-hidden rounded-sm bg-surface shadow-slide"
            style={{ aspectRatio: ratio } as CSSProperties}
          >
            <div
              key={move?.n ?? 0}
              data-slide-content=""
              data-move={moving ?? undefined}
              // Its own animation only (a mark or the loading text inside fades in too).
              onAnimationEnd={(e) => {
                if (e.target === e.currentTarget) setMove((m) => m && { ...m, done: true });
              }}
              className={`absolute inset-0 ${
                moving === "back" ? "motion-safe:animate-slide-back" : moving === "next" ? "motion-safe:animate-slide-next" : ""
              }`}
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
                    imageRef={imageRef}
                    marking={marking && active !== null}
                    markingKind={active?.kind}
                    onMark={(rect) => markRef.current?.(rect)}
                    onCancel={() => setMarking(false)}
                    shown={shown}
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
          {behind && !marking && (
            // On a phone, Jump to live floats over the bottom edge of the slide (the sidebar has it on a laptop).
            <button
              type="button"
              data-lecture-jump="pill"
              onClick={onJump}
              className="press focus-ring absolute bottom-3 left-1/2 z-10 flex h-11 -translate-x-1/2 animate-pop-in items-center rounded-full bg-ink px-4 type-button whitespace-nowrap text-surface shadow-popover hover:bg-ink-hover"
            >
              {jumpLabel}
            </button>
          )}
        </div>

        <div data-lecture-nav="" data-controls="" className="flex h-11 min-w-0 items-center">
          <button
            type="button"
            aria-label="Back"
            onClick={onBack}
            disabled={!state || state.viewing <= 1}
            className={arrowClass}
          >
            <Icon name="back" />
          </button>
          <SlideStrip live={live} viewing={viewing} spots={spotKinds} onPick={onPick} />
          <button
            type="button"
            aria-label="Forward"
            onClick={onForward}
            disabled={!state || state.viewing >= state.live}
            className={arrowClass}
          >
            <Icon name="forward" />
          </button>
          <div className="ml-auto flex shrink-0 items-baseline gap-2 pl-3 whitespace-nowrap">
            <span data-slide-number="" className="type-number-s text-ink">
              {viewing}
            </span>
            {reconnecting ? (
              <span className="type-small text-secondary">reconnecting</span>
            ) : (
              !behind && <span className="type-small text-secondary">live</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// 44 px, a touch target on its own.
const arrowClass =
  "press flex size-11 shrink-0 items-center justify-center rounded-md text-ink hover:enabled:bg-surface focus-ring disabled:opacity-30";
