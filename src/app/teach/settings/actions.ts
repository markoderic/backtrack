"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { isMiamiEmail } from "@/lib/email";

const NAME_MAX = 80;

export type SignOutState = { error: string } | null;
export type SaveNameResult = { error: string } | null;

/**
 * Saves the teacher's name, checked here on the server like Task 3's setup (1 to 80 characters
 * after trimming, a Miami account). Runs as the signed in teacher, so row level security
 * (teachers_update_own) only lets them change their own row; no row back counts as a failure.
 */
export async function saveName(name: string): Promise<SaveNameResult> {
  const trimmed = String(name ?? "").trim();
  if (trimmed.length < 1 || trimmed.length > NAME_MAX) return { error: "Your name must be 1 to 80 characters." };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isMiamiEmail(user.email)) return { error: "You're signed out. Sign in again to change your name." };

  const { data, error } = await supabase
    .from("teachers")
    .update({ display_name: trimmed })
    .eq("id", user.id)
    .select("id");
  if (error || !data || data.length === 0) return { error: "Could not save your name." };

  revalidatePath("/teach", "layout");
  return null;
}

// Signs the teacher out on the server, so the session cookies are cleared with it, then goes home.
// Only this device: a teacher signing out on a phone must not end the projector laptop's session.
// If Supabase can't end the session they stay signed in, so say so instead of pretending.
export async function signOut(): Promise<SignOutState> {
  let failed = false;
  try {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    failed = Boolean(error);
  } catch {
    failed = true;
  }
  if (failed) return { error: "Couldn't sign out. Try again." };
  revalidatePath("/teach", "layout");
  redirect("/");
}
