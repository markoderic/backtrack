export type TextItem = { str: string; transform: number[] };

const SAME_LINE = 2;
const MAX_LENGTH = 200;

// The text on the top line of a PDF page, used as the slide's title.
export function firstLine(items: TextItem[]): string {
  if (items.length === 0) return "";
  const top = Math.max(...items.map((i) => i.transform[5]));
  return items
    .filter((i) => top - i.transform[5] <= SAME_LINE)
    .sort((a, b) => a.transform[4] - b.transform[4])
    .map((i) => i.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LENGTH);
}
