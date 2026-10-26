"use client";

import { useEffect, useRef, type CSSProperties, type MouseEvent, type RefObject } from "react";
import type { Rect } from "@/lib/rect";
import { slideBoxStyle, useDragRect } from "@/lib/useDragRect";
import { glowStep, markLook, markLookClass, type MarkLook, type MarkTone, type SlideSample } from "@/lib/slideTone";

export type MarkKind = "lost" | "save";

/** A mark drawn on the slide: red (lost) or yellow (save). */
export type ShownMark = { id: string; rect: Rect; kind: MarkKind; note?: string };

/** A fraction as a css percentage, without float noise (0.3 * 100 is 30.000000000000004). */
const pct = (n: number) => `${Math.round(n * 1e6) / 1e4}%`;

/**
 * A mark's look (lib/slideTone): the highlighter on a light part of the slide (multiply, --color-mark or
 * --color-mark-lost, no border), a glow on a dark part, a fill with a colored inner edge when the slide
 * could not be measured.
 */
export function markClass(kind: MarkKind, tone: MarkTone = "light"): string {
  return markLookClass(kind, tone);
}

/** A glow's strength as the --glow variable (lib/slideTone, globals.css mark-glow). */
const glowStyle = (look: MarkLook): CSSProperties => (look.tone === "dark" ? ({ "--glow": look.opacity ?? 1 } as CSSProperties) : {});

/** The selected outline and the focus ring, so they show on the slide under the mark. */
function ringClass(look: MarkLook, kind: MarkKind, selected: boolean): string {
  // On a dark part white; in the edge look (any color under it) ink with a white ring around it.
  if (look.tone === "dark") return `outline-offset-1 focus-visible:outline-2 focus-visible:outline-surface ${selected ? "outline-2 outline-surface" : ""}`;
  if (look.tone === "edge") return `outline-offset-2 focus-visible:outline-2 focus-visible:outline-ink focus-visible:ring-2 focus-visible:ring-surface ${selected ? "outline-2 outline-ink ring-2 ring-surface" : ""}`;
  return `outline-offset-1 focus-visible:outline-2 focus-visible:outline-ink ${selected ? `outline-2 ${kind === "lost" ? "outline-lost" : "outline-ink"}` : ""}`;
}

/** What a screen reader hears for a mark: its number, red marks say lost, and its note if it has one. */
export function markLabel(mark: ShownMark, n: number): string {
  return `Mark ${n}${mark.kind === "lost" ? ", lost" : ""}${mark.note ? `: ${mark.note}` : ""}`;
}

type Props = {
  /** The slide image this layer sits over. */
  imageRef: RefObject<HTMLImageElement | null>;
  /** The Mark tool is on: a drag (mouse, pen or finger) draws a box, and letting go adds a mark. */
  marking: boolean;
  /** The kind a new mark gets (red on a slide where the student is lost), for the drag and the hint. */
  markingKind?: MarkKind;
  /** The student's marks on this slide. */
  marks?: ShownMark[];
  /** The mark whose popover is open. */
  selectedId?: string | null;
  /** A mark was clicked or tapped (null: the selection goes). `keyboard` when it came from Enter or Space. */
  onSelect?: (id: string | null, keyboard: boolean) => void;
  /** The box the student let go on. */
  onMark: (rect: Rect) => void;
  /** Esc while marking. */
  onCancel: () => void;
  /** One mark drawn without a popover (My spots, until batch K2 gives it several). */
  shown?: { kind: MarkKind; rect: Rect } | null;
  /**
   * The slide measured (lib/slideTone useSlideSample), so each mark takes the look that shows on the
   * part of the slide under it. undefined while measuring; null when it can not be measured.
   */
  sample?: SlideSample | null;
};

/**
 * Sits over the slide image and draws the student's marks, like a highlighter (a fill, no border).
 * Each mark is a button: a click, a tap or Enter selects it (its popover opens; the page draws it).
 * While the Mark tool is on, the slide takes a drag with a mouse, a pen or a finger and adds a mark
 * the moment the drag ends; the tool stays on for the next one. A click on a mark while marking
 * selects it; a click elsewhere, or a drag under 2% of the slide in both directions, adds nothing.
 * Esc stops marking. There is no keyboard shortcut.
 */
