import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  latestReadGuard,
  startSupportPoll,
  supportPollDelay,
  SUPPORT_MESSAGE_POLL_MS,
  SUPPORT_POLL_IDLE_MS,
  SUPPORT_POLL_QUIET_READS,
  SUPPORT_POLL_SLOW_MS,
  SUPPORT_POLL_SLOW_READS,
  SUPPORT_THREAD_POLL_MS,
  type SupportPollOutcome,
} from "../lib/supportInboxPoll.ts";

/** A fake clock: timers fire only when the test advances it. */
function clock() {
  let now = 0, nextId = 1;
  const jobs = new Map<number, { at: number; callback: () => void }>();
  return {
    timers: {
      setTimeout(callback: () => void, ms: number) { const id = nextId++; jobs.set(id, { at: now + ms, callback }); return id; },
      clearTimeout(handle: unknown) { jobs.delete(handle as number); },
    },
    get now() { return now; },
    get pending() { return [...jobs.values()].map((job) => job.at - now).sort((a, b) => a - b); },
    async advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = [...jobs.entries()].filter(([, job]) => job.at <= until).sort(([, a], [, b]) => a.at - b.at)[0];
        if (!due) break;
        jobs.delete(due[0]);
        now = due[1].at;
        due[1].callback();
        await settle();
      }
      now = until;
    },
  };
}
const settle = async () => { for (let round = 0; round < 5; round++) await new Promise<void>((resolve) => setImmediate(resolve)); };

function visibility(initiallyHidden = false) {
  let hidden = initiallyHidden;
  const listeners = new Set<() => void>();
  return {
    source: { hidden: () => hidden, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); } },
    set(value: boolean) { hidden = value; for (const listener of listeners) listener(); },
    get listeners() { return listeners.size; },
  };
}

/** A read the test answers by hand, recording when each one started. */
function reads() {
  const started: number[] = [];
  const open: Array<(outcome: SupportPollOutcome | Error) => void> = [];
  return {
    started,
    get inFlight() { return open.length; },
    read: (time: { now: number }) => () => new Promise<SupportPollOutcome>((resolve, reject) => {
      started.push(time.now);
      open.push((outcome) => (outcome instanceof Error ? reject(outcome) : resolve(outcome)));
    }),
    async answer(outcome: SupportPollOutcome | Error) { open.shift()!(outcome); await settle(); },
  };
}

test("the cadence: base interval, slower after reads that change nothing, slower still when idle, and failures back off", () => {
  assert.equal(SUPPORT_THREAD_POLL_MS, 5_000, "the old thread interval");
  assert.equal(SUPPORT_MESSAGE_POLL_MS, 3_000, "the old message interval");
  for (let quiet = 0; quiet < SUPPORT_POLL_QUIET_READS; quiet++) assert.equal(supportPollDelay(3_000, quiet, 0), 3_000);
  for (let quiet = SUPPORT_POLL_QUIET_READS; quiet < SUPPORT_POLL_QUIET_READS + SUPPORT_POLL_SLOW_READS; quiet++) {
    assert.equal(supportPollDelay(3_000, quiet, 0), SUPPORT_POLL_SLOW_MS);
  }
  assert.equal(supportPollDelay(5_000, SUPPORT_POLL_QUIET_READS + SUPPORT_POLL_SLOW_READS, 0), SUPPORT_POLL_IDLE_MS);
  assert.equal(supportPollDelay(5_000, 1_000, 0), SUPPORT_POLL_IDLE_MS);
  assert.deepEqual([1, 2, 3, 4, 50].map((failures) => supportPollDelay(3_000, 0, failures)), [15_000, 30_000, 60_000, 60_000, 60_000]);
});

