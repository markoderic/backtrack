"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { addCourse } from "./actions";
import { fieldClass, labelClass, textLinkClass } from "./ui";

/** "Add a course" under the course list. Opens a field in place (pops in); open from the start with no courses. */
export function AddCourseForm({ startOpen = false }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
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
    setName("");
    setOpen(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (!value) return;
    startTransition(async () => {
      await addCourse(value);
      setName("");
    });
  }

  if (!open) {
    return (
      <button ref={openButton} type="button" onClick={() => setOpen(true)} className={textLinkClass}>
        Add a course
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-[720px] animate-pop-in flex-col gap-2">
      <label htmlFor="new-course" className={labelClass}>
        Course name
      </label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <input
          id="new-course"
          value={name}
          maxLength={120}
          autoFocus={!startOpen}
          placeholder="ACC 221 Intro to Financial Accounting"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !startOpen) close();
          }}
          className={`${fieldClass} min-w-0 flex-1 basis-72`}
        />
        <button
          type="submit"
          disabled={pending || name.trim() === ""}
          className="press focus-ring inline-flex h-12 shrink-0 items-center justify-center rounded-md bg-ink px-6 type-button text-surface hover:bg-ink-hover disabled:cursor-default disabled:bg-strip disabled:hover:bg-strip"
        >
          Add course
        </button>
        {!startOpen && (
          <button
            type="button"
            onClick={close}
            className={textLinkClass}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
