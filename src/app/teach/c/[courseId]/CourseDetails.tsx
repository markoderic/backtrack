"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { buttonPrimaryInlineClass, buttonSecondaryClass } from "@/components/ButtonPrimary";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import {
  COLOR_BG,
  COURSE_COLORS,
  DAYS,
  SECTION_MAX,
  parseTime,
  scheduleLabel,
  timeValue,
  type CourseColor,
  type CourseDetails,
} from "@/lib/courseDetails";
import { fieldClass, labelClass } from "../../ui";
import { STATUS_MS } from "../../settings/NameForm";

type ErrorField = "start" | "end" | "days" | "section";

/** The time fields: the teacher field look, as wide as a time needs. */
const timeClass =
  "h-12 w-40 max-w-full rounded-md border border-hairline bg-surface px-4 type-body text-ink outline-hidden " +
  "transition-[border-color,box-shadow] duration-(--dur-fast) ease-out " +
  "focus:border-ink focus:shadow-[inset_0_0_0_0.5px_var(--color-ink)] disabled:text-secondary";

/** A round 24 px swatch; the ring shows the chosen one (shape, not only color), the outline shows focus. */
const chipClass =
  "block size-6 rounded-full transition-[box-shadow,scale] duration-(--dur-fast) ease-spring " +
  "peer-checked:shadow-[0_0_0_2px_var(--color-bg),0_0_0_4px_var(--color-ink)] " +
  "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-6 peer-focus-visible:outline-ink " +
  "motion-safe:group-active:scale-90";

/**
 * The course's color, section and meeting time on its page (batch D): one line under the name
 * ("Section B · Mon Wed Fri · 10:05–11:00 AM") and Edit details, which opens a small form with
 * the eight color chips, the section, the days and the start and end time. Save writes the course
 * row as the signed in teacher (row level security keeps it to their own course; 0018 grants the
 * five columns). Only rendered once migration 0018 is in (the page reads the columns first).
 */