test("one read at a time: the first at once, the next only after the previous settled, then at the base cadence", async () => {
  const time = clock(), seen = visibility(), calls = reads();
  const poll = startSupportPoll(calls.read(time), 3_000, { timers: time.timers, visibility: seen.source });
  assert.deepEqual(calls.started, [0], "the first load is immediate, as before");
  await time.advance(20_000);
  assert.deepEqual(calls.started, [0], "a slow read is never overlapped by the next one");
  assert.deepEqual(time.pending, [], "and no timer waits beside it");
  await calls.answer("changed");
  assert.deepEqual(time.pending, [3_000]);
  await time.advance(3_000);
  assert.deepEqual(calls.started, [0, 23_000]);
  await calls.answer(new Error("network"));
  assert.deepEqual(time.pending, [15_000], "a read that throws counts as failed");
  poll.stop();
});

test("reads that change nothing slow the poll; a change or reset() brings back the base cadence", async () => {
  const time = clock(), seen = visibility(), calls = reads();
  const poll = startSupportPoll(calls.read(time), 3_000, { timers: time.timers, visibility: seen.source });
  const delays: number[] = [];
  await calls.answer("changed");
  for (let index = 0; index < SUPPORT_POLL_QUIET_READS + SUPPORT_POLL_SLOW_READS + 2; index++) {
    delays.push(time.pending[0]);
    await time.advance(time.pending[0]);
    await calls.answer("unchanged");
  }
  // The delay before read n+1 after n reads in a row that changed nothing.
  assert.deepEqual(delays, [
    ...Array(SUPPORT_POLL_QUIET_READS).fill(3_000), ...Array(SUPPORT_POLL_SLOW_READS).fill(SUPPORT_POLL_SLOW_MS), SUPPORT_POLL_IDLE_MS, SUPPORT_POLL_IDLE_MS,
  ]);
  assert.deepEqual(time.pending, [SUPPORT_POLL_IDLE_MS]);
  // A message arrives: the next read is back at the base cadence.
  await time.advance(SUPPORT_POLL_IDLE_MS);
  await calls.answer("changed");
  assert.deepEqual(time.pending, [3_000]);
  // Idle again, then an explicit load (a send): the waiting timer is re-armed at the base cadence.
  for (let index = 0; index < SUPPORT_POLL_QUIET_READS + 1; index++) { await time.advance(time.pending[0]); await calls.answer("unchanged"); }
  assert.deepEqual(time.pending, [SUPPORT_POLL_SLOW_MS]);
  const before = calls.started.length;
  poll.reset();
  assert.deepEqual(time.pending, [3_000]);
  assert.equal(calls.started.length, before, "reset() does not read by itself; the page's own load does");
  poll.stop();
});

test("failures back off and a later success resets them; reset() during a read keeps one read at a time", async () => {
  const time = clock(), seen = visibility(), calls = reads();
  const poll = startSupportPoll(calls.read(time), 5_000, { timers: time.timers, visibility: seen.source });
  await calls.answer("failed");
  assert.deepEqual(time.pending, [15_000], "the error panel no longer polls every 5 s");
  await time.advance(15_000); await calls.answer("failed");
  assert.deepEqual(time.pending, [30_000]);
  await time.advance(30_000); await calls.answer("failed");
  assert.deepEqual(time.pending, [60_000]);
  await time.advance(60_000);
  poll.reset();
  assert.deepEqual(time.pending, [], "a reset while a read is in flight schedules nothing beside it");
  await calls.answer("unchanged");
  assert.deepEqual(time.pending, [5_000]);
  poll.stop();
});

test("a hidden tab reads nothing; on return it reads at once and starts from the base cadence", async () => {
  const time = clock(), seen = visibility(), calls = reads();
  const poll = startSupportPoll(calls.read(time), 3_000, { timers: time.timers, visibility: seen.source });
  await calls.answer("changed");
  for (let index = 0; index < 6; index++) { await time.advance(time.pending[0]); await calls.answer("unchanged"); }
  const before = calls.started.length;
  seen.set(true);
  assert.deepEqual(time.pending, [], "hiding the tab clears the timer");
  await time.advance(10 * 60_000);
  assert.equal(calls.started.length, before, "ten hidden minutes, no read");
  seen.set(false);
  assert.equal(calls.started.length, before + 1, "the read on return is immediate");
  await calls.answer("unchanged");
  assert.deepEqual(time.pending, [3_000], "and the cadence starts again from the base");

  // Hidden while a read is in flight: it finishes, nothing is scheduled after it.
  await time.advance(3_000);
  seen.set(true);
  await calls.answer("changed");
  assert.deepEqual(time.pending, []);
  // Visible again while a read is in flight: no second read is started beside it.
  seen.set(false);
  seen.set(true); seen.set(false);
  assert.equal(calls.inFlight, 1);
  await calls.answer("unchanged");
  assert.equal(time.pending.length, 1);
  poll.stop();
  assert.equal(seen.listeners, 0, "stop() lets go of the visibility listener");
});

