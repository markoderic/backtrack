"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { clampSlide, slideKeyAction } from "@/lib/slideKeys";
import { useSlideImages } from "@/lib/useSlideImages";
import { useJoinedCount } from "@/lib/useJoinedCount";
import { useLiveLecture } from "@/lib/useLiveLecture";
import { useShownAgain } from "@/lib/useShownAgain";
import { LogoMark } from "@/components/Logo";
import { Icon } from "@/components/Icon";
import { ButtonPrimary, buttonSecondaryClass } from "@/components/ButtonPrimary";
import { ClassEnded } from "./ClassEnded";

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

/** How long "Continued on slide N" stays in the bar. */
export const CONTINUED_MS = 4000;

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

/**
 * localStorage key: this lecture's projector was opened in this browser. Only the very first
 * open shows the join card; Data and back, a reload, Resume (in any tab) go to the slide.
 */
export const joinCardKey = (lectureId: string) => `backtrack:joincard:${lectureId}`;

function joinCardSeen(lectureId: string): boolean {
  try {
    return window.localStorage.getItem(joinCardKey(lectureId)) !== null;
  } catch {
    return false;
  }
}

function markJoinCardSeen(lectureId: string): void {
  try {
    window.localStorage.setItem(joinCardKey(lectureId), "1");
  } catch {
    // Storage is blocked: the card just shows again on the next open at slide 1.
  }
}

// The key is only read, never watched: it changes only from this page's own first open.
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
 * The join card (Figma 34:821) is drawn for a 1920 x 1080 projector: the logo up top, then one
 * centered block, "Go to <address>" over the code, and how many joined under it. Every size is
 * min(design px, the same size on a 1440 wide screen, a share of the height), so it is exact on
 * a projector and shrinks with a smaller window instead of running off the side.
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
  /** A click anywhere on the card starts, like the first arrow (the card, not the bar under it). */
  onStart?: () => void;
}) {
  return (
    <div
      {...(ghost
        ? {
            "aria-hidden": true,
            onAnimationEnd: onFaded,
            className:
              "pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center bg-bg px-4 " +
              "[animation:fade-in_var(--dur-slow)_var(--ease-in-out)_reverse_both]",
          }
        : {
            "data-testid": "join-card",
            onClick: onStart,
            className: "absolute inset-0 z-10 flex cursor-pointer flex-col items-center justify-center bg-bg px-4",
          })}
    >
      {/* The logo sits higher than the block: the gap under it is the biggest one on the card. */}
      <span className="mb-[min(136px,9.444vw,12vh)] flex items-center gap-[min(16.8px,1.167vw)]">
        <LogoMark size={73} className="size-[min(72.8px,5.056vw,6.5vh)]!" />
        <span className="font-sans text-[min(72.8px,5.056vw,6.5vh)] leading-none font-semibold tracking-[-0.05em] whitespace-nowrap text-ink">
          backtrack
        </span>
      </span>
      <div data-testid="join-block" className="flex flex-col items-center gap-[min(16px,1.111vw,1.5vh)] text-center whitespace-nowrap">
        <p className="font-sans text-[min(64px,4.444vw,6vh)] leading-[1.125] font-medium tracking-[-0.02em] text-ink">
          <span className="font-normal text-secondary">Go to </span>
          {siteAddress}
        </p>
        <p className="font-sans text-[min(160px,11.111vw,15vh)] leading-none font-light tracking-[-0.03em] text-ink">
          <Code code={code} />
        </p>
        {/* Always takes its line, so the card does not jump when the first count arrives. */}
        <p className="mt-[min(24px,1.667vw,2vh)] min-h-[1.25em] font-sans text-[min(32px,2.222vw,3vh)] leading-[1.25] font-normal text-secondary">
          {joined !== null && `${joined} joined`}
        </p>
      </div>
    </div>
  );
}

