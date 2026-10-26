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
  const read = (columns: string) => supabase.from("courses").select(columns).eq("id", courseId).maybeSingle();
  // The section is in the breadcrumb ("ACC 221 A"); before migration 0018 the column is not there.
  let res = await read("id, name, section");
  if (res.error?.code === "42703") res = await read("id, name");
  const { error } = res;
  const course = res.data as { id: string; name: string; section?: string | null } | null;
  // 22P02 is a malformed uuid in the url. Any other error is a real failure, not a missing course.
  if (error && error.code !== "22P02") throw new Error(error.message);
  if (!course) notFound();

  const [{ count, error: countError }, teacherName] = await Promise.all([
    supabase.from("lectures").select("id", { count: "exact", head: true }).eq("course_id", course.id),
    readTeacherName(supabase, user.id),
  ]);
  if (countError) throw new Error(countError.message);

  const code = splitCourseName(course.name).code;
  return (
    <TeacherPage
      crumbs={[
        { label: "Courses", href: "/teach" },
        { label: code, section: course.section ?? null, href: `/teach/c/${course.id}` },
        { label: "Start lecture" },
      ]}
      teacherName={teacherName}
    >
      {/* Figma 33:979: a 720 wide column (360 side padding at 1440). */}
      <main className="mx-auto flex w-full max-w-[784px] animate-page-in flex-col gap-7 px-4 py-12 sm:px-8">
        <h1 className="type-display text-ink">Start lecture</h1>
        <StartForm courseId={course.id} existingCount={count ?? 0} />
      </main>
    </TeacherPage>
  );
}
