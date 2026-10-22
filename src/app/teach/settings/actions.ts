"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

export type SignOutState = { error: string } | null;

// Signs the teacher out on the server, so the session cookies are cleared with it, then goes home.
// If Supabase can't end the session they stay signed in, so say so instead of pretending.
export async function signOut(): Promise<SignOutState> {
  let failed = false;
  try {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.signOut();
    failed = Boolean(error);
  } catch {
    failed = true;
  }
  if (failed) return { error: "Couldn't sign out. Try again." };
  revalidatePath("/teach", "layout");
  redirect("/");
}