/** Data, Show code, Fullscreen and End class: quiet small text actions for the teacher, not for the room. */
const controlClass =
  "press focus-ring inline-flex h-8 items-center rounded-sm px-2 type-small-strong whitespace-nowrap text-secondary hover:bg-ink/5 hover:text-ink";

export function Projector({ lectureId, code, siteAddress, initialSlide, slideCount, courseId }: Props) {
  const [current, setCurrent] = useState(initialSlide);
  // The join card shows by itself only on the very first open of the lecture in this browser,
  // on slide 1. Data and back, a reload or Resume go straight to the slide (with "Continued on
  // slide N" when it is past the first). The server has no storage, so it draws the card on
  // slide 1 and the first client render corrects it; the choice is then pinned in state on
  // mount, since the first open writes the stored flag right away.
  const seen = useSyncExternalStore(
    noSubscribe,
    () => joinCardSeen(lectureId),
    () => false,
  );
  const [cardChoice, setCardChoice] = useState<boolean | null>(null);
  const joinCardShowing = cardChoice ?? (initialSlide === 1 && !seen);
  // The join card fading out after the first arrow, drawn over the slide and then removed.
  const [joinCardFading, setJoinCardFading] = useState(false);
  // "Continued on slide N" after reopening past the first slide, for a few seconds.
  const [continued, setContinued] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { urlFor, loaded } = useSlideImages(lectureId, current);
  // The image that failed to load on this visit to its slide (deleted object, expired url, a
  // network blip). Cleared whenever the slide changes, so coming back to the slide tries the
  // image again; a renewed url for the same slide is a different string and is tried too.
  const [broken, setBroken] = useState<{ slide: number; url: string } | null>(null);
  const joined = useJoinedCount(lectureId);
  // Hears an End from anywhere else (the dashboard, a phone): Realtime, plus a read every 20 s.
  // It also counts the students who have the lecture open right now (Realtime Presence).
  const live = useLiveLecture(lectureId, initialSlide, { presence: "count" });
  const ended = live.state?.ended ?? false;
  const here = live.here ?? null;
  const [endedHere, setEndedHere] = useState(false);
  const isEnded = ended || endedHere;
  // End class asks first, right here on the projector (no trip to the data view).
  const [confirming, setConfirming] = useState(false);
  const [ending, setEnding] = useState(false);
  // Show code: the address and the code, big, in a dialog over the slide.
  const [codeOpen, setCodeOpen] = useState(false);
  const endButton = useRef<HTMLButtonElement>(null);
  const endArea = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const showCodeButton = useRef<HTMLButtonElement>(null);
  const closeCodeButton = useRef<HTMLButtonElement>(null);
  const confirmingRef = useRef(false);
  const codeOpenRef = useRef(false);
  const endingRef = useRef(false);
  useEffect(() => {
    confirmingRef.current = confirming;
  }, [confirming]);
  useEffect(() => {
    codeOpenRef.current = codeOpen;
  }, [codeOpen]);

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

  // The first open: the join card only if this lecture's projector was never opened in this
  // browser and it is on slide 1. Pinned in state, since the stored flag is written right away.
  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    const first = initialSlide === 1 && !joinCardSeen(lectureId);
    markJoinCardSeen(lectureId);
    joinCardRef.current = first;
    /* eslint-disable react-hooks/set-state-in-effect -- the choice is pinned once, on the first open */
    setCardChoice(first);
    if (!first && initialSlide > 1) setContinued(initialSlide);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [initialSlide, lectureId]);

  // Next keeps this page alive while the teacher is on Data (or after browser Back) and shows
  // it again with its state: straight to the slide it was on, never back to the join card,
  // with no dialog left open.
  useShownAgain(() => {
    joinCardRef.current = false;
    confirmingRef.current = false;
    codeOpenRef.current = false;
    setCardChoice(false);
    setJoinCardFading(false);
    setConfirming(false);
    setCodeOpen(false);
    if (currentRef.current > 1) setContinued(currentRef.current);
  });

  // "Continued on slide N" goes away by itself, and as soon as the slide moves.
  useEffect(() => {
    if (continued === null) return;
    const timer = setTimeout(() => setContinued(null), CONTINUED_MS);
    return () => clearTimeout(timer);
  }, [continued]);

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
          setBroken(null);
          setCurrent(target);
          setError(null);
          setContinued(null);
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
        setBroken(null);
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

  // Esc closes the confirm (closing a dialog, not a shortcut), and Keep going does the same;
  // both hand focus back to End class. A press outside closes it and leaves focus alone.
  const closeConfirm = useCallback((refocus: boolean) => {
    confirmingRef.current = false;
    setConfirming(false);
    if (refocus) endButton.current?.focus();
  }, []);

  // Close (or Esc, a press outside, a slide key) puts the code dialog away. Focus goes back to
  // Show code, except after a slide key: that one is for the slides, like the first arrow.
  const closeCode = useCallback((refocus: boolean) => {
    codeOpenRef.current = false;
    setCodeOpen(false);
    if (refocus) showCodeButton.current?.focus();
  }, []);

  // The only keys: a clicker's (arrows, Page Up and Down, Space) move the slide. No shortcuts.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const action = slideKeyAction(e);
      if (!action) return;
      if (endedRef.current) return;
      if (codeOpenRef.current) {
        // The code dialog is up: the first slide key only puts it away, like the join card.
        e.preventDefault();
        closeCode(false);
        return;
      }
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
      // focus (End class after Keep going, Fullscreen, Show code, Data): some browsers press a
      // focused button on Space's keyup, which would open the confirm in front of the room.
      const active = document.activeElement;
      if (active instanceof HTMLElement && bar.current?.contains(active)) active.blur();
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
  }, [go, putCardAway, slideCount, closeConfirm, closeCode]);

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

  // The code dialog is modal: Esc closes it, Tab stays on its Close button, and leaving
  // fullscreen (the browser's Esc) closes it too. A press outside it is handled on the backdrop.
  useEffect(() => {
    if (!codeOpen) return;
    closeCodeButton.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Tab") {
        e.preventDefault();
        closeCodeButton.current?.focus();
        return;
      }
      if (e.key !== "Escape" || e.repeat) return;
      e.preventDefault();
      closeCode(true);
    }
    function onFullscreenChange() {
      if (!document.fullscreenElement) closeCode(true);
    }
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [codeOpen, closeCode]);

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
      setError("Could not end the class.");
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
  const missing = url ? broken?.slide === current && broken.url === url : loaded;

  if (isEnded) return <ClassEnded courseId={courseId} fixed />;

  // Students on the lecture page right now, never more than have joined (one student with
  // two tabs open counts once there).
  const hereCount = here !== null && joined !== null ? Math.min(here, joined) : null;
  const count =
    joined === null ? null : hereCount === null ? `${joined} joined` : `${hereCount} here · ${joined} joined`;


  /*
   * The bar: one slim quiet strip under the slide, never over it. Left, the address and code
   * small and who is here; middle, messages; right, the teacher's controls. End class opens its
   * confirm just above the bar. The bar has no animation of its own and is z-20 over the slide
   * area and the join card (z-10), so the confirm is never under anything: no animated ancestor
   * traps it (see f27789f).
   */
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-bg text-ink">
      <div data-testid="projector-stage" className="relative min-h-0 flex-1">
        {/* The slide fills the space above the bar at its own ratio, letterboxed. It swaps instantly. */}
        {url && !missing && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={`Slide ${current}`}
            onError={() => setBroken({ slide: current, url })}
            className="absolute inset-0 h-full w-full object-contain"
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
      </div>

      <div
        ref={bar}
        data-testid="projector-bar"
        className="relative z-20 flex h-11 shrink-0 items-center gap-6 border-t border-hairline bg-bg pr-3 pl-6 type-small whitespace-nowrap text-secondary"
      >
        {joinCardShowing ? (
          <p className="shrink-0">Press → or click to start</p>
        ) : (
          <p data-testid="projector-code" className="flex shrink-0 items-center gap-3">
            <span>{siteAddress}</span>
            <span className="type-small-strong text-ink">
              <Code code={code} />
            </span>
          </p>
        )}
        {!joinCardShowing && count && (
          <p data-testid="projector-count" className="shrink-0">
            {count}
          </p>
        )}
        {/* The middle: a failure first, else "Continued on slide N" (a live region that is always there). */}
        <div className="flex min-w-0 flex-1 justify-center">
          {error && (
            <p role="alert" className="flex min-w-0 animate-fade-in items-center gap-2 text-ink">
              <Icon name="alert" size={16} />
              <span className="truncate">{error}</span>
            </p>
          )}
          <p role="status" className={error ? "sr-only" : "min-w-0"}>
            {!error && continued !== null && (
              <span
                data-testid="continued"
                className="block animate-fade-in truncate rounded-sm border border-hairline bg-surface px-3 py-1 text-ink"
              >
                Continued on slide {continued}
              </span>
            )}
          </p>
        </div>
        <div data-testid="projector-controls" className="flex shrink-0 items-center gap-1">
          <Link href={`/teach/l/${lectureId}/live`} className={controlClass}>
            Data
          </Link>
          {!joinCardShowing && (
            <button
              ref={showCodeButton}
              type="button"
              aria-haspopup="dialog"
              onClick={(e) => {
                e.currentTarget.blur();
                setError(null);
                setCodeOpen(true);
              }}
              className={controlClass}
            >
              Show code
            </button>
          )}
          <button type="button" onClick={toggleFullscreen} className={controlClass}>
            Fullscreen
          </button>
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
            {confirming && (
              <div
                id="end-class-confirm"
                role="dialog"
                aria-labelledby="end-class-title"
                aria-describedby="end-class-text"
                tabIndex={-1}
                className="absolute right-0 bottom-full z-30 mb-2 flex w-80 max-w-[calc(100vw-32px)] origin-bottom-right animate-pop-in flex-col gap-3 rounded-md border border-hairline bg-surface p-5 whitespace-normal shadow-popover outline-hidden"
              >
                <p id="end-class-title" className="type-body-strong text-ink">
                  End class?
                </p>
                <p id="end-class-text" className="type-small text-ink">
                  The code stops working and students land on My spots.
                </p>
                <div className="flex items-center gap-3">
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
                    className={buttonSecondaryClass}
                  >
                    Keep going
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {codeOpen && (
        // The backdrop: a press on it (outside the dialog) closes the dialog.
        <div
          data-testid="show-code-backdrop"
          className="fixed inset-0 z-40 flex animate-fade-in items-center justify-center bg-ink/40 p-4"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) closeCode(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="show-code-title"
            className="flex max-w-full animate-pop-in flex-col items-center gap-[min(16px,1.111vw,1.5vh)] rounded-md bg-surface px-[min(96px,6.667vw)] pt-[min(72px,5vw,6.5vh)] pb-[min(48px,3.333vw,4.5vh)] text-center whitespace-nowrap shadow-popover"
          >
            <p
              id="show-code-title"
              className="font-sans text-[min(64px,4.444vw,6vh)] leading-[1.125] font-medium tracking-[-0.02em] text-ink"
            >
              <span className="font-normal text-secondary">Go to </span>
              {siteAddress}
            </p>
            <p className="font-sans text-[min(160px,11.111vw,15vh)] leading-none font-light tracking-[-0.03em] text-ink">
              <Code code={code} />
            </p>
            <button
              ref={closeCodeButton}
              type="button"
              onClick={() => closeCode(true)}
              className={`${buttonSecondaryClass} mt-[min(32px,2.222vw,3vh)] px-6`}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
