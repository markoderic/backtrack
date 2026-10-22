import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../lecture-actions", () => ({ deleteLecture: vi.fn() }));

import { PastLectures, type PastLecture } from "./PastLectures";

const lectures: PastLecture[] = Array.from({ length: 8 }, (_, i) => ({
  id: `l${8 - i}`,
  name: `Week ${8 - i}`,
  lectureDate: `2026-10-${String(21 - i).padStart(2, "0")}`,
  joined: 30,
  lostTaps: 10,
  mostLost: { number: 2, firstLine: "Accruals" },
}));

describe("PastLectures", () => {
  it("shows five, and N more brings in the rest with the keyboard on the first new one", async () => {
    render(<PastLectures lectures={lectures} />);
    expect(screen.getAllByRole("link")).toHaveLength(5);
    const more = screen.getByRole("button", { name: "3 more" });
    // A white button, not quiet text.
    expect(more.className).toContain("border-hairline");
    expect(more.className).toContain("h-11");
    more.focus();
    fireEvent.click(more);
    expect(screen.getAllByRole("link")).toHaveLength(8);
    expect(screen.queryByRole("button", { name: /more/ })).toBeNull();
    await waitFor(() => expect(screen.getByRole("link", { name: /Week 3/ })).toHaveFocus());
  });

  it("gives every shown row an always-visible ⋯ menu for that lecture, outside the row link", () => {
    render(<PastLectures lectures={lectures} />);
    const more = screen.getByRole("button", { name: "More for Week 8" });
    expect(more.closest("a")).toBeNull();
    expect(more.closest("li")?.querySelector("a")).toHaveAttribute("href", "/teach/l/l8");
    expect(screen.getAllByRole("button", { name: /^More for / })).toHaveLength(5);
    // Never hidden until hover (Marko: the Delete that spawned on hover).
    expect(more.className).not.toMatch(/opacity-0/);
    expect(more.className).toContain("size-11");
    fireEvent.click(more);
    const menu = screen.getByRole("menu");
    expect(menu).toHaveTextContent("Download CSV");
    expect(menu).toHaveTextContent("Delete");
    expect(menu).not.toHaveTextContent("Resume");
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Week 8");
  });
});
