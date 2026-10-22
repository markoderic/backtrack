import { describe, it, expect } from "vitest";
import { groupBySlide, type SpotRow } from "./group";

const row = (id: string, o: Partial<SpotRow> = {}): SpotRow => ({
  id,
  kind: "lost",
  slideNumber: 7,
  note: null,
  tappedAt: `2026-10-26T14:0${id.length}:00Z`,
  rect: null,
  ...o,
});

describe("groupBySlide", () => {
  it("four taps on one slide are one spot (Marko: 4 spots, all on one slide)", () => {
    const spots = groupBySlide([
      row("a", { tappedAt: "2026-10-26T14:00:00Z" }),
      row("b", { tappedAt: "2026-10-26T14:01:00Z" }),
      row("c", { tappedAt: "2026-10-26T14:02:00Z" }),
      row("d", { tappedAt: "2026-10-26T14:03:00Z" }),
    ]);
    expect(spots).toHaveLength(1);
    expect(spots[0]).toMatchObject({ id: "d", ids: ["a", "b", "c", "d"], slideNumber: 7, kind: "lost" });
  });

  it("is in slide order, one per slide", () => {
    const spots = groupBySlide([row("a", { slideNumber: 9 }), row("b", { slideNumber: 2 }), row("c", { slideNumber: 9 })]);
    expect(spots.map((s) => s.slideNumber)).toEqual([2, 9]);
  });

  it("is lost when any row on the slide is lost, and the latest lost row is the one that changes", () => {
    const spots = groupBySlide([
      row("lost", { tappedAt: "2026-10-26T14:00:00Z" }),
      row("save", { kind: "save", tappedAt: "2026-10-26T14:05:00Z" }),
    ]);
    expect(spots[0]).toMatchObject({ id: "lost", kind: "lost", tappedAt: "2026-10-26T14:00:00Z" });
  });

  it("a slide with only saves is a save", () => {
    expect(groupBySlide([row("s", { kind: "save" })])[0].kind).toBe("save");
  });

  it("shows the latest note and mark; the main row's own wins", () => {
    const r1 = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    const r2 = { x: 0.5, y: 0.5, w: 0.2, h: 0.2 };
    const spots = groupBySlide([
      row("a", { tappedAt: "2026-10-26T14:00:00Z", note: "older", rect: r1 }),
      row("b", { tappedAt: "2026-10-26T14:01:00Z", note: "newer", rect: r2 }),
      row("c", { tappedAt: "2026-10-26T14:02:00Z" }),
    ]);
    expect(spots[0]).toMatchObject({ id: "c", note: "newer", rect: r2 });
    const own = groupBySlide([
      row("a", { tappedAt: "2026-10-26T14:00:00Z", note: "mine" }),
      row("b", { tappedAt: "2026-10-26T14:01:00Z", kind: "save", note: "a save's" }),
    ]);
    expect(own[0].note).toBe("mine");
  });

  it("an empty note counts as none", () => {
    expect(groupBySlide([row("a", { note: "  " })])[0].note).toBeNull();
  });

  it("no rows, no spots", () => {
    expect(groupBySlide([])).toEqual([]);
  });
});
