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

import { CourseRow } from "./CourseRow";
import { hitAreaClass } from "../ui";

const NAME = "ACC 221 Intro to Financial Accounting";
const renameLink = () => screen.getByRole("button", { name: `Rename ${NAME}` });
const field = () => screen.getByLabelText(`New name for ${NAME}`) as HTMLInputElement;
const save = () => screen.getByRole("button", { name: "Rename" });
const type = (v: string) => fireEvent.change(field(), { target: { value: v } });

beforeEach(() => {
  h.updates.length = 0;
  h.eqs.length = 0;
  h.tables.length = 0;
  h.refresh.mockReset();
  h.select.mockReset().mockResolvedValue({ data: [{ id: "c1" }], error: null });
});

describe("CourseRow", () => {
  it("shows the course name and a Rename text action with a 44 px hit area, and no Archive", () => {
    render(<CourseRow courseId="c1" initialName={NAME} />);
    expect(screen.getByText(NAME)).toBeInTheDocument();
    expect(renameLink().className).toContain(hitAreaClass);
    expect(screen.queryByText(/archive/i)).toBeNull();
    expect(screen.queryByText(/delete/i)).toBeNull();
  });

  it("renames the course with the trimmed name, then refreshes the page", async () => {
    render(<CourseRow courseId="c1" initialName={NAME} />);
    fireEvent.click(renameLink());
    expect(field().value).toBe(NAME);
    expect(save()).toBeDisabled();
    type("  ACC 221 Financial Accounting  ");
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Renamed."));
    expect(h.tables).toEqual(["courses"]);
    expect(h.updates).toEqual([{ name: "ACC 221 Financial Accounting" }]);
    expect(h.eqs).toEqual([["id", "c1"]]);
    expect(h.refresh).toHaveBeenCalled();
    expect(screen.getByText("ACC 221 Financial Accounting")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename ACC 221 Financial Accounting" }));
  });

  it("says so when the rename fails, and keeps the field open", async () => {
    h.select.mockResolvedValue({ data: null, error: { message: "boom" } });
    render(<CourseRow courseId="c1" initialName={NAME} />);
    fireEvent.click(renameLink());
    type("ACC 999");
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not rename the course."));
    expect(field().value).toBe("ACC 999");
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("treats an update that matched no row (not their course) as a failure", async () => {
    h.select.mockResolvedValue({ data: [], error: null });
    render(<CourseRow courseId="c1" initialName={NAME} />);
    fireEvent.click(renameLink());
    type("ACC 999");
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not rename the course."));
  });

  it("refuses a blank name without calling the database", async () => {
    render(<CourseRow courseId="c1" initialName={NAME} />);
    fireEvent.click(renameLink());
    type("   ");
    fireEvent.submit(field().closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("The course name must be 1 to 120 characters.");
    expect(h.updates).toEqual([]);
  });

  it("Esc and Cancel leave the name as it was and return focus to Rename", () => {
    render(<CourseRow courseId="c1" initialName={NAME} />);
    fireEvent.click(renameLink());
    type("Something else");
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(screen.getByText(NAME)).toBeInTheDocument();
    expect(document.activeElement).toBe(renameLink());
    fireEvent.click(renameLink());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(NAME)).toBeInTheDocument();
    expect(h.updates).toEqual([]);
  });
});
