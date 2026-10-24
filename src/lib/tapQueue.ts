import { isRect, type Rect } from "./rect";

/**
 * What the patch of a queued update can change. A rect is stored as the four hl_ columns;
 * rect null clears them (Clear mark). An empty note takes the note away.
 */
export type TapPatch = { undone?: boolean; note?: string; rect?: Rect | null };

export type PendingTap = {
  /** A uuid made in the browser, so a resend can be ignored by the database. */
  id: string;
  tappedOnSlide: number;
  tappedAt: string;
  note?: string;
  /** Missing means 'lost', so a tap already in someone's localStorage still loads. */
  kind?: "lost" | "save";
  /** A highlight on the slide, as fractions of it. */
  rect?: Rect;
};

export type QueueOp =
  | { op: "insert"; tap: PendingTap }
  | {
      op: "update";
      id: string;
      patch: TapPatch;
      /**
       * Undo of Removed only: which slide and kind the row is, so a page loaded while the update still
       * waits can show the spot again even when it can not read the row. Never sent to the database.
       */
      spot?: { slide: number; kind: "lost" | "save"; note?: string };
    };

/**
 * ok: saved. offline: try again later. rejected: the database said no, retrying will not
 * help. limited: the database said no because this student made too many taps in a minute
 * (the 0012 limit); capped: the same for 300 taps in the lecture. The queue drops both like a
 * rejection, and the page says why. throttled: the server turned it away for now (401, the
 * login is gone or expired, or 429, too many requests). A later try may work, so the queue
 * tries it again after a wait, THROTTLED_TRIES times in all, then drops it (gaveUp) so it
 * can't hold up the taps behind it forever.
 */
export type SendResult = "ok" | "rejected" | "offline" | "limited" | "capped" | "throttled";

/** How many throttled answers an op gets before the queue drops it. */
export const THROTTLED_TRIES = 4;

/** The wait before trying a throttled op again: 2, 4 then 8 seconds (at most 30). */
export const throttledDelay = (tries: number) => Math.min(30_000, 2_000 * 2 ** (tries - 1));

/**
 * sent: how many went through. rejected: what the database refused (removed from the queue).
 * gaveUp: what was throttled THROTTLED_TRIES times and dropped. retryIn: set when the run
 * stopped at a throttled op; flush again after this many milliseconds.
 */
export type FlushResult = { sent: number; rejected: QueueOp[]; gaveUp?: QueueOp[]; retryIn?: number };

/** A refusal for the 0012 tap limit, not because the lecture ended. */
export const isTapLimit = (r: SendResult): r is "limited" | "capped" => r === "limited" || r === "capped";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function isOp(v: unknown): v is QueueOp {
  if (!isRecord(v)) return false;
  if (v.op === "insert") {
    const tap = v.tap;
    return (
      isRecord(tap) &&
      typeof tap.id === "string" &&
      typeof tap.tappedOnSlide === "number" &&
      typeof tap.tappedAt === "string" &&
      (tap.note === undefined || typeof tap.note === "string") &&
      (tap.kind === undefined || tap.kind === "lost" || tap.kind === "save") &&
      (tap.rect === undefined || isRect(tap.rect))
    );
  }
  if (v.op === "update") {
    const spot = v.spot;
    return (
      typeof v.id === "string" &&
      isRecord(v.patch) &&
      (v.patch.rect === undefined || v.patch.rect === null || isRect(v.patch.rect)) &&
      (spot === undefined ||
        (isRecord(spot) && typeof spot.slide === "number" && (spot.kind === "lost" || spot.kind === "save")))
    );
  }
  return false;
}

/**
 * The taps and changes that have not reached the database yet, in the order they
 * were made. They are kept in memory and copied to localStorage under
 * `backtrack:queue:<lectureId>`, so a tap made offline survives a reload. Every
 * storage call can fail (private windows, full disks); the queue then goes on in
 * memory only.
 */
export class TapQueue {
  private readonly key: string;
  private ops: QueueOp[];
  /** The insert being sent right now. It can no longer be cancelled. */
  private inFlight: QueueOp | null = null;
  private running: Promise<FlushResult> | null = null;
  /** Throttled ops: how many times, and not to be sent again before this time (ms). In memory only. */
  private throttled = new WeakMap<QueueOp, { tries: number; notBefore: number }>();

  constructor(lectureId: string) {
    this.key = `backtrack:queue:${lectureId}`;
    this.ops = this.load();
  }

  enqueue(tap: PendingTap): void {
    this.ops.push({ op: "insert", tap });
    this.save();
  }

  update(id: string, patch: TapPatch, spot?: { slide: number; kind: "lost" | "save"; note?: string }): void {
    this.ops.push(spot ? { op: "update", id, patch, spot } : { op: "update", id, patch });
    this.save();
  }

  /**
   * Takes back a tap that has not been sent: removes its insert and any queued
   * updates for it, and returns true. Returns false when the insert was already
   * sent (or is being sent now); the caller then queues an update with undone.
   */
  cancel(id: string): boolean {
    const insert = this.ops.find((o) => o.op === "insert" && o.tap.id === id);
    if (!insert || insert === this.inFlight) return false;
    this.ops = this.ops.filter((o) => (o.op === "insert" ? o.tap.id !== id : o.id !== id));
    this.save();
    return true;
  }

  pending(): QueueOp[] {
    return [...this.ops];
  }

  /**
   * Sends the queued ops one at a time, in order. An op that sends ok is removed.
   * A rejected op is removed and returned (with its insert's queued updates
   * dropped, as they have nothing to change). The first offline stops the flush
   * and leaves everything from that op on queued. A throttled op also stops the flush,
   * and is not sent again until its wait is over (retryIn says how long); after
   * THROTTLED_TRIES it is dropped like a rejection and returned in gaveUp, and the flush
   * goes on to the ops behind it. Ops queued while it runs are sent in the same run.
   * Two flushes at once share one run.
   */
  flush(send: (op: QueueOp) => Promise<SendResult>): Promise<FlushResult> {
    if (this.running) return this.running;
    this.running = this.run(send);
    return this.running;
  }

  private async run(send: (op: QueueOp) => Promise<SendResult>): Promise<FlushResult> {
    // Lets flush() record this run before the loop can finish. The loop's last look at
    // the queue and `running = null` below happen in the same tick, so an op queued
    // at any moment is either seen by the loop or starts a new run.
    await Promise.resolve();
    let sent = 0;
    const rejected: QueueOp[] = [];
    const gaveUp: QueueOp[] = [];
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
        const result = await send(op);
        this.inFlight = null;
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
        this.ops = this.ops.filter((o) => o !== op);
        if (result === "ok") {
          sent++;
        } else {
          (result === "throttled" ? gaveUp : rejected).push(op);
          if (op.op === "insert") {
            const id = op.tap.id;
            this.ops = this.ops.filter((o) => o.op === "insert" || o.id !== id);
          }
        }
        this.save();
      }
    } finally {
      this.inFlight = null;
      this.running = null;
    }
    return {
      sent,
      rejected,
      ...(gaveUp.length > 0 ? { gaveUp } : {}),
      ...(retryIn !== undefined ? { retryIn } : {}),
    };
  }

  private load(): QueueOp[] {
    try {
      const raw = window.localStorage.getItem(this.key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isOp) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      window.localStorage.setItem(this.key, JSON.stringify(this.ops));
    } catch {
      // Storage is blocked or full. The queue still works in memory.
    }
  }
}
