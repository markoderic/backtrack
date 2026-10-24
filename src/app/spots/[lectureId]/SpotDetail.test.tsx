import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// from("lost_taps").update(patch).in("id", ids).select("id")
const selectAfter = vi.fn();
const inIds = vi.fn(() => ({ select: selectAfter }));
const update = vi.fn(() => ({ in: inIds }));
const from = vi.fn(() => ({ update }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => ({ from }) }));

const urlFor = (n: number) => `https://signed/${n}.webp`;

import { SpotDetail, type Spot } from "./SpotDetail";

const LECTURE = "11111111-1111-1111-1111-111111111111";
const lostSpot: Spot = { id: "tap-1", ids: ["tap-1"], kind: "lost", slideNumber: 7, note: null, tappedAt: "2026-10-26T14:00:00Z" };

function show(
  o: {
    spot?: Spot;
    students?: number;
    slideCount?: number | null;
    liveSlide?: number | null;
    focusOnOpen?: "heading" | "prev" | "next";
    firstLine?: string;
    onPrevSpot?: () => void;
    onNextSpot?: () => void;
    expired?: boolean;
    noteMax?: number;
  } = {},
) {
  const props = {
    lectureId: LECTURE,
    spot: o.spot ?? lostSpot,
    firstLine: o.firstLine,
    students: o.students ?? 6,
    slideCount: o.slideCount === undefined ? 23 : o.slideCount,
    liveSlide: o.liveSlide ?? null,
    urlFor,
    expired: o.expired,
    onViewingChange: vi.fn(),
    focusOnOpen: o.focusOnOpen,
    onNoteSaved: vi.fn(),
    noteMax: o.noteMax,
    onHighlightSaved: vi.fn(),
    onRemoved: vi.fn(),
    onBack: vi.fn(),
    onPrevSpot: o.onPrevSpot,
    onNextSpot: o.onNextSpot,
  };
  const view = render(<SpotDetail {...props} />);
  return { ...props, ...view };
}

const shownSrc = () => screen.getByRole("img").getAttribute("src");

beforeEach(() => {
  [selectAfter, inIds, update, from].forEach((m) => m.mockClear());
  selectAfter.mockResolvedValue({ data: [{ id: "tap-1" }], error: null });
});

describe("SpotDetail: who got lost", () => {
  it("says how many people got lost on a lost spot", () => {
    show({ students: 6 });
    expect(screen.getByText("6 people got lost here")).toBeInTheDocument();
  });

  it("says 2 people for two", () => {
    show({ students: 2 });
    expect(screen.getByText("2 people got lost here")).toBeInTheDocument();
  });

  it("says only you when it is one student", () => {
    show({ students: 1 });
    expect(screen.getByText("Only you got lost here")).toBeInTheDocument();
    expect(screen.queryByText(/people got lost/)).not.toBeInTheDocument();
  });

  it("says nothing about people when the count is 0", () => {
    show({ students: 0 });
    expect(screen.queryByText(/got lost/)).not.toBeInTheDocument();
  });

  it("a saved spot says people got lost on this slide when anyone did", () => {
    show({ spot: { ...lostSpot, kind: "save" }, students: 4 });
    expect(screen.getByText("4 people got lost on this slide")).toBeInTheDocument();
    expect(screen.queryByText(/Only you/)).not.toBeInTheDocument();
  });

  it("a saved spot says 1 person for one, and nothing for 0", () => {
    const { unmount } = show({ spot: { ...lostSpot, kind: "save" }, students: 1 });
    expect(screen.getByText("1 person got lost on this slide")).toBeInTheDocument();
    unmount();
    show({ spot: { ...lostSpot, kind: "save" }, students: 0 });
    expect(screen.queryByText(/got lost/)).not.toBeInTheDocument();
  });
});

