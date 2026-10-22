import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { SpotsView } from "./SpotsView";

export async function SpotsBody({ params }: { params: Promise<{ lectureId: string }> }) {
  const { lectureId } = await params;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/join");

  // No row unless this user joined the lecture (or owns it). Ended lectures are readable.
  const { data: lecture, error } = await supabase
    .from("lectures")
    .select("name, lecture_date, slide_count, status, current_slide, ended_at")
    .eq("id", lectureId)
    .maybeSingle();
  // 22P02 is a malformed uuid in the url. Any other error is a real failure.
  if (error && error.code !== "22P02") throw new Error(error.message);
  if (!lecture) redirect("/join");

  // Students cannot read courses; the course name for the top bar comes from lecture_header.
  const { data: headers, error: headerError } = await supabase.rpc("lecture_header", { p_lecture_id: lectureId });
  if (headerError) throw new Error(headerError.message);

  const live = lecture.status !== "ended";
  return (
    <SpotsView
      lectureId={lectureId}
      userId={user.id}
      courseName={headers?.[0]?.course_name ?? ""}
      lectureName={lecture.name}
      lectureDate={lecture.lecture_date}
      endedAt={live ? null : (lecture.ended_at ?? null)}
      slideCount={lecture.slide_count}
      liveSlide={live ? lecture.current_slide : null}
    />
  );
}
