import { firstLine, type TextItem } from "./firstLine";

export class NotPdfError extends Error {
  constructor() {
    super("That file isn't a PDF.");
    this.name = "NotPdfError";
  }
}

export class PasswordPdfError extends Error {
  constructor() {
    super("That PDF is password protected. Remove the password and try again.");
    this.name = "PasswordPdfError";
  }
}

const PAGE_WIDTH = 1920;
const QUALITY = 0.85;
const PDF_MAGIC = "%PDF-";

async function startsWithPdfMagic(file: Blob): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, PDF_MAGIC.length).arrayBuffer());
  return PDF_MAGIC.split("").every((ch, i) => bytes[i] === ch.charCodeAt(0));
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

// WebP first. A browser that cannot encode it hands back a PNG, so check the type
// of what came back and use JPEG instead.
async function exportPage(canvas: HTMLCanvasElement, webpWorks: { value: boolean }): Promise<Blob> {
  if (webpWorks.value) {
    const webp = await canvasToBlob(canvas, "image/webp");
    if (webp && webp.type === "image/webp") return webp;
    webpWorks.value = false;
  }
  const jpeg = await canvasToBlob(canvas, "image/jpeg");
  if (!jpeg) throw new Error("Could not turn a slide into an image.");
  return jpeg;
}

// pdfjs-dist errors are plain Error subclasses; tell them apart by name.
function translate(error: unknown): unknown {
  const name = error instanceof Error ? error.name : "";
  if (name === "PasswordException") return new PasswordPdfError();
  if (name === "InvalidPDFException") return new NotPdfError();
  return error;
}

/**
 * Renders every page of a PDF to an image in the browser, 1920 px wide, plus the
 * first line of text on each page. Calls onProgress(done, total) after each page.
 */
export async function renderPdf(
  file: File,
  onProgress: (done: number, total: number) => void,
): Promise<{ blobs: Blob[]; firstLines: string[] }> {
  if (!(await startsWithPdfMagic(file))) throw new NotPdfError();

  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let doc;
  try {
    doc = await task.promise;
  } catch (error) {
    await task.destroy();
    throw translate(error);
  }

  try {
    const total = doc.numPages;
    const blobs: Blob[] = [];
    const firstLines: string[] = [];
    const canvas = document.createElement("canvas");
    const webpWorks = { value: true };

    for (let n = 1; n <= total; n++) {
      const page = await doc.getPage(n);
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: PAGE_WIDTH / natural.width });
      canvas.width = PAGE_WIDTH;
      canvas.height = Math.round(viewport.height);

      await page.render({ canvas, viewport }).promise;
      blobs.push(await exportPage(canvas, webpWorks));

      const content = await page.getTextContent();
      const items = content.items.filter((item): item is typeof item & TextItem => "str" in item && "transform" in item);
      firstLines.push(firstLine(items));

      page.cleanup();
      onProgress(n, total);
    }
    return { blobs, firstLines };
  } catch (error) {
    throw translate(error);
  } finally {
    await task.destroy();
  }
}
