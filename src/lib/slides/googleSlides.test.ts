import { describe, it, expect } from "vitest";
import { NOT_GOOGLE_TEXT, PUBLISHED_TEXT, googleSlidesId, isGoogleSlidesId, nameFromDisposition } from "./googleSlides";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-ab";

describe("googleSlidesId", () => {
  it("finds the id in the usual share and edit links", () => {
    for (const link of [
      `https://docs.google.com/presentation/d/${ID}/edit?usp=sharing`,
      `https://docs.google.com/presentation/d/${ID}/edit#slide=id.p1`,
      `https://docs.google.com/presentation/d/${ID}`,
      `docs.google.com/presentation/d/${ID}/view`,
      `  https://docs.google.com/presentation/u/1/d/${ID}/edit  `,
    ]) {
      expect(googleSlidesId(link)).toEqual({ id: ID });
    }
  });

  it("tells a Publish to the web link apart", () => {
    expect(googleSlidesId("https://docs.google.com/presentation/d/e/2PACX-1vQabc/pub?start=false")).toEqual({ error: PUBLISHED_TEXT });
  });

  it("refuses anything that is not a Google Slides link", () => {
    for (const link of [
      "",
      "https://example.com/presentation/d/" + ID,
      `https://docs.google.com/document/d/${ID}/edit`,
      "https://docs.google.com/presentation/d/short/edit",
      `https://docs.google.com.evil.com/presentation/d/${ID}`,
    ]) {
      expect(googleSlidesId(link)).toEqual({ error: NOT_GOOGLE_TEXT });
    }
  });

  it("isGoogleSlidesId only takes id characters", () => {
    expect(isGoogleSlidesId(ID)).toBe(true);
    expect(isGoogleSlidesId("../../etc/passwd")).toBe(false);
    expect(isGoogleSlidesId(`${ID}/x`)).toBe(false);
  });
});

describe("nameFromDisposition", () => {
  it("reads the plain and the UTF-8 file name, without .pdf", () => {
    expect(nameFromDisposition('attachment; filename="Week 8.pdf"')).toBe("Week 8");
    expect(nameFromDisposition("attachment; filename=\"x.pdf\"; filename*=UTF-8''Caf%C3%A9%20slides.pdf")).toBe("Café slides");
    expect(nameFromDisposition(null)).toBe("");
  });
});
