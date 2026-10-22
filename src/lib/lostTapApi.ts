import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueueOp, SendResult } from "./tapQueue";

type ErrorLike = { code?: string | null; message?: string; status?: number };

/** Statuses a retry can fix: the connection, a busy server, an expired login. */
function retryable(status: number | undefined): boolean {
  return status === 0 || (status !== undefined && (status >= 500 || status === 401 || status === 408 || status === 429));
}

/**
 * Offline (try again later) or rejected (the database said no, retrying will not
 * help). supabase-js reports a failed fetch as status 0 with an empty code; a
 * Postgres or RLS rejection has a code (42501, 23514, ...) and a 4xx status.
 */
export function classifyError(error: ErrorLike, status?: number): "offline" | "rejected" {
  const s = status ?? error.status;
  if (retryable(s)) return "offline";
  if (error.code) return "rejected";
  return s === undefined ? "offline" : "rejected";
}

/** The result of one supabase-js call, as ok, rejected or offline. */
export function classifySend(res: { error: ErrorLike | null; status?: number }): SendResult {
  return res.error ? classifyError(res.error, res.status) : "ok";
}

/** A fetch that threw because there is no network is offline. Anything else is a bug and goes on up. */
export function classifyThrown(e: unknown): "offline" {
  if (e instanceof TypeError && /fetch|network|load failed/i.test(e.message)) return "offline";
  throw e;
}

/** Sends one queued op. Never throws for a network failure; throws for anything unexpected. */
export function makeSend(supabase: SupabaseClient, lectureId: string): (op: QueueOp) => Promise<SendResult> {
  return async (op) => {
    try {
      if (op.op === "update") {
        return classifySend(await supabase.from("lost_taps").update(op.patch).eq("id", op.id));
      }
      // The session is read from the device, so a tap made offline still has its user.
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      if (sessionError) {
        if (classifyError(sessionError) === "offline") return "offline";
        throw new Error(sessionError.message);
      }
      if (!session) throw new Error("You are not signed in.");
      const { tap } = op;
      return classifySend(
        await supabase.from("lost_taps").upsert(
          {
            id: tap.id,
            lecture_id: lectureId,
            anon_id: session.user.id,
            kind: "lost",
            tapped_on_slide: tap.tappedOnSlide,
            slide_number: tap.tappedOnSlide,
            ...(tap.note ? { note: tap.note } : {}),
            tapped_at: tap.tappedAt,
          },
          // A resend of the same tap does nothing.
          { onConflict: "id", ignoreDuplicates: true },
        ),
      );
    } catch (e) {
      return classifyThrown(e);
    }
  };
}

/** The rows this student already has in a lecture that are not undone, or null when offline. */
export async function loadOwnTaps(
  supabase: SupabaseClient,
  lectureId: string,
): Promise<{ id: string; slide: number }[] | null> {
  try {
    const { data, error, status } = await supabase
      .from("lost_taps")
      .select("id, slide_number")
      .eq("lecture_id", lectureId)
      .eq("undone", false);
    if (error) {
      if (classifyError(error, status) === "offline") return null;
      throw new Error(error.message);
    }
    return (data ?? []).map((r) => ({ id: r.id as string, slide: r.slide_number as number }));
  } catch (e) {
    classifyThrown(e); // throws unless the network is down
    return null;
  }
}
