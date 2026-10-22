import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

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
  [single, select, eq, update, from, push, urlFor, useSlideImages].forEach((m) => m.mockClear());
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

  it("shows the lecture's current slide full viewport and letterboxed, not stretched", () => {
    show({ initialSlide: 4 });
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://signed/4.webp");
    expect(img.className).toContain("object-contain");
    expect(useSlideImages).toHaveBeenLastCalledWith(LECTURE, 4);
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
    expect(screen.getByText("482916")).toBeInTheDocument();
  });

  it("ignores a held key", () => {
    show();
    fireEvent.keyDown(window, { key: "ArrowRight", repeat: true });
    expect(screen.getByText("482916")).toBeInTheDocument();
  });

  it("the Fullscreen button asks the browser for fullscreen", () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const { container } = show();
    (container.firstElementChild as HTMLElement).requestFullscreen = requestFullscreen;
    fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
    expect(requestFullscreen).toHaveBeenCalled();
  });
});
