import test from "node:test";
import assert from "node:assert/strict";
import { createAdminMembershipRecovery, type MembershipRecoveryAnswer } from "../lib/adminMembershipRecovery.ts";
import { membershipClock } from "./support/adminMembershipClock.mts";

test("DERIVED recovery: only membership is probed, with one bounded exponential backoff and no mutation payload", async () => {
  const time = membershipClock(); let probes = 0;
  const recovery = createAdminMembershipRecovery(async () => { probes++; return "unconfirmed"; }, () => assert.fail("no redirect for an unconfirmed answer"), time.clock);
  recovery.markUnconfirmed(); recovery.markUnconfirmed(); assert.equal(time.jobs.size, 1);
  for (const expected of [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]) {
    assert.equal([...time.jobs.values()][0].delay, expected); await time.tick(); assert.equal(recovery.getSnapshot(), true);
  }
  assert.equal(probes, 7); assert.equal(time.jobs.size, 1);
});
test("DERIVED recovery: concurrent operator retries share one probe; a positive answer only clears the presentation semaphore", async () => {
  const time = membershipClock(); let resolve!: (answer: MembershipRecoveryAnswer) => void, probes = 0;
  const recovery = createAdminMembershipRecovery(() => { probes++; return new Promise((done) => { resolve = done; }); }, () => assert.fail(), time.clock);
  recovery.markUnconfirmed(); const first = recovery.retry(), second = recovery.retry(); assert.equal(first, second); assert.equal(probes, 1);
  const waiting = recovery.waitUntilRecovered(); resolve("confirmed"); assert.equal(await first, true); assert.equal(await waiting, true);
  assert.equal(recovery.getSnapshot(), false); assert.equal(time.jobs.size, 0);
  const fresh = recovery.retry(); assert.equal(probes, 2); resolve("confirmed"); await fresh;
});
test("DERIVED recovery: a newer failure makes a late positive or negative recovery answer inert", async () => {
  for (const late of ["confirmed", "revoked"] as const) {
    const time = membershipClock(); let resolve!: (answer: MembershipRecoveryAnswer) => void;
    const recovery = createAdminMembershipRecovery(() => new Promise((done) => { resolve = done; }), () => assert.fail("stale answer cannot redirect"), time.clock);
    recovery.markUnconfirmed(); const pending = recovery.retry(); recovery.markUnconfirmed(); resolve(late);
    assert.equal(await pending, false); assert.equal(recovery.getSnapshot(), true); assert.equal(time.jobs.size, 1);
  }
});
test("DERIVED recovery: a definite current revocation redirects once and stops background reads", async () => {
  const time = membershipClock(); let redirects = 0, probes = 0;
  const recovery = createAdminMembershipRecovery(async () => { probes++; return "revoked"; }, () => { redirects++; }, time.clock);
  recovery.markUnconfirmed(); const waiting = recovery.waitUntilRecovered(); await time.tick();
  assert.equal(await waiting, false); assert.equal(redirects, 1); assert.equal(time.jobs.size, 0);
  assert.equal(await recovery.retry(), false); assert.equal(probes, 1);
});
test("DERIVED recovery: cancelling one read waiter does not clear the outage notice or release another waiter", async () => {
  const time = membershipClock(), controller = new AbortController();
  const recovery = createAdminMembershipRecovery(async () => "confirmed", () => assert.fail(), time.clock);
  recovery.markUnconfirmed(); const canceled = recovery.waitUntilRecovered(controller.signal), active = recovery.waitUntilRecovered();
  controller.abort(); assert.equal(await canceled, false); assert.equal(recovery.getSnapshot(), true);
  await time.tick(); assert.equal(await active, true);
});
test("DERIVED recovery: an exception stays unconfirmed; server snapshot is never a client authorization grant", async () => {
  const time = membershipClock();
  const recovery = createAdminMembershipRecovery(async () => { throw new Error("DERIVED outage"); }, () => assert.fail(), time.clock);
  recovery.markUnconfirmed(); await time.tick(); assert.equal(recovery.getSnapshot(), true); assert.equal(recovery.getServerSnapshot(), false);
});
