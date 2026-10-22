import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const slidesResult = vi.fn();
const createSignedUrls = vi.fn();
const inCall = vi.fn();
const eq = vi.fn();
const select = vi.fn();
const fromTable = vi.fn();
const storageFrom = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({
    from: (table: string) => {
      fromTable(table);
      return {
        select: (cols: string) => (
          select(cols),
          { eq: (...a: unknown[]) => (eq(...a), { in: (...b: unknown[]) => (inCall(...b), slidesResult()) }) }
        ),
      };
    },
    storage: { from: (bucket: string) => (storageFrom(bucket), { createSignedUrls }) },
  }),
}));

import { useSlideUrls, RENEW_MS } from "./useSlideUrls";

const path = (n: number) => `L/${n}.webp`;

beforeEach(() => {
  [slidesResult, createSignedUrls, inCall, eq, select, fromTable, storageFrom].forEach((m) => m.mockReset());
  slidesResult.mockImplementation(async () => ({
    data: (inCall.mock.calls.at(-1)?.[1] as number[]).map((n) => ({ number: n, image_path: path(n) })),
    error: null,
  }));
  createSignedUrls.mockImplementation(async (paths: string[]) => ({
    data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}`, error: null })),
    error: null,
  }));
});

describe("useSlideUrls", () => {
  it("asks for nothing while no slide is wanted", async () => {
    const { result } = renderHook(() => useSlideUrls("L", []));
    await act(async () => {});
    expect(fromTable).not.toHaveBeenCalled();
    expect(createSignedUrls).not.toHaveBeenCalled();
    expect(result.current).toEqual({});
  });

  it("reads and signs only the wanted slides", async () => {
    const { result } = renderHook(() => useSlideUrls("L", [4, 2]));
    await waitFor(() => expect(result.current[2]).toBe("https://signed/L/2.webp"));
    expect(result.current[4]).toBe("https://signed/L/4.webp");
    expect(fromTable).toHaveBeenCalledWith("slides");
    expect(select).toHaveBeenCalledWith("number, image_path");
    expect(eq).toHaveBeenCalledWith("lecture_id", "L");
    expect(inCall).toHaveBeenCalledWith("number", [2, 4]);
    expect(storageFrom).toHaveBeenCalledWith("slides");
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith([path(2), path(4)], 14400);
  });

  it("asks only for the slides it does not have yet", async () => {
    const { result, rerender } = renderHook(({ wanted }) => useSlideUrls("L", wanted), { initialProps: { wanted: [2] } });
    await waitFor(() => expect(result.current[2]).toBeDefined());
    rerender({ wanted: [2, 5] });
    await waitFor(() => expect(result.current[5]).toBe("https://signed/L/5.webp"));
    expect(inCall).toHaveBeenLastCalledWith("number", [5]);
    expect(result.current[2]).toBe("https://signed/L/2.webp");
    // The same list again asks for nothing.
    rerender({ wanted: [5, 2] });
    await act(async () => {});
    expect(createSignedUrls).toHaveBeenCalledTimes(2);
  });

  it("does not ask twice for a slide while the first answer is still coming", async () => {
    let finish!: (v: unknown) => void;
    createSignedUrls.mockReturnValueOnce(new Promise((r) => (finish = r)));
    const { result, rerender } = renderHook(({ wanted }) => useSlideUrls("L", wanted), { initialProps: { wanted: [2] } });
    await waitFor(() => expect(createSignedUrls).toHaveBeenCalledTimes(1));
    rerender({ wanted: [2, 3] });
    await waitFor(() => expect(createSignedUrls).toHaveBeenCalledTimes(2));
    expect(createSignedUrls).toHaveBeenLastCalledWith([path(3)], 14400);
    finish({ data: [{ path: path(2), signedUrl: "https://signed/L/2.webp", error: null }], error: null });
    await waitFor(() => expect(result.current[2]).toBe("https://signed/L/2.webp"));
  });

  it("does not throw when the slides can not be read; the slide just has no image", async () => {
    slidesResult.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => useSlideUrls("L", [2]));
    await act(async () => {});
    expect(result.current).toEqual({});
  });

  it("does not throw when an image can not be signed, and keeps the ones that could", async () => {
    createSignedUrls.mockResolvedValue({
      data: [
        { path: path(2), signedUrl: null, error: "Object not found" },
        { path: path(3), signedUrl: "https://signed/L/3.webp", error: null },
      ],
      error: null,
    });
    const { result } = renderHook(() => useSlideUrls("L", [2, 3]));
    await waitFor(() => expect(result.current[3]).toBe("https://signed/L/3.webp"));
    expect(result.current[2]).toBeUndefined();
  });

  it("asks again for a slide that failed the next time the wanted list changes", async () => {
    slidesResult.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { result, rerender } = renderHook(({ wanted }) => useSlideUrls("L", wanted), { initialProps: { wanted: [2] } });
    await act(async () => {});
    rerender({ wanted: [2, 3] });
    await waitFor(() => expect(result.current[2]).toBe("https://signed/L/2.webp"));
    expect(result.current[3]).toBe("https://signed/L/3.webp");
  });

  describe("renewing before the urls expire", () => {
    const wait = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));
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

    it("signs every wanted slide again after 3.5 hours, keeping the old urls until then", async () => {
      const { result } = renderHook(() => useSlideUrls("L", [2, 4]));
      await wait(0);
      expect(result.current[2]).toBe("https://signed/L/2.webp?v=1");
      await wait(RENEW_MS - 1);
      expect(createSignedUrls).toHaveBeenCalledTimes(1);
      await wait(1);
      expect(createSignedUrls).toHaveBeenCalledTimes(2);
      expect(createSignedUrls).toHaveBeenLastCalledWith([path(2), path(4)], 14400);
      expect(result.current[4]).toBe("https://signed/L/4.webp?v=2");
    });

    it("keeps the old urls when a renewal fails and tries again a minute later", async () => {
      const { result } = renderHook(() => useSlideUrls("L", [2]));
      await wait(0);
      createSignedUrls.mockResolvedValueOnce({ data: null, error: { message: "sign broke" } });
      await wait(RENEW_MS);
      expect(createSignedUrls).toHaveBeenCalledTimes(2);
      expect(result.current[2]).toBe("https://signed/L/2.webp?v=1");
      await wait(60 * 1000);
      expect(createSignedUrls).toHaveBeenCalledTimes(3);
      expect(result.current[2]).toBe("https://signed/L/2.webp?v=2");
    });

    it("a slide with no image keeps failing without delaying the next renewal (minute by minute)", async () => {
      // Slide 9 has no row, as in a seeded demo lecture.
      slidesResult.mockImplementation(async () => {
        const asked = (inCall.mock.calls.at(-1)?.[1] as number[]).filter((n) => n !== 9);
        return { data: asked.map((n) => ({ number: n, image_path: path(n) })), error: null };
      });
      const { result, rerender } = renderHook(({ wanted }) => useSlideUrls("L", wanted), {
        initialProps: { wanted: [2] },
      });
      await wait(0);
      expect(result.current[2]).toBe("https://signed/L/2.webp?v=1");
      await wait(RENEW_MS);
      expect(result.current[2]).toBe("https://signed/L/2.webp?v=2");
      // Someone highlights slide 9 a minute later.
      await wait(60 * 1000);
      rerender({ wanted: [2, 9] });
      await wait(0);
      const asksFor9 = () => inCall.mock.calls.filter((c) => (c[1] as number[]).includes(9)).length;
      expect(asksFor9()).toBe(1);
      // 3.5 hours after the last full signing, a minute at a time.
      for (let m = 1; m < 210; m++) await wait(60 * 1000);
      expect(result.current[2]).toBe("https://signed/L/2.webp?v=3");
      expect(result.current[9]).toBeUndefined();
      // Slide 9 was only asked for with each renewal, never every minute.
      expect(asksFor9()).toBe(2);
    });

    it("a slide whose renewal is refused alone is tried again a minute later", async () => {
      const { result } = renderHook(() => useSlideUrls("L", [2, 4]));
      await wait(0);
      createSignedUrls.mockImplementationOnce(async (paths: string[]) => {
        signing++;
        return {
          data: paths.map((p) =>
            p === path(4)
              ? { path: p, signedUrl: null, error: "Object not found" }
              : { path: p, signedUrl: `https://signed/${p}?v=${signing}`, error: null },
          ),
          error: null,
        };
      });
      await wait(RENEW_MS);
      expect(result.current[2]).toBe("https://signed/L/2.webp?v=2");
      expect(result.current[4]).toBe("https://signed/L/4.webp?v=1");
      await wait(60 * 1000);
      expect(createSignedUrls).toHaveBeenLastCalledWith([path(4)], 14400);
      expect(result.current[4]).toBe("https://signed/L/4.webp?v=3");
      // And the next full renewal still comes 3.5 hours after the last one, not after the retry.
      await wait(RENEW_MS - 60 * 1000);
      expect(createSignedUrls).toHaveBeenLastCalledWith([path(2), path(4)], 14400);
    });

    it("starts one renewal, not one per focus", async () => {
      renderHook(() => useSlideUrls("L", [2]));
      await wait(0);
      vi.setSystemTime(Date.now() + 4 * 60 * 60 * 1000);
      for (let i = 0; i < 5; i++) await act(async () => window.dispatchEvent(new Event("focus")));
      await wait(0);
      expect(createSignedUrls).toHaveBeenCalledTimes(2);
    });

    it("catches up when the page is shown again after a sleep", async () => {
      const { result } = renderHook(() => useSlideUrls("L", [3]));
      await wait(0);
      vi.setSystemTime(Date.now() + 4 * 60 * 60 * 1000);
      await act(async () => document.dispatchEvent(new Event("visibilitychange")));
      await wait(0);
      expect(result.current[3]).toBe("https://signed/L/3.webp?v=2");
    });
  });
});
