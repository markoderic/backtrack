import { describe, it, expect } from "vitest";
import { accessChoices, choiceOf, defaultSemesterEnd, isStudentAccess, todayInOxford } from "./slideAccess";

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
  it("takes the three choices from 0016 and the three from 0019, nothing else", () => {
    expect(["semester", "30d", "always", "7d", "custom_days", "custom_date"].every(isStudentAccess)).toBe(true);
    for (const bad of ["forever", "custom", "14d", "", undefined, null]) expect(isStudentAccess(bad)).toBe(false);
  });
});

describe("accessChoices", () => {
  it("after 0019 five choices (the two custom values are one, Custom); before it the first three", () => {
    expect(accessChoices(true).map((c) => c.label)).toEqual([
      "End of semester",
      "30 days after each class",
      "A week after each class",
      "Always",
      "Custom",
    ]);
    expect(accessChoices(false).map((c) => c.value)).toEqual(["semester", "30d", "always"]);
    expect(choiceOf("custom_days")).toBe("custom");
    expect(choiceOf("custom_date")).toBe("custom");
    expect(choiceOf("7d")).toBe("7d");
  });
});
