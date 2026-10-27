import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ViewMenu } from "./ViewMenu";
import type { LectureView } from "@/lib/lectureView";

function show(view: LectureView = "notes") {
  const onView = vi.fn();
  const utils = render(
    <>
      <ViewMenu view={view} onView={onView} />
      <button type="button">Elsewhere</button>
    </>,
  );
  return { ...utils, onView, button: () => screen.getByRole("button", { name: "Layout" }) };
}

describe("ViewMenu (the student's layout, batch N)", () => {
  it("is one icon button named Layout, with no text on the screen until it is opened", () => {
    const { container, button } = show();
    expect(button()).toHaveAttribute("aria-haspopup", "menu");
    expect(button()).toHaveAttribute("aria-expanded", "false");
    expect(button().textContent).toBe("");
    expect(container.querySelector('[data-icon="layout"]')).not.toBeNull();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens a menu of the three layouts with the current one checked and focused", () => {
    const { button } = show("classic");
    fireEvent.click(button());
    const menu = screen.getByRole("menu", { name: "Layout" });
    expect(button()).toHaveAttribute("aria-expanded", "true");
    expect(button()).toHaveAttribute("aria-controls", menu.id);
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual(["Notes", "Slides only", "Classic"]);
    expect(items.map((i) => i.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
    expect(document.activeElement).toBe(items[2]);
  });

  it("picking one closes the menu, gives the focus back to the button and reports the pick (not the current one)", () => {
    const { button, onView } = show("notes");
    fireEvent.click(button());
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Slides only" }));
    expect(onView).toHaveBeenCalledWith("slides");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(button());
    fireEvent.click(button());
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Notes" }));
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it("arrow keys move in the menu (round), Home and End go to the ends, Escape closes it back to the button", () => {
    const { button } = show("notes");
    fireEvent.keyDown(button(), { key: "ArrowDown" });
    const items = screen.getAllByRole("menuitemradio");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: "ArrowUp" });
    fireEvent.keyDown(items[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2], { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "End" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2], { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(button());
  });

  it("closes on a press outside it (not inside it), and on Tab", () => {
    const { button } = show();
    fireEvent.click(button());
    fireEvent.pointerDown(screen.getByRole("menu"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(button());
    fireEvent.keyDown(screen.getAllByRole("menuitemradio")[0], { key: "Tab" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
