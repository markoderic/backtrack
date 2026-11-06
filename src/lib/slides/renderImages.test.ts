import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NOT_IMAGE_TEXT, renderImages } from "./renderImages";

const png = (name: string) => new File(["png"], name, { type: "image/png" });
let drawn: { width: number; height: number; fill: string }[] = [];

beforeEach(() => {
  drawn = [];
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async (file: File) => {
      if (file.name.startsWith("bad")) throw new Error("decode");
      return { width: 960, height: 540, close: vi.fn() };
    }),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    const ctx = {
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(() => drawn.push({ width: this.width, height: this.height, fill: ctx.fillStyle })),
    };
    return ctx as unknown as CanvasRenderingContext2D;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (cb, type) {
    cb(new Blob(["img"], { type: type ?? "image/png" }));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("renderImages", () => {
  it("makes one 1920 px slide per image, on white, in order, with empty first lines", async () => {
    const onProgress = vi.fn();
    const onPage = vi.fn();
    const { blobs, firstLines } = await renderImages([png("1.png"), png("2.png")], onProgress, onPage);
    expect(blobs.map((b) => b.type)).toEqual(["image/webp", "image/webp"]);
    expect(firstLines).toEqual(["", ""]);
    expect(drawn).toEqual([
      { width: 1920, height: 1080, fill: "#ffffff" },
      { width: 1920, height: 1080, fill: "#ffffff" },
    ]);
    expect(onPage.mock.calls.map((c) => c[1])).toEqual([0, 1]);
    expect(onProgress.mock.calls).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });

  it("says so when an image cannot be opened", async () => {
    await expect(renderImages([png("ok.png"), png("bad.png")], () => {})).rejects.toThrow(NOT_IMAGE_TEXT);
  });
});
