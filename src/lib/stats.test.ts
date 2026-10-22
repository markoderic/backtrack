import { describe, it, expect } from "vitest";
import {
  topThree,
  slideStats,
  notesBySlide,
  highlightsBySlide,
  redSlides,
  marksBySlide,
  studentsWhoTapped,
  type TapRow,
} from "./stats";

const stat = (students: number[]) => students.map((s, i) => ({ slide_number: i + 1, taps: s, students: s }));

describe("topThree", () => {
  it("ranks the spec numbers as 7, 5, 6", () => {
    expect(topThree(stat([0, 1, 3, 5, 8, 6, 11, 4, 2, 0]))).toEqual([7, 5, 6]);
  });

  it("breaks a tie on students by taps, most first", () => {
    expect(
      topThree([
        { slide_number: 1, taps: 4, students: 3 },
        { slide_number: 2, taps: 9, students: 3 },
        { slide_number: 3, taps: 6, students: 3 },
        { slide_number: 4, taps: 1, students: 3 },
      ]),
    ).toEqual([2, 3, 1]);
  });

  it("breaks a tie on students and taps by the lower slide", () => {
    expect(
      topThree([
        { slide_number: 5, taps: 2, students: 2 },
        { slide_number: 3, taps: 2, students: 2 },
        { slide_number: 9, taps: 2, students: 2 },
        { slide_number: 4, taps: 2, students: 2 },
      ]),
    ).toEqual([3, 4, 5]);
  });

  it("leaves out slides with 0 students, so fewer than three can come back", () => {
    expect(topThree(stat([0, 0, 2, 0, 1]))).toEqual([3, 5]);
    expect(topThree(stat([0, 0, 0]))).toEqual([]);
    expect(topThree([])).toEqual([]);
  });

  it("does not change the rows it is given", () => {
    const rows = stat([1, 3, 2]);
    topThree(rows);
    expect(rows.map((r) => r.slide_number)).toEqual([1, 2, 3]);
  });
});

const tap = (over: Partial<TapRow> & { id: string }): TapRow => ({
  anon_id: "s1",
  kind: "lost",
  slide_number: 1,
  note: null,
  undone: false,
  tapped_at: "2026-10-26T10:00:00Z",
  ...over,
});

describe("slideStats", () => {
  it("returns one row per slide 1 to the slide count, zeros included", () => {
    expect(slideStats([], 3)).toEqual([
      { slide_number: 1, taps: 0, students: 0 },
      { slide_number: 2, taps: 0, students: 0 },
      { slide_number: 3, taps: 0, students: 0 },
    ]);
  });

  it("counts one student tapping three times as 3 taps and 1 student", () => {
    const rows = [tap({ id: "a", slide_number: 2 }), tap({ id: "b", slide_number: 2 }), tap({ id: "c", slide_number: 2 })];
    expect(slideStats(rows, 3)[1]).toEqual({ slide_number: 2, taps: 3, students: 1 });
  });

  it("counts different students separately", () => {
    const rows = [tap({ id: "a", anon_id: "s1" }), tap({ id: "b", anon_id: "s2" }), tap({ id: "c", anon_id: "s2" })];
    expect(slideStats(rows, 2)[0]).toEqual({ slide_number: 1, taps: 3, students: 2 });
  });

  it("leaves out undone rows and saves", () => {
    const rows = [
      tap({ id: "a", undone: true }),
      tap({ id: "b", kind: "save" }),
      tap({ id: "c", anon_id: "s2", undone: true }),
    ];
    expect(slideStats(rows, 2)[0]).toEqual({ slide_number: 1, taps: 0, students: 0 });
  });

  it("ignores a row for a slide outside 1 to the slide count", () => {
    expect(slideStats([tap({ id: "a", slide_number: 7 })], 3).every((r) => r.taps === 0)).toBe(true);
  });
});

describe("notesBySlide", () => {
  it("lists the notes of live lost rows per slide in tap order, with no names", () => {
    const rows = [
      tap({ id: "b", slide_number: 2, note: "second", tapped_at: "2026-10-26T10:02:00Z" }),
      tap({ id: "a", slide_number: 2, note: "first", tapped_at: "2026-10-26T10:01:00Z" }),
      tap({ id: "c", slide_number: 4, note: "other slide" }),
    ];
    const notes = notesBySlide(rows);
    expect(notes.get(2)).toEqual([
      { id: "a", text: "first", at: "2026-10-26T10:01:00Z" },
      { id: "b", text: "second", at: "2026-10-26T10:02:00Z" },
    ]);
    expect(notes.get(4)?.map((n) => n.text)).toEqual(["other slide"]);
    expect(notes.get(1)).toBeUndefined();
  });

  it("skips empty notes, undone rows and saves", () => {
    const rows = [
      tap({ id: "a", note: null }),
      tap({ id: "b", note: "   " }),
      tap({ id: "c", note: "undone note", undone: true }),
      tap({ id: "d", note: "save note", kind: "save" }),
    ];
    expect(notesBySlide(rows).size).toBe(0);
  });
});

