import { describe, it, expect } from "vitest";
import {
  COLOR_BG,
  COURSE_COLORS,
  colorClass,
  colorPaint,
  formatDays,
  normalizeHex,
  presetColors,
  formatTime,
  formatTimeRange,
  nowAndNext,
  oxfordClock,
  oxfordDate,
  parseTime,
  readDetails,
  scheduleLabel,
  timeValue,
  whenLabel,
  type CourseDetails,
} from "./courseDetails";

const none: CourseDetails = { color: null, section: null, meetDays: [], startMinute: null, endMinute: null };
const course = (id: string, meetDays: number[], start: number | null, end: number | null) => ({
  id,
  details: { ...none, meetDays, startMinute: start, endMinute: end },
});

// Wednesday, Oct 21 2026. Eastern daylight time is UTC-4 then.
const wed = (hhmm: string) => new Date(`2026-10-21T${hhmm}:00-04:00`);

describe("colors", () => {
  it("eleven presets in hue order (red, orange and pink added in 0019), none the I'm lost red, each with its own token", () => {
    expect(COURSE_COLORS.map((c) => c.value)).toEqual([
      "red",
      "orange",
      "ochre",
      "olive",
      "green",
      "teal",
      "blue",
      "indigo",
      "plum",
      "pink",
      "slate",
    ]);
    for (const c of COURSE_COLORS) expect(COLOR_BG[c.value]).toBe(`bg-course-${c.value}`);
    expect(colorClass("teal")).toBe("bg-course-teal");
    expect(colorClass("red")).toBe("bg-course-red");
    expect(colorClass(null)).toBe("bg-hairline");
    expect(colorClass("lost")).toBe("bg-hairline");
  });

  it("before 0019 only the eight presets the database takes", () => {
    expect(presetColors(false).map((c) => c.value)).toEqual(["ochre", "olive", "green", "teal", "blue", "indigo", "plum", "slate"]);
    expect(presetColors(true)).toHaveLength(11);
  });

  it("a picked color is painted inline; a preset by its token; none by the hairline", () => {
    expect(colorPaint("teal")).toEqual({ className: "bg-course-teal" });
    expect(colorPaint("#2f6db5")).toEqual({ className: "", style: { backgroundColor: "#2f6db5" } });
    expect(colorPaint("#2F6DB5")).toEqual({ className: "", style: { backgroundColor: "#2f6db5" } });
    expect(colorPaint(null)).toEqual({ className: "bg-hairline" });
    expect(colorPaint("#fff")).toEqual({ className: "bg-hairline" });
    expect(colorPaint("red; background: url(x)")).toEqual({ className: "bg-hairline" });
  });

  it("normalizeHex takes #rrggbb in any case and nothing else", () => {
    expect(normalizeHex("#C0FFEE")).toBe("#c0ffee");
    expect(normalizeHex(" #c0ffee ")).toBe("#c0ffee");
    for (const bad of ["c0ffee", "#c0ffe", "#c0ffeeee", "#g0ffee", "", null, 5]) expect(normalizeHex(bad)).toBeNull();
  });
});

describe("readDetails", () => {
  it("keeps good values and drops what does not make sense", () => {
    expect(
      readDetails({
        color: "plum",
        section: "  Section B ",
        meet_days: [5, 1, 3, 3, 9],
        start_minute: 605,
        end_minute: 660,
      }),
    ).toEqual({ color: "plum", section: "Section B", meetDays: [1, 3, 5], startMinute: 605, endMinute: 660 });
    expect(readDetails({ color: "lost", section: "  ", meet_days: null, start_minute: 700, end_minute: 660 })).toEqual(
      none,
    );
    expect(readDetails({})).toEqual(none);
  });

  it("keeps the new presets and a picked #rrggbb color", () => {
    expect(readDetails({ color: "pink" }).color).toBe("pink");
    expect(readDetails({ color: "#2f6db5" }).color).toBe("#2f6db5");
    expect(readDetails({ color: "#2F6DB5" }).color).toBe("#2f6db5");
    expect(readDetails({ color: "#2f6" }).color).toBeNull();
  });
});

describe("labels", () => {
  it("times in 12 hour style, the AM or PM once when the range stays on one side of noon", () => {
    expect(formatTime(605)).toBe("10:05 AM");
    expect(formatTime(780)).toBe("1:00 PM");
    expect(formatTime(0)).toBe("12:00 AM");
    expect(formatTime(720)).toBe("12:00 PM");
    expect(formatTimeRange(605, 660)).toBe("10:05–11:00 AM");
    expect(formatTimeRange(700, 755)).toBe("11:40 AM–12:35 PM");
    expect(formatTimeRange(795, 875)).toBe("1:15–2:35 PM");
  });

  it("days in week order, and the whole schedule line", () => {
    expect(formatDays([5, 1, 3])).toBe("Mon Wed Fri");
    expect(scheduleLabel({ ...none, meetDays: [1, 3, 5], startMinute: 605, endMinute: 660 })).toBe(
      "Mon Wed Fri · 10:05–11:00 AM",
    );
    expect(scheduleLabel({ ...none, meetDays: [2, 4] })).toBe("Tue Thu");
    expect(scheduleLabel(none)).toBeNull();
  });

  it("reads and writes the time field's value", () => {
    expect(parseTime("10:05")).toBe(605);
    expect(parseTime("23:59")).toBe(1439);
    expect(parseTime("")).toBeNull();
    expect(parseTime("25:00")).toBeNull();
    expect(timeValue(605)).toBe("10:05");
    expect(timeValue(null)).toBe("");
  });

  it("when the next meeting is", () => {
    expect(whenLabel({ daysAhead: 0, day: 3, start: 890 })).toBe("Today 2:50 PM");
    expect(whenLabel({ daysAhead: 1, day: 4, start: 605 })).toBe("Tomorrow 10:05 AM");
    expect(whenLabel({ daysAhead: 4, day: 1, start: 605 })).toBe("Mon 10:05 AM");
    expect(whenLabel({ daysAhead: 7, day: 3, start: 605, date: "2026-10-28" })).toBe("Wed, Oct 28 10:05 AM");
  });
});

