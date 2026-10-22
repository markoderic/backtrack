import { formatLectureDate } from "./lectureDate";

/**
 * A course's color, section and meeting days and time (migration 0018), and the "Now" / "Next"
 * meeting on the courses dashboard. Times are minutes after midnight in Oxford, Ohio
 * (America/New_York), the same clock lecture_date uses; days are 1 = Monday ... 7 = Sunday.
 */

export const COURSE_COLORS = [
  { value: "slate", label: "Slate" },
  { value: "blue", label: "Blue" },
  { value: "indigo", label: "Indigo" },
  { value: "plum", label: "Plum" },
  { value: "teal", label: "Teal" },
  { value: "green", label: "Green" },
  { value: "olive", label: "Olive" },
  { value: "ochre", label: "Ochre" },
] as const;

export type CourseColor = (typeof COURSE_COLORS)[number]["value"];

/** The background utility for each swatch, written out so Tailwind generates every one. */
export const COLOR_BG: Record<CourseColor, string> = {
  slate: "bg-course-slate",
  blue: "bg-course-blue",
  indigo: "bg-course-indigo",
  plum: "bg-course-plum",
  teal: "bg-course-teal",
  green: "bg-course-green",
  olive: "bg-course-olive",
  ochre: "bg-course-ochre",
};

export function isCourseColor(v: unknown): v is CourseColor {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(COLOR_BG, v);
}

/** The background for a course's bar or dot; a quiet hairline when it has no color. */
export function colorClass(color: unknown): string {
  return isCourseColor(color) ? COLOR_BG[color] : "bg-hairline";
}

export function colorLabel(color: unknown): string | null {
  return COURSE_COLORS.find((c) => c.value === color)?.label ?? null;
}

export const SECTION_MAX = 40;

export const DAYS = [
  { n: 1, short: "Mon", long: "Monday" },
  { n: 2, short: "Tue", long: "Tuesday" },
  { n: 3, short: "Wed", long: "Wednesday" },
  { n: 4, short: "Thu", long: "Thursday" },
  { n: 5, short: "Fri", long: "Friday" },
  { n: 6, short: "Sat", long: "Saturday" },
  { n: 7, short: "Sun", long: "Sunday" },
] as const;

/** The five columns, as read from courses (any of them may be missing or empty). */
export type CourseDetails = {
  color: CourseColor | null;
  section: string | null;
  meetDays: number[];
  startMinute: number | null;
  endMinute: number | null;
};

export const DETAIL_COLUMNS = "color, section, meet_days, start_minute, end_minute";

const isMinute = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1440;

/** The details from a courses row, cleaned up: unknown colors, bad days and half a time range are left out. */
export function readDetails(row: Record<string, unknown>): CourseDetails {
  const days = Array.isArray(row.meet_days)
    ? [...new Set(row.meet_days.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7))].sort(
        (a, b) => a - b,
      )
    : [];
  const start = row.start_minute;
  const end = row.end_minute;
  const timed = isMinute(start) && isMinute(end) && end > start;
  const section = typeof row.section === "string" && row.section.trim() ? row.section.trim() : null;
  return {
    color: isCourseColor(row.color) ? row.color : null,
    section,
    meetDays: days,
    startMinute: timed ? start : null,
    endMinute: timed ? end : null,
  };
}

/** True when the course meets on set days at a set time, so it can be Now or Next. */
export function hasSchedule(d: CourseDetails): boolean {
  return d.meetDays.length > 0 && d.startMinute !== null && d.endMinute !== null;
}

function clock(minute: number): { h: number; m: number; pm: boolean } {
  const h24 = Math.floor(minute / 60) % 24;
  return { h: h24 % 12 === 0 ? 12 : h24 % 12, m: minute % 60, pm: h24 >= 12 };
}

/** 605 -> "10:05 AM", 780 -> "1:00 PM", 0 and 1440 -> "12:00 AM". */
export function formatTime(minute: number): string {
  const { h, m, pm } = clock(minute);
  return `${h}:${String(m).padStart(2, "0")} ${pm ? "PM" : "AM"}`;
}

/** "10:05–11:00 AM", or "11:40 AM–12:35 PM" when it crosses noon. */
export function formatTimeRange(start: number, end: number): string {
  const a = clock(start);
  const b = clock(end);
  const short = `${a.h}:${String(a.m).padStart(2, "0")}`;
  return a.pm === b.pm ? `${short}–${formatTime(end)}` : `${formatTime(start)}–${formatTime(end)}`;
}

