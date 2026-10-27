"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, type KeyboardEvent, type TextareaHTMLAttributes } from "react";
import type { NoteState } from "@/lib/notebookApi";

/**
 * Text typed straight on the page, like a notebook: no box, no border, no button. Inter, regular
 * (type-note, batch N), on faint ruled lines (bg-ruled), with a thin margin line at the left that turns ink while
 * the field has the focus (the focus indicator). The page saves it by itself.
 *
 * `grow`: the field is as tall as its text (from `rows` lines up to `maxRows`, then it scrolls).
 * Without it the field fills the room its parent gives it and scrolls inside.
 */
type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onValue: (text: string) => void;
  grow?: boolean;
  maxRows?: number;
};

export const notebookFieldClass =
  "block w-full min-w-0 resize-none border-0 border-l border-hairline bg-transparent bg-ruled py-0 pl-3 pr-1 type-note text-ink " +
  "outline-hidden placeholder:text-secondary transition-[border-color,box-shadow] duration-(--dur-fast) ease-out " +
  "hover:border-strip focus:border-ink focus:shadow-[inset_1px_0_0_var(--color-ink)]";

export const NotebookField = forwardRef<HTMLTextAreaElement, Props>(function NotebookField(
  { value, onValue, grow = false, maxRows = 6, rows = 1, className = "", ...rest },
  ref,
) {
  const inner = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement);
  // Grows with its text, a line (24 px) at a time: when the text changes, and when the field gets
  // narrower or wider (a "Saved" beside it, the sidebar resized), so its last line is never hidden.
  useEffect(() => {
    const field = inner.current;
    if (!grow || !field) return;
    const fit = () => {
      field.style.height = "";
      const lines = Math.min(Math.max(Math.ceil(field.scrollHeight / 24), Number(rows)), maxRows);
      field.style.height = `${lines * 24}px`;
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (field.clientWidth === width) return;
      width = field.clientWidth;
      fit();
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [value, grow, rows, maxRows]);
  return (
    <textarea
      ref={inner}
      rows={rows}
      value={value}
      spellCheck
      onChange={(e) => onValue(e.target.value)}
      className={`${notebookFieldClass} ${grow ? "overflow-y-auto" : "h-full"} ${className}`}
      {...rest}
    />
  );
});

/** Enter without Shift: the field's text goes now (a new line needs Shift+Enter). */
export function isSendKey(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing;
}

/**
 * The quiet saved state: "Saved" once the database has the text, "Saved on this device" while it can
 * only be kept here (offline, or before migration 0020). Nothing while typing.
 */
export function savedText(state: NoteState | null): string {
  if (state === "saved") return "Saved";
  if (state === "offline" || state === "missing" || state === "failed") return "Saved on this device";
  return "";
}

/** The saved state, said once by a screen reader each time it changes (polite). */
export function SavedState({ state, className = "" }: { state: NoteState | null; className?: string }) {
  const text = savedText(state);
  return (
    <p role="status" data-saved-state={state ?? ""} className={`type-caption text-secondary ${className}`}>
      {text && (
        <span key={text} className="animate-fade-in">
          {text}
        </span>
      )}
    </p>
  );
}
