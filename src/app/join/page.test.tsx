import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const getSession = vi.fn();
const signInAnonymously = vi.fn();
const rpc = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({ auth: { getSession, signInAnonymously }, rpc }),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import JoinPage from "./page";

const LECTURE = "11111111-1111-1111-1111-111111111111";
const input = () => screen.getByLabelText("Enter the code on the screen") as HTMLInputElement;
const joinButton = () => screen.getByRole("button", { name: /^Join/ });
const type = (value: string) => fireEvent.change(input(), { target: { value } });

beforeEach(() => {
  [getSession, signInAnonymously, rpc, push].forEach((m) => m.mockReset());
  getSession.mockResolvedValue({ data: { session: null }, error: null });
  signInAnonymously.mockResolvedValue({ data: { session: {} }, error: null });
  rpc.mockResolvedValue({ data: LECTURE, error: null });
});

describe("Join page", () => {
  it("is a numeric box for 6 digits", () => {
    render(<JoinPage />);
    expect(input()).toHaveAttribute("inputmode", "numeric");
    // 6 digits plus the space shown after the third one.
    expect(input()).toHaveAttribute("maxlength", "7");
    expect(input()).toHaveAttribute("placeholder", "6 digits");
  });

  it("shows a space after 3 digits, for reading only", async () => {
    render(<JoinPage />);
    type("482");
    expect(input().value).toBe("482");
    type("4829");
    expect(input().value).toBe("482 9");
    type("482 913");
    expect(input().value).toBe("482 913");
    fireEvent.click(joinButton());
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("join_lecture", { p_code: "482913" }));
  });

  it("lets no letters or symbols be typed", () => {
    render(<JoinPage />);
    type("12ab-3 4");
    expect(input().value).toBe("123 4");
    type("abc");
    expect(input().value).toBe("");
  });

  it("cuts a pasted code to 6 digits", () => {
    render(<JoinPage />);
    type("482 916 77");
    expect(input().value).toBe("482 916");
  });

  it("keeps Join disabled under 6 digits", () => {
    render(<JoinPage />);
    expect(joinButton()).toBeDisabled();
    type("48291");
    expect(joinButton()).toBeDisabled();
    type("482916");
    expect(joinButton()).toBeEnabled();
    type("48291a");
    expect(joinButton()).toBeDisabled();
  });

  it("has no explanation line under the input", () => {
    const { container } = render(<JoinPage />);
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("signs in anonymously when there is no session, joins, then goes to the lecture", async () => {
    render(<JoinPage />);
    type("482916");
    fireEvent.click(joinButton());
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/l/${LECTURE}`));
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("join_lecture", { p_code: "482916" });
    expect(signInAnonymously.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]);
  });

  it("does not sign in again when there is already a session", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    render(<JoinPage />);
    type("482916");
    fireEvent.click(joinButton());
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it("says Joining… while it works and cannot be pressed twice", async () => {
    let finish!: (v: unknown) => void;
    rpc.mockImplementation(() => new Promise((r) => (finish = r)));
    render(<JoinPage />);
    type("482916");
    fireEvent.click(joinButton());
    expect(await screen.findByRole("button", { name: "Joining…" })).toBeDisabled();
    fireEvent.submit(input().closest("form")!);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    finish({ data: LECTURE, error: null });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  });

  it("explains a code that is not live and lets the student try again", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not_found" } });
    render(<JoinPage />);
    type("999999");
    fireEvent.click(joinButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("No live lecture has that code.");
    expect(push).not.toHaveBeenCalled();
    expect(joinButton()).toBeEnabled();
    expect(input().value).toBe("999 999");
  });

  it("shows the message with an alert icon and puts the cursor back in the field", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    render(<JoinPage />);
    type("999999");
    fireEvent.click(joinButton());
    const alert = await screen.findByRole("alert");
    expect(alert.querySelector('[data-icon="alert"]')).not.toBeNull();
    await waitFor(() => expect(input()).toHaveFocus());
  });

  it("shakes the field on each wrong code, but not for other errors", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { container } = render(<JoinPage />);
    const field = () => container.querySelector("[data-shake]");
    type("999999");
    fireEvent.click(joinButton());
    await screen.findByRole("alert");
    expect(field()).toHaveAttribute("data-shake", "animate-shake");
    await waitFor(() => expect(joinButton()).toBeEnabled());
    fireEvent.click(joinButton());
    await waitFor(() => expect(field()).toHaveAttribute("data-shake", "animate-shake-again"));
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    fireEvent.click(joinButton());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not join. Try again."));
    expect(field()).toBeNull();
  });

  /** Puts a value in the field as the browser would after an edit, with the caret at `caret`, and fires input. */
  function edit(value: string, caret: number, inputType = "insertText") {
    const el = input();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.setSelectionRange(caret, caret);
    fireEvent.input(el, { inputType });
  }

  it("keeps the code and the caret right when a digit in the middle is fixed", async () => {
    render(<JoinPage />);
    input().focus();
    type("482913");
    // Caret after the first digit, Backspace: the browser leaves "82 913" with the caret at 0.
    edit("82 913", 0, "deleteContentBackward");
    expect(input().value).toBe("829 13");
    expect(input().selectionStart).toBe(0);
    // Type 7 there: "7829 13", caret 1.
    edit("7829 13", 1);
    expect(input().value).toBe("782 913");
    expect(input().selectionStart).toBe(1);
    // Fix the 5th digit: caret after "782 9", Backspace, then 4.
    edit("782 13", 4, "deleteContentBackward");
    expect(input().value).toBe("782 13");
    expect(input().selectionStart).toBe(4);
    edit("782 413", 5);
    expect(input().value).toBe("782 413");
    expect(input().selectionStart).toBe(5);
    fireEvent.click(joinButton());
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("join_lecture", { p_code: "782413" }));
  });

  it("Backspace right after the reading space deletes the 3rd digit, Delete right before it the 4th", () => {
    render(<JoinPage />);
    input().focus();
    type("482913");
    // Caret after the space; Backspace removes only the space in the browser.
    edit("482913", 3, "deleteContentBackward");
    expect(input().value).toBe("489 13");
    expect(input().selectionStart).toBe(2);
    type("482913");
    // Caret before the space; Delete removes only the space.
    edit("482913", 3, "deleteContentForward");
    expect(input().value).toBe("482 13");
    expect(input().selectionStart).toBe(3);
  });

  it("draws each typed digit in its own span so it can pop in", () => {
    const { container } = render(<JoinPage />);
    type("4829");
    const display = container.querySelector("[data-code-display]")!;
    expect(display).toHaveAttribute("aria-hidden", "true");
    expect(Array.from(display.querySelectorAll("span"), (s) => s.textContent)).toEqual(["4", "8", "2", " ", "9"]);
  });

  it("explains a code that is not live when the database returns null with no error", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    render(<JoinPage />);
    type("999999");
    fireEvent.click(joinButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("No live lecture has that code.");
    expect(push).not.toHaveBeenCalled();
    expect(joinButton()).toBeEnabled();
  });

  it("tells the student to wait when there have been too many tries", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "too_many_attempts" } });
    render(<JoinPage />);
    type("482916");
    fireEvent.click(joinButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many tries. Wait a few minutes and try again.");
    expect(push).not.toHaveBeenCalled();
    expect(joinButton()).toBeEnabled();
  });

  it("clears the message when the code is edited", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not_found" } });
    render(<JoinPage />);
    type("999999");
    fireEvent.click(joinButton());
    await screen.findByRole("alert");
    type("99999");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a try again line when sign in fails", async () => {
    signInAnonymously.mockResolvedValue({ data: { session: null }, error: { message: "rate limit" } });
    render(<JoinPage />);
    type("482916");
    fireEvent.click(joinButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not join. Try again.");
    expect(rpc).not.toHaveBeenCalled();
    expect(joinButton()).toBeEnabled();
  });

  it("shows a try again line when joining fails for any other reason", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    render(<JoinPage />);
    type("482916");
    fireEvent.click(joinButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not join. Try again.");
    expect(push).not.toHaveBeenCalled();
  });

  it("shows a try again line when the session cannot be read", async () => {
    getSession.mockRejectedValue(new Error("storage"));
    render(<JoinPage />);
    type("482916");
    fireEvent.click(joinButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not join. Try again.");
  });
});
