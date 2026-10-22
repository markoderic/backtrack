import { describe, it, expect } from "vitest";
import { slideKeyAction, clampSlide } from "./slideKeys";

const press = (key: string, extra: Partial<{ repeat: boolean; target: EventTarget | null }> = {}) =>
  slideKeyAction({ key, repeat: false, target: null, ...extra });

describe("slideKeyAction", () => {
  it.each(["ArrowRight", "PageDown", " ", ".", "n"])("%j is next", (key) => {
    expect(press(key)).toBe("next");
  });

  it.each(["ArrowLeft", "PageUp", "b", "p"])("%j is prev", (key) => {
    expect(press(key)).toBe("prev");
  });

  it.each(["d", "D"])("%j is data", (key) => {
    expect(press(key)).toBe("data");
  });

  it("Escape is close", () => {
    expect(press("Escape")).toBe("close");
  });

  it("is null for any other key", () => {
    expect(press("x")).toBeNull();
    expect(press("Enter")).toBeNull();
  });

  it("is null for a repeated key", () => {
    expect(press("ArrowRight", { repeat: true })).toBeNull();
  });

  it("is null when the target is an input", () => {
    expect(press("n", { target: document.createElement("input") })).toBeNull();
  });

  it("is null when the target is a textarea", () => {
    expect(press("n", { target: document.createElement("textarea") })).toBeNull();
  });

  it("is null when the target is contentEditable", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    expect(press("n", { target: div })).toBeNull();
  });

  it("still works when the target is a plain element", () => {
    expect(press("n", { target: document.createElement("div") })).toBe("next");
  });
});

describe("clampSlide", () => {
  it("clamps above the count", () => {
    expect(clampSlide(11, 10)).toBe(10);
  });
  it("clamps below 1", () => {
    expect(clampSlide(0, 10)).toBe(1);
  });
  it("leaves a slide in range alone", () => {
    expect(clampSlide(4, 10)).toBe(4);
  });
});
