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
 *   lifts the dark slide under it, with a soft halo and no border, at the opacity that keeps the
 *   background at luminance 0.183 or below (white text 4.5:1);
 * - edge: when the slide can not be measured (an image the browser will not let us read), or on mid
 *   grays where it keeps the text most readable: a 30% fill and a 2 px colored inner edge, which
 *   shows on white and on black alike.
 *
 * The slide is measured once per storage object (not per signed url), only while a slide has marks
 * or Mark is on: decoded and shrunk to at most 64 px a side (createImageBitmap) and read from a
 * canvas. Each box is judged by its background (the pixel of median luminance in it), and takes the
 * look that keeps the slide's text readable (lookOn); slideTone.test.ts measures the contrasts.
 */

/** The look a mark takes on the slide under it. */
export type MarkTone = "light" | "dark" | "edge";

/** A look, and for a glow the opacity that keeps white text under it readable. */
export type MarkLook = { tone: MarkTone; opacity?: number };

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
  save: { light: "#ffe45c", dark: "#84731a" },
  lost: { light: "#f2a898", dark: "#b84d3a" },
} as const;

/** The highlighter is kept while multiply changes the background at least this much (OKLab). */
export const LIGHT_MIN = 0.09;
/** Below this OKLab change a look barely shows. */
export const MIN_VISIBLE = 0.06;
/** A glow never lifts the background above this luminance: white text under it keeps 4.5:1. */
export const GLOW_MAX_LUMINANCE = 0.183;
/** A glow that would have to be fainter than this to keep white text readable takes the edge look. */
export const GLOW_MIN_OPACITY = 0.35;

type RGB = [number, number, number];

const hexRgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Relative luminance (WCAG) of an sRGB color. */
export function luminance([r, g, b]: RGB): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

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
/** A glow at this opacity: mix-blend-screen on an element with `opacity`. */
export const glowOver = (under: RGB, fill: RGB, opacity: number): RGB => {
  const lifted = screen(under, fill);
  return under.map((u, i) => Math.round(u + opacity * (lifted[i] - u))) as RGB;
};

/** The strongest glow (0 to 1, two decimals, rounded down) that keeps this background at GLOW_MAX_LUMINANCE or below. */
export function glowOpacityOn(under: RGB, fill: RGB): number {
  if (luminance(glowOver(under, fill, 1)) <= GLOW_MAX_LUMINANCE) return 1;
  if (luminance(under) > GLOW_MAX_LUMINANCE) return 0;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (luminance(glowOver(under, fill, mid)) <= GLOW_MAX_LUMINANCE) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo * 100) / 100;
}

/** WCAG contrast of two colors. */
export function contrast(a: RGB, b: RGB): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Text under a mark keeps 4.5:1, or what it had when it had less. */
export const TEXT_MIN = 4.5;

/** The edge look's fill: this much of the mark color over the slide (normal blending). */
export const EDGE_FILL = 0.3;
const over = (under: RGB, fill: RGB, a: number): RGB => under.map((u, i) => Math.round(u * (1 - a) + fill[i] * a)) as RGB;

/**
 * The look for a mark on this background, chosen so the text on it stays readable (the slide's text
 * is taken to be black or white, whichever reads better on this background):
 * - the highlighter (multiply) while it shows (LIGHT_MIN) and the text keeps TEXT_MIN (or what it had);
 * - else a glow, as strong as white text allows (the background at GLOW_MAX_LUMINANCE or below);
 * - else (mid grays, where no look keeps 4.5:1) whichever visible look keeps the text most readable.
 */
export function lookOn(background: RGB, kind: ToneKind): MarkLook {
  const fill = hexRgb(MARK_COLORS[kind].light);
  const glow = hexRgb(MARK_COLORS[kind].dark);
  const black: RGB = [0, 0, 0];
  const white: RGB = [255, 255, 255];
  const text = contrast(black, background) >= contrast(white, background) ? black : white;
  const need = Math.min(TEXT_MIN, contrast(text, background));
  const lightShows = colorDistance(background, multiply(background, fill));
  const lightText = contrast(multiply(text, fill), multiply(background, fill));
  if (lightShows >= LIGHT_MIN && lightText >= need) return { tone: "light" };
  const opacity = glowOpacityOn(background, glow);
  const glowShows = opacity >= GLOW_MIN_OPACITY && colorDistance(background, glowOver(background, glow, opacity)) >= MIN_VISIBLE;
  const glowText = contrast(glowOver(text, glow, opacity), glowOver(background, glow, opacity));
  if (glowShows && glowText >= need) return { tone: "dark", opacity };
  const edgeText = contrast(over(text, fill, EDGE_FILL), over(background, fill, EDGE_FILL));
  const options: [number, MarkLook][] = [[edgeText, { tone: "edge" }]];
  if (lightShows >= MIN_VISIBLE) options.push([lightText, { tone: "light" }]);
  if (glowShows) options.push([glowText, { tone: "dark", opacity }]);
  return options.sort((x, y) => y[0] - x[0])[0][1];
}

