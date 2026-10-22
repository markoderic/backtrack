import { describe, it, expect, vi, beforeEach } from "vitest";
import { Activity } from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({ deleteLecture: vi.fn() }));
vi.mock("./lecture-actions", () => ({ deleteLecture: h.deleteLecture }));

import { LectureMenu } from "./LectureMenu";

const ID = "6b2895f2-5ffc-47ed-9065-8168a678f1ce";
const NAME = "Week 8: Adjusting Entries";

const trigger = () => screen.getByRole("button", { name: `More for ${NAME}` });
const items = () => within(screen.getByRole("menu")).getAllByRole("menuitem");

beforeEach(() => {
  h.deleteLecture.mockReset().mockResolvedValue({ error: "Could not delete the lecture. Try again." });
});

describe("LectureMenu (the ⋯ on a lecture row)", () => {
  it("is an always-visible 44 px button named for its lecture, closed at first", () => {
    render(<LectureMenu lectureId={ID} lectureName={NAME} live={false} />);
    const button = trigger();
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button.className).toContain("size-11");
    expect(button.className).not.toMatch(/opacity-0|group-hover/);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("an ended lecture: Download CSV (this lecture's export) and Delete, no Resume", () => {
    render(<LectureMenu lectureId={ID} lectureName={NAME} live={false} />);
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(items().map((i) => i.textContent)).toEqual(["Download CSV", "Delete"]);
    const csv = screen.getByRole("menuitem", { name: "Download CSV" });
    expect(csv).toHaveAttribute("href", `/teach/l/${ID}/export`);
    expect(csv).toHaveAttribute("download");
    expect(screen.queryByRole("menuitem", { name: /Resume/ })).toBeNull();
  });

  it("a live lecture: Resume goes to the projector; Download CSV and Delete are off and say why", () => {
    render(<LectureMenu lectureId={ID} lectureName={NAME} live />);
    fireEvent.click(trigger());
    expect(screen.getByRole("menuitem", { name: "Resume" })).toHaveAttribute("href", `/teach/l/${ID}/present`);
    const del = screen.getByRole("menuitem", { name: /^Delete/ });
    expect(del).toHaveAttribute("aria-disabled", "true");
    expect(del).toHaveAccessibleDescription("End the class first");
    const csv = screen.getByRole("menuitem", { name: /^Download CSV/ });
    expect(csv).toHaveAttribute("aria-disabled", "true");
    expect(csv).not.toHaveAttribute("href");
    // Pressing the off Delete opens nothing.
    fireEvent.click(del);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.deleteLecture).not.toHaveBeenCalled();
  });

  it("lives in document.body (fixed, z-50), so no row's stacking context can cover it", () => {
    const { container } = render(<LectureMenu lectureId={ID} lectureName={NAME} live={false} />);
    fireEvent.click(trigger());
    const menu = screen.getByRole("menu");
    expect(container.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
    expect(menu.className).toMatch(/\bfixed\b/);
    expect(menu.className).toMatch(/\bz-50\b/);
  });

  it("works from the keyboard: ↓ opens on the first item, arrows wrap, Home and End jump, Esc closes back on ⋯", async () => {
    render(<LectureMenu lectureId={ID} lectureName={NAME} live />);
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    const [csv, resume, del] = items();
    await waitFor(() => expect(csv).toHaveFocus());
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(resume).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(del).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(csv).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(del).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(csv).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(del).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger()).toHaveFocus();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("↑ opens on the last item; Tab closes it with the keyboard back on ⋯", async () => {
    render(<LectureMenu lectureId={ID} lectureName={NAME} live={false} />);
    fireEvent.keyDown(trigger(), { key: "ArrowUp" });
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("a press outside closes it; a second press on ⋯ closes it too", () => {
    render(
      <>
        <p>elsewhere</p>
        <LectureMenu lectureId={ID} lectureName={NAME} live={false} />
      </>,
    );
    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText("elsewhere"));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("stays open and with its button when the page scrolls or the window is resized", () => {
    render(<LectureMenu lectureId={ID} lectureName={NAME} live={false} />);
    fireEvent.click(trigger());
    fireEvent.scroll(window);
    fireEvent(window, new Event("resize"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menu").style.top).not.toBe("");
  });

  it("Delete opens the Delete lecture confirm; Keep it gives the keyboard back to ⋯", async () => {
    render(<LectureMenu lectureId={ID} lectureName={NAME} live={false} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.queryByRole("menu")).toBeNull();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAccessibleName("Delete this lecture?");
    expect(dialog).toHaveTextContent(NAME);
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(trigger()).toHaveFocus());
    expect(h.deleteLecture).not.toHaveBeenCalled();
  });

  it("Delete lecture in the confirm deletes this lecture", async () => {
    render(<LectureMenu lectureId={ID} lectureName={NAME} live={false} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete lecture" }));
    await waitFor(() => expect(h.deleteLecture).toHaveBeenCalledWith(ID));
  });

  it("closes on Back or Forward (popstate) and when the page is hidden (batch A review M2)", () => {
    render(<LectureMenu lectureId={ID} lectureName={NAME} live={false} />);
    fireEvent.click(trigger());
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent(window, new PopStateEvent("popstate"));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger());
    fireEvent(window, new Event("pagehide"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("is closed when its page comes back after being kept hidden (Activity), and takes no focus", async () => {
    const { rerender } = render(
      <Activity mode="visible">
        <LectureMenu lectureId={ID} lectureName={NAME} live={false} />
      </Activity>,
    );
    fireEvent.click(trigger());
    expect(screen.getByRole("menu")).toBeInTheDocument();
    rerender(
      <Activity mode="hidden">
        <LectureMenu lectureId={ID} lectureName={NAME} live={false} />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <LectureMenu lectureId={ID} lectureName={NAME} live={false} />
      </Activity>,
    );
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).not.toBe(document.querySelector('[role="menuitem"]'));
  });
});

