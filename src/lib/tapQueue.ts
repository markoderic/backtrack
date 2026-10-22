export type PendingTap = {
  /** A uuid made in the browser, so a resend can be ignored by the database. */
  id: string;
  tappedOnSlide: number;
  tappedAt: string;
  note?: string;
};

export type QueueOp =
  | { op: "insert"; tap: PendingTap }
  | { op: "update"; id: string; patch: { undone?: boolean; note?: string } };

export type SendResult = "ok" | "rejected" | "offline";

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
      (tap.note === undefined || typeof tap.note === "string")
    );
  }
  if (v.op === "update") {
    return typeof v.id === "string" && isRecord(v.patch);
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
  private running: Promise<{ sent: number; rejected: QueueOp[] }> | null = null;

  constructor(lectureId: string) {
    this.key = `backtrack:queue:${lectureId}`;
    this.ops = this.load();
  }

  enqueue(tap: PendingTap): void {
    this.ops.push({ op: "insert", tap });
    this.save();
  }

  update(id: string, patch: { undone?: boolean; note?: string }): void {
    this.ops.push({ op: "update", id, patch });
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
   * and leaves everything from that op on queued. Ops queued while it runs are
   * sent in the same run. Two flushes at once share one run.
   */
  flush(send: (op: QueueOp) => Promise<SendResult>): Promise<{ sent: number; rejected: QueueOp[] }> {
    if (this.running) return this.running;
    this.running = this.run(send);
    return this.running;
  }

  private async run(send: (op: QueueOp) => Promise<SendResult>): Promise<{ sent: number; rejected: QueueOp[] }> {
    // Lets flush() record this run before the loop can finish. The loop's last look at
    // the queue and `running = null` below happen in the same tick, so an op queued
    // at any moment is either seen by the loop or starts a new run.
    await Promise.resolve();
    let sent = 0;
    const rejected: QueueOp[] = [];
    try {
      for (;;) {
        const op = this.ops[0];
        if (!op) break;
        this.inFlight = op;
        const result = await send(op);
        this.inFlight = null;
        if (result === "offline") break;
        this.ops = this.ops.filter((o) => o !== op);
        if (result === "ok") {
          sent++;
        } else {
          rejected.push(op);
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
    return { sent, rejected };
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
