import { classifySend } from "./lostTapApi";

type ErrorLike = { code?: string | null; message?: string; status?: number };

/**
 * Errors that mean "that table, column or function is not in the database (yet)": the app is
 * running before the migration that adds it. Postgres says 42P01 (no such table), 42703 (no such
 * column) or 42883 (no such function); PostgREST says PGRST205 (table), PGRST204 (column) or
 * PGRST202 (function) when its schema cache does not have it.
 */
const MISSING_CODES = new Set(["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"]);

export function isMissingSchema(error: ErrorLike | null | undefined): boolean {
  return !!error?.code && MISSING_CODES.has(error.code);
}

/** The result of one write: saved, not there yet (migration missing), or what classifySend says. */
export type WriteResult = "ok" | "offline" | "rejected" | "throttled" | "missing";

/** A write's supabase-js result as a WriteResult. A missing table, column or function is "missing". */
export function classifyWrite(res: { error: ErrorLike | null; status?: number }): WriteResult {
  if (res.error && isMissingSchema(res.error)) return "missing";
  const r = classifySend(res);
  // The tap limit (BT429) is not raised by these writes; if it ever were, it is a refusal.
  return r === "limited" || r === "capped" ? "rejected" : r;
}

/** A read: the rows, offline (try again later), or the migration is not there yet. */
export type Loaded<T> = { status: "ok"; data: T } | { status: "offline" } | { status: "missing" };
