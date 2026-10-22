import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { CSV_HEADER, attachmentDisposition, csvFileName, toCsv } from "@/lib/csv";

const PAGE = 1000;

type ExportRow = {
  lecture_date: string;
  lecture_name: string;
  slide_number: number;
  first_line: string;
  lost_taps: number;
  students: number;
};

const notFound = () => new Response("Not found", { status: 404 });

export async function GET(_request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/teach");

  // Only the teacher's own course comes back, asked for explicitly as well as by row level security.
  const { data: course, error } = await supabase
    .from("courses")
    .select("id, name")
    .eq("id", courseId)
    .eq("teacher_id", user.id)
    .maybeSingle();
  // 22P02 is a malformed uuid in the url. Any other error is a real failure, not a missing course.
  if (error && error.code !== "22P02") throw new Error(error.message);
  if (!course) return notFound();

  // The API returns at most 1000 rows a call and a semester can have more, so read it in pages.
  // The function's order is fixed, so the pages line up.
  const rows: ExportRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error: exportError } = await supabase
      .rpc("course_export", { p_course_id: course.id })
      .range(from, from + PAGE - 1);
    // 42501: the database says this is not the caller's course.
    if (exportError?.code === "42501") return notFound();
    if (exportError) throw new Error(exportError.message);
    const page = (data ?? []) as ExportRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const csv = toCsv(
    CSV_HEADER,
    rows.map((r) => [r.lecture_date, r.lecture_name, r.slide_number, r.first_line, r.lost_taps, r.students]),
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": attachmentDisposition(csvFileName(course.name)),
      "Cache-Control": "private, no-store",
    },
  });
}
