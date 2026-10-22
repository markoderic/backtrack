import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  select: vi.fn(),
  refresh: vi.fn(),
  updates: [] as unknown[],
  eqs: [] as [string, unknown][],
  tables: [] as string[],
}));

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({
    from: (table: string) => {
      h.tables.push(table);
      return {
        update: (payload: unknown) => {
          h.updates.push(payload);
          const chain = {
            eq: (c: string, v: unknown) => {
              h.eqs.push([c, v]);
              return chain;
            },
            select: h.select,
          };
          return chain;
        },
      };
    },
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));

import { CourseList, type SettingsCourse } from "./CourseList";
import { STATUS_MS } from "./NameForm";

const A = "ACC 221 Intro to Financial Accounting";
const B = "ACC 222 Intro to Managerial Accounting";
const courses: SettingsCourse[] = [
  { id: "c1", name: A, archived: false },
  { id: "c2", name: B, archived: true },
];
const archivedGroup = () => screen.queryByRole("region", { name: "Archived" });

beforeEach(() => {
  h.updates.length = 0;
  h.eqs.length = 0;
  h.tables.length = 0;
  h.refresh.mockReset();
  h.select.mockReset().mockResolvedValue({ data: [{ id: "c1" }], error: null });
});

afterEach(() => vi.useRealTimers());

describe("CourseList", () => {
  it("shows courses in use with Rename and Archive, Add a course between, and the archived ones in their own group", () => {
    render(
      <CourseList courses={courses}>
        <form data-testid="add-course" />
      </CourseList>,
    );
    expect(screen.getByRole("button", { name: `Rename ${A}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Archive ${A}` })).toBeInTheDocument();
    const group = archivedGroup()!;
    expect(within(group).getByRole("link", { name: B })).toHaveAttribute("href", "/teach/c/c2");
    expect(within(group).getByRole("button", { name: `Unarchive ${B}` })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `Rename ${B}` })).toBeNull();
    const add = screen.getByTestId("add-course");
    expect(add.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Archive saves archived = true for that course, moves it to Archived at once, says Archived., and keeps the keyboard on Unarchive", async () => {
    render(<CourseList courses={[courses[0]]} />);
    expect(archivedGroup()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `Archive ${A}` }));
    await waitFor(() => expect(archivedGroup()).not.toBeNull());
    const unarchive = within(archivedGroup()!).getByRole("button", { name: `Unarchive ${A}` });
    expect(h.tables).toEqual(["courses"]);
    expect(h.updates).toEqual([{ archived: true }]);
    expect(h.eqs).toEqual([["id", "c1"]]);
    expect(h.refresh).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: `Archive ${A}` })).toBeNull();
    expect(screen.getByTestId("courses-status")).toHaveTextContent(`Archived ${A}.`);
    expect(screen.getByText("Archived.")).toHaveAttribute("aria-hidden");
    await waitFor(() => expect(document.activeElement).toBe(unarchive));
  });

  it("Unarchive brings it back with Unarchived. and focus on Archive", async () => {
    render(<CourseList courses={[courses[1]]} />);
    fireEvent.click(screen.getByRole("button", { name: `Unarchive ${B}` }));
    const archive = await screen.findByRole("button", { name: `Archive ${B}` });
    expect(h.updates).toEqual([{ archived: false }]);
    await waitFor(() => expect(archivedGroup()).toBeNull());
    expect(screen.getByTestId("courses-status")).toHaveTextContent(`Unarchived ${B}.`);
    expect(screen.getByText("Unarchived.")).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(archive));
  });

  it("the note clears after a few seconds", async () => {
    vi.useFakeTimers();
    render(<CourseList courses={[courses[0]]} />);
    fireEvent.click(screen.getByRole("button", { name: `Archive ${A}` }));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText("Archived.")).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(STATUS_MS));
    expect(screen.queryByText("Archived.")).toBeNull();
    expect(screen.getByTestId("courses-status")).toHaveTextContent("");
  });

  it("a failed or refused update leaves the course where it was and says so", async () => {
    h.select.mockResolvedValueOnce({ data: [], error: null });
    const { unmount } = render(<CourseList courses={courses} />);
    fireEvent.click(screen.getByRole("button", { name: `Archive ${A}` }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not archive the course.");
    expect(screen.getByRole("button", { name: `Archive ${A}` })).toBeInTheDocument();
    expect(h.refresh).not.toHaveBeenCalled();
    unmount();

    h.select.mockRejectedValueOnce(new Error("offline"));
    render(<CourseList courses={courses} />);
    fireEvent.click(screen.getByRole("button", { name: `Unarchive ${B}` }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not unarchive the course.");
    expect(within(archivedGroup()!).getByRole("button", { name: `Unarchive ${B}` })).toBeInTheDocument();
  });

  it("follows the server's list once it comes back", async () => {
    const { rerender } = render(<CourseList courses={[courses[0]]} />);
    fireEvent.click(screen.getByRole("button", { name: `Archive ${A}` }));
    await screen.findByRole("button", { name: `Unarchive ${A}` });
    rerender(<CourseList courses={[{ ...courses[0], archived: true }]} />);
    expect(screen.getByRole("button", { name: `Unarchive ${A}` })).toBeInTheDocument();
  });
});
