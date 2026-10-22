import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { LectureData } from "./live/LectureData";
import { RenameForm } from "./RenameForm";

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
    .select("id, course_id, name, status, lecture_date, slide_count, courses!inner(teacher_id)")
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

  // The data view reads only the numbers, never the slide images.
  return (
    <LectureData
      lectureId={lecture.id}
      mode="past"
      lectureName={lecture.name}
      lectureDate={lecture.lecture_date}
      slides={slides}
      courseId={lecture.course_id}
    >
      <RenameForm lectureId={lecture.id} initialName={lecture.name} />
    </LectureData>
  );
}
