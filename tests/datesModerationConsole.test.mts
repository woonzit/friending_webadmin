import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { datesModerationSla } from "../lib/datesAdmin.ts";
import { datesModerationQueue, datesModerationConsoleSla, datesConsoleCommandReceipt,
  isDatesConsoleCommand } from "../lib/datesModerationRead.ts";

// Exact provider capture from Core 262fba782bc23727a376fe499e8c44512c0de711.
// Synthetic variants below are negative/compatibility controls, never captures.
const DIRECTORY = new URL("./fixtures/dates_moderation_console_wire/", import.meta.url);
const SOURCE = "51fcf7e4c2eab33280f314e042788c39c8b534b4";
const MANIFEST_SHA = "8dbd2491fa6cd6fb3d1dacbf5c2ef793d7a84dab84efb08cd05e117665db6c90";
const GENERATOR_SHA = "d3f561f96747dd935d661884c3b2318d099a0afb21f3924e17a773855c90dcf0";
const SET_SHA = "4f390a3e1e06e71cf237f7f4b37331d17d1da2ffda9e0dcc8fd15329c41f5151";
const QUEUES = ["appeals", "breached", "closed", "conflicted", "mine", "page-empty", "page-one", "page-two",
  "search", "unassigned", "unknown-role"];
const COMMANDS = ["claim", "escalate", "heartbeat", "heartbeat-replay", "note", "release", "release-expired", "release-replay"];
const REFUSALS = ["heartbeat-closed", "heartbeat-expired", "heartbeat-foreign", "heartbeat-key-conflict",
  "heartbeat-stale", "heartbeat-viewer", "release-foreign", "release-unknown-role"];
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, DIRECTORY), "utf8"));
const queue = (name: string) => {
  const body = fixture(`admin-queue-${name}`);
  return datesModerationQueue(body, { page: body.page, limit: body.limit });
};
const caseId = (value: number) => `cas_${value.toString(16).padStart(32, "0")}`;

test("console corpus is the complete 29-response provider capture with independent exact pins", () => {
  const manifest = fixture("manifest");
  assert.equal(hash(readFileSync(new URL("manifest.json", DIRECTORY))), MANIFEST_SHA);
  assert.equal(manifest.contract, "dates-moderation-console-v1");
  assert.equal(manifest.source_commit, SOURCE);
  assert.equal(manifest.provenance.generator, "tests/dates_moderation_console_fixture_dump.php");
  assert.equal(manifest.provenance.generator_sha256, GENERATOR_SHA);
  assert.equal(manifest.fixture_set_sha256, SET_SHA);
  assert.equal(manifest.fixtures.length, 29);
  const expected = [...QUEUES.map((name) => `admin-queue-${name}.json`),
    ...COMMANDS.map((name) => `admin-${name}.json`), ...REFUSALS.map((name) => `admin-${name}-denied.json`),
    "admin-sla-empty.json", "admin-sla-populated.json"].sort();
  assert.deepEqual(manifest.fixtures.map((entry: { file: string }) => entry.file), expected);
  assert.deepEqual(readdirSync(DIRECTORY).sort(), ["manifest.json", ...expected].sort());
  const lines = manifest.fixtures.map((entry: { file: string; sha256: string; consumer: string; http_status: number; status_code: number }) => {
    assert.equal(entry.consumer, "webadmin");
    assert.equal(entry.http_status, 200, "Core retains HTTP 200 even for logical refusals");
    const bytes = readFileSync(new URL(entry.file, DIRECTORY));
    assert.equal(hash(bytes), entry.sha256, entry.file);
    assert.equal(JSON.parse(bytes.toString()).status_code, entry.status_code, entry.file);
    return `${entry.file}\0${entry.sha256}`;
  });
  assert.equal(hash(lines.join("\n")), SET_SHA);
});

for (const name of QUEUES) {
  test(`queue ${name}: actual populated/empty provider rows pass the page decoder unchanged`, () => {
    const body = fixture(`admin-queue-${name}`);
    const decoded = queue(name);
    assert.ok(decoded);
    assert.deepEqual(decoded, { cases: body.cases, page: body.page, limit: body.limit, total: body.total });
    assert.doesNotMatch(JSON.stringify(decoded), /PRIVATE_|"internal_notes"|"reporter_uid"|"snapshot"|"evidence"/);
  });
}

