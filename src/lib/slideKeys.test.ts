import { describe, it, expect } from "vitest";
import { slideKeyAction, clampSlide } from "./slideKeys";

const press = (
  key: string,
  extra: Partial<{
    repeat: boolean;
    target: EventTarget | null;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  }> = {},
) =>
  slideKeyAction({ key, repeat: false, target: null, ...extra });

describe("slideKeyAction", () => {
  it.each(["ArrowRight", "PageDown", " "])("%j is next", (key) => {
    expect(press(key)).toBe("next");
  });

  it.each(["ArrowLeft", "PageUp"])("%j is prev", (key) => {
    expect(press(key)).toBe("prev");
  });

  it.each(["d", "D", "Escape", "n", "p", "b", ".", "x", "Enter", "j", "f"])("%j does nothing (no key binds)", (key) => {
    expect(press(key)).toBeNull();
  });

  it("is null for a repeated key", () => {
    expect(press("ArrowRight", { repeat: true })).toBeNull();
  });

  it("is null when the target is an input", () => {
    expect(press("ArrowRight", { target: document.createElement("input") })).toBeNull();
  });

  it("is null when the target is a textarea", () => {
    expect(press("ArrowRight", { target: document.createElement("textarea") })).toBeNull();
  });

  it("is null when the target is contentEditable", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    expect(press("ArrowRight", { target: div })).toBeNull();
  });

  it("still works when the target is a plain element", () => {
    expect(press("ArrowRight", { target: document.createElement("div") })).toBe("next");
  });
});

describe("slideKeyAction with modifier keys", () => {
  it("ignores Cmd+ArrowRight", () => {
    expect(press("ArrowRight", { metaKey: true })).toBeNull();
  });
  it("ignores Ctrl+ArrowRight", () => {
    expect(press("ArrowRight", { ctrlKey: true })).toBeNull();
  });
  it("ignores Alt+ArrowLeft", () => {
    expect(press("ArrowLeft", { altKey: true })).toBeNull();
  });
  it("ignores Ctrl+Space and Meta+PageDown", () => {
    expect(press(" ", { ctrlKey: true })).toBeNull();
    expect(press("PageDown", { metaKey: true })).toBeNull();
  });
  it("ignores a combo with several modifiers", () => {
    expect(press("ArrowRight", { metaKey: true, shiftKey: true })).toBeNull();
  });
  it("still works with the modifier flags set to false", () => {
    expect(press("ArrowRight", { metaKey: false, ctrlKey: false, altKey: false })).toBe("next");
    expect(press("PageUp", { metaKey: false, ctrlKey: false, altKey: false })).toBe("prev");
  });
  it("still works with no modifier flags at all", () => {
    expect(press("ArrowRight")).toBe("next");
    expect(press("ArrowLeft")).toBe("prev");
  });
  it("lets Shift+Space through as next", () => {
    expect(press(" ", { shiftKey: true })).toBe("next");
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
