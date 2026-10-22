"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { clampSlide, slideKeyAction } from "@/lib/slideKeys";
import { useSlideImages } from "@/lib/useSlideImages";
import { useJoinedCount } from "@/lib/useJoinedCount";
import { useLiveLecture } from "@/lib/useLiveLecture";
import { LogoMark } from "@/components/Logo";
import { Icon } from "@/components/Icon";
import { ButtonPrimaryLink } from "@/components/ButtonPrimary";

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
/** The controls row fades out after this long without the mouse moving (and no control focused). */
const CONTROLS_IDLE_MS = 3000;

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

type KeyboardLock = { lock?: (codes?: string[]) => Promise<void>; unlock?: () => void };
const keyboardLock = () => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;

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
}: {
  code: string;
  siteAddress: string;
  joined: number | null;
  /** The copy that fades out after the first arrow. Hidden from screen readers and takes no clicks. */
  ghost?: boolean;
  onFaded?: () => void;
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
            className:
              "absolute inset-0 z-10 flex flex-col items-center justify-center gap-[min(72px,5vw)] bg-bg px-4",
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
      <p className="absolute right-16 bottom-12 type-small text-secondary">Press → to start</p>
    </div>
  );
}

/** Data, End lecture and Fullscreen: quiet text actions for the teacher, not for the room. */
const controlClass =
  "press focus-ring rounded-sm type-small-strong whitespace-nowrap text-secondary hover:text-ink";

