import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
});
