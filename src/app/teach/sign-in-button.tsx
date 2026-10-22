"use client";

import { createBrowserSupabase } from "@/lib/supabase/browser";

export function SignInButton() {
  function signIn() {
    const site = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    // hd only hints Google's account picker. The server checks the account in /auth/callback.
    void createBrowserSupabase().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${site}/auth/callback`,
        queryParams: { hd: "miamioh.edu", prompt: "select_account" },
      },
    });
  }

  return (
    <button type="button" onClick={signIn} style={{ padding: "0.75rem 1.5rem", border: "1px solid currentColor" }}>
      Sign in with Google
    </button>
  );
}
