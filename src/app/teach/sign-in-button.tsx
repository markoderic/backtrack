"use client";

import { createBrowserSupabase } from "@/lib/supabase/browser";
import "./google-button.css";

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
    <button
      type="button"
      onClick={signIn}
      className={`google-button press focus-ring flex h-12 w-75 max-w-full items-center justify-center gap-3 rounded-md px-4 whitespace-nowrap`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a fixed 20 px local SVG */}
      <img src="/brand/google-g.svg" alt="" aria-hidden width={20} height={20} className="block size-5 shrink-0" />
      Sign in with Google
    </button>
  );
}
