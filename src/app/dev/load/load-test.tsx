"use client";

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

const STUDENTS = 40;

type Result = { joined: number; firstError: string | null };

/** Storage that lives in memory, so a test student never touches the page's real session. */
function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  };
}

async function joinAsNewStudent(index: number, code: string): Promise<string | null> {
  try {
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: {
        storage: memoryStorage(),
        storageKey: `backtrack-load-${index}`,
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const { error: signInError } = await client.auth.signInAnonymously();
    if (signInError) return signInError.message;
    const { data: lectureId, error: joinError } = await client.rpc("join_lecture", { p_code: code });
    if (joinError) return joinError.message;
    // A null lecture id with no error means the code is not live.
    return lectureId ? null : "code is not live (join_lecture returned null)";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export function LoadTest() {
  const [code, setCode] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function run() {
    if (code.length !== 6 || running) return;
    setRunning(true);
    setResult(null);
    const errors = await Promise.all(Array.from({ length: STUDENTS }, (_, i) => joinAsNewStudent(i, code)));
    setResult({
      joined: errors.filter((e) => e === null).length,
      firstError: errors.find((e) => e !== null) ?? null,
    });
    setRunning(false);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1">
          Code
          <input
            value={code}
            inputMode="numeric"
            maxLength={6}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="w-full border border-current px-3 py-3 font-mono text-3xl tracking-widest"
          />
        </label>
        <button
          type="submit"
          disabled={code.length !== 6 || running}
          className="self-start border border-current px-6 py-3 disabled:opacity-40"
        >
          {running ? "Running..." : "Run"}
        </button>
      </form>
      {result && <p>{`${result.joined} of ${STUDENTS} joined`}</p>}
      {result?.firstError && <p role="alert">{result.firstError}</p>}
    </main>
  );
}