describe("highlightsBySlide", () => {
  const box = (x: number) => ({ hl_x: x, hl_y: 0.2, hl_w: 0.3, hl_h: 0.4 });

  it("lists the boxes of live lost rows per slide, in tap order", () => {
    const rows = [
      tap({ id: "b", slide_number: 2, tapped_at: "2026-10-26T10:02:00Z", ...box(0.5) }),
      tap({ id: "a", slide_number: 2, tapped_at: "2026-10-26T10:01:00Z", ...box(0.1) }),
      tap({ id: "c", slide_number: 4, ...box(0.3) }),
    ];
    const out = highlightsBySlide(rows);
    expect(out.get(2)).toEqual([
      { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      { x: 0.5, y: 0.2, w: 0.3, h: 0.4 },
    ]);
    expect(out.get(4)).toEqual([{ x: 0.3, y: 0.2, w: 0.3, h: 0.4 }]);
    expect(out.get(1)).toBeUndefined();
  });

  it("skips undone rows, saves, rows with no box and half boxes", () => {
    const rows = [
      tap({ id: "a", undone: true, ...box(0.1) }),
      tap({ id: "b", kind: "save", ...box(0.1) }),
      tap({ id: "c" }),
      tap({ id: "d", hl_x: 0.1, hl_y: null, hl_w: null, hl_h: null }),
      tap({ id: "e", hl_x: 0.9, hl_y: 0.2, hl_w: 0.3, hl_h: 0.4 }),
    ];
    expect(highlightsBySlide(rows).size).toBe(0);
  });
});

describe("redSlides", () => {
  it("is every slide whose count is one of the three highest different counts, ties all red", () => {
    // 6, 5, 5, 4, 1, 0: the top three different counts are 6, 5 and 4, all at least half of 6.
    expect([...redSlides(stat([6, 5, 5, 4, 1, 0]))].sort()).toEqual([1, 2, 3, 4]);
    // 4 different counts: the lowest one (1) is gray.
    expect([...redSlides(stat([4, 4, 3, 2, 1]))].sort()).toEqual([1, 2, 3, 4]);
  });

  it("leaves a top-3 count gray when it is under half the highest one", () => {
    // 5, 2, 1: only 5 is red (2 and 1 are under 2.5).
    expect([...redSlides(stat([5, 2, 2, 2, 1, 0]))]).toEqual([1]);
    // 4, 2: 2 is exactly half, so red.
    expect([...redSlides(stat([4, 2, 0]))].sort()).toEqual([1, 2]);
    // 11, 8, 5: 5 is under 5.5.
    expect([...redSlides(stat([0, 1, 3, 5, 8, 5, 11, 4, 2, 0]))].sort((a, b) => a - b)).toEqual([5, 7]);
  });

  it("never makes a slide nobody is lost on red", () => {
    expect([...redSlides(stat([0, 0, 2, 0]))]).toEqual([3]);
    expect(redSlides(stat([0, 0, 0])).size).toBe(0);
    expect(redSlides([]).size).toBe(0);
  });

  it("counts people, not taps", () => {
    const rows = [
      { slide_number: 1, taps: 9, students: 1 },
      { slide_number: 2, taps: 2, students: 2 },
      { slide_number: 3, taps: 3, students: 3 },
      { slide_number: 4, taps: 4, students: 4 },
    ];
    expect([...redSlides(rows)].sort()).toEqual([2, 3, 4]);
  });
});

describe("marksBySlide", () => {
  const tap = (o: Partial<TapRow>): TapRow => ({
    id: Math.random().toString(36),
    anon_id: "s1",
    kind: "lost",
    slide_number: 1,
    note: null,
    undone: false,
    tapped_at: "2026-10-26T10:00:00Z",
    hl_x: 0.1,
    hl_y: 0.1,
    hl_w: 0.2,
    hl_h: 0.2,
    ...o,
  });

  it("counts different students with a valid box on each slide, from counted rows only", () => {
    const m = marksBySlide([
      tap({ anon_id: "a" }),
      tap({ anon_id: "a" }),
      tap({ anon_id: "b" }),
      tap({ anon_id: "c", slide_number: 2 }),
      tap({ anon_id: "d", slide_number: 2, undone: true }),
      tap({ anon_id: "e", slide_number: 2, kind: "save" }),
      tap({ anon_id: "f", slide_number: 3, hl_x: null, hl_y: null, hl_w: null, hl_h: null }),
      tap({ anon_id: "g", slide_number: 3, hl_w: 2 }),
    ]);
    expect(m.get(1)).toBe(2);
    expect(m.get(2)).toBe(1);
    expect(m.has(3)).toBe(false);
  });
});

describe("studentsWhoTapped", () => {
  it("counts different students with a counted lost tap on a slide of the lecture", () => {
    const t = (anon_id: string, o: Partial<TapRow> = {}): TapRow => ({
      id: Math.random().toString(36),
      anon_id,
      kind: "lost",
      slide_number: 1,
      note: null,
      undone: false,
      tapped_at: "2026-10-26T10:00:00Z",
      ...o,
    });
    expect(
      studentsWhoTapped(
        [t("a"), t("a", { slide_number: 2 }), t("b"), t("c", { undone: true }), t("d", { kind: "save" }), t("e", { slide_number: 9 })],
        5,
      ),
    ).toBe(2);
    expect(studentsWhoTapped([], 5)).toBe(0);
  });
});
