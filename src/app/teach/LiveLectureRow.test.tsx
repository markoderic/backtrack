import { describe, it, expect, vi } from "vitest";
import { Activity } from "react";
import { render, screen, act } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { LiveLectureRow } from "./LiveLectureRow";
import { RefreshOnReturn } from "./RefreshOnReturn";

describe("LiveLectureRow", () => {
  it("shows the live class with Resume as the main (black) button and Data and End class as white ones", () => {
    render(<LiveLectureRow id="l2" name="Week 9: Inventory" />);
    expect(screen.getByText("Live now")).toBeInTheDocument();
    const resume = screen.getByRole("link", { name: "Resume" });
    expect(resume).toHaveAttribute("href", "/teach/l/l2/present");
    expect(resume.className).toContain("bg-ink");
    for (const [name, href] of [
      ["Data", "/teach/l/l2/live"],
      ["End class", "/teach/l/l2/live?end=1"],
    ]) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link.className).toContain("bg-surface");
      expect(link.className).not.toContain("underline");
    }
    expect(screen.queryByRole("link", { name: "End lecture" })).toBeNull();
  });
});

describe("RefreshOnReturn", () => {
  const tick = () => act(async () => new Promise((r) => setTimeout(r, 5)));

  it("reads the page again when Back shows the kept-alive page (a class started or ended meanwhile), not on the first load", async () => {
    refresh.mockClear();
    const view = render(
      <Activity mode="visible">
        <RefreshOnReturn />
      </Activity>,
    );
    await tick();
    expect(refresh).not.toHaveBeenCalled();
    view.rerender(
      <Activity mode="hidden">
        <RefreshOnReturn />
      </Activity>,
    );
    await tick();
    view.rerender(
      <Activity mode="visible">
        <RefreshOnReturn />
      </Activity>,
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
