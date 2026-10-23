"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { buttonPrimaryInlineClass, buttonSecondaryClass } from "@/components/ButtonPrimary";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { CourseDetails } from "@/lib/courseDetails";
import { CourseDetailsForm } from "./c/[courseId]/CourseDetails";
import { Dialog } from "./Dialog";
import { fieldClass, labelClass } from "./ui";
import { moveFocus, usePopup } from "./usePopup";

/** The menu items: 44 px tall rows, Small strong (the lecture row menu's look). */
const itemClass =
  "flex min-h-11 w-full items-center rounded-sm px-3 py-1.5 text-left type-small-strong text-ink outline-hidden " +
  "transition-colors duration-(--dur-fast) ease-out hover:bg-bg focus-visible:bg-bg " +
  "focus-visible:shadow-[inset_0_0_0_2px_var(--color-ink)]";

/** The course name's limit (courses_name_check, 0002). */
export const COURSE_NAME_MAX = 120;

type Props = {
  courseId: string;
  /** The full name, "IMS 452 Senior Design". */
  name: string;
  /** The code the card shows, "IMS 452". */
  code: string;
  /** Null before migration 0018: no Edit details. */
  details: CourseDetails | null;
  /** Migration 0019 is in: the new colors and Custom in Edit details. */
  options: boolean;
  /** Archives the course; false when it could not. The list moves the keyboard after it. */
  onArchive: () => Promise<boolean>;
  /** Says what just happened in the list's status line (Saved, Renamed). */
  announce: (text: string) => void;
};

/**
 * The ⋯ button in the top right corner of a course card on the dashboard (batch H, Marko: "a
 * three-dot menu in one of the corners"). Like the lecture row menu: always visible, 44 px, the
 * menu rendered into document.body (fixed, z-50) so the card's animation can not cover it.
 * Keyboard: Enter, Space or ↓ opens it on the first item (↑ on the last), ↑ ↓ Home End move, Esc or
 * Tab closes it with the keyboard back on ⋯.
 * - Download CSV: the course's semester CSV (the course page's Export semester CSV),
 * - Edit details: the color, section, days and time form, in a dialog, right on the dashboard,
 * - Rename: the name in a dialog,
 * - Archive: hides the course from Courses (Settings has Unarchive; the list offers Undo).
 */
