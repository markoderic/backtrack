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
const box = (n: number) => screen.getByLabelText(`Digit ${n} of 6`) as HTMLInputElement;
const values = () => [1, 2, 3, 4, 5, 6].map((n) => box(n).value);
const joinButton = () => screen.getByRole("button", { name: /^Join/ });
/** Types into whichever box has the focus, as the keyboard would (one input event per character). */
const type = (chars: string) => {
  for (const ch of chars) fireEvent.change(document.activeElement!, { target: { value: ch } });
};
const key = (k: string) => fireEvent.keyDown(document.activeElement!, { key: k });
const paste = (el: HTMLElement, text: string) => fireEvent.paste(el, { clipboardData: { getData: () => text } });
const typeCode = (code: string) => {
  box(1).focus();
  type(code);
};

beforeEach(() => {
  [getSession, signInAnonymously, rpc, push].forEach((m) => m.mockReset());
  getSession.mockResolvedValue({ data: { session: null }, error: null });
  signInAnonymously.mockResolvedValue({ data: { session: {} }, error: null });
  rpc.mockResolvedValue({ data: LECTURE, error: null });
});

describe("Join page", () => {
  it("is six numeric boxes in one group with one visible label", () => {
    render(<JoinPage />);
    const group = screen.getByRole("group", { name: "Enter the code on the screen" });
    expect(screen.getByRole("heading", { name: "Enter the code on the screen" })).toBeInTheDocument();
    const inputs = group.querySelectorAll("input");
    expect(inputs).toHaveLength(6);
    inputs.forEach((el, i) => {
      expect(el).toHaveAccessibleName(`Digit ${i + 1} of 6`);
      expect(el).toHaveAttribute("inputmode", "numeric");
      // Box 1 has no maxlength: the browser would cut an autofilled / one-time-code "482913" to "4" before the
      // input event. The other boxes take one digit each.
      if (i === 0) expect(el).not.toHaveAttribute("maxlength");
      else expect(el).toHaveAttribute("maxlength", "1");
      expect(el).toHaveAttribute("autocomplete", i === 0 ? "one-time-code" : "off");
    });
  });

  it("puts the cursor in the first box", () => {
    render(<JoinPage />);
    expect(box(1)).toHaveFocus();
  });

  it("fills the box and moves to the next one for each digit typed", () => {
    render(<JoinPage />);
    type("4");
    expect(values()).toEqual(["4", "", "", "", "", ""]);
    expect(box(2)).toHaveFocus();
    type("8291");
    expect(values()).toEqual(["4", "8", "2", "9", "1", ""]);
    expect(box(6)).toHaveFocus();
    type("3");
    expect(values()).toEqual(["4", "8", "2", "9", "1", "3"]);
    expect(box(6)).toHaveFocus();
  });

  it("takes digits only", () => {
    render(<JoinPage />);
    type("a");
    type("-");
    type(" ");
    expect(values()).toEqual(["", "", "", "", "", ""]);
    expect(box(1)).toHaveFocus();
  });

  it("replaces the digit when a digit is typed on a filled box", () => {
    render(<JoinPage />);
    typeCode("482913");
    box(3).focus();
    key("7");
    expect(values()).toEqual(["4", "8", "7", "9", "1", "3"]);
    expect(box(4)).toHaveFocus();
  });

  it("takes the new digit when a box holding one gets a second next to it", () => {
    render(<JoinPage />);
    typeCode("48");
    fireEvent.change(box(1), { target: { value: "47" } });
    expect(values()).toEqual(["7", "8", "", "", "", ""]);
    expect(box(2)).toHaveFocus();
    fireEvent.change(box(2), { target: { value: "38" } });
    expect(values()).toEqual(["7", "3", "", "", "", ""]);
  });

  it("takes one digit typed into box 1, which has no maxlength", () => {
    render(<JoinPage />);
    fireEvent.change(box(1), { target: { value: "4" } });
    expect(values()).toEqual(["4", "", "", "", "", ""]);
    expect(box(2)).toHaveFocus();
    box(1).focus();
    key("9");
    expect(values()).toEqual(["9", "", "", "", "", ""]);
  });

  it("Delete clears the box it is on and stays there", () => {
    render(<JoinPage />);
    typeCode("482");
    box(2).focus();
    key("Delete");
    expect(values()).toEqual(["4", "", "2", "", "", ""]);
    expect(box(2)).toHaveFocus();
    key("Delete");
    expect(values()).toEqual(["4", "", "2", "", "", ""]);
  });

  it("takes the first 6 digits of a longer paste", () => {
    render(<JoinPage />);
    paste(box(3), "482 913 77");
    expect(values()).toEqual(["4", "8", "2", "9", "1", "3"]);
    expect(box(6)).toHaveFocus();
    fireEvent.change(box(1), { target: { value: "1234567" } });
    expect(values()).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("selects a box's digit when it is clicked, so typing replaces it", () => {
    render(<JoinPage />);
    typeCode("482913");
    fireEvent.click(box(2));
    expect(box(2).selectionStart).toBe(0);
    expect(box(2).selectionEnd).toBe(1);
  });

  it("Backspace on a filled box clears it and stays there", () => {
    render(<JoinPage />);
    typeCode("482");
    box(3).focus();
    key("Backspace");
    expect(values()).toEqual(["4", "8", "", "", "", ""]);
    expect(box(3)).toHaveFocus();
  });

  it("Backspace on an empty box moves to the one before and clears it", () => {
    render(<JoinPage />);
    typeCode("482");
    expect(box(4)).toHaveFocus();
    key("Backspace");
    expect(values()).toEqual(["4", "8", "", "", "", ""]);
    expect(box(3)).toHaveFocus();
    key("Backspace");
    key("Backspace");
    key("Backspace");
    expect(values()).toEqual(["", "", "", "", "", ""]);
    expect(box(1)).toHaveFocus();
  });

  it("moves between boxes with the arrow keys", () => {
    render(<JoinPage />);
    typeCode("48");
    key("ArrowLeft");
    expect(box(2)).toHaveFocus();
    key("ArrowLeft");
    key("ArrowLeft");
    expect(box(1)).toHaveFocus();
    key("ArrowRight");
    key("ArrowRight");
    expect(box(3)).toHaveFocus();
    box(6).focus();
    key("ArrowRight");
    expect(box(6)).toHaveFocus();
  });

  it("fills all six boxes from a pasted code, wherever it is pasted", () => {
    render(<JoinPage />);
    paste(box(4), "482 913");
    expect(values()).toEqual(["4", "8", "2", "9", "1", "3"]);
    expect(box(6)).toHaveFocus();
    paste(box(2), "915-264");
    expect(values()).toEqual(["9", "1", "5", "2", "6", "4"]);
    expect(joinButton()).toBeEnabled();
  });

  it("fills from the focused box when a shorter code is pasted", () => {
    render(<JoinPage />);
    typeCode("48");
    paste(box(3), "29");
    expect(values()).toEqual(["4", "8", "2", "9", "", ""]);
    expect(box(5)).toHaveFocus();
    paste(box(5), "1 3 7");
    expect(values()).toEqual(["4", "8", "2", "9", "1", "3"]);
    paste(box(1), "abc");
    expect(values()).toEqual(["4", "8", "2", "9", "1", "3"]);
  });

  it("spreads a code autofilled into the first box over all six (one-time-code)", () => {
    render(<JoinPage />);
    fireEvent.change(box(1), { target: { value: "482913" } });
    expect(values()).toEqual(["4", "8", "2", "9", "1", "3"]);
    expect(joinButton()).toBeEnabled();
  });

  it("keeps Join disabled until all six boxes have a digit", () => {
    render(<JoinPage />);
    expect(joinButton()).toBeDisabled();
    typeCode("48291");
    expect(joinButton()).toBeDisabled();
    type("6");
    expect(joinButton()).toBeEnabled();
    box(3).focus();
    key("Backspace");
    expect(joinButton()).toBeDisabled();
  });

  it("sends the 6 digit code", async () => {
    render(<JoinPage />);
    typeCode("482913");
    fireEvent.click(joinButton());
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("join_lecture", { p_code: "482913" }));
  });

  it("joins with Enter once all six digits are in, and not before", async () => {
    render(<JoinPage />);
    typeCode("48291");
    key("Enter");
    expect(getSession).not.toHaveBeenCalled();
    type("3");
    key("Enter");
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("join_lecture", { p_code: "482913" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/l/${LECTURE}`));
  });

  it("has no explanation line under the boxes", () => {
    const { container } = render(<JoinPage />);
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("draws each digit in a layer that pops in, and only the box that changed pops again", () => {
    const { container } = render(<JoinPage />);
    typeCode("48");
    const layers = () => container.querySelectorAll("[data-digit]");
    expect(Array.from(layers(), (s) => s.textContent)).toEqual(["4", "8"]);
    layers().forEach((s) => {
      expect(s).toHaveAttribute("aria-hidden", "true");
      expect(s.className).toContain("motion-safe:animate-pop-in");
    });
    const [first, second] = Array.from(layers());
    box(2).focus();
    key("5");
    const [firstAfter, secondAfter] = Array.from(layers());
    expect(firstAfter).toBe(first);
    expect(secondAfter).not.toBe(second);
    expect(secondAfter).toHaveTextContent("5");
  });

  it("signs in anonymously when there is no session, joins, then goes to the lecture", async () => {
    render(<JoinPage />);
    typeCode("482916");
    fireEvent.click(joinButton());
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/l/${LECTURE}`));
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("join_lecture", { p_code: "482916" });
    expect(signInAnonymously.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]);
  });

  it("does not sign in again when there is already a session", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    render(<JoinPage />);
    typeCode("482916");
    fireEvent.click(joinButton());
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it("says Joining… while it works and cannot be pressed twice", async () => {
    let finish!: (v: unknown) => void;
    rpc.mockImplementation(() => new Promise((r) => (finish = r)));
    render(<JoinPage />);
    typeCode("482916");
    fireEvent.click(joinButton());
    expect(await screen.findByRole("button", { name: "Joining…" })).toBeDisabled();
    expect(box(1)).toBeDisabled();
    fireEvent.submit(box(1).closest("form")!);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    finish({ data: LECTURE, error: null });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  });

  it("says the code isn't active, keeps the digits and puts the cursor in the first box", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    render(<JoinPage />);
    typeCode("999999");
    fireEvent.click(joinButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("That code isn't active.");
    expect(alert.querySelector('[data-icon="alert"]')).not.toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(values()).toEqual(["9", "9", "9", "9", "9", "9"]);
    await waitFor(() => expect(box(1)).toHaveFocus());
    expect(joinButton()).toBeEnabled();
  });

  it("uses the same message when an older database raises not_found", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not_found" } });
    render(<JoinPage />);
    typeCode("999999");
    fireEvent.click(joinButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("That code isn't active.");
    expect(push).not.toHaveBeenCalled();
    expect(joinButton()).toBeEnabled();
  });

  it("lets one digit be fixed after a wrong code and joins with the fixed code", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    render(<JoinPage />);
    typeCode("482931");
    fireEvent.click(joinButton());
    await screen.findByRole("alert");
    await waitFor(() => expect(box(1)).toHaveFocus());
    box(5).focus();
    key("1");
    key("3");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(joinButton());
    await waitFor(() => expect(rpc).toHaveBeenLastCalledWith("join_lecture", { p_code: "482913" }));
  });

  it("shakes the boxes on each wrong code, but not for other errors", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { container } = render(<JoinPage />);
    const group = () => container.querySelector("[data-shake]");
    typeCode("999999");
    fireEvent.click(joinButton());
    await screen.findByRole("alert");
    expect(group()).toHaveAttribute("data-shake", "animate-shake");
    expect(group()).toHaveAttribute("role", "group");
    await waitFor(() => expect(joinButton()).toBeEnabled());
    fireEvent.click(joinButton());
    await waitFor(() => expect(group()).toHaveAttribute("data-shake", "animate-shake-again"));
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    fireEvent.click(joinButton());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not join. Try again."));
    expect(group()).toBeNull();
  });

  it("tells the student to wait when there have been too many tries", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "too_many_attempts" } });
    render(<JoinPage />);
    typeCode("482916");
    fireEvent.click(joinButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many tries. Wait a few minutes and try again.");
    expect(push).not.toHaveBeenCalled();
    expect(joinButton()).toBeEnabled();
  });

  it("clears the message when the code is edited", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not_found" } });
    render(<JoinPage />);
    typeCode("999999");
    fireEvent.click(joinButton());
    await screen.findByRole("alert");
    box(6).focus();
    key("Backspace");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a try again line when sign in fails", async () => {
    signInAnonymously.mockResolvedValue({ data: { session: null }, error: { message: "rate limit" } });
    render(<JoinPage />);
    typeCode("482916");
    fireEvent.click(joinButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not join. Try again.");
    expect(rpc).not.toHaveBeenCalled();
    expect(joinButton()).toBeEnabled();
  });

  it("shows a try again line when joining fails for any other reason", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    render(<JoinPage />);
    typeCode("482916");
    fireEvent.click(joinButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not join. Try again.");
    expect(push).not.toHaveBeenCalled();
  });

  it("shows a try again line when the session cannot be read", async () => {
    getSession.mockRejectedValue(new Error("storage"));
    render(<JoinPage />);
    typeCode("482916");
    fireEvent.click(joinButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not join. Try again.");
  });

  it("has a quiet white My spots button under Join, for lectures already joined on this browser", () => {
    render(<JoinPage />);
    const spots = screen.getByRole("link", { name: "My spots" });
    expect(spots).toHaveAttribute("href", "/spots");
    // Secondary (white, 44 px), not the primary look and not underlined text.
    expect(spots.className).toContain("bg-surface");
    expect(spots.className).toContain("h-11");
    expect(spots.className).not.toContain("bg-ink");
    expect(spots.className).not.toContain("underline");
    // Under Join in the column, and it holds its press until the next page shows.
    expect(joinButton().compareDocumentPosition(spots) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(spots.querySelector("span.hidden[aria-hidden]")).not.toBeNull();
    // Enter in a box still joins, not My spots.
    expect(joinButton()).toHaveAttribute("type", "submit");
  });

  it("has a quiet Privacy link in the footer", () => {
    render(<JoinPage />);
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  });
});
