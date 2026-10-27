"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/Icon";
import { LECTURE_VIEWS, VIEW_LABEL, type LectureView } from "@/lib/lectureView";

/**
 * The student's layout picker in the top bar (batch N): an icon button named "Layout" that opens a
 * small menu with Notes, Slides only and Classic, the current one checked. No text on the screen
 * explains it (the info panel does). Arrow keys move in the menu, Enter or Space picks, Esc, Tab, the
 * button again or a press anywhere else closes it.
 */
export function ViewMenu({ view, onView }: { view: LectureView; onView: (view: LectureView) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    // The current layout has the focus when the menu opens.
    rootRef.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function close(focusButton: boolean) {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  }

  function pick(next: LectureView) {
    close(true);
    if (next !== view) onView(next);
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const items = itemRefs.current.filter((el): el is HTMLButtonElement => el !== null);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    let to: number | null = null;
    if (e.key === "ArrowDown") to = (at + 1) % items.length;
    else if (e.key === "ArrowUp") to = (at - 1 + items.length) % items.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = items.length - 1;
    else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
      return;
    } else if (e.key === "Tab") {
      close(false);
      return;
    }
    if (to === null) return;
    e.preventDefault();
    items[to]?.focus();
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Layout"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-view-button=""
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="press touch-target relative flex size-9 items-center justify-center rounded-md text-ink hover:bg-surface focus-ring aria-expanded:bg-surface"
      >
        <Icon name="layout" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Layout"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-20 mt-1.5 flex w-44 animate-pop-in flex-col gap-0.5 rounded-md border border-hairline bg-surface p-1 text-ink shadow-popover origin-top-right"
        >
          {LECTURE_VIEWS.map((v, i) => (
            <button
              key={v}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={v === view}
              data-view-option={v}
              tabIndex={v === view ? 0 : -1}
              onClick={() => pick(v)}
              className="press focus-ring flex h-10 w-full items-center justify-between gap-3 rounded-md px-3 text-left type-small text-ink hover:bg-bg aria-checked:type-small-strong focus-visible:outline-offset-0"
            >
              {VIEW_LABEL[v]}
              {v === view && <Icon name="check" size={18} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
