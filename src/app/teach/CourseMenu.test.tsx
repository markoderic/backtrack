import { describe, it, expect, vi, beforeEach } from "vitest";
import { Activity } from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { CourseDetails } from "@/lib/courseDetails";

const h = vi.hoisted(() => ({
  select: vi.fn(),
  refresh: vi.fn(),
  updates: [] as unknown[],
  eqs: [] as [string, unknown][],
}));

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({
    from: () => ({
      update: (payload: unknown) => {
        h.updates.push(payload);
        const chain = {
          eq: (c: string, v: unknown) => {
            h.eqs.push([c, v]);
            return chain;
          },
          select: h.select,
        };
        return chain;
      },
    }),
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));

import { CourseMenu } from "./CourseMenu";

const ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const details: CourseDetails = { color: "teal", section: "Section B", meetDays: [1, 3], startMinute: 605, endMinute: 685 };

const trigger = () => screen.getByRole("button", { name: "More for IMS 452" });
const items = () => within(screen.getByRole("menu")).getAllByRole("menuitem");

const props: {
  courseId: string;
  name: string;
  code: string;
  details: CourseDetails | null;
  options: boolean;
} = {
  courseId: ID,
  name: "IMS 452 Senior Design",
  code: "IMS 452",
  details,
  options: true,
};

let onArchive: ReturnType<typeof vi.fn>;
let announce: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.select.mockReset().mockResolvedValue({ data: [{ id: ID }], error: null });
  h.refresh.mockReset();
  h.updates.length = 0;
  h.eqs.length = 0;
  onArchive = vi.fn().mockResolvedValue(true);
  announce = vi.fn();
});

const show = (more: Partial<typeof props> = {}) =>
  render(
    <CourseMenu
      {...props}
      {...more}
      onArchive={onArchive as unknown as () => Promise<boolean>}
      announce={announce as unknown as (t: string) => void}
    />,
  );

