export type MembershipRecoveryAnswer = "confirmed" | "revoked" | "unconfirmed";

/** An advisory notice only; dismissal never settles or deletes a retained command. */
export function createAdminWriteOutcomeNotice() {
  let visible = false;
  const listeners = new Set<() => void>();
  const update = (value: boolean) => { visible = value; for (const listener of listeners) listener(); };
  return { markUnknown: () => update(true), dismiss: () => update(false), getSnapshot: () => visible, getServerSnapshot: () => false,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}

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
  const recoveredListeners = new Set<() => void>();
  let recoveryEpoch = 0;
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
      if (answer === "confirmed") {
        const recovered = unconfirmed;
        unconfirmed = false; delay = 1000;
        if (recovered) recoveryEpoch++;
        notify();
        if (recovered) for (const listener of recoveredListeners) {
          if (startedVersion !== version || unconfirmed || stopped) break;
          listener();
        }
        return true;
      }
      unconfirmed = true; notify(); return false;
    })().finally(() => { checking = undefined; schedule(); });
    return checking;
  }
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  const subscribeRecovered = (listener: () => void) => { recoveredListeners.add(listener); return () => { recoveredListeners.delete(listener); }; };
  return { markUnconfirmed, retry, subscribe, subscribeRecovered, getSnapshot: () => unconfirmed, getServerSnapshot: () => false,
    getRecoveryEpoch: () => recoveryEpoch, getServerRecoveryEpoch: () => 0 };
}
