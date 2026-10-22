import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PrivacyPage, { metadata } from "./page";

describe("Privacy page", () => {
  it("has the page title and a heading", () => {
    render(<PrivacyPage />);
    expect(metadata.title).toBe("Privacy");
    expect(screen.getByRole("heading", { level: 1, name: "Privacy" })).toBeInTheDocument();
  });

  it("covers students, professors, teachers, browser storage, retention and hosting", () => {
    render(<PrivacyPage />);
    const names = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(names).toEqual(["Students", "What professors see", "Teachers", "In your browser", "How long", "Where it lives"]);
  });

  it("says students never sign in and that saved spots are private", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/You never sign in\./)).toBeInTheDocument();
    expect(screen.getByText(/Save this are private/)).toBeInTheDocument();
  });

  it("is honest that nothing is deleted on a timer", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/never deletes anything on a timer/)).toBeInTheDocument();
  });

  it("names the hosts and the region", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/Vercel/)).toBeInTheDocument();
    expect(screen.getByText(/us-east-1/)).toBeInTheDocument();
  });

  it("never calls the anonymous ID tracking, and invents no email address", () => {
    const { container } = render(<PrivacyPage />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\btracking\b/i);
    expect(text).not.toMatch(/mailto|@gmail|@[a-z0-9-]+\.com/i);
    expect(screen.getByText("Questions: talk to your professor.")).toBeInTheDocument();
  });

  it("links back to Home from the logo", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("link", { name: "backtrack" })).toHaveAttribute("href", "/");
  });
});
