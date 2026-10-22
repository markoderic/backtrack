"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { openChannel } from "@/lib/supabase/realtime";
import { HighlightBoxes } from "@/components/HighlightBoxes";
import { ButtonPrimary } from "@/components/ButtonPrimary";
import { Icon } from "@/components/Icon";
import { highlightsBySlide, notesBySlide, slideStats, topThree, type TapRow } from "@/lib/stats";
import { useSlideUrls } from "@/lib/useSlideUrls";
import { textLinkClass } from "../../../ui";

const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 10000;
const PAGE = 1000;

/** The tallest bar in px (Figma 34:862: the slide with the most people, 11, is 260 high). */
const BAR_MAX = 260;
/** A slide nobody is lost on still shows a 2 px bar. */
const BAR_MIN = 2;
/**
 * Below this column width (px) the slide numbers thin out to every 5th (10th past 99 slides)
 * plus slide 1, the top 3, the live slide and the selected one, and "now" goes under its
 * number. Columns are never narrower than 24 px (the WCAG 2.5.8 target minimum).
 */
const DENSE_COLUMN = 40;

type Props = {
  lectureId: string;
  /** live follows the lecture as it happens and can end it; past loads once. */
  mode: "live" | "past";
  lectureName: string;
  /** One entry for every slide, 1 to the slide count. */
  slides: { number: number; first_line: string }[];
  initialCurrentSlide?: number;
  /** After the lecture ends here, a link goes back to this course. */
  courseId?: string;
  /** The join code, shown in the live heading as "Code 482 916". */
  code?: string | null;
  /** Open the End lecture confirm on load (the url has ?end=1). Only a live lecture uses it. */
  confirmEndOnLoad?: boolean;
  /** The signed in teacher, so "Hide notes" is remembered for them on this browser. */
  teacherId?: string;
  /**
   * The past lecture page's own heading (name to rename, when, joined, export). In past
   * mode it takes the place of this view's heading, so the lecture name shows once.
   */
  children?: React.ReactNode;
};

type Supabase = ReturnType<typeof createBrowserSupabase>;

