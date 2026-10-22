"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { ButtonPrimary } from "@/components/ButtonPrimary";
import { Icon } from "@/components/Icon";
import { LogoLockup } from "@/components/Logo";
import { PrivacyLink } from "@/components/PrivacyLink";

// One message for a code that ended and one that never existed: join_lecture cannot tell them apart.
const NOT_ACTIVE = "That code isn't active.";
const TOO_MANY = "Too many tries. Wait a few minutes and try again.";
const FAILED = "Could not join. Try again.";

const LENGTH = 6;
const EMPTY = Array<string>(LENGTH).fill("");

class NotActiveError extends Error {}
class TooManyTriesError extends Error {}

/**
 * Join (Figma 31:89 / 31:106 / 31:123 / 31:172): six boxes for the code on the screen, one digit
 * each, with a wider gap after the third so it reads "482 913". Typing moves to the next box;
 * Backspace clears a box or steps back; arrows move; a paste or one-time-code autofill fills
 * them all. Each typed digit pops in; a wrong code shakes the boxes and keeps the digits.
 */
export default function JoinPage() {
  const router = useRouter();
  const [digits, setDigits] = useState<string[]>(EMPTY);
  // One stamp per box, renewed when its digit is set, so only that digit pops in again.
  const [stamps, setStamps] = useState<number[]>(() => Array(LENGTH).fill(0));
  const nextStamp = useRef(0);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  // Counts wrong codes, so each one shakes the boxes again.
  const [wrongCount, setWrongCount] = useState(0);

  const code = digits.join("");
  const complete = code.length === LENGTH;

  // The boxes are disabled while joining, which takes the cursor out. Put it in the first box with the message
  // so the code can be fixed (the digits stay).
  useEffect(() => {
    if (error && !joining) boxes.current[0]?.focus();
  }, [error, joining]);

  function focusBox(i: number) {
    boxes.current[Math.max(0, Math.min(LENGTH - 1, i))]?.focus();
  }

  /** Puts `incoming` digits into the boxes from box `start` on, then moves to the box after the last one. */
  function fill(start: number, incoming: string) {
    const take = incoming.slice(0, LENGTH - start);
    if (!take) return;
    const next = [...digits];
    const nextStamps = [...stamps];
    for (let k = 0; k < take.length; k++) {
      next[start + k] = take[k];
      nextStamps[start + k] = ++nextStamp.current;
    }
    setDigits(next);
    setStamps(nextStamps);
    setError(null);
    focusBox(start + take.length);
  }

  function clear(i: number) {
    if (!digits[i]) return;
    const next = [...digits];
    next[i] = "";
    setDigits(next);
    setError(null);
  }

  /** A paste of a whole code fills every box; a shorter one fills from the box it lands in. */
  function placeMany(i: number, found: string) {
    if (found.length >= LENGTH) fill(0, found);
    else fill(i, found);
  }

  function onChange(i: number, e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    if (raw === "") return clear(i);
    const found = raw.replace(/\D/g, "");
    if (!found) return; // A letter or symbol: the box keeps what it had.
    if (found.length === 2 && digits[i] && found.includes(digits[i])) {
      // A second digit typed next to the old one (a keyboard that ignores maxLength): it replaces it.
      return fill(i, found[0] === digits[i] ? found[1] : found[0]);
    }
    // One typed digit, or a whole code from autofill or the iOS one-time-code suggestion.
    placeMany(i, found);
  }

  function onKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (digits[i]) clear(i);
      else if (i > 0) {
        clear(i - 1);
        focusBox(i - 1);
      }
    } else if (e.key === "Delete") {
      e.preventDefault();
      clear(i);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusBox(i - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusBox(i + 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (complete) void join();
    } else if (/^\d$/.test(e.key) && digits[i] && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // A digit on a filled box replaces it, wherever the caret is.
      e.preventDefault();
      fill(i, e.key);
    }
  }

  function onPaste(i: number, e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const found = e.clipboardData.getData("text").replace(/\D/g, "");
    if (found) placeMany(i, found);
  }

  async function join() {
    if (!complete || joining) return;
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
        if (joinError.message === "not_found") throw new NotActiveError();
        if (joinError.message === "too_many_attempts") throw new TooManyTriesError();
        throw new Error(joinError.message);
      }
      // join_lecture returns null, not an error, for a code that is not active (ended or unknown).
      if (!lectureId) throw new NotActiveError();
      router.push(`/l/${lectureId}`);
    } catch (e) {
      setError(e instanceof NotActiveError ? NOT_ACTIVE : e instanceof TooManyTriesError ? TOO_MANY : FAILED);
      if (e instanceof NotActiveError) setWrongCount((n) => n + 1);
      setJoining(false);
    }
  }

  const shake = error === NOT_ACTIVE && wrongCount > 0 ? (wrongCount % 2 ? "animate-shake" : "animate-shake-again") : "";

  return (
    <main className="relative flex min-h-dvh flex-col bg-bg">
      <header className="flex items-center p-4">
        <Link href="/" className="press focus-ring touch-target relative flex rounded-xs">
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
        <div className="flex w-full animate-page-in flex-col items-center gap-4">
          <h1 id="code-label" className="type-title text-center text-ink">
            Enter the code on the screen
          </h1>
          {/* Six boxes in the 300 px column: 8 px apart, 16 after the third. The group shakes on a wrong code. */}
          <div
            role="group"
            aria-labelledby="code-label"
            data-shake={shake || undefined}
            className={`flex w-75 max-w-full gap-2 ${shake}`}
          >
            {digits.map((d, i) => (
              <div
                key={i}
                data-box
                className={`relative h-16 min-w-0 flex-1 ${i === 3 ? "ml-2" : ""} ${joining ? "" : "press"}`}
              >
                <input
                  ref={(el) => {
                    boxes.current[i] = el;
                  }}
                  value={d}
                  aria-label={`Digit ${i + 1} of ${LENGTH}`}
                  inputMode="numeric"
                  // No maxLength on box 1: a browser cuts an autofilled or iOS one-time-code value to maxLength
                  // before the input event, so "482913" would arrive as "4". onChange spreads a whole code; typed
                  // digits still stay one per box (keydown replaces a filled box, onChange takes one new digit).
                  maxLength={i === 0 ? undefined : 1}
                  autoComplete={i === 0 ? "one-time-code" : "off"}
                  autoFocus={i === 0}
                  disabled={joining}
                  onChange={(e) => onChange(i, e)}
                  onKeyDown={(e) => onKeyDown(i, e)}
                  onPaste={(e) => onPaste(i, e)}
                  // Focus or a click selects the digit, so typing replaces it.
                  onFocus={(e) => e.currentTarget.select()}
                  onClick={(e) => e.currentTarget.select()}
                  className={
                    "absolute inset-0 h-full w-full rounded-md border border-hairline bg-surface p-0 text-center type-number-m " +
                    // The digit is drawn by the layer below so it can pop in; the input keeps the caret.
                    "text-transparent caret-ink outline-hidden selection:bg-transparent disabled:opacity-100 " +
                    // Hover and focus borders ease in (focus is the field's 1.5 px ink border, drawn as 1 px plus a
                    // 0.5 px inset shadow like the teacher fields, since a browser at 1x rounds a 1.5 px border down to 1).
                    "transition-[border-color,box-shadow] duration-(--dur-fast) ease-out hover:border-strip " +
                    "focus:border-ink focus:shadow-[inset_0_0_0_0.5px_var(--color-ink)] disabled:border-hairline"
                  }
                />
                {d && (
                  <span
                    key={stamps[i]}
                    aria-hidden
                    data-digit
                    className="pointer-events-none absolute inset-0 flex items-center justify-center type-number-m text-ink motion-safe:animate-pop-in"
                  >
                    {d}
                  </span>
                )}
              </div>
            ))}
          </div>
          {error && (
            <div role="alert" className="flex animate-fade-in items-center gap-2 text-ink">
              <Icon name="alert" size={18} />
              <p className="type-small">{error}</p>
            </div>
          )}
          <ButtonPrimary type="submit" disabled={!complete || joining}>
            {joining ? "Joining…" : "Join"}
          </ButtonPrimary>
          {/* Reserved for the message, so the column never moves (design: a 20 px row). */}
          {!error && <div aria-hidden className="h-5" />}
        </div>
      </form>
      <footer className="absolute inset-x-0 bottom-0 flex justify-center pb-1">
        <PrivacyLink />
      </footer>
    </main>
  );
}
