import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const h = vi.hoisted(() => ({ saveName: vi.fn(), refresh: vi.fn() }));

vi.mock("./actions", () => ({ saveName: h.saveName }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));

import { NameForm, STATUS_MS, saveButtonClass } from "./NameForm";

const field = () => screen.getByLabelText("Your name, as students see it") as HTMLInputElement;
const save = () => screen.getByRole("button", { name: "Save" });
const type = (v: string) => fireEvent.change(field(), { target: { value: v } });
const status = () => screen.getByRole("status");

beforeEach(() => {
  h.refresh.mockReset();
  h.saveName.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("NameForm", () => {
  it("shows the saved name in a 480 wide field, with nothing to save", () => {
    render(<NameForm initialName="Linda Carter" />);
    expect(field().value).toBe("Linda Carter");
    expect(field().className).toContain("w-120");
    expect(field().className.split(" ")).not.toContain("w-full");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("keeps an empty status line in the page so the save is announced", () => {
    render(<NameForm initialName="Linda Carter" />);
    expect(status()).toHaveTextContent("");
    // Empty it is visually hidden but still in the accessibility tree (display:none would drop it).
    expect(status().className).toContain("empty:sr-only");
    expect(status().className).not.toContain("empty:hidden");
  });

  it("gives Save a 44 px target", () => {
    expect(saveButtonClass).toContain("h-10");
    expect(saveButtonClass).toContain("after:-inset-y-0.5");
  });

  it("saves the trimmed name through the server action, refreshes, and puts focus back on the field", async () => {
    render(<NameForm initialName="Linda Carter" />);
    const statusBefore = status();
    type("  Dr. Linda Carter  ");
    save().focus();
    fireEvent.click(save());
    await waitFor(() => expect(status()).toHaveTextContent("Saved."));
    expect(status()).toBe(statusBefore);
    expect(h.saveName).toHaveBeenCalledWith("Dr. Linda Carter");
    expect(h.refresh).toHaveBeenCalled();
    expect(field().value).toBe("Dr. Linda Carter");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(document.activeElement).toBe(field());
  });

  it("clears Saved. after a few seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<NameForm initialName="Linda Carter" />);
    type("Linda C.");
    fireEvent.click(save());
    await waitFor(() => expect(status()).toHaveTextContent("Saved."));
    act(() => {
      vi.advanceTimersByTime(STATUS_MS);
    });
    expect(status()).toHaveTextContent("");
  });

  it("saves on Enter", async () => {
    render(<NameForm initialName="Linda Carter" />);
    type("Linda C.");
    fireEvent.submit(field().closest("form")!);
    await waitFor(() => expect(h.saveName).toHaveBeenCalledWith("Linda C."));
  });

  it("shows the action's error, ties it to the field, and keeps what was typed", async () => {
    h.saveName.mockResolvedValue({ error: "Could not save your name." });
    render(<NameForm initialName="Linda Carter" />);
    type("Linda C.");
    fireEvent.click(save());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not save your name.");
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAttribute("aria-describedby", alert.id);
    expect(field().value).toBe("Linda C.");
    expect(h.refresh).not.toHaveBeenCalled();
    expect(status()).toHaveTextContent("");
  });

  it("says so when the action itself fails (network)", async () => {
    h.saveName.mockRejectedValue(new Error("offline"));
    render(<NameForm initialName="Linda Carter" />);
    type("Linda C.");
    fireEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save your name.");
  });

  it("never sends a blank name", () => {
    render(<NameForm initialName="Linda Carter" />);
    type("   ");
    expect(save()).toBeDisabled();
    fireEvent.submit(field().closest("form")!);
    expect(h.saveName).not.toHaveBeenCalled();
  });

  it("Esc and Cancel put the saved name back without saving; Cancel puts focus back on the field", () => {
    render(<NameForm initialName="Linda Carter" />);
    type("Someone else");
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(field().value).toBe("Linda Carter");
    type("Someone else");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    cancel.focus();
    fireEvent.click(cancel);
    expect(field().value).toBe("Linda Carter");
    expect(document.activeElement).toBe(field());
    expect(h.saveName).not.toHaveBeenCalled();
  });
});
