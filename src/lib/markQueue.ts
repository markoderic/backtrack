import type { MarkKind } from "./marksApi";
import { isRect, type Rect } from "./rect";
import { THROTTLED_TRIES, throttledDelay } from "./tapQueue";

/** A mark made on the live screen, as it waits to be sent (slide_marks, migration 0020). */
export type QueuedMark = { id: string; slide: number; rect: Rect; kind: MarkKind; note?: string };

/**
 * One change to the student's marks: add one, set its note (empty takes it off), delete one, or
 * set the kind of every mark on a slide (red when the student is lost there, yellow when not).
 */
export type MarkOp =
  | { op: "add"; mark: QueuedMark }
  | { op: "note"; id: string; note: string }
  | { op: "delete"; id: string }
  | { op: "kind"; slide: number; kind: MarkKind };

/**
 * What the database said: ok, offline (try again later), rejected (it said no), throttled (401 or
 * 429: tried again after a wait, dropped after a few tries), missing (no slide_marks yet: 0020 has
 * not run), or one of the two mark limits (30 on a slide, 300 in a lecture).
 */
export type MarkSendResult = "ok" | "offline" | "rejected" | "throttled" | "missing" | "slide_full" | "lecture_full";

/** refused: the ops that were dropped, with why. retryIn: flush again after this many ms (a throttled op is waiting). */
export type MarkFlushResult = { sent: MarkOp[]; refused: { op: MarkOp; result: MarkSendResult }[]; retryIn?: number };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isKind = (v: unknown): v is MarkKind => v === "lost" || v === "save";

function isMarkOp(v: unknown): v is MarkOp {
  if (!isRecord(v)) return false;
  switch (v.op) {
    case "add": {
      const m = v.mark;
      return (
        isRecord(m) &&
        typeof m.id === "string" &&
        typeof m.slide === "number" &&
        isRect(m.rect) &&
        isKind(m.kind) &&
        (m.note === undefined || typeof m.note === "string")
      );
    }
    case "note":
      return typeof v.id === "string" && typeof v.note === "string";
    case "delete":
      return typeof v.id === "string";
    case "kind":
      return typeof v.slide === "number" && isKind(v.kind);
    default:
      return false;
  }
}

/** The ops kept under the queue's key (anything unreadable is left out). */
function parseOps(raw: string | null): MarkOp[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isMarkOp) : [];
  } catch {
    return [];
  }
}

/** The id a mark op is about (a kind op is about a slide, not one mark). */
const idOf = (op: MarkOp): string | null => (op.op === "add" ? op.mark.id : op.op === "kind" ? null : op.id);

/**
 * The student's mark changes that have not reached the database yet, in the order they were made,
 * kept in memory and in localStorage under `backtrack:marks:<lectureId>` (so a mark made offline
 * survives a reload). Works like the tap queue: sent one at a time, in order; offline stops a
 * flush; a throttled op waits and is tried again, THROTTLED_TRIES times in all. A note typed in
 * bursts is one op (the last text wins), and a mark deleted before it was sent is simply taken out.
 *
 * Another page can send or change the same ops (My spots sends what the live screen left; Next keeps
 * the live screen alive, hidden, meanwhile). So before it reads or changes its ops, the queue takes
 * what localStorage holds when that differs from what it last wrote there: it never sends an op again
 * that the other page already sent (a mark deleted in My spots must not come back).
 */
export class MarkQueue {
  private readonly key: string;
  private ops: MarkOp[];
  private inFlight: MarkOp | null = null;
  private running: Promise<MarkFlushResult> | null = null;
  private throttled = new WeakMap<MarkOp, { tries: number; notBefore: number }>();
  /** What this queue last wrote to (or read from) localStorage; null once storage failed (then memory only). */
  private written: string | null = null;

  constructor(lectureId: string) {
    this.key = `backtrack:marks:${lectureId}`;
    this.ops = this.load();
  }

  pending(): MarkOp[] {
    this.sync();
    return [...this.ops];
  }

  add(mark: QueuedMark): void {
    this.sync();
    this.ops.push({ op: "add", mark });
    this.save();
  }

  /** The note on a mark. A newer text replaces one still waiting, or goes into the mark's own add. */
  note(id: string, note: string): void {
    this.sync();
    const add = this.ops.find((o) => o.op === "add" && o.mark.id === id);
    if (add && add !== this.inFlight && add.op === "add") {
      add.mark = { ...add.mark, note };
      if (note.trim() === "") delete add.mark.note;
    } else {
      this.ops = this.ops.filter((o) => o === this.inFlight || !(o.op === "note" && o.id === id));
      this.ops.push({ op: "note", id, note });
    }
    this.save();
  }

