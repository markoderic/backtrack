import { describe, it, expect, vi, beforeEach } from "vitest";
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

import { useSlideUrls } from "./useSlideUrls";

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
});
