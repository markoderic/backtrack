import type { SupabaseClient } from "@supabase/supabase-js";
import { isRect, type Rect } from "./rect";
import type { QueueOp, SendResult } from "./tapQueue";
import { timed } from "./requestTimeout";

/** One of the student's own rows, as the live screen needs it: which slide, what kind, its note and mark. */
export type OwnTap = { id: string; slide: number; kind: "lost" | "save"; note?: string; rect?: Rect };

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

/**
 * The SQLSTATE the tap limit trigger raises (supabase/migrations/0012_tap_limits.sql): one
 * student made over 20 taps in a minute, or 300 in the lecture. Checked before the status,
 * so whatever HTTP status the API gives it, the tap is dropped and never retried.
 */
export const TAP_LIMIT_CODE = "BT429";

/** The result of one supabase-js call, as ok, rejected, limited, capped, throttled or offline. */
export function classifySend(res: { error: ErrorLike | null; status?: number }): SendResult {
  if (!res.error) return "ok";
  // Same code for both limits; the 300 a lecture one says "in this lecture".
  if (res.error.code === TAP_LIMIT_CODE) return /in this lecture/i.test(res.error.message ?? "") ? "capped" : "limited";
  // The login is gone or expired (401), or the API is turning requests away (429). Retried
  // a few times with a wait, then dropped, so it can't block the taps behind it for good.
  const status = res.status ?? res.error.status;
  if (status === 401 || status === 429) return "throttled";
  return classifyError(res.error, res.status);
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
        // The rect is four columns in the database; there is no rect column. A null rect clears all four.
        const { rect, ...rest } = op.patch;
        const patch =
          rect === undefined
            ? rest
            : rect === null
              ? { ...rest, hl_x: null, hl_y: null, hl_w: null, hl_h: null }
              : { ...rest, hl_x: rect.x, hl_y: rect.y, hl_w: rect.w, hl_h: rect.h };
        // A send that hangs gives up after 15 s: offline, so the queue keeps it and sends it again.
        return classifySend(await timed(supabase.from("lost_taps").update(patch).eq("id", op.id)));
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
      // A send that hangs gives up after 15 s: offline, so the queue keeps it and sends it again.
      return classifySend(
        await timed(
          supabase.from("lost_taps").upsert(
            {
              id: tap.id,
              lecture_id: lectureId,
              anon_id: session.user.id,
              kind: tap.kind ?? "lost",
              tapped_on_slide: tap.tappedOnSlide,
              slide_number: tap.tappedOnSlide,
              ...(tap.note ? { note: tap.note } : {}),
              ...(tap.rect ? { hl_x: tap.rect.x, hl_y: tap.rect.y, hl_w: tap.rect.w, hl_h: tap.rect.h } : {}),
              tapped_at: tap.tappedAt,
            },
            // A resend of the same tap does nothing.
            { onConflict: "id", ignoreDuplicates: true },
          ),
        ),
      );
    } catch (e) {
      return classifyThrown(e);
    }
  };
}

/**
 * The rows this student already has in a lecture that are not undone, with their note and
 * mark (so Edit note and Clear mark work after a reload), or null when offline.
 */
export async function loadOwnTaps(supabase: SupabaseClient, lectureId: string): Promise<OwnTap[] | null> {
  try {
    // Only this user's own rows: a teacher who joins their own lecture in the same browser
    // could otherwise read every student's lost taps here (the teacher's select policy).
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    if (sessionError) {
      if (classifyError(sessionError) === "offline") return null;
      throw new Error(sessionError.message);
    }
    if (!session) return [];
    // A read that hangs gives up after 15 s and counts as offline.
    const { data, error, status } = await timed(
      supabase
        .from("lost_taps")
        .select("id, slide_number, kind, note, hl_x, hl_y, hl_w, hl_h")
        .eq("lecture_id", lectureId)
        .eq("anon_id", session.user.id)
        .eq("undone", false),
    );
    if (error) {
      if (classifyError(error, status) === "offline") return null;
      throw new Error(error.message);
    }
    // The kind picks the dot: red for I'm lost, open for a save.
    return (data ?? []).map((r) => {
      const tap: OwnTap = {
        id: r.id as string,
        slide: r.slide_number as number,
        kind: r.kind === "save" ? "save" : "lost",
      };
      if (typeof r.note === "string" && r.note.trim() !== "") tap.note = r.note;
      const rect = { x: r.hl_x, y: r.hl_y, w: r.hl_w, h: r.hl_h };
      if (isRect(rect)) tap.rect = rect;
      return tap;
    });
  } catch (e) {
    classifyThrown(e); // throws unless the network is down
    return null;
  }
}
