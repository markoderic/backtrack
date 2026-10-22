"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { clampSlide, slideKeyAction } from "@/lib/slideKeys";
import { useSlideImages } from "@/lib/useSlideImages";
import { useJoinedCount } from "@/lib/useJoinedCount";
import { useLiveLecture } from "@/lib/useLiveLecture";
import { LogoMark } from "@/components/Logo";
import { Icon } from "@/components/Icon";
import { ButtonPrimary, ButtonPrimaryLink } from "@/components/ButtonPrimary";
import { textLinkClass } from "../../../ui";

type Props = {
  lectureId: string;
  code: string;
  /** The site address without the protocol, as students type it. */
  siteAddress: string;
  initialSlide: number;
  slideCount: number;
  /** Where "Back to the course" goes once the lecture has ended. */
  courseId?: string;
};

/** How long the join card takes to fade out on the first arrow (--dur-slow, plus room). */
const JOIN_FADE_MS = 400;

/**
 * A slide change that has not come back in this long is given up: the request is aborted,
 * the teacher sees "Couldn't move to slide N. Try again." and the keys work again.
 */
export const SLIDE_WRITE_TIMEOUT_MS = 8000;

class TimedOut extends Error {}

/** Resolves with `request`, or aborts it and rejects with TimedOut after `ms`. */
function within<T>(request: PromiseLike<T>, ms: number, controller: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(request),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new TimedOut());
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** sessionStorage key: the join card of this lecture was put away in this tab. */
export const joinCardKey = (lectureId: string) => `backtrack:joincard:${lectureId}`;

function joinCardSeen(lectureId: string): boolean {
  try {
    return window.sessionStorage.getItem(joinCardKey(lectureId)) !== null;
  } catch {
    return false;
  }
}

function markJoinCardSeen(lectureId: string): void {
  try {
    window.sessionStorage.setItem(joinCardKey(lectureId), "1");
  } catch {
    // Storage is blocked: the card just shows again on the next open at slide 1.
  }
}

// The key is only read, never watched: it changes only from this page's own key press.
const noSubscribe = () => () => {};

/**
 * The code as the design shows it, "482 916": two groups of three with a gap. The gap is
 * an empty span, so the text is still the six digits in a row ("482916") for copying,
 * screen readers and tests.
 */
function Code({ code }: { code: string }) {
  if (code.length !== 6) return <>{code}</>;
  return (
    <>
      {code.slice(0, 3)}
      <span aria-hidden className="inline-block w-[0.24em]" />
      {code.slice(3)}
    </>
  );
}

/*
 * The join card (Figma 34:821) is drawn for a 1920 x 1080 projector. Every size is
 * min(design px, the same size on a 1440 wide screen), so it is exact on a projector and
 * shrinks with a narrower window instead of running off the side.
 */
