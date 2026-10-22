import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const signInWithOAuth = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({ auth: { signInWithOAuth } }),
}));

import { SignInButton } from "./sign-in-button";

beforeEach(() => {
  signInWithOAuth.mockReset();
  signInWithOAuth.mockResolvedValue({ data: {}, error: null });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SignInButton", () => {
  it("starts Google sign in with the Miami hint and the callback url", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://backtrack.example");
    render(<SignInButton />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://backtrack.example/auth/callback",
        queryParams: { hd: "miamioh.edu", prompt: "select_account" },
      },
    });
  });

  it("falls back to the current origin when NEXT_PUBLIC_SITE_URL is not set", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    render(<SignInButton />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    expect(signInWithOAuth.mock.calls[0][0].options.redirectTo).toBe(
      `${window.location.origin}/auth/callback`,
    );
  });

  it("shows the Google G in the button", () => {
    render(<SignInButton />);
    const button = screen.getByRole("button", { name: "Sign in with Google" });
    expect(button.querySelector('img[src="/brand/google-g.svg"]')).not.toBeNull();
  });
});
