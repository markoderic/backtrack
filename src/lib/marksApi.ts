import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyError, classifyThrown, TAP_LIMIT_CODE } from "./lostTapApi";
import { isRect, type Rect } from "./rect";
import { classifyWrite, isMissingSchema, type Loaded, type WriteResult } from "./schemaCheck";

/**
 * Marks (highlights) on a slide, in the slide_marks table of migration 0020. A student can have
 * several on one slide, each a box stored as fractions of the slide. 'lost' (red) the teacher of
 * the course sees, without the note; 'save' (yellow) only the student sees. Each mark can carry a
 * private note that no teacher can read.
 *
 * Every function here works before 0020 has run: a read says { status: "missing" } and a write
 * says "missing", and the page keeps today's behavior (the one highlight on the tap, lost_taps.hl_*).
 */

export type MarkKind = "lost" | "save";

/** One of the student's own marks, with its note. */
export type Mark = {
  id: string;
  lectureId: string;
  slide: number;
  rect: Rect;
  kind: MarkKind;
  /** The private note, or undefined when there is none. */
  note?: string;
  createdAt: string;
  updatedAt: string;
};

/** A 'lost' mark as the teacher reads it: where the box is and whose (anonymous), never a note. */
export type LostMark = {
  id: string;
  /** The student's anonymous join id, the same one their taps carry. */
  anonId: string;
  slide: number;
  rect: Rect;
  createdAt: string;
  updatedAt: string;
};

/** The longest note on a mark (slide_marks.note's check). */
export const MARK_NOTE_MAX = 2000;
/** One student's marks: at most this many on one slide and in one lecture (0020's trigger). */
export const MARKS_PER_SLIDE = 30;
export const MARKS_PER_LECTURE = 300;

/** A write of a mark, plus the two limits: this slide already has 30, this lecture 300. */
export type MarkWriteResult = WriteResult | "slide_full" | "lecture_full";

/** The teacher's columns. note is never among them: no signed in user may select it (0020). */
const TEACHER_COLUMNS = "id, anon_id, slide_number, x, y, w, h, created_at, updated_at";

type Row = Record<string, unknown>;

const rectOf = (r: Row): Rect | null => {
  const rect = { x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h) };
  return isRect(rect) ? rect : null;
};

