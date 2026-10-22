"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { Icon } from "@/components/Icon";
import { labelClass, staggerClass, staggerStyle, textLinkClass } from "../ui";
import { CourseRow } from "./CourseRow";
import { STATUS_MS } from "./NameForm";

export type SettingsCourse = { id: string; name: string; archived: boolean };

/**
 * The courses on Settings: the ones in use, each with Rename and Archive, then whatever sits
 * between (Add a course), then a quiet Archived group with Unarchive. Archive hides a course from
 * Courses and keeps everything (its past lectures, the CSV, students' My spots), so it is undone
 * with one click and needs no confirm. The row moves at once, says "Archived." for a moment, and
 * keeps the keyboard on its Unarchive (and the other way round).
 */
export function CourseList({ courses, children }: { courses: SettingsCourse[]; children?: React.ReactNode }) {
  const router = useRouter();
  // What this page changed, until the server's list catches up.
  const [moved, setMoved] = useState<Record<string, boolean>>({});
  const [seen, setSeen] = useState(courses);
  if (courses !== seen) {
    setSeen(courses);
    setMoved({});
  }
  const [flash, setFlash] = useState<{ id: string; archived: boolean } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), STATUS_MS);
    return () => clearTimeout(t);
  }, [flash]);

  const isArchived = (c: SettingsCourse) => moved[c.id] ?? c.archived;
  const active = courses.filter((c) => !isArchived(c));
  const archived = courses.filter(isArchived);

  async function setArchived(c: SettingsCourse, value: boolean): Promise<boolean> {
    try {
      const { data, error } = await createBrowserSupabase()
        .from("courses")
        .update({ archived: value })
        .eq("id", c.id)
        .select("id");
      if (error || !data || data.length === 0) return false;
    } catch {
      return false;
    }
    setMoved((m) => ({ ...m, [c.id]: value }));
    setFlash({ id: c.id, archived: value });
    setFocusId(c.id);
    router.refresh();
    return true;
  }

  const note = (c: SettingsCourse) => (flash?.id === c.id ? (flash.archived ? "Archived." : "Unarchived.") : null);
  const flashed = flash ? courses.find((c) => c.id === flash.id) : undefined;

  return (
    <>
      {/* The rows move between the groups, so the announcement lives here, outside both. */}
      <p role="status" data-testid="courses-status" className="sr-only">
        {flash && flashed ? `${flash.archived ? "Archived" : "Unarchived"} ${flashed.name}.` : ""}
      </p>
      {active.length > 0 && (
        <ul className="flex flex-col">
          {active.map((course, i) => (
            <li key={course.id} className={`border-t border-hairline ${staggerClass}`} style={staggerStyle(i)}>
              <CourseRow
                courseId={course.id}
                initialName={course.name}
                onArchive={() => setArchived(course, true)}
                note={note(course)}
                focusOnMount={focusId === course.id}
              />
            </li>
          ))}
        </ul>
      )}
      {children}
      {archived.length > 0 && (
        <section aria-labelledby="settings-archived" className="flex flex-col pt-8">
          <h3 id="settings-archived" className={`${labelClass} pb-2`}>
            Archived
          </h3>
          <ul className="flex flex-col">
            {archived.map((course) => (
              <li key={course.id} className="border-t border-hairline">
                <ArchivedRow
                  course={course}
                  onUnarchive={() => setArchived(course, false)}
                  note={note(course)}
                  focusOnMount={focusId === course.id}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** An archived course: its name opens the course page (past lectures, the CSV), and Unarchive. */
function ArchivedRow({
  course,
  onUnarchive,
  note,
  focusOnMount,
}: {
  course: SettingsCourse;
  onUnarchive: () => Promise<boolean>;
  note: string | null;
  focusOnMount: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focusOnMount) button.current?.focus();
    // Only when the row appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function unarchive() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const ok = await onUnarchive();
    setBusy(false);
    if (!ok) setFailed(true);
  }

  return (
    <>
      <div className="flex min-w-0 items-center gap-6 py-3.5">
        <Link
          href={`/teach/c/${course.id}`}
          className="press focus-ring min-w-0 flex-1 truncate rounded-sm type-body text-secondary hover:text-ink"
        >
          {course.name}
        </Link>
        {note && (
          <p aria-hidden className="shrink-0 animate-fade-in type-small text-secondary">
            {note}
          </p>
        )}
        <button
          ref={button}
          type="button"
          aria-label={`Unarchive ${course.name}`}
          disabled={busy}
          onClick={() => void unarchive()}
          className={`${textLinkClass} shrink-0`}
        >
          Unarchive
        </button>
      </div>
      {failed && (
        <p role="alert" className="flex animate-fade-in items-center gap-2 pb-3 type-small text-ink">
          <Icon name="alert" size={18} />
          Could not unarchive the course.
        </p>
      )}
    </>
  );
}
