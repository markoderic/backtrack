import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("./actions", () => ({ signOut: h.signOut }));

import { SignOut } from "./SignOut";

beforeEach(() => {
  h.signOut.mockReset();
});

describe("SignOut", () => {
  it("shows who is signed in and a white Sign out button", () => {
    render(<SignOut email="lcarter@miamioh.edu" />);
    expect(screen.getByText("Signed in as lcarter@miamioh.edu")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Sign out" });
    expect(button.className).toContain("h-11");
    expect(button.className).toContain("border-hairline");
    expect(button.className).not.toContain("underline");
  });

  it("calls the sign out action when pressed", async () => {
    h.signOut.mockResolvedValue(null);
    render(<SignOut email="lcarter@miamioh.edu" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(h.signOut).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the error when signing out fails", async () => {
    h.signOut.mockResolvedValue({ error: "Couldn't sign out. Try again." });
    render(<SignOut email="lcarter@miamioh.edu" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't sign out. Try again.");
  });
});
