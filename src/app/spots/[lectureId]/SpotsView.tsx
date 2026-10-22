"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HighlightBoxes } from "@/components/HighlightBoxes";
import { Icon } from "@/components/Icon";
import { InfoButton } from "@/components/InfoButton";
import { LogoMark } from "@/components/Logo";
import { formatLectureDate } from "@/lib/lectureDate";
import { isRect, type Rect } from "@/lib/rect";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { flushLeftoverTaps, rejectedKey } from "@/lib/tapSync";
import { useLiveLecture } from "@/lib/useLiveLecture";
import { useSlideImages } from "@/lib/useSlideImages";
import { formatClock } from "../time";
import { groupBySlide, type Spot, type SpotRow } from "../group";
import { buttonSecondaryClass } from "@/components/ButtonPrimary";
import { SpotDetail, backButtonClass, countLine, highlightClass, whenLine } from "./SpotDetail";

type Props = {
  lectureId: string;
  /** The signed in student, so a teacher who opens the page never sees other students' taps. */
  userId: string;
  /** For the top bar. Empty when it could not be read. */
  courseName?: string;
  lectureName: string;
  /** YYYY-MM-DD */
  lectureDate: string;
  /** When the lecture ended, or null while it is live. */
  endedAt?: string | null;
  /** Only used to stop the next arrow on the last slide. Never shown; null while the lecture is live (D10). */
  slideCount: number | null;
  /** The live slide (as the server read it) while the lecture is live; null once it ended. Followed live from there. */
  liveSlide?: number | null;
};

