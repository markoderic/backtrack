import { describe, it, expect } from "vitest";
import { defaultLectureName } from "./lectureName";

describe("defaultLectureName", () => {
  it("numbers the lecture after the existing ones and adds a short date", () => {
    expect(defaultLectureName(6, new Date(2026, 9, 26))).toBe("Lecture 7, Oct 26");
  });

  it("has no leading zero on the day", () => {
    expect(defaultLectureName(0, new Date(2026, 0, 5))).toBe("Lecture 1, Jan 5");
  });

  it("writes every month in short English", () => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    months.forEach((m, i) => {
      expect(defaultLectureName(1, new Date(2026, i, 15))).toBe(`Lecture 2, ${m} 15`);
    });
  });
});
