import { describe, it, expect, vi } from "vitest";
import { Activity, StrictMode } from "react";
import { render, act } from "@testing-library/react";
import { useShownAgain } from "./useShownAgain";

function Probe({ onShownAgain }: { onShownAgain: () => void }) {
  useShownAgain(onShownAgain);
  return null;
}

const tick = () => act(async () => new Promise((r) => setTimeout(r, 5)));

describe("useShownAgain", () => {
  it("does nothing on the first mount, also under a development double run", async () => {
    const cb = vi.fn();
    render(
      <StrictMode>
        <Probe onShownAgain={cb} />
      </StrictMode>,
    );
    await tick();
    expect(cb).not.toHaveBeenCalled();
  });

  it("runs each time a kept-alive (hidden) page is shown again", async () => {
    const cb = vi.fn();
    const at = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <Probe onShownAgain={cb} />
      </Activity>
    );
    const view = render(at("visible"));
    view.rerender(at("hidden"));
    await tick();
    expect(cb).not.toHaveBeenCalled();
    view.rerender(at("visible"));
    expect(cb).toHaveBeenCalledTimes(1);
    view.rerender(at("hidden"));
    await tick();
    view.rerender(at("visible"));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("calls the newest callback", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(
      <Activity mode="visible">
        <Probe onShownAgain={first} />
      </Activity>,
    );
    view.rerender(
      <Activity mode="hidden">
        <Probe onShownAgain={second} />
      </Activity>,
    );
    await tick();
    view.rerender(
      <Activity mode="visible">
        <Probe onShownAgain={second} />
      </Activity>,
    );
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
