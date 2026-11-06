"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { DELETE_FAILED_ERROR, LIVE_LECTURE_ERROR, RESUME_FAILED_ERROR, RESUME_NOT_READY_ERROR } from "./delete-lecture-copy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the confirm shows when the delete did not happen. */
export type DeleteLectureResult = { error: string };

/** Storage's remove() takes a list; a long deck is sent in a few calls. */
const REMOVE_BATCH = 100;

/**
 * Deletes one of the signed in teacher's ended lectures and everything attached to it, then goes
 * back to its course with "Lecture deleted.". The rows go first, in one database call
 * (delete_lecture checks the owner and refuses a live lecture). Then the slide images are removed
 * from the slides bucket with the Storage API as the same teacher (slides_delete_unused allows it
 * once no lecture uses them). A failed image removal never undoes the delete: it is logged and the
 * file is left for the orphan cleanup.
 */
export async function deleteLecture(lectureId: string): Promise<DeleteLectureResult> {
  const id = String(lectureId ?? "");
  if (!UUID.test(id)) return { error: DELETE_FAILED_ERROR };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/teach");

  const { data, error } = await supabase.rpc("delete_lecture", { p_lecture_id: id });
  if (error) {
    return { error: error.code === "55000" ? LIVE_LECTURE_ERROR : DELETE_FAILED_ERROR };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { course_id?: string; image_paths?: string[] } | undefined;
  if (!row?.course_id) return { error: DELETE_FAILED_ERROR };

  const paths = (row.image_paths ?? []).filter((p) => typeof p === "string" && p.startsWith(`${id}/`));
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    try {
      const { error: removeError } = await supabase.storage.from("slides").remove(paths.slice(i, i + REMOVE_BATCH));
      if (removeError) console.error(`delete_lecture ${id}: slide images left in storage:`, removeError.message);
    } catch (e) {
      console.error(`delete_lecture ${id}: slide images left in storage:`, e);
    }
  }

  revalidatePath(`/teach/c/${row.course_id}`);
  revalidatePath("/teach");
  redirect(`/teach/c/${row.course_id}?deleted=1`);
}

/** What Resume lecture shows when the lecture did not open again. */
export type ResumeLectureResult = { error: string };

/**
 * Opens one of the signed in teacher's ended lectures again (resume_lecture, migration 0021: back
 * to live with a new join code, on the slide it was on, with everything it had), then goes to its
 * projector. For a teacher who keeps one deck for the whole semester. A lecture that is already
 * live just goes to its projector.
 */
export async function resumeLecture(lectureId: string): Promise<ResumeLectureResult> {
  const id = String(lectureId ?? "");
  if (!UUID.test(id)) return { error: RESUME_FAILED_ERROR };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/teach");

  const { data, error } = await supabase.rpc("resume_lecture", { p_lecture_id: id });
  if (error) {
    // PGRST202 / 42883: the function is not there yet (0021 has not run).
    const missing = error.code === "PGRST202" || error.code === "42883";
    if (!missing) console.error(`resume_lecture ${id}:`, error.message);
    return { error: missing ? RESUME_NOT_READY_ERROR : RESUME_FAILED_ERROR };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { lecture_id?: string } | undefined;
  if (row?.lecture_id !== id) return { error: RESUME_FAILED_ERROR };

  revalidatePath("/teach", "layout");
  redirect(`/teach/l/${id}/present`);
}

/**
 * Removes the signed in teacher's own slide uploads that no lecture uses and that are over a day
 * old (a start that failed or was left halfway). The list comes from my_orphan_slide_images; the
 * Storage API removes them as the teacher (slides_delete_unused). Best effort: returns how many
 * went, and never throws. Called when the Start lecture page opens; there is no scheduled job.
 */
export async function cleanupOrphanUploads(): Promise<number> {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return 0;
    const { data, error } = await supabase.rpc("my_orphan_slide_images");
    if (error || !Array.isArray(data)) return 0;
    const names = (data as unknown[]).filter((n): n is string => typeof n === "string");
    let removed = 0;
    for (let i = 0; i < names.length; i += REMOVE_BATCH) {
      const batch = names.slice(i, i + REMOVE_BATCH);
      const { error: removeError } = await supabase.storage.from("slides").remove(batch);
      if (removeError) {
        console.error("cleanupOrphanUploads: could not remove leftovers:", removeError.message);
        break;
      }
      removed += batch.length;
    }
    return removed;
  } catch (e) {
    console.error("cleanupOrphanUploads:", e);
    return 0;
  }
}
