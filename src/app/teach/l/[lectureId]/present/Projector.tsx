"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { clampSlide, slideKeyAction } from "@/lib/slideKeys";
import { useSlideImages } from "@/lib/useSlideImages";
import { useJoinedCount } from "@/lib/useJoinedCount";
import { LogoMark } from "@/components/Logo";
import { Icon } from "@/components/Icon";

type Props = {
  lectureId: string;
  code: string;
  /** The site address without the protocol, as students type it. */
  siteAddress: string;
  initialSlide: number;
  slideCount: number;
};

/** How long the join card takes to fade out on the first arrow (--dur-slow, plus room). */
const JOIN_FADE_MS = 400;

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
              "pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-[min(72px,5vw)] bg-bg " +
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

export function Projector({ lectureId, code, siteAddress, initialSlide, slideCount }: Props) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(initialSlide);
  const [joinCardShowing, setJoinCardShowing] = useState(true);
  // The join card fading out after the first arrow, drawn over the slide and then removed.
  const [joinCardFading, setJoinCardFading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { urlFor } = useSlideImages(lectureId, current);
  const joined = useJoinedCount(lectureId);

  // The key handler reads these instead of state, so a fast key press never sees a stale value.
  const currentRef = useRef(initialSlide);
  const joinCardRef = useRef(true);
  const updating = useRef(false);

  const go = useCallback(
    async (target: number) => {
      updating.current = true;
      try {
        const { data, error: updateError } = await createBrowserSupabase()
          .from("lectures")
          .update({ current_slide: target })
          .eq("id", lectureId)
          .select("current_slide")
          .single();
        if (updateError || !data) throw new Error(updateError?.message ?? "No row was updated.");
        currentRef.current = target;
        setCurrent(target);
        setError(null);
      } catch {
        setError("Could not change the slide.");
      } finally {
        updating.current = false;
      }
    },
    [lectureId],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const action = slideKeyAction(e);
      if (!action) return;
      if (action === "close") return; // The browser leaves fullscreen by itself.
      e.preventDefault();
      if (updating.current) return;
      if (action === "data") {
        router.push(`/teach/l/${lectureId}/live`);
        return;
      }
      if (joinCardRef.current) {
        joinCardRef.current = false;
        setJoinCardShowing(false);
        setJoinCardFading(true);
        return;
      }
      const target = clampSlide(currentRef.current + (action === "next" ? 1 : -1), slideCount);
      if (target === currentRef.current) return;
      void go(target);
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

  async function toggleFullscreen(e: React.MouseEvent<HTMLButtonElement>) {
    e.currentTarget.blur(); // Space must move the slide, not press this button again.
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen?.();
    } catch {
      setError("Could not change fullscreen.");
    }
  }

  const url = urlFor(current);

  const controls = (
    <div className="flex items-center gap-4">
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
    <div ref={root} className="fixed inset-0 overflow-hidden bg-bg text-ink">
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
       * Top right, 32 from the corner (Figma 34:851). On the slide it is the corner card:
       * address, code, joined, then the teacher's controls after a hairline. On the join
       * card only the controls show there, since the card itself has the rest.
       */}
      <div className="absolute top-8 right-8 z-20 flex max-w-[calc(100%-64px)] justify-end">
        {joinCardShowing ? (
          controls
        ) : (
          <div
            data-testid="corner-card"
            className="flex animate-fade-in flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-hairline bg-surface px-6 py-4 whitespace-nowrap shadow-popover"
          >
            <p className="type-body-strong text-ink">{siteAddress}</p>
            <p className="type-title text-ink">
              <Code code={code} />
            </p>
            {joined !== null && <p className="type-body text-secondary">{joined} joined</p>}
            <span aria-hidden className="h-6 w-px bg-hairline" />
            {controls}
          </div>
        )}
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
