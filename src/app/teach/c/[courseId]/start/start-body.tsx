import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { readTeacherName } from "../../../teacher";
import { TeacherPage, splitCourseName } from "../../../ui";
import { StartForm } from "./start-form";

export async function StartBody({ params }: { params: Promise<{ courseId: string }> }) {
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

  const [{ count, error: countError }, teacherName] = await Promise.all([
    supabase.from("lectures").select("id", { count: "exact", head: true }).eq("course_id", course.id),
    readTeacherName(supabase, user.id),
  ]);
  if (countError) throw new Error(countError.message);

  const { code } = splitCourseName(course.name);
  return (
    <TeacherPage
      crumbs={[
        { label: "Courses", href: "/teach" },
        { label: code, href: `/teach/c/${course.id}` },
        { label: "Start lecture" },
      ]}
      teacherName={teacherName}
    >
      {/* Figma 33:979: a 720 wide column (360 side padding at 1440). */}
      <main className="mx-auto flex w-full max-w-[784px] animate-rise-in flex-col gap-7 px-4 py-12 sm:px-8">
        <h1 className="type-display text-ink">Start lecture</h1>
        <StartForm courseId={course.id} existingCount={count ?? 0} />
      </main>
    </TeacherPage>
  );
}
