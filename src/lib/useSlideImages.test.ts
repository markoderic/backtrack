import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const slidesResult = vi.fn();
const createSignedUrls = vi.fn();
const order = vi.fn();
const eq = vi.fn();
const select = vi.fn();
const storageFrom = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({
    from: (table: string) => {
      select(table);
      return { select: () => ({ eq: (...a: unknown[]) => (eq(...a), { order: (...b: unknown[]) => (order(...b), slidesResult()) }) }) };
    },
    storage: { from: (bucket: string) => (storageFrom(bucket), { createSignedUrls }) },
  }),
}));

import { useSlideImages, RENEW_MS } from "./useSlideImages";

const rows = [
  { number: 1, image_path: "L/1.webp" },
  { number: 2, image_path: "L/2.webp" },
  { number: 3, image_path: "L/3.webp" },
];

let created: string[];
// Images that have not loaded yet, when autoLoad is off.
let pending: { onload: (() => void) | null }[];
let autoLoad: boolean;
const RealImage = globalThis.Image;

beforeEach(() => {
  [slidesResult, createSignedUrls, order, eq, select, storageFrom].forEach((m) => m.mockReset());
  slidesResult.mockResolvedValue({ data: rows, error: null });
  createSignedUrls.mockResolvedValue({
    data: rows.map((r) => ({ path: r.image_path, signedUrl: `https://signed/${r.image_path}`, error: null })),
    error: null,
  });
  created = [];
  pending = [];
  autoLoad = true;
  globalThis.Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(v: string) {
      created.push(v);
      if (autoLoad) queueMicrotask(() => this.onload?.());
      else pending.push(this);
    }
  } as unknown as typeof Image;
});

afterEach(() => {
  globalThis.Image = RealImage;
});

