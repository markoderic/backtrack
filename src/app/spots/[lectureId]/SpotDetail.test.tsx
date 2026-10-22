import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// from("lost_taps").update(patch).eq("id", id).select("id")
const selectAfter = vi.fn();
const eq = vi.fn(() => ({ select: selectAfter }));
const update = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ update }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => ({ from }) }));

const urlFor = (n: number) => `https://signed/${n}.webp`;

import { SpotDetail, type Spot } from "./SpotDetail";

const LECTURE = "11111111-1111-1111-1111-111111111111";
const lostSpot: Spot = { id: "tap-1", kind: "lost", slideNumber: 7, note: null, tappedAt: "2026-10-26T14:00:00Z" };

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
    onViewingChange: vi.fn(),
    focusOnOpen: o.focusOnOpen,
    onNoteSaved: vi.fn(),
    onHighlightSaved: vi.fn(),
    onMoved: vi.fn(async () => {}),
    onRemoved: vi.fn(),
    onBack: vi.fn(),
    onPrevSpot: o.onPrevSpot,
    onNextSpot: o.onNextSpot,
  };
  const view = render(<SpotDetail {...props} />);
  return { ...props, ...view };
}

const move = () => screen.getByRole("button", { name: "Move to slide 6" });
const shownSrc = () => screen.getByRole("img").getAttribute("src");

