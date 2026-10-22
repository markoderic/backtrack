import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { topThree } from "@/lib/stats";
import { ButtonPrimaryLink, buttonSecondaryClass } from "@/components/ButtonPrimary";
import { Icon } from "@/components/Icon";
import { LiveLectureRow } from "../../LiveLectureRow";
import { RefreshOnReturn } from "../../RefreshOnReturn";
import { readTeacherName } from "../../teacher";
import { TeacherPage, splitCourseName } from "../../ui";
import { LECTURE_DELETED } from "../../delete-lecture-copy";
import { PastLectures, type PastLecture } from "./PastLectures";
import { SlideAccess } from "./SlideAccess";
import { isStudentAccess, todayInOxford } from "@/lib/slideAccess";
import { DETAIL_COLUMNS, colorClass, readDetails } from "@/lib/courseDetails";
import { CourseDetailsEditor } from "./CourseDetails";

const PAGE = 1000;

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;
type LectureRow = {
  id: string;
  name: string;
  status: string;
  lecture_date: string;
  started_at?: string;
  slide_count?: number;
};
type ExportRow = {
  lecture_date: string;
  lecture_name: string;
  slide_number: number;
  first_line: string;
  lost_taps: number;
  students: number;
};
type CourseRow = {
  id: string;
  name: string;
  archived: boolean;
  student_access?: unknown;
  semester_end?: string | null;
  color?: unknown;
  section?: unknown;
  meet_days?: unknown;
  start_minute?: unknown;
  end_minute?: unknown;
};
type Summary = { joined: number | null; lostTaps: number | null; mostLost: { number: number; firstLine: string } | null };

/**
 * Joined, lost taps and the most lost slide of each ended lecture, for the table.
 * Lost taps and the slides come from course_export (the same numbers as the CSV: ended lectures,
 * lost taps not undone). Its rows are in lecture_date, started_at, id order, slide_count rows a
 * lecture, so they are matched back to the lectures in that order. These are labels only: a
 * failed read leaves the cells empty instead of taking the course page down.
 */
async function summarize(supabase: Supabase, courseId: string, past: LectureRow[]): Promise<Map<string, Summary>> {
  const out = new Map<string, Summary>(past.map((l) => [l.id, { joined: null, lostTaps: null, mostLost: null }]));
  if (past.length === 0) return out;
  const ids = past.map((l) => l.id);

  const [exportRows, joinedRows] = await Promise.all([
    (async () => {
      try {
        const rows: ExportRow[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase
            .rpc("course_export", { p_course_id: courseId })
            .range(from, from + PAGE - 1);
          if (error) return null;
          const page = (data ?? []) as ExportRow[];
          rows.push(...page);
          if (page.length < PAGE) return rows;
        }
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        const rows: { lecture_id: string }[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase
            .from("participants")
            .select("lecture_id")
            .in("lecture_id", ids)
            .order("lecture_id")
            .order("anon_id")
            .range(from, from + PAGE - 1);
          if (error) return null;
          const page = (data ?? []) as { lecture_id: string }[];
          rows.push(...page);
          if (page.length < PAGE) return rows;
        }
      } catch {
        return null;
      }
    })(),
  ]);

  if (joinedRows) {
    for (const l of past) out.get(l.id)!.joined = 0;
    for (const r of joinedRows) {
      const s = out.get(r.lecture_id);
      if (s) s.joined = (s.joined ?? 0) + 1;
    }
  }

  if (exportRows) {
    const ordered = [...past].sort(
      (a, b) =>
        a.lecture_date.localeCompare(b.lecture_date) ||
        (a.started_at ?? "").localeCompare(b.started_at ?? "") ||
        a.id.localeCompare(b.id),
    );
    let at = 0;
    for (const l of ordered) {
      const count = l.slide_count ?? 0;
      const rows = exportRows.slice(at, at + count);
      // Stop matching as soon as anything does not line up (a lecture renamed or ended in between).
      if (rows.length !== count || rows.some((r) => r.lecture_date !== l.lecture_date || r.lecture_name !== l.name)) break;
      at += count;
      const top = topThree(rows.map((r) => ({ slide_number: r.slide_number, taps: r.lost_taps, students: r.students })))[0];
      const s = out.get(l.id)!;
      s.lostTaps = rows.reduce((n, r) => n + r.lost_taps, 0);
      const row = top ? rows.find((r) => r.slide_number === top) : undefined;
      s.mostLost = row ? { number: row.slide_number, firstLine: row.first_line } : null;
    }
  }
  return out;
}

