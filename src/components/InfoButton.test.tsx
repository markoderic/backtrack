import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InfoButton } from "./InfoButton";

const HELP = "Lost the thread? Tap I'm lost. The slide is saved and the lecture keeps going.";

describe("InfoButton", () => {
  it("shows only the info icon button until it is pressed", () => {
    const { container } = render(<InfoButton />);
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
    expect(container.querySelector('[data-icon="info"]')).not.toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(HELP)).not.toBeInTheDocument();
  });

  it("opens the How it works popover: I'm lost, Mark with red and yellow, notes and taking back, privacy", () => {
    render(<InfoButton />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    const panel = screen.getByRole("dialog");
    expect(screen.getByRole("button", { name: "Help" })).toHaveAttribute("aria-expanded", "true");
    expect(panel).toHaveTextContent("How it works");
    expect(panel).toHaveTextContent(HELP);
    expect(panel).toHaveTextContent("Save this keeps a slide just for you.");
    expect(panel).toHaveTextContent(
      "Turn on Mark and drag over any part of the slide. Yellow marks are just for you. On a slide where you're lost they're red, and your teacher sees the box but never its note.",
    );
    expect(panel).toHaveTextContent("Tap a mark to add a note or delete it. Tap I'm lost or Saved for you again to take it back.");
    expect(panel).toHaveTextContent("Nobody sees your name, not even your teacher. Your spots stay in this browser.");
    // The old Mark the spot (only after I'm lost) is gone.
    expect(panel).not.toHaveTextContent("Mark the spot");
    expect(panel.querySelectorAll("p")).toHaveLength(5);
  });

  it("closes when the button is pressed again", () => {
    render(<InfoButton />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on a press outside it, not on a press inside it", () => {
    render(
      <>
        <InfoButton />
        <button type="button">Elsewhere</button>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.pointerDown(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes with Escape", () => {
    render(<InfoButton />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does nothing on Escape while closed, and other keys do not close it", () => {
    render(<InfoButton />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.keyDown(window, { key: "n" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
