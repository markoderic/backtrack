"use client";

import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 10000;

/**
 * How many students have joined a lecture, live. null until the first count
 * arrives. A failed count keeps the last number and is retried after 1, 2, 4
 * seconds and so on, up to 10, so the projector never goes blank over it.
 * Teacher side only: row level security shows a teacher the participants of
 * their own lectures.
 */
export function useJoinedCount(lectureId: string): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refetch = async () => {
      clearTimeout(timer);
      timer = undefined;
      try {
        const { count: total, error } = await supabase
          .from("participants")
          .select("lecture_id", { count: "exact", head: true })
          .eq("lecture_id", lectureId);
        if (error) throw new Error(error.message);
        if (cancelled) return;
        failures = 0;
        setCount(total ?? 0);
      } catch {
        if (cancelled) return;
        // Keep the last count and try again.
        clearTimeout(timer);
        timer = setTimeout(refetch, Math.min(RETRY_FIRST_MS * 2 ** failures, RETRY_MAX_MS));
        failures++;
      }
    };

    const channel = supabase
      .channel(`participants-${lectureId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "participants", filter: `lecture_id=eq.${lectureId}` },
        () => setCount((c) => (c ?? 0) + 1),
      )
      // Counts again on every SUBSCRIBED, which also covers a reconnect that missed inserts.
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refetch();
      });
    void refetch();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [lectureId]);

  return count;
}
