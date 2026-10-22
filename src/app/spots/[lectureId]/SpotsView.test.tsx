import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor, act } from "@testing-library/react";

type Result = { data: unknown; error: { message: string } | null };

// Every query on the supabase mock is a chain that ends in a promise.
const calls: string[] = [];
function chain(table: string, result: () => Result) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) {
    c[m] = vi.fn((...args: unknown[]) => {
      calls.push(`${table}.${m}(${args.map(String).join(",")})`);
      return c;
    });
  }
  c.then = (ok: (v: Result) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad);
  c.single = () => Promise.resolve(result());
  return c;
}

// The realtime channel useLiveLecture listens on (same pattern as src/lib/useLiveLecture.test.tsx).
type Handler = (payload: { new: Record<string, unknown> }) => void;
const channel = {
  update: null as Handler | null,
  on: vi.fn(),
  subscribe: vi.fn(),
};
channel.on.mockImplementation((_type: string, _filter: unknown, cb: Handler) => {
  channel.update = cb;
  return channel;
});
channel.subscribe.mockImplementation(() => channel);
const makeChannel = vi.fn(() => channel);
const removeChannel = vi.fn();
// What Realtime sends. Throws if the page has not opened its channel yet.
function channelUpdate(payload: { new: Record<string, unknown> }) {
  if (!channel.update) throw new Error("The channel is not open yet.");
  channel.update(payload);
}

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const tables: Record<string, Result> = {};
const rpc = vi.fn();
const selectAfter = vi.fn();
const eqId = vi.fn(() => ({ select: selectAfter }));
const update = vi.fn(() => ({ in: eqId }));
const from = vi.fn((table: string) => ({
  ...(chain(table, () => tables[table]) as object),
  update,
}));
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({
    from,
    rpc,
    channel: makeChannel,
    removeChannel,
    realtime: { setAuth: async () => {} },
  }),
}));

const flush = vi.fn();
vi.mock("@/lib/tapSync", async (orig) => ({
  ...(await orig<typeof import("@/lib/tapSync")>()),
  flushLeftoverTaps: (id: string) => {
    calls.push("flush");
    return flush(id);
  },
}));

const useSlideImages = vi.fn();
vi.mock("@/lib/useSlideImages", () => ({
  useSlideImages: (id: string, current?: number) => {
    useSlideImages(id, current);
    return { urlFor: (n: number) => `https://signed/${n}.webp` };
  },
}));

import { SpotsView } from "./SpotsView";
import { rejectedKey } from "@/lib/tapSync";

const LECTURE = "11111111-1111-1111-1111-111111111111";
const ME = "44444444-4444-4444-4444-000000000001";

const tap = (id: string, slide: number, at: string, o: Partial<{ kind: string; note: string | null }> = {}) => ({
  id,
  kind: o.kind ?? "lost",
  slide_number: slide,
  note: o.note ?? null,
  tapped_at: at,
});

const stat = (slide: number, students: number) => ({ slide_number: slide, taps: students, students });
const allStats = (counts: Record<number, number>) =>
  Array.from({ length: 12 }, (_, i) => stat(i + 1, counts[i + 1] ?? 0));

function show(o: { endedAt?: string | null; liveSlide?: number | null } = {}) {
  // What useLiveLecture reads while the lecture is live.
  if (o.liveSlide) tables.lectures = { data: { current_slide: o.liveSlide, status: "live" }, error: null };
  return render(
    <SpotsView
      lectureId={LECTURE}
      userId={ME}
      courseName="CSE 274"
      lectureName="Lecture 3, Oct 26"
      lectureDate="2026-10-26"
      endedAt={o.endedAt ?? null}
      slideCount={o.liveSlide ? null : 12}
      liveSlide={o.liveSlide ?? null}
    />,
  );
}

const ready = () => screen.findAllByRole("listitem");

