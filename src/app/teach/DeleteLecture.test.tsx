import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({ deleteLecture: vi.fn() }));
vi.mock("./lecture-actions", () => ({ deleteLecture: h.deleteLecture }));

import { DeleteLecture } from "./DeleteLecture";
import { DELETE_FAILED_ERROR, LIVE_LECTURE_ERROR } from "./delete-lecture-copy";

const ID = "6b2895f2-5ffc-47ed-9065-8168a678f1ce";
const NAME = "System check, Oct 22";

beforeEach(() => {
  h.deleteLecture.mockReset().mockResolvedValue({ error: DELETE_FAILED_ERROR });
});

const openPage = () => {
  render(<DeleteLecture lectureId={ID} lectureName={NAME} variant="page" />);
  fireEvent.click(screen.getByRole("button", { name: "Delete lecture" }));
  return screen.getByRole("alertdialog");
};

describe("DeleteLecture", () => {
  it("opens one plain confirm with the exact words and the lecture name, Keep it focused", () => {
    const dialog = openPage();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Delete this lecture?");
    expect(dialog).toHaveAccessibleDescription(`${NAME} This deletes the lecture and its data for good.`);
    expect(within(dialog).getByRole("button", { name: "Delete lecture" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Keep it" })).toHaveFocus();
    // Nothing to type.
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(h.deleteLecture).not.toHaveBeenCalled();
  });

  it("lives in document.body, outside the page's stacking contexts", () => {
    const { container } = render(<DeleteLecture lectureId={ID} lectureName={NAME} variant="page" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete lecture" }));
    const backdrop = screen.getByTestId("delete-lecture-backdrop");
    expect(container.contains(backdrop)).toBe(false);
    expect(backdrop.parentElement).toBe(document.body);
    expect(backdrop.className).toMatch(/\bfixed\b/);
    expect(backdrop.className).toMatch(/\bz-50\b/);
  });

  it("Keep it closes it, deletes nothing and gives focus back to the trigger", async () => {
    const dialog = openPage();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete lecture" })).toHaveFocus());
    expect(h.deleteLecture).not.toHaveBeenCalled();
  });

  it("Esc closes it and deletes nothing", () => {
    const dialog = openPage();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.deleteLecture).not.toHaveBeenCalled();
  });

  it("a press on the dimmed page closes it; a press inside does not", () => {
    const dialog = openPage();
    fireEvent.mouseDown(within(dialog).getByText(NAME));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("delete-lecture-backdrop"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("Tab stays inside the confirm", () => {
    const dialog = openPage();
    const del = within(dialog).getByRole("button", { name: "Delete lecture" });
    const keep = within(dialog).getByRole("button", { name: "Keep it" });
    keep.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(del).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(keep).toHaveFocus();
  });

  it("Delete lecture calls the server action with this lecture once", async () => {
    let resolve!: (v: unknown) => void;
    h.deleteLecture.mockReturnValue(new Promise((r) => (resolve = r)));
    const dialog = openPage();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete lecture" }));
    expect(h.deleteLecture).toHaveBeenCalledWith(ID);
    // While it runs: buttons are off, so a second press can not send it twice, and Esc waits.
    expect(within(dialog).getByRole("button", { name: "Deleting…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Keep it" })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    resolve({ error: DELETE_FAILED_ERROR });
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent(DELETE_FAILED_ERROR));
    expect(h.deleteLecture).toHaveBeenCalledTimes(1);
  });

  it("shows why when the lecture is live and stays open", async () => {
    h.deleteLecture.mockResolvedValue({ error: LIVE_LECTURE_ERROR });
    const dialog = openPage();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete lecture" }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent(LIVE_LECTURE_ERROR));
    expect(within(dialog).getByRole("button", { name: "Delete lecture" })).toBeEnabled();
  });

  it("a thrown failure shows the plain error", async () => {
    h.deleteLecture.mockRejectedValueOnce(new Error("network"));
    const dialog = openPage();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete lecture" }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent(DELETE_FAILED_ERROR));
  });

  it("a redirect (the delete worked) shows no error", async () => {
    h.deleteLecture.mockRejectedValueOnce(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/teach/c/x?deleted=1;307;" }));
    const dialog = openPage();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete lecture" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Delete lecture" })).toBeEnabled());
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  it("the row trigger is a quiet Delete named for its lecture", () => {
    render(<DeleteLecture lectureId={ID} lectureName={NAME} variant="row" />);
    const trigger = screen.getByRole("button", { name: `Delete ${NAME}` });
    expect(trigger).toHaveTextContent("Delete");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    // Hidden until hover or keyboard focus, always there on touch screens.
    expect(trigger.className).toMatch(/opacity-0/);
    expect(trigger.className).toMatch(/focus-visible:opacity-100/);
    expect(trigger.className).toMatch(/\[@media\(hover:none\)\]:opacity-100/);
    fireEvent.click(trigger);
    expect(screen.getByRole("alertdialog")).toHaveAccessibleName("Delete this lecture?");
  });
});
