import { describe, it, expect, vi, beforeEach } from "vitest";
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
  removeChannel: vi.fn(),
  slideUrls: vi.fn(),
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
    channel: () => channel,
    removeChannel: h.removeChannel,
    rpc: h.rpc,
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/lib/useSlideUrls", () => ({
  useSlideUrls: (lectureId: string, wanted: number[]) => h.slideUrls(lectureId, wanted),
}));

import { LectureData } from "./LectureData";

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

beforeEach(() => {
  h.handlers = {};
  h.filters = {};
  h.status = null;
  [h.push, h.removeChannel, channel.on, channel.subscribe].forEach((m) => m.mockClear());
  h.tapsQuery.mockReset().mockResolvedValue({
    data: [row("a", { slide_number: 2 }), row("b", { slide_number: 2, anon_id: "s2" }), row("c", { slide_number: 4 })],
    error: null,
  });
  h.participantsQuery.mockReset().mockResolvedValue({ count: 7, error: null });
  h.lectureQuery.mockReset().mockResolvedValue({ data: { current_slide: 3, status: "live" }, error: null });
  h.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  h.slideUrls.mockReset().mockReturnValue({});
});

describe("LectureData live", () => {
  it("shows one bar per slide with people and taps, the joined count and the current slide", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    expect(screen.getAllByTestId(/^slide-\d+$/)).toHaveLength(5);
    expect(counts(1)).toBe("0 people, 0 taps");
    expect(counts(4)).toBe("1 person, 1 tap");
    expect(within(slideRow(2)).getByText("Heading 2")).toBeInTheDocument();
    expect(screen.getByText("7 joined")).toBeInTheDocument();
    expect(screen.getByText("Lecture 1, Oct 26")).toBeInTheDocument();
    expect(within(slideRow(3)).getByText("Current slide")).toBeInTheDocument();
    expect(within(slideRow(2)).queryByText("Current slide")).not.toBeInTheDocument();
  });

  it("sizes each bar against the slide with the most people", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    expect(within(slideRow(2)).getByTestId("bar")).toHaveStyle({ width: "100%" });
    expect(within(slideRow(4)).getByTestId("bar")).toHaveStyle({ width: "50%" });
    expect(within(slideRow(1)).getByTestId("bar")).toHaveStyle({ width: "0%" });
  });

  it("marks the top slides with Top 3 and nobody else", async () => {
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
    await waitFor(() => expect(counts(4)).toBe("3 people, 3 taps"));
    expect(screen.getAllByText("Top 3")).toHaveLength(3);
    expect(within(slideRow(4)).getByText("Top 3")).toBeInTheDocument();
    expect(within(slideRow(2)).getByText("Top 3")).toBeInTheDocument();
    expect(within(slideRow(1)).getByText("Top 3")).toBeInTheDocument();
    expect(within(slideRow(3)).queryByText("Top 3")).not.toBeInTheDocument();
    expect(within(slideRow(5)).queryByText("Top 3")).not.toBeInTheDocument();
  });

  it("reads only the lost rows of this lecture, and the participants and lecture row", async () => {
    renderLive();
    await waitFor(() => expect(screen.getByText("7 joined")).toBeInTheDocument());
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
    await waitFor(() => expect(counts(1)).toBe("1005 people, 1005 taps"));
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
    await waitFor(() => expect(counts(4)).toBe("1 person, 1 tap"));
    const reads = h.tapsQuery.mock.calls.length;
    insert(row("new1", { slide_number: 4, anon_id: "s9" }));
    expect(counts(4)).toBe("2 people, 2 taps");
    insert(row("new2", { slide_number: 4, anon_id: "s9" }));
    expect(counts(4)).toBe("2 people, 3 taps");
    expect(within(slideRow(4)).getByTestId("bar")).toHaveStyle({ width: "100%" });
    expect(h.tapsQuery.mock.calls.length).toBe(reads);
  });

  it("does not count the same row twice when its insert arrives again", async () => {
    renderLive();
    await waitFor(() => expect(counts(4)).toBe("1 person, 1 tap"));
    insert(row("c", { slide_number: 4 }));
    expect(counts(4)).toBe("1 person, 1 tap");
  });

  it("ignores a row that is not a lost tap", async () => {
    renderLive();
    await waitFor(() => expect(counts(4)).toBe("1 person, 1 tap"));
    insert(row("save1", { slide_number: 4, kind: "save", anon_id: "s5" }));
    expect(counts(4)).toBe("1 person, 1 tap");
  });

  it("lowers the bar when an update sets undone", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    update(row("a", { slide_number: 2, undone: true }));
    expect(counts(2)).toBe("1 person, 1 tap");
    update(row("b", { slide_number: 2, anon_id: "s2", undone: true }));
    expect(counts(2)).toBe("0 people, 0 taps");
    expect(within(slideRow(2)).queryByText("Top 3")).not.toBeInTheDocument();
  });

  it("moves a tap to its new slide when an update changes slide_number", async () => {
    renderLive();
    await waitFor(() => expect(counts(4)).toBe("1 person, 1 tap"));
    update(row("c", { slide_number: 1 }));
    expect(counts(4)).toBe("0 people, 0 taps");
    expect(counts(1)).toBe("1 person, 1 tap");
  });

  it("lists notes under the slide with no names, and drops the note of an undone tap", async () => {
    h.tapsQuery.mockResolvedValue({
      data: [
        row("a", { slide_number: 2, note: "what is a join?", anon_id: "student-secret-id" }),
        row("b", { slide_number: 2, note: "too fast", tapped_at: "2026-10-26T10:05:00Z" }),
        row("c", { slide_number: 4, note: "gone", undone: true }),
      ],
      error: null,
    });
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    const items = within(slideRow(2)).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["what is a join?", "too fast"]);
    expect(within(slideRow(4)).queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText(/student-secret-id/)).not.toBeInTheDocument();
    update(row("b", { slide_number: 2, note: "too fast", undone: true }));
    expect(within(slideRow(2)).getAllByRole("listitem")).toHaveLength(1);
  });

  it("adds one to the joined count for every participant insert", async () => {
    renderLive();
    await waitFor(() => expect(screen.getByText("7 joined")).toBeInTheDocument());
    act(() => h.handlers["participants:INSERT"]({ new: { lecture_id: LECTURE } }));
    expect(screen.getByText("8 joined")).toBeInTheDocument();
  });

  it("moves the current slide marker when the lecture row updates", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    act(() => h.handlers["lectures:UPDATE"]({ new: { current_slide: 5, status: "live" } }));
    expect(within(slideRow(5)).getByText("Current slide")).toBeInTheDocument();
    expect(within(slideRow(3)).queryByText("Current slide")).not.toBeInTheDocument();
  });

  it("reads everything again on every SUBSCRIBED", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    const before = h.tapsQuery.mock.calls.length;
    h.tapsQuery.mockResolvedValue({ data: [row("z", { slide_number: 5 })], error: null });
    h.participantsQuery.mockResolvedValue({ count: 12, error: null });
    h.lectureQuery.mockResolvedValue({ data: { current_slide: 4, status: "live" }, error: null });
    await act(async () => h.status?.("SUBSCRIBED"));
    await waitFor(() => expect(counts(5)).toBe("1 person, 1 tap"));
    expect(h.tapsQuery.mock.calls.length).toBe(before + 1);
    expect(counts(2)).toBe("0 people, 0 taps");
    expect(screen.getByText("12 joined")).toBeInTheDocument();
    expect(within(slideRow(4)).getByText("Current slide")).toBeInTheDocument();
  });

  it("keeps a row that arrived by Realtime while a read was running", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    let release!: (v: unknown) => void;
    h.tapsQuery.mockReturnValueOnce(new Promise((r) => (release = r)));
    await act(async () => h.status?.("SUBSCRIBED"));
    insert(row("live1", { slide_number: 5, anon_id: "s7" }));
    update(row("a", { slide_number: 2, undone: true }));
    await act(async () =>
      release({ data: [row("a", { slide_number: 2 }), row("b", { slide_number: 2, anon_id: "s2" })], error: null }),
    );
    expect(counts(5)).toBe("1 person, 1 tap");
    expect(counts(2)).toBe("1 person, 1 tap");
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
        expect(counts(1)).toBe("1 person, 1 tap");
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
        expect(counts(2)).toBe("2 people, 2 taps");

        h.tapsQuery.mockRejectedValue(new TypeError("Failed to fetch"));
        await act(async () => h.status?.("SUBSCRIBED"));
        const calls = h.tapsQuery.mock.calls.length;
        expect(counts(2)).toBe("2 people, 2 taps");

        await wait(999);
        expect(h.tapsQuery.mock.calls.length).toBe(calls);
        await wait(1);
        expect(h.tapsQuery.mock.calls.length).toBe(calls + 1);
        await wait(2000);
        expect(h.tapsQuery.mock.calls.length).toBe(calls + 2);
        expect(counts(2)).toBe("2 people, 2 taps");

        h.tapsQuery.mockResolvedValue({ data: [row("q", { slide_number: 3 })], error: null });
        await wait(4000);
        expect(counts(3)).toBe("1 person, 1 tap");
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
        expect(counts(2)).toBe("2 people, 2 taps");
        await wait(999);
        expect(h.tapsQuery.mock.calls.length).toBe(calls);
        await wait(1);
        expect(h.tapsQuery.mock.calls.length).toBe(calls + 1);
        expect(counts(2)).toBe("2 people, 2 taps");
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

describe("End lecture", () => {
  const DIALOG_TEXT = "End lecture? The code stops working and students go to My spots.";

  async function open() {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    fireEvent.click(screen.getByRole("button", { name: "End lecture" }));
  }

  it("shows no dialog until End lecture is pressed, then asks with the exact words", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "End lecture" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(DIALOG_TEXT)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "End" })).toBeInTheDocument();
  });

  it("Cancel closes the dialog and ends nothing", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "End lecture" })).toBeInTheDocument();
  });

  it("End calls end_lecture, then switches to past mode in place and says Lecture ended.", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    await waitFor(() => expect(screen.getByText("Lecture ended.")).toBeInTheDocument());
    expect(h.rpc).toHaveBeenCalledWith("end_lecture", { p_lecture_id: LECTURE });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End lecture" })).not.toBeInTheDocument();
    expect(h.removeChannel).toHaveBeenCalledWith(channel);
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    expect(screen.getByText("7 joined")).toBeInTheDocument();
    expect(screen.queryByText("Current slide")).not.toBeInTheDocument();
  });

  it("shows a plain error and stays live when ending fails", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "Not allowed." } });
    await open();
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not end the lecture."));
    expect(screen.queryByText("Lecture ended.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End lecture" })).toBeInTheDocument();
    expect(h.removeChannel).not.toHaveBeenCalled();
    h.rpc.mockResolvedValue({ data: null, error: null });
    fireEvent.click(screen.getByRole("button", { name: "End lecture" }));
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    await waitFor(() => expect(screen.getByText("Lecture ended.")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the same error when the request itself throws", async () => {
    h.rpc.mockRejectedValue(new TypeError("Failed to fetch"));
    await open();
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not end the lecture."));
    expect(screen.getByRole("button", { name: "End lecture" })).toBeInTheDocument();
  });

  it("switches to past mode when the lecture row says ended, whoever ended it", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    act(() => h.handlers["lectures:UPDATE"]({ new: { current_slide: 3, status: "ended" } }));
    expect(screen.queryByRole("button", { name: "End lecture" })).not.toBeInTheDocument();
    expect(screen.getByText("Lecture ended.")).toBeInTheDocument();
    expect(h.removeChannel).toHaveBeenCalledWith(channel);
  });
});

