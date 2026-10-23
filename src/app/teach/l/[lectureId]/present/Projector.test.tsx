import { describe, it, expect, vi, beforeEach } from "vitest";
import { Activity, StrictMode } from "react";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";

// The slide write: update(...).eq(...).select(...).abortSignal(...).maybeSingle() -> single().
const single = vi.fn();
const abortSignal = vi.fn();
const filters = { eq: vi.fn(), select: vi.fn(), abortSignal, maybeSingle: single };
filters.eq.mockImplementation(() => filters);
filters.select.mockImplementation(() => filters);
abortSignal.mockImplementation(() => filters);
const eq = filters.eq;
const select = filters.select;
const update = vi.fn(() => filters);
// The read after a write that moved no row: select(...).eq(...).abortSignal(...).maybeSingle() -> read().
const read = vi.fn();
const readChain = { eq: vi.fn(), abortSignal: vi.fn(), maybeSingle: read };
readChain.eq.mockImplementation(() => readChain);
readChain.abortSignal.mockImplementation(() => readChain);
const readSelect = vi.fn(() => readChain);
const from = vi.fn(() => ({ update, select: readSelect }));
const rpc = vi.fn<(fn: string, args: unknown) => Promise<{ data: null; error: { message: string } | null }>>(
  async () => ({ data: null, error: null }),
);
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => ({ from, rpc }) }));

