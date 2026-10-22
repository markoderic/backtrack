"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const SIGNED_URL_SECONDS = 4 * 60 * 60;
/** The urls are signed again this long after the last signing, half an hour before they expire. */
export const RENEW_MS = 3.5 * 60 * 60 * 1000;
/** A renewal that failed is tried again after this long; the old urls still work meanwhile. */
const RENEW_RETRY_MS = 60 * 1000;
/** On a renewal the slide on screen is loaded with its new url first, for at most this long. */
const SWAP_WAIT_MS = 10 * 1000;

/** Resolves once the image has loaded or failed, or after `ms`, whichever is first. */
function loadFirst(img: HTMLImageElement, url: string, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    img.onload = done;
    img.onerror = done;
    img.src = url;
  });
}

/**
 * Signed urls for every slide of a lecture, made once, all at once, and made again
 * every 3.5 hours (they last 4), so a projector or My spots tab left open never shows
 * a broken image. A tab that slept is caught up when it is shown or focused again.
 * Pass the slide that is on screen as `current` and the next one is preloaded.
 * urlFor(n) is undefined until the urls have arrived. A failed first query or a slide
 * that could not be signed throws on the next render; a failed renewal keeps the old
 * urls and tries again a minute later. On a renewal the slide on screen is loaded with
 * its new url before the urls swap, so it never blinks or shows the loading text.
 */
export function useSlideImages(lectureId: string, current?: number): { urlFor(n: number): string | undefined } {
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [error, setError] = useState<Error | null>(null);
  // Goes up to sign the urls again.
  const [round, setRound] = useState(0);
  const preloaded = useRef(new Map<string, HTMLImageElement>());
  // When, and for which lecture, the urls on hand were signed.
  const signed = useRef<{ lectureId: string; at: number } | null>(null);
  // The slide on screen, for the renewal to load first.
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const renewing = signed.current?.lectureId === lectureId;
    (async () => {
      const supabase = createBrowserSupabase();
      const { data: rows, error: slidesError } = await supabase
        .from("slides")
        .select("number, image_path")
        .eq("lecture_id", lectureId)
        .order("number");
      if (slidesError) throw new Error(slidesError.message);
      if (!rows || rows.length === 0) return;

      const { data: signedUrls, error: signError } = await supabase.storage
        .from("slides")
        .createSignedUrls(
          rows.map((r) => r.image_path as string),
          SIGNED_URL_SECONDS,
        );
      if (signError) throw new Error(signError.message);

      const byPath = new Map<string, string>();
      for (const item of signedUrls ?? []) {
        if (item.error || !item.signedUrl) throw new Error(item.error ?? "Could not sign a slide image.");
        byPath.set(item.path as string, item.signedUrl);
      }
      const next: Record<number, string> = {};
      for (const r of rows) {
        const url = byPath.get(r.image_path as string);
        if (url) next[r.number as number] = url;
      }
      if (cancelled) return;
      const shown = currentRef.current;
      const fresh = shown === undefined ? undefined : next[shown];
      if (renewing && fresh && !preloaded.current.has(fresh)) {
        const img = new Image();
        preloaded.current.set(fresh, img);
        await loadFirst(img, fresh, SWAP_WAIT_MS);
        if (cancelled) return;
      }
      signed.current = { lectureId, at: Date.now() };
      setUrls(next);
    })().catch((e: unknown) => {
      if (cancelled) return;
      if (renewing) {
        retry = setTimeout(() => setRound((n) => n + 1), RENEW_RETRY_MS);
        return;
      }
      setError(e instanceof Error ? e : new Error(String(e)));
    });
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [lectureId, round]);

  // Sign again 3.5 hours after the last signing, or as soon as the page is back after that.
  // Once per signing: while a renewal is out, more focus events start nothing (a failed one
  // is tried again by its own timer).
  useEffect(() => {
    const at = signed.current?.at;
    if (at === undefined) return;
    let fired = false;
    const renew = () => {
      if (fired) return;
      fired = true;
      setRound((n) => n + 1);
    };
    const timer = setTimeout(renew, Math.max(0, at + RENEW_MS - Date.now()));
    const catchUp = () => {
      if (document.visibilityState === "visible" && Date.now() - at >= RENEW_MS) renew();
    };
    document.addEventListener("visibilitychange", catchUp);
    window.addEventListener("focus", catchUp);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", catchUp);
      window.removeEventListener("focus", catchUp);
    };
  }, [urls]);

  useEffect(() => {
    if (current === undefined) return;
    const url = urls[current + 1];
    if (!url || preloaded.current.has(url)) return;
    const img = new Image();
    img.src = url;
    preloaded.current.set(url, img);
  }, [current, urls]);

  const urlFor = useCallback((n: number) => urls[n], [urls]);

  if (error) throw error;
  return { urlFor };
}
