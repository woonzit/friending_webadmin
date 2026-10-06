import assert from "node:assert/strict";

// DERIVED timer/event-loop control, not browser wall-clock measurement.
export function membershipClock() {
  let id = 0;
  const jobs = new Map<number, { job: () => void; delay: number }>();
  return {
    jobs,
    clock: { schedule: (job: () => void, delay: number) => { jobs.set(++id, { job, delay }); return id as unknown as ReturnType<typeof setTimeout>; },
      cancel: (timer: ReturnType<typeof setTimeout>) => { jobs.delete(timer as unknown as number); } },
    tick: async () => { const next = jobs.entries().next().value; assert.ok(next); jobs.delete(next[0]); next[1].job(); await new Promise<void>((resolve) => setImmediate(resolve)); },
  };
}
