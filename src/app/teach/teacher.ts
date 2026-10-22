import type { createServerSupabase } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;

/** The teacher's name for the top bar. Only a label, so a failed read shows no name instead of an error page. */
export async function readTeacherName(supabase: Supabase, userId: string): Promise<string | null> {
  try {
    const { data } = await supabase.from("teachers").select("display_name").eq("id", userId).maybeSingle();
    return (data as { display_name?: string | null } | null)?.display_name ?? null;
  } catch {
    return null;
  }
}
