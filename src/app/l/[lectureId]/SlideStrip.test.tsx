import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SlideStrip } from "./SlideStrip";

const strip = (props: Partial<Parameters<typeof SlideStrip>[0]> = {}) =>
  render(<SlideStrip live={8} viewing={8} spotSlides={new Set()} onPick={() => {}} {...props} />);

const item = (n: number) => screen.getByRole("button", { name: new RegExp(`^Slide ${n}\\b`) });

describe("SlideStrip", () => {
  it("shows a dot on slides 3 and 7 for spotSlides {3, 7} and nowhere else", () => {
    strip({ spotSlides: new Set([3, 7]) });
    for (let n = 1; n <= 8; n++) {
      expect(item(n).querySelector("[data-spot]") !== null).toBe(n === 3 || n === 7);
    }
  });

  it("with live 8 renders exactly 8 items and nothing for 9", () => {
    strip();
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    expect(screen.getAllByRole("button")).toHaveLength(8);
    expect(screen.queryByRole("button", { name: /^Slide 9\b/ })).not.toBeInTheDocument();
    expect(screen.queryByText("9")).not.toBeInTheDocument();
  });

  it("does not draw a dot for a spot beyond live", () => {
    const { container } = strip({ spotSlides: new Set([9, 12]) });
    expect(container.querySelectorAll("[data-spot]")).toHaveLength(0);
  });

  it("with live 8 and viewing 5, slide 8 has the live marker and slide 5 the viewing marker", () => {
    strip({ live: 8, viewing: 5 });
    expect(item(8)).toHaveAttribute("data-live");
    expect(item(8)).not.toHaveAttribute("aria-current");
    expect(item(5)).toHaveAttribute("aria-current", "true");
    expect(item(5)).not.toHaveAttribute("data-live");
    for (const n of [1, 2, 3, 4, 6, 7]) {
      expect(item(n)).not.toHaveAttribute("data-live");
      expect(item(n)).not.toHaveAttribute("aria-current");
    }
  });

  it("when viewing the live slide, one item has both markers", () => {
    strip({ live: 8, viewing: 8 });
    expect(item(8)).toHaveAttribute("data-live");
    expect(item(8)).toHaveAttribute("aria-current", "true");
  });

  it("names the markers for a screen reader", () => {
    strip({ live: 8, viewing: 5, spotSlides: new Set([5]) });
    expect(screen.getByRole("button", { name: "Slide 8, live" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Slide 5, viewing, saved" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Slide 1" })).toBeInTheDocument();
  });

  it("calls onPick with the slide number", () => {
    const onPick = vi.fn();
    strip({ onPick });
    fireEvent.click(item(3));
    expect(onPick).toHaveBeenCalledWith(3);
  });

  it("grows as the live slide moves and shows no count", () => {
    const { rerender, container } = strip({ live: 3, viewing: 3 });
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    rerender(<SlideStrip live={4} viewing={4} spotSlides={new Set()} onPick={() => {}} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(container.textContent).not.toMatch(/\bof\b|\//);
  });

  it("scrolls the strip so the viewed slide is centered", () => {
    const { container, rerender } = strip({ live: 30, viewing: 30 });
    const nav = container.firstElementChild as HTMLElement;
    const setScroll = vi.fn();
    Object.defineProperty(nav, "scrollLeft", { configurable: true, get: () => 0, set: setScroll });
    Object.defineProperty(nav, "clientWidth", { configurable: true, value: 300 });
    const target = item(20);
    Object.defineProperty(target, "offsetLeft", { configurable: true, value: 900 });
    Object.defineProperty(target, "offsetWidth", { configurable: true, value: 40 });
    rerender(<SlideStrip live={30} viewing={20} spotSlides={new Set()} onPick={() => {}} />);
    expect(setScroll).toHaveBeenLastCalledWith(900 - 300 / 2 + 40 / 2);
  });
});
