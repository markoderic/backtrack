/** How long after the last join event the count is read again from the database. */
export const SETTLE_MS = 800;
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 10000;

/** Marks when a read of the count started. See JoinedCounter.begin. */
export type ReadMark = { events: number; seq: number };

export type JoinedCounter = {
  /** Call when a read of the count starts; pass the mark to settle with its result. */
  begin(): ReadMark;
  /**
   * Shows a count that a read brought back, unless it may be older than what is on
   * screen: a join event arrived while it ran (a recount already follows that event),
   * or a read that started later already settled.
   */
  settle(count: number, mark: ReadMark): void;
  /** Reads the count now. A failed read keeps the number and retries after 1, 2, 4 s, up to 10. */
  recount(): Promise<void>;
  /** A join event: shows one more at once, then reads the exact count once joins stop for a moment. */
  joined(): void;
  /** Stops every timer; nothing is shown after this. */
  stop(): void;
};

/**
 * The joined count, kept exact. Join events add one at once so the number moves
 * live, but an event can be for a student the last read already counted (the read
 * and the event race), so the number is read again from the database shortly after
 * the events stop and that read wins. participants has one row per student per
 * lecture, so the database count is the distinct number of students.
 */
export function createJoinedCounter(
  read: () => Promise<number>,
  show: (count: number) => void,
): JoinedCounter {
  let shown: number | null = null;
  let events = 0;
  let started = 0;
  let settled = 0;
  let failures = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const put = (n: number) => {
    shown = n;
    show(n);
  };

  const counter: JoinedCounter = {
    begin: () => ({ events, seq: ++started }),
    settle(count, mark) {
      if (stopped || mark.events !== events || mark.seq < settled) return;
      settled = mark.seq;
      put(count);
    },
    async recount() {
      clearTimeout(timer);
      timer = undefined;
      const mark = counter.begin();
      try {
        const n = await read();
        if (stopped) return;
        failures = 0;
        counter.settle(n, mark);
      } catch {
        if (stopped) return;
        // Keep the last count and try again.
        clearTimeout(timer);
        timer = setTimeout(() => void counter.recount(), Math.min(RETRY_FIRST_MS * 2 ** failures, RETRY_MAX_MS));
        failures++;
      }
    },
    joined() {
      if (stopped) return;
      events++;
      put((shown ?? 0) + 1);
      clearTimeout(timer);
      failures = 0;
      timer = setTimeout(() => void counter.recount(), SETTLE_MS);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
  return counter;
}
