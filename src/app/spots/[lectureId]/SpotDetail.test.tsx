import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// from("lost_taps").update(patch).eq("id", id).select("id")
const selectAfter = vi.fn();
const eq = vi.fn(() => ({ select: selectAfter }));
const update = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ update }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => ({ from }) }));

const useSlideImages = vi.fn();
vi.mock("@/lib/useSlideImages", () => ({
  useSlideImages: (id: string, current?: number) => {
    useSlideImages(id, current);
    return { urlFor: (n: number) => `https://signed/${n}.webp` };
  },
}));

import { SpotDetail, type Spot } from "./SpotDetail";

const LECTURE = "11111111-1111-1111-1111-111111111111";
const lostSpot: Spot = { id: "tap-1", kind: "lost", slideNumber: 7, note: null, tappedAt: "2026-10-26T14:00:00Z" };

function show(o: { spot?: Spot; students?: number; slideCount?: number } = {}) {
  const props = {
    lectureId: LECTURE,
    spot: o.spot ?? lostSpot,
    students: o.students ?? 6,
    slideCount: o.slideCount ?? 23,
    onNoteSaved: vi.fn(),
    onMoved: vi.fn(async () => {}),
    onBack: vi.fn(),
  };
  const view = render(<SpotDetail {...props} />);
  return { ...props, ...view };
}

const move = () => screen.getByRole("button", { name: "Move marker one slide earlier" });
const shownSrc = () => screen.getByRole("img").getAttribute("src");

beforeEach(() => {
  [selectAfter, eq, update, from, useSlideImages].forEach((m) => m.mockClear());
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

  it("is disabled on slide 1 and does nothing", () => {
    show({ spot: { ...lostSpot, slideNumber: 1 } });
    expect(move()).toBeDisabled();
    fireEvent.click(move());
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

  it("preloads from the slide on screen", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(useSlideImages).toHaveBeenLastCalledWith(LECTURE, 8);
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
  const input = () => screen.getByLabelText("Note") as HTMLInputElement;
  const save = () => screen.getByRole("button", { name: "Save note" });

  it("shows the note and limits it to 140 characters", () => {
    show({ spot: { ...lostSpot, note: "the proof step" } });
    expect(input()).toHaveValue("the proof step");
    expect(input()).toHaveAttribute("maxlength", "140");
  });

  it("saves a changed note to the row and reports it", async () => {
    const { onNoteSaved } = show();
    expect(save()).toBeDisabled();
    fireEvent.change(input(), { target: { value: "ask about step 2" } });
    fireEvent.click(save());
    await waitFor(() => expect(onNoteSaved).toHaveBeenCalledWith("ask about step 2"));
    expect(update).toHaveBeenCalledWith({ note: "ask about step 2" });
    expect(eq).toHaveBeenCalledWith("id", "tap-1");
    expect(await screen.findByRole("status")).toHaveTextContent("Note saved");
  });

  it("saves an emptied note as no note", async () => {
    const { onNoteSaved } = show({ spot: { ...lostSpot, note: "old" } });
    fireEvent.change(input(), { target: { value: "   " } });
    fireEvent.click(save());
    await waitFor(() => expect(onNoteSaved).toHaveBeenCalledWith(null));
    expect(update).toHaveBeenCalledWith({ note: null });
  });

  it("shows the error plainly and keeps what was typed", async () => {
    selectAfter.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { onNoteSaved } = show();
    fireEvent.change(input(), { target: { value: "keep me" } });
    fireEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the note");
    expect(onNoteSaved).not.toHaveBeenCalled();
    expect(input()).toHaveValue("keep me");
  });
});

describe("SpotDetail: leaving", () => {
  it("has a way back to the list", () => {
    const { onBack } = show();
    fireEvent.click(screen.getByRole("button", { name: "Back to my spots" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
