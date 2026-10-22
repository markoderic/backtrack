"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { Icon } from "@/components/Icon";
import { rowPressClass, textLinkClass } from "../../ui";

const NAME_MAX = 120;

// Renames a lecture. Runs as the signed in teacher, so row level security
// (lectures_update_own) decides whether the update is allowed.
// The past lecture heading (Figma 34:1117): the name with a pencil; a click turns it into a field.
// Enter (or Rename) saves, Esc (or Cancel) leaves it as it was.
export function RenameForm({ lectureId, initialName }: { lectureId: string; initialName: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const nameButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // A refresh after a rename brings the new name in from the server.
  const [seenInitial, setSeenInitial] = useState(initialName);
  if (initialName !== seenInitial) {
    setSeenInitial(initialName);
    if (!editing) setCurrent(initialName);
  }

  // Back on the name after closing the field, so the keyboard does not lose its place.
  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      nameButton.current?.focus();
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
    setSaved(false);
    if (trimmed.length < 1 || trimmed.length > NAME_MAX) {
      setError("The name must be 1 to 120 characters.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const { data, error: updateError } = await createBrowserSupabase()
        .from("lectures")
        .update({ name: trimmed })
        .eq("id", lectureId)
        .select("id");
      // No row back means the update matched nothing (not the teacher's lecture).
      if (updateError || !data || data.length === 0) throw new Error("not renamed");
      setCurrent(trimmed);
      setName(trimmed);
      setSaved(true);
      returnFocus.current = true;
      setEditing(false);
      router.refresh();
    } catch {
      setError("Could not rename the lecture.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="min-w-0">
          <button
            ref={nameButton}
            type="button"
            onClick={open}
            className={`group flex min-w-0 items-center gap-2.5 rounded-sm text-left ${rowPressClass}`}
          >
            <span className="min-w-0 type-lecture-l break-words text-ink">{current}</span>{" "}
            <Icon
              name="edit"
              size={18}
              className="text-secondary transition-colors duration-(--dur-fast) ease-out group-hover:text-ink"
            />
            {/* Read as "<name> Rename". */}
            <span className="sr-only"> Rename</span>
          </button>
        </h1>
        {saved && (
          <p role="status" className="animate-fade-in type-small text-secondary">
            Renamed.
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex w-full max-w-[640px] animate-pop-in flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label htmlFor="rename-lecture" className="sr-only">
          Lecture name
        </label>
        <input
          id="rename-lecture"
          value={name}
          maxLength={NAME_MAX}
          autoFocus
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
            setSaved(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
          className={
            "h-12 min-w-0 flex-1 basis-64 rounded-md border border-hairline bg-surface px-4 type-lecture-l text-ink outline-hidden " +
            "transition-[border-color,box-shadow] duration-(--dur-fast) ease-out focus:border-ink focus:shadow-[inset_0_0_0_0.5px_var(--color-ink)]"
          }
        />
        <button
          type="submit"
          disabled={saving || trimmed === current.trim()}
          className="press focus-ring inline-flex h-10 shrink-0 items-center rounded-md bg-ink px-4 type-small-strong text-surface hover:bg-ink-hover disabled:cursor-default disabled:bg-strip disabled:hover:bg-strip"
        >
          Rename
        </button>
        <button type="button" onClick={close} className={textLinkClass}>
          Cancel
        </button>
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
