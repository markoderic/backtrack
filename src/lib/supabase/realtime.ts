import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

/**
 * Opens a Realtime channel once Realtime has the signed-in user's token, and
 * returns a function that closes it (before or after it opened).
 *
 * Why: realtime-js writes the token into a channel's join message at
 * subscribe(). Right after the browser client is made (a page reload) the
 * session is still being read, so the join goes out with only the anon key and
 * the server checks row level security for every change as role anon, which
 * sees no lecture, tap or participant row: the channel says SUBSCRIBED and then
 * stays silent. The token that arrives a moment later is never sent to a
 * channel that was still joining. setAuth() waits for the session first.
 * If that fails the channel opens anyway; the reads around it still work.
 */
export function openChannel(supabase: SupabaseClient, open: () => RealtimeChannel): () => void {
  let closed = false;
  let channel: RealtimeChannel | undefined;
  void (async () => {
    try {
      await supabase.realtime.setAuth();
    } catch {
      // No token to give it: join as before.
    }
    if (!closed) channel = open();
  })();
  return () => {
    closed = true;
    if (channel) void supabase.removeChannel(channel);
  };
}
