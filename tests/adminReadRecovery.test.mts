import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN_READ_RECOVERY_DELAYS, registerAdminReadRecovery } from "../lib/adminReadRecovery.ts";
import { membershipClock } from "./support/adminMembershipClock.mts";

// DERIVED timer/loader control, not browser elapsed-time evidence.
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function events() {
  let listener: (() => void) | undefined;
  return { subscribeRecovered: (value: () => void) => { listener = value; return () => { listener = undefined; }; }, emit: () => listener?.() };
}
test("DERIVED read-loader recovery: increasing capped delays and a finite budget survive healthy membership events", async () => {
  const time = membershipClock(), source = events(); let loads = 0;
  const release = registerAdminReadRecovery(source, () => true, async () => { loads++; throw new Error("DERIVED request-specific connection failure"); }, time.clock);
  assert.deepEqual(ADMIN_READ_RECOVERY_DELAYS, [0, 1000, 2000, 4000, 8000, 16_000, 30_000]);
  for (const delay of ADMIN_READ_RECOVERY_DELAYS) {
    source.emit();
    if (delay === 0) await flush();
    else { assert.equal(time.jobs.size, 1); assert.equal([...time.jobs.values()][0].delay, delay); source.emit(); assert.equal(time.jobs.size, 1); await time.tick(); }
  }
  assert.equal(loads, 7);
  for (let index = 0; index < 20; index++) source.emit();
  await flush(); assert.equal(loads, 7); assert.equal(time.jobs.size, 0); release();
});
test("DERIVED read-loader recovery: unmount cancels a pending attempt and successful/draft eligibility is checked again", async () => {
  for (const unmount of [false, true]) {
    const time = membershipClock(), source = events(); let eligible = true, loads = 0;
    const release = registerAdminReadRecovery(source, () => eligible, async () => { loads++; }, time.clock);
    source.emit(); await flush(); assert.equal(loads, 1);
    source.emit(); assert.equal(time.jobs.size, 1);
    if (unmount) { release(); assert.equal(time.jobs.size, 0); }
    else { eligible = false; await time.tick(); assert.equal(loads, 1); release(); }
    source.emit(); await flush(); assert.equal(loads, 1);
  }
});
test("DERIVED read-loader recovery: repeated events cannot overlap an in-flight load", async () => {
  const source = events(); let done!: () => void, loads = 0;
  const release = registerAdminReadRecovery(source, () => true, () => { loads++; return new Promise<void>((resolve) => { done = resolve; }); });
  source.emit(); await flush(); for (let index = 0; index < 20; index++) source.emit();
  assert.equal(loads, 1); done(); await flush(); release();
});
