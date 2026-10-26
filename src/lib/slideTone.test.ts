import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeSlideImages } from "../../tests/fakeSlides";
import {
  EDGE_FILL,
  GLOW_MAX_LUMINANCE,
  LIGHT_MIN,
  MARK_COLORS,
  MIN_VISIBLE,
  SAMPLE_RETRY_MS,
  backgroundIn,
  colorDistance,
  contrast,
  glowOver,
  loadSample,
  lookOn,
  luminance,
  markLook,
  markLookClass,
  markTone,
  multiply,
  peekSample,
  sampleImage,
  sampleKey,
  textContrastUnder,
  toneOn,
  useSlideSample,
  type MarkLook,
  type SlideSample,
} from "./slideTone";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type RGB = [number, number, number];
/** A w x h copy painted by (x, y) -> color. */
function sampleOf(w: number, h: number, at: (x: number, y: number) => RGB): SlideSample {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...at(x, y), 255], (y * w + x) * 4);
  return { w, h, data };
}
const plain = (c: RGB) => sampleOf(64, 36, () => c);
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [255, 255, 255];
const CCC: RGB = [204, 204, 204];
/** The edge look's fill over the slide (normal blending). */
const over = (c: RGB, fill: RGB, a: number) => c.map((v, i) => Math.round(v * (1 - a) + fill[i] * a)) as RGB;
/** What a color becomes under a look. */
function under(c: RGB, kind: "save" | "lost", look: MarkLook): RGB {
  if (look.tone === "light") return multiply(c, hex(MARK_COLORS[kind].light));
  if (look.tone === "dark") return glowOver(c, hex(MARK_COLORS[kind].dark), look.opacity ?? 1);
  return over(c, hex(MARK_COLORS[kind].light), EDGE_FILL);
}