// The API returns at most 1000 rows a call, so a big lecture is read in pages.
async function readTaps(supabase: Supabase, lectureId: string): Promise<TapRow[]> {
  const out: TapRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("lost_taps")
      .select("id, anon_id, kind, slide_number, note, undone, tapped_at, hl_x, hl_y, hl_w, hl_h")
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

// Lectures happen at Miami (Ohio): a note's time is Eastern, without AM or PM, as in the design.
const clock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
function noteTime(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return clock.format(d).replace(/\s?[AP]M$/i, "");
}

/** localStorage key for "Hide notes", per teacher. Set means hidden; notes show by default. */
export const hideNotesKey = (teacherId?: string) => `backtrack:hide-notes${teacherId ? `:${teacherId}` : ""}`;

function readNotesHidden(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeNotesHidden(key: string, hidden: boolean): void {
  try {
    if (hidden) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    // Storage is blocked: the choice holds until the page closes.
  }
}

/** "482916" -> "482 916", as the design shows a code. */
const spacedCode = (code: string) => (code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code);

/** The outlined End lecture button (Figma 34:890): 140 x 44, 1 px ink, radius md, Button type. */
const endButtonClass =
  "press focus-ring inline-flex h-11 w-35 shrink-0 items-center justify-center rounded-md border border-ink px-5 " +
  "type-button whitespace-nowrap text-ink hover:bg-ink/5";

export function LectureData({
  lectureId,
  mode,
  lectureName,
  slides,
  initialCurrentSlide,
  courseId,
  code,
  confirmEndOnLoad,
  teacherId,
  children,
}: Props) {
  const router = useRouter();
  const [live, setLive] = useState(mode === "live");
  const [justEnded, setJustEnded] = useState(false);
  const [taps, setTaps] = useState<Map<string, TapRow>>(new Map());
  const [joined, setJoined] = useState<number | null>(null);
  const [current, setCurrent] = useState(initialCurrentSlide ?? 1);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(mode === "live" && !!confirmEndOnLoad);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState(false);
  // The slide the teacher clicked. Until then the panel shows the slide that lost the most people.
  const [picked, setPicked] = useState<number | null>(null);
  // Hide notes keeps students' raw notes off a projected view; only their count shows. The
  // panel first draws after the data loads in the browser, so reading storage here never
  // changes the server's markup.
  const notesKey = hideNotesKey(teacherId);
  const [notesHidden, setNotesHidden] = useState(() => typeof window !== "undefined" && readNotesHidden(notesKey));
  const toggleNotes = () => {
    const next = !notesHidden;
    setNotesHidden(next);
    writeNotesHidden(notesKey, next);
  };
  const endButton = useRef<HTMLButtonElement>(null);
  const endArea = useRef<HTMLDivElement>(null);
  const backLink = useRef<HTMLAnchorElement>(null);
  const bars = useRef<HTMLOListElement>(null);
  // Columns too narrow for every slide number (measured, so it follows the window).
  const [dense, setDense] = useState(false);
  // Where focus goes once the confirm it was in is gone: the way back after ending here,
  // or End lecture again after a failure. Ended by someone else, focus is left alone.
  const focusAfterEnd = useRef<"back" | "end" | null>(null);
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

    // Opened once Realtime has the teacher's token (see openChannel), so the
    // database lets this channel see the rows it listens to.
    let close: (() => void) | undefined;
    if (live) {
      close = openChannel(supabase, () =>
        supabase
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
          }),
      );
    }
    void refetch();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      close?.();
    };
  }, [lectureId, live]);

  // Closing the confirm also drops ?end=1, or a reload would ask again. Esc and Keep going
  // hand focus back to the End lecture button; a click somewhere else leaves it there.
  const closeConfirm = useCallback(
    (refocus: boolean) => {
      setConfirming(false);
      if (confirmEndOnLoad) router.replace(`/teach/l/${lectureId}/live`);
      if (refocus) endButton.current?.focus();
    },
    [confirmEndOnLoad, lectureId, router],
  );

  // Esc closes the End lecture confirm (closing a dialog). No other key does anything here:
  // no key binds (Marko, Oct 22), the way back to the projector is a link.
  useEffect(() => {
    if (!live || !confirming) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.repeat || isTyping(e.target)) return;
      closeConfirm(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [live, confirming, closeConfirm]);

  // The confirm is a popover: a press anywhere outside it closes it (not while it is ending).
  useEffect(() => {
    if (!confirming || ending) return;
    function onPointerDown(e: PointerEvent) {
      if (e.target instanceof Node && endArea.current?.contains(e.target)) return;
      closeConfirm(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [confirming, ending, closeConfirm]);

  async function endLecture() {
    setEnding(true);
    setEndError(false);
    try {
      const { error } = await createBrowserSupabase().rpc("end_lecture", { p_lecture_id: lectureId });
      if (error) throw new Error(error.message);
      setConfirming(false);
      setLive(false);
      setJustEnded(true);
      focusAfterEnd.current = "back";
    } catch {
      setConfirming(false);
      setEndError(true);
      focusAfterEnd.current = "end";
    } finally {
      setEnding(false);
    }
  }

  useEffect(() => {
    if (!focusAfterEnd.current || ending) return;
    (focusAfterEnd.current === "back" ? backLink.current : endButton.current)?.focus();
    focusAfterEnd.current = null;
  }, [ending, justEnded, endError]);

  // One observer on the chart: dense flips only when the room per slide crosses the line, so
  // resizing the window renders at most once per crossing.
  useEffect(() => {
    const ol = bars.current;
    if (!ol || typeof ResizeObserver === "undefined" || slides.length === 0) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setDense(width / slides.length < DENSE_COLUMN);
    });
    observer.observe(ol);
    return () => observer.disconnect();
  }, [slides.length, loaded]);

  const rows = useMemo(() => Array.from(taps.values()), [taps]);
  const stats = useMemo(() => slideStats(rows, slides.length), [rows, slides.length]);
  const ranked = useMemo(() => topThree(stats), [stats]);
  const top = useMemo(() => new Set(ranked), [ranked]);
  const most = Math.max(0, ...stats.map((s) => s.students));
  // Only slides someone highlighted get an image, so a lecture with no highlights loads none.
  // All of them are asked for at once, so clicking from bar to bar shows each one right away.
  const boxes = useMemo(() => highlightsBySlide(rows), [rows]);
  const highlighted = useMemo(
    () => Array.from(boxes.keys()).filter((n) => n >= 1 && n <= slides.length).sort((a, b) => a - b),
    [boxes, slides.length],
  );
  const slideUrls = useSlideUrls(lectureId, highlighted);

  const liveSlide = Math.min(Math.max(current, 1), Math.max(slides.length, 1));
  const selected =
    picked !== null && picked >= 1 && picked <= slides.length ? picked : (ranked[0] ?? (live ? liveSlide : 1));
  const selectedSlide = slides[selected - 1];
  const selectedStat = stats[selected - 1];
  const selectedRects = boxes.get(selected);
  const noteMap = useMemo(() => notesBySlide(rows), [rows]);
  const selectedNotes = noteMap.get(selected) ?? [];

  // The live page has this heading; the past page passes its own (children) instead.
  const ownHeading = mode === "live";

  const status = failed ? (loaded ? "Not up to date. Trying again." : "Could not load the data. Trying again.") : null;

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      {ownHeading ? (
        <div className="relative z-20 flex animate-page-in flex-wrap items-center gap-x-8 gap-y-4 px-4 pt-8 pb-6 sm:px-12">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="type-lecture-l break-words text-ink">{lectureName}</h1>
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 type-small text-secondary">
              {live ? (
                <span className="flex items-center gap-1.5 type-small-strong text-ink">
                  <span aria-hidden className="size-2 shrink-0 rounded-full bg-ink" />
                  Live, on slide {liveSlide}
                </span>
              ) : (
                justEnded && (
                  <span role="status" className="animate-fade-in type-small-strong text-ink">
                    Lecture ended.
                  </span>
                )
              )}
              {joined !== null && <span>{joined} joined</span>}
              {live && code && <span>Code {spacedCode(code)}</span>}
            </p>
            {endError && (
              <p role="alert" className="flex animate-fade-in items-center gap-2 type-small text-ink">
                <Icon name="alert" size={18} />
                Could not end the lecture.
              </p>
            )}
          </div>
          <div className="min-w-0 flex-1" />
          {/* The way back to the projector (no Esc shortcut): a plain link, so fullscreen stays. */}
          {live && (
            <Link href={`/teach/l/${lectureId}/present`} className={`${textLinkClass} ml-auto`}>
              Back to slides
            </Link>
          )}
          {live ? (
            <div
              ref={endArea}
              className="relative ml-auto"
              // A non-modal popover: Tab past Keep going (or anywhere else) closes it, so it never
              // stays open over the page with focus behind it. A press inside it never closes it,
              // and switching windows leaves it open. A press outside closes it (pointerdown above).
              // A press inside never moves focus (no blur, so no close and no reopen on touch, and
              // none in Safari or Firefox on macOS where a pressed button isn't focused). Clicks still fire.
              onMouseDown={(e) => e.preventDefault()}
              onBlur={(e) => {
                if (!confirming || ending || !document.hasFocus()) return;
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                closeConfirm(false);
              }}
            >
              <button
                ref={endButton}
                type="button"
                aria-expanded={confirming}
                aria-controls={confirming ? "end-lecture-confirm" : undefined}
                onClick={() => {
                  setEndError(false);
                  if (confirming) closeConfirm(false);
                  else setConfirming(true);
                }}
                className={endButtonClass}
              >
                End lecture
              </button>
              {confirming && (
                <div
                  id="end-lecture-confirm"
                  role="dialog"
                  aria-labelledby="end-lecture-title"
                  aria-describedby="end-lecture-text"
                  tabIndex={-1}
                  className="absolute top-full right-0 z-30 mt-px flex outline-hidden w-80 max-w-[calc(100vw-32px)] origin-top-right animate-pop-in flex-col gap-3 rounded-md border border-hairline bg-surface p-5 shadow-popover"
                >
                  <p id="end-lecture-title" className="type-body-strong text-ink">
                    End the lecture?
                  </p>
                  <p id="end-lecture-text" className="type-small text-ink">
                    The code stops working and students land on My spots.
                  </p>
                  <div className="flex items-center gap-4">
                    <ButtonPrimary disabled={ending} onClick={() => void endLecture()} className="h-11! w-35!">
                      End lecture
                    </ButtonPrimary>
                    <button
                      type="button"
                      autoFocus
                      disabled={ending}
                      onClick={() => closeConfirm(true)}
                      className={textLinkClass}
                    >
                      Keep going
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            justEnded &&
            courseId && (
              <Link ref={backLink} href={`/teach/c/${courseId}`} className={textLinkClass}>
                Back to the course
              </Link>
            )
          )}
        </div>
      ) : (
        children && <div className="px-4 pt-8 pb-6 sm:px-12">{children}</div>
      )}

      <div className="flex flex-1 flex-col border-t border-hairline lg:flex-row">
        <section aria-labelledby="chart-title" className="flex min-w-0 flex-1 flex-col gap-4 px-4 py-8 sm:px-12">
          <h2 id="chart-title" className="type-small-strong text-secondary">
            People lost, per slide
          </h2>
          {status && (
            <p role="status" className="type-small text-secondary">
              {status}
            </p>
          )}
          {!loaded && !failed && (
            <p role="status" className="type-small text-secondary">
              Loading...
            </p>
          )}

          {loaded && (
            <>
              {/*
               * Columns sit flush and share the width: each is 1/n of it, at most 76 px (the
               * design's 64 + 12 gap, the gap now padding inside the column so the whole column
               * is the click target) and at least 24 px. Past that the chart scrolls inside itself.
               * -mx-3 + px-1.5 line the first bar up with the heading and leave room for its ring.
               */}
              <ol
                ref={bars}
                data-testid="bars"
                data-dense={dense ? "true" : "false"}
                className="-mx-3 -my-2 flex h-[396px] animate-fade-in items-end overflow-x-auto overflow-y-hidden px-1.5 py-2"
              >
                {slides.map((slide) => {
                  const stat = stats[slide.number - 1];
                  const isTop = top.has(slide.number);
                  const isNow = live && slide.number === liveSlide;
                  // A slide the lecture has not reached yet, and nobody is lost on, is grayed out.
                  const ahead = live && slide.number > liveSlide && stat.students === 0;
                  const isSelected = slide.number === selected;
                  const share = most === 0 ? 0 : stat.students / most;
                  const scale = Math.round(Math.max(share, BAR_MIN / BAR_MAX) * 1e4) / 1e4;
                  const step = slides.length > 99 ? 10 : 5;
                  const labelShown =
                    !dense || slide.number === 1 || slide.number % step === 0 || isTop || isNow || isSelected;
                  return (
                    <li
                      key={slide.number}
                      data-testid={`slide-${slide.number}`}
                      className="flex h-full max-w-[76px] min-w-6 flex-1 basis-0"
                    >
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setPicked(slide.number)}
                        className="group press focus-ring relative flex h-full w-full flex-col items-center justify-end gap-2 rounded-sm px-[8%]"
                      >
                        {/* What a screen reader hears; the drawing below is hidden from it. */}
                        <span className="sr-only">
                          Slide {slide.number}
                          {slide.first_line && (
                            <>
                              {", "}
                              <span>{slide.first_line}</span>
                            </>
                          )}
                          {": "}
                          <span data-testid="counts">
                            {plural(stat.students, "person", "people")}, {plural(stat.taps, "tap", "taps")}
                          </span>
                          {isTop && (
                            <>
                              {", "}
                              <span>Top 3</span>
                            </>
                          )}
                          {isNow && (
                            <>
                              {", "}
                              <span>Current slide</span>
                            </>
                          )}
                        </span>
                        {/*
                         * The count rides on top of its bar. Both move with transform only: the bar is a
                         * fixed 260 px scaled from the bottom, the count slides down by what the bar is not.
                         */}
                        <span
                          aria-hidden
                          className={`type-small-strong whitespace-nowrap text-ink transition-transform duration-(--dur-base) ease-out motion-reduce:transition-none ${ahead ? "invisible" : ""}`}
                          style={{ transform: `translateY(${Math.round((1 - scale) * BAR_MAX * 100) / 100}px)` }}
                        >
                          {stat.students}
                        </span>
                        <span aria-hidden className="relative block h-[260px] w-full max-w-9">
                          <span
                            data-testid="bar"
                            className={`absolute inset-0 origin-bottom rounded-t-[3px] transition-[transform,background-color] duration-(--dur-base) ease-out motion-reduce:transition-none ${
                              isTop ? "bg-lost" : "bg-strip"
                            } ${ahead ? "opacity-40" : ""}`}
                            style={{ transform: `scaleY(${scale})` }}
                          />
                        </span>
                        {/* Every column keeps its label line, so bars stay aligned when labels thin out. */}
                        <span
                          aria-hidden
                          data-testid="label"
                          data-shown={labelShown ? "true" : "false"}
                          className={`flex whitespace-nowrap ${dense ? "h-9 flex-col items-center" : "items-baseline"} ${
                            isSelected ? "type-small-strong" : "type-small"
                          } ${ahead ? "text-secondary" : "text-ink"} ${labelShown ? "" : "invisible"} group-hover:text-ink`}
                        >
                          <span>{slide.number}</span>
                          {isNow && <span className={dense ? "type-caption" : ""}>{dense ? "now" : "\u00a0now"}</span>}
                        </span>
                        <span
                          aria-hidden
                          className={`h-0.5 w-6 max-w-full shrink-0 bg-ink transition-opacity duration-(--dur-fast) ease-out ${
                            isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-30"
                          }`}
                        />
                      </button>
                    </li>
                  );
                })}
              </ol>
              <div aria-hidden className="flex flex-wrap items-center gap-x-6 gap-y-2 type-small text-secondary">
                <span className="flex items-center gap-2">
                  <span className="size-3 rounded-xs bg-lost" />
                  Top 3
                </span>
                <span className="flex items-center gap-2">
                  <span className="size-3 rounded-xs bg-strip" />
                  Other slides
                </span>
              </div>
            </>
          )}
        </section>

        {loaded && selectedSlide && selectedStat && (
          <aside
            data-testid="slide-panel"
            aria-label={`Slide ${selected}`}
            className="w-full shrink-0 border-t border-hairline px-4 py-8 sm:p-8 lg:w-[480px] lg:border-t-0 lg:border-l"
          >
            {/* Swapping slides fades the panel in (opacity only). */}
            <div key={selected} className="flex animate-fade-in flex-col gap-4">
              <div className="flex items-baseline justify-between gap-4">
                <p className="type-small text-secondary">Slide {selected}</p>
                <button type="button" onClick={toggleNotes} className={textLinkClass}>
                  {notesHidden ? "Show notes" : "Hide notes"}
                </button>
              </div>
              {selectedSlide.first_line && <h2 className="type-title break-words text-ink">{selectedSlide.first_line}</h2>}
              <p className="flex flex-wrap items-baseline gap-x-3">
                <span className={`type-number-m ${selectedStat.students > 0 ? "text-lost" : "text-secondary"}`}>
                  {selectedStat.students}
                </span>
                <span className="type-body text-ink">{selectedStat.students === 1 ? "person" : "people"} got lost</span>
                <span className="type-small text-secondary">{plural(selectedStat.taps, "tap", "taps")}</span>
              </p>
              {selectedRects && (
                <>
                  <h3 className="type-small-strong text-ink">Where they highlighted</h3>
                  <div
                    data-testid={`highlights-${selected}`}
                    className="relative w-full max-w-[416px] overflow-hidden rounded-sm bg-surface shadow-slide"
                  >
                    {slideUrls[selected] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={slideUrls[selected]} alt={`Slide ${selected}`} className="block h-auto w-full" />
                    ) : (
                      <div className="aspect-video w-full bg-surface" />
                    )}
                    {/* Every student's box, translucent: where most people pointed comes out darkest. */}
                    <HighlightBoxes rects={selectedRects} boxClassName="rounded-xs bg-lost/20" />
                  </div>
                </>
              )}
              {selectedNotes.length > 0 && notesHidden && (
                <>
                  <h3 className="type-small-strong text-ink">Notes</h3>
                  <p data-testid="notes-hidden" className="type-small text-secondary">
                    {plural(selectedNotes.length, "note", "notes")} hidden
                  </p>
                </>
              )}
              {selectedNotes.length > 0 && !notesHidden && (
                <>
                  <h3 className="type-small-strong text-ink">Notes</h3>
                  <ul data-testid="notes" className="flex flex-col gap-4">
                    {selectedNotes.map((note) => {
                      const at = noteTime(note.at);
                      return (
                        <li key={note.id} className="flex items-baseline gap-3 border-t border-hairline py-2.5">
                          <span data-testid="note" className="min-w-0 flex-1 type-note break-words text-ink">
                            {note.text}
                          </span>
                          {at && <span className="shrink-0 type-caption text-secondary">{at}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}
