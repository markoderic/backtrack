import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";

const single = vi.fn();
const select = vi.fn(() => ({ single }));
const eq = vi.fn(() => ({ select }));
const update = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ update }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => ({ from }) }));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const urlFor = vi.fn((n: number) => `https://signed/${n}.webp`);
const useSlideImages = vi.fn((...args: [string, number?]) => ({ urlFor, args }));
vi.mock("@/lib/useSlideImages", () => ({
  useSlideImages: (id: string, current?: number) => useSlideImages(id, current),
}));

let joined: number | null = 0;
const useJoinedCount = vi.fn<(id: string) => number | null>(() => joined);
vi.mock("@/lib/useJoinedCount", () => ({ useJoinedCount: (id: string) => useJoinedCount(id) }));

import { Projector } from "./Projector";

const LECTURE = "11111111-1111-1111-1111-111111111111";

function show(props: Partial<{ initialSlide: number; slideCount: number }> = {}) {
  return render(
    <Projector
      lectureId={LECTURE}
      code="482916"
      siteAddress="backtrack-ebon-sigma.vercel.app"
      initialSlide={props.initialSlide ?? 1}
      slideCount={props.slideCount ?? 10}
    />,
  );
}

const press = (key: string) => fireEvent.keyDown(window, { key });
const shownSlide = () => screen.getByRole("img").getAttribute("src");

beforeEach(() => {
  [single, select, eq, update, from, push, urlFor, useSlideImages, useJoinedCount].forEach((m) => m.mockClear());
  joined = 0;
  single.mockImplementation(async () => ({ data: { current_slide: 0 }, error: null }));
});