describe("each mark takes the look that keeps the text on the slide readable (hand test 4, review I1)", () => {
  it("white keeps the highlighter, black gets a full glow, for yellow and red marks", () => {
    for (const kind of ["save", "lost"] as const) {
      expect(lookOn(WHITE, kind), kind).toEqual({ tone: "light" });
      expect(lookOn(BLACK, kind), kind).toEqual({ tone: "dark", opacity: 1 });
      expect(toneOn([20, 20, 30], kind), kind).toBe("dark");
    }
    // Multiply on black, the old look, changes nothing at all: that is what Marko saw.
    expect(colorDistance(BLACK, multiply(BLACK, hex(MARK_COLORS.save.light)))).toBe(0);
  });

  /*
   * The contrast table (the K1 bar: 4.5:1 for body text). Text is checked where a slide would use it:
   * black on the light and mid backgrounds, white and #ccc on the dark ones. Stated floors where no look
   * can keep 4.5:1: #ccc under a glow keeps 3:1 (a glow bright enough to show lifts the background); black
   * on the mid grays #808080 and #969696 keeps 3.5:1 (multiply darkens the background, a glow washes it).
   */
  const TABLE: { bg: string; black?: number; white?: number; ccc?: number }[] = [
    { bg: "#ffffff", black: 4.5 },
    { bg: "#969696", black: 3.5 },
    { bg: "#808080", black: 3.5 },
    { bg: "#505050", white: 4.5, ccc: 3 },
    { bg: "#333333", white: 4.5, ccc: 3 },
    { bg: "#000000", white: 4.5, ccc: 3 },
    { bg: "#1f3a68", white: 4.5, ccc: 3 },
    { bg: "#003366", white: 4.5, ccc: 3 },
  ];
  for (const row of TABLE) {
    it(`on ${row.bg}: ${[row.black && `black ${row.black}:1`, row.white && `white ${row.white}:1`, row.ccc && `#ccc ${row.ccc}:1`].filter(Boolean).join(", ")}, and the mark shows`, () => {
      const bg = hex(row.bg);
      for (const kind of ["save", "lost"] as const) {
        const look = lookOn(bg, kind);
        const shown = under(bg, kind, look);
        const at = `${kind} ${row.bg} ${JSON.stringify(look)}`;
        if (row.black) expect(contrast(under(BLACK, kind, look), shown), `black, ${at}`).toBeGreaterThanOrEqual(row.black);
        if (row.white) expect(contrast(under(WHITE, kind, look), shown), `white, ${at}`).toBeGreaterThanOrEqual(row.white);
        if (row.ccc) expect(contrast(under(CCC, kind, look), shown), `#ccc, ${at}`).toBeGreaterThanOrEqual(row.ccc);
        // Visible: the look changes the background, or (edge) draws its own colored inner edge.
        if (look.tone !== "edge") expect(colorDistance(bg, shown), `visible, ${at}`).toBeGreaterThanOrEqual(MIN_VISIBLE);
        // textContrastUnder says the same.
        const text = contrast(BLACK, bg) >= contrast(WHITE, bg) ? BLACK : WHITE;
        expect(textContrastUnder(bg, kind, look, text)).toBeCloseTo(contrast(under(text, kind, look), shown), 5);
      }
    });
  }

  it("a glow never lifts the background above luminance 0.183 (white text 4.5:1): its opacity is scaled down on #333, #505050 and navy", () => {
    for (const bg of ["#000000", "#333333", "#505050", "#1f3a68", "#003366", "#2e5e2e", "#b22222"].map(hex)) {
      for (const kind of ["save", "lost"] as const) {
        const look = lookOn(bg, kind);
        if (look.tone !== "dark") continue;
        expect(luminance(under(bg, kind, look))).toBeLessThanOrEqual(GLOW_MAX_LUMINANCE);
        expect(contrast(WHITE, under(bg, kind, look))).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(lookOn(hex("#505050"), "save").opacity).toBeLessThan(1);
    expect(lookOn(hex("#333333"), "lost").opacity).toBeLessThan(1);
  });

  it("the highlighter is kept down to about 0.09 OKLab while it keeps the text readable (navy keeps it: white text turns yellow)", () => {
    expect(LIGHT_MIN).toBe(0.09);
    expect(lookOn(hex("#969696"), "save").tone).toBe("light");
    expect(lookOn(hex("#808080"), "save").tone).toBe("light");
    expect(lookOn(hex("#1f3a68"), "save").tone).toBe("light");
    // Mid gray under the red: multiply would take black text under 3.2:1; the edge look keeps more.
    expect(lookOn(hex("#808080"), "lost").tone).toBe("edge");
  });

  it("is visible on photo colors too (OKLab change of at least 0.06, or the edge look)", () => {
    for (const area of ["#87ceeb", "#2e5e2e", "#c68642", "#1a1a2e", "#b22222", "#c8c8c8", "#646464"]) {
      for (const kind of ["save", "lost"] as const) {
        const look = lookOn(hex(area), kind);
        if (look.tone === "edge") continue;
        expect(colorDistance(hex(area), under(hex(area), kind, look)), `${kind} on ${area}`).toBeGreaterThanOrEqual(MIN_VISIBLE);
      }
    }
    // A yellow mark on a yellow slide, where neither look would show, gets the edge look.
    expect(toneOn(hex("#f5d742"), "save")).toBe("edge");
  });

  it("a box is judged by its background (median), so bold black text in a tight box on white does not tip it", () => {
    // A box on white whose middle third is a black headline: the mean is about 170 (it used to tip to the glow).
    const headline = sampleOf(64, 36, (_x, y) => (y >= 12 && y < 16 ? BLACK : WHITE));
    const box = { x: 0.1, y: 8 / 36, w: 0.6, h: 12 / 36 };
    expect(backgroundIn(headline, box)).toEqual(WHITE);
    expect(markTone(headline, box, "save")).toBe("light");
    // On the black half a glow, on the white half the highlighter.
    const split = sampleOf(64, 36, (x) => (x < 32 ? BLACK : WHITE));
    expect(markTone(split, { x: 0.05, y: 0.1, w: 0.3, h: 0.2 }, "save")).toBe("dark");
    expect(markTone(split, { x: 0.6, y: 0.1, w: 0.3, h: 0.2 }, "save")).toBe("light");
    // White text on black: still black.
    const text = sampleOf(64, 36, (x, y) => (y % 6 === 0 && x % 3 === 0 ? WHITE : BLACK));
    expect(markLook(text, { x: 0.1, y: 0.1, w: 0.8, h: 0.5 }, "lost")).toEqual({ tone: "dark", opacity: 1 });
    // A box smaller than a pixel of the copy reads the pixel it is on.
    expect(backgroundIn(split, { x: 0.9, y: 0.5, w: 0.001, h: 0.001 })).toEqual(WHITE);
  });

  it("while the slide is measured: the highlighter; when it can not be measured: the edge look", () => {
    const r = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    expect(markTone(undefined, r, "save")).toBe("light");
    expect(markTone(null, r, "save")).toBe("edge");
    expect(markTone(plain(BLACK), r, "lost")).toBe("dark");
  });

  it("the looks: multiply highlighter, screen glow (strength in --glow, with a halo), edge fill with a 2 px colored inner edge; never a hard black border", () => {
    expect(markLookClass("save", "light")).toBe("mix-blend-multiply bg-mark");
    expect(markLookClass("lost", "light")).toBe("mix-blend-multiply bg-mark-lost");
    expect(markLookClass("save", "dark")).toBe("mix-blend-screen mark-glow");
    expect(markLookClass("lost", "dark")).toBe("mix-blend-screen mark-lost-glow");
    expect(markLookClass("save", "edge")).toBe("bg-mark/30 inset-ring-2 inset-ring-mark-edge");
    expect(markLookClass("lost", "edge")).toBe("bg-mark-lost/30 inset-ring-2 inset-ring-lost");
    expect(EDGE_FILL).toBe(0.3);
    for (const kind of ["save", "lost"] as const)
      for (const tone of ["light", "dark", "edge"] as const) {
        expect(markLookClass(kind, tone)).not.toMatch(/\bborder\b|ink|black/);
        expect(markLookClass(kind, tone).includes("mix-blend-multiply")).toBe(tone === "light");
      }
  });

  it("the colors here are the globals.css tokens, and the glow utilities take --glow", () => {
    const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
    const token = (name: string) => css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1]?.toLowerCase();
    expect(token("mark")).toBe(MARK_COLORS.save.light);
    expect(token("mark-lost")).toBe(MARK_COLORS.lost.light);
    expect(token("mark-glow")).toBe(MARK_COLORS.save.dark);
    expect(token("mark-lost-glow")).toBe(MARK_COLORS.lost.dark);
    for (const name of ["mark-glow", "mark-lost-glow"]) {
      const block = css.match(new RegExp(`@utility ${name}\\s*{([\\s\\S]*?)\\n}`))?.[1] ?? "";
      expect(block, name).toContain(`color-mix(in srgb, var(--color-${name}) calc(var(--glow, 1) * 100%), transparent)`);
      expect(block, name).toMatch(/box-shadow:\s*0 0 8px 1px/);
    }
  });
});

