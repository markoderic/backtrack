import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InfoButton } from "./InfoButton";

const HELP = "Tap I'm lost when you lose track. Backtrack saves the slide so you can come back to it after class.";

describe("InfoButton", () => {
  it("shows only the button until it is pressed", () => {
    render(<InfoButton />);
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(HELP)).not.toBeInTheDocument();
  });

  it("opens a panel with the two lines", () => {
    render(<InfoButton />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    const panel = screen.getByRole("dialog");
    expect(panel).toHaveTextContent(HELP);
    expect(panel).toHaveTextContent("Nobody sees your name.");
    expect(panel.querySelectorAll("p")).toHaveLength(2);
  });

  it("closes with the Close button", () => {
    render(<InfoButton />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
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
