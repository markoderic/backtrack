import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";

const limit = vi.fn();
const select = vi.fn(() => ({ limit }));
const from = vi.fn((table: string) => (table === "slide_marks" ? { select } : {}));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => ({ from }) }));

import { forgetTeacherNoteMax, loadTeacherNoteMax, noteCounterFrom, useTeacherNoteMax } from "./noteLimit";

const client = { from } as unknown as SupabaseClient;
const missing = { data: null, error: { code: "PGRST205", message: "Could not find the table" }, status: 404 };

beforeEach(() => {
  forgetTeacherNoteMax();
  [limit, select, from].forEach((m) => m.mockClear());
  limit.mockReset();
});

describe("loadTeacherNoteMax", () => {
  it("is 2000 when slide_marks answers (0020 has run), reading no rows", async () => {
    limit.mockResolvedValue({ data: [], error: null, status: 200 });
    expect(await loadTeacherNoteMax(client)).toBe(2000);
    expect(from).toHaveBeenCalledWith("slide_marks");
    expect(select).toHaveBeenCalledWith("id");
    expect(limit).toHaveBeenCalledWith(0);
  });

  it("is 140 before 0020 (no such table), whichever way the database says it", async () => {
    limit.mockResolvedValue(missing);
    expect(await loadTeacherNoteMax(client)).toBe(140);
    limit.mockResolvedValue({ data: null, error: { code: "42P01", message: "relation does not exist" }, status: 404 });
    expect(await loadTeacherNoteMax(client)).toBe(140);
  });

  it("is 140 when offline or anything goes wrong, and asks again next time", async () => {
    limit.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await loadTeacherNoteMax(client)).toBe(140);
    limit.mockResolvedValue({ data: null, error: { code: "", message: "Failed to fetch" }, status: 0 });
    expect(await loadTeacherNoteMax(client)).toBe(140);
    limit.mockResolvedValue({ data: [], error: null, status: 200 });
    expect(await loadTeacherNoteMax(client)).toBe(2000);
  });

  it("remembers 2000 once seen (no second request)", async () => {
    limit.mockResolvedValue({ data: [], error: null, status: 200 });
    await loadTeacherNoteMax(client);
    await loadTeacherNoteMax(client);
    expect(limit).toHaveBeenCalledTimes(1);
  });
});

describe("useTeacherNoteMax", () => {
  function Show() {
    return <p>{useTeacherNoteMax()}</p>;
  }

  it("starts at 140 and becomes 2000 once the database answers", async () => {
    let answer: (v: unknown) => void = () => {};
    limit.mockReturnValue(new Promise((r) => (answer = r)));
    render(<Show />);
    expect(screen.getByText("140")).toBeInTheDocument();
    await act(async () => answer({ data: [], error: null, status: 200 }));
    await waitFor(() => expect(screen.getByText("2000")).toBeInTheDocument());
  });

  it("stays at 140 before 0020", async () => {
    limit.mockResolvedValue(missing);
    render(<Show />);
    await act(async () => {});
    expect(screen.getByText("140")).toBeInTheDocument();
  });
});

describe("noteCounterFrom", () => {
  it("shows the counter for the last 20 characters", () => {
    expect(noteCounterFrom(140)).toBe(120);
    expect(noteCounterFrom(2000)).toBe(1980);
  });
});
