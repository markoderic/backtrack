import { SlidesFileError } from "./slideFiles";

/** The sandboxed renderer (src/pptx-renderer/main.ts, built into public/pptx-renderer/). */
export const PPTX_RENDERER_URL = "/pptx-renderer/index.html";
/** With no word from the renderer for this long, it is given up on. */
export const PPTX_IDLE_MS = 45_000;
const MAX_LENGTH = 200;

export const PPTX_TEXT = "Could not read that PowerPoint file. Try saving it as a PDF and uploading that.";

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

type In =
  | { type: "ready" }
  | { type: "info"; total: number }
  | { type: "slide"; index: number; image: Blob; firstLine: string }
  | { type: "done" }
  | { type: "error"; message: string };

/**
 * A PowerPoint file as slides. The file is read in a frame sandboxed without allow-same-origin, so
 * the renderer (pptx-preview, closed source, and echarts) runs in an origin of its own, with no
 * access to the site's cookies or the teacher's session. Each slide comes back as an image and is
 * handed on as it arrives. Same callbacks as renderPdf, including stopping when onProgress throws.
 */
export async function renderPptx(
  file: File,
  onProgress: (done: number, total: number) => void,
  onPage?: (image: Blob, index: number) => void,
): Promise<{ blobs: Blob[]; firstLines: string[] }> {
  const data = await file.arrayBuffer();
  const head = new Uint8Array(data.slice(0, 4));
  if (!ZIP_MAGIC.every((b, i) => head[i] === b)) throw new SlidesFileError(PPTX_TEXT);

  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.title = "PowerPoint renderer";
  // In view but invisible (1 px, opacity 0): Chrome pauses a cross origin frame that is off screen,
  // and the render would never finish. The slide inside is still laid out at 1920 px.
  frame.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;";
  frame.src = PPTX_RENDERER_URL;

  return new Promise((resolve, reject) => {
    const blobs: Blob[] = [];
    const firstLines: string[] = [];
    let total = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;

    const finish = (error?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      frame.remove();
      if (error !== undefined) reject(error);
      else resolve({ blobs, firstLines });
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(new SlidesFileError(PPTX_TEXT)), PPTX_IDLE_MS);
    };

    function onMessage(event: MessageEvent) {
      // Only the frame made here; its origin is "null" (sandboxed), so the source is what is checked.
      if (event.source !== frame.contentWindow) return;
      const message = event.data as In;
      arm();
      try {
        if (message?.type === "ready") {
          frame.contentWindow?.postMessage({ type: "render", data }, "*", [data]);
        } else if (message?.type === "info") {
          if (!Number.isInteger(message.total) || message.total < 1) throw new SlidesFileError(PPTX_TEXT);
          total = message.total;
          onProgress(0, total);
        } else if (message?.type === "slide") {
          const { index, image } = message;
          const isImage = image instanceof Blob && (image.type === "image/webp" || image.type === "image/jpeg");
          if (index !== blobs.length || index >= total || !isImage) throw new SlidesFileError(PPTX_TEXT);
          blobs.push(image);
          firstLines.push(typeof message.firstLine === "string" ? message.firstLine.slice(0, MAX_LENGTH) : "");
          onPage?.(image, index);
          onProgress(blobs.length, total);
        } else if (message?.type === "done") {
          if (blobs.length === 0 || blobs.length !== total) throw new SlidesFileError(PPTX_TEXT);
          finish();
        } else if (message?.type === "error") {
          throw new SlidesFileError(PPTX_TEXT);
        }
      } catch (error) {
        // onProgress throwing is the form stopping this render; anything else is a file that did not read.
        finish(error);
      }
    }

    window.addEventListener("message", onMessage);
    arm();
    document.body.appendChild(frame);
  });
}
