import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
// The student's own rows: select(...).eq("lecture_id", ...).eq("anon_id", ...).eq("undone", false)
const ownRows = vi.fn();
const ownFilters = vi.fn();
const getSession = vi.fn();
const from = vi.fn((table: string) =>
  table === "lost_taps"
    ? {
        select: () => ({
          eq: (...a: unknown[]) => (
            ownFilters(...a),
            { eq: (...b: unknown[]) => (ownFilters(...b), { eq: ownRows }) }
          ),
        }),
        insert,
        update,
        upsert,
      }
    : { select: () => ({ eq: () => ({ single }) }), insert, update, upsert },
);
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({
    from,
    rpc,
    auth: { getSession },
    realtime: { setAuth: async () => {} },
    channel: () => channel,
    removeChannel: vi.fn(),
  }),
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
const useTrackHere = vi.fn();
vi.mock("@/lib/useHere", () => ({
  useTrackHere: (id: string, enabled: boolean) => useTrackHere(id, enabled),
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
// The top bar on a phone; on a laptop its parts sit in the sidebar (same markup, see globals.css).
const top = () => document.querySelector("[data-lecture-top]") as HTMLElement;
const panel = () => document.querySelector("[data-lecture-panel]") as HTMLElement;
// Behind live there are two Jump to live buttons, one per layout (the sidebar's and the pill on the slide); CSS shows one.
const jumps = (n: number) => screen.getAllByRole("button", { name: `Jump to live, slide ${n}` });
// Runs every queued promise (and any timer already due) inside act, with fake or real timers.
// The channel opens a step after the first render (once Realtime has the token), so a
// test settles before it drives the channel.
const settle = () =>
  act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await new Promise((r) => setTimeout(r, 0));
  });
// What Realtime sends. Throws if the page has not opened its channel yet.
function channelUpdate(payload: { new: Record<string, unknown> }) {
  if (!channel.update) throw new Error("The channel is not open yet: settle first.");
  channel.update(payload);
}
function channelStatus(status: string) {
  if (!channel.status) throw new Error("The channel is not open yet: settle first.");
  channel.status(status);
}
const teacherMoves = (n: number) => act(() => channelUpdate({ new: { current_slide: n, status: "live", slide_count: 10 } }));

beforeEach(() => {
  [single, insert, update, upsert, rpc, from, replace, useSlideImages, ownRows, ownFilters, getSession, useTrackHere].forEach((m) =>
    m.mockClear(),
  );
  localStorage.clear();
  sessionStorage.clear();
  upsert.mockResolvedValue({ error: null, status: 201 });
  update.mockReturnValue({ eq: vi.fn(async () => ({ error: null, status: 204 })) });
  ownRows.mockResolvedValue({ data: [], error: null, status: 200 });
  getSession.mockResolvedValue({ data: { session: { user: { id: STUDENT } } }, error: null });
  single.mockResolvedValue({ data: { current_slide: 7, status: "live", slide_count: 10 }, error: null });
  channel.update = null;
  channel.status = null;
});

describe("StudentLecture", () => {
  it("shows the class and the lecture name in the top bar, and live next to the slide number", () => {
    show();
    const bar = top();
    expect(within(bar).getByText("IMS 452")).toBeInTheDocument();
    expect(within(bar).getByText("Lecture 3, Oct 26")).toBeInTheDocument();
    // The lecture name hides on a phone.
    expect(within(bar).getByText("Lecture 3, Oct 26").className).toContain("max-sm:hidden");
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
    expect(screen.getByText("live")).toBeInTheDocument();
  });

  it("truncates a long course name instead of running into My spots", () => {
    render(
      <StudentLecture
        lectureId={LECTURE}
        lectureName="Lecture 3, Oct 26"
        courseName="ACC 221 Principles of Financial Accounting, Section B"
        initialSlide={7}
      />,
    );
    const course = within(top()).getByText("ACC 221 Principles of Financial Accounting, Section B");
    expect(course.className).toMatch(/\btruncate\b/);
    expect(course.className).toMatch(/\bmin-w-0\b/);
    expect(course.className).not.toMatch(/\bshrink-0\b/);
    expect(within(top()).getByRole("link", { name: /My spots/ }).className).toMatch(/\bshrink-0\b/);
  });

  it("has a My spots link with the count in the top bar, and no theme button yet", () => {
    show();
    const link = within(top()).getByRole("link", { name: /My spots/ });
    expect(link).toHaveAttribute("href", `/spots/${LECTURE}`);
    expect(link).toHaveTextContent("My spots0");
    expect(within(top()).getAllByRole("button")).toHaveLength(1);
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
    await act(async () => channelStatus("SUBSCRIBED"));
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
    // The help text says "part of a slide", so look for a count like "7 of 10" rather than the word alone.
    expect(container.textContent ?? "").not.toMatch(/\d\s*of\s*\d/i);
    expect(container.textContent ?? "").not.toMatch(/10/);
  });

  it("has the help button in the layout", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Nobody sees your name, not even your teacher.");
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
    expect(jumps(7)).toHaveLength(2);
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

  it("behind live, puts Jump to live in the sidebar under I'm lost (laptop) and as a pill over the slide (phone), never in the strip row", async () => {
    const { container } = show();
    await settle();
    expect(container.querySelector("[data-lecture-jump]")).toBeNull();
    fireEvent.click(back());
    const [side, pill] = jumps(7);
    expect(side).toHaveAttribute("data-lecture-jump", "side");
    expect(pill).toHaveAttribute("data-lecture-jump", "pill");
    expect(container.querySelector("[data-lecture-slide]")).toContainElement(pill);
    expect(container.querySelector("[data-lecture-nav]")).not.toContainElement(side);
    expect(container.querySelector("[data-lecture-nav]")).not.toContainElement(pill);
    // The sidebar's comes after the I'm lost panel (its grid row is above My spots), so I'm lost never moves.
    expect(panel().compareDocumentPosition(side) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(pill);
    expect(shownSrc()).toBe("https://signed/7.webp");
    expect(container.querySelector("[data-lecture-jump]")).toBeNull();
  });

  it("a double click on Jump to live records no tap (I'm lost does not move under it)", async () => {
    show();
    await settle();
    fireEvent.click(back());
    const [side] = jumps(7);
    fireEvent.click(side);
    fireEvent.click(side);
    fireEvent.doubleClick(side);
    await settle();
    expect(upsert).not.toHaveBeenCalled();
    expect(lost()).not.toHaveAttribute("aria-disabled");
  });

  it("has no empty theme slot at the edge of the top bar", () => {
    const { container } = show();
    expect(container.querySelector("[data-theme-slot]")).toBeNull();
  });

  it("Back is disabled on slide 1", () => {
    single.mockResolvedValue({ data: { current_slide: 1, status: "live", slide_count: 10 }, error: null });
    show(1);
    expect(back()).toBeDisabled();
  });

  it("follows the teacher forward", async () => {
    show();
    await settle();
    teacherMoves(8);
    expect(shownSrc()).toBe("https://signed/8.webp");
    expect(numberShown("8")).toHaveLength(1);
  });

  it("stays on the slide the student went back to and updates the jump button", async () => {
    show();
    await settle();
    fireEvent.click(back());
    teacherMoves(9);
    expect(shownSrc()).toBe("https://signed/6.webp");
    fireEvent.click(jumps(9)[0]);
    expect(shownSrc()).toBe("https://signed/9.webp");
    expect(screen.queryByRole("button", { name: /Jump to live/ })).not.toBeInTheDocument();
  });

  it("shows Reconnecting… while the channel is down and clears it when it is back", async () => {
    const { container } = show();
    await settle();
    expect(screen.queryByText("Reconnecting…")).not.toBeInTheDocument();
    act(() => channelStatus("CHANNEL_ERROR"));
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
    // In the saved row, and the word next to the slide number says so too.
    expect(container.querySelector("[data-lecture-panel]")).toContainElement(screen.getByText("Reconnecting…"));
    expect(screen.getByText("reconnecting")).toBeInTheDocument();
    expect(screen.queryByText("live")).not.toBeInTheDocument();
    // A screen reader hears it from a status line that is always on the page.
    expect(screen.getAllByRole("status").map((s) => s.textContent)).toContain("Reconnecting.");
    single.mockResolvedValue({ data: { current_slide: 9, status: "live", slide_count: 10 }, error: null });
    await act(async () => channelStatus("SUBSCRIBED"));
    await waitFor(() => expect(screen.queryByText("Reconnecting…")).not.toBeInTheDocument());
    expect(screen.getAllByRole("status").map((s) => s.textContent)).not.toContain("Reconnecting.");
    expect(shownSrc()).toBe("https://signed/9.webp");
  });

  it("keeps Reconnecting… when the read after a drop fails, then jumps to live on a retry", async () => {
    vi.useFakeTimers();
    try {
      show();
      await act(async () => {});
      fireEvent.click(back());
      act(() => channelStatus("CHANNEL_ERROR"));
      single.mockResolvedValue({ data: null, error: { message: "Failed to fetch" } });
      await act(async () => channelStatus("SUBSCRIBED"));
      expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
      expect(shownSrc()).toBe("https://signed/6.webp");

      single.mockResolvedValue({ data: { current_slide: 9, status: "live", slide_count: 10 }, error: null });
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      expect(screen.queryByText("Reconnecting…")).not.toBeInTheDocument();
      expect(shownSrc()).toBe("https://signed/9.webp");
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts this tab in the teacher's here count while the lecture is live, and stops when it ends", async () => {
    show();
    await settle();
    expect(useTrackHere).toHaveBeenLastCalledWith(LECTURE, true);
    act(() => channelUpdate({ new: { current_slide: 7, status: "ended", slide_count: 10 } }));
    await waitFor(() => expect(useTrackHere).toHaveBeenLastCalledWith(LECTURE, false));
  });

  it("goes to the lecture's spot when the lecture ends", async () => {
    show();
    await settle();
    expect(replace).not.toHaveBeenCalled();
    act(() => channelUpdate({ new: { current_slide: 7, status: "ended", slide_count: 10 } }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/spots/${LECTURE}`));
  });

  it("reads the lecture again on SUBSCRIBED and goes to the spot if it ended meanwhile", async () => {
    show();
    await settle();
    single.mockResolvedValue({ data: { current_slide: 7, status: "ended", slide_count: 10 }, error: null });
    await act(async () => channelStatus("SUBSCRIBED"));
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
    expect(screen.queryByRole("button", { name: /Lost on slide/ })).not.toBeInTheDocument();
    // Only the reads of the lecture row happened.
    await waitFor(() => expect(single).toHaveBeenCalled());
    // Reads only: the lecture row, and the student's own rows.
    for (const call of from.mock.calls as unknown as string[][]) expect(["lectures", "lost_taps"]).toContain(call[0]);
  });

  it("says Loading slide 7 only when the image takes over 300 ms", async () => {
    vi.useFakeTimers();
    try {
      show(7);
      await act(async () => vi.advanceTimersByTimeAsync(299));
      expect(screen.queryByText("Loading slide 7")).not.toBeInTheDocument();
      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(screen.getByText("Loading slide 7")).toBeInTheDocument();
      fireEvent.load(screen.getByRole("img"));
      expect(screen.queryByText("Loading slide 7")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a slide that loaded in time with no loading text, and takes the slide's own shape from the image", async () => {
    vi.useFakeTimers();
    try {
      show(7);
      const img = screen.getByRole("img");
      Object.defineProperty(img, "naturalWidth", { value: 1024, configurable: true });
      Object.defineProperty(img, "naturalHeight", { value: 768, configurable: true });
      fireEvent.load(img);
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      expect(screen.queryByText(/Loading slide/)).not.toBeInTheDocument();
      const box = img.parentElement as HTMLElement;
      expect(box).toHaveAttribute("data-slide");
      expect(box.style.aspectRatio).toMatch(/^1\.333/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("has no total anywhere in its markup, even for the jump button", async () => {
    const { container } = show(7);
    await settle();
    fireEvent.click(back());
    teacherMoves(9);
    expect(container.textContent ?? "").not.toMatch(/\bof\b/i);
    expect(within(container).queryByText(/10/)).not.toBeInTheDocument();
  });
  describe("slide strip", () => {
    it("runs from 1 to the live slide and no further", async () => {
      const { container } = show(7);
      await settle();
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
      expect(jumps(7)).toHaveLength(2);
      fireEvent.click(within(strip()).getByRole("button", { name: "Slide 7, live" }));
      expect(shownSrc()).toBe("https://signed/7.webp");
      expect(screen.queryByRole("button", { name: /Jump to live/ })).not.toBeInTheDocument();
    });

    it("shows a dot on each slide where the student already has a row", async () => {
      ownRows.mockResolvedValue({
        data: [
          { id: "a", slide_number: 3, kind: "lost" },
          { id: "b", slide_number: 5, kind: "save" },
        ],
        error: null,
        status: 200,
      });
      show(7);
      await waitFor(() => expect(within(strip()).getByRole("button", { name: "Slide 3, lost" })).toBeInTheDocument());
      expect(within(strip()).getByRole("button", { name: "Slide 5, saved" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /My spots/ })).toHaveTextContent("My spots2");
      expect(within(strip()).getByRole("button", { name: "Slide 7, live, viewing" })).toBeInTheDocument();
      // Only this user's rows are asked for.
      expect(ownFilters).toHaveBeenCalledWith("lecture_id", LECTURE);
      expect(ownFilters).toHaveBeenCalledWith("anon_id", STUDENT);
      expect(ownRows).toHaveBeenCalledWith("undone", false);
    });
  });

  describe("I'm lost", () => {
    it("is in its own panel, apart from the strip row, which holds Back, the strip, Forward and the number", () => {
      show();
      expect(panel()).toContainElement(lost());
      expect(panel()).not.toContainElement(back());
      const navRow = document.querySelector("[data-lecture-nav]") as HTMLElement;
      expect(navRow).toContainElement(back());
      expect(navRow).toContainElement(forward());
      expect(navRow).toContainElement(strip());
      expect(numberShown("7")[0]).toHaveAttribute("data-slide-number");
      expect(navRow).toContainElement(numberShown("7")[0]);
      // The navigation sits right under the slide.
      expect(navRow.previousElementSibling).toHaveAttribute("data-lecture-slide");
    });

    it("is the Join button's shape (full width, 48 px, radius md), not a circle", () => {
      show();
      expect(lost().className).toContain("w-full");
      expect(lost().className).toContain("h-12");
      expect(lost().className).toContain("rounded-md");
      expect(lost().className).not.toContain("rounded-full");
    });

    it("turns the My spots count red for 2 seconds after a tap, and counts it", async () => {
      vi.useFakeTimers();
      try {
        show(7);
        await act(async () => {});
        const count = () => screen.getByRole("link", { name: /My spots/ }).lastElementChild as HTMLElement;
        expect(count()).not.toHaveAttribute("data-count-red");
        fireEvent.click(lost());
        expect(count()).toHaveTextContent("1");
        expect(count()).toHaveAttribute("data-count-red");
        expect(count().className).toContain("text-lost");
        await act(async () => vi.advanceTimersByTimeAsync(1999));
        expect(count()).toHaveAttribute("data-count-red");
        await act(async () => vi.advanceTimersByTimeAsync(1));
        expect(count()).not.toHaveAttribute("data-count-red");
        expect(count().className).toContain("text-ink");
      } finally {
        vi.useRealTimers();
      }
    });

    it("records the slide being viewed, shows Saved slide 6 and puts a dot on it", async () => {
      show(7);
      await act(async () => {});
      fireEvent.click(back());
      fireEvent.click(lost());
      expect(screen.getByRole("button", { name: "Lost on slide 6" })).toHaveAttribute("aria-disabled", "true");
      expect(within(strip()).getByRole("button", { name: "Slide 6, viewing, lost" })).toBeInTheDocument();
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

    it("keeps the panel out of the slide area", () => {
      show(7);
      const slideArea = screen.getByRole("img").parentElement as HTMLElement;
      expect(slideArea.contains(panel())).toBe(false);
      fireEvent.click(lost());
      expect(slideArea.contains(screen.getByRole("button", { name: "Undo" }))).toBe(false);
    });

    it("takes one tap per slide: a second press on the same slide sends nothing", async () => {
      show(7);
      await settle();
      fireEvent.click(lost());
      fireEvent.click(screen.getByRole("button", { name: "Lost on slide 7" }));
      await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
      await settle();
      expect(upsert).toHaveBeenCalledTimes(1);
    });

    it("counts one spot per slide in My spots, even for an old slide with two rows", async () => {
      ownRows.mockResolvedValue({
        data: [
          { id: "a", slide_number: 3, kind: "lost" },
          { id: "b", slide_number: 3, kind: "lost" },
        ],
        error: null,
        status: 200,
      });
      show(7);
      await waitFor(() => expect(within(strip()).getByRole("button", { name: "Slide 3, lost" })).toBeInTheDocument());
      expect(screen.getByRole("link", { name: /My spots/ })).toHaveTextContent("My spots1");
    });

    it("sends a tap that failed offline again when the connection comes back", async () => {
      upsert.mockResolvedValueOnce({ error: { code: "", message: "TypeError: Failed to fetch" }, status: 0 });
      show(7);
      await act(async () => {});
      fireEvent.click(lost());
      await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
      act(() => channelStatus("CHANNEL_ERROR"));
      await act(async () => channelStatus("SUBSCRIBED"));
      await waitFor(() => expect(screen.queryByText("Reconnecting…")).not.toBeInTheDocument());
      await waitFor(() => expect(upsert).toHaveBeenCalledTimes(2));
      expect(upsert.mock.calls[1][0]).toEqual(upsert.mock.calls[0][0]);
    });

    it("shows the lecture-ended message and takes the dot away when the tap is rejected", async () => {
      // Fake timers and a settled queue instead of waitFor's one second of wall clock,
      // which a busy machine could run out of.
      vi.useFakeTimers();
      try {
        upsert.mockResolvedValue({ error: { code: "42501", message: "new row violates row-level security policy" }, status: 403 });
        show(7);
        await settle();
        fireEvent.click(lost());
        await settle();
        expect(upsert).toHaveBeenCalledTimes(1);
        expect(screen.getByText("This one didn't save because the lecture had ended.")).toBeInTheDocument();
        expect(within(strip()).getByRole("button", { name: "Slide 7, live, viewing" })).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it("never shows the slide count while tapping", async () => {
      const { container } = show(7);
      await act(async () => {});
      fireEvent.click(lost());
      expect(container.textContent ?? "").not.toMatch(/10/);
      expect(container.textContent ?? "").not.toMatch(/\bof\b/i);
    });
  });
  describe("when the lecture ends", () => {
    const offlineOnce = () => upsert.mockResolvedValueOnce({ error: { code: "", message: "TypeError: Failed to fetch" }, status: 0 });
    const ends = () => act(() => channelUpdate({ new: { current_slide: 7, status: "ended", slide_count: 10 } }));
    const endedRow = { data: { current_slide: 7, status: "ended", slide_count: 10 }, error: null };
    const refused = { error: { code: "42501", message: "new row violates row-level security policy" }, status: 403 };

    it("goes to the spot when Realtime says it ended", async () => {
      show(7);
      await settle();
      expect(channel.update).not.toBeNull();
      ends();
      await settle();
      expect(replace).toHaveBeenCalledWith(`/spots/${LECTURE}`);
    });

    it("goes to the spot when the 20 second check finds it ended, though Realtime said nothing", async () => {
      vi.useFakeTimers();
      try {
        show(7);
        await settle();
        single.mockResolvedValue(endedRow);
        await act(async () => vi.advanceTimersByTimeAsync(19999));
        expect(replace).not.toHaveBeenCalled();
        await act(async () => vi.advanceTimersByTimeAsync(1));
        expect(replace).toHaveBeenCalledTimes(1);
        expect(replace).toHaveBeenCalledWith(`/spots/${LECTURE}`);
      } finally {
        vi.useRealTimers();
      }
    });

    it("goes to the spot when the page becomes visible and the lecture had ended", async () => {
      vi.useFakeTimers();
      try {
        show(7);
        await settle();
        single.mockResolvedValue(endedRow);
        await act(async () => document.dispatchEvent(new Event("visibilitychange")));
        await settle();
        expect(replace).toHaveBeenCalledTimes(1);
        expect(replace).toHaveBeenCalledWith(`/spots/${LECTURE}`);
      } finally {
        vi.useRealTimers();
      }
    });

    it("goes to the spot after a tap is refused and the read it sets off finds the lecture ended", async () => {
      vi.useFakeTimers();
      try {
        show(7);
        await settle();
        upsert.mockResolvedValue(refused);
        single.mockResolvedValue(endedRow);
        const reads = single.mock.calls.length;
        fireEvent.click(lost());
        await settle();
        expect(screen.getByText("This one didn't save because the lecture had ended.")).toBeInTheDocument();
        expect(single.mock.calls.length).toBe(reads + 1);
        expect(replace).toHaveBeenCalledTimes(1);
        expect(replace).toHaveBeenCalledWith(`/spots/${LECTURE}`);
        // So My spots says the tap did not save.
        expect(sessionStorage.getItem(`backtrack:rejected:${LECTURE}`)).toBe("1");
      } finally {
        vi.useRealTimers();
      }
    });

    it("stays on the live view when a tap is refused but the lecture is still live", async () => {
      vi.useFakeTimers();
      try {
        show(7);
        await settle();
        upsert.mockResolvedValue(refused);
        const reads = single.mock.calls.length;
        fireEvent.click(lost());
        await settle();
        expect(single.mock.calls.length).toBe(reads + 1);
        await act(async () => vi.advanceTimersByTimeAsync(5000));
        expect(replace).not.toHaveBeenCalled();
        expect(screen.getByText("live")).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it("sends a tap that was waiting offline before it goes to the spot", async () => {
      offlineOnce();
      show(7);
      await act(async () => {});
      fireEvent.click(lost());
      await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
      ends();
      await waitFor(() => expect(replace).toHaveBeenCalledWith(`/spots/${LECTURE}`));
      expect(upsert).toHaveBeenCalledTimes(2);
      expect(upsert.mock.invocationCallOrder[1]).toBeLessThan(replace.mock.invocationCallOrder[0]);
      expect(JSON.parse(localStorage.getItem(`backtrack:queue:${LECTURE}`) ?? "[]")).toEqual([]);
      expect(sessionStorage.getItem(`backtrack:rejected:${LECTURE}`)).toBeNull();
    });

    it("also sends it when the end is found by the read after a reconnect", async () => {
      offlineOnce();
      show(7);
      await act(async () => {});
      fireEvent.click(lost());
      await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
      act(() => channelStatus("CHANNEL_ERROR"));
      single.mockResolvedValue({ data: { current_slide: 7, status: "ended", slide_count: 10 }, error: null });
      await act(async () => channelStatus("SUBSCRIBED"));
      await waitFor(() => expect(replace).toHaveBeenCalledWith(`/spots/${LECTURE}`));
      expect(upsert).toHaveBeenCalledTimes(2);
    });

    it("sets backtrack:rejected:<lectureId> when that flush is rejected, and still goes to the spot", async () => {
      offlineOnce();
      show(7);
      await act(async () => {});
      fireEvent.click(lost());
      await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
      upsert.mockResolvedValue({ error: { code: "42501", message: "new row violates row-level security policy" }, status: 403 });
      ends();
      await waitFor(() => expect(replace).toHaveBeenCalledWith(`/spots/${LECTURE}`));
      expect(sessionStorage.getItem(`backtrack:rejected:${LECTURE}`)).toBe("1");
    });

    it("goes to the spot anyway after 3 seconds if the flush hangs", async () => {
      vi.useFakeTimers();
      try {
        upsert.mockReturnValue(new Promise(() => {}));
        show(7);
        await act(async () => {});
        fireEvent.click(lost());
        await act(async () => {});
        expect(upsert).toHaveBeenCalledTimes(1);
        ends();
        await act(async () => vi.advanceTimersByTimeAsync(2999));
        expect(replace).not.toHaveBeenCalled();
        await act(async () => vi.advanceTimersByTimeAsync(1));
        expect(replace).toHaveBeenCalledTimes(1);
        expect(replace).toHaveBeenCalledWith(`/spots/${LECTURE}`);
        // The tap is still queued for the spots page to send.
        expect(JSON.parse(localStorage.getItem(`backtrack:queue:${LECTURE}`) ?? "[]")).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("goes to the spot once, not again when the flush finishes after the bound", async () => {
      vi.useFakeTimers();
      try {
        let finish: (v: unknown) => void = () => {};
        upsert.mockReturnValue(new Promise((r) => (finish = r)));
        show(7);
        await act(async () => {});
        fireEvent.click(lost());
        await act(async () => {});
        ends();
        await act(async () => vi.advanceTimersByTimeAsync(3000));
        await act(async () => finish({ error: null, status: 201 }));
        expect(replace).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("StudentLecture Mark the spot", () => {
  const mouse = { pointerType: "mouse", button: 0, pointerId: 1 };
  const layer = () => document.querySelector("[data-highlight-layer]") as HTMLElement;

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: 1000, bottom: 500, x: 0, y: 0, width: 1000, height: 500, toJSON: () => ({}),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function drag() {
    fireEvent.pointerDown(layer(), { ...mouse, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(layer(), { ...mouse, clientX: 300, clientY: 200 });
    fireEvent.pointerUp(layer(), { ...mouse, clientX: 300, clientY: 200 });
  }
  const updatePatches = () => update.mock.calls.map((c) => c[0] as Record<string, unknown>);

  it("puts the layer over the slide image and still shows the one image", () => {
    show(7);
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img").parentElement?.contains(layer())).toBe(true);
  });

  it("a drag on the slide does nothing until Mark the spot is on (no drag-first flow, no Keep highlight)", async () => {
    show(7);
    await settle();
    drag();
    await settle();
    expect(upsert).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Highlight" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Keep highlight/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark the spot" })).not.toBeInTheDocument();
  });

  it("I'm lost, then Mark the spot and a drag: the box is saved on that tap at once, drawn in the lost look", async () => {
    show(7);
    await settle();
    fireEvent.click(lost());
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    const row = upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(row).some((k) => k.startsWith("hl_"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Mark the spot" }));
    expect(screen.getByText("Drag over the part you lost")).toBeInTheDocument();
    drag();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(updatePatches()[0]).toEqual({ hl_x: 0.1, hl_y: 0.2, hl_w: 0.2, hl_h: 0.2 });
    expect(screen.queryByText(/Drag over/)).not.toBeInTheDocument();
    const box = document.querySelector("[data-highlight-box]") as HTMLElement;
    expect(box.className).toContain("bg-lost-tint");
    // Clear mark takes it back.
    fireEvent.click(screen.getByRole("button", { name: "Clear mark" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(updatePatches()[1]).toEqual({ hl_x: null, hl_y: null, hl_w: null, hl_h: null });
    expect(document.querySelector("[data-highlight-box]")).toBeNull();
  });

  it("Save this sends a private save on the slide being viewed and gives the strip an open dot", async () => {
    show(7);
    await settle();
    fireEvent.click(back());
    fireEvent.click(screen.getByRole("button", { name: "Save this" }));
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(upsert.mock.calls[0][0]).toMatchObject({ lecture_id: LECTURE, anon_id: STUDENT, kind: "save", tapped_on_slide: 6 });
    expect(within(strip()).getByRole("button", { name: "Slide 6, viewing, saved" })).toBeInTheDocument();
    // A save is not an I'm lost: the count goes up but does not turn red, and the button keeps its look.
    const count = screen.getByRole("link", { name: /My spots/ }).lastElementChild as HTMLElement;
    expect(count).toHaveTextContent("1");
    expect(count).not.toHaveAttribute("data-count-red");
    expect(lost()).toHaveAttribute("data-phase", "default");
  });

  it("hides the phone's Jump to live pill while marking, so it does not sit in the drag area", async () => {
    const { container } = show(7);
    await settle();
    fireEvent.click(back());
    fireEvent.click(lost());
    fireEvent.click(screen.getByRole("button", { name: "Mark the spot" }));
    expect(container.querySelector('[data-lecture-jump="pill"]')).toBeNull();
    expect(container.querySelector('[data-lecture-jump="side"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop marking" }));
    expect(container.querySelector('[data-lecture-jump="pill"]')).not.toBeNull();
  });

  it("drops a drag cut off by the slide changing: no dashed box is left on the next slide", async () => {
    show(7);
    await settle();
    fireEvent.click(lost());
    fireEvent.click(screen.getByRole("button", { name: "Mark the spot" }));
    fireEvent.pointerDown(layer(), { ...mouse, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(layer(), { ...mouse, clientX: 300, clientY: 200 });
    expect(document.querySelector("[data-highlight-box]")).not.toBeNull();
    teacherMoves(8);
    await waitFor(() => expect(layer()).not.toHaveAttribute("data-marking"));
    expect(document.querySelector("[data-highlight-box]")).toBeNull();
  });

  it("ends marking when the teacher moves a following student to the next slide", async () => {
    show(7);
    await settle();
    fireEvent.click(lost());
    fireEvent.click(screen.getByRole("button", { name: "Mark the spot" }));
    expect(layer()).toHaveAttribute("data-marking");
    teacherMoves(8);
    await waitFor(() => expect(layer()).not.toHaveAttribute("data-marking"));
    expect(screen.queryByText(/Drag over/)).not.toBeInTheDocument();
  });

  it("shows no hint text on the slide unless marking", () => {
    show(7);
    expect(screen.queryByText(/drag/i)).not.toBeInTheDocument();
  });
});
