import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { StudentAccess } from "@/lib/slideAccess";

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

import { SlideAccess } from "./SlideAccess";

const trigger = () => screen.getByRole("button", { name: /^Students can see slides until/ });
const list = () => screen.queryByRole("listbox", { name: "Students can see slides until" });
const option = (name: RegExp | string) => within(list()!).getByRole("option", { name });
const date = () => screen.queryByLabelText("Last day of the semester") as HTMLInputElement | null;
const save = () => screen.getByRole("button", { name: "Save" });

/** Opens the popup with a click and picks a choice with a click. */
const choose = (name: RegExp | string) => {
  fireEvent.click(trigger());
  fireEvent.click(option(name));
};

beforeEach(() => {
  h.select.mockReset().mockResolvedValue({ data: [{ id: "c1" }], error: null });
  h.refresh.mockReset();
  h.updates.length = 0;
  h.eqs.length = 0;
  h.tables.length = 0;
});

const show = (
  access: StudentAccess = "semester",
  semesterEnd: string | null = null,
  more: { options?: boolean; accessDays?: number | null; accessUntil?: string | null } = {},
) =>
  render(
    <SlideAccess
      courseId="c1"
      access={access}
      semesterEnd={semesterEnd}
      today="2026-10-22"
      options={more.options ?? false}
      accessDays={more.accessDays ?? null}
      accessUntil={more.accessUntil ?? null}
    />,
  );

describe("SlideAccess: the popup", () => {
  it("is a button of the app's own (no native select) that names the setting and the choice", () => {
    show();
    expect(document.querySelector("select")).toBeNull();
    expect(trigger()).toHaveAccessibleName("Students can see slides until End of semester");
    expect(trigger()).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(list()).toBeNull();
  });

  it("the chevron sits inside the button's own padding, never on its edge", () => {
    show();
    expect(trigger().className).toContain("pr-3");
    expect(trigger().className).toContain("justify-between");
    expect(trigger().querySelector('[data-icon="forward"]')).not.toBeNull();
  });

  it("after 0019: End of semester with its date, 30 days, A week, Always and Custom", () => {
    show("semester", null, { options: true });
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    const options = within(list()!).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "End of semesterDec 18",
      "30 days after each class",
      "A week after each class",
      "Always",
      "CustomA date, or a number of days after each class",
    ]);
    expect(option(/End of semester/)).toHaveAttribute("aria-selected", "true");
    expect(option(/End of semester/)).toHaveFocus();
  });

  it("before 0019: only the three choices the database takes", () => {
    show("semester", "2026-12-11");
    fireEvent.click(trigger());
    expect(within(list()!).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "End of semesterDec 11",
      "30 days after each class",
      "Always",
    ]);
  });

  it("keyboard: ↓ opens it on the current choice, ↓ ↑ Home End move, Enter picks and goes back to the button", () => {
    show("30d", null, { options: true });
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    expect(option("30 days after each class")).toHaveFocus();
    fireEvent.keyDown(list()!, { key: "ArrowDown" });
    expect(option("A week after each class")).toHaveFocus();
    fireEvent.keyDown(list()!, { key: "End" });
    expect(option(/Custom/)).toHaveFocus();
    fireEvent.keyDown(list()!, { key: "Home" });
    expect(option(/End of semester/)).toHaveFocus();
    fireEvent.keyDown(list()!, { key: "ArrowUp" });
    expect(option(/Custom/)).toHaveFocus();
    fireEvent.keyDown(list()!, { key: "ArrowUp" });
    fireEvent.keyDown(list()!, { key: "ArrowUp" });
    expect(option("A week after each class")).toHaveFocus();
    fireEvent.keyDown(list()!, { key: "Enter" });
    expect(list()).toBeNull();
    expect(trigger()).toHaveFocus();
    expect(trigger()).toHaveAccessibleName("Students can see slides until A week after each class");
    expect(save()).toBeEnabled();
  });

  it("Esc closes it without changing anything, back on the button; a press outside closes it too", () => {
    show("always", null, { options: true });
    fireEvent.click(trigger());
    fireEvent.keyDown(list()!, { key: "ArrowDown" });
    fireEvent.keyDown(list()!, { key: "Escape" });
    expect(list()).toBeNull();
    expect(trigger()).toHaveFocus();
    expect(trigger()).toHaveAccessibleName("Students can see slides until Always");
    fireEvent.click(trigger());
    fireEvent.mouseDown(document.body);
    expect(list()).toBeNull();
    expect(save()).toBeDisabled();
  });
});

