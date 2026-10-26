import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeSlideImages } from "../../tests/fakeSlides";
import {
  MARK_COLORS,
  MIN_VISIBLE,
  averageIn,
  colorDistance,
  loadSample,
  markLookClass,
  markTone,
  multiply,
  peekSample,
  sampleImage,
  screen,
  toneOn,
  useSlideSample,
  type SlideSample,
} from "./slideTone";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A w x h copy painted by (x, y) -> color. */
function sampleOf(w: number, h: number, at: (x: number, y: number) => [number, number, number]): SlideSample {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...at(x, y), 255], (y * w + x) * 4);
  return { w, h, data };
}
const plain = (c: [number, number, number]) => sampleOf(64, 36, () => c);
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

describe("each mark takes the look that shows on the slide under it (hand test 4: black slides)", () => {
  it("white keeps the highlighter, black gets the glow, for yellow and red marks", () => {
    for (const kind of ["save", "lost"] as const) {
      expect(toneOn([255, 255, 255], kind), kind).toBe("light");
      expect(toneOn([0, 0, 0], kind), kind).toBe("dark");
      expect(toneOn([20, 20, 30], kind), kind).toBe("dark");
    }
  });

  it("is clearly visible on white, light and mid gray, black and photo colors (it changes the area by at least 0.1 in OKLab, or takes the edge look)", () => {
    const areas = ["#ffffff", "#c8c8c8", "#808080", "#464646", "#000000", "#87ceeb", "#2e5e2e", "#c68642", "#1a1a2e", "#1f3a68", "#b22222"];
    for (const kind of ["save", "lost"] as const) {
      for (const area of areas) {
        const under = hex(area);
        const tone = toneOn(under, kind);
        if (tone === "edge") continue;
        const fill = hex(MARK_COLORS[kind][tone]);
        const shown = tone === "light" ? multiply(under, fill) : screen(under, fill);
        expect(colorDistance(under, shown), `${kind} on ${area} (${tone})`).toBeGreaterThanOrEqual(0.1);
      }
    }
    // Multiply on black, the old look, changes nothing at all: that is what Marko saw.
    expect(colorDistance([0, 0, 0], multiply([0, 0, 0], hex(MARK_COLORS.save.light)))).toBe(0);
  });

  it("a yellow mark on a yellow slide, where neither look would show, gets the edge look", () => {
    expect(toneOn(hex("#f5d742"), "save")).toBe("edge");
    expect(MIN_VISIBLE).toBeGreaterThan(0.02);
  });

  it("a box is judged by the average of the slide under it: on the black half it glows, on the white half it is a highlighter", () => {
    const split = sampleOf(64, 36, (x) => (x < 32 ? [0, 0, 0] : [255, 255, 255]));
    expect(markTone(split, { x: 0.05, y: 0.1, w: 0.3, h: 0.2 }, "save")).toBe("dark");
    expect(markTone(split, { x: 0.6, y: 0.1, w: 0.3, h: 0.2 }, "save")).toBe("light");
    // Mostly black with white text in it: still dark on average.
    const text = sampleOf(64, 36, (x, y) => (y % 6 === 0 && x % 3 === 0 ? [255, 255, 255] : [0, 0, 0]));
    expect(markTone(text, { x: 0.1, y: 0.1, w: 0.8, h: 0.5 }, "lost")).toBe("dark");
    expect(averageIn(split, { x: 0.25, y: 0, w: 0.5, h: 1 })).toEqual([128, 128, 128]);
    // A box smaller than a pixel of the copy reads the pixel it is on.
    expect(averageIn(split, { x: 0.9, y: 0.5, w: 0.001, h: 0.001 })).toEqual([255, 255, 255]);
  });

  it("while the slide is measured: the highlighter; when it can not be measured: the edge look", () => {
    const r = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    expect(markTone(undefined, r, "save")).toBe("light");
    expect(markTone(null, r, "save")).toBe("edge");
    expect(markTone(plain([0, 0, 0]), r, "lost")).toBe("dark");
  });

  it("the looks: multiply highlighter, screen glow with a soft halo, edge fill with a 2 px colored inner edge; never a hard black border", () => {
    expect(markLookClass("save", "light")).toBe("mix-blend-multiply bg-mark");
    expect(markLookClass("lost", "light")).toBe("mix-blend-multiply bg-mark-lost");
    expect(markLookClass("save", "dark")).toContain("mix-blend-screen bg-mark-glow");
    expect(markLookClass("lost", "dark")).toContain("mix-blend-screen bg-mark-lost-glow");
    expect(markLookClass("save", "dark")).toContain("shadow-[0_0_8px_1px_var(--color-mark-glow)]");
    expect(markLookClass("save", "edge")).toBe("bg-mark/40 inset-ring-2 inset-ring-mark-edge");
    expect(markLookClass("lost", "edge")).toBe("bg-mark-lost/40 inset-ring-2 inset-ring-lost");
    for (const kind of ["save", "lost"] as const)
      for (const tone of ["light", "dark", "edge"] as const) {
        expect(markLookClass(kind, tone)).not.toMatch(/\bborder\b|ink|black/);
        expect(markLookClass(kind, tone).includes("mix-blend-multiply")).toBe(tone === "light");
      }
  });

  it("the colors here are the globals.css tokens", () => {
    const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
    const token = (name: string) => css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1]?.toLowerCase();
    expect(token("mark")).toBe(MARK_COLORS.save.light);
    expect(token("mark-lost")).toBe(MARK_COLORS.lost.light);
    expect(token("mark-glow")).toBe(MARK_COLORS.save.dark);
    expect(token("mark-lost-glow")).toBe(MARK_COLORS.lost.dark);
  });
});

describe("measuring a slide image", () => {
  it("draws it small (at most 64 px a side) over white and reads its pixels", () => {
    fakeSlideImages(() => "black");
    const img = { naturalWidth: 1600, naturalHeight: 900, src: "x" } as HTMLImageElement;
    const s = sampleImage(img)!;
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

  it("loads each url once, with crossOrigin anonymous, and keeps the result; a broken or tainted image is null", async () => {
    const fake = fakeSlideImages((url) => (url.endsWith("broken") ? "broken" : url.endsWith("tainted") ? "tainted" : "white"));
    const [a, b] = await Promise.all([loadSample("https://signed/1.webp"), loadSample("https://signed/1.webp")]);
    expect(a).toBe(b);
    expect(a!.data[0]).toBe(255);
    expect(fake.loads).toEqual([{ url: "https://signed/1.webp", crossOrigin: "anonymous" }]);
    expect(peekSample("https://signed/1.webp")).toBe(a);
    await loadSample("https://signed/1.webp");
    expect(fake.loads).toHaveLength(1);
    expect(await loadSample("https://signed/2.broken")).toBeNull();
    expect(await loadSample("https://signed/3.tainted")).toBeNull();
    expect(peekSample("https://signed/3.tainted")).toBeNull();
  });

  it("useSlideSample: undefined while measuring, then the copy; a new url is measured again", async () => {
    fakeSlideImages((url) => (url.includes("dark") ? "black" : "white"));
    const { result, rerender } = renderHook(({ url }) => useSlideSample(url), { initialProps: { url: "https://signed/dark.webp" as string | undefined } });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current?.data[0]).toBe(0));
    rerender({ url: "https://signed/light.webp" });
    await waitFor(() => expect(result.current?.data[0]).toBe(255));
    // Measured before: there at once.
    rerender({ url: "https://signed/dark.webp" });
    expect(result.current?.data[0]).toBe(0);
    rerender({ url: undefined });
    expect(result.current).toBeUndefined();
  });
});
