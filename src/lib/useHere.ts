"use client";

import { useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { openChannel } from "@/lib/supabase/realtime";

/**
 * The "here" count: who has a lecture open right now, with Realtime Presence on a small
 * channel of its own, `here-<lectureId>`. It is kept apart from the lecture's channel
 * (`lecture-<id>`, the live slide changes) on purpose: the server closes a channel that goes
 * over a presence limit, and that must only ever cost the count, never a student's slides.
 */
export const hereChannel = (lectureId: string) => `here-${lectureId}`;

/** A class starts all at once: each student's first track waits a random 0 to 3 seconds. */
export const TRACK_SPREAD_MS = 3000;

/** How often, and how many times, the count looks again for a same-topic channel to finish closing. */
const FREE_WAIT_MS = 250;
const FREE_TRIES = 20;

/**
 * Counts this student's tab in the lecture's here count while `enabled` (the live lecture
 * page while the lecture is live; not My spots). It tracks an empty payload and the server
 * picks the key, so nothing identifies the tab: no name, no anonymous id, no device details.
 * It binds no presence listener, but the server still sends a tracked client the presence
 * state and its changes (keys only). It tracks again after every rejoin (the server forgets a
 * tab whose connection dropped). A system error on the channel (a presence limit, a payload
 * the server refuses) stops tracking for the rest of this page: being counted is a hint for
 * the teacher, never a load on the class.
 */
export function useTrackHere(lectureId: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const supabase = createBrowserSupabase();
    let cancelled = false;
    let off = false;
    let close: (() => void) | undefined;
    const start = setTimeout(() => {
      if (cancelled) return;
      close = openChannel(supabase, () => {
        const channel: RealtimeChannel = supabase.channel(hereChannel(lectureId));
        channel.on("system", {}, (payload: { status?: string } | undefined) => {
          if (payload?.status === "error") off = true;
        });
        return channel.subscribe((status) => {
          if (cancelled || off || status !== "SUBSCRIBED") return;
          try {
            void Promise.resolve(channel.track({})).catch(() => {});
          } catch {
            // A client without presence: this tab just isn't counted.
          }
        });
      });
    }, Math.random() * TRACK_SPREAD_MS);
    return () => {
      cancelled = true;
      clearTimeout(start);
      close?.();
    };
  }, [lectureId, enabled]);
}

/**
 * How many students have the lecture open right now, for the teacher's screens (the projector
 * and the data view). It only listens: never counted itself, it sends nothing. null until the
 * first count, while the channel is down, or when `enabled` is false (a lecture that ended).
 *
 * realtime-js hands back the channel it already has for a topic, so a projector still leaving
 * `here-<id>` (the teacher just pressed Data) would give this page a channel that is closing.
 * It waits for that one to go first (up to 5 seconds), then opens its own; if it never goes,
 * the count stays null.
 */
export function useHereCount(lectureId: string, enabled: boolean): number | null {
  const [here, setHere] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const supabase = createBrowserSupabase();
    const topic = `realtime:${hereChannel(lectureId)}`;
    let cancelled = false;
    let wait: ReturnType<typeof setTimeout> | undefined;
    let close: (() => void) | undefined;

    const taken = () => {
      try {
        return supabase.getChannels().some((c) => c.topic === topic);
      } catch {
        return false;
      }
    };

    const open = () => {
      close = openChannel(supabase, () => {
        const channel: RealtimeChannel = supabase.channel(hereChannel(lectureId));
        channel.on("presence", { event: "sync" }, () => {
          if (cancelled) return;
          setHere(Object.keys(channel.presenceState()).length);
        });
        return channel.subscribe((status) => {
          if (cancelled) return;
          // The count is unknown until the channel is back and syncs again.
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setHere(null);
        });
      });
    };

    let tries = 0;
    const tryOpen = () => {
      if (cancelled) return;
      if (!taken()) return open();
      if (++tries >= FREE_TRIES) return;
      wait = setTimeout(tryOpen, FREE_WAIT_MS);
    };
    tryOpen();

    return () => {
      cancelled = true;
      clearTimeout(wait);
      close?.();
    };
  }, [lectureId, enabled]);

  return enabled ? here : null;
}
