import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SlideFocus } from "./SlideFocus";

const rects = [
  { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
  { x: 0.12, y: 0.22, w: 0.3, h: 0.1 },
];
const show = (props: Partial<React.ComponentProps<typeof SlideFocus>> = {}) =>
  render(
    <SlideFocus number={3} firstLine="Why adjust at all?" url="https://signed/3.webp" rects={rects} marksLabel="2 marked the spot" {...props} />,
  );
const trigger = () => screen.getByRole("button", { name: "Enlarge slide 3" });
const open = () => fireEvent.click(trigger());
const closeButton = () => screen.getByRole("button", { name: "Close" });

describe("SlideFocus", () => {
  it("draws the slide with every box at the panel's width, at the guessed shape until the image loads", () => {
    const onRatio = vi.fn();
    show({ ratio: 4 / 3, onRatio });
    const box = screen.getByTestId("slide-box");
    expect(box.style.aspectRatio).toBe(`${4 / 3} / 1`);
    expect(box.querySelectorAll("[data-highlight-box]")).toHaveLength(2);
    const img = box.querySelector("img")!;
    expect(img).toHaveAttribute("src", "https://signed/3.webp");
    Object.defineProperty(img, "naturalWidth", { value: 1600 });
    Object.defineProperty(img, "naturalHeight", { value: 900 });
    fireEvent.load(img);
    expect(onRatio).toHaveBeenCalledWith(1600 / 900);
    expect(box.style.aspectRatio).toBe(`${1600 / 900} / 1`);
  });

  it("shows a blank slide with its first line while there is no image", () => {
    show({ url: undefined });
    expect(screen.getByTestId("slide-box").querySelector("img")).toBeNull();
    expect(screen.getByTestId("slide-box")).toHaveTextContent("Why adjust at all?");
  });

  it("opens a modal big view with the slide, its boxes and the marks; focus on Close; onOpen is told", () => {
    const onOpen = vi.fn();
    show({ onOpen });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    open();
    const dialog = screen.getByRole("dialog");
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("tabindex", "-1");
    expect(dialog).toHaveAccessibleName("Slide 3, Why adjust at all?");
    expect(dialog).toHaveTextContent("2 marked the spot");
    expect(dialog.querySelector('img[alt="Slide 3"]')).toHaveAttribute("src", "https://signed/3.webp");
    expect(dialog.querySelectorAll("[data-highlight-box]")).toHaveLength(2);
    expect(closeButton()).toHaveFocus();
  });

  it("Tab and Shift+Tab stay on Close", () => {
    show();
    open();
    fireEvent.keyDown(closeButton(), { key: "Tab" });
    expect(closeButton()).toHaveFocus();
    fireEvent.keyDown(closeButton(), { key: "Tab", shiftKey: true });
    expect(closeButton()).toHaveFocus();
  });

  it("Esc closes and gives focus back to the slide", () => {
    show();
    open();
    fireEvent.keyDown(closeButton(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("after a click on the slide inside it, Esc still closes and Tab still lands on Close", () => {
    show();
    open();
    const img = screen.getByRole("dialog").querySelector("img")!;
    fireEvent.mouseDown(img);
    // The click moves focus off Close (to the dialog, or the page in a browser that drops it).
    closeButton().blur();
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(closeButton()).toHaveFocus();
    closeButton().blur();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("Close closes; a press on the dimmed page closes; a press inside does not", () => {
    show();
    open();
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("slide-big-backdrop"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    open();
    fireEvent.click(closeButton());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("stops the page behind from scrolling while it is open, and gives the scroll back", () => {
    document.body.style.overflow = "";
    show();
    open();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(closeButton());
    expect(document.body.style.overflow).toBe("");
  });

  it("no longer hears Esc once closed", () => {
    show();
    open();
    fireEvent.click(closeButton());
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.body.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(false);
  });
});