beforeEach(() => {
  [selectAfter, eq, update, from].forEach((m) => m.mockClear());
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

describe("SpotDetail: move the marker", () => {
  it("updates slide_number to one less, for the right row, then reports the move", async () => {
    const { onMoved } = show();
    fireEvent.click(move());
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith(6));
    expect(from).toHaveBeenCalledWith("lost_taps");
    expect(update).toHaveBeenCalledWith({ slide_number: 6 });
    expect(eq).toHaveBeenCalledWith("id", "tap-1");
  });

  it("shows the slide the marker moved to", async () => {
    show();
    fireEvent.click(move());
    await waitFor(() => expect(shownSrc()).toBe("https://signed/6.webp"));
  });

  it("is not offered on slide 1", () => {
    show({ spot: { ...lostSpot, slideNumber: 1 } });
    expect(screen.queryByRole("button", { name: /Move to slide/ })).not.toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("says plainly when the database refuses, and does not report a move", async () => {
    selectAfter.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const { onMoved } = show();
    fireEvent.click(move());
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not move the marker");
    expect(onMoved).not.toHaveBeenCalled();
    expect(shownSrc()).toBe("https://signed/7.webp");
    expect(move()).toBeEnabled();
  });

  it("treats an update that changed no row as a failure", async () => {
    selectAfter.mockResolvedValue({ data: [], error: null });
    const { onMoved } = show();
    fireEvent.click(move());
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not move the marker");
    expect(onMoved).not.toHaveBeenCalled();
  });

  it("can not be pressed twice while it is saving", async () => {
    let finish!: (v: unknown) => void;
    selectAfter.mockReturnValue(new Promise((r) => (finish = r)));
    show();
    fireEvent.click(move());
    expect(move()).toBeDisabled();
    fireEvent.click(move());
    expect(update).toHaveBeenCalledTimes(1);
    finish({ data: [{ id: "tap-1" }], error: null });
    await waitFor(() => expect(move()).toBeEnabled());
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
  const input = () => screen.getByLabelText("Your note") as HTMLInputElement;
  const send = () => fireEvent.submit(input().form!);

  it("shows the note, and its field limits it to 140 characters", () => {
    show({ spot: { ...lostSpot, note: "the proof step" } });
    expect(screen.getByText("the proof step")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your note")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
    expect(input()).toHaveValue("the proof step");
    expect(input()).toHaveAttribute("maxlength", "140");
    expect(input()).toHaveFocus();
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
    expect(eq).toHaveBeenCalledWith("id", "tap-1");
    expect(await screen.findByRole("status")).toHaveTextContent("Note saved");
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
  it("asks once, inline, then marks the row undone and reports it", async () => {
    const { onRemoved } = show();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByText("Remove this spot?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith({ undone: true });
    expect(eq).toHaveBeenCalledWith("id", "tap-1");
  });

  it("Keep it leaves the spot alone", () => {
    const { onRemoved } = show();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(update).not.toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
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

  it("goes to the highlight action when the Keep highlight menu closes", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: 1000, bottom: 500, x: 0, y: 0, width: 1000, height: 500, toJSON: () => ({}),
    });
    show();
    const layer = document.querySelector("[data-highlight-layer]") as HTMLElement;
    const mouse = { pointerType: "mouse", button: 0, pointerId: 1 };
    fireEvent.pointerDown(layer, { ...mouse, clientX: 500, clientY: 250 });
    fireEvent.pointerUp(layer, { ...mouse, clientX: 900, clientY: 450 });
    const keep = screen.getByRole("button", { name: "Keep highlight" });
    keep.focus();
    fireEvent.click(keep);
    await waitFor(() => expect(screen.getByRole("button", { name: "Change highlight" })).toHaveFocus());
    vi.restoreAllMocks();
  });
});

describe("SpotDetail: previous and next spot", () => {
  it("are disabled at the ends and open the spot next to this one", () => {
    const onNextSpot = vi.fn();
    show({ onNextSpot });
    expect(screen.getByRole("button", { name: "Previous spot" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next spot" }));
    expect(onNextSpot).toHaveBeenCalledTimes(1);
  });
});

describe("SpotDetail: leaving", () => {
  it("has a way back to the list", () => {
    const { onBack } = show();
    fireEvent.click(screen.getByRole("button", { name: "Back to my spots" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("SpotDetail: the highlight", () => {
  const RECT = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
  const withRect: Spot = { ...lostSpot, rect: RECT };
  const mouse = { pointerType: "mouse", button: 0, pointerId: 1 };
  const boxes = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>("[data-highlight-box]"));
  const layer = () => document.querySelector("[data-highlight-layer]") as HTMLElement;
  const drawButton = (name = "Highlight") => screen.getByRole("button", { name });
  // A drag from (500, 250) to (900, 450) on the 1000 x 500 slide.
  function drag(from: [number, number] = [500, 250], to: [number, number] = [900, 450]) {
    fireEvent.pointerDown(layer(), { ...mouse, clientX: from[0], clientY: from[1] });
    fireEvent.pointerMove(layer(), { ...mouse, clientX: to[0], clientY: to[1] });
    fireEvent.pointerUp(layer(), { ...mouse, clientX: to[0], clientY: to[1] });
  }

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: 1000, bottom: 500, x: 0, y: 0, width: 1000, height: 500, toJSON: () => ({}),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws the spot's highlight over the slide image", () => {
    const { container } = show({ spot: withRect });
    const [box] = boxes(container);
    expect(boxes(container)).toHaveLength(1);
    expect(box.style.left).toBe("10%");
    expect(box.style.top).toBe("20%");
    expect(box.style.width).toBe("30%");
    expect(box.style.height).toBe("40%");
    expect(screen.getByRole("img").parentElement?.contains(box)).toBe(true);
  });

  it("draws the highlight of a saved spot too", () => {
    const { container } = show({ spot: { ...withRect, kind: "save" } });
    expect(boxes(container)).toHaveLength(1);
  });

  it("draws nothing when the spot has no highlight", () => {
    const { container } = show();
    expect(boxes(container)).toHaveLength(0);
  });

  it("draws the highlight only on the spot's slide, not on the slides next to it", () => {
    const { container } = show({ spot: withRect });
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(boxes(container)).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /highlight/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to slide 7" }));
    expect(boxes(container)).toHaveLength(1);
  });

  it("offers Highlight when there is none and Change highlight when there is one", () => {
    const { unmount } = show();
    expect(drawButton("Highlight")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change highlight" })).not.toBeInTheDocument();
    unmount();
    show({ spot: withRect });
    expect(drawButton("Change highlight")).toBeInTheDocument();
  });

  const keep = () => fireEvent.click(screen.getByRole("button", { name: "Keep highlight" }));

  it("a mouse drag draws a box right away, as in class, and saves nothing until Keep highlight", () => {
    const { container } = show();
    expect(layer()).toBeInTheDocument();
    drag();
    expect(screen.getByRole("group", { name: "Highlight" })).toBeInTheDocument();
    expect(boxes(container)).toHaveLength(1);
    expect(update).not.toHaveBeenCalled();
    // While the box waits, the Highlight action steps aside (design 31:1192).
    expect(screen.queryByRole("button", { name: "Highlight" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move to slide 6" })).toBeInTheDocument();
  });

  it("a touch drag needs Highlight pressed first, so the page still scrolls", () => {
    show();
    const touch = { pointerType: "touch", pointerId: 2 };
    fireEvent.pointerDown(layer(), { ...touch, clientX: 500, clientY: 250 });
    fireEvent.pointerUp(layer(), { ...touch, clientX: 900, clientY: 450 });
    expect(screen.queryByRole("group", { name: "Highlight" })).not.toBeInTheDocument();
    fireEvent.click(drawButton());
    fireEvent.pointerDown(layer(), { ...touch, clientX: 500, clientY: 250 });
    fireEvent.pointerUp(layer(), { ...touch, clientX: 900, clientY: 450 });
    expect(screen.getByRole("group", { name: "Highlight" })).toBeInTheDocument();
  });

  it("Cancel drops the box without saving", () => {
    const { container } = show();
    drag();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Highlight" })).not.toBeInTheDocument();
    expect(drawButton()).toBeInTheDocument();
    expect(boxes(container)).toHaveLength(0);
    expect(update).not.toHaveBeenCalled();
  });

  it("saves a dragged box as an update of the four hl_ columns of the row, then shows it", async () => {
    const { onHighlightSaved, container } = show({ spot: withRect });
    drag();
    keep();
    await waitFor(() => expect(onHighlightSaved).toHaveBeenCalledWith({ x: 0.5, y: 0.5, w: 0.4, h: 0.4 }));
    expect(from).toHaveBeenCalledWith("lost_taps");
    expect(update).toHaveBeenCalledWith({ hl_x: 0.5, hl_y: 0.5, hl_w: 0.4, hl_h: 0.4 });
    expect(eq).toHaveBeenCalledWith("id", "tap-1");
    expect(selectAfter).toHaveBeenCalledWith("id");
    expect(await screen.findByRole("status")).toHaveTextContent("Highlight saved");
    const [box] = boxes(container);
    expect(boxes(container)).toHaveLength(1);
    expect(box.style.left).toBe("50%");
    expect(box.style.width).toBe("40%");
    // The menu goes away when the highlight is saved.
    expect(screen.queryByRole("group", { name: "Highlight" })).not.toBeInTheDocument();
  });

  it("adds a first highlight to a spot that had none", async () => {
    const { onHighlightSaved } = show();
    drag();
    keep();
    await waitFor(() => expect(onHighlightSaved).toHaveBeenCalled());
    expect(drawButton("Change highlight")).toBeInTheDocument();
  });

  it("a click on the slide saves nothing", () => {
    show();
    drag([500, 250], [500, 250]);
    expect(update).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Highlight" })).not.toBeInTheDocument();
    expect(layer()).toBeInTheDocument();
  });

  it("Escape drops the box and stops drawing without saving", () => {
    show({ spot: withRect });
    fireEvent.click(drawButton("Change highlight"));
    drag();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Highlight" })).not.toBeInTheDocument();
    expect(drawButton("Change highlight")).toHaveAttribute("aria-pressed", "false");
    expect(update).not.toHaveBeenCalled();
  });

  it("a press anywhere else drops the box", () => {
    show();
    drag();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("group", { name: "Highlight" })).not.toBeInTheDocument();
  });

  it("pressing the button again stops drawing", () => {
    show();
    fireEvent.click(drawButton());
    expect(drawButton()).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(drawButton());
    expect(drawButton()).toHaveAttribute("aria-pressed", "false");
  });

  it("says plainly when the database refuses, and keeps the old highlight", async () => {
    selectAfter.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const { onHighlightSaved, container } = show({ spot: withRect });
    drag();
    keep();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the highlight");
    expect(onHighlightSaved).not.toHaveBeenCalled();
    expect(boxes(container)).toHaveLength(1);
    expect(boxes(container)[0].style.left).toBe("10%");
  });

  it("treats an update that changed no row as a failure", async () => {
    selectAfter.mockResolvedValue({ data: [], error: null });
    const { onHighlightSaved } = show();
    drag();
    keep();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the highlight");
    expect(onHighlightSaved).not.toHaveBeenCalled();
  });

  it("moving the marker takes the highlight off the row, as it belonged to the slide it was drawn on", async () => {
    const { onMoved, container } = show({ spot: withRect });
    fireEvent.click(move());
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith(6));
    expect(update).toHaveBeenCalledWith({ slide_number: 6, hl_x: null, hl_y: null, hl_w: null, hl_h: null });
    expect(boxes(container)).toHaveLength(0);
  });

  it("moving the marker of a spot with no highlight changes only the slide", async () => {
    const { onMoved } = show();
    fireEvent.click(move());
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith(6));
    expect(update).toHaveBeenCalledWith({ slide_number: 6 });
  });
});
