/**
 * "Students can see slides until", per course (migration 0016). The database decides who may
 * read a lecture's slides (student_can_see_lecture); this only names the choices and works out
 * the date the course page shows when the teacher has not set one.
 */
export type StudentAccess = "semester" | "30d" | "always";

export const ACCESS_CHOICES: { value: StudentAccess; label: string }[] = [
  { value: "semester", label: "End of semester" },
  { value: "30d", label: "30 days after each class" },
  { value: "always", label: "Always" },
];

export function isStudentAccess(v: unknown): v is StudentAccess {
  return v === "semester" || v === "30d" || v === "always";
}

/**
 * The usual end of the semester a day falls in, as the database works it out for a course
 * with no date of its own: May 15 for a day on or before May 15, else Dec 18, and after
 * Dec 18 the next May 15. Days are YYYY-MM-DD text, never Dates, so no time zone moves them.
 */
export function defaultSemesterEnd(day: string): string {
  const year = Number(day.slice(0, 4));
  if (day <= `${year}-05-15`) return `${year}-05-15`;
  if (day <= `${year}-12-18`) return `${year}-12-18`;
  return `${year + 1}-05-15`;
}

/** Today in Oxford, Ohio, as YYYY-MM-DD (the database ends days at midnight there too). */
export function todayInOxford(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
