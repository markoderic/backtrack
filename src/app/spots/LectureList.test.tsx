import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const getSession = vi.fn();
const result = vi.fn();
const eq = vi.fn(() => result());
const select = vi.fn(() => ({ eq }));
// lost_taps.select(...).eq(anon_id).eq(undone): the student's own rows, for the spot counts.
const tapRows = vi.fn();
const tapEqs: [string, unknown][] = [];
const tapChain = {
  eq: (c: string, v: unknown) => {
    tapEqs.push([c, v]);
    return tapChain;
  },
  then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(tapRows()).then(ok, bad),
};
const from = vi.fn((table: string) => (table === "lost_taps" ? { select: () => tapChain } : { select }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => ({ auth: { getSession }, from }) }));

import { LectureList } from "./LectureList";

const joined = (id: string, name: string, date: string, joinedAt: string, status = "ended") => ({
  joined_at: joinedAt,
  lectures: { id, name, lecture_date: date, status },
});

beforeEach(() => {
  [getSession, result, eq, select, from].forEach((m) => m.mockClear());
  tapEqs.length = 0;
  tapRows.mockReset().mockResolvedValue({ data: [], error: null });
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

  describe("a lecture that is live right now", () => {
    beforeEach(() => {
      result.mockResolvedValue({
        data: [
          joined("l3", "Lecture 3, Oct 26", "2026-10-26", "2026-10-26T14:00:00Z"),
          joined("live", "Week 9: Inventory", "2026-10-20", "2026-10-20T14:00:00Z", "live"),
          joined("l2", "Lecture 2, Oct 21", "2026-10-21", "2026-10-21T14:00:00Z"),
        ],
        error: null,
      });
    });

    it("asks for each lecture's status", async () => {
      render(<LectureList />);
      await screen.findAllByRole("listitem");
      expect(select).toHaveBeenCalledWith("joined_at, lectures(id, name, lecture_date, status)");
    });

    it("comes first in the list, whatever its date, marked Live now", async () => {
      render(<LectureList />);
      const items = await screen.findAllByRole("listitem");
      expect(items[0]).toHaveTextContent("Week 9: Inventory");
      expect(within(items[0]).getByText("Live now")).toBeInTheDocument();
      expect(items[1]).toHaveTextContent("Lecture 3, Oct 26");
      for (const other of items.slice(1)) expect(within(other).queryByText("Live now")).not.toBeInTheDocument();
      // Ink, never the lost red.
      const marker = items[0].querySelector("[data-live-now]") as HTMLElement;
      expect(marker.className).toContain("text-ink");
      expect(marker.innerHTML).not.toContain("lost");
    });

    it("has a black Back to lecture button that goes back into class, and its row still opens its spots", async () => {
      render(<LectureList />);
      const [first, second] = await screen.findAllByRole("listitem");
      const back = within(first).getByRole("link", { name: /^Back to lecture/ });
      expect(back).toHaveAttribute("href", "/l/live");
      expect(back).toHaveTextContent("Back to lecture");
      expect(back.className).toContain("bg-ink");
      expect(back.className).toContain("text-surface");
      expect(within(first).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/spots/live", "/l/live"]);
      expect(within(second).queryByRole("link", { name: /^Back to lecture/ })).not.toBeInTheDocument();
    });
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

  it("counts spots per lecture by slide, not by row (two taps on one slide are one spot)", async () => {
    tapRows.mockResolvedValue({
      data: [
        { lecture_id: "l3", slide_number: 4 },
        { lecture_id: "l3", slide_number: 4 },
        { lecture_id: "l3", slide_number: 4 },
        { lecture_id: "l3", slide_number: 4 },
        { lecture_id: "l2", slide_number: 1 },
        { lecture_id: "l2", slide_number: 7 },
      ],
      error: null,
    });
    render(<LectureList />);
    const items = await screen.findAllByRole("listitem");
    expect(items[0]).toHaveTextContent("1 spot");
    expect(items[0]).not.toHaveTextContent("4 spots");
    expect(items[1]).toHaveTextContent("2 spots");
    expect(items[2].querySelector("[data-spot-count]")).toBeNull();
    expect(tapEqs).toEqual([
      ["anon_id", "s1"],
      ["undone", false],
    ]);
  });

  it("leaves the counts out when they can not be read, and still lists the lectures", async () => {
    tapRows.mockResolvedValue({ data: null, error: { message: "nope" } });
    render(<LectureList />);
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(document.querySelector("[data-spot-count]")).toBeNull();
  });

  it("heads the page My spots and has a back arrow to Home", async () => {
    render(<LectureList />);
    await screen.findAllByRole("listitem");
    expect(screen.getByRole("heading", { level: 1, name: "My spots" })).toBeInTheDocument();
    const back = screen.getByRole("link", { name: "Back to Home" });
    expect(back).toHaveAttribute("href", "/");
    expect(back).toHaveClass("size-11");
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
  });

  it("has no coming soon text", async () => {
    const { container } = render(<LectureList />);
    await screen.findAllByRole("listitem");
    expect(container.textContent).not.toMatch(/coming soon/i);
  });
});
