import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isMiamiEmail } from "@/lib/email";
import { formatLectureDate } from "@/lib/lectureDate";
import { DETAIL_COLUMNS, OPTION_COLUMNS, hasSchedule, readDetails, type CourseDetails } from "@/lib/courseDetails";
import { CoursesHeading } from "./add-course-form";
import { CourseGrid } from "./CourseGrid";
import { LiveLectureRow } from "./LiveLectureRow";
import { NowNext, type ScheduledCourse } from "./NowNext";
import { RefreshOnReturn } from "./RefreshOnReturn";
import { SignInView } from "./sign-in-view";
import { CoursesSkeleton } from "./skeletons";
import { TeacherPage, splitCourseName } from "./ui";

type LectureMeta = { course_id: string; lecture_date: string };

/** "8 lectures, last on Oct 21", "1 lecture, last on Oct 21" or "No lectures yet". */
function courseMeta(list: LectureMeta[] | undefined): string {
  if (!list || list.length === 0) return "No lectures yet";
  const last = list.reduce((a, b) => (b.lecture_date > a ? b.lecture_date : a), list[0].lecture_date);
  return `${list.length} ${list.length === 1 ? "lecture" : "lectures"}, last on ${formatLectureDate(last)}`;
}

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;
const PAGE = 1000;

/** The server's clock for the first render of Now / Next (the browser keeps it moving after that). */
function serverNow(): number {
  return Date.now();
}

type DashCourse = { id: string; name: string; details: CourseDetails | null };

/**
 * The teacher's courses in use, with their color, section and schedule (migration 0018). Newest
 * columns first: with 0019's columns there the new colors and choices can be saved (`options`).
 * Before 0019, and before 0018, those columns are not there: only then (42703, undefined column)
 * the read is made again without them, and the cards and the Now / Next block leave out what they
 * drive (details null before 0018). Any other error is a real failure and is thrown: a passing
 * hiccup must never make the page offer the old choices for a course that uses the new ones.
 */
/** Postgres "undefined column": the migration that adds it has not run yet. */
const MISSING_COLUMN = "42703";

async function readCourses(supabase: Supabase): Promise<{ courses: DashCourse[]; options: boolean }> {
  const read = (columns: string) =>
    supabase.from("courses").select(columns).eq("archived", false).order("created_at");
  for (const [columns, options] of [
    [`id, name, ${DETAIL_COLUMNS}, ${OPTION_COLUMNS}`, true],
    [`id, name, ${DETAIL_COLUMNS}`, false],
  ] as const) {
    const full = await read(columns);
    if (!full.error) {
      const courses = ((full.data ?? []) as unknown as Record<string, unknown>[]).map((c) => ({
        id: String(c.id),
        name: String(c.name),
        details: readDetails(c),
      }));
      return { courses, options };
    }
    if (full.error.code !== MISSING_COLUMN) throw new Error(full.error.message);
  }
  const plain = await read("id, name");
  if (plain.error) throw new Error(plain.error.message);
  const courses = ((plain.data ?? []) as unknown as { id: string; name: string }[]).map((c) => ({
    id: c.id,
    name: c.name,
    details: null,
  }));
  return { courses, options: false };
}

/**
 * Every lecture's course and date, for the line under each course name. Read in pages (the API
 * returns at most 1000 rows a call). Only a label: a failed read shows the list without the line.
 */
async function readLectureMeta(supabase: Supabase, teacherId: string): Promise<LectureMeta[] | null> {
  try {
    const out: LectureMeta[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("lectures")
        .select("course_id, lecture_date, courses!inner(teacher_id)")
        .eq("courses.teacher_id", teacherId)
        .order("lecture_date", { ascending: false })
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) return null;
      const page = (data ?? []) as LectureMeta[];
      out.push(...page);
      if (page.length < PAGE) return out;
    }
  } catch {
    return null;
  }
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
      const { courses: list, options } = await readCourses(supabase);
      // Joined students can read the lectures they joined, so ask for the
      // teacher's own courses explicitly instead of relying on row level security.
      const { data: live, error: liveError } = await supabase
        .from("lectures")
        .select("id, name, course_id, courses!inner(teacher_id)")
        .eq("status", "live")
        .eq("courses.teacher_id", user.id)
        .order("started_at", { ascending: false });
      if (liveError) throw new Error(liveError.message);
      const held = await readLectureMeta(supabase, user.id);
      const byCourse = new Map<string, LectureMeta[]>();
      for (const l of held ?? []) {
        byCourse.set(l.course_id, [...(byCourse.get(l.course_id) ?? []), l]);
      }

      const liveLectures = (live ?? []) as { id: string; name: string; course_id: string }[];
      // The newest live lecture of each course (the list is newest first).
      const liveByCourse = new Map<string, string>();
      for (const l of liveLectures) if (!liveByCourse.has(l.course_id)) liveByCourse.set(l.course_id, l.id);
      const courseCode = new Map(list.map((c) => [c.id, splitCourseName(c.name).code]));
      const scheduled = list.filter(
        (c): c is ScheduledCourse => c.details !== null && hasSchedule(c.details),
      );
      const now = serverNow();
      return (
        <TeacherPage crumbs={[{ label: "Courses" }]} teacherName={teacher.display_name}>
          <RefreshOnReturn />
          <main className="mx-auto flex w-full max-w-[1104px] animate-page-in flex-col gap-2 px-4 py-12 sm:px-8">
            {liveLectures.length > 0 && (
              <div className="mb-8 flex flex-col">
                {liveLectures.map((lecture) => (
                  <LiveLectureRow
                    key={lecture.id}
                    id={lecture.id}
                    name={lecture.name}
                    course={courseCode.get(lecture.course_id) ?? null}
                  />
                ))}
              </div>
            )}
            {scheduled.length > 0 && (
              <NowNext courses={scheduled} liveCourseIds={[...liveByCourse.keys()]} initialNow={now} />
            )}
            <CoursesHeading startOpen={list.length === 0} />
            <CourseGrid
              options={options}
              courses={list.map((course) => ({
                id: course.id,
                name: course.name,
                details: course.details,
                meta: held ? courseMeta(byCourse.get(course.id)) : null,
                liveLectureId: liveByCourse.get(course.id) ?? null,
              }))}
            />
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
    <Suspense fallback={<CoursesSkeleton />}>
      <TeachBody searchParams={searchParams} />
    </Suspense>
  );
}
