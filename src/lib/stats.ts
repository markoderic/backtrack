import { isRect, type Rect } from "./rect";

export type SlideStat = { slide_number: number; taps: number; students: number };

/** The columns of a lost_taps row the data view reads. */
export type TapRow = {
  id: string;
  anon_id: string;
  kind: string;
  slide_number: number;
  note: string | null;
  undone: boolean;
  tapped_at: string;
  /** The highlight, as fractions of the slide: all four numbers or none. */
  hl_x?: number | null;
  hl_y?: number | null;
  hl_w?: number | null;
  hl_h?: number | null;
};

/** Slide numbers of the three slides the most students are lost on. Ties on
 * students go to the slide with more taps, then to the lower slide. A slide
 * with 0 students never ranks, so fewer than three can come back. */
export function topThree(rows: SlideStat[]): number[] {
  return rows
    .filter((r) => r.students > 0)
    .sort((a, b) => b.students - a.students || b.taps - a.taps || a.slide_number - b.slide_number)
    .slice(0, 3)
    .map((r) => r.slide_number);
}

// Only a tap of kind 'lost' that was not undone counts (D8).
const counts = (t: TapRow) => t.kind === "lost" && !t.undone;

/** The same numbers as the lecture_slide_stats function, from the rows held in
 * the browser: one entry per slide 1 to slideCount, zeros included. */
export function slideStats(taps: TapRow[], slideCount: number): SlideStat[] {
  const tapCount = new Array<number>(slideCount + 1).fill(0);
  const people = Array.from({ length: slideCount + 1 }, () => new Set<string>());
  for (const t of taps) {
    if (!counts(t) || t.slide_number < 1 || t.slide_number > slideCount) continue;
    tapCount[t.slide_number]++;
    people[t.slide_number].add(t.anon_id);
  }
  return Array.from({ length: slideCount }, (_, i) => ({
    slide_number: i + 1,
    taps: tapCount[i + 1],
    students: people[i + 1].size,
  }));
}

export type SlideNote = { id: string; text: string; at: string };

/** The notes on each slide, oldest first, from counted rows only. No names. */
export function notesBySlide(taps: TapRow[]): Map<number, SlideNote[]> {
  const out = new Map<number, SlideNote[]>();
  const sorted = taps
    .filter((t) => counts(t) && t.note && t.note.trim() !== "")
    .sort((a, b) => a.tapped_at.localeCompare(b.tapped_at) || a.id.localeCompare(b.id));
  for (const t of sorted) {
    const list = out.get(t.slide_number) ?? [];
    list.push({ id: t.id, text: t.note!.trim(), at: t.tapped_at });
    out.set(t.slide_number, list);
  }
  return out;
}

/** The highlight boxes on each slide, oldest first, from counted rows only. No names. */
export function highlightsBySlide(taps: TapRow[]): Map<number, Rect[]> {
  const out = new Map<number, Rect[]>();
  const sorted = taps
    .filter(counts)
    .sort((a, b) => a.tapped_at.localeCompare(b.tapped_at) || a.id.localeCompare(b.id));
  for (const t of sorted) {
    const rect = { x: t.hl_x, y: t.hl_y, w: t.hl_w, h: t.hl_h };
    if (!isRect(rect)) continue;
    const list = out.get(t.slide_number) ?? [];
    list.push(rect);
    out.set(t.slide_number, list);
  }
  return out;
}

/**
 * The slides whose bar is red: a slide whose people count is one of the three highest
 * different counts above zero (ties all red, so with 5, 5, 3 both 5s are red) AND at least
 * half of the highest count, so a lone slide far ahead does not drag small counts in (with 5, 2,
 * 1 only the 5 is red). Marko asked why one slide with 2 lost was red when others with 2 were
 * gray; the controller ruled the half rule on top. A slide nobody is lost on is never red.
 */
export function redSlides(rows: SlideStat[]): Set<number> {
  const top = [...new Set(rows.map((r) => r.students).filter((n) => n > 0))].sort((a, b) => b - a).slice(0, 3);
  const floor = (top[0] ?? 0) / 2;
  return new Set(rows.filter((r) => top.includes(r.students) && r.students >= floor).map((r) => r.slide_number));
}

/**
 * How many different students marked the spot (a valid highlight box) on each slide, from
 * counted rows only. A slide nobody marked has no entry.
 */
export function marksBySlide(taps: TapRow[]): Map<number, number> {
  const people = new Map<number, Set<string>>();
  for (const t of taps) {
    if (!counts(t) || !isRect({ x: t.hl_x, y: t.hl_y, w: t.hl_w, h: t.hl_h })) continue;
    const set = people.get(t.slide_number) ?? new Set<string>();
    set.add(t.anon_id);
    people.set(t.slide_number, set);
  }
  return new Map(Array.from(people, ([n, set]) => [n, set.size]));
}

/** How many different students made at least one counted lost tap on slides 1 to slideCount. */
export function studentsWhoTapped(taps: TapRow[], slideCount: number): number {
  const people = new Set<string>();
  for (const t of taps) if (counts(t) && t.slide_number >= 1 && t.slide_number <= slideCount) people.add(t.anon_id);
  return people.size;
}