function JoinCard({
  code,
  siteAddress,
  joined,
  ghost = false,
  onFaded,
  onStart,
}: {
  code: string;
  siteAddress: string;
  joined: number | null;
  /** The copy that fades out after the first arrow. Hidden from screen readers and takes no clicks. */
  ghost?: boolean;
  onFaded?: () => void;
  /** A click anywhere on the card starts, like the first arrow (the card, not the controls above it). */
  onStart?: () => void;
}) {
  return (
    <div
      {...(ghost
        ? {
            "aria-hidden": true,
            onAnimationEnd: onFaded,
            className:
              "pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-[min(72px,5vw)] bg-bg px-4 " +
              "[animation:fade-in_var(--dur-slow)_var(--ease-in-out)_reverse_both]",
          }
        : {
            "data-testid": "join-card",
            onClick: onStart,
            className:
              "absolute inset-0 z-10 flex cursor-pointer flex-col items-center justify-center gap-[min(72px,5vw)] bg-bg px-4",
          })}
    >
      <span className="flex items-center gap-[min(16.8px,1.167vw)]">
        <LogoMark size={73} className="size-[min(72.8px,5.056vw)]!" />
        <span className="font-sans text-[min(72.8px,5.056vw)] leading-none font-semibold tracking-[-0.05em] whitespace-nowrap text-ink">
          backtrack
        </span>
      </span>
      <div className="flex items-end gap-[min(120px,8.333vw)] whitespace-nowrap">
        <div className="flex flex-col gap-[min(8px,0.556vw)]">
          <p className="font-sans text-[min(32px,2.222vw)] leading-[1.25] font-normal text-secondary">Go to</p>
          <p className="font-sans text-[min(64px,4.444vw)] leading-[1.125] font-medium tracking-[-0.02em] text-ink">
            {siteAddress}
          </p>
        </div>
        <div className="flex flex-col">
          <p className="font-sans text-[min(32px,2.222vw)] leading-[1.25] font-normal text-secondary">Enter</p>
          <p className="font-sans text-[min(160px,11.111vw)] leading-none font-light tracking-[-0.03em] text-ink">
            <Code code={code} />
          </p>
        </div>
      </div>
      {/* Always takes its line, so the card does not jump when the first count arrives. */}
      <p className="min-h-[1.25em] font-sans text-[min(32px,2.222vw)] leading-[1.25] font-normal text-secondary">
        {joined !== null && `${joined} joined`}
      </p>
      <p className="absolute right-16 bottom-12 type-small text-secondary">Press → or click to start</p>
    </div>
  );
}

/** Data, End class, Fullscreen and Show code: quiet text actions for the teacher, not for the room. */
const controlClass =
  "press focus-ring rounded-sm type-small-strong whitespace-nowrap text-secondary hover:text-ink";

