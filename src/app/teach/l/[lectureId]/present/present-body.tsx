import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { siteAddress } from "@/lib/siteAddress";
import { Projector } from "./Projector";
import { ClassEnded } from "./ClassEnded";

export async function PresentBody({ params }: { params: Promise<{ lectureId: string }> }) {
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
    .select("id, course_id, code, status, current_slide, slide_count, courses!inner(teacher_id)")
    .eq("id", lectureId)
    .eq("courses.teacher_id", user.id)
    .maybeSingle();
  // 22P02 is a malformed uuid in the url. Any other error is a real failure, not a missing lecture.
  if (error && error.code !== "22P02") throw new Error(error.message);
  if (!lecture) notFound();

  if (lecture.status === "ended") return <ClassEnded courseId={lecture.course_id} />;

  return (
    <Projector
      lectureId={lecture.id}
      code={lecture.code}
      siteAddress={siteAddress()}
      initialSlide={lecture.current_slide}
      slideCount={lecture.slide_count}
      courseId={lecture.course_id}
    />
  );
}
