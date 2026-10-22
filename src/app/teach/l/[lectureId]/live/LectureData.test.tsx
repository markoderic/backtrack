import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";

type Query = { table: string; cols?: string; opts?: unknown; range: [number, number] | null; eqs: [string, unknown][] };

const h = vi.hoisted(() => ({
  handlers: {} as Record<string, (payload: unknown) => void>,
  filters: {} as Record<string, unknown>,
  status: null as ((s: string) => void) | null,
  tapsQuery: vi.fn(),
  participantsQuery: vi.fn(),
  lectureQuery: vi.fn(),
  rpc: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  removeChannel: vi.fn(),
  slideUrls: vi.fn(),
  here: vi.fn(),
  setAuth: vi.fn(async () => {}),
  makeChannel: vi.fn(),
}));

const channel = {
  on: vi.fn((_type: string, filter: { event: string; table: string }, cb: (payload: unknown) => void) => {
    h.handlers[`${filter.table}:${filter.event}`] = cb;
    h.filters[`${filter.table}:${filter.event}`] = filter;
    return channel;
  }),
  subscribe: vi.fn((cb: (s: string) => void) => {
    h.status = cb;
    return channel;
  }),
};

function from(table: string) {
  const q: Query = { table, range: null, eqs: [] };
  const b = {
    select(cols: string, opts?: unknown) {
      q.cols = cols;
      q.opts = opts;
      return b;
    },
    eq(c: string, v: unknown) {
      q.eqs.push([c, v]);
      return b;
    },
    order() {
      return b;
    },
    range(a: number, z: number) {
      q.range = [a, z];
      return b;
    },
    single() {
      return b;
    },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      const run = table === "lost_taps" ? h.tapsQuery : table === "participants" ? h.participantsQuery : h.lectureQuery;
      return Promise.resolve(run(q)).then(res, rej);
    },
  };
  return b;
}

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({
    from,
    channel: (name: string) => {
      h.makeChannel(name);
      return channel;
    },
    removeChannel: h.removeChannel,
    rpc: h.rpc,
    realtime: { setAuth: h.setAuth },
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push, replace: h.replace }) }));
vi.mock("@/lib/useSlideUrls", () => ({
  useSlideUrls: (lectureId: string, wanted: number[]) => h.slideUrls(lectureId, wanted),
}));
vi.mock("@/lib/useHere", () => ({
  useHereCount: (lectureId: string, enabled: boolean) => h.here(lectureId, enabled),
}));

import { LectureData, hideNotesKey } from "./LectureData";

const LECTURE = "11111111-1111-1111-1111-111111111111";
const slides = Array.from({ length: 5 }, (_, i) => ({ number: i + 1, first_line: `Heading ${i + 1}` }));

const row = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  anon_id: "s1",
  kind: "lost",
  slide_number: 2,
  note: null,
  undone: false,
  tapped_at: "2026-10-26T10:00:00Z",
  ...o,
});

type Props = Partial<React.ComponentProps<typeof LectureData>>;
const renderLive = (props: Props = {}) =>
  render(
    <LectureData
      lectureId={LECTURE}
      mode="live"
      lectureName="Lecture 1, Oct 26"
      slides={slides}
      initialCurrentSlide={3}
      courseId="c1"
      {...props}
    />,
  );

const slideRow = (n: number) => screen.getByTestId(`slide-${n}`);
const counts = (n: number) => within(slideRow(n)).getByTestId("counts").textContent;
const insert = (r: Record<string, unknown>) => act(() => h.handlers["lost_taps:INSERT"]({ new: r }));
const update = (r: Record<string, unknown>) => act(() => h.handlers["lost_taps:UPDATE"]({ new: r }));
const key = (k: string, target: Element | Window = window) => fireEvent.keyDown(target, { key: k });
/** Clicks a slide's bar, which shows that slide in the panel on the right. */
const select = (n: number) => fireEvent.click(within(slideRow(n)).getByRole("button"));
const panel = () => screen.getByTestId("slide-panel");
/** A number in the summary row at the top ("sum-joined", "sum-here", ...). */
const figure = (id: string) => screen.getByTestId(id).querySelector("dd")!.textContent;
const joinedShown = () => figure("sum-joined");
const barScale = (n: number) => Number(/scaleY\(([\d.]+)\)/.exec(within(slideRow(n)).getByTestId("bar").style.transform)![1]);

beforeEach(() => {
  h.handlers = {};
  h.filters = {};
  h.status = null;
  [h.push, h.replace, h.removeChannel, h.makeChannel, h.setAuth].forEach((m) => m.mockClear());
  [channel.on, channel.subscribe].forEach((m) => m.mockClear());
  h.setAuth.mockImplementation(async () => {});
  h.tapsQuery.mockReset().mockResolvedValue({
    data: [row("a", { slide_number: 2 }), row("b", { slide_number: 2, anon_id: "s2" }), row("c", { slide_number: 4 })],
    error: null,
  });
  h.participantsQuery.mockReset().mockResolvedValue({ count: 7, error: null });
  h.lectureQuery.mockReset().mockResolvedValue({ data: { current_slide: 3, status: "live" }, error: null });
  h.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  h.slideUrls.mockReset().mockReturnValue({});
  h.here.mockReset().mockReturnValue(null);
  localStorage.clear();
});

