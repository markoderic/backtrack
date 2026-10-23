import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import Home from "./page";

describe("Home", () => {
  it("shows the name and exactly two choices: I'm a student and I'm a teacher", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { name: "backtrack" })).toBeInTheDocument();
    const choices = within(screen.getByRole("navigation")).getAllByRole("link");
    expect(choices).toHaveLength(2);
    expect(choices.map((c) => c.textContent)).toEqual(["I'm a student", "I'm a teacher"]);
    expect(screen.getByRole("link", { name: "I'm a student" })).toHaveAttribute("href", "/join");
    expect(screen.getByRole("link", { name: "I'm a teacher" })).toHaveAttribute("href", "/teach");
    expect(screen.queryByRole("link", { name: "Join a class" })).not.toBeInTheDocument();
  });

  it("has no My spots button (it lives on the student's code page now)", () => {
    render(<Home />);
    expect(screen.queryByRole("link", { name: /My spots/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link").map((l) => l.getAttribute("href"))).not.toContain("/spots");
  });

  it("I'm a student is the black primary button, I'm a teacher the white one at the same size, and both hold their press while the next page loads", () => {
    render(<Home />);
    const student = screen.getByRole("link", { name: "I'm a student" });
    const teacher = screen.getByRole("link", { name: "I'm a teacher" });
    expect(student.className).toContain("bg-ink");
    expect(student.className).toContain("text-surface");
    expect(teacher.className).not.toContain("underline");
    expect(teacher.className).toContain("bg-surface");
    expect(teacher.className).toContain("border-hairline");
    for (const size of ["h-12", "w-75"]) {
      expect(teacher.className).toContain(size);
      expect(student.className).toContain(size);
    }
    // A pending marker inside each link keeps it pressed until the next page (or its skeleton) shows.
    for (const link of [student, teacher]) {
      expect(link.className).toContain("has-[[data-pending]]:");
      expect(link.querySelector("span.hidden[aria-hidden]")).not.toBeNull();
    }
  });

  it("has a quiet Privacy link in the footer, outside the two choices", () => {
    render(<Home />);
    const privacy = screen.getByRole("link", { name: "Privacy" });
    expect(privacy).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("contentinfo")).toContainElement(privacy);
    expect(within(screen.getByRole("navigation")).queryByRole("link", { name: "Privacy" })).toBeNull();
  });
});