export async function CourseBody({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  /** ?deleted=1 after Delete lecture brought the teacher back here. */
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { courseId } = await params;
  const deleted = (await searchParams)?.deleted === "1";

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/teach");

  // Row level security only returns the course to the teacher who owns it, and
  // the query asks for the teacher's own course explicitly as well.
  const readCourse = (columns: string) =>
    supabase.from("courses").select(columns).eq("id", courseId).eq("teacher_id", user.id).maybeSingle();
  // Newest columns first. Before migration 0018 (color, section, schedule) and 0016 (who can see
  // slides) those columns are not there yet: the course is read again without them, and the page
  // leaves out what they drive. 22P02 is a malformed uuid in the url: no second read.
  const columnSets = [
    `id, name, archived, student_access, semester_end, ${DETAIL_COLUMNS}`,
    "id, name, archived, student_access, semester_end",
    "id, name, archived",
  ];
  let read = await readCourse(columnSets[0]);
  for (const columns of columnSets.slice(1)) {
    if (!read.error || read.error.code === "22P02") break;
    read = await readCourse(columns);
  }
  const { error } = read;
  // Any other error is a real failure, not a missing course.
  if (error && error.code !== "22P02") throw new Error(error.message);
  const course = read.data as CourseRow | null;
  if (!course) notFound();

  const [{ data: lectures, error: lecturesError }, teacherName] = await Promise.all([
    supabase
      .from("lectures")
      .select("id, name, status, lecture_date, started_at, slide_count")
      .eq("course_id", course.id)
      .order("lecture_date", { ascending: false })
      .order("started_at", { ascending: false }),
    readTeacherName(supabase, user.id),
  ]);
  if (lecturesError) throw new Error(lecturesError.message);
  const live = ((lectures ?? []) as LectureRow[]).filter((l) => l.status === "live");
  const past = ((lectures ?? []) as LectureRow[]).filter((l) => l.status !== "live");
  const summaries = await summarize(supabase, course.id, past);

  const rows: PastLecture[] = past.map((l) => {
    const s = summaries.get(l.id);
    return {
      id: l.id,
      name: l.name,
      lectureDate: l.lecture_date,
      joined: s?.joined ?? null,
      lostTaps: s?.lostTaps ?? null,
      mostLost: s?.mostLost ?? null,
    };
  });

  const { code, title } = splitCourseName(course.name);
  // Present once 0018 is in (the column comes back, even when empty).
  const details = "color" in course ? readDetails(course as Record<string, unknown>) : null;

  return (
    <TeacherPage crumbs={[{ label: "Courses", href: "/teach" }, { label: code }]} teacherName={teacherName}>
      <RefreshOnReturn />
      <main className="mx-auto flex w-full max-w-[1104px] animate-page-in flex-col gap-2 px-4 py-12 sm:px-8">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-6">
          <div className="flex min-w-0 flex-1 gap-4">
            {details && (
              <span
                aria-hidden
                data-course-color={details.color ?? "none"}
                className={`w-1.5 shrink-0 self-stretch rounded-full ${colorClass(details.color)}`}
              />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h1 className="type-display break-words text-ink">{code}</h1>
              {title && <p className="type-lecture-l text-secondary">{title}</p>}
            </div>
          </div>
          {/* An archived course still opens (from Settings or by url) for its past lectures and the
              CSV; a new lecture waits until it is unarchived. */}
          {course.archived ? (
            <p data-testid="course-archived" className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-2">
              <span className="type-small text-secondary">Archived</span>
              <Link href="/teach/settings" className={buttonSecondaryClass}>
                Unarchive in Settings
              </Link>
            </p>
          ) : (
            <ButtonPrimaryLink href={`/teach/c/${course.id}/start`} className="w-auto!">
              Start lecture
            </ButtonPrimaryLink>
          )}
        </div>

        {details && (
          <div className="pt-4">
            <CourseDetailsEditor courseId={course.id} code={code} details={details} />
          </div>
        )}

        {/* Always in the page so the line is announced when it appears. */}
        <p role="status" data-testid="course-status" className="type-small text-secondary empty:sr-only">
          {deleted ? LECTURE_DELETED : ""}
        </p>

        {live.length > 0 && (
          <div className="mt-8 flex flex-col">
            {live.map((lecture) => (
              <LiveLectureRow key={lecture.id} id={lecture.id} name={lecture.name} />
            ))}
          </div>
        )}

        {past.length === 0 ? (
          <div className="flex flex-col gap-2 py-16">
            <h2 className="type-title text-ink">No lectures yet</h2>
            <p className="type-body text-secondary">
              Start one when class begins. Past lectures and their data collect here.
            </p>
          </div>
        ) : (
          <section className="flex flex-col pt-10">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pb-3">
              <h2 className="type-title text-ink">Past lectures</h2>
              <div className="flex-1" />
              {/* A plain link, not next/link: it downloads a file and must not be prefetched as a page. */}
              <a href={`/teach/c/${course.id}/export`} download className={buttonSecondaryClass}>
                <Icon name="download" size={18} />
                Export semester CSV
              </a>
            </div>
            <PastLectures lectures={rows} />
          </section>
        )}

        {isStudentAccess(course.student_access) && (
          <div className="pt-12">
            <SlideAccess
              courseId={course.id}
              access={course.student_access}
              semesterEnd={course.semester_end ?? null}
              today={todayInOxford()}
            />
          </div>
        )}
      </main>
    </TeacherPage>
  );
}
