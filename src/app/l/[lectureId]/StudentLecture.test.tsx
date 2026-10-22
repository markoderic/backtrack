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
// The student's own rows: select(...).eq("lecture_id", ...).eq("undone", false)
const ownRows = vi.fn();
const getSession = vi.fn();
const from = vi.fn((table: string) =>
  table === "lost_taps"
    ? { select: () => ({ eq: () => ({ eq: ownRows }) }), insert, update, upsert }
    : { select: () => ({ eq: () => ({ single }) }), insert, update, upsert },
);
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({ from, rpc, auth: { getSession }, channel: () => channel, removeChannel: vi.fn() }),
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
const STUDENT = "44444444-4444-4444-4444-000000000001";

function show(initialSlide = 7) {
  return render(
    <StudentLecture lectureId={LECTURE} lectureName="Lecture 3, Oct 26" courseName="IMS 452" initialSlide={initialSlide} />,
  );
}

const shownSrc = () => screen.getByRole("img").getAttribute("src");
const forward = () => screen.getByRole("button", { name: "Forward" });
const back = () => screen.getByRole("button", { name: "Back" });
// The big number under the slide, not the matching number in the slide strip.
const numberShown = (n: string) => screen.getAllByText(n).filter((el) => !el.closest("[aria-label='Slides']"));
const strip = () => screen.getByRole("navigation", { name: "Slides" });
const stripItems = () => within(strip()).getAllByRole("listitem");
const lost = () => screen.getByRole("button", { name: "I'm lost" });
const teacherMoves = (n: number) => act(() => channel.update?.({ new: { current_slide: n, status: "live", slide_count: 10 } }));

