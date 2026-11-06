import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PPTX_IDLE_MS, PPTX_RENDERER_URL, PPTX_TEXT, renderPptx } from "./renderPptx";

const zip = (name = "deck.pptx") => new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])], name);
const webp = () => new Blob(["img"], { type: "image/webp" });

const frame = () => document.querySelector("iframe") as HTMLIFrameElement;
/** A message from the renderer frame (its source is the frame's window, as in a browser). */
const fromFrame = (data: unknown, source: Window | null = frame().contentWindow) =>
  window.dispatchEvent(new MessageEvent("message", { data, source }));
const tick = () => new Promise((r) => setTimeout(r, 0));

let posted: unknown[] = [];

beforeEach(() => {
  posted = [];
});
afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll("iframe").forEach((f) => f.remove());
});

async function started(file = zip(), onProgress = vi.fn(), onPage = vi.fn()) {
  const result = renderPptx(file, onProgress, onPage);
  await tick();
  const win = frame().contentWindow as Window;
  vi.spyOn(win, "postMessage").mockImplementation((m: unknown) => {
    posted.push(m);
  });
  return { result, onProgress, onPage };
}

describe("renderPptx", () => {
  it("refuses a file that is not a zip without making a frame", async () => {
    await expect(renderPptx(new File(["%PDF-1.7"], "x.pptx"), () => {})).rejects.toThrow(PPTX_TEXT);
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("opens the renderer in a frame sandboxed without allow-same-origin", async () => {
    await started();
    const f = frame();
    expect(f.getAttribute("sandbox")).toBe("allow-scripts");
    expect(f.getAttribute("src")).toBe(PPTX_RENDERER_URL);
    expect(f.getAttribute("aria-hidden")).toBe("true");
  });

  it("sends the file once the frame is ready, then hands on each slide and resolves on done", async () => {
    const { result, onProgress, onPage } = await started();
    fromFrame({ type: "ready" });
    expect(posted).toHaveLength(1);
    expect((posted[0] as { type: string }).type).toBe("render");
    fromFrame({ type: "info", total: 2 });
    const a = webp();
    const b = new Blob(["img"], { type: "image/jpeg" });
    fromFrame({ type: "slide", index: 0, image: a, firstLine: "Adjusting Entries" });
    fromFrame({ type: "slide", index: 1, image: b, firstLine: "x".repeat(500) });
    fromFrame({ type: "done" });
    const { blobs, firstLines } = await result;
    expect(blobs).toEqual([a, b]);
    expect(firstLines[0]).toBe("Adjusting Entries");
    expect(firstLines[1]).toHaveLength(200);
    expect(onPage.mock.calls.map((c) => c[1])).toEqual([0, 1]);
    expect(onProgress.mock.calls).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("ignores messages from anywhere but its own frame", async () => {
    const { result } = await started();
    fromFrame({ type: "done" }, window);
    fromFrame({ type: "error", message: "x" }, null);
    fromFrame({ type: "info", total: 1 });
    fromFrame({ type: "slide", index: 0, image: webp(), firstLine: "" });
    fromFrame({ type: "done" });
    await expect(result).resolves.toMatchObject({ firstLines: [""] });
  });

  it("refuses a slide that is not a WebP or JPEG image, or out of order", async () => {
    let { result } = await started();
    fromFrame({ type: "info", total: 1 });
    fromFrame({ type: "slide", index: 0, image: new Blob(["<svg>"], { type: "image/svg+xml" }), firstLine: "" });
    await expect(result).rejects.toThrow(PPTX_TEXT);
    ({ result } = await started());
    fromFrame({ type: "info", total: 2 });
    fromFrame({ type: "slide", index: 1, image: webp(), firstLine: "" });
    await expect(result).rejects.toThrow(PPTX_TEXT);
  });

  it("turns the renderer's error, or a done with slides missing, into the PowerPoint message", async () => {
    let { result } = await started();
    fromFrame({ type: "error", message: "boom" });
    await expect(result).rejects.toThrow(PPTX_TEXT);
    ({ result } = await started());
    fromFrame({ type: "info", total: 2 });
    fromFrame({ type: "slide", index: 0, image: webp(), firstLine: "" });
    fromFrame({ type: "done" });
    await expect(result).rejects.toThrow(PPTX_TEXT);
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("stops, and takes the frame away, when onProgress throws (the form cancelling)", async () => {
    const onProgress = vi.fn(() => {
      throw new Error("cancelled");
    });
    const { result } = await started(zip(), onProgress);
    fromFrame({ type: "info", total: 3 });
    await expect(result).rejects.toThrow("cancelled");
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("gives up when the renderer goes quiet", async () => {
    vi.useFakeTimers();
    const result = renderPptx(zip(), () => {});
    const caught = result.catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(PPTX_IDLE_MS + 10);
    expect(((await caught) as Error).message).toBe(PPTX_TEXT);
    expect(document.querySelector("iframe")).toBeNull();
  });
});
