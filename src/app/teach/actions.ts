"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

const NAME_MAX = 80;
const COURSE_MAX = 120;

async function signedInUser() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/teach");
  return { supabase, user };
}

// Saves the teacher's name and their first courses. Runs as the signed in user,
// so row level security decides what is allowed.
export async function saveSetup(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const courses = formData
    .getAll("course")
    .filter((c): c is string => typeof c === "string")
    .map((c) => c.trim())
    .filter(Boolean);

  if (!name || name.length > NAME_MAX || courses.length === 0 || courses.some((c) => c.length > COURSE_MAX)) {
    redirect("/teach/setup");
  }

  const { supabase, user } = await signedInUser();

  const { data: updated, error: nameError } = await supabase
    .from("teachers")
    .update({ display_name: name })
    .eq("id", user.id)
    .select("id");
  if (nameError) throw new Error("Could not save your name.");
  if (!updated || updated.length === 0) redirect("/teach");

  const { error: coursesError } = await supabase
    .from("courses")
    .insert(courses.map((course) => ({ teacher_id: user.id, name: course })));
  if (coursesError) throw new Error("Could not save your courses.");

  revalidatePath("/teach");
  redirect("/teach");
}

export async function addCourse(name: string) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed || trimmed.length > COURSE_MAX) throw new Error("Course name must be 1 to 120 characters.");

  const { supabase, user } = await signedInUser();
  const { error } = await supabase.from("courses").insert({ teacher_id: user.id, name: trimmed });
  if (error) throw new Error("Could not add the course.");

  revalidatePath("/teach");
}