export function CourseMenu({ courseId, name, code, details, options, onArchive, announce }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"details" | "rename" | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const startAt = useRef<"first" | "last">("first");
  const ids = useId();
  const menuId = `${ids}-menu`;

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }

  const place = usePopup({ open, close, trigger, panel: menu });
  const placed = place !== null;
  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  // The keyboard goes into the menu once it is placed.
  useEffect(() => {
    if (!open || !placed) return;
    const list = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    (startAt.current === "last" ? list[list.length - 1] : list[0])?.focus({ preventScroll: true });
  }, [open, placed]);

  function show(at: "first" | "last") {
    startAt.current = at;
    setOpen(true);
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      show(e.key === "ArrowUp" ? "last" : "first");
    }
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (moveFocus(e.key, items())) {
      e.preventDefault();
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  }

  function openDialog(which: "details" | "rename") {
    close(false);
    setDialog(which);
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={`More for ${code}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-course-menu={courseId}
        onClick={() => (open ? close(false) : show("first"))}
        onKeyDown={onTriggerKeyDown}
        className={
          "press focus-ring flex size-11 shrink-0 items-center justify-center gap-[3px] rounded-md border border-transparent text-ink " +
          "hover:border-hairline hover:bg-surface aria-expanded:border-hairline aria-expanded:bg-surface"
        }
      >
        {/* Three plain dots (CSS circles), the ⋯. */}
        <span aria-hidden className="size-1 rounded-full bg-current" />
        <span aria-hidden className="size-1 rounded-full bg-current" />
        <span aria-hidden className="size-1 rounded-full bg-current" />
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            role="menu"
            aria-label={code}
            data-testid="course-menu"
            onKeyDown={onMenuKeyDown}
            style={place ?? { top: 0, right: 0, visibility: "hidden" }}
            className="fixed z-50 flex w-56 animate-pop-in flex-col rounded-md border border-hairline bg-surface p-1.5 shadow-popover"
          >
            {/* A plain link, not next/link: it downloads a file and must not be prefetched as a page. */}
            <a
              role="menuitem"
              tabIndex={-1}
              href={`/teach/c/${courseId}/export`}
              download
              onClick={() => close(true)}
              className={itemClass}
            >
              Download CSV
            </a>
            {details && (
              <button
                role="menuitem"
                tabIndex={-1}
                type="button"
                aria-haspopup="dialog"
                onClick={() => openDialog("details")}
                className={itemClass}
              >
                Edit details
              </button>
            )}
            <button
              role="menuitem"
              tabIndex={-1}
              type="button"
              aria-haspopup="dialog"
              onClick={() => openDialog("rename")}
              className={itemClass}
            >
              Rename
            </button>
            <button
              role="menuitem"
              tabIndex={-1}
              type="button"
              onClick={() => {
                close(false);
                void onArchive();
              }}
              className={itemClass}
            >
              Archive
            </button>
          </div>,
          document.body,
        )}
      {details && (
        <Dialog
          open={dialog === "details"}
          onClose={() => setDialog(null)}
          title={`Details for ${code}`}
          returnFocusTo={trigger}
          wide
          testId="course-details-dialog"
        >
          <CourseDetailsForm
            courseId={courseId}
            code={code}
            initial={details}
            options={options}
            inDialog
            onCancel={() => setDialog(null)}
            onSaved={() => {
              setDialog(null);
              announce(`Saved the details for ${code}.`);
              router.refresh();
            }}
          />
        </Dialog>
      )}
      <Dialog
        open={dialog === "rename"}
        onClose={() => setDialog(null)}
        title={`Rename ${code}`}
        returnFocusTo={trigger}
        testId="rename-course-dialog"
      >
        <RenameCourseForm
          courseId={courseId}
          name={name}
          onCancel={() => setDialog(null)}
          onSaved={(next) => {
            setDialog(null);
            announce(`Renamed to ${next}.`);
            router.refresh();
          }}
        />
      </Dialog>
    </>
  );
}

/**
 * The course name in the Rename dialog: Save writes it as the signed in teacher (row level
 * security keeps it to their own course), the same check as Settings' Rename (1 to 120 characters).
 */
function RenameCourseForm({
  courseId,
  name,
  onCancel,
  onSaved,
}: {
  courseId: string;
  name: string;
  onCancel: () => void;
  onSaved: (name: string) => void;
}) {
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();
  const fieldId = `${ids}-name`;
  const errorId = `${ids}-error`;
  const trimmed = value.trim();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (trimmed.length < 1 || trimmed.length > COURSE_NAME_MAX) {
      setError("The course name must be 1 to 120 characters.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const { data, error: updateError } = await createBrowserSupabase()
        .from("courses")
        .update({ name: trimmed })
        .eq("id", courseId)
        .select("id");
      if (updateError || !data || data.length === 0) throw new Error("not renamed");
      setSaving(false);
      onSaved(trimmed);
    } catch {
      setError("Could not rename the course.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor={fieldId} className={labelClass}>
          Course name
        </label>
        <input
          id={fieldId}
          data-autofocus
          value={value}
          maxLength={COURSE_NAME_MAX}
          disabled={saving}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          className={fieldClass}
        />
      </div>
      {error && (
        <p id={errorId} role="alert" className="flex animate-fade-in items-center gap-2 type-small text-ink">
          <Icon name="alert" size={18} />
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={saving || trimmed === name.trim()} className={buttonPrimaryInlineClass}>
          Rename
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className={buttonSecondaryClass}>
          Cancel
        </button>
      </div>
    </form>
  );
}
