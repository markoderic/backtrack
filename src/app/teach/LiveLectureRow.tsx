import Link from "next/link";
import { buttonPrimarySmallClass, buttonSecondaryClass } from "@/components/ButtonPrimary";
import { LectureMenu } from "./LectureMenu";
import { CourseTitle } from "./ui";

/**
 * A class that is running now: its name, and where the teacher can go from here. Resume is the
 * main way back to the projector (black); Data and End class are white secondary buttons; the ⋯
 * menu is the same as on every past lecture row (Delete is off until the class ends). On the
 * dashboard `course` names the course next to Live now.
 */
export function LiveLectureRow({
  id,
  name,
  course,
}: {
  id: string;
  name: string;
  /** The course's code and section ("IMS 452", "B"): the section in a lighter weight. */
  course?: { code: string; section?: string | null } | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-y border-hairline py-4">
      <div className="flex min-w-0 flex-1 basis-60 flex-col">
        <span className="flex items-center gap-1.5 type-small-strong text-ink">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-ink" />
          Live now
          {/* On the dashboard, which course it is (the course page needs no reminder). */}
          {course && (
            <span className="font-normal text-secondary">
              · <CourseTitle code={course.code} section={course.section} tone="regular" />
            </span>
          )}
        </span>
        <span className="truncate type-lecture text-secondary">{name}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/teach/l/${id}/present`} className={buttonPrimarySmallClass}>
          Resume
        </Link>
        <Link href={`/teach/l/${id}/live`} className={buttonSecondaryClass}>
          Data
        </Link>
        <Link href={`/teach/l/${id}/live?end=1`} className={buttonSecondaryClass}>
          End class
        </Link>
        <LectureMenu lectureId={id} lectureName={name} live />
      </div>
    </div>
  );
}
