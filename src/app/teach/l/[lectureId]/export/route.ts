import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { CSV_HEADER, attachmentDisposition, lectureCsvFileName, toCsv } from "@/lib/csv";

const notFound = () => new Response("Not found", { status: 404 });

/**
 * One ended lecture as CSV ("Export this lecture" on the past lecture page): the same columns
 * and numbers as the semester export (one row per slide, lost taps not undone, different
 * students), never notes. Reads only through functions and tables the teacher already can.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ lectureId: string }> }) {
  const { lectureId } = await params;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/teach");

  // Joined students can read a lecture too, so ownership is asked for explicitly.
  const { data: lecture, error } = await supabase
    .from("lectures")
    .select("id, name, status, lecture_date, slide_count, courses!inner(teacher_id)")
    .eq("id", lectureId)
    .eq("courses.teacher_id", user.id)
    .maybeSingle();
  // 22P02 is a malformed uuid in the url. Any other error is a real failure, not a missing lecture.
  if (error && error.code !== "22P02") throw new Error(error.message);
  // Like the semester export: only an ended lecture is exported.
  if (!lecture || lecture.status !== "ended") return notFound();

  const [stats, slides] = await Promise.all([
    supabase.rpc("lecture_slide_stats", { p_lecture_id: lecture.id }),
    supabase.from("slides").select("number, first_line").eq("lecture_id", lecture.id).order("number"),
  ]);
  if (stats.error?.code === "42501") return notFound();
  if (stats.error) throw new Error(stats.error.message);
  if (slides.error) throw new Error(slides.error.message);

  const firstLines = new Map(((slides.data ?? []) as { number: number; first_line: string }[]).map((s) => [s.number, s.first_line]));
  const counts = new Map(
    ((stats.data ?? []) as { slide_number: number; taps: number; students: number }[]).map((r) => [r.slide_number, r]),
  );
  const rows = Array.from({ length: lecture.slide_count }, (_, i) => {
    const n = i + 1;
    const c = counts.get(n);
    return [lecture.lecture_date, lecture.name, n, firstLines.get(n) ?? "", c?.taps ?? 0, c?.students ?? 0];
  });

  return new Response(toCsv(CSV_HEADER, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": attachmentDisposition(lectureCsvFileName(lecture.name)),
      "Cache-Control": "private, no-store",
    },
  });
}
