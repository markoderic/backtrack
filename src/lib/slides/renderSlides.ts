import { renderPdf } from "@/lib/pdf/renderPdf";
import { kindOf } from "./slideFiles";
import { renderImages } from "./renderImages";
import { renderPptx } from "./renderPptx";

/**
 * One part of the start form as slide images: a PDF, a PowerPoint file, or a set of images
 * (see groupPicked). Same callbacks and result as renderPdf.
 */
export function renderSlides(
  files: File[],
  onProgress: (done: number, total: number) => void,
  onPage?: (image: Blob, index: number) => void,
): Promise<{ blobs: Blob[]; firstLines: string[] }> {
  const kind = kindOf(files[0]);
  if (kind === "image") return renderImages(files, onProgress, onPage);
  if (kind === "pptx") return renderPptx(files[0], onProgress, onPage);
  return renderPdf(files[0], onProgress, onPage);
}
