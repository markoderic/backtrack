"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { followReducer, initialFollowState, type FollowState } from "@/lib/followState";

/**
 * Follows a lecture's live slide for a student. `state` is null until the
 * first read arrives, unless `initialLive` (the slide the server already read)
 * is given. Reads only current_slide and status, never the slide count.
 * A failed read throws on the next render.
 */
export function useLiveLecture(
  lectureId: string,
  initialLive?: number,
): {
  state: FollowState | null;
  back(): void;
  forward(): void;
  jumpToLive(): void;
} {
  const [state, dispatch] = useReducer(followReducer, initialFollowState(initialLive ?? 1));
  const [ready, setReady] = useState(initialLive !== undefined);
  const [error, setError] = useState<Error | null>(null);
  const readyRef = useRef(initialLive !== undefined);
  const droppedRef = useRef(false);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    let cancelled = false;

    const load = async () => {
      const { data, error: readError } = await supabase
        .from("lectures")
        .select("current_slide, status")
        .eq("id", lectureId)
        .single();
      if (cancelled) return;
      if (readError || !data) throw new Error(readError?.message ?? "Lecture not found.");
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
    const fail = (e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
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
          load().catch(fail);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          droppedRef.current = true;
          dispatch({ type: "disconnected" });
        }
      });
    load().catch(fail);

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [lectureId]);

  const back = useCallback(() => dispatch({ type: "back" }), []);
  const forward = useCallback(() => dispatch({ type: "forward" }), []);
  const jumpToLive = useCallback(() => dispatch({ type: "jumpToLive" }), []);

  if (error) throw error;
  return { state: ready ? state : null, back, forward, jumpToLive };
}
