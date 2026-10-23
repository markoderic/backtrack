/**
 * "Students can see slides until", per course (migrations 0016 and 0019). The database decides who
 * may read a lecture's slides (student_can_see_lecture); this only names the choices and works out
 * the date the course page shows when the teacher has not set one.
 *
 * Stored values (courses.student_access):
 *   semester     the end of the semester (courses.semester_end, or the usual May 15 / Dec 18)
 *   30d          30 days after each class
 *   7d           a week after each class (0019)
 *   always       no end
 *   custom_days  a number of days after each class, courses.access_days, 1 to 365 (0019)
 *   custom_date  until a date, courses.access_until, for every lecture (0019)
 */
export type StudentAccess = "semester" | "30d" | "7d" | "always" | "custom_days" | "custom_date";

/** What the popup offers: the two custom values are one choice, Custom, with a date or days under it. */
export type AccessChoice = "semester" | "30d" | "7d" | "always" | "custom";

export const ACCESS_CHOICES: { value: AccessChoice; label: string; added: boolean }[] = [
  { value: "semester", label: "End of semester", added: false },
  { value: "30d", label: "30 days after each class", added: false },
  { value: "7d", label: "A week after each class", added: true },
  { value: "always", label: "Always", added: false },
  { value: "custom", label: "Custom", added: true },
];

/** The choices the database takes: all five after migration 0019, the first three before it. */
export function accessChoices(options: boolean) {
  return ACCESS_CHOICES.filter((c) => options || !c.added);
}

export function choiceOf(access: StudentAccess): AccessChoice {
  return access === "custom_days" || access === "custom_date" ? "custom" : access;
}

const ALL: readonly string[] = ["semester", "30d", "7d", "always", "custom_days", "custom_date"];

export function isStudentAccess(v: unknown): v is StudentAccess {
  return typeof v === "string" && ALL.includes(v);
}

/** Custom days after each class: 1 to 365 (the database checks the same). */
export const ACCESS_DAYS_MAX = 365;

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