describe("SlideAccess: saving", () => {
  it("shows End of semester with the usual date (Dec 18 in the fall) when the course has none", () => {
    show();
    expect(date()!.value).toBe("2026-12-18");
    expect(save()).toBeDisabled();
  });

  it("shows the course's own date", () => {
    show("semester", "2026-12-11");
    expect(date()!.value).toBe("2026-12-11");
  });

  it("the date field is only there for End of semester", () => {
    show("30d");
    expect(date()).toBeNull();
    choose(/End of semester/);
    expect(date()).not.toBeNull();
  });

  it("before 0019: saves a new choice with only the two old columns and says Saved.", async () => {
    show();
    choose("Always");
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved."));
    expect(h.tables).toEqual(["courses"]);
    expect(h.updates).toEqual([{ student_access: "always", semester_end: null }]);
    expect(h.eqs).toEqual([["id", "c1"]]);
    expect(h.refresh).toHaveBeenCalled();
    expect(save()).toBeDisabled();
  });

  it("saves a date the teacher picked, and stores none for the usual date", async () => {
    show("30d");
    choose(/End of semester/);
    fireEvent.click(save());
    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(h.updates[0]).toEqual({ student_access: "semester", semester_end: null });
    await waitFor(() => expect(save()).toBeDisabled());
    fireEvent.change(date()!, { target: { value: "2026-12-11" } });
    fireEvent.click(save());
    await waitFor(() => expect(h.updates).toHaveLength(2));
    expect(h.updates[1]).toEqual({ student_access: "semester", semester_end: "2026-12-11" });
  });

  it("refuses a day before today or an empty date without saving", async () => {
    show();
    fireEvent.change(date()!, { target: { value: "2026-10-01" } });
    fireEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Pick a day from today on.");
    expect(date()).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(date()!, { target: { value: "" } });
    fireEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Pick the last day of the semester.");
    expect(h.updates).toEqual([]);
  });

  it("says so when the row was not changed (no row back)", async () => {
    h.select.mockResolvedValue({ data: [], error: null });
    show();
    choose("30 days after each class");
    fireEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save. Try again.");
    expect(save()).toBeEnabled();
  });

  it("after 0019: A week saves '7d' and clears the custom columns", async () => {
    show("semester", null, { options: true });
    choose("A week after each class");
    fireEvent.click(save());
    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(h.updates[0]).toEqual({ student_access: "7d", semester_end: null, access_days: null, access_until: null });
  });

  it("after 0019: Custom offers a date or a number of days; days are saved as custom_days", async () => {
    show("semester", "2026-12-11", { options: true });
    choose(/Custom/);
    const custom = screen.getByRole("group", { name: "Custom" });
    expect(within(custom).getByRole("radio", { name: "A number of days after each class" })).toBeChecked();
    const days = screen.getByRole("spinbutton", { name: "Days after each class" });
    expect(days).toHaveValue(14);
    fireEvent.change(days, { target: { value: "21" } });
    fireEvent.click(save());
    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(h.updates[0]).toEqual({ student_access: "custom_days", semester_end: null, access_days: 21, access_until: null });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved."));
    expect(trigger()).toHaveAccessibleName("Students can see slides until Custom");
  });

  it("after 0019: Custom with a date saves custom_date and the day", async () => {
    show("30d", null, { options: true });
    choose(/Custom/);
    fireEvent.click(screen.getByRole("radio", { name: "Until a date" }));
    expect(screen.queryByRole("spinbutton")).toBeNull();
    fireEvent.change(screen.getByLabelText("Last day students can see the slides"), { target: { value: "2027-03-03" } });
    fireEvent.click(save());
    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(h.updates[0]).toEqual({
      student_access: "custom_date",
      semester_end: null,
      access_days: null,
      access_until: "2027-03-03",
    });
  });

  it.each([
    ["0", "Type a number of days from 1 to 365."],
    ["366", "Type a number of days from 1 to 365."],
    ["", "Type a number of days from 1 to 365."],
    ["2.5", "Type a number of days from 1 to 365."],
  ])("after 0019: refuses %j days without saving", (value, message) => {
    show("always", null, { options: true });
    choose(/Custom/);
    const days = screen.getByRole("spinbutton", { name: "Days after each class" });
    fireEvent.change(days, { target: { value } });
    fireEvent.click(save());
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(days).toHaveAttribute("aria-invalid", "true");
    expect(h.updates).toEqual([]);
  });

  it("after 0019: refuses a custom date that is empty or before today", () => {
    show("always", null, { options: true });
    choose(/Custom/);
    fireEvent.click(screen.getByRole("radio", { name: "Until a date" }));
    fireEvent.click(save());
    expect(screen.getByRole("alert")).toHaveTextContent("Pick the last day students can see the slides.");
    fireEvent.change(screen.getByLabelText("Last day students can see the slides"), { target: { value: "2026-10-01" } });
    fireEvent.click(save());
    expect(screen.getByRole("alert")).toHaveTextContent("Pick a day from today on.");
    expect(h.updates).toEqual([]);
  });

  it("after 0019: a course on custom days opens on Custom with its days, and nothing to save yet", () => {
    show("custom_days", null, { options: true, accessDays: 10 });
    expect(trigger()).toHaveAccessibleName("Students can see slides until Custom");
    expect(screen.getByRole("spinbutton", { name: "Days after each class" })).toHaveValue(10);
    expect(save()).toBeDisabled();
  });

  it("after 0019: a course on a custom date opens on Custom with its date", () => {
    show("custom_date", null, { options: true, accessUntil: "2027-03-03" });
    expect(screen.getByRole("radio", { name: "Until a date" })).toBeChecked();
    expect(screen.getByLabelText("Last day students can see the slides")).toHaveValue("2027-03-03");
    expect(save()).toBeDisabled();
  });
});

