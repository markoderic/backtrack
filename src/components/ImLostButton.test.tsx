import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ImLostButton, PRESS_MS } from "./ImLostButton";

afterEach(() => {
  vi.useRealTimers();
});

describe("ImLostButton", () => {
  it("is a full width button named I'm lost, the Join button's shape (48 px, radius md) in red", () => {
    render(<ImLostButton />);
    const b = screen.getByRole("button", { name: "I'm lost" });
    expect(b).toHaveAttribute("type", "button");
    expect(b).toHaveAttribute("data-phase", "default");
    expect(b).not.toHaveAttribute("aria-disabled");
    expect(b.className).toContain("h-12");
    expect(b.className).toContain("w-full");
    expect(b.className).toContain("rounded-md");
    expect(b.className).toContain("bg-lost");
    expect(b.className).not.toContain("rounded-full");
  });

  it("calls onClick at once, presses for 120 ms, then shows the checked look while checked", () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    const { rerender } = render(<ImLostButton onClick={onClick} slide={7} />);
    const b = screen.getByRole("button", { name: "I'm lost" });
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(b).toHaveAttribute("data-phase", "pressed");
    rerender(<ImLostButton onClick={onClick} slide={7} checked />);
    // Still the press look until the 120 ms are over.
    expect(b).toHaveAttribute("data-phase", "pressed");
    act(() => vi.advanceTimersByTime(PRESS_MS));
    expect(b).toHaveAttribute("data-phase", "checked");
    expect(b).toHaveTextContent("Lost on slide 7");
    expect(b.querySelector('[data-icon="check"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Lost on slide 7" })).toBe(b);
  });

  it("takes no second tap while checked: aria-disabled, focusable, onClick not called", () => {
    const onClick = vi.fn();
    render(<ImLostButton onClick={onClick} slide={3} checked />);
    const b = screen.getByRole("button", { name: "Lost on slide 3" });
    expect(b).toHaveAttribute("aria-disabled", "true");
    expect(b).not.toBeDisabled();
    b.focus();
    expect(b).toHaveFocus();
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
    expect(b).toHaveAttribute("data-phase", "checked");
  });

  it("goes back to I'm lost when it is no longer checked (Undo, or another slide)", () => {
    const { rerender } = render(<ImLostButton slide={3} checked />);
    rerender(<ImLostButton slide={4} />);
    const b = screen.getByRole("button", { name: "I'm lost" });
    expect(b).toHaveAttribute("data-phase", "default");
    expect(b).not.toHaveAttribute("aria-disabled");
  });
});
