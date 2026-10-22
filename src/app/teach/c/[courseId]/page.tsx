import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

async function CourseBody({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/teach");

  // Row level security only returns the course to the teacher who owns it.
  const { data: course } = await supabase
    .from("courses")
    .select("id, name")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) notFound();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 p-4">
      <h1 className="text-4xl font-semibold">{course.name}</h1>
      <Link href={`/teach/c/${course.id}/start`} className="self-start border border-current px-6 py-3">
        Start lecture
      </Link>
      <h2 className="text-2xl font-semibold">Past lectures</h2>
      <p>No lectures yet.</p>
    </main>
  );
}

export default function CoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  return (
    <Suspense fallback={null}>
      <CourseBody params={params} />
    </Suspense>
  );
}
