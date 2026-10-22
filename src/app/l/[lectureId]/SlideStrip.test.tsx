import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SlideStrip, type SpotKind } from "./SlideStrip";

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
    expect(item(8)).not.toHaveAttribute("aria-current");
    expect(item(5)).toHaveAttribute("aria-current", "true");
    expect(item(5)).not.toHaveAttribute("data-live");
    expect(item(5).querySelector("[data-here]")).not.toBeNull();
    for (const n of [1, 2, 3, 4, 6, 7]) {
      expect(item(n)).not.toHaveAttribute("data-live");
      expect(item(n)).not.toHaveAttribute("aria-current");
    }
  });

  it("when viewing the live slide, one segment has both markers and the playhead alone shows it (no ring)", () => {
    const { container } = strip({ live: 8, viewing: 8 });
    expect(item(8)).toHaveAttribute("data-live");
    expect(item(8)).toHaveAttribute("aria-current", "true");
    expect(container.querySelector("[data-here]")).toBeNull();
    expect(container.querySelectorAll("[data-playhead]")).toHaveLength(1);
  });

  it("names the markers for a screen reader", () => {
    strip({ live: 8, viewing: 5, spots: kinds([[5, "save"], [3, "lost"]]) });
    expect(screen.getByRole("button", { name: "Slide 8, live" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Slide 5, viewing, saved" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Slide 3, lost" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Slide 1" })).toBeInTheDocument();
  });

  it("calls onPick with the slide number", () => {
    const onPick = vi.fn();
    strip({ onPick });
    fireEvent.click(item(3));
    expect(onPick).toHaveBeenCalledWith(3);
  });

  it("grows as the live slide moves, 40 px a slide (28 on a phone), and shows no count", () => {
    const { rerender, container } = strip({ live: 3, viewing: 3 });
    const nav = screen.getByRole("navigation", { name: "Slides" });
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(nav.style.maxWidth).toBe("calc(var(--seg) * 3 + 2px)");
    expect(nav.className).toContain("[--seg:28px]");
    expect(nav.className).toContain("sm:[--seg:40px]");
    rerender(<SlideStrip live={4} viewing={4} spots={new Map()} onPick={() => {}} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(nav.style.maxWidth).toBe("calc(var(--seg) * 4 + 2px)");
    expect(container.textContent).not.toMatch(/\bof\b|\//);
  });

  it("shrinks its segments instead of scrolling when the lecture runs past the width", () => {
    strip({ live: 30, viewing: 20 });
    const nav = screen.getByRole("navigation", { name: "Slides" });
    // The strip takes the room left in the row (flex-1, min-w-0) and every segment an equal share of it.
    expect(nav.className).toMatch(/\bflex-1\b/);
    expect(nav.className).toMatch(/\bmin-w-0\b/);
    expect(nav.className).not.toMatch(/overflow-x-auto/);
    for (const li of screen.getAllByRole("listitem")) expect(li.className).toMatch(/\bflex-1\b/);
  });
});
