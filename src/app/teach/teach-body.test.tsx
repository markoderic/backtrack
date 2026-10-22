import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const getUser = vi.fn();
const teacher = vi.fn();
const courses = vi.fn();
const live = vi.fn();
const held = vi.fn();
const selects: [string, string][] = [];
const eqCalls: [string, string, unknown][] = [];
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser },
    from: (table: string) => {
      let columns = "";
      const chain = {
        maybeSingle: teacher,
        order: (...args: unknown[]) =>
          table === "courses" ? courses(...args) : columns.startsWith("course_id") ? held(...args) : live(...args),
        eq: (column: string, value: unknown) => {
          eqCalls.push([table, column, value]);
          return chain;
        },
      };
      return {
        select: (cols: string) => {
          columns = cols;
          selects.push([table, cols]);
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
vi.mock("./add-course-form", () => ({
  AddCourseForm: ({ startOpen }: { startOpen?: boolean }) => <form data-start-open={String(!!startOpen)} />,
}));

import { TeachBody } from "./page";
import NotMiamiPage from "./not-miami/page";

const search = Promise.resolve({});
// Text and href of every link to a lecture page, in order.
const links = (html: string) =>
  [...html.matchAll(/<a [^>]*href="(\/teach\/l\/[^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[2], m[1].replace(/&amp;/g, "&")]);

beforeEach(() => {
  selects.length = 0;
  eqCalls.length = 0;
  [getUser, teacher, courses, live, held].forEach((m) => m.mockReset());
  held.mockResolvedValue({ data: [], error: null });
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

  it("lists the courses with how many lectures each has and the last date, under the teacher's top bar", async () => {
    courses.mockResolvedValue({
      data: [
        { id: "c1", name: "ACC 221 Intro to Financial Accounting" },
        { id: "c2", name: "ACC 222 Intro to Managerial Accounting" },
      ],
      error: null,
    });
    held.mockResolvedValue({
      data: [
        { course_id: "c1", lecture_date: "2026-10-21" },
        { course_id: "c1", lecture_date: "2026-10-14" },
      ],
      error: null,
    });
    const html = renderToStaticMarkup(await TeachBody({ searchParams: search }));
    expect(selects).toContainEqual(["lectures", "course_id, lecture_date, courses!inner(teacher_id)"]);
    expect(eqCalls.filter(([t, c]) => t === "lectures" && c === "courses.teacher_id")).toHaveLength(2);
    expect(html).toMatch(/<h1[^>]*>Courses<\/h1>/);
    expect(html).toContain('href="/teach/c/c1"');
    expect(html).toContain("2 lectures, last on Oct 21");
    expect(html).toContain("No lectures yet");
    expect(html).toContain("Marko");
    expect(html).toContain('data-start-open="false"');
  });

  it("opens the add course field when there are no courses", async () => {
    courses.mockResolvedValue({ data: [], error: null });
    const html = renderToStaticMarkup(await TeachBody({ searchParams: search }));
    expect(html).toContain('data-start-open="true"');
  });

  it("shows Teacher sign in, and why when sign in did not finish", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const plain = renderToStaticMarkup(await TeachBody({ searchParams: search }));
    expect(plain).toContain("Teacher sign in");
    expect(plain).toContain("Miami University accounts only.");
    expect(plain).not.toContain('role="alert"');
    const failed = renderToStaticMarkup(await TeachBody({ searchParams: Promise.resolve({ error: "signin" }) }));
    expect(failed).toMatch(/role="alert"[^>]*>.*Sign in didn&#x27;t finish. Try again./);
  });

  it("tells someone outside Miami to use their @miamioh.edu account, with the sign in button again", () => {
    const html = renderToStaticMarkup(NotMiamiPage());
    expect(html).toContain("Teacher sign in");
    expect(html).toMatch(/role="alert"[^>]*>.*That isn&#x27;t a Miami account. Use your @miamioh.edu account./);
    expect(html).toContain("Sign in");
  });
});
