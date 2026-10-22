"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const SIGNED_URL_SECONDS = 4 * 60 * 60;

/**
 * Signed urls for just the slides asked for, each read once. For a page that shows
 * a few slides out of many (the teacher's data view shows the slides people
 * highlighted), so a lecture whose other images are missing, like a seeded demo,
 * is never asked for them. A slide that can not be read or signed has no entry and
 * is asked for again the next time the list changes; nothing is thrown.
 */
export function useSlideUrls(lectureId: string, wanted: number[]): Record<number, string> {
  const [urls, setUrls] = useState<Record<number, string>>({});
  const asked = useRef(new Set<number>());
  const alive = useRef(true);
  const key = [...new Set(wanted)].sort((a, b) => a - b).join(",");

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const need = key === "" ? [] : key.split(",").map(Number).filter((n) => !asked.current.has(n));
    if (need.length === 0) return;
    for (const n of need) asked.current.add(n);
    (async () => {
      const supabase = createBrowserSupabase();
      const { data: rows, error } = await supabase
        .from("slides")
        .select("number, image_path")
        .eq("lecture_id", lectureId)
        .in("number", need);
      if (error || !rows || rows.length === 0) throw new Error(error?.message ?? "No slide rows.");
      const { data: signed, error: signError } = await supabase.storage
        .from("slides")
        .createSignedUrls(
          rows.map((r) => r.image_path as string),
          SIGNED_URL_SECONDS,
        );
      if (signError) throw new Error(signError.message);
      const byPath = new Map<string, string>();
      for (const item of signed ?? []) if (!item.error && item.signedUrl) byPath.set(item.path as string, item.signedUrl);
      const got: Record<number, string> = {};
      for (const r of rows) {
        const url = byPath.get(r.image_path as string);
        if (url) got[r.number as number] = url;
      }
      for (const n of need) if (!(n in got)) asked.current.delete(n);
      if (alive.current && Object.keys(got).length > 0) setUrls((prev) => ({ ...prev, ...got }));
    })().catch(() => {
      // No image for these slides for now. The boxes still show, on a blank slide.
      for (const n of need) asked.current.delete(n);
    });
  }, [lectureId, key]);

  return urls;
}
