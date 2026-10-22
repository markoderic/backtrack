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

/**
 * Resolves once the image has loaded or failed, or after `ms`, whichever is first.
 * `stop` drops the timer and the handlers (the page went away meanwhile).
 */
function loadFirst(img: HTMLImageElement, url: string, ms: number): { done: Promise<void>; stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    clearTimeout(timer);
    img.onload = null;
    img.onerror = null;
  };
  const done = new Promise<void>((resolve) => {
    const finish = () => {
      stop();
      resolve();
    };
    timer = setTimeout(finish, ms);
    img.onload = finish;
    img.onerror = finish;
    img.src = url;
  });
  return { done, stop };
}

/**
 * Signed urls for every slide of a lecture, made once, all at once, and made again
 * every 3.5 hours (they last 4), so a projector or My spots tab left open never shows
 * a broken image. A tab that slept is caught up when it is shown or focused again.
 * Pass the slide that is on screen as `current` and the next one is preloaded.
 * urlFor(n) is undefined until the urls have arrived; `loaded` turns true once the
 * slide list has been read, so after that an undefined url means the slide has no
 * image (no slide row for it) rather than "still loading". A failed first query or a slide
 * that could not be signed throws on the next render; a failed renewal keeps the old
 * urls and tries again a minute later. On a renewal the slide on screen is loaded with
 * its new url before the urls swap, so it never blinks or shows the loading text.
 */
export function useSlideImages(
  lectureId: string,
  current?: number,
): { urlFor(n: number): string | undefined; loaded: boolean } {
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [loaded, setLoaded] = useState(false);
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
    let stopLoading: (() => void) | undefined;
    const renewing = signed.current?.lectureId === lectureId;
    (async () => {
      const supabase = createBrowserSupabase();
      const { data: rows, error: slidesError } = await supabase
        .from("slides")
        .select("number, image_path")
        .eq("lecture_id", lectureId)
        .order("number");
      if (slidesError) throw new Error(slidesError.message);
      // No rows on a renewal (a session that lapsed, say) is a failed renewal: tried again.
      if (!rows || rows.length === 0) {
        if (renewing) throw new Error("No slide rows.");
        if (!cancelled) setLoaded(true);
        return;
      }

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
        const loading = loadFirst(img, fresh, SWAP_WAIT_MS);
        stopLoading = loading.stop;
        await loading.done;
        if (cancelled) return;
      }
      signed.current = { lectureId, at: Date.now() };
      setUrls(next);
      setLoaded(true);
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
      stopLoading?.();
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
  return { urlFor, loaded };
}
