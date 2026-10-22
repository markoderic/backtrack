"use client";

import { useState } from "react";
import { saveSetup } from "../actions";

const inputClass = "w-full border border-current px-3 py-2";

export function SetupForm() {
  const [name, setName] = useState("");
  const [courses, setCourses] = useState([""]);

  const ready = name.trim() !== "" && courses.some((c) => c.trim() !== "");

  return (
    <form action={saveSetup} className="flex w-full max-w-md flex-col gap-4">
      <label className="flex flex-col gap-1">
        Your name
        <input
          name="name"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </label>

      {courses.map((course, i) => (
        <label key={i} className="flex flex-col gap-1">
          Course
          <input
            name="course"
            value={course}
            maxLength={120}
            onChange={(e) => setCourses(courses.map((c, j) => (j === i ? e.target.value : c)))}
            className={inputClass}
          />
        </label>
      ))}

      <button type="button" onClick={() => setCourses([...courses, ""])} className="self-start underline">
        Add another course
      </button>

      <button type="submit" disabled={!ready} className="border border-current px-6 py-3 disabled:opacity-40">
        Continue
      </button>
    </form>
  );
}