/** [1, 3, 5] -> "Mon Wed Fri". */
export function formatDays(days: number[]): string {
  return DAYS.filter((d) => days.includes(d.n))
    .map((d) => d.short)
    .join(" ");
}

/** "Mon Wed Fri · 10:05–11:00 AM", "Mon Wed Fri" or null with nothing set. */
export function scheduleLabel(d: CourseDetails): string | null {
  const parts: string[] = [];
  if (d.meetDays.length > 0) parts.push(formatDays(d.meetDays));
  if (d.startMinute !== null && d.endMinute !== null) parts.push(formatTimeRange(d.startMinute, d.endMinute));
  return parts.length ? parts.join(" · ") : null;
}

/** "10:05" (an <input type="time"> value) -> 605; anything else -> null. */
export function parseTime(value: string): number | null {
  const m = /^(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** 605 -> "10:05", for an <input type="time">. */
export function timeValue(minute: number | null): string {
  if (minute === null) return "";
  const h = Math.floor(minute / 60) % 24;
  return `${String(h).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** The day of the week (1 = Monday) and the minute of the day in Oxford, Ohio, at `now`. */
export function oxfordClock(now: Date): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: WEEKDAY[get("weekday")] ?? 1, minute: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
}

/** How close to the start (and after the end) a meeting counts as happening now. */
export const NOW_MARGIN = 15;

export type Meeting<C> = {
  course: C;
  start: number;
  end: number;
  /** 0 today, 1 tomorrow ... 7 the same day next week. */
  daysAhead: number;
  day: number;
  /** The meeting's day in Oxford, YYYY-MM-DD. */
  date: string;
};

/** The calendar day in Oxford, Ohio, `ahead` days after `now`'s, as YYYY-MM-DD. */
export function oxfordDate(now: Date, ahead = 0): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  // Calendar arithmetic on the date alone (noon UTC), so no time zone or clock change moves it.
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ahead);
  return d.toISOString().slice(0, 10);
}

/**
 * The course meeting right now (from 15 minutes before it starts to 15 minutes after it ends),
 * and otherwise the next one to start within a week. `skipNow` leaves out courses that need no
 * "Now" (one already has a live lecture: its Live now row says it). Ties go to the earlier start,
 * then to the course listed first.
 */
export function nowAndNext<C extends { details: CourseDetails }>(
  courses: C[],
  now: Date,
  skipNow: (course: C) => boolean = () => false,
): { now: Meeting<C> | null; next: Meeting<C> | null } {
  const { day: today, minute } = oxfordClock(now);
  let current: { m: Meeting<C>; at: number } | null = null;
  let next: { m: Meeting<C>; at: number } | null = null;
  for (const course of courses) {
    const d = course.details;
    if (!hasSchedule(d)) continue;
    const start = d.startMinute!;
    const end = d.endMinute!;
    // From yesterday (a meeting near midnight still running) to the same day next week.
    for (let ahead = -1; ahead <= 7; ahead++) {
      const day = ((((today - 1 + ahead) % 7) + 7) % 7) + 1;
      if (!d.meetDays.includes(day)) continue;
      const at = ahead * 1440 + start;
      const until = ahead * 1440 + end;
      const meeting = { course, start, end, daysAhead: ahead, day, date: oxfordDate(now, ahead) };
      if (minute >= at - NOW_MARGIN && minute <= until + NOW_MARGIN) {
        if (!skipNow(course) && (!current || at < current.at)) current = { m: meeting, at };
      } else if (at - NOW_MARGIN > minute && ahead >= 0) {
        if (!next || at < next.at) next = { m: meeting, at };
      }
    }
  }
  return { now: current?.m ?? null, next: current ? null : (next?.m ?? null) };
}

/**
 * "Today 2:50 PM", "Tomorrow 10:05 AM", "Wed 10:05 AM" (later this week), and a week out, on
 * today's own weekday, with its date so it never reads as today: "Next Wed, Oct 28 10:05 AM".
 */
export function whenLabel(m: { daysAhead: number; day: number; start: number; date?: string }): string {
  const short = DAYS[m.day - 1].short;
  const day =
    m.daysAhead === 0
      ? "Today"
      : m.daysAhead === 1
        ? "Tomorrow"
        : m.daysAhead >= 7
          ? `Next ${short}${m.date ? `, ${formatLectureDate(m.date)}` : ""}`
          : short;
  return `${day} ${formatTime(m.start)}`;
}
