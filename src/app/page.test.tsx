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

  it("has a quiet Privacy link in the footer, outside the two choices", () => {
    render(<Home />);
    const privacy = screen.getByRole("link", { name: "Privacy" });
    expect(privacy).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("contentinfo")).toContainElement(privacy);
    expect(within(screen.getByRole("navigation")).queryByRole("link", { name: "Privacy" })).toBeNull();
  });
});
