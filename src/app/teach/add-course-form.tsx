"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { addCourse } from "./actions";
import { Icon } from "@/components/Icon";
import { buttonPrimaryInlineClass, buttonSecondaryClass } from "@/components/ButtonPrimary";
import { fieldClass, labelClass } from "./ui";

/**
 * The course name field with Add course (and Cancel when it can close). Adds the trimmed name with
 * the addCourse server action; `onAdded` runs after it is in.
 */
function CourseNameForm({
  id,
  canClose,
  autoFocus,
  onClose,
  onAdded,
}: {
  id?: string;
  canClose: boolean;
  autoFocus: boolean;
  onClose: () => void;
  onAdded?: () => void;
}) {
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (!value) return;
    startTransition(async () => {
      await addCourse(value);
      setName("");
      onAdded?.();
    });
  }

  return (
    <form id={id} onSubmit={submit} className="flex w-full max-w-[720px] animate-pop-in flex-col gap-2 pt-4">
      <label htmlFor="new-course" className={labelClass}>
        Course name
      </label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <input
          id="new-course"
          value={name}
          maxLength={120}
          autoFocus={autoFocus}
          placeholder="ACC 221 Intro to Financial Accounting"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && canClose) onClose();
          }}
          className={`${fieldClass} min-w-0 flex-1 basis-72`}
        />
        <button type="submit" disabled={pending || name.trim() === ""} className={buttonPrimaryInlineClass}>
          Add course
        </button>
        {canClose && (
          <button type="button" onClick={onClose} className={buttonSecondaryClass}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** "Add a course" on Settings, under the course list. Opens a field in place (pops in); open from the start with no courses. */
export function AddCourseForm({ startOpen = false }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const openButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  // Closing the field puts the keyboard back on Add a course.
  useEffect(() => {
    if (!open && refocus.current) {
      refocus.current = false;
      openButton.current?.focus();
    }
  }, [open]);

  function close() {
    refocus.current = true;
    setOpen(false);
  }

  if (!open) {
    return (
      <button ref={openButton} type="button" onClick={() => setOpen(true)} className={`${buttonSecondaryClass} mt-4 w-fit`}>
        Add a course
      </button>
    );
  }

  return <CourseNameForm canClose={!startOpen} autoFocus={!startOpen} onClose={close} />;
}

/**
 * The dashboard's "Courses" heading with a "+" icon button in the top right corner (batch H,
 * Marko: "just a plus button in a corner"), named "Add a course" for screen readers. It opens the
 * course name field under the heading; Add course or Cancel closes it again with the keyboard back
 * on "+". With no courses yet the field is open from the start (and "+" closes nothing then).
 */
export function CoursesHeading({ startOpen = false }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const plus = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const formId = useId();

  useEffect(() => {
    if (!open && refocus.current) {
      refocus.current = false;
      plus.current?.focus();
    }
  }, [open]);

  function close() {
    refocus.current = true;
    setOpen(false);
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h1 className="type-display text-ink">Courses</h1>
        <button
          ref={plus}
          type="button"
          aria-label="Add a course"
          aria-expanded={open}
          aria-controls={open ? formId : undefined}
          data-testid="add-course-plus"
          onClick={() => {
            if (!open) setOpen(true);
            else if (startOpen) document.getElementById("new-course")?.focus();
            else close();
          }}
          className={`${buttonSecondaryClass} size-11 shrink-0 px-0!`}
        >
          {/* The brand close icon turned 45 degrees: the same stroke, as a +. */}
          <Icon name="close" size={22} className="rotate-45" />
        </button>
      </div>
      {open && (
        <CourseNameForm
          id={formId}
          canClose={!startOpen}
          autoFocus={!startOpen}
          onClose={close}
          onAdded={() => {
            if (!startOpen) close();
          }}
        />
      )}
    </>
  );
}
