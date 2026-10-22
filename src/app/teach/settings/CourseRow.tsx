"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { Icon } from "@/components/Icon";
import { fieldClass, textLinkClass } from "../ui";
import { saveButtonClass } from "./NameForm";

const NAME_MAX = 120;

/**
 * One course on Settings (Figma 34:1270): the name (Body), then Rename. Rename turns the row into
 * a field; Enter (or Rename) saves, Esc (or Cancel) leaves it as it was. Runs as the signed in
 * teacher, so row level security (courses_update_own) decides whether the update is allowed.
 * The design's Archive action is not built (needs Marko).
 */
export function CourseRow({ courseId, initialName }: { courseId: string; initialName: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const renameButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  const [seenInitial, setSeenInitial] = useState(initialName);
  if (initialName !== seenInitial) {
    setSeenInitial(initialName);
    if (!editing) setCurrent(initialName);
  }

  // Back on Rename after closing the field, so the keyboard does not lose its place.
  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      renameButton.current?.focus();
    }
  }, [editing]);

  const trimmed = name.trim();

  function open() {
    setName(current);
    setError(null);
    setSaved(false);
    setEditing(true);
  }

  function close() {
    returnFocus.current = true;
    setEditing(false);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (trimmed.length < 1 || trimmed.length > NAME_MAX) {
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
      setCurrent(trimmed);
      setName(trimmed);
      setSaved(true);
      returnFocus.current = true;
      setEditing(false);
      router.refresh();
    } catch {
      setError("Could not rename the course.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-6 py-3.5">
        <span className="min-w-0 flex-1 truncate type-body text-ink">{current}</span>
        {saved && (
          <p role="status" className="shrink-0 animate-fade-in type-small text-secondary">
            Renamed.
          </p>
        )}
        <button
          ref={renameButton}
          type="button"
          aria-label={`Rename ${current}`}
          onClick={open}
          className={`${textLinkClass} shrink-0`}
        >
          Rename
        </button>
      </div>
    );
  }

  const fieldId = `course-name-${courseId}`;
  return (
    <form onSubmit={(e) => void submit(e)} className="flex animate-pop-in flex-col gap-2 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label htmlFor={fieldId} className="sr-only">
          New name for {current}
        </label>
        <input
          id={fieldId}
          value={name}
          maxLength={NAME_MAX}
          autoFocus
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
          className={`${fieldClass} min-w-0 flex-1 basis-64`}
        />
        {/* Rename and Cancel wrap together, so on a phone the field gets the whole line. */}
        <div className="flex shrink-0 items-center gap-4">
          <button type="submit" disabled={saving || trimmed === current.trim()} className={saveButtonClass}>
            Rename
          </button>
          <button type="button" onClick={close} className={textLinkClass}>
            Cancel
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="flex animate-fade-in items-center gap-2 type-small text-ink">
          <Icon name="alert" size={18} />
          {error}
        </p>
      )}
    </form>
  );
}
