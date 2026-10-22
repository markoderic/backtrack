import Link from "next/link";
import { LogoLockup } from "@/components/Logo";
import { hitAreaClass } from "./ui";

/*
 * Loading skeletons for the teacher pages: what shows the moment a teacher clicks, before the
 * page's data is back (loading.tsx, and the Suspense fallback inside each page). Quiet hairline
 * blocks where the content will be, in the same layout as the page, so nothing jumps when it
 * arrives. No spinner and no shimmer: the blocks only fade in (opacity, so it is the same with
 * reduced motion), after a short delay so a fast page never flashes them. Words that are known
 * before any data (Courses, Settings, Start lecture) are shown for real.
 */

/** One placeholder block: hairline colored, radius sm. Width and height in Tailwind classes. */
export function Bone({ className = "" }: { className?: string }) {
  return <span aria-hidden data-bone className={`block shrink-0 rounded-sm bg-hairline ${className}`} />;
}

/**
 * The whole skeleton page: told to screen readers once as "Loading" (a status that is busy),
 * and faded in after 120 ms so a page that is ready at once never flashes a skeleton.
 */
function SkeletonShell({ crumbs, children }: { crumbs: React.ReactNode; children: React.ReactNode }) {
  return (
    <div data-testid="teacher-skeleton" aria-busy="true" className="flex min-h-screen flex-col">
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-hairline px-4 sm:gap-6 sm:px-8">
        <Link href="/teach" aria-label="backtrack, courses" className="press focus-ring shrink-0 rounded-sm">
          <LogoLockup size="S" />
        </Link>
        <div className="hidden min-w-0 items-center gap-2 type-small whitespace-nowrap sm:flex">{crumbs}</div>
        <div className="min-w-0 flex-1" />
        <Bone className="hidden h-4 w-24 sm:block" />
        <Link
          href="/teach/settings"
          className={`press focus-ring shrink-0 rounded-sm type-small-strong whitespace-nowrap text-ink hover:text-ink-hover ${hitAreaClass}`}
        >
          Settings
        </Link>
      </header>
      <p role="status" className="sr-only">
        Loading
      </p>
      <div className="flex flex-1 flex-col animate-[fade-in_var(--dur-base)_var(--ease-out)_120ms_both]">
        {children}
      </div>
    </div>
  );
}

const Slash = () => (
  <span aria-hidden className="text-secondary">
    /
  </span>
);

/** Courses (the dashboard, /teach): the heading, three course rows, Add a course. */
export function CoursesSkeleton() {
  return (
    <SkeletonShell crumbs={<span className="type-small-strong text-ink">Courses</span>}>
      <main className="mx-auto flex w-full max-w-[1104px] flex-col gap-2 px-4 py-12 sm:px-8">
        <h1 className="type-display text-ink">Courses</h1>
        <ul aria-hidden className="flex flex-col pt-6">
          {/* Different widths, so the rows read as names and not as a grid. */}
          {["w-[min(400px,80%)]", "w-[min(320px,70%)]", "w-[min(360px,75%)]"].map((w, i) => (
            <li key={i} className="flex flex-col gap-2 border-t border-hairline py-6">
              <Bone className={`h-6 ${w}`} />
              <Bone className="h-4 w-[min(220px,60%)]" />
            </li>
          ))}
        </ul>
        <Bone className="mt-4 h-11 w-32" />
      </main>
    </SkeletonShell>
  );
}

/** A course page (/teach/c/[courseId]): code and title, Start lecture, and the past lectures table. */
export function CourseSkeleton() {
  return (
    <SkeletonShell
      crumbs={
        <>
          <span className="text-secondary">Courses</span>
          <Slash />
          <Bone className="h-4 w-16" />
        </>
      }
    >
      <main className="mx-auto flex w-full max-w-[1104px] flex-col gap-2 px-4 py-12 sm:px-8">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-6">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Bone className="h-9 w-36" />
            <Bone className="h-6 w-[min(360px,90%)]" />
          </div>
          <Bone className="h-12 w-40" />
        </div>
        <section aria-hidden className="flex flex-col pt-10">
          <div className="flex items-center gap-6 pb-3">
            <Bone className="h-6 w-36" />
            <div className="flex-1" />
            <Bone className="h-11 w-48" />
          </div>
          <div className="border-t border-hairline py-4">
            <Bone className="h-4 w-full max-w-160" />
          </div>
          {["w-[min(340px,60%)]", "w-[min(280px,55%)]", "w-[min(380px,65%)]", "w-[min(300px,58%)]", "w-[min(260px,50%)]"].map(
            (w, i) => (
              <div key={i} className="flex items-center gap-4 border-t border-hairline py-4">
                <Bone className="h-5 w-14 sm:w-20" />
                <Bone className={`h-5 ${w}`} />
                <div className="flex-1" />
                <Bone className="hidden h-5 w-8 md:block" />
                <Bone className="hidden h-5 w-8 md:block" />
                <Bone className="h-11 w-11" />
              </div>
            ),
          )}
        </section>
      </main>
    </SkeletonShell>
  );
}

