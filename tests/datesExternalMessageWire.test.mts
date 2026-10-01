import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { datesCaseClaimableByRole, permittedResolutionActions, type DatesAdminPrincipal } from "../lib/datesAdmin.ts";
import { datesCaseDetail, datesConsoleCommandReceipt, datesEvidenceRead, datesModerationQueue } from "../lib/datesModerationRead.ts";
import { datesExternalMessageResolutionBaseline, datesExternalMessageResolutionMayStart, datesExternalMessageResolutionReceipt,
  prepareDatesExternalMessageResolution, readDatesExternalMessageResolution, runDatesExternalMessageResolution } from "../lib/datesExternalMessageModeration.ts";

// Byte-identical actual member-send -> audited operator decision captures from
// Core3ba2cda2/source242fd5de. The complete independent inventory/hash pin lives
// in datesExternalWire.test.mts. Controlled transports and mutants below are
// explicitly consumer tests, not additional producer captures or browser runs.
const fixture = (name: string): any => JSON.parse(readFileSync(new URL(`./fixtures/dates_external_admin_wire/admin-chat-${name}.json`, import.meta.url), "utf8"));
const now = 1_790_000_000, actor = "chat-admin@example.test";
const principal: DatesAdminPrincipal = { email: actor, role: "administrator", rank: 40, linked_uid: null,
  sensitive_location: false, break_glass: false, capabilities: ["dates_case_claim", "dates_case_resolve", "dates_evidence_read"] };
function body(label: "approve" | "reject", expectedRevision = 2) {
  return { case_id: fixture(`${label}-claimed`).case.case_id, expected_revision: expectedRevision,
    action: `${label}_content`, reason: "Reviewed the immutable synthetic message.",
    user_visible_reason_en: "Reviewed by support.", user_visible_reason_hu: "Az ügyfélszolgálat ellenőrizte.",
    idempotency_key: `chat-wire-resolve-${label}`, expires_at: null, break_glass: false };
}
function pending(label: "approve" | "reject", expectedRevision = 2) {
  const value = fixture(`${label}-claimed`), detail = datesCaseDetail(value, value.case.case_id);
  assert.ok(detail);
  const baseline = datesExternalMessageResolutionBaseline(detail.case); assert.ok(baseline);
  const command = prepareDatesExternalMessageResolution(actor, body(label, expectedRevision), baseline, now);
  assert.ok(command); return command;
}
function storage() { const rows = new Map<string, string>(); return { rows, getItem: (key: string) => rows.get(key) ?? null,
  setItem: (key: string, value: string) => { rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } }; }

