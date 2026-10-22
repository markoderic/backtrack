"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { notesBySlide, slideStats, topThree, type TapRow } from "@/lib/stats";

const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 10000;
const PAGE = 1000;

type Props = {
  lectureId: string;
  /** live follows the lecture as it happens and can end it; past loads once. */
  mode: "live" | "past";
  lectureName: string;
  /** One entry for every slide, 1 to the slide count. */
  slides: { number: number; first_line: string }[];
  initialCurrentSlide?: number;
  /** Past mode links back to this course. */
  courseId?: string;
};

type Supabase = ReturnType<typeof createBrowserSupabase>;

// The API returns at most 1000 rows a call, so a big lecture is read in pages.
async function readTaps(supabase: Supabase, lectureId: string): Promise<TapRow[]> {
  const out: TapRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("lost_taps")
      .select("id, anon_id, kind, slide_number, note, undone, tapped_at")
      .eq("lecture_id", lectureId)
      .eq("kind", "lost")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data as TapRow[]));
    if (data.length < PAGE) return out;
  }
}

async function readJoined(supabase: Supabase, lectureId: string): Promise<number> {
  const { count, error } = await supabase
    .from("participants")
    .select("lecture_id", { count: "exact", head: true })
    .eq("lecture_id", lectureId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function readLecture(supabase: Supabase, lectureId: string): Promise<{ current_slide: number; status: string }> {
  const { data, error } = await supabase
    .from("lectures")
    .select("current_slide, status")
    .eq("id", lectureId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Lecture not found.");
  return data;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  if (target.isContentEditable) return true;
  const attr = target.getAttribute("contenteditable");
  return attr !== null && attr !== "false";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function LectureData({ lectureId, mode, lectureName, slides, initialCurrentSlide, courseId }: Props) {
  const router = useRouter();
  const [live, setLive] = useState(mode === "live");
  const [justEnded, setJustEnded] = useState(false);
  const [taps, setTaps] = useState<Map<string, TapRow>>(new Map());
  const [joined, setJoined] = useState<number | null>(null);
  const [current, setCurrent] = useState(initialCurrentSlide ?? 1);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState(false);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // For each read still running: what Realtime changed meanwhile. Those win
    // over what the read brings back, which may be older.
    const inflight = new Set<Set<string>>();

    const retry = () => {
      if (cancelled) return;
      clearTimeout(timer);
      timer = setTimeout(refetch, Math.min(RETRY_FIRST_MS * 2 ** failures, RETRY_MAX_MS));
      failures++;
      setFailed(true);
    };

    async function refetch() {
      clearTimeout(timer);
      timer = undefined;
      const touched = new Set<string>();
      inflight.add(touched);
      try {
        const [list, count, lecture] = await Promise.all([
          readTaps(supabase, lectureId),
          readJoined(supabase, lectureId),
          live ? readLecture(supabase, lectureId) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        failures = 0;
        setFailed(false);
        setTaps((prev) => {
          const next = new Map(list.map((r) => [r.id, r]));
          for (const id of touched) {
            const own = prev.get(id);
            if (own) next.set(id, own);
          }
          return next;
        });
        // People never leave, so a smaller number is an older one.
        setJoined((prev) => Math.max(prev ?? 0, count));
        if (lecture) {
          if (lecture.status === "ended") {
            setLive(false);
            setJustEnded(true);
          } else if (!touched.has("lecture")) {
            setCurrent(lecture.current_slide);
          }
        }
        setLoaded(true);
      } catch {
        // Keep what is on screen and try again.
        retry();
      } finally {
        inflight.delete(touched);
      }
    }

    const touch = (id: string) => inflight.forEach((t) => t.add(id));
    const put = (payload: { new: unknown }) => {
      const row = payload.new as TapRow;
      if (row.kind !== "lost") return;
      touch(row.id);
      setTaps((prev) => new Map(prev).set(row.id, row));
    };

    let channel: ReturnType<Supabase["channel"]> | undefined;
    if (live) {
      channel = supabase
        .channel(`lecture-data-${lectureId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "lost_taps", filter: `lecture_id=eq.${lectureId}` },
          put,
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "lost_taps", filter: `lecture_id=eq.${lectureId}` },
          put,
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "participants", filter: `lecture_id=eq.${lectureId}` },
          () => setJoined((n) => (n ?? 0) + 1),
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "lectures", filter: `id=eq.${lectureId}` },
          (payload) => {
            const row = payload.new as { current_slide: number; status: string };
            touch("lecture");
            if (row.status === "ended") {
              setLive(false);
              setJustEnded(true);
            } else {
              setCurrent(row.current_slide);
            }
          },
        )
        // Reads everything again on every SUBSCRIBED, which also covers a reconnect that missed rows.
        .subscribe((status) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") void refetch();
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") retry();
        });
    }
    void refetch();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [lectureId, live]);

  // Escape goes back to the projector (D6). Nothing else is a shortcut.
  useEffect(() => {
    if (!live) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.repeat || isTyping(e.target)) return;
      if (confirming) {
        setConfirming(false);
        return;
      }
      router.push(`/teach/l/${lectureId}/present`);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [live, confirming, lectureId, router]);

  async function endLecture() {
    setEnding(true);
    setEndError(false);
    try {
      const { error } = await createBrowserSupabase().rpc("end_lecture", { p_lecture_id: lectureId });
      if (error) throw new Error(error.message);
      setConfirming(false);
      setLive(false);
      setJustEnded(true);
    } catch {
      setConfirming(false);
      setEndError(true);
    } finally {
      setEnding(false);
    }
  }

  const rows = useMemo(() => Array.from(taps.values()), [taps]);
  const stats = useMemo(() => slideStats(rows, slides.length), [rows, slides.length]);
  const top = useMemo(() => new Set(topThree(stats)), [stats]);
  const notes = useMemo(() => notesBySlide(rows), [rows]);
  const most = Math.max(0, ...stats.map((s) => s.students));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl">{lectureName}</h1>
          {joined !== null && <p>{joined} joined</p>}
        </div>
        {live ? (
          <button
            type="button"
            onClick={() => {
              setEndError(false);
              setConfirming(true);
            }}
            className="border border-current px-4 py-2"
          >
            End lecture
          </button>
        ) : (
          courseId && (
            <Link href={`/teach/c/${courseId}`} className="border border-current px-4 py-2">
              Back to the course
            </Link>
          )
        )}
      </header>

      {!live && justEnded && <p role="status">Lecture ended.</p>}
      {endError && <p role="alert">Could not end the lecture.</p>}
      {failed && (
        <p role="status">{loaded ? "Not up to date. Trying again." : "Could not load the data. Trying again."}</p>
      )}
      {!loaded && !failed && <p role="status">Loading...</p>}

      {loaded && (
        <ol className="flex flex-col gap-4">
          {slides.map((slide) => {
            const stat = stats[slide.number - 1];
            const list = notes.get(slide.number);
            return (
              <li key={slide.number} data-testid={`slide-${slide.number}`} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span>Slide {slide.number}</span>
                  <span className="min-w-0 truncate">{slide.first_line}</span>
                  {top.has(slide.number) && <span className="font-semibold">Top 3</span>}
                  {live && slide.number === current && <span className="font-semibold">Current slide</span>}
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-4 flex-1 border border-current">
                    <div
                      data-testid="bar"
                      className="h-full bg-current"
                      style={{ width: `${most === 0 ? 0 : Math.round((stat.students / most) * 100)}%` }}
                    />
                  </div>
                  <span data-testid="counts" className="shrink-0">
                    {plural(stat.students, "person", "people")}, {plural(stat.taps, "tap", "taps")}
                  </span>
                </div>
                {list && (
                  <ul className="list-disc pl-6">
                    {list.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {confirming && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="end-lecture-title"
            className="flex w-full max-w-sm flex-col gap-4 border border-current bg-white p-6"
          >
            <p id="end-lecture-title">End lecture? The code stops working and students go to My spots.</p>
            <div className="flex gap-3">
              <button
                type="button"
                autoFocus
                disabled={ending}
                onClick={() => setConfirming(false)}
                className="border border-current px-4 py-2"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={ending}
                onClick={() => void endLecture()}
                className="border border-current px-4 py-2"
              >
                End
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
