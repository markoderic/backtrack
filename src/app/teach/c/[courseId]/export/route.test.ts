// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  rpcRange: vi.fn(),
  eqs: [] as [string, string, unknown][],
  rpcs: [] as [string, unknown][],
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser: h.getUser },
    from: (table: string) => {
      const chain = {
        maybeSingle: h.maybeSingle,
        eq: (c: string, v: unknown) => {
          h.eqs.push([table, c, v]);
          return chain;
        },
      };
      return { select: () => chain };
    },
    rpc: (fn: string, args: unknown) => {
      h.rpcs.push([fn, args]);
      return { range: (a: number, z: number) => h.rpcRange(a, z) };
    },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { GET } from "./route";

const params = Promise.resolve({ courseId: "c1" });
// Response.text() drops a leading BOM, so read the bytes and keep it.
const body = async (res: Response) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(await res.arrayBuffer());
const call = () => GET(new Request("http://localhost/teach/c/c1/export"), { params });

const row = (n: number, extra: Partial<Record<string, unknown>> = {}) => ({
  lecture_date: "2026-10-19",
  lecture_name: "Lecture 1, Oct 19",
  slide_number: n,
  first_line: `Slide ${n}`,
  lost_taps: 0,
  students: 0,
  ...extra,
});

beforeEach(() => {
  h.eqs.length = 0;
  h.rpcs.length = 0;
  h.getUser.mockReset().mockResolvedValue({ data: { user: { id: "u1" } } });
  h.maybeSingle.mockReset().mockResolvedValue({ data: { id: "c1", name: "IMS 452" }, error: null });
  h.rpcRange.mockReset().mockResolvedValue({ data: [row(1), row(2, { lost_taps: 3, students: 2 })], error: null });
});

describe("GET /teach/c/[courseId]/export", () => {
  it("sends a signed out visitor to /teach", async () => {
    h.getUser.mockResolvedValue({ data: { user: null } });
    await expect(call()).rejects.toThrow("REDIRECT:/teach");
  });

  it("is a 404 for a course that is not the teacher's, and never calls the export", async () => {
    h.maybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await call();
    expect(res.status).toBe(404);
    expect(h.rpcs).toEqual([]);
    expect(h.eqs).toContainEqual(["courses", "id", "c1"]);
    expect(h.eqs).toContainEqual(["courses", "teacher_id", "u1"]);
  });

  it("is a 404 for a malformed uuid in the url", async () => {
    h.maybeSingle.mockResolvedValue({ data: null, error: { code: "22P02", message: "bad uuid" } });
    expect((await call()).status).toBe(404);
  });

  it("is a 404 when the database says the caller does not own the course", async () => {
    h.rpcRange.mockResolvedValue({ data: null, error: { code: "42501", message: "Not allowed." } });
    expect((await call()).status).toBe(404);
  });

  it("throws on any other course query error", async () => {
    h.maybeSingle.mockResolvedValue({ data: null, error: { code: "42P01", message: "courses broke" } });
    await expect(call()).rejects.toThrow("courses broke");
  });

  it("throws on any other export error", async () => {
    h.rpcRange.mockResolvedValue({ data: null, error: { code: "XX000", message: "export broke" } });
    await expect(call()).rejects.toThrow("export broke");
  });

  it("returns the semester as CSV with the header, BOM and CRLF", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.rpcs[0]).toEqual(["course_export", { p_course_id: "c1" }]);
    const text = await body(res);
    expect(text).toBe(
      "﻿Date,Lecture,Slide,First line of slide,Lost taps,Different students\r\n" +
        '2026-10-19,"Lecture 1, Oct 19",1,Slide 1,0,0\r\n' +
        '2026-10-19,"Lecture 1, Oct 19",2,Slide 2,3,2\r\n',
    );
  });

  it("starts the bytes with the UTF-8 BOM EF BB BF", async () => {
    const bytes = new Uint8Array(await (await call()).arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("sends text/csv and an attachment filename from the course name", async () => {
    const res = await call();
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe(
      `attachment; filename="IMS 452 semester.csv"; filename*=UTF-8''IMS%20452%20semester.csv`,
    );
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("cleans a course name that would break the header", async () => {
    h.maybeSingle.mockResolvedValue({ data: { id: "c1", name: 'Ávila "A"/B\r\nX: y' }, error: null });
    const res = await call();
    const header = res.headers.get("Content-Disposition")!;
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain('filename="Avila ABX: y semester.csv"');
    expect(header).toContain("filename*=UTF-8''%C3%81vila%20ABX%3A%20y%20semester.csv");
  });

  it("reads the export in pages of 1000 so a long semester is not cut off", async () => {
    const page = (from: number, count: number) => Array.from({ length: count }, (_, i) => row(from + i + 1));
    h.rpcRange
      .mockResolvedValueOnce({ data: page(0, 1000), error: null })
      .mockResolvedValueOnce({ data: page(1000, 200), error: null });
    const res = await call();
    expect(h.rpcRange.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    const lines = (await body(res)).split("\r\n");
    expect(lines).toHaveLength(1 + 1200 + 1); // header, rows, trailing empty after the last CRLF
  });

  it("asks for another page when the first is exactly full, and stops on an empty one", async () => {
    h.rpcRange
      .mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, i) => row(i + 1)), error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    await call();
    expect(h.rpcRange).toHaveBeenCalledTimes(2);
  });

  it("returns just the header for a course with no lectures", async () => {
    h.rpcRange.mockResolvedValue({ data: [], error: null });
    const res = await call();
    expect(await body(res)).toBe("﻿Date,Lecture,Slide,First line of slide,Lost taps,Different students\r\n");
  });
});
