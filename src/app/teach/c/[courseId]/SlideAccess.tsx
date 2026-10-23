"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { buttonPrimaryInlineClass } from "@/components/ButtonPrimary";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { formatLectureDate } from "@/lib/lectureDate";
import {
  ACCESS_DAYS_MAX,
  accessChoices,
  choiceOf,
  defaultSemesterEnd,
  type AccessChoice,
  type StudentAccess,
} from "@/lib/slideAccess";
import { STATUS_MS } from "../../settings/NameForm";
import { moveFocus, usePopup } from "../../usePopup";

/** The date and number fields: 48 high, surface, hairline, radius md, Body (the teacher field look). */
const control =
  "h-12 rounded-md border border-hairline bg-surface px-4 type-body text-ink outline-hidden " +
  "transition-[border-color,box-shadow] duration-(--dur-fast) ease-out " +
  "focus:border-ink focus:shadow-[inset_0_0_0_0.5px_var(--color-ink)] disabled:text-secondary";

/** The popup's button: the same field look, the chevron inside its own padding (never on the edge). */
const triggerClass =
  "press focus-ring inline-flex h-12 min-w-64 max-w-full items-center justify-between gap-4 rounded-md border border-hairline bg-surface pr-3 pl-4 " +
  "text-left type-body text-ink transition-[border-color,background-color] duration-(--dur-fast) ease-out " +
  "hover:border-strip aria-expanded:border-ink disabled:text-secondary";

const optionClass =
  "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-sm px-3 py-2 text-left outline-hidden " +
  "transition-colors duration-(--dur-fast) ease-out hover:bg-bg focus-visible:bg-bg " +
  "focus-visible:shadow-[inset_0_0_0_2px_var(--color-ink)]";

type Props = {
  courseId: string;
  access: StudentAccess;
  /** The course's own semester end (YYYY-MM-DD), or null for the usual one. */
  semesterEnd: string | null;
  /** Custom: days after each class (migration 0019), or null. */
  accessDays?: number | null;
  /** Custom: the last day (YYYY-MM-DD, migration 0019), or null. */
  accessUntil?: string | null;
  /** Migration 0019 is in: A week and Custom are offered and the two custom columns are saved. */
  options?: boolean;
  /** Today in Oxford (YYYY-MM-DD), from the server, for the usual end shown when there is no date. */
  today: string;
};

type Kind = "date" | "days";
type Value = { access: StudentAccess; end: string; until: string; days: string };

const DAYS_DEFAULT = "14";

/**
 * "Students can see slides until" on the course page. A button opens a small popup of its own (not
 * the browser's select menu): End of semester (with its date: the usual May 15 or Dec 18 until the
 * teacher sets one), 30 days after each class, A week after each class, Always, and Custom (a date,
 * or a number of days after each class, 1 to 365). Save writes the course row as the signed in
 * teacher (row level security keeps it to their own course); the database enforces it on the slide
 * rows and images (student_can_see_lecture, 0016, 0017 and 0019). Saving the usual date stores no
 * date, so the course goes on to the next semester by itself. Before migration 0019 only the first
 * three choices are offered and only the two old columns are written.
 */
