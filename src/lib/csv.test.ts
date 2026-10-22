import { describe, it, expect } from "vitest";
import { toCsv, CSV_HEADER, csvFileName, attachmentDisposition } from "./csv";

const BOM = "﻿";

describe("toCsv", () => {
  it("starts with a UTF 8 BOM so Excel reads accented names", () => {
    expect(toCsv(["A"], [["José"]]).startsWith(BOM)).toBe(true);
  });

  it("separates lines with CRLF and writes the header first", () => {
    expect(toCsv(["A", "B"], [[1, "x"], [2, "y"]])).toBe(`${BOM}A,B\r\n1,x\r\n2,y\r\n`);
  });

  it("writes only the header when there are no rows", () => {
    expect(toCsv(["A", "B"], [])).toBe(`${BOM}A,B\r\n`);
  });

  it("quotes a field with a comma", () => {
    expect(toCsv(["A"], [["a,b"]])).toBe(`${BOM}A\r\n"a,b"\r\n`);
  });

  it("quotes a field with a quote and doubles the quotes", () => {
    expect(toCsv(["A"], [[`What's "accrual", anyway`]])).toBe(`${BOM}A\r\n"What's ""accrual"", anyway"\r\n`);
  });

  it("keeps a newline inside quotes", () => {
    expect(toCsv(["A"], [["line one\nline two"]])).toBe(`${BOM}A\r\n"line one\nline two"\r\n`);
    expect(toCsv(["A"], [["a\rb"]])).toBe(`${BOM}A\r\n"a\rb"\r\n`);
  });

  it("quotes header fields the same way", () => {
    expect(toCsv(["A,B"], [])).toBe(`${BOM}"A,B"\r\n`);
  });

  it("leaves plain fields and numbers alone, zero included", () => {
    expect(toCsv(["A", "B"], [["plain text", 0]])).toBe(`${BOM}A,B\r\nplain text,0\r\n`);
  });

  it("writes an empty string as an empty field", () => {
    expect(toCsv(["A", "B"], [["", 3]])).toBe(`${BOM}A,B\r\n,3\r\n`);
  });
});

describe("CSV_HEADER", () => {
  it("is the header the spec asks for", () => {
    expect(CSV_HEADER.join(",")).toBe("Date,Lecture,Slide,First line of slide,Lost taps,Different students");
  });
});

describe("csvFileName", () => {
  it("is the course name plus ' semester.csv'", () => {
    expect(csvFileName("IMS 452")).toBe("IMS 452 semester.csv");
  });

  it("strips quotes, backslashes, slashes and line breaks", () => {
    expect(csvFileName('A"B\\C/D\r\nE')).toBe("ABCDE semester.csv");
  });

  it("strips other control characters and squeezes spaces", () => {
    expect(csvFileName("  ACC\t 221\u0000  ")).toBe("ACC 221 semester.csv");
  });

  it("falls back to 'semester.csv' when nothing is left", () => {
    expect(csvFileName('"/\\')).toBe("semester.csv");
    expect(csvFileName("")).toBe("semester.csv");
  });

  it("keeps accented letters", () => {
    expect(csvFileName("Contabilidad Ávila")).toBe("Contabilidad Ávila semester.csv");
  });
});

describe("attachmentDisposition", () => {
  it("gives a plain ASCII filename and an equal filename*", () => {
    expect(attachmentDisposition("IMS 452 semester.csv")).toBe(
      `attachment; filename="IMS 452 semester.csv"; filename*=UTF-8''IMS%20452%20semester.csv`,
    );
  });

  it("gives accented names an ASCII fallback and a UTF-8 filename*", () => {
    const h = attachmentDisposition("Contabilidad Ávila semester.csv");
    expect(h).toContain('filename="Contabilidad Avila semester.csv"');
    expect(h).toContain("filename*=UTF-8''Contabilidad%20%C3%81vila%20semester.csv");
  });

  it("replaces characters with no ASCII form by an underscore in the fallback", () => {
    const h = attachmentDisposition("会計 semester.csv");
    expect(h).toContain('filename="__ semester.csv"');
    expect(h).toContain("filename*=UTF-8''%E4%BC%9A%E8%A8%88%20semester.csv");
  });

  it("escapes the characters RFC 5987 does not allow in filename*", () => {
    expect(attachmentDisposition("a'b(c)*.csv")).toContain("filename*=UTF-8''a%27b%28c%29%2A.csv");
  });

  it("never lets a quote, backslash or percent into the quoted fallback", () => {
    const h = attachmentDisposition('a"b\\c%d.csv');
    expect(h).toContain('filename="a_b_c_d.csv"');
  });
});
