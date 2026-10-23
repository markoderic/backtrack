import type { Rect } from "@/lib/rect";

/** One of the student's rows that is not undone, as My spots reads it. */
export type SpotRow = {
  id: string;
  kind: "lost" | "save";
  slideNumber: number;
  note: string | null;
  tappedAt: string;
  rect: Rect | null;
};

/**
 * One spot per slide. The live screen takes one tap per slide, but an older lecture can hold
 * several rows on one slide (taps from before that, or moved there by the old "Move to slide",
 * now gone). They show once: lost when any of them is lost, with the latest note and mark.
 *
 * `id` is the row that changes take (the latest lost row, else the latest save); `ids` is every
 * row on the slide, for Remove and clearing a note or a mark, so nothing older comes back.
 */
export type Spot = {
  id: string;
  ids: string[];
  kind: "lost" | "save";
  /** The slide the spot is on (lost_taps.slide_number). */
  slideNumber: number;
  /** The latest note on the slide's rows (the main row's own first). */
  note: string | null;
  /** When the main row was made. */
  tappedAt: string;
  /** The latest mark on the slide's rows (the main row's own first), as fractions of the slide. */
  rect?: Rect | null;
};

const byTime = (a: SpotRow, b: SpotRow) => a.tappedAt.localeCompare(b.tappedAt);

/** The rows grouped into one spot per slide, in slide order. */
export function groupBySlide(rows: SpotRow[]): Spot[] {
  const bySlide = new Map<number, SpotRow[]>();
  for (const r of rows) {
    const list = bySlide.get(r.slideNumber);
    if (list) list.push(r);
    else bySlide.set(r.slideNumber, [r]);
  }
  const spots: Spot[] = [];
  for (const [slideNumber, list] of bySlide) {
    const sorted = [...list].sort(byTime);
    const lost = sorted.filter((r) => r.kind === "lost");
    const main = (lost.length > 0 ? lost : sorted)[(lost.length > 0 ? lost : sorted).length - 1];
    // Newest last, so the latest wins; the main row's own note or mark wins over the others.
    const latest = <T>(pick: (r: SpotRow) => T | null): T | null => {
      const own = pick(main);
      if (own !== null) return own;
      for (let i = sorted.length - 1; i >= 0; i--) {
        const v = pick(sorted[i]);
        if (v !== null) return v;
      }
      return null;
    };
    spots.push({
      id: main.id,
      ids: sorted.map((r) => r.id),
      kind: lost.length > 0 ? "lost" : "save",
      slideNumber,
      note: latest((r) => (r.note && r.note.trim() !== "" ? r.note : null)),
      tappedAt: main.tappedAt,
      rect: latest((r) => r.rect),
    });
  }
  return spots.sort((a, b) => a.slideNumber - b.slideNumber);
}