test("queue corpus retains ordered pages, filter membership, null IDs and per-case authority", () => {
  assert.deepEqual(queue("page-one")!.cases.map((row) => row.case_id), [caseId(1), caseId(2)]);
  assert.deepEqual(queue("page-two")!.cases.map((row) => row.case_id), [caseId(3), caseId(4)]);
  assert.deepEqual(queue("page-empty"), { cases: [], page: 3, limit: 2, total: 4 });
  assert.equal(queue("page-one")!.cases[1].activity_id, null);
  assert.notEqual(queue("page-one")!.cases[0].activity_id, null);
  assert.deepEqual(queue("mine")!.cases.map((row) => row.case_id), [caseId(2)]);
  assert.deepEqual(queue("unassigned")!.cases.map((row) => row.case_id), [caseId(1), caseId(3), caseId(4)]);
  assert.equal(queue("unassigned")!.cases[1].assignee_email, "other@example.invalid", "expired lease stays visibly assigned until a command changes it");
  assert.ok(queue("breached")!.cases.every((row) => row.sla_breached));
  assert.ok(queue("appeals")!.cases.every((row) => row.queue === "appeals"));
  assert.equal(queue("search")!.cases[0].case_id, caseId(3));
  assert.ok(queue("closed")!.cases.every((row) => row.status === "closed"));
  assert.equal(queue("conflicted")!.cases[0].conflict_of_interest, true);
  for (const name of ["conflicted", "unknown-role"]) {
    assert.ok(queue(name)!.cases.every((row) => !row.capabilities.can_read_evidence && !row.capabilities.can_resolve));
  }
});

test("queue refuses malformed metadata, duplicate cases, bad envelopes and foreign pagination", () => {
  const source = fixture("admin-queue-page-one");
  const scope = { page: 1, limit: 2 };
  const corruptions = [
    (v: any) => { v.success = "true"; }, (v: any) => { v.status_code = 409; },
    (v: any) => { v.status = 403; }, (v: any) => { v.message = "200"; },
    (v: any) => { v.cases = {}; }, (v: any) => { v.cases[1] = v.cases[0]; },
    (v: any) => { v.cases.push(v.cases[0]); }, (v: any) => { v.total = "4"; },
    (v: any) => { v.total = -1; }, (v: any) => { v.total = Number.MAX_SAFE_INTEGER + 1; },
    (v: any) => { v.page = 2; }, (v: any) => { v.limit = 40; },
    (v: any) => { v.server_now = null; }, (v: any) => { delete v.total; },
    (v: any) => { v.cases[0].target_uid = -1; }, (v: any) => { v.cases[0].activity_id = "wrong"; },
    (v: any) => { v.cases[0].revision = "1"; }, (v: any) => { v.cases[0].capabilities.can_claim = 1; },
    (v: any) => { delete v.cases[0].capabilities.can_resolve; }, (v: any) => { delete v.cases[0].sla_due_at; },
  ];
  for (const corrupt of corruptions) {
    const body = structuredClone(source); corrupt(body);
    assert.equal(datesModerationQueue(body, scope), null, corrupt.toString());
  }
  // D-143: the queue and its rows are bound on their fields; a key this console does not know is tolerated - at the top,
  // on a row and in a row's capabilities - and the queue page reads none of them.
  for (const widen of [(v: any) => { v.private_notes = []; }, (v: any) => { v.cases[0].internal_notes = []; }, (v: any) => { v.cases[0].future_private = "private"; },
    (v: any) => { v.cases[0].capabilities.can_future = true; }]) {
    const body = structuredClone(source); widen(body);
    assert.ok(datesModerationQueue(body, scope), widen.toString());
  }
  for (const key of Object.keys(source)) {
    const body = structuredClone(source); delete body[key];
    assert.equal(datesModerationQueue(body, scope), null, `missing envelope ${key}`);
  }
  for (const key of Object.keys(source.cases[0])) {
    const body = structuredClone(source); delete body.cases[0][key];
    assert.equal(datesModerationQueue(body, scope), null, `missing case ${key}`);
  }
  for (const value of [null, [], {}, false]) assert.equal(datesModerationQueue(value, scope), null);
});

test("closed metadata does not invent a member-host or historical-target policy", () => {
  const body = fixture("admin-queue-page-one");
  // Synthetic compatibility controls: not claimed as provider captures.
  body.cases[0].target_uid = 0;
  body.cases[0].target_type = "historical_nonmember";
  body.cases[0].target_id = "future-target";
  body.cases[0].activity_id = null;
  assert.ok(datesModerationQueue(body, { page: 1, limit: 2 }));
  // Core's find/count are not a transaction; a concurrent removal may lower total.
  body.total = 0;
  assert.equal(datesModerationQueue(body, { page: 1, limit: 2 })?.total, 0);
});

