"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const SIGNED_URL_SECONDS = 4 * 60 * 60;

/**
 * Signed urls for every slide of a lecture, made once, all at once.
 * Pass the slide that is on screen as `current` and the next one is preloaded.
 * urlFor(n) is undefined until the urls have arrived. A failed query or a slide
 * that could not be signed throws on the next render.
 */
export function useSlideImages(lectureId: string, current?: number): { urlFor(n: number): string | undefined } {
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [error, setError] = useState<Error | null>(null);
  const preloaded = useRef(new Map<string, HTMLImageElement>());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createBrowserSupabase();
      const { data: rows, error: slidesError } = await supabase
        .from("slides")
        .select("number, image_path")
        .eq("lecture_id", lectureId)
        .order("number");
      if (slidesError) throw new Error(slidesError.message);
      if (!rows || rows.length === 0) return;

      const { data: signed, error: signError } = await supabase.storage
        .from("slides")
        .createSignedUrls(
          rows.map((r) => r.image_path as string),
          SIGNED_URL_SECONDS,
        );
      if (signError) throw new Error(signError.message);

      const byPath = new Map<string, string>();
      for (const item of signed ?? []) {
        if (item.error || !item.signedUrl) throw new Error(item.error ?? "Could not sign a slide image.");
        byPath.set(item.path as string, item.signedUrl);
      }
      const next: Record<number, string> = {};
      for (const r of rows) {
        const url = byPath.get(r.image_path as string);
        if (url) next[r.number as number] = url;
      }
      if (!cancelled) setUrls(next);
    })().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
    });
    return () => {
      cancelled = true;
    };
  }, [lectureId]);

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
