import Link from "next/link";
import { buttonSecondaryClass } from "@/components/ButtonPrimary";
import { colorPaint, scheduleLabel, type CourseDetails } from "@/lib/courseDetails";
import { CourseMenu } from "./CourseMenu";
import { CourseTitle, courseTitleSpoken, courseTitleText, splitCourseName, staggerClass, staggerStyle } from "./ui";

/**
 * One course on the dashboard (batch D): a card with the course's color as a bar down its left
 * side, the code with the section as one title ("IMS 452 B", batch L), the course title, when it meets, how many lectures it has had, and Start
 * lecture (Resume while one of its lectures is live). The whole card opens the course page (the
 * name is the link, stretched over the card); the button sits above that link. The ⋯ menu in the
 * top right corner (batch H) sits above it too: Download CSV, Edit details, Rename, Archive.
 * No white fill behind the content (design brief: surface is never a card behind content): a
 * hairline outline on the page background, white only as a hover.
 */
export function CourseCard({
  id,
  name,
  details,
  meta,
  liveLectureId,
  index,
  options,
  onArchive,
  announce,
}: {
  id: string;
  name: string;
  /** Null before migration 0018: no bar color, section or schedule. */
  details: CourseDetails | null;
  /** "8 lectures, last on Oct 21", or null when that read failed. */
  meta: string | null;
  /** A lecture of this course that is live now. */
  liveLectureId?: string | null;
  index: number;
  /** Migration 0019 is in: the new colors and Custom in Edit details. */
  options: boolean;
  onArchive: () => Promise<boolean>;
  announce: (text: string) => void;
}) {
  const { code, title } = splitCourseName(name);
  const spoken = courseTitleSpoken(code, details?.section);
  const schedule = details ? scheduleLabel(details) : null;
  const color = details?.color ?? null;
  const paint = colorPaint(color);
  return (
    <li className={`flex ${staggerClass}`} style={staggerStyle(index)} data-testid="course-card">
      <article
        className={
          "group relative flex min-w-0 flex-1 overflow-hidden rounded-md border border-hairline " +
          "transition-[background-color,border-color,outline-color,scale] duration-(--dur-fast) ease-out hover:border-strip hover:bg-surface " +
          "motion-safe:has-[[data-card-link]:active]:scale-[0.99] " +
          // The name's link covers the card, so the card shows its focus ring (the name is cut to one line).
          "outline-0 outline-offset-4 outline-transparent has-[[data-card-link]:focus-visible]:outline-2 has-[[data-card-link]:focus-visible]:outline-ink"
        }
      >
        <span
          aria-hidden
          data-course-color={color ?? "none"}
          className={`w-1.5 shrink-0 ${paint.className}`}
          style={paint.style}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1 py-5 pr-5 pl-4">
          {/* Room on the right for the ⋯ button. */}
          <div className="flex min-w-0 items-baseline gap-3 pr-10">
            {/* The section is part of the title: same size and weight (Marko, hand test 3). */}
            <h2 className="min-w-0 flex-1 truncate type-title text-ink">
              <Link
                href={`/teach/c/${id}`}
                data-card-link
                className="rounded-sm outline-none after:absolute after:inset-0 after:content-['']"
              >
                <CourseTitle code={code} section={details?.section} />
              </Link>
            </h2>
          </div>
          {title && <p className="truncate type-lecture text-secondary">{title}</p>}
          <div className="flex flex-col gap-0.5 pt-2">
            {schedule && <p className="type-small text-ink">{schedule}</p>}
            {meta && <p className="type-small text-secondary">{meta}</p>}
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-3 pt-4">
            {liveLectureId ? (
              <>
                <span className="flex items-center gap-1.5 type-small-strong text-ink">
                  <span aria-hidden className="size-2 shrink-0 rounded-full bg-ink" />
                  Live now
                </span>
                <Link
                  href={`/teach/l/${liveLectureId}/present`}
                  aria-label={`Resume ${spoken}`}
                  className={`${buttonSecondaryClass} relative z-10`}
                >
                  Resume
                </Link>
              </>
            ) : (
              <Link
                href={`/teach/c/${id}/start`}
                aria-label={`Start lecture in ${spoken}`}
                className={`${buttonSecondaryClass} relative z-10`}
              >
                Start lecture
              </Link>
            )}
          </div>
        </div>
        {/* Above the card's link, in the top right corner; after the name in reading and Tab order. */}
        <div className="absolute top-2 right-2 z-10">
          <CourseMenu
            courseId={id}
            name={name}
            code={courseTitleText(code, details?.section)}
            details={details}
            options={options}
            onArchive={onArchive}
            announce={announce}
          />
        </div>
      </article>
    </li>
  );
}
