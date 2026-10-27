import { describe, it, expect, vi, afterEach } from "vitest";
import {
  currentLectureView,
  DEFAULT_VIEW,
  LECTURE_VIEW_KEY,
  readLectureView,
  subscribeLectureView,
  VIEW_LABEL,
  writeLectureView,
} from "./lectureView";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("lectureView (the student's layout, batch N)", () => {
  it("is Notes for a new student, and the three layouts have the menu's names", () => {
    expect(DEFAULT_VIEW).toBe("notes");
    expect(readLectureView()).toBe("notes");
    expect(VIEW_LABEL).toEqual({ notes: "Notes", slides: "Slides only", classic: "Classic" });
  });

  it("is remembered on this device, and something broken there reads as the default", () => {
    writeLectureView("classic");
    expect(localStorage.getItem(LECTURE_VIEW_KEY)).toBe("classic");
    expect(readLectureView()).toBe("classic");
    writeLectureView("slides");
    expect(currentLectureView()).toBe("slides");
    // Back to the default: nothing kept.
    writeLectureView("notes");
    expect(localStorage.getItem(LECTURE_VIEW_KEY)).toBeNull();
    localStorage.setItem(LECTURE_VIEW_KEY, "sideways");
    expect(readLectureView()).toBe("notes");
  });

  it("tells every screen of the page, and hears another tab", () => {
    const heard = vi.fn();
    const stop = subscribeLectureView(heard);
    writeLectureView("classic");
    expect(heard).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: LECTURE_VIEW_KEY }));
    expect(heard).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new StorageEvent("storage", { key: "something-else" }));
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    writeLectureView("notes");
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("with storage blocked it still switches for this visit (and reads never throw)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readLectureView()).toBe("notes");
    expect(() => writeLectureView("slides")).not.toThrow();
    expect(currentLectureView()).toBe("slides");
  });
});
