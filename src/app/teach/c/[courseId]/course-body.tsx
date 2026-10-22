import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

export async function CourseBody({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/teach");

  // Row level security only returns the course to the teacher who owns it.
  const { data: course, error } = await supabase
    .from("courses")
    .select("id, name")
    .eq("id", courseId)
    .maybeSingle();
  // 22P02 is a malformed uuid in the url. Any other error is a real failure, not a missing course.
  if (error && error.code !== "22P02") throw new Error(error.message);
  if (!course) notFound();

  const { data: lectures, error: lecturesError } = await supabase
    .from("lectures")
    .select("id, name, status, lecture_date")
    .eq("course_id", course.id)
    .order("started_at", { ascending: false });
  if (lecturesError) throw new Error(lecturesError.message);
  const live = (lectures ?? []).filter((l) => l.status === "live");
  const past = (lectures ?? []).filter((l) => l.status !== "live");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 p-4">
      <h1 className="text-4xl font-semibold">{course.name}</h1>
      <Link href={`/teach/c/${course.id}/start`} className="self-start border border-current px-6 py-3">
        Start lecture
      </Link>
      {live.map((lecture) => (
        <p key={lecture.id} className="flex flex-wrap items-center gap-3">
          <Link href={`/teach/l/${lecture.id}/present`} className="border border-current px-4 py-2">
            Live now: Resume
          </Link>
          <span>{lecture.name}</span>
        </p>
      ))}
      <h2 className="text-2xl font-semibold">Past lectures</h2>
      {past.length === 0 ? (
        <p>No lectures yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {past.map((lecture) => (
            <li key={lecture.id} className="border border-current px-4 py-3">
              {lecture.name}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
