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
    // A 44 px hit area that reaches down only (20 px text + 24 px), so it never covers the last row above.
    expect(more.className).toContain("after:top-0 after:-bottom-6");
    expect(more.className).not.toContain("after:-top-");
    more.focus();
    fireEvent.click(more);
    expect(screen.getAllByRole("link")).toHaveLength(8);
    expect(screen.queryByRole("button", { name: /more/ })).toBeNull();
    await waitFor(() => expect(screen.getByRole("link", { name: /Week 3/ })).toHaveFocus());
  });

  it("gives each shown row a quiet Delete for that lecture, outside the row link", () => {
    render(<PastLectures lectures={lectures} />);
    const del = screen.getByRole("button", { name: "Delete Week 8" });
    expect(del.closest("a")).toBeNull();
    expect(del.closest("li")?.querySelector("a")).toHaveAttribute("href", "/teach/l/l8");
    expect(screen.getAllByRole("button", { name: /^Delete / })).toHaveLength(5);
    fireEvent.click(del);
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Week 8");
  });
});