export function HighlightLayer({
  imageRef,
  marking,
  markingKind = "save",
  marks = [],
  selectedId = null,
  onSelect,
  onMark,
  onCancel,
  shown = null,
  sample,
}: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  const { box, draft, cancel, handlers } = useDragRect({
    layerRef,
    imageRef,
    touch: marking,
    onRect: (rect) => {
      if (marking) onMark(rect);
    },
    // A click on a mark while marking selects it (the last one drawn is on top).
    onTap: (p) => {
      if (!marking) return;
      const hit = [...marks]
        .reverse()
        .find((m) => p.x >= m.rect.x && p.x <= m.rect.x + m.rect.w && p.y >= m.rect.y && p.y <= m.rect.y + m.rect.h);
      if (hit) onSelect?.(hit.id, false);
    },
  });

  // Marking ended (Esc, another slide) maybe in the middle of a drag: drop it, so no box is left half drawn.
  useEffect(() => {
    if (!marking) cancel();
  }, [marking, cancel]);

  useEffect(() => {
    if (!marking) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancelRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [marking]);

  const shownLook = shown ? markLook(sample, shown.rect, shown.kind) : null;
  const looks = marks.map((m) => markLook(sample, m.rect, m.kind));
  // Glowing marks by strength step (lib/slideTone glowStep), strongest first.
  const stepMap = new Map<number, ShownMark[]>();
  marks.forEach((m, i) => {
    if (looks[i].tone !== "dark") return;
    const step = glowStep(looks[i].opacity ?? 1);
    stepMap.set(step, [...(stepMap.get(step) ?? []), m]);
  });
  const glowSteps = [...stepMap].sort((x, y) => y[0] - x[0]);
  const draftLook = draft ? markLook(sample, draft, markingKind) : null;

  const onMarkClick = (id: string) => (e: MouseEvent) => {
    // The second click of a double click would close what the first one opened.
    if (e.detail > 1) return;
    // detail 0: Enter or Space, so the popover takes the focus.
    onSelect?.(id === selectedId ? null : id, e.detail === 0);
  };

  return (
    <div
      ref={layerRef}
      data-highlight-layer=""
      data-marking={marking ? "" : undefined}
      className={`absolute inset-0 select-none rounded-sm ${
        marking ? "outline-2 -outline-offset-2 outline-ink outline-dashed" : "pointer-events-none"
      }`}
      // While marking, a finger drags instead of scrolling the page.
      style={marking ? { touchAction: "none", cursor: "crosshair" } : undefined}
      {...(marking ? handlers : {})}
    >
      {/* The box of the slide itself, so the rects are fractions of the slide and not of the space around it. */}
      <div className="absolute" style={slideBoxStyle(box)}>
        {/* The glows, drawn under the mark buttons in one isolated screen layer per strength step, the
            glows lightening each other inside it: two overlapping glows never add up past one (white text
            under them keeps 4.5:1). The buttons on top stay in mark order (the tab order). */}
        {glowSteps.map(([step, list]) => (
          <div
            key={`glow-${step}`}
            aria-hidden
            data-glow-layer=""
            data-strength={step}
            className="pointer-events-none absolute inset-0 isolate mix-blend-screen"
            style={step < 1 ? { opacity: step } : undefined}
          >
            {list.map((m) => (
              <div
                key={m.id}
                data-glow-box={m.id}
                data-kind={m.kind}
                className={`absolute animate-fade-in rounded-xs mix-blend-lighten ${m.kind === "lost" ? "mark-lost-glow" : "mark-glow"}`}
                style={{ left: pct(m.rect.x), top: pct(m.rect.y), width: pct(m.rect.w), height: pct(m.rect.h) }}
              />
            ))}
          </div>
        ))}
        {marks.map((m, i) => {
          const selected = m.id === selectedId;
          const look = looks[i];
          const tone = look.tone;
          return (
            <button
              key={m.id}
              type="button"
              data-mark={m.id}
              data-highlight-box=""
              data-kind={m.kind}
              data-tone={tone}
              data-selected={selected ? "" : undefined}
              aria-label={markLabel(m, i + 1)}
              aria-haspopup="dialog"
              aria-expanded={selected}
              onClick={onMarkClick(m.id)}
              className={
                // A glowing mark's color is in the glow layer under it; the button itself is see-through.
                `absolute animate-fade-in rounded-xs ${tone === "dark" ? "bg-transparent" : markClass(m.kind, tone)} ` +
                // While marking, the drag goes to the layer under the marks.
                (marking ? "pointer-events-none " : "pointer-events-auto cursor-pointer ") +
                ringClass(look, m.kind, selected)
              }
              style={{ left: pct(m.rect.x), top: pct(m.rect.y), width: pct(m.rect.w), height: pct(m.rect.h) }}
            />
          );
        })}
        {shown && shownLook && (
          <div
            aria-hidden
            data-highlight-box=""
            data-kind={shown.kind}
            data-tone={shownLook.tone}
            className={`pointer-events-none absolute animate-fade-in rounded-xs ${markClass(shown.kind, shownLook.tone)}`}
            style={{ left: pct(shown.rect.x), top: pct(shown.rect.y), width: pct(shown.rect.w), height: pct(shown.rect.h), ...glowStyle(shownLook) }}
          />
        )}
        {draft && draftLook && (
          // The box as it is drawn, in the look it will have.
          <div
            aria-hidden
            data-mark-draft=""
            data-tone={draftLook.tone}
            className={`pointer-events-none absolute rounded-xs opacity-80 ${markClass(markingKind, draftLook.tone)}`}
            style={{ left: pct(draft.x), top: pct(draft.y), width: pct(draft.w), height: pct(draft.h), ...glowStyle(draftLook) }}
          />
        )}
      </div>
      {marking && !draft && (
        <p
          data-mark-hint=""
          className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 animate-pop-in rounded-md bg-ink px-3 py-1.5 type-small-strong whitespace-nowrap text-surface shadow-popover"
        >
          {markingKind === "lost" ? "Drag over the part you lost" : "Drag over the part to keep"}
        </p>
      )}
    </div>
  );
}
