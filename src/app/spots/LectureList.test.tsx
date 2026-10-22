import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const getSession = vi.fn();
const result = vi.fn();
const eq = vi.fn(() => result());
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => ({ auth: { getSession }, from }) }));

import { LectureList } from "./LectureList";

const joined = (id: string, name: string, date: string, joinedAt: string) => ({
  joined_at: joinedAt,
  lectures: { id, name, lecture_date: date },
});

beforeEach(() => {
  [getSession, result, eq, select, from].forEach((m) => m.mockClear());
  getSession.mockResolvedValue({ data: { session: { user: { id: "s1" } } }, error: null });
  result.mockResolvedValue({
    data: [
      joined("l1", "Lecture 1, Oct 19", "2026-10-19", "2026-10-19T14:00:00Z"),
      joined("l3", "Lecture 3, Oct 26", "2026-10-26", "2026-10-26T14:00:00Z"),
      joined("l2", "Lecture 2, Oct 21", "2026-10-21", "2026-10-21T14:00:00Z"),
    ],
    error: null,
  });
});

describe("LectureList", () => {
  it("lists every lecture this browser joined, newest first, each a link", async () => {
    render(<LectureList />);
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Lecture 3, Oct 26"),
      expect.stringContaining("Lecture 2, Oct 21"),
      expect.stringContaining("Lecture 1, Oct 19"),
    ]);
    expect(within(items[0]).getByRole("link")).toHaveAttribute("href", "/spots/l3");
    expect(within(items[0]).getByText("Oct 26")).toBeInTheDocument();
    expect(from).toHaveBeenCalledWith("participants");
  });

  it("asks only for the signed in user's own participant rows", async () => {
    render(<LectureList />);
    await screen.findAllByRole("listitem");
    expect(eq).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith("anon_id", "s1");
  });

  it("puts two lectures on the same day in the order they were joined, newest first", async () => {
    result.mockResolvedValue({
      data: [
        joined("am", "Morning", "2026-10-26", "2026-10-26T13:00:00Z"),
        joined("pm", "Afternoon", "2026-10-26", "2026-10-26T18:00:00Z"),
      ],
      error: null,
    });
    render(<LectureList />);
    const items = await screen.findAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Afternoon"),
      expect.stringContaining("Morning"),
    ]);
  });

  it("says No lectures yet. when nothing was joined", async () => {
    result.mockResolvedValue({ data: [], error: null });
    render(<LectureList />);
    expect(await screen.findByText("No lectures yet.")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("says the same with no session at all, without asking the database", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    render(<LectureList />);
    expect(await screen.findByText("No lectures yet.")).toBeInTheDocument();
    expect(from).not.toHaveBeenCalled();
  });

  it("always has a Join a class link to /join", async () => {
    render(<LectureList />);
    await screen.findAllByRole("listitem");
    expect(screen.getByRole("link", { name: "Join a class" })).toHaveAttribute("href", "/join");
  });

  it("skips a lecture the database did not return", async () => {
    result.mockResolvedValue({
      data: [{ joined_at: "2026-10-26T14:00:00Z", lectures: null }, joined("l1", "Lecture 1", "2026-10-19", "2026-10-19T14:00:00Z")],
      error: null,
    });
    render(<LectureList />);
    expect(await screen.findAllByRole("listitem")).toHaveLength(1);
  });

  it("throws on a failed query instead of showing an empty list", async () => {
    result.mockResolvedValue({ data: null, error: { message: "participants broke" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { Component } = await import("react");
    class Catch extends Component<{ children: React.ReactNode }, { error: Error | null }> {
      state = { error: null as Error | null };
      static getDerivedStateFromError(error: Error) {
        return { error };
      }
      render() {
        return this.state.error ? <p>caught: {this.state.error.message}</p> : this.props.children;
      }
    }
    render(
      <Catch>
        <LectureList />
      </Catch>,
    );
    expect(await screen.findByText("caught: participants broke")).toBeInTheDocument();
    expect(screen.queryByText("No lectures yet.")).not.toBeInTheDocument();
    spy.mockRestore();
  });

  it("heads the page My spots and links the mark home", async () => {
    render(<LectureList />);
    await screen.findAllByRole("listitem");
    expect(screen.getByRole("heading", { level: 1, name: "My spots" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
  });

  it("has no coming soon text", async () => {
    const { container } = render(<LectureList />);
    await screen.findAllByRole("listitem");
    expect(container.textContent).not.toMatch(/coming soon/i);
  });
});
