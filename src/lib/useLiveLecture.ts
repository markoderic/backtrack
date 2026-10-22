"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { openChannel } from "@/lib/supabase/realtime";
import { followReducer, initialFollowState, type FollowState } from "@/lib/followState";

const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 10000;
/** While the lecture is live, the slide and status are read again this long after the last read. */
export const CHECK_MS = 20000;
/** A visible, focus, online or recheck() waits for a read started less than this long ago. */
const READ_FRESH_MS = 5000;

/**
 * Follows a lecture's live slide for a student. `state` is null until the
 * first read arrives, unless `initialLive` (the slide the server already read)
 * is given. Reads only current_slide and status, never the slide count.
 * A failed read leaves the connection on "reconnecting" and is retried after
 * 1, 2, 4 seconds and so on, up to 10, until it works; then the view jumps to
 * the live slide.
 *
 * The channel is the fast way to hear of a new slide or the end, not the only
 * one: while the lecture is live the same small read runs again 20 seconds
 * after the last read, when the page becomes visible, on window focus and
 * online, and when the page calls recheck() (a tap the database refused).
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
  /** Reads the slide and status again now, unless the lecture ended or a read is already running. */
  recheck(): void;
} {
  const [state, dispatch] = useReducer(followReducer, initialFollowState(initialLive ?? 1));
  const [ready, setReady] = useState(initialLive !== undefined);
  const readyRef = useRef(initialLive !== undefined);
  const droppedRef = useRef(false);
  const checkRef = useRef<() => void>(() => {});

  useEffect(() => {
    const supabase = createBrowserSupabase();
    let cancelled = false;

    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ended = false;
    // Only the newest read counts: an older one that comes back last is dropped.
    let latest = 0;
    let reading = false;
    let readStarted = 0;

    const end = () => {
      ended = true;
      clearTimeout(timer);
      timer = undefined;
      dispatch({ type: "ended" });
    };

    const load = async () => {
      clearTimeout(timer);
      timer = undefined;
      const mine = ++latest;
      reading = true;
      readStarted = Date.now();
      // Should this read never come back, the 20 second check still goes out.
      timer = setTimeout(check, CHECK_MS);
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
        if (cancelled || mine !== latest) return;
        reading = false;
        // Not connected, as far as the student can tell: say so and try again.
        droppedRef.current = true;
        dispatch({ type: "disconnected" });
        clearTimeout(timer);
        timer = setTimeout(load, Math.min(RETRY_FIRST_MS * 2 ** failures, RETRY_MAX_MS));
        failures++;
        return;
      }
      if (cancelled || mine !== latest) return;
      reading = false;
      clearTimeout(timer);
      timer = undefined;
      failures = 0;
      if (data.status === "ended") {
        end();
      } else if (!readyRef.current || droppedRef.current) {
        // The first read, or the channel came back: show the live slide.
        readyRef.current = true;
        droppedRef.current = false;
        dispatch({ type: "reconnected", n: data.current_slide });
      } else {
        dispatch({ type: "liveChanged", n: data.current_slide });
      }
      setReady(true);
      // Still live: read again in 20 seconds, in case the channel misses the end.
      if (!ended) timer = setTimeout(load, CHECK_MS);
    };

    // The extra checks. A read that started moments ago will bring the news, so no second one.
    function check() {
      if (cancelled || ended) return;
      if (reading && Date.now() - readStarted < READ_FRESH_MS) return;
      void load();
    }
    checkRef.current = check;
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);

    // Opened once Realtime has the user's token (see openChannel), so the
    // database lets this channel see the row it listens to.
    const close = openChannel(supabase, () =>
      supabase
        .channel(`lecture-${lectureId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "lectures", filter: `id=eq.${lectureId}` },
          (payload) => {
            if (cancelled || ended) return;
            const row = payload.new as { current_slide: number; status: string };
            if (row.status === "ended") end();
            else dispatch({ type: "liveChanged", n: row.current_slide });
          },
        )
        .subscribe((status) => {
          if (cancelled || ended) return;
          if (status === "SUBSCRIBED") {
            void load();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            droppedRef.current = true;
            dispatch({ type: "disconnected" });
          }
        }),
    );
    void load();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      checkRef.current = () => {};
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      close();
    };
  }, [lectureId]);

  const back = useCallback(() => dispatch({ type: "back" }), []);
  const forward = useCallback(() => dispatch({ type: "forward" }), []);
  const jumpToLive = useCallback(() => dispatch({ type: "jumpToLive" }), []);
  const goTo = useCallback((n: number) => dispatch({ type: "goTo", n }), []);
  const recheck = useCallback(() => checkRef.current(), []);

  return { state: ready ? state : null, back, forward, jumpToLive, goTo, recheck };
}