/** The contrast of the slide's text (black or white, whichever it is likely to be) under a look. */
export function textContrastUnder(background: RGB, kind: ToneKind, look: MarkLook, text: RGB): number {
  const fill = hexRgb(MARK_COLORS[kind].light);
  const glow = hexRgb(MARK_COLORS[kind].dark);
  const draw = (c: RGB) => (look.tone === "light" ? multiply(c, fill) : look.tone === "dark" ? glowOver(c, glow, look.opacity ?? 1) : over(c, fill, EDGE_FILL));
  return contrast(draw(text), draw(background));
}

/**
 * A glow's strength rounded down to a step of 0.1 (1 stays 1). Glows of one step share a layer whose
 * opacity is the step, so a pile in it is never stronger than its weakest allowed glow, and a dim
 * part of a slide never weakens the glows on its black parts.
 */
export const glowStep = (opacity: number): number => (opacity >= 1 ? 1 : Math.floor(opacity * 10 + 1e-9) / 10);

/** The look's tone alone. */
export const toneOn = (background: RGB, kind: ToneKind): MarkTone => lookOn(background, kind).tone;

/**
 * The background inside a box (fractions of the slide): the pixel of median luminance, so the text in
 * the box does not tip it (a bold headline on white is still white); the nearest pixel for a tiny box.
 */
export function backgroundIn(sample: SlideSample, rect: Rect): RGB {
  const { w, h, data } = sample;
  const x0 = Math.min(w - 1, Math.max(0, Math.floor(rect.x * w)));
  const y0 = Math.min(h - 1, Math.max(0, Math.floor(rect.y * h)));
  const x1 = Math.min(w, Math.max(x0 + 1, Math.ceil((rect.x + rect.w) * w)));
  const y1 = Math.min(h, Math.max(y0 + 1, Math.ceil((rect.y + rect.h) * h)));
  const px: { l: number; c: RGB }[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      const c: RGB = [data[i], data[i + 1], data[i + 2]];
      px.push({ l: luminance(c), c });
    }
  }
  if (px.length === 0) return [255, 255, 255];
  px.sort((a, b) => a.l - b.l);
  return px[Math.floor(px.length / 2)].c;
}

/**
 * The look of one mark. `sample` undefined: the slide is still being measured, so today's highlighter.
 * null: the slide could not be measured, so the edge look, which shows on any color.
 */
export function markLook(sample: SlideSample | null | undefined, rect: Rect, kind: ToneKind): MarkLook {
  if (sample === undefined) return { tone: "light" };
  if (sample === null) return { tone: "edge" };
  return lookOn(backgroundIn(sample, rect), kind);
}

/** The tone alone. */
export const markTone = (sample: SlideSample | null | undefined, rect: Rect, kind: ToneKind): MarkTone => markLook(sample, rect, kind).tone;

/**
 * The classes that draw a mark in a look (Tailwind utilities on the globals.css tokens). Never a
 * hard black border: the edge look's inner edge is the mark's own color.
 */
export function markLookClass(kind: ToneKind, tone: MarkTone): string {
  const lost = kind === "lost";
  if (tone === "dark") {
    // The glow's strength comes from --glow on the mark (globals.css mark-glow, mark-lost-glow).
    return lost ? "mix-blend-screen mark-lost-glow" : "mix-blend-screen mark-glow";
  }
  if (tone === "edge") {
    return lost ? "bg-mark-lost/30 inset-ring-2 inset-ring-lost" : "bg-mark/30 inset-ring-2 inset-ring-mark-edge";
  }
  return lost ? "mix-blend-multiply bg-mark-lost" : "mix-blend-multiply bg-mark";
}

/** What measuring gave: the copy (or null), and whether that is final (a network failure is not). */
type Measured = { sample: SlideSample | null; final: boolean };

/** The copy's size for an image of this size. */
const sampleSize = (nw: number, nh: number) => {
  const scale = Math.min(1, SAMPLE_MAX / Math.max(nw, nh));
  return { w: Math.max(1, Math.round(nw * scale)), h: Math.max(1, Math.round(nh * scale)) };
};

/** Draws an image (or an already small bitmap) into a canvas laid over white and reads its pixels. */
export function sampleFrom(source: CanvasImageSource, w: number, h: number): Measured {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { sample: null, final: true };
    // A see-through image sits on the white slide box.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    // Throws (SecurityError) when the image is from another site without permission to read it.
    const { data } = ctx.getImageData(0, 0, w, h);
    return data.length === w * h * 4 ? { sample: { w, h, data }, final: true } : { sample: null, final: true };
  } catch (e) {
    // Not allowed to read it: that will not change. Anything else may work next time.
    return { sample: null, final: (e as { name?: string } | null)?.name === "SecurityError" };
  }
}

/** Draws an image element small and reads it; null when the browser will not. */
export function sampleImage(img: HTMLImageElement): SlideSample | null {
  if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) return null;
  const { w, h } = sampleSize(img.naturalWidth, img.naturalHeight);
  return sampleFrom(img, w, h).sample;
}

/**
 * Measures a loaded image off the main thread where the browser can: createImageBitmap decodes and
 * shrinks it to the copy's size, so only a 64 px bitmap is drawn; else img.decode() first.
 */
