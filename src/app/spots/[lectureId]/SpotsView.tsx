"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buttonPrimarySmallClass, buttonSecondaryClass } from "@/components/ButtonPrimary";
import { HighlightBoxes } from "@/components/HighlightBoxes";
import { markLook, useSlideSample } from "@/lib/slideTone";
import { Icon } from "@/components/Icon";
import { InfoButton } from "@/components/InfoButton";
import { LogoMark } from "@/components/Logo";
import { formatLectureDate } from "@/lib/lectureDate";
import type { LiveMark } from "@/lib/markQueue";
import { useTeacherNoteMax } from "@/lib/noteLimit";
import { isRect, type Rect } from "@/lib/rect";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { flushLeftoverTaps, rejectedKey } from "@/lib/tapSync";
import { useLiveLecture } from "@/lib/useLiveLecture";
import { useLiveMarks } from "@/lib/useLiveMarks";
import { useNotebook } from "@/lib/useNotebook";
import { useSlideImages } from "@/lib/useSlideImages";
import { formatClock } from "../time";
import { groupBySlide, type Spot, type SpotRow } from "../group";
import { KindDot, SpotDetail, countLine, highlightClass, whenLine, type SpotKindShown } from "./SpotDetail";

type Props = {
  lectureId: string;
  /** The signed in student, so a teacher who opens the page never sees other students' taps. */
  userId: string;
  /** The course, as a small line over the lecture's name. Empty when it could not be read. */
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

/**
 * One slide in My spots: anything the student left on it. Its I'm lost or save (spot), its marks
 * (slide_marks, migration 0020) and its notebook note. A slide with only marks or only a note is a
 * spot too (controller ruling, Oct 24).
 */
type Entry = {
  slideNumber: number;
  kind: SpotKindShown;
  spot: Spot | null;
  marks: LiveMark[];
  notebook: string;
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

/** The marks drawn on a slide in My spots: from slide_marks (0020), or the spot's one mark before that. */
function marksOf(entry: Entry, table: boolean): Rect[] {
  if (table) return entry.marks.map((m) => m.rect);
  return entry.spot?.rect ? [entry.spot.rect] : [];
}

/** The small slide on a row: the slide's own shape, bigger from 640 and 1024 px, with the slide's marks. */
function Thumb({ url, entry, table, gone }: { url: string | undefined; entry: Entry; table: boolean; gone?: boolean }) {
  const rects = marksOf(entry, table);
  const kind = entry.spot?.kind === "lost" ? "lost" : "save";
  // The slide measured, so each mark shows on it (a glow on a dark part, the highlighter on a light one).
  // Only a thumbnail with marks is measured (the others are not downloaded a second time).
  const sample = useSlideSample(gone || rects.length === 0 ? undefined : url);
  return (
    <div data-thumb="" className="relative w-28 shrink-0 overflow-hidden rounded-sm bg-surface shadow-slide sm:w-56 lg:w-72">
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
      {!gone && url && rects.length > 0 && (
        <HighlightBoxes
          rects={rects}
          boxClassName={(r) => highlightClass(kind, markLook(sample, r, kind).tone)}
          opacity={(r) => markLook(sample, r, kind).opacity}
        />
      )}
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
  // The slide of the spot that is open.
  const [openSlide, setOpenSlide] = useState<number | null>(null);
  // How the open spot was reached, so keyboard focus lands in the right place after the swap.
  const [openedBy, setOpenedBy] = useState<"heading" | "prev" | "next">("heading");
  // The slide on screen in the detail: one signed set of urls serves the thumbnails and the detail, and preloads its next slide.
  const [detailSlide, setDetailSlide] = useState<number | undefined>(undefined);
  const { urlFor } = useSlideImages(lectureId, openSlide !== null ? detailSlide : undefined);
  // The teacher's slide as it moves; the server's read until the first update.
  const [followedLive, setFollowedLive] = useState<number | null>(null);
  const liveCap = liveSlide === null ? null : (followedLive ?? liveSlide);
  // The note to the teacher: 2000 characters once the database has migration 0020, else 140.
  const noteMax = useTeacherNoteMax();
  // The student's marks (slide_marks, 0020): marks still waiting from the live screen go out first.
  const marks = useLiveMarks(lectureId);
  const table = marks.mode === "table";
  // The student's notebook: text still waiting on the device from the live screen goes out first.
  const notebook = useNotebook(lectureId);
  // After the detail closes, focus goes back to the row of the spot that was open (or the heading).
  const returnFocus = useRef<number | null>(null);
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

  // The note to the teacher goes on the main row; clearing it clears it on every row of the slide.
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

  // Before 0020: the spot's one mark on its main row; clearing it clears every row of the slide.
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

  const live = liveSlide !== null;
  // One entry per slide: its spot (one per slide, an older lecture may hold several rows on one slide),
  // its marks and its notebook note. A slide with only marks or only a note is listed too.
  const entries = useMemo(() => {
    const bySlide = new Map<number, Entry>();
    const entry = (slide: number, kind: SpotKindShown) => {
      let e = bySlide.get(slide);
      if (!e) {
        e = { slideNumber: slide, kind, spot: null, marks: [], notebook: "" };
        bySlide.set(slide, e);
      }
      return e;
    };
    for (const s of groupBySlide(loaded?.rows ?? [])) entry(s.slideNumber, s.kind).spot = s;
    if (table) for (const m of marks.marks) entry(m.slide, "mark").marks.push(m);
    for (const slide of notebook.slides) entry(slide, "note");
    for (const e of bySlide.values()) e.notebook = notebook.textOf(e.slideNumber);
    return [...bySlide.values()].sort((a, b) => a.slideNumber - b.slideNumber);
  }, [loaded, table, marks.marks, notebook]);

  /**
   * Remove. "tap": the I'm lost or save was taken back (its rows are undone): the slide's marks turn
   * yellow ('save'), and the slide stays in the list while it still has marks or a note. "all": a slide
   * with only marks or a note: they are deleted.
   */
  async function onRemoved(entry: Entry, what: "tap" | "all") {
    const slide = entry.slideNumber;
    let stays = false;
    if (what === "tap" && entry.spot) {
      const ids = new Set(entry.spot.ids);
      // The spot leaves the list in the same step as the detail closes, so it never flashes back.
      setLoaded((l) => l && { ...l, rows: l.rows.filter((r) => !ids.has(r.id)) });
      // Not lost any more: the marks are just for the student now (queued, so it goes even offline).
      if (table && entry.spot.kind === "lost") marks.setKind(slide, "save");
      stays = (table && entry.marks.length > 0) || entry.notebook.trim() !== "";
    } else {
      for (const m of entry.marks) marks.remove(m.id);
      notebook.set(slide, "");
      void notebook.flush();
    }
    if (!stays) {
      returnFocus.current = slide;
      setOpenSlide(null);
    }
    try {
      // The count of the slide drops by one when this was the student's only lost spot there.
      const students = await loadStudents(lectureId);
      setLoaded((l) => l && { ...l, students });
    } catch {
      // The remove itself worked; the list keeps the counts it had.
    }
  }

  function open(slide: number, by: "heading" | "prev" | "next") {
    setOpenedBy(by);
    setOpenSlide(slide);
  }

  function back(slide: number) {
    returnFocus.current = slide;
    setOpenSlide(null);
  }

  useEffect(() => {
    if (openSlide !== null || returnFocus.current === null) return;
    const slide = returnFocus.current;
    returnFocus.current = null;
    const row = document.querySelector<HTMLButtonElement>(`[data-spot-slide-row="${slide}"]`);
    if (row) row.focus();
    else listHeadingRef.current?.focus();
  }, [openSlide, loaded]);

  const expired = !!loaded && !live && !loaded.slidesShown;
  const openIndex = openSlide === null ? -1 : entries.findIndex((e) => e.slideNumber === openSlide);
  const current = openIndex >= 0 ? entries[openIndex] : undefined;
  const follow = live && <LiveFollow lectureId={lectureId} initialLive={liveSlide} onLive={setFollowedLive} />;

  if (loaded && current) {
    const prev = entries[openIndex - 1];
    const next = entries[openIndex + 1];
    const openEntry = current;
    const slide = openEntry.slideNumber;
    const markKind = openEntry.spot?.kind === "lost" ? "lost" : "save";
    return (
      <>
        {follow}
        <SpotDetail
          key={slide}
          lectureId={lectureId}
          spot={openEntry.spot}
          slideNumber={slide}
          kind={openEntry.kind === "note" ? "note" : "mark"}
          firstLine={loaded.firstLines[slide]}
          students={loaded.students[slide] ?? 0}
          slideCount={slideCount}
          liveSlide={liveCap}
          urlFor={urlFor}
          expired={expired}
          onViewingChange={setDetailSlide}
          focusOnOpen={openedBy}
          onNoteSaved={(note) => openEntry.spot && onNoteSaved(openEntry.spot, note)}
          noteMax={noteMax}
          marks={
            table
              ? {
                  list: openEntry.marks.map((m) => (m.note ? { id: m.id, rect: m.rect, kind: markKind, note: m.note } : { id: m.id, rect: m.rect, kind: markKind })),
                  add: (rect) => void marks.add(slide, rect, markKind),
                  remove: marks.remove,
                  setNote: marks.setNote,
                  problem: marks.problem?.text ?? null,
                }
              : null
          }
          notebook={{
            text: openEntry.notebook,
            state: notebook.stateOf(slide),
            onChange: (text) => notebook.set(slide, text),
            onFlush: () => void notebook.flush(),
          }}
          onHighlightSaved={(rect) => openEntry.spot && onHighlightSaved(openEntry.spot, rect)}
          onRemoved={(what) => void onRemoved(openEntry, what)}
          onBack={() => back(slide)}
          onPrevSpot={prev ? () => open(prev.slideNumber, "prev") : undefined}
          onNextSpot={next ? () => open(next.slideNumber, "next") : undefined}
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
        {/* Lined up with the content column below it. */}
        <header className="mx-auto flex h-16 w-full max-w-5xl shrink-0 items-center gap-2 pl-4 pr-2 sm:pl-6 lg:px-8">
          {/* Up one level: all the lectures on this browser. */}
          <Link href="/spots" className={`${buttonSecondaryClass} shrink-0 pl-2`}>
            <Icon name="back" />
            My lectures
          </Link>
          <span className="pl-1 max-sm:hidden">
            <LogoMark size={22} />
          </span>
          <div className="min-w-0 flex-1" />
          {live && (
            // Opened from the lecture while it is live: the way back into class, the one black button here.
            <Link href={`/l/${lectureId}`} className={`${buttonPrimarySmallClass} shrink-0`}>
              Back to lecture
            </Link>
          )}
          <InfoButton panelClassName="-right-11" />
          {/* Room for the theme button, which comes with dark mode (not built yet). */}
          <span aria-hidden data-theme-slot="" className="size-9 shrink-0" />
        </header>

        {loaded && (
          <main className="mx-auto flex w-full max-w-5xl flex-1 animate-page-in flex-col gap-1 px-4 pb-16 pt-6 sm:px-6 lg:px-8 lg:pt-10">
            {notice && <div className="pb-4">{notice}</div>}
            {/* The lecture is the title (the course as a small line above it), so a skim tells which lecture this is. */}
            {courseName && <p className="type-small-strong text-secondary lg:type-body-strong">{courseName}</p>}
            <h1
              ref={listHeadingRef}
              tabIndex={-1}
              className="break-words font-serif text-[28px] leading-9 font-normal text-ink outline-hidden lg:text-[40px] lg:leading-12"
            >
              {lectureName}
            </h1>
            <p className="flex flex-wrap items-center gap-x-3 pt-1 type-small text-secondary lg:type-body">
              <span>{when}</span>
              {entries.length > 0 && (
                <span data-spot-total="" className="text-ink">
                  {entries.length === 1 ? "1 spot" : `${entries.length} spots`}
                </span>
              )}
            </p>
            {expired && <p className="pt-2 type-small text-secondary">These slides are no longer available.</p>}
            {entries.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 pb-20 pt-16 text-center">
                <p className="type-title text-ink">No spots yet</p>
                <p className="type-body text-secondary">Slides you mark show up here.</p>
              </div>
            ) : (
              <ul className="flex flex-col pt-6 lg:pt-8">
                {entries.map((e, i) => {
                  const kind = e.kind;
                  const people = kind === "lost" ? countLine(kind, loaded.students[e.slideNumber] ?? 0) : null;
                  const first = loaded.firstLines[e.slideNumber];
                  const count = table ? e.marks.length : e.spot?.rect ? 1 : 0;
                  const teacherNote = e.spot?.kind === "lost" ? e.spot.note : null;
                  const oldNote = e.spot?.kind === "save" ? e.spot.note : null;
                  return (
                    <li
                      key={e.slideNumber}
                      style={stagger(i)}
                      className="animate-rise-in border-t border-hairline [animation-delay:var(--stagger)] motion-reduce:[animation-delay:0ms]"
                    >
                      <button
                        type="button"
                        data-spot-id={e.spot?.id ?? `slide-${e.slideNumber}`}
                        data-spot-slide-row={e.slideNumber}
                        data-spot-kind={kind}
                        onClick={() => open(e.slideNumber, "heading")}
                        className="press -mx-2 flex w-[calc(100%+16px)] items-start gap-3 rounded-md px-2 py-5 text-left hover:bg-surface/60 focus-ring sm:gap-5 lg:gap-8 lg:py-6"
                      >
                        <span
                          aria-hidden
                          data-spot-number=""
                          className={`w-10 shrink-0 type-number-m sm:w-14 ${kind === "lost" ? "text-lost" : "text-ink"}`}
                        >
                          {e.slideNumber}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                          <span className="sr-only">Slide {e.slideNumber}: </span>
                          <span className="break-words type-body-strong text-ink lg:type-title">{first || `Slide ${e.slideNumber}`}</span>
                          <span className="flex flex-wrap items-center gap-x-2 type-small text-secondary">
                            <KindDot kind={kind} />
                            <span>{whenLine({ kind, tappedAt: e.spot?.tappedAt })}</span>
                            {count > 0 && <span data-mark-count="">· {count === 1 ? "1 mark" : `${count} marks`}</span>}
                          </span>
                          {people && <span className="type-small text-ink">{people}</span>}
                          {teacherNote && (
                            <span data-list-teacher-note="" className="flex items-start gap-2 type-body text-ink">
                              <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-lost" />
                              <span className="sr-only">Note for the teacher: </span>
                              <span className="min-w-0 break-words type-body">{teacherNote}</span>
                            </span>
                          )}
                          {oldNote && <span className="break-words type-body text-ink">{oldNote}</span>}
                          {e.notebook.trim() !== "" && (
                            <span data-list-notebook="" className="line-clamp-3 break-words whitespace-pre-line type-note text-ink">
                              {e.notebook}
                            </span>
                          )}
                        </span>
                        <Thumb url={urlFor(e.slideNumber)} entry={e} table={table} gone={expired} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </main>
        )}
      </div>
    </>
  );
}
