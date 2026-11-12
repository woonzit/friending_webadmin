import {
  DATES_EXTERNAL_RECHECK_OPEN, datesExternalRechecks, decodeDatesExternalDetail, type DatesExternalDetail, type DatesExternalRecheck,
  type DatesExternalRows,
} from "@/lib/datesExternalAdmin";

/** What one status read of the event detail found; null: the read failed or its body could not be decoded. */
export interface DatesExternalRecheckStatus {
  detail: DatesExternalDetail;
  jobs: DatesExternalRows<DatesExternalRecheck> | null;
  /** A job of the event is queued or running. */
  open: boolean;
}

export function datesExternalRecheckStatus(response: unknown, externalId: string): DatesExternalRecheckStatus | null {
  const detail = decodeDatesExternalDetail(response, externalId);
  if (!detail) return null;
  const jobs = datesExternalRechecks(detail.event, detail.server_now);
  return { detail, jobs, open: jobs?.rows.some((job) => DATES_EXTERNAL_RECHECK_OPEN.includes(job.status)) ?? false };
}

/**
 * One read of an open re-research job's status (D-149 W2). It resolves to whether the poll should go on: `false` once
 * the job is known to be finished (no job queued or running), `true` while it is still open AND when the read failed or
 * its body could not be decoded - then nothing is known, and the next read retries. A read that throws counts as failed.
 */
type DatesExternalRecheckPollRead = (signal: AbortSignal) => Promise<boolean>;

/** The two timer functions the poll uses: the browser's by default, a fake clock's in a test. */
export interface DatesExternalRecheckPollTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const globalTimers: DatesExternalRecheckPollTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as Parameters<typeof globalThis.clearTimeout>[0]),
};

/**
 * Reads an open re-research job every `intervalMs` until it is finished (Codex review 2026-11-02, F4). The next read is
 * scheduled when the previous one has settled, whatever it answered, so one failed or undecodable read no longer ends
 * the polling. There is one timer or one read at a time, never both and never two. The returned function stops the
 * poll (the job is no longer open on the page, or the page is unmounted): it clears the timer, aborts a read in flight,
 * and nothing is scheduled after it.
 */
export function pollDatesExternalRecheck(read: DatesExternalRecheckPollRead, intervalMs: number,
  timers: DatesExternalRecheckPollTimers = globalTimers): () => void {
  const controller = new AbortController();
  let timer: unknown = null;
  const schedule = () => { timer = timers.setTimeout(() => void tick(), intervalMs); };
  async function tick() {
    timer = null;
    let goOn = true;
    try { goOn = await read(controller.signal); } catch { goOn = true; }
    if (goOn && !controller.signal.aborted) schedule();
  }
  schedule();
  return () => {
    controller.abort();
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
}