let liveEnded = false;
let here: number | null = null;
const useLiveLecture = vi.fn((...args: [string, number?]) => ({
  state: { ended: liveEnded },
  args,
}));
vi.mock("@/lib/useLiveLecture", () => ({
  useLiveLecture: (id: string, initial?: number) => useLiveLecture(id, initial),
}));
const useHereCount = vi.fn((...args: [string, boolean]) => (args[1] ? here : null));
vi.mock("@/lib/useHere", () => ({
  useHereCount: (id: string, enabled: boolean) => useHereCount(id, enabled),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const urlFor = vi.fn<(n: number) => string | undefined>((n: number) => `https://signed/${n}.webp`);
let imagesLoaded = true;
const useSlideImages = vi.fn((...args: [string, number?]) => ({ urlFor, loaded: imagesLoaded, args }));
vi.mock("@/lib/useSlideImages", () => ({
  useSlideImages: (id: string, current?: number) => useSlideImages(id, current),
}));

let joined: number | null = 0;
const useJoinedCount = vi.fn<(id: string) => number | null>(() => joined);
vi.mock("@/lib/useJoinedCount", () => ({ useJoinedCount: (id: string) => useJoinedCount(id) }));

import { Projector, joinCardKey, CONTINUED_MS } from "./Projector";
import { fullscreenReturnKey } from "@/lib/fullscreenReturn";

const LECTURE = "11111111-1111-1111-1111-111111111111";

function show(props: Partial<{ initialSlide: number; slideCount: number }> = {}) {
  return render(
    <Projector
      lectureId={LECTURE}
      code="482916"
      siteAddress="backtrack-ebon-sigma.vercel.app"
      initialSlide={props.initialSlide ?? 1}
      slideCount={props.slideCount ?? 10}
      courseId="c1"
    />,
  );
}

const press = (key: string) => fireEvent.keyDown(window, { key });
const shownSlide = () => screen.getByRole("img").getAttribute("src");

beforeEach(() => {
  [single, select, eq, update, from, push, urlFor, useSlideImages, useJoinedCount, useLiveLecture, useHereCount, rpc, abortSignal, read, readSelect].forEach(
    (m) => m.mockClear(),
  );
  urlFor.mockImplementation((n: number) => `https://signed/${n}.webp`);
  imagesLoaded = true;
  read.mockImplementation(async () => ({ data: null, error: null }));
  rpc.mockImplementation(async () => ({ data: null, error: null }));
  joined = 0;
  here = null;
  liveEnded = false;
  window.localStorage.clear();
  single.mockImplementation(async () => ({ data: { current_slide: 0 }, error: null }));
});

describe("Projector", () => {
  it("opens on the join card with the address and the code", () => {
    show();
    const card = screen.getByTestId("join-card");
    expect(card).toHaveTextContent("backtrack-ebon-sigma.vercel.app");
    expect(card).toHaveTextContent("482916");
    expect(screen.queryByTestId("projector-code")).not.toBeInTheDocument();
    expect(screen.getByText("backtrack-ebon-sigma.vercel.app")).toBeInTheDocument();
    expect(screen.getByText("482916")).toBeInTheDocument();
  });

  it("shows how many students have joined on the join card and in the bar", () => {
    joined = 12;
    show();
    expect(useJoinedCount).toHaveBeenCalledWith(LECTURE);
    expect(screen.getByTestId("join-card")).toHaveTextContent("12 joined");
    press("ArrowRight");
    expect(screen.getByTestId("projector-code")).toHaveTextContent("482916");
    expect(screen.getByTestId("projector-count")).toHaveTextContent("12 joined");
  });

  it("shows no count until the first count has arrived", () => {
    joined = null;
    show();
    press("ArrowRight");
    expect(screen.queryByTestId("projector-count")).toBeNull();
    expect(screen.getByTestId("projector-bar")).not.toHaveTextContent(/joined/);
  });

  it("shows the lecture's current slide letterboxed in the space above the bar, not stretched", () => {
    show({ initialSlide: 4 });
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://signed/4.webp");
    expect(img.className).toContain("object-contain");
    expect(useSlideImages).toHaveBeenLastCalledWith(LECTURE, 4);
    // The slide lives in the stage; the bar is its own strip under it, never on top of it.
    const stage = screen.getByTestId("projector-stage");
    const bar = screen.getByTestId("projector-bar");
    expect(stage).toContainElement(img);
    expect(stage).not.toContainElement(bar);
    expect(stage.className).toContain("flex-1");
    expect(bar.className).toContain("shrink-0");
    expect(stage.nextElementSibling).toBe(bar);
  });

  it("the join card says where to go and the code as one centered block, and the bar says how to start", () => {
    joined = 7;
    show();
    const card = screen.getByTestId("join-card");
    expect(card).toHaveTextContent("backtrack");
    const block = within(card).getByTestId("join-block");
    // Marko, hand test 2: no "Go to". The address is the clear, strong line (ink, the wordmark's
    // weight), with the code big under it.
    expect(block).not.toHaveTextContent("Go to");
    const address = within(block).getByTestId("join-address");
    expect(address.textContent).toBe("backtrack-ebon-sigma.vercel.app");
    expect(address.className).toContain("font-semibold");
    expect(address.className).toContain("text-ink");
    expect(address.querySelector(".text-secondary")).toBeNull();
    expect(block).toHaveTextContent(/^backtrack-ebon-sigma\.vercel\.app482916/);
    expect(block).toHaveTextContent("482916");
    // The joined count stays, under the code.
    expect(block).toHaveTextContent(/482916.*7 joined/);
    expect(block.className).toContain("items-center");
    expect(block.className).toContain("text-center");
    expect(card).not.toHaveTextContent("Press → or click to start");
    expect(screen.getByTestId("projector-bar")).toHaveTextContent("Press → or click to start");
  });

  it("the join card fades out over the slide after the first arrow: a copy hidden from screen readers, then gone", async () => {
    vi.useFakeTimers();
    try {
      const { container } = show();
      press("ArrowRight");
      expect(screen.queryByTestId("join-card")).not.toBeInTheDocument();
      const ghost = container.querySelector('[aria-hidden="true"].pointer-events-none');
      expect(ghost).not.toBeNull();
      expect(ghost).toHaveTextContent("482916");
      await act(async () => vi.advanceTimersByTimeAsync(400));
      expect(container.querySelector('[aria-hidden="true"].pointer-events-none')).toBeNull();
      expect(screen.getByTestId("projector-code")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("first ArrowRight hides the join card and does not change the slide", () => {
    show();
    press("ArrowRight");
    expect(screen.queryByTestId("join-card")).not.toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
    expect(shownSlide()).toBe("https://signed/1.webp");
  });

  it("keeps the address and code small in the bar once the join card is gone", () => {
    show();
    press("ArrowRight");
    const code = screen.getByTestId("projector-code");
    expect(code).toHaveTextContent("backtrack-ebon-sigma.vercel.app");
    expect(code).toHaveTextContent("482916");
    expect(code.className).not.toMatch(/type-title|type-number|text-\[min/);
  });

  it("ignores ArrowRight with Cmd held: no update and the join card stays", () => {
    show();
    fireEvent.keyDown(window, { key: "ArrowRight", metaKey: true });
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByTestId("join-card")).toBeInTheDocument();
  });

  it("has no key binds: d, Escape, n, p, b, . and j do nothing, and the join card stays", () => {
    show();
    for (const k of ["d", "D", "Escape", "n", "p", "b", ".", "j", "f", "Enter"]) press(k);
    expect(push).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByTestId("join-card")).toBeInTheDocument();
  });

  it("ignores Cmd+d: does not open the data view", () => {
    show();
    fireEvent.keyDown(window, { key: "d", metaKey: true });
    expect(push).not.toHaveBeenCalled();
  });

  it("second ArrowRight updates current_slide to 2 and redraws after the write succeeds", async () => {
    show();
    press("ArrowRight");
    press("ArrowRight");
    expect(from).toHaveBeenCalledWith("lectures");
    expect(update).toHaveBeenCalledWith({ current_slide: 2 });
    expect(eq).toHaveBeenCalledWith("id", LECTURE);
    // Only a live lecture moves, and only from the slide on screen.
    expect(eq).toHaveBeenCalledWith("status", "live");
    expect(eq).toHaveBeenCalledWith("current_slide", 1);
    await waitFor(() => expect(shownSlide()).toBe("https://signed/2.webp"));
  });

  it("does not redraw until the write has finished", async () => {
    let finish!: (v: unknown) => void;
    single.mockImplementation(() => new Promise((r) => (finish = r)));
    show();
    press("ArrowRight");
    press("ArrowRight");
    expect(shownSlide()).toBe("https://signed/1.webp");
    await act(async () => finish({ data: { current_slide: 2 }, error: null }));
    expect(shownSlide()).toBe("https://signed/2.webp");
  });

  it("keeps presses made while an update is in flight and sends the newest slide when it returns", async () => {
    let finish!: (v: unknown) => void;
    single.mockImplementation(() => new Promise((r) => (finish = r)));
    show();
    press("ArrowRight"); // hides the join card
    press("ArrowRight");
    press("ArrowRight");
    press("PageDown");
    // One write at a time.
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenLastCalledWith({ current_slide: 2 });
    await act(async () => finish({ data: { current_slide: 2 }, error: null }));
    // A quick double press skipped two slides: the newest wanted slide goes out next.
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith({ current_slide: 4 });
    expect(shownSlide()).toBe("https://signed/2.webp");
    await act(async () => finish({ data: { current_slide: 4 }, error: null }));
    expect(shownSlide()).toBe("https://signed/4.webp");
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("a press back while a forward is in flight cancels out: nothing more is sent", async () => {
    let finish!: (v: unknown) => void;
    single.mockImplementation(() => new Promise((r) => (finish = r)));
    show({ initialSlide: 4 });
    press("ArrowRight");
    press("ArrowLeft");
    press("ArrowLeft");
    await act(async () => finish({ data: { current_slide: 5 }, error: null }));
    expect(update).toHaveBeenLastCalledWith({ current_slide: 3 });
    await act(async () => finish({ data: { current_slide: 3 }, error: null }));
    expect(shownSlide()).toBe("https://signed/3.webp");
  });

  it("drops the presses made during a write that failed: the next press starts from the slide on screen", async () => {
    let finish!: (v: unknown) => void;
    single.mockImplementation(() => new Promise((r) => (finish = r)));
    show({ initialSlide: 4 });
    press("ArrowRight");
    press("ArrowRight");
    await act(async () => finish({ data: null, error: { message: "nope" } }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't move to slide 5. Try again.");
    press("ArrowRight");
    expect(update).toHaveBeenLastCalledWith({ current_slide: 5 });
  });

  it("ArrowRight on the last slide makes no update call", () => {
    show({ initialSlide: 10, slideCount: 10 });
    press("ArrowRight");
    press("ArrowRight");
    expect(update).not.toHaveBeenCalled();
    expect(shownSlide()).toBe("https://signed/10.webp");
  });

  it("ArrowLeft goes back one slide", async () => {
    show({ initialSlide: 3 });
    press("ArrowLeft");
    expect(update).toHaveBeenCalledWith({ current_slide: 2 });
    await waitFor(() => expect(shownSlide()).toBe("https://signed/2.webp"));
  });

  it("ArrowLeft on slide 1 makes no update call", () => {
    show({ initialSlide: 1 });
    press("ArrowRight");
    press("ArrowLeft");
    expect(update).not.toHaveBeenCalled();
  });

  it("the other next and prev keys work too", async () => {
    show({ initialSlide: 5 });
    press("PageDown");
    expect(update).toHaveBeenLastCalledWith({ current_slide: 6 });
    await waitFor(() => expect(shownSlide()).toBe("https://signed/6.webp"));
    press("PageUp");
    expect(update).toHaveBeenLastCalledWith({ current_slide: 5 });
  });

  it("a failed update shows an error line and keeps the slide where it was", async () => {
    single.mockResolvedValue({ data: null, error: { message: "nope" } });
    show();
    press("ArrowRight");
    press("ArrowRight");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't move to slide 2. Try again.");
    expect(shownSlide()).toBe("https://signed/1.webp");
  });

  it("a thrown update is also reported and the slide stays", async () => {
    single.mockRejectedValue(new Error("network"));
    show();
    press("ArrowRight");
    press("ArrowRight");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(shownSlide()).toBe("https://signed/1.webp");
  });

  it("the error clears and the next key works after a failure", async () => {
    single.mockResolvedValueOnce({ data: null, error: { message: "nope" } });
    show();
    press("ArrowRight");
    press("ArrowRight");
    await screen.findByRole("alert");
    single.mockResolvedValue({ data: { current_slide: 2 }, error: null });
    press("ArrowRight");
    await waitFor(() => expect(shownSlide()).toBe("https://signed/2.webp"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Escape does nothing", () => {
    show();
    press("Escape");
    expect(push).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByTestId("join-card")).toBeInTheDocument();
  });

  it("ignores a held key", () => {
    show();
    fireEvent.keyDown(window, { key: "ArrowRight", repeat: true });
    expect(screen.getByTestId("join-card")).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("typing in a text box never changes the slide", () => {
    show();
    press("ArrowRight"); // hides the join card
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "ArrowRight" });
    fireEvent.keyDown(input, { key: "n" });
    input.remove();
    expect(update).not.toHaveBeenCalled();
    expect(shownSlide()).toBe("https://signed/1.webp");
  });

  it("the Fullscreen button asks the browser for fullscreen on the whole page", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    document.documentElement.requestFullscreen = requestFullscreen;
    try {
      show();
      fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
      await act(async () => {});
      expect(requestFullscreen).toHaveBeenCalled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      delete (document.documentElement as Partial<HTMLElement>).requestFullscreen;
    }
  });

  it("takes no keyboard lock (Esc leaves fullscreen the browser's way)", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const lock = vi.fn().mockResolvedValue(undefined);
    document.documentElement.requestFullscreen = requestFullscreen;
    Object.defineProperty(navigator, "keyboard", { configurable: true, value: { lock, unlock: vi.fn() } });
    try {
      show();
      fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
      await act(async () => {});
      expect(requestFullscreen).toHaveBeenCalled();
      expect(lock).not.toHaveBeenCalled();
    } finally {
      delete (document.documentElement as Partial<HTMLElement>).requestFullscreen;
      delete (navigator as { keyboard?: unknown }).keyboard;
    }
  });

  it("says so when fullscreen is refused", async () => {
    document.documentElement.requestFullscreen = vi.fn().mockRejectedValue(new Error("denied"));
    try {
      show();
      fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not change fullscreen.");
    } finally {
      delete (document.documentElement as Partial<HTMLElement>).requestFullscreen;
    }
  });

  it("Fullscreen again leaves fullscreen, and Escape on the page changes nothing", async () => {
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => document.documentElement });
    document.exitFullscreen = exitFullscreen;
    try {
      show({ initialSlide: 3 });
      press("Escape");
      expect(exitFullscreen).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
      await act(async () => {});
      expect(exitFullscreen).toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    } finally {
      delete (document as { fullscreenElement?: unknown }).fullscreenElement;
      delete (document as Partial<Document>).exitFullscreen;
    }
  });

  it("has a Data link, an End class button and Fullscreen, and no End lecture link", () => {
    show();
    expect(screen.getByRole("link", { name: "Data" })).toHaveAttribute("href", `/teach/l/${LECTURE}/live`);
    expect(screen.getByRole("button", { name: "End class" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Fullscreen" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "End lecture" })).toBeNull();
  });

  it("arrow keys and Space still move the slide while a link has focus, and the link does nothing", async () => {
    show();
    press("ArrowRight"); // hides the join card
    const link = screen.getByRole("link", { name: "Data" });
    link.focus();
    expect(link).toHaveFocus();
    // Not prevented would let Space scroll the page or click the focused link.
    expect(fireEvent.keyDown(link, { key: " " })).toBe(false);
    await waitFor(() => expect(shownSlide()).toBe("https://signed/2.webp"));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ current_slide: 2 });
    expect(push).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(link, { key: "ArrowRight" })).toBe(false);
    await waitFor(() => expect(shownSlide()).toBe("https://signed/3.webp"));
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("Data in fullscreen leaves fullscreen first and remembers it for Back to slides (Marko: 'If I click on data, nothing will show')", async () => {
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => document.documentElement });
    document.exitFullscreen = exitFullscreen;
    window.sessionStorage.clear();
    try {
      show({ initialSlide: 3 });
      const data = screen.getByRole("link", { name: "Data" });
      data.addEventListener("click", (e) => e.preventDefault()); // jsdom cannot navigate
      fireEvent.click(data);
      await act(async () => {});
      expect(exitFullscreen).toHaveBeenCalledTimes(1);
      expect(window.sessionStorage.getItem(fullscreenReturnKey(LECTURE))).toBe("1");
      expect(update).not.toHaveBeenCalled();
    } finally {
      delete (document as { fullscreenElement?: unknown }).fullscreenElement;
      delete (document as Partial<Document>).exitFullscreen;
      window.sessionStorage.clear();
    }
  });

  it("Data out of fullscreen forgets a flag left from earlier, so Back to slides can't go fullscreen unasked (review M1)", async () => {
    window.sessionStorage.setItem(fullscreenReturnKey(LECTURE), "1");
    try {
      show({ initialSlide: 3 });
      const data = screen.getByRole("link", { name: "Data" });
      data.addEventListener("click", (e) => e.preventDefault());
      fireEvent.click(data);
      expect(window.sessionStorage.getItem(fullscreenReturnKey(LECTURE))).toBeNull();
    } finally {
      window.sessionStorage.clear();
    }
  });

  it("shown again (browser Back from Data) it forgets the flag too", async () => {
    vi.useFakeTimers();
    try {
      const props = { lectureId: LECTURE, code: "482916", siteAddress: "backtrack.courses", slideCount: 10, courseId: "c1" };
      const view = render(
        <Activity mode="visible">
          <Projector {...props} initialSlide={3} />
        </Activity>,
      );
      window.sessionStorage.setItem(fullscreenReturnKey(LECTURE), "1");
      view.rerender(
        <Activity mode="hidden">
          <Projector {...props} initialSlide={3} />
        </Activity>,
      );
      await act(async () => vi.advanceTimersByTimeAsync(10));
      view.rerender(
        <Activity mode="visible">
          <Projector {...props} initialSlide={3} />
        </Activity>,
      );
      expect(window.sessionStorage.getItem(fullscreenReturnKey(LECTURE))).toBeNull();
    } finally {
      vi.useRealTimers();
      window.sessionStorage.clear();
    }
  });

  it("Data out of fullscreen leaves the window alone", async () => {
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    document.exitFullscreen = exitFullscreen;
    window.sessionStorage.clear();
    try {
      show({ initialSlide: 3 });
      const data = screen.getByRole("link", { name: "Data" });
      data.addEventListener("click", (e) => e.preventDefault());
      fireEvent.click(data);
      await act(async () => {});
      expect(exitFullscreen).not.toHaveBeenCalled();
      expect(window.sessionStorage.getItem(fullscreenReturnKey(LECTURE))).toBeNull();
    } finally {
      delete (document as Partial<Document>).exitFullscreen;
    }
  });

  it("clicking a link changes no slide", () => {
    show();
    press("ArrowRight"); // hides the join card
    const data = screen.getByRole("link", { name: "Data" });
    data.addEventListener("click", (e) => e.preventDefault()); // jsdom cannot navigate
    fireEvent.click(data);
    expect(update).not.toHaveBeenCalled();
    expect(shownSlide()).toBe("https://signed/1.webp");
  });
});

describe("Projector join card only on the first open", () => {
  it("does not show on a projector opened mid lecture (Resume, or back from the data view), and the first arrow advances", async () => {
    show({ initialSlide: 4 });
    expect(screen.queryByTestId("join-card")).not.toBeInTheDocument();
    expect(screen.getByTestId("projector-code")).toHaveTextContent("482916");
    press("ArrowRight");
    expect(update).toHaveBeenCalledWith({ current_slide: 5 });
    await waitFor(() => expect(shownSlide()).toBe("https://signed/5.webp"));
  });

  it("does not show again on slide 1 once it was put away (Data and back, or a reload)", async () => {
    const first = show();
    press("ArrowRight"); // puts the card away
    expect(window.localStorage.getItem(joinCardKey(LECTURE))).toBe("1");
    first.unmount();
    // The projector page mounts fresh after Back to slides from the data view.
    show();
    expect(screen.queryByTestId("join-card")).not.toBeInTheDocument();
    press("ArrowRight");
    expect(update).toHaveBeenCalledWith({ current_slide: 2 });
    await waitFor(() => expect(shownSlide()).toBe("https://signed/2.webp"));
  });

  it("shows only on the very first open: a reload or Resume on slide 1 goes to the slide, even if the card was never put away", () => {
    const first = show();
    expect(screen.getByTestId("join-card")).toBeInTheDocument();
    expect(window.localStorage.getItem(joinCardKey(LECTURE))).toBe("1");
    first.unmount();
    show();
    expect(screen.queryByTestId("join-card")).not.toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://signed/1.webp");
    // Still on the first slide: nothing to continue from.
    expect(screen.queryByTestId("continued")).toBeNull();
  });

  it("is remembered for the browser, not just the tab (Resume from a new tab)", () => {
    window.localStorage.setItem(joinCardKey(LECTURE), "1");
    show();
    expect(screen.queryByTestId("join-card")).not.toBeInTheDocument();
  });

  it("is per lecture", () => {
    window.localStorage.setItem(joinCardKey("22222222-2222-2222-2222-222222222222"), "1");
    show();
    expect(screen.getByTestId("join-card")).toBeInTheDocument();
  });

  it("works with storage blocked: the card shows and the first arrow puts it away", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      show();
      expect(screen.getByTestId("join-card")).toBeInTheDocument();
      press("ArrowRight");
      expect(screen.queryByTestId("join-card")).not.toBeInTheDocument();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});

describe("Projector after the lecture ended somewhere else", () => {
  it("follows the lecture's status with the shared live hook, and counts (never joins) who is here on its own channel", () => {
    show({ initialSlide: 3 });
    expect(useLiveLecture).toHaveBeenCalledWith(LECTURE, 3);
    expect(useHereCount).toHaveBeenCalledWith(LECTURE, true);
  });

  it("shows the ended state when the hook hears the end, and keys do nothing", () => {
    liveEnded = true;
    show({ initialSlide: 3 });
    expect(screen.getByText("This class has ended.")).toHaveClass("type-projector-l");
    const back = screen.getByRole("link", { name: "Back to the course" });
    expect(back).toHaveAttribute("href", "/teach/c/c1");
    // A quiet white button: the line is for the room, the button for the teacher.
    expect(back.className).toContain("bg-surface");
    expect(back.className).not.toContain("bg-ink");
    expect(screen.queryByText("482916")).not.toBeInTheDocument();
    press("ArrowRight");
    expect(update).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "End class" })).toBeNull();
  });

  it("shows the ended state when a slide change finds no live lecture to move", async () => {
    single.mockResolvedValue({ data: null, error: null });
    show({ initialSlide: 3 });
    press("ArrowRight");
    expect(await screen.findByText("This class has ended.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    press("ArrowRight");
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe("Projector controls row", () => {
  const row = () => screen.getByTestId("projector-controls");

  it("puts the address, code and count in the bar, with the controls in their own group", () => {
    joined = 38;
    show();
    press("ArrowRight");
    const code = screen.getByTestId("projector-code");
    expect(code).toHaveTextContent("backtrack-ebon-sigma.vercel.app");
    expect(code).toHaveTextContent("482916");
    expect(screen.getByTestId("projector-count")).toHaveTextContent("38 joined");
    expect(within(code).queryByRole("link", { name: "Data" })).toBeNull();
    expect(within(code).queryByRole("button", { name: "End class" })).toBeNull();
    expect(screen.getByTestId("projector-bar")).toContainElement(row());
    expect(within(row()).getByRole("link", { name: "Data" })).toHaveAttribute("href", `/teach/l/${LECTURE}/live`);
    expect(within(row()).getByRole("button", { name: "End class" })).toBeInTheDocument();
    expect(within(row()).getByRole("button", { name: "Fullscreen" })).toBeInTheDocument();
    expect(within(row()).getByRole("button", { name: "Show code" })).toBeInTheDocument();
  });

  it("is the same single row on the join card, without Show code there", () => {
    show();
    expect(screen.getByTestId("join-card")).toBeInTheDocument();
    expect(screen.getAllByTestId("projector-controls")).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "Data" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Show code" })).toBeNull();
  });

  it("is always shown: no fade, no idle timer, no pointer listeners", () => {
    vi.useFakeTimers();
    const added = vi.spyOn(window, "addEventListener");
    try {
      show();
      expect(row().className).not.toMatch(/opacity-0/);
      expect(row()).not.toHaveAttribute("data-awake");
      act(() => vi.advanceTimersByTime(60000));
      expect(row().className).not.toMatch(/opacity-0/);
      const types = added.mock.calls.map((c) => c[0]);
      expect(types).not.toContain("pointermove");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      added.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("Projector join card click", () => {
  it("a click on the join card starts too, without moving the slide", () => {
    show();
    fireEvent.click(screen.getByTestId("join-card"));
    expect(screen.queryByTestId("join-card")).not.toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(joinCardKey(LECTURE))).toBe("1");
    expect(screen.getByTestId("projector-code")).toBeInTheDocument();
  });

  it("a click on the controls over the card does not put it away", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "End class" }));
    expect(screen.getByTestId("join-card")).toBeInTheDocument();
  });
});

describe("Projector End class", () => {
  // The bar's End class (the one that opens the confirm), not the confirm's own.
  const endClass = () =>
    within(screen.getByTestId("projector-controls"))
      .getAllByRole("button", { name: "End class" })
      .find((b) => b.hasAttribute("aria-expanded"))!;
  const dialog = () => screen.queryByRole("dialog", { name: "End class?" });
  const open = () => {
    show({ initialSlide: 3 });
    fireEvent.click(endClass());
  };

  it("opens the confirm right on the projector, with Keep going focused, and goes nowhere", () => {
    open();
    expect(dialog()).toBeInTheDocument();
    expect(dialog()).toHaveTextContent("The code stops working and students land on My spots.");
    expect(endClass()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Keep going" })).toHaveFocus();
    // Same words as the button: End class, not End lecture. Keep going is a white button.
    expect(within(dialog()!).getByRole("button", { name: "End class" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep going" }).className).toContain("bg-surface");
    expect(screen.getByRole("button", { name: "Keep going" }).className).not.toContain("underline");
    expect(screen.queryByText(/lecture/i)).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("Keep going closes it, ends nothing and hands focus back to End class", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Keep going" }));
    expect(dialog()).not.toBeInTheDocument();
    expect(endClass()).toHaveFocus();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("Esc closes it (closing a dialog) and hands focus back to End class", () => {
    open();
    press("Escape");
    expect(dialog()).not.toBeInTheDocument();
    expect(endClass()).toHaveFocus();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a press outside closes it", () => {
    open();
    fireEvent.pointerDown(screen.getByRole("img"));
    expect(dialog()).not.toBeInTheDocument();
  });

  it("a slide key closes it (Keep going) and moves the slide, so a teacher with only a clicker is never stuck", async () => {
    open();
    press("ArrowRight");
    expect(dialog()).not.toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ current_slide: 4 });
    await waitFor(() => expect(shownSlide()).toBe("https://signed/4.webp"));
  });

  it("Space and Page Up from Keep going (where focus starts) close it and move the slide too", async () => {
    open();
    const keep = screen.getByRole("button", { name: "Keep going" });
    expect(fireEvent.keyDown(keep, { key: " " })).toBe(false);
    expect(dialog()).not.toBeInTheDocument();
    await waitFor(() => expect(shownSlide()).toBe("https://signed/4.webp"));
    fireEvent.click(endClass());
    fireEvent.keyDown(screen.getByRole("button", { name: "Keep going" }), { key: "PageUp" });
    expect(dialog()).not.toBeInTheDocument();
    expect(update).toHaveBeenLastCalledWith({ current_slide: 3 });
  });

  it("Space on its own End class (reached with Tab) is left to the button, not taken as a slide key", () => {
    open();
    const confirmEnd = within(dialog()!).getByRole("button", { name: "End class" });
    confirmEnd.focus();
    expect(fireEvent.keyDown(confirmEnd, { key: " " })).toBe(true);
    expect(dialog()).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("slide keys wait while it is ending", async () => {
    rpc.mockImplementationOnce(() => new Promise(() => {}));
    open();
    fireEvent.click(within(dialog()!).getByRole("button", { name: "End class" }));
    press("ArrowRight");
    expect(update).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
  });

  it("after Keep going, Space on the refocused End class moves the slide and does not press it again", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Keep going" }));
    expect(endClass()).toHaveFocus();
    // Prevented, and the button loses focus, so no browser can press it on the keyup either.
    expect(fireEvent.keyDown(endClass(), { key: " " })).toBe(false);
    expect(endClass()).not.toHaveFocus();
    fireEvent.keyUp(document.body, { key: " " });
    expect(dialog()).not.toBeInTheDocument();
    expect(endClass()).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(shownSlide()).toBe("https://signed/4.webp"));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("closes (Keep going) when the page leaves fullscreen, since the browser took the Esc", () => {
    open();
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => null });
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(dialog()).not.toBeInTheDocument();
    expect(endClass()).toHaveFocus();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stays open when the page enters fullscreen", () => {
    open();
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => document.documentElement });
    try {
      act(() => {
        document.dispatchEvent(new Event("fullscreenchange"));
      });
      expect(dialog()).toBeInTheDocument();
    } finally {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => null });
    }
  });

  it("End class in it ends the lecture and shows the ended state with the way back to the course", async () => {
    open();
    fireEvent.click(within(dialog()!).getByRole("button", { name: "End class" }));
    expect(await screen.findByText("This class has ended.")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("end_lecture", { p_lecture_id: LECTURE });
    expect(screen.getByRole("link", { name: "Back to the course" })).toHaveAttribute("href", "/teach/c/c1");
    expect(screen.queryByText("482916")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    press("ArrowRight");
    expect(update).not.toHaveBeenCalled();
  });

  it("says so when the end fails, closes the confirm and keeps the slide", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "nope" } });
    open();
    fireEvent.click(within(dialog()!).getByRole("button", { name: "End class" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not end the class.");
    expect(dialog()).not.toBeInTheDocument();
    expect(endClass()).toHaveFocus();
    expect(shownSlide()).toBe("https://signed/3.webp");
  });

  it("sits in the z-20 bar with no animated ancestor, so nothing covers it (see f27789f)", () => {
    open();
    const box = dialog()!;
    expect(box.className).toContain("z-30");
    let el = box.parentElement;
    let corner: HTMLElement | null = null;
    while (el && el !== document.body) {
      expect(el.className).not.toMatch(/animate-/);
      if (el.className.includes("z-20")) corner ??= el;
      el = el.parentElement;
    }
    expect(corner).not.toBeNull();
    // The join card and its fading copy are z-10, under the corner box.
    expect(screen.getByRole("img").className).not.toMatch(/z-/);
  });
});

describe("Projector slide write that hangs", () => {
  const wait = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));

  it("gives up after 8 s: aborts the request, says so quietly and unlocks the keys, with one write at a time", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      abortSignal.mockImplementation((s: AbortSignal) => ((signal = s), filters));
      single.mockImplementation(() => new Promise(() => {}));
      show({ initialSlide: 3 });
      press("ArrowRight");
      press("ArrowRight"); // made during the hang: waits, no second write
      expect(update).toHaveBeenCalledTimes(1);
      await wait(7999);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(signal?.aborted).toBe(false);
      await wait(1);
      expect(signal?.aborted).toBe(true);
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't move to slide 4. Try again.");
      expect(shownSlide()).toBe("https://signed/3.webp");
      expect(update).toHaveBeenCalledTimes(1);
      // The keys work again, from the slide on screen.
      single.mockImplementation(async () => ({ data: { current_slide: 4 }, error: null }));
      press("ArrowRight");
      await wait(0);
      expect(update).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenLastCalledWith({ current_slide: 4 });
      expect(eq).toHaveBeenLastCalledWith("current_slide", 3);
      expect(shownSlide()).toBe("https://signed/4.webp");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      abortSignal.mockImplementation(() => filters);
    }
  });

  it("when the write that timed out landed after all, the next press shows where the lecture is instead of ending", async () => {
    vi.useFakeTimers();
    try {
      single.mockImplementationOnce(() => new Promise(() => {}));
      show({ initialSlide: 3 });
      press("ArrowRight");
      await wait(8000);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      // The database is on 4 now, so "from 3 to 4" moves no row; a read says where it is.
      single.mockImplementation(async () => ({ data: null, error: null }));
      read.mockImplementation(async () => ({ data: { current_slide: 4, status: "live" }, error: null }));
      press("ArrowRight");
      await wait(0);
      expect(readSelect).toHaveBeenCalledWith("current_slide, status");
      expect(shownSlide()).toBe("https://signed/4.webp");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText("This lecture has ended.")).not.toBeInTheDocument();
      expect(update).toHaveBeenCalledTimes(2);
      // And the next press goes on from there.
      single.mockImplementation(async () => ({ data: { current_slide: 5 }, error: null }));
      press("ArrowRight");
      await wait(0);
      expect(update).toHaveBeenLastCalledWith({ current_slide: 5 });
      expect(shownSlide()).toBe("https://signed/5.webp");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a read that hangs too gives up the same way", async () => {
    vi.useFakeTimers();
    try {
      single.mockImplementation(async () => ({ data: null, error: null }));
      read.mockImplementation(() => new Promise(() => {}));
      show({ initialSlide: 3 });
      press("ArrowRight");
      await wait(8000);
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't move to slide 4. Try again.");
      expect(screen.queryByText("This lecture has ended.")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Projector slide that has no image", () => {
  it("says which slide didn't load instead of an empty screen, and the keys still work", async () => {
    urlFor.mockImplementation((n: number) => (n === 4 ? undefined : `https://signed/${n}.webp`));
    single.mockImplementation(async () => ({ data: { current_slide: 0 }, error: null }));
    show({ initialSlide: 4 });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("Slide 4 didn't load.")).toHaveAttribute("role", "status");
    press("ArrowRight");
    await waitFor(() => expect(shownSlide()).toBe("https://signed/5.webp"));
    expect(screen.queryByText(/didn't load/)).not.toBeInTheDocument();
  });

  it("says nothing while the slide list is still loading", () => {
    urlFor.mockImplementation(() => undefined);
    imagesLoaded = false;
    show({ initialSlide: 4 });
    expect(screen.queryByText(/didn't load/)).not.toBeInTheDocument();
  });

  it("tries the image again when the teacher comes back to the slide (a one-off failure heals)", async () => {
    show({ initialSlide: 4 });
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText("Slide 4 didn't load.")).toHaveAttribute("role", "status");
    press("ArrowLeft");
    await waitFor(() => expect(shownSlide()).toBe("https://signed/3.webp"));
    press("ArrowRight");
    // Same signed url as before, mounted again.
    await waitFor(() => expect(shownSlide()).toBe("https://signed/4.webp"));
    expect(screen.queryByText(/didn't load/)).not.toBeInTheDocument();
  });

  it("says so when the image itself fails to load (a deleted file), and the next slide shows", async () => {
    show({ initialSlide: 4 });
    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("Slide 4 didn't load.")).toHaveAttribute("role", "status");
    press("ArrowLeft");
    await waitFor(() => expect(shownSlide()).toBe("https://signed/3.webp"));
  });
});

describe("Projector bar: who is here", () => {
  const count = () => screen.getByTestId("projector-count");

  it("shows N watching · M joined, so the teacher sees who left early (Marko did not read 'here')", () => {
    joined = 38;
    here = 31;
    show({ initialSlide: 2 });
    expect(count()).toHaveTextContent("31 watching, students with the lecture open right now · 38 joined");
    expect(count()).not.toHaveTextContent("here");
    const watching = screen.getByTestId("projector-watching");
    // Seen: "31 watching" (with the meaning on hover); heard: the meaning right after the number.
    const hidden = watching.querySelector(".sr-only")!;
    expect(hidden).toHaveTextContent(", students with the lecture open right now");
    expect(watching.textContent!.replace(hidden.textContent!, "")).toBe("31 watching");
    expect(watching).toHaveAttribute("title", "Students with the lecture open right now");
  });

  it("shows only joined until the here count is known (or while it is unknown)", () => {
    joined = 38;
    here = null;
    show({ initialSlide: 2 });
    expect(count()).toHaveTextContent("38 joined");
    expect(count()).not.toHaveTextContent("watching");
  });

  it("never says more are here than joined (one student with two tabs)", () => {
    joined = 3;
    here = 5;
    show({ initialSlide: 2 });
    expect(count()).toHaveTextContent(/^3 watching.* · 3 joined$/);
  });

  it("leaves the count to the big join card while it is up", () => {
    joined = 12;
    here = 9;
    show();
    expect(screen.queryByTestId("projector-count")).toBeNull();
    expect(screen.getByTestId("join-card")).toHaveTextContent("12 joined");
  });

  it("is small quiet text, not the old corner card", () => {
    joined = 4;
    show({ initialSlide: 2 });
    const bar = screen.getByTestId("projector-bar");
    expect(bar.className).toContain("type-small");
    expect(bar.className).toContain("text-secondary");
    expect(screen.queryByTestId("corner-card")).toBeNull();
  });
});

describe("Projector Show code", () => {
  const codeDialog = () => screen.queryByRole("dialog", { name: "Join code" });
  const showCode = () => screen.getByRole("button", { name: "Show code" });
  const openCode = () => {
    show({ initialSlide: 4 });
    fireEvent.click(showCode());
  };

  it("opens a dialog over the slide with the address and the code, big, and a Close button; the join card stays away", () => {
    openCode();
    const d = codeDialog()!;
    expect(d).toHaveAttribute("aria-modal", "true");
    // Named "Join code", described by the address and the code (review M8).
    expect(d).toHaveAccessibleDescription("backtrack-ebon-sigma.vercel.app 482916");
    expect(d).toHaveTextContent(/^backtrack-ebon-sigma\.vercel\.app482916/);
    expect(d).not.toHaveTextContent("Go to");
    expect(d).toHaveTextContent("482916");
    expect(within(d).getByRole("button", { name: "Close" })).toHaveFocus();
    expect(screen.queryByTestId("join-card")).toBeNull();
    // The slide stays where it was, under the dialog.
    expect(shownSlide()).toBe("https://signed/4.webp");
    expect(update).not.toHaveBeenCalled();
  });

  it("Close closes it and hands focus back to Show code", () => {
    openCode();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(codeDialog()).toBeNull();
    expect(showCode()).toHaveFocus();
  });

  it("closes with the open animation run backwards, then goes (Marko: no animation on close)", async () => {
    vi.useFakeTimers();
    try {
      openCode();
      const backdrop = screen.getByTestId("show-code-backdrop");
      expect(backdrop.className).toContain("animate-fade-in");
      expect(screen.getByTestId("show-code-card").className).toContain("animate-pop-in");
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      // No longer a dialog (hidden, inert, takes no clicks), but still drawn while it animates out.
      expect(codeDialog()).toBeNull();
      const closing = screen.getByTestId("show-code-backdrop");
      expect(closing).toHaveAttribute("data-closing");
      expect(closing).toHaveAttribute("aria-hidden", "true");
      expect(closing).toHaveAttribute("inert");
      expect(closing.className).toContain("pointer-events-none");
      expect(closing.className).toContain("[animation:fade-in_160ms_var(--ease-in-out)_reverse_both]");
      expect(screen.getByTestId("show-code-card").className).toContain("[animation:pop-in_160ms_var(--ease-in-out)_reverse_both]");
      // Slide keys work at once while it fades.
      press("ArrowRight");
      expect(update).toHaveBeenCalledWith({ current_slide: 5 });
      // Gone once the animation is over (animationend, or the fallback timer jsdom gets).
      await act(async () => vi.advanceTimersByTimeAsync(250));
      expect(screen.queryByTestId("show-code-backdrop")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the close has a fallback when no animation runs, and Show code during the close opens it again", async () => {
    vi.useFakeTimers();
    try {
      openCode();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      fireEvent.click(showCode());
      expect(codeDialog()).toBeInTheDocument();
      expect(screen.getByTestId("show-code-backdrop")).not.toHaveAttribute("data-closing");
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(screen.getByTestId("show-code-backdrop")).toHaveAttribute("data-closing");
      await act(async () => vi.advanceTimersByTimeAsync(250));
      expect(screen.queryByTestId("show-code-backdrop")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Esc closes it", () => {
    openCode();
    press("Escape");
    expect(codeDialog()).toBeNull();
    expect(showCode()).toHaveFocus();
  });

  it("a press outside it closes it; a press inside does not", () => {
    openCode();
    fireEvent.pointerDown(codeDialog()!);
    expect(codeDialog()).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByTestId("show-code-backdrop"));
    expect(codeDialog()).toBeNull();
  });

  it("a slide key puts it away without moving the slide; the next one moves", async () => {
    openCode();
    press("ArrowRight");
    expect(codeDialog()).toBeNull();
    expect(update).not.toHaveBeenCalled();
    press("ArrowRight");
    expect(update).toHaveBeenCalledWith({ current_slide: 5 });
    await waitFor(() => expect(shownSlide()).toBe("https://signed/5.webp"));
  });

  it("Tab stays on its Close button", () => {
    openCode();
    const close = screen.getByRole("button", { name: "Close" });
    fireEvent.keyDown(close, { key: "Tab" });
    expect(close).toHaveFocus();
  });

  it("closes when the page leaves fullscreen, since the browser took the Esc", () => {
    openCode();
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => null });
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(codeDialog()).toBeNull();
  });
});

describe("Projector reopened mid class", () => {
  it("says Continued on slide N for a few seconds when it opens past the first slide", async () => {
    vi.useFakeTimers();
    try {
      show({ initialSlide: 6 });
      expect(screen.queryByTestId("join-card")).toBeNull();
      expect(screen.getByTestId("continued")).toHaveTextContent("Continued on slide 6");
      expect(screen.getByTestId("continued").closest('[role="status"]')).not.toBeNull();
      await act(async () => vi.advanceTimersByTimeAsync(CONTINUED_MS));
      expect(screen.queryByTestId("continued")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the toast as soon as the slide moves", async () => {
    single.mockResolvedValue({ data: { current_slide: 7 }, error: null });
    show({ initialSlide: 6 });
    press("ArrowRight");
    await waitFor(() => expect(shownSlide()).toBe("https://signed/7.webp"));
    expect(screen.queryByTestId("continued")).toBeNull();
  });

  it("keeps the join card on the first open under a development double run (Strict Mode)", async () => {
    render(
      <StrictMode>
        <Projector lectureId={LECTURE} code="482916" siteAddress="backtrack.courses" initialSlide={1} slideCount={10} />
      </StrictMode>,
    );
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(screen.getByTestId("join-card")).toBeInTheDocument();
  });

  it("says nothing on the first open of a new lecture", () => {
    show();
    expect(screen.getByTestId("join-card")).toBeInTheDocument();
    expect(screen.queryByTestId("continued")).toBeNull();
  });

  // Next keeps a visited page alive but hidden (React Activity) and shows it again on Back or
  // Back to slides, with its old state. It must come back on the slide, never on the join card.
  it("comes back from a hidden page (Data and Back) on the slide it was on, not on the join card", async () => {
    vi.useFakeTimers();
    try {
      const props = { lectureId: LECTURE, code: "482916", siteAddress: "backtrack.courses", slideCount: 10, courseId: "c1" };
      const view = render(
        <Activity mode="visible">
          <Projector {...props} initialSlide={1} />
        </Activity>,
      );
      expect(screen.getByTestId("join-card")).toBeInTheDocument();
      // The teacher goes to Data with the join card still up.
      view.rerender(
        <Activity mode="hidden">
          <Projector {...props} initialSlide={1} />
        </Activity>,
      );
      await act(async () => vi.advanceTimersByTimeAsync(10));
      view.rerender(
        <Activity mode="visible">
          <Projector {...props} initialSlide={1} />
        </Activity>,
      );
      expect(screen.queryByTestId("join-card")).toBeNull();
      expect(screen.getByRole("img")).toHaveAttribute("src", "https://signed/1.webp");
      // Slide keys work again (the page's listeners came back with it).
      fireEvent.keyDown(window, { key: "ArrowRight" });
      expect(update).toHaveBeenCalledWith({ current_slide: 2 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("comes back from a hidden page past slide 1 with Continued on slide N, and its dialogs closed", async () => {
    vi.useFakeTimers();
    try {
      const props = { lectureId: LECTURE, code: "482916", siteAddress: "backtrack.courses", slideCount: 10, courseId: "c1" };
      const view = render(
        <Activity mode="visible">
          <Projector {...props} initialSlide={5} />
        </Activity>,
      );
      await act(async () => vi.advanceTimersByTimeAsync(CONTINUED_MS));
      expect(screen.queryByTestId("continued")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Show code" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      view.rerender(
        <Activity mode="hidden">
          <Projector {...props} initialSlide={5} />
        </Activity>,
      );
      await act(async () => vi.advanceTimersByTimeAsync(10));
      view.rerender(
        <Activity mode="visible">
          <Projector {...props} initialSlide={5} />
        </Activity>,
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByTestId("continued")).toHaveTextContent("Continued on slide 5");
    } finally {
      vi.useRealTimers();
    }
  });
});
