import { makeSend } from "./lostTapApi";
import { createBrowserSupabase } from "./supabase/browser";
import { TapQueue, type QueueOp, type SendResult } from "./tapQueue";

/** sessionStorage key that says a tap of this lecture was refused by the database. */
export const rejectedKey = (lectureId: string) => `backtrack:rejected:${lectureId}`;

/** Remembers, for the spots page, that a tap of this lecture did not save. */
export function markRejected(lectureId: string): void {
  try {
    window.sessionStorage.setItem(rejectedKey(lectureId), "1");
  } catch {
    // Storage is blocked. The tap is already gone from the queue; the page just can not say so.
  }
}

/**
 * Restores the ops a closed page left in `backtrack:queue:<lectureId>` and sends
 * them. Anything refused sets the rejected key. Ops that could not be sent
 * (still offline) stay queued. For the spots page to call on load.
 */
export async function flushLeftoverTaps(
  lectureId: string,
  send: (op: QueueOp) => Promise<SendResult> = (op) => makeSend(createBrowserSupabase(), lectureId)(op),
): Promise<{ sent: number; rejected: QueueOp[] }> {
  const result = await new TapQueue(lectureId).flush(send);
  if (result.rejected.length > 0) markRejected(lectureId);
  return result;
}
