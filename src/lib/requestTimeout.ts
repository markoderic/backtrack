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
  // supabase-js may wait on the login (a token refresh) before the fetch even starts, where the
  // signal can not reach: the same limit answers for that wait too (review M6).
  return withLimit(query.abortSignal(controller.signal), ms, () => {
    controller.abort();
    return FAILED_FETCH as T;
  });
}

/** What supabase-js gives for a fetch that failed: every caller here reads it as offline. */
const FAILED_FETCH = { data: null, error: { message: "The request took too long.", code: "" }, status: 0 };

/** The promise's answer, or after `ms` what `late` gives (the promise is then left to end on its own). */
export function withLimit<T>(work: PromiseLike<T>, ms: number, late: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(late()), ms);
  });
  return Promise.race([Promise.resolve(work), limit]).finally(() => clearTimeout(timer));
}
