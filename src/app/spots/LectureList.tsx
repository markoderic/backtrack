"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { InfoButton } from "@/components/InfoButton";
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
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 p-4">
      <header className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">My spots</h1>
        <InfoButton />
      </header>

      {items &&
        (items.length === 0 ? (
          <p>No lectures yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((l) => (
              <li key={l.id}>
                <Link href={`/spots/${l.id}`} className="flex items-baseline justify-between gap-3 border border-current p-3">
                  <span className="min-w-0 break-words">{l.name}</span>
                  <span className="shrink-0">{formatLectureDate(l.date)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ))}

      <Link href="/join" className="self-start border border-current px-4 py-3">
        Join a class
      </Link>
    </main>
  );
}