type Loaded = {
  /** Every row that is not undone; the page shows them one spot per slide. */
  rows: SpotRow[];
  /** False once the course's time for students to see the slides is over (no slide rows come back). */
  slidesShown: boolean;
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

/** The row's highlight, or null when it has none (the database keeps all four columns or none). */
function rectOf(r: Record<string, unknown>): Rect | null {
  const rect = { x: r.hl_x, y: r.hl_y, w: r.hl_w, h: r.hl_h };
  return isRect(rect) ? rect : null;
}

async function loadAll(lectureId: string, userId: string): Promise<Loaded> {
  const supabase = createBrowserSupabase();
  const [taps, slides, students] = await Promise.all([
    supabase
      .from("lost_taps")
      .select("id, kind, slide_number, note, tapped_at, hl_x, hl_y, hl_w, hl_h")
      .eq("lecture_id", lectureId)
      .eq("undone", false)
      .eq("anon_id", userId),
    supabase.from("slides").select("number, first_line").eq("lecture_id", lectureId),
    loadStudents(lectureId),
  ]);
  if (taps.error) throw new Error(taps.error.message);
  if (slides.error) throw new Error(slides.error.message);

  const rows: SpotRow[] = ((taps.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    kind: r.kind as SpotRow["kind"],
    slideNumber: r.slide_number as number,
    note: (r.note as string | null) ?? null,
    tappedAt: r.tapped_at as string,
    rect: rectOf(r),
  }));

  const slideRows = (slides.data ?? []) as { number: number; first_line: string }[];
  const firstLines: Record<number, string> = {};
  for (const s of slideRows) firstLines[s.number] = s.first_line;
  // Every lecture has slides; none back means the database stopped giving them to this student.
  return { rows, slidesShown: slideRows.length > 0, firstLines, students };
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

/** List items rise in, 30 ms apart; past the 8th they come in together (no delay with reduced motion). */
function stagger(i: number): CSSProperties {
  return { "--stagger": `${Math.min(i, 8) * 30}ms` } as CSSProperties;
}

/** The small slide on a row: the slide's own shape, 176 wide (96 on a phone), with the spot's highlight. */
function Thumb({ url, spot, gone }: { url: string | undefined; spot: Spot; gone?: boolean }) {
  return (
    <div className="relative w-24 shrink-0 overflow-hidden rounded-sm bg-surface shadow-slide sm:w-44">
      {gone ? (
        <div data-slide-gone="" className="flex aspect-video w-full items-center justify-center p-2 text-center">
          <span className="type-caption text-secondary">No longer available</span>
        </div>
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" draggable={false} className="block h-auto w-full" />
      ) : (
        <div className="aspect-video w-full" />
      )}
      {!gone && url && spot.rect && <HighlightBoxes rects={[spot.rect]} boxClassName={highlightClass(spot.kind, true)} />}
    </div>
  );
}

/**
 * Follows the lecture while it is live (the same subscription the lecture screen uses) and reports
 * the teacher's slide, so slide browsing stops at the live slide as it moves. When the lecture ends
 * the page is read again on the server: the end time, the real last slide, no more Back to lecture.
 */
function LiveFollow({ lectureId, initialLive, onLive }: { lectureId: string; initialLive: number; onLive: (n: number) => void }) {
  const router = useRouter();
  const { state } = useLiveLecture(lectureId, initialLive);
  const live = state?.live;
  const ended = state?.ended ?? false;
  const onLiveRef = useRef(onLive);
  useEffect(() => {
    onLiveRef.current = onLive;
  });
  useEffect(() => {
    if (live !== undefined) onLiveRef.current(live);
  }, [live]);
  useEffect(() => {
    if (ended) router.refresh();
  }, [ended, router]);
  return null;
}

export function SpotsView({
  lectureId,
  userId,
  courseName = "",
  lectureName,
  lectureDate,
  endedAt = null,
  slideCount,
  liveSlide = null,
}: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [rejected, setRejected] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // How the open spot was reached, so keyboard focus lands in the right place after the swap.
  const [openedBy, setOpenedBy] = useState<"heading" | "prev" | "next">("heading");
  // The slide on screen in the detail: one signed set of urls serves the thumbnails and the detail, and preloads its next slide.
  const [detailSlide, setDetailSlide] = useState<number | undefined>(undefined);
  const { urlFor } = useSlideImages(lectureId, openId ? detailSlide : undefined);
  // The teacher's slide as it moves; the server's read until the first update.
  const [followedLive, setFollowedLive] = useState<number | null>(null);
  const liveCap = liveSlide === null ? null : (followedLive ?? liveSlide);
  // After the detail closes, focus goes back to the row of the spot that was open (or the heading).
  const returnFocus = useRef<string | null>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
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

  async function onMoved(spot: Spot, newSlide: number) {
    const ids = new Set(spot.ids);
    // The spot keeps its place as the one open: after the move its main row is still spot.id.
    try {
      const students = await loadStudents(lectureId);
      setLoaded((l) =>
        l && {
          ...l,
          students,
          // Every row of the spot moves; the mark stays behind (it was drawn on the slide the marker left).
          rows: l.rows.map((r) => (ids.has(r.id) ? { ...r, slideNumber: newSlide, rect: null } : r)),
        },
      );
    } catch (e) {
      setFatal(e instanceof Error ? e : new Error(String(e)));
    }
  }

  // A note or a mark goes on the main row; clearing one clears it on every row of the slide.
  function onNoteSaved(spot: Spot, note: string | null) {
    const ids = new Set(spot.ids);
    setLoaded(
      (l) =>
        l && {
          ...l,
          rows: l.rows.map((r) => (r.id === spot.id ? { ...r, note } : note === null && ids.has(r.id) ? { ...r, note: null } : r)),
        },
    );
  }

  function onHighlightSaved(spot: Spot, rect: Rect | null) {
    const ids = new Set(spot.ids);
    setLoaded(
      (l) =>
        l && {
          ...l,
          rows: l.rows.map((r) => (r.id === spot.id ? { ...r, rect } : rect === null && ids.has(r.id) ? { ...r, rect: null } : r)),
        },
    );
  }

  async function onRemoved(spot: Spot) {
    const ids = new Set(spot.ids);
    const id = spot.id;
    // The spot leaves the list in the same step as the detail closes, so it never flashes back.
    setLoaded((l) => l && { ...l, rows: l.rows.filter((r) => !ids.has(r.id)) });
    returnFocus.current = id;
    setOpenId(null);
    try {
      // The count of the slide drops by one when this was the student's only lost spot there.
      const students = await loadStudents(lectureId);
      setLoaded((l) => l && { ...l, students });
    } catch {
      // The remove itself worked; the list keeps the counts it had.
    }
  }

  function open(id: string, by: "heading" | "prev" | "next") {
    setOpenedBy(by);
    setOpenId(id);
  }

  function back(id: string) {
    returnFocus.current = id;
    setOpenId(null);
  }

  useEffect(() => {
    if (openId !== null || returnFocus.current === null) return;
    const id = returnFocus.current;
    returnFocus.current = null;
    const row = document.querySelector<HTMLButtonElement>(`[data-spot-id="${id}"]`);
    if (row) row.focus();
    else listHeadingRef.current?.focus();
  }, [openId, loaded]);

  const live = liveSlide !== null;
  // One spot per slide (an older lecture may hold several rows on one slide).
  const spots = useMemo(() => groupBySlide(loaded?.rows ?? []), [loaded]);
  const expired = !!loaded && !live && !loaded.slidesShown;
  // By any of its rows: a marker moved onto a slide that had a spot joins that spot.
  const openIndex = openId === null ? -1 : spots.findIndex((s) => s.ids.includes(openId));
  const current = openIndex >= 0 ? spots[openIndex] : undefined;
  const follow = live && <LiveFollow lectureId={lectureId} initialLive={liveSlide} onLive={setFollowedLive} />;

  if (loaded && current) {
    const prev = spots[openIndex - 1];
    const next = spots[openIndex + 1];
    const openSpot = current;
    return (
      <>
        {follow}
        <SpotDetail
          // A new key when another spot joins this one (its marker moved onto it), so the note and mark are read again.
          key={`${openSpot.id}:${openSpot.ids.length}`}
          lectureId={lectureId}
          spot={openSpot}
          firstLine={loaded.firstLines[openSpot.slideNumber]}
          students={loaded.students[openSpot.slideNumber] ?? 0}
          slideCount={slideCount}
          liveSlide={liveCap}
          urlFor={urlFor}
          expired={expired}
          onViewingChange={setDetailSlide}
          focusOnOpen={openedBy}
          onNoteSaved={(note) => onNoteSaved(openSpot, note)}
          onHighlightSaved={(rect) => onHighlightSaved(openSpot, rect)}
          onMoved={(n) => onMoved(openSpot, n)}
          onRemoved={() => void onRemoved(openSpot)}
          onBack={() => back(openSpot.id)}
          onPrevSpot={prev ? () => open(prev.id, "prev") : undefined}
          onNextSpot={next ? () => open(next.id, "next") : undefined}
        />
      </>
    );
  }

  const when = endedAt ? `${formatLectureDate(lectureDate)}, ended ${formatClock(endedAt)}` : formatLectureDate(lectureDate);
  const notice = rejected && (
    <p role="alert" className="flex animate-fade-in items-center gap-2 type-small text-ink">
      <Icon name="alert" size={18} />
      This one didn&apos;t save because the lecture had ended.
    </p>
  );

  return (
    <>
      {/* At the same place as in the detail, so following the lecture carries on across the swap. */}
      {follow}
      <div className="flex min-h-dvh flex-col bg-bg text-ink">
        <header className="flex h-16 shrink-0 items-center gap-2 pl-4 pr-2">
          {/* Up one level: all the lectures on this browser. */}
          <Link href="/spots" aria-label="Back to My spots" className={backButtonClass}>
            <Icon name="back" />
          </Link>
          <div className="flex min-w-0 items-center gap-2 pl-1">
            <LogoMark size={22} />
            <p className="min-w-0 truncate type-small-strong text-ink">{courseName}</p>
          </div>
          <div className="min-w-0 flex-1" />
          {live && (
            // Opened from the lecture while it is live: the way back into class.
            <Link href={`/l/${lectureId}`} className={`${buttonSecondaryClass} shrink-0`}>
              Back to lecture
            </Link>
          )}
          <InfoButton panelClassName="-right-11" />
          {/* Room for the theme button, which comes with dark mode (not built yet). */}
          <span aria-hidden data-theme-slot="" className="size-9 shrink-0" />
        </header>

        {loaded &&
          (spots.length === 0 ? (
            <main className="mx-auto flex w-full max-w-180 flex-1 animate-page-in flex-col items-center justify-center gap-2 px-6 pb-20 text-center">
              {notice && <div className="pb-4">{notice}</div>}
              <h1 ref={listHeadingRef} tabIndex={-1} className="type-title text-ink outline-hidden">
                No spots yet
              </h1>
              <p className="type-body text-secondary">Slides you mark show up here.</p>
            </main>
          ) : (
            <main className="mx-auto flex w-full max-w-180 animate-page-in flex-col gap-1 px-4 pb-12 pt-6 sm:px-6">
              {notice && <div className="pb-4">{notice}</div>}
              <h1 ref={listHeadingRef} tabIndex={-1} className="type-display text-ink outline-hidden">
                My spots
              </h1>
              <p className="flex flex-wrap items-center gap-x-2">
                <span className="min-w-0 break-words type-lecture text-ink">{lectureName}</span>
                <span className="type-small text-secondary">{when}</span>
              </p>
              {expired && <p className="pt-2 type-small text-secondary">These slides are no longer available.</p>}
              <ul className="flex flex-col pt-6">
                {spots.map((s, i) => {
                  const people = s.kind === "lost" ? countLine(s.kind, loaded.students[s.slideNumber] ?? 0) : null;
                  const first = loaded.firstLines[s.slideNumber];
                  return (
                    <li
                      key={s.id}
                      style={stagger(i)}
                      className="animate-rise-in border-t border-hairline [animation-delay:var(--stagger)] motion-reduce:[animation-delay:0ms]"
                    >
                      <button
                        type="button"
                        data-spot-id={s.id}
                        onClick={() => open(s.id, "heading")}
                        className="press -mx-2 flex w-[calc(100%+16px)] items-start gap-3 rounded-md px-2 py-5 text-left hover:bg-surface/60 focus-ring sm:gap-5"
                      >
                        <span
                          aria-hidden
                          data-spot-number=""
                          className={`w-10 shrink-0 type-number-m sm:w-12 ${s.kind === "lost" ? "text-lost" : "text-ink"}`}
                        >
                          {s.slideNumber}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="sr-only">Slide {s.slideNumber}: </span>
                          <span className="break-words type-body-strong text-ink">{first || `Slide ${s.slideNumber}`}</span>
                          <span className="type-small text-secondary">{whenLine(s)}</span>
                          {people && <span className="type-small text-ink">{people}</span>}
                          {s.note && <span className="break-words type-body text-ink">{s.note}</span>}
                        </span>
                        <Thumb url={urlFor(s.slideNumber)} spot={s} gone={expired} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </main>
          ))}
      </div>
    </>
  );
}
