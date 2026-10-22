import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isMiamiEmail } from "@/lib/email";
import { AddCourseForm } from "../add-course-form";
import { TeacherPage, labelClass, staggerClass, staggerStyle } from "../ui";
import { CourseRow } from "./CourseRow";
import { NameForm } from "./NameForm";
import { SignOut } from "./SignOut";

/**
 * Settings (Figma 34:1246): the teacher's name, their courses with Rename, Add a course, and
 * who is signed in with Sign out. Left out on purpose: the Theme choice (dark mode comes later),
 * Archive on each course (needs Marko), and recovery codes (the password fallback was never built).
 */
export async function SettingsBody() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isMiamiEmail(user.email)) redirect("/teach");

  const { data: teacher } = await supabase
    .from("teachers")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();
  if (!teacher) redirect("/teach");
  if (!teacher.display_name) redirect("/teach/setup");

  const { data: courses, error } = await supabase
    .from("courses")
    .select("id, name")
    .eq("teacher_id", user.id)
    .eq("archived", false)
    .order("created_at");
  if (error) throw new Error(error.message);
  const list = (courses ?? []) as { id: string; name: string }[];

  return (
    <TeacherPage
      crumbs={[{ label: "Settings" }]}
      back={{ label: "Courses", href: "/teach" }}
      teacherName={teacher.display_name}
      onSettings
    >
      <main className="mx-auto flex w-full max-w-[784px] animate-page-in flex-col gap-8 px-4 py-12 sm:px-8">
        <h1 className="type-display text-ink">Settings</h1>
        <NameForm initialName={teacher.display_name} />
        <section aria-labelledby="settings-courses" className="flex flex-col">
          <h2 id="settings-courses" className={labelClass}>
            Courses
          </h2>
          {list.length > 0 && (
            <ul className="flex flex-col">
              {list.map((course, i) => (
                <li key={course.id} className={`border-t border-hairline ${staggerClass}`} style={staggerStyle(i)}>
                  <CourseRow courseId={course.id} initialName={course.name} />
                </li>
              ))}
            </ul>
          )}
          <AddCourseForm startOpen={list.length === 0} />
        </section>
        <SignOut email={user.email ?? null} />
      </main>
    </TeacherPage>
  );
}
