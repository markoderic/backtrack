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

import { NameForm } from "./NameForm";

const field = () => screen.getByLabelText("Your name, as students see it") as HTMLInputElement;
const save = () => screen.getByRole("button", { name: "Save" });
const type = (v: string) => fireEvent.change(field(), { target: { value: v } });

beforeEach(() => {
  h.updates.length = 0;
  h.eqs.length = 0;
  h.tables.length = 0;
  h.refresh.mockReset();
  h.select.mockReset().mockResolvedValue({ data: [{ id: "t1" }], error: null });
});

describe("NameForm", () => {
  it("shows the saved name in a 480 wide field, with nothing to save", () => {
    render(<NameForm teacherId="t1" initialName="Linda Carter" />);
    expect(field().value).toBe("Linda Carter");
    expect(field().className).toContain("w-120");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("saves the trimmed name to the teacher's own row, then refreshes the page", async () => {
    render(<NameForm teacherId="t1" initialName="Linda Carter" />);
    type("  Dr. Linda Carter  ");
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved."));
    expect(h.tables).toEqual(["teachers"]);
    expect(h.updates).toEqual([{ display_name: "Dr. Linda Carter" }]);
    expect(h.eqs).toEqual([["id", "t1"]]);
    expect(h.refresh).toHaveBeenCalled();
    expect(field().value).toBe("Dr. Linda Carter");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("saves on Enter", async () => {
    render(<NameForm teacherId="t1" initialName="Linda Carter" />);
    type("Linda C.");
    fireEvent.submit(field().closest("form")!);
    await waitFor(() => expect(h.updates).toEqual([{ display_name: "Linda C." }]));
  });

  it("says so when the save fails, and keeps what was typed", async () => {
    h.select.mockResolvedValue({ data: null, error: { message: "boom" } });
    render(<NameForm teacherId="t1" initialName="Linda Carter" />);
    type("Linda C.");
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not save your name."));
    expect(field().value).toBe("Linda C.");
    expect(h.refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("treats an update that matched no row as a failure", async () => {
    h.select.mockResolvedValue({ data: [], error: null });
    render(<NameForm teacherId="t1" initialName="Linda Carter" />);
    type("Linda C.");
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not save your name."));
  });

  it("never saves a blank name", () => {
    render(<NameForm teacherId="t1" initialName="Linda Carter" />);
    type("   ");
    expect(save()).toBeDisabled();
    fireEvent.submit(field().closest("form")!);
    expect(h.updates).toEqual([]);
  });

  it("Esc and Cancel put the saved name back without saving", () => {
    render(<NameForm teacherId="t1" initialName="Linda Carter" />);
    type("Someone else");
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(field().value).toBe("Linda Carter");
    type("Someone else");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(field().value).toBe("Linda Carter");
    expect(h.updates).toEqual([]);
  });
});
