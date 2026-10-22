"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { ButtonPrimary } from "@/components/ButtonPrimary";
import { Icon } from "@/components/Icon";
import { LogoLockup } from "@/components/Logo";

const NOT_LIVE = "No live lecture has that code.";
const TOO_MANY = "Too many tries. Wait a few minutes and try again.";
const FAILED = "Could not join. Try again.";

/** Shows the code with a space after 3 digits, for reading ("482 913"). */
function spaced(digits: string): string {
  return digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
}

/**
 * Where the caret goes in the spaced code when it sits after this many digits. After exactly 3
 * it stays on the side of the space it was on (after it when the 4th digit was just deleted).
 */
function caretAt(digitsBefore: number, afterSpace: boolean, length: number): number {
  if (digitsBefore === 3 && afterSpace && length > 3) return 4;
  return digitsBefore > 3 ? digitsBefore + 1 : digitsBefore;
}

/**
 * Reads an edit of the spaced field: the new digits, and how many digits are left of the caret.
 * Deleting only the reading space deletes the digit on that side instead, so Backspace right
 * after the space removes the 3rd digit (and Delete right before it removes the 4th).
 */
function readEdit(
  value: string,
  caret: number,
  before: string,
  inputType: string | undefined,
): { digits: string; digitsBefore: number; afterSpace: boolean } {
  let digits = value.replace(/\D/g, "");
  let digitsBefore = value.slice(0, caret).replace(/\D/g, "").length;
  let afterSpace = caret > 0 && value[caret - 1] === " ";
  // Only a key delete (Backspace, Delete, word deletes) that took out just the space. A paste or autofill of the
  // same code, or a cut of only the space, is not a delete of a digit. No inputType (old browsers) counts as a key delete.
  const keyDelete = inputType === undefined || (inputType.startsWith("delete") && inputType !== "deleteByCut" && inputType !== "deleteByDrag");
  if (keyDelete && digits === before && value.length < spaced(before).length) {
    if (inputType?.endsWith("Forward")) {
      digits = before.slice(0, digitsBefore) + before.slice(digitsBefore + 1);
    } else if (digitsBefore > 0) {
      digits = before.slice(0, digitsBefore - 1) + before.slice(digitsBefore);
      digitsBefore -= 1;
    }
    afterSpace = false;
  }
  digits = digits.slice(0, 6);
  return { digits, digitsBefore: Math.min(digitsBefore, digits.length), afterSpace };
}

class NotLiveError extends Error {}
class TooManyTriesError extends Error {}

export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Where the caret belongs after the code is re-spaced. A new object each edit, so it is set every time.
  const [caret, setCaret] = useState<{ pos: number } | null>(null);
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (caret && el && document.activeElement === el) el.setSelectionRange(caret.pos, caret.pos);
  }, [caret]);
  // Counts wrong codes, so each one shakes the field again.
  const [wrongCount, setWrongCount] = useState(0);

  // The field is disabled while joining, which takes the cursor out. Put it back with the message so the code can be fixed.
  useEffect(() => {
    if (error && !joining) inputRef.current?.focus();
  }, [error, joining]);

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
        // not_found is what a database from before 0009 raises for a wrong code.
        if (joinError.message === "not_found") throw new NotLiveError();
        if (joinError.message === "too_many_attempts") throw new TooManyTriesError();
        throw new Error(joinError.message);
      }
      // join_lecture returns null, not an error, for a code that is not live.
      if (!lectureId) throw new NotLiveError();
      router.push(`/l/${lectureId}`);
    } catch (e) {
      setError(e instanceof NotLiveError ? NOT_LIVE : e instanceof TooManyTriesError ? TOO_MANY : FAILED);
      if (e instanceof NotLiveError) setWrongCount((n) => n + 1);
      setJoining(false);
    }
  }

  const shown = spaced(code);
  const shake = error === NOT_LIVE && wrongCount > 0 ? (wrongCount % 2 ? "animate-shake" : "animate-shake-again") : "";

  return (
    <main className="flex min-h-dvh flex-col bg-bg">
      <header className="flex items-center p-4">
        <Link href="/" className="focus-ring flex rounded-xs">
          <LogoLockup size="S" />
        </Link>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void join();
        }}
        className="flex flex-1 flex-col items-center justify-center px-4 pb-14"
      >
        <div className="flex w-full animate-rise-in flex-col items-center gap-4">
          <h1 className="type-title text-center text-ink">
            <label htmlFor="code">Enter the code on the screen</label>
          </h1>
          {/* The field shakes on a wrong code (transform only). */}
          <div data-shake={shake || undefined} className={`relative h-18 w-75 max-w-full ${shake}`}>
            <input
              ref={inputRef}
              id="code"
              value={shown}
              inputMode="numeric"
              // 6 digits and the reading space after the third.
              maxLength={7}
              autoComplete="off"
              autoFocus
              placeholder="6 digits"
              disabled={joining}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const el = e.target;
                const { digits, digitsBefore, afterSpace } = readEdit(
                  el.value,
                  el.selectionStart ?? el.value.length,
                  code,
                  (e.nativeEvent as InputEvent).inputType,
                );
                setCode(digits);
                setCaret({ pos: caretAt(digitsBefore, afterSpace, digits.length) });
                setError(null);
              }}
              className={
                "absolute inset-0 h-full w-full rounded-md border border-hairline bg-surface px-4 text-center " +
                // Empty, it is set in Body so the "6 digits" placeholder sits like the design; with digits, Number M.
                (shown ? "type-number-m " : "type-body ") +
                // The typed text is drawn by the layer below so each digit can pop in; the input keeps the caret.
                "text-transparent caret-ink outline-hidden focus:border-[1.5px] focus:border-ink disabled:opacity-100 " +
                "placeholder:text-secondary"
              }
            />
            <div
              aria-hidden
              data-code-display
              className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 type-number-m whitespace-pre text-ink"
            >
              {shown.split("").map((ch, i) => (
                <span key={i} className="inline-block animate-digit-pop">
                  {ch}
                </span>
              ))}
            </div>
          </div>
          {error && (
            <div role="alert" className="flex animate-fade-in items-center gap-2 text-ink">
              <Icon name="alert" size={18} />
              <p className="type-small">{error}</p>
            </div>
          )}
          <ButtonPrimary type="submit" disabled={code.length !== 6 || joining}>
            {joining ? "Joining…" : "Join"}
          </ButtonPrimary>
          {/* Reserved for the message, so the column never moves (design: a 20 px row). */}
          {!error && <div aria-hidden className="h-5" />}
        </div>
      </form>
    </main>
  );
}
