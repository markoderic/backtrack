"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { Icon } from "@/components/Icon";

const NAME_MAX = 120;

/** How long "Renamed." stays before the line clears. */
const STATUS_MS = 4000;

/**
 * The past lecture's name, always editable in place (Marko, 2:05 PM: "I just want to be able to
 * type"): a text field that looks like the heading (Lecture L) until it is pointed at or clicked,
 * then shows its field border. Enter or leaving the field saves, Esc puts the saved name back.
 * "Renamed." shows quietly for a few seconds. The update runs as the signed in teacher, so row
 * level security (lectures_update_own, and the 0014 column grant on name) decides if it is allowed.
 * The field sits inside the h1, so the heading is read as the lecture's name.
 */
export function RenameForm({ lectureId, initialName }: { lectureId: string; initialName: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState(initialName);
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const busy = useRef(false);
  const field = useRef<HTMLInputElement>(null);

  // A refresh brings the name in from the server; it replaces the field only when nothing is typed there.
  const [seenInitial, setSeenInitial] = useState(initialName);
  if (initialName !== seenInitial) {
    setSeenInitial(initialName);
    setCurrent(initialName);
    if (name === current) setName(initialName);
  }

  // "Renamed." clears after a few seconds.
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), STATUS_MS);
    return () => clearTimeout(t);
  }, [saved]);

  async function commit() {
    if (busy.current) return;
    const trimmed = name.trim();
    if (trimmed === current) {
      // Nothing new (maybe only spaces around it): show the saved name again.
      if (name !== current) setName(current);
      setError(null);
      return;
    }
    if (trimmed.length < 1 || trimmed.length > NAME_MAX) {
      setError("The name must be 1 to 120 characters.");
      return;
    }
    busy.current = true;
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
      router.refresh();
    } catch {
      setError("Could not rename the lecture.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void commit();
      }}
      className="flex w-full max-w-[640px] min-w-0 flex-col gap-1"
    >
      <div className="flex min-w-0 items-center gap-3">
        <label htmlFor="rename-lecture" className="sr-only">
          Lecture name
        </label>
        <h1 className="min-w-0 flex-1">
          <input
            ref={field}
            id="rename-lecture"
            value={name}
            maxLength={NAME_MAX}
            spellCheck={false}
            autoComplete="off"
            enterKeyHint="done"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "rename-lecture-error" : undefined}
            aria-busy={saving || undefined}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
              setSaved(false);
            }}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setName(current);
                setError(null);
              }
            }}
            className={
              // The heading's look and place: the 1 px border and the 8 px padding sit outside the
              // text (negative margin), so the name lines up with the line under it.
              "-mx-2 h-11 w-[calc(100%+16px)] min-w-0 truncate rounded-md border border-transparent bg-transparent px-2 type-lecture-l text-ink outline-hidden " +
              "transition-[border-color,background-color,box-shadow] duration-(--dur-fast) ease-out " +
              "hover:border-hairline focus:border-ink focus:bg-surface focus:shadow-[inset_0_0_0_0.5px_var(--color-ink)] " +
              "aria-invalid:border-ink"
            }
          />
        </h1>
        {/* Always in the page, so screen readers announce the text when it appears. */}
        {/* pl-2: the field's border reaches 8 px past its text, so this keeps clear of it. */}
        <p role="status" className="shrink-0 pl-2 type-small text-secondary empty:sr-only">
          {saved ? "Renamed." : ""}
        </p>
      </div>
      {error && (
        <p id="rename-lecture-error" role="alert" className="flex animate-fade-in items-center gap-2 type-small text-ink">
          <Icon name="alert" size={18} />
          {error}
        </p>
      )}
    </form>
  );
}