describe("oxfordDate", () => {
  it("the Oxford calendar day, moved by whole days, across the end of the month and the clock change", () => {
    expect(oxfordDate(new Date("2026-10-22T01:30:00Z"))).toBe("2026-10-21");
    expect(oxfordDate(wed("10:05"), 7)).toBe("2026-10-28");
    expect(oxfordDate(new Date("2026-10-29T12:00:00-04:00"), 4)).toBe("2026-11-02");
  });
});

describe("oxfordClock", () => {
  it("the day and minute in Oxford, whatever the computer's own zone", () => {
    expect(oxfordClock(wed("10:05"))).toEqual({ day: 3, minute: 605 });
    // 1:30 AM Thursday in UTC is still Wednesday evening in Oxford.
    expect(oxfordClock(new Date("2026-10-22T01:30:00Z"))).toEqual({ day: 3, minute: 21 * 60 + 30 });
    // After the clocks go back (Nov 1), Eastern is UTC-5.
    expect(oxfordClock(new Date("2026-11-02T15:05:00Z"))).toEqual({ day: 1, minute: 605 });
  });
});

describe("nowAndNext", () => {
  const ims = course("ims", [1, 3, 5], 605, 660); // Mon Wed Fri 10:05-11:00
  const bio = course("bio", [2, 4], 780, 855); // Tue Thu 1:00-2:15
  const acc = course("acc", [3], 890, 965); // Wed 2:50-4:05
  const plain = course("plain", [], null, null);

  it("a class from 15 minutes before it starts to 15 minutes after it ends is Now", () => {
    for (const t of ["09:50", "10:05", "10:40", "11:15"]) {
      const r = nowAndNext([ims, bio, acc, plain], wed(t));
      expect(r.now?.course.id, t).toBe("ims");
      expect(r.next, t).toBeNull();
    }
  });

  it("before that window and after it, the next meeting is Next", () => {
    const early = nowAndNext([ims, bio, acc], wed("09:49"));
    expect(early.now).toBeNull();
    expect(early.next).toMatchObject({ course: { id: "ims" }, daysAhead: 0, start: 605 });

    const after = nowAndNext([ims, bio, acc], wed("11:16"));
    expect(after.now).toBeNull();
    expect(after.next).toMatchObject({ course: { id: "acc" }, daysAhead: 0, start: 890 });
    expect(whenLabel(after.next!)).toBe("Today 2:50 PM");
  });

  it("after the last class of the day, the first one tomorrow or later this week", () => {
    const evening = nowAndNext([ims, bio, acc], wed("18:00"));
    expect(evening.next).toMatchObject({ course: { id: "bio" }, daysAhead: 1 });
    expect(whenLabel(evening.next!)).toBe("Tomorrow 1:00 PM");

    // Friday evening: Monday's IMS 452 is next.
    const friday = nowAndNext([ims, bio], new Date("2026-10-23T18:00:00-04:00"));
    expect(friday.next).toMatchObject({ course: { id: "ims" }, daysAhead: 3, day: 1, date: "2026-10-26" });
    expect(whenLabel(friday.next!)).toBe("Mon 10:05 AM");
  });

  it("a class that met earlier today and meets on no other day is next on the same day next week", () => {
    const r = nowAndNext([acc], wed("17:00"));
    expect(r.next).toMatchObject({ daysAhead: 7, day: 3, date: "2026-10-28" });
    // Never just "Wed" on a Wednesday: that would read as today.
    expect(whenLabel(r.next!)).toBe("Wed, Oct 28 2:50 PM");
  });

  it("a course with a lecture already live is not Now (its Live now row says it); the next one shows", () => {
    const r = nowAndNext([ims, acc], wed("10:10"), (c) => c.id === "ims");
    expect(r.now).toBeNull();
    expect(r.next).toMatchObject({ course: { id: "acc" } });
  });

  it("two classes in their window at once: the one that starts first", () => {
    const lab = course("lab", [3], 630, 720);
    expect(nowAndNext([lab, ims], wed("10:30")).now?.course.id).toBe("ims");
  });

  it("nothing at all when no course has days and a time", () => {
    expect(nowAndNext([plain, course("days-only", [1], null, null)], wed("10:05"))).toEqual({ now: null, next: null });
  });
});

describe("where course colors show", () => {
  it("only on teacher screens: no student or public screen paints a course color", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const app = path.resolve(__dirname, "../app");
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = path.join(dir, f);
        return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : [];
      });
    const student = [
      ...files(path.join(app, "l")),
      ...files(path.join(app, "spots")),
      ...files(path.join(app, "join")),
      path.join(app, "page.tsx"),
      ...files(path.resolve(__dirname, "../components")),
    ];
    expect(student.length).toBeGreaterThan(10);
    for (const f of student) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/colorPaint|colorClass|bg-course-|courseDetails/);
    }
  });
});
