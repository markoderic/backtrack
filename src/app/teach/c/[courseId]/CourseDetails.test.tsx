import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { CourseDetails } from "@/lib/courseDetails";

const h = vi.hoisted(() => ({
  select: vi.fn(),
  refresh: vi.fn(),
  updates: [] as unknown[],
  eqs: [] as [string, unknown][],
  tables: [] as string[],
}));

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({
    from: (table: string) => {
      h.tables.push(table);
      return {
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
      };
    },
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));

import { CourseDetailsEditor } from "./CourseDetails";

const empty: CourseDetails = { color: null, section: null, meetDays: [], startMinute: null, endMinute: null };
const set: CourseDetails = {
  color: "teal",
  section: "Section B",
  meetDays: [1, 3, 5],
  startMinute: 605,
  endMinute: 660,
};

beforeEach(() => {
  h.select.mockReset().mockResolvedValue({ data: [{ id: "c1" }], error: null });
  h.refresh.mockReset();
  h.updates.length = 0;
  h.eqs.length = 0;
  h.tables.length = 0;
});

const show = (details: CourseDetails = set) =>
  render(<CourseDetailsEditor courseId="c1" code="IMS 452" details={details} />);
const showWith = (details: CourseDetails, options: boolean) =>
  render(<CourseDetailsEditor courseId="c1" code="IMS 452" details={details} options={options} />);
const edit = () => fireEvent.click(screen.getByRole("button", { name: /Edit details|Add color, section and time/ }));
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save" }));
const day = (name: string) => screen.getByRole("button", { name });

