// A finite per-mounted-loader budget. A healthy membership probe must not
// reset request-specific failures into an endless one-second reload loop.
export const ADMIN_READ_RECOVERY_DELAYS = [0, 1000, 2000, 4000, 8000, 16_000, 30_000] as const;

/** A page-owned READ loader, not an interrupted call or a command callback. */
export function registerAdminReadRecovery(
  recovery: { subscribeRecovered: (listener: () => void) => () => void },
  eligible: () => boolean,
  load: () => Promise<void>,
  clock = { schedule: (job: () => void, delay: number) => setTimeout(job, delay), cancel: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer) },
) {
  let active = true, running = false, attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const release = recovery.subscribeRecovered(() => {
    if (!active || running || !eligible() || attempts >= ADMIN_READ_RECOVERY_DELAYS.length) return;
    const delay = ADMIN_READ_RECOVERY_DELAYS[attempts++];
    running = true;
    const run = () => {
      timer = undefined;
      void Promise.resolve().then(async () => {
        // Eligibility is checked again at execution, not cached across renders.
        if (active && eligible()) await load();
      }).catch(() => { /* A loader owns its error UI; never revive its caller. */ })
        .finally(() => { running = false; });
    };
    if (delay === 0) run(); else timer = clock.schedule(run, delay);
  });
  return () => { active = false; release(); if (timer !== undefined) clock.cancel(timer); };
}
