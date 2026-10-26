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

  it("the narrow student screen keeps the slide's default size (the same room under it as before, now the notebook's)", () => {
    expect(css).toMatch(/--slide-room:\s*calc\(100cqh - 394px\)/);
  });

  it("the slide size handle scales only the slide: --slide-scale on a phone, --slide-scale-wide on a laptop (1 by default)", () => {
    expect(css).toMatch(/\* var\(--slide-scale, 1\)\)/);
    expect(css).toMatch(/\* var\(--slide-scale-wide, 1\)\)/);
    // No sidebar width set by the handle any more (it made the buttons wider, hand test 4).
    expect(css).not.toContain("--side-w");
    expect(css).toMatch(/grid-template-areas:\s*"top" "slide" "panel" "nav" "handle" "notes"/);
  });

  it("I'm lost and its buttons, the strip and the note to the teacher have one size at every slide size and window size (hand test 4)", () => {
    const rule = (sel: string) => css.match(new RegExp(`\\[${sel}\\]\\s*{([^}]*)}`))?.[1] ?? "";
    expect(rule("data-lecture-panel")).toMatch(/width:\s*360px;\s*max-width:\s*100%/);
    expect(rule("data-lecture-nav")).toMatch(/width:\s*480px;\s*max-width:\s*100%/);
    expect(rule("data-teacher-slot")).toMatch(/width:\s*300px;\s*max-width:\s*100%/);
    // Nothing else sizes them: no other rule gives the panel, the strip or the note a width from the slide or the window.
    for (const sel of ["data-lecture-panel", "data-lecture-nav", "data-teacher-slot"]) {
      const widths = [...css.matchAll(new RegExp(`\\[${sel}\\][^{]*{[^}]*[^-]width:[^;]*;`, "g"))];
      expect(widths, sel).toHaveLength(1);
    }
  });

  it("on a laptop the panel and the strip sit right under the slide; a small slide puts the notebook under them, the whole width (no empty band)", () => {
    expect(css).toMatch(/grid-template-areas:\s*"stage handle back back" "stage handle brand info" "stage handle notes notes" "stage handle jump jump" "stage handle spots spots"/);
    const notesUnder = css.match(/\[data-lecture\]\[data-notes="under"\]\s*{([^}]*)}/)?.[1] ?? "";
    expect(notesUnder).toMatch(/grid-template-areas:\s*"stage handle side" "notes notes notes"/);
    expect(notesUnder).toMatch(/grid-template-rows:\s*auto minmax\(0, 1fr\)/);
    const wide = css.slice(css.lastIndexOf("@media (min-width: 700px) and (min-aspect-ratio: 1/1) {"));
    const stage = wide.match(/\n  \[data-lecture-stage\]\s*{([^}]*)}/)?.[1] ?? "";
    expect(stage).toMatch(/flex-direction:\s*column/);
    expect(stage).toMatch(/align-self:\s*start/);
    // The size handle sits on the slide's right edge, as tall as the slide, however small the slide is
    // (review I5: it used to sit beside the strip, about 110 px away).
    const handle = wide.match(/\n  \[data-split-handle\]\s*{([^}]*)}/)?.[1] ?? "";
    expect(handle).toMatch(/position:\s*absolute/);
    expect(handle).toMatch(/left:\s*calc\(16px \+ var\(--slide-w\)\)/);
    expect(handle).toMatch(/height:\s*calc\(var\(--slide-w\) \/ var\(--slide-ratio, 1.7778\)\)/);
    expect(wide).toMatch(/\[data-lecture-slide\]\s*{\s*width:\s*var\(--slide-w\);/);
    // The slide's full size leaves the panel and the strip (216 px) under it.
    expect(css).toMatch(/--slide-room:\s*calc\(100cqh - 216px\)/);
  });

  it("notebook text sits on faint ruled lines, one per 24 px line, that scroll with it", () => {
    const block = css.match(/@utility bg-ruled\s*{([\s\S]*?)\n}/)?.[1] ?? "";
    expect(block).toContain("var(--color-hairline)");
    expect(block).toMatch(/background-size:\s*100% 24px/);
    expect(block).toMatch(/background-attachment:\s*local/);
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

describe("marks look like a highlighter (batch K1)", () => {
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

  // mix-blend-multiply: the text under a mark is multiplied by the fill too (per channel, 0 to 255).
  const multiply = (text: string, fill: string) =>
    "#" +
    [1, 3, 5]
      .map((i) => Math.round((parseInt(text.slice(i, i + 2), 16) * parseInt(fill.slice(i, i + 2), 16)) / 255))
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");

  it("text under either mark stays readable: ink and black 7:1, dark and secondary gray 4.5:1 (multiplied)", () => {
    for (const name of ["mark", "mark-lost"]) {
      const fill = token(name);
      expect(fill, name).not.toBeNull();
      for (const [text, min] of [
        [token("ink")!, 7],
        ["#000000", 7],
        ["#444444", 4.5],
        [token("secondary")!, 4.5],
      ] as const) {
        expect(contrast(multiply(text, fill!), fill!), `${name} ${text}`).toBeGreaterThanOrEqual(min);
      }
    }
  });

  it("the yellow is yellow and the red is clearly red, both visible on a white slide", () => {
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [yr, yg, yb] = rgb(token("mark")!);
    expect(yr).toBeGreaterThan(200);
    expect(yg).toBeGreaterThan(200);
    expect(yb).toBeLessThan(150);
    const [rr, rg, rb] = rgb(token("mark-lost")!);
    expect(rr - rg).toBeGreaterThan(60);
    expect(rr - rb).toBeGreaterThan(60);
    // Stronger than the pale lost tint on white.
    expect(contrast(token("mark-lost")!, "#ffffff")).toBeGreaterThan(contrast(token("lost-tint")!, "#ffffff") + 0.5);
  });
});

describe("marks on a dark slide glow, and marks on a slide that can not be measured get an edge (batch M)", () => {
  const token = (name: string) => css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1] ?? null;
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const toHex = (c: number[]) => "#" + c.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");
  const luminance = (hex: string) => {
    const [r, g, b] = rgb(hex).map((n) => {
      const v = n / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  // mix-blend-screen, per channel: what the browser draws for the slide (and its text) under a glow.
  const screen = (under: string, fill: string) => toHex(rgb(under).map((u, i) => 255 - ((255 - u) * (255 - rgb(fill)[i])) / 255));
  // A fill of this opacity laid over the slide (the edge look, normal blending).
  const over = (under: string, fill: string, a: number) => toHex(rgb(under).map((u, i) => u * (1 - a) + rgb(fill)[i] * a));

  // The full glow (on black); on lighter dark backgrounds lib/slideTone lowers its strength (slideTone.test.ts has the table).
  it("under a full glow on black, white text keeps 4.5:1 (AA) and light gray 3:1 (the stated floor), and the glow stands out from black by 4:1", () => {
    for (const name of ["mark-glow", "mark-lost-glow"]) {
      const glow = token(name);
      expect(glow, name).not.toBeNull();
      const bg = screen("#000000", glow!);
      expect(bg).toBe(glow!.toLowerCase());
      expect(contrast(screen("#ffffff", glow!), bg), `${name} white`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(screen("#cccccc", glow!), bg), `${name} #ccc`).toBeGreaterThanOrEqual(3);
      expect(contrast(bg, "#000000"), `${name} on black`).toBeGreaterThanOrEqual(4);
    }
  });

  it("the glows are the same color family: a yellow and a red", () => {
    const [yr, yg, yb] = rgb(token("mark-glow")!);
    expect(yr).toBeGreaterThan(yb + 60);
    expect(yg).toBeGreaterThan(yb + 60);
    expect(Math.abs(yr - yg)).toBeLessThan(30);
    const [rr, rg, rb] = rgb(token("mark-lost-glow")!);
    expect(rr - rg).toBeGreaterThan(80);
    expect(rr - rb).toBeGreaterThan(80);
  });

  it("the edge look: its 2 px inner edge shows on white and on black (3:1), and text under its 30% fill stays readable on both", () => {
    for (const [fill, edge] of [
      ["mark", "mark-edge"],
      ["mark-lost", "lost"],
    ]) {
      const e = token(edge)!;
      expect(contrast(e, "#ffffff"), `${edge} on white`).toBeGreaterThanOrEqual(3);
      expect(contrast(e, "#000000"), `${edge} on black`).toBeGreaterThanOrEqual(3);
      const f = token(fill)!;
      // Black text on a white slide, white text on a black one.
      expect(contrast(over("#000000", f, 0.3), over("#ffffff", f, 0.3)), `${fill} white slide`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(over("#ffffff", f, 0.3), over("#000000", f, 0.3)), `${fill} black slide`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
