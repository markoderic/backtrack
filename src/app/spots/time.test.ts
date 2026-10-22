import { describe, it, expect } from "vitest";
import { formatClock } from "./time";

const local = (h: number, m: number) => new Date(2026, 9, 21, h, m).toISOString();

describe("formatClock", () => {
  it("shows hours and minutes on the student's clock, without am or pm", () => {
    expect(formatClock(local(10, 19))).toBe("10:19");
    expect(formatClock(local(14, 5))).toBe("2:05");
    expect(formatClock(local(0, 30))).toBe("12:30");
    expect(formatClock(local(12, 0))).toBe("12:00");
  });

  it("gives nothing for a value it cannot read", () => {
    expect(formatClock("not a time")).toBe("");
  });
});
