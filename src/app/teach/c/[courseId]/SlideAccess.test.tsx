import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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

const choice = () => screen.getByLabelText("Students can see slides until") as HTMLSelectElement;
const date = () => screen.queryByLabelText("Last day of the semester") as HTMLInputElement | null;
const save = () => screen.getByRole("button", { name: "Save" });

beforeEach(() => {
  h.select.mockReset().mockResolvedValue({ data: [{ id: "c1" }], error: null });
  h.refresh.mockReset();
  h.updates.length = 0;
  h.eqs.length = 0;
  h.tables.length = 0;
});

const show = (access: "semester" | "30d" | "always" = "semester", semesterEnd: string | null = null) =>
  render(<SlideAccess courseId="c1" access={access} semesterEnd={semesterEnd} today="2026-10-22" />);

describe("SlideAccess", () => {
  it("shows End of semester with the usual date (Dec 18 in the fall) when the course has none", () => {
    show();
    expect(choice().value).toBe("semester");
    expect(date()!.value).toBe("2026-12-18");
    expect(save()).toBeDisabled();
  });

  it("shows the course's own date", () => {
    show("semester", "2026-12-11");
    expect(date()!.value).toBe("2026-12-11");
  });

  it("the date field is only there for End of semester", () => {
    show("30d");
    expect(choice().value).toBe("30d");
    expect(date()).toBeNull();
    fireEvent.change(choice(), { target: { value: "semester" } });
    expect(date()).not.toBeNull();
  });

  it("saves a new choice on its own course and says Saved.", async () => {
    show();
    fireEvent.change(choice(), { target: { value: "always" } });
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
    fireEvent.change(choice(), { target: { value: "semester" } });
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
    fireEvent.change(date()!, { target: { value: "" } });
    fireEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Pick the last day of the semester.");
    expect(h.updates).toEqual([]);
  });

  it("says so when the row was not changed (no row back)", async () => {
    h.select.mockResolvedValue({ data: [], error: null });
    show();
    fireEvent.change(choice(), { target: { value: "30d" } });
    fireEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save. Try again.");
    expect(save()).toBeEnabled();
  });
});
