"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/Icon";
import { MARK_NOTE_MAX } from "@/lib/marksApi";
import type { ShownMark } from "./HighlightLayer";

/** A note is saved this long after the last key (and at once when the popover closes). */
export const MARK_NOTE_SAVE_MS = 600;

type Props = {
  mark: ShownMark;
  /** The mark's number on its slide (Mark 2), for the popover's name. */
  n: number;
  /** Before migration 0020 a mark is the one highlight on the tap: it has no note of its own. */
  noteless?: boolean;
  /** Take the focus into the note when it opens (it was opened with the keyboard). */
  focusNote?: boolean;
  onNote: (text: string) => void;
  onDelete: () => void;
  /** Esc, the close button, or a press outside. `back` puts the focus back on the mark. */
  onClose: (back: boolean) => void;
};

/**
 * Where the popover goes over the slide (in its frame, outside the slide's clipping): under the mark,
 * or over it when the mark is low on the slide, and never past the slide's left or right edge.
 */
export function popoverPlace(mark: ShownMark): CSSProperties {
  const left = `clamp(0px, ${Math.round(mark.rect.x * 1e4) / 100}%, calc(100% - min(18rem, 100%)))`;
  const below = mark.rect.y + mark.rect.h <= 0.6;
  return below
    ? { left, top: `calc(${Math.round((mark.rect.y + mark.rect.h) * 1e4) / 100}% + 8px)` }
    : { left, bottom: `calc(${Math.round((1 - mark.rect.y) * 1e4) / 100}% + 8px)` };
}

/** Drops the click that follows a press (once, within a moment), so closing a popover does nothing else. */
function swallowNextClick() {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    done();
  };
  const done = () => {
    clearTimeout(timer);
    document.removeEventListener("click", stop, true);
  };
  const timer = setTimeout(done, 800);
  document.addEventListener("click", stop, true);
}

/**
 * The small popover on a selected mark: its private note and Delete. The note is like a line in a
 * notebook: no box to submit, it saves by itself a moment after typing stops and when the popover
 * closes. "Saved" shows once it is. Esc or the close button closes it.
 */
export function MarkPopover({ mark, n, noteless = false, focusNote = false, onNote, onDelete, onClose }: Props) {
  const [text, setText] = useState(mark.note ?? "");
  const [saved, setSaved] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // The text not saved yet, so closing (or unmounting) saves it.
  const dirty = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onNoteRef = useRef(onNote);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onNoteRef.current = onNote;
    onCloseRef.current = onClose;
  });

  const save = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (dirty.current === null) return;
    const next = dirty.current;
    dirty.current = null;
    onNoteRef.current(next);
  };
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  // Saves what is left when the popover goes (closed, another mark, another slide).
  useEffect(() => () => saveRef.current(), []);

  // Only when it opens: with the keyboard, the focus goes into the note (or the popover, with no note).
  const focusOnOpen = useRef(focusNote);
  useEffect(() => {
    if (focusOnOpen.current) (fieldRef.current ?? rootRef.current)?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current(true);
      }
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Element | null;
      // A press on a mark is that mark's own click (it selects it, or closes this one).
      if (rootRef.current?.contains(target) || target?.closest?.("[data-mark]")) return;
      // A press that only closes the popover never records I'm lost (on a phone the popover can sit over it).
      if (target?.closest?.("[data-im-lost]")) swallowNextClick();
      onCloseRef.current(false);
    }
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={`Mark ${n}`}
      tabIndex={-1}
      data-mark-popover={mark.id}
      style={popoverPlace(mark)}
      className="absolute z-20 flex w-72 max-w-full animate-pop-in flex-col gap-2 rounded-md border border-hairline bg-surface p-3 text-ink shadow-popover outline-hidden"
    >
      {!noteless && (
        <textarea
          ref={fieldRef}
          aria-label="Note on this mark"
          placeholder="Add a note"
          rows={3}
          maxLength={MARK_NOTE_MAX}
          value={text}
          onChange={(e) => {
            const next = e.target.value.slice(0, MARK_NOTE_MAX);
            setText(next);
            setSaved(false);
            dirty.current = next;
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => {
              save();
              setSaved(true);
            }, MARK_NOTE_SAVE_MS);
          }}
          onBlur={() => {
            if (dirty.current === null) return;
            save();
            setSaved(true);
          }}
          className="block w-full resize-none bg-transparent type-note text-ink outline-hidden placeholder:text-secondary"
        />
      )}
      <div className="flex items-center gap-2">
        <span data-mark-saved="" aria-live="polite" className="type-caption text-secondary">
          {saved ? "Saved" : ""}
        </span>
        <button
          type="button"
          onClick={() => {
            dirty.current = null;
            if (timer.current) clearTimeout(timer.current);
            onDelete();
          }}
          className="press focus-ring ml-auto flex h-9 items-center rounded-md px-3 type-button text-ink hover:bg-bg"
        >
          Delete
        </button>
        <button
          type="button"
          aria-label="Close"
          onClick={() => onClose(true)}
          className="press focus-ring flex size-9 items-center justify-center rounded-md text-ink hover:bg-bg"
        >
          <Icon name="close" size={20} />
        </button>
      </div>
    </div>
  );
}
