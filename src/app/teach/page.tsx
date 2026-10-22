import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isMiamiEmail } from "@/lib/email";
import { formatLectureDate } from "@/lib/lectureDate";
import { Icon } from "@/components/Icon";
import { AddCourseForm } from "./add-course-form";
import { LiveLectureRow } from "./LiveLectureRow";
import { SignInView } from "./sign-in-view";
import { TeacherPage, rowLinkClass, staggerClass, staggerStyle } from "./ui";

type LectureMeta = { course_id: string; lecture_date: string };

/** "8 lectures, last on Oct 21", "1 lecture, last on Oct 21" or "No lectures yet". */
function courseMeta(list: LectureMeta[] | undefined): string {
  if (!list || list.length === 0) return "No lectures yet";
  const last = list.reduce((a, b) => (b.lecture_date > a ? b.lecture_date : a), list[0].lecture_date);
  return `${list.length} ${list.length === 1 ? "lecture" : "lectures"}, last on ${formatLectureDate(last)}`;
}

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
      // How many lectures each course has and the last one's date, for the line under its name.
      const { data: held, error: heldError } = await supabase
        .from("lectures")
        .select("course_id, lecture_date, courses!inner(teacher_id)")
        .eq("courses.teacher_id", user.id)
        .order("lecture_date", { ascending: false });
      if (heldError) throw new Error(heldError.message);
      const byCourse = new Map<string, LectureMeta[]>();
      for (const l of (held ?? []) as LectureMeta[]) {
        byCourse.set(l.course_id, [...(byCourse.get(l.course_id) ?? []), l]);
      }

      const list = courses ?? [];
      return (
        <TeacherPage crumbs={[{ label: "Courses" }]} teacherName={teacher.display_name}>
          <main className="mx-auto flex w-full max-w-[1104px] animate-rise-in flex-col gap-2 px-4 py-12 sm:px-8">
            {(live ?? []).length > 0 && (
              <div className="mb-8 flex flex-col">
                {(live ?? []).map((lecture) => (
                  <LiveLectureRow key={lecture.id} id={lecture.id} name={lecture.name} />
                ))}
              </div>
            )}
            <h1 className="type-display text-ink">Courses</h1>
            {list.length > 0 && (
              <ul className="flex flex-col pt-6">
                {list.map((course, i) => (
                  <li key={course.id} className={`border-t border-hairline ${staggerClass}`} style={staggerStyle(i)}>
                    <Link
                      href={`/teach/c/${course.id}`}
                      className={`${rowLinkClass} flex items-center gap-4 py-6`}
                    >
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="truncate type-title text-ink transition-colors duration-(--dur-fast) ease-out group-hover:text-ink-hover">
                          {course.name}
                        </span>
                        <span className="type-small text-secondary">{courseMeta(byCourse.get(course.id))}</span>
                      </span>
                      <span className="min-w-0 flex-1" />
                      <Icon
                        name="forward"
                        size={20}
                        className="transition-[translate] duration-(--dur-fast) ease-out motion-safe:group-hover:translate-x-0.5"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <AddCourseForm startOpen={list.length === 0} />
          </main>
        </TeacherPage>
      );
    }
  }

  const { error } = await searchParams;
  return <SignInView message={error === "signin" ? "Sign in didn't finish. Try again." : null} />;
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
