"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createBrowserSupabase } from "@/lib/supabase/browser";

/** The note to the teacher (lost_taps.note) before migration 0020: its check in 0007. */
export const LEGACY_NOTE_MAX = 140;
/** The note to the teacher once 0020 has run (its part 2). */
export const TEACHER_NOTE_MAX = 2000;

// Once the database is known to have 0020 it keeps it, so later screens start at 2000.
let known: number | null = null;

/**
 * How long the note to the teacher may be: 2000 when the database has migration 0020 (its
 * slide_marks table answers), else 140. The code goes out before the migration runs, so until
 * then the old limit stays. Offline or any other trouble also gives 140 (asked again next time).
 */
export async function loadTeacherNoteMax(supabase: SupabaseClient): Promise<number> {
  if (known !== null) return known;
  try {
    const { error } = await supabase.from("slide_marks").select("id").limit(0);
    if (error) return LEGACY_NOTE_MAX;
    known = TEACHER_NOTE_MAX;
    return known;
  } catch {
    return LEGACY_NOTE_MAX;
  }
}

/** For tests: forget what the last probe found. */
export function forgetTeacherNoteMax(): void {
  known = null;
}

/** loadTeacherNoteMax for a component: 140 until the database says 2000. */
export function useTeacherNoteMax(): number {
  const [max, setMax] = useState(known ?? LEGACY_NOTE_MAX);
  useEffect(() => {
    let on = true;
    void loadTeacherNoteMax(createBrowserSupabase()).then((m) => {
      if (on) setMax(m);
    });
    return () => {
      on = false;
    };
  }, []);
  return max;
}

/** The quiet "N left" counter shows from this many characters on (120 of 140, 1980 of 2000). */
export const noteCounterFrom = (max: number) => max - 20;

/** A note's length as the database counts it (Postgres length(): whole characters, an emoji is one). */
export const noteLength = (text: string) => Array.from(text).length;

/**
 * A note cut to `max` whole characters (never half an emoji, so the database never gets a broken
 * character; past the limit it would refuse the whole save).
 */
export function cutNote(text: string, max: number): string {
  return noteLength(text) <= max ? text : Array.from(text).slice(0, max).join("");
}
