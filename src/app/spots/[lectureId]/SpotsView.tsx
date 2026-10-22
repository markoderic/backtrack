"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { InfoButton } from "@/components/InfoButton";
import { formatLectureDate } from "@/lib/lectureDate";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { flushLeftoverTaps, rejectedKey } from "@/lib/tapSync";
import { SpotDetail, type Spot } from "./SpotDetail";

const REJECTED_TEXT = "This one didn't save because the lecture had ended.";

type Props = {
  lectureId: string;
  /** The signed in student, so a teacher who opens the page never sees other students' taps. */
  userId: string;
  lectureName: string;
  /** YYYY-MM-DD */
  lectureDate: string;
  /** Only used to stop the next arrow on the last slide. It is never shown. */
  slideCount: number;
};

type Loaded = {
  spots: Spot[];
  firstLines: Record<number, string>;
  /** Different students lost on each slide, by slide number. */
  students: Record<number, number>;
};

/** Different students lost on each slide of the lecture. */
async function loadStudents(lectureId: string): Promise<Record<number, number>> {
  const { data, error } = await createBrowserSupabase().rpc("lecture_slide_stats", { p_lecture_id: lectureId });
  if (error) throw new Error(error.message);
  const out: Record<number, number> = {};
  for (const r of (data ?? []) as { slide_number: number; students: number }[]) out[r.slide_number] = r.students;
  return out;
}

async function loadAll(lectureId: string, userId: string): Promise<Loaded> {
  const supabase = createBrowserSupabase();
  const [taps, slides, students] = await Promise.all([
    supabase
      .from("lost_taps")
      .select("id, kind, slide_number, note, tapped_at")
      .eq("lecture_id", lectureId)
      .eq("undone", false)
      .eq("anon_id", userId),
    supabase.from("slides").select("number, first_line").eq("lecture_id", lectureId),
    loadStudents(lectureId),
  ]);
  if (taps.error) throw new Error(taps.error.message);
  if (slides.error) throw new Error(slides.error.message);

  const spots: Spot[] = ((taps.data ?? []) as Record<string, unknown>[])
    .map((r) => ({
      id: r.id as string,
      kind: r.kind as Spot["kind"],
      slideNumber: r.slide_number as number,
      note: (r.note as string | null) ?? null,
      tappedAt: r.tapped_at as string,
    }))
    .sort((a, b) => a.tappedAt.localeCompare(b.tappedAt));

  const firstLines: Record<number, string> = {};
  for (const s of (slides.data ?? []) as { number: number; first_line: string }[]) firstLines[s.number] = s.first_line;
  return { spots, firstLines, students };
}

/** True when a tap of this lecture was refused. Reads the key; clearing it is the caller's job. */
function wasRejected(lectureId: string): boolean {
  try {
    return window.sessionStorage.getItem(rejectedKey(lectureId)) !== null;
  } catch {
    return false;
  }
}

function clearRejected(lectureId: string): void {
  try {
    window.sessionStorage.removeItem(rejectedKey(lectureId));
  } catch {
    // Storage is blocked; the notice just shows again next time.
  }
}

export function SpotsView({ lectureId, userId, lectureName, lectureDate, slideCount }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [rejected, setRejected] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // A failed query is thrown on the next render, so the error page shows (never an empty list).
  const [fatal, setFatal] = useState<Error | null>(null);
  if (fatal) throw fatal;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // A tap still waiting from the lecture screen goes first, so it shows up below.
      await flushLeftoverTaps(lectureId);
      if (cancelled) return;
      const refused = wasRejected(lectureId);
      const data = await loadAll(lectureId, userId);
      if (cancelled) return;
      setLoaded(data);
      if (refused) {
        setRejected(true);
        clearRejected(lectureId);
      }
    })().catch((e: unknown) => {
      if (!cancelled) setFatal(e instanceof Error ? e : new Error(String(e)));
    });
    return () => {
      cancelled = true;
    };
  }, [lectureId, userId]);

  async function onMoved(id: string, newSlide: number) {
    try {
      const students = await loadStudents(lectureId);
      setLoaded((l) =>
        l && {
          ...l,
          students,
          spots: l.spots.map((s) => (s.id === id ? { ...s, slideNumber: newSlide } : s)),
        },
      );
    } catch (e) {
      setFatal(e instanceof Error ? e : new Error(String(e)));
    }
  }

  function onNoteSaved(id: string, note: string | null) {
    setLoaded((l) => l && { ...l, spots: l.spots.map((s) => (s.id === id ? { ...s, note } : s)) });
  }

  const open = loaded?.spots.find((s) => s.id === openId);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 p-4">
      {rejected && <p role="alert">{REJECTED_TEXT}</p>}

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold">{lectureName}</h1>
          <p>{formatLectureDate(lectureDate)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Link href="/spots" className="underline">
            All lectures
          </Link>
          <InfoButton />
        </div>
      </header>

      {loaded &&
        (open ? (
          <SpotDetail
            key={open.id}
            lectureId={lectureId}
            spot={open}
            students={loaded.students[open.slideNumber] ?? 0}
            slideCount={slideCount}
            onNoteSaved={(note) => onNoteSaved(open.id, note)}
            onMoved={(n) => onMoved(open.id, n)}
            onBack={() => setOpenId(null)}
          />
        ) : loaded.spots.length === 0 ? (
          <p>You didn&apos;t mark any spots in this lecture.</p>
        ) : (
          <>
            <p className="text-xl">
              You saved {loaded.spots.length} {loaded.spots.length === 1 ? "spot" : "spots"}
            </p>
            <ul className="flex flex-col gap-3">
              {loaded.spots.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(s.id)}
                    className="flex w-full flex-col gap-1 border border-current p-3 text-left"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold">Slide {s.slideNumber}</span>
                      <span>{s.kind === "save" ? "Saved" : "Lost"}</span>
                    </span>
                    {loaded.firstLines[s.slideNumber] && (
                      <span className="break-words">{loaded.firstLines[s.slideNumber]}</span>
                    )}
                    {s.note && <span className="break-words">{s.note}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ))}
    </main>
  );
}
