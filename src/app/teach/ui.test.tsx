import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TeacherTopBar, hitAreaBelowClass, hitAreaClass, textLinkBelowClass, textLinkClass } from "./ui";

describe("hit areas", () => {
  it("text actions get an invisible ::after box that makes the 20 px text 44 px tall", () => {
    // -inset-y-3: 12 px above and below. Below variant: 4 px up, 20 px down.
    expect(hitAreaClass).toBe("relative after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']");
    expect(hitAreaBelowClass).toContain("after:-top-1 after:-bottom-5");
    expect(textLinkClass).toContain(hitAreaClass);
    expect(textLinkBelowClass).toContain(hitAreaBelowClass);
    expect(textLinkClass).not.toContain("after:-bottom-5");
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

  it("gives phones a back link to the page one level up (the breadcrumb is hidden there)", () => {
    render(<TeacherTopBar crumbs={crumbs} />);
    const back = screen.getByTestId("back-link");
    expect(back).toHaveAttribute("href", "/teach/c/c1");
    expect(back).toHaveTextContent("ACC 221");
    expect(back.className).toContain("sm:hidden");
    expect(back.className).toContain("after:-inset-y-3");
  });

  it("has no back link on the top level", () => {
    render(<TeacherTopBar crumbs={[{ label: "Courses" }]} />);
    expect(screen.queryByTestId("back-link")).toBeNull();
  });
});
