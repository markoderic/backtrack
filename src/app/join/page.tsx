"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const NOT_LIVE = "That code isn't live. Check the number with your professor.";
const FAILED = "Could not join. Try again.";

class NotLiveError extends Error {}

export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    if (code.length !== 6 || joining) return;
    setJoining(true);
    setError(null);
    try {
      const supabase = createBrowserSupabase();
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) {
        const { error: signInError } = await supabase.auth.signInAnonymously();
        if (signInError) throw signInError;
      }

      const { data: lectureId, error: joinError } = await supabase.rpc("join_lecture", { p_code: code });
      if (joinError) {
        if (joinError.message === "not_found") throw new NotLiveError();
        throw new Error(joinError.message);
      }
      router.push(`/l/${lectureId}`);
    } catch (e) {
      setError(e instanceof NotLiveError ? NOT_LIVE : FAILED);
      setJoining(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-4">
      <h1 className="text-4xl font-semibold">Backtrack</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void join();
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1">
          Class code
          <input
            value={code}
            inputMode="numeric"
            maxLength={6}
            autoComplete="off"
            autoFocus
            disabled={joining}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              setError(null);
            }}
            className="w-full border border-current px-3 py-3 font-mono text-3xl tracking-widest"
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button
          type="submit"
          disabled={code.length !== 6 || joining}
          className="self-start border border-current px-6 py-3 disabled:opacity-40"
        >
          {joining ? "Joining..." : "Join"}
        </button>
      </form>
    </main>
  );
}
