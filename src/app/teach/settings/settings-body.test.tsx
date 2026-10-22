import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  teacher: vi.fn(),
  courses: vi.fn(),
  eqs: [] as [string, string, unknown][],
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser: h.getUser },
    from: (table: string) => {
      const chain = {
        eq: (column: string, value: unknown) => {
          h.eqs.push([table, column, value]);
          return chain;
        },
        maybeSingle: h.teacher,
        order: h.courses,
      };
      return { select: () => chain };
    },
  }),
}));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => ({}) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("../add-course-form", () => ({
  AddCourseForm: ({ startOpen }: { startOpen?: boolean }) => <form data-add-course={String(!!startOpen)} />,
}));
vi.mock("./actions", () => ({ signOut: vi.fn(), saveName: vi.fn() }));

import { SettingsBody } from "./settings-body";

beforeEach(() => {
  h.eqs.length = 0;
  h.getUser.mockReset().mockResolvedValue({ data: { user: { id: "u1", email: "lcarter@miamioh.edu" } } });
  h.teacher.mockReset().mockResolvedValue({ data: { display_name: "Linda Carter" }, error: null });
  h.courses.mockReset().mockResolvedValue({
    data: [
      { id: "c1", name: "ACC 221 Intro to Financial Accounting" },
      { id: "c2", name: "ACC 222 Intro to Managerial Accounting" },
    ],
    error: null,
  });
});

const html = async () => renderToStaticMarkup(await SettingsBody());

describe("SettingsBody", () => {
  it("shows the name, each course with Rename, Add a course and who is signed in with Sign out", async () => {
    const out = await html();
    expect(out).toContain("<h1");
    expect(out).toContain(">Settings</h1>");
    expect(out).toContain("Your name, as students see it");
    expect(out).toContain('value="Linda Carter"');
    expect(out).toContain("ACC 221 Intro to Financial Accounting");
    expect(out).toContain("ACC 222 Intro to Managerial Accounting");
    expect(out).toContain('aria-label="Rename ACC 221 Intro to Financial Accounting"');
    expect(out).toContain('aria-label="Rename ACC 222 Intro to Managerial Accounting"');
    expect(out).toContain('data-add-course="false"');
    expect(out).toContain("Signed in as lcarter@miamioh.edu");
    expect(out).toContain(">Sign out</button>");
  });

  it("leaves out the theme, archive, delete and recovery codes", async () => {
    const out = await html();
    for (const word of [/theme/i, /dark/i, /archive/i, /delete/i, /recovery/i]) expect(out).not.toMatch(word);
  });

  it("marks Settings in the top bar as the current page", async () => {
    const out = await html();
    expect(out).toMatch(/<a [^>]*href="\/teach\/settings"[^>]*aria-current="page"|<a [^>]*aria-current="page"[^>]*href="\/teach\/settings"/);
  });

  it("shows only Settings in the breadcrumb (as designed) and gives phones a back link to Courses", async () => {
    const out = await html();
    expect(out).toMatch(/<a [^>]*href="\/teach"[^>]*data-testid="back-link"|<a [^>]*data-testid="back-link"[^>]*href="\/teach"/);
    const nav = out.slice(out.indexOf('aria-label="Breadcrumb"'), out.indexOf("</nav>"));
    expect(nav.match(/<li/g)).toHaveLength(1);
  });

  it("asks only for the teacher's own courses that are not archived", async () => {
    await html();
    expect(h.eqs).toContainEqual(["teachers", "id", "u1"]);
    expect(h.eqs).toContainEqual(["courses", "teacher_id", "u1"]);
    expect(h.eqs).toContainEqual(["courses", "archived", false]);
  });

  it("opens Add a course when there are no courses", async () => {
    h.courses.mockResolvedValue({ data: [], error: null });
    const out = await html();
    expect(out).toContain('data-add-course="true"');
    expect(out).not.toContain("<ul");
  });

  it("sends a signed out visitor or a non Miami account to the sign in page", async () => {
    h.getUser.mockResolvedValue({ data: { user: null } });
    await expect(SettingsBody()).rejects.toThrow("REDIRECT:/teach");
    h.getUser.mockResolvedValue({ data: { user: { id: "u2", email: "x@gmail.com" } } });
    await expect(SettingsBody()).rejects.toThrow("REDIRECT:/teach");
  });

  it("sends someone with no teachers row to /teach, and an unfinished setup to setup", async () => {
    h.teacher.mockResolvedValue({ data: null, error: null });
    await expect(SettingsBody()).rejects.toThrow("REDIRECT:/teach");
    h.teacher.mockResolvedValue({ data: { display_name: null }, error: null });
    await expect(SettingsBody()).rejects.toThrow("REDIRECT:/teach/setup");
  });

  it("fails loudly when the courses can't be read", async () => {
    h.courses.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(SettingsBody()).rejects.toThrow("boom");
  });
});