describe("CourseDetailsEditor", () => {
  it("shows the section and when the class meets, and Edit details", () => {
    show();
    expect(screen.getByTestId("course-details")).toHaveTextContent("Section B · Mon Wed Fri · 10:05–11:00 AM");
    expect(screen.getByRole("button", { name: "Edit details" })).toBeInTheDocument();
  });

  it("with nothing set, only the button, worded for adding", () => {
    show(empty);
    expect(screen.getByTestId("course-details").querySelector("p")).toBeNull();
    expect(screen.getByRole("button", { name: "Add color, section and time" })).toBeInTheDocument();
  });

  it("before 0019: the eight colors the database takes and No color, as named round chips, the chosen one checked and focused", () => {
    show();
    edit();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.closest("label")!.textContent)).toEqual([
      "No color",
      "Ochre",
      "Olive",
      "Green",
      "Teal",
      "Blue",
      "Indigo",
      "Plum",
      "Slate",
    ]);
    expect(screen.getByRole("radio", { name: "Teal" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Teal" })).toHaveFocus();
    expect(screen.getByRole("group", { name: "Color" })).toBeInTheDocument();
    const chip = document.querySelector('[data-swatch="teal"]')!;
    expect(chip.className).toContain("size-6");
    expect(chip.className).toContain("rounded-full");
    expect(chip.className).toContain("bg-course-teal");
    // Nothing the database would refuse before 0019, and never the I'm lost red.
    expect(document.querySelector('[data-swatch="red"], [data-swatch="custom"], .bg-lost')).toBeNull();
  });

  it("after 0019: eleven presets in hue order (red, orange and pink added) and Custom", () => {
    showWith(set, true);
    edit();
    expect(screen.getAllByRole("radio").map((r) => r.closest("label")!.textContent)).toEqual([
      "No color",
      "Red",
      "Orange",
      "Ochre",
      "Olive",
      "Green",
      "Teal",
      "Blue",
      "Indigo",
      "Plum",
      "Pink",
      "Slate",
      "Custom",
    ]);
    expect(document.querySelector('[data-swatch="custom"]')!.className).toContain("bg-course-rainbow");
    for (const c of ["red", "orange", "pink"]) {
      expect(document.querySelector(`[data-swatch="${c}"]`)!.className).toContain(`bg-course-${c}`);
    }
    expect(document.querySelector(".bg-lost")).toBeNull();
  });

  const picker = () => screen.getByRole("button", { name: /^Pick a color/ });
  const panel = () => screen.queryByRole("dialog", { name: "Pick a custom color" });
  const swatches = () => within(screen.getByRole("group", { name: "Colors" })).getAllByRole("button");

  it("after 0019: Custom opens a picker of the app's own (no system color panel): 24 swatches and the hex field", async () => {
    showWith(set, true);
    edit();
    expect(screen.queryByRole("button", { name: /^Pick a color/ })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    expect(document.querySelector('input[type="color"]')).toBeNull();
    expect(picker()).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(picker());
    expect(picker()).toHaveAttribute("aria-expanded", "true");
    // Not in a dialog here (the course page): the popover goes to the page's body.
    expect(panel()!.parentElement).toBe(document.body);
    expect(swatches()).toHaveLength(24);
    for (const b of swatches()) expect(b.getAttribute("aria-label")).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(swatches().map((b) => b.getAttribute("aria-label"))).size).toBe(24);
    // A swatch picks the color, closes the popover and puts the keyboard back on the button.
    const third = swatches()[2];
    const hex = third.getAttribute("aria-label")!;
    fireEvent.click(third);
    expect(panel()).toBeNull();
    expect(picker()).toHaveFocus();
    expect(picker()).toHaveAccessibleName(`Pick a color, now ${hex}`);
    expect((document.querySelector('[data-swatch="custom"]') as HTMLElement).style.backgroundColor).not.toBe("");
    // The hex field, typed in any case, is saved lowercase.
    fireEvent.click(picker());
    expect(within(panel()!).getByRole("button", { name: hex })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByLabelText("Custom color"), { target: { value: "#2F6DB5" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    save();
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(h.updates).toEqual([
      { color: "#2f6db5", section: "Section B", meet_days: [1, 3, 5], start_minute: 605, end_minute: 660 },
    ]);
  });

  it("after 0019: the picker works from the keyboard: arrows in the grid, Tab through the field and Done, Esc back", () => {
    showWith({ ...set, color: null }, true);
    edit();
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    fireEvent.click(picker());
    const grid = screen.getByRole("group", { name: "Colors" });
    expect(swatches()[0]).toHaveFocus();
    expect(swatches().filter((b) => b.tabIndex === 0)).toHaveLength(1);
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(swatches()[1]).toHaveFocus();
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(swatches()[13]).toHaveFocus();
    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    expect(swatches()[12]).toHaveFocus();
    // At the bottom row ↓ stays put, and at the top row ↑ does.
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(swatches()[12]).toHaveFocus();
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(swatches()[0]).toHaveFocus();
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(swatches()[0]).toHaveFocus();
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(swatches()[1]).toHaveFocus();
    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(swatches()[13]).toHaveFocus();
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(swatches()[13]).toHaveFocus();
    fireEvent.keyDown(grid, { key: "End" });
    expect(swatches()[23]).toHaveFocus();
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(swatches()[23]).toHaveFocus();
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(swatches()[11]).toHaveFocus();
    fireEvent.keyDown(grid, { key: "Home" });
    expect(swatches()[0]).toHaveFocus();
    fireEvent.keyDown(swatches()[0], { key: "Tab" });
    expect(screen.getByLabelText("Custom color")).toHaveFocus();
    fireEvent.keyDown(screen.getByLabelText("Custom color"), { key: "Tab" });
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: "Done" }), { key: "Tab" });
    expect(swatches()[0]).toHaveFocus();
    fireEvent.keyDown(swatches()[0], { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();
    // Esc closes the popover only (not the form), back on the button.
    fireEvent.keyDown(screen.getByRole("button", { name: "Done" }), { key: "Escape" });
    expect(panel()).toBeNull();
    expect(picker()).toHaveFocus();
    expect(screen.getByTestId("course-details-form")).toBeInTheDocument();
    // Enter in the hex field closes it too.
    fireEvent.click(picker());
    fireEvent.change(screen.getByLabelText("Custom color"), { target: { value: "#123456" } });
    fireEvent.keyDown(screen.getByLabelText("Custom color"), { key: "Enter" });
    expect(panel()).toBeNull();
    expect(picker()).toHaveAccessibleName("Pick a color, now #123456");
  });

  it("after 0019: a hex without the # is taken; a bad one is refused and points at the picker", async () => {
    showWith(set, true);
    edit();
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    fireEvent.click(picker());
    fireEvent.change(screen.getByLabelText("Custom color"), { target: { value: "c0ffee" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(picker()).toHaveAccessibleName("Pick a color, now #c0ffee");
    fireEvent.click(picker());
    fireEvent.change(screen.getByLabelText("Custom color"), { target: { value: "#12g" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    save();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Pick a color, or type one like #2f6db5.");
    expect(picker()).toHaveAttribute("aria-describedby", alert.id);
    fireEvent.click(picker());
    expect(screen.getByLabelText("Custom color")).toHaveAttribute("aria-invalid", "true");
    expect(h.updates).toEqual([]);
  });

  it("after 0019: a course with a picked color opens on Custom with it", () => {
    showWith({ ...set, color: "#2f6db5" }, true);
    edit();
    expect(screen.getByRole("radio", { name: "Custom" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Custom" })).toHaveFocus();
    expect(picker()).toHaveAccessibleName("Pick a color, now #2f6db5");
  });

  it.each([
    ["a picked color", "#2f6db5" as CourseDetails["color"]],
    ["a preset from 0019", "pink" as CourseDetails["color"]],
  ])("a stored color the form can not offer (%s, columns not read) is kept on Save, not cleared", async (_n, color) => {
    showWith({ ...set, color }, false);
    edit();
    const kept = screen.getByRole("radio", { name: "Current color" });
    expect(kept).toBeChecked();
    expect(kept).toHaveFocus();
    expect(screen.queryByRole("radio", { name: "Custom" })).toBeNull();
    fireEvent.click(day("Tuesday"));
    save();
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(h.updates).toEqual([
      { color, section: "Section B", meet_days: [1, 2, 3, 5], start_minute: 605, end_minute: 660 },
    ]);
  });

  it("a stored color the form can not offer can still be changed on purpose", async () => {
    showWith({ ...set, color: "#2f6db5" }, false);
    edit();
    fireEvent.click(screen.getByRole("radio", { name: "Teal" }));
    save();
    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(h.updates[0]).toMatchObject({ color: "teal" });
  });

  it("the days are toggles, Monday to Sunday, with the course's days pressed", () => {
    show();
    edit();
    expect(screen.getByRole("group", { name: "Meets on" })).toBeInTheDocument();
    for (const [name, on] of [
      ["Monday", true],
      ["Tuesday", false],
      ["Wednesday", true],
      ["Thursday", false],
      ["Friday", true],
      ["Saturday", false],
      ["Sunday", false],
    ] as const) {
      expect(day(name), name).toHaveAttribute("aria-pressed", String(on));
    }
    fireEvent.click(day("Tuesday"));
    expect(day("Tuesday")).toHaveAttribute("aria-pressed", "true");
  });

  it("saves all five to the teacher's course, closes, says Saved and refreshes the page", async () => {
    show(empty);
    edit();
    fireEvent.click(screen.getByRole("radio", { name: "Plum" }));
    fireEvent.change(screen.getByLabelText(/Section/), { target: { value: "  001 " } });
    fireEvent.click(day("Thursday"));
    fireEvent.click(day("Tuesday"));
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "13:15" } });
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "14:35" } });
    save();
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(h.tables).toEqual(["courses"]);
    expect(h.updates).toEqual([
      { color: "plum", section: "001", meet_days: [2, 4], start_minute: 795, end_minute: 875 },
    ]);
    expect(h.eqs).toEqual([["id", "c1"]]);
    expect(screen.getByTestId("course-details")).toHaveTextContent("001 · Tue Thu · 1:15–2:35 PM");
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit details" })).toHaveFocus());
  });

  it("clearing everything saves empty values", async () => {
    show();
    edit();
    fireEvent.click(screen.getByRole("radio", { name: "No color" }));
    fireEvent.change(screen.getByLabelText(/Section/), { target: { value: "" } });
    for (const d of ["Monday", "Wednesday", "Friday"]) fireEvent.click(day(d));
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "" } });
    save();
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(h.updates).toEqual([{ color: null, section: null, meet_days: null, start_minute: null, end_minute: null }]);
    expect(screen.getByRole("button", { name: "Add color, section and time" })).toBeInTheDocument();
  });

  it.each([
    ["days without a time", { days: ["Monday"], start: "", end: "" }, "Add when class starts and ends."],
    ["a start without an end", { days: ["Monday"], start: "10:05", end: "" }, "Add when class starts and ends."],
    ["a time without days", { days: [], start: "10:05", end: "11:00" }, "Pick the days the class meets."],
    [
      "an end before the start",
      { days: ["Monday"], start: "11:00", end: "10:05" },
      "Class has to end after it starts.",
    ],
  ])("refuses %s, says what to fix and saves nothing", (_name, input, message) => {
    show(empty);
    edit();
    for (const d of input.days) fireEvent.click(day(d));
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: input.start } });
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: input.end } });
    save();
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(h.updates).toEqual([]);
  });

  it.each([
    ["days without a time: the start time", { days: ["Monday"], start: "", end: "" }, "start"],
    ["a start without an end: the end time", { days: ["Monday"], start: "10:05", end: "" }, "end"],
    ["an end before the start: the end time", { days: ["Monday"], start: "11:00", end: "10:05" }, "end"],
    ["a time without days: the days", { days: [], start: "10:05", end: "11:00" }, "days"],
  ])("points the message at the field it is about, %s", (_name, input, at) => {
    show(empty);
    edit();
    for (const d of input.days) fireEvent.click(day(d));
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: input.start } });
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: input.end } });
    save();
    const errorId = screen.getByRole("alert").id;
    const fields = {
      start: screen.getByLabelText("Starts"),
      end: screen.getByLabelText("Ends"),
      days: screen.getByRole("group", { name: "Meets on" }),
      section: screen.getByLabelText(/Section/),
    };
    for (const [name, el] of Object.entries(fields)) {
      const mine = name === at;
      expect(el.getAttribute("aria-describedby"), name).toBe(mine ? errorId : null);
      if (name !== "days") expect(el.getAttribute("aria-invalid"), name).toBe(mine ? "true" : null);
    }
  });

  it("Esc in a time field leaves the form open (it closes the browser's time picker); Esc elsewhere closes it", () => {
    show();
    edit();
    fireEvent.keyDown(screen.getByLabelText("Starts"), { key: "Escape" });
    fireEvent.keyDown(screen.getByLabelText("Ends"), { key: "Escape" });
    expect(screen.getByTestId("course-details-form")).toBeInTheDocument();
    fireEvent.keyDown(day("Monday"), { key: "Escape" });
    expect(screen.queryByTestId("course-details-form")).toBeNull();
  });

  it("a failed save keeps the form open with the teacher's choices", async () => {
    h.select.mockResolvedValue({ data: [], error: null });
    show();
    edit();
    fireEvent.click(screen.getByRole("radio", { name: "Blue" }));
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save. Try again.");
    expect(screen.getByRole("radio", { name: "Blue" })).toBeChecked();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("Cancel and Esc leave everything as it was and go back to the button", () => {
    show();
    edit();
    fireEvent.click(screen.getByRole("radio", { name: "Blue" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Edit details" })).toHaveFocus();
    edit();
    expect(screen.getByRole("radio", { name: "Teal" })).toBeChecked();
    fireEvent.keyDown(screen.getByLabelText(/Section/), { key: "Escape" });
    expect(screen.queryByTestId("course-details-form")).toBeNull();
    expect(h.updates).toEqual([]);
  });

  it("the section is at most 40 characters", () => {
    show();
    edit();
    expect(screen.getByLabelText(/Section/)).toHaveAttribute("maxLength", "40");
  });
});
