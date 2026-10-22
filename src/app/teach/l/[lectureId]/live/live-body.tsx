import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { LectureData } from "./LectureData";

export async function LiveBody({ params }: { params: Promise<{ lectureId: string }> }) {
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
    .select("id, course_id, name, status, current_slide, slide_count, courses!inner(teacher_id)")
    .eq("id", lectureId)
    .eq("courses.teacher_id", user.id)
    .maybeSingle();
  // 22P02 is a malformed uuid in the url. Any other error is a real failure, not a missing lecture.
  if (error && error.code !== "22P02") throw new Error(error.message);
  if (!lecture) notFound();

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

  // A lecture that already ended only shows its numbers.
  return (
    <LectureData
      lectureId={lecture.id}
      mode={lecture.status === "ended" ? "past" : "live"}
      lectureName={lecture.name}
      slides={slides}
      initialCurrentSlide={lecture.current_slide}
      courseId={lecture.course_id}
    />
  );
}
