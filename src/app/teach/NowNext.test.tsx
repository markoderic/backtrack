import { describe, it, expect, vi, afterEach } from "vitest";
import { Activity } from "react";
import { act, render, screen } from "@testing-library/react";
import { NowNext, TICK_MS, type ScheduledCourse } from "./NowNext";

const ims: ScheduledCourse = {
  id: "c1",
  name: "IMS 452",
  details: { color: "blue", section: "001", meetDays: [3], startMinute: 605, endMinute: 660 },
};
const wed = (hhmm: string) => new Date(`2026-10-21T${hhmm}:00-04:00`).getTime();

afterEach(() => {
  vi.useRealTimers();
});

describe("NowNext", () => {
  it("first shows what the server's clock says, then moves on with the browser's clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(wed("09:49"));
    render(<NowNext courses={[ims]} liveCourseIds={[]} initialNow={wed("09:49")} />);
    expect(screen.getByTestId("now-next")).toHaveAttribute("data-state", "next");
    expect(screen.getByTestId("now-next")).toHaveTextContent("NextIMS 452, 001Today 10:05 AM");

    act(() => {
      vi.setSystemTime(wed("09:50"));
      vi.advanceTimersByTime(TICK_MS);
    });
    expect(screen.getByTestId("now-next")).toHaveAttribute("data-state", "now");
    expect(screen.getByRole("link", { name: "Start lecture in IMS 452" })).toHaveAttribute("href", "/teach/c/c1/start");
    expect(screen.getByRole("region", { name: "Now" })).toHaveTextContent("Wed · 10:05–11:00 AM");
  });

  it("looks at the clock again when the tab comes back", () => {
    vi.useFakeTimers();
    vi.setSystemTime(wed("11:20"));
    render(<NowNext courses={[ims]} liveCourseIds={[]} initialNow={wed("10:30")} />);
    expect(screen.getByTestId("now-next")).toHaveAttribute("data-state", "now");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByTestId("now-next")).toHaveAttribute("data-state", "next");
    expect(screen.getByTestId("now-next")).toHaveTextContent("Next Wed, Oct 28 10:05 AM");
  });

  it("a course that is live is never Now; its next meeting shows as Next", () => {
    vi.useFakeTimers();
    vi.setSystemTime(wed("10:10"));
    const { container } = render(
      <NowNext
        courses={[{ ...ims, details: { ...ims.details, meetDays: [3] } }]}
        liveCourseIds={["c1"]}
        initialNow={wed("10:10")}
      />,
    );
    // Live now: not Now; its next meeting is next Wednesday, so Next shows that.
    expect(container.querySelector('[data-state="next"]')).toHaveTextContent("Next Wed, Oct 28 10:05 AM");
  });

  it("takes a newer server time at once when the page is refreshed (no 30 s wait)", () => {
    vi.useFakeTimers();
    // The browser clock is still where the page was left; only the new server render knows better.
    vi.setSystemTime(wed("08:00"));
    const view = render(<NowNext courses={[ims]} liveCourseIds={[]} initialNow={wed("08:00")} />);
    expect(screen.getByTestId("now-next")).toHaveAttribute("data-state", "next");
    view.rerender(<NowNext courses={[ims]} liveCourseIds={[]} initialNow={wed("09:55")} />);
    expect(screen.getByTestId("now-next")).toHaveAttribute("data-state", "now");
  });

  it("looks at the clock right after mount", () => {
    vi.useFakeTimers();
    vi.setSystemTime(wed("09:55"));
    // A server render from 8:00 handed over late (a cached page): the browser's clock wins at once.
    render(<NowNext courses={[ims]} liveCourseIds={[]} initialNow={wed("08:00")} />);
    expect(screen.getByTestId("now-next")).toHaveAttribute("data-state", "next");
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByTestId("now-next")).toHaveAttribute("data-state", "now");
  });

  it("looks at the clock again when Next shows the kept-alive dashboard again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(wed("08:00"));
    const at = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <NowNext courses={[ims]} liveCourseIds={[]} initialNow={wed("08:00")} />
      </Activity>
    );
    const view = render(at("visible"));
    act(() => {
      vi.advanceTimersByTime(0);
    });
    view.rerender(at("hidden"));
    act(() => {
      vi.advanceTimersByTime(5);
    });
    // The teacher comes back at 9:55, well inside one 30 s tick.
    vi.setSystemTime(wed("09:55"));
    view.rerender(at("visible"));
    expect(screen.getByTestId("now-next")).toHaveAttribute("data-state", "now");
  });
});