/** A past lecture (/teach/l/[lectureId]): its name and time, Export and Delete, the summary row, the chart and the side panel. */
export function PastLectureSkeleton() {
  return (
    <SkeletonShell
      crumbs={
        <>
          <span className="text-secondary">Courses</span>
          <Slash />
          <Bone className="h-4 w-16" />
          <Slash />
          <Bone className="h-4 w-40" />
        </>
      }
    >
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-4 pt-8 pb-6 sm:px-12">
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <Bone className="h-8 w-[min(420px,90%)]" />
            <Bone className="h-4 w-44" />
          </div>
          <div className="flex gap-3">
            <Bone className="h-11 w-44" />
            <Bone className="h-11 w-36" />
          </div>
        </div>
        <div aria-hidden className="flex flex-wrap gap-x-12 gap-y-5 border-t border-hairline px-4 py-6 sm:px-12">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Bone className="h-4 w-20" />
              <Bone className="h-9 w-16" />
            </div>
          ))}
        </div>
        <div aria-hidden className="flex flex-1 flex-col border-t border-hairline lg:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-6 px-4 py-8 sm:px-12">
            <Bone className="h-4 w-32" />
            <div className="flex h-[260px] items-end gap-3">
              {[30, 55, 20, 80, 45, 100, 35, 60, 25, 40].map((h, i) => (
                <span key={i} className="block h-full max-w-9 min-w-3 flex-1">
                  <span className="flex h-full items-end">
                    <span className="block w-full rounded-sm bg-hairline" style={{ height: `${h}%` }} />
                  </span>
                </span>
              ))}
            </div>
          </div>
          <div className="flex w-full shrink-0 flex-col gap-4 border-t border-hairline px-4 py-8 sm:p-8 lg:w-[480px] lg:border-t-0 lg:border-l">
            <Bone className="h-6 w-40" />
            <Bone className="aspect-video h-auto w-full rounded-sm" />
            <Bone className="h-4 w-3/4" />
            <Bone className="h-4 w-1/2" />
          </div>
        </div>
      </main>
    </SkeletonShell>
  );
}

/** Settings (/teach/settings): the name field, the course rows, Sign out. */
export function SettingsSkeleton() {
  return (
    <SkeletonShell crumbs={<span className="type-small-strong text-ink">Settings</span>}>
      <main className="mx-auto flex w-full max-w-[784px] flex-col gap-8 px-4 py-12 sm:px-8">
        <h1 className="type-display text-ink">Settings</h1>
        <div aria-hidden className="flex flex-col gap-2">
          <Bone className="h-5 w-52" />
          <Bone className="h-12 w-120 max-w-full rounded-md" />
        </div>
        <div aria-hidden className="flex flex-col">
          <Bone className="mb-2 h-5 w-20" />
          {["w-[min(380px,60%)]", "w-[min(320px,55%)]", "w-[min(350px,58%)]"].map((w, i) => (
            <div key={i} className="flex items-center gap-3 border-t border-hairline py-2">
              <Bone className={`h-5 ${w}`} />
              <div className="flex-1" />
              <Bone className="h-11 w-22" />
              <Bone className="h-11 w-22" />
            </div>
          ))}
        </div>
        <div aria-hidden className="flex items-center gap-4">
          <Bone className="h-5 w-64 max-w-full" />
          <Bone className="h-11 w-24" />
        </div>
      </main>
    </SkeletonShell>
  );
}

/** Start lecture (/teach/c/[courseId]/start): the Name field, the drop zone, Start lecture. */
export function StartSkeleton() {
  return (
    <SkeletonShell
      crumbs={
        <>
          <span className="text-secondary">Courses</span>
          <Slash />
          <Bone className="h-4 w-16" />
          <Slash />
          <span className="type-small-strong text-ink">Start lecture</span>
        </>
      }
    >
      <main className="mx-auto flex w-full max-w-[784px] flex-col gap-7 px-4 py-12 sm:px-8">
        <h1 className="type-display text-ink">Start lecture</h1>
        <div aria-hidden className="flex flex-col gap-7">
          <div className="flex flex-col gap-2">
            <Bone className="h-5 w-12" />
            <Bone className="h-12 w-full rounded-md" />
          </div>
          <Bone className="h-60 w-full rounded-md" />
          <Bone className="h-12 w-40 rounded-md" />
        </div>
      </main>
    </SkeletonShell>
  );
}
