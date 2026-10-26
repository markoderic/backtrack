import { vi } from "vitest";

/**
 * How a fake slide image looks when a test measures it (lib/slideTone):
 * white, black, mid gray, "dim" (#333), "blackdim" (left half black, right half #505050), "split" (left half black, right half white), "tainted" (it loads but the
 * canvas may not be read, like an image from another site without CORS) or "broken" (it fails to load).
 */
export type FakePaint = "white" | "black" | "gray" | "dim" | "split" | "blackdim" | "tainted" | "broken";

const RGB: Record<"white" | "black" | "gray" | "dim", [number, number, number]> = {
  dim: [51, 51, 51],
  white: [255, 255, 255],
  black: [0, 0, 0],
  gray: [128, 128, 128],
};

/**
 * jsdom loads no images and has no canvas. This stands in for both: `new Image()` loads (or fails)
 * on the next microtask with a 1600 x 900 picture painted as `paint(url)` says, and a 2d canvas
 * draws it. Returns the urls loaded and with which crossOrigin.
 */
export function fakeSlideImages(paint: (url: string) => FakePaint) {
  const loads: { url: string; crossOrigin: string | null }[] = [];
  class FakeImage {
    crossOrigin: string | null = null;
    decoding = "auto";
    naturalWidth = 0;
    naturalHeight = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private url = "";
    get src() {
      return this.url;
    }
    set src(url: string) {
      this.url = url;
      loads.push({ url, crossOrigin: this.crossOrigin });
      queueMicrotask(() => {
        if (paint(url) === "broken") {
          this.onerror?.();
          return;
        }
        this.naturalWidth = 1600;
        this.naturalHeight = 900;
        this.onload?.();
      });
    }
  }
  vi.stubGlobal("Image", FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function () {
    let drawn: FakeImage | null = null;
    return {
      fillStyle: "",
      fillRect() {},
      drawImage(img: FakeImage) {
        drawn = img;
      },
      getImageData(_x: number, _y: number, w: number, h: number) {
        const look = paint(drawn?.src ?? "");
        if (look === "tainted") throw new DOMException("The canvas has been tainted by cross-origin data.", "SecurityError");
        const data = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const c =
              look === "split"
                ? x < w / 2
                  ? RGB.black
                  : RGB.white
                : look === "blackdim"
                  ? x < w / 2
                    ? RGB.black
                    : ([80, 80, 80] as [number, number, number])
                  : RGB[look as keyof typeof RGB];
            const i = (y * w + x) * 4;
            data.set([...c, 255], i);
          }
        }
        return { data, width: w, height: h };
      },
    } as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext);
  return { loads };
}
