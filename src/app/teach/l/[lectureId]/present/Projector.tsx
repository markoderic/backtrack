"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { clampSlide, slideKeyAction } from "@/lib/slideKeys";
import { useSlideImages } from "@/lib/useSlideImages";

type Props = {
  lectureId: string;
  code: string;
  /** The site address without the protocol, as students type it. */
  siteAddress: string;
  initialSlide: number;
  slideCount: number;
};

export function Projector({ lectureId, code, siteAddress, initialSlide, slideCount }: Props) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(initialSlide);
  const [joinCardShowing, setJoinCardShowing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { urlFor } = useSlideImages(lectureId, current);

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
        return;
      }
      const target = clampSlide(currentRef.current + (action === "next" ? 1 : -1), slideCount);
      if (target === currentRef.current) return;
      void go(target);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go, lectureId, router, slideCount]);

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

  return (
    <div ref={root} className="fixed inset-0 overflow-hidden bg-black text-white">
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Slide ${current}`} className="h-full w-full object-contain" />
      )}

      {joinCardShowing ? (
        <div
          data-testid="join-card"
          className="absolute inset-0 flex flex-col items-center justify-center gap-[3vw] bg-black"
        >
          <p className="text-[4vw]">{siteAddress}</p>
          <p className="font-mono text-[14vw] leading-none tracking-widest">{code}</p>
        </div>
      ) : (
        <div data-testid="corner-card" className="absolute bottom-4 left-4 border border-white bg-black px-4 py-3">
          <p className="text-lg">{siteAddress}</p>
          <p className="font-mono text-3xl tracking-widest">{code}</p>
        </div>
      )}

      <button
        type="button"
        onClick={toggleFullscreen}
        className="absolute right-4 top-4 border border-white bg-black px-3 py-1"
      >
        Fullscreen
      </button>

      {error && (
        <p role="alert" className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black px-3 py-1">
          {error}
        </p>
      )}
    </div>
  );
}
