import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

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
  return c;
}

const tables: Record<string, Result> = {};
const rpc = vi.fn();
const selectAfter = vi.fn();
const eqId = vi.fn(() => ({ select: selectAfter }));
const update = vi.fn(() => ({ eq: eqId }));
const from = vi.fn((table: string) => ({
  ...(chain(table, () => tables[table]) as object),
  update,
}));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => ({ from, rpc }) }));

const flush = vi.fn();
vi.mock("@/lib/tapSync", async (orig) => ({
  ...(await orig<typeof import("@/lib/tapSync")>()),
  flushLeftoverTaps: (id: string) => {
    calls.push("flush");
    return flush(id);
  },
}));

vi.mock("@/lib/useSlideImages", () => ({
  useSlideImages: () => ({ urlFor: (n: number) => `https://signed/${n}.webp` }),
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

function show() {
  return render(
    <SpotsView lectureId={LECTURE} userId={ME} lectureName="Lecture 3, Oct 26" lectureDate="2026-10-26" slideCount={12} />,
  );
}

beforeEach(() => {
  calls.length = 0;
  sessionStorage.clear();
  [rpc, selectAfter, eqId, update, from, flush].forEach((m) => m.mockClear());
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
  it("shows the lecture name, the date as Oct 26, and how many spots", async () => {
    show();
    expect(await screen.findByText("You saved 3 spots")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Lecture 3, Oct 26" })).toBeInTheDocument();
    expect(screen.getByText("Oct 26")).toBeInTheDocument();
  });

  it("says 1 spot for one", async () => {
    tables.lost_taps = { data: [tap("a", 3, "2026-10-26T14:05:00Z")], error: null };
    show();
    expect(await screen.findByText("You saved 1 spot")).toBeInTheDocument();
  });

  it("lists the spots in the order they were made, with slide, first line, note and kind", async () => {
    show();
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Slide 3");
    expect(items[0]).toHaveTextContent("Big O notation");
    expect(items[0]).toHaveTextContent("Lost");
    expect(items[1]).toHaveTextContent("Slide 9");
    expect(items[1]).toHaveTextContent("Induction");
    expect(items[1]).toHaveTextContent("the proof");
    expect(items[1]).toHaveTextContent("Lost");
    expect(items[2]).toHaveTextContent("Slide 5");
    expect(items[2]).toHaveTextContent("read later");
    expect(items[2]).toHaveTextContent("Saved");
  });

  it("asks only for the student's own rows that are not undone", async () => {
    show();
    await screen.findByText("You saved 3 spots");
    expect(calls).toContain("lost_taps.eq(lecture_id," + LECTURE + ")");
    expect(calls).toContain("lost_taps.eq(undone,false)");
    expect(calls).toContain("lost_taps.eq(anon_id," + ME + ")");
    expect(rpc).toHaveBeenCalledWith("lecture_slide_stats", { p_lecture_id: LECTURE });
  });

  it("shows the empty state when there are no spots", async () => {
    tables.lost_taps = { data: [], error: null };
    show();
    expect(await screen.findByText("You didn't mark any spots in this lecture.")).toBeInTheDocument();
    expect(screen.queryByText(/You saved/)).not.toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("has no coming soon text, no slide count and no name promise", async () => {
    const { container } = show();
    await screen.findByText("You saved 3 spots");
    expect(container.textContent).not.toMatch(/coming soon/i);
    expect(container.textContent).not.toMatch(/\b12\b/);
    expect(container.textContent).not.toMatch(/nobody sees/i);
  });

  it("has a help button", async () => {
    show();
    await screen.findByText("You saved 3 spots");
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
  });

  it("links to all lectures", async () => {
    show();
    await screen.findByText("You saved 3 spots");
    expect(screen.getByRole("link", { name: "All lectures" })).toHaveAttribute("href", "/spots");
  });
});

describe("SpotsView: waiting taps and the rejected notice", () => {
  it("sends waiting taps before it loads the student's taps", async () => {
    show();
    await screen.findByText("You saved 3 spots");
    expect(flush).toHaveBeenCalledWith(LECTURE);
    expect(calls.indexOf("flush")).toBeLessThan(calls.findIndex((c) => c.startsWith("lost_taps.")));
  });

  it("shows no notice when nothing was refused", async () => {
    show();
    await screen.findByText("You saved 3 spots");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the notice once, at the top, and clears the key", async () => {
    sessionStorage.setItem(rejectedKey(LECTURE), "1");
    const { unmount } = show();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This one didn't save because the lecture had ended.");
    expect(sessionStorage.getItem(rejectedKey(LECTURE))).toBeNull();
    expect(alert.compareDocumentPosition(screen.getByRole("heading", { name: "Lecture 3, Oct 26" }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    unmount();
    show();
    await screen.findByText("You saved 3 spots");
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
    expect(await screen.findByText("You saved 3 spots")).toBeInTheDocument();
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
        <SpotsView lectureId={LECTURE} userId={ME} lectureName="L" lectureDate="2026-10-26" slideCount={12} />
      </Catch>,
    );
    expect(await screen.findByText("caught: taps broke")).toBeInTheDocument();
    expect(screen.queryByText("You didn't mark any spots in this lecture.")).not.toBeInTheDocument();
    spy.mockRestore();
  });
});

describe("SpotsView: opening a spot", () => {
  async function open(slide: string) {
    show();
    await screen.findByText("You saved 3 spots");
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
    fireEvent.click(screen.getByRole("button", { name: "Back to my spots" }));
    expect(await screen.findByText("You saved 3 spots")).toBeInTheDocument();
  });

  it("moving the marker updates the row, asks for the counts again and shows the new slide's count", async () => {
    await open("9");
    expect(rpc).toHaveBeenCalledTimes(1);
    rpc.mockResolvedValue({ data: allStats({ 3: 4, 5: 2, 8: 3 }), error: null });
    fireEvent.click(screen.getByRole("button", { name: "Move marker one slide earlier" }));
    expect(await screen.findByText("3 people got lost here")).toBeInTheDocument();
    expect(update).toHaveBeenCalledWith({ slide_number: 8 });
    expect(eqId).toHaveBeenCalledWith("id", "b");
    expect(rpc).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Back to my spots" }));
    const items = await screen.findAllByRole("listitem");
    expect(items[1]).toHaveTextContent("Slide 8");
    expect(items[1]).toHaveTextContent("Base case");
  });

  it("a saved note shows in the list", async () => {
    await open("3");
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "ask Dr. Lee" } });
    selectAfter.mockResolvedValue({ data: [{ id: "a" }], error: null });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Back to my spots" }));
    const items = await screen.findAllByRole("listitem");
    expect(within(items[0]).getByText("ask Dr. Lee")).toBeInTheDocument();
  });
});

describe("SpotsView: highlights", () => {
  const withBox = (id: string, slide: number, at: string, hl: Record<string, unknown>) => ({ ...tap(id, slide, at), ...hl });
  const boxes = () => Array.from(document.querySelectorAll<HTMLElement>("[data-highlight-box]"));
  const HL = { hl_x: 0.1, hl_y: 0.2, hl_w: 0.3, hl_h: 0.4 };

  async function open(slide: string) {
    show();
    await screen.findByText(/You saved \d+ spots?/);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Slide ${slide}`) }));
  }

  it("asks for the four hl_ columns", async () => {
    show();
    await screen.findByText("You saved 3 spots");
    expect(calls.find((c) => c.startsWith("lost_taps.select("))).toMatch(/hl_x, hl_y, hl_w, hl_h/);
  });

  it("draws the highlight of the spot that has one", async () => {
    tables.lost_taps = { data: [withBox("a", 3, "2026-10-26T14:05:00Z", HL)], error: null };
    await open("3");
    expect(boxes()).toHaveLength(1);
    expect(boxes()[0].style.left).toBe("10%");
    expect(boxes()[0].style.height).toBe("40%");
    expect(screen.getByRole("button", { name: "Change highlight" })).toBeInTheDocument();
  });

  it("draws nothing for a spot with no highlight, or a half filled one", async () => {
    tables.lost_taps = {
      data: [tap("a", 3, "2026-10-26T14:05:00Z"), withBox("b", 5, "2026-10-26T14:06:00Z", { hl_x: 0.1, hl_y: null, hl_w: null, hl_h: null })],
      error: null,
    };
    await open("3");
    expect(boxes()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Highlight" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to my spots" }));
    fireEvent.click(await screen.findByRole("button", { name: /Slide 5/ }));
    expect(boxes()).toHaveLength(0);
  });

  it("keeps a changed highlight when the student goes back to the list and opens the spot again", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: 1000, bottom: 500, x: 0, y: 0, width: 1000, height: 500, toJSON: () => ({}),
    });
    tables.lost_taps = { data: [tap("b", 9, "2026-10-26T14:20:00Z")], error: null };
    await open("9");
    fireEvent.click(screen.getByRole("button", { name: "Highlight" }));
    const layer = document.querySelector("[data-highlight-layer]") as HTMLElement;
    const mouse = { pointerType: "mouse", button: 0, pointerId: 1 };
    fireEvent.pointerDown(layer, { ...mouse, clientX: 500, clientY: 250 });
    fireEvent.pointerUp(layer, { ...mouse, clientX: 900, clientY: 450 });
    await screen.findByText("Highlight saved");
    expect(update).toHaveBeenCalledWith({ hl_x: 0.5, hl_y: 0.5, hl_w: 0.4, hl_h: 0.4 });
    expect(eqId).toHaveBeenCalledWith("id", "b");
    fireEvent.click(screen.getByRole("button", { name: "Back to my spots" }));
    fireEvent.click(await screen.findByRole("button", { name: /Slide 9/ }));
    expect(boxes()).toHaveLength(1);
    expect(boxes()[0].style.left).toBe("50%");
    vi.restoreAllMocks();
  });

  it("moving the marker clears the highlight, in the list state too", async () => {
    tables.lost_taps = { data: [withBox("b", 9, "2026-10-26T14:20:00Z", HL)], error: null };
    await open("9");
    rpc.mockResolvedValue({ data: allStats({ 8: 3 }), error: null });
    fireEvent.click(screen.getByRole("button", { name: "Move marker one slide earlier" }));
    await screen.findByText("3 people got lost here");
    expect(update).toHaveBeenCalledWith({ slide_number: 8, hl_x: null, hl_y: null, hl_w: null, hl_h: null });
    expect(boxes()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Highlight" })).toBeInTheDocument();
  });
});
