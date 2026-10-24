import { describe, it, expect, vi, beforeEach } from "vitest";

const maybeSingle = vi.fn();
const courseSelects: string[] = [];
const lectureCount = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser },
    from: (table: string) => ({
      select: (columns: string) => {
        if (table === "courses") courseSelects.push(columns);
        return { eq: () => (table === "lectures" ? lectureCount() : { maybeSingle }) };
      },
    }),
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("./start-form", () => ({ StartForm: () => null }));

import { StartBody } from "./start-body";

const params = Promise.resolve({ courseId: "c1" });

beforeEach(() => {
  maybeSingle.mockReset();
  lectureCount.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  lectureCount.mockResolvedValue({ count: 3, error: null });
});

describe("StartBody", () => {
  it("sends a signed out visitor to /teach", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(StartBody({ params })).rejects.toThrow("REDIRECT:/teach");
  });

  it("is a 404 when the course is not the teacher's", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(StartBody({ params })).rejects.toThrow("NOT_FOUND");
  });

  it("is a 404 for a malformed uuid in the url", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } });
    await expect(StartBody({ params })).rejects.toThrow("NOT_FOUND");
  });

  it("throws on any other course query error", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: "42P01", message: "courses broke" } });
    await expect(StartBody({ params })).rejects.toThrow("courses broke");
  });

  it("throws when counting lectures fails", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "c1", name: "IMS 452" }, error: null });
    lectureCount.mockResolvedValue({ count: null, error: { message: "count broke" } });
    await expect(StartBody({ params })).rejects.toThrow("count broke");
  });

  it("the course crumb carries the section (\"IMS 452 B\"), and before 0018 it reads the course without it", async () => {
    courseSelects.length = 0;
    const { render, screen } = await import("@testing-library/react");
    maybeSingle.mockResolvedValueOnce({ data: { id: "c1", name: "IMS 452", section: "Section B" }, error: null });
    const first = render(await StartBody({ params }));
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).querySelector('a[href="/teach/c/c1"]')).toHaveTextContent(/^IMS 452 B$/);
    first.unmount();
    maybeSingle
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column courses.section does not exist" } })
      .mockResolvedValueOnce({ data: { id: "c1", name: "IMS 452" }, error: null });
    render(await StartBody({ params }));
    expect(courseSelects).toEqual(["id, name, section", "id, name, section", "id, name"]);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).querySelector('a[href="/teach/c/c1"]')).toHaveTextContent(/^IMS 452$/);
  });

  it("passes the number of lectures already in the course to the form", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "c1", name: "IMS 452" }, error: null });
    const element = await StartBody({ params });
    // Finds the StartForm element anywhere in the page tree.
    type El = { props?: { children?: unknown; existingCount?: number } };
    const find = (node: unknown): El | undefined => {
      if (Array.isArray(node)) return node.map(find).find(Boolean);
      const el = node as El;
      if (!el || typeof el !== "object" || !el.props) return undefined;
      if ("existingCount" in el.props) return el;
      return find(el.props.children);
    };
    expect(find(element)?.props).toEqual({ courseId: "c1", existingCount: 3 });
  });
});
