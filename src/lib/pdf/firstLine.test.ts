import { describe, it, expect } from "vitest";
import { firstLine } from "./firstLine";

const item = (str: string, x: number, y: number) => ({ str, transform: [1, 0, 0, 1, x, y] });

describe("firstLine", () => {
  it("joins items on the top line in x order even when given out of order", () => {
    expect(firstLine([item("world", 80, 700), item("Hello", 10, 700), item("lower", 10, 500)])).toBe("Hello world");
  });

  it("includes an item 1.5 units lower on the same line", () => {
    expect(firstLine([item("Hello", 10, 700), item("there", 60, 698.5)])).toBe("Hello there");
  });

  it("ignores a line 20 units lower", () => {
    expect(firstLine([item("Title", 10, 700), item("Body text", 10, 680)])).toBe("Title");
  });

  it("uses the topmost line, not the first item", () => {
    expect(firstLine([item("Body", 10, 400), item("Title", 10, 700)])).toBe("Title");
  });

  it("returns an empty string when there is no text", () => {
    expect(firstLine([])).toBe("");
  });

  it("returns an empty string when the top line is only spaces", () => {
    expect(firstLine([item("  ", 10, 700)])).toBe("");
  });

  it("trims and collapses to single spaces", () => {
    expect(firstLine([item(" Hello ", 10, 700), item(" there ", 60, 700)])).toBe("Hello there");
  });

  it("caps the result at 200 characters", () => {
    expect(firstLine([item("a".repeat(500), 10, 700)])).toHaveLength(200);
  });
});
