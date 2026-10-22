import { describe, it, expect, afterEach, vi } from "vitest";
import { formatLectureDate } from "./lectureDate";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("formatLectureDate", () => {
  it("turns a calendar date into month and day", () => {
    expect(formatLectureDate("2026-10-21")).toBe("Oct 21");
    expect(formatLectureDate("2026-01-05")).toBe("Jan 5");
    expect(formatLectureDate("2026-12-31")).toBe("Dec 31");
  });

  it("does not shift the day through a time zone", () => {
    for (const tz of ["Pacific/Auckland", "America/Los_Angeles", "UTC"]) {
      vi.stubEnv("TZ", tz);
      expect(formatLectureDate("2026-10-21")).toBe("Oct 21");
    }
  });

  it("returns something unreadable as it came, not NaN", () => {
    expect(formatLectureDate("soon")).toBe("soon");
  });
});
