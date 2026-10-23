"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { buttonSecondaryClass } from "@/components/ButtonPrimary";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { CourseDetails } from "@/lib/courseDetails";
import { CourseCard } from "./CourseCard";
import { STATUS_MS } from "./settings/NameForm";
import { splitCourseName } from "./ui";

export type GridCourse = {
  id: string;
  name: string;
  /** Null before migration 0018. */
  details: CourseDetails | null;
  /** "8 lectures, last on Oct 21", or null when that read failed. */
  meta: string | null;
  liveLectureId: string | null;
};

type Note = { text: string; undo?: GridCourse };

/** Undo for an archive goes away after this long, like the student's Undo (batch G, Marko). */
export const UNDO_MS = 10_000;

/**
 * The course cards on the dashboard, and one status line above them for what the cards' ⋯ menus
 * did: "Saved the details for IMS 452.", "Renamed to ...", or "Archived IMS 452." with Undo.
 * Archive hides the card at once (the server list catches up with a refresh) and puts the keyboard
 * on Undo. Undo goes after 10 s (Settings' Unarchive stays the way back); if the keyboard was on it,
 * it goes to the status line. Undo brings the card back (from the copy kept here until the server list has it again)
 * and puts the keyboard back on its ⋯. A failed archive leaves the card and says so.
 */
export function CourseGrid({ courses, options }: { courses: GridCourse[]; options: boolean }) {
  const router = useRouter();
  const [archived, setArchived] = useState<Set<string>>(() => new Set());
  // Courses brought back by Undo that the server list may not have yet.
  const [restored, setRestored] = useState<GridCourse[]>([]);
  const [note, setNote] = useState<Note | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // Where the keyboard goes after the next render (the Undo button, or a card's ⋯ again).
  const focusNext = useRef<{ to: "undo" } | { to: "status" } | { to: "menu"; id: string } | null>(null);
  const statusLine = useRef<HTMLDivElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  // Messages go after a few seconds; an Undo after 10 s, leaving its words for a few seconds more.
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(
      () => {
        if (note.undo) {
          if (document.activeElement === undoButton.current) focusNext.current = { to: "status" };
          setNote({ text: note.text });
        } else setNote(null);
      },
      note.undo ? UNDO_MS : STATUS_MS,
    );
    return () => clearTimeout(t);
  }, [note]);

  useEffect(() => {
    const f = focusNext.current;
    if (!f) return;
    focusNext.current = null;
    if (f.to === "undo") undoButton.current?.focus();
    else if (f.to === "status") statusLine.current?.focus();
    else list.current?.querySelector<HTMLElement>(`[data-course-menu="${f.id}"]`)?.focus();
  });

  const shown = [
    ...courses,
    ...restored.filter((r) => !courses.some((c) => c.id === r.id)),
  ].filter((c) => !archived.has(c.id));

  async function setArchivedOnServer(id: string, value: boolean): Promise<boolean> {
    try {
      const { data, error } = await createBrowserSupabase()
        .from("courses")
        .update({ archived: value })
        .eq("id", id)
        .select("id");
      return !error && !!data && data.length > 0;
    } catch {
      return false;
    }
  }

  async function archive(course: GridCourse): Promise<boolean> {
    const { code } = splitCourseName(course.name);
    setFailed(null);
    const ok = await setArchivedOnServer(course.id, true);
    if (!ok) {
      setFailed(`Could not archive ${code}.`);
      return false;
    }
    setArchived((s) => new Set(s).add(course.id));
    setRestored((r) => r.filter((c) => c.id !== course.id));
    setNote({ text: `Archived ${code}.`, undo: course });
    focusNext.current = { to: "undo" };
    router.refresh();
    return true;
  }

  async function undo(course: GridCourse) {
    const { code } = splitCourseName(course.name);
    setFailed(null);
    const ok = await setArchivedOnServer(course.id, false);
    if (!ok) {
      setFailed(`Could not unarchive ${code}.`);
      return;
    }
    setArchived((s) => {
      const next = new Set(s);
      next.delete(course.id);
      return next;
    });
    setRestored((r) => [...r.filter((c) => c.id !== course.id), course]);
    setNote({ text: `Unarchived ${code}.` });
    focusNext.current = { to: "menu", id: course.id };
    router.refresh();
  }

  return (
    <>
      <div ref={statusLine} tabIndex={-1} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-sm outline-none">
        {/* Always in the page so it is announced; the visible line is the same words. */}
        <p role="status" data-testid="courses-status" className="type-small text-secondary empty:sr-only">
          {note?.text ?? ""}
        </p>
        {note?.undo && (
          <button
            ref={undoButton}
            type="button"
            aria-label={`Undo, unarchive ${splitCourseName(note.undo.name).code}`}
            onClick={() => void undo(note.undo!)}
            className={buttonSecondaryClass}
          >
            Undo
          </button>
        )}
      </div>
      {failed && (
        <p role="alert" className="flex animate-fade-in items-center gap-2 type-small text-ink">
          <Icon name="alert" size={18} />
          {failed}
        </p>
      )}
      {shown.length > 0 && (
        <ul ref={list} className="grid grid-cols-1 gap-4 pt-6 pb-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((course, i) => (
            <CourseCard
              key={course.id}
              id={course.id}
              name={course.name}
              details={course.details}
              meta={course.meta}
              liveLectureId={course.liveLectureId}
              index={i}
              options={options}
              onArchive={() => archive(course)}
              announce={(text) => setNote({ text })}
            />
          ))}
        </ul>
      )}
    </>
  );
}
