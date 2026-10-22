import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

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

import { useSlideImages } from "./useSlideImages";

const rows = [
  { number: 1, image_path: "L/1.webp" },
  { number: 2, image_path: "L/2.webp" },
  { number: 3, image_path: "L/3.webp" },
];

let created: string[];
const RealImage = globalThis.Image;

beforeEach(() => {
  [slidesResult, createSignedUrls, order, eq, select, storageFrom].forEach((m) => m.mockReset());
  slidesResult.mockResolvedValue({ data: rows, error: null });
  createSignedUrls.mockResolvedValue({
    data: rows.map((r) => ({ path: r.image_path, signedUrl: `https://signed/${r.image_path}`, error: null })),
    error: null,
  });
  created = [];
  globalThis.Image = class {
    set src(v: string) {
      created.push(v);
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
});
