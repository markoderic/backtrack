import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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

import { CourseGrid, type GridCourse } from "./CourseGrid";

const ims: GridCourse = { id: "c1", name: "IMS 452 Senior Design", details: null, meta: "No lectures yet", liveLectureId: null };
const acc: GridCourse = { id: "c2", name: "ACC 221", details: null, meta: "No lectures yet", liveLectureId: null };

const archive = (code: string) => {
  fireEvent.click(screen.getByRole("button", { name: `More for ${code}` }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
};
const cards = () => screen.getAllByTestId("course-card").map((c) => c.querySelector("h2")!.textContent);

beforeEach(() => {
  h.select.mockReset().mockResolvedValue({ data: [{ id: "c1" }], error: null });
  h.refresh.mockReset();
  h.updates.length = 0;
  h.eqs.length = 0;
});

describe("CourseGrid: Archive from a card's ⋯", () => {
  it("archives the course, hides its card at once, says so with Undo and puts the keyboard on Undo", async () => {
    render(<CourseGrid courses={[ims, acc]} options />);
    archive("IMS 452");
    await waitFor(() => expect(cards()).toEqual(["ACC 221"]));
    expect(h.updates).toEqual([{ archived: true }]);
    expect(h.eqs).toEqual([["id", "c1"]]);
    expect(screen.getByRole("status")).toHaveTextContent("Archived IMS 452.");
    expect(screen.getByRole("button", { name: "Undo, unarchive IMS 452" })).toHaveFocus();
    expect(h.refresh).toHaveBeenCalled();
  });

  it("Undo brings the card back (even once the server list has dropped it) with the keyboard on its ⋯", async () => {
    const { rerender } = render(<CourseGrid courses={[ims, acc]} options />);
    archive("IMS 452");
    await waitFor(() => expect(cards()).toEqual(["ACC 221"]));
    // The refresh came back without the archived course.
    rerender(<CourseGrid courses={[acc]} options />);
    fireEvent.click(screen.getByRole("button", { name: "Undo, unarchive IMS 452" }));
    await waitFor(() => expect(cards()).toEqual(["ACC 221", "IMS 452"]));
    expect(h.updates).toEqual([{ archived: true }, { archived: false }]);
    expect(screen.getByRole("status")).toHaveTextContent("Unarchived IMS 452.");
    expect(screen.getByRole("button", { name: "More for IMS 452" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: /^Undo/ })).toBeNull();
    // And once the server list has it again, it shows once.
    rerender(<CourseGrid courses={[ims, acc]} options />);
    expect(cards()).toEqual(["IMS 452", "ACC 221"]);
  });

  it("a failed archive keeps the card and says so", async () => {
    h.select.mockResolvedValue({ data: [], error: null });
    render(<CourseGrid courses={[ims, acc]} options />);
    archive("IMS 452");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not archive IMS 452.");
    expect(cards()).toEqual(["IMS 452", "ACC 221"]);
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("Rename and Edit details report through the same status line", async () => {
    render(<CourseGrid courses={[ims]} options />);
    fireEvent.click(screen.getByRole("button", { name: "More for IMS 452" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("Course name"), { target: { value: "IMS 452 Capstone" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Renamed to IMS 452 Capstone."));
  });
});
