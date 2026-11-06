/**
 * The PowerPoint renderer. It runs only inside a sandboxed frame (public/pptx-renderer/index.html,
 * opened by src/lib/slides/renderPptx.ts with sandbox="allow-scripts" and no allow-same-origin), so
 * it has no access to the site's cookies, storage or session. pptx-preview is closed source and
 * pulls in echarts, which has open advisories; the sandbox is what keeps a bad file from reaching
 * the teacher's login.
 *
 * Built into public/pptx-renderer/render.js by scripts/build-pptx-renderer.mjs.
 *
 * The page asks with {type: "render", data: ArrayBuffer}. This answers, to the page only:
 * {type: "ready"} once loaded, {type: "info", total}, then one {type: "slide", index, image, firstLine}
 * per slide (image: a WebP or JPEG Blob, 1920 px wide), then {type: "done"}, or {type: "error", message}.
 */
import { init } from "pptx-preview";
import { toCanvas } from "html-to-image";

const WIDTH = 1920;
const QUALITY = 0.85;
const MAX_LENGTH = 200;
// Charts are drawn by echarts with a short animation; a slide with one waits this long before the picture.
const CHART_WAIT_MS = 1200;

type Out =
  | { type: "ready" }
  | { type: "info"; total: number }
  | { type: "slide"; index: number; image: Blob; firstLine: string }
  | { type: "done" }
  | { type: "error"; message: string };

const send = (message: Out) => window.parent.postMessage(message, "*");

const toBlob = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY));

async function exportSlide(canvas: HTMLCanvasElement, webpWorks: { value: boolean }): Promise<Blob> {
  if (webpWorks.value) {
    const webp = await toBlob(canvas, "image/webp");
    if (webp && webp.type === "image/webp") return webp;
    webpWorks.value = false;
  }
  const jpeg = await toBlob(canvas, "image/jpeg");
  if (!jpeg) throw new Error("Could not turn a slide into an image.");
  return jpeg;
}

async function settle(el: HTMLElement) {
  await Promise.all(
    Array.from(el.querySelectorAll("img")).map((img) => img.decode().catch(() => undefined)),
  );
  await document.fonts.ready;
  if (el.querySelector(".chart-node")) await new Promise((r) => setTimeout(r, CHART_WAIT_MS));
  // A timer, not requestAnimationFrame, which a cross origin frame may not get.
  await new Promise((r) => setTimeout(r, 0));
}

function firstLineOf(el: HTMLElement): string {
  for (const node of Array.from(el.querySelectorAll<HTMLElement>(".text-wrapper"))) {
    const line = (node.innerText || node.textContent || "")
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .find((l) => l !== "");
    if (line) return line.slice(0, MAX_LENGTH);
  }
  return "";
}

const SERIF = /cambria|times|georgia|garamond|palatino|book antiqua|serif/i;
const GENERIC = /(?:^|,)\s*(?:sans-serif|serif|monospace|system-ui)\s*$/i;

/**
 * Gets a slide ready for its picture. The slide sits at its own top left (the previewer centers a
 * slide that is taller than 16:9 with a negative top, which the picture would keep and cut off).
 * And every font list ends in a close fallback: the picture is drawn as an SVG image, which sees
 * only the fonts installed on the computer, so a deck in Calibri on a computer without it would
 * otherwise come out in a serif.
 */
function prepareForPicture(el: HTMLElement) {
  el.style.top = "0px";
  el.style.left = "0px";
  el.style.margin = "0px";
  for (const node of [el, ...Array.from(el.querySelectorAll<HTMLElement>("*"))]) {
    const family = getComputedStyle(node).fontFamily;
    if (!family || GENERIC.test(family)) continue;
    const fallback = SERIF.test(family) ? 'Georgia, "Times New Roman", serif' : 'Arial, Helvetica, "Liberation Sans", sans-serif';
    node.style.fontFamily = `${family}, ${fallback}`;
  }
}

let busy = false;

async function render(data: ArrayBuffer) {
  const host = document.getElementById("host") as HTMLElement;
  host.replaceChildren();
  const previewer = init(host, { width: WIDTH, height: 1080, mode: "slide" });
  const pptx = await previewer.load(data);
  const total = pptx.slides.length;
  if (total === 0) throw new Error("empty");
  send({ type: "info", total });
  const webpWorks = { value: true };
  for (let index = 0; index < total; index++) {
    previewer.renderSingleSlide(index);
    const el = host.querySelector<HTMLElement>(".pptx-preview-slide-wrapper");
    if (!el) throw new Error("no slide");
    await settle(el);
    prepareForPicture(el);
    const rect = el.getBoundingClientRect();
    // html-to-image, not a library that makes frames of its own: inside this sandbox a child frame
    // gets an origin of its own and could not be read.
    const canvas = await toCanvas(el, {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      canvasWidth: Math.round(rect.width),
      canvasHeight: Math.round(rect.height),
      pixelRatio: 1,
      backgroundColor: "#ffffff",
      // The deck's fonts are the computer's own; nothing to fetch and inline.
      skipFonts: true,
    });
    send({ type: "slide", index, image: await exportSlide(canvas, webpWorks), firstLine: firstLineOf(el) });
  }
  previewer.destroy();
  send({ type: "done" });
}

window.addEventListener("message", (event) => {
  // Only the page that opened this frame gives it work.
  if (event.source !== window.parent || busy) return;
  const message = event.data as { type?: string; data?: unknown };
  if (message?.type !== "render" || !(message.data instanceof ArrayBuffer)) return;
  busy = true;
  render(message.data).catch((error: unknown) => {
    send({ type: "error", message: error instanceof Error ? error.message : String(error) });
  });
});

send({ type: "ready" });