describe("SpotDetail: the page itself", () => {
  it("shows the slide image of the spot", () => {
    show();
    expect(shownSrc()).toBe("https://signed/7.webp");
    expect(screen.getByRole("img")).toHaveAttribute("alt", "Slide 7");
  });

  it("heads the page with the slide number, the slide's first line and when it was marked", () => {
    const at = new Date(2026, 9, 26, 10, 41).toISOString();
    show({ spot: { ...lostSpot, tappedAt: at }, firstLine: "Accrual example: unpaid wages", students: 11 });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Slide 7: Accrual example: unpaid wages");
    expect(screen.getByText("11 people got lost here").parentElement).toHaveTextContent(
      "Lost at 10:41. 11 people got lost here.",
    );
  });

  it("shows the number red for a lost spot and ink for a saved one", () => {
    const { unmount } = show();
    const number = () => document.querySelector("[data-spot-number]")!;
    expect(number()).toHaveTextContent("7");
    expect(number()).toHaveClass("text-lost");
    unmount();
    show({ spot: { ...lostSpot, kind: "save" }, students: 0 });
    expect(number()).toHaveClass("text-ink");
    expect(screen.getByText(/^Saved for later at \d+:\d\d\.$/)).toBeInTheDocument();
  });

  it("uses Slide n as the heading when the slide has no text", () => {
    show();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Slide 7: Slide 7");
  });

  it("has no coming soon text and does not show the slide count", () => {
    const { container } = show({ slideCount: 23 });
    expect(container.textContent).not.toMatch(/coming soon/i);
    expect(container.textContent).not.toMatch(/23/);
  });
});

