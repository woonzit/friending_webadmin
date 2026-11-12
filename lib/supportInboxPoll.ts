/**
 * When the support inbox reads Core again (audit finding 4 and D2).
 *
 * The inbox used to read the thread list every 5 s and the open conversation every
 * 3 s with `setInterval`, for as long as the page was mounted: in a hidden tab, while
 * it showed its error panel, and with no guard against a read still in flight, so an
 * older thread list could land after a newer one.
 *
 * Now each stream is one poll:
 * - one timer or one read at a time: the next read is scheduled only after the
 *   previous one settled, whatever it answered (a read that throws counts as failed);
 * - the first read happens at once, as before;
 * - the base cadence is the old interval; after `SUPPORT_POLL_QUIET_READS` reads in a
 *   row that changed nothing it slows to `SUPPORT_POLL_SLOW_MS`, and after
 *   `SUPPORT_POLL_SLOW_READS` more to `SUPPORT_POLL_IDLE_MS`; failed reads wait 15 s,
 *   30 s, then 60 s;
 * - a read that changed something, and `reset()` (an explicit load: Retry, a send),
 *   put it back to the base cadence;
 * - while the tab is hidden nothing is read; on return it reads at once and starts
 *   again from the base cadence.
 */

export type SupportPollOutcome = "changed" | "unchanged" | "failed";

export const SUPPORT_THREAD_POLL_MS = 5_000;
export const SUPPORT_MESSAGE_POLL_MS = 3_000;
export const SUPPORT_POLL_QUIET_READS = 4;
export const SUPPORT_POLL_SLOW_READS = 8;
export const SUPPORT_POLL_SLOW_MS = 15_000;
export const SUPPORT_POLL_IDLE_MS = 30_000;
const SUPPORT_POLL_FAILURE_MS = [15_000, 30_000, 60_000];

/** The wait before the next read, after `quiet` reads that changed nothing and `failures` failed reads in a row. */
export function supportPollDelay(baseMs: number, quiet: number, failures: number): number {
  if (failures > 0) return SUPPORT_POLL_FAILURE_MS[Math.min(failures, SUPPORT_POLL_FAILURE_MS.length) - 1];
  if (quiet < SUPPORT_POLL_QUIET_READS) return baseMs;
  if (quiet < SUPPORT_POLL_QUIET_READS + SUPPORT_POLL_SLOW_READS) return Math.max(baseMs, SUPPORT_POLL_SLOW_MS);
  return Math.max(baseMs, SUPPORT_POLL_IDLE_MS);
}

/** The two timer functions the poll uses: the browser's by default, a fake clock's in a test. */
export interface SupportPollTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Whether the page is hidden, and a way to hear when that changes. */
export interface SupportPollVisibility {
  hidden(): boolean;
  subscribe(listener: () => void): () => void;
}

const globalTimers: SupportPollTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as Parameters<typeof globalThis.clearTimeout>[0]),
};

function documentVisibility(): SupportPollVisibility {
  if (typeof document === "undefined") return { hidden: () => false, subscribe: () => () => {} };
  return {
    hidden: () => document.visibilityState === "hidden",
    subscribe: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  };
}

export interface SupportPoll {
  /** Back to the base cadence: the next read comes `baseMs` after now (or after the read in flight). */
  reset(): void;
  /** No read is started or scheduled after this; a read in flight finishes unheard. */
  stop(): void;
}

export function startSupportPoll(
  read: () => Promise<SupportPollOutcome>,
  baseMs: number,
  options: { timers?: SupportPollTimers; visibility?: SupportPollVisibility } = {},
): SupportPoll {
  const timers = options.timers ?? globalTimers;
  const visibility = options.visibility ?? documentVisibility();
  let quiet = 0, failures = 0, timer: unknown = null, reading = false, stopped = false;

  const clear = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    clear();
    if (stopped || reading || visibility.hidden()) return;
    timer = timers.setTimeout(() => {
      timer = null;
      void tick();
    }, supportPollDelay(baseMs, quiet, failures));
  };
  async function tick() {
    if (stopped || reading) return;
    reading = true;
    let outcome: SupportPollOutcome;
    try { outcome = await read(); } catch { outcome = "failed"; }
    reading = false;
    if (outcome === "changed") quiet = failures = 0;
    else if (outcome === "failed") failures += 1;
    else { failures = 0; quiet += 1; }
    schedule();
  }
  const unsubscribe = visibility.subscribe(() => {
    if (stopped) return;
    if (visibility.hidden()) {
      clear();
      return;
    }
    quiet = failures = 0;
    if (!reading) {
      clear();
      void tick();
    }
  });
  // The first read is the page's first load: at once, hidden tab or not.
  void tick();

  return {
    reset() {
      if (stopped) return;
      quiet = failures = 0;
      if (timer !== null) schedule();
    },
    stop() {
      stopped = true;
      clear();
      unsubscribe();
    },
  };
}

/**
 * D2: of reads that may overlap (a poll read and an explicit load), only the answer
 * of the one started last may be used. `begin()` marks a read as started and returns
 * the check to make once its answer arrives.
 */
export function latestReadGuard(): { begin(): () => boolean } {
  let latest = 0;
  return {
    begin() {
      const mine = ++latest;
      return () => mine === latest;
    },
  };
}