test("a page opened in a hidden tab still makes its first read, as before, and then waits for the tab", async () => {
  const time = clock(), seen = visibility(true), calls = reads();
  const poll = startSupportPoll(calls.read(time), 5_000, { timers: time.timers, visibility: seen.source });
  assert.equal(calls.started.length, 1);
  await calls.answer("changed");
  assert.deepEqual(time.pending, []);
  seen.set(false);
  assert.equal(calls.started.length, 2);
  poll.stop();
});

test("stop(): nothing is read or scheduled afterwards, even when a read in flight settles", async () => {
  const time = clock(), seen = visibility(), calls = reads();
  const poll = startSupportPoll(calls.read(time), 3_000, { timers: time.timers, visibility: seen.source });
  poll.stop();
  await calls.answer("changed");
  await time.advance(120_000);
  seen.set(true); seen.set(false);
  poll.reset();
  assert.deepEqual(calls.started, [0]);
  assert.deepEqual(time.pending, []);
});

test("D2: of overlapping thread reads only the latest started may use its answer; a late older answer is ignored", async () => {
  const guard = latestReadGuard();
  const applied: string[] = [];
  const answers = new Map<string, (rows: string) => void>();
  async function load(name: string) {
    const isLatest = guard.begin();
    const rows = await new Promise<string>((resolve) => answers.set(name, resolve));
    if (isLatest()) applied.push(rows);
  }
  const poll = load("poll"), send = load("send");
  answers.get("send")!("newer list");
  answers.get("poll")!("older list");
  await Promise.all([poll, send]);
  assert.deepEqual(applied, ["newer list"]);
  const alone = load("alone");
  answers.get("alone")!("only list");
  await alone;
  assert.deepEqual(applied, ["newer list", "only list"]);
});

test("the inbox uses the poll for both streams, no interval, and keeps its explicit loads", () => {
  const source = readFileSync(new URL("../app/(dashboard)/support/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /setInterval/);
  assert.match(source, /startSupportPoll\(readThreads, SUPPORT_THREAD_POLL_MS\)/);
  assert.match(source, /startSupportPoll\(\(\) => readConversation\(selectedUid, generation\), SUPPORT_MESSAGE_POLL_MS\)/);
  assert.match(source, /const isLatest = threadReads\.current\.begin\(\);\n\s+const response = await adminCall\("support_threads", \{ limit: 100 \}\);\n[^\n]*\n\s+if \(!isLatest\(\)\) return "unchanged";/);
  // Retry and the reads after a send reset the cadence, then read.
  assert.match(source, /const loadThreads = useCallback\(async \(\) => \{\n\s+threadPollRef\.current\?\.reset\(\);\n\s+await readThreads\(\);/);
  assert.match(source, /const loadConversation = useCallback\(async \(uid: number, generation: number\) => \{\n\s+messagePollRef\.current\?\.reset\(\);\n\s+await readConversation\(uid, generation\);/);
  assert.equal(source.match(/void loadConversation\(intent\.uid, conversationGenerationRef\.current\);\n\s+void loadThreads\(\);/g)?.length, 2, "both sends");
  assert.match(source, /<ErrorPanel message=\{t\("loadError"\)\} retry=\{loadThreads\} \/>/);
  // Each poll is stopped when its stream goes away.
  assert.equal(source.match(/poll\.stop\(\);/g)?.length, 2);
});
