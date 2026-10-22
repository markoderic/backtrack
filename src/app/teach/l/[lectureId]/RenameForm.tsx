"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const NAME_MAX = 120;

// Renames a lecture. Runs as the signed in teacher, so row level security
// (lectures_update_own) decides whether the update is allowed.
export function RenameForm({ lectureId, initialName }: { lectureId: string; initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const trimmed = name.trim();

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
      setName(trimmed);
      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not rename the lecture.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1">
          Lecture name
          <input
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
              setSaved(false);
            }}
            className="w-full border border-current px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={saving || trimmed === initialName.trim()}
          className="self-end border border-current px-4 py-2 disabled:opacity-40"
        >
          Rename
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">Renamed.</p>}
    </form>
  );
}
