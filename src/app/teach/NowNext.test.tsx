import { describe, it, expect, vi, afterEach } from "vitest";
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
    expect(screen.getByTestId("now-next")).toHaveTextContent("Wed 10:05 AM");
  });

  it("a course that is live is never Now; its next meeting shows as Next", () => {
    const { container } = render(
      <NowNext
        courses={[{ ...ims, details: { ...ims.details, meetDays: [3] } }]}
        liveCourseIds={["c1"]}
        initialNow={wed("10:10")}
      />,
    );
    // Live now: not Now; its next meeting is next Wednesday, so Next shows that.
    expect(container.querySelector('[data-state="next"]')).toHaveTextContent("Wed 10:05 AM");
  });
});
