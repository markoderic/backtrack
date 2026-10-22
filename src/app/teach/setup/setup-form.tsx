"use client";

import { useState } from "react";
import { saveSetup } from "../actions";
import { ButtonPrimary } from "@/components/ButtonPrimary";
import { fieldClass, labelClass, textLinkBelowClass } from "../ui";

export function SetupForm({ defaultName = "" }: { defaultName?: string }) {
  const [name, setName] = useState(defaultName);
  const [courses, setCourses] = useState([""]);

  const ready = name.trim() !== "" && courses.some((c) => c.trim() !== "");

  return (
    <form action={saveSetup} className="flex w-full flex-col gap-7">
      <div className="flex flex-col gap-2">
        <label htmlFor="setup-name" className={labelClass}>
          Your name, as students see it
        </label>
        <input
          id="setup-name"
          name="name"
          value={name}
          maxLength={80}
          autoComplete="name"
          onChange={(e) => setName(e.target.value)}
          className={fieldClass}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className={`${labelClass} mb-2`}>Your courses</legend>
        {courses.map((course, i) => (
          <input
            key={i}
            name="course"
            aria-label="Course"
            value={course}
            maxLength={120}
            placeholder={i === 0 ? "ACC 221 Intro to Financial Accounting" : undefined}
            autoFocus={i > 0 && i === courses.length - 1}
            onChange={(e) => setCourses(courses.map((c, j) => (j === i ? e.target.value : c)))}
            className={`${fieldClass} ${i > 0 ? "animate-pop-in" : ""}`}
          />
        ))}
        <button type="button" onClick={() => setCourses([...courses, ""])} className={textLinkBelowClass}>
          Add another course
        </button>
      </fieldset>

      <ButtonPrimary type="submit" disabled={!ready}>
        Done
      </ButtonPrimary>
    </form>
  );
}
