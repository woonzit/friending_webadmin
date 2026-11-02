import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  datesExternalRecheckStatus, pollDatesExternalRecheck, type DatesExternalRecheckPollTimers,
} from "../lib/datesExternalRecheckPoll.ts";

// Codex review 2026-11-02, F4: one failed status read used to end the automatic polling of an open re-research job,
// because the next read was scheduled only by a successful change of `jobs`. The poll loop now schedules its own next
// read. Fake timers (node:test mock.timers) and Core-B's genuine detail bodies (tests/fixtures/dates_external_review_wire).
const genuine = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/dates_external_review_wire/${name}.json`, import.meta.url), "utf8"));
const XEV6 = "xev_00000000000000000000000000000006";
/** Lets the awaited read and the loop's continuation run (setImmediate is not faked). */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** The panel's read: the same decode, the job's status as the panel would show it, and whether to go on. */
function panelRead(answers: unknown[], seen: string[], counts = { calls: 0, inFlight: 0, maxInFlight: 0 }) {
  return Object.assign(async (signal: AbortSignal) => {
    counts.calls++; counts.inFlight++; counts.maxInFlight = Math.max(counts.maxInFlight, counts.inFlight);
    try {
      const next = answers.shift();
      if (next instanceof Error) throw next;
      const response = await Promise.resolve(next ?? null);
      if (signal.aborted) return false;
      const status = datesExternalRecheckStatus(response, XEV6);
      if (!status) { seen.push("poll-error"); return true; }
      seen.push(status.jobs!.rows[0]!.status);
      return status.open;
    } finally { counts.inFlight--; }
  }, { counts });
}

test("the status read: open while queued or running, finished otherwise, nothing from an unusable body", () => {
  assert.equal(datesExternalRecheckStatus(genuine("webadmin-external-detail-recheck-queued"), XEV6)?.open, true);
  assert.equal(datesExternalRecheckStatus(genuine("webadmin-external-detail-recheck-running"), XEV6)?.open, true);
  for (const state of ["applied", "failed", "no-change"]) assert.equal(datesExternalRecheckStatus(genuine(`webadmin-external-detail-recheck-${state}`), XEV6)?.open, false, state);
  for (const body of [null, {}, { success: true, status_code: 200 }, { success: false, status_code: 409, error: "dates-external-unavailable" }])
    assert.equal(datesExternalRecheckStatus(body, XEV6), null, JSON.stringify(body));
  assert.equal(datesExternalRecheckStatus(genuine("webadmin-external-detail-recheck-running"), "xev_00000000000000000000000000000001"), null, "another event's body");
});

test("a failed read and an undecodable body are retried; the status updates without Refresh; a finished job stops the poll", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const seen: string[] = [];
  const read = panelRead([null, { success: true, status_code: 200 }, new Error("network"), genuine("webadmin-external-detail-recheck-running"),
    genuine("webadmin-external-detail-recheck-applied")], seen);
  const stop = pollDatesExternalRecheck(read, 10_000);
  t.mock.timers.tick(9_999); await settle();
  assert.equal(read.counts.calls, 0, "the first read comes after ten seconds");
  t.mock.timers.tick(1); await settle();
  assert.deepEqual(seen, ["poll-error"], "the read failed (no answer)");
  t.mock.timers.tick(10_000); await settle();
  assert.deepEqual(seen, ["poll-error", "poll-error"], "the next read came anyway, and its body could not be decoded");
  t.mock.timers.tick(10_000); await settle();
  assert.equal(read.counts.calls, 3, "a read that throws is a failed read too");
  t.mock.timers.tick(10_000); await settle();
  assert.deepEqual(seen, ["poll-error", "poll-error", "running"], "recovered: the job's status is read");
  t.mock.timers.tick(10_000); await settle();
  assert.deepEqual(seen, ["poll-error", "poll-error", "running", "applied"], "the finished job is shown without Refresh");
  t.mock.timers.tick(120_000); await settle();
  assert.equal(read.counts.calls, 5, "a finished job is not read again");
  assert.equal(read.counts.maxInFlight, 1, "never two reads at once");
  stop();
});

test("stopping (unmount, or the job no longer open on the page) aborts a read in flight and leaves no timer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release: (value: unknown) => void = () => undefined, signalSeen: AbortSignal | null = null, calls = 0;
  const read = async (signal: AbortSignal) => {
    calls++; signalSeen = signal;
    await new Promise((resolve) => { release = resolve; });
    return true;
  };
  const stop = pollDatesExternalRecheck(read, 10_000);
  t.mock.timers.tick(10_000); await settle();
  assert.equal(calls, 1);
  stop();
  assert.equal(signalSeen!.aborted, true, "the read in flight is aborted");
  release(undefined); await settle();
  t.mock.timers.tick(120_000); await settle();
  assert.equal(calls, 1, "nothing is scheduled after a stop, even when the aborted read settles");

  // Stopped before the first read: none is made.
  let early = 0;
  const stopEarly = pollDatesExternalRecheck(async () => { early++; return true; }, 10_000);
  stopEarly();
  t.mock.timers.tick(120_000); await settle();
  assert.equal(early, 0);
});

test("one timer or one read at a time, and none left behind", async () => {
  const pending = new Map<number, () => void>();
  let next = 0, cleared = 0;
  const timers: DatesExternalRecheckPollTimers = {
    setTimeout: (callback) => { pending.set(++next, callback); return next; },
    clearTimeout: (handle) => { if (pending.delete(handle as number)) cleared++; },
  };
  const fire = async () => {
    assert.equal(pending.size, 1, "exactly one timer is waiting");
    const [[handle, callback]] = [...pending];
    pending.delete(handle); callback(); await settle();
  };
  let calls = 0;
  const stop = pollDatesExternalRecheck(async () => { calls++; assert.equal(pending.size, 0, "no timer while a read is out"); return true; }, 10_000, timers);
  for (let round = 0; round < 4; round++) await fire();
  assert.equal(calls, 4);
  stop();
  assert.equal(pending.size, 0); assert.equal(cleared, 1, "the waiting timer is cleared");
  stop();
  assert.equal(cleared, 1, "a second stop is harmless");
});
