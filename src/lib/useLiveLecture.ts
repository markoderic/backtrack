"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { followReducer, initialFollowState, type FollowState } from "@/lib/followState";

const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 10000;

/**
 * Follows a lecture's live slide for a student. `state` is null until the
 * first read arrives, unless `initialLive` (the slide the server already read)
 * is given. Reads only current_slide and status, never the slide count.
 * A failed read leaves the connection on "reconnecting" and is retried after
 * 1, 2, 4 seconds and so on, up to 10, until it works; then the view jumps to
 * the live slide.
 */
export function useLiveLecture(
  lectureId: string,
  initialLive?: number,
): {
  state: FollowState | null;
  back(): void;
  forward(): void;
  jumpToLive(): void;
  goTo(n: number): void;
} {
  const [state, dispatch] = useReducer(followReducer, initialFollowState(initialLive ?? 1));
  const [ready, setReady] = useState(initialLive !== undefined);
  const readyRef = useRef(initialLive !== undefined);
  const droppedRef = useRef(false);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    let cancelled = false;

    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      clearTimeout(timer);
      timer = undefined;
      let data: { current_slide: number; status: string };
      try {
        const { data: row, error: readError } = await supabase
          .from("lectures")
          .select("current_slide, status")
          .eq("id", lectureId)
          .single();
        if (readError || !row) throw new Error(readError?.message ?? "Lecture not found.");
        data = row;
      } catch {
        if (cancelled) return;
        // Not connected, as far as the student can tell: say so and try again.
        droppedRef.current = true;
        dispatch({ type: "disconnected" });
        clearTimeout(timer);
        timer = setTimeout(load, Math.min(RETRY_FIRST_MS * 2 ** failures, RETRY_MAX_MS));
        failures++;
        return;
      }
      if (cancelled) return;
      failures = 0;
      if (data.status === "ended") {
        dispatch({ type: "ended" });
      } else if (!readyRef.current || droppedRef.current) {
        // The first read, or the channel came back: show the live slide.
        readyRef.current = true;
        droppedRef.current = false;
        dispatch({ type: "reconnected", n: data.current_slide });
      } else {
        dispatch({ type: "liveChanged", n: data.current_slide });
      }
      setReady(true);
    };

    const channel = supabase
      .channel(`lecture-${lectureId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "lectures", filter: `id=eq.${lectureId}` },
        (payload) => {
          const row = payload.new as { current_slide: number; status: string };
          if (row.status === "ended") dispatch({ type: "ended" });
          else dispatch({ type: "liveChanged", n: row.current_slide });
        },
      )
      .subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          void load();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          droppedRef.current = true;
          dispatch({ type: "disconnected" });
        }
      });
    void load();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [lectureId]);

  const back = useCallback(() => dispatch({ type: "back" }), []);
  const forward = useCallback(() => dispatch({ type: "forward" }), []);
  const jumpToLive = useCallback(() => dispatch({ type: "jumpToLive" }), []);
  const goTo = useCallback((n: number) => dispatch({ type: "goTo", n }), []);

  return { state: ready ? state : null, back, forward, jumpToLive, goTo };
}
