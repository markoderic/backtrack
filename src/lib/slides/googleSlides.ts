/** A Google Slides file id: letters, digits, _ and -, as Google makes them. */
export function isGoogleSlidesId(id: string): boolean {
  return /^[A-Za-z0-9_-]{20,100}$/.test(id);
}

export const NOT_GOOGLE_TEXT = "That isn't a Google Slides link. Copy it from Share, then Copy link.";
export const PUBLISHED_TEXT = "That's a Publish to the web link. In Google Slides use Share, then Copy link, and paste that.";
export const NOT_SHARED_TEXT =
  "Couldn't open that deck. In Google Slides, click Share and set General access to Anyone with the link, then try again.";

/**
 * The file id in a Google Slides link (docs.google.com/presentation/d/<id>/edit and its variants),
 * or an error to show. A Publish to the web link (/d/e/...) is told apart, since it has no id to export.
 */
export function googleSlidesId(input: string): { id: string } | { error: string } {
  const text = input.trim();
  if (/^(?:https?:\/\/)?docs\.google\.com\/presentation\/(?:u\/\d+\/)?d\/e\//i.test(text)) return { error: PUBLISHED_TEXT };
  const match = text.match(/^(?:https?:\/\/)?docs\.google\.com\/presentation\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)(?:[/?#]|$)/i);
  if (!match || !isGoogleSlidesId(match[1])) return { error: NOT_GOOGLE_TEXT };
  return { id: match[1] };
}

/** The deck's name from Google's Content-Disposition, without ".pdf". */
export function nameFromDisposition(header: string | null): string {
  if (!header) return "";
  const star = header.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/);
  let name = "";
  if (star) {
    try {
      name = decodeURIComponent(star[1].trim());
    } catch {
      name = "";
    }
  }
  if (!name) name = header.match(/filename\s*=\s*"([^"]*)"/)?.[1] ?? header.match(/filename\s*=\s*([^;]+)/)?.[1]?.trim() ?? "";
  return name.replace(/\.pdf$/i, "").slice(0, 120);
}
