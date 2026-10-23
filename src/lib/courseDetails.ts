import type React from "react";
import { formatLectureDate } from "./lectureDate";

/**
 * A course's color, section and meeting days and time (migration 0018), and the "Now" / "Next"
 * meeting on the courses dashboard. Times are minutes after midnight in Oxford, Ohio
 * (America/New_York), the same clock lecture_date uses; days are 1 = Monday ... 7 = Sunday.
 */

/**
 * The preset swatches, in hue order. `added` marks the three that came with migration 0019 (red,
 * orange, pink): before 0019 the database only takes the first eight, so the form leaves them out.
 */
export const COURSE_COLORS = [
  { value: "red", label: "Red", added: true },
  { value: "orange", label: "Orange", added: true },
  { value: "ochre", label: "Ochre", added: false },
  { value: "olive", label: "Olive", added: false },
  { value: "green", label: "Green", added: false },
  { value: "teal", label: "Teal", added: false },
  { value: "blue", label: "Blue", added: false },
  { value: "indigo", label: "Indigo", added: false },
  { value: "plum", label: "Plum", added: false },
  { value: "pink", label: "Pink", added: true },
  { value: "slate", label: "Slate", added: false },
] as const;

export type PresetColor = (typeof COURSE_COLORS)[number]["value"];
/** A preset name, or (after 0019) any color the teacher picked, as lowercase #rrggbb. */
export type CourseColor = PresetColor | `#${string}`;

/** The presets the database takes: all eleven after migration 0019, the first eight before it. */
export function presetColors(options: boolean) {
  return COURSE_COLORS.filter((c) => options || !c.added);
}

/** The background utility for each swatch, written out so Tailwind generates every one. */
export const COLOR_BG: Record<PresetColor, string> = {
  red: "bg-course-red",
  orange: "bg-course-orange",
  ochre: "bg-course-ochre",
  olive: "bg-course-olive",
  green: "bg-course-green",
  teal: "bg-course-teal",
  blue: "bg-course-blue",
  indigo: "bg-course-indigo",
  plum: "bg-course-plum",
  pink: "bg-course-pink",
  slate: "bg-course-slate",
};

export function isPresetColor(v: unknown): v is PresetColor {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(COLOR_BG, v);
}

const HEX = /^#[0-9a-f]{6}$/;

/** "#2F6DB5" or "#2f6db5" -> "#2f6db5"; anything else -> null. */
export function normalizeHex(v: unknown): `#${string}` | null {
  if (typeof v !== "string") return null;
  const lower = v.trim().toLowerCase();
  return HEX.test(lower) ? (lower as `#${string}`) : null;
}

export function isCourseColor(v: unknown): v is CourseColor {
  return isPresetColor(v) || (typeof v === "string" && HEX.test(v));
}

/** The background for a course's bar or dot; a quiet hairline when it has no color. */
export function colorClass(color: unknown): string {
  return isPresetColor(color) ? COLOR_BG[color] : "bg-hairline";
}

/**
 * The class and style that paint a course's bar or dot: a preset's token, a picked color as an
 * inline background (the teacher's own value, not a color of the app), or the hairline for none.
 * Bars and dots are decoration only; no text ever sits on them.
 */
export function colorPaint(color: unknown): { className: string; style?: React.CSSProperties } {
  if (isPresetColor(color)) return { className: COLOR_BG[color] };
  const hex = normalizeHex(color);
  if (hex) return { className: "", style: { backgroundColor: hex } };
  return { className: "bg-hairline" };
}

function hslToHex(h: number, sat: number, light: number): `#${string}` {
  const s = sat / 100;
  const l = light / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/** Columns of the in-app color picker's grid: one per hue. */
export const PICKER_HUES = 12;

/**
 * The in-app color picker's swatches (batch H, in place of the system color panel): twelve hues
 * around the wheel, each as a deeper and a lighter shade, as #rrggbb values a teacher can pick.
 * Computed, so they are the teacher's data like a typed color, not colors of the app.
 */
export const PICKER_SWATCHES: `#${string}`[] = [42, 62].flatMap((light) =>
  Array.from({ length: PICKER_HUES }, (_, i) => hslToHex(i * 30, light === 42 ? 62 : 58, light)),
);

export function colorLabel(color: unknown): string | null {
  if (isPresetColor(color)) return COURSE_COLORS.find((c) => c.value === color)!.label;
  const hex = normalizeHex(color);
  return hex ? `Custom ${hex}` : null;
}

/**
 * Columns that only exist once migration 0019 is in. A read that asks for them and gets them back
 * tells the app the new colors and slide access choices can be saved; without them it falls back
 * to the eight colors and the three choices from before.
 */
export const OPTION_COLUMNS = "access_days, access_until";

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
    color: isPresetColor(row.color) ? row.color : normalizeHex(row.color),
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
 * today's own weekday, with its date so it never reads as today: "Wed, Oct 28 10:05 AM".
 */
export function whenLabel(m: { daysAhead: number; day: number; start: number; date?: string }): string {
  const short = DAYS[m.day - 1].short;
  const day =
    m.daysAhead === 0
      ? "Today"
      : m.daysAhead === 1
        ? "Tomorrow"
        : m.daysAhead >= 7
          ? `${short}${m.date ? `, ${formatLectureDate(m.date)}` : ""}`
          : short;
  return `${day} ${formatTime(m.start)}`;
}