describe("LectureData live", () => {
  it("opens its channel only once Realtime has the teacher's token, so row level security sees the teacher", async () => {
    let giveToken: () => void = () => {};
    h.setAuth.mockImplementation(() => new Promise<void>((r) => (giveToken = r)));
    renderLive();
    await act(async () => {});
    expect(h.setAuth).toHaveBeenCalled();
    expect(h.makeChannel).not.toHaveBeenCalled();
    await act(async () => giveToken());
    expect(h.makeChannel).toHaveBeenCalledTimes(1);
    expect(h.makeChannel).toHaveBeenCalledWith(`lecture-data-${LECTURE}`);
  });

  it("shows one bar per slide with people and taps, the joined count and the current slide", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    expect(screen.getAllByTestId(/^slide-\d+$/)).toHaveLength(5);
    expect(counts(1)).toBe("0 lost, 0 taps");
    expect(counts(4)).toBe("1 lost, 1 tap");
    expect(within(slideRow(2)).getByText("Heading 2")).toBeInTheDocument();
    expect(joinedShown()).toBe("7");
    expect(screen.getByRole("heading", { level: 1, name: "Lecture 1, Oct 26" })).toBeInTheDocument();
    expect(within(slideRow(3)).getByText("Current slide")).toBeInTheDocument();
    expect(within(slideRow(3)).getByTestId("label").textContent).toBe("3\u00a0now");
    expect(within(slideRow(2)).queryByText("Current slide")).not.toBeInTheDocument();
    expect(screen.getByText("Live, on slide 3")).toBeInTheDocument();
  });

  it("shows the join code in the heading as two groups of three", async () => {
    renderLive({ code: "482916" });
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    expect(screen.getByText("Code 482 916")).toBeInTheDocument();
  });

  it("sizes each bar against the slide with the most people, with transform only, and a 2 px bar for nobody", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    expect(barScale(2)).toBe(1);
    expect(barScale(4)).toBe(0.5);
    // 2 px of the 260 px bar.
    expect(barScale(1)).toBeCloseTo(2 / 260, 3);
    expect(within(slideRow(1)).getByTestId("bar").style.height).toBe("");
  });

  it("draws the top 3 bars red and the others in the strip gray", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    expect(within(slideRow(2)).getByTestId("bar").className).toContain("bg-lost");
    expect(within(slideRow(4)).getByTestId("bar").className).toContain("bg-lost");
    expect(within(slideRow(1)).getByTestId("bar").className).toContain("bg-strip");
  });

  it("makes a bar red when its count is in the top three different counts and at least half the highest (ties all red), zero never", async () => {
    // People per slide: 4, 2, 2, 1, 0, 2. The top three different counts are 4, 2 and 1; 1 is under half of 4.
    const people = [4, 2, 2, 1, 0, 2];
    h.tapsQuery.mockResolvedValue({
      data: people.flatMap((n, i) =>
        Array.from({ length: n }, (_, k) => row(`${i}-${k}`, { slide_number: i + 1, anon_id: `p${k}` })),
      ),
      error: null,
    });
    renderLive({ slides: Array.from({ length: 6 }, (_, i) => ({ number: i + 1, first_line: "" })) });
    await waitFor(() => expect(counts(1)).toBe("4 lost, 4 taps"));
    const isRed = (n: number) => within(slideRow(n)).getByTestId("bar").className.includes("bg-lost");
    expect([1, 2, 3, 4, 5, 6].map(isRed)).toEqual([true, true, true, false, false, true]);
    expect(within(slideRow(6)).getByRole("button")).toHaveAccessibleName("Slide 6: 2 lost, 2 taps, among the most lost");
    expect(within(slideRow(4)).getByRole("button")).toHaveAccessibleName("Slide 4: 1 lost, 1 tap");
    expect(within(slideRow(5)).getByRole("button")).toHaveAccessibleName("Slide 5: 0 lost, 0 taps");
    // Slide 1 grows to 6: 2 is now under half of 6, so only slide 1 stays red.
    insert(row("x", { slide_number: 1, anon_id: "p8" }));
    insert(row("y", { slide_number: 1, anon_id: "p9" }));
    expect([1, 2, 3, 4, 5, 6].map(isRed)).toEqual([true, false, false, false, false, false]);
  });

  it("has no legend under the chart", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    expect(screen.queryByText("Top 3")).not.toBeInTheDocument();
    expect(screen.queryByText("Other slides")).not.toBeInTheDocument();
  });

  it("grays out a slide the lecture has not reached when nobody is lost on it", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    expect(within(slideRow(5)).getByTestId("bar").className).toContain("opacity-40");
    // Slide 4 is ahead too, but someone is lost on it, so it shows normally.
    expect(within(slideRow(4)).getByTestId("bar").className).not.toContain("opacity-40");
    expect(within(slideRow(1)).getByTestId("bar").className).not.toContain("opacity-40");
  });

  it("shows the slide most people are lost on in the panel, and a clicked bar's slide after that", async () => {
    h.tapsQuery.mockResolvedValue({
      data: [
        row("a", { slide_number: 2, tapped_at: "2026-10-26T14:41:00Z" }),
        row("b", { slide_number: 2, anon_id: "s2" }),
        row("c", { slide_number: 4 }),
      ],
      error: null,
    });
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    expect(within(panel()).getByText("Slide 2")).toBeInTheDocument();
    expect(within(panel()).getByRole("heading", { name: "Heading 2" })).toBeInTheDocument();
    expect(within(panel()).getByText("people got lost")).toBeInTheDocument();
    expect(within(panel()).getByText("2 taps")).toBeInTheDocument();
    expect(within(slideRow(2)).getByRole("button")).toHaveAttribute("aria-pressed", "true");
    select(4);
    expect(within(panel()).getByText("Slide 4")).toBeInTheDocument();
    expect(within(panel()).getByText("person got lost")).toBeInTheDocument();
    expect(within(panel()).getByText("1 tap")).toBeInTheDocument();
    expect(within(slideRow(4)).getByRole("button")).toHaveAttribute("aria-pressed", "true");
    expect(within(slideRow(2)).getByRole("button")).toHaveAttribute("aria-pressed", "false");
    // A new tap elsewhere does not move the panel away from the clicked slide.
    insert(row("n", { slide_number: 1, anon_id: "s5" }));
    insert(row("m", { slide_number: 1, anon_id: "s6" }));
    insert(row("o", { slide_number: 1, anon_id: "s7" }));
    expect(within(panel()).getByText("Slide 4")).toBeInTheDocument();
  });

  it("shows the live slide in the panel while nobody is lost", async () => {
    h.tapsQuery.mockResolvedValue({ data: [], error: null });
    renderLive();
    await waitFor(() => expect(counts(1)).toBe("0 lost, 0 taps"));
    expect(within(panel()).getByText("Slide 3")).toBeInTheDocument();
    expect(within(panel()).getByText("0")).toBeInTheDocument();
  });

  it("names each bar for a screen reader: slide, first line, people and taps", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    expect(within(slideRow(2)).getByRole("button")).toHaveAccessibleName(
      "Slide 2, Heading 2: 2 lost, 2 taps, among the most lost",
    );
    expect(within(slideRow(3)).getByRole("button")).toHaveAccessibleName(
      "Slide 3, Heading 3: 0 lost, 0 taps, Current slide",
    );
  });

  it("says among the most lost on the red slides and nobody else", async () => {
    h.tapsQuery.mockResolvedValue({
      data: [
        row("a", { slide_number: 1 }),
        row("b", { slide_number: 2, anon_id: "s2" }),
        row("c", { slide_number: 2 }),
        row("d", { slide_number: 4 }),
        row("e", { slide_number: 4, anon_id: "s2" }),
        row("f", { slide_number: 4, anon_id: "s3" }),
      ],
      error: null,
    });
    renderLive();
    await waitFor(() => expect(counts(4)).toBe("3 lost, 3 taps"));
    // 3, 2 and 1 people: 1 is under half of 3.
    expect(within(screen.getByTestId("bars")).getAllByText("among the most lost")).toHaveLength(2);
    expect(within(slideRow(4)).getByText("among the most lost")).toBeInTheDocument();
    expect(within(slideRow(2)).getByText("among the most lost")).toBeInTheDocument();
    expect(within(slideRow(1)).queryByText("among the most lost")).not.toBeInTheDocument();
    expect(within(slideRow(3)).queryByText("among the most lost")).not.toBeInTheDocument();
    expect(within(slideRow(5)).queryByText("among the most lost")).not.toBeInTheDocument();
  });

  it("reads only the lost rows of this lecture, and the participants and lecture row", async () => {
    renderLive();
    await waitFor(() => expect(joinedShown()).toBe("7"));
    const q = h.tapsQuery.mock.calls[0][0] as Query;
    expect(q.eqs).toContainEqual(["lecture_id", LECTURE]);
    expect(q.eqs).toContainEqual(["kind", "lost"]);
    const p = h.participantsQuery.mock.calls[0][0] as Query;
    expect(p.eqs).toContainEqual(["lecture_id", LECTURE]);
    expect(p.opts).toEqual({ count: "exact", head: true });
    expect((h.lectureQuery.mock.calls[0][0] as Query).eqs).toContainEqual(["id", LECTURE]);
  });

  it("reads every page of taps when there are more than 1000", async () => {
    const page = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => row(`id-${from + i}`, { slide_number: 1, anon_id: `s${from + i}` }));
    h.tapsQuery.mockImplementation(async (q: Query) =>
      q.range?.[0] === 0 ? { data: page(0, 1000), error: null } : { data: page(1000, 5), error: null },
    );
    renderLive();
    await waitFor(() => expect(counts(1)).toBe("1005 lost, 1005 taps"));
    expect(h.tapsQuery.mock.calls.map((c) => (c[0] as Query).range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("subscribes to lost_taps inserts and updates, participants inserts and the lecture row, all for this lecture", async () => {
    renderLive();
    await waitFor(() => expect(h.tapsQuery).toHaveBeenCalled());
    expect(h.filters["lost_taps:INSERT"]).toEqual({
      event: "INSERT",
      schema: "public",
      table: "lost_taps",
      filter: `lecture_id=eq.${LECTURE}`,
    });
    expect(h.filters["lost_taps:UPDATE"]).toEqual({
      event: "UPDATE",
      schema: "public",
      table: "lost_taps",
      filter: `lecture_id=eq.${LECTURE}`,
    });
    expect(h.filters["participants:INSERT"]).toEqual({
      event: "INSERT",
      schema: "public",
      table: "participants",
      filter: `lecture_id=eq.${LECTURE}`,
    });
    expect(h.filters["lectures:UPDATE"]).toEqual({
      event: "UPDATE",
      schema: "public",
      table: "lectures",
      filter: `id=eq.${LECTURE}`,
    });
    expect(channel.subscribe).toHaveBeenCalled();
  });

  it("updates a bar from a Realtime insert without reloading", async () => {
    renderLive();
    await waitFor(() => expect(counts(4)).toBe("1 lost, 1 tap"));
    const reads = h.tapsQuery.mock.calls.length;
    insert(row("new1", { slide_number: 4, anon_id: "s9" }));
    expect(counts(4)).toBe("2 lost, 2 taps");
    insert(row("new2", { slide_number: 4, anon_id: "s9" }));
    expect(counts(4)).toBe("2 lost, 3 taps");
    expect(barScale(4)).toBe(1);
    expect(h.tapsQuery.mock.calls.length).toBe(reads);
  });

  it("does not count the same row twice when its insert arrives again", async () => {
    renderLive();
    await waitFor(() => expect(counts(4)).toBe("1 lost, 1 tap"));
    insert(row("c", { slide_number: 4 }));
    expect(counts(4)).toBe("1 lost, 1 tap");
  });

  it("ignores a row that is not a lost tap", async () => {
    renderLive();
    await waitFor(() => expect(counts(4)).toBe("1 lost, 1 tap"));
    insert(row("save1", { slide_number: 4, kind: "save", anon_id: "s5" }));
    expect(counts(4)).toBe("1 lost, 1 tap");
  });

  it("lowers the bar when an update sets undone", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    update(row("a", { slide_number: 2, undone: true }));
    expect(counts(2)).toBe("1 lost, 1 tap");
    update(row("b", { slide_number: 2, anon_id: "s2", undone: true }));
    expect(counts(2)).toBe("0 lost, 0 taps");
    expect(within(slideRow(2)).queryByText("among the most lost")).not.toBeInTheDocument();
  });

  it("moves a tap to its new slide when an update changes slide_number", async () => {
    renderLive();
    await waitFor(() => expect(counts(4)).toBe("1 lost, 1 tap"));
    update(row("c", { slide_number: 1 }));
    expect(counts(4)).toBe("0 lost, 0 taps");
    expect(counts(1)).toBe("1 lost, 1 tap");
  });

  it("lists the notes of the shown slide with their time and no names, and drops the note of an undone tap", async () => {
    h.tapsQuery.mockResolvedValue({
      data: [
        row("a", { slide_number: 2, note: "what is a join?", anon_id: "student-secret-id" }),
        row("b", { slide_number: 2, note: "too fast", tapped_at: "2026-10-26T14:42:00Z" }),
        row("c", { slide_number: 4, note: "gone", undone: true }),
      ],
      error: null,
    });
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    select(2);
    const notes = () => within(panel()).getAllByTestId("note").map((n) => n.textContent);
    expect(within(panel()).getByRole("heading", { name: /^Notes\s*2$/ })).toBeInTheDocument();
    expect(notes()).toEqual(["what is a join?", "too fast"]);
    // 14:42 UTC is 10:42 in Oxford, Ohio (EDT), shown without AM or PM.
    expect(within(panel()).getByText("10:42")).toBeInTheDocument();
    select(4);
    expect(within(panel()).queryByTestId("notes")).not.toBeInTheDocument();
    expect(within(panel()).getByRole("heading", { name: "Notes" })).toBeInTheDocument();
    expect(within(panel()).getByText("No notes on this slide.")).toBeInTheDocument();
    expect(screen.queryByText(/student-secret-id/)).not.toBeInTheDocument();
    select(2);
    update(row("b", { slide_number: 2, note: "too fast", undone: true }));
    expect(notes()).toEqual(["what is a join?"]);
  });

  it("sets the notes in Geist (not Newsreader), one row each under a Notes heading with a hairline", async () => {
    h.tapsQuery.mockResolvedValue({
      data: [
        row("a", { slide_number: 2, note: "what is a join?" }),
        row("b", { slide_number: 2, note: "too fast", anon_id: "s2" }),
      ],
      error: null,
    });
    renderLive();
    await waitFor(() => expect(within(panel()).getAllByTestId("note")).toHaveLength(2));
    for (const n of within(panel()).getAllByTestId("note")) {
      expect(n.className).toContain("type-body");
      expect(n.className).not.toContain("type-note");
    }
    const heading = within(panel()).getByRole("heading", { name: /^Notes\s*2$/ });
    expect(heading.parentElement!.className).toContain("border-b");
    expect(heading.parentElement!.className).toContain("border-hairline");
    expect(within(panel()).getByTestId("notes").className).toContain("divide-hairline");
    // Hide notes is a white button now, not an underlined link.
    expect(within(panel()).getByRole("button", { name: "Hide notes" }).className).toContain("bg-surface");
  });

  describe("Hide notes", () => {
    const withNotes = () =>
      h.tapsQuery.mockResolvedValue({
        data: [
          row("a", { slide_number: 2, note: "what is a join?" }),
          row("b", { slide_number: 2, note: "too fast", anon_id: "s2" }),
        ],
        error: null,
      });
    const noteTexts = () => within(panel()).queryAllByTestId("note").map((n) => n.textContent);

    it("shows the notes by default, and Hide notes swaps them for their count", async () => {
      withNotes();
      renderLive({ teacherId: "t1" });
      await waitFor(() => expect(noteTexts()).toEqual(["what is a join?", "too fast"]));
      fireEvent.click(within(panel()).getByRole("button", { name: "Hide notes" }));
      expect(noteTexts()).toEqual([]);
      expect(screen.queryByText("what is a join?")).not.toBeInTheDocument();
      expect(within(panel()).getByTestId("notes-hidden")).toHaveTextContent("2 notes hidden");
      // A new note on the shown slide stays hidden too.
      insert(row("c", { slide_number: 2, note: "lost here", anon_id: "s3" }));
      expect(screen.queryByText("lost here")).not.toBeInTheDocument();
      expect(within(panel()).getByTestId("notes-hidden")).toHaveTextContent("3 notes hidden");
      fireEvent.click(within(panel()).getByRole("button", { name: "Show notes" }));
      expect(noteTexts()).toEqual(["what is a join?", "too fast", "lost here"]);
    });

    it("is remembered for this teacher in localStorage, and only for them", async () => {
      withNotes();
      const first = renderLive({ teacherId: "t1" });
      await waitFor(() => expect(noteTexts()).toHaveLength(2));
      fireEvent.click(within(panel()).getByRole("button", { name: "Hide notes" }));
      expect(localStorage.getItem(hideNotesKey("t1"))).toBe("1");
      first.unmount();

      const again = renderLive({ teacherId: "t1" });
      await waitFor(() => expect(within(panel()).getByTestId("notes-hidden")).toHaveTextContent("2 notes hidden"));
      expect(within(panel()).getByRole("button", { name: "Show notes" })).toBeInTheDocument();
      again.unmount();

      renderLive({ teacherId: "t2" });
      await waitFor(() => expect(noteTexts()).toHaveLength(2));
      fireEvent.click(within(panel()).getByRole("button", { name: "Hide notes" }));
      fireEvent.click(within(panel()).getByRole("button", { name: "Show notes" }));
      expect(localStorage.getItem(hideNotesKey("t2"))).toBeNull();
      expect(localStorage.getItem(hideNotesKey("t1"))).toBe("1");
    });

    it("still works with localStorage blocked", async () => {
      withNotes();
      const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      try {
        renderLive({ teacherId: "t1" });
        await waitFor(() => expect(noteTexts()).toHaveLength(2));
        fireEvent.click(within(panel()).getByRole("button", { name: "Hide notes" }));
        expect(noteTexts()).toEqual([]);
      } finally {
        get.mockRestore();
        set.mockRestore();
      }
    });

    it("is there in past mode too", async () => {
      withNotes();
      renderLive({ mode: "past", teacherId: "t1" });
      await waitFor(() => expect(noteTexts()).toHaveLength(2));
      fireEvent.click(within(panel()).getByRole("button", { name: "Hide notes" }));
      expect(noteTexts()).toEqual([]);
    });
  });

  it("adds one to the joined count for every participant insert", async () => {
    renderLive();
    await waitFor(() => expect(joinedShown()).toBe("7"));
    act(() => h.handlers["participants:INSERT"]({ new: { lecture_id: LECTURE } }));
    expect(joinedShown()).toBe("8");
  });

  it("does not stay one too high when a participant insert was already in the count", async () => {
    vi.useFakeTimers();
    try {
      renderLive();
      await act(async () => {});
      await act(async () => {});
      expect(joinedShown()).toBe("7");
      // The read that showed 7 already counted this student.
      act(() => h.handlers["participants:INSERT"]({ new: { lecture_id: LECTURE } }));
      expect(joinedShown()).toBe("8");
      const taps = h.tapsQuery.mock.calls.length;
      await act(async () => vi.advanceTimersByTimeAsync(800));
      expect(joinedShown()).toBe("7");
      // Only the count is read again, not every tap.
      expect(h.tapsQuery.mock.calls.length).toBe(taps);
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves the current slide marker when the lecture row updates", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    act(() => h.handlers["lectures:UPDATE"]({ new: { current_slide: 5, status: "live" } }));
    expect(within(slideRow(5)).getByText("Current slide")).toBeInTheDocument();
    expect(within(slideRow(3)).queryByText("Current slide")).not.toBeInTheDocument();
  });

  it("reads everything again on every SUBSCRIBED", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    const before = h.tapsQuery.mock.calls.length;
    h.tapsQuery.mockResolvedValue({ data: [row("z", { slide_number: 5 })], error: null });
    h.participantsQuery.mockResolvedValue({ count: 12, error: null });
    h.lectureQuery.mockResolvedValue({ data: { current_slide: 4, status: "live" }, error: null });
    await act(async () => h.status?.("SUBSCRIBED"));
    await waitFor(() => expect(counts(5)).toBe("1 lost, 1 tap"));
    expect(h.tapsQuery.mock.calls.length).toBe(before + 1);
    expect(counts(2)).toBe("0 lost, 0 taps");
    expect(joinedShown()).toBe("12");
    expect(within(slideRow(4)).getByText("Current slide")).toBeInTheDocument();
  });

  it("keeps a row that arrived by Realtime while a read was running", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    let release!: (v: unknown) => void;
    h.tapsQuery.mockReturnValueOnce(new Promise((r) => (release = r)));
    await act(async () => h.status?.("SUBSCRIBED"));
    insert(row("live1", { slide_number: 5, anon_id: "s7" }));
    update(row("a", { slide_number: 2, undone: true }));
    await act(async () =>
      release({ data: [row("a", { slide_number: 2 }), row("b", { slide_number: 2, anon_id: "s2" })], error: null }),
    );
    expect(counts(5)).toBe("1 lost, 1 tap");
    expect(counts(2)).toBe("1 lost, 1 tap");
  });

  it("removes the channel when it unmounts", async () => {
    const { unmount } = renderLive();
    await waitFor(() => expect(h.tapsQuery).toHaveBeenCalled());
    expect(h.removeChannel).not.toHaveBeenCalled();
    unmount();
    expect(h.removeChannel).toHaveBeenCalledWith(channel);
  });

  describe("when a read fails", () => {
    const wait = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));

    it("says so before the first read works, then shows the data", async () => {
      vi.useFakeTimers();
      try {
        h.tapsQuery.mockResolvedValue({ data: null, error: { message: "Failed to fetch" } });
        renderLive();
        await act(async () => {});
        expect(screen.getByText("Could not load the data. Trying again.")).toBeInTheDocument();
        expect(screen.queryByTestId("slide-1")).not.toBeInTheDocument();
        h.tapsQuery.mockResolvedValue({ data: [row("a", { slide_number: 1 })], error: null });
        await wait(1000);
        expect(counts(1)).toBe("1 lost, 1 tap");
        expect(screen.queryByText("Could not load the data. Trying again.")).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps the last data, does not throw, and retries after 1, 2, 4 seconds until it works", async () => {
      vi.useFakeTimers();
      try {
        renderLive();
        await act(async () => {});
        expect(counts(2)).toBe("2 lost, 2 taps");

        h.tapsQuery.mockRejectedValue(new TypeError("Failed to fetch"));
        await act(async () => h.status?.("SUBSCRIBED"));
        const calls = h.tapsQuery.mock.calls.length;
        expect(counts(2)).toBe("2 lost, 2 taps");

        await wait(999);
        expect(h.tapsQuery.mock.calls.length).toBe(calls);
        await wait(1);
        expect(h.tapsQuery.mock.calls.length).toBe(calls + 1);
        await wait(2000);
        expect(h.tapsQuery.mock.calls.length).toBe(calls + 2);
        expect(counts(2)).toBe("2 lost, 2 taps");

        h.tapsQuery.mockResolvedValue({ data: [row("q", { slide_number: 3 })], error: null });
        await wait(4000);
        expect(counts(3)).toBe("1 lost, 1 tap");
        const done = h.tapsQuery.mock.calls.length;
        await wait(60000);
        expect(h.tapsQuery.mock.calls.length).toBe(done);
      } finally {
        vi.useRealTimers();
      }
    });

    it("caps the wait at 10 seconds", async () => {
      vi.useFakeTimers();
      try {
        h.tapsQuery.mockResolvedValue({ data: null, error: { message: "down" } });
        renderLive();
        await act(async () => {});
        for (const delay of [1000, 2000, 4000, 8000, 10000, 10000]) {
          const before = h.tapsQuery.mock.calls.length;
          await wait(delay - 1);
          expect(h.tapsQuery.mock.calls.length).toBe(before);
          await wait(1);
          expect(h.tapsQuery.mock.calls.length).toBe(before + 1);
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it("reads again with backoff after a channel error and keeps the data on screen", async () => {
      vi.useFakeTimers();
      try {
        renderLive();
        await act(async () => {});
        const calls = h.tapsQuery.mock.calls.length;
        await act(async () => h.status?.("CHANNEL_ERROR"));
        expect(counts(2)).toBe("2 lost, 2 taps");
        await wait(999);
        expect(h.tapsQuery.mock.calls.length).toBe(calls);
        await wait(1);
        expect(h.tapsQuery.mock.calls.length).toBe(calls + 1);
        expect(counts(2)).toBe("2 lost, 2 taps");
      } finally {
        vi.useRealTimers();
      }
    });

    it("stops retrying when it unmounts", async () => {
      vi.useFakeTimers();
      try {
        h.tapsQuery.mockResolvedValue({ data: null, error: { message: "down" } });
        const { unmount } = renderLive();
        await act(async () => {});
        unmount();
        const calls = h.tapsQuery.mock.calls.length;
        await wait(60000);
        expect(h.tapsQuery.mock.calls.length).toBe(calls);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

const TITLE = "End class?";
const DIALOG_TEXT = "The code stops working and students land on My spots.";
/** The End class button in the heading (not the one inside the confirm). */
const endButton = () => screen.getAllByRole("button", { name: "End class" })[0];
/** The End class button inside the confirm. */
const confirmEnd = () => fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "End class" }));
const keepGoing = () => fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Keep going" }));

describe("End class", () => {
  async function open() {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    // The channel opens once Realtime has the token: wait for it, so ending can close it.
    await waitFor(() => expect(h.makeChannel).toHaveBeenCalled());
    fireEvent.click(endButton());
  }

  it("the header row that holds the confirm sits above the chart and the panel (its animation makes a stacking context)", async () => {
    await open();
    // jsdom can't hit-test. The confirm's z-30 only counts inside the header's own stacking context, so the
    // header itself must be positioned and above the later, animated chart and panel, or they swallow the clicks.
    const header = screen.getByRole("dialog").closest(".animate-page-in");
    expect(header).not.toBeNull();
    expect(header!.className).toContain("relative");
    expect(header!.className).toContain("z-20");
  });

  it("shows no confirm until End lecture is pressed, then asks with the exact words", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(endButton()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(endButton());
    const dialog = screen.getByRole("dialog", { name: TITLE });
    expect(within(dialog).getByText(DIALOG_TEXT)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Keep going" })).toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "End class" })).toBeInTheDocument();
    expect(endButton()).toHaveAttribute("aria-expanded", "true");
  });

  it("Keep going closes the confirm, ends nothing and gives focus back to End class", async () => {
    await open();
    keepGoing();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "End class" })).toHaveFocus();
  });

  it("a press outside the confirm closes it and ends nothing", async () => {
    await open();
    fireEvent.pointerDown(within(slideRow(1)).getByRole("button"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("focus leaving the confirm (Tab past Keep going) closes it and ends nothing", async () => {
    await open();
    const keep = within(screen.getByRole("dialog")).getByRole("button", { name: "Keep going" });
    const bar = within(slideRow(1)).getByRole("button");
    fireEvent.blur(keep, { relatedTarget: bar });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("a press inside the End area never moves focus (mousedown is cancelled), and End class still ends", async () => {
    await open();
    const dialog = screen.getByRole("dialog");
    const end = within(dialog).getByRole("button", { name: "End class" });
    // fireEvent returns false when the event's default was prevented: no focus change, so no blur.
    expect(fireEvent.mouseDown(end)).toBe(false);
    expect(fireEvent.mouseDown(dialog)).toBe(false);
    expect(fireEvent.mouseDown(screen.getByText(DIALOG_TEXT))).toBe(false);
    expect(fireEvent.mouseDown(within(dialog).getByRole("button", { name: "Keep going" }))).toBe(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(dialog).toHaveAttribute("tabindex", "-1");
    fireEvent.click(end);
    await waitFor(() => expect(screen.getByText("Class ended.")).toBeInTheDocument());
    expect(h.rpc).toHaveBeenCalledWith("end_lecture", { p_lecture_id: LECTURE });
  });

  it("tapping the End class toggle while the confirm is open closes it and it stays closed", async () => {
    await open();
    // A touch tap: the compat mousedown is cancelled, so focus never leaves (no blur), then the click.
    expect(fireEvent.mouseDown(endButton())).toBe(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(endButton());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("a press outside the End area is not cancelled", async () => {
    await open();
    expect(fireEvent.mouseDown(within(slideRow(1)).getByRole("button"))).toBe(true);
  });

  it("focus leaving to nothing (Tab out of the page) closes it", async () => {
    await open();
    const keep = within(screen.getByRole("dialog")).getByRole("button", { name: "Keep going" });
    fireEvent.blur(keep, { relatedTarget: null });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("focus moving inside the confirm keeps it open", async () => {
    await open();
    const dialog = screen.getByRole("dialog");
    const keep = within(dialog).getByRole("button", { name: "Keep going" });
    fireEvent.blur(keep, { relatedTarget: within(dialog).getByRole("button", { name: "End class" }) });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("a press inside the confirm keeps it open", async () => {
    await open();
    fireEvent.pointerDown(screen.getByText(DIALOG_TEXT));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("End class in the confirm calls end_lecture, then switches to past mode in place and says Class ended.", async () => {
    await open();
    confirmEnd();
    await waitFor(() => expect(screen.getByText("Class ended.")).toBeInTheDocument());
    expect(h.rpc).toHaveBeenCalledWith("end_lecture", { p_lecture_id: LECTURE });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End class" })).not.toBeInTheDocument();
    expect(h.removeChannel).toHaveBeenCalledWith(channel);
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    expect(joinedShown()).toBe("7");
    expect(screen.queryByText("Current slide")).not.toBeInTheDocument();
    expect(screen.queryByText(/Live, on slide/)).not.toBeInTheDocument();
    // The name stays, once, and there is a way back to the course.
    expect(screen.getAllByText("Lecture 1, Oct 26")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Back to the course" })).toHaveAttribute("href", "/teach/c/c1");
    // Focus was on the confirm's button, which is gone: it lands on the way back.
    await waitFor(() => expect(screen.getByRole("link", { name: "Back to the course" })).toHaveFocus());
  });

  it("shows a plain error and stays live when ending fails", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "Not allowed." } });
    await open();
    confirmEnd();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not end the class."));
    expect(screen.queryByText("Class ended.")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "End class" })).toHaveFocus());
    expect(screen.getByRole("button", { name: "End class" })).toBeInTheDocument();
    expect(h.removeChannel).not.toHaveBeenCalled();
    h.rpc.mockResolvedValue({ data: null, error: null });
    fireEvent.click(endButton());
    confirmEnd();
    await waitFor(() => expect(screen.getByText("Class ended.")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the same error when the request itself throws", async () => {
    h.rpc.mockRejectedValue(new TypeError("Failed to fetch"));
    await open();
    confirmEnd();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not end the class."));
    expect(screen.getByRole("button", { name: "End class" })).toBeInTheDocument();
  });

  it("switches to past mode when the lecture row says ended, whoever ended it", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    const bar = within(slideRow(2)).getByRole("button");
    act(() => bar.focus());
    act(() => h.handlers["lectures:UPDATE"]({ new: { current_slide: 3, status: "ended" } }));
    expect(screen.queryByRole("button", { name: "End class" })).not.toBeInTheDocument();
    // Ended by someone else: focus is left where the teacher had it.
    expect(bar).toHaveFocus();
    expect(screen.getByText("Class ended.")).toBeInTheDocument();
    expect(h.removeChannel).toHaveBeenCalledWith(channel);
  });
});

describe("End class from ?end=1", () => {
  it("opens the confirm on load for a live lecture", async () => {
    renderLive({ confirmEndOnLoad: true });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(DIALOG_TEXT)).toBeInTheDocument();
    expect(h.rpc).not.toHaveBeenCalled();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
  });

  it("does not open without the flag", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores the flag for an ended lecture", async () => {
    renderLive({ mode: "past", confirmEndOnLoad: true });
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Keep going closes it, ends nothing and removes ?end=1 from the url", async () => {
    renderLive({ confirmEndOnLoad: true });
    keepGoing();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.replace).toHaveBeenCalledWith(`/teach/l/${LECTURE}/live`);
    expect(h.rpc).not.toHaveBeenCalled();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
  });

  it("Escape closes it the same way", async () => {
    renderLive({ confirmEndOnLoad: true });
    key("Escape");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.replace).toHaveBeenCalledWith(`/teach/l/${LECTURE}/live`);
    expect(h.push).not.toHaveBeenCalled();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
  });

  it("End class in it ends the lecture", async () => {
    renderLive({ confirmEndOnLoad: true });
    confirmEnd();
    await waitFor(() => expect(screen.getByText("Class ended.")).toBeInTheDocument());
    expect(h.rpc).toHaveBeenCalledWith("end_lecture", { p_lecture_id: LECTURE });
  });

  it("a Keep going on a confirm opened by the button leaves the url alone", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    fireEvent.click(endButton());
    keepGoing();
    expect(h.replace).not.toHaveBeenCalled();
  });
});

describe("Live header buttons", () => {
  it("Back to slides is the primary black button (as Home's Join a class) and End class a white secondary one", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    const back = screen.getByRole("link", { name: "Back to slides" });
    expect(back.className).toContain("bg-ink");
    expect(back.className).toContain("text-surface");
    expect(back.className).not.toContain("underline");
    const end = endButton();
    expect(end).toHaveTextContent("End class");
    expect(end.className).toContain("bg-surface");
    expect(end.className).not.toContain("bg-ink");
    expect(end.className).not.toContain("border-ink");
  });

  it("the confirm says End class with a white Keep going button, no underlined link", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    fireEvent.click(endButton());
    const dialog = screen.getByRole("dialog", { name: "End class?" });
    expect(dialog).toHaveTextContent("The code stops working and students land on My spots.");
    expect(within(dialog).getByRole("button", { name: "End class" })).toBeInTheDocument();
    const keep = within(dialog).getByRole("button", { name: "Keep going" });
    expect(keep.className).toContain("bg-surface");
    expect(keep.className).not.toContain("underline");
  });
});

describe("No key binds", () => {
  it("Escape no longer leaves for the projector; Back to slides is a link instead", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    key("Escape");
    expect(h.push).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Back to slides" })).toHaveAttribute("href", `/teach/l/${LECTURE}/present`);
  });

  it("closes the confirm when it is open (closing a dialog), and leaves nothing", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    fireEvent.click(endButton());
    key("Escape");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.push).not.toHaveBeenCalled();
  });

  it("an Escape typed in an input leaves the confirm open", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    fireEvent.click(endButton());
    const input = document.createElement("input");
    document.body.appendChild(input);
    key("Escape", input);
    input.remove();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("has no shortcuts at all", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    for (const k of ["d", "D", "n", " ", "ArrowRight", "e", "Enter", "Escape"]) key(k);
    expect(h.push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("has no Back to slides in past mode", async () => {
    renderLive({ mode: "past" });
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    expect(screen.queryByRole("link", { name: "Back to slides" })).not.toBeInTheDocument();
  });
});

describe("LectureData past", () => {
  it("loads once, subscribes to nothing and has no End button", async () => {
    renderLive({ mode: "past" });
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    expect(channel.on).not.toHaveBeenCalled();
    expect(channel.subscribe).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "End class" })).not.toBeInTheDocument();
    expect(screen.queryByText("Class ended.")).not.toBeInTheDocument();
    expect(h.tapsQuery).toHaveBeenCalledTimes(1);
  });

  it("shows the bars, the red ones and notes, with no current slide marker and nothing grayed out", async () => {
    h.tapsQuery.mockResolvedValue({ data: [row("a", { slide_number: 4, note: "ask again" })], error: null });
    renderLive({ mode: "past" });
    await waitFor(() => expect(counts(4)).toBe("1 lost, 1 tap"));
    expect(within(slideRow(4)).getByText("among the most lost")).toBeInTheDocument();
    expect(within(panel()).getByText("Slide 4")).toBeInTheDocument();
    expect(within(panel()).getByText("ask again")).toBeInTheDocument();
    expect(screen.queryByText("Current slide")).not.toBeInTheDocument();
    expect(screen.queryByText(/now$/)).not.toBeInTheDocument();
    expect(within(slideRow(5)).getByTestId("bar").className).not.toContain("opacity-40");
  });

  it("has no heading of its own: the page's heading (children) shows the name once, above the chart", async () => {
    renderLive({ mode: "past", children: <h1>Lecture 1, Oct 26</h1> });
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    expect(screen.getAllByText("Lecture 1, Oct 26")).toHaveLength(1);
    const heading = screen.getByRole("heading", { level: 1, name: "Lecture 1, Oct 26" });
    const chart = screen.getByTestId("bars");
    expect(heading.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The joined count shows once, in the summary row.
    expect(screen.queryByText(/^\d+ joined$/)).not.toBeInTheDocument();
    expect(joinedShown()).toBe("7");
    expect(screen.queryByRole("link", { name: "Back to the course" })).not.toBeInTheDocument();
  });

  it("shows no heading at all in past mode without children", async () => {
    renderLive({ mode: "past" });
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByText("Lecture 1, Oct 26")).not.toBeInTheDocument();
  });

  it("a missing slide image can not break it: the panel shows a blank slide with its first line", async () => {
    renderLive({ mode: "past" });
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    expect(document.querySelector("img")).toBeNull();
    expect(within(panel()).getByTestId("highlights-2")).toHaveTextContent("Heading 2");
    expect(h.lectureQuery).not.toHaveBeenCalled();
  });

  it("retries a failed load with backoff", async () => {
    vi.useFakeTimers();
    try {
      h.tapsQuery.mockResolvedValueOnce({ data: null, error: { message: "down" } });
      renderLive({ mode: "past" });
      await act(async () => {});
      expect(screen.getByText("Could not load the data. Trying again.")).toBeInTheDocument();
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      expect(counts(2)).toBe("2 lost, 2 taps");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("LectureData highlights", () => {
  const HL = (x: number, y = 0.2) => ({ hl_x: x, hl_y: y, hl_w: 0.3, hl_h: 0.4 });
  /** The boxes drawn for slide n, after clicking its bar to show it in the panel. */
  const boxesOn = (n: number) => {
    select(n);
    return Array.from(panel().querySelectorAll<HTMLElement>("[data-highlight-box]"));
  };
  const withBoxes = () =>
    h.tapsQuery.mockResolvedValue({
      data: [
        row("a", { slide_number: 2, ...HL(0.1) }),
        row("b", { slide_number: 2, anon_id: "s2", ...HL(0.2) }),
        row("c", { slide_number: 4, anon_id: "s3" }),
        row("d", { slide_number: 5, ...HL(0.5) }),
      ],
      error: null,
    });

  it("reads the four hl_ columns with the taps", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    expect((h.tapsQuery.mock.calls[0][0] as Query).cols).toMatch(/hl_x, hl_y, hl_w, hl_h/);
  });

  it("draws every highlight of the shown slide as a translucent box over a copy of the slide", async () => {
    withBoxes();
    h.slideUrls.mockReturnValue({ 2: "https://signed/2.webp", 5: "https://signed/5.webp" });
    renderLive();
    await waitFor(() => expect(boxesOn(2)).toHaveLength(2));
    expect(within(panel()).getByTestId("panel-marks")).toHaveTextContent("2 marked the spot");
    const copy = within(panel()).getByTestId("highlights-2").querySelector("img")!;
    expect(copy).toHaveAttribute("src", "https://signed/2.webp");
    expect(copy.parentElement?.contains(boxesOn(2)[0])).toBe(true);
    expect(boxesOn(2)[0].style.left).toBe("10%");
    expect(boxesOn(2)[1].style.left).toBe("20%");
    expect(boxesOn(2)[0].className).toMatch(/\/\d+/);
    expect(boxesOn(2)[0].className).toContain("bg-lost");
    expect(boxesOn(5)).toHaveLength(1);
    expect(within(panel()).getByTestId("highlights-5").querySelector("img")).toHaveAttribute(
      "src",
      "https://signed/5.webp",
    );
  });

  it("shows the slide with no boxes when nobody marked it, and says so", async () => {
    withBoxes();
    h.slideUrls.mockReturnValue({ 4: "https://signed/4.webp" });
    renderLive();
    await waitFor(() => expect(counts(4)).toBe("1 lost, 1 tap"));
    expect(boxesOn(4)).toHaveLength(0);
    expect(within(panel()).getByTestId("highlights-4").querySelector("img")).toHaveAttribute(
      "src",
      "https://signed/4.webp",
    );
    expect(within(panel()).getByTestId("panel-marks")).toHaveTextContent("Nobody marked the spot");
    expect(boxesOn(1)).toHaveLength(0);
  });

  it("asks for the images of the slides someone is lost on or marked, plus the selected one, and none before the data", async () => {
    withBoxes();
    renderLive();
    expect(h.slideUrls).toHaveBeenLastCalledWith(LECTURE, []);
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    expect(h.slideUrls).toHaveBeenLastCalledWith(LECTURE, [2, 4, 5]);
    select(1);
    expect(h.slideUrls).toHaveBeenLastCalledWith(LECTURE, [1, 2, 4, 5]);
  });

  it("draws the boxes on a blank slide until the image arrives", async () => {
    withBoxes();
    renderLive();
    await waitFor(() => expect(boxesOn(2)).toHaveLength(2));
    expect(panel().querySelector("img")).toBeNull();
  });

  it("adds a box from a Realtime insert and asks for that slide's image", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    insert(row("n", { slide_number: 3, anon_id: "s9", ...HL(0.4) }));
    await waitFor(() => expect(boxesOn(3)).toHaveLength(1));
    expect(h.slideUrls).toHaveBeenLastCalledWith(LECTURE, [2, 3, 4]);
  });

  it("moves a box when the student changes their highlight (a Realtime update)", async () => {
    withBoxes();
    renderLive();
    await waitFor(() => expect(boxesOn(5)).toHaveLength(1));
    expect(boxesOn(5)[0].style.left).toBe("50%");
    update(row("d", { slide_number: 5, ...HL(0.6, 0.1) }));
    await waitFor(() => expect(boxesOn(5)[0].style.left).toBe("60%"));
    expect(boxesOn(5)[0].style.top).toBe("10%");
    expect(boxesOn(5)).toHaveLength(1);
  });

  it("takes a box away when its tap is undone", async () => {
    withBoxes();
    renderLive();
    await waitFor(() => expect(boxesOn(5)).toHaveLength(1));
    update(row("d", { slide_number: 5, undone: true, ...HL(0.5) }));
    await waitFor(() => expect(boxesOn(5)).toHaveLength(0));
    expect(within(slideRow(5)).getByRole("button")).toHaveAccessibleName("Slide 5, Heading 5: 0 lost, 0 taps");
  });

  it("never draws a save", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    insert(row("s", { kind: "save", slide_number: 3, ...HL(0.4) }));
    await act(async () => {});
    expect(boxesOn(3)).toHaveLength(0);
    expect(within(slideRow(3)).getByRole("button")).toHaveAccessibleName(
      "Slide 3, Heading 3: 0 lost, 0 taps, Current slide",
    );
  });

  it("shows the highlights of a lecture that has ended", async () => {
    withBoxes();
    renderLive({ mode: "past" });
    await waitFor(() => expect(boxesOn(2)).toHaveLength(2));
    expect(h.slideUrls).toHaveBeenLastCalledWith(LECTURE, [2, 4, 5]);
  });

  it("ignores a box that is not a valid rectangle", async () => {
    h.tapsQuery.mockResolvedValue({
      data: [row("a", { slide_number: 2, hl_x: 0.9, hl_y: 0.2, hl_w: 0.3, hl_h: 0.4 }), row("b", { slide_number: 2, hl_x: 0.1, hl_y: null, hl_w: null, hl_h: null })],
      error: null,
    });
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("1 lost, 2 taps"));
    expect(boxesOn(2)).toHaveLength(0);
  });
});

describe("LectureData with many slides", () => {
  // jsdom has no ResizeObserver: this one lets a test say how wide the chart is.
  let resize: ((width: number) => void) | null = null;
  class FakeResizeObserver {
    constructor(cb: (entries: { contentRect: { width: number } }[]) => void) {
      resize = (width) => cb([{ contentRect: { width } }]);
    }
    observe() {}
    disconnect() {
      resize = null;
    }
  }
  const many = Array.from({ length: 50 }, (_, i) => ({ number: i + 1, first_line: `Heading ${i + 1}` }));
  const label = (n: number) => within(slideRow(n)).getByTestId("label");
  const shown = (n: number) => label(n).getAttribute("data-shown") === "true";

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    h.tapsQuery.mockResolvedValue({
      data: [
        row("a", { slide_number: 17 }),
        row("b", { slide_number: 17, anon_id: "s2" }),
        row("c", { slide_number: 17, anon_id: "s3" }),
        row("d", { slide_number: 33 }),
        row("e", { slide_number: 33, anon_id: "s2" }),
        row("f", { slide_number: 42 }),
      ],
      error: null,
    });
    h.lectureQuery.mockResolvedValue({ data: { current_slide: 23, status: "live" }, error: null });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function renderMany(width: number) {
    renderLive({ slides: many, initialCurrentSlide: 23 });
    await waitFor(() => expect(counts(17)).toBe("3 lost, 3 taps"));
    await waitFor(() => expect(within(slideRow(23)).getByText("Current slide")).toBeInTheDocument());
    act(() => resize?.(width));
  }

  it("shows every slide number while the columns are wide enough", async () => {
    renderLive();
    await waitFor(() => expect(screen.getByTestId("bars")).toBeInTheDocument());
    act(() => resize?.(760));
    expect(screen.getByTestId("bars")).toHaveAttribute("data-dense", "false");
    for (const n of [1, 2, 3, 4, 5]) expect(shown(n)).toBe(true);
  });

  it("thins the numbers to slide 1 and every 5th when 50 slides share a laptop wide chart", async () => {
    // 876 px for 50 slides is 17.5 px a slide (the columns stop at 24 px and scroll).
    await renderMany(876);
    expect(screen.getByTestId("bars")).toHaveAttribute("data-dense", "true");
    for (const n of [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]) expect(shown(n)).toBe(true);
    for (const n of [2, 3, 4, 6, 9, 11, 16, 24, 41, 49]) expect(shown(n)).toBe(false);
    // A hidden number keeps its line (invisible), so the bars stay aligned.
    expect(label(2).className).toContain("invisible");
    expect(label(2).className).toContain("h-9");
    expect(label(5).className).toContain("h-9");
  });

  it("always shows the top 3, the live slide and the selected slide, with now under the live number", async () => {
    await renderMany(876);
    for (const n of [17, 33, 42]) expect(shown(n)).toBe(true);
    expect(shown(23)).toBe(true);
    expect(label(23).textContent).toBe("23now");
    expect(within(label(23)).getByText("now").className).toContain("type-caption");
    expect(shown(8)).toBe(false);
    select(8);
    expect(shown(8)).toBe(true);
  });

  it("keeps the full name on every bar, numbers shown or not", async () => {
    await renderMany(876);
    expect(within(slideRow(2)).getByRole("button")).toHaveAccessibleName("Slide 2, Heading 2: 0 lost, 0 taps");
    expect(within(slideRow(17)).getByRole("button")).toHaveAccessibleName("Slide 17, Heading 17: 3 lost, 3 taps, among the most lost");
    expect(within(slideRow(23)).getByRole("button")).toHaveAccessibleName(
      "Slide 23, Heading 23: 0 lost, 0 taps, Current slide",
    );
  });

  it("goes back to every number when the window gets wide enough again", async () => {
    await renderMany(876);
    act(() => resize?.(2400));
    expect(screen.getByTestId("bars")).toHaveAttribute("data-dense", "false");
    expect(shown(2)).toBe(true);
    expect(label(23).textContent).toBe("23\u00a0now");
  });

  it("exactly 40 px a slide is not dense, just under is", async () => {
    await renderMany(2000);
    expect(screen.getByTestId("bars")).toHaveAttribute("data-dense", "false");
    expect(shown(2)).toBe(true);
    act(() => resize?.(1999.5));
    expect(screen.getByTestId("bars")).toHaveAttribute("data-dense", "true");
    expect(shown(2)).toBe(false);
  });

  it("99 slides thin to every 5th, 100 slides to every 10th", async () => {
    const deck = (n: number) => Array.from({ length: n }, (_, i) => ({ number: i + 1, first_line: "" }));
    const { unmount } = renderLive({ slides: deck(99), initialCurrentSlide: 1 });
    await waitFor(() => expect(counts(17)).toBe("3 lost, 3 taps"));
    act(() => resize?.(876));
    expect(shown(95)).toBe(true);
    expect(shown(15)).toBe(true);
    expect(shown(96)).toBe(false);
    unmount();
    renderLive({ slides: deck(100), initialCurrentSlide: 1 });
    await waitFor(() => expect(counts(17)).toBe("3 lost, 3 taps"));
    act(() => resize?.(876));
    expect(shown(90)).toBe(true);
    expect(shown(100)).toBe(true);
    expect(shown(95)).toBe(false);
    expect(shown(15)).toBe(false);
  });

  it("thins to every 10th past 99 slides", async () => {
    const hundred = Array.from({ length: 120 }, (_, i) => ({ number: i + 1, first_line: "" }));
    renderLive({ slides: hundred, initialCurrentSlide: 1 });
    await waitFor(() => expect(counts(17)).toBe("3 lost, 3 taps"));
    act(() => resize?.(876));
    expect(shown(10)).toBe(true);
    expect(shown(100)).toBe(true);
    expect(shown(15)).toBe(false);
    expect(shown(105)).toBe(false);
  });
});

describe("LectureData summary row", () => {
  const HL = { hl_x: 0.1, hl_y: 0.2, hl_w: 0.3, hl_h: 0.1 };
  const fixture = () =>
    h.tapsQuery.mockResolvedValue({
      data: [
        // s1 taps twice on slide 2 (one student, two taps), with a note.
        row("a", { slide_number: 2, anon_id: "s1", note: "what is a join?" }),
        row("b", { slide_number: 2, anon_id: "s1" }),
        // s2 marks the spot on slide 2.
        row("c", { slide_number: 2, anon_id: "s2", ...HL }),
        // s3's tap with a note and a mark was undone: it counts nowhere.
        row("d", { slide_number: 4, anon_id: "s3", undone: true, note: "gone", ...HL }),
        // A save with a mark: private, never counted.
        row("e", { slide_number: 4, anon_id: "s4", kind: "save", ...HL }),
        // s5 marks slide 3 and leaves a note.
        row("f", { slide_number: 3, anon_id: "s5", note: "too fast", ...HL }),
        // A tap on a slide the lecture does not have.
        row("g", { slide_number: 9, anon_id: "s6", note: "nowhere", ...HL }),
      ],
      error: null,
    });

  it("counts only counted lost taps on the lecture's slides, and caps here at joined", async () => {
    fixture();
    h.here.mockReturnValue(12);
    renderLive();
    await waitFor(() => expect(figure("sum-joined")).toBe("7"));
    expect(h.here).toHaveBeenLastCalledWith(LECTURE, true);
    // 12 here but 7 joined: never more here than joined.
    expect(figure("sum-here")).toBe("7");
    // s1, s2 and s5: three different students; 3 of 7 is 43%.
    expect(figure("sum-tapped")).toBe("343% of joined");
    expect(within(screen.getByTestId("sum-tapped")).getByText("43% of joined")).toBeInTheDocument();
    // a, b, c, f.
    expect(figure("sum-taps")).toBe("4");
    // "what is a join?" and "too fast".
    expect(figure("sum-notes")).toBe("2");
    // s2 on slide 2 and s5 on slide 3.
    expect(figure("sum-marks")).toBe("2");
    // Slide 2: 2 people, 3 taps.
    expect(figure("sum-most")).toBe("2Heading 2");
  });

  it("shows here only while live, and follows a Realtime change in every number", async () => {
    fixture();
    h.here.mockReturnValue(3);
    renderLive({ mode: "past" });
    await waitFor(() => expect(figure("sum-taps")).toBe("4"));
    expect(screen.queryByTestId("sum-here")).not.toBeInTheDocument();
    expect(h.here).toHaveBeenLastCalledWith(LECTURE, false);
  });

  it("moves with Realtime: an undo and a new tap change the counts at once", async () => {
    fixture();
    renderLive();
    await waitFor(() => expect(figure("sum-taps")).toBe("4"));
    expect(screen.queryByTestId("sum-here")).not.toBeInTheDocument();
    update(row("c", { slide_number: 2, anon_id: "s2", undone: true, ...HL }));
    expect(figure("sum-taps")).toBe("3");
    expect(figure("sum-marks")).toBe("1");
    expect(figure("sum-tapped")).toBe("229% of joined");
    insert(row("n", { slide_number: 5, anon_id: "s7", note: "lost here", ...HL }));
    expect(figure("sum-taps")).toBe("4");
    expect(figure("sum-notes")).toBe("3");
    expect(figure("sum-marks")).toBe("2");
  });

  it("says None yet for the most lost slide and 0s when nobody is lost", async () => {
    h.tapsQuery.mockResolvedValue({ data: [], error: null });
    renderLive();
    await waitFor(() => expect(figure("sum-taps")).toBe("0"));
    expect(figure("sum-most")).toBe("None yet");
    expect(figure("sum-tapped")).toBe("00% of joined");
  });
});

describe("LectureData hover and focus card", () => {
  it("focusing a bar shows its card with the same words as its name, and it follows a new tap", async () => {
    h.tapsQuery.mockResolvedValue({
      data: [
        row("a", { slide_number: 2, hl_x: 0.1, hl_y: 0.1, hl_w: 0.2, hl_h: 0.2 }),
        row("b", { slide_number: 2, anon_id: "s2" }),
      ],
      error: null,
    });
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    expect(screen.queryByTestId("bar-tip")).not.toBeInTheDocument();
    const bar = within(slideRow(2)).getByRole("button");
    fireEvent.focus(bar);
    const tip = () => screen.getByTestId("bar-tip");
    expect(tip()).toHaveTextContent("Slide 2");
    expect(tip()).toHaveTextContent("2 lost, 2 taps");
    expect(tip()).toHaveTextContent("1 marked the spot");
    expect(tip()).toHaveAttribute("aria-hidden", "true");
    insert(row("c", { slide_number: 2, anon_id: "s3" }));
    expect(tip()).toHaveTextContent("3 lost, 3 taps");
    fireEvent.blur(bar);
    expect(screen.queryByTestId("bar-tip")).not.toBeInTheDocument();
    fireEvent.pointerEnter(within(slideRow(4)).getByRole("button"));
    expect(tip()).toHaveTextContent("Slide 4");
    expect(tip()).not.toHaveTextContent("marked the spot");
    fireEvent.pointerLeave(within(slideRow(4)).getByRole("button"));
    expect(screen.queryByTestId("bar-tip")).not.toBeInTheDocument();
  });
});

describe("LectureData keeps the shown slide still", () => {
  it("pins the most lost slide on load: a new top slide never swaps the panel or closes the big view", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 lost, 2 taps"));
    expect(within(panel()).getByText("Slide 2")).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole("button", { name: "Enlarge slide 2" }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Slide 2, Heading 2");
    // Slide 4 becomes the most lost.
    for (const id of ["x", "y", "z"]) insert(row(id, { slide_number: 4, anon_id: id }));
    expect(counts(4)).toBe("4 lost, 4 taps");
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Slide 2, Heading 2");
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(within(panel()).getByText("Slide 2")).toBeInTheDocument();
  });

  it("pins the live slide when the teacher opens it before anyone is lost", async () => {
    h.tapsQuery.mockResolvedValue({ data: [], error: null });
    renderLive();
    await waitFor(() => expect(within(panel()).getByText("Slide 3")).toBeInTheDocument());
    fireEvent.click(within(panel()).getByRole("button", { name: "Enlarge slide 3" }));
    insert(row("a", { slide_number: 1 }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Slide 3, Heading 3");
  });
});

describe("LectureData with more slides than fit", () => {
  let resize: ((width: number) => void) | null = null;
  class FakeResizeObserver {
    constructor(cb: (entries: { contentRect: { width: number } }[]) => void) {
      resize = (width) => cb([{ contentRect: { width } }]);
    }
    observe() {}
    disconnect() {
      resize = null;
    }
  }
  const many = Array.from({ length: 50 }, (_, i) => ({ number: i + 1, first_line: `Heading ${i + 1}` }));
  let left = 0;

  beforeEach(() => {
    left = 0;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    h.tapsQuery.mockResolvedValue({
      data: [
        row("a", { slide_number: 17 }),
        row("b", { slide_number: 17, anon_id: "s2" }),
        row("c", { slide_number: 17, anon_id: "s3" }),
        row("d", { slide_number: 33 }),
        row("e", { slide_number: 33, anon_id: "s2" }),
        row("f", { slide_number: 42 }),
      ],
      error: null,
    });
    // A laid out chart: 600 px wide, each column 24 px from 6 px in, moved by the scroll.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const id = this.dataset?.testid ?? "";
      const box = (l: number, w: number) => ({ left: l, right: l + w, width: w, top: 0, bottom: 10, height: 10, x: l, y: 0 }) as DOMRect;
      if (id === "bars") return box(0, 600);
      const m = /^slide-(\d+)$/.exec(id);
      if (m) return box(6 + (Number(m[1]) - 1) * 24 - left, 24);
      return box(0, 0);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function renderAt(width: number) {
    renderLive({ slides: many, initialCurrentSlide: 23 });
    await waitFor(() => expect(counts(17)).toBe("3 lost, 3 taps"));
    const ol = screen.getByTestId("bars");
    Object.defineProperty(ol, "scrollLeft", {
      configurable: true,
      get: () => left,
      set: (v: number) => {
        left = Math.max(0, Math.min(v, 50 * 24 + 12 - width));
      },
    });
    act(() => resize?.(width));
    return ol;
  }

  it("says which slides are in view, fades the side that has more, and says where red bars are hidden", async () => {
    await renderAt(600);
    expect(screen.getByTestId("chart-range")).toHaveTextContent("Slides 1 to 25 of 50, 1 red bar to the right");
    expect(screen.getByTestId("fade-right")).toBeInTheDocument();
    expect(screen.queryByTestId("fade-left")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Earlier slides" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Later slides" })).toBeEnabled();
  });

  it("Later and Earlier slides move the chart by most of its width", async () => {
    await renderAt(600);
    fireEvent.click(screen.getByRole("button", { name: "Later slides" }));
    expect(left).toBe(480);
    expect(screen.getByTestId("chart-range")).toHaveTextContent("Slides 21 to 45 of 50, 1 red bar to the left");
    expect(screen.getByTestId("fade-left")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Later slides" }));
    expect(screen.getByTestId("chart-range")).toHaveTextContent("of 50");
    expect(screen.getByRole("button", { name: "Later slides" })).toBeDisabled();
    expect(screen.queryByTestId("fade-right")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Earlier slides" }));
    fireEvent.click(screen.getByRole("button", { name: "Earlier slides" }));
    expect(left).toBe(0);
  });

  it("follows a scroll by hand", async () => {
    const ol = await renderAt(600);
    left = 240;
    fireEvent.scroll(ol);
    expect(screen.getByTestId("chart-range")).toHaveTextContent("Slides 11 to 35 of 50");
  });

  it("scrolls the selected bar into view when it is picked", async () => {
    await renderAt(600);
    select(33);
    // Slide 33 ends at 6 + 33 * 24 = 798: the chart moves by 798 - 600 + 6.
    expect(left).toBe(204);
    expect(screen.getByTestId("chart-range")).toHaveTextContent("Slides 9 to 33 of 50");
  });

  it("shows no range or buttons when every slide fits", async () => {
    await renderAt(1300);
    expect(screen.queryByTestId("chart-scroll")).not.toBeInTheDocument();
    expect(screen.queryByTestId("fade-right")).not.toBeInTheDocument();
  });
});
