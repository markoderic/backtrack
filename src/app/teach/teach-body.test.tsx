import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const getUser = vi.fn();
const teacher = vi.fn();
const courses = vi.fn();
const live = vi.fn();
const selects: [string, string][] = [];
const eqCalls: [string, string, unknown][] = [];
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser },
    from: (table: string) => {
      const chain = {
        maybeSingle: teacher,
        order: table === "courses" ? courses : live,
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
vi.mock("./sign-in-button", () => ({ SignInButton: () => <button>Sign in</button> }));
vi.mock("./add-course-form", () => ({ AddCourseForm: () => <form /> }));

import { TeachBody } from "./page";

const search = Promise.resolve({});
// Text and href of every link to a lecture page, in order.
const links = (html: string) =>
  [...html.matchAll(/<a [^>]*href="(\/teach\/l\/[^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[2], m[1].replace(/&amp;/g, "&")]);

beforeEach(() => {
  selects.length = 0;
  eqCalls.length = 0;
  [getUser, teacher, courses, live].forEach((m) => m.mockReset());
  getUser.mockResolvedValue({ data: { user: { id: "u1", email: "dericm@miamioh.edu" } } });
  teacher.mockResolvedValue({ data: { display_name: "Marko" }, error: null });
  courses.mockResolvedValue({ data: [{ id: "c1", name: "IMS 452" }], error: null });
  live.mockResolvedValue({ data: [], error: null });
});

describe("TeachBody", () => {
  it("asks for live lectures of the signed in teacher's own courses only", async () => {
    await TeachBody({ searchParams: search });
    expect(selects).toContainEqual(["lectures", "id, name, courses!inner(teacher_id)"]);
    expect(eqCalls).toContainEqual(["lectures", "status", "live"]);
    expect(eqCalls).toContainEqual(["lectures", "courses.teacher_id", "u1"]);
  });

  it("shows Live now with the name and Resume, Data and End lecture links for each live lecture", async () => {
    live.mockResolvedValue({
      data: [{ id: "l2", name: "Lecture 2, Oct 26", courses: { teacher_id: "u1" } }],
      error: null,
    });
    const html = renderToStaticMarkup(await TeachBody({ searchParams: search }));
    expect(html).toContain('href="/teach/l/l2/present"');
    expect(html).toContain("Live now");
    expect(html).toContain("Lecture 2, Oct 26");
    expect(links(html)).toEqual([
      ["Resume", "/teach/l/l2/present"],
      ["Data", "/teach/l/l2/live"],
      ["End lecture", "/teach/l/l2/live?end=1"],
    ]);
  });

  it("throws when the live lectures query fails", async () => {
    live.mockResolvedValue({ data: null, error: { message: "live broke" } });
    await expect(TeachBody({ searchParams: search })).rejects.toThrow("live broke");
  });

  it("shows the sign in button to a signed out visitor", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const html = renderToStaticMarkup(await TeachBody({ searchParams: search }));
    expect(html).toContain("Sign in");
    expect(html).not.toContain("Live now");
  });
});
