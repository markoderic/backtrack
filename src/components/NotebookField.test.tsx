import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { NotebookField } from "./NotebookField";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("NotebookField (grow)", () => {
  it("fits its height again when it gets narrower, so its last line is never hidden (K2 review M1)", () => {
    let resized: (() => void) | null = null;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          resized = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    let width = 300;
    let scroll = 24;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => scroll);
    render(<NotebookField grow rows={1} maxRows={4} aria-label="Note" value="Where does the 2,400 come from?" onValue={() => {}} />);
    const field = screen.getByRole("textbox", { name: "Note" });
    expect(field.style.height).toBe("24px");
    // "Saved" comes beside it: narrower, and the text wraps to two lines.
    width = 240;
    scroll = 48;
    act(() => resized?.());
    expect(field.style.height).toBe("48px");
  });
});
