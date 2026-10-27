import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");
/** The laptop layout's block, the phone's, and the Classic screen rule inside the laptop's. */
const wide = css.slice(css.lastIndexOf("@media (min-width: 700px) and (min-aspect-ratio: 1/1) {"));
const narrow = css.slice(css.lastIndexOf("@media (max-width: 699.98px), (max-aspect-ratio: 9999/10000) {"), css.indexOf("@media (min-width: 592px)"));
const classic = wide.match(/\[data-lecture\]\[data-view="classic"\]\s*{([^}]*)}/)?.[1] ?? "";

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
    expect(css).toMatch(/--slide-w:\s*calc\(var\(--slide-full-w\) \* var\(--slide-scale-wide, 1\)\)/);
    // The sidebar width set by the handle is only the Classic layout's (batch N restores it).
    const sideW = [...css.matchAll(/var\(--side-w[,)]/g)];
    expect(sideW).toHaveLength(1);
    expect(classic).toMatch(/--side:\s*var\(--side-w, clamp\(260px, 20vw, 380px\)\)/);
    expect(css).toMatch(/grid-template-areas:\s*"top" "slide" "panel" "nav" "handle" "notes"/);
  });

  it("the panel, the strip and the note to the teacher never take a size from the slide: the panel and the strip fill the stack (batch N)", () => {
    // No fixed 360 / 480 px any more (Marko, Oct 27: the buttons "go all the way right until the notes",
    // the timeline "long" again), and no rule gives the panel a width at all: it fills its column.
    expect(css).not.toMatch(/\[data-lecture-panel\][^{]*{[^}]*[^-]width:/);
    expect(css).not.toMatch(/width:\s*360px/);
    // The strip has no width of its own except in Classic, where it is the slide's (480 px at least, as in K2).
    const navWidths = [...css.matchAll(/\[data-lecture-nav\][^{]*{[^}]*[^-]width:([^;]*);/g)].map((m) => m[1].trim());
    expect(navWidths).toEqual(["max(min(var(--classic-w), 480px), var(--slide-w))"]);
    expect(css).toMatch(/\[data-teacher-slot\]\s*{\s*width:\s*300px;\s*max-width:\s*100%;/);
  });

  it("Notes on a laptop: the stack is the slide's full width (whatever the handle did), the panel and the strip stretch to it", () => {
    const stage = wide.match(/\n  \[data-lecture-stage\]\s*{([^}]*)}/)?.[1] ?? "";
    expect(stage).toMatch(/flex-direction:\s*column/);
    expect(stage).toMatch(/align-items:\s*stretch/);
    expect(stage).toMatch(/align-self:\s*start/);
    expect(stage).toMatch(/width:\s*var\(--col-w\)/);
    // The column: the slide's full size (never the scaled one), so dragging never changes the buttons' width.
    expect(wide).toMatch(/--col-w:\s*max\(var\(--slide-full-w\), var\(--col-min\)\)/);
    expect(wide).toMatch(/--slide-full-w:\s*min\(100cqw - var\(--handle-w\) - var\(--nb-w\), max\(var\(--slide-room\), 96px\) \* var\(--slide-ratio, 1.7778\)\)/);
    expect(wide).not.toMatch(/--col-w:[^;]*slide-scale/);
    // At the default size the slide uses the room it can: beside 260 px of notebook (it was 300), over the panel.
    expect(wide).toMatch(/--nb-w:\s*260px/);
    expect(wide).toMatch(/--slide-room:\s*calc\(100cqh - var\(--under\)\)/);
    expect(wide).toMatch(/\[data-lecture-slide\]\s*{\s*width:\s*var\(--slide-w\);/);
    expect(wide).toMatch(/grid-template-areas:\s*"stage handle back back" "stage handle brand info" "stage handle notes notes" "stage handle jump jump" "stage handle spots spots"/);
    const notesUnder = css.match(/\[data-lecture\]\[data-view="notes"\]\[data-notes="under"\]\s*{([^}]*)}/)?.[1] ?? "";
    expect(notesUnder).toMatch(/grid-template-areas:\s*"stage handle side" "notes notes notes"/);
    expect(notesUnder).toMatch(/grid-template-rows:\s*auto minmax\(0, 1fr\)/);
    // The size handle sits on the slide's right edge, as tall as the slide, however small the slide is.
    const handle = wide.match(/\n  \[data-split-handle\]\s*{([^}]*)}/)?.[1] ?? "";
    expect(handle).toMatch(/position:\s*absolute/);
    expect(handle).toMatch(/left:\s*calc\(16px \+ var\(--slide-w\)\)/);
    expect(handle).toMatch(/height:\s*calc\(var\(--slide-w\) \/ var\(--slide-ratio, 1.7778\)\)/);
    // No cq unit sizes the screen's own grid (there it would be the window's, not the screen's content box).
    const grid = wide.match(/\n  \[data-lecture\]\s*{([^}]*)}/)?.[1] ?? "";
    expect(grid.match(/grid-template-columns:([^;]*);/)?.[1]).not.toMatch(/cq|--col-w|--slide/);
  });

  it("no empty band between the buttons and the strip: with room, the Undo line sits beside Save this and Mark (panel 104 px, not 156)", () => {
    // Laptop (Notes and Slides only, 892 px and up) and a half window on a phone layout (592 px and up).
    const laptop = css.slice(css.indexOf("@media (min-width: 892px) and (min-aspect-ratio: 1/1) {"));
    const half = css.slice(css.indexOf("@media (min-width: 592px) and (max-width: 699.98px), (min-width: 592px) and (max-aspect-ratio: 9999/10000) {"));
    for (const [name, block, sel] of [
      ["laptop", laptop, '\\[data-lecture\\]:not\\(\\[data-view="classic"\\]\\)'],
      ["half", half, "\\[data-lecture\\]"],
    ] as const) {
      expect(block, name).toMatch(new RegExp(`${sel} \\[data-lecture-panel\\]\\s*{[^}]*display:\\s*grid;[^}]*grid-template-columns:\\s*repeat\\(4, minmax\\(0, 1fr\\)\\)`));
      expect(block, name).toMatch(new RegExp(`${sel} \\[data-lecture-panel\\] > \\*\\s*{\\s*grid-column:\\s*1 / -1;`));
      expect(block, name).toMatch(new RegExp(`${sel} \\[data-lecture-panel\\] > \\[data-tools\\]\\s*{\\s*grid-column:\\s*1 / span 2;`));
      expect(block, name).toMatch(new RegExp(`${sel} \\[data-lecture-panel\\] > \\[data-panel-line\\]\\s*{\\s*grid-column:\\s*3 / span 2;`));
    }
    // The room under the slide shrinks with it: 216 -> 164 (laptop), 394 -> 342 (half window).
    expect(wide).toMatch(/--under:\s*216px/);
    expect(laptop).toMatch(/\[data-lecture\]:not\(\[data-view="classic"\]\)\s*{\s*--under:\s*164px;\s*--col-min:\s*560px;/);
    expect(css).toMatch(/--slide-room:\s*calc\(100cqh - 394px\)/);
    expect(half).toMatch(/\[data-lecture\]\s*{\s*--slide-room:\s*calc\(100cqh - 342px\);/);
    // The stack's own gap stays the token's 8 px.
    expect(wide.match(/\n  \[data-lecture-stage\]\s*{([^}]*)}/)?.[1]).toMatch(/gap:\s*8px/);
  });

  it("Slides only: no notebook column, a 200 px sidebar, the slide at its full size (no handle scale)", () => {
    expect(wide).toMatch(/\[data-lecture\]\[data-view="slides"\]\s*{\s*--handle-w:\s*16px;\s*--nb-w:\s*200px;\s*--slide-w:\s*var\(--slide-full-w\);/);
    const narrowSlides = narrow.match(/\[data-lecture\]\[data-view="slides"\]\s*{([^}]*)}/)?.[1] ?? "";
    expect(narrowSlides).toMatch(/grid-template-areas:\s*"top" "slide" "panel" "nav" "notes"/);
    expect(narrowSlides).toMatch(/--slide-room:\s*calc\(100cqh - 328px\)/);
    expect(narrow).toMatch(/\[data-lecture\]\[data-view="slides"\] \[data-lecture-slide\]\s*{\s*width:\s*min\(100cqw, max\(var\(--slide-room\), 96px\) \* var\(--slide-ratio, 1.7778\)\);/);
  });

  it("Classic (the K2 layout): the slide with its strip on the left, the sidebar with the buttons on top and the notebook under them", () => {
    expect(classic).toMatch(
      /grid-template-areas:\s*"stage handle back back" "stage handle brand info" "stage handle panel panel" "stage handle notes notes" "stage handle jump jump" "stage handle spots spots"/,
    );
    expect(classic).toMatch(/grid-template-rows:\s*auto auto auto minmax\(96px, 1fr\) auto auto/);
    expect(classic).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) 24px minmax\(0, calc\(var\(--side\) - var\(--info-w\)\)\) var\(--info-w\)/);
    // The stack's box goes away so the panel can sit in the sidebar; the strip sits 8 px under the slide.
    expect(wide).toMatch(/\[data-lecture\]\[data-view="classic"\] \[data-lecture-stage\]\s*{\s*display:\s*contents;/);
    expect(wide).toMatch(/\[data-lecture\]\[data-view="classic"\] \[data-lecture-panel\]\s*{\s*grid-area:\s*panel;/);
    expect(wide).toMatch(/margin-top:\s*calc\(var\(--slide-w\) \/ var\(--slide-ratio, 1.7778\) \+ 8px\)/);
    // As in K2: the slide as big as the room left of the sidebar and the height less the strip (52) allow.
    expect(classic).toMatch(/--slide-room:\s*calc\(100cqh - 52px\)/);
    expect(classic).toMatch(/--slide-w:\s*min\(var\(--classic-w\), max\(var\(--slide-room\), 96px\) \* var\(--slide-ratio, 1.7778\)\)/);
    // The handle between the slide and the sidebar, the whole height.
    expect(wide).toMatch(/\[data-lecture\]\[data-view="classic"\] \[data-split-handle\]\s*{\s*grid-area:\s*handle;\s*position:\s*relative;/);
    // Classic's panel keeps its three rows (the two row panel is for Notes and Slides only).
    expect(css).toMatch(/\[data-lecture\]:not\(\[data-view="classic"\]\) \[data-lecture-panel\]/);
  });

  it("student notes are Inter, regular and upright, with Arial and the system sans as fallbacks (Marko, Oct 27)", () => {
    const note = css.match(/@utility type-note\s*{([^}]*)}/)?.[1] ?? "";
    expect(note).toMatch(/font-family:\s*var\(--font-notes\);/);
    expect(note).toMatch(/font-weight:\s*400;/);
    expect(note).toMatch(/font-style:\s*normal;/);
    expect(note).not.toContain("italic");
    expect(css).toMatch(/--font-notes:\s*"Inter Variable", Inter, Arial, ui-sans-serif, system-ui, sans-serif;/);
    // Loaded from npm in the root layout (no Google Fonts at build).
    const layout = readFileSync(join(__dirname, "layout.tsx"), "utf8");
    expect(layout).toContain('import "@fontsource-variable/inter/wght.css";');
    expect(layout).not.toContain("400-italic");
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
