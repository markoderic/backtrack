"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const SIGNED_URL_SECONDS = 4 * 60 * 60;
/** Every url on hand is signed again this long after the last round, before any expires. */
export const RENEW_MS = 3.5 * 60 * 60 * 1000;
/** A renewal that failed is tried again after this long; the old urls still work meanwhile. */
const RENEW_RETRY_MS = 60 * 1000;

/**
 * Signed urls for just the slides asked for, each read once. For a page that shows
 * a few slides out of many (the teacher's data view shows the slides people
 * highlighted), so a lecture whose other images are missing, like a seeded demo,
 * is never asked for them. A slide that can not be read or signed has no entry and
 * is asked for again the next time the list changes; nothing is thrown. Every 3.5
 * hours (the urls last 4) all the wanted slides are signed again, so a data view left
 * open keeps its images; the old urls stay until the new ones arrive, and a slide whose
 * renewal failed is tried again a minute later.
 */
export function useSlideUrls(lectureId: string, wanted: number[]): Record<number, string> {
  const [urls, setUrls] = useState<Record<number, string>>({});
  // Goes up to sign everything wanted again (the 3.5 h timer, or a catch-up after a sleep).
  const [renewals, setRenewals] = useState(0);
  // Goes up to try a failed renewal again. Kept apart from `renewals`, so a retry never
  // restarts the 3.5 h countdown of the urls already on hand.
  const [retries, setRetries] = useState(0);
  const asked = useRef(new Set<number>());
  const alive = useRef(true);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The urls on hand, for the fetch to tell a renewal that failed from a slide that never had one.
  const have = useRef<Record<number, string>>({});
  const key = [...new Set(wanted)].sort((a, b) => a - b).join(",");

  useEffect(() => {
    have.current = urls;
  }, [urls]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(retry.current);
    };
  }, []);

  useEffect(() => {
    const need = key === "" ? [] : key.split(",").map(Number).filter((n) => !asked.current.has(n));
    if (need.length === 0) return;
    for (const n of need) asked.current.add(n);
    // Slides that have a url and could not be signed again are tried again in a minute, before
    // their url expires. A slide that never had one (no image row, a seeded demo) is only asked
    // for again when the list changes, as before, so it never makes a request every minute.
    const missed = (failed: number[]) => {
      for (const n of failed) asked.current.delete(n);
      if (!alive.current || !failed.some((n) => n in have.current)) return;
      clearTimeout(retry.current);
      retry.current = setTimeout(() => setRetries((n) => n + 1), RENEW_RETRY_MS);
    };
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
      if (alive.current && Object.keys(got).length > 0) setUrls((prev) => ({ ...prev, ...got }));
      missed(need.filter((n) => !(n in got)));
    })().catch(() => {
      // No image for these slides for now. The boxes still show, on a blank slide.
      missed(need);
    });
  }, [lectureId, key, renewals, retries]);

  // The 3.5 hours count from the first url on hand, then from each renewal (never from a
  // retry). A tab that slept catches up when it is shown or focused again.
  const any = Object.keys(urls).length > 0;
  useEffect(() => {
    if (!any) return;
    const from = Date.now();
    let fired = false;
    const renew = () => {
      if (fired) return;
      fired = true;
      asked.current.clear();
      setRenewals((n) => n + 1);
    };
    const timer = setTimeout(renew, RENEW_MS);
    const catchUp = () => {
      if (document.visibilityState === "visible" && Date.now() - from >= RENEW_MS) renew();
    };
    document.addEventListener("visibilitychange", catchUp);
    window.addEventListener("focus", catchUp);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", catchUp);
      window.removeEventListener("focus", catchUp);
    };
  }, [any, renewals]);

  return urls;
}
