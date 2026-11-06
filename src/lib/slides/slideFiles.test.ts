import { describe, it, expect } from "vitest";
import { KEYNOTE_TEXT, OLD_PPT_TEXT, SLIDES_ACCEPT, SlidesFileError, UNSUPPORTED_TEXT, groupPicked, kindOf, partName } from "./slideFiles";

const file = (name: string, type = "") => new File(["x"], name, { type });

describe("kindOf", () => {
  it("knows each kind by its extension, in any case", () => {
    expect(kindOf(file("a.pdf"))).toBe("pdf");
    expect(kindOf(file("Week 8.PPTX"))).toBe("pptx");
    for (const n of ["a.png", "b.JPG", "c.jpeg", "d.webp"]) expect(kindOf(file(n))).toBe("image");
  });

  it("falls back to the type when the name has no extension", () => {
    expect(kindOf(file("slides", "application/pdf"))).toBe("pdf");
    expect(kindOf(file("deck", "application/vnd.openxmlformats-officedocument.presentationml.presentation"))).toBe("pptx");
    expect(kindOf(file("shot", "image/png"))).toBe("image");
  });

  it("says what to do with an old .ppt, a Keynote file and anything else", () => {
    expect(() => kindOf(file("old.ppt"))).toThrow(OLD_PPT_TEXT);
    expect(() => kindOf(file("talk.key"))).toThrow(KEYNOTE_TEXT);
    expect(() => kindOf(file("notes.docx"))).toThrow(UNSUPPORTED_TEXT);
    expect(() => kindOf(file("notes.docx"))).toThrow(SlidesFileError);
  });

  it("offers every kind in the picker", () => {
    for (const a of [".pdf", ".pptx", ".png", ".jpg", ".jpeg", "image/png", "application/pdf"]) expect(SLIDES_ACCEPT.split(",")).toContain(a);
  });
});

describe("groupPicked", () => {
  it("keeps each PDF and PowerPoint alone and puts the images together, in name order, where the first one was", () => {
    const picked = [file("Slide10.png"), file("intro.pdf"), file("Slide2.png"), file("deck.pptx"), file("Slide1.jpg")];
    const { groups, error } = groupPicked(picked);
    expect(error).toBeNull();
    expect(groups.map((g) => g.map((f) => f.name))).toEqual([["Slide1.jpg", "Slide2.png", "Slide10.png"], ["intro.pdf"], ["deck.pptx"]]);
  });

  it("leaves out files it cannot read and says the first one's message", () => {
    const { groups, error } = groupPicked([file("old.ppt"), file("a.pdf"), file("b.docx")]);
    expect(groups.map((g) => g[0].name)).toEqual(["a.pdf"]);
    expect(error).toBe(OLD_PPT_TEXT);
  });

  it("gives no groups for a pick of only unreadable files", () => {
    expect(groupPicked([file("b.docx")])).toEqual({ groups: [], error: UNSUPPORTED_TEXT });
  });
});

describe("partName", () => {
  it("is the file's name, or a count for a set of images", () => {
    expect(partName([file("Week 8.pdf")])).toBe("Week 8.pdf");
    expect(partName([file("1.png"), file("2.png"), file("3.png")])).toBe("3 images");
  });
});
