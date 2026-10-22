"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { Icon } from "@/components/Icon";
import { fieldClass, labelClass, textLinkClass } from "../ui";

const NAME_MAX = 80;

/** The small ink button that saves an edit in place (as Rename on the past lecture). */
export const saveButtonClass =
  "press focus-ring inline-flex h-10 shrink-0 items-center rounded-md bg-ink px-4 type-small-strong text-surface " +
  "hover:bg-ink-hover disabled:cursor-default disabled:bg-strip disabled:hover:bg-strip";

/**
 * "Your name, as students see it" (Figma 34:1264): a 480 wide field. Save and Cancel appear only
 * once the name is changed; Enter saves, Esc puts the saved name back. Runs as the signed in
 * teacher, so row level security (teachers_update_own) only lets them change their own row.
 */
export function NameForm({ teacherId, initialName }: { teacherId: string; initialName: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState(initialName);
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // A refresh brings the name in from the server.
  const [seenInitial, setSeenInitial] = useState(initialName);
  if (initialName !== seenInitial) {
    setSeenInitial(initialName);
    setCurrent(initialName);
    if (name.trim() === current) setName(initialName);
  }

  const trimmed = name.trim();
  const changed = trimmed !== current;

  function reset() {
    setName(current);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving || !changed) return;
    if (trimmed.length < 1 || trimmed.length > NAME_MAX) {
      setError("Your name must be 1 to 80 characters.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const { data, error: updateError } = await createBrowserSupabase()
        .from("teachers")
        .update({ display_name: trimmed })
        .eq("id", teacherId)
        .select("id");
      // No row back means the update matched nothing (not this teacher's row).
      if (updateError || !data || data.length === 0) throw new Error("not saved");
      setCurrent(trimmed);
      setName(trimmed);
      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not save your name.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
      <label htmlFor="settings-name" className={labelClass}>
        Your name, as students see it
      </label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <input
          id="settings-name"
          value={name}
          maxLength={NAME_MAX}
          autoComplete="name"
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
            setSaved(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && changed) {
              e.preventDefault();
              reset();
            }
          }}
          className={fieldClass.replace("w-full", "w-120 max-w-full")}
        />
        {changed && (
          <>
            <button type="submit" disabled={saving || trimmed === ""} className={`${saveButtonClass} animate-pop-in`}>
              Save
            </button>
            <button type="button" onClick={reset} className={`${textLinkClass} animate-pop-in`}>
              Cancel
            </button>
          </>
        )}
        {!changed && saved && (
          <p role="status" className="animate-fade-in type-small text-secondary">
            Saved.
          </p>
        )}
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
