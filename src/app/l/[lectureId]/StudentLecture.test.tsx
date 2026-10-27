import { Activity } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fakeSlideImages } from "../../../../tests/fakeSlides";
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
// The note limit's look at the database: from("slide_marks").select("id").limit(0).
const probe = vi.fn();
// The student's marks (migration 0020): rpc("my_slide_marks"), and the writes on slide_marks.
const myMarks = vi.fn();
const markUpsert = vi.fn();
const markUpdate = vi.fn();
const markUpdateFilters = vi.fn();
const markDelete = vi.fn();
// The student's notebook (migration 0020): from("notebook_notes").select(...).eq(...).order(...), and
// rpc("save_notebook_note").
const notebookRows = vi.fn();
const notebookSave = vi.fn();
const markWrite = vi.fn(async (): Promise<{ error: { code: string; message: string } | null; status: number }> => ({ error: null, status: 204 }));
// update(...).eq(...)[.eq(...).neq(...)], delete().eq(...): each step records its filter and can be awaited.
function filtered(record: (...a: unknown[]) => void) {
  const step: Record<string, unknown> = {
    eq: (...a: unknown[]) => (record("eq", ...a), step),
    neq: (...a: unknown[]) => (record("neq", ...a), step),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => markWrite().then(res, rej),
  };
  return step;
}
const from = vi.fn((table: string) =>
  table === "slide_marks"
    ? {
        select: () => ({ limit: probe }),
        upsert: markUpsert,
        update: (row: unknown) => (markUpdate(row), filtered((...a) => markUpdateFilters(row, ...a))),
        delete: () => filtered((...a) => markDelete(...a)),
      }
    : table === "notebook_notes"
    ? { select: () => ({ eq: () => ({ order: notebookRows }) }) }
    : table === "lost_taps"
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

import { forgetTeacherNoteMax } from "@/lib/noteLimit";
import { NOTEBOOK_PIN_MS, StudentLecture } from "./StudentLecture";

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
  [myMarks, markUpsert, markUpdate, markUpdateFilters, markDelete].forEach((m) => m.mockReset());
  markWrite.mockReset();
  markWrite.mockImplementation(async () => ({ error: null, status: 204 }));
  // Before 0020 there is no my_slide_marks function either.
  myMarks.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" }, status: 404 });
  markUpsert.mockResolvedValue({ error: null, status: 201 });
  rpc.mockImplementation((name: string, args: unknown) =>
    name === "my_slide_marks" ? myMarks(args) : name === "save_notebook_note" ? notebookSave(args) : undefined,
  );
  notebookRows.mockReset();
  notebookSave.mockReset();
  // Before 0020 there is no notebook either.
  notebookRows.mockResolvedValue({ data: null, error: { code: "PGRST205", message: "Could not find the table" }, status: 404 });
  notebookSave.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" }, status: 404 });
  localStorage.clear();
  sessionStorage.clear();
  forgetTeacherNoteMax();
  probe.mockReset();
  // The database before 0020 (production until it is applied): PostgREST has no slide_marks.
  probe.mockResolvedValue({ data: null, error: { code: "PGRST205", message: "Could not find the table" }, status: 404 });
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

  it("has a My spots link with the count in the top bar, and no theme button yet (Layout and Help only)", () => {
    show();
    const link = within(top()).getByRole("link", { name: /My spots/ });
    expect(link).toHaveAttribute("href", `/spots/${LECTURE}`);
    expect(link).toHaveTextContent("My spots0");
    expect(within(top()).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Layout", "Help"]);
  });

  // The note to the teacher, on a lost slide.
  const teacherNote = () => screen.getByRole("textbox", { name: /^Note for the teacher/ }) as HTMLTextAreaElement;

  it("the note to the teacher takes 140 characters while the database has no 0020", async () => {
    show();
    await settle();
    expect(probe).toHaveBeenCalledWith(0);
    fireEvent.click(lost());
    fireEvent.change(teacherNote(), { target: { value: "f".repeat(900) } });
    expect(teacherNote().value).toHaveLength(140);
  });

  it("the note to the teacher takes 2000 characters once the database has 0020", async () => {
    probe.mockResolvedValue({ data: [], error: null, status: 200 });
    show();
    await settle();
    await settle();
    fireEvent.click(lost());
    fireEvent.change(teacherNote(), { target: { value: "f".repeat(2500) } });
    await waitFor(() => expect(teacherNote().value).toHaveLength(2000));
  });

  it("the note to the teacher stays at 140 when the look at the database fails (offline)", async () => {
    probe.mockRejectedValue(new TypeError("Failed to fetch"));
    show();
    await settle();
    fireEvent.click(lost());
    fireEvent.change(teacherNote(), { target: { value: "f".repeat(900) } });
    expect(teacherNote().value).toHaveLength(140);
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
    // The sidebar's is in the sidebar, apart from the stack (slide, I'm lost, strip), so I'm lost never moves.
    expect(container.querySelector("[data-lecture-side]")).toContainElement(side);
    expect(container.querySelector("[data-lecture-stage]")).not.toContainElement(side);
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

  describe("slide moves", () => {
    const content = () => document.querySelector("[data-slide-content]") as HTMLElement;

    it("a move the student makes slides the new slide in: Back from the left; Forward, a later dot and Jump to live from the right", async () => {
      show(7);
      await settle();
      expect(content()).not.toHaveAttribute("data-move");
      fireEvent.click(back());
      expect(content()).toHaveAttribute("data-move", "back");
      expect(content().className).toContain("motion-safe:animate-slide-back");
      fireEvent.click(forward());
      expect(content()).toHaveAttribute("data-move", "next");
      expect(content().className).toContain("motion-safe:animate-slide-next");
      fireEvent.click(within(strip()).getByRole("button", { name: /^Slide 3\b/ }));
      expect(content()).toHaveAttribute("data-move", "back");
      expect(shownSrc()).toBe("https://signed/3.webp");
      fireEvent.click(within(strip()).getByRole("button", { name: /^Slide 5\b/ }));
      expect(content()).toHaveAttribute("data-move", "next");
      fireEvent.click(jumps(7)[0]);
      expect(content()).toHaveAttribute("data-move", "next");
      expect(shownSrc()).toBe("https://signed/7.webp");
    });

    it("each move starts the slide-in again on a fresh element, with the one slide image inside", async () => {
      show(7);
      await settle();
      fireEvent.click(back());
      const first = content();
      fireEvent.click(back());
      expect(content()).not.toBe(first);
      expect(content()).toHaveAttribute("data-move", "back");
      expect(screen.getAllByRole("img")).toHaveLength(1);
      expect(content()).toContainElement(screen.getByRole("img"));
    });

    it("the teacher moving a following student stays instant: no slide-in, the same element", async () => {
      show(7);
      await settle();
      teacherMoves(8);
      expect(shownSrc()).toBe("https://signed/8.webp");
      expect(content()).not.toHaveAttribute("data-move");
      // Also after the student moved and is following live again.
      fireEvent.click(back());
      fireEvent.click(forward());
      const el = content();
      teacherMoves(9);
      expect(shownSrc()).toBe("https://signed/9.webp");
      expect(content()).toBe(el);
      expect(content()).not.toHaveAttribute("data-move");
      expect(content().className).not.toMatch(/animate-slide/);
    });

    it("picking the dot already on screen does not slide anything", async () => {
      show(7);
      await settle();
      const el = content();
      fireEvent.click(within(strip()).getByRole("button", { name: /^Slide 7\b/ }));
      expect(content()).toBe(el);
      expect(content()).not.toHaveAttribute("data-move");
    });
  });

  it("has no note box in the panel any more; on a lost slide the note to the teacher sits at the top of the notebook and saves on the tap", async () => {
    show(7);
    await settle();
    expect(within(panel()).queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save note/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /^Note for the teacher/ })).not.toBeInTheDocument();
    fireEvent.click(lost());
    const notes = document.querySelector("[data-lecture-notes]") as HTMLElement;
    const slot = notes.querySelector("[data-teacher-slot]") as HTMLElement;
    expect(slot).toContainElement(teacherNote());
    // Above the notebook itself.
    expect(teacherNote().compareDocumentPosition(screen.getByRole("textbox", { name: "Your notes, slide 7" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    teacherNote().focus();
    fireEvent.change(teacherNote(), { target: { value: "lost on the accrual" } });
    fireEvent.keyDown(teacherNote(), { key: "Enter" });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ note: "lost on the accrual" }));
    expect(teacherNote()).toHaveValue("lost on the accrual");
  });

  it("Undo goes away 10 seconds after a tap; the tap stays and its dot stays", async () => {
    vi.useFakeTimers();
    try {
      show(7);
      await settle();
      fireEvent.click(lost());
      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Lost on slide 7" })).toBeInTheDocument();
      expect(within(strip()).getByRole("button", { name: /^Slide 7, live, you are here, you got lost here$/ })).toBeInTheDocument();
      expect(update).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
    expect(markUpsert).not.toHaveBeenCalled();
    expect(markUpdate).not.toHaveBeenCalled();
    expect(markDelete).not.toHaveBeenCalled();
    // The only call is the read of the student's own marks (and the notebook is only read).
    for (const call of rpc.mock.calls) expect(call[0]).toBe("my_slide_marks");
    expect(screen.queryByRole("button", { name: /Lost on slide/ })).not.toBeInTheDocument();
    // Only the reads of the lecture row happened.
    await waitFor(() => expect(single).toHaveBeenCalled());
    // Reads only: the lecture row, the student's own rows, and the look for 0020 (the note limit).
    for (const call of from.mock.calls as unknown as string[][]) expect(["lectures", "lost_taps", "slide_marks", "notebook_notes"]).toContain(call[0]);
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
      const box = img.closest("[data-slide]") as HTMLElement;
      expect(box).not.toBeNull();
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
      expect(within(strip()).getByRole("button", { name: "Slide 5, you are here" })).toHaveAttribute("aria-current", "true");
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
      await waitFor(() => expect(within(strip()).getByRole("button", { name: "Slide 3, you got lost here" })).toBeInTheDocument());
      expect(within(strip()).getByRole("button", { name: "Slide 5, you saved this" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /My spots/ })).toHaveTextContent("My spots2");
      expect(within(strip()).getByRole("button", { name: "Slide 7, live, you are here" })).toBeInTheDocument();
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
      // The panel sits right under the slide and the strip right under the panel (hand test 4), all in the stack.
      expect(panel().previousElementSibling).toHaveAttribute("data-lecture-slide");
      expect(navRow.previousElementSibling).toBe(panel());
      expect(panel().parentElement).toHaveAttribute("data-lecture-stage");
    });

    it("the notebook is outside the sidebar and the stack, after the handle, so it can sit beside the slide or under the strip", () => {
      show();
      const notes = document.querySelector("[data-lecture-notes]") as HTMLElement;
      const lecture = document.querySelector("[data-lecture]") as HTMLElement;
      expect(notes.parentElement).toBe(lecture);
      expect(document.querySelector("[data-lecture-side]")).not.toContainElement(notes);
      const handle = screen.getByRole("separator", { name: "Slide size" });
      expect(handle.parentElement).toBe(lecture);
      expect(handle.nextElementSibling).toBe(notes);
      expect(document.querySelector("[data-lecture-stage]")!.compareDocumentPosition(handle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // The note to the teacher is still put at the top of the notebook.
      expect(notes.firstElementChild).toHaveAttribute("data-teacher-slot");
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
      expect(screen.getByRole("button", { name: "Lost on slide 6" })).toHaveAttribute("aria-pressed", "true");
      expect(within(strip()).getByRole("button", { name: "Slide 6, you are here, you got lost here" })).toBeInTheDocument();
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
      await waitFor(() => expect(within(strip()).getByRole("button", { name: "Slide 3, you got lost here" })).toBeInTheDocument());
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
        expect(within(strip()).getByRole("button", { name: "Slide 7, live, you are here" })).toBeInTheDocument();
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

describe("StudentLecture marks before migration 0020 (one per slide, on the tap)", () => {
  const mouse = { pointerType: "mouse", button: 0, pointerId: 1 };
  const layer = () => document.querySelector("[data-highlight-layer]") as HTMLElement;
  const markTool = () => screen.getByRole("button", { name: "Mark" });

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

  it("a drag on the slide does nothing until Mark is on (no drag-first flow, no Keep highlight)", async () => {
    show(7);
    await settle();
    drag();
    await settle();
    expect(upsert).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Highlight" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Keep highlight/i)).not.toBeInTheDocument();
    expect(markTool()).toHaveAttribute("aria-pressed", "false");
  });

  it("I'm lost, then Mark and a drag: the box is saved on that tap at once, drawn red, and Delete in its popover takes it back", async () => {
    show(7);
    await settle();
    fireEvent.click(lost());
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    const row = upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(row).some((k) => k.startsWith("hl_"))).toBe(false);
    fireEvent.click(markTool());
    expect(screen.getByText("Drag over the part you lost")).toBeInTheDocument();
    drag();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(updatePatches()[0]).toEqual({ hl_x: 0.1, hl_y: 0.2, hl_w: 0.2, hl_h: 0.2 });
    // Nothing goes to slide_marks before 0020.
    expect(markUpsert).not.toHaveBeenCalled();
    const box = screen.getByRole("button", { name: "Mark 1, lost" });
    expect(box.className).toContain("bg-mark-lost");
    fireEvent.click(markTool());
    fireEvent.click(box, { detail: 1 });
    const pop = screen.getByRole("dialog", { name: "Mark 1" });
    // No note of its own before 0020 (the tap's note is the note to the teacher).
    expect(within(pop).queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(within(pop).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(updatePatches()[1]).toEqual({ hl_x: null, hl_y: null, hl_w: null, hl_h: null });
    expect(document.querySelector("[data-highlight-box]")).toBeNull();
  });

  it("Mark on a slide with no spot saves it just for the student with the box, drawn yellow", async () => {
    show(7);
    await settle();
    fireEvent.click(markTool());
    expect(screen.getByText("Drag over the part to keep")).toBeInTheDocument();
    drag();
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(upsert.mock.calls[0][0]).toMatchObject({ kind: "save", tapped_on_slide: 7, hl_x: 0.1, hl_y: 0.2, hl_w: 0.2, hl_h: 0.2 });
    expect(screen.getByRole("button", { name: "Mark 1" }).className).toContain("bg-mark");
  });

  it("Save this sends a private save on the slide being viewed and gives the strip an open dot", async () => {
    show(7);
    await settle();
    fireEvent.click(back());
    fireEvent.click(screen.getByRole("button", { name: "Save this" }));
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(upsert.mock.calls[0][0]).toMatchObject({ lecture_id: LECTURE, anon_id: STUDENT, kind: "save", tapped_on_slide: 6 });
    expect(within(strip()).getByRole("button", { name: "Slide 6, you are here, you saved this" })).toBeInTheDocument();
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
    fireEvent.click(markTool());
    expect(container.querySelector('[data-lecture-jump="pill"]')).toBeNull();
    expect(container.querySelector('[data-lecture-jump="side"]')).not.toBeNull();
    fireEvent.click(markTool());
    expect(container.querySelector('[data-lecture-jump="pill"]')).not.toBeNull();
  });

  it("drops a drag cut off by the slide changing: no box is left half drawn on the next slide", async () => {
    show(7);
    await settle();
    fireEvent.click(markTool());
    fireEvent.pointerDown(layer(), { ...mouse, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(layer(), { ...mouse, clientX: 300, clientY: 200 });
    expect(document.querySelector("[data-mark-draft]")).not.toBeNull();
    teacherMoves(8);
    await waitFor(() => expect(layer()).not.toHaveAttribute("data-marking"));
    expect(document.querySelector("[data-mark-draft]")).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("ends marking when the teacher moves a following student to the next slide", async () => {
    show(7);
    await settle();
    fireEvent.click(markTool());
    expect(layer()).toHaveAttribute("data-marking");
    teacherMoves(8);
    await waitFor(() => expect(layer()).not.toHaveAttribute("data-marking"));
    expect(screen.queryByText(/Drag over/)).not.toBeInTheDocument();
  });

  it("shows no hint text on the slide unless marking", () => {
    show(7);
    expect(screen.queryByText(/drag/i)).not.toBeInTheDocument();
  });

  it("when the page is shown again (back from My spots), a mark cleared there is gone: no stale mark, no Clear mark", async () => {
    // The hand test 3 bug: My spots cleared the mark, the live lecture still showed it.
    ownRows.mockResolvedValue({ data: [{ id: "t1", slide_number: 7, kind: "lost", note: null, hl_x: 0.1, hl_y: 0.2, hl_w: 0.2, hl_h: 0.2 }], error: null, status: 200 });
    const view = render(
      <Activity mode="visible">
        <StudentLecture lectureId={LECTURE} lectureName="Lecture 3, Oct 26" courseName="IMS 452" initialSlide={7} />
      </Activity>,
    );
    await waitFor(() => expect(document.querySelectorAll("[data-highlight-box]")).toHaveLength(1));
    view.rerender(
      <Activity mode="hidden">
        <StudentLecture lectureId={LECTURE} lectureName="Lecture 3, Oct 26" courseName="IMS 452" initialSlide={7} />
      </Activity>,
    );
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    // In My spots: Clear mark (the tap keeps its I'm lost).
    ownRows.mockResolvedValue({ data: [{ id: "t1", slide_number: 7, kind: "lost", note: null, hl_x: null, hl_y: null, hl_w: null, hl_h: null }], error: null, status: 200 });
    view.rerender(
      <Activity mode="visible">
        <StudentLecture lectureId={LECTURE} lectureName="Lecture 3, Oct 26" courseName="IMS 452" initialSlide={7} />
      </Activity>,
    );
    await waitFor(() => expect(document.querySelectorAll("[data-highlight-box]")).toHaveLength(0));
    expect(screen.queryByRole("button", { name: /Clear mark/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lost on slide 7" })).toBeInTheDocument();
  });
});

describe("StudentLecture marks (migration 0020: several per slide, in slide_marks)", () => {
  const mouse = { pointerType: "mouse", button: 0, pointerId: 1 };
  const layer = () => document.querySelector("[data-highlight-layer]") as HTMLElement;
  const markTool = () => screen.getByRole("button", { name: "Mark" });
  const marksShown = () => Array.from(document.querySelectorAll<HTMLElement>("[data-mark]"));
  const markRow = (over: Record<string, unknown> = {}) => ({
    id: "m1", lecture_id: LECTURE, slide_number: 7, x: 0.1, y: 0.1, w: 0.2, h: 0.1, kind: "save", note: null,
    created_at: "2026-10-26T14:00:00Z", updated_at: "2026-10-26T14:00:00Z", ...over,
  });

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: 1000, bottom: 500, x: 0, y: 0, width: 1000, height: 500, toJSON: () => ({}),
    });
    probe.mockResolvedValue({ data: [], error: null, status: 200 });
    myMarks.mockResolvedValue({ data: [], error: null, status: 200 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function drag(from: [number, number] = [100, 100], to: [number, number] = [300, 200]) {
    fireEvent.pointerDown(layer(), { ...mouse, clientX: from[0], clientY: from[1] });
    fireEvent.pointerMove(layer(), { ...mouse, clientX: to[0], clientY: to[1] });
    fireEvent.pointerUp(layer(), { ...mouse, clientX: to[0], clientY: to[1] });
  }

  it("Mark is there without Save this or I'm lost; two drags make two yellow marks, each its own row with a new id", async () => {
    show(7);
    await settle();
    fireEvent.click(markTool());
    drag();
    drag([500, 250], [800, 400]);
    await waitFor(() => expect(markUpsert).toHaveBeenCalledTimes(2));
    const [a, b] = markUpsert.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(a).toMatchObject({ lecture_id: LECTURE, slide_number: 7, x: 0.1, y: 0.2, w: 0.2, h: 0.2, kind: "save" });
    expect(b).toMatchObject({ slide_number: 7, x: 0.5, y: 0.5, kind: "save" });
    expect(a.id).not.toBe(b.id);
    expect(markUpsert.mock.calls[0][1]).toEqual({ onConflict: "id", ignoreDuplicates: true });
    // No tap: nothing goes to lost_taps (the marks make the slide a spot on their own).
    expect(upsert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(marksShown()).toHaveLength(2);
    for (const m of marksShown()) {
      expect(m.className).toContain("bg-mark");
      expect(m.className).not.toMatch(/border/);
    }
    // The tool stays on for the next one.
    expect(markTool()).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the student's own marks from slide_marks on the live slide, never a tap's old highlight", async () => {
    ownRows.mockResolvedValue({ data: [{ id: "t1", slide_number: 7, kind: "save", note: null, hl_x: 0.6, hl_y: 0.6, hl_w: 0.2, hl_h: 0.2 }], error: null, status: 200 });
    myMarks.mockResolvedValue({ data: [markRow(), markRow({ id: "m2", slide_number: 5 })], error: null, status: 200 });
    show(7);
    await waitFor(() => expect(marksShown()).toHaveLength(1));
    expect(marksShown()[0]).toHaveAttribute("data-mark", "m1");
    expect(myMarks).toHaveBeenCalledWith({ p_lecture_id: LECTURE });
  });

  it("measures a slide only when it has marks or Mark is on: a slide without marks is not downloaded again (review I4)", async () => {
    const fake = fakeSlideImages(() => "black");
    try {
      show(7);
      await settle();
      await act(async () => new Promise((r) => setTimeout(r, 50)));
      expect(fake.loads).toEqual([]);
      // Turning Mark on starts measuring, before the first drag ends.
      fireEvent.click(markTool());
      await waitFor(() => expect(fake.loads.map((l) => l.url)).toEqual(["https://signed/7.webp"]));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("on a black slide the marks glow instead of multiplying into black (hand test 4); a white slide keeps the highlighter", async () => {
    const fake = fakeSlideImages((url) => (url.endsWith("/7.webp") ? "black" : "white"));
    try {
      myMarks.mockResolvedValue({ data: [markRow(), markRow({ id: "m6", slide_number: 6 })], error: null, status: 200 });
      show(7);
      await waitFor(() => expect(marksShown()[0]).toHaveAttribute("data-tone", "dark"));
      expect(document.querySelector("[data-glow-layer]")!.className).toContain("mix-blend-screen");
      expect(document.querySelector('[data-glow-box="m1"]')!.className).toContain("mark-glow");
      expect(marksShown()[0].className).not.toContain("mix-blend-multiply");
      // The slide on screen is measured once, read with CORS so the canvas can be read.
      expect(fake.loads).toContainEqual({ url: "https://signed/7.webp", crossOrigin: "anonymous" });
      // A new mark drawn there glows too.
      fireEvent.click(markTool());
      drag([500, 250], [800, 400]);
      await waitFor(() => expect(marksShown()).toHaveLength(2));
      expect(marksShown()[1]).toHaveAttribute("data-tone", "dark");
      fireEvent.keyDown(window, { key: "Escape" });
      fireEvent.click(back());
      await waitFor(() => expect(marksShown()[0]).toHaveAttribute("data-mark", "m6"));
      await waitFor(() => expect(marksShown()[0]).toHaveAttribute("data-tone", "light"));
      expect(marksShown()[0].className).toContain("mix-blend-multiply bg-mark");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a mark on a lost slide is red and saved as lost", async () => {
    show(7);
    await settle();
    fireEvent.click(lost());
    fireEvent.click(markTool());
    drag();
    await waitFor(() => expect(markUpsert).toHaveBeenCalledTimes(1));
    expect(markUpsert.mock.calls[0][0]).toMatchObject({ kind: "lost" });
    expect(screen.getByRole("button", { name: "Mark 1, lost" }).className).toContain("bg-mark-lost");
  });

  it("I'm lost turns the slide's yellow marks red (one update); taking it back turns them yellow again", async () => {
    myMarks.mockResolvedValue({ data: [markRow(), markRow({ id: "m2", x: 0.5, y: 0.5 })], error: null, status: 200 });
    show(7);
    await waitFor(() => expect(marksShown()).toHaveLength(2));
    for (const m of marksShown()) expect(m).toHaveAttribute("data-kind", "save");
    fireEvent.click(lost());
    for (const m of marksShown()) expect(m).toHaveAttribute("data-kind", "lost");
    // A moment later nothing puts it back (the kind follows the press, not an in-between state).
    await act(async () => new Promise((r) => setTimeout(r, 1200)));
    await waitFor(() => expect(markUpdate).toHaveBeenCalledTimes(1));
    expect(markUpdate).toHaveBeenLastCalledWith({ kind: "lost" });
    expect(markUpdateFilters.mock.calls.map((c) => c.slice(1))).toEqual([
      ["eq", "lecture_id", LECTURE],
      ["eq", "slide_number", 7],
      ["neq", "kind", "lost"],
    ]);
    // A moment later, the checked button takes it back.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
    fireEvent.click(screen.getByRole("button", { name: "Lost on slide 7" }), { detail: 1 });
    for (const m of marksShown()) expect(m).toHaveAttribute("data-kind", "save");
    await waitFor(() => expect(markUpdate).toHaveBeenCalledTimes(2));
    expect(markUpdate).toHaveBeenLastCalledWith({ kind: "save" });
    expect(screen.getByRole("button", { name: "I'm lost" })).toBeInTheDocument();
    expect(screen.getByText("Removed")).toBeInTheDocument();
  });

  it("Undo of I'm lost turns the marks yellow again", async () => {
    myMarks.mockResolvedValue({ data: [markRow()], error: null, status: 200 });
    show(7);
    await waitFor(() => expect(marksShown()).toHaveLength(1));
    fireEvent.click(lost());
    expect(marksShown()[0]).toHaveAttribute("data-kind", "lost");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }), { detail: 1 });
    expect(marksShown()[0]).toHaveAttribute("data-kind", "save");
    await waitFor(() => expect(markUpdate).toHaveBeenLastCalledWith({ kind: "save" }));
  });

  it("a click on a mark opens its popover; the note saves by itself (no submit) and Delete removes the mark", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      myMarks.mockResolvedValue({ data: [markRow(), markRow({ id: "m2", x: 0.5, y: 0.5, note: "older" })], error: null, status: 200 });
      show(7);
      await act(async () => vi.advanceTimersByTimeAsync(0));
      await act(async () => vi.advanceTimersByTimeAsync(0));
      expect(marksShown()).toHaveLength(2);
      const second = screen.getByRole("button", { name: "Mark 2: older" });
      fireEvent.click(second, { detail: 1 });
      expect(second).toHaveAttribute("aria-expanded", "true");
      const pop = screen.getByRole("dialog", { name: "Mark 2" });
      const field = within(pop).getByRole("textbox", { name: "Note on this mark" });
      expect(field).toHaveValue("older");
      expect(within(pop).queryByRole("button", { name: /save|submit/i })).not.toBeInTheDocument();
      fireEvent.change(field, { target: { value: "ask in office hours" } });
      expect(markUpdate).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTimeAsync(600));
      expect(markUpdate).toHaveBeenCalledWith({ note: "ask in office hours" });
      expect(markUpdateFilters).toHaveBeenCalledWith({ note: "ask in office hours" }, "eq", "id", "m2");
      expect(within(pop).getByText("Saved")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Mark 2: ask in office hours" })).toBeInTheDocument();
      fireEvent.click(within(pop).getByRole("button", { name: "Delete" }));
      await act(async () => vi.advanceTimersByTimeAsync(0));
      expect(markDelete).toHaveBeenCalledWith("eq", "id", "m2");
      expect(marksShown().map((m) => m.dataset.mark)).toEqual(["m1"]);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("with the keyboard: Enter on a mark opens the popover with the focus in the note; Esc closes it and the focus goes back", async () => {
    myMarks.mockResolvedValue({ data: [markRow()], error: null, status: 200 });
    show(7);
    await waitFor(() => expect(marksShown()).toHaveLength(1));
    const mark = screen.getByRole("button", { name: "Mark 1" });
    mark.focus();
    // Enter or Space on a button is a click with detail 0.
    fireEvent.click(mark, { detail: 0 });
    const field = screen.getByRole("textbox", { name: "Note on this mark" });
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: "x" } });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mark).toHaveFocus();
    // Closing saved the note at once.
    await waitFor(() => expect(markUpdate).toHaveBeenCalledWith({ note: "x" }));
  });

  it("a press outside the popover closes it; another slide closes it too", async () => {
    myMarks.mockResolvedValue({ data: [markRow()], error: null, status: 200 });
    show(7);
    await waitFor(() => expect(marksShown()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Mark 1" }), { detail: 1 });
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark 1" }), { detail: 1 });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(back());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a press on I'm lost while a mark's popover is open records the tap at once and closes the popover", async () => {
    myMarks.mockResolvedValue({ data: [markRow()], error: null, status: 200 });
    show(7);
    await waitFor(() => expect(marksShown()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Mark 1" }), { detail: 1 });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.pointerDown(lost());
    fireEvent.click(lost());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lost on slide 7" })).toBeInTheDocument();
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
  });

  it("a double click on a mark leaves its popover open", async () => {
    myMarks.mockResolvedValue({ data: [markRow()], error: null, status: 200 });
    show(7);
    await waitFor(() => expect(marksShown()).toHaveLength(1));
    const mark = screen.getByRole("button", { name: "Mark 1" });
    fireEvent.click(mark, { detail: 1 });
    fireEvent.click(mark, { detail: 2 });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Tab out of the popover closes it", async () => {
    myMarks.mockResolvedValue({ data: [markRow()], error: null, status: 200 });
    show(7);
    await waitFor(() => expect(marksShown()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Mark 1" }), { detail: 0 });
    const field = screen.getByRole("textbox", { name: "Note on this mark" });
    fireEvent.blur(field, { relatedTarget: forward() });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("cuts a long mark note by whole characters, never half an emoji", async () => {
    myMarks.mockResolvedValue({ data: [markRow()], error: null, status: 200 });
    show(7);
    await waitFor(() => expect(marksShown()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Mark 1" }), { detail: 0 });
    const field = screen.getByRole("textbox", { name: "Note on this mark" }) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "a".repeat(1999) + "😀😀" } });
    expect(field.value).toBe("a".repeat(1999) + "😀");
  });

  it("a slide with only marks is a spot: a yellow dot in the strip, and it counts in My spots", async () => {
    show(7);
    await settle();
    const count = () => screen.getByRole("link", { name: /My spots/ }).lastElementChild as HTMLElement;
    expect(count()).toHaveTextContent("0");
    fireEvent.click(markTool());
    drag();
    const dot = within(strip()).getByRole("button", { name: "Slide 7, live, you are here, you marked this" });
    expect(dot.querySelector("[data-spot]")).toHaveAttribute("data-spot", "mark");
    expect(dot.querySelector("[data-spot]")!.className).toContain("bg-mark");
    expect(count()).toHaveTextContent("1");
    // I'm lost on it: one spot, red.
    fireEvent.click(lost());
    expect(count()).toHaveTextContent("1");
    expect(within(strip()).getByRole("button", { name: /^Slide 7, .*you got lost here$/ })).toBeInTheDocument();
  });

  it("marks on another slide show its yellow dot and count, read from slide_marks", async () => {
    myMarks.mockResolvedValue({ data: [markRow({ slide_number: 4 }), markRow({ id: "m2", slide_number: 4, x: 0.5 })], error: null, status: 200 });
    show(7);
    await waitFor(() => expect(within(strip()).getByRole("button", { name: "Slide 4, you marked this" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /My spots/ }).lastElementChild).toHaveTextContent("1");
  });

  it("puts the stored kind right once the taps and marks are read: a yellow mark on a lost slide becomes lost, a red one elsewhere save", async () => {
    ownRows.mockResolvedValue({ data: [{ id: "t1", slide_number: 7, kind: "lost", note: null, hl_x: null, hl_y: null, hl_w: null, hl_h: null }], error: null, status: 200 });
    myMarks.mockResolvedValue({ data: [markRow({ kind: "save" }), markRow({ id: "m2", slide_number: 5, kind: "lost" })], error: null, status: 200 });
    // Fake timers (they still run on their own), so the 1 s reconcile does not race a busy machine.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      show(7);
      for (let i = 0; i < 6 && markUpdate.mock.calls.length < 2; i++) await act(async () => vi.advanceTimersByTimeAsync(500));
      expect(markUpdate).toHaveBeenCalledTimes(2);
      const asked = markUpdateFilters.mock.calls.filter((c) => c[1] === "eq" && c[2] === "slide_number").map((c) => [c[0], c[3]]);
      expect(asked).toEqual(expect.arrayContaining([[{ kind: "lost" }, 7], [{ kind: "save" }, 5]]));
      // Asked once, not again and again.
      for (let i = 0; i < 4; i++) await act(async () => vi.advanceTimersByTimeAsync(500));
      expect(markUpdate).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks for a kind change once even when the database refuses it slowly (K1 re-review N1)", async () => {
    ownRows.mockResolvedValue({ data: [{ id: "t1", slide_number: 7, kind: "lost", note: null, hl_x: null, hl_y: null, hl_w: null, hl_h: null }], error: null, status: 200 });
    myMarks.mockResolvedValue({ data: [markRow({ kind: "save" })], error: null, status: 200 });
    // Refused 1.2 s after it is sent: longer than the 1 s the reconcile waits.
    markWrite.mockImplementation(
      () => new Promise((r) => setTimeout(() => r({ error: { code: "42501", message: "permission denied" }, status: 403 }), 1200)),
    );
    show(7);
    await waitFor(() => expect(markUpdate).toHaveBeenCalledTimes(1), { timeout: 3000 });
    // In short steps, so the screen redraws in between (as it would in a browser).
    for (let i = 0; i < 8; i++) await act(async () => new Promise((r) => setTimeout(r, 400)));
    expect(markUpdate).toHaveBeenCalledTimes(1);
  }, 10_000);

  it("reads the marks again after taking a tap back (0020's trigger can delete an old highlight with it)", async () => {
    ownRows.mockResolvedValue({ data: [{ id: "t1", slide_number: 7, kind: "save", note: null, hl_x: null, hl_y: null, hl_w: null, hl_h: null }], error: null, status: 200 });
    show(7);
    await waitFor(() => expect(screen.getByRole("button", { name: "Saved for you" })).toBeInTheDocument());
    const reads = myMarks.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Saved for you" }), { detail: 1 });
    await waitFor(() => expect(myMarks.mock.calls.length).toBeGreaterThan(reads));
  });

  it("Undo of Removed still waiting after a reload: the slide is lost and its marks are red again", async () => {
    localStorage.setItem(
      `backtrack:queue:${LECTURE}`,
      JSON.stringify([
        { op: "update", id: "t1", patch: { undone: true } },
        { op: "update", id: "t1", patch: { undone: false }, spot: { slide: 7, kind: "lost" } },
      ]),
    );
    update.mockReturnValue({ eq: vi.fn(async () => ({ error: { code: "", message: "TypeError: Failed to fetch" }, status: 0 })) });
    ownRows.mockResolvedValue({ data: [], error: null, status: 200 });
    myMarks.mockResolvedValue({ data: [markRow({ kind: "save" })], error: null, status: 200 });
    show(7);
    await waitFor(() => expect(screen.getByRole("button", { name: "Lost on slide 7" })).toBeInTheDocument());
    await waitFor(() => expect(marksShown()[0]).toHaveAttribute("data-kind", "lost"));
    await waitFor(() => expect(markUpdate).toHaveBeenCalledWith({ kind: "lost" }));
  });

  it("the student sees their marks again on the slide after going away and back", async () => {
    myMarks.mockResolvedValue({ data: [markRow({ slide_number: 6 })], error: null, status: 200 });
    show(7);
    await settle();
    expect(marksShown()).toHaveLength(0);
    fireEvent.click(back());
    await waitFor(() => expect(marksShown()).toHaveLength(1));
    fireEvent.click(forward());
    expect(marksShown()).toHaveLength(0);
  });

  it("when the page is shown again (back from My spots), it reads the marks again: a mark deleted there is gone", async () => {
    myMarks.mockResolvedValue({ data: [markRow(), markRow({ id: "m2", x: 0.5 })], error: null, status: 200 });
    const page = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <StudentLecture lectureId={LECTURE} lectureName="Lecture 3, Oct 26" courseName="IMS 452" initialSlide={7} />
      </Activity>
    );
    const view = render(page("visible"));
    await waitFor(() => expect(marksShown()).toHaveLength(2));
    view.rerender(page("hidden"));
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    // In My spots: one mark deleted.
    myMarks.mockResolvedValue({ data: [markRow({ id: "m2", x: 0.5 })], error: null, status: 200 });
    view.rerender(page("visible"));
    await waitFor(() => expect(marksShown().map((m) => m.dataset.mark)).toEqual(["m2"]));
  });

  it("keeps a mark made here that is still waiting to be sent when the marks are read again", async () => {
    markUpsert.mockResolvedValue({ error: { code: "", message: "TypeError: Failed to fetch" }, status: 0 });
    show(7);
    await settle();
    fireEvent.click(markTool());
    drag();
    await waitFor(() => expect(markUpsert).toHaveBeenCalledTimes(1));
    expect(marksShown()).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(`backtrack:marks:${LECTURE}`) ?? "[]")).toHaveLength(1);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(myMarks).toHaveBeenCalledTimes(2));
    expect(marksShown()).toHaveLength(1);
  });

  it("says when a slide has too many marks", async () => {
    markUpsert.mockResolvedValue({ error: { code: "BT429", message: "Too many marks on this slide." }, status: 400 });
    show(7);
    await settle();
    fireEvent.click(markTool());
    drag();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Too many marks on this slide."));
    expect(marksShown()).toHaveLength(0);
  });
});

describe("StudentLecture notebook (batch K2: typed on the page, one private note per slide)", () => {
  const notes = () => document.querySelector("[data-lecture-notes]") as HTMLElement;
  const notebook = (n = 7) => screen.getByRole("textbox", { name: `Your notes, slide ${n}` }) as HTMLTextAreaElement;
  const NB_KEY = `backtrack:notebook:${LECTURE}`;
  const saves = () => notebookSave.mock.calls.map((c) => c[0] as { p_slide_number: number; p_body: string });

  beforeEach(() => {
    probe.mockResolvedValue({ data: [], error: null, status: 200 });
    myMarks.mockResolvedValue({ data: [], error: null, status: 200 });
    notebookRows.mockResolvedValue({ data: [{ slide_number: 6, body: "six", updated_at: "2026-10-26T14:00:00Z" }], error: null, status: 200 });
    notebookSave.mockResolvedValue({ data: "2026-10-26T14:01:00Z", error: null, status: 200 });
  });

  it("is a field straight on the page (no box, no button), outside the panel, that follows the slide on screen", async () => {
    show(7);
    await settle();
    const field = notebook();
    expect(notes()).toContainElement(field);
    expect(panel()).not.toContainElement(field);
    expect(field.className).toContain("bg-ruled");
    expect(field.className).toContain("border-0");
    expect(field).toHaveAttribute("placeholder", "Your notes");
    expect(within(notes()).queryByRole("button")).not.toBeInTheDocument();
    fireEvent.click(back());
    await waitFor(() => expect(notebook(6)).toHaveValue("six"));
    fireEvent.click(forward());
    expect(notebook(7)).toHaveValue("");
  });

  it("saves by itself after a pause (save_notebook_note), then says Saved quietly", async () => {
    show(7);
    await settle();
    fireEvent.change(notebook(), { target: { value: "accrual = earned, not paid" } });
    expect(notebookSave).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(NB_KEY) ?? "{}")).toEqual({ "7": "accrual = earned, not paid" });
    await waitFor(() => expect(notebookSave).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(saves()[0]).toEqual({ p_lecture_id: LECTURE, p_slide_number: 7, p_body: "accrual = earned, not paid" });
    await waitFor(() => expect(within(notes()).getByRole("status")).toHaveTextContent("Saved"));
    expect(localStorage.getItem(NB_KEY)).toBeNull();
    // Saved means saved: nothing that explains it.
    expect(within(notes()).getByRole("status").textContent).toBe("Saved");
  });

  it("saves at once when the field loses the focus and when the slide changes", async () => {
    show(7);
    await settle();
    fireEvent.change(notebook(), { target: { value: "first" } });
    fireEvent.blur(notebook());
    await waitFor(() => expect(saves()).toEqual([expect.objectContaining({ p_slide_number: 7, p_body: "first" })]));
    fireEvent.change(notebook(), { target: { value: "second" } });
    fireEvent.click(back());
    await waitFor(() => expect(saves().at(-1)).toEqual(expect.objectContaining({ p_slide_number: 7, p_body: "second" })));
  });

  it("typing on while the teacher moves on keeps the notes on their slide (Slide 7), never splitting them (K2 review I2)", async () => {
    show(7);
    await settle();
    await act(async () => channelStatus("SUBSCRIBED"));
    const field = notebook(7);
    field.focus();
    fireEvent.change(field, { target: { value: "accrual means the" } });
    teacherMoves(8);
    // Still slide 7's notes, with its number shown quietly.
    expect(screen.getByRole("textbox", { name: "Your notes, slide 7" })).toBe(field);
    expect(field).toHaveValue("accrual means the");
    expect(document.querySelector("[data-notebook-slide]")).toHaveTextContent("Slide 7");
    fireEvent.change(field, { target: { value: "accrual means the revenue is earned" } });
    fireEvent.blur(field);
    await waitFor(() => expect(saves().at(-1)).toEqual(expect.objectContaining({ p_slide_number: 7, p_body: "accrual means the revenue is earned" })));
    expect(saves().some((c) => c.p_slide_number === 8)).toBe(false);
    // Let go: the field follows the slide on screen again.
    expect(notebook(8)).toHaveValue("");
    expect(document.querySelector("[data-notebook-slide]")).toHaveTextContent("");
  });

  it("a slide change the student makes lets go of the notes at once, even when the field keeps the focus (K2 re-review N6)", async () => {
    show(7);
    await settle();
    await act(async () => channelStatus("SUBSCRIBED"));
    const field = notebook(7);
    field.focus();
    fireEvent.change(field, { target: { value: "seven" } });
    teacherMoves(8);
    expect(notebook(7)).toBe(field);
    // A tap on a strip dot (on a phone it may not blur the field).
    fireEvent.click(within(strip()).getByRole("button", { name: /^Slide 5\b/ }));
    expect(screen.getByRole("textbox", { name: "Your notes, slide 5" })).toBe(field);
    expect(document.querySelector("[data-notebook-slide]")).toHaveTextContent("");
    await waitFor(() => expect(saves()).toEqual([expect.objectContaining({ p_slide_number: 7, p_body: "seven" })]));
  });

  it("keeps the notes on their slide while an IME composition is open, past the pause", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      show(7);
      await settle();
      await act(async () => channelStatus("SUBSCRIBED"));
      const field = notebook(7);
      fireEvent.compositionStart(field);
      fireEvent.change(field, { target: { value: "かいけい" } });
      teacherMoves(8);
      await act(async () => vi.advanceTimersByTimeAsync(NOTEBOOK_PIN_MS * 2));
      expect(screen.getByRole("textbox", { name: "Your notes, slide 7" })).toBe(field);
      fireEvent.compositionEnd(field);
      await act(async () => vi.advanceTimersByTimeAsync(NOTEBOOK_PIN_MS));
      expect(screen.getByRole("textbox", { name: "Your notes, slide 8" })).toBe(field);
    } finally {
      vi.useRealTimers();
    }
  });

  it("after a pause in typing the notes follow the slide on screen again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      show(7);
      await settle();
      await act(async () => channelStatus("SUBSCRIBED"));
      fireEvent.change(notebook(7), { target: { value: "seven" } });
      teacherMoves(8);
      expect(notebook(7)).toHaveValue("seven");
      await act(async () => vi.advanceTimersByTimeAsync(NOTEBOOK_PIN_MS));
      expect(notebook(8)).toHaveValue("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("offline: keeps the text on the device, says so, and sends it when the browser is back online", async () => {
    notebookSave.mockRejectedValue(new TypeError("Failed to fetch"));
    show(7);
    await settle();
    fireEvent.change(notebook(), { target: { value: "on the train" } });
    fireEvent.blur(notebook());
    await waitFor(() => expect(within(notes()).getByRole("status")).toHaveTextContent("Saved on this device"));
    expect(JSON.parse(localStorage.getItem(NB_KEY) ?? "{}")).toEqual({ "7": "on the train" });
    notebookSave.mockResolvedValue({ data: "x", error: null, status: 200 });
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(within(notes()).getByRole("status")).toHaveTextContent(/^Saved$/));
    expect(localStorage.getItem(NB_KEY)).toBeNull();
  });

  it("the page hidden: the text is on the device before the save goes out", async () => {
    let finish: (v: unknown) => void = () => {};
    notebookSave.mockImplementation(() => new Promise((r) => (finish = r)));
    show(7);
    await settle();
    // The copy made while typing did not land (storage full for a moment).
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new Error("full");
    });
    fireEvent.change(notebook(), { target: { value: "typed then hidden" } });
    setItem.mockRestore();
    expect(localStorage.getItem(NB_KEY)).toBeNull();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(JSON.parse(localStorage.getItem(NB_KEY) ?? "{}")).toEqual({ "7": "typed then hidden" });
    expect(notebookSave).toHaveBeenCalledTimes(1);
    await act(async () => finish({ data: "x", error: null, status: 200 }));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("text left on the device by the last visit shows at once and is sent", async () => {
    localStorage.setItem(NB_KEY, JSON.stringify({ "7": "from last time" }));
    show(7);
    await settle();
    expect(notebook()).toHaveValue("from last time");
    await waitFor(() => expect(saves()).toEqual([expect.objectContaining({ p_slide_number: 7, p_body: "from last time" })]));
  });

  it("before 0020 the notebook stays on this device: one look at the database, then no more sends", async () => {
    notebookRows.mockResolvedValue({ data: null, error: { code: "PGRST205", message: "Could not find the table" }, status: 404 });
    show(7);
    await settle();
    fireEvent.change(notebook(), { target: { value: "device only" } });
    fireEvent.blur(notebook());
    await waitFor(() => expect(within(notes()).getByRole("status")).toHaveTextContent("Saved on this device"));
    expect(notebookSave).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(NB_KEY) ?? "{}")).toEqual({ "7": "device only" });
  });

  it("a slide with only a notebook note is a spot: an ink dot in the strip, and it counts in My spots", async () => {
    show(7);
    await waitFor(() => expect(within(strip()).getByRole("button", { name: "Slide 6, you wrote a note" })).toBeInTheDocument());
    const dot = within(strip()).getByRole("button", { name: "Slide 6, you wrote a note" });
    expect(dot.querySelector("[data-spot]")).toHaveAttribute("data-spot", "note");
    const count = () => screen.getByRole("link", { name: /My spots/ }).lastElementChild as HTMLElement;
    expect(count()).toHaveTextContent("1");
    fireEvent.change(notebook(), { target: { value: "seven too" } });
    expect(count()).toHaveTextContent("2");
    // Emptied, it is not a spot any more.
    fireEvent.change(notebook(), { target: { value: "  " } });
    expect(count()).toHaveTextContent("1");
  });

  it("reads the notebook again when the page is shown again (a note changed in My spots)", async () => {
    notebookRows.mockResolvedValue({ data: [{ slide_number: 7, body: "seven", updated_at: "x" }], error: null, status: 200 });
    const page = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <StudentLecture lectureId={LECTURE} lectureName="Lecture 3, Oct 26" courseName="IMS 452" initialSlide={7} />
      </Activity>
    );
    const view = render(page("visible"));
    await waitFor(() => expect(notebook(7)).toHaveValue("seven"));
    view.rerender(page("hidden"));
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    notebookRows.mockResolvedValue({ data: [{ slide_number: 7, body: "seven, edited in My spots", updated_at: "x" }], error: null, status: 200 });
    view.rerender(page("visible"));
    await waitFor(() => expect(notebook(7)).toHaveValue("seven, edited in My spots"));
  });

  it("sends the notebook before leaving when the lecture ends", async () => {
    show(7);
    await settle();
    await act(async () => channelStatus("SUBSCRIBED"));
    fireEvent.change(notebook(), { target: { value: "last words" } });
    act(() => channelUpdate({ new: { current_slide: 7, status: "ended" } }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/spots/${LECTURE}`));
    expect(saves()).toEqual([expect.objectContaining({ p_body: "last words" })]);
  });
});

describe("StudentLecture way back to My lectures, and the slide size handle", () => {
  it("has My lectures in the top bar (to all the lectures), next to My spots (this lecture)", () => {
    show(7);
    const link = screen.getByRole("link", { name: "My lectures" });
    expect(link).toHaveAttribute("href", "/spots");
    expect(top()).toContainElement(link);
    expect(screen.getByRole("link", { name: /My spots/ })).toHaveAttribute("href", `/spots/${LECTURE}`);
  });

  it("has the handle between the slide and the notebook: a focusable separator at 100% by default", () => {
    show(7);
    const handle = screen.getByRole("separator", { name: "Slide size" });
    expect(handle).toHaveAttribute("tabindex", "0");
    expect(handle).toHaveAttribute("aria-valuenow", "100");
    const lecture = document.querySelector("[data-lecture]") as HTMLElement;
    expect(lecture.style.getPropertyValue("--slide-scale")).toBe("");
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(handle).toHaveAttribute("aria-valuenow", "95");
    expect(lecture.style.getPropertyValue("--slide-scale")).toBe("0.95");
  });
});

describe("StudentLecture layouts (batch N: Notes, Slides only, Classic, picked by the student)", () => {
  const screenEl = () => document.querySelector("[data-lecture]") as HTMLElement;
  const layoutButton = () => screen.getByRole("button", { name: "Layout" });
  const pick = (name: "Notes" | "Slides only" | "Classic") => {
    fireEvent.click(layoutButton());
    fireEvent.click(screen.getByRole("menuitemradio", { name }));
  };
  const notebookField = (n = 7) => screen.queryByRole("textbox", { name: `Your notes, slide ${n}` }) as HTMLTextAreaElement | null;
  const saves = () => notebookSave.mock.calls.map((c) => c[0] as { p_slide_number: number; p_body: string });

  beforeEach(() => {
    probe.mockResolvedValue({ data: [], error: null, status: 200 });
    myMarks.mockResolvedValue({ data: [], error: null, status: 200 });
    notebookRows.mockResolvedValue({ data: [], error: null, status: 200 });
    notebookSave.mockResolvedValue({ data: "2026-10-27T14:01:00Z", error: null, status: 200 });
  });

  it("a new student gets Notes; the Layout button sits in the top bar next to Help, with no text on the screen", async () => {
    show(7);
    await settle();
    expect(screenEl()).toHaveAttribute("data-view", "notes");
    const info = document.querySelector("[data-lecture-info]") as HTMLElement;
    expect(info).toContainElement(layoutButton());
    expect(info).toContainElement(screen.getByRole("button", { name: "Help" }));
    expect(top()).toContainElement(layoutButton());
    expect(layoutButton().textContent).toBe("");
    expect(notebookField()).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Slide size" })).toBeInTheDocument();
    fireEvent.click(layoutButton());
    expect(screen.getByRole("menuitemradio", { name: "Notes" })).toHaveAttribute("aria-checked", "true");
  });

  it("the pick is remembered on this device: a new visit opens in it", async () => {
    const first = show(7);
    await settle();
    pick("Classic");
    expect(screenEl()).toHaveAttribute("data-view", "classic");
    expect(localStorage.getItem("backtrack:view")).toBe("classic");
    first.unmount();
    show(7);
    await settle();
    expect(screenEl()).toHaveAttribute("data-view", "classic");
    fireEvent.click(layoutButton());
    expect(screen.getByRole("menuitemradio", { name: "Classic" })).toHaveAttribute("aria-checked", "true");
  });

  it("Slides only has no notebook and no handle; the note to the teacher still shows on a lost slide", async () => {
    show(7);
    await settle();
    pick("Slides only");
    expect(screenEl()).toHaveAttribute("data-view", "slides");
    expect(notebookField()).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Your notes/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: "Slide size" })).not.toBeInTheDocument();
    expect(screenEl()).not.toHaveAttribute("data-notes");
    fireEvent.click(lost());
    const slot = document.querySelector("[data-teacher-slot]") as HTMLElement;
    expect(slot).toContainElement(screen.getByRole("textbox", { name: "Note for the teacher" }));
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
  });

  it("Classic has the buttons above the notebook (both after the slide), the handle between", async () => {
    show(7);
    await settle();
    pick("Classic");
    expect(screenEl()).toHaveAttribute("data-view", "classic");
    const notes = document.querySelector("[data-lecture-notes]") as HTMLElement;
    expect(panel().compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notes).toContainElement(notebookField());
    expect(screen.getByRole("separator", { name: "Slide size" })).toBeInTheDocument();
  });

  it("switching never loses typed notes: the notebook is sent first, and its text is there again in Notes", async () => {
    show(7);
    await settle();
    const field = notebookField()!;
    field.focus();
    fireEvent.change(field, { target: { value: "accrual = earned, not paid" } });
    expect(notebookSave).not.toHaveBeenCalled();
    pick("Slides only");
    await waitFor(() => expect(saves()).toEqual([expect.objectContaining({ p_slide_number: 7, p_body: "accrual = earned, not paid" })]));
    pick("Classic");
    expect(notebookField()).toHaveValue("accrual = earned, not paid");
    pick("Notes");
    expect(notebookField()).toHaveValue("accrual = earned, not paid");
    expect(saves()).toHaveLength(1);
  });

  it("switching never remounts I'm lost or loses its state: the same button, still lost, with its Undo", async () => {
    show(7);
    await settle();
    fireEvent.click(lost());
    const button = screen.getByRole("button", { name: "Lost on slide 7" });
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    for (const name of ["Slides only", "Classic", "Notes"] as const) {
      pick(name);
      expect(screen.getByRole("button", { name: "Lost on slide 7" })).toBe(button);
      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
      // One markup: the panel stays in the stack, right after the slide, in every layout.
      expect(panel().parentElement).toHaveAttribute("data-lecture-stage");
    }
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
  });

  it("a pick in another tab of this browser shows here too", async () => {
    show(7);
    await settle();
    act(() => {
      localStorage.setItem("backtrack:view", "slides");
      window.dispatchEvent(new StorageEvent("storage", { key: "backtrack:view" }));
    });
    expect(screenEl()).toHaveAttribute("data-view", "slides");
  });
});
