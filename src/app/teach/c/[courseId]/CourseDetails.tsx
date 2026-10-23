"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { buttonPrimaryInlineClass, buttonSecondaryClass } from "@/components/ButtonPrimary";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import {
  COLOR_BG,
  DAYS,
  SECTION_MAX,
  isPresetColor,
  normalizeHex,
  parseTime,
  presetColors,
  scheduleLabel,
  timeValue,
  type CourseDetails,
  type PresetColor,
} from "@/lib/courseDetails";
import { fieldClass, labelClass } from "../../ui";
import { STATUS_MS } from "../../settings/NameForm";

type ErrorField = "start" | "end" | "days" | "section" | "color";

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

/** The Custom chip before a color is picked: every preset around a circle (globals.css, tokens only). */
const rainbowClass = "bg-course-rainbow";

type Choice = PresetColor | "custom" | null;

/** A preset's own color, read from its token, to start Custom from (empty where styles are not loaded). */
function tokenHex(color: PresetColor): string {
  if (typeof window === "undefined") return "";
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--color-course-${color}`);
  return normalizeHex(v) ?? "";
}

/**
 * The details form (batch D, batch H): the color chips, the section, the days and the start and
 * end time. Used in place on the course page and in a dialog from the dashboard card's ⋯ menu.
 * Save writes the course row as the signed in teacher (row level security keeps it to their own
 * course; 0018 grants the five columns). `options` is true once migration 0019 is in: the eleven
 * presets and Custom (any #rrggbb, with the browser's color picker or typed). Before 0019 only the
 * eight presets the database takes are offered (a course's custom color can not exist yet).
 */
export function CourseDetailsForm({
  courseId,
  code,
  initial,
  options,
  onSaved,
  onCancel,
  inDialog = false,
}: {
  courseId: string;
  code: string;
  initial: CourseDetails;
  options: boolean;
  onSaved: (next: CourseDetails) => void;
  onCancel: () => void;
  /** In a dialog: no rules above and below, and the dialog's title names it. */
  inDialog?: boolean;
}) {
  const presets = presetColors(options);
  const startHex = normalizeHex(initial.color);
  const [choice, setChoice] = useState<Choice>(
    isPresetColor(initial.color) ? initial.color : startHex && options ? "custom" : null,
  );
  const [custom, setCustom] = useState(startHex ?? "");
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
  const form = useRef<HTMLFormElement>(null);
  const id = useId();
  const sectionId = `${id}-section`;
  const startId = `${id}-start`;
  const endId = `${id}-end`;
  const hexId = `${id}-hex`;
  const errorId = `${id}-error`;

  useEffect(() => {
    // Start on the chosen color (or No color), the first thing in the form.
    form.current?.querySelector<HTMLInputElement>('input[name$="color"]:checked')?.focus();
  }, []);

  const pickedHex = normalizeHex(custom.startsWith("#") ? custom : `#${custom}`);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const startMinute = start ? parseTime(start) : null;
    const endMinute = end ? parseTime(end) : null;
    const trimmed = section.trim();
    if (choice === "custom" && !pickedHex) {
      setError("Pick a color, or type one like #2f6db5.", "color");
      return;
    }
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
      color: choice === "custom" ? pickedHex : choice,
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
      setSaving(false);
      onSaved(next);
    } catch {
      setError("Could not save. Try again.");
      setSaving(false);
    }
  }

  const toggleDay = (n: number) => {
    setDays((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n]));
    setError(null);
  };

  const pick = (next: Choice) => {
    if (next === "custom" && !custom) {
      // Start the picker from the color the course had (or slate), not from black.
      setCustom(tokenHex(isPresetColor(choice) ? choice : "slate"));
    }
    setChoice(next);
    setError(null);
  };

  return (
    <form
      ref={form}
      onSubmit={(e) => void submit(e)}
      onKeyDown={(e) => {
        // Esc in a time or color field belongs to the field (it closes the browser's own picker).
        const t = e.target;
        if (e.key === "Escape" && !(t instanceof HTMLInputElement && (t.type === "time" || t.type === "color"))) {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
      noValidate
      data-testid="course-details-form"
      aria-label={`Details for ${code}`}
      className={
        inDialog
          ? "flex flex-col gap-6"
          : "flex max-w-180 animate-pop-in flex-col gap-6 border-y border-hairline py-6"
      }
    >
      <fieldset className="flex flex-col gap-3" aria-describedby={errorAt === "color" ? errorId : undefined}>
        <legend className={`${labelClass} pb-3`}>Color</legend>
        <div className="flex flex-wrap items-center gap-1">
          <label className="group relative flex size-9 cursor-pointer items-center justify-center" title="No color">
            <input
              type="radio"
              name={`${id}-color`}
              checked={choice === null}
              onChange={() => pick(null)}
              disabled={saving}
              className="peer sr-only"
            />
            <span className={`${chipClass} border border-strip bg-surface`} />
            <span className="sr-only">No color</span>
          </label>
          {presets.map((c) => (
            <label
              key={c.value}
              className="group relative flex size-9 cursor-pointer items-center justify-center"
              title={c.label}
            >
              <input
                type="radio"
                name={`${id}-color`}
                value={c.value}
                checked={choice === c.value}
                onChange={() => pick(c.value)}
                disabled={saving}
                className="peer sr-only"
              />
              <span data-swatch={c.value} className={`${chipClass} ${COLOR_BG[c.value]}`} />
              <span className="sr-only">{c.label}</span>
            </label>
          ))}
          {options && (
            <label className="group relative flex size-9 cursor-pointer items-center justify-center" title="Custom">
              <input
                type="radio"
                name={`${id}-color`}
                value="custom"
                checked={choice === "custom"}
                onChange={() => pick("custom")}
                disabled={saving}
                className="peer sr-only"
              />
              <span
                data-swatch="custom"
                className={`${chipClass} ${choice === "custom" && pickedHex ? "" : rainbowClass}`}
                style={choice === "custom" && pickedHex ? { backgroundColor: pickedHex } : undefined}
              />
              <span className="sr-only">Custom</span>
            </label>
          )}
        </div>
        {options && choice === "custom" && (
          <div className="flex animate-pop-in flex-wrap items-center gap-3">
            <input
              type="color"
              aria-label="Pick a color"
              value={pickedHex ?? "#000000"}
              disabled={saving}
              onChange={(e) => {
                setCustom(e.target.value.toLowerCase());
                setError(null);
              }}
              className="press focus-ring size-11 shrink-0 cursor-pointer rounded-md border border-hairline bg-surface p-1"
            />
            <label htmlFor={hexId} className="sr-only">
              Custom color
            </label>
            <input
              id={hexId}
              value={custom}
              maxLength={7}
              spellCheck={false}
              autoComplete="off"
              placeholder="#2f6db5"
              disabled={saving}
              aria-invalid={errorAt === "color" ? true : undefined}
              aria-describedby={errorAt === "color" ? errorId : undefined}
              onChange={(e) => {
                setCustom(e.target.value.trim().toLowerCase());
                setError(null);
              }}
              className={`${fieldClass} w-32!`}
            />
          </div>
        )}
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
        <button type="button" onClick={onCancel} disabled={saving} className={buttonSecondaryClass}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The course's color, section and meeting time on its page (batch D): one line under the name
 * ("Section B · Mon Wed Fri · 10:05–11:00 AM") and Edit details, which opens the details form in
 * place. Only rendered once migration 0018 is in (the page reads the columns first).
 */
export function CourseDetailsEditor({
  courseId,
  code,
  details: initial,
  options = false,
}: {
  courseId: string;
  code: string;
  details: CourseDetails;
  /** Migration 0019 is in: the new colors and Custom. */
  options?: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [done, setDone] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // A new row from the server (after Save, or another tab) while the form is closed.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    if (!editing) setSaved(initial);
  }

  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      editButton.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), STATUS_MS);
    return () => clearTimeout(t);
  }, [done]);

  function close() {
    returnFocus.current = true;
    setEditing(false);
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
          <button
            ref={editButton}
            type="button"
            onClick={() => {
              setDone(false);
              setEditing(true);
            }}
            className={buttonSecondaryClass}
          >
            <Icon name="edit" size={18} />
            {summary || saved.color ? "Edit details" : "Add color, section and time"}
          </button>
        </div>
        {status}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <CourseDetailsForm
        courseId={courseId}
        code={code}
        initial={saved}
        options={options}
        onCancel={close}
        onSaved={(next) => {
          setSaved(next);
          setDone(true);
          close();
          router.refresh();
        }}
      />
      {status}
    </div>
  );
}
