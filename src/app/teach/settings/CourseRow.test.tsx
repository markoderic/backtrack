import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

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
import { STATUS_MS } from "./NameForm";

const NAME = "ACC 221 Intro to Financial Accounting";
const renameLink = () => screen.getByRole("button", { name: `Rename ${NAME}` });
const field = () => screen.getByLabelText(`New name for ${NAME}`) as HTMLInputElement;
const save = () => screen.getByRole("button", { name: "Rename" });
const type = (v: string) => fireEvent.change(field(), { target: { value: v } });

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  h.updates.length = 0;
  h.eqs.length = 0;
  h.tables.length = 0;
  h.refresh.mockReset();
  h.select.mockReset().mockResolvedValue({ data: [{ id: "c1" }], error: null });
});

describe("CourseRow", () => {
  it("shows Archive only when the list gives it, with a 44 px hit area, and shows the list's note", async () => {
    const onArchive = vi.fn().mockResolvedValue(true);
    render(<CourseRow courseId="c1" initialName={NAME} onArchive={onArchive} note="Unarchived." />);
    const archive = screen.getByRole("button", { name: `Archive ${NAME}` });
    // A white button (44 px tall on its own), not underlined text.
    expect(archive.className).toContain("h-11");
    expect(archive.className).toContain("border-hairline");
    expect(archive.className).not.toContain("underline");
    expect(screen.getByText("Unarchived.")).toHaveAttribute("aria-hidden");
    fireEvent.click(archive);
    await waitFor(() => expect(onArchive).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says so when Archive fails, and stays put", async () => {
    render(<CourseRow courseId="c1" initialName={NAME} onArchive={vi.fn().mockResolvedValue(false)} />);
    fireEvent.click(screen.getByRole("button", { name: `Archive ${NAME}` }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not archive the course.");
    expect(screen.getByRole("button", { name: `Archive ${NAME}` })).not.toBeDisabled();
  });

  it("shows the course name and a white Rename button, and no Archive without the list", () => {
    render(<CourseRow courseId="c1" initialName={NAME} />);
    expect(screen.getByText(NAME)).toBeInTheDocument();
    expect(renameLink().className).toContain("h-11");
    expect(renameLink().className).toContain("border-hairline");
    expect(renameLink().className).not.toContain("underline");
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
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Renamed to ACC 221 Financial Accounting."));
    expect(screen.getByText("Renamed.")).toHaveAttribute("aria-hidden");
    expect(h.tables).toEqual(["courses"]);
    expect(h.updates).toEqual([{ name: "ACC 221 Financial Accounting" }]);
    expect(h.eqs).toEqual([["id", "c1"]]);
    expect(h.refresh).toHaveBeenCalled();
    expect(screen.getByText("ACC 221 Financial Accounting")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename ACC 221 Financial Accounting" }));
  });

  it("keeps one status line mounted while the row turns into the field and back, so the rename is announced", async () => {
    render(<CourseRow courseId="c1" initialName={NAME} />);
    const before = screen.getByRole("status");
    fireEvent.click(renameLink());
    expect(screen.getByRole("status")).toBe(before);
    type("ACC 999");
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Renamed to ACC 999."));
    expect(screen.getByRole("status")).toBe(before);
  });

  it("clears Renamed. after a few seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<CourseRow courseId="c1" initialName={NAME} />);
    fireEvent.click(renameLink());
    type("ACC 999");
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Renamed to ACC 999."));
    // The effect that starts the clear timer can run after the text shows; let it run first.
    await act(async () => {});
    act(() => {
      vi.advanceTimersByTime(STATUS_MS);
    });
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.queryByText("Renamed.")).toBeNull();
  });

  it("says so when the rename fails, and keeps the field open", async () => {
    h.select.mockResolvedValue({ data: null, error: { message: "boom" } });
    render(<CourseRow courseId="c1" initialName={NAME} />);
    fireEvent.click(renameLink());
    type("ACC 999");
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not rename the course."));
    expect(field().value).toBe("ACC 999");
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAttribute("aria-describedby", screen.getByRole("alert").id);
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
