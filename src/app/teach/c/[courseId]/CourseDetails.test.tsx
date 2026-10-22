import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

  it("the form has the eight colors and No color as named round chips, the chosen one checked and focused", () => {
    show();
    edit();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.closest("label")!.textContent)).toEqual([
      "No color",
      "Slate",
      "Blue",
      "Indigo",
      "Plum",
      "Teal",
      "Green",
      "Olive",
      "Ochre",
    ]);
    expect(screen.getByRole("radio", { name: "Teal" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Teal" })).toHaveFocus();
    expect(screen.getByRole("group", { name: "Color" })).toBeInTheDocument();
    const chip = document.querySelector('[data-swatch="teal"]')!;
    expect(chip.className).toContain("size-6");
    expect(chip.className).toContain("rounded-full");
    expect(chip.className).toContain("bg-course-teal");
    // No red swatch.
    expect(document.querySelector('[data-swatch="red"], .bg-lost')).toBeNull();
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
    expect(screen.getByRole("button", { name: "Edit details" })).toHaveFocus();
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
