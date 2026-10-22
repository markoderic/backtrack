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

import { RenameForm } from "./RenameForm";

const field = () => screen.getByLabelText("Lecture name") as HTMLInputElement;
const save = () => screen.getByRole("button", { name: "Rename" });
const type = (v: string) => fireEvent.change(field(), { target: { value: v } });

beforeEach(() => {
  h.updates.length = 0;
  h.eqs.length = 0;
  h.tables.length = 0;
  h.refresh.mockReset();
  h.select.mockReset().mockResolvedValue({ data: [{ id: "l1" }], error: null });
});

describe("RenameForm", () => {
  it("starts with the current name and nothing to save", () => {
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    expect(field().value).toBe("Lecture 1, Oct 19");
    expect(save()).toBeDisabled();
  });

  it("updates lectures.name for this lecture with the trimmed name, then refreshes the page", async () => {
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    type("  Accruals day  ");
    fireEvent.click(save());
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(h.tables).toEqual(["lectures"]);
    expect(h.updates).toEqual([{ name: "Accruals day" }]);
    expect(h.eqs).toEqual([["id", "l1"]]);
    expect(screen.getByRole("status")).toHaveTextContent("Renamed.");
    expect(field().value).toBe("Accruals day");
  });

  it("does not save an empty or blank name and says why", () => {
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    type("   ");
    fireEvent.submit(field().closest("form")!);
    expect(h.updates).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent("The name must be 1 to 120 characters.");
  });

  it("does not save a name over 120 characters", () => {
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    type("x".repeat(121));
    fireEvent.submit(field().closest("form")!);
    expect(h.updates).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent("The name must be 1 to 120 characters.");
  });

  it("accepts exactly 120 characters", async () => {
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    type("x".repeat(120));
    fireEvent.click(save());
    await waitFor(() => expect(h.updates).toEqual([{ name: "x".repeat(120) }]));
  });

  it("limits the field to 120 characters", () => {
    render(<RenameForm lectureId="l1" initialName="a" />);
    expect(field()).toHaveAttribute("maxlength", "120");
  });

  it("shows a plain error when the update fails and does not refresh", async () => {
    h.select.mockResolvedValue({ data: null, error: { message: "boom" } });
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    type("New");
    fireEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not rename the lecture.");
    expect(h.refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("treats an update that changed no row as a failure", async () => {
    h.select.mockResolvedValue({ data: [], error: null });
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    type("New");
    fireEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not rename the lecture.");
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("shows a plain error when the request itself throws", async () => {
    h.select.mockRejectedValue(new Error("offline"));
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    type("New");
    fireEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not rename the lecture.");
    expect(save()).not.toBeDisabled();
  });

  it("disables the button while saving so a double click sends one update", async () => {
    let finish!: (v: unknown) => void;
    h.select.mockReturnValue(new Promise((r) => (finish = r)));
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    type("New");
    fireEvent.click(save());
    expect(save()).toBeDisabled();
    fireEvent.click(save());
    finish({ data: [{ id: "l1" }], error: null });
    await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
    expect(h.updates).toHaveLength(1);
  });

  it("clears an old error or confirmation when the name is edited again", async () => {
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    type("New");
    fireEvent.click(save());
    await screen.findByRole("status");
    type("Newer");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
