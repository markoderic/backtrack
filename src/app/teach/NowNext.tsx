"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ButtonPrimaryLink } from "@/components/ButtonPrimary";
import { useShownAgain } from "@/lib/useShownAgain";
import {
  colorPaint,
  formatDays,
  formatTimeRange,
  nowAndNext,
  whenLabel,
  type CourseDetails,
} from "@/lib/courseDetails";
import { splitCourseName } from "./ui";

export type ScheduledCourse = { id: string; name: string; details: CourseDetails };

/** How often the block looks at the clock again while the page stays open. */
export const TICK_MS = 30_000;

/**
 * The top of the courses dashboard (batch D): the course meeting right now (15 minutes either
 * side of its time) with a big Start lecture, or else the next meeting this week. Hidden when no
 * course has days and a time. A course that already has a live lecture is never Now (its Live
 * now row above says it).
 * `initialNow` is the server's clock, so the first render here matches the server's (and a newer
 * one from a refresh is taken at once); after that the browser's clock moves it on right after
 * mount, every 30 s, whenever the tab comes back and whenever Next shows the kept page again.
 */
export function NowNext({
  courses,
  liveCourseIds,
  initialNow,
}: {
  courses: ScheduledCourse[];
  liveCourseIds: string[];
  initialNow: number;
}) {
  const [now, setNow] = useState(initialNow);
  // A newer server time (router.refresh, or the page rendered again) replaces the clock at once.
  const [seenInitial, setSeenInitial] = useState(initialNow);
  if (initialNow !== seenInitial) {
    setSeenInitial(initialNow);
    setNow(initialNow);
  }

  useEffect(() => {
    const tick = () => setNow(Date.now());
    // Right after mount too (just after hydration, so the first render still matches the server's).
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, TICK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Next keeps the dashboard alive while the teacher is on another page: look at the clock again
  // the moment it is shown, not up to 30 s later.
  useShownAgain(() => setNow(Date.now()));

  const live = new Set(liveCourseIds);
  const { now: current, next } = nowAndNext(courses, new Date(now), (c) => live.has(c.id));

  if (current) {
    const { code, title } = splitCourseName(current.course.name);
    const d = current.course.details;
    return (
      <section
        aria-label="Now"
        data-testid="now-next"
        data-state="now"
        className="mb-10 flex animate-rise-in flex-wrap items-center gap-x-8 gap-y-5 border-y border-hairline py-6"
      >
        <span
          aria-hidden
          data-course-color={d.color ?? "none"}
          className={`w-1.5 self-stretch rounded-full ${colorPaint(d.color).className}`}
          style={colorPaint(d.color).style}
        />
        <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
          <p className="type-small-strong text-secondary">Now</p>
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-3">
            <Link href={`/teach/c/${current.course.id}`} className="press focus-ring rounded-sm type-display text-ink">
              {code}
            </Link>
            {d.section && <span className="type-body-strong text-secondary">{d.section}</span>}
          </p>
          {title && <p className="truncate type-lecture text-secondary">{title}</p>}
          <p className="type-small text-ink">
            {formatDays(d.meetDays)} · {formatTimeRange(current.start, current.end)}
          </p>
        </div>
        <ButtonPrimaryLink href={`/teach/c/${current.course.id}/start`} aria-label={`Start lecture in ${code}`}>
          Start lecture
        </ButtonPrimaryLink>
      </section>
    );
  }

  if (next) {
    const { code } = splitCourseName(next.course.name);
    const d = next.course.details;
    return (
      <section
        aria-label="Next"
        data-testid="now-next"
        data-state="next"
        className="mb-10 flex animate-rise-in flex-wrap items-center gap-x-3 gap-y-1 border-y border-hairline py-4"
      >
        <span
          aria-hidden
          data-course-color={d.color ?? "none"}
          className={`size-2.5 shrink-0 rounded-full ${colorPaint(d.color).className}`}
          style={colorPaint(d.color).style}
        />
        <span className="type-small-strong text-secondary">Next</span>
        <Link href={`/teach/c/${next.course.id}`} className="press focus-ring rounded-sm type-body-strong text-ink">
          {code}
          {d.section ? `, ${d.section}` : ""}
        </Link>
        <span className="type-body text-secondary">{whenLabel(next)}</span>
      </section>
    );
  }

  return null;
}
