import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SlideStrip, stripTarget, type SpotKind } from "./SlideStrip";

const strip = (props: Partial<Parameters<typeof SlideStrip>[0]> = {}) =>
  render(<SlideStrip live={8} viewing={8} spots={new Map()} onPick={() => {}} {...props} />);

const item = (n: number) => screen.getByRole("button", { name: new RegExp(`^Slide ${n}\\b`) });
const kinds = (entries: [number, SpotKind][]) => new Map<number, SpotKind>(entries);

describe("SlideStrip", () => {
  it("shows a dot on slides 3 and 7 for spots {3, 7} and nowhere else", () => {
    strip({ spots: kinds([[3, "lost"], [7, "save"]]) });
    for (let n = 1; n <= 8; n++) {
      expect(item(n).querySelector("[data-spot]") !== null).toBe(n === 3 || n === 7);
    }
  });

  it("draws an ink dot for a slide with only a notebook note, named for it (batch K2)", () => {
    strip({ spots: kinds([[4, "note"]]) });
    const dot = item(4).querySelector("[data-spot]") as HTMLElement;
    expect(dot).toHaveAttribute("data-spot", "note");
    expect(dot.className).toContain("bg-ink");
    expect(item(4)).toHaveAccessibleName("Slide 4, you wrote a note");
  });

  it("draws a red dot for I'm lost and an open dot for a save", () => {
    strip({ spots: kinds([[3, "lost"], [7, "save"]]) });
    const lost = item(3).querySelector("[data-spot]") as HTMLElement;
    const saved = item(7).querySelector("[data-spot]") as HTMLElement;
    expect(lost).toHaveAttribute("data-spot", "lost");
    expect(lost.className).toContain("bg-lost");
    expect(saved).toHaveAttribute("data-spot", "save");
    expect(saved.className).toContain("border-ink");
    expect(saved.className).not.toContain("bg-lost");
    // A new dot drops in behind the playhead.
    expect(lost.className).toContain("animate-dot-drop");
  });

  it("draws a yellow dot in an ink ring for a slide with only marks, named you marked this", () => {
    strip({ spots: kinds([[3, "lost"], [5, "mark"]]) });
    const mark = item(5).querySelector("[data-spot]") as HTMLElement;
    expect(mark).toHaveAttribute("data-spot", "mark");
    expect(mark.className).toContain("bg-mark");
    expect(mark.className).toContain("border-ink");
    expect(mark.className).not.toContain("bg-lost");
    expect(screen.getByRole("button", { name: "Slide 5, you marked this" })).toBe(item(5));
  });

  it("with live 8 renders exactly 8 segments and nothing for 9", () => {
    strip();
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    expect(screen.getAllByRole("button")).toHaveLength(8);
    expect(screen.queryByRole("button", { name: /^Slide 9\b/ })).not.toBeInTheDocument();
    expect(screen.queryByText("9")).not.toBeInTheDocument();
  });

  it("does not draw a dot for a spot beyond live", () => {
    const { container } = strip({ spots: kinds([[9, "lost"], [12, "save"]]) });
    expect(container.querySelectorAll("[data-spot]")).toHaveLength(0);
  });

  it("with live 8 and viewing 5, slide 8 has the live marker and slide 5 the viewing marker and the ring", () => {
    strip({ live: 8, viewing: 5 });
    expect(item(8)).toHaveAttribute("data-live");
    expect(item(8).querySelector("[data-playhead]")).not.toBeNull();
    expect(item(8)).not.toHaveAttribute("aria-current");
    expect(item(5)).toHaveAttribute("aria-current", "true");
    expect(item(5)).not.toHaveAttribute("data-live");
    expect(item(5).querySelector("[data-here]")).not.toBeNull();
    for (const n of [1, 2, 3, 4, 6, 7]) {
      expect(item(n)).not.toHaveAttribute("data-live");
      expect(item(n)).not.toHaveAttribute("aria-current");
      expect(item(n).querySelector("[data-dot]")).not.toBeNull();
    }
  });

  it("when viewing the live slide, its dot has both the ring and the playhead, and there is one of each", () => {
    const { container } = strip({ live: 8, viewing: 8 });
    expect(item(8)).toHaveAttribute("data-live");
    expect(item(8)).toHaveAttribute("aria-current", "true");
    expect(container.querySelectorAll("[data-here]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-playhead]")).toHaveLength(1);
  });

  it("names the markers for a screen reader", () => {
    strip({ live: 8, viewing: 5, spots: kinds([[5, "save"], [3, "lost"]]) });
    expect(screen.getByRole("button", { name: "Slide 8, live" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Slide 5, you are here, you saved this" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Slide 3, you got lost here" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Slide 1" })).toBeInTheDocument();
  });

  describe("tooltip", () => {
    const tip = () => document.querySelector("[data-strip-tip]");

    it("hovering a dot shows its slide number in a small tooltip, the same words as its name", () => {
      strip({ live: 12, viewing: 12, spots: kinds([[9, "lost"]]) });
      expect(tip()).toBeNull();
      fireEvent.pointerEnter(item(9), { pointerType: "mouse" });
      expect(tip()).toHaveTextContent("Slide 9, you got lost here");
      expect(item(9)).toHaveAccessibleName("Slide 9, you got lost here");
      // Read once, as the button's name: the tooltip itself is hidden from screen readers.
      expect(tip()).toHaveAttribute("aria-hidden", "true");
      fireEvent.pointerLeave(item(9), { pointerType: "mouse" });
      expect(tip()).toBeNull();
    });

    it("focusing a dot from the keyboard shows it too, and it goes on blur", () => {
      strip({ live: 12, viewing: 12 });
      act(() => item(4).focus());
      expect(tip()).toHaveTextContent("Slide 4");
      act(() => item(4).blur());
      expect(tip()).toBeNull();
    });

    it("Esc puts the tooltip away and leaves focus on the dot", () => {
      strip({ live: 12, viewing: 12 });
      act(() => item(4).focus());
      expect(tip()).not.toBeNull();
      fireEvent.keyDown(item(4), { key: "Escape" });
      expect(tip()).toBeNull();
      expect(item(4)).toHaveFocus();
    });

    it("a finger tap does not leave a tooltip behind", () => {
      strip({ live: 12, viewing: 12 });
      fireEvent.pointerEnter(item(4), { pointerType: "touch" });
      expect(tip()).toBeNull();
    });

    it("hides when the strip scrolls", () => {
      strip({ live: 12, viewing: 12 });
      fireEvent.pointerEnter(item(4), { pointerType: "mouse" });
      fireEvent.scroll(screen.getByRole("list"));
      expect(tip()).toBeNull();
    });
  });

  it("calls onPick with the slide number", () => {
    const onPick = vi.fn();
    strip({ onPick });
    fireEvent.click(item(3));
    expect(onPick).toHaveBeenCalledWith(3);
  });

  it("gives every dot a 44 px button and grows as the live slide moves, with no count", () => {
    const { rerender, container } = strip({ live: 3, viewing: 3 });
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    for (const li of screen.getAllByRole("listitem")) expect(li.className).toMatch(/\bsize-11\b/);
    rerender(<SlideStrip live={4} viewing={4} spots={new Map()} onPick={() => {}} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(container.textContent).not.toMatch(/\bof\b|\//);
  });

  describe("scrolling", () => {
    const DOT = 44;
    /** A strip 220 px wide (5 dots) with real-looking geometry: each dot at its place minus the scroll. */
    function geometry(list: HTMLElement, live: number) {
      let left = 0;
      Object.defineProperty(list, "clientWidth", { configurable: true, get: () => 220 });
      Object.defineProperty(list, "scrollWidth", { configurable: true, get: () => live * DOT });
      Object.defineProperty(list, "scrollLeft", { configurable: true, get: () => left, set: (v: number) => (left = v) });
      list.getBoundingClientRect = () => ({ left: 0, right: 220, width: 220, top: 0, bottom: 44, height: 44, x: 0, y: 0, toJSON() {} });
      list.querySelectorAll("button").forEach((b, i) => {
        b.getBoundingClientRect = () => {
          const x = i * DOT - left;
          return { left: x, right: x + DOT, width: DOT, top: 0, bottom: 44, height: 44, x, y: 0, toJSON() {} };
        };
      });
      const scrollTo = vi.fn((o: ScrollToOptions) => (left = o.left ?? left));
      list.scrollTo = scrollTo as unknown as typeof list.scrollTo;
      return { scrollTo, left: () => left };
    }

    it("keeps the dot on screen and the live dot both in view, and scrolls smoothly when they change", () => {
      const { rerender } = strip({ live: 30, viewing: 30 });
      const g = geometry(screen.getByRole("list"), 30);
      rerender(<SlideStrip live={30} viewing={26} spots={new Map()} onPick={() => {}} />);
      // Slides 26 to 30 fill the 220 px exactly: both the ring and the playhead are in view.
      expect(g.scrollTo).toHaveBeenLastCalledWith({ left: 25 * DOT, behavior: "smooth" });
      const shown = [g.left(), g.left() + 220];
      expect(25 * DOT).toBeGreaterThanOrEqual(shown[0]);
      expect(30 * DOT).toBeLessThanOrEqual(shown[1]);
    });

    it("keeps them in view when the strip gets narrower (the slide size handle, or the window)", () => {
      let observed: (() => void) | null = null;
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(cb: () => void) {
            observed = cb;
          }
          observe() {}
          disconnect() {}
        },
      );
      strip({ live: 30, viewing: 30 });
      const g = geometry(screen.getByRole("list"), 30);
      g.scrollTo.mockClear();
      act(() => observed?.());
      expect(g.scrollTo).toHaveBeenLastCalledWith({ left: 30 * DOT - 220, behavior: "smooth" });
      vi.unstubAllGlobals();
    });

    it("when both can't fit, centers the dot on screen", () => {
      const { rerender } = strip({ live: 30, viewing: 30 });
      const g = geometry(screen.getByRole("list"), 30);
      rerender(<SlideStrip live={30} viewing={10} spots={new Map()} onPick={() => {}} />);
      expect(g.scrollTo).toHaveBeenLastCalledWith({ left: 9 * DOT - (220 - DOT) / 2, behavior: "smooth" });
    });

    it("moves with the live dot as the teacher goes on, while both still fit", () => {
      const { rerender } = strip({ live: 30, viewing: 30 });
      let g = geometry(screen.getByRole("list"), 30);
      rerender(<SlideStrip live={30} viewing={28} spots={new Map()} onPick={() => {}} />);
      const before = g.left();
      // The teacher goes to 31: the new dot is measured, and the strip moves one dot on.
      rerender(<SlideStrip live={31} viewing={28} spots={new Map()} onPick={() => {}} />);
      g = geometry(screen.getByRole("list"), 31);
      rerender(<SlideStrip live={31} viewing={27} spots={new Map()} onPick={() => {}} />);
      expect(g.left()).toBe(before + DOT);
      expect(g.scrollTo).toHaveBeenLastCalledWith({ left: 26 * DOT, behavior: "smooth" });
    });

    it("stripTarget: does not move when both are already in view", () => {
      expect(stripTarget({ scrollLeft: 100, view: 220, max: 1000, here: [120, 164], live: [250, 294] })).toBe(100);
      expect(stripTarget({ scrollLeft: 100, view: 220, max: 1000, here: [40, 84], live: [200, 244] })).toBe(40);
      expect(stripTarget({ scrollLeft: 0, view: 220, max: 1000, here: [100, 144], live: [200, 244] })).toBe(24);
      expect(stripTarget({ scrollLeft: 0, view: 220, max: 50, here: [300, 344], live: [400, 444] })).toBe(50);
      expect(stripTarget({ scrollLeft: 0, view: 220, max: 1000, here: [100, 144], live: [300, 344] })).toBe(12);
    });

    it("jumps without the smooth scroll with reduced motion", () => {
      const media = vi.fn(() => ({ matches: true }));
      vi.stubGlobal("matchMedia", media);
      try {
        const { rerender } = strip({ live: 30, viewing: 30 });
        const g = geometry(screen.getByRole("list"), 30);
        rerender(<SlideStrip live={30} viewing={10} spots={new Map()} onPick={() => {}} />);
        expect(g.scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "auto" }));
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it("scrolls sideways when the lecture runs past the width, instead of shrinking the dots", () => {
    strip({ live: 30, viewing: 20 });
    const list = screen.getByRole("list");
    expect(list.className).toMatch(/overflow-x-auto/);
    for (const li of screen.getAllByRole("listitem")) expect(li.className).toMatch(/\bshrink-0\b/);
  });
});
