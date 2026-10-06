export type MembershipRecoveryAnswer = "confirmed" | "revoked" | "unconfirmed";

/**
 * Presentation / read-recovery semaphore, NOT an authorization cache. Clearing
 * the notice never authorizes a request: every server gate checks Core again.
 * This coordinator has no mutation callback or stored request payload.
 */
export function createAdminMembershipRecovery(
  probe: () => Promise<MembershipRecoveryAnswer>,
  redirect: () => void,
  clock = { schedule: (job: () => void, delay: number) => setTimeout(job, delay), cancel: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer) },
) {
  let unconfirmed = false, stopped = false, version = 0, delay = 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let checking: Promise<boolean> | undefined;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  const cancelTimer = () => { if (timer !== undefined) clock.cancel(timer); timer = undefined; };
  const schedule = () => {
    if (!unconfirmed || stopped || timer !== undefined || checking) return;
    timer = clock.schedule(() => { timer = undefined; void retry(); }, delay);
    delay = Math.min(delay * 2, 30_000);
  };
  function markUnconfirmed() {
    version++; unconfirmed = true; notify(); schedule();
  }
  function retry(): Promise<boolean> {
    cancelTimer();
    if (checking) return checking;
    if (stopped) return Promise.resolve(false);
    const startedVersion = version;
    checking = (async () => {
      let answer: MembershipRecoveryAnswer;
      try { answer = await probe(); } catch { answer = "unconfirmed"; }
      // A newer failed check wins over an older recovery answer, even a late
      // revocation. Only a subsequent fresh probe may clear / redirect it.
      if (startedVersion !== version) return false;
      if (answer === "revoked") { stopped = true; unconfirmed = true; notify(); redirect(); return false; }
      if (answer === "confirmed") { unconfirmed = false; delay = 1000; notify(); return true; }
      unconfirmed = true; notify(); return false;
    })().finally(() => { checking = undefined; schedule(); });
    return checking;
  }
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  function waitUntilRecovered(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted || stopped) return Promise.resolve(false);
    if (!unconfirmed) return Promise.resolve(true);
    schedule();
    return new Promise((resolve) => {
      const finish = (value: boolean) => { release(); signal?.removeEventListener("abort", aborted); resolve(value); };
      const aborted = () => finish(false);
      const release = subscribe(() => { if (stopped || !unconfirmed) finish(!stopped); });
      signal?.addEventListener("abort", aborted, { once: true });
    });
  }
  return { markUnconfirmed, retry, subscribe, waitUntilRecovered, getSnapshot: () => unconfirmed, getServerSnapshot: () => false };
}
