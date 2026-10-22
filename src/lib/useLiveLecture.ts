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
/** What a read asks for. slide_version (migration 0015) says which of two states is newer. */
const COLS = "current_slide, status, slide_version";
/** The same without slide_version, for a database that doesn't have the column yet. */
const COLS_BEFORE_0015 = "current_slide, status";

type LectureRow = { current_slide: number; status: string; slide_version?: number | string | null };

/** The row's slide_version, or null when it has none (0015 not applied). */
function versionOf(row: LectureRow): number | null {
  const v = typeof row.slide_version === "string" ? Number(row.slide_version) : row.slide_version;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** PostgREST's answer when a selected column doesn't exist. */
function isMissingVersionColumn(error: { code?: string; message?: string }): boolean {
  return error.code === "42703" || /slide_version/.test(error.message ?? "");
}

/**
 * Who shows up in the lecture's "here" count (Realtime Presence on the lecture channel).
 * "track" (the default, every student page that follows a lecture: the lecture screen and
 * its My spots view): this tab is counted while it has the lecture open, under a random key
 * made for this tab. Nothing else is sent: no name, no anonymous id, no device details.
 * "count" (the projector): not counted itself, and it hears the count.
 */
export type LivePresenceOptions = { presence?: "track" | "count" };

/**
 * Follows a lecture's live slide for a student. `state` is null until the
 * first read arrives, unless `initialLive` (the slide the server already read)
 * is given. Reads only current_slide and status, never the slide count.
 * A failed read leaves the connection on "reconnecting" and is retried after
 * 1, 2, 4 seconds and so on, up to 10, until it works. Then the view jumps to
 * the live slide only if the channel itself had dropped (or it was the first
 * read); after a failed background read with the channel up, a student who
 * went back stays where they are.
 *
 * Reads and Realtime events can arrive in either order, and the teacher can go
 * back, so the slide number alone can't say which is newer: every lecture row
 * update counts up slide_version, and the page only shows a state newer than
 * the one it shows, so a late read or a late event never moves a student back.
 * (Without the column it falls back to: a read that a Realtime event overtook
 * keeps that event's slide.)
 *
 * The channel is the fast way to hear of a new slide or the end, not the only
 * one: while the lecture is live the same small read runs again 20 seconds
 * after the last read, when the page becomes visible, on window focus and
 * online, and when the page calls recheck() (a tap the database refused).
 */
export function useLiveLecture(
  lectureId: string,
  initialLive?: number,
  options: LivePresenceOptions = {},
): {
  state: FollowState | null;
  /**
   * With presence "count": how many students have the lecture open right now (Realtime
   * Presence on the lecture's channel), null until the first count or while the channel is
   * down. Always null with presence "track".
   */
  here: number | null;
  back(): void;
  forward(): void;
  jumpToLive(): void;
  goTo(n: number): void;
  /** Reads the slide and status again now, unless the lecture ended or a read is already running. */
  recheck(): void;
} {
  const counting = options.presence === "count";
  const [state, dispatch] = useReducer(followReducer, initialFollowState(initialLive ?? 1));
  const [here, setHere] = useState<number | null>(null);
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
    // Realtime slide changes so far, and the last one: a read that started before
    // one of them brings an older slide, so the Realtime one wins.
    let events = 0;
    let eventSlide = 0;
    // The channel reported an error and has not said SUBSCRIBED since. A read then
    // updates the slide but does not say live again; only the channel does.
    let channelDown = false;
    // The newest slide_version shown and its slide. -1 until a read or event with one.
    let shownVersion = -1;
    let shownSlide = 0;
    let cols = COLS;

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
      const eventsAtStart = events;
      reading = true;
      readStarted = Date.now();
      // Should this read never come back, the 20 second check still goes out.
      timer = setTimeout(check, CHECK_MS);
      let data: LectureRow;
      try {
        const { data: row, error: readError } = await supabase
          .from("lectures")
          .select(cols)
          .eq("id", lectureId)
          .single();
        if (readError && cols === COLS && isMissingVersionColumn(readError)) {
          // The database doesn't have slide_version yet (0015 not applied): read without it.
          if (cancelled || mine !== latest) return;
          cols = COLS_BEFORE_0015;
          reading = false;
          void load();
          return;
        }
        if (readError || !row) throw new Error(readError?.message ?? "Lecture not found.");
        data = row as unknown as LectureRow;
      } catch {
        // Ended meanwhile (Realtime said so): nothing to retry.
        if (cancelled || ended || mine !== latest) return;
        reading = false;
        // Not connected, as far as the student can tell: say so and try again. Only the
        // channel going down counts as dropped (see subscribe): a failed read alone, like
        // one flaky 20 second check, must not move a student who went back once it works.
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
      const version = versionOf(data);
      let n: number;
      if (version === null) {
        // No version to compare: a Realtime event during the read is newer than the read.
        n = events !== eventsAtStart ? eventSlide : data.current_slide;
      } else if (version >= shownVersion) {
        shownVersion = version;
        shownSlide = data.current_slide;
        n = data.current_slide;
      } else {
        // Older than what the page already shows (an event overtook this read).
        n = shownSlide;
      }
      if (data.status === "ended") {
        end();
      } else if (!readyRef.current || (droppedRef.current && !channelDown)) {
        // The first read, or the channel came back: show the live slide.
        readyRef.current = true;
        droppedRef.current = false;
        dispatch({ type: "reconnected", n });
      } else if (channelDown) {
        // The channel is still down: the live slide updates, "Reconnecting…" stays.
        dispatch({ type: "liveChanged", n });
      } else {
        // The channel is fine: a read that works says live again (after a failed one),
        // and never moves a student who went back.
        dispatch({ type: "readOk", n });
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
    const close = openChannel(supabase, () => {
      // The projector listens to presence (that alone turns presence on for its channel) and
      // is not counted. A student tracks under a random key for this tab and does not listen,
      // so no student's browser hears who else is there.
      const channel = counting
        ? supabase.channel(`lecture-${lectureId}`)
        : supabase.channel(`lecture-${lectureId}`, { config: { presence: { key: crypto.randomUUID() } } });
      if (counting) {
        channel.on("presence", { event: "sync" }, () => {
          if (cancelled) return;
          setHere(Object.keys(channel.presenceState()).length);
        });
      }
      // Being counted is a hint for the teacher, never a reason for the page to fail.
      const trackHere = () => {
        try {
          void Promise.resolve(channel.track({})).catch(() => {});
        } catch {
          // A client without presence: this tab just isn't counted.
        }
      };
      return channel
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "lectures", filter: `id=eq.${lectureId}` },
          (payload) => {
            if (cancelled || ended) return;
            const row = payload.new as LectureRow;
            if (row.status === "ended") return end();
            const version = versionOf(row);
            if (version !== null) {
              // Late: a read already showed this state or a newer one.
              if (version <= shownVersion) return;
              shownVersion = version;
              shownSlide = row.current_slide;
            }
            events++;
            eventSlide = row.current_slide;
            dispatch({ type: "liveChanged", n: row.current_slide });
          },
        )
        .subscribe((status) => {
          if (cancelled || ended) return;
          if (status === "SUBSCRIBED") {
            channelDown = false;
            // Again after every rejoin: the server forgets a tab whose connection dropped.
            if (!counting) trackHere();
            void load();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            channelDown = true;
            droppedRef.current = true;
            // The count is unknown until the channel is back and syncs again.
            if (counting) setHere(null);
            dispatch({ type: "disconnected" });
          }
        });
    });
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
  }, [lectureId, counting]);

  const back = useCallback(() => dispatch({ type: "back" }), []);
  const forward = useCallback(() => dispatch({ type: "forward" }), []);
  const jumpToLive = useCallback(() => dispatch({ type: "jumpToLive" }), []);
  const goTo = useCallback((n: number) => dispatch({ type: "goTo", n }), []);
  const recheck = useCallback(() => checkRef.current(), []);

  return { state: ready ? state : null, here, back, forward, jumpToLive, goTo, recheck };
}
