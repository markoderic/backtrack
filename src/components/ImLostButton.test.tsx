import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ImLostButton, PRESS_MS, SAVED_MS } from "./ImLostButton";

afterEach(() => {
  vi.useRealTimers();
});

describe("ImLostButton", () => {
  it("is a button named I'm lost", () => {
    render(<ImLostButton />);
    const b = screen.getByRole("button", { name: "I'm lost" });
    expect(b).toHaveAttribute("type", "button");
    expect(b).toHaveAttribute("data-phase", "default");
    expect(b).toHaveTextContent("I'm lost");
  });

  it("calls onClick, presses for 120 ms, shows Saved with a check for 2 s, then goes back", () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    render(<ImLostButton onClick={onClick} />);
    const b = screen.getByRole("button", { name: "I'm lost" });
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(b).toHaveAttribute("data-phase", "pressed");
    act(() => vi.advanceTimersByTime(PRESS_MS));
    expect(b).toHaveAttribute("data-phase", "saved");
    expect(b.querySelector('[data-icon="check"]')).not.toBeNull();
    // Still named I'm lost while it shows the check.
    expect(screen.getByRole("button", { name: "I'm lost" })).toBe(b);
    act(() => vi.advanceTimersByTime(SAVED_MS - 1));
    expect(b).toHaveAttribute("data-phase", "saved");
    act(() => vi.advanceTimersByTime(1));
    expect(b).toHaveAttribute("data-phase", "default");
  });

  it("can be pressed again while Saved shows, which starts the 2 s over", () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    render(<ImLostButton onClick={onClick} />);
    const b = screen.getByRole("button", { name: "I'm lost" });
    fireEvent.click(b);
    act(() => vi.advanceTimersByTime(PRESS_MS + 1500));
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(PRESS_MS + 1000));
    expect(b).toHaveAttribute("data-phase", "saved");
  });

  it("shows a forced phase", () => {
    render(<ImLostButton phase="saved" />);
    expect(screen.getByRole("button", { name: "I'm lost" })).toHaveAttribute("data-phase", "saved");
  });
});