for (const name of ["populated", "empty"]) {
  test(`SLA ${name}: real reply passes both the existing decoder and the page envelope boundary`, () => {
    const body = fixture(`admin-sla-${name}`);
    const decoded = datesModerationConsoleSla(body);
    assert.ok(decoded);
    assert.deepEqual(decoded, datesModerationSla(body));
    assert.equal(decoded.open_count, name === "populated" ? 4 : 0);
    assert.equal(decoded.unassigned_count, name === "populated" ? 3 : 0);
    assert.equal(decoded.sla_breach_count, name === "populated" ? 2 : 0);
    assert.equal(decoded.appeals_waiting, name === "populated" ? 1 : 0);
    assert.equal(decoded.oldest_unassigned_at, name === "populated" ? 1789827200 : null);
    assert.equal(decoded.median_seconds_to_claim, name === "populated" ? 120 : null);
    assert.equal(decoded.median_seconds_to_resolve, name === "populated" ? 600 : null);
    assert.deepEqual(Object.values(decoded.age_buckets), name === "populated" ? [1, 1, 1, 1] : [0, 0, 0, 0]);
  });
}

test("SLA rejects contradictory/loose/partial success instead of showing zero statistics", () => {
  const source = fixture("admin-sla-populated");
  for (const corrupt of [
    (v: any) => { v.success = false; }, (v: any) => { v.status_code = 403; },
    (v: any) => { v.open_count = "4"; }, (v: any) => { v.unassigned_count = 5; },
    (v: any) => { v.age_buckets.under_1h = 0; }, (v: any) => { delete v.age_buckets.over_24h; },
    (v: any) => { v.oldest_unassigned_at = null; }, (v: any) => { v.median_seconds_to_claim = -1; },
    (v: any) => { v.median_seconds_to_resolve = 0.5; }, (v: any) => { v.appeals_waiting = 5; },
    (v: any) => { v.open_count = Number.MAX_SAFE_INTEGER + 1; }, (v: any) => { delete v.sla_breach_count; },
  ]) {
    const body = structuredClone(source); corrupt(body);
    assert.equal(datesModerationConsoleSla(body), null, corrupt.toString());
  }
  // D-143: bound on its fields. An unknown key is tolerated; an unknown age bucket is too, and the known buckets still
  // have to add up to the open cases - so a bucket this console cannot show never hides cases silently.
  for (const widen of [(v: any) => { v.extra = true; }, (v: any) => { v.age_buckets.future = 0; }]) {
    const body = structuredClone(source); widen(body);
    assert.ok(datesModerationConsoleSla(body), widen.toString());
  }
  const hidden = structuredClone(source); hidden.age_buckets.future = 1; hidden.open_count += 1;
  assert.equal(datesModerationConsoleSla(hidden), null, "an open case counted only in a bucket this console does not know");
  for (const key of Object.keys(source)) {
    const body = structuredClone(source); delete body[key];
    assert.equal(datesModerationConsoleSla(body), null, `missing ${key}`);
  }
});

for (const name of COMMANDS) {
  test(`${name}: actual audited receipt acknowledges exactly its command case and revision`, () => {
    const body = fixture(`admin-${name}`);
    const action = `dates_moderation_${name.split("-")[0]}`;
    assert.equal(isDatesConsoleCommand(action), true);
    const receipt = datesConsoleCommandReceipt(body, action, body.case_id, body.revision - 1);
    assert.deepEqual(receipt, { case_id: body.case_id, revision: body.revision,
      audit_id: body.audit_id, idempotency_replayed: body.idempotency_replayed });
    assert.equal(datesConsoleCommandReceipt(body, action, caseId(99), body.revision - 1), null);
    assert.equal(datesConsoleCommandReceipt(body, action, body.case_id, body.revision), null);
    assert.equal(datesConsoleCommandReceipt(body, action, body.case_id, String(body.revision - 1)), null);
    for (const key of Object.keys(body)) {
      const incomplete = structuredClone(body); delete incomplete[key];
      assert.equal(datesConsoleCommandReceipt(incomplete, action, body.case_id, body.revision - 1), null, `missing ${key}`);
    }
  });
}

