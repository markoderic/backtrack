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
    expect(screen.getByText(/You never sign in or sign up\./)).toBeInTheDocument();
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

  it("tells students the professor reads notes, and that an undone tap keeps its note", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/the professor reads it/)).toBeInTheDocument();
    expect(screen.getByText(/A professor can hide notes on their own screen/)).toBeInTheDocument();
    expect(screen.getByText(/marked as undone, with its note and highlight/)).toBeInTheDocument();
  });

  it("is plain about the anonymous ID: it persists, the professor's browser gets it, a wrong code is not kept", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/same ID in every lecture you join on this browser/)).toBeInTheDocument();
    expect(screen.getByText(/The code you typed is not kept/)).toBeInTheDocument();
    expect(screen.getByText(/own tables keep no device details with it/)).toBeInTheDocument();
  });

  it("says a teacher can delete an ended lecture, images best effort, and what the host logs can hold", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/A teacher can delete an ended lecture\. That removes its taps, notes and joined list, and then its slide images\. If an image fails to delete it can stay in storage\./)).toBeInTheDocument();
    expect(screen.getByText(/can include your IP address/)).toBeInTheDocument();
  });

  it("mentions the tap limit", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/At most 20 taps in a minute and 300 in one lecture for each student/)).toBeInTheDocument();
  });
});
