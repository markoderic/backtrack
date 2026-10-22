"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { buttonPrimaryInlineClass } from "@/components/ButtonPrimary";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { ACCESS_CHOICES, defaultSemesterEnd, isStudentAccess, type StudentAccess } from "@/lib/slideAccess";
import { STATUS_MS } from "../../settings/NameForm";

/** The select and the date field: 48 high, surface, hairline, radius md, Body (the teacher field look). */
const control =
  "h-12 rounded-md border border-hairline bg-surface px-4 type-body text-ink outline-hidden " +
  "transition-[border-color,box-shadow] duration-(--dur-fast) ease-out " +
  "focus:border-ink focus:shadow-[inset_0_0_0_0.5px_var(--color-ink)] disabled:text-secondary";

type Props = {
  courseId: string;
  access: StudentAccess;
  /** The course's own semester end (YYYY-MM-DD), or null for the usual one. */
  semesterEnd: string | null;
  /** Today in Oxford (YYYY-MM-DD), from the server, for the usual end shown when there is no date. */
  today: string;
};

/**
 * "Students can see slides until" on the course page: End of semester (with its date, the usual
 * May 15 or Dec 18 until the teacher sets one), 30 days after each class, or Always. Save writes
 * the course row as the signed in teacher (row level security keeps it to their own course); the
 * database enforces it on the slide rows and images (student_can_see_lecture, 0016 and 0017).
 * Saving the usual date stores no date, so the course goes on to the next semester by itself.
 */
export function SlideAccess({ courseId, access: initialAccess, semesterEnd: initialEnd, today }: Props) {
  const router = useRouter();
  const usual = defaultSemesterEnd(today);
  const [saved, setSaved] = useState({ access: initialAccess, end: initialEnd ?? usual });
  const [access, setAccess] = useState<StudentAccess>(initialAccess);
  const [end, setEnd] = useState(initialEnd ?? usual);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const selectId = useId();
  const dateId = useId();
  const errorId = useId();

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), STATUS_MS);
    return () => clearTimeout(t);
  }, [done]);

  const changed = access !== saved.access || (access === "semester" && end !== saved.end);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving || !changed) return;
    if (access === "semester" && !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      setError("Pick the last day of the semester.");
      return;
    }
    if (access === "semester" && end < today) {
      setError("Pick a day from today on.");
      return;
    }
    setError(null);
    setSaving(true);
    const sent = { access, end };
    try {
      const { data, error: updateError } = await createBrowserSupabase()
        .from("courses")
        .update({
          student_access: sent.access,
          // The usual date is stored as none, so it moves on to the next semester by itself.
          semester_end: sent.access === "semester" && sent.end !== usual ? sent.end : null,
        })
        .eq("id", courseId)
        .select("id");
      if (updateError || !data || data.length === 0) throw new Error("not saved");
      setSaved(sent);
      setDone(true);
      router.refresh();
    } catch {
      setError("Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      // Checked here, with words that say what to fix, not the browser's bubble.
      noValidate
      data-testid="slide-access"
      className="flex flex-col gap-3 border-t border-hairline pt-8"
    >
      <label htmlFor={selectId} className="type-title text-ink">
        Students can see slides until
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <select
          id={selectId}
          value={access}
          disabled={saving}
          onChange={(e) => {
            if (isStudentAccess(e.target.value)) setAccess(e.target.value);
            setError(null);
            setDone(false);
          }}
          className={`${control} min-w-0 max-w-full pr-10`}
        >
          {ACCESS_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {access === "semester" && (
          <>
            <label htmlFor={dateId} className="sr-only">
              Last day of the semester
            </label>
            <input
              id={dateId}
              type="date"
              value={end}
              min={today}
              disabled={saving}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(e) => {
                setEnd(e.target.value);
                setError(null);
                setDone(false);
              }}
              className={`${control} w-auto`}
            />
          </>
        )}
        <button type="submit" disabled={saving || !changed} className={buttonPrimaryInlineClass}>
          Save
        </button>
        <p role="status" className="type-small text-secondary empty:sr-only">
          {done && !changed ? "Saved." : ""}
        </p>
      </div>
      {error && (
        <p id={errorId} role="alert" className="flex animate-fade-in items-center gap-2 type-small text-ink">
          <Icon name="alert" size={18} />
          {error}
        </p>
      )}
    </form>
  );
}
