import { describe, it, expect } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { CoursesSkeleton, CourseSkeleton, PastLectureSkeleton, SettingsSkeleton, StartSkeleton } from "./skeletons";
import TeachLoading from "./loading";
import CourseLoading from "./c/[courseId]/loading";
import StartLoading from "./c/[courseId]/start/loading";
import PastLoading from "./l/[lectureId]/(past)/loading";
import SettingsLoading from "./settings/loading";
import TeachPage from "./page";
import CoursePage from "./c/[courseId]/page";
import StartPage from "./c/[courseId]/start/page";
import PastLecturePage from "./l/[lectureId]/(past)/page";
import SettingsPage from "./settings/page";

const all = [
  ["Courses", CoursesSkeleton],
  ["course", CourseSkeleton],
  ["past lecture", PastLectureSkeleton],
  ["Settings", SettingsSkeleton],
  ["Start lecture", StartSkeleton],
] as const;

describe("teacher loading skeletons (Marko: no blank page after a click)", () => {
  it.each(all)("%s: a busy page with the top bar, told to screen readers once as Loading", (_name, Skeleton) => {
    render(<Skeleton />);
    const page = screen.getByTestId("teacher-skeleton");
    expect(page).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    // The logo goes to Courses and Settings works while the page loads.
    expect(screen.getByRole("link", { name: "backtrack, courses" })).toHaveAttribute("href", "/teach");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/teach/settings");
    // Quiet hairline blocks: no spinner, no shimmer, no pulse.
    const bones = page.querySelectorAll("[data-bone]");
    expect(bones.length).toBeGreaterThan(3);
    for (const bone of bones) {
      expect(bone.className).toContain("bg-hairline");
      expect(bone).toHaveAttribute("aria-hidden", "true");
    }
    expect(page.innerHTML).not.toMatch(/animate-(spin|pulse|ping|bounce)|shimmer/);
  });

  it("only fades in (opacity, the same with reduced motion), a moment later, so a fast page never flashes it", () => {
    render(<CourseSkeleton />);
    const content = screen.getByTestId("teacher-skeleton").querySelector("main")!.parentElement!;
    expect(content.className).toContain("animate-[fade-in_var(--dur-base)_var(--ease-out)_120ms_both]");
  });

  it("shows the words that are known before any data for real", () => {
    render(<CoursesSkeleton />);
    expect(screen.getByRole("heading", { name: "Courses" })).toBeInTheDocument();
    render(<SettingsSkeleton />);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    render(<StartSkeleton />);
    expect(screen.getByRole("heading", { name: "Start lecture" })).toBeInTheDocument();
  });

  it("each page's loading.tsx is its skeleton", () => {
    expect(TeachLoading).toBe(CoursesSkeleton);
    expect(CourseLoading).toBe(CourseSkeleton);
    expect(StartLoading).toBe(StartSkeleton);
    expect(PastLoading).toBe(PastLectureSkeleton);
    expect(SettingsLoading).toBe(SettingsSkeleton);
  });

  it("each page shows its skeleton (not nothing) while its data loads", () => {
    const params = Promise.resolve({ lectureId: "l1", courseId: "c1" });
    const searchParams = Promise.resolve({});
    const pages: [ReactElement, unknown][] = [
      [TeachPage({ searchParams }), CoursesSkeleton],
      [CoursePage({ params, searchParams }), CourseSkeleton],
      [StartPage({ params }), StartSkeleton],
      [PastLecturePage({ params }), PastLectureSkeleton],
      [SettingsPage(), SettingsSkeleton],
    ];
    for (const [page, skeleton] of pages) {
      const fallback = (page.props as { fallback?: unknown }).fallback;
      expect(isValidElement(fallback)).toBe(true);
      expect((fallback as ReactElement).type).toBe(skeleton);
    }
  });
});
