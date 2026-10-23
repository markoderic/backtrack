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

  it("a slide the student moves to slides in under 200 ms, with transform and opacity only", () => {
    for (const name of ["slide-next", "slide-back"]) {
      const token = css.match(new RegExp(`--animate-${name}:\\s*${name} (\\d+)ms`));
      expect(token, name).not.toBeNull();
      expect(Number(token![1])).toBeLessThan(200);
      const block = css.match(new RegExp(`@keyframes ${name}\\s*{([\\s\\S]*?)\\n}`))?.[1] ?? "";
      const props = [...block.matchAll(/([a-z-]+):/g)].map((m) => m[1]);
      expect(props.length, name).toBeGreaterThan(0);
      for (const p of props) expect(["opacity", "translate"], `${name} ${p}`).toContain(p);
    }
  });

  it("the narrow student screen keeps room under the slide for the whole I'm lost panel with its note box", () => {
    expect(css).toMatch(/--slide-room:\s*calc\(100cqh - 374px\)/);
  });

  it("has no keyframes block that nothing uses", () => {
    expect(css).not.toContain("digit-pop");
  });
});

describe("course colors (batch D, three more in batch H)", () => {
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
    expect(COURSE_COLORS).toHaveLength(11);
    for (const { value } of COURSE_COLORS) {
      const hex = token(`course-${value}`);
      expect(hex, value).not.toBeNull();
      expect(hex!.toLowerCase(), value).not.toBe(lost);
      expect(contrast(hex!, bg), value).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex!, surface), value).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the Custom chip's rainbow is a utility of its own (one class the build can see), made of the course tokens", () => {
    const block = css.match(/@utility bg-course-rainbow\s*{([\s\S]*?)\n}/)?.[1] ?? "";
    expect(block).toContain("conic-gradient(");
    expect(block).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(block).toContain("var(--color-course-pink)");
  });
});

