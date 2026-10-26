"use client";

import { useEffect, useState } from "react";
import type { Rect } from "./rect";

/*
 * Marks that are visible on any slide (Marko, hand test 4: "It's a black background, so I can't
 * see that"). A mark drawn like a highlighter (multiply) disappears on black: anything multiplied by
 * black stays black. So each mark looks at the slide under it and takes one of three looks:
 *
 * - light: today's highlighter (multiply, yellow --color-mark or red --color-mark-lost, no border);
 * - dark: a glow (screen) in a deeper yellow or red (--color-mark-glow, --color-mark-lost-glow) that
 *   lifts the dark slide under it, with a soft halo and no border;
 * - edge: when the slide can not be measured (an image the browser will not let us read, or not
 *   loaded at all), or when neither look would show: a light fill and a 2 px colored inner edge,
 *   which shows on white and on black alike.
 *
 * The slide is measured once per image: drawn small (at most 64 px a side) into an offscreen canvas,
 * then each box's average color is compared with what each look would make of it (OKLab distance),
 * and the box takes the look that changes it the most. Text under a mark stays readable in each
 * look (globals.test.ts measures the blended colors).
 */

/** The look a mark takes on the slide under it. */
export type MarkTone = "light" | "dark" | "edge";

/** The two kinds of marks: red on a slide where the student is lost, else yellow. */
export type ToneKind = "lost" | "save";

/** A small copy of a slide image: `w` x `h` pixels, RGBA, laid over white like the slide box. */
export type SlideSample = { w: number; h: number; data: Uint8ClampedArray };

/** The largest side of the copy. Enough to tell a dark title bar from a white body. */
export const SAMPLE_MAX = 64;

/**
 * The mark colors (globals.css: --color-mark, --color-mark-lost, --color-mark-glow,
 * --color-mark-lost-glow; globals.test.ts checks they are the same).
 */
export const MARK_COLORS = {
  save: { light: "#ffe45c", dark: "#756617" },
  lost: { light: "#f2a898", dark: "#a84635" },
} as const;

/** Below this OKLab distance a look barely shows; when both looks are below it, the edge look is used. */
export const MIN_VISIBLE = 0.06;

type RGB = [number, number, number];

const hexRgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** OKLab coordinates of an sRGB color (0 to 255 per channel). */
export function oklab([r8, g8, b8]: RGB): RGB {
  const [r, g, b] = [toLinear(r8), toLinear(g8), toLinear(b8)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** How far apart two colors look (OKLab distance; about 0.02 is just noticeable). */
export function colorDistance(a: RGB, b: RGB): number {
  const [x, y] = [oklab(a), oklab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** mix-blend-mode: multiply, per channel (what the browser draws in sRGB). */
export const multiply = (under: RGB, fill: RGB): RGB => under.map((u, i) => Math.round((u * fill[i]) / 255)) as RGB;
/** mix-blend-mode: screen, per channel. */
export const screen = (under: RGB, fill: RGB): RGB => under.map((u, i) => Math.round(255 - ((255 - u) * (255 - fill[i])) / 255)) as RGB;

/** The look that shows best on an area of this average color, for a mark of this kind. */
export function toneOn(average: RGB, kind: ToneKind): MarkTone {
  const colors = MARK_COLORS[kind];
  const light = colorDistance(average, multiply(average, hexRgb(colors.light)));
  const dark = colorDistance(average, screen(average, hexRgb(colors.dark)));
  if (Math.max(light, dark) < MIN_VISIBLE) return "edge";
  return dark > light ? "dark" : "light";
}

/** The average color of the copy inside a box (fractions of the slide); the nearest pixel for a tiny box. */
export function averageIn(sample: SlideSample, rect: Rect): RGB {
  const { w, h, data } = sample;
  const x0 = Math.max(0, Math.floor(rect.x * w));
  const y0 = Math.max(0, Math.floor(rect.y * h));
  const x1 = Math.min(w, Math.max(x0 + 1, Math.ceil((rect.x + rect.w) * w)));
  const y1 = Math.min(h, Math.max(y0 + 1, Math.ceil((rect.y + rect.h) * h)));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  if (n === 0) return [255, 255, 255];
  return [r / n, g / n, b / n].map(Math.round) as RGB;
}

/**
 * The look of one mark. `sample` undefined: the slide is still being measured, so today's highlighter
 * (the slide is usually light, and it changes as soon as the copy is there). null: the slide could not
 * be measured, so the edge look, which shows on any color.
 */
export function markTone(sample: SlideSample | null | undefined, rect: Rect, kind: ToneKind): MarkTone {
  if (sample === undefined) return "light";
  if (sample === null) return "edge";
  return toneOn(averageIn(sample, rect), kind);
}

/**
 * The classes that draw a mark in a look (Tailwind utilities on the globals.css tokens). Never a
 * hard black border: the edge look's inner edge is the mark's own color.
 */
export function markLookClass(kind: ToneKind, tone: MarkTone): string {
  const lost = kind === "lost";
  if (tone === "dark") {
    return lost
      ? "mix-blend-screen bg-mark-lost-glow shadow-[0_0_8px_1px_var(--color-mark-lost-glow)]"
      : "mix-blend-screen bg-mark-glow shadow-[0_0_8px_1px_var(--color-mark-glow)]";
  }
  if (tone === "edge") {
    return lost ? "bg-mark-lost/40 inset-ring-2 inset-ring-lost" : "bg-mark/40 inset-ring-2 inset-ring-mark-edge";
  }
  return lost ? "mix-blend-multiply bg-mark-lost" : "mix-blend-multiply bg-mark";
}

/** Draws an image into a small canvas laid over white and reads its pixels; null when the browser will not. */
export function sampleImage(img: HTMLImageElement): SlideSample | null {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!(nw > 0 && nh > 0)) return null;
  const scale = Math.min(1, SAMPLE_MAX / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * scale));
  const h = Math.max(1, Math.round(nh * scale));
  try {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    // A see-through image sits on the white slide box.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    // Throws (SecurityError) when the image is from another site without permission to read it.
    const { data } = ctx.getImageData(0, 0, w, h);
    return data.length === w * h * 4 ? { w, h, data } : null;
  } catch {
    return null;
  }
}

/** Measured slides, by image url (a signed url is new every few hours, so the map is kept small). */
const done = new Map<string, SlideSample | null>();
const waiting = new Map<string, Promise<SlideSample | null>>();
const KEEP = 120;

/** The measured copy of a slide, if it is already there (undefined while it is not). */
export function peekSample(url: string): SlideSample | null | undefined {
  return done.get(url);
}

/**
 * Measures a slide image once per url: loads it with crossOrigin="anonymous" (the slide storage
 * answers with CORS headers, so the canvas can be read) and resolves to its small copy, or null when
 * it fails to load or the canvas can not be read.
 */
export function loadSample(url: string): Promise<SlideSample | null> {
  if (done.has(url)) return Promise.resolve(done.get(url) ?? null);
  const pending = waiting.get(url);
  if (pending) return pending;
  const p = new Promise<SlideSample | null>((resolve) => {
    if (typeof Image === "undefined") {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(sampleImage(img));
    img.onerror = () => resolve(null);
    img.src = url;
  }).then((sample) => {
    waiting.delete(url);
    done.set(url, sample);
    if (done.size > KEEP) done.delete(done.keys().next().value as string);
    return sample;
  });
  waiting.set(url, p);
  return p;
}

/** Forgets every measured slide (tests). */
export function forgetSamples(): void {
  done.clear();
  waiting.clear();
}

/**
 * The measured copy of the slide at `url`: undefined while it is measured (or with no url), null when
 * it can not be measured.
 */
export function useSlideSample(url: string | undefined): SlideSample | null | undefined {
  const [got, setGot] = useState<{ url: string; sample: SlideSample | null } | null>(null);
  useEffect(() => {
    if (!url || done.has(url)) return;
    let on = true;
    void loadSample(url).then((sample) => {
      if (on) setGot({ url, sample });
    });
    return () => {
      on = false;
    };
  }, [url]);
  if (!url) return undefined;
  if (got?.url === url) return got.sample;
  return peekSample(url);
}