export function CourseDetailsEditor({
  courseId,
  code,
  details: initial,
}: {
  courseId: string;
  code: string;
  details: CourseDetails;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [color, setColor] = useState<CourseColor | null>(initial.color);
  const [section, setSection] = useState(initial.section ?? "");
  const [days, setDays] = useState<number[]>(initial.meetDays);
  const [start, setStart] = useState(timeValue(initial.startMinute));
  const [end, setEnd] = useState(timeValue(initial.endMinute));
  const [saving, setSaving] = useState(false);
  const [error, setErrorText] = useState<string | null>(null);
  // Which field the message is about, so only that one is marked invalid and points at it.
  const [errorAt, setErrorAt] = useState<ErrorField | null>(null);
  const setError = (text: string | null, at: ErrorField | null = null) => {
    setErrorText(text);
    setErrorAt(text ? at : null);
  };
  const [done, setDone] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const returnFocus = useRef(false);
  const id = useId();
  const sectionId = `${id}-section`;
  const startId = `${id}-start`;
  const endId = `${id}-end`;
  const errorId = `${id}-error`;

  // A new row from the server (after Save, or another tab) while the form is closed.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    if (!editing) setSaved(initial);
  }

  useEffect(() => {
    if (editing) {
      // Start on the chosen color (or No color), the first thing in the form.
      form.current?.querySelector<HTMLInputElement>('input[name$="color"]:checked')?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      editButton.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), STATUS_MS);
    return () => clearTimeout(t);
  }, [done]);

  function open() {
    setColor(saved.color);
    setSection(saved.section ?? "");
    setDays(saved.meetDays);
    setStart(timeValue(saved.startMinute));
    setEnd(timeValue(saved.endMinute));
    setError(null);
    setDone(false);
    setEditing(true);
  }

  function close() {
    returnFocus.current = true;
    setEditing(false);
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const startMinute = start ? parseTime(start) : null;
    const endMinute = end ? parseTime(end) : null;
    const trimmed = section.trim();
    if ((start && startMinute === null) || (end && endMinute === null)) {
      setError("Type the times like 10:05 AM.", start && startMinute === null ? "start" : "end");
      return;
    }
    if ((startMinute === null) !== (endMinute === null) || (days.length > 0 && startMinute === null)) {
      setError("Add when class starts and ends.", startMinute === null ? "start" : "end");
      return;
    }
    if (startMinute !== null && days.length === 0) {
      setError("Pick the days the class meets.", "days");
      return;
    }
    if (startMinute !== null && endMinute !== null && endMinute <= startMinute) {
      setError("Class has to end after it starts.", "end");
      return;
    }
    if (trimmed.length > SECTION_MAX) {
      setError(`The section can be at most ${SECTION_MAX} characters.`, "section");
      return;
    }
    setError(null);
    setSaving(true);
    const next: CourseDetails = {
      color,
      section: trimmed || null,
      meetDays: [...days].sort((a, b) => a - b),
      startMinute,
      endMinute,
    };
    try {
      const { data, error: updateError } = await createBrowserSupabase()
        .from("courses")
        .update({
          color: next.color,
          section: next.section,
          meet_days: next.meetDays.length ? next.meetDays : null,
          start_minute: next.startMinute,
          end_minute: next.endMinute,
        })
        .eq("id", courseId)
        .select("id");
      if (updateError || !data || data.length === 0) throw new Error("not saved");
      setSaved(next);
      setDone(true);
      close();
      router.refresh();
    } catch {
      setError("Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const summary = [saved.section, scheduleLabel(saved)].filter(Boolean).join(" · ");
  // Always in the page (outside the line and the form, which swap), so "Saved." is announced.
  const status = (
    <p role="status" className="type-small text-secondary empty:sr-only">
      {done && !editing ? "Saved." : ""}
    </p>
  );

  if (!editing) {
    return (
      <div className="flex flex-col gap-2">
        <div data-testid="course-details" className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {summary && <p className="type-body text-ink">{summary}</p>}
          <button ref={editButton} type="button" onClick={open} className={buttonSecondaryClass}>
            <Icon name="edit" size={18} />
            {summary || saved.color ? "Edit details" : "Add color, section and time"}
          </button>
        </div>
        {status}
      </div>
    );
  }

  const toggleDay = (n: number) => {
    setDays((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n]));
    setError(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <form
        ref={form}
        onSubmit={(e) => void submit(e)}
        onKeyDown={(e) => {
          // Esc in a time field belongs to the field (it closes the browser's time picker).
          if (e.key === "Escape" && !(e.target instanceof HTMLInputElement && e.target.type === "time")) {
            e.preventDefault();
            close();
          }
        }}
        noValidate
        data-testid="course-details-form"
        aria-label={`Details for ${code}`}
        className="flex max-w-180 animate-pop-in flex-col gap-6 border-y border-hairline py-6"
      >
        <fieldset className="flex flex-col gap-3">
          <legend className={`${labelClass} pb-3`}>Color</legend>
          <div className="flex flex-wrap items-center gap-1">
            <label className="group relative flex size-9 cursor-pointer items-center justify-center" title="No color">
              <input
                type="radio"
                name={`${id}-color`}
                checked={color === null}
                onChange={() => setColor(null)}
                disabled={saving}
                className="peer sr-only"
              />
              <span className={`${chipClass} border border-strip bg-surface`} />
              <span className="sr-only">No color</span>
            </label>
            {COURSE_COLORS.map((c) => (
              <label
                key={c.value}
                className="group relative flex size-9 cursor-pointer items-center justify-center"
                title={c.label}
              >
                <input
                  type="radio"
                  name={`${id}-color`}
                  value={c.value}
                  checked={color === c.value}
                  onChange={() => setColor(c.value)}
                  disabled={saving}
                  className="peer sr-only"
                />
                <span data-swatch={c.value} className={`${chipClass} ${COLOR_BG[c.value]}`} />
                <span className="sr-only">{c.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-2">
          <label htmlFor={sectionId} className={labelClass}>
            Section <span className="type-small text-secondary">(optional)</span>
          </label>
          <input
            id={sectionId}
            value={section}
            maxLength={SECTION_MAX}
            placeholder="Section B, 001"
            disabled={saving}
            aria-invalid={errorAt === "section" ? true : undefined}
            aria-describedby={errorAt === "section" ? errorId : undefined}
            onChange={(e) => {
              setSection(e.target.value);
              setError(null);
            }}
            className={`${fieldClass} max-w-80`}
          />
        </div>

        <fieldset className="flex flex-col" aria-describedby={errorAt === "days" ? errorId : undefined}>
          <legend className={`${labelClass} pb-3`}>Meets on</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d) => {
              const on = days.includes(d.n);
              return (
                <button
                  key={d.n}
                  type="button"
                  aria-pressed={on}
                  aria-label={d.long}
                  disabled={saving}
                  onClick={() => toggleDay(d.n)}
                  className={
                    "press focus-ring inline-flex h-11 min-w-13 items-center justify-center rounded-md border px-3 type-button " +
                    (on
                      ? "border-ink bg-ink text-surface hover:bg-ink-hover"
                      : "border-hairline bg-surface text-ink hover:border-strip hover:bg-bg")
                  }
                >
                  {d.short}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-x-6 gap-y-4">
          <div className="flex flex-col gap-2">
            <label htmlFor={startId} className={labelClass}>
              Starts
            </label>
            <input
              id={startId}
              type="time"
              value={start}
              disabled={saving}
              aria-invalid={errorAt === "start" ? true : undefined}
              aria-describedby={errorAt === "start" ? errorId : undefined}
              onChange={(e) => {
                setStart(e.target.value);
                setError(null);
              }}
              className={timeClass}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor={endId} className={labelClass}>
              Ends
            </label>
            <input
              id={endId}
              type="time"
              value={end}
              disabled={saving}
              aria-invalid={errorAt === "end" ? true : undefined}
              aria-describedby={errorAt === "end" ? errorId : undefined}
              onChange={(e) => {
                setEnd(e.target.value);
                setError(null);
              }}
              className={timeClass}
            />
          </div>
        </div>

        {error && (
          <p id={errorId} role="alert" className="flex animate-fade-in items-center gap-2 type-small text-ink">
            <Icon name="alert" size={18} />
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" disabled={saving} className={buttonPrimaryInlineClass}>
            Save
          </button>
          <button type="button" onClick={close} disabled={saving} className={buttonSecondaryClass}>
            Cancel
          </button>
        </div>
      </form>
      {status}
    </div>
  );
}
