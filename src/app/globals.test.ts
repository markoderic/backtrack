import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

describe("globals.css entrance animations", () => {
  it("a whole page never starts invisible and is done within 120 ms", () => {
    // --dur-fast is 120ms; the page-in token must use it (or something shorter).
    expect(css).toMatch(/--dur-fast:\s*120ms/);
    expect(css).toMatch(/--animate-page-in:\s*page-in var\(--dur-fast\)/);
    const first = css.match(/@keyframes page-in\s*{\s*from\s*{([^}]*)}/);
    expect(first).not.toBeNull();
    const opacity = Number(first![1].match(/opacity:\s*([\d.]+)/)?.[1]);
    expect(opacity).toBeGreaterThanOrEqual(0.5);
  });

  it("has no keyframes block that nothing uses", () => {
    expect(css).not.toContain("digit-pop");
  });
});

describe("course colors (batch D)", () => {
  const token = (name: string) => css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1] ?? null;
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  it("every swatch has a token, reads at 4.5:1 or more on the page background and on white, and is not the lost red", async () => {
    const { COURSE_COLORS } = await import("@/lib/courseDetails");
    const bg = token("bg")!;
    const surface = token("surface")!;
    const lost = token("lost")!.toLowerCase();
    expect(COURSE_COLORS).toHaveLength(8);
    for (const { value } of COURSE_COLORS) {
      const hex = token(`course-${value}`);
      expect(hex, value).not.toBeNull();
      expect(hex!.toLowerCase(), value).not.toBe(lost);
      expect(contrast(hex!, bg), value).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex!, surface), value).toBeGreaterThanOrEqual(4.5);
    }
  });
});
