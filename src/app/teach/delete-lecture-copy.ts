/** The words of Delete lecture, shared by the server action and the confirm. */
export const LIVE_LECTURE_ERROR = "This lecture is live. End it first, then delete it.";
export const DELETE_FAILED_ERROR = "Could not delete the lecture. Try again.";
export const LECTURE_DELETED = "Lecture deleted.";

/** The words of Resume lecture (an ended lecture opened again). */
export const RESUME_FAILED_ERROR = "Could not resume the lecture. Try again.";
/** Before migration 0021 has run, the database has no resume_lecture. */
export const RESUME_NOT_READY_ERROR = "Resume isn't set up yet. Run migration 0021 in Supabase, then try again.";