async function measureImage(img: HTMLImageElement): Promise<Measured> {
  if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) return { sample: null, final: true };
  const { w, h } = sampleSize(img.naturalWidth, img.naturalHeight);
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(img, { resizeWidth: w, resizeHeight: h, resizeQuality: "low" });
      const out = sampleFrom(bitmap, w, h);
      bitmap.close?.();
      return out;
    } catch {
      // Fall back to drawing the element.
    }
  }
  await img.decode?.().catch(() => {});
  return sampleFrom(img, w, h);
}

/**
 * The cache key of a slide image: its storage object (origin and path), not its signed url, so a
 * url signed again every few hours finds the slide already measured.
 */
export function sampleKey(url: string): string {
  try {
    const u = new URL(url, typeof location === "undefined" ? "http://localhost/" : location.href);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

/** Measured slides, by storage object. null only for a slide that may never be read (SecurityError). */
const done = new Map<string, SlideSample | null>();
const waiting = new Map<string, Promise<SlideSample | null>>();
/** Slides whose load failed: how many times, and when they may be tried again. */
const retries = new Map<string, { count: number; next: number }>();
/** After a failed load, a slide is tried again after these waits; after the last it is remembered as unreadable. */
export const SAMPLE_RETRY_MS = [5_000, 15_000, 30_000, 60_000];
const KEEP = 120;

/** The measured copy of a slide, if it is already there (undefined while it is not). */
export function peekSample(url: string): SlideSample | null | undefined {
  return done.get(sampleKey(url));
}

/**
 * Measures a slide image once per storage object: loads it with crossOrigin="anonymous" (the slide
 * storage answers with CORS headers, so the canvas can be read) and resolves to its small copy, or
 * null. A canvas that may not be read is remembered as null; a failed load is not (tried again later).
 */
export function loadSample(url: string): Promise<SlideSample | null> {
  const key = sampleKey(url);
  if (done.has(key)) return Promise.resolve(done.get(key) ?? null);
  const pending = waiting.get(key);
  if (pending) return pending;
  // Failed before: not again until its wait is over (shared by every part of the page).
  const retry = retries.get(key);
  if (retry && Date.now() < retry.next) return Promise.resolve(null);
  const p = new Promise<Measured>((resolve) => {
    if (typeof Image === "undefined") {
      resolve({ sample: null, final: true });
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => void measureImage(img).then(resolve);
    img.onerror = () => resolve({ sample: null, final: false });
    img.src = url;
  }).then(({ sample, final }) => {
    waiting.delete(key);
    if (final) {
      retries.delete(key);
      remember(key, sample);
    } else {
      // A failed load: a network blip, or (with crossOrigin) storage that does not allow reading the
      // image. Tried again after SAMPLE_RETRY_MS; after the last try it is remembered as unreadable,
      // so it is not downloaded again on every visit.
      const count = (retries.get(key)?.count ?? 0) + 1;
      if (count > SAMPLE_RETRY_MS.length) {
        retries.delete(key);
        remember(key, null);
      } else retries.set(key, { count, next: Date.now() + SAMPLE_RETRY_MS[count - 1] });
    }
    return sample;
  });
  waiting.set(key, p);
  return p;
}

function remember(key: string, sample: SlideSample | null) {
  done.set(key, sample);
  if (done.size > KEEP) done.delete(done.keys().next().value as string);
}

/** When a slide that failed to load may be tried again (ms since epoch), or undefined. */
export function retryAt(url: string): number | undefined {
  return retries.get(sampleKey(url))?.next;
}

/** Forgets every measured slide and every retry (tests). */
export function forgetSamples(): void {
  done.clear();
  waiting.clear();
  retries.clear();
}

/**
 * The measured copy of the slide at `url`: undefined while it is measured (or with no url), null when
 * it can not be measured (the edge look). The same slide signed again keeps its copy. A failed load
 * shows null and is tried again when its slide's wait is over (the waits are per slide, kept for the
 * page, so one slide's failures never hold up another).
 */
export function useSlideSample(url: string | undefined): SlideSample | null | undefined {
  const key = url ? sampleKey(url) : undefined;
  const [got, setGot] = useState<{ key: string; sample: SlideSample | null } | null>(null);
  // Goes up when a wait is over, to try again.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url || !key) return;
    let on = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      const at = retryAt(url);
      if (at !== undefined && !done.has(key)) timer = setTimeout(() => setTick((t) => t + 1), Math.max(0, at - Date.now()));
    };
    const at = retryAt(url);
    if (done.has(key) || (at !== undefined && at > Date.now())) {
      // Measured between this render and this effect, or waiting to try again: show what there is now.
      void Promise.resolve().then(() => {
        if (!on) return;
        setGot({ key, sample: done.has(key) ? (done.get(key) ?? null) : null });
        later();
      });
    } else {
      void loadSample(url).then((sample) => {
        if (!on) return;
        setGot({ key, sample });
        later();
      });
    }
    return () => {
      on = false;
      clearTimeout(timer);
    };
  }, [url, key, tick]);
  if (!key) return undefined;
  if (done.has(key)) return done.get(key);
  if (got?.key === key) return got.sample;
  return undefined;
}
