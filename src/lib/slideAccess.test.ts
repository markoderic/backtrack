import { describe, it, expect } from "vitest";
import { defaultSemesterEnd, isStudentAccess, todayInOxford } from "./slideAccess";

describe("defaultSemesterEnd", () => {
  it("spring runs to May 15, fall to Dec 18, late December to the next May 15", () => {
    expect(defaultSemesterEnd("2026-01-20")).toBe("2026-05-15");
    expect(defaultSemesterEnd("2026-05-15")).toBe("2026-05-15");
    expect(defaultSemesterEnd("2026-05-16")).toBe("2026-12-18");
    expect(defaultSemesterEnd("2026-10-22")).toBe("2026-12-18");
    expect(defaultSemesterEnd("2026-12-18")).toBe("2026-12-18");
    expect(defaultSemesterEnd("2026-12-19")).toBe("2027-05-15");
  });
});

describe("todayInOxford", () => {
  it("is the date in Ohio, not in UTC", () => {
    // 2 AM UTC on Oct 23 is still Oct 22 in Oxford.
    expect(todayInOxford(new Date("2026-10-23T02:00:00Z"))).toBe("2026-10-22");
    expect(todayInOxford(new Date("2026-10-23T12:00:00Z"))).toBe("2026-10-23");
  });
});

describe("isStudentAccess", () => {
  it("takes only the three choices", () => {
    expect(["semester", "30d", "always"].every(isStudentAccess)).toBe(true);
    expect(isStudentAccess("forever")).toBe(false);
    expect(isStudentAccess(undefined)).toBe(false);
  });
});
