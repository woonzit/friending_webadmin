/** A page-owned READ loader, not an interrupted call or a command callback. */
export function registerAdminReadRecovery(
  recovery: { subscribeRecovered: (listener: () => void) => () => void },
  eligible: () => boolean,
  load: () => Promise<void>,
) {
  let active = true, running = false;
  const release = recovery.subscribeRecovered(() => {
    if (!active || running || !eligible()) return;
    running = true;
    void Promise.resolve().then(async () => {
      // Eligibility is checked again at execution, not cached across renders.
      if (active && eligible()) await load();
    }).catch(() => { /* A loader owns its error UI; never revive its caller. */ })
      .finally(() => { running = false; });
  });
  return () => { active = false; release(); };
}