describe("SpotDetail: no Move to slide", () => {
  it("offers no Move to slide (the spot stays on the slide it was made on) and never changes slide_number", () => {
    show();
    expect(screen.queryByRole("button", { name: /Move to slide/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Move/)).not.toBeInTheDocument();
    for (const b of screen.getAllByRole("button")) fireEvent.click(b);
    for (const call of update.mock.calls as unknown as [Record<string, unknown>][]) expect(call[0]).not.toHaveProperty("slide_number");
  });
});

describe("SpotDetail: Back to lecture", () => {
  it("while the lecture is live, a black Back to lecture goes back into class", () => {
    show({ liveSlide: 12 });
    const back = screen.getByRole("link", { name: "Back to lecture" });
    expect(back).toHaveAttribute("href", `/l/${LECTURE}`);
    expect(back.className).toContain("bg-ink");
    expect(back.className).toContain("text-surface");
    expect(back.className).not.toContain("bg-surface");
  });

  it("is not there once the lecture has ended", () => {
    show({ liveSlide: null });
    expect(screen.queryByRole("link", { name: "Back to lecture" })).not.toBeInTheDocument();
  });
});

describe("SpotDetail: every button on screen", () => {
  it("sizes the slide to the window's height, so the buttons under it stay on screen", () => {
    const { container } = show();
    const frame = container.querySelector("[data-spot-slide]") as HTMLElement;
    expect(frame.style.width).toContain("100dvh");
    expect(frame.style.width).toContain("var(--spot-room)");
    // The room kept for the rest: two rows of buttons on a phone, one from 640, beside the slide from 1024.
    const main = screen.getByRole("main");
    for (const room of ["[--spot-room:352px]", "sm:[--spot-room:300px]", "lg:[--spot-room:236px]"]) expect(main.className).toContain(room);
  });

  it("while a note is being written, keeps more room under the slide so Save note and Cancel stay on screen", () => {
    show();
    const main = screen.getByRole("main");
    expect(main).not.toHaveAttribute("data-editing");
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    expect(main).toHaveAttribute("data-editing");
    for (const room of ["data-editing:[--spot-room:532px]", "sm:data-editing:[--spot-room:488px]", "lg:data-editing:[--spot-room:236px]"])
      expect(main.className).toContain(room);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(main).not.toHaveAttribute("data-editing");
  });

  it("puts the buttons right after the slide (beside it on a wide screen), before the note", () => {
    const { container } = show({ spot: { ...lostSpot, note: "a long note" } });
    const actions = container.querySelector("[data-spot-actions]") as HTMLElement;
    const note = container.querySelector("[data-note]") as HTMLElement;
    expect(actions.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const side = container.querySelector("[data-spot-side]") as HTMLElement;
    expect(side).toContainElement(actions);
    expect(side.className).toContain("lg:w-80");
    expect(side.parentElement!.className).toContain("lg:flex-row");
  });

  it("takes the slide's own shape from the image", () => {
    const { container } = show();
    const img = screen.getByRole("img") as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", { value: 1024, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 768, configurable: true });
    fireEvent.load(img);
    const frame = container.querySelector("[data-spot-slide]") as HTMLElement;
    expect(frame.style.width).toContain("* 1.3333");
  });
});

describe("SpotDetail: previous and next slide", () => {
  it("browses the slides without moving the marker", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(shownSrc()).toBe("https://signed/8.webp");
    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    expect(shownSrc()).toBe("https://signed/6.webp");
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByText("6 people got lost here")).toBeInTheDocument();
  });

  it("previous is disabled on slide 1", () => {
    show({ spot: { ...lostSpot, slideNumber: 1 } });
    expect(screen.getByRole("button", { name: "Previous slide" })).toBeDisabled();
  });

  it("next is disabled on the last slide", () => {
    show({ spot: { ...lostSpot, slideNumber: 9 }, slideCount: 9 });
    expect(screen.getByRole("button", { name: "Next slide" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous slide" })).toBeEnabled();
  });

  it("while the lecture is live, next stops at the live slide, never past it (D10)", () => {
    show({ liveSlide: 8, slideCount: 23 });
    const next = () => screen.getByRole("button", { name: "Next slide" });
    expect(next()).toBeEnabled();
    fireEvent.click(next());
    expect(shownSrc()).toBe("https://signed/8.webp");
    expect(next()).toBeDisabled();
    fireEvent.click(next());
    expect(shownSrc()).toBe("https://signed/8.webp");
  });

  it("a later live slide opens the next arrow again, up to the new live slide", () => {
    const props = show({ liveSlide: 7, slideCount: null });
    const next = () => screen.getByRole("button", { name: "Next slide" });
    expect(next()).toBeDisabled();
    props.rerender(<SpotDetail {...props} liveSlide={9} />);
    fireEvent.click(next());
    fireEvent.click(next());
    expect(shownSrc()).toBe("https://signed/9.webp");
    expect(next()).toBeDisabled();
  });

  it("when the teacher goes back below the slide on screen, the view stays and next stays off", () => {
    const props = show({ liveSlide: 9, slideCount: null });
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    props.rerender(<SpotDetail {...props} liveSlide={6} />);
    expect(shownSrc()).toBe("https://signed/8.webp");
    expect(screen.getByRole("button", { name: "Next slide" })).toBeDisabled();
  });

  it("on the live slide itself, next is disabled at once", () => {
    show({ liveSlide: 7, slideCount: 23 });
    expect(screen.getByRole("button", { name: "Next slide" })).toBeDisabled();
  });

  it("after the lecture ended, next goes on to the last slide", () => {
    show({ liveSlide: null, slideCount: 9 });
    const next = () => screen.getByRole("button", { name: "Next slide" });
    fireEvent.click(next());
    fireEvent.click(next());
    expect(shownSrc()).toBe("https://signed/9.webp");
    expect(next()).toBeDisabled();
  });

  it("tells the page the slide on screen, so the page preloads the next one", () => {
    const { onViewingChange } = show();
    expect(onViewingChange).toHaveBeenLastCalledWith(7);
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(onViewingChange).toHaveBeenLastCalledWith(8);
  });

  it("can come back to the marked slide after browsing away", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to slide 7" }));
    expect(shownSrc()).toBe("https://signed/7.webp");
    expect(screen.queryByRole("button", { name: /Back to slide/ })).not.toBeInTheDocument();
  });
});

describe("SpotDetail: the note", () => {
  const input = () => screen.getByLabelText("Your note") as HTMLTextAreaElement;
  const send = () => fireEvent.submit(input().form!);

  it("shows the note in Geist (not italic Newsreader) under a divider, and its field limits it to 140 characters", () => {
    show({ spot: { ...lostSpot, note: "the proof step" } });
    expect(screen.getByText("the proof step")).toBeInTheDocument();
    expect(screen.getByText("the proof step")).toHaveClass("type-body");
    expect(screen.getByText("the proof step").className).not.toContain("type-note");
    expect(screen.getByText("the proof step").closest("[data-note]")).toHaveClass("border-t");
    expect(screen.queryByLabelText("Your note")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
    expect(input()).toHaveValue("the proof step");
    expect(input()).toHaveAttribute("maxlength", "140");
    expect(input().tagName).toBe("TEXTAREA");
    expect(input()).toHaveAttribute("rows", "3");
    expect(input()).toHaveFocus();
  });

  it("Add a note is a white button, and the field has Save note and Cancel buttons", () => {
    show();
    const add = screen.getByRole("button", { name: "Add a note" });
    expect(add.className).toContain("bg-surface");
    expect(add.className).not.toMatch(/(^|\s)underline(\s|$)/);
    fireEvent.click(add);
    expect(screen.getByRole("button", { name: "Save note" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Your note")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a note" })).toHaveFocus();
  });

  it("Enter saves, Shift+Enter does not", async () => {
    const { onNoteSaved } = show();
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    fireEvent.change(input(), { target: { value: "line one" } });
    fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });
    expect(update).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(onNoteSaved).toHaveBeenCalledWith("line one"));
  });

  it("shows a quiet counter only near the limit", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    fireEvent.change(input(), { target: { value: "a".repeat(100) } });
    expect(document.querySelector("[data-counter]")).toBeNull();
    fireEvent.change(input(), { target: { value: "a".repeat(130) } });
    expect(document.querySelector("[data-counter]")).toHaveTextContent("10 left");
  });

  it("takes up to 2000 characters once the database has 0020 (noteMax), and saves them all", async () => {
    const { onNoteSaved } = show({ noteMax: 2000 });
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    expect(input()).toHaveAttribute("maxlength", "2000");
    const long = "b".repeat(600);
    fireEvent.change(input(), { target: { value: long } });
    expect(input()).toHaveValue(long);
    expect(document.querySelector("[data-counter]")).toBeNull();
    fireEvent.change(input(), { target: { value: "b".repeat(1990) } });
    expect(document.querySelector("[data-counter]")).toHaveTextContent("10 left");
    fireEvent.change(input(), { target: { value: long } });
    send();
    await waitFor(() => expect(onNoteSaved).toHaveBeenCalledWith(long));
    expect(update).toHaveBeenCalledWith({ note: long });
  });

  it("cuts a note at 140 while the database is still on the old limit (no noteMax)", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    fireEvent.change(input(), { target: { value: "c".repeat(600) } });
    expect(input().value).toHaveLength(140);
  });

  it("offers Add a note when there is none", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    expect(input()).toHaveValue("");
  });

  it("Enter saves a changed note to the row and reports it", async () => {
    const { onNoteSaved } = show();
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    fireEvent.change(input(), { target: { value: "ask about step 2" } });
    send();
    await waitFor(() => expect(onNoteSaved).toHaveBeenCalledWith("ask about step 2"));
    expect(update).toHaveBeenCalledWith({ note: "ask about step 2" });
    expect(inIds).toHaveBeenCalledWith("id", ["tap-1"]);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Note saved."));
    expect(screen.queryByLabelText("Your note")).not.toBeInTheDocument();
  });

  it("Enter on an unchanged note sends nothing and closes the field", () => {
    show({ spot: { ...lostSpot, note: "old" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
    send();
    expect(update).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Your note")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit note" })).toHaveFocus();
  });

  it("Esc drops what was typed", () => {
    show({ spot: { ...lostSpot, note: "old" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
    fireEvent.change(input(), { target: { value: "new words" } });
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByText("old")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
    expect(input()).toHaveValue("old");
  });

  it("saves an emptied note as no note", async () => {
    const { onNoteSaved } = show({ spot: { ...lostSpot, note: "old" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
    fireEvent.change(input(), { target: { value: "   " } });
    send();
    await waitFor(() => expect(onNoteSaved).toHaveBeenCalledWith(null));
    expect(update).toHaveBeenCalledWith({ note: null });
  });

  it("a new note goes on the main row; an emptied one clears the notes of every row on the slide", async () => {
    const spot: Spot = { ...lostSpot, ids: ["tap-0", "tap-1"], note: "old" };
    show({ spot });
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
    fireEvent.change(input(), { target: { value: "new" } });
    send();
    await waitFor(() => expect(inIds).toHaveBeenCalledWith("id", ["tap-1"]));
    fireEvent.click(await screen.findByRole("button", { name: "Edit note" }));
    selectAfter.mockResolvedValue({ data: [{ id: "tap-0" }, { id: "tap-1" }], error: null });
    fireEvent.change(input(), { target: { value: "" } });
    send();
    await waitFor(() => expect(inIds).toHaveBeenLastCalledWith("id", ["tap-0", "tap-1"]));
    expect(update).toHaveBeenLastCalledWith({ note: null });
  });

  it("shows the error plainly and keeps what was typed", async () => {
    selectAfter.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { onNoteSaved } = show();
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    fireEvent.change(input(), { target: { value: "keep me" } });
    send();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the note");
    expect(onNoteSaved).not.toHaveBeenCalled();
    expect(input()).toHaveValue("keep me");
  });
});

describe("SpotDetail: remove", () => {
  it("every action is a white button, never underlined text", () => {
    show();
    const names = ["Add a note", "Mark the spot", "Remove"];
    for (const name of names) {
      const b = screen.getByRole("button", { name });
      expect(b.className, name).toContain("bg-surface");
      expect(b.className, name).not.toMatch(/(^|\s)underline(\s|$)/);
    }
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    for (const name of ["Yes, remove", "Keep it"]) {
      expect(screen.getByRole("button", { name }).className, name).toContain("bg-surface");
    }
  });

  it("asks once, inline, then marks the row undone and reports it", async () => {
    const { onRemoved } = show();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByText("Remove this spot?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith({ undone: true });
    expect(inIds).toHaveBeenCalledWith("id", ["tap-1"]);
  });

  it("Keep it leaves the spot alone", () => {
    const { onRemoved } = show();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(update).not.toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("removes every row on the slide (an older lecture can hold two)", async () => {
    selectAfter.mockResolvedValue({ data: [{ id: "tap-0" }, { id: "tap-1" }], error: null });
    const { onRemoved } = show({ spot: { ...lostSpot, ids: ["tap-0", "tap-1"] } });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
    expect(inIds).toHaveBeenCalledWith("id", ["tap-0", "tap-1"]);
  });

  it("takes it as a failure when only some of the rows changed", async () => {
    selectAfter.mockResolvedValue({ data: [{ id: "tap-1" }], error: null });
    const { onRemoved } = show({ spot: { ...lostSpot, ids: ["tap-0", "tap-1"] } });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not remove the spot");
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("says plainly when the database refuses", async () => {
    selectAfter.mockResolvedValue({ data: [], error: null });
    const { onRemoved } = show();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not remove the spot");
    expect(onRemoved).not.toHaveBeenCalled();
  });
});

describe("SpotDetail: keyboard focus", () => {
  it("lands on the spot arrow that was used, or the heading when that arrow is at its end", () => {
    const { unmount } = show({ focusOnOpen: "next", onNextSpot: vi.fn() });
    expect(screen.getByRole("button", { name: "Next spot" })).toHaveFocus();
    unmount();
    show({ focusOnOpen: "next" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
  });

  it("lands on the heading when the spot was opened from the list", () => {
    show({ focusOnOpen: "heading" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
  });

  it("goes to Keep it when Remove asks, and back to Remove on Keep it", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByRole("button", { name: "Keep it" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.getByRole("button", { name: "Remove" })).toHaveFocus();
  });

  it("goes back to Mark the spot when Esc stops marking", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Mark the spot" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Mark the spot" })).toHaveFocus();
  });
});

describe("SpotDetail: previous and next spot", () => {
  it("are white buttons like My spots, with words on a wide screen", () => {
    show({ onNextSpot: vi.fn() });
    for (const name of ["Previous spot", "Next spot"]) {
      const b = screen.getByRole("button", { name });
      expect(b.className, name).toContain("bg-surface");
      expect(b.className, name).toContain("border-hairline");
      expect(b.className, name).toContain("type-button");
      expect(b).toHaveTextContent(name);
    }
    // The 16 px gutter on both sides of the top bar.
    expect(screen.getByRole("button", { name: "Next spot" }).parentElement).toHaveClass("px-4");
  });

  it("are disabled at the ends and open the spot next to this one", () => {
    const onNextSpot = vi.fn();
    show({ onNextSpot });
    expect(screen.getByRole("button", { name: "Previous spot" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next spot" }));
    expect(onNextSpot).toHaveBeenCalledTimes(1);
  });
});

describe("SpotDetail: leaving", () => {
  it("has a 44 px back arrow at the top left, back to the list", () => {
    const { onBack } = show();
    const back = screen.getByRole("button", { name: "Back to My spots" });
    expect(back).toHaveClass("size-11");
    expect(back.parentElement?.firstElementChild).toBe(back);
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("SpotDetail: the mark", () => {
  const RECT = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
  const withRect: Spot = { ...lostSpot, rect: RECT };
  const mouse = { pointerType: "mouse", button: 0, pointerId: 1 };
  const boxes = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>("[data-highlight-box]"));
  const layer = () => document.querySelector("[data-highlight-layer]") as HTMLElement;
  const markButton = (name = "Mark the spot") => screen.getByRole("button", { name });
  // A drag from (500, 250) to (900, 450) on the 1000 x 500 slide.
  function drag(from: [number, number] = [500, 250], to: [number, number] = [900, 450], o = mouse) {
    fireEvent.pointerDown(layer(), { ...o, clientX: from[0], clientY: from[1] });
    fireEvent.pointerMove(layer(), { ...o, clientX: to[0], clientY: to[1] });
    fireEvent.pointerUp(layer(), { ...o, clientX: to[0], clientY: to[1] });
  }

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: 1000, bottom: 500, x: 0, y: 0, width: 1000, height: 500, toJSON: () => ({}),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws the spot's mark over the slide image", () => {
    const { container } = show({ spot: withRect });
    const [box] = boxes(container);
    expect(boxes(container)).toHaveLength(1);
    expect(box.style.left).toBe("10%");
    expect(box.style.top).toBe("20%");
    expect(box.style.width).toBe("30%");
    expect(box.style.height).toBe("40%");
    expect(screen.getByRole("img").parentElement?.contains(box)).toBe(true);
  });

  it("draws the mark of a saved spot too, and nothing when there is none", () => {
    const { container, unmount } = show({ spot: { ...withRect, kind: "save" } });
    expect(boxes(container)).toHaveLength(1);
    unmount();
    const again = show();
    expect(boxes(again.container)).toHaveLength(0);
  });

  it("shows the mark and Mark the spot only on the spot's slide", () => {
    const { container } = show({ spot: withRect });
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(boxes(container)).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /mark/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to slide 7" }));
    expect(boxes(container)).toHaveLength(1);
    expect(markButton("Clear mark")).toBeInTheDocument();
  });

  it("the slide takes no drag until Mark the spot is pressed (no Keep highlight step)", () => {
    show();
    drag();
    expect(update).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Keep highlight" })).not.toBeInTheDocument();
  });

  it("Mark the spot, then a drag, saves the box at once on the main row", async () => {
    const { onHighlightSaved, container } = show();
    fireEvent.click(markButton());
    expect(markButton("Stop marking")).toHaveAttribute("aria-pressed", "true");
    drag();
    await waitFor(() => expect(onHighlightSaved).toHaveBeenCalledWith({ x: 0.5, y: 0.5, w: 0.4, h: 0.4 }));
    expect(update).toHaveBeenCalledWith({ hl_x: 0.5, hl_y: 0.5, hl_w: 0.4, hl_h: 0.4 });
    expect(inIds).toHaveBeenCalledWith("id", ["tap-1"]);
    expect(boxes(container)).toHaveLength(1);
    expect(markButton("Clear mark")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Spot marked.");
  });

  it("a finger can drag once Mark the spot is on", async () => {
    const { onHighlightSaved } = show();
    fireEvent.click(markButton());
    drag(undefined, undefined, { pointerType: "touch", button: 0, pointerId: 2 });
    await waitFor(() => expect(onHighlightSaved).toHaveBeenCalled());
  });

  it("Clear mark takes the mark off every row on the slide", async () => {
    selectAfter.mockResolvedValue({ data: [{ id: "tap-0" }, { id: "tap-1" }], error: null });
    const { onHighlightSaved, container } = show({ spot: { ...withRect, ids: ["tap-0", "tap-1"] } });
    fireEvent.click(markButton("Clear mark"));
    await waitFor(() => expect(onHighlightSaved).toHaveBeenCalledWith(null));
    expect(update).toHaveBeenCalledWith({ hl_x: null, hl_y: null, hl_w: null, hl_h: null });
    expect(inIds).toHaveBeenCalledWith("id", ["tap-0", "tap-1"]);
    expect(boxes(container)).toHaveLength(0);
    expect(markButton()).toBeInTheDocument();
  });

  it("a click on the slide saves nothing and leaves marking on", () => {
    show();
    fireEvent.click(markButton());
    drag([500, 250], [501, 251]);
    expect(update).not.toHaveBeenCalled();
    expect(markButton("Stop marking")).toBeInTheDocument();
  });

  it("Stop marking and Esc both end marking without saving", () => {
    show();
    fireEvent.click(markButton());
    fireEvent.click(markButton("Stop marking"));
    expect(markButton()).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(markButton());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(markButton()).toBeInTheDocument();
    drag();
    expect(update).not.toHaveBeenCalled();
  });

  it("says plainly when the database refuses, and keeps the old mark", async () => {
    selectAfter.mockResolvedValue({ data: null, error: { message: "nope" } });
    const { onHighlightSaved, container } = show({ spot: withRect });
    fireEvent.click(markButton("Clear mark"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the mark");
    expect(onHighlightSaved).not.toHaveBeenCalled();
    expect(boxes(container)).toHaveLength(1);
  });

  it("treats an update that changed no row as a failure", async () => {
    selectAfter.mockResolvedValue({ data: [], error: null });
    const { onHighlightSaved } = show();
    fireEvent.click(markButton());
    drag();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the mark");
    expect(onHighlightSaved).not.toHaveBeenCalled();
  });
});

describe("SpotDetail: a slide that is no longer available", () => {
  it("says so in place of the slide, and keeps the note, the count and Remove", () => {
    show({ spot: { ...lostSpot, note: "my note" }, expired: true });
    expect(screen.getByText("This slide is no longer available.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("my note")).toBeInTheDocument();
    expect(screen.getByText("6 people got lost here")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit note" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    // Nothing to browse or mark without the slide.
    expect(screen.queryByRole("button", { name: "Next slide" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark/i })).not.toBeInTheDocument();
  });
});
