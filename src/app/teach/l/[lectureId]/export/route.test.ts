import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
const maybeSingle = vi.fn();
const stats = vi.fn();
const slides = vi.fn();
const selects: [string, string][] = [];
const eqCalls: [string, string, unknown][] = [];
const rpcCalls: [string, unknown][] = [];
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser },
    rpc: (name: string, args: unknown) => {
      rpcCalls.push([name, args]);
      return Promise.resolve(stats());
    },
    from: (table: string) => {
      const chain = {
        maybeSingle,
        order: () => Promise.resolve(slides()),
        eq: (column: string, value: unknown) => {
          eqCalls.push([table, column, value]);
          return chain;
        },
      };
      return {
        select: (columns: string) => {
          selects.push([table, columns]);
          return chain;
        },
      };
    },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { GET } from "./route";
import { lectureCsvFileName } from "./filename";

const call = () => GET(new Request("http://x/teach/l/l1/export"), { params: Promise.resolve({ lectureId: "l1" }) });
const lecture = { id: "l1", name: "Week 8: Adjusting", status: "ended", lecture_date: "2026-10-21", slide_count: 3 };

beforeEach(() => {
  selects.length = 0;
  eqCalls.length = 0;
  rpcCalls.length = 0;
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "u1" } } });
  maybeSingle.mockReset().mockResolvedValue({ data: lecture, error: null });
  stats.mockReset().mockResolvedValue({
    data: [
      { slide_number: 1, taps: 0, students: 0 },
      { slide_number: 2, taps: 5, students: 3 },
      { slide_number: 3, taps: 1, students: 1 },
    ],
    error: null,
  });
  slides.mockReset().mockResolvedValue({
    data: [
      { number: 1, first_line: "Welcome" },
      { number: 2, first_line: "=SUM(A1)" },
    ],
    error: null,
  });
});

describe("GET /teach/l/[lectureId]/export", () => {
  it("sends a signed out visitor to /teach", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(call()).rejects.toThrow("REDIRECT:/teach");
  });

  it("asks only for a lecture of the teacher's own courses", async () => {
    await call();
    expect(selects[0]).toEqual(["lectures", expect.stringContaining("courses!inner(teacher_id)")]);
    expect(eqCalls).toContainEqual(["lectures", "id", "l1"]);
    expect(eqCalls).toContainEqual(["lectures", "courses.teacher_id", "u1"]);
  });

  it("is a 404 for someone else's lecture, a malformed id, or a lecture still live", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await call()).status).toBe(404);
    maybeSingle.mockResolvedValue({ data: null, error: { code: "22P02", message: "bad uuid" } });
    expect((await call()).status).toBe(404);
    maybeSingle.mockResolvedValue({ data: { ...lecture, status: "live" }, error: null });
    expect((await call()).status).toBe(404);
    expect(rpcCalls).toEqual([]);
  });

  it("is a 404 when the database says the lecture is not the caller's", async () => {
    stats.mockResolvedValue({ data: null, error: { code: "42501", message: "Not allowed." } });
    expect((await call()).status).toBe(404);
  });

  it("throws on other errors", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: "42P01", message: "lectures broke" } });
    await expect(call()).rejects.toThrow("lectures broke");
  });

  it("writes one row per slide with the semester export's columns, zeros filled and formulas defused", async () => {
    const res = await call();
    expect(rpcCalls).toEqual([["lecture_slide_stats", { p_lecture_id: "l1" }]]);
    expect(eqCalls).toContainEqual(["slides", "lecture_id", "l1"]);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toContain('filename="Week 8: Adjusting.csv"');
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const text = (await res.text()).replace(/^﻿/, "");
    expect(text.split("\r\n")).toEqual([
      "Date,Lecture,Slide,First line of slide,Lost taps,Different students",
      "2026-10-21,Week 8: Adjusting,1,Welcome,0,0",
      "2026-10-21,Week 8: Adjusting,2,'=SUM(A1),5,3",
      "2026-10-21,Week 8: Adjusting,3,,1,1",
      "",
    ]);
  });

  it("names the file after the lecture, without characters that break a file name", () => {
    expect(lectureCsvFileName('Week "8"/9')).toBe("Week 89.csv");
    expect(lectureCsvFileName("  ")).toBe("lecture.csv");
  });
});