export function Projector({ lectureId, code, siteAddress, initialSlide, slideCount, courseId }: Props) {
  const [current, setCurrent] = useState(initialSlide);
  // The join card shows by itself only on the first open of the lecture: still on slide 1 and
  // not put away before in this tab. Coming back from the data view, Resume or a reload goes
  // straight to the slide. The server has no sessionStorage, so it draws the card and the
  // first client render corrects it. Show code brings it back at any time; the first arrow or
  // a click puts it away again.
  const seen = useSyncExternalStore(
    noSubscribe,
    () => joinCardSeen(lectureId),
    () => false,
  );
  const [cardChoice, setCardChoice] = useState<boolean | null>(null);
  const joinCardShowing = cardChoice ?? (initialSlide === 1 && !seen);
  // The join card fading out after the first arrow, drawn over the slide and then removed.
  const [joinCardFading, setJoinCardFading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { urlFor, loaded } = useSlideImages(lectureId, current);
  // The signed url whose image failed to load (deleted object, expired url). A renewed url
  // for the same slide is a different string, so it is tried again.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const joined = useJoinedCount(lectureId);
  // Hears an End from anywhere else (the dashboard, a phone): Realtime, plus a read every 20 s.
  const ended = useLiveLecture(lectureId, initialSlide).state?.ended ?? false;
  const [endedHere, setEndedHere] = useState(false);
  const isEnded = ended || endedHere;
  // End class asks first, right here on the projector (no trip to the data view).
  const [confirming, setConfirming] = useState(false);
  const [ending, setEnding] = useState(false);
  const endButton = useRef<HTMLButtonElement>(null);
  const endArea = useRef<HTMLDivElement>(null);
  const confirmingRef = useRef(false);
  const endingRef = useRef(false);
  useEffect(() => {
    confirmingRef.current = confirming;
  }, [confirming]);

  // The key handler reads these instead of state, so a fast key press never sees a stale value.
  const currentRef = useRef(initialSlide);
  // The slide the teacher asked for last. A press while a change is still being saved moves
  // this on, and the newest one is sent when that save comes back, so a quick double press
  // on a clicker skips two slides instead of dropping one.
  const wantedRef = useRef(initialSlide);
  const joinCardRef = useRef(joinCardShowing);
  const endedRef = useRef(false);
  const updating = useRef(false);
  useEffect(() => {
    joinCardRef.current = joinCardShowing;
  }, [joinCardShowing]);
  useEffect(() => {
    if (isEnded) endedRef.current = true;
  }, [isEnded]);

  const go = useCallback(async () => {
    if (updating.current) return;
    updating.current = true;
    let target = wantedRef.current;
    try {
      while (wantedRef.current !== currentRef.current && !endedRef.current) {
        target = wantedRef.current;
        const from = currentRef.current;
        const supabase = createBrowserSupabase();
        // Only a live lecture moves, and only from the slide on screen: a write that timed out
        // but still lands later can't move the lecture once the slide has moved on.
        const write = new AbortController();
        const { data, error: updateError } = await within(
          supabase
            .from("lectures")
            .update({ current_slide: target })
            .eq("id", lectureId)
            .eq("status", "live")
            .eq("current_slide", from)
            .select("current_slide")
            .abortSignal(write.signal)
            .maybeSingle(),
          SLIDE_WRITE_TIMEOUT_MS,
          write,
        );
        if (updateError) throw new Error(updateError.message);
        if (data) {
          currentRef.current = target;
          setCurrent(target);
          setError(null);
          continue;
        }
        // No row moved: the lecture ended somewhere else, or it is not on the slide this screen
        // shows (an earlier write that timed out landed after all). Read where it is.
        const check = new AbortController();
        const { data: row, error: readError } = await within(
          supabase
            .from("lectures")
            .select("current_slide, status")
            .eq("id", lectureId)
            .abortSignal(check.signal)
            .maybeSingle(),
          SLIDE_WRITE_TIMEOUT_MS,
          check,
        );
        if (readError) throw new Error(readError.message);
        if (!row || row.status !== "live") {
          endedRef.current = true;
          setEndedHere(true);
          return;
        }
        // Show where the lecture really is; the press that assumed another slide is dropped.
        currentRef.current = row.current_slide;
        wantedRef.current = row.current_slide;
        setCurrent(row.current_slide);
        setError(null);
      }
    } catch {
      // Failed or timed out (the request was aborted). Presses made meanwhile are dropped with
      // it: the next press starts from the slide on screen, and nothing else is sent until then.
      wantedRef.current = currentRef.current;
      setError(`Couldn't move to slide ${target}. Try again.`);
    } finally {
      updating.current = false;
    }
  }, [lectureId]);

  // Puts the join card away (first arrow, or a click on it): it fades out over the slide.
  const putCardAway = useCallback(() => {
    if (!joinCardRef.current) return;
    joinCardRef.current = false;
    markJoinCardSeen(lectureId);
    setCardChoice(false);
    setJoinCardFading(true);
  }, [lectureId]);

  function showCard() {
    joinCardRef.current = true;
    setJoinCardFading(false);
    setCardChoice(true);
  }

  // Esc closes the confirm (closing a dialog, not a shortcut), and Keep going does the same;
  // both hand focus back to End class. A press outside closes it and leaves focus alone.
  const closeConfirm = useCallback((refocus: boolean) => {
    confirmingRef.current = false;
    setConfirming(false);
    if (refocus) endButton.current?.focus();
  }, []);

  // The only keys: a clicker's (arrows, Page Up and Down, Space) move the slide. No shortcuts.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const action = slideKeyAction(e);
      if (!action) return;
      if (endedRef.current) return;
      if (confirmingRef.current) {
        // Ending: the keys wait for it.
        if (endingRef.current) return;
        // Space on the confirm's own End class presses it: only a keyboard (Tab) gets focus
        // there, a clicker can't.
        if (e.key === " " && e.target instanceof HTMLElement && e.target.dataset.confirmEnd !== undefined) return;
        // A teacher holding only a clicker is never stuck behind the confirm: a slide key is
        // Keep going plus the move.
        closeConfirm(false);
      }
      e.preventDefault();
      // The key moves the slide and never also presses the projector's own control that has
      // focus (End class after Keep going, Fullscreen, Data): some browsers press a focused
      // button on Space's keyup, which would open the confirm in front of the room.
      const active = document.activeElement;
      if (active instanceof HTMLElement && endArea.current?.contains(active)) active.blur();
      if (joinCardRef.current) {
        putCardAway();
        return;
      }
      const target = clampSlide(wantedRef.current + (action === "next" ? 1 : -1), slideCount);
      if (target === wantedRef.current) return;
      wantedRef.current = target;
      void go();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go, putCardAway, slideCount, closeConfirm]);

  useEffect(() => {
    if (!confirming || ending) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.repeat) return;
      e.preventDefault();
      closeConfirm(true);
    }
    function onPointerDown(e: PointerEvent) {
      if (e.target instanceof Node && endArea.current?.contains(e.target)) return;
      closeConfirm(false);
    }
    // In fullscreen the browser takes Esc to leave fullscreen and the page never sees the key,
    // so leaving fullscreen with the confirm open is the teacher's Esc: Keep going.
    function onFullscreenChange() {
      if (!document.fullscreenElement) closeConfirm(true);
    }
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [confirming, ending, closeConfirm]);

  async function endClass() {
    endingRef.current = true;
    setEnding(true);
    try {
      const { error: endError } = await createBrowserSupabase().rpc("end_lecture", { p_lecture_id: lectureId });
      if (endError) throw new Error(endError.message);
      endedRef.current = true;
      setEndedHere(true);
    } catch {
      closeConfirm(true);
      setError("Could not end the lecture.");
    } finally {
      endingRef.current = false;
      setEnding(false);
    }
  }

  // The fade ends with animationend; this is the fallback when no animation runs.
  useEffect(() => {
    if (!joinCardFading) return;
    const timer = setTimeout(() => setJoinCardFading(false), JOIN_FADE_MS);
    return () => clearTimeout(timer);
  }, [joinCardFading]);

  // The whole page goes fullscreen, not this component, so it stays fullscreen through Data and
  // back (both are client side, the document stays). Esc leaves fullscreen the browser's way.
  async function toggleFullscreen(e: React.MouseEvent<HTMLButtonElement>) {
    e.currentTarget.blur(); // Space must move the slide, not press this button again.
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen?.();
    } catch {
      setError("Could not change fullscreen.");
    }
  }

  const url = urlFor(current);
  // The slide has no image (no slide row or signed url once the list is in), or its image
  // failed to load: say so instead of an empty screen. The keys keep working.
  const missing = url ? brokenUrl === url : loaded;

  if (isEnded) {
    return (
      <main className="fixed inset-0 flex animate-page-in flex-col items-center justify-center gap-6 bg-bg p-4 text-center">
        <p role="status" className="type-title text-ink">
          This lecture has ended.
        </p>
        {courseId && <ButtonPrimaryLink href={`/teach/c/${courseId}`}>Back to the course</ButtonPrimaryLink>}
      </main>
    );
  }

  /*
   * One quiet row of controls, always shown (no fade), under the corner card. End class opens
   * its confirm right under the row. The row has no animation of its own, and the corner box
   * it sits in is z-20 over the slide and the join card (z-10), so the confirm is never under
   * anything: no animated ancestor traps it (see f27789f).
   */
  const controls = (
    <div
      ref={endArea}
      className="relative"
      // A non-modal popover, as in the data view: Tab out of it closes it, a press inside never
      // moves focus (so it never blurs shut), and switching windows leaves it open.
      onMouseDown={(e) => {
        if (confirming) e.preventDefault();
      }}
      onBlur={(e) => {
        if (!confirming || ending || !document.hasFocus()) return;
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        closeConfirm(false);
      }}
    >
      <div
        data-testid="projector-controls"
        className="flex items-center gap-4 rounded-md border border-hairline bg-surface px-4 py-2 shadow-popover"
      >
        <Link href={`/teach/l/${lectureId}/live`} className={controlClass}>
          Data
        </Link>
        <button
          ref={endButton}
          type="button"
          aria-expanded={confirming}
          aria-controls={confirming ? "end-class-confirm" : undefined}
          onClick={() => {
            if (confirming) closeConfirm(false);
            else {
              setError(null);
              setConfirming(true);
            }
          }}
          className={controlClass}
        >
          End class
        </button>
        <button type="button" onClick={toggleFullscreen} className={controlClass}>
          Fullscreen
        </button>
        {!joinCardShowing && (
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur(); // Space must move on from the card, not press this again.
              showCard();
            }}
            className={controlClass}
          >
            Show code
          </button>
        )}
      </div>
      {confirming && (
        <div
          id="end-class-confirm"
          role="dialog"
          aria-labelledby="end-class-title"
          aria-describedby="end-class-text"
          tabIndex={-1}
          className="absolute top-full right-0 z-30 mt-2 flex w-80 max-w-[calc(100vw-32px)] origin-top-right animate-pop-in flex-col gap-3 rounded-md border border-hairline bg-surface p-5 shadow-popover outline-hidden"
        >
          <p id="end-class-title" className="type-body-strong text-ink">
            End the lecture?
          </p>
          <p id="end-class-text" className="type-small text-ink">
            The code stops working and students land on My spots.
          </p>
          <div className="flex items-center gap-4">
            <ButtonPrimary
              // The one place Space keeps its button meaning while the confirm is open (see the keys).
              data-confirm-end=""
              disabled={ending}
              onClick={() => void endClass()}
              className="h-11! w-35!"
            >
              End class
            </ButtonPrimary>
            <button
              type="button"
              autoFocus
              disabled={ending}
              onClick={() => closeConfirm(true)}
              className={textLinkClass}
            >
              Keep going
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 overflow-hidden bg-bg text-ink">
      {/* The slide fills the screen at its own ratio and is never scaled past it. It swaps instantly. */}
      {url && !missing && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`Slide ${current}`}
          onError={() => setBrokenUrl(url)}
          className="h-full w-full object-contain"
        />
      )}
      {missing && (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <p role="status" className="type-title text-secondary">
            Slide {current} didn&apos;t load.
          </p>
        </div>
      )}

      {joinCardShowing && <JoinCard code={code} siteAddress={siteAddress} joined={joined} onStart={putCardAway} />}
      {joinCardFading && (
        <JoinCard code={code} siteAddress={siteAddress} joined={joined} ghost onFaded={() => setJoinCardFading(false)} />
      )}

      {/*
       * Top right, 32 from the corner (Figma 34:851). On the slide: the corner card with
       * address, code and joined, as in the design. Under it (alone there on the join card)
       * the teacher's controls, always shown.
       */}
      <div className="absolute top-8 right-8 z-20 flex max-w-[calc(100%-64px)] flex-col items-end gap-2">
        {!joinCardShowing && (
          <div
            data-testid="corner-card"
            className="flex animate-fade-in items-center gap-6 rounded-md border border-hairline bg-surface px-6 py-4 whitespace-nowrap shadow-popover"
          >
            <p className="type-body-strong text-ink">{siteAddress}</p>
            <p className="type-title text-ink">
              <Code code={code} />
            </p>
            {joined !== null && <p className="type-body text-secondary">{joined} joined</p>}
          </div>
        )}
        {controls}
      </div>

      {error && (
        <p
          role="alert"
          className="absolute bottom-8 left-1/2 z-20 flex -translate-x-1/2 animate-pop-in items-center gap-2 rounded-md border border-hairline bg-surface px-4 py-2.5 type-small whitespace-nowrap text-ink shadow-popover"
        >
          <Icon name="alert" size={18} />
          {error}
        </p>
      )}
    </div>
  );
}
