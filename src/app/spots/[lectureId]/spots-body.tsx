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
    .select("name, lecture_date, slide_count")
    .eq("id", lectureId)
    .maybeSingle();
  // 22P02 is a malformed uuid in the url. Any other error is a real failure.
  if (error && error.code !== "22P02") throw new Error(error.message);
  if (!lecture) redirect("/join");

  return (
    <SpotsView
      lectureId={lectureId}
      userId={user.id}
      lectureName={lecture.name}
      lectureDate={lecture.lecture_date}
      slideCount={lecture.slide_count}
    />
  );
}
