"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { ButtonPrimaryLink, buttonPrimarySmallClass } from "@/components/ButtonPrimary";
import { backButtonClass } from "./[lectureId]/SpotDetail";
import { Icon } from "@/components/Icon";
import { InfoButton } from "@/components/InfoButton";
import { LogoMark } from "@/components/Logo";
import { formatLectureDate } from "@/lib/lectureDate";
import { loadMyMarks } from "@/lib/marksApi";
import { loadNotebookSlides } from "@/lib/notebookApi";
import { createBrowserSupabase } from "@/lib/supabase/browser";

type Item = {
  id: string;
  name: string;
  date: string;
  joinedAt: string;
  /**
   * How many slides have a spot (one per slide, as on the lecture's page): a tap, a mark or a notebook
   * note. Null when unknown.
   */
  spots: number | null;
  /** The lecture is going on right now. */
  live: boolean;
};

type JoinedLecture = { id: string; name: string; lecture_date: string; status?: string };
type JoinedRow = {
  joined_at: string;
  lectures: JoinedLecture | JoinedLecture[] | null;
};

/**
 * The slides with a spot, per lecture: the student's own rows that are not undone, their marks
 * (slide_marks) and their notebook notes, one per slide (two taps, or a tap and marks, on one slide
 * are one spot), as on the lecture's page. Only a label: null when the taps can not be read. Before
 * migration 0020 (no marks, no notebook) the taps alone.
 */
async function spotCounts(userId: string): Promise<Map<string, Set<number>> | null> {
  try {
    const supabase = createBrowserSupabase();
    const [taps, marks, notes] = await Promise.all([
      supabase.from("lost_taps").select("lecture_id, slide_number").eq("anon_id", userId).eq("undone", false),
      loadMyMarks(supabase, null).catch(() => null),
      loadNotebookSlides(supabase).catch(() => null),
    ]);
    if (taps.error) return null;
    const out = new Map<string, Set<number>>();
    const add = (lecture: string, slide: number) => {
      const set = out.get(lecture) ?? new Set<number>();
      set.add(slide);
      out.set(lecture, set);
    };
    for (const r of (taps.data ?? []) as { lecture_id: string; slide_number: number }[]) add(r.lecture_id, r.slide_number);
    if (marks?.status === "ok") for (const m of marks.data) add(m.lectureId, m.slide);
    if (notes?.status === "ok") for (const n of notes.data) add(n.lectureId, n.slide);
    return out;
  } catch {
    return null;
  }
}

/** Every lecture this browser joined: the live ones first, then newest first. */
async function loadJoined(): Promise<Item[]> {
  const supabase = createBrowserSupabase();
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) throw new Error(sessionError.message);
  // Never joined anything on this browser.
  if (!session) return [];

  // Own rows only: a teacher can read every participant of their lectures, which would list each lecture once per student.
  const { data, error } = await supabase
    .from("participants")
    .select("joined_at, lectures(id, name, lecture_date, status)")
    .eq("anon_id", session.user.id);
  if (error) throw new Error(error.message);

  const counts = await spotCounts(session.user.id);
  const items: Item[] = [];
  for (const row of (data ?? []) as unknown as JoinedRow[]) {
    const l = Array.isArray(row.lectures) ? row.lectures[0] : row.lectures;
    if (l)
      items.push({
        id: l.id,
        name: l.name,
        date: l.lecture_date,
        joinedAt: row.joined_at,
        spots: counts ? (counts.get(l.id)?.size ?? 0) : null,
        live: l.status === "live",
      });
  }
  // A lecture going on right now comes first: that is where the student goes back to.
  return items.sort(
    (a, b) => Number(b.live) - Number(a.live) || b.date.localeCompare(a.date) || b.joinedAt.localeCompare(a.joinedAt),
  );
}

export function LectureList() {
  const [items, setItems] = useState<Item[] | null>(null);
  // A failed query is thrown on the next render, so the error page shows (never an empty list).
  const [fatal, setFatal] = useState<Error | null>(null);
  if (fatal) throw fatal;

  useEffect(() => {
    let cancelled = false;
    loadJoined().then(
      (list) => {
        if (!cancelled) setItems(list);
      },
      (e: unknown) => {
        if (!cancelled) setFatal(e instanceof Error ? e : new Error(String(e)));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      {/* Lined up with the content column below it. */}
      <header className="mx-auto flex h-16 w-full max-w-5xl shrink-0 items-center gap-2 pl-4 pr-2 sm:pl-6 lg:px-8">
        {/* Up one level: Home. */}
        <Link href="/" aria-label="Back to Home" className={backButtonClass}>
          <Icon name="back" />
        </Link>
        <span className="pl-1">
          <LogoMark size={22} />
        </span>
        <div className="min-w-0 flex-1" />
        <InfoButton panelClassName="-right-11" />
        {/* Room for the theme button, which comes with dark mode (not built yet). */}
        <span aria-hidden data-theme-slot="" className="size-9 shrink-0" />
      </header>

      <main className="mx-auto flex w-full max-w-5xl animate-page-in flex-col gap-1 px-4 pb-16 pt-6 sm:px-6 lg:px-8 lg:pt-10">
        <h1 className="type-display text-ink lg:text-[40px] lg:leading-12">My lectures</h1>
        {items &&
          (items.length === 0 ? (
            <p className="pt-2 type-body text-secondary">No lectures yet.</p>
          ) : (
            <ul className="flex flex-col pt-6 lg:pt-8">
              {items.map((l, i) => (
                <li
                  key={l.id}
                  style={{ "--stagger": `${Math.min(i, 8) * 30}ms` } as CSSProperties}
                  className="animate-rise-in border-t border-hairline [animation-delay:var(--stagger)] last:border-b motion-reduce:[animation-delay:0ms]"
                >
                  <Link
                    href={`/spots/${l.id}`}
                    className="press -mx-2 flex items-center gap-4 rounded-md px-2 py-5 hover:bg-surface/60 focus-ring lg:gap-6 lg:py-6"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      {l.live && (
                        // The one place red is not I'm lost (Marko: cohesive, and a sense of urgency).
                        <span data-live-now="" className="flex items-center gap-2 type-small-strong text-ink">
                          <span aria-hidden data-live-dot="" className="size-2 rounded-full bg-lost" />
                          Live now
                        </span>
                      )}
                      <span className="break-words type-lecture text-ink lg:type-lecture-l">{l.name}</span>
                    </span>
                    {l.spots !== null && l.spots > 0 && (
                      <span data-spot-count="" className="shrink-0 type-small text-ink lg:type-body">
                        {l.spots === 1 ? "1 spot" : `${l.spots} spots`}
                      </span>
                    )}
                    <span className="shrink-0 text-right type-small text-secondary sm:w-24 lg:w-28 lg:type-body">
                      {formatLectureDate(l.date)}
                    </span>
                    <Icon name="forward" className="text-secondary" />
                  </Link>
                  {l.live && (
                    // The way back into class: the one black button on the list.
                    <div className="pb-4">
                      <Link href={`/l/${l.id}`} aria-label={`Back to lecture, ${l.name}`} className={buttonPrimarySmallClass}>
                        Back to lecture
                      </Link>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ))}
        {items && (
          <div className="pt-8">
            <ButtonPrimaryLink href="/join">Join a class</ButtonPrimaryLink>
          </div>
        )}
      </main>
    </div>
  );
}