describe("measuring a slide image", () => {
  it("draws it small (at most 64 px a side) over white and reads its pixels", () => {
    fakeSlideImages(() => "black");
    const s = sampleImage({ naturalWidth: 1600, naturalHeight: 900, src: "x" } as HTMLImageElement)!;
    expect([s.w, s.h]).toEqual([64, 36]);
    expect(Array.from(s.data.slice(0, 4))).toEqual([0, 0, 0, 255]);
  });

  it("a canvas the browser will not read (tainted), no canvas, or an image with no size: null", () => {
    fakeSlideImages(() => "tainted");
    expect(sampleImage({ naturalWidth: 1600, naturalHeight: 900, src: "x" } as HTMLImageElement)).toBeNull();
    expect(sampleImage({ naturalWidth: 0, naturalHeight: 0, src: "x" } as HTMLImageElement)).toBeNull();
    vi.restoreAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(sampleImage({ naturalWidth: 1600, naturalHeight: 900, src: "x" } as HTMLImageElement)).toBeNull();
  });

  it("decodes and shrinks with createImageBitmap where there is one, so only a 64 px bitmap is drawn", async () => {
    fakeSlideImages(() => "white");
    const bitmap = { close: vi.fn(), src: "https://signed/1.webp" };
    const make = vi.fn(async () => bitmap);
    vi.stubGlobal("createImageBitmap", make);
    const s = await loadSample("https://signed/1.webp");
    expect(make).toHaveBeenCalledWith(expect.anything(), { resizeWidth: 64, resizeHeight: 36, resizeQuality: "low" });
    expect(bitmap.close).toHaveBeenCalled();
    expect(s!.data[0]).toBe(255);
  });

  it("loads each slide once, with crossOrigin anonymous; the same slide signed again is not loaded again (review I3)", async () => {
    const fake = fakeSlideImages(() => "white");
    const [a, b] = await Promise.all([loadSample("https://signed/obj/1.webp?token=a"), loadSample("https://signed/obj/1.webp?token=a")]);
    expect(a).toBe(b);
    expect(a!.data[0]).toBe(255);
    expect(fake.loads).toEqual([{ url: "https://signed/obj/1.webp?token=a", crossOrigin: "anonymous" }]);
    // A new signed url for the same storage object: the copy is there at once, nothing is downloaded.
    expect(sampleKey("https://signed/obj/1.webp?token=b")).toBe(sampleKey("https://signed/obj/1.webp?token=a"));
    expect(peekSample("https://signed/obj/1.webp?token=b")).toBe(a);
    expect(await loadSample("https://signed/obj/1.webp?token=b")).toBe(a);
    expect(fake.loads).toHaveLength(1);
    // Another slide is its own.
    expect(sampleKey("https://signed/obj/2.webp?token=a")).not.toBe(sampleKey("https://signed/obj/1.webp?token=a"));
  });

  it("a tainted canvas is remembered as null; a failed load (a network blip) is not, and is tried again", async () => {
    let blip = true;
    const fake = fakeSlideImages((url) => (url.includes("tainted") ? "tainted" : blip ? "broken" : "black"));
    expect(await loadSample("https://signed/3.tainted")).toBeNull();
    expect(peekSample("https://signed/3.tainted")).toBeNull();
    expect(await loadSample("https://signed/4.webp")).toBeNull();
    expect(peekSample("https://signed/4.webp")).toBeUndefined();
    blip = false;
    expect((await loadSample("https://signed/4.webp"))!.data[0]).toBe(0);
    expect(fake.loads.filter((l) => l.url === "https://signed/4.webp")).toHaveLength(2);
  });
});

