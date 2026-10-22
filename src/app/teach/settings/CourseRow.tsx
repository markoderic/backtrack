"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { Icon } from "@/components/Icon";
import { fieldClass, textLinkClass } from "../ui";
import { STATUS_MS, saveButtonClass } from "./NameForm";

const NAME_MAX = 120;

/**
 * One course on Settings (Figma 34:1270): the name (Body), then Rename. Rename turns the row into
 * a field; Enter (or Rename) saves, Esc (or Cancel) leaves it as it was. Runs as the signed in
 * teacher, so row level security (courses_update_own) decides whether the update is allowed.
 * Archive (Figma 34:1275) is there when `onArchive` is given: the list moves the course to its
 * Archived group, and `note` ("Unarchived.") shows next to the name for a moment.
 */
export function CourseRow({
  courseId,
  initialName,
  onArchive,
  note,
  focusOnMount,
}: {
  courseId: string;
  initialName: string;
  /** Archives the course; false when it could not. */
  onArchive?: () => Promise<boolean>;
  /** A short status next to the name, for the eye only (the list announces it). */
  note?: string | null;
  /** Focus Archive when the row appears (it just came back from the Archived group). */
  focusOnMount?: boolean;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState(false);
  const renameButton = useRef<HTMLButtonElement>(null);
  const archiveButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (focusOnMount) archiveButton.current?.focus();
    // Only when the row appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function archive() {
    if (!onArchive || archiving) return;
    setArchiving(true);
    setArchiveError(false);
    setSaved(false);
    const ok = await onArchive();
    setArchiving(false);
    if (!ok) setArchiveError(true);
  }

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

  // "Renamed." clears after a few seconds.
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), STATUS_MS);
    return () => clearTimeout(t);
  }, [saved]);

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

  // The row swaps between the name and the field, so the announcement lives outside both and
  // stays in the page; the visible "Renamed." next to the name is for the eye only.
  const status = (
    <p role="status" className="sr-only">
      {saved ? `Renamed to ${current}.` : ""}
    </p>
  );

  const shownNote = saved ? "Renamed." : (note ?? null);

  if (!editing) {
    return (
      <>
        {status}
        <div className="flex min-w-0 items-center gap-6 py-3.5">
          <span className="min-w-0 flex-1 truncate type-body text-ink">{current}</span>
          {shownNote && (
            <p aria-hidden className="shrink-0 animate-fade-in type-small text-secondary">
              {shownNote}
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
          {onArchive && (
            <button
              ref={archiveButton}
              type="button"
              aria-label={`Archive ${current}`}
              disabled={archiving}
              onClick={() => void archive()}
              className={`${textLinkClass} shrink-0`}
            >
              Archive
            </button>
          )}
        </div>
        {archiveError && (
          <p role="alert" className="flex animate-fade-in items-center gap-2 pb-3 type-small text-ink">
            <Icon name="alert" size={18} />
            Could not archive the course.
          </p>
        )}
      </>
    );
  }

  const fieldId = `course-name-${courseId}`;
  const errorId = `course-name-error-${courseId}`;
  return (
    <>
      {status}
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
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
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
          <p id={errorId} role="alert" className="flex animate-fade-in items-center gap-2 type-small text-ink">
            <Icon name="alert" size={18} />
            {error}
          </p>
        )}
      </form>
    </>
  );
}
