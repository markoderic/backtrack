import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { StudentLecture } from "./StudentLecture";

export async function LectureBody({ params }: { params: Promise<{ lectureId: string }> }) {
  const { lectureId } = await params;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/join");

  // No row unless this user joined the lecture (or owns it).
  const { data: headers, error: headerError } = await supabase.rpc("lecture_header", { p_lecture_id: lectureId });
  // 22P02 is a malformed uuid in the url. Any other error is a real failure.
  if (headerError && headerError.code !== "22P02") throw new Error(headerError.message);
  const header = headers?.[0];
  if (!header) redirect("/join");

  // Not the slide count: the student screen never reads it.
  const { data: lecture, error } = await supabase
    .from("lectures")
    .select("current_slide, status")
    .eq("id", lectureId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!lecture) redirect("/join");
  if (lecture.status === "ended") redirect(`/spots/${lectureId}`);

  return (
    <StudentLecture
      lectureId={lectureId}
      lectureName={header.lecture_name}
      courseName={header.course_name}
      initialSlide={lecture.current_slide}
    />
  );
}
