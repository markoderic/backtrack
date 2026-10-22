"use client";

import { useRef, useState, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import { saveSetup } from "../actions";
import { ButtonPrimary } from "@/components/ButtonPrimary";
import { fieldClass, labelClass, textLinkBelowClass } from "../ui";

/** The most courses setup takes at once (save_setup allows 20); more can be added in Settings. */
const COURSES_MAX = 20;

/** Done, disabled while the save runs so a second click can't send it again. */
function DoneButton({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <ButtonPrimary type="submit" disabled={!ready || pending} aria-busy={pending || undefined}>
      Done
    </ButtonPrimary>
  );
}

export function SetupForm({ defaultName = "" }: { defaultName?: string }) {
  const [name, setName] = useState(defaultName);
  const [courses, setCourses] = useState([""]);

  const ready = name.trim() !== "" && courses.some((c) => c.trim() !== "");
  // A double click can submit twice before the button has re-rendered as disabled; only the
  // first submit goes. (save_setup also does nothing the second time.)
  const sent = useRef(false);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (sent.current) e.preventDefault();
    else sent.current = true;
  };

  return (
    <form action={saveSetup} onSubmit={onSubmit} className="flex w-full flex-col gap-7">
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
        {courses.length < COURSES_MAX && (
          <button type="button" onClick={() => setCourses([...courses, ""])} className={textLinkBelowClass}>
            Add another course
          </button>
        )}
      </fieldset>

      <DoneButton ready={ready} />
    </form>
  );
}
