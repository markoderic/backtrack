"use client";

import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

/**
 * How many students have joined a lecture, live. null until the first count
 * arrives. A failed count throws on the next render. Teacher side only: row
 * level security shows a teacher the participants of their own lectures.
 */
export function useJoinedCount(lectureId: string): number | null {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    let cancelled = false;

    const refetch = async () => {
      const { count: total, error: countError } = await supabase
        .from("participants")
        .select("lecture_id", { count: "exact", head: true })
        .eq("lecture_id", lectureId);
      if (countError) throw new Error(countError.message);
      if (!cancelled) setCount(total ?? 0);
    };
    const fail = (e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
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
        if (status === "SUBSCRIBED") refetch().catch(fail);
      });
    refetch().catch(fail);

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [lectureId]);

  if (error) throw error;
  return count;
}
