import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { siteAddress } from "@/lib/siteAddress";
import { Projector } from "./Projector";

export async function PresentBody({ params }: { params: Promise<{ lectureId: string }> }) {
  const { lectureId } = await params;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/teach");

  // Row level security only returns the lecture to the teacher who owns it.
  const { data: lecture, error } = await supabase
    .from("lectures")
    .select("id, course_id, code, status, current_slide, slide_count")
    .eq("id", lectureId)
    .maybeSingle();
  // 22P02 is a malformed uuid in the url. Any other error is a real failure, not a missing lecture.
  if (error && error.code !== "22P02") throw new Error(error.message);
  if (!lecture) notFound();

  if (lecture.status === "ended") {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 p-4">
        <p className="text-2xl">This lecture has ended.</p>
        <Link href={`/teach/c/${lecture.course_id}`} className="self-start border border-current px-6 py-3">
          Back to the course
        </Link>
      </main>
    );
  }

  return (
    <Projector
      lectureId={lecture.id}
      code={lecture.code}
      siteAddress={siteAddress()}
      initialSlide={lecture.current_slide}
      slideCount={lecture.slide_count}
    />
  );
}
