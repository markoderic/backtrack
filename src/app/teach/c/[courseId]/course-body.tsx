import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { formatLectureDate } from "@/lib/lectureDate";
import { LiveLectureRow } from "../../LiveLectureRow";

export async function CourseBody({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/teach");

  // Row level security only returns the course to the teacher who owns it, and
  // the query asks for the teacher's own course explicitly as well.
  const { data: course, error } = await supabase
    .from("courses")
    .select("id, name")
    .eq("id", courseId)
    .eq("teacher_id", user.id)
    .maybeSingle();
  // 22P02 is a malformed uuid in the url. Any other error is a real failure, not a missing course.
  if (error && error.code !== "22P02") throw new Error(error.message);
  if (!course) notFound();

  const { data: lectures, error: lecturesError } = await supabase
    .from("lectures")
    .select("id, name, status, lecture_date")
    .eq("course_id", course.id)
    .order("lecture_date", { ascending: false })
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
        <LiveLectureRow key={lecture.id} id={lecture.id} name={lecture.name} />
      ))}
      <h2 className="text-2xl font-semibold">Past lectures</h2>
      {past.length === 0 ? (
        <p>No lectures yet.</p>
      ) : (
        <>
          {/* A plain link, not next/link: it downloads a file and must not be prefetched as a page. */}
          <a href={`/teach/c/${course.id}/export`} download className="self-start border border-current px-4 py-2">
            Export semester CSV
          </a>
          <ul className="flex flex-col gap-2">
            {past.map((lecture) => (
              <li key={lecture.id}>
                <Link
                  href={`/teach/l/${lecture.id}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 border border-current px-4 py-3"
                >
                  <span>{lecture.name}</span>
                  <span>{formatLectureDate(lecture.lecture_date)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
