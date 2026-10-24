import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
          table === "courses" ? courses(...args) : columns.startsWith("course_id") ? chain : live(...args),
        range: () => held(),
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
  useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("./sign-in-button", () => ({ SignInButton: () => <button>Sign in</button> }));
vi.mock("./actions", () => ({ addCourse: vi.fn(), saveSetup: vi.fn() }));

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
  it("lists only courses that are not archived", async () => {
    await TeachBody({ searchParams: search });
    expect(eqCalls).toContainEqual(["courses", "archived", false]);
  });

  it("asks for live lectures of the signed in teacher's own courses only", async () => {
    await TeachBody({ searchParams: search });
    expect(selects).toContainEqual(["lectures", "id, name, course_id, courses!inner(teacher_id)"]);
    expect(eqCalls).toContainEqual(["lectures", "status", "live"]);
    expect(eqCalls).toContainEqual(["lectures", "courses.teacher_id", "u1"]);
  });

  it("shows Live now with the name and Resume, Data and End class links for each live lecture", async () => {
    live.mockResolvedValue({
      data: [{ id: "l2", name: "Lecture 2, Oct 26", course_id: "c1", courses: { teacher_id: "u1" } }],
      error: null,
    });
    const html = renderToStaticMarkup(await TeachBody({ searchParams: search }));
    expect(html).toContain('href="/teach/l/l2/present"');
    expect(html).toContain("Live now");
    expect(html).toContain("Lecture 2, Oct 26");
    expect(links(html)).toEqual([
      ["Resume", "/teach/l/l2/present"],
      ["Data", "/teach/l/l2/live"],
      ["End class", "/teach/l/l2/live?end=1"],
      // The course's card offers Resume instead of a second Start lecture.
      ["Resume", "/teach/l/l2/present"],
    ]);
    // Live now names the course on the dashboard.
    expect(html).toMatch(/Live now<span[^>]*>· IMS 452<\/span>/);
    // The Live now row stays at the very top, above the course cards.
    expect(html.indexOf("Lecture 2, Oct 26")).toBeLessThan(html.indexOf('data-testid="course-card"'));
    expect(html).not.toContain('href="/teach/c/c1/start"');
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
    // With courses, only the "+" next to the heading; the name field opens from it.
    expect(html).toMatch(/<button[^>]*aria-label="Add a course"[^>]*aria-expanded="false"/);
    expect(html).not.toContain("Course name");
  });

  it("still lists the courses, without the line under them, when that read fails", async () => {
    held.mockResolvedValue({ data: null, error: { message: "meta broke" } });
    const html = renderToStaticMarkup(await TeachBody({ searchParams: search }));
    expect(html).toContain('href="/teach/c/c1"');
    expect(html).toContain("IMS 452");
    expect(html).not.toContain("No lectures yet");
    expect(html).not.toContain("last on");
  });

  it("opens the add course field when there are no courses", async () => {
    courses.mockResolvedValue({ data: [], error: null });
    const html = renderToStaticMarkup(await TeachBody({ searchParams: search }));
    expect(html).toMatch(/<button[^>]*aria-label="Add a course"[^>]*aria-expanded="true"/);
    expect(html).toContain("Course name");
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

describe("TeachBody course cards and Now / Next (batch D)", () => {
  const ims = {
    id: "c1",
    name: "IMS 452 Senior Design",
    color: "teal",
    section: "Section B",
    meet_days: [1, 3, 5],
    start_minute: 605,
    end_minute: 660,
  };
  const acc = { id: "c2", name: "ACC 221", color: null, section: null, meet_days: [3], start_minute: 890, end_minute: 965 };
  const plain = { id: "c3", name: "BIO 121", color: null, section: null, meet_days: null, start_minute: null, end_minute: null };
  const at = (iso: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
  };
  afterEach(() => {
    vi.useRealTimers();
  });
  const cards = (html: string) => html.split('data-testid="course-card"').slice(1);

  it("reads the color, section and schedule with the courses (and 0019's columns, to know the new options are in)", async () => {
    await TeachBody({ searchParams: search });
    expect(selects.filter(([t]) => t === "courses")).toEqual([
      ["courses", "id, name, color, section, meet_days, start_minute, end_minute, access_days, access_until"],
    ]);
  });

  it("each course is a card: color bar, code, section, when it meets, lectures, and Start lecture", async () => {
    courses.mockResolvedValue({ data: [ims, plain], error: null });
    held.mockResolvedValue({ data: [{ course_id: "c1", lecture_date: "2026-10-21" }], error: null });
    const html = renderToStaticMarkup(await TeachBody({ searchParams: search }));
    const [first, second] = cards(html);
    expect(first).toContain('data-course-color="teal"');
    expect(first).toContain("bg-course-teal");
    // The section is part of the title (Marko, hand test 3): "IMS 452 B" in the title's size and weight, the
    // typed "Section B" shortened to "B"; a screen reader hears "IMS 452 section B".
    expect(first).toMatch(/<h2 class="[^"]*type-title[^"]*"><a [^>]*data-card-link[^>]*>IMS 452 <span class="sr-only">section<\/span> <span data-course-section="">B<\/span><\/a><\/h2>/);
    expect(first).not.toContain("Section B");
    expect(first).not.toContain("type-small-strong text-secondary");
    expect(first).toContain('aria-label="Start lecture in IMS 452 section B"');
    expect(first).toContain("Senior Design");
    expect(first).toContain("Mon Wed Fri · 10:05–11:00 AM");
    expect(first).toContain("1 lecture, last on Oct 21");
    expect(first).toContain('href="/teach/c/c1"');
    expect(first).toMatch(/href="\/teach\/c\/c1\/start"[^>]*>Start lecture</);
    // No color, section or schedule: a quiet hairline bar and just the name.
    expect(second).toContain('data-course-color="none"');
    expect(second).toContain("bg-hairline");
    expect(second).toContain("No lectures yet");
    expect(second).not.toContain(" · ");
  });

  it("before migration 0018 it reads the courses without the new columns and leaves them out", async () => {
    courses
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column courses.access_days does not exist" } })
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column courses.color does not exist" } })
      .mockResolvedValueOnce({ data: [{ id: "c1", name: "IMS 452" }], error: null });
    at("2026-10-21T10:10:00-04:00");
    const html = renderToStaticMarkup(await TeachBody({ searchParams: search }));
    expect(selects.filter(([t]) => t === "courses").map(([, c]) => c)).toEqual([
      "id, name, color, section, meet_days, start_minute, end_minute, access_days, access_until",
      "id, name, color, section, meet_days, start_minute, end_minute",
      "id, name",
    ]);
    expect(cards(html)).toHaveLength(1);
    expect(html).toContain('href="/teach/c/c1/start"');
    expect(html).not.toContain('data-testid="now-next"');
  });

  it("still throws when the courses can not be read at all", async () => {
    courses.mockResolvedValue({ data: null, error: { message: "courses broke" } });
    await expect(TeachBody({ searchParams: search })).rejects.toThrow("courses broke");
  });

  it("Now: the course meeting right now, at the top, with the big Start lecture", async () => {
    courses.mockResolvedValue({ data: [ims, acc, plain], error: null });
    at("2026-10-21T10:10:00-04:00"); // Wednesday 10:10 AM in Oxford
    const html = renderToStaticMarkup(await TeachBody({ searchParams: search }));
    const block = html.match(/<section[^>]*data-testid="now-next"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(block).toContain('data-state="now"');
    expect(block).toContain(">Now<");
    expect(block).toMatch(/<a class="[^"]*type-display[^"]*" href="\/teach\/c\/c1">IMS 452 <span class="sr-only">section<\/span> <span data-course-section="">B<\/span><\/a>/);
    expect(block).not.toContain("Section B");
    expect(block).toContain('aria-label="Start lecture in IMS 452 section B"');
    expect(block).toContain("Mon Wed Fri · 10:05–11:00 AM");
    expect(block).toMatch(/href="\/teach\/c\/c1\/start"[^>]*>Start lecture</);
    expect(html.indexOf('data-testid="now-next"')).toBeLessThan(html.indexOf(">Courses</h1>"));
  });

  it("Next: the next meeting today or this week when nothing meets now", async () => {
    courses.mockResolvedValue({ data: [ims, acc], error: null });
    at("2026-10-21T12:00:00-04:00");
    const html = renderToStaticMarkup(await TeachBody({ searchParams: search }));
    const block = html.match(/<section[^>]*data-testid="now-next"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(block).toContain('data-state="next"');
    expect(block).toContain(">Next<");
    expect(block).toContain("ACC 221");
    expect(block).toContain("Today 2:50 PM");
    expect(block).not.toContain("Start lecture");
  });

  it("a course already live is not Now: the Live now row is on top and Next follows", async () => {
    courses.mockResolvedValue({ data: [ims, acc], error: null });
    live.mockResolvedValue({ data: [{ id: "l9", name: "Lecture 9", course_id: "c1" }], error: null });
    at("2026-10-21T10:10:00-04:00");
    const html = renderToStaticMarkup(await TeachBody({ searchParams: search }));
    expect(html).toContain('data-state="next"');
    expect(html.indexOf("Live now")).toBeLessThan(html.indexOf('data-testid="now-next"'));
  });

  it("no block at all when no course has days and a time", async () => {
    courses.mockResolvedValue({ data: [plain, { ...plain, id: "c4", meet_days: [1] }], error: null });
    at("2026-10-21T10:10:00-04:00");
    const html = renderToStaticMarkup(await TeachBody({ searchParams: search }));
    expect(html).not.toContain('data-testid="now-next"');
    expect(cards(html)[1]).toContain(">Mon<");
  });

  it("before migration 0019 it reads the details without 0019's columns and keeps the cards as they were", async () => {
    courses
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column courses.access_days does not exist" } })
      .mockResolvedValueOnce({ data: [ims], error: null });
    const html = renderToStaticMarkup(await TeachBody({ searchParams: search }));
    expect(selects.filter(([t]) => t === "courses").map(([, c]) => c)).toEqual([
      "id, name, color, section, meet_days, start_minute, end_minute, access_days, access_until",
      "id, name, color, section, meet_days, start_minute, end_minute",
    ]);
    expect(cards(html)).toHaveLength(1);
    expect(cards(html)[0]).toContain("bg-course-teal");
    expect(cards(html)[0]).toMatch(/<h2 class="[^"]*type-title[^"]*"><a [^>]*data-card-link[^>]*>IMS 452 <span class="sr-only">section<\/span> <span data-course-section="">B<\/span><\/a><\/h2>/);
  });

  it("a course with a picked color (after 0019): the bar is painted with it, inline, on the card and in Now", async () => {
    courses.mockResolvedValue({ data: [{ ...ims, color: "#2f6db5", access_days: null, access_until: null }], error: null });
    at("2026-10-21T10:10:00-04:00");
    const html = renderToStaticMarkup(await TeachBody({ searchParams: search }));
    expect(cards(html)[0]).toMatch(/data-course-color="#2f6db5"[^>]*style="background-color:#2f6db5"/);
    const block = html.match(/<section[^>]*data-testid="now-next"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(block).toContain("background-color:#2f6db5");
    // The new presets have their own tokens.
    courses.mockResolvedValue({ data: [{ ...ims, color: "pink" }], error: null });
    expect(renderToStaticMarkup(await TeachBody({ searchParams: search }))).toContain("bg-course-pink");
  });

  it("each card has a ⋯ button in its top right corner, named for the course, above the card's link", async () => {
    courses.mockResolvedValue({ data: [ims, plain], error: null });
    const html = renderToStaticMarkup(await TeachBody({ searchParams: search }));
    const [first, second] = cards(html);
    expect(first).toMatch(/<div class="absolute top-2 right-2 z-10"><button[^>]*aria-label="More for IMS 452 B"[^>]*aria-haspopup="menu"/);
    expect(second).toContain('aria-label="More for BIO 121"');
  });

  it("Add a course is a + icon button next to the Courses heading, not a text button under the cards", async () => {
    courses.mockResolvedValue({ data: [ims], error: null });
    const html = renderToStaticMarkup(await TeachBody({ searchParams: search }));
    const row = html.match(/<div class="flex items-center justify-between gap-4"><h1[^>]*>Courses<\/h1><button[^>]*>[\s\S]*?<\/button><\/div>/)?.[0];
    expect(row).toBeDefined();
    expect(row).toContain('aria-label="Add a course"');
    expect(row).toContain('data-icon="close"');
    expect(row).toContain("rotate-45");
    // No visible "Add a course" text anywhere on the dashboard.
    expect(html).not.toMatch(/>Add a course</);
    expect(html.indexOf('aria-label="Add a course"')).toBeLessThan(html.indexOf('data-testid="course-card"'));
  });

  it("falls back only when a column is missing (42703); any other error on the first read is thrown, not hidden", async () => {
    courses.mockResolvedValueOnce({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
    await expect(TeachBody({ searchParams: search })).rejects.toThrow("statement timeout");
    expect(selects.filter(([t]) => t === "courses")).toHaveLength(1);
  });

  it("an error other than a missing column on the 0018 read is thrown too", async () => {
    courses
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column courses.access_days does not exist" } })
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST301", message: "upstream broke" } });
    await expect(TeachBody({ searchParams: search })).rejects.toThrow("upstream broke");
    expect(selects.filter(([t]) => t === "courses")).toHaveLength(2);
  });

  it("in each card the course name comes first and the ⋯ last, in reading and Tab order", async () => {
    courses.mockResolvedValue({ data: [ims], error: null });
    const card = cards(renderToStaticMarkup(await TeachBody({ searchParams: search })))[0];
    expect(card.indexOf('aria-label="More for IMS 452 B"')).toBeGreaterThan(-1);
    expect(card.indexOf("<h2")).toBeLessThan(card.indexOf('aria-label="More for IMS 452 B"'));
    expect(card.indexOf("Start lecture")).toBeLessThan(card.indexOf('aria-label="More for IMS 452 B"'));
  });
});
