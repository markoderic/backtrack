"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { fieldNarrowClass, labelClass, textLinkClass } from "../ui";
import { saveName } from "./actions";

const NAME_MAX = 80;

/** How long "Saved." and "Renamed." stay before the line clears. */
export const STATUS_MS = 4000;

/**
 * The small ink button that saves an edit in place (as Rename on the past lecture). 40 high,
 * with an invisible ::after 2 px above and below so the target is 44 px.
 */
export const saveButtonClass =
  "press focus-ring relative inline-flex h-10 shrink-0 items-center rounded-md bg-ink px-4 type-small-strong text-surface " +
  "after:absolute after:inset-x-0 after:-inset-y-0.5 after:content-[''] " +
  "hover:bg-ink-hover disabled:cursor-default disabled:bg-strip disabled:hover:bg-strip";

/**
 * "Your name, as students see it" (Figma 34:1264): a 480 wide field. Save and Cancel appear only
 * once the name is changed; Enter saves, Esc puts the saved name back. The saveName server action
 * checks the name and the account, and row level security (teachers_update_own) only lets the
 * teacher change their own row.
 */
export function NameForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState(initialName);
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  // A refresh brings the name in from the server.
  const [seenInitial, setSeenInitial] = useState(initialName);
  if (initialName !== seenInitial) {
    setSeenInitial(initialName);
    setCurrent(initialName);
    if (name.trim() === current) setName(initialName);
  }

  // "Saved." clears after a few seconds.
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), STATUS_MS);
    return () => clearTimeout(t);
  }, [saved]);

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
      const result = await saveName(trimmed);
      if (result) {
        setError(result.error);
        return;
      }
      setCurrent(trimmed);
      setName(trimmed);
      setSaved(true);
      // Save and Cancel go away with the change, so the keyboard goes back to the field.
      field.current?.focus();
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
          ref={field}
          id="settings-name"
          value={name}
          maxLength={NAME_MAX}
          autoComplete="name"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "settings-name-error" : undefined}
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
          className={fieldNarrowClass}
        />
        {changed && (
          <>
            <button type="submit" disabled={saving || trimmed === ""} className={`${saveButtonClass} animate-pop-in`}>
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                field.current?.focus();
              }}
              className={`${textLinkClass} animate-pop-in`}
            >
              Cancel
            </button>
          </>
        )}
        {/* Always in the page, so screen readers announce the text when it appears. */}
        <p role="status" className="type-small text-secondary empty:sr-only">
          {!changed && saved ? "Saved." : ""}
        </p>
      </div>
      {error && (
        <p id="settings-name-error" role="alert" className="flex animate-fade-in items-center gap-2 type-small text-ink">
          <Icon name="alert" size={18} />
          {error}
        </p>
      )}
    </form>
  );
}
