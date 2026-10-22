import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isMiamiEmail } from "@/lib/email";
import { SignInButton } from "./sign-in-button";
import { AddCourseForm } from "./add-course-form";
import { LiveLectureRow } from "./LiveLectureRow";

export async function TeachBody({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && isMiamiEmail(user.email)) {
    const { data: teacher } = await supabase
      .from("teachers")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();
    if (teacher && !teacher.display_name) redirect("/teach/setup");
    if (teacher) {
      const { data: courses, error: coursesError } = await supabase
        .from("courses")
        .select("id, name")
        .eq("archived", false)
        .order("created_at");
      if (coursesError) throw new Error(coursesError.message);
      // Joined students can read the lectures they joined, so ask for the
      // teacher's own courses explicitly instead of relying on row level security.
      const { data: live, error: liveError } = await supabase
        .from("lectures")
        .select("id, name, courses!inner(teacher_id)")
        .eq("status", "live")
        .eq("courses.teacher_id", user.id)
        .order("started_at", { ascending: false });
      if (liveError) throw new Error(liveError.message);
      return (
        <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 p-4">
          <h1 className="text-4xl font-semibold">Backtrack</h1>
          <p>{teacher.display_name}</p>
          {(live ?? []).map((lecture) => (
            <LiveLectureRow key={lecture.id} id={lecture.id} name={lecture.name} />
          ))}
          <h2 className="text-2xl font-semibold">Courses</h2>
          <ul className="flex flex-col gap-2">
            {(courses ?? []).map((course) => (
              <li key={course.id}>
                <Link href={`/teach/c/${course.id}`} className="block border border-current px-4 py-3">
                  {course.name}
                </Link>
              </li>
            ))}
          </ul>
          <AddCourseForm />
        </main>
      );
    }
  }

  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4 text-center">
      <h1 className="text-4xl font-semibold">Backtrack</h1>
      {error === "signin" && <p>Sign in didn&apos;t finish. Try again.</p>}
      <SignInButton />
    </main>
  );
}

export default function TeachPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  return (
    <Suspense fallback={null}>
      <TeachBody searchParams={searchParams} />
    </Suspense>
  );
}
