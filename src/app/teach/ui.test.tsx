import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { TeacherTopBar, fieldClass, fieldNarrowClass, hitAreaClass } from "./ui";

describe("buttons, not links (Marko, 2:05 PM)", () => {
  it("no teacher screen and not Home has an underlined text action left", () => {
    // Every action is the black or the white button now; only navigation (breadcrumb, Settings) is text.
    const root = path.resolve(import.meta.dirname);
    const files = [
      ...readdirSync(root, { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
        .map((f) => path.join(root, f)),
      path.resolve(root, "../page.tsx"),
    ];
    expect(files.length).toBeGreaterThan(20);
    const underlined = files.filter((f) => /\bunderline\b(?!d)/.test(readFileSync(f, "utf8").replace(/\/\/.*|\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}/g, "")));
    expect(underlined).toEqual([]);
  });

  it("text links in the top bar keep an invisible 44 px hit area", () => {
    expect(hitAreaClass).toBe("relative after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']");
  });
});

describe("fields", () => {
  it("the narrow field is the same field at 480 px instead of full width", () => {
    expect(fieldClass).toContain("w-full");
    expect(fieldNarrowClass).toContain("w-120 max-w-full");
    expect(fieldNarrowClass.split(" ")).not.toContain("w-full");
    expect(fieldNarrowClass.replace("w-120 max-w-full", "")).toBe(fieldClass.replace("w-full", ""));
  });
});

describe("TeacherTopBar", () => {
  const crumbs = [
    { label: "Courses", href: "/teach" },
    { label: "ACC 221", href: "/teach/c/c1" },
    { label: "Start lecture" },
  ];

  it("links the breadcrumb with 44 px hit areas and marks the current page", () => {
    render(<TeacherTopBar crumbs={crumbs} teacherName="Linda Carter" />);
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    const courses = nav.querySelector('a[href="/teach"]')!;
    expect(courses.className).toContain("after:-inset-y-3");
    expect(nav.querySelector('a[href="/teach/c/c1"]')!.className).toContain("after:-inset-y-3");
    expect(screen.getByText("Start lecture")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Linda Carter")).toBeInTheDocument();
  });

  it("the logo goes Home, the page with I'm a student and I'm a teacher (Marko, hand test 2)", () => {
    render(<TeacherTopBar crumbs={[{ label: "Courses" }]} teacherName="Linda Carter" />);
    const logo = screen.getByRole("link", { name: "backtrack, home" });
    expect(logo).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "backtrack, courses" })).toBeNull();
    // The dashboard keeps its Courses breadcrumb.
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText("Courses")).toHaveAttribute("aria-current", "page");
  });

  it("gives phones a back link to the page one level up (the breadcrumb is hidden there)", () => {
    render(<TeacherTopBar crumbs={crumbs} />);
    const back = screen.getByTestId("back-link");
    expect(back).toHaveAttribute("href", "/teach/c/c1");
    expect(back).toHaveTextContent("ACC 221");
    expect(back.className).toContain("sm:hidden");
    expect(back.className).toContain("after:-inset-y-3");
  });

  it("links to Settings on every teacher page, with a 44 px hit area", () => {
    render(<TeacherTopBar crumbs={crumbs} teacherName="Linda Carter" />);
    const settings = screen.getByRole("link", { name: "Settings" });
    expect(settings).toHaveAttribute("href", "/teach/settings");
    expect(settings).not.toHaveAttribute("aria-current");
    expect(settings.className).toContain(hitAreaClass);
  });

  it("marks Settings as the current page on the Settings page", () => {
    render(<TeacherTopBar crumbs={[{ label: "Settings" }]} teacherName="Linda Carter" onSettings />);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  });

  it("leaves the teacher's name out on a phone (the back link and Settings keep their room)", () => {
    render(<TeacherTopBar crumbs={crumbs} teacherName="Linda Carter" />);
    expect(screen.getByText("Linda Carter").className).toContain("hidden");
    expect(screen.getByText("Linda Carter").className).toContain("sm:block");
  });

  it("can give phones a back link without a parent crumb (Settings shows only its own name, as designed)", () => {
    render(<TeacherTopBar crumbs={[{ label: "Settings" }]} back={{ label: "Courses", href: "/teach" }} onSettings />);
    const back = screen.getByTestId("back-link");
    expect(back).toHaveAttribute("href", "/teach");
    expect(back).toHaveTextContent("Courses");
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav.querySelectorAll("li")).toHaveLength(1);
  });

  it("has no back link on the top level", () => {
    render(<TeacherTopBar crumbs={[{ label: "Courses" }]} />);
    expect(screen.queryByTestId("back-link")).toBeNull();
  });
});
