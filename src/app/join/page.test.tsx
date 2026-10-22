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
const input = () => screen.getByLabelText("Class code") as HTMLInputElement;
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
    expect(input()).toHaveAttribute("maxlength", "6");
  });

  it("lets no letters or symbols be typed", () => {
    render(<JoinPage />);
    type("12ab-3 4");
    expect(input().value).toBe("1234");
    type("abc");
    expect(input().value).toBe("");
  });

  it("cuts a pasted code to 6 digits", () => {
    render(<JoinPage />);
    type("482 916 77");
    expect(input().value).toBe("48291677".slice(0, 6));
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

  it("says Joining... while it works and cannot be pressed twice", async () => {
    let finish!: (v: unknown) => void;
    rpc.mockImplementation(() => new Promise((r) => (finish = r)));
    render(<JoinPage />);
    type("482916");
    fireEvent.click(joinButton());
    expect(await screen.findByRole("button", { name: "Joining..." })).toBeDisabled();
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
    expect(await screen.findByRole("alert")).toHaveTextContent("That code isn't live. Check the number with your professor.");
    expect(push).not.toHaveBeenCalled();
    expect(joinButton()).toBeEnabled();
    expect(input().value).toBe("999999");
  });

  it("explains a code that is not live when the database returns null with no error", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    render(<JoinPage />);
    type("999999");
    fireEvent.click(joinButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("That code isn't live. Check the number with your professor.");
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
