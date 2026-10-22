"use client";

import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { openChannel } from "@/lib/supabase/realtime";
import { createJoinedCounter } from "@/lib/joinedCounter";

/**
 * How many students have joined a lecture, live. null until the first count
 * arrives. A failed count keeps the last number and is retried after 1, 2, 4
 * seconds and so on, up to 10, so the projector never goes blank over it.
 * A join event adds one at once and the count is read again just after, so an
 * event for a student the last read already counted can't leave it one too high
 * (see createJoinedCounter).
 * Teacher side only: row level security shows a teacher the participants of
 * their own lectures.
 */
export function useJoinedCount(lectureId: string): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    const counter = createJoinedCounter(async () => {
      const { count: total, error } = await supabase
        .from("participants")
        .select("lecture_id", { count: "exact", head: true })
        .eq("lecture_id", lectureId);
      if (error) throw new Error(error.message);
      return total ?? 0;
    }, setCount);

    // Opened once Realtime has the teacher's token (see openChannel), so the
    // database lets this channel see the participant rows.
    const close = openChannel(supabase, () =>
      supabase
        .channel(`participants-${lectureId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "participants", filter: `lecture_id=eq.${lectureId}` },
          () => counter.joined(),
        )
        // Counts again on every SUBSCRIBED, which also covers a reconnect that missed inserts.
        .subscribe((status) => {
          if (status === "SUBSCRIBED") void counter.recount();
        }),
    );
    void counter.recount();

    return () => {
      counter.stop();
      close();
    };
  }, [lectureId]);

  return count;
}