for (const name of REFUSALS) {
  test(`${name}: actual HTTP-200 logical refusal is never queue/SLA/command success`, () => {
    const body = fixture(`admin-${name}-denied`);
    assert.equal(body.success, false);
    assert.ok([403, 409].includes(body.status_code));
    assert.equal(datesModerationQueue(body, { page: 1, limit: 40 }), null);
    assert.equal(datesModerationConsoleSla(body), null);
    for (const action of ["claim", "heartbeat", "release", "note", "escalate"]) {
      assert.equal(datesConsoleCommandReceipt(body, `dates_moderation_${action}`, caseId(1), 1), null);
    }
  });
}

test("receipt validation preserves durable replay identity without treating old leases as current state", () => {
  for (const action of ["heartbeat", "release"]) {
    const first = fixture(`admin-${action}`);
    const replay = fixture(`admin-${action}-replay`);
    assert.equal(replay.audit_id, first.audit_id);
    assert.equal(replay.revision, first.revision);
    assert.equal(replay.idempotency_replayed, true);
    // Synthetic later response time: Core can replay the same durable result after release/expiry.
    replay.server_now += 86400;
    const receipt = datesConsoleCommandReceipt(replay, `dates_moderation_${action}`, first.case_id, first.revision - 1);
    assert.ok(receipt);
    assert.equal(Object.hasOwn(receipt, "claim_expires_at"), false, "receipt cannot install a stale lease");
  }
});

test("receipt refuses malformed audits, replay flags, revisions, action shapes and logical success contradictions", () => {
  const source = fixture("admin-heartbeat");
  for (const corrupt of [
    (v: any) => { v.success = "true"; }, (v: any) => { v.status_code = 409; },
    (v: any) => { v.audit_id = "aud_unverified"; }, (v: any) => { v.revision = "3"; },
    (v: any) => { v.idempotency_replayed = "false"; }, (v: any) => { v.claim_expires_at = null; },
    (v: any) => { v.case_status = "new"; }, (v: any) => { delete v.audit_id; },
  ]) {
    const body = structuredClone(source); corrupt(body);
    assert.equal(datesConsoleCommandReceipt(body, "dates_moderation_heartbeat", source.case_id, 2), null, corrupt.toString());
  }
  // D-143: the receipt binds on what identifies the command; a key this console does not know is tolerated and not returned.
  const wider = structuredClone(source); wider.extra = "private";
  assert.deepEqual(Object.keys(datesConsoleCommandReceipt(wider, "dates_moderation_heartbeat", source.case_id, 2)!).sort(), ["audit_id", "case_id", "idempotency_replayed", "revision"]);
  for (const action of ["dates_moderation_release", "dates_moderation_resolve", "unknown", "__proto__", "toString"]) {
    assert.equal(datesConsoleCommandReceipt(source, action, source.case_id, 2), null, action);
  }
  for (const [name, field, value] of [["release", "claim_expires_at", 1790000000],
    ["claim", "break_glass_used", "false"], ["note", "note_id", "aud_00000000000000000000000000000001"],
    ["escalate", "escalated", false], ["escalate", "severity", "low"]] as const) {
    const body = fixture(`admin-${name}`); body[field] = value;
    assert.equal(datesConsoleCommandReceipt(body, `dates_moderation_${name}`, body.case_id, body.revision - 1), null);
  }
});

test("live queue and command pages use the tested decoders before installing rows or announcing success", () => {
  const queuePage = readFileSync(new URL("../app/(dashboard)/dates/moderation/page.tsx", import.meta.url), "utf8");
  assert.match(queuePage, /datesModerationQueue\(response, \{ page, limit: PAGE_SIZE \}\)/);
  assert.match(queuePage, /datesModerationConsoleSla\(slaResponse\)/);
  assert.match(queuePage, /setRows\(nextQueue\.cases\)/);
  assert.match(queuePage, /setTotal\(nextQueue\.total\)/);
  assert.doesNotMatch(queuePage, /response\.cases as|Number\(response\.total\)/);
  assert.ok(queuePage.indexOf("if (signal?.aborted) return") < queuePage.indexOf("setRows(nextQueue.cases)"));
  const detail = readFileSync(new URL("../app/(dashboard)/dates/moderation/[caseId]/page.tsx", import.meta.url), "utf8");
  const mutate = detail.slice(detail.indexOf("async function mutate"), detail.indexOf("async function claim"));
  assert.match(mutate, /isDatesConsoleCommand\(action\)/);
  assert.match(mutate, /datesConsoleCommandReceipt\(response, action, caseId, payload\.expected_revision\)/);
  assert.ok(mutate.indexOf("datesConsoleCommandReceipt(") < mutate.indexOf('setFeedback({ tone: "success"'));
  assert.match(mutate, /await load\(\)/, "receipts acknowledge a command; fresh detail remains authoritative");
});