beforeEach(() => {
  [single, insert, update, upsert, rpc, from, replace, useSlideImages, ownRows, getSession].forEach((m) => m.mockClear());
  localStorage.clear();
  upsert.mockResolvedValue({ error: null, status: 201 });
  update.mockReturnValue({ eq: vi.fn(async () => ({ error: null, status: 204 })) });
  ownRows.mockResolvedValue({ data: [], error: null, status: 200 });
  getSession.mockResolvedValue({ data: { session: { user: { id: STUDENT } } }, error: null });
  single.mockResolvedValue({ data: { current_slide: 7, status: "live", slide_count: 10 }, error: null });
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
    expect(numberShown("7")).toHaveLength(1);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/10/);
    expect(text).not.toMatch(/\bof\b/i);
    expect(screen.queryByText(/\//)).not.toBeInTheDocument();
  });

  it("shows no total even after the lecture row and a realtime update carried slide_count 10", async () => {
    const { container } = show(7);
    await waitFor(() => expect(single).toHaveBeenCalled());
    await act(async () => channel.status?.("SUBSCRIBED"));
    expect(numberShown("7")).toHaveLength(1);
    expect(container.textContent ?? "").not.toMatch(/10/);
    teacherMoves(8);
    expect(numberShown("8")).toHaveLength(1);
    expect(container.textContent ?? "").not.toMatch(/10/);
    expect(container.textContent ?? "").not.toMatch(/\bof\b/i);
  });

  it("keeps the same when the help panel is open", () => {
    const { container } = show(7);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(numberShown("7")).toHaveLength(1);
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
    expect(numberShown("6")).toHaveLength(1);
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
    single.mockResolvedValue({ data: { current_slide: 1, status: "live", slide_count: 10 }, error: null });
    show(1);
    expect(back()).toBeDisabled();
  });

  it("follows the teacher forward", () => {
    show();
    teacherMoves(8);
    expect(shownSrc()).toBe("https://signed/8.webp");
    expect(numberShown("8")).toHaveLength(1);
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
    single.mockResolvedValue({ data: { current_slide: 9, status: "live", slide_count: 10 }, error: null });
    await act(async () => channel.status?.("SUBSCRIBED"));
    await waitFor(() => expect(screen.queryByText("Reconnecting...")).not.toBeInTheDocument());
    expect(shownSrc()).toBe("https://signed/9.webp");
  });

  it("keeps the Reconnecting... bar when the read after a drop fails, then jumps to live on a retry", async () => {
    vi.useFakeTimers();
    try {
      show();
      await act(async () => {});
      fireEvent.click(back());
      act(() => channel.status?.("CHANNEL_ERROR"));
      single.mockResolvedValue({ data: null, error: { message: "Failed to fetch" } });
      await act(async () => channel.status?.("SUBSCRIBED"));
      expect(screen.getByText("Reconnecting...")).toBeInTheDocument();
      expect(shownSrc()).toBe("https://signed/6.webp");

      single.mockResolvedValue({ data: { current_slide: 9, status: "live", slide_count: 10 }, error: null });
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      expect(screen.queryByText("Reconnecting...")).not.toBeInTheDocument();
      expect(shownSrc()).toBe("https://signed/9.webp");
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes to the lecture's spot when the lecture ends", () => {
    show();
    expect(replace).not.toHaveBeenCalled();
    act(() => channel.update?.({ new: { current_slide: 7, status: "ended", slide_count: 10 } }));
    expect(replace).toHaveBeenCalledWith(`/spots/${LECTURE}`);
  });

  it("reads the lecture again on SUBSCRIBED and goes to the spot if it ended meanwhile", async () => {
    show();
    single.mockResolvedValue({ data: { current_slide: 7, status: "ended", slide_count: 10 }, error: null });
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
    expect(screen.queryByText(/Saved slide/)).not.toBeInTheDocument();
    // Only the reads of the lecture row happened.
    await waitFor(() => expect(single).toHaveBeenCalled());
    // Reads only: the lecture row, and the student's own rows.
    for (const call of from.mock.calls as unknown as string[][]) expect(["lectures", "lost_taps"]).toContain(call[0]);
  });

  it("has no total anywhere in its markup, even for the jump button", () => {
    const { container } = show(7);
    fireEvent.click(back());
    teacherMoves(9);
    expect(container.textContent ?? "").not.toMatch(/\bof\b/i);
    expect(within(container).queryByText(/10/)).not.toBeInTheDocument();
  });
  describe("slide strip", () => {
    it("runs from 1 to the live slide and no further", () => {
      const { container } = show(7);
      expect(stripItems()).toHaveLength(7);
      expect(within(strip()).queryByRole("button", { name: /^Slide 8\b/ })).not.toBeInTheDocument();
      expect(container.textContent ?? "").not.toMatch(/10/);
      teacherMoves(8);
      expect(stripItems()).toHaveLength(8);
    });

    it("marks the live slide apart from the one being viewed", () => {
      show(7);
      fireEvent.click(back());
      fireEvent.click(back());
      expect(within(strip()).getByRole("button", { name: "Slide 7, live" })).toHaveAttribute("data-live");
      expect(within(strip()).getByRole("button", { name: "Slide 5, viewing" })).toHaveAttribute("aria-current", "true");
    });

    it("picking a slide shows it and offers Jump to live", () => {
      show(7);
      fireEvent.click(within(strip()).getByRole("button", { name: "Slide 3" }));
      expect(shownSrc()).toBe("https://signed/3.webp");
      expect(screen.getByRole("button", { name: "Jump to live, slide 7" })).toBeInTheDocument();
      fireEvent.click(within(strip()).getByRole("button", { name: "Slide 7, live" }));
      expect(shownSrc()).toBe("https://signed/7.webp");
      expect(screen.queryByRole("button", { name: /Jump to live/ })).not.toBeInTheDocument();
    });

    it("shows a dot on each slide where the student already has a row", async () => {
      ownRows.mockResolvedValue({ data: [{ id: "a", slide_number: 3 }, { id: "b", slide_number: 5 }], error: null, status: 200 });
      show(7);
      await waitFor(() => expect(within(strip()).getByRole("button", { name: "Slide 3, saved" })).toBeInTheDocument());
      expect(within(strip()).getByRole("button", { name: "Slide 5, saved" })).toBeInTheDocument();
      expect(within(strip()).getByRole("button", { name: "Slide 7, live, viewing" })).toBeInTheDocument();
    });
  });

  describe("I'm lost", () => {
    it("sits in the bottom row with Back and Forward", () => {
      show();
      expect(lost().parentElement).toContainElement(back());
      expect(lost().parentElement).toContainElement(forward());
    });

    it("records the slide being viewed, shows Saved slide 6 and puts a dot on it", async () => {
      show(7);
      await act(async () => {});
      fireEvent.click(back());
      fireEvent.click(lost());
      expect(screen.getByText("Saved slide 6")).toBeInTheDocument();
      expect(within(strip()).getByRole("button", { name: "Slide 6, viewing, saved" })).toBeInTheDocument();
      await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
      expect(from).toHaveBeenCalledWith("lost_taps");
      expect(upsert.mock.calls[0][0]).toMatchObject({
        lecture_id: LECTURE,
        anon_id: STUDENT,
        kind: "lost",
        tapped_on_slide: 6,
        slide_number: 6,
      });
      expect(upsert.mock.calls[0][1]).toEqual({ onConflict: "id", ignoreDuplicates: true });
    });

    it("keeps the bar out of the slide area and gives it a row that is there before the tap", () => {
      const { container } = show(7);
      const slideArea = screen.getByRole("img").parentElement as HTMLElement;
      const bar = container.querySelector("[data-bar]") as HTMLElement;
      expect(slideArea.contains(bar)).toBe(false);
      const className = bar.className;
      fireEvent.click(lost());
      expect(slideArea.contains(screen.getByText("Saved slide 7"))).toBe(false);
      expect(bar.contains(screen.getByText("Saved slide 7"))).toBe(true);
      expect(bar.className).toBe(className);
    });

    it("sends a tap that failed offline again when the connection comes back", async () => {
      upsert.mockResolvedValueOnce({ error: { code: "", message: "TypeError: Failed to fetch" }, status: 0 });
      show(7);
      await act(async () => {});
      fireEvent.click(lost());
      await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
      act(() => channel.status?.("CHANNEL_ERROR"));
      await act(async () => channel.status?.("SUBSCRIBED"));
      await waitFor(() => expect(screen.queryByText("Reconnecting...")).not.toBeInTheDocument());
      await waitFor(() => expect(upsert).toHaveBeenCalledTimes(2));
      expect(upsert.mock.calls[1][0]).toEqual(upsert.mock.calls[0][0]);
    });

    it("shows the lecture-ended message and takes the dot away when the tap is rejected", async () => {
      upsert.mockResolvedValue({ error: { code: "42501", message: "new row violates row-level security policy" }, status: 403 });
      show(7);
      await act(async () => {});
      fireEvent.click(lost());
      await waitFor(() => expect(screen.getByText("This one didn't save because the lecture had ended.")).toBeInTheDocument());
      expect(within(strip()).getByRole("button", { name: "Slide 7, live, viewing" })).toBeInTheDocument();
    });

    it("never shows the slide count while tapping", async () => {
      const { container } = show(7);
      await act(async () => {});
      fireEvent.click(lost());
      expect(container.textContent ?? "").not.toMatch(/10/);
      expect(container.textContent ?? "").not.toMatch(/\bof\b/i);
    });
  });
});
