import { exportPage } from "@/lib/pdf/renderPdf";
import { SlidesFileError } from "./slideFiles";

const WIDTH = 1920;

export const NOT_IMAGE_TEXT = "One of those images could not be opened. Try saving it as PNG or JPEG again.";

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new SlidesFileError(NOT_IMAGE_TEXT);
  }
}

/**
 * Images as slides, one each, in the order given: each drawn 1920 px wide on white (so a
 * transparent PNG does not show the page behind it) and saved the same way as a PDF page.
 * Same callbacks as renderPdf. Images have no text, so every first line is empty.
 */
export async function renderImages(
  files: File[],
  onProgress: (done: number, total: number) => void,
  onPage?: (image: Blob, index: number) => void,
): Promise<{ blobs: Blob[]; firstLines: string[] }> {
  const total = files.length;
  const blobs: Blob[] = [];
  const canvas = document.createElement("canvas");
  const webpWorks = { value: true };
  onProgress(0, total);
  for (let i = 0; i < total; i++) {
    const bitmap = await decode(files[i]);
    try {
      canvas.width = WIDTH;
      canvas.height = Math.max(1, Math.round((bitmap.height * WIDTH) / bitmap.width));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not turn a slide into an image.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    } finally {
      bitmap.close();
    }
    const image = await exportPage(canvas, webpWorks);
    blobs.push(image);
    onPage?.(image, i);
    onProgress(i + 1, total);
  }
  return { blobs, firstLines: files.map(() => "") };
}
