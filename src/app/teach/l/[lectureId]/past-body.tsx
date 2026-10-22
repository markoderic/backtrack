import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { formatLectureDate } from "@/lib/lectureDate";
import { Icon } from "@/components/Icon";
import { LectureData } from "./live/LectureData";
import { RenameForm } from "./RenameForm";
import { DeleteLecture } from "../../DeleteLecture";
import { readTeacherName } from "../../teacher";
import { buttonSecondaryClass } from "@/components/ButtonPrimary";
import { TeacherTopBar, splitCourseName } from "../../ui";

// Lectures happen at Miami (Ohio), and lecture_date is already the Eastern date.
const clock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
/** "2026-10-21T14:02:00Z" -> "10:02" (Eastern, no AM or PM, as in the design). */
function clockTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return clock.format(d).replace(/\s?[AP]M$/i, "");
}

/** "Oct 21, 10:02 to 10:55", or just the date when a time is missing. */
export function lectureWhen(date: string, startedAt?: string | null, endedAt?: string | null): string {
  const from = clockTime(startedAt);
  const to = clockTime(endedAt);
  const day = formatLectureDate(date);
  return from && to ? `${day}, ${from} to ${to}` : from ? `${day}, ${from}` : day;
}

export async function PastBody({ params }: { params: Promise<{ lectureId: string }> }) {
  const { lectureId } = await params;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/teach");

  // Students who joined a lecture can read it too, so ownership is asked for
  // explicitly: only a lecture of one of this teacher's own courses comes back.
  const { data: lecture, error } = await supabase
    .from("lectures")
    .select(
      "id, course_id, name, status, lecture_date, slide_count, started_at, ended_at, courses!inner(teacher_id, name)",
    )
    .eq("id", lectureId)
    .eq("courses.teacher_id", user.id)
    .maybeSingle();
  // 22P02 is a malformed uuid in the url. Any other error is a real failure, not a missing lecture.
  if (error && error.code !== "22P02") throw new Error(error.message);
  if (!lecture) notFound();

  // A lecture that is still going has its own page, with the End button.
  if (lecture.status === "live") redirect(`/teach/l/${lecture.id}/live`);

  const { data: slideRows, error: slidesError } = await supabase
    .from("slides")
    .select("number, first_line")
    .eq("lecture_id", lecture.id)
    .order("number");
  if (slidesError) throw new Error(slidesError.message);

  const firstLines = new Map((slideRows ?? []).map((s) => [s.number, s.first_line]));
  const slides = Array.from({ length: lecture.slide_count }, (_, i) => ({
    number: i + 1,
    first_line: firstLines.get(i + 1) ?? "",
  }));

  const teacherName = await readTeacherName(supabase, user.id);
  const courseRel = (lecture as { courses?: { name?: string } | { name?: string }[] }).courses;
  const courseName = (Array.isArray(courseRel) ? courseRel[0]?.name : courseRel?.name) ?? "";
  const { code } = splitCourseName(courseName);
  // Joined, lost taps and the rest are in the data view's summary row right under this.
  const when = lectureWhen(lecture.lecture_date, lecture.started_at, lecture.ended_at);

  // The data view reads only the numbers, never the slide images.
  return (
    <div className="flex min-h-screen flex-col">
      <TeacherTopBar
        crumbs={[
          { label: "Courses", href: "/teach" },
          ...(code ? [{ label: code, href: `/teach/c/${lecture.course_id}` }] : []),
          { label: lecture.name },
        ]}
        teacherName={teacherName}
      />
      <LectureData
        lectureId={lecture.id}
        mode="past"
        lectureName={lecture.name}
        slides={slides}
        courseId={lecture.course_id}
        teacherId={user.id}
      >
        {/* The heading of the past lecture (Figma 34:1117): name to rename, when it ran, export, delete. */}
        <div className="flex animate-page-in flex-wrap items-center gap-x-8 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <RenameForm lectureId={lecture.id} initialName={lecture.name} />
            <p className="type-small text-secondary">{when}</p>
          </div>
          <div className="min-w-0 flex-1" />
          {/* A plain link, not next/link: it downloads a file and must not be prefetched as a page. */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <a href={`/teach/l/${lecture.id}/export`} download className={buttonSecondaryClass}>
              <Icon name="download" size={18} />
              Export this lecture
            </a>
            <DeleteLecture lectureId={lecture.id} lectureName={lecture.name} variant="page" />
          </div>
        </div>
      </LectureData>
    </div>
  );
}
