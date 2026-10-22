import { describe, it, expect, vi } from "vitest";

// next/font only works inside the Next build.
vi.mock("geist/font/sans", () => ({ GeistSans: { variable: "geist" } }));

import { metadata } from "./layout";

describe("site metadata", () => {
  it("has a real title, a one line description and the production address", () => {
    expect(metadata.title).toEqual({ default: "Backtrack", template: "%s — Backtrack" });
    expect(metadata.description).toBe("Mark the slide where you got lost, come back to it after class.");
    expect(String(metadata.metadataBase)).toBe("https://backtrack.courses/");
  });

  it("asks for a large share card and sets no per lecture image or title", () => {
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
    expect(metadata.openGraph).toMatchObject({ type: "website", siteName: "Backtrack" });
    // The image comes from opengraph-image.png and twitter-image.png; nothing here names a lecture.
    expect(metadata.openGraph).not.toHaveProperty("images");
    expect(metadata.twitter).not.toHaveProperty("images");
  });
});