export function SlideAccess({
  courseId,
  access: initialAccess,
  semesterEnd: initialEnd,
  accessDays,
  accessUntil,
  options = false,
  today,
}: Props) {
  const router = useRouter();
  const usual = defaultSemesterEnd(today);
  const first: Value = {
    access: initialAccess,
    end: initialEnd ?? usual,
    until: accessUntil ?? "",
    days: accessDays ? String(accessDays) : DAYS_DEFAULT,
  };
  const [saved, setSaved] = useState(first);
  const [choice, setChoice] = useState<AccessChoice>(choiceOf(initialAccess));
  const [kind, setKind] = useState<Kind>(initialAccess === "custom_date" ? "date" : "days");
  const [end, setEnd] = useState(first.end);
  const [until, setUntil] = useState(first.until);
  const [days, setDays] = useState(first.days);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorAt, setErrorAt] = useState<"end" | "until" | "days" | null>(null);
  const [done, setDone] = useState(false);
  const ids = useId();
  const labelId = `${ids}-label`;
  const dateId = `${ids}-date`;
  const errorId = `${ids}-error`;

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), STATUS_MS);
    return () => clearTimeout(t);
  }, [done]);

  const access: StudentAccess = choice === "custom" ? (kind === "days" ? "custom_days" : "custom_date") : choice;
  const changed =
    access !== saved.access ||
    (access === "semester" && end !== saved.end) ||
    (access === "custom_days" && days !== saved.days) ||
    (access === "custom_date" && until !== saved.until);

  const touched = () => {
    setError(null);
    setErrorAt(null);
    setDone(false);
  };
  const fail = (text: string, at: "end" | "until" | "days") => {
    setError(text);
    setErrorAt(at);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving || !changed) return;
    const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (access === "semester" && !isDate(end)) return fail("Pick the last day of the semester.", "end");
    if (access === "semester" && end < today) return fail("Pick a day from today on.", "end");
    if (access === "custom_date" && !isDate(until)) return fail("Pick the last day students can see the slides.", "until");
    if (access === "custom_date" && until < today) return fail("Pick a day from today on.", "until");
    const n = Number(days);
    if (access === "custom_days" && (!/^\d+$/.test(days.trim()) || n < 1 || n > ACCESS_DAYS_MAX)) {
      return fail(`Type a number of days from 1 to ${ACCESS_DAYS_MAX}.`, "days");
    }
    touched();
    setSaving(true);
    const sent: Value = { access, end, until, days: access === "custom_days" ? String(n) : days };
    const row: Record<string, unknown> = {
      student_access: sent.access,
      // The usual date is stored as none, so it moves on to the next semester by itself.
      semester_end: sent.access === "semester" && sent.end !== usual ? sent.end : null,
    };
    // The two columns from 0019, only once it is in (before, the update would name columns that do not exist).
    if (options) {
      row.access_days = sent.access === "custom_days" ? n : null;
      row.access_until = sent.access === "custom_date" ? sent.until : null;
    }
    try {
      const { data, error: updateError } = await createBrowserSupabase()
        .from("courses")
        .update(row)
        .eq("id", courseId)
        .select("id");
      if (updateError || !data || data.length === 0) throw new Error("not saved");
      setDays(sent.days);
      setSaved(sent);
      setDone(true);
      router.refresh();
    } catch {
      setError("Could not save. Try again.");
      setErrorAt(null);
    } finally {
      setSaving(false);
    }
  }

  const choices = accessChoices(options);
  const invalid = (at: "end" | "until" | "days") =>
    errorAt === at ? { "aria-invalid": true as const, "aria-describedby": errorId } : {};

  return (
    <form
      onSubmit={(e) => void submit(e)}
      // Checked here, with words that say what to fix, not the browser's bubble.
      noValidate
      data-testid="slide-access"
      className="flex flex-col gap-3 border-t border-hairline pt-5"
    >
      <p id={labelId} className="type-title text-ink">
        Students can see slides until
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <AccessPicker
          labelId={labelId}
          choices={choices}
          value={choice}
          semesterDate={end}
          disabled={saving}
          onPick={(next) => {
            setChoice(next);
            touched();
          }}
        />
        {choice === "semester" && (
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
              {...invalid("end")}
              onChange={(e) => {
                setEnd(e.target.value);
                touched();
              }}
              className={`${control} w-auto`}
            />
          </>
        )}
        {choice === "custom" && (
          <fieldset
            data-testid="custom-access"
            className="flex basis-full animate-pop-in flex-col gap-3 py-1"
          >
            <legend className="sr-only">Custom</legend>
            <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2">
              <label className="flex cursor-pointer items-center gap-2 type-body text-ink">
                <input
                  type="radio"
                  name={`${ids}-kind`}
                  checked={kind === "date"}
                  disabled={saving}
                  onChange={() => {
                    setKind("date");
                    touched();
                  }}
                  className="size-5 accent-ink"
                />
                Until a date
              </label>
              {kind === "date" && (
                <input
                  type="date"
                  aria-label="Last day students can see the slides"
                  value={until}
                  min={today}
                  disabled={saving}
                  {...invalid("until")}
                  onChange={(e) => {
                    setUntil(e.target.value);
                    touched();
                  }}
                  className={`${control} w-auto`}
                />
              )}
            </div>
            <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2">
              <label className="flex cursor-pointer items-center gap-2 type-body text-ink">
                <input
                  type="radio"
                  name={`${ids}-kind`}
                  checked={kind === "days"}
                  disabled={saving}
                  onChange={() => {
                    setKind("days");
                    touched();
                  }}
                  className="size-5 accent-ink"
                />
                A number of days after each class
              </label>
              {kind === "days" && (
                <span className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    aria-label="Days after each class"
                    min={1}
                    max={ACCESS_DAYS_MAX}
                    value={days}
                    disabled={saving}
                    {...invalid("days")}
                    onChange={(e) => {
                      setDays(e.target.value);
                      touched();
                    }}
                    className={`${control} w-24`}
                  />
                  <span aria-hidden className="type-body text-secondary">
                    days
                  </span>
                </span>
              )}
            </div>
          </fieldset>
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

/**
 * The choices popup: a button with the current choice, and under it a listbox of its own, drawn
 * like the app's menus (white, hairline, popover shadow), never the browser's select menu.
 * Keyboard: Enter, Space, ↓ or ↑ opens it on the current choice; ↑ ↓ Home End move; Enter or Space
 * picks; Esc or Tab closes it; the keyboard goes back to the button either way.
 */
function AccessPicker({
  labelId,
  choices,
  value,
  semesterDate,
  disabled,
  onPick,
}: {
  labelId: string;
  choices: { value: AccessChoice; label: string }[];
  value: AccessChoice;
  semesterDate: string;
  disabled: boolean;
  onPick: (value: AccessChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const ids = useId();
  const listId = `${ids}-list`;
  const buttonId = `${ids}-button`;

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }

  const place = usePopup({ open, close, trigger, panel: list, align: "left" });
  const placed = place !== null;

  // The keyboard goes to the current choice once the list is placed.
  useEffect(() => {
    if (!open || !placed) return;
    const items = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    (items.find((el) => el.getAttribute("aria-selected") === "true") ?? items[0])?.focus({ preventScroll: true });
  }, [open, placed]);

  const caption = (c: AccessChoice) =>
    c === "semester"
      ? /^\d{4}-\d{2}-\d{2}$/.test(semesterDate)
        ? formatLectureDate(semesterDate)
        : null
      : c === "custom"
        ? "A date, or a number of days after each class"
        : null;

  const current = choices.find((c) => c.value === value) ?? choices[0];

  function pick(next: AccessChoice) {
    onPick(next);
    close(true);
  }

  function onListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    if (moveFocus(e.key, items)) {
      e.preventDefault();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const at = (document.activeElement as HTMLElement | null)?.dataset.value as AccessChoice | undefined;
      if (at) pick(at);
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  }

  return (
    <>
      <button
        ref={trigger}
        id={buttonId}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${buttonId}`}
        data-testid="access-trigger"
        disabled={disabled}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={triggerClass}
      >
        <span className="truncate">{current.label}</span>
        <Icon
          name="forward"
          size={20}
          className="rotate-90 text-secondary transition-[rotate] duration-(--dur-fast) ease-out in-aria-expanded:-rotate-90"
        />
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={list}
            id={listId}
            role="listbox"
            aria-labelledby={labelId}
            data-testid="access-list"
            onKeyDown={onListKeyDown}
            style={place ?? { top: 0, left: 0, visibility: "hidden" }}
            className="fixed z-50 flex w-80 max-w-[calc(100vw-16px)] animate-pop-in flex-col rounded-md border border-hairline bg-surface p-1.5 shadow-popover"
          >
            {choices.map((c) => {
              const selected = c.value === value;
              const sub = caption(c.value);
              return (
                <div
                  key={c.value}
                  role="option"
                  tabIndex={-1}
                  aria-selected={selected}
                  data-value={c.value}
                  onClick={() => pick(c.value)}
                  className={optionClass}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="type-small-strong text-ink">{c.label}</span>
                    {sub && <span className="type-caption text-secondary">{sub}</span>}
                  </span>
                  {selected && <Icon name="check" size={18} />}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
