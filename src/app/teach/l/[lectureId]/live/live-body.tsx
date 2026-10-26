import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { LectureData } from "./LectureData";
import { readTeacherName } from "../../../teacher";
import { TeacherTopBar, splitCourseName } from "../../../ui";

export type LiveSearchParams = Promise<{ end?: string | string[] }>;

export async function LiveBody({
  params,
  searchParams,
}: {
  params: Promise<{ lectureId: string }>;
  searchParams: LiveSearchParams;
}) {
  const { lectureId } = await params;
  const { end } = await searchParams;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/teach");

  // Students who joined a lecture can read it too, so ownership is asked for
  // explicitly: only a lecture of one of this teacher's own courses comes back.
  const read = (withSection: boolean) =>
    supabase
      .from("lectures")
      .select(
        withSection
          ? "id, course_id, name, code, status, current_slide, slide_count, courses!inner(teacher_id, name, section)"
          : "id, course_id, name, code, status, current_slide, slide_count, courses!inner(teacher_id, name)",
      )
      .eq("id", lectureId)
      .eq("courses.teacher_id", user.id)
      .maybeSingle();
  // The course's section is in the breadcrumb ("ACC 221 A"); before migration 0018 it is not there.
  let res = await read(true);
  if (res.error?.code === "42703") res = await read(false);
  const { data: lecture, error } = res;
  // 22P02 is a malformed uuid in the url. Any other error is a real failure, not a missing lecture.
  if (error && error.code !== "22P02") throw new Error(error.message);
  if (!lecture) notFound();

  // A lecture that already ended has its own page, with its heading, rename and export.
  // ?end=1 is dropped there: an ended lecture has nothing to end.
  if (lecture.status === "ended") redirect(`/teach/l/${lecture.id}`);

  // The slides and the teacher's name (a label only; it never throws) are read together.
  const [{ data: slideRows, error: slidesError }, teacherName] = await Promise.all([
    supabase.from("slides").select("number, first_line").eq("lecture_id", lecture.id).order("number"),
    readTeacherName(supabase, user.id),
  ]);
  if (slidesError) throw new Error(slidesError.message);

  const firstLines = new Map((slideRows ?? []).map((s) => [s.number, s.first_line]));
  const slides = Array.from({ length: lecture.slide_count }, (_, i) => ({
    number: i + 1,
    first_line: firstLines.get(i + 1) ?? "",
  }));

  type CourseRel = { name?: string; section?: string | null };
  const courseRel = (lecture as { courses?: CourseRel | CourseRel[] }).courses;
  const course = Array.isArray(courseRel) ? courseRel[0] : courseRel;
  const courseCode = splitCourseName(course?.name ?? "").code;

  return (
    <div className="flex min-h-screen flex-col">
      <TeacherTopBar
        crumbs={[
          { label: "Courses", href: "/teach" },
          ...(courseCode ? [{ label: courseCode, section: course?.section ?? null, href: `/teach/c/${lecture.course_id}` }] : []),
          { label: lecture.name },
        ]}
        teacherName={teacherName}
      />
      <LectureData
        lectureId={lecture.id}
        mode="live"
        lectureName={lecture.name}
        slides={slides}
        initialCurrentSlide={lecture.current_slide}
        courseId={lecture.course_id}
        code={lecture.code}
        // ?end=1 comes from the End class links.
        confirmEndOnLoad={end === "1"}
        teacherId={user.id}
      />
    </div>
  );
}
