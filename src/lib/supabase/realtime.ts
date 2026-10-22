import type { RealtimeChannel, RealtimeClient, SupabaseClient } from "@supabase/supabase-js";

/** The longest the channel waits for the token before it opens anyway. */
const AUTH_WAIT_MS = 5000;

async function tokenReady(realtime: RealtimeClient): Promise<void> {
  await realtime.setAuth();
  // setAuth() returns early without a token when a newer call overlaps it. Null means
  // no token was ever set (with no session the callback gives the anon key), so ask once more.
  if (realtime.accessTokenValue === null) await realtime.setAuth();
}

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
 * If that fails, or takes over 5 seconds, the channel opens anyway; the reads
 * around it still work.
 */
export function openChannel(supabase: SupabaseClient, open: () => RealtimeChannel): () => void {
  let closed = false;
  let channel: RealtimeChannel | undefined;
  let waited: ReturnType<typeof setTimeout> | undefined;
  void (async () => {
    try {
      await Promise.race([
        tokenReady(supabase.realtime),
        new Promise((r) => {
          waited = setTimeout(r, AUTH_WAIT_MS);
        }),
      ]);
    } catch {
      // No token to give it: join as before.
    }
    clearTimeout(waited);
    if (!closed) channel = open();
  })();
  return () => {
    closed = true;
    clearTimeout(waited);
    if (channel) void supabase.removeChannel(channel);
  };
}
