import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import Home from "./page";

describe("Home", () => {
  it("shows the name and exactly two choices", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { name: "backtrack" })).toBeInTheDocument();
    const choices = within(screen.getByRole("navigation")).getAllByRole("link");
    expect(choices).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Join a class" })).toHaveAttribute("href", "/join");
    expect(screen.getByRole("link", { name: "I'm a teacher" })).toHaveAttribute("href", "/teach");
  });

  it("I'm a teacher is a white button the size of Join a class, not an underlined link, and holds its press while the next page loads", () => {
    render(<Home />);
    const teacher = screen.getByRole("link", { name: "I'm a teacher" });
    const join = screen.getByRole("link", { name: "Join a class" });
    expect(teacher.className).not.toContain("underline");
    expect(teacher.className).toContain("bg-surface");
    expect(teacher.className).toContain("border-hairline");
    for (const size of ["h-12", "w-75"]) {
      expect(teacher.className).toContain(size);
      expect(join.className).toContain(size);
    }
    // A pending marker inside the link keeps it pressed until the teacher page (or its skeleton) shows.
    expect(teacher.className).toContain("has-[[data-pending]]:");
    expect(teacher.querySelector("span.hidden[aria-hidden]")).not.toBeNull();
  });

  it("has a quiet Privacy link in the footer, outside the two choices", () => {
    render(<Home />);
    const privacy = screen.getByRole("link", { name: "Privacy" });
    expect(privacy).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("contentinfo")).toContainElement(privacy);
    expect(within(screen.getByRole("navigation")).queryByRole("link", { name: "Privacy" })).toBeNull();
  });
});