describe("SlideAccess: batch H fix round 1", () => {
  it.each([
    ["custom_days", "Custom"],
    ["custom_date", "Custom"],
    ["7d", "A week after each class"],
  ] as const)("a stored %s the page can not offer (columns not read) still shows its own name, not the first choice", (access, label) => {
    show(access);
    expect(trigger()).toHaveAccessibleName(`Students can see slides until ${label}`);
    // No made-up custom values, and nothing to save.
    expect(screen.queryByRole("group", { name: "Custom" })).toBeNull();
    expect(save()).toBeDisabled();
  });

  it("a custom date that has passed says so next to the button", () => {
    show("custom_date", null, { options: true, accessUntil: "2026-10-20" });
    expect(screen.getByTestId("access-ended")).toHaveTextContent("Ended Oct 20. Students can’t see slides after class.");
  });

  it("no such line for a date still ahead, for other choices, or once another date is typed", () => {
    show("custom_date", null, { options: true, accessUntil: "2026-10-22" });
    expect(screen.queryByTestId("access-ended")).toBeNull();
    cleanup();
    show("custom_date", null, { options: true, accessUntil: "2026-10-20" });
    fireEvent.change(screen.getByLabelText("Last day students can see the slides"), { target: { value: "2026-12-01" } });
    expect(screen.queryByTestId("access-ended")).toBeNull();
    cleanup();
    show("semester", "2026-10-20");
    expect(screen.queryByTestId("access-ended")).toBeNull();
  });

  it("each option is named by its label, with the date or hint as its description", () => {
    show("semester", null, { options: true });
    fireEvent.click(trigger());
    const semester = within(list()!).getAllByRole("option")[0];
    expect(semester).toHaveAccessibleName("End of semester");
    expect(semester).toHaveAccessibleDescription("Dec 18");
    expect(within(list()!).getAllByRole("option")[4]).toHaveAccessibleDescription("A date, or a number of days after each class");
  });
});

