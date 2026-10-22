/** The header of the semester export (spec: one row per slide per lecture). */
export const CSV_HEADER = ["Date", "Lecture", "Slide", "First line of slide", "Lost taps", "Different students"];

const BOM = "﻿";

// RFC 4180: a field with a comma, quote or line break is wrapped in quotes and its quotes are doubled.
// A text cell that starts with = + - @ (or a tab or carriage return) is read as a formula by
// Excel, Numbers and Sheets, so it gets a leading apostrophe. Numbers are written as they are.
const FORMULA_START = /^[=+\-@\t\r]/;

function field(value: string | number): string {
  const raw = String(value);
  const text = typeof value === "string" && FORMULA_START.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV text with CRLF line endings and a UTF 8 BOM, so Excel and Numbers show accents right. */
export function toCsv(header: string[], rows: (string | number)[][]): string {
  const lines = [header, ...rows].map((row) => row.map(field).join(","));
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

/** "<course name> semester.csv", with what would break a header or a file name taken out. */
export function csvFileName(courseName: string): string {
  const clean = courseName
    .replace(/\t/g, " ")
    .replace(/["\\/\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? `${clean} semester.csv` : "semester.csv";
}

// RFC 5987 attr-char leaves out ' ( ) * which encodeURIComponent does not escape.
const pct = (s: string) =>
  encodeURIComponent(s).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * A Content-Disposition for a download: a plain ASCII filename for old clients and
 * filename* (UTF-8) for everyone else, so accented course names survive.
 */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/["\\%]/g, "_")
    .replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${pct(fileName)}`;
}