describe("useSlideImages", () => {
  it("reads the lecture's slide paths in order and signs them all for 4 hours at once", async () => {
    const { result } = renderHook(() => useSlideImages("L"));
    await waitFor(() => expect(result.current.urlFor(1)).toBe("https://signed/L/1.webp"));
    expect(select).toHaveBeenCalledWith("slides");
    expect(eq).toHaveBeenCalledWith("lecture_id", "L");
    expect(order).toHaveBeenCalledWith("number");
    expect(storageFrom).toHaveBeenCalledWith("slides");
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(["L/1.webp", "L/2.webp", "L/3.webp"], 14400);
    expect(result.current.urlFor(3)).toBe("https://signed/L/3.webp");
    expect(result.current.urlFor(4)).toBeUndefined();
  });

  it("returns undefined for every slide until the urls arrive", () => {
    const { result } = renderHook(() => useSlideImages("L"));
    expect(result.current.urlFor(1)).toBeUndefined();
  });

  it("preloads the next slide when told the current one", async () => {
    const { result, rerender } = renderHook(({ n }) => useSlideImages("L", n), { initialProps: { n: 1 } });
    await waitFor(() => expect(result.current.urlFor(1)).toBeDefined());
    await waitFor(() => expect(created).toEqual(["https://signed/L/2.webp"]));
    rerender({ n: 2 });
    await waitFor(() => expect(created).toEqual(["https://signed/L/2.webp", "https://signed/L/3.webp"]));
  });

  it("does not preload past the last slide or twice", async () => {
    const { result, rerender } = renderHook(({ n }) => useSlideImages("L", n), { initialProps: { n: 3 } });
    await waitFor(() => expect(result.current.urlFor(1)).toBeDefined());
    rerender({ n: 3 });
    expect(created).toEqual([]);
  });

  it("throws when the slides query fails", async () => {
    slidesResult.mockResolvedValue({ data: null, error: { message: "slides broke" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => {
      try {
        return useSlideImages("L");
      } catch (e) {
        return e as Error;
      }
    });
    await waitFor(() => expect(result.current).toBeInstanceOf(Error));
    expect((result.current as Error).message).toBe("slides broke");
  });

  it("throws when signing fails", async () => {
    createSignedUrls.mockResolvedValue({ data: null, error: { message: "sign broke" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => {
      try {
        return useSlideImages("L");
      } catch (e) {
        return e as Error;
      }
    });
    await waitFor(() => expect(result.current).toBeInstanceOf(Error));
    expect((result.current as Error).message).toBe("sign broke");
  });

  it("throws when one slide could not be signed", async () => {
    createSignedUrls.mockResolvedValue({
      data: [{ path: "L/1.webp", signedUrl: null, error: "Object not found" }],
      error: null,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => {
      try {
        return useSlideImages("L");
      } catch (e) {
        return e as Error;
      }
    });
    await waitFor(() => expect(result.current).toBeInstanceOf(Error));
    expect((result.current as Error).message).toBe("Object not found");
  });

  describe("renewing the urls before they expire", () => {
    const wait = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));
    // Each signing hands out new urls, as Supabase does (a new token every time).
    let signing = 0;
    beforeEach(() => {
      vi.useFakeTimers();
      signing = 0;
      createSignedUrls.mockImplementation(async (paths: string[]) => {
        signing++;
        return { data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}?v=${signing}`, error: null })), error: null };
      });
    });
    afterEach(() => vi.useRealTimers());

    it("is 3.5 hours, under the 4 hours they last", () => {
      expect(RENEW_MS).toBe(3.5 * 60 * 60 * 1000);
      expect(RENEW_MS).toBeLessThan(14400 * 1000);
    });

    it("signs them all again 3.5 hours after the last signing, and again after that", async () => {
      const { result } = renderHook(() => useSlideImages("L", 1));
      await wait(0);
      expect(result.current.urlFor(1)).toBe("https://signed/L/1.webp?v=1");
      await wait(RENEW_MS - 1);
      expect(createSignedUrls).toHaveBeenCalledTimes(1);
      await wait(1);
      expect(createSignedUrls).toHaveBeenCalledTimes(2);
      expect(result.current.urlFor(1)).toBe("https://signed/L/1.webp?v=2");
      await wait(RENEW_MS);
      expect(createSignedUrls).toHaveBeenCalledTimes(3);
      expect(result.current.urlFor(3)).toBe("https://signed/L/3.webp?v=3");
    });

    it("keeps the old urls when a renewal fails, does not throw, and tries again a minute later", async () => {
      const { result } = renderHook(() => useSlideImages("L"));
      await wait(0);
      createSignedUrls.mockResolvedValueOnce({ data: null, error: { message: "sign broke" } });
      await wait(RENEW_MS);
      expect(createSignedUrls).toHaveBeenCalledTimes(2);
      expect(result.current.urlFor(2)).toBe("https://signed/L/2.webp?v=1");
      await wait(60 * 1000);
      expect(createSignedUrls).toHaveBeenCalledTimes(3);
      expect(result.current.urlFor(2)).toBe("https://signed/L/2.webp?v=2");
    });

    it("treats a renewal that finds no slide rows as failed, and tries again a minute later", async () => {
      const { result } = renderHook(() => useSlideImages("L"));
      await wait(0);
      slidesResult.mockResolvedValueOnce({ data: [], error: null });
      await wait(RENEW_MS);
      expect(result.current.urlFor(1)).toBe("https://signed/L/1.webp?v=1");
      await wait(60 * 1000);
      expect(result.current.urlFor(1)).toBe("https://signed/L/1.webp?v=2");
    });

    it("drops the wait for the new image when the page goes away", async () => {
      const { unmount } = renderHook(() => useSlideImages("L", 2));
      await wait(0);
      autoLoad = false;
      await wait(RENEW_MS);
      const img = pending.at(-1) as { onload: (() => void) | null };
      expect(img.onload).not.toBeNull();
      unmount();
      expect(img.onload).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("catches up when the page is shown again after a sleep the timer missed", async () => {
      const { result } = renderHook(() => useSlideImages("L"));
      await wait(0);
      // The clock jumps 4 hours (a laptop that slept), but no timer has fired yet.
      vi.setSystemTime(Date.now() + 4 * 60 * 60 * 1000);
      await act(async () => document.dispatchEvent(new Event("visibilitychange")));
      await wait(0);
      expect(createSignedUrls).toHaveBeenCalledTimes(2);
      expect(result.current.urlFor(1)).toBe("https://signed/L/1.webp?v=2");
    });

    it("does not sign again on a visible page before the 3.5 hours", async () => {
      renderHook(() => useSlideImages("L"));
      await wait(0);
      await act(async () => window.dispatchEvent(new Event("focus")));
      await wait(0);
      expect(createSignedUrls).toHaveBeenCalledTimes(1);
    });

    it("loads the slide on screen with its new url before the urls swap, so it never blinks", async () => {
      const { result } = renderHook(() => useSlideImages("L", 2));
      await wait(0);
      expect(result.current.urlFor(2)).toBe("https://signed/L/2.webp?v=1");
      autoLoad = false;
      await wait(RENEW_MS);
      expect(createSignedUrls).toHaveBeenCalledTimes(2);
      expect(created).toContain("https://signed/L/2.webp?v=2");
      // Not loaded yet: the old urls stay.
      expect(result.current.urlFor(2)).toBe("https://signed/L/2.webp?v=1");
      await act(async () => pending.find((p) => p.onload)?.onload?.());
      expect(result.current.urlFor(2)).toBe("https://signed/L/2.webp?v=2");
      expect(result.current.urlFor(1)).toBe("https://signed/L/1.webp?v=2");
    });

    it("swaps anyway when the new image takes over 10 seconds", async () => {
      const { result } = renderHook(() => useSlideImages("L", 2));
      await wait(0);
      autoLoad = false;
      await wait(RENEW_MS);
      expect(result.current.urlFor(2)).toBe("https://signed/L/2.webp?v=1");
      await wait(10 * 1000);
      expect(result.current.urlFor(2)).toBe("https://signed/L/2.webp?v=2");
    });

    it("starts one renewal, not one per focus, while a renewal is out", async () => {
      let release: () => void = () => {};
      renderHook(() => useSlideImages("L"));
      await wait(0);
      createSignedUrls.mockImplementationOnce(
        () => new Promise((resolve) => (release = () => resolve({ data: rows.map((r) => ({ path: r.image_path, signedUrl: `https://signed/${r.image_path}?v=9`, error: null })), error: null }))),
      );
      vi.setSystemTime(Date.now() + 4 * 60 * 60 * 1000);
      for (let i = 0; i < 5; i++) {
        await act(async () => window.dispatchEvent(new Event("focus")));
        await act(async () => document.dispatchEvent(new Event("visibilitychange")));
      }
      await wait(0);
      expect(createSignedUrls).toHaveBeenCalledTimes(2);
      await act(async () => release());
      await wait(0);
      expect(createSignedUrls).toHaveBeenCalledTimes(2);
    });

    it("stops when it unmounts", async () => {
      const { unmount } = renderHook(() => useSlideImages("L"));
      await wait(0);
      unmount();
      await wait(RENEW_MS * 2);
      expect(createSignedUrls).toHaveBeenCalledTimes(1);
    });
  });
});
