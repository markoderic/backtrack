import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => ({ auth: { signInWithOAuth: vi.fn() } }) }));

import { SignInView } from "./sign-in-view";

describe("SignInView (Marko: after I'm a teacher there was no way back)", () => {
  it("the logo goes back to Home", () => {
    render(<SignInView />);
    expect(screen.getByRole("link", { name: "backtrack, home" })).toHaveAttribute("href", "/");
  });

  it("has a white Back to home button under the sign in", () => {
    render(<SignInView />);
    const back = screen.getByRole("link", { name: "Back to home" });
    expect(back).toHaveAttribute("href", "/");
    expect(back.className).toContain("border-hairline");
    expect(back.className).toContain("h-11");
    expect(back.className).not.toContain("underline");
    expect(back.querySelector('[data-icon="back"]')).not.toBeNull();
  });

  it("keeps the way back with a message showing (not a Miami account)", () => {
    render(<SignInView message="That isn't a Miami account. Use your @miamioh.edu account." />);
    expect(screen.getByRole("alert")).toHaveTextContent("That isn't a Miami account.");
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/");
  });
});
