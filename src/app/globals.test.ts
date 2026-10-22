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
