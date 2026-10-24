/**
 * How long one database request may take before it is given up on. A request that hangs (a
 * half-dead connection, a laptop waking from sleep) then answers like a dropped connection: the
 * caller sees "offline", keeps what it was sending, and tries again later, instead of waiting on
 * a request that never comes back.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

/** A supabase-js query (or rpc) builder: it can be given an AbortSignal. */
type Abortable<T> = PromiseLike<T> & { abortSignal?: (signal: AbortSignal) => PromiseLike<T> };

/**
 * Runs a supabase-js query with a time limit. Past it the request is aborted, and supabase-js
 * answers as it does for a failed fetch ({ error, status: 0 }), which every caller here already
 * reads as offline. A builder without abortSignal (a test double) runs as it is.
 */
export async function timed<T>(query: Abortable<T>, ms: number = REQUEST_TIMEOUT_MS): Promise<T> {
  if (typeof query.abortSignal !== "function") return await query;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await query.abortSignal(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
