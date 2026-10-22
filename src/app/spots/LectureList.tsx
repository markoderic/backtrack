"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { ButtonPrimaryLink } from "@/components/ButtonPrimary";
import { Icon } from "@/components/Icon";
import { InfoButton } from "@/components/InfoButton";
import { LogoMark } from "@/components/Logo";
import { formatLectureDate } from "@/lib/lectureDate";
import { createBrowserSupabase } from "@/lib/supabase/browser";

type Item = { id: string; name: string; date: string; joinedAt: string };

type JoinedRow = {
  joined_at: string;
  lectures: { id: string; name: string; lecture_date: string } | { id: string; name: string; lecture_date: string }[] | null;
};

/** Every lecture this browser joined, newest first. */
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
    .select("joined_at, lectures(id, name, lecture_date)")
    .eq("anon_id", session.user.id);
  if (error) throw new Error(error.message);

  const items: Item[] = [];
  for (const row of (data ?? []) as unknown as JoinedRow[]) {
    const l = Array.isArray(row.lectures) ? row.lectures[0] : row.lectures;
    if (l) items.push({ id: l.id, name: l.name, date: l.lecture_date, joinedAt: row.joined_at });
  }
  return items.sort((a, b) => b.date.localeCompare(a.date) || b.joinedAt.localeCompare(a.joinedAt));
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
      <header className="flex h-14 shrink-0 items-center gap-2 pl-4 pr-2">
        <Link href="/" aria-label="Home" className="press -m-1 rounded-md p-1 focus-ring">
          <LogoMark size={22} />
        </Link>
        <div className="min-w-0 flex-1" />
        <InfoButton panelClassName="-right-11" />
        {/* Room for the theme button, which comes with dark mode (not built yet). */}
        <span aria-hidden data-theme-slot="" className="size-9 shrink-0" />
      </header>

      <main className="mx-auto flex w-full max-w-180 animate-page-in flex-col gap-1 px-4 pb-12 pt-6 sm:px-6">
        <h1 className="type-display text-ink">My spots</h1>
        {items &&
          (items.length === 0 ? (
            <p className="pt-2 type-body text-secondary">No lectures yet.</p>
          ) : (
            <ul className="flex flex-col pt-6">
              {items.map((l, i) => (
                <li
                  key={l.id}
                  style={{ "--stagger": `${Math.min(i, 8) * 30}ms` } as CSSProperties}
                  className="animate-rise-in border-t border-hairline [animation-delay:var(--stagger)] last:border-b motion-reduce:[animation-delay:0ms]"
                >
                  <Link
                    href={`/spots/${l.id}`}
                    className="press -mx-2 flex items-center gap-4 rounded-md px-2 py-4 hover:bg-surface/60 focus-ring"
                  >
                    <span className="min-w-0 flex-1 break-words type-lecture text-ink">{l.name}</span>
                    <span className="shrink-0 type-small text-secondary">{formatLectureDate(l.date)}</span>
                    <Icon name="forward" className="text-secondary" />
                  </Link>
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
