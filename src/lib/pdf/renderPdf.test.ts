import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getDocument = vi.fn();
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: (...args: unknown[]) => getDocument(...args),
}));

import { renderPdf, NotPdfError, PasswordPdfError } from "./renderPdf";

const pdfFile = (name = "a.pdf") => new File(["%PDF-1.7\n..."], name, { type: "application/pdf" });

let canvases: { width: number; height: number }[] = [];

function fakePage(text: string) {
  return {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: vi.fn((params: { canvas: { width: number; height: number } }) => {
      canvases.push({ width: params.canvas.width, height: params.canvas.height });
      return { promise: Promise.resolve() };
    }),
    getTextContent: vi.fn(async () => ({
      items: [{ type: "beginMarkedContent" }, { str: text, transform: [1, 0, 0, 1, 10, 700] }],
    })),
    cleanup: vi.fn(),
  };
}

function fakeDoc(pages: string[]) {
  return {
    numPages: pages.length,
    getPage: vi.fn(async (n: number) => fakePage(pages[n - 1])),
  };
}

let blobType = "image/webp";

beforeEach(() => {
  getDocument.mockReset();
  blobType = "image/webp";
  canvases = [];
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (cb, type) {
    // A browser that cannot encode WebP hands back a PNG whatever you ask for.
    const want = type === "image/webp" ? blobType : (type ?? "image/png");
    cb(new Blob(["img"], { type: want }));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderPdf", () => {
  it("throws NotPdfError for a file that does not start with %PDF-", async () => {
    const file = new File(["PK\u0003\u0004 not a pdf"], "slides.pdf", { type: "application/pdf" });
    await expect(renderPdf(file, () => {})).rejects.toBeInstanceOf(NotPdfError);
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("throws NotPdfError for an empty file", async () => {
    await expect(renderPdf(new File([], "empty.pdf"), () => {})).rejects.toBeInstanceOf(NotPdfError);
  });

  it("maps a pdfjs InvalidPDFException to NotPdfError", async () => {
    const err = Object.assign(new Error("Invalid PDF structure."), { name: "InvalidPDFException" });
    getDocument.mockReturnValue({ promise: Promise.reject(err), destroy: vi.fn() });
    await expect(renderPdf(pdfFile(), () => {})).rejects.toBeInstanceOf(NotPdfError);
  });

  it("maps a pdfjs PasswordException to PasswordPdfError", async () => {
    const err = Object.assign(new Error("No password given"), { name: "PasswordException" });
    getDocument.mockReturnValue({ promise: Promise.reject(err), destroy: vi.fn() });
    await expect(renderPdf(pdfFile(), () => {})).rejects.toBeInstanceOf(PasswordPdfError);
  });

  it("lets other errors through unchanged", async () => {
    getDocument.mockReturnValue({ promise: Promise.reject(new Error("boom")), destroy: vi.fn() });
    await expect(renderPdf(pdfFile(), () => {})).rejects.toThrow("boom");
  });

  it("calls onProgress once per page and returns a blob and first line for each", async () => {
    const destroy = vi.fn(async () => {});
    getDocument.mockReturnValue({ promise: Promise.resolve(fakeDoc(["One", "Two", "Three"])), destroy });
    const onProgress = vi.fn();
    const result = await renderPdf(pdfFile(), onProgress);
    expect(onProgress.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(result.blobs).toHaveLength(3);
    expect(result.blobs.every((b) => b.type === "image/webp")).toBe(true);
    expect(result.firstLines).toEqual(["One", "Two", "Three"]);
    expect(destroy).toHaveBeenCalled();
  });

  it("hands each page's image to onPage as soon as it is made, in order, before that page's progress", async () => {
    getDocument.mockReturnValue({ promise: Promise.resolve(fakeDoc(["One", "Two", "Three"])), destroy: vi.fn(async () => {}) });
    const order: string[] = [];
    const onPage = vi.fn((_image: Blob, i: number) => order.push(`page ${i}`));
    const result = await renderPdf(pdfFile(), (done) => order.push(`progress ${done}`), onPage);
    expect(onPage.mock.calls.map((c) => c[0])).toEqual(result.blobs);
    expect(onPage.mock.calls.map((c) => c[1])).toEqual([0, 1, 2]);
    expect(order).toEqual(["page 0", "progress 1", "page 1", "progress 2", "page 2", "progress 3"]);
  });

  it("renders each page 1920 px wide", async () => {
    getDocument.mockReturnValue({ promise: Promise.resolve(fakeDoc(["One"])), destroy: vi.fn() });
    await renderPdf(pdfFile(), () => {});
    expect(canvases[0].width).toBe(1920);
    expect(canvases[0].height).toBe(2560);
  });

  it("asks for WebP at quality 0.85", async () => {
    getDocument.mockReturnValue({ promise: Promise.resolve(fakeDoc(["One"])), destroy: vi.fn() });
    await renderPdf(pdfFile(), () => {});
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/webp", 0.85);
  });

  it("falls back to JPEG when the canvas cannot make WebP", async () => {
    blobType = "image/png";
    getDocument.mockReturnValue({ promise: Promise.resolve(fakeDoc(["One", "Two"])), destroy: vi.fn() });
    const result = await renderPdf(pdfFile(), () => {});
    expect(result.blobs.every((b) => b.type === "image/jpeg")).toBe(true);
  });
});