describe("useSlideSample", () => {
  it("undefined while measuring, then the copy; a new slide is measured again, a slide signed again keeps its copy", async () => {
    const fake = fakeSlideImages((url) => (url.includes("dark") ? "black" : "white"));
    const { result, rerender } = renderHook(({ url }) => useSlideSample(url), { initialProps: { url: "https://signed/dark.webp?t=1" as string | undefined } });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current?.data[0]).toBe(0));
    // The url is signed again (every 3.5 hours): the same copy at once, no new download (review I3).
    rerender({ url: "https://signed/dark.webp?t=2" });
    expect(result.current?.data[0]).toBe(0);
    rerender({ url: "https://signed/light.webp?t=1" });
    await waitFor(() => expect(result.current?.data[0]).toBe(255));
    rerender({ url: "https://signed/dark.webp?t=3" });
    expect(result.current?.data[0]).toBe(0);
    expect(fake.loads.map((l) => l.url)).toEqual(["https://signed/dark.webp?t=1", "https://signed/light.webp?t=1"]);
    rerender({ url: undefined });
    expect(result.current).toBeUndefined();
  });

  it("measured while this page was rendering (by another part of the page): shown without waiting for a re-render (review race)", async () => {
    fakeSlideImages(() => "black");
    const pending = loadSample("https://signed/9.webp");
    const { result } = renderHook(() => useSlideSample("https://signed/9.webp"));
    expect(result.current).toBeUndefined();
    await act(async () => {
      await pending;
    });
    await waitFor(() => expect(result.current?.data[0]).toBe(0));
  });

  it("a network blip: the edge look meanwhile (null), measured again after a few seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let blip = true;
    const fake = fakeSlideImages(() => (blip ? "broken" : "black"));
    const { result } = renderHook(() => useSlideSample("https://signed/5.webp"));
    await waitFor(() => expect(result.current).toBeNull());
    blip = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAMPLE_RETRY_MS[0] + 10);
    });
    await waitFor(() => expect(result.current?.data[0]).toBe(0));
    expect(fake.loads).toHaveLength(2);
  });
});