export function Projector({ lectureId, code, siteAddress, initialSlide, slideCount, courseId }: Props) {
  const router = useRouter();
  const [current, setCurrent] = useState(initialSlide);
  // The join card shows only on the first open of the lecture: still on slide 1 and not put
  // away before in this tab. Coming back from the data view (D then Esc), Resume or a reload
  // goes straight to the slide. The server has no sessionStorage, so it draws the card and
  // the first client render corrects it.
  const seen = useSyncExternalStore(
    noSubscribe,
    () => joinCardSeen(lectureId),
    () => false,
  );
  const [dismissed, setDismissed] = useState(false);
  const joinCardShowing = initialSlide === 1 && !seen && !dismissed;
  // The join card fading out after the first arrow, drawn over the slide and then removed.
  const [joinCardFading, setJoinCardFading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { urlFor } = useSlideImages(lectureId, current);
  const joined = useJoinedCount(lectureId);
  // Hears an End from anywhere else (the dashboard, a phone): Realtime, plus a read every 20 s.
  const ended = useLiveLecture(lectureId, initialSlide).state?.ended ?? false;
  const [endedHere, setEndedHere] = useState(false);
  const isEnded = ended || endedHere;
  // The controls row shows while the mouse moves and while one of its controls has focus.
  const [awake, setAwake] = useState(true);
  const [focused, setFocused] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
    try {
      while (wantedRef.current !== currentRef.current && !endedRef.current) {
        const target = wantedRef.current;
        // Only a live lecture moves: no row back means it ended somewhere else.
        const { data, error: updateError } = await createBrowserSupabase()
          .from("lectures")
          .update({ current_slide: target })
          .eq("id", lectureId)
          .eq("status", "live")
          .select("current_slide")
          .maybeSingle();
        if (updateError) throw new Error(updateError.message);
        if (!data) {
          endedRef.current = true;
          setEndedHere(true);
          return;
        }
        currentRef.current = target;
        setCurrent(target);
        setError(null);
      }
    } catch {
      // Presses made meanwhile are dropped with it: the next press starts from the slide on screen.
      wantedRef.current = currentRef.current;
      setError("Could not change the slide.");
    } finally {
      updating.current = false;
    }
  }, [lectureId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const action = slideKeyAction(e);
      if (!action) return;
      if (endedRef.current) return;
      if (action === "close") {
        // Without a keyboard lock the browser leaves fullscreen by itself and this never runs.
        // With one (Chrome, see toggleFullscreen), Esc reaches the page, so it leaves here.
        if (document.fullscreenElement) {
          keyboardLock()?.unlock?.();
          void document.exitFullscreen?.().catch(() => {});
        }
        return;
      }
      e.preventDefault();
      if (action === "data") {
        router.push(`/teach/l/${lectureId}/live`);
        return;
      }
      if (joinCardRef.current) {
        joinCardRef.current = false;
        markJoinCardSeen(lectureId);
        setDismissed(true);
        setJoinCardFading(true);
        return;
      }
      const target = clampSlide(wantedRef.current + (action === "next" ? 1 : -1), slideCount);
      if (target === wantedRef.current) return;
      wantedRef.current = target;
      void go();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go, lectureId, router, slideCount]);

  // The fade ends with animationend; this is the fallback when no animation runs.
  useEffect(() => {
    if (!joinCardFading) return;
    const timer = setTimeout(() => setJoinCardFading(false), JOIN_FADE_MS);
    return () => clearTimeout(timer);
  }, [joinCardFading]);

  // Any pointer move or press wakes the controls for another 3 s. Keys never do: arrows, a
  // clicker and Space must not flash the row over the slide. Setting the same state again
  // does not render, so a moving mouse only restarts the timer.
  const wake = useCallback(() => {
    setAwake(true);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setAwake(false), CONTROLS_IDLE_MS);
  }, []);

  useEffect(() => {
    // Shown on load (awake starts true); the first countdown starts here.
    idleTimer.current = setTimeout(() => setAwake(false), CONTROLS_IDLE_MS);
    window.addEventListener("pointermove", wake, { passive: true });
    window.addEventListener("pointerdown", wake, { passive: true });
    return () => {
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      clearTimeout(idleTimer.current);
    };
  }, [wake]);

  // The whole page goes fullscreen, not this component, so it stays fullscreen through D to
  // the data view and Esc back (both are client side, the document stays). Where the browser
  // has a keyboard lock (Chrome), Esc is locked too: a press then reaches the page (Esc in the
  // data view comes back here, Esc here leaves fullscreen), and holding Esc still leaves.
  async function toggleFullscreen(e: React.MouseEvent<HTMLButtonElement>) {
    e.currentTarget.blur(); // Space must move the slide, not press this button again.
    try {
      if (document.fullscreenElement) {
        keyboardLock()?.unlock?.();
        await document.exitFullscreen();
        return;
      }
      await document.documentElement.requestFullscreen?.();
    } catch {
      setError("Could not change fullscreen.");
      return;
    }
    try {
      await keyboardLock()?.lock?.(["Escape"]);
    } catch {
      // No lock: the first Esc in the data view then only leaves fullscreen, as before.
    }
  }

  const url = urlFor(current);

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
   * One row of controls, always in the DOM and in the tab order (Tab reaches it and focus
   * shows it). It only fades: opacity, instant with reduced motion.
   */
  const controls = (
    <div
      data-testid="projector-controls"
      data-awake={awake || focused ? "true" : "false"}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setFocused(false);
        wake();
      }}
      className="flex items-center gap-4 rounded-md border border-hairline bg-surface px-4 py-2 shadow-popover opacity-0 transition-opacity duration-(--dur-slow) ease-out focus-within:opacity-100 motion-reduce:transition-none data-[awake=true]:opacity-100"
    >
      <Link href={`/teach/l/${lectureId}/live`} className={controlClass}>
        Data
      </Link>
      <Link href={`/teach/l/${lectureId}/live?end=1`} className={controlClass}>
        End lecture
      </Link>
      <button type="button" onClick={toggleFullscreen} className={controlClass}>
        Fullscreen
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 overflow-hidden bg-bg text-ink">
      {/* The slide fills the screen at its own ratio and is never scaled past it. It swaps instantly. */}
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Slide ${current}`} className="h-full w-full object-contain" />
      )}

      {joinCardShowing && <JoinCard code={code} siteAddress={siteAddress} joined={joined} />}
      {joinCardFading && (
        <JoinCard code={code} siteAddress={siteAddress} joined={joined} ghost onFaded={() => setJoinCardFading(false)} />
      )}

      {/*
       * Top right, 32 from the corner (Figma 34:851). On the slide: the corner card with
       * address, code and joined, as in the design. Under it (alone there on the join card)
       * the teacher's controls, which fade out while the mouse is still.
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
