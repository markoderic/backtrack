import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";

type Handler = (payload: { new: Record<string, unknown> }) => void;
const channel = {
  update: null as Handler | null,
  status: null as ((s: string) => void) | null,
  on: vi.fn(),
  subscribe: vi.fn(),
};
channel.on.mockImplementation((_t: string, _f: unknown, cb: Handler) => {
  channel.update = cb;
  return channel;
});
channel.subscribe.mockImplementation((cb: (s: string) => void) => {
  channel.status = cb;
  return channel;
});

// Reads are allowed. Anything that writes is a spy the tests check was never called.
const single = vi.fn();
const insert = vi.fn();
const update = vi.fn();
const upsert = vi.fn();
const rpc = vi.fn();
const from = vi.fn(() => ({ select: () => ({ eq: () => ({ single }) }), insert, update, upsert }));
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({ from, rpc, channel: () => channel, removeChannel: vi.fn() }),
}));

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));

const useSlideImages = vi.fn((...args: [string, number?]) => ({
  urlFor: (n: number) => `https://signed/${n}.webp`,
  args,
}));
vi.mock("@/lib/useSlideImages", () => ({
  useSlideImages: (id: string, current?: number) => useSlideImages(id, current),
}));

import { StudentLecture } from "./StudentLecture";

const LECTURE = "11111111-1111-1111-1111-111111111111";

function show(initialSlide = 7) {
  return render(
    <StudentLecture lectureId={LECTURE} lectureName="Lecture 3, Oct 26" courseName="IMS 452" initialSlide={initialSlide} />,
  );
}

const shownSrc = () => screen.getByRole("img").getAttribute("src");
const forward = () => screen.getByRole("button", { name: "Forward" });
const back = () => screen.getByRole("button", { name: "Back" });
const teacherMoves = (n: number) => act(() => channel.update?.({ new: { current_slide: n, status: "live" } }));

beforeEach(() => {
  [single, insert, update, upsert, rpc, from, replace, useSlideImages].forEach((m) => m.mockClear());
  single.mockResolvedValue({ data: { current_slide: 7, status: "live" }, error: null });
  channel.update = null;
  channel.status = null;
});

describe("StudentLecture", () => {
  it("shows the class, the lecture name and LIVE", () => {
    show();
    expect(screen.getByText("IMS 452")).toBeInTheDocument();
    expect(screen.getByText("Lecture 3, Oct 26")).toBeInTheDocument();
    expect(screen.getByText("LIVE")).toBeInTheDocument();
  });

  it("shows the live slide as large as it can, at its own shape", () => {
    show();
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://signed/7.webp");
    expect(img.className).toContain("object-contain");
    expect(img.className).not.toMatch(/object-(fill|cover)/);
    expect(useSlideImages).toHaveBeenLastCalledWith(LECTURE, 7);
  });

  it("with slide 7 of a 10 slide lecture, never shows 10 or the word of, and shows 7 once", () => {
    const { container } = show(7);
    expect(screen.getAllByText("7")).toHaveLength(1);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/10/);
    expect(text).not.toMatch(/\bof\b/i);
    expect(screen.queryByText(/\//)).not.toBeInTheDocument();
  });

  it("keeps the same when the help panel is open", () => {
    const { container } = show(7);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getAllByText("7")).toHaveLength(1);
    expect(container.textContent ?? "").not.toMatch(/\bof\b/i);
  });

  it("has the help button in the layout", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Nobody sees your name.");
  });

  it("Forward is disabled at the live slide and there is no jump button", () => {
    show();
    expect(forward()).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Jump to live/ })).not.toBeInTheDocument();
  });

  it("Back goes one slide back and offers Jump to live, slide 7", () => {
    show();
    fireEvent.click(back());
    expect(shownSrc()).toBe("https://signed/6.webp");
    expect(screen.getAllByText("6")).toHaveLength(1);
    expect(forward()).toBeEnabled();
    expect(screen.getByRole("button", { name: "Jump to live, slide 7" })).toBeInTheDocument();
  });

  it("Forward walks back toward live and stops there", () => {
    show();
    fireEvent.click(back());
    fireEvent.click(back());
    fireEvent.click(forward());
    expect(shownSrc()).toBe("https://signed/6.webp");
    fireEvent.click(forward());
    expect(shownSrc()).toBe("https://signed/7.webp");
    expect(forward()).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Jump to live/ })).not.toBeInTheDocument();
  });

  it("Back is disabled on slide 1", () => {
    single.mockResolvedValue({ data: { current_slide: 1, status: "live" }, error: null });
    show(1);
    expect(back()).toBeDisabled();
  });

  it("follows the teacher forward", () => {
    show();
    teacherMoves(8);
    expect(shownSrc()).toBe("https://signed/8.webp");
    expect(screen.getAllByText("8")).toHaveLength(1);
  });

  it("stays on the slide the student went back to and updates the jump button", () => {
    show();
    fireEvent.click(back());
    teacherMoves(9);
    expect(shownSrc()).toBe("https://signed/6.webp");
    fireEvent.click(screen.getByRole("button", { name: "Jump to live, slide 9" }));
    expect(shownSrc()).toBe("https://signed/9.webp");
    expect(screen.queryByRole("button", { name: /Jump to live/ })).not.toBeInTheDocument();
  });

  it("shows a Reconnecting... bar while the channel is down and clears it when it is back", async () => {
    show();
    expect(screen.queryByText("Reconnecting...")).not.toBeInTheDocument();
    act(() => channel.status?.("CHANNEL_ERROR"));
    expect(screen.getByText("Reconnecting...")).toBeInTheDocument();
    single.mockResolvedValue({ data: { current_slide: 9, status: "live" }, error: null });
    await act(async () => channel.status?.("SUBSCRIBED"));
    await waitFor(() => expect(screen.queryByText("Reconnecting...")).not.toBeInTheDocument());
    expect(shownSrc()).toBe("https://signed/9.webp");
  });

  it("goes to the lecture's spot when the lecture ends", () => {
    show();
    expect(replace).not.toHaveBeenCalled();
    act(() => channel.update?.({ new: { current_slide: 7, status: "ended" } }));
    expect(replace).toHaveBeenCalledWith(`/spots/${LECTURE}`);
  });

  it("reads the lecture again on SUBSCRIBED and goes to the spot if it ended meanwhile", async () => {
    show();
    single.mockResolvedValue({ data: { current_slide: 7, status: "ended" }, error: null });
    await act(async () => channel.status?.("SUBSCRIBED"));
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/spots/${LECTURE}`));
  });

  it("records nothing when letter keys are pressed, and keys do not move the slide", async () => {
    show();
    for (const key of ["l", "L", "n", "b", "p", ".", " ", "d", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Escape"]) {
      fireEvent.keyDown(window, { key });
      fireEvent.keyDown(document.body, { key });
      fireEvent.keyUp(window, { key });
    }
    expect(shownSrc()).toBe("https://signed/7.webp");
    expect(screen.queryByRole("button", { name: /Jump to live/ })).not.toBeInTheDocument();
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    // Only the reads of the lecture row happened.
    await waitFor(() => expect(single).toHaveBeenCalled());
    for (const call of from.mock.calls as unknown as string[][]) expect(call[0]).toBe("lectures");
  });

  it("has no total anywhere in its markup, even for the jump button", () => {
    const { container } = show(7);
    fireEvent.click(back());
    teacherMoves(9);
    expect(container.textContent ?? "").not.toMatch(/\bof\b/i);
    expect(within(container).queryByText(/10/)).not.toBeInTheDocument();
  });
});