describe("CourseMenu (the ⋯ on a course card)", () => {
  it("is a 44 px button named for its course, closed at first", () => {
    show();
    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger().className).toContain("size-11");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens Download CSV (the course's semester CSV), Edit details, Rename and Archive, in document.body", () => {
    const { container } = show();
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(items().map((i) => i.textContent)).toEqual(["Download CSV", "Edit details", "Rename", "Archive"]);
    const csv = screen.getByRole("menuitem", { name: "Download CSV" });
    expect(csv).toHaveAttribute("href", `/teach/c/${ID}/export`);
    expect(csv).toHaveAttribute("download");
    const menu = screen.getByRole("menu");
    expect(container.contains(menu)).toBe(false);
    expect(menu.className).toContain("fixed");
    expect(menu.className).toContain("z-50");
  });

  it("before 0018 (no details) there is no Edit details", () => {
    show({ details: null });
    fireEvent.click(trigger());
    expect(items().map((i) => i.textContent)).toEqual(["Download CSV", "Rename", "Archive"]);
  });

  it("keyboard: ↓ opens it on the first item, ↑ on the last; ↑ ↓ Home End move; Esc and Tab close it back on ⋯", () => {
    show();
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Download CSV" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Edit details" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "End" });
    expect(screen.getByRole("menuitem", { name: "Archive" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Download CSV" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger()).toHaveFocus();
    fireEvent.keyDown(trigger(), { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "Archive" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Home" });
    expect(screen.getByRole("menuitem", { name: "Download CSV" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("a press outside closes it; Next hiding the page closes it too", () => {
    const { rerender } = render(
      <Activity mode="visible">
        <CourseMenu {...props} onArchive={onArchive as never} announce={announce as never} />
      </Activity>,
    );
    fireEvent.click(trigger());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(trigger());
    rerender(
      <Activity mode="hidden">
        <CourseMenu {...props} onArchive={onArchive as never} announce={announce as never} />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <CourseMenu {...props} onArchive={onArchive as never} announce={announce as never} />
      </Activity>,
    );
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Archive calls the list's archive", () => {
    show();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("CourseMenu: Edit details in a dialog", () => {
  const open = () => {
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit details" }));
  };

  it("opens the same details form in a dialog on the dashboard, on the chosen color", () => {
    show();
    open();
    const dialog = screen.getByRole("dialog", { name: "Details for IMS 452" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("group", { name: "Color" })).toBeInTheDocument();
    expect(within(dialog).getByRole("group", { name: "Meets on" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Starts")).toHaveValue("10:05");
    expect(within(dialog).getByRole("radio", { name: "Teal" })).toHaveFocus();
    // After 0019: the new presets and Custom.
    expect(within(dialog).getByRole("radio", { name: "Pink" })).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "Custom" })).toBeInTheDocument();
  });

  it("before 0019 the dialog offers only the eight colors", () => {
    show({ options: false });
    open();
    const dialog = screen.getByRole("dialog", { name: "Details for IMS 452" });
    expect(within(dialog).queryByRole("radio", { name: "Pink" })).toBeNull();
    expect(within(dialog).queryByRole("radio", { name: "Custom" })).toBeNull();
  });

  it("saves a custom color and the details, closes, says so and refreshes; the keyboard goes back to ⋯", async () => {
    show();
    open();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Custom" }));
    // The app's own picker: a popover outside the dialog's box, still reachable.
    fireEvent.click(within(dialog).getByRole("button", { name: /^Pick a color/ }));
    fireEvent.change(screen.getByLabelText("Custom color"), { target: { value: "#c0ffee" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("dialog", { name: "Details for IMS 452" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Wednesday" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(h.updates).toEqual([
      { color: "#c0ffee", section: "Section B", meet_days: [1], start_minute: 605, end_minute: 685 },
    ]);
    expect(h.eqs).toEqual([["id", ID]]);
    expect(announce).toHaveBeenCalledWith("Saved the details for IMS 452.");
    expect(h.refresh).toHaveBeenCalled();
    expect(trigger()).toHaveFocus();
  });

  it("Esc, Cancel or a press on the dimmed page close it without saving, back on ⋯", () => {
    show();
    open();
    fireEvent.keyDown(screen.getByLabelText(/Section/), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger()).toHaveFocus();
    open();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    fireEvent.mouseDown(screen.getByTestId("course-details-dialog-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.updates).toEqual([]);
  });

  it("Esc in a time field stays with the field (the browser's picker)", () => {
    show();
    open();
    fireEvent.keyDown(screen.getByLabelText("Starts"), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Tab stays inside the dialog", () => {
    show();
    open();
    const dialog = screen.getByRole("dialog");
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(within(dialog).getByRole("radio", { name: "Teal" })).toHaveFocus();
    fireEvent.keyDown(within(dialog).getByRole("radio", { name: "Teal" }), { key: "Tab", shiftKey: true });
    expect(cancel).toHaveFocus();
  });

  it("a failed save keeps the dialog open and says so", async () => {
    h.select.mockResolvedValue({ data: [], error: null });
    show();
    open();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save. Try again.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(announce).not.toHaveBeenCalled();
  });
});

describe("CourseMenu: Rename in a dialog", () => {
  const open = () => {
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
  };

  it("opens with the full name in a focused field; saves the trimmed name and refreshes", async () => {
    show();
    open();
    const dialog = screen.getByRole("dialog", { name: "Rename IMS 452" });
    const field = within(dialog).getByLabelText("Course name");
    expect(field).toHaveValue("IMS 452 Senior Design");
    expect(field).toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "Rename" })).toBeDisabled();
    fireEvent.change(field, { target: { value: "  IMS 452 Capstone " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(h.updates).toEqual([{ name: "IMS 452 Capstone" }]);
    expect(announce).toHaveBeenCalledWith("Renamed to IMS 452 Capstone.");
    expect(h.refresh).toHaveBeenCalled();
    expect(trigger()).toHaveFocus();
  });

  it("refuses an empty name and says so; a failed save keeps it open", async () => {
    show();
    open();
    const field = screen.getByLabelText("Course name");
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The course name must be 1 to 120 characters.");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(h.updates).toEqual([]);
    h.select.mockResolvedValue({ data: [], error: null });
    fireEvent.change(field, { target: { value: "IMS 999" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not rename the course.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("CourseMenu: the dialog and the page", () => {
  it("the page behind does not scroll while a dialog is open", () => {
    show();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(document.body.style.overflow).toBe("hidden");
    // The scrollbar's room stays, so the page does not shift sideways.
    expect(document.documentElement.style.scrollbarGutter).toBe("stable");
    fireEvent.keyDown(screen.getByLabelText("Course name"), { key: "Escape" });
    expect(document.body.style.overflow).toBe("");
    expect(document.documentElement.style.scrollbarGutter).toBe("");
  });

  it("Next hiding the page closes an open dialog; shown again it is closed and pulls no focus", () => {
    const view = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <CourseMenu {...props} onArchive={onArchive as never} announce={announce as never} />
      </Activity>
    );
    const { rerender } = render(view("visible"));
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit details" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    rerender(view("hidden"));
    (document.activeElement as HTMLElement | null)?.blur();
    rerender(view("visible"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger()).not.toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("a failed Archive puts the keyboard back on ⋯", async () => {
    onArchive.mockResolvedValue(false);
    show();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    await waitFor(() => expect(trigger()).toHaveFocus());
  });
});

describe("CourseMenu: the color picker inside the Edit details dialog", () => {
  it("its popover is placed inside the modal dialog, so aria-modal never hides it from screen readers", () => {
    show();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit details" }));
    const dialog = screen.getByRole("dialog", { name: "Details for IMS 452" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Custom" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Pick a color/ }));
    const popover = screen.getByRole("dialog", { name: "Pick a custom color" });
    expect(dialog.contains(popover)).toBe(true);
    // Still fixed to the window: not inside the white panel, whose pop-in scale would move it.
    expect(screen.getByTestId("course-details-dialog").contains(popover)).toBe(false);
    expect(popover.className).toContain("fixed");
    // A press in the popover does not close the dialog; Esc closes only the popover.
    fireEvent.mouseDown(within(popover).getAllByRole("button")[0]);
    fireEvent.keyDown(screen.getByLabelText("Custom color"), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Pick a custom color" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Details for IMS 452" })).toBeInTheDocument();
  });
});

