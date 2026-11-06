/**
 * Which slide files the start form takes, and how a pick is grouped. A PDF or a PowerPoint file is
 * one part each; the images picked together are one part, in name order (Slide2 before Slide10), so
 * a deck exported as one image per slide reads as one deck.
 */

export type SlideKind = "pdf" | "pptx" | "image";

/** A file the form cannot read, with the words that say what to do instead. */
export class SlidesFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlidesFileError";
  }
}

export const UNSUPPORTED_TEXT = "That file type isn't supported. Use a PDF, a PowerPoint file (.pptx), PNG or JPEG.";
export const OLD_PPT_TEXT = "That's an old PowerPoint file (.ppt). Save it as .pptx or PDF and try again.";
export const KEYNOTE_TEXT = "Keynote files can't be read here. Export it as PDF or PowerPoint and try again.";

/** What the file picker offers. */
export const SLIDES_ACCEPT = [
  ".pdf",
  ".pptx",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/png",
  "image/jpeg",
  "image/webp",
].join(",");

const PPTX_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const extension = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
};

/** The kind of a picked file, by its name first and its type second. Throws SlidesFileError for anything else. */
export function kindOf(file: File): SlideKind {
  const ext = extension(file.name);
  if (ext === "pdf") return "pdf";
  if (ext === "pptx") return "pptx";
  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp") return "image";
  if (ext === "ppt") throw new SlidesFileError(OLD_PPT_TEXT);
  if (ext === "key") throw new SlidesFileError(KEYNOTE_TEXT);
  if (file.type === "application/pdf") return "pdf";
  if (file.type === PPTX_TYPE) return "pptx";
  if (file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/webp") return "image";
  throw new SlidesFileError(UNSUPPORTED_TEXT);
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * The parts a pick makes, in the order picked: each PDF or PowerPoint file alone, and all the images
 * together (sorted by name) where the first image was. Files the form cannot read are left out, and
 * the first one's message is returned so the form can say it.
 */
export function groupPicked(files: File[]): { groups: File[][]; error: string | null } {
  const groups: File[][] = [];
  let images: File[] | null = null;
  let error: string | null = null;
  for (const file of files) {
    let kind: SlideKind;
    try {
      kind = kindOf(file);
    } catch (e) {
      if (!error) error = e instanceof SlidesFileError ? e.message : UNSUPPORTED_TEXT;
      continue;
    }
    if (kind === "image") {
      if (!images) {
        images = [];
        groups.push(images);
      }
      images.push(file);
    } else {
      groups.push([file]);
    }
  }
  if (images) images.sort((a, b) => collator.compare(a.name, b.name));
  return { groups, error };
}

/** The name a part goes by on the form: its file, or "12 images" for a set of images. */
export function partName(files: File[]): string {
  if (files.length === 1) return files[0].name;
  return `${files.length} images`;
}