beforeEach(() => {
  calls.length = 0;
  sessionStorage.clear();
  [rpc, selectAfter, eqId, update, from, flush, refresh, makeChannel, removeChannel, useSlideImages].forEach((m) =>
    m.mockClear(),
  );
  channel.update = null;
  flush.mockResolvedValue({ sent: 0, rejected: [] });
  tables.lost_taps = {
    data: [
      tap("b", 9, "2026-10-26T14:20:00Z", { note: "the proof" }),
      tap("a", 3, "2026-10-26T14:05:00Z"),
      tap("c", 5, "2026-10-26T14:30:00Z", { kind: "save", note: "read later" }),
    ],
    error: null,
  };
  tables.slides = {
    data: [
      { number: 3, first_line: "Big O notation" },
      { number: 5, first_line: "Recursion" },
      { number: 8, first_line: "Base case" },
      { number: 9, first_line: "Induction" },
    ],
    error: null,
  };
  rpc.mockResolvedValue({ data: allStats({ 3: 4, 5: 2, 9: 1 }), error: null });
  selectAfter.mockResolvedValue({ data: [{ id: "b" }], error: null });
});

describe("SpotsView: the list", () => {
  it("shows My spots, the lecture name and the date as Oct 26, and the course in the top bar", async () => {
    show();
    expect(await ready()).toHaveLength(3);
    expect(screen.getByRole("heading", { level: 1, name: "My spots" })).toBeInTheDocument();
    expect(screen.getByText("Lecture 3, Oct 26")).toBeInTheDocument();
    expect(screen.getByText("Oct 26")).toBeInTheDocument();
    expect(screen.getByText("CSE 274")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Back to lecture" })).not.toBeInTheDocument();
  });

  it("says when an ended lecture ended", async () => {
    show({ endedAt: new Date(2026, 9, 26, 10, 55).toISOString() });
    await ready();
    expect(screen.getByText("Oct 26, ended 10:55")).toBeInTheDocument();
  });

  it("lists the spots in slide order, with slide, first line, when, note and kind", async () => {
    show();
    const items = await ready();
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Slide 3");
    expect(items[0]).toHaveTextContent("Big O notation");
    expect(items[0]).toHaveTextContent(/Lost at \d+:\d\d/);
    expect(items[0]).toHaveTextContent("4 people got lost here");
    expect(items[1]).toHaveTextContent("Slide 5");
    expect(items[1]).toHaveTextContent("Recursion");
    expect(items[1]).toHaveTextContent("read later");
    expect(items[1]).toHaveTextContent(/Saved for later at \d+:\d\d/);
    // A save says nothing about other people in the list.
    expect(items[1]).not.toHaveTextContent("got lost");
    expect(items[2]).toHaveTextContent("Slide 9");
    expect(items[2]).toHaveTextContent("Induction");
    expect(items[2]).toHaveTextContent("the proof");
    expect(items[2]).toHaveTextContent("Only you got lost here");
  });

  it("several taps on one slide show once, with the latest note (Marko: 4 spots, all on one slide)", async () => {
    tables.lost_taps = {
      data: [
        tap("t1", 5, "2026-10-26T14:10:00Z", { note: "first" }),
        tap("t2", 5, "2026-10-26T14:20:00Z"),
        tap("t3", 5, "2026-10-26T14:30:00Z", { note: "second" }),
        tap("t4", 5, "2026-10-26T14:40:00Z"),
      ],
      error: null,
    };
    show();
    const items = await ready();
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("second");
    expect(items[0]).not.toHaveTextContent("first");
  });

  it("a slide with a save and a lost tap shows once, as lost", async () => {
    tables.lost_taps = {
      data: [tap("s", 5, "2026-10-26T14:10:00Z", { kind: "save" }), tap("l", 5, "2026-10-26T14:20:00Z")],
      error: null,
    };
    show();
    const items = await ready();
    expect(items).toHaveLength(1);
    expect(items[0].querySelector("[data-spot-number]")).toHaveClass("text-lost");
  });

  it("notes in the list are Geist, not italic Newsreader", async () => {
    show();
    const items = await ready();
    expect(within(items[2]).getByText("the proof")).toHaveClass("type-body");
    expect(document.querySelector(".type-note")).toBeNull();
  });

  it("shows the number red for a lost spot and ink for a saved one", async () => {
    show();
    const items = await ready();
    const number = (li: HTMLElement) => li.querySelector("[data-spot-number]")!;
    expect(number(items[0])).toHaveTextContent("3");
    expect(number(items[0])).toHaveClass("text-lost");
    expect(number(items[1])).toHaveClass("text-ink");
    expect(number(items[2])).toHaveClass("text-lost");
  });

  it("shows each spot's slide small, with its highlight", async () => {
    tables.lost_taps = { data: [{ ...tap("a", 3, "2026-10-26T14:05:00Z"), hl_x: 0.1, hl_y: 0.2, hl_w: 0.3, hl_h: 0.4 }], error: null };
    show();
    const [item] = await ready();
    expect(item.querySelector("img")).toHaveAttribute("src", "https://signed/3.webp");
    expect(item.querySelectorAll("[data-highlight-box]")).toHaveLength(1);
  });

  it("during a live lecture a white Back to lecture button goes back into class", async () => {
    show({ liveSlide: 6 });
    await ready();
    const back = screen.getByRole("link", { name: "Back to lecture" });
    expect(back).toHaveAttribute("href", `/l/${LECTURE}`);
    expect(back.className).toContain("bg-surface");
  });

  it("after the lecture there is no Back to lecture", async () => {
    show({ endedAt: "2026-10-26T15:00:00Z" });
    await ready();
    expect(screen.queryByRole("link", { name: "Back to lecture" })).not.toBeInTheDocument();
    expect(screen.getByText("CSE 274")).toBeInTheDocument();
  });

  it("asks only for the student's own rows that are not undone", async () => {
    show();
    await ready();
    expect(calls).toContain("lost_taps.eq(lecture_id," + LECTURE + ")");
    expect(calls).toContain("lost_taps.eq(undone,false)");
    expect(calls).toContain("lost_taps.eq(anon_id," + ME + ")");
    expect(rpc).toHaveBeenCalledWith("lecture_slide_stats", { p_lecture_id: LECTURE });
  });

  it("shows the empty state when there are no spots", async () => {
    tables.lost_taps = { data: [], error: null };
    show();
    expect(await screen.findByRole("heading", { name: "No spots yet" })).toBeInTheDocument();
    expect(screen.getByText("Slides you mark show up here.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Tap I.m lost/);
    expect(screen.queryByRole("heading", { name: "My spots" })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("has no coming soon text, no slide count and no name promise", async () => {
    const { container } = show();
    await ready();
    expect(container.textContent).not.toMatch(/coming soon/i);
    expect(container.textContent).not.toMatch(/\b12\b/);
    expect(container.textContent).not.toMatch(/nobody sees/i);
  });

  it("has a help button", async () => {
    show();
    await ready();
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
  });

  it("has a 44 px back arrow at the top left up to all lectures, and no All lectures text link", async () => {
    show();
    await ready();
    const back = screen.getByRole("link", { name: "Back to My spots" });
    expect(back).toHaveAttribute("href", "/spots");
    expect(back).toHaveClass("size-11");
    expect(back.parentElement?.firstElementChild).toBe(back);
    expect(screen.queryByRole("link", { name: "All lectures" })).not.toBeInTheDocument();
  });
});

describe("SpotsView: waiting taps and the rejected notice", () => {
  it("sends waiting taps before it loads the student's taps", async () => {
    show();
    await ready();
    expect(flush).toHaveBeenCalledWith(LECTURE);
    expect(calls.indexOf("flush")).toBeLessThan(calls.findIndex((c) => c.startsWith("lost_taps.")));
  });

  it("shows no notice when nothing was refused", async () => {
    show();
    await ready();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the notice once, at the top, and clears the key", async () => {
    sessionStorage.setItem(rejectedKey(LECTURE), "1");
    const { unmount } = show();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This one didn't save because the lecture had ended.");
    expect(sessionStorage.getItem(rejectedKey(LECTURE))).toBeNull();
    expect(alert.compareDocumentPosition(screen.getByRole("heading", { name: "My spots" }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    unmount();
    show();
    await ready();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the notice for a tap the flush just got refused", async () => {
    flush.mockImplementation(async (id: string) => {
      sessionStorage.setItem(rejectedKey(id), "1");
      return { sent: 0, rejected: [{}] };
    });
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("didn't save because the lecture had ended");
  });

  it("works when sessionStorage throws", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    show();
    expect(await ready()).toHaveLength(3);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    get.mockRestore();
  });
});

describe("SpotsView: errors go to the error page", () => {
  it("throws when the taps query fails, never an empty list", async () => {
    tables.lost_taps = { data: null, error: { message: "taps broke" } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    class Catch extends (await import("react")).Component<{ children: React.ReactNode }, { error: Error | null }> {
      state = { error: null as Error | null };
      static getDerivedStateFromError(error: Error) {
        return { error };
      }
      render() {
        return this.state.error ? <p>caught: {this.state.error.message}</p> : this.props.children;
      }
    }
    render(
      <Catch>
        <SpotsView lectureId={LECTURE} userId={ME} courseName="C" lectureName="L" lectureDate="2026-10-26" slideCount={12} />
      </Catch>,
    );
    expect(await screen.findByText("caught: taps broke")).toBeInTheDocument();
    expect(screen.queryByText("No spots yet")).not.toBeInTheDocument();
    spy.mockRestore();
  });
});

describe("SpotsView: opening a spot", () => {
  async function open(slide: string) {
    show();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Slide ${slide}`) }));
  }

  it("shows the detail with the count for that slide", async () => {
    await open("3");
    expect(screen.getByText("4 people got lost here")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://signed/3.webp");
  });

  it("says only you when it is one student", async () => {
    await open("9");
    expect(screen.getByText("Only you got lost here")).toBeInTheDocument();
  });

  it("a saved spot says people got lost on this slide", async () => {
    await open("5");
    expect(screen.getByText("2 people got lost on this slide")).toBeInTheDocument();
  });

  it("goes back to the list", async () => {
    await open("3");
    fireEvent.click(screen.getByRole("button", { name: "Back to My spots" }));
    expect(await ready()).toHaveLength(3);
  });

  it("moving the marker updates the row, asks for the counts again and shows the new slide's count", async () => {
    await open("9");
    expect(rpc).toHaveBeenCalledTimes(1);
    rpc.mockResolvedValue({ data: allStats({ 3: 4, 5: 2, 8: 3 }), error: null });
    fireEvent.click(screen.getByRole("button", { name: "Move to slide 8" }));
    expect(await screen.findByText("3 people got lost here")).toBeInTheDocument();
    expect(update).toHaveBeenCalledWith({ slide_number: 8 });
    expect(eqId).toHaveBeenCalledWith("id", ["b"]);
    expect(rpc).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Back to My spots" }));
    const items = await screen.findAllByRole("listitem");
    expect(items[2]).toHaveTextContent("Slide 8");
    expect(items[2]).toHaveTextContent("Base case");
  });

  it("a saved note shows in the list", async () => {
    await open("3");
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    fireEvent.change(screen.getByLabelText("Your note"), { target: { value: "ask Dr. Lee" } });
    selectAfter.mockResolvedValue({ data: [{ id: "a" }], error: null });
    fireEvent.submit((screen.getByLabelText("Your note") as HTMLTextAreaElement).form!);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Note saved."));
    fireEvent.click(screen.getByRole("button", { name: "Back to My spots" }));
    const items = await screen.findAllByRole("listitem");
    expect(within(items[0]).getByText("ask Dr. Lee")).toBeInTheDocument();
  });

  it("goes to the previous and next spot in slide order", async () => {
    await open("5");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Recursion");
    fireEvent.click(screen.getByRole("button", { name: "Next spot" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Induction");
    expect(screen.getByRole("button", { name: "Next spot" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous spot" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous spot" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Big O notation");
    expect(screen.getByRole("button", { name: "Previous spot" })).toBeDisabled();
  });

  it("during a live lecture the slide arrows stop at the live slide", async () => {
    show({ liveSlide: 4 });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /Slide 3/ }));
    const next = () => screen.getByRole("button", { name: "Next slide" });
    fireEvent.click(next());
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://signed/4.webp");
    expect(next()).toBeDisabled();
  });

  it("after the lecture ended the slide arrows go on past the old live slide", async () => {
    show();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /Slide 3/ }));
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://signed/6.webp");
  });

  it("during a live lecture, a later live slide raises the cap, and the end reads the page again", async () => {
    show({ liveSlide: 4 });
    await ready();
    expect(makeChannel).toHaveBeenCalledWith(`lecture-${LECTURE}`);
    // My spots never counts in the teacher's here count: no here channel, no presence.
    expect(makeChannel.mock.calls.map((c) => (c as unknown[])[0])).not.toContain(`here-${LECTURE}`);
    expect(makeChannel.mock.calls.every((c) => (c as unknown[]).length === 1)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Slide 3/ }));
    const next = () => screen.getByRole("button", { name: "Next slide" });
    fireEvent.click(next());
    expect(next()).toBeDisabled();
    act(() => channelUpdate({ new: { current_slide: 6, status: "live" } }));
    expect(next()).toBeEnabled();
    fireEvent.click(next());
    fireEvent.click(next());
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://signed/6.webp");
    expect(next()).toBeDisabled();
    expect(refresh).not.toHaveBeenCalled();
    act(() => channelUpdate({ new: { current_slide: 6, status: "ended" } }));
    expect(refresh).toHaveBeenCalledTimes(1);
    // One subscription for the page: opening a spot did not start a second one.
    expect(makeChannel).toHaveBeenCalledTimes(1);
  });

  it("does not follow a lecture that has ended", async () => {
    show();
    await ready();
    expect(makeChannel).not.toHaveBeenCalled();
  });

  it("signs the slides once for the page and preloads from the slide on screen in the detail", async () => {
    await open("3");
    expect(new Set(useSlideImages.mock.calls.map((c) => c[0]))).toEqual(new Set([LECTURE]));
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    await waitFor(() => expect(useSlideImages).toHaveBeenLastCalledWith(LECTURE, 4));
  });

  it("puts focus back on the row of the spot that was open, and keeps it on the spot arrow", async () => {
    await open("3");
    fireEvent.click(screen.getByRole("button", { name: "Next spot" }));
    expect(screen.getByRole("button", { name: "Next spot" })).toHaveFocus();
    // At the last spot the arrow is off, so focus goes to the heading.
    fireEvent.click(screen.getByRole("button", { name: "Next spot" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Back to My spots" }));
    await ready();
    expect(screen.getByRole("button", { name: /Slide 9/ })).toHaveFocus();
  });

  it("a removed spot is gone at once, even before the counts come back", async () => {
    await open("9");
    let answer!: (v: unknown) => void;
    rpc.mockReturnValue(new Promise((r) => (answer = r)));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(screen.queryByText("Induction")).not.toBeInTheDocument();
    // Focus moves in an effect after the list renders: wait for it rather than race it.
    await waitFor(() => expect(screen.getByRole("heading", { name: "My spots" })).toHaveFocus());
    await act(async () => answer({ data: allStats({ 3: 4, 5: 2 }), error: null }));
  });

  it("keeps the list when the counts can not be read after a remove", async () => {
    await open("9");
    rpc.mockResolvedValue({ data: null, error: { message: "stats broke" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("4 people got lost here");
  });

  it("a removed spot leaves the list, and the counts are read again", async () => {
    await open("9");
    selectAfter.mockResolvedValue({ data: [{ id: "b" }], error: null });
    rpc.mockResolvedValue({ data: allStats({ 3: 4, 5: 2 }), error: null });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(update).toHaveBeenCalledWith({ undone: true });
    expect(eqId).toHaveBeenCalledWith("id", ["b"]);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Induction")).not.toBeInTheDocument();
  });
});

describe("SpotsView: highlights", () => {
  const withBox = (id: string, slide: number, at: string, hl: Record<string, unknown>) => ({ ...tap(id, slide, at), ...hl });
  const boxes = () => Array.from(document.querySelectorAll<HTMLElement>("[data-highlight-box]"));
  const HL = { hl_x: 0.1, hl_y: 0.2, hl_w: 0.3, hl_h: 0.4 };

  async function open(slide: string) {
    show();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Slide ${slide}`) }));
  }

  it("asks for the four hl_ columns", async () => {
    show();
    await ready();
    expect(calls.find((c) => c.startsWith("lost_taps.select("))).toMatch(/hl_x, hl_y, hl_w, hl_h/);
  });

  it("draws the highlight of the spot that has one", async () => {
    tables.lost_taps = { data: [withBox("a", 3, "2026-10-26T14:05:00Z", HL)], error: null };
    await open("3");
    expect(boxes()).toHaveLength(1);
    expect(boxes()[0].style.left).toBe("10%");
    expect(boxes()[0].style.height).toBe("40%");
    expect(screen.getByRole("button", { name: "Clear mark" })).toBeInTheDocument();
  });

  it("draws nothing for a spot with no highlight, or a half filled one", async () => {
    tables.lost_taps = {
      data: [tap("a", 3, "2026-10-26T14:05:00Z"), withBox("b", 5, "2026-10-26T14:06:00Z", { hl_x: 0.1, hl_y: null, hl_w: null, hl_h: null })],
      error: null,
    };
    await open("3");
    expect(boxes()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Mark the spot" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to My spots" }));
    fireEvent.click(await screen.findByRole("button", { name: /Slide 5/ }));
    expect(boxes()).toHaveLength(0);
  });

  it("keeps a changed highlight when the student goes back to the list and opens the spot again", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: 1000, bottom: 500, x: 0, y: 0, width: 1000, height: 500, toJSON: () => ({}),
    });
    tables.lost_taps = { data: [tap("b", 9, "2026-10-26T14:20:00Z")], error: null };
    await open("9");
    fireEvent.click(screen.getByRole("button", { name: "Mark the spot" }));
    const layer = document.querySelector("[data-highlight-layer]") as HTMLElement;
    const mouse = { pointerType: "mouse", button: 0, pointerId: 1 };
    fireEvent.pointerDown(layer, { ...mouse, clientX: 500, clientY: 250 });
    fireEvent.pointerUp(layer, { ...mouse, clientX: 900, clientY: 450 });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Spot marked."));
    expect(update).toHaveBeenCalledWith({ hl_x: 0.5, hl_y: 0.5, hl_w: 0.4, hl_h: 0.4 });
    expect(eqId).toHaveBeenCalledWith("id", ["b"]);
    fireEvent.click(screen.getByRole("button", { name: "Back to My spots" }));
    fireEvent.click(await screen.findByRole("button", { name: /Slide 9/ }));
    expect(boxes()).toHaveLength(1);
    expect(boxes()[0].style.left).toBe("50%");
    vi.restoreAllMocks();
  });

  it("moving the marker clears the highlight, in the list state too", async () => {
    tables.lost_taps = { data: [withBox("b", 9, "2026-10-26T14:20:00Z", HL)], error: null };
    await open("9");
    rpc.mockResolvedValue({ data: allStats({ 8: 3 }), error: null });
    fireEvent.click(screen.getByRole("button", { name: "Move to slide 8" }));
    await screen.findByText("3 people got lost here");
    expect(update).toHaveBeenCalledWith({ slide_number: 8, hl_x: null, hl_y: null, hl_w: null, hl_h: null });
    expect(boxes()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Mark the spot" })).toBeInTheDocument();
  });
});

describe("SpotsView: after the course's time to see slides is over", () => {
  beforeEach(() => {
    // The database gives this student no slide rows any more (0017).
    tables.slides = { data: [], error: null };
  });

  it("lists the spots with their notes, says the slides are no longer available, and shows no thumbnails", async () => {
    show({ endedAt: "2026-10-26T15:00:00Z" });
    const items = await ready();
    expect(items).toHaveLength(3);
    expect(screen.getByText("These slides are no longer available.")).toBeInTheDocument();
    expect(items[2]).toHaveTextContent("the proof");
    expect(document.querySelectorAll("li img")).toHaveLength(0);
    expect(items[0].querySelector("[data-slide-gone]")).not.toBeNull();
  });

  it("draws no mark over a thumbnail that is no longer available", async () => {
    tables.lost_taps = { data: [{ ...tap("a", 3, "2026-10-26T14:05:00Z"), hl_x: 0.1, hl_y: 0.2, hl_w: 0.3, hl_h: 0.4 }], error: null };
    show({ endedAt: "2026-10-26T15:00:00Z" });
    const [item] = await ready();
    expect(item.querySelector("[data-slide-gone]")).not.toBeNull();
    expect(item.querySelectorAll("[data-highlight-box]")).toHaveLength(0);
  });

  it("a spot opens with the note and This slide is no longer available.", async () => {
    show({ endedAt: "2026-10-26T15:00:00Z" });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /Slide 9/ }));
    expect(screen.getByText("This slide is no longer available.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("the proof")).toBeInTheDocument();
  });

  it("a live lecture never shows it, even before its slide rows arrive", async () => {
    show({ liveSlide: 6 });
    await ready();
    expect(screen.queryByText(/no longer available/)).not.toBeInTheDocument();
  });
});

describe("SpotsView: moving onto a slide that has a spot", () => {
  it("the two become one spot, and it stays open", async () => {
    tables.lost_taps = {
      data: [tap("on8", 8, "2026-10-26T14:10:00Z", { note: "eight" }), tap("on9", 9, "2026-10-26T14:20:00Z")],
      error: null,
    };
    show();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /Slide 9/ }));
    rpc.mockResolvedValue({ data: allStats({ 8: 1 }), error: null });
    fireEvent.click(screen.getByRole("button", { name: "Move to slide 8" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Base case"));
    expect(screen.getByText("eight")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to My spots" }));
    expect(await screen.findAllByRole("listitem")).toHaveLength(1);
  });
});