/** One row of my_slide_marks (or a Realtime record of the student's own mark) as a Mark, or null if it is not one. */
export function markFromRow(r: Row): Mark | null {
  const rect = rectOf(r);
  if (!rect || typeof r.id !== "string" || typeof r.lecture_id !== "string") return null;
  const mark: Mark = {
    id: r.id,
    lectureId: r.lecture_id,
    slide: Number(r.slide_number),
    rect,
    kind: r.kind === "lost" ? "lost" : "save",
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
  if (typeof r.note === "string" && r.note.trim() !== "") mark.note = r.note;
  return mark;
}

/** One row of the teacher's read (or a Realtime record) as a LostMark, or null if it is not one. */
export function lostMarkFromRow(r: Row): LostMark | null {
  const rect = rectOf(r);
  if (!rect || typeof r.id !== "string" || typeof r.anon_id !== "string") return null;
  return {
    id: r.id,
    anonId: r.anon_id,
    slide: Number(r.slide_number),
    rect,
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

async function read<T>(run: () => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null; status?: number }>, map: (rows: Row[]) => T): Promise<Loaded<T>> {
  try {
    const { data, error, status } = await run();
    if (error) {
      if (isMissingSchema(error)) return { status: "missing" };
      if (classifyError(error, status) === "offline") return { status: "offline" };
      throw new Error(error.message);
    }
    return { status: "ok", data: map((data ?? []) as Row[]) };
  } catch (e) {
    classifyThrown(e); // throws unless the network is down
    return { status: "offline" };
  }
}

async function write<R extends string>(run: () => PromiseLike<{ error: { code?: string; message: string; status?: number } | null; status?: number }>, limits?: (message: string) => R): Promise<WriteResult | R> {
  try {
    const res = await run();
    if (res.error?.code === TAP_LIMIT_CODE && limits) return limits(res.error.message ?? "");
    return classifyWrite(res);
  } catch (e) {
    return classifyThrown(e);
  }
}

/**
 * The student's own marks, with their notes: of one lecture, or of every lecture when lectureId
 * is null (My lectures). Through my_slide_marks, the only way to read a note.
 */
export function loadMyMarks(supabase: SupabaseClient, lectureId: string | null): Promise<Loaded<Mark[]>> {
  return read(
    () => supabase.rpc("my_slide_marks", { p_lecture_id: lectureId }),
    (rows) => rows.map(markFromRow).filter((m): m is Mark => m !== null),
  );
}

/** The 'lost' marks of a lecture, for its teacher (the data view). Never a 'save', never a note. */
export function loadLostMarks(supabase: SupabaseClient, lectureId: string): Promise<Loaded<LostMark[]>> {
  return read(
    () =>
      supabase
        .from("slide_marks")
        .select(TEACHER_COLUMNS)
        .eq("lecture_id", lectureId)
        // Row level security already gives the teacher only 'lost' marks; this also keeps out the
        // teacher's own 'save' marks if they joined their own lecture as a student.
        .eq("kind", "lost")
        .order("slide_number")
        .order("created_at"),
    (rows) => rows.map(lostMarkFromRow).filter((m): m is LostMark => m !== null),
  );
}

export type NewMark = { id: string; lectureId: string; slide: number; rect: Rect; kind: MarkKind; note?: string };

const cleanNote = (note: string | null | undefined): string | null =>
  note === undefined || note === null || note.trim() === "" ? null : note.slice(0, MARK_NOTE_MAX);

const limitOf = (message: string): "slide_full" | "lecture_full" => (/in this lecture/i.test(message) ? "lecture_full" : "slide_full");

/**
 * Adds one of the student's marks. The id is made by the caller (newId), so sending it again
 * after a dropped connection adds nothing. The student is whoever is signed in (anon_id defaults
 * to auth.uid() in the database). Allowed while the lecture is live and up to 15 minutes after it.
 */
export function addMark(supabase: SupabaseClient, mark: NewMark): Promise<MarkWriteResult> {
  if (!isRect(mark.rect)) return Promise.resolve("rejected");
  const note = cleanNote(mark.note);
  return write(
    () =>
      supabase.from("slide_marks").upsert(
        {
          id: mark.id,
          lecture_id: mark.lectureId,
          slide_number: mark.slide,
          x: mark.rect.x,
          y: mark.rect.y,
          w: mark.rect.w,
          h: mark.rect.h,
          kind: mark.kind,
          ...(note ? { note } : {}),
        },
        { onConflict: "id", ignoreDuplicates: true },
      ),
    limitOf,
  );
}

export type MarkPatch = { rect?: Rect; note?: string | null; kind?: MarkKind };

/** Changes one of the student's marks: its box, its note (empty or null clears it) or its kind. Any time. */
export function updateMark(supabase: SupabaseClient, id: string, patch: MarkPatch): Promise<WriteResult> {
  const row: Row = {};
  if (patch.rect !== undefined) {
    if (!isRect(patch.rect)) return Promise.resolve("rejected");
    Object.assign(row, { x: patch.rect.x, y: patch.rect.y, w: patch.rect.w, h: patch.rect.h });
  }
  if (patch.note !== undefined) row.note = cleanNote(patch.note);
  if (patch.kind !== undefined) row.kind = patch.kind;
  if (Object.keys(row).length === 0) return Promise.resolve("ok");
  return write(() => supabase.from("slide_marks").update(row).eq("id", id));
}

/**
 * Sets the kind of every one of the student's marks on a slide, in one request: 'lost' when they
 * press I'm lost there, 'save' when they take it back (batch K1's rule). Only their own marks
 * change (row level security).
 */
export function setSlideMarksKind(supabase: SupabaseClient, lectureId: string, slide: number, kind: MarkKind): Promise<WriteResult> {
  return write(() =>
    supabase
      .from("slide_marks")
      .update({ kind })
      .eq("lecture_id", lectureId)
      .eq("slide_number", slide)
      .neq("kind", kind),
  );
}

/**
 * Deletes one of the student's marks. Any time. A mark copied from a tap's highlight (same id as
 * the tap) also clears the highlight on that tap, in the database.
 */
export function deleteMark(supabase: SupabaseClient, id: string): Promise<WriteResult> {
  return write(() => supabase.from("slide_marks").delete().eq("id", id));
}
