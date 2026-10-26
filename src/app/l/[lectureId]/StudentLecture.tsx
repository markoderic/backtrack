"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buttonSecondaryClass } from "@/components/ButtonPrimary";
import { Icon } from "@/components/Icon";
import { InfoButton } from "@/components/InfoButton";
import { LogoMark } from "@/components/Logo";
import { NotebookField, SavedState } from "@/components/NotebookField";
import { loadOwnTaps, makeSend } from "@/lib/lostTapApi";
import { NOTEBOOK_MAX } from "@/lib/notebookApi";
import { cutNote, useTeacherNoteMax } from "@/lib/noteLimit";
import type { Rect } from "@/lib/rect";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { QueueOp } from "@/lib/tapQueue";
import { useLiveLecture } from "@/lib/useLiveLecture";
import { useLiveMarks } from "@/lib/useLiveMarks";
import { useNotebook } from "@/lib/useNotebook";
import { useTrackHere } from "@/lib/useHere";
import { useSlideImages } from "@/lib/useSlideImages";
import { useSlideSample } from "@/lib/slideTone";
import { HighlightLayer, type ShownMark } from "./HighlightLayer";
import { LostButton, type LegacyMarks, type Spot } from "./LostButton";
import { MarkPopover } from "./MarkPopover";
import { SlideStrip, type SpotKind } from "./SlideStrip";
import { SplitHandle } from "./SplitHandle";

const END_FLUSH_MS = 3000;
/** "Loading slide 7" shows only if the image takes longer than this. The next slide is preloaded, so it is rare. */
const LOADING_TEXT_MS = 300;
/** The My spots count is red this long after an I'm lost. */
const COUNT_RED_MS = 2000;
const WIDE = 16 / 9;
/**
 * The notebook stays on the slide it is being typed on this long after the last key, while it has the
 * focus, even when the teacher moves on (so a sentence never splits across two slides).
 */
export const NOTEBOOK_PIN_MS = 3000;
/** The marks' stored kind is put right this long after the marks and the taps were last changed. */
const RECONCILE_MS = 1000;

type Props = {
  lectureId: string;
  lectureName: string;
  courseName: string;
  /** The live slide the server read, so the first paint is already right. */
  initialSlide: number;
};

/**
 * The student's live lecture screen. One markup, two layouts (globals.css, "student live
 * lecture"): on a laptop or a landscape tablet the slide fills the left (about 80%) with
 * its navigation right under it, and a sidebar on the right holds My lectures, the lecture,
 * the I'm lost panel, the notebook, Jump to live and My spots; on a phone or a narrow window it
 * stacks the top bar, the slide, the I'm lost panel, the slide strip and the notebook. A handle
 * between the slide and the notebook makes the slide smaller or bigger (remembered on the device).
 *
 * The notebook: the student types straight on the page, one private note per slide (the slide on
 * screen), saved by itself. On a slide where they are lost, a small note to the teacher sits above it.
 *
 * No student component reads or shows the slide count: the screen only knows the slide
 * the teacher is on and the ones before it (the strip runs 1 to live). No keyboard
 * shortcuts, I'm lost included: it is only the button.
 */