  /** Deletes a mark. One that was never sent is just taken out, with everything queued for it. */
  delete(id: string): void {
    this.sync();
    const add = this.ops.find((o) => o.op === "add" && o.mark.id === id);
    if (add && add !== this.inFlight) {
      this.ops = this.ops.filter((o) => idOf(o) !== id);
    } else {
      this.ops = this.ops.filter((o) => o === this.inFlight || !(o.op === "note" && o.id === id));
      this.ops.push({ op: "delete", id });
    }
    this.save();
  }

  /** Every mark on a slide becomes this kind: the ones still waiting at once, the sent ones by one update. */
  kind(slide: number, kind: MarkKind): void {
    this.sync();
    this.ops = this.ops
      .filter((o) => o === this.inFlight || !(o.op === "kind" && o.slide === slide))
      .map((o) => (o.op === "add" && o !== this.inFlight && o.mark.slide === slide ? { op: "add", mark: { ...o.mark, kind } } : o));
    this.ops.push({ op: "kind", slide, kind });
    this.save();
  }

  flush(send: (op: MarkOp) => Promise<MarkSendResult>): Promise<MarkFlushResult> {
    if (this.running) return this.running;
    this.sync();
    this.running = this.run(send);
    return this.running;
  }

  private async run(send: (op: MarkOp) => Promise<MarkSendResult>): Promise<MarkFlushResult> {
    await Promise.resolve();
    const sent: MarkOp[] = [];
    const refused: MarkFlushResult["refused"] = [];
    let retryIn: number | undefined;
    try {
      for (;;) {
        const op = this.ops[0];
        if (!op) break;
        const wait = this.throttled.get(op);
        if (wait && wait.notBefore > Date.now()) {
          retryIn = wait.notBefore - Date.now();
          break;
        }
        this.inFlight = op;
        let result: MarkSendResult;
        try {
          result = await send(op);
        } finally {
          this.inFlight = null;
        }
        if (result === "offline") break;
        if (result === "throttled") {
          const tries = (wait?.tries ?? 0) + 1;
          if (tries < THROTTLED_TRIES) {
            retryIn = throttledDelay(tries);
            this.throttled.set(op, { tries, notBefore: Date.now() + retryIn });
            break;
          }
          this.throttled.delete(op);
        }
        // The op may have been replaced while it was out (a note typed meanwhile is a new op).
        this.ops = this.ops.filter((o) => o !== op);
        if (result === "ok") {
          sent.push(op);
        } else {
          refused.push({ op, result });
          // A mark that never got in has nothing for its later ops to change.
          if (op.op === "add") this.ops = this.ops.filter((o) => idOf(o) !== op.mark.id);
        }
        this.save();
      }
    } finally {
      this.inFlight = null;
      this.running = null;
    }
    return { sent, refused, ...(retryIn !== undefined ? { retryIn } : {}) };
  }

  private load(): MarkOp[] {
    try {
      const raw = window.localStorage.getItem(this.key);
      this.written = raw ?? "";
      return parseOps(raw);
    } catch {
      this.written = null;
      return [];
    }
  }

  /**
   * Takes what localStorage holds when another page changed it since this queue last wrote it (never
   * while a flush runs: the op in flight is this queue's own). With storage blocked, memory only.
   */
  private sync(): void {
    if (this.running || this.written === null) return;
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(this.key);
    } catch {
      return;
    }
    if ((raw ?? "") === this.written) return;
    this.ops = parseOps(raw);
    this.written = raw ?? "";
  }

  private save(): void {
    try {
      if (this.ops.length === 0) {
        window.localStorage.removeItem(this.key);
        this.written = "";
      } else {
        const raw = JSON.stringify(this.ops);
        window.localStorage.setItem(this.key, raw);
        this.written = raw;
      }
    } catch {
      // Storage is blocked or full. The queue still works in memory (and stops looking at storage).
      this.written = null;
    }
  }
}

/** A mark as the live screen shows it. */
export type LiveMark = QueuedMark;

/** The marks with one op applied (what the database will hold once it is sent). */
export function applyMarkOp(marks: Map<string, LiveMark>, op: MarkOp): void {
  switch (op.op) {
    case "add":
      if (!marks.has(op.mark.id)) marks.set(op.mark.id, { ...op.mark });
      return;
    case "note": {
      const m = marks.get(op.id);
      if (!m) return;
      const next = { ...m };
      if (op.note.trim() === "") delete next.note;
      else next.note = op.note;
      marks.set(op.id, next);
      return;
    }
    case "delete":
      marks.delete(op.id);
      return;
    case "kind":
      for (const [id, m] of marks) if (m.slide === op.slide && m.kind !== op.kind) marks.set(id, { ...m, kind: op.kind });
      return;
  }
}