for (const label of ["approve", "reject"] as const) {
  test(`genuine held-message ${label} queue stays metadata-only and offers the two publication decisions`, () => {
    const value = fixture(`${label}-queue`), decoded = datesModerationQueue(value, { page: 1, limit: 40 });
    assert.ok(decoded); assert.deepEqual(decoded.cases, value.cases);
    assert.equal(decoded.cases.length, 1); assert.equal(decoded.cases[0].target_uid, 6000);
    assert.deepEqual(permittedResolutionActions(decoded.cases[0], principal), ["approve_content", "reject_content"]);
    assert.equal(datesCaseClaimableByRole(decoded.cases[0], principal), true);
    assert.doesNotMatch(JSON.stringify(decoded), /Selling tickets|Eladó jegy|snapshot|target_content_hash/);
  });
  for (const phase of ["detail", "claimed", "resolved"] as const) test(`genuine held-message ${label} ${phase} decodes without projecting private evidence`, () => {
    const value = fixture(`${label}-${phase}`), decoded = datesCaseDetail(value, value.case.case_id);
    assert.ok(decoded); assert.deepEqual(decoded.case, value.case); assert.deepEqual(decoded.decisions, value.decisions);
    assert.deepEqual(decoded.reports, []);
    const command = pending(label);
    assert.equal(datesExternalMessageResolutionMayStart(decoded.case, principal, command.body, command.baseline, now), phase === "claimed");
    assert.doesNotMatch(JSON.stringify(decoded), /Selling tickets|Eladó jegy|snapshot|target_content_hash/);
    if (phase === "resolved") {
      assert.deepEqual(permittedResolutionActions(decoded.case, principal), []);
      assert.equal(decoded.case.external_message?.moderation_state, label === "approve" ? "visible" : "rejected");
      assert.equal(decoded.case.external_message?.available, false);
      assert.equal(decoded.decisions[0].action, `${label}_content`);
    }
  });
  for (const replay of [false, true]) test(`genuine held-message ${label} claim${replay ? " replay" : ""} acknowledges only the case CAS`, () => {
    const value = fixture(`${label}-claim${replay ? "-replay" : ""}`), caseId = pending(label).body.case_id;
    assert.ok(datesConsoleCommandReceipt(value, "dates_moderation_claim", caseId, 1));
    assert.equal(value.idempotency_replayed, replay);
    assert.equal(datesConsoleCommandReceipt(value, "dates_moderation_claim", caseId, 2), null);
  });
  test(`genuine held-message ${label} evidence remains a separately audited immutable snapshot`, () => {
    const value = fixture(`${label}-evidence`), command = pending(label);
    const decoded = datesEvidenceRead(value, { case_id: command.body.case_id, appeal_id: null, include_sensitive_location: false, break_glass: false });
    assert.ok(decoded); assert.deepEqual(decoded.evidence, value.evidence);
    assert.equal(decoded.evidence.length, 1);
    const evidence = value.evidence[0];
    assert.equal(evidence.evidence_type, "message_prepublication_snapshot");
    assert.equal(evidence.immutable, true); assert.equal(evidence.sensitive_location, false);
    assert.equal(evidence.snapshot.message_id, command.baseline.message_id);
    assert.equal(evidence.snapshot.sender_uid, command.baseline.target_uid);
    assert.equal(evidence.snapshot.revision, command.baseline.revision);
    assert.equal(evidence.snapshot.moderation_state, "pending");
    assert.equal(evidence.snapshot.text, label === "approve" ? "Selling tickets for the concert" : "Eladó jegy a koncertre");
    assert.doesNotMatch(JSON.stringify(command), /Selling tickets|Eladó jegy|snapshot|target_content_hash/);
  });
  for (const replay of [false, true]) test(`genuine held-message ${label} decision${replay ? " replay" : ""} validates and clears its exact durable command`, async () => {
    const value = fixture(`${label}-resolve${replay ? "-replay" : ""}`), command = pending(label), store = storage();
    assert.deepEqual(datesExternalMessageResolutionReceipt(value, command), value);
    assert.equal(value.idempotency_replayed, replay);
    assert.equal(value.target_result.after.revision, value.target_result.before.revision + 1);
    assert.equal(value.target_result.after.sequence > value.target_result.before.sequence, label === "approve");
    const result = await runDatesExternalMessageResolution(command, store, now, async (action, request) => {
      assert.equal(action, "dates_moderation_resolve"); assert.deepEqual(request, body(label));
      assert.equal(readDatesExternalMessageResolution(store, actor).kind, "pending"); return value;
    });
    assert.deepEqual(result, { kind: "success", retained: false }); assert.equal(store.rows.size, 0);
  });
  test(`genuine held-message ${label} stale case revision is a no-land refusal requiring fresh review`, async () => {
    const value = fixture(`${label}-stale-denied`), command = pending(label, 1), store = storage();
    assert.equal(datesCaseDetail(value, command.body.case_id), null);
    assert.equal(datesExternalMessageResolutionReceipt(value, command), null);
    assert.deepEqual(await runDatesExternalMessageResolution(command, store, now, async () => value), { kind: "refused", retained: false });
    assert.equal(store.rows.size, 0);
    // Synthetic wrong-status counterfactual is never evidence that no write landed.
    assert.equal((await runDatesExternalMessageResolution(command, store, now, async () => ({ ...value, status_code: 503 }))).kind, "uncertain");
    assert.equal(store.rows.size, 1);
  });
  test(`genuine held-message ${label} replay recovers unchanged bytes after a controlled lost reply`, async () => {
    const command = pending(label), store = storage(), requests: string[] = [];
    assert.equal((await runDatesExternalMessageResolution(command, store, now, async (_action, value) => {
      requests.push(JSON.stringify(value)); throw new Error("controlled lost response");
    })).kind, "uncertain");
    const saved = readDatesExternalMessageResolution(store, actor); assert.equal(saved.kind, "pending"); if (saved.kind !== "pending") return;
    assert.deepEqual(await runDatesExternalMessageResolution(saved.pending, store, now + 1, async (_action, value) => {
      requests.push(JSON.stringify(value)); return fixture(`${label}-resolve-replay`);
    }), { kind: "success", retained: false });
    assert.equal(requests[0], requests[1]); assert.equal(store.rows.size, 0);
  });
  test(`synthetic mutants of the genuine held-message ${label} receipt cannot settle another target or effect`, async () => {
    const command = pending(label);
    for (const mutate of [
      (value: any) => { value.target_result.target_id = "msg_" + "f".repeat(32); },
      (value: any) => { value.target_result.subject_uid = 0; },
      (value: any) => { value.target_result.before.revision++; },
      (value: any) => { value.target_result.after.revision++; },
      (value: any) => { value.target_result.after.sequence = value.target_result.before.sequence + (label === "approve" ? 0 : 1); },
      (value: any) => { value.audit_id = null; },
    ]) {
      const value = fixture(`${label}-resolve`), store = storage(); mutate(value);
      assert.equal(datesExternalMessageResolutionReceipt(value, command), null);
      assert.equal((await runDatesExternalMessageResolution(command, store, now, async () => value)).kind, "uncertain");
      assert.equal(store.rows.size, 1);
    }
  });
}

test("genuine author withdrawal keeps safe bound metadata but offers no claim or publication action", () => {
  const value = fixture("withdrawn-unavailable"), decoded = datesCaseDetail(value, value.case.case_id);
  assert.ok(decoded); assert.deepEqual(decoded.case, value.case); assert.equal(decoded.case.status, "closed");
  assert.deepEqual(decoded.case.external_message, { thread_id: "thr_00000000000000000000000000001771", revision: 2,
    moderation_state: "pending", available: false });
  assert.deepEqual(permittedResolutionActions(decoded.case, principal), []);
  assert.equal(datesCaseClaimableByRole(decoded.case, principal), false);
  assert.doesNotMatch(JSON.stringify(decoded), /Buying concert tickets|snapshot|target_content_hash/);
});