describe("Projector", () => {
  it("opens on the join card with the address and the code", () => {
    show();
    const card = screen.getByTestId("join-card");
    expect(card).toHaveTextContent("backtrack-ebon-sigma.vercel.app");
    expect(card).toHaveTextContent("482916");
    expect(screen.queryByTestId("corner-card")).not.toBeInTheDocument();
    expect(screen.getByText("backtrack-ebon-sigma.vercel.app")).toBeInTheDocument();
    expect(screen.getByText("482916")).toBeInTheDocument();
  });

  it("shows how many students have joined on the join card and in the corner card", () => {
    joined = 12;
    show();
    expect(useJoinedCount).toHaveBeenCalledWith(LECTURE);
    expect(screen.getByTestId("join-card")).toHaveTextContent("12 joined");
    press("ArrowRight");
    expect(screen.getByTestId("corner-card")).toHaveTextContent("482916");
    expect(screen.getByTestId("corner-card")).toHaveTextContent("12 joined");
  });

  it("shows no count until the first count has arrived", () => {
    joined = null;
    show();
    press("ArrowRight");
    expect(screen.getByTestId("corner-card")).not.toHaveTextContent(/joined/);
  });

  it("shows the lecture's current slide full viewport and letterboxed, not stretched", () => {
    show({ initialSlide: 4 });
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://signed/4.webp");
    expect(img.className).toContain("object-contain");
    expect(useSlideImages).toHaveBeenLastCalledWith(LECTURE, 4);
  });

  it("the join card says where to go, the code and how to start", () => {
    show();
    const card = screen.getByTestId("join-card");
    expect(card).toHaveTextContent("Go to");
    expect(card).toHaveTextContent("Enter");
    expect(card).toHaveTextContent("Press → to start");
    expect(card).toHaveTextContent("backtrack");
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
      expect(screen.getByTestId("corner-card")).toBeInTheDocument();
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

  it("keeps the address and code in a small corner card once the join card is gone", () => {
    show();
    press("ArrowRight");
    const corner = screen.getByTestId("corner-card");
    expect(corner).toHaveTextContent("backtrack-ebon-sigma.vercel.app");
    expect(corner).toHaveTextContent("482916");
  });

  it("ignores ArrowRight with Cmd held: no update and the join card stays", () => {
    show();
    fireEvent.keyDown(window, { key: "ArrowRight", metaKey: true });
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

  it("ignores keys while an update is in flight", async () => {
    let finish!: (v: unknown) => void;
    single.mockImplementation(() => new Promise((r) => (finish = r)));
    show();
    press("ArrowRight");
    press("ArrowRight");
    press("ArrowRight");
    press("n");
    expect(update).toHaveBeenCalledTimes(1);
    await act(async () => finish({ data: { current_slide: 2 }, error: null }));
    press("ArrowRight");
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith({ current_slide: 3 });
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
    press("ArrowRight");
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
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not change the slide.");
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

  it("d goes to the live data page", () => {
    show();
    press("d");
    expect(push).toHaveBeenCalledWith(`/teach/l/${LECTURE}/live`);
    expect(update).not.toHaveBeenCalled();
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

  it("the Fullscreen button asks the browser for fullscreen", () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const { container } = show();
    (container.firstElementChild as HTMLElement).requestFullscreen = requestFullscreen;
    fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
    expect(requestFullscreen).toHaveBeenCalled();
  });

  it("has a Data link and an End lecture link next to Fullscreen", () => {
    show();
    expect(screen.getByRole("link", { name: "Data" })).toHaveAttribute("href", `/teach/l/${LECTURE}/live`);
    expect(screen.getByRole("link", { name: "End lecture" })).toHaveAttribute("href", `/teach/l/${LECTURE}/live?end=1`);
    expect(screen.getByRole("button", { name: "Fullscreen" })).toBeInTheDocument();
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

  it("clicking a link changes no slide", () => {
    show();
    press("ArrowRight"); // hides the join card
    const end = screen.getByRole("link", { name: "End lecture" });
    end.addEventListener("click", (e) => e.preventDefault()); // jsdom cannot navigate
    fireEvent.click(end);
    expect(update).not.toHaveBeenCalled();
    expect(shownSlide()).toBe("https://signed/1.webp");
  });
});

describe("Projector controls row", () => {
  const row = () => screen.getByTestId("projector-controls");
  const awake = () => row().getAttribute("data-awake");
  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  function withTimers(run: () => void | Promise<void>) {
    return async () => {
      vi.useFakeTimers();
      try {
        await run();
      } finally {
        vi.useRealTimers();
      }
    };
  }

  it("keeps the corner card to the address, code and joined, with the controls in their own row", () => {
    joined = 38;
    show();
    press("ArrowRight");
    const corner = screen.getByTestId("corner-card");
    expect(corner).toHaveTextContent("backtrack-ebon-sigma.vercel.app");
    expect(corner).toHaveTextContent("482916");
    expect(corner).toHaveTextContent("38 joined");
    expect(within(corner).queryByRole("link", { name: "Data" })).toBeNull();
    expect(within(corner).queryByRole("link", { name: "End lecture" })).toBeNull();
    expect(within(corner).queryByRole("button", { name: "Fullscreen" })).toBeNull();
    expect(within(row()).getByRole("link", { name: "Data" })).toHaveAttribute("href", `/teach/l/${LECTURE}/live`);
    expect(within(row()).getByRole("link", { name: "End lecture" })).toHaveAttribute(
      "href",
      `/teach/l/${LECTURE}/live?end=1`,
    );
    expect(within(row()).getByRole("button", { name: "Fullscreen" })).toBeInTheDocument();
  });

  it("is the same single row on the join card", () => {
    show();
    expect(screen.getByTestId("join-card")).toBeInTheDocument();
    expect(screen.getAllByTestId("projector-controls")).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "Data" })).toHaveLength(1);
  });

  it(
    "shows on load and fades after 3 seconds without the mouse moving",
    withTimers(() => {
      show();
      expect(awake()).toBe("true");
      advance(2999);
      expect(awake()).toBe("true");
      advance(1);
      expect(awake()).toBe("false");
    }),
  );

  it(
    "wakes on a pointer move or press, and each move restarts the 3 seconds",
    withTimers(() => {
      show();
      advance(3000);
      fireEvent.pointerMove(window);
      expect(awake()).toBe("true");
      advance(2000);
      fireEvent.pointerMove(window);
      advance(2999);
      expect(awake()).toBe("true");
      advance(1);
      expect(awake()).toBe("false");
      fireEvent.pointerDown(window);
      expect(awake()).toBe("true");
    }),
  );

  it(
    "stays shown while a control has focus, and counts down again after focus leaves",
    withTimers(() => {
      show();
      advance(3000);
      expect(awake()).toBe("false");
      act(() => screen.getByRole("link", { name: "Data" }).focus());
      expect(awake()).toBe("true");
      advance(10000);
      expect(awake()).toBe("true");
      // Moving between controls keeps it shown.
      act(() => screen.getByRole("link", { name: "End lecture" }).focus());
      advance(10000);
      expect(awake()).toBe("true");
      act(() => screen.getByRole("link", { name: "End lecture" }).blur());
      expect(awake()).toBe("true");
      advance(3000);
      expect(awake()).toBe("false");
    }),
  );

  it(
    "while faded the controls are still reachable: in the accessibility tree, focusable, not hidden",
    withTimers(() => {
      show();
      advance(3000);
      expect(awake()).toBe("false");
      expect(row().closest("[aria-hidden]")).toBeNull();
      expect(row().closest("[inert]")).toBeNull();
      const data = screen.getByRole("link", { name: "Data" });
      act(() => data.focus());
      expect(data).toHaveFocus();
    }),
  );

  it(
    "keys never wake it, and d and Escape work the same while it is faded",
    withTimers(async () => {
      show();
      advance(3000);
      press("ArrowRight"); // hides the join card
      expect(awake()).toBe("false");
      const updates = update.mock.calls.length;
      press("Escape");
      expect(push).not.toHaveBeenCalled();
      expect(update.mock.calls.length).toBe(updates);
      expect(awake()).toBe("false");
      press("d");
      expect(push).toHaveBeenCalledWith(`/teach/l/${LECTURE}/live`);
      expect(awake()).toBe("false");
      // A slide change by key does not wake it either.
      press(" ");
      await act(async () => {});
      expect(update).toHaveBeenCalledWith({ current_slide: 2 });
      expect(awake()).toBe("false");
    }),
  );

  it(
    "the Fullscreen button works while the row is faded",
    withTimers(() => {
      const requestFullscreen = vi.fn().mockResolvedValue(undefined);
      const { container } = show();
      (container.firstElementChild as HTMLElement).requestFullscreen = requestFullscreen;
      advance(3000);
      fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
      expect(requestFullscreen).toHaveBeenCalled();
    }),
  );

  it(
    "stops listening and clears its timer when it unmounts",
    withTimers(() => {
      const removed = vi.spyOn(window, "removeEventListener");
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const { unmount } = show();
        unmount();
        const types = removed.mock.calls.map((c) => c[0]);
        expect(types).toContain("pointermove");
        expect(types).toContain("pointerdown");
        expect(vi.getTimerCount()).toBe(0);
        advance(10000);
        fireEvent.pointerMove(window);
        expect(errors).not.toHaveBeenCalled();
      } finally {
        removed.mockRestore();
        errors.mockRestore();
      }
    }),
  );
});