describe("Escape", () => {
  it("goes back to the projector", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    key("Escape");
    expect(h.push).toHaveBeenCalledWith(`/teach/l/${LECTURE}/present`);
  });

  it("is ignored while typing in an input", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    const input = document.createElement("input");
    document.body.appendChild(input);
    key("Escape", input);
    input.remove();
    expect(h.push).not.toHaveBeenCalled();
  });

  it("closes the confirm instead of leaving when it is open", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    fireEvent.click(screen.getByRole("button", { name: "End lecture" }));
    key("Escape");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.push).not.toHaveBeenCalled();
  });

  it("has no other shortcuts", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    for (const k of ["d", "D", "n", " ", "ArrowRight", "e", "Enter"]) key(k);
    expect(h.push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does nothing in past mode", async () => {
    renderLive({ mode: "past" });
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    key("Escape");
    expect(h.push).not.toHaveBeenCalled();
  });

  it("stops listening when it unmounts", async () => {
    const { unmount } = renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    unmount();
    key("Escape");
    expect(h.push).not.toHaveBeenCalled();
  });
});

describe("LectureData past", () => {
  it("loads once, subscribes to nothing and has no End button", async () => {
    renderLive({ mode: "past" });
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    expect(channel.on).not.toHaveBeenCalled();
    expect(channel.subscribe).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "End lecture" })).not.toBeInTheDocument();
    expect(screen.queryByText("Lecture ended.")).not.toBeInTheDocument();
    expect(h.tapsQuery).toHaveBeenCalledTimes(1);
  });

  it("shows the bars, Top 3, notes and joined count, with no current slide marker", async () => {
    h.tapsQuery.mockResolvedValue({ data: [row("a", { slide_number: 4, note: "ask again" })], error: null });
    renderLive({ mode: "past" });
    await waitFor(() => expect(counts(4)).toBe("1 person, 1 tap"));
    expect(within(slideRow(4)).getByText("Top 3")).toBeInTheDocument();
    expect(within(slideRow(4)).getByText("ask again")).toBeInTheDocument();
    expect(screen.getByText("7 joined")).toBeInTheDocument();
    expect(screen.queryByText("Current slide")).not.toBeInTheDocument();
  });

  it("links back to the course", async () => {
    renderLive({ mode: "past" });
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    expect(screen.getByRole("link", { name: "Back to the course" })).toHaveAttribute("href", "/teach/c/c1");
  });

  it("shows the lecture date like Oct 21 when it is given, and nothing when it is not", async () => {
    const { unmount } = renderLive({ mode: "past", lectureDate: "2026-10-21" });
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    expect(screen.getByText("Oct 21")).toBeInTheDocument();
    unmount();
    renderLive({ mode: "past" });
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    expect(screen.queryByText("Oct 21")).not.toBeInTheDocument();
  });

  it("shows what the page passes in as children (the rename field) under the heading", async () => {
    renderLive({ mode: "past", children: <p>rename here</p> });
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    const heading = screen.getByRole("heading", { name: "Lecture 1, Oct 26" });
    const child = screen.getByText("rename here");
    expect(heading.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does not need slide images: it reads taps and the joined count only, so a missing image object can not break it", async () => {
    renderLive({ mode: "past" });
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    expect(document.querySelector("img")).toBeNull();
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
      expect(counts(2)).toBe("2 people, 2 taps");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("LectureData highlights", () => {
  const HL = (x: number, y = 0.2) => ({ hl_x: x, hl_y: y, hl_w: 0.3, hl_h: 0.4 });
  const boxesOn = (n: number) => Array.from(slideRow(n).querySelectorAll<HTMLElement>("[data-highlight-box]"));
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
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    expect((h.tapsQuery.mock.calls[0][0] as Query).cols).toMatch(/hl_x, hl_y, hl_w, hl_h/);
  });

  it("draws every highlight of a slide as a translucent box over a small copy of the slide", async () => {
    withBoxes();
    h.slideUrls.mockReturnValue({ 2: "https://signed/2.webp", 5: "https://signed/5.webp" });
    renderLive();
    await waitFor(() => expect(boxesOn(2)).toHaveLength(2));
    const copy = within(slideRow(2)).getByRole("img");
    expect(copy).toHaveAttribute("src", "https://signed/2.webp");
    expect(copy.parentElement?.contains(boxesOn(2)[0])).toBe(true);
    expect(boxesOn(2)[0].style.left).toBe("10%");
    expect(boxesOn(2)[1].style.left).toBe("20%");
    expect(boxesOn(2)[0].className).toMatch(/\/\d+/);
    expect(boxesOn(5)).toHaveLength(1);
    expect(within(slideRow(5)).getByRole("img")).toHaveAttribute("src", "https://signed/5.webp");
  });

  it("shows nothing extra on a slide with taps but no highlight, and asks for images of highlighted slides only", async () => {
    withBoxes();
    renderLive();
    await waitFor(() => expect(counts(4)).toBe("1 person, 1 tap"));
    expect(within(slideRow(4)).queryByRole("img")).not.toBeInTheDocument();
    expect(boxesOn(4)).toHaveLength(0);
    expect(boxesOn(1)).toHaveLength(0);
    expect(h.slideUrls).toHaveBeenLastCalledWith(LECTURE, [2, 5]);
  });

  it("asks for no images at all when nobody highlighted, so a seeded lecture with missing images is never asked", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    expect(h.slideUrls).toHaveBeenLastCalledWith(LECTURE, []);
    expect(document.querySelector("img")).toBeNull();
  });

  it("draws the boxes on a blank slide until the image arrives", async () => {
    withBoxes();
    renderLive();
    await waitFor(() => expect(boxesOn(2)).toHaveLength(2));
    expect(within(slideRow(2)).queryByRole("img")).not.toBeInTheDocument();
  });

  it("adds a box from a Realtime insert and asks for that slide's image", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    insert(row("n", { slide_number: 3, anon_id: "s9", ...HL(0.4) }));
    await waitFor(() => expect(boxesOn(3)).toHaveLength(1));
    expect(h.slideUrls).toHaveBeenLastCalledWith(LECTURE, [3]);
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
    expect(h.slideUrls).toHaveBeenLastCalledWith(LECTURE, [2]);
  });

  it("never draws a save", async () => {
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("2 people, 2 taps"));
    insert(row("s", { kind: "save", slide_number: 3, ...HL(0.4) }));
    await act(async () => {});
    expect(boxesOn(3)).toHaveLength(0);
    expect(h.slideUrls).toHaveBeenLastCalledWith(LECTURE, []);
  });

  it("shows the highlights of a lecture that has ended", async () => {
    withBoxes();
    renderLive({ mode: "past" });
    await waitFor(() => expect(boxesOn(2)).toHaveLength(2));
    expect(h.slideUrls).toHaveBeenLastCalledWith(LECTURE, [2, 5]);
  });

  it("ignores a box that is not a valid rectangle", async () => {
    h.tapsQuery.mockResolvedValue({
      data: [row("a", { slide_number: 2, hl_x: 0.9, hl_y: 0.2, hl_w: 0.3, hl_h: 0.4 }), row("b", { slide_number: 2, hl_x: 0.1, hl_y: null, hl_w: null, hl_h: null })],
      error: null,
    });
    renderLive();
    await waitFor(() => expect(counts(2)).toBe("1 person, 2 taps"));
    expect(boxesOn(2)).toHaveLength(0);
  });
});
