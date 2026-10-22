import { describe, it, expect, vi, beforeEach } from "vitest";
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

import { RenameForm } from "./RenameForm";

const field = () => screen.getByLabelText("Lecture name") as HTMLInputElement;
const type = (v: string) => fireEvent.change(field(), { target: { value: v } });
const enter = () => fireEvent.submit(field().closest("form")!);
const status = () => screen.getByRole("status");

beforeEach(() => {
  h.updates.length = 0;
  h.eqs.length = 0;
  h.tables.length = 0;
  h.refresh.mockReset();
  h.select.mockReset().mockResolvedValue({ data: [{ id: "l1" }], error: null });
});

describe("RenameForm (the lecture name, always a field)", () => {
  it("is a field from the start, in the h1, with the current name: no pencil or Rename to press first", () => {
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    expect(field().value).toBe("Lecture 1, Oct 19");
    expect(field().closest("h1")).not.toBeNull();
    // The heading reads as the lecture's name.
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Lecture 1, Oct 19");
    expect(screen.queryByRole("button")).toBeNull();
    // Styled like the heading (Lecture L), with no border until pointed at or focused.
    expect(field().className).toContain("type-lecture-l");
    expect(field().className).toContain("border-transparent");
    expect(field().className).toContain("focus:border-ink");
  });

  it("Enter saves the trimmed name for this lecture, says Renamed. quietly and refreshes the page", async () => {
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    type("  Accruals day  ");
    enter();
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(h.tables).toEqual(["lectures"]);
    expect(h.updates).toEqual([{ name: "Accruals day" }]);
    expect(h.eqs).toEqual([["id", "l1"]]);
    expect(status()).toHaveTextContent("Renamed.");
    expect(field().value).toBe("Accruals day");
  });

  it("leaving the field saves too", async () => {
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    type("Accruals day");
    fireEvent.blur(field());
    await waitFor(() => expect(h.updates).toEqual([{ name: "Accruals day" }]));
    expect(await screen.findByText("Renamed.")).toBeInTheDocument();
  });

  it("Renamed. goes away after a few seconds", async () => {
    vi.useFakeTimers();
    try {
      render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
      type("New");
      enter();
      await act(async () => {});
      expect(status()).toHaveTextContent("Renamed.");
      await act(async () => vi.advanceTimersByTime(4000));
      expect(status()).toHaveTextContent("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves nothing when the name did not change (also with spaces around it), on Enter or on leaving", () => {
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    enter();
    fireEvent.blur(field());
    type("  Lecture 1, Oct 19 ");
    fireEvent.blur(field());
    expect(h.updates).toEqual([]);
    expect(field().value).toBe("Lecture 1, Oct 19");
  });

  it("Esc puts the saved name back and saves nothing", () => {
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    field().focus();
    type("Something else");
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(field().value).toBe("Lecture 1, Oct 19");
    fireEvent.blur(field());
    expect(h.updates).toEqual([]);
  });

  it("does not save an empty or blank name and says why", () => {
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    type("   ");
    enter();
    fireEvent.blur(field());
    expect(h.updates).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent("The name must be 1 to 120 characters.");
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAccessibleDescription("The name must be 1 to 120 characters.");
  });

  it("does not save a name over 120 characters", () => {
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    type("x".repeat(121));
    enter();
    expect(h.updates).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent("The name must be 1 to 120 characters.");
  });

  it("accepts exactly 120 characters", async () => {
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    type("x".repeat(120));
    enter();
    await waitFor(() => expect(h.updates).toEqual([{ name: "x".repeat(120) }]));
  });

  it("limits the field to 120 characters", () => {
    render(<RenameForm lectureId="l1" initialName="a" />);
    expect(field()).toHaveAttribute("maxlength", "120");
  });

  it("shows a plain error when the update fails, keeps what was typed and does not refresh", async () => {
    h.select.mockResolvedValue({ data: null, error: { message: "boom" } });
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    type("New");
    enter();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not rename the lecture.");
    expect(h.refresh).not.toHaveBeenCalled();
    expect(status()).toHaveTextContent("");
    expect(field().value).toBe("New");
  });

  it("treats an update that changed no row as a failure", async () => {
    h.select.mockResolvedValue({ data: [], error: null });
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    type("New");
    enter();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not rename the lecture.");
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("shows a plain error when the request itself throws, and can try again", async () => {
    h.select.mockRejectedValueOnce(new Error("offline"));
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    type("New");
    enter();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not rename the lecture.");
    enter();
    await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
    expect(h.updates).toHaveLength(2);
  });

  it("Enter and then leaving the field while it saves sends one update", async () => {
    let finish!: (v: unknown) => void;
    h.select.mockReturnValue(new Promise((r) => (finish = r)));
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    type("New");
    enter();
    fireEvent.blur(field());
    enter();
    finish({ data: [{ id: "l1" }], error: null });
    await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
    expect(h.updates).toHaveLength(1);
  });

  it("clears an old error or Renamed. as soon as the name is typed again", async () => {
    render(<RenameForm lectureId="l1" initialName="Lecture 1, Oct 19" />);
    type("New");
    enter();
    await waitFor(() => expect(status()).toHaveTextContent("Renamed."));
    type("Newer");
    expect(status()).toHaveTextContent("");
    type("");
    enter();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    type("Fixed");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("takes a new name from the server when nothing is typed, and keeps what is being typed otherwise", () => {
    const view = render(<RenameForm lectureId="l1" initialName="Old" />);
    view.rerender(<RenameForm lectureId="l1" initialName="From server" />);
    expect(field().value).toBe("From server");
    type("Typing");
    view.rerender(<RenameForm lectureId="l1" initialName="Again" />);
    expect(field().value).toBe("Typing");
  });
});
