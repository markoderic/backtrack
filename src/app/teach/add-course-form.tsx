"use client";

import { useState, useTransition } from "react";
import { addCourse } from "./actions";

export function AddCourseForm() {
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (!value) return;
    startTransition(async () => {
      await addCourse(value);
      setName("");
    });
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <label className="flex flex-1 flex-col gap-1">
        Course name
        <input
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          className="w-full border border-current px-3 py-2"
        />
      </label>
      <button
        type="submit"
        disabled={pending || name.trim() === ""}
        className="self-end border border-current px-4 py-2 disabled:opacity-40"
      >
        Add course
      </button>
    </form>
  );
}