export function StudentLecture({ lectureId, lectureName, courseName, initialSlide }: Props) {
  const router = useRouter();
  const { state, back, forward, jumpToLive, goTo, recheck } = useLiveLecture(lectureId, initialSlide);
  const { urlFor } = useSlideImages(lectureId, state?.viewing);

  // The client is made when a tap is sent, not while rendering.
  const send = useMemo(() => (op: QueueOp) => makeSend(createBrowserSupabase(), lectureId)(op), [lectureId]);
  const loadOwn = useMemo(() => () => loadOwnTaps(createBrowserSupabase(), lectureId), [lectureId]);
  const [spots, setSpots] = useState<Spot[]>([]);
  // The note to the teacher: 2000 characters once the database has migration 0020, else 140.
  const noteMax = useTeacherNoteMax();

  // The My spots count turns red for 2 s after an I'm lost (a new one starts the 2 s over).
  const [countRed, setCountRed] = useState(0);
  useEffect(() => {
    if (countRed === 0) return;
    const timer = setTimeout(() => setCountRed(0), COUNT_RED_MS);
    return () => clearTimeout(timer);
  }, [countRed]);
  const onTap = useCallback((kind: SpotKind) => {
    if (kind === "lost") setCountRed((n) => n + 1);
  }, []);
  // The student's rows were read once: from then on the marks' kinds can follow them.
  const [spotsLoaded, setSpotsLoaded] = useState(false);
  const onSpots = useCallback((next: Spot[], loaded: boolean) => {
    setSpots(next);
    if (loaded) setSpotsLoaded(true);
  }, []);

  // Counts the times the live connection came back, so the queue is sent again then.
  const conn = state?.conn;
  const [lastConn, setLastConn] = useState(conn);
  const [reconnects, setReconnects] = useState(0);
  if (conn !== lastConn) {
    setLastConn(conn);
    if (lastConn === "reconnecting" && conn === "live") setReconnects((n) => n + 1);
  }

  // The student's marks (slide_marks, migration 0020): several per slide, each with a private note.
  const marks = useLiveMarks(lectureId, { reconnects });
  // The student's private notebook (notebook_notes, migration 0020): one note per slide.
  const notebook = useNotebook(lectureId);
  // Where LostButton puts the note to the teacher: the top of the notebook area.
  const [noteSlot, setNoteSlot] = useState<HTMLElement | null>(null);
  // The slide the notebook is being typed on (null: it follows the slide on screen). Kept while the
  // field has the focus and was typed in within NOTEBOOK_PIN_MS; let go on blur or after the pause.
  const [notebookPin, setNotebookPin] = useState<number | null>(null);
  const pinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // An IME composition (Japanese, Chinese ...) is going on in the notebook: the pin waits for its end.
  const composing = useRef(false);
  useEffect(
    () => () => {
      if (pinTimer.current) clearTimeout(pinTimer.current);
    },
    [],
  );
  // Before 0020 a mark is the one highlight on the slide's spot (lost_taps.hl_*), through the panel.
  const legacy = marks.mode === "legacy";
  // One dot per slide: red if any row there is an I'm lost, open if they are all saves, a yellow dot
  // for a slide that only has marks, and an ink dot for one with only a notebook note (a slide with
  // marks or a note is a spot too: it counts in My spots).
  const notebookSlides = notebook.slides;
  const spotKinds = useMemo(() => {
    const kinds = new Map<number, SpotKind>();
    for (const s of spots) if (kinds.get(s.slide) !== "lost") kinds.set(s.slide, s.kind);
    if (!legacy) for (const m of marks.marks) if (!kinds.has(m.slide)) kinds.set(m.slide, "mark");
    for (const slide of notebookSlides) if (!kinds.has(slide)) kinds.set(slide, "note");
    return kinds;
  }, [spots, legacy, marks.marks, notebookSlides]);
  const legacyRef = useRef<LegacyMarks | null>(null);
  const onMarkReady = useCallback((api: LegacyMarks) => {
    legacyRef.current = api;
  }, []);
  // I'm lost (or its Undo) turns the slide's marks red; taking it back turns them yellow (one request).
  const setMarksKind = marks.setKind;
  const forgetMarks = marks.forget;
  const spotsRef = useRef<Spot[]>([]);
  const onLostChange = useCallback(
    (slide: number, lost: boolean) => {
      if (legacy) return;
      setMarksKind(slide, lost ? "lost" : "save");
      // 0020's trigger deletes the copy of an old highlight (it has the tap's id) when the tap is taken back.
      if (!lost) forgetMarks(spotsRef.current.filter((s) => s.slide === slide && s.kind === "lost").map((s) => s.id));
    },
    [legacy, setMarksKind, forgetMarks],
  );
  useEffect(() => {
    spotsRef.current = spots;
  }, [spots]);

  // The kind stored on each mark follows the slide: 'lost' while the student is lost there, 'save'
  // when not. This screen's own presses set it at once; this puts right what changed elsewhere (My
  // spots took a tap back, a mark drawn before the taps were read) once both are read. Once per
  // slide and kind: what was asked for is only asked again once the slide wants the other kind, so a
  // change the database keeps refusing (or that waits in the queue) is not sent again and again.
  // It waits until both have been still for a moment: a press changes the marks one render before the
  // panel reports its rows, and must never be undone by that in-between state.
  const kindAsked = useRef(new Map<number, "lost" | "save">());
  useEffect(() => {
    if (marks.mode !== "table" || !spotsLoaded) return;
    const timer = setTimeout(() => {
      const lostSlides = new Set(spots.filter((s) => s.kind === "lost").map((s) => s.slide));
      const wantOf = (slide: number) => (lostSlides.has(slide) ? "lost" : "save");
      const wrong = new Map<number, "lost" | "save">();
      for (const m of marks.marks) {
        const want = wantOf(m.slide);
        if (m.kind !== want) wrong.set(m.slide, want);
      }
      for (const [slide, kind] of kindAsked.current) if (wantOf(slide) !== kind) kindAsked.current.delete(slide);
      for (const [slide, kind] of wrong) {
        if (kindAsked.current.get(slide) === kind) continue;
        kindAsked.current.set(slide, kind);
        setMarksKind(slide, kind);
      }
    }, RECONCILE_MS);
    return () => clearTimeout(timer);
  }, [marks.mode, marks.marks, spots, spotsLoaded, setMarksKind]);

  // A tap still waiting (made offline, or just before the end) is sent before leaving,
  // so it is not lost with this screen. If that takes over 3 seconds, leave anyway:
  // what is left stays in the queue for the spots page (marks stay in theirs).
  const flushRef = useRef<((ending?: boolean) => Promise<void>) | null>(null);
  const onFlushReady = useCallback((flush: (ending?: boolean) => Promise<void>) => {
    flushRef.current = flush;
  }, []);
  const flushMarksRef = useRef(marks.flush);
  useEffect(() => {
    flushMarksRef.current = marks.flush;
  }, [marks.flush]);
  const flushNotebookRef = useRef(notebook.flush);
  useEffect(() => {
    flushNotebookRef.current = notebook.flush;
  }, [notebook.flush]);
  // The Mark tool: the panel turns it on and off, the slide takes the drags.
  const [marking, setMarking] = useState(false);
  // The mark whose popover is open, and whether it was opened with the keyboard.
  const [selected, setSelected] = useState<{ id: string; keyboard: boolean } | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  // The slide's own shape, from the image once it loads.
  const [ratio, setRatio] = useState(WIDE);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [slowKey, setSlowKey] = useState<string | null>(null);
  const ended = state?.ended ?? false;
  // This tab counts in the teacher's "here" while the lecture is live (on its own channel,
  // never the slide channel). My spots does not count.
  useTrackHere(lectureId, !ended);
  // Kept in a ref so a re-render (the count turning back from red, the loading text)
  // never restarts the 3 second bound below.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });
  useEffect(() => {
    if (!ended) return;
    let left = false;
    const leave = () => {
      if (left) return;
      left = true;
      clearTimeout(bound);
      routerRef.current.replace(`/spots/${lectureId}`);
    };
    const bound = setTimeout(leave, END_FLUSH_MS);
    void Promise.all([
      flushRef.current?.(true) ?? Promise.resolve(),
      flushMarksRef.current().catch(() => {}),
      flushNotebookRef.current().catch(() => {}),
    ]).then(leave);
    return () => {
      left = true;
      clearTimeout(bound);
    };
  }, [ended, lectureId]);

  const viewing = state?.viewing ?? initialSlide;
  const url = state ? urlFor(viewing) : undefined;
  // The slide measured, so each mark shows on it (a glow on a dark part, the highlighter on a light one).
  const sample = useSlideSample(url);
  const behind = state !== null && !state.following && state.viewing < state.live;
  const reconnecting = state?.conn === "reconnecting";
  const live = state?.live ?? initialSlide;

  // Another slide ends marking (the box would belong to the slide just left) and closes a mark's popover.
  const [markedSlide, setMarkedSlide] = useState(viewing);
  if (markedSlide !== viewing) {
    setMarkedSlide(viewing);
    if (marking) setMarking(false);
    if (selected) setSelected(null);
    // A mark's message belonged to the slide just left.
    if (marks.problem) marks.clearProblem();
  }

  // Another slide: the notebook text of the slide just left goes now (the field follows the slide on screen).
  useEffect(() => {
    void flushNotebookRef.current();
  }, [viewing]);

  // The notebook field's slide: the one it is being typed on, else the one on screen.
  const notebookSlide = notebookPin ?? viewing;
  const armPin = () => {
    if (pinTimer.current) clearTimeout(pinTimer.current);
    pinTimer.current = setTimeout(() => {
      pinTimer.current = null;
      // Not in the middle of a composition: its candidates may be open for a while.
      if (composing.current) {
        armPin();
        return;
      }
      setNotebookPin(null);
      void flushNotebookRef.current();
    }, NOTEBOOK_PIN_MS);
  };
  const typeNotebook = (text: string) => {
    const slide = notebookPin ?? viewing;
    if (notebookPin === null) setNotebookPin(slide);
    notebook.set(slide, cutNote(text, NOTEBOOK_MAX));
    armPin();
  };
  /** The notebook follows the slide on screen again (blur, or the student moving the slide). */
  const unpinNotebook = () => {
    if (pinTimer.current) clearTimeout(pinTimer.current);
    pinTimer.current = null;
    if (notebookPin !== null) setNotebookPin(null);
  };
  const leaveNotebook = () => {
    composing.current = false;
    unpinNotebook();
    void notebook.flush();
  };

  // The slide changes at once; the loading text only shows when the image is slow.
  const imageKey = url ?? `slide-${viewing}`;
  useEffect(() => {
    const timer = setTimeout(() => setSlowKey(imageKey), LOADING_TEXT_MS);
    return () => clearTimeout(timer);
  }, [imageKey]);
  const loading = slowKey === imageKey && loadedSrc !== url;

  // The spot on the slide on screen (the I'm lost one, or else the save), and whether it is lost.
  const active = useMemo(() => {
    let lost: Spot | null = null;
    let save: Spot | null = null;
    for (const s of spots) {
      if (s.slide !== viewing) continue;
      if (s.kind === "lost") lost = s;
      else save = s;
    }
    return lost ?? save;
  }, [spots, viewing]);
  const lostHere = active?.kind === "lost";
  // The marks on the slide on screen, red where the student is lost and yellow elsewhere. Before
  // 0020: the one highlight on the slide's spot. After: only slide_marks (never a tap's highlight).
  const slideMarks: ShownMark[] = useMemo(() => {
    const kind = lostHere ? "lost" : "save";
    if (legacy) return active?.rect ? [{ id: active.id, rect: active.rect, kind }] : [];
    return marks.marks
      .filter((m) => m.slide === viewing)
      .map((m) => (m.note ? { id: m.id, rect: m.rect, kind, note: m.note } : { id: m.id, rect: m.rect, kind }));
  }, [legacy, active, lostHere, marks.marks, viewing]);
  const selectedIndex = selected ? slideMarks.findIndex((m) => m.id === selected.id) : -1;
  const selectedMark = selectedIndex >= 0 ? slideMarks[selectedIndex] : null;
  // Said to a screen reader when a mark is added or deleted (the panel says the rest).
  const [markSaid, setMarkSaid] = useState<{ n: number; text: string } | null>(null);
  const sayMark = (text: string) => setMarkSaid((s) => ({ n: (s?.n ?? 0) + 1, text }));

  function addMark(rect: Rect) {
    setSelected(null);
    if (legacy) {
      legacyRef.current?.add(rect);
      return;
    }
    if (marks.add(viewing, rect, lostHere ? "lost" : "save")) sayMark("Marked.");
  }

  function deleteMark(id: string) {
    setSelected(null);
    if (legacy) legacyRef.current?.clear(id);
    else {
      marks.remove(id);
      sayMark("Mark deleted.");
    }
    // The mark is gone: the slide's panel takes the focus.
    (document.querySelector("[data-lecture-panel]") as HTMLElement | null)?.focus();
  }

  function closeMark(back: boolean) {
    const id = selected?.id;
    setSelected(null);
    if (back && id) (document.querySelector(`[data-mark="${id}"]`) as HTMLElement | null)?.focus();
  }
  // One per slide, as on the My spots page (an older lecture may have two rows on one slide).
  const spotCount = spotKinds.size;

  const jumpLabel = state ? `Jump to live, slide ${state.live}` : "";

  // A move the student makes (Back, Forward, a strip dot, Jump to live) slides the new slide in;
  // the teacher moving a following student stays instant. Each move gets a new key, so the
  // slide's content mounts again with the short slide and fade (none with reduced motion).
  const [move, setMove] = useState<{ n: number; dir: "next" | "back"; slide: number; done: boolean } | null>(null);
  const moveTo = (target: number, go: () => void) => {
    // The student moves the slide: the notebook goes with them (a tap may not blur the field on a phone).
    unpinNotebook();
    void flushNotebookRef.current();
    if (state && target !== state.viewing && target >= 1 && target <= state.live) {
      const dir = target < state.viewing ? "back" : "next";
      setMove((m) => ({ n: (m?.n ?? 0) + 1, dir, slide: target, done: false }));
    }
    go();
  };
  const moving = move && !move.done && move.slide === viewing ? move.dir : null;
  const onBack = () => moveTo(viewing - 1, back);
  const onForward = () => moveTo(viewing + 1, forward);
  const onJump = () => moveTo(live, jumpToLive);
  const onPick = (n: number) => moveTo(Math.min(Math.max(Math.floor(n), 1), live), () => goTo(n));

  return (
    <div data-lecture="" className="text-ink" style={{ "--slide-ratio": ratio } as CSSProperties}>
      <div data-lecture-side="">
        <div data-lecture-top="">
          {/* The way to all the student's lectures (My spots of each). Just the arrow on a phone. */}
          <Link
            href="/spots"
            data-lecture-back=""
            className="press focus-ring touch-target relative flex h-9 shrink-0 items-center gap-1 rounded-md type-small-strong text-ink hover:bg-surface narrow:-ml-2 narrow:w-9 narrow:justify-center wide:-ml-1.5 wide:pl-1 wide:pr-2"
          >
            <Icon name="back" size={20} />
            <span className="narrow:sr-only">My lectures</span>
          </Link>
          <div data-lecture-brand="" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <LogoMark size={22} />
            {/* Both truncate; the lecture name gives way first (a shrink factor under 1 would let the course overflow). */}
            <p className="min-w-0 flex-1 truncate type-small-strong text-ink narrow:flex-initial">{courseName}</p>
            <p
              data-lecture-name=""
              className="min-w-0 shrink-[4] truncate type-lecture text-secondary max-sm:hidden wide:block wide:basis-full"
            >
              {lectureName}
            </p>
          </div>
          <Link
            href={`/spots/${lectureId}`}
            data-lecture-spots=""
            className={`${buttonSecondaryClass} touch-target relative shrink-0 narrow:h-9 wide:w-full`}
          >
            My spots
            <span
              data-count-red={countRed > 0 ? "" : undefined}
              className={`transition-colors duration-(--dur-slow) ease-out ${countRed > 0 ? "text-lost" : "text-ink"}`}
            >
              {spotCount}
            </span>
          </Link>
          <div data-lecture-info="" className="flex shrink-0 justify-end">
            {/* The popover lines up with the right edge (of the top bar, or of the sidebar on a laptop). */}
            <InfoButton panelClassName="right-0" />
          </div>
          {/* The theme button comes with dark mode (not built yet); until then no empty slot at the edge. */}
        </div>
        {behind && (
          // On a laptop, at the bottom of the sidebar above My spots: it comes and goes without moving
          // I'm lost, so a double click on it can never land on I'm lost.
          <button
            type="button"
            data-lecture-jump="side"
            onClick={onJump}
            className="press focus-ring flex h-12 w-full items-center justify-center rounded-md bg-ink px-4 type-button text-surface hover:bg-ink-hover"
          >
            {jumpLabel}
          </button>
        )}
      </div>
      {/* Always there, so a screen reader hears when the connection drops (the panel shows it). */}
      <p role="status" className="sr-only">
        {reconnecting ? "Reconnecting." : ""}
      </p>
      <p role="status" aria-atomic="false" className="sr-only" data-mark-status="">
        {markSaid && <span key={markSaid.n}>{markSaid.text}</span>}
      </p>

      <div data-lecture-stage="">
        <div data-lecture-slide="" className="relative shrink-0">
          <div
            data-slide=""
            className="relative w-full overflow-hidden rounded-sm bg-surface shadow-slide"
            style={{ aspectRatio: ratio } as CSSProperties}
          >
            <div
              key={move?.n ?? 0}
              data-slide-content=""
              data-move={moving ?? undefined}
              // Its own animation only (a mark or the loading text inside fades in too).
              onAnimationEnd={(e) => {
                if (e.target === e.currentTarget) setMove((m) => m && { ...m, done: true });
              }}
              className={`absolute inset-0 ${
                moving === "back" ? "motion-safe:animate-slide-back" : moving === "next" ? "motion-safe:animate-slide-next" : ""
              }`}
            >
              {url && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    ref={imageRef}
                    src={url}
                    alt={`Slide ${viewing}`}
                    draggable={false}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      setLoadedSrc(img.getAttribute("src"));
                      if (img.naturalWidth > 0 && img.naturalHeight > 0) setRatio(img.naturalWidth / img.naturalHeight);
                    }}
                    className="absolute inset-0 h-full w-full rounded-sm object-contain"
                  />
                  <HighlightLayer
                    imageRef={imageRef}
                    marking={marking}
                    markingKind={lostHere ? "lost" : "save"}
                    marks={slideMarks}
                    selectedId={selectedMark?.id ?? null}
                    onSelect={(id, keyboard) => {
                      setMarking(false);
                      setSelected(id ? { id, keyboard } : null);
                    }}
                    onMark={addMark}
                    onCancel={() => setMarking(false)}
                    sample={sample}
                  />
                </>
              )}
              {loading && (
                <p className="absolute inset-0 flex animate-fade-in items-center justify-center rounded-sm bg-surface type-small text-secondary">
                  Loading slide {viewing}
                </p>
              )}
            </div>
          </div>
          {selectedMark && (
            // Outside the slide's clipping, so it can sit over the edge of a mark near the bottom.
            <MarkPopover
              key={selectedMark.id}
              mark={selectedMark}
              n={selectedIndex + 1}
              noteless={legacy}
              focusNote={selected?.keyboard}
              onNote={(text) => marks.setNote(selectedMark.id, text)}
              onDelete={() => deleteMark(selectedMark.id)}
              onClose={closeMark}
            />
          )}
          {behind && !marking && !selectedMark && (
            // On a phone, Jump to live floats over the bottom edge of the slide (the sidebar has it on a laptop).
            <button
              type="button"
              data-lecture-jump="pill"
              onClick={onJump}
              className="press focus-ring absolute bottom-3 left-1/2 z-10 flex h-11 -translate-x-1/2 animate-pop-in items-center rounded-full bg-ink px-4 type-button whitespace-nowrap text-surface shadow-popover hover:bg-ink-hover"
            >
              {jumpLabel}
            </button>
          )}
        </div>

        {/* Right under the slide, one size at every slide size (globals.css). */}
        <LostButton
          key={lectureId}
          lectureId={lectureId}
          viewing={viewing}
          send={send}
          loadOwn={loadOwn}
          onSpots={onSpots}
          onTap={(kind) => {
            onTap(kind);
            marks.clearProblem();
          }}
          onTakenBack={() => {
            if (!legacy) void marks.reload();
          }}
          reconnects={reconnects}
          onFlushReady={onFlushReady}
          marking={marking}
          onMarkingChange={(on) => {
            setMarking(on);
            if (on) setSelected(null);
          }}
          onMarkReady={onMarkReady}
          onLostChange={onLostChange}
          notice={marks.problem}
          // A refused tap usually means the lecture ended: read the status now, and
          // if it did, leave the same way as when Realtime says so.
          onRejected={recheck}
          noteMax={noteMax}
          noteSlot={noteSlot}
          idle={reconnecting ? <p className="animate-fade-in type-small text-secondary">Reconnecting…</p> : null}
        />
        <div data-lecture-nav="" data-controls="" className="flex h-11 min-w-0 items-center">
          <button
            type="button"
            aria-label="Back"
            onClick={onBack}
            disabled={!state || state.viewing <= 1}
            className={arrowClass}
          >
            <Icon name="back" />
          </button>
          <SlideStrip live={live} viewing={viewing} spots={spotKinds} onPick={onPick} />
          <button
            type="button"
            aria-label="Forward"
            onClick={onForward}
            disabled={!state || state.viewing >= state.live}
            className={arrowClass}
          >
            <Icon name="forward" />
          </button>
          <div className="ml-auto flex shrink-0 items-baseline gap-2 pl-3 whitespace-nowrap">
            <span data-slide-number="" className="type-number-s text-ink">
              {viewing}
            </span>
            {reconnecting ? (
              <span className="type-small text-secondary">reconnecting</span>
            ) : (
              !behind && <span className="type-small text-secondary">live</span>
            )}
          </div>
        </div>
      </div>
      {/* At the slide's edge (laptop) or above the notebook (phone): drag (or arrow keys) to make the slide smaller or bigger. */}
      <SplitHandle />
      {/* The notebook: typed straight on the page, one private note per slide, saved by itself. */}
      <div data-lecture-notes="">
        {/* The note to the teacher, on a slide where the student is lost (LostButton puts it here). */}
        <div ref={setNoteSlot} data-teacher-slot="" className="shrink-0 empty:hidden [&:not(:empty)]:pb-3" />
        <NotebookField
          aria-label={`Your notes, slide ${notebookSlide}`}
          placeholder="Your notes"
          value={notebook.textOf(notebookSlide)}
          onValue={typeNotebook}
          onBlur={leaveNotebook}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          className="min-h-12 flex-1"
        />
        <div className="flex h-5 shrink-0 items-end justify-between gap-3 pt-1">
          {/* Typing on while the teacher moved on: the notes stay with their slide for now. */}
          <span data-notebook-slide="" className="type-caption text-secondary">
            {notebookSlide !== viewing ? `Slide ${notebookSlide}` : ""}
          </span>
          <SavedState state={notebook.stateOf(notebookSlide)} className="text-right" />
        </div>
      </div>
    </div>
  );
}

// 44 px, a touch target on its own.
const arrowClass =
  "press flex size-11 shrink-0 items-center justify-center rounded-md text-ink hover:enabled:bg-surface focus-ring disabled:opacity-30";
