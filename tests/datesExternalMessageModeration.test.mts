import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { datesAdminPrincipal, datesCaseInternalNotes, datesCaseClaimableByRole, datesExternalReviewAllowed, isDatesExternalMessageCase,
  permittedResolutionActions, resolutionActions } from "../lib/datesAdmin.ts";
import { DatesCaseReadFence, datesCaseDetail, datesModerationQueue } from "../lib/datesModerationRead.ts";
import { datesExternalMessageResolutionBaseline, datesExternalMessageResolutionMayStart, datesExternalMessageResolutionReceipt,
  prepareDatesExternalMessageResolution, readDatesExternalMessageResolution, readDatesExternalMessageResolutionAccess,
  runDatesExternalMessageResolution } from "../lib/datesExternalMessageModeration.ts";

// Synthetic state/counterfactual controls from committed Core1db0a709's actual
// Admin serializer and decision service. These are NOT genuine member sends or
// a provider corpus. Routed captures and their independent pins remain separate.
const now = 1_790_000_000, actor = "moderator@example.invalid";
const messageId = "msg_" + "a".repeat(32), activityId = "act_" + "b".repeat(32), threadId = "thr_" + "c".repeat(32);
const caps = ["dates_case_claim", "dates_case_resolve", "dates_evidence_read"];
const principal = { email: actor, role: "moderator" as const, rank: 20, linked_uid: null, sensitive_location: false, break_glass: false, capabilities: caps };
const envelope = { success: true, status_code: 200, message: 200, status: 200, can_send: 0, server_now: now };
function sample(): any {
  const value = JSON.parse(readFileSync(new URL("./fixtures/dates_moderation_wire/admin-detail-report-viewer.json", import.meta.url), "utf8"));
  Object.assign(value, envelope);
  value.case = { ...value.case, queue: "messages", case_kind: "prepublication", target_type: "message", target_id: messageId,
    target_uid: 12500, activity_id: activityId, revision: 2, status: "in_review", assignee_email: actor, claim_expires_at: now + 300,
    conflict_of_interest: false, external_message: { thread_id: threadId, revision: 1, moderation_state: "pending", available: true },
    allowed_actions: ["approve_content", "reject_content"], capabilities: { can_claim: true, can_read_evidence: true, can_resolve: true, can_break_glass: false } };
  value.reports = []; value.case.report_count = 0; value.case.distinct_reporter_count = 0;
  value.decisions = []; value.appeal = null;
  return value;
}
function request(): any {
  return { case_id: sample().case.case_id, expected_revision: 2, action: "approve_content", reason: "Reviewed immutable evidence",
    user_visible_reason_en: "We reviewed your message.", user_visible_reason_hu: "Ellenőriztük az üzenetedet.",
    expires_at: null, break_glass: false, idempotency_key: "message-review:000000000001" };
}
const baseline = { message_id: messageId, activity_id: activityId, thread_id: threadId, target_uid: 12500, revision: 1 };
const pending = () => prepareDatesExternalMessageResolution(actor, request(), baseline, now)!;
function receipt(): any {
  return { ...envelope, case_id: request().case_id, case_status: "actioned", action: "approve_content", revision: 3,
    decision_id: "dec_" + "d".repeat(32), audit_id: "aud_" + "e".repeat(32), idempotency_replayed: false, break_glass_used: false,
    target_result: { target_type: "message", target_id: messageId, activity_id: activityId, subject_uid: 12500, target_path: "published",
      before: { moderation_state: "pending", revision: 1, sequence: 4 }, after: { moderation_state: "visible", revision: 2, sequence: 9 } } };
}
function closedSample(): any {
  const value = sample();
  Object.assign(value.case, { status: "actioned", revision: 3, allowed_actions: [],
    external_message: { thread_id: threadId, revision: 2, moderation_state: "visible", available: false },
    capabilities: { ...value.case.capabilities, can_claim: false, can_resolve: false } });
  return value;
}
function storage() { const rows = new Map<string, string>(); return { rows, getItem: (k: string) => rows.get(k) ?? null,
  setItem: (k: string, v: string) => { rows.set(k, v); }, removeItem: (k: string) => { rows.delete(k); } }; }

test("external message review is a closed member-authored metadata variant without message text", () => {
  const value = sample(), detail = datesCaseDetail(value, value.case.case_id);
  assert.ok(detail); assert.deepEqual(detail.case.external_message, value.case.external_message);
  assert.equal(isDatesExternalMessageCase(detail.case), true);
  assert.deepEqual(datesExternalMessageResolutionBaseline(detail.case), baseline);
  assert.deepEqual(datesModerationQueue({ ...envelope, cases: [value.case], page: 1, limit: 40, total: 1 }, { page: 1, limit: 40 })?.cases, [value.case]);
  assert.doesNotMatch(JSON.stringify(detail), /snapshot|target_content_hash|message_text/);
  for (const change of [{ target_type: "user" }, { queue: "activities" }, { case_kind: "reports" }, { target_id: activityId },
    { activity_id: null }, { target_uid: 0 }, { target_uid: 1 }, { target_uid: "12500" }, { revision: 0 },
    { allowed_actions: ["warn"] }, { allowed_actions: ["approve_content", "approve_content"] }, { allowed_actions: [1] },
    { external_message: null }]) {
    const body = sample(); Object.assign(body.case, change); assert.equal(datesCaseDetail(body, body.case.case_id), null, JSON.stringify(change));
  }
  // D-143: the case is bound on its fields; a key this console does not know is tolerated. It stays what it is - a
  // message case, told by `external_message` - and no screen reads the added key.
  for (const change of [{ external_revision: 1 }, { text: "PRIVATE_MESSAGE" }, { snapshot: {} }]) {
    const body = sample(); Object.assign(body.case, change);
    const read = datesCaseDetail(body, body.case.case_id);
    assert.ok(read, JSON.stringify(change)); assert.equal(isDatesExternalMessageCase(read.case), true);
  }
  for (const key of ["external_message", "allowed_actions"]) {
    const body = sample(); delete body.case[key]; assert.equal(datesCaseDetail(body, body.case.case_id), null, key);
  }
  for (const change of [{ thread_id: activityId }, { thread_id: null }, { revision: "1" }, { revision: 0 }, { moderation_state: "approved" },
    { moderation_state: "visible" }, { available: "true" }]) {
    const body = sample(); Object.assign(body.case.external_message, change); assert.equal(datesCaseDetail(body, body.case.case_id), null, JSON.stringify(change));
  }
  // D-143: tolerated inside the message metadata as well; the three bound fields still decide.
  for (const change of [{ text: "PRIVATE_MESSAGE" }, { target_content_hash: "f".repeat(64) }]) {
    const body = sample(); Object.assign(body.case.external_message, change); assert.ok(datesCaseDetail(body, body.case.case_id), JSON.stringify(change));
  }
  // What the screens of a message case read of it: the four metadata fields, never a text.
  for (const file of ["../app/(dashboard)/dates/moderation/[caseId]/page.tsx", "../lib/datesExternalMessageModeration.ts"])
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), "utf8"), /external_message\??\.(?!thread_id|revision|moderation_state|available)[a-z_]+/, file);
});

test("unavailable message metadata retains a bound state or a complete null triple, never invented authority", () => {
  for (const state of ["pending", "visible", "rejected", null]) {
    const body = closedSample();
    body.case.external_message = { thread_id: state ? threadId : null, revision: state ? 2 : null, moderation_state: state, available: false };
    assert.ok(datesCaseDetail(body, body.case.case_id));
    assert.deepEqual(resolutionActions(body.case), []); assert.equal(datesCaseClaimableByRole(body.case, principal), false);
    for (const change of [{ allowed_actions: ["approve_content"] }, { capabilities: { ...body.case.capabilities, can_claim: true } },
      { capabilities: { ...body.case.capabilities, can_resolve: true } }]) {
      const bad = structuredClone(body); Object.assign(bad.case, change); assert.equal(datesCaseDetail(bad, bad.case.case_id), null);
    }
  }
  for (const field of ["thread_id", "revision", "moderation_state"]) {
    const value = closedSample(); value.case.external_message[field] = null; assert.equal(datesCaseDetail(value, value.case.case_id), null);
  }
  const viewer = sample(); viewer.case.allowed_actions = [];
  Object.assign(viewer.case.capabilities, { can_claim: false, can_resolve: false, can_read_evidence: false });
  assert.ok(datesCaseDetail(viewer, viewer.case.case_id));
});

test("only current approve/reject actions are offered and ordinary member case contracts stay unchanged", () => {
  const item = sample().case;
  assert.deepEqual(permittedResolutionActions(item, principal), ["approve_content", "reject_content"]);
  assert.equal(datesCaseClaimableByRole(item, principal), true, "no external-event review role is invented for a member message");
  assert.deepEqual(permittedResolutionActions(item, { capabilities: [] }), []);
  assert.deepEqual(resolutionActions({ ...item, allowed_actions: ["reject_content"] }), ["reject_content"]);
  for (const value of [{ ...item, external_message: undefined }, { ...item, queue: "appeals" }, { ...item, allowed_actions: ["restore_content", "warn"] }])
    assert.deepEqual(resolutionActions(value), []);
  const ordinary = JSON.parse(readFileSync(new URL("./fixtures/dates_moderation_wire/admin-detail-report-viewer.json", import.meta.url), "utf8"));
  assert.ok(datesCaseDetail(ordinary, ordinary.case.case_id)); assert.equal(isDatesExternalMessageCase(ordinary.case), false);
  assert.deepEqual(resolutionActions({ queue: "messages", case_kind: "reports", target_type: "message" }),
    ["dismiss", "restore_content", "remove_content", "warn", "restrict_dates", "suspend_account"]);
  assert.deepEqual(resolutionActions({ queue: "reviews", case_kind: "prepublication", target_type: "review" }), ["approve_content", "reject_content"]);
});

test("message decision history binds the exact subject and cannot acquire account-sanction or appeal semantics", () => {
  const value = closedSample();
  const decision = { decision_id: "dec_" + "d".repeat(32), case_id: value.case.case_id, target_type: "message", target_id: messageId,
    activity_id: activityId, target_path: "published", action: "approve_content", severity: "medium", user_visible_reason: { en: "Reviewed", hu: "Ellenőrizve" },
    created_at: now, expires_at: null, appeal_outcome: null, appeal_resolved_at: null };
  value.decisions = [decision]; assert.ok(datesCaseDetail(value, value.case.case_id));
  for (const change of [{ target_type: "user" }, { target_id: activityId }, { activity_id: null }, { action: "warn" }, { action: "restore_content" },
    { target_path: "membership" }, { expires_at: now }, { appeal_outcome: "overturned" }, { appeal_resolved_at: now }]) {
    value.decisions = [{ ...decision, ...change }]; assert.equal(datesCaseDetail(value, value.case.case_id), null, JSON.stringify(change));
  }
  // D-143: a key this console does not know is tolerated on a decision row; a missing field is not.
  value.decisions = [{ ...decision, text: "PRIVATE_MESSAGE" }]; assert.ok(datesCaseDetail(value, value.case.case_id));
  const { severity: _severity, ...partial } = decision;
  value.decisions = [partial]; assert.equal(datesCaseDetail(value, value.case.case_id), null);
});

test("pending request validates closed exact fields and copies the form without storing content evidence", () => {
  const body = request(), original = prepareDatesExternalMessageResolution(actor, body, baseline, now)!;
  assert.ok(original); body.reason = "edited form"; assert.notEqual(original.body.reason, body.reason);
  assert.doesNotMatch(JSON.stringify(original), /snapshot|moderation_state|message_text/);
  for (const change of [{ case_id: messageId }, { expected_revision: "2" }, { expected_revision: Number.MAX_SAFE_INTEGER }, { action: "restore_content" },
    { expected_external_revision: 1 }, { expected_target_revision: 1 }, { target_uid: 12500 }, { expires_at: now }, { break_glass: 0 },
    { idempotency_key: "short" }, { user_visible_reason_en: "" }, { user_visible_reason_hu: "x".repeat(501) }, { reason: "\u0000bad" }, { text: "PRIVATE_MESSAGE" }])
    assert.equal(prepareDatesExternalMessageResolution(actor, { ...request(), ...change }, baseline, now), null, JSON.stringify(change));
  for (const change of [{ message_id: activityId }, { thread_id: messageId }, { target_uid: 0 }, { revision: "1" }, { text: "PRIVATE_MESSAGE" }])
    assert.equal(prepareDatesExternalMessageResolution(actor, request(), { ...baseline, ...change } as any, now), null);
  for (const identity of ["UPPER@example.invalid", " bad@example.invalid", "invalid"])
    assert.equal(prepareDatesExternalMessageResolution(identity, request(), baseline, now), null);
});

test("receipt requires exact case/target CAS, audit and fresh public sequence only for approval", () => {
  assert.ok(datesExternalMessageResolutionReceipt(receipt(), pending()));
  for (const change of [{ success: false }, { status_code: 201 }, { server_now: "1790000000" }, { case_id: messageId },
    { case_status: "closed" }, { revision: 2 }, { action: "reject_content" }, { audit_id: "missing" },
    { idempotency_replayed: 1 }, { break_glass_used: true }, { decision_id: "dec_1" }])
    assert.equal(datesExternalMessageResolutionReceipt({ ...receipt(), ...change }, pending()), null, JSON.stringify(change));
  // D-143: the receipt binds on what identifies the decision; a key this console does not know is tolerated.
  assert.ok(datesExternalMessageResolutionReceipt({ ...receipt(), private: {} }, pending()));
  const { audit_id: _audit, ...unaudited } = receipt() as Record<string, unknown>;
  assert.equal(datesExternalMessageResolutionReceipt(unaudited, pending()), null, "a missing binding field");
  for (const change of [{ target_type: "user" }, { target_id: activityId }, { activity_id: null }, { subject_uid: 0 },
    { subject_uid: 12501 }, { target_path: "unchanged" }]) {
    const value = receipt(); Object.assign(value.target_result, change); assert.equal(datesExternalMessageResolutionReceipt(value, pending()), null);
  }
  for (const [section, changes] of Object.entries({ before: [{ revision: 2 }, { moderation_state: "visible" }, { sequence: 0 }],
    after: [{ revision: 1 }, { moderation_state: "pending" }, { sequence: 4 }, { sequence: "9" }] })) {
    for (const change of changes) {
      const value = receipt(); Object.assign(value.target_result[section], change); assert.equal(datesExternalMessageResolutionReceipt(value, pending()), null);
    }
  }
  // D-143: unknown keys in the target result and in its two states are tolerated.
  const wider = receipt(); Object.assign(wider.target_result, { thread_id: threadId, text: "PRIVATE_MESSAGE" }); Object.assign(wider.target_result.after, { text: "PRIVATE_MESSAGE" });
  assert.ok(datesExternalMessageResolutionReceipt(wider, pending()));
  const rejected = receipt(); rejected.action = "reject_content";
  Object.assign(rejected.target_result.after, { moderation_state: "rejected", sequence: 4 });
  const original = prepareDatesExternalMessageResolution(actor, { ...request(), action: "reject_content" }, baseline, now)!;
  assert.ok(datesExternalMessageResolutionReceipt(rejected, original));
  rejected.target_result.after.sequence = 5; assert.equal(datesExternalMessageResolutionReceipt(rejected, original), null);
});

test("fresh access permits recovery of a closed case but not revoked permission or another case variant", async () => {
  const send = async (action: string) => action === "admin_me" ? { success: true, dates: principal } : closedSample();
  assert.ok(await readDatesExternalMessageResolutionAccess(send, request().case_id));
  assert.equal(await readDatesExternalMessageResolutionAccess(async (action) => action === "admin_me"
    ? { success: true, dates: { ...principal, capabilities: ["dates_evidence_read"] } } : sample(), request().case_id), null);
  assert.equal(await readDatesExternalMessageResolutionAccess(async () => { throw new Error("offline"); }, request().case_id), null);
  assert.equal(await readDatesExternalMessageResolutionAccess(async (action) => action === "admin_me"
    ? { success: true, dates: principal } : { ...sample(), server_now: "1790000000" }, request().case_id), null);
});

test("new decisions require the fresh claim and message identity while original replay remains separate", () => {
  assert.equal(datesExternalMessageResolutionMayStart(sample().case, principal, request(), baseline, now), true);
  for (const change of [{ revision: 3 }, { target_id: "msg_" + "f".repeat(32) }, { target_uid: 12501 }, { activity_id: "act_" + "f".repeat(32) },
    { allowed_actions: ["reject_content"] }, { assignee_email: "other@example.invalid" }, { claim_expires_at: now },
    { capabilities: { ...sample().case.capabilities, can_resolve: false } }]) {
    assert.equal(datesExternalMessageResolutionMayStart({ ...sample().case, ...change }, principal, request(), baseline, now), false, JSON.stringify(change));
  }
  for (const change of [{ thread_id: "thr_" + "f".repeat(32) }, { revision: 2 }, { available: false }, { moderation_state: "visible" }]) {
    const item = sample().case; Object.assign(item.external_message, change);
    assert.equal(datesExternalMessageResolutionMayStart(item, principal, request(), baseline, now), false);
  }
  const conflicted = sample().case; conflicted.conflict_of_interest = true;
  Object.assign(conflicted.capabilities, { can_resolve: false, can_break_glass: true });
  const senior = { ...principal, break_glass: true };
  assert.equal(datesExternalMessageResolutionMayStart(conflicted, senior, request(), baseline, now), false);
  assert.equal(datesExternalMessageResolutionMayStart(conflicted, senior, { ...request(), break_glass: true }, baseline, now), true);
  assert.equal(datesExternalMessageResolutionMayStart(closedSample().case, principal, request(), baseline, now), false);
});

test("uncertain decision persists before sending and retries identical bytes after recreation", async () => {
  const store = storage(), sent: string[] = [];
  const send = async (action: string, body: unknown) => { assert.equal(action, "dates_moderation_resolve");
    assert.equal(store.rows.size, 1); sent.push(JSON.stringify(body)); throw new Error("lost reply"); };
  assert.equal((await runDatesExternalMessageResolution(pending(), store, now, send)).kind, "uncertain");
  const saved = readDatesExternalMessageResolution(store, actor); assert.equal(saved.kind, "pending"); if (saved.kind !== "pending") return;
  assert.equal((await runDatesExternalMessageResolution(saved.pending, store, now + 1, send)).kind, "uncertain");
  assert.equal(sent[0], sent[1]);
  assert.equal((await runDatesExternalMessageResolution(saved.pending, store, now + 2, async () => ({ ...receipt(), idempotency_replayed: true }))).kind, "success");
  assert.equal(store.rows.size, 0);
});

test("a request owner or transport cannot mutate the in-flight receipt binding", async () => {
  const store = storage(), original = pending();
  const result = await runDatesExternalMessageResolution(original, store, now, async (_action, body) => {
    original.body.action = "reject_content"; original.baseline.revision = 4; body.action = "remove_content";
    return receipt();
  });
  assert.deepEqual(result, { kind: "success", retained: false }); assert.equal(store.rows.size, 0);
});

test("only exact no-land refusals retire the saved decision; auth/key/transport uncertainty retains it", async () => {
  for (const [error, status, expected] of [["dates-moderation-target-stale", 409, "refused"], ["dates-moderation-case-closed", 409, "refused"],
    ["dates-moderation-action-invalid", 422, "refused"], ["dates-moderation-target-stale", 503, "uncertain"],
    ["dates-admin-capability-required", 403, "uncertain"], ["dates-admin-idempotency-conflict", 409, "uncertain"], ["unrecognized", 422, "uncertain"]] as const) {
    const store = storage(); const result = await runDatesExternalMessageResolution(pending(), store, now,
      async () => ({ success: false, status_code: status, error, message: 200, status: 200, can_send: 0 }));
    assert.equal(result.kind, expected); assert.equal(store.rows.size, expected === "refused" ? 0 : 1);
  }
  const store = storage(); const malformed = receipt(); malformed.target_result.after.sequence = 4;
  assert.equal((await runDatesExternalMessageResolution(pending(), store, now, async () => malformed)).kind, "uncertain");
  assert.equal(store.rows.size, 1);
});

test("corrupt/competing/inaccessible/expired storage cannot dispatch or silently discard a request", async () => {
  let sent = 0; const send = async () => { sent++; return receipt(); };
  assert.equal((await runDatesExternalMessageResolution(pending(), null, now, send)).kind, "blocked");
  assert.equal((await runDatesExternalMessageResolution(pending(), storage(), now + 6 * 86400, send)).kind, "expired");
  assert.equal((await runDatesExternalMessageResolution(pending(), storage(), now - 301, send)).kind, "blocked");
  for (const raw of ["bad JSON", "x".repeat(16001), JSON.stringify({ ...pending(), private: {} }),
    JSON.stringify({ ...pending(), actor: "other@example.invalid" }), JSON.stringify({ ...pending(), body: { ...request(), idempotency_key: "other-review:000000000001" } })]) {
    const store = storage(); await runDatesExternalMessageResolution(pending(), store, now, async () => null);
    const key = [...store.rows.keys()][0]; store.rows.set(key, raw);
    assert.equal((await runDatesExternalMessageResolution(pending(), store, now, send)).kind, "blocked"); assert.equal(store.rows.get(key), raw);
  }
  for (const stage of ["read", "write"] as const) {
    const store = storage(); if (stage === "read") store.getItem = () => { throw new Error("denied"); };
    else store.setItem = () => { throw new Error("denied"); };
    assert.equal((await runDatesExternalMessageResolution(pending(), store, now, send)).kind, "blocked");
  }
  assert.equal(sent, 0);
});

test("late success never erases a replaced journal and failed cleanup remains visible", async () => {
  for (const mode of ["replaced", "remove-fails"] as const) {
    const store = storage(); if (mode === "remove-fails") store.removeItem = () => { throw new Error("denied"); };
    const result = await runDatesExternalMessageResolution(pending(), store, now, async () => {
      if (mode === "replaced") store.rows.set([...store.rows.keys()][0], JSON.stringify({ ...pending(), body: { ...request(), idempotency_key: "replacement-review:0000001" } }));
      return receipt();
    });
    assert.deepEqual(result, { kind: "success", retained: true }); assert.equal(store.rows.size, 1);
    if (mode === "replaced") assert.match([...store.rows.values()][0], /replacement-review/);
  }
});

// These execute the production page callbacks with controlled I/O, not a
// browser mount or a provider capture. Ordinary callbacks are exercised too.
const pageSource = readFileSync(new URL("../app/(dashboard)/dates/moderation/[caseId]/page.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("page.tsx", pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "DatesModerationCase");
assert.ok(component?.body);
const callback = (name: string) => {
  const value = component.body!.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(value); return value.getText(tree);
};
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function deferred() { let resolve!: (value: any) => void; const promise = new Promise<any>((done) => { resolve = done; }); return { promise, resolve }; }
const flush = () => new Promise((done) => setImmediate(done));
const operation = () => ({ kind: "resolve", label: "Approve", payload: request() });
function harness(store = storage(), initial = sample(), initialPrincipal = principal) {
  const access = deferred(), response = deferred(), state: any = {}, writes: string[] = [], sent: Array<{ action: string; body: unknown }> = [];
  const readFence = new DatesCaseReadFence(), lifetime = { current: 0 };
  const context: any = { exports: {}, JSON, principal: initialPrincipal, caseId: initial.case.case_id, data: initial, writeLocked: false, mutationBusy: { current: false }, readFence, lifetime,
    messageReview: (key: string) => key, isDatesExternalMessageCase, datesExternalMessageResolutionBaseline, datesExternalMessageResolutionMayStart,
    prepareDatesExternalMessageResolution, readDatesExternalMessageResolution, readDatesExternalMessageResolutionAccess, runDatesExternalMessageResolution,
    datesExternalBrowserStorage: () => store, load: async () => { writes.push("load"); },
    adminCall: async (action: string, body: unknown) => {
      if (action === "admin_me" || action === "dates_moderation_detail") { const fresh = await access.promise; return action === "admin_me" ? fresh.identity : fresh.detail; }
      sent.push({ action, body }); return response.promise;
    } };
  for (const name of ["Busy", "Evidence", "Feedback", "Confirmed", "MessageNeedsReload", "MessagePending", "ResolutionReason", "VisibleReasonEn", "VisibleReasonHu"])
    context[`set${name}`] = (value: unknown) => { state[name] = value; writes.push(name); };
  vm.runInNewContext(compile(`${callback("executeMessageResolution")}; exports.execute = executeMessageResolution;`), context);
  return { store, context, access, response, state, sent, writes, readFence, lifetime, execute: context.exports.execute as (operation: unknown, retry?: unknown) => Promise<void>,
    authorize: (detail = initial, identity: unknown = { success: true, dates: initialPrincipal }) => access.resolve({ detail, identity }),
    unmount: () => { readFence.invalidate(); lifetime.current++; } };
}

test("actual message callback saves one command before dispatch and prevents concurrent writes", async () => {
  const h = harness(), work = h.execute(operation()); h.authorize(); await flush();
  assert.equal(h.sent.length, 1); assert.equal(readDatesExternalMessageResolution(h.store, actor).kind, "pending");
  await h.execute(operation()); assert.equal(h.sent.length, 1);
  h.response.resolve(null); await work;
  assert.equal(h.state.Feedback.text, "uncertain"); assert.equal(h.writes.includes("ResolutionReason"), false);
});

test("actual message confirmation rejects stale case/target/claim/action/identity before dispatch", async () => {
  for (const mode of ["case", "message", "action", "lease", "assignee", "identity", "capability"] as const) {
    const h = harness(), work = h.execute(operation()), value = sample();
    const identity = { success: true, dates: { ...principal, capabilities: [...caps] } };
    if (mode === "case") value.case.revision++;
    if (mode === "message") value.case.external_message.revision++;
    if (mode === "action") value.case.allowed_actions = ["reject_content"];
    if (mode === "lease") value.case.claim_expires_at = now;
    if (mode === "assignee") value.case.assignee_email = "other@example.invalid";
    if (mode === "identity") identity.dates.email = "other@example.invalid";
    if (mode === "capability") identity.dates.capabilities = [];
    h.authorize(value, identity); await work;
    assert.equal(h.sent.length, 0); assert.equal(readDatesExternalMessageResolution(h.store, actor).kind, "empty");
    assert.equal(h.writes.includes("ResolutionReason"), false);
  }
});

test("actual message callback recovers an identical receipt after the case is resolved", async () => {
  const first = harness(), work = first.execute(operation()); first.authorize(); await flush(); first.response.resolve(null); await work;
  const saved = readDatesExternalMessageResolution(first.store, actor); assert.equal(saved.kind, "pending"); if (saved.kind !== "pending") return;
  const h = harness(first.store), retry = h.execute(null, saved.pending); h.authorize(closedSample()); await flush();
  assert.equal(JSON.stringify(h.sent), JSON.stringify(first.sent)); h.response.resolve({ ...receipt(), idempotency_replayed: true }); await retry;
  assert.equal(readDatesExternalMessageResolution(h.store, actor).kind, "empty"); assert.ok(h.writes.includes("load"));
});

for (const label of ["approve", "reject"] as const) test(`actual page callback recovers genuine Core ${label} bytes after a controlled lost reply`, async () => {
  // These case/decision bodies are genuine Core3ba2cda2. The principal and
  // delayed I/O are controlled consumer seams, not a live browser session.
  const fixture = (phase: string) => JSON.parse(readFileSync(new URL(
    `./fixtures/dates_external_admin_wire/admin-chat-${label}-${phase}.json`, import.meta.url), "utf8"));
  const initial = fixture("claimed"), currentPrincipal = { ...principal, email: "chat-admin@example.test" };
  const command = { case_id: initial.case.case_id, expected_revision: 2, action: `${label}_content`,
    reason: "Reviewed the immutable synthetic message.", user_visible_reason_en: "Reviewed by support.",
    user_visible_reason_hu: "Az ügyfélszolgálat ellenőrizte.", idempotency_key: `chat-wire-resolve-${label}`,
    expires_at: null, break_glass: false };
  const first = harness(storage(), initial, currentPrincipal);
  const work = first.execute({ kind: "resolve", label, payload: command }); first.authorize(); await flush();
  assert.equal(first.sent.length, 1); assert.equal(JSON.stringify(first.sent[0].body), JSON.stringify(command));
  first.response.resolve(null); await work;
  const saved = readDatesExternalMessageResolution(first.store, currentPrincipal.email);
  assert.equal(saved.kind, "pending"); if (saved.kind !== "pending") return;
  const second = harness(first.store, fixture("resolved"), currentPrincipal);
  const retry = second.execute(null, saved.pending); second.authorize(); await flush();
  assert.equal(JSON.stringify(second.sent), JSON.stringify(first.sent));
  second.response.resolve(fixture("resolve-replay")); await retry;
  assert.equal(readDatesExternalMessageResolution(first.store, currentPrincipal.email).kind, "empty");
  assert.equal(second.state.Feedback.text, "success"); assert.ok(second.writes.includes("load"));
});

test("actual message callback rejects replaced-page work before dispatch or UI adoption", async () => {
  for (const stage of ["before", "after"] as const) {
    const h = harness(), work = h.execute(operation());
    if (stage === "after") { h.authorize(); await flush(); }
    h.unmount(); const writes = [...h.writes];
    if (stage === "before") h.authorize(); else h.response.resolve(null);
    await work; assert.deepEqual(h.writes, writes); assert.equal(h.sent.length, stage === "before" ? 0 : 1);
    assert.equal(readDatesExternalMessageResolution(h.store, actor).kind, stage === "before" ? "empty" : "pending");
  }
});

test("actual confirm dispatcher isolates held messages from ordinary and external-event decisions", async () => {
  for (const mode of ["message", "ordinary", "event", "hold"] as const) {
    const calls: string[] = [], data = sample(), context: any = { exports: {}, confirmed: operation(), data, isDatesExternalMessageCase,
      executeMessageResolution: async () => calls.push("message"), executeExternalResolution: async () => calls.push("event"),
      mutate: async (action: string) => { calls.push(action); return false; }, t: (key: string) => key, setConfirmed: () => {} };
    if (mode === "ordinary") { delete data.case.external_message; data.case.case_kind = "reports"; }
    if (mode === "event") data.case.target_type = "external_event";
    if (mode === "hold") context.confirmed.kind = "legal_hold";
    vm.runInNewContext(compile(`${callback("executeConfirmed")}; exports.execute = executeConfirmed;`), context);
    await context.exports.execute();
    assert.deepEqual(calls, [mode === "message" ? "message" : mode === "event" ? "event" : mode === "hold" ? "dates_moderation_legal_hold" : "dates_moderation_resolve"]);
  }
});

test("actual held-message loader reads metadata and saved identity only, never private evidence or event facts", async () => {
  const loader = component.body!.statements.flatMap((node) => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
    .find((node) => node.name.getText(tree) === "load");
  assert.ok(loader?.initializer && ts.isCallExpression(loader.initializer));
  const store = storage(); await runDatesExternalMessageResolution(pending(), store, now, async () => null);
  const calls: string[] = [], state: any = {}, context: any = { exports: {}, caseId: request().case_id, readFence: new DatesCaseReadFence(),
    datesAdminPrincipal, datesCaseDetail, datesCaseInternalNotes, isDatesExternalMessageCase, permittedResolutionActions,
    readDatesExternalMessageResolution, datesExternalBrowserStorage: () => store,
    adminCall: async (action: string) => { calls.push(action); return action === "admin_me" ? { success: true, dates: principal } : sample(); } };
  for (const name of ["Evidence", "Data", "ExternalEvent", "Principal", "Confirmed", "BreakGlass", "EvidenceSensitive", "State", "Feedback", "Notes", "ExternalPending", "ExternalNeedsReload", "MessagePending", "MessageNeedsReload", "ResolutionAction"])
    context[`set${name}`] = (value: unknown) => { state[name] = value; };
  vm.runInNewContext(compile(`exports.load = ${loader.initializer.arguments[0].getText(tree)};`), context);
  await context.exports.load(); assert.equal(state.State, "ready"); assert.equal(state.MessagePending.kind, "pending");
  assert.deepEqual(calls.sort(), ["admin_me", "dates_moderation_detail"]); assert.equal(state.Evidence, null); assert.equal(state.ExternalEvent, null);
});

test("actual evidence callback never requests live-location scope for an external event or its held message", async () => {
  for (const mode of ["message", "event", "ordinary"] as const) {
    const data = sample(), sent: any[] = [], scopes: any[] = [];
    if (mode === "event") data.case.target_type = "external_event";
    if (mode === "ordinary") { delete data.case.external_message; data.case.case_kind = "reports"; }
    const context: any = { exports: {}, data, caseId: data.case.case_id, busy: false, breakGlass: false,
      principal: { ...principal, capabilities: [...caps, "dates_external_event_review"] },
      datesExternalReviewAllowed, isDatesExternalMessageCase, evidenceSensitive: true,
      evidenceReason: mode === "ordinary" ? "Read authorized evidence" : "", readFence: new DatesCaseReadFence(),
      t: (key: string) => key, setBusy: () => {}, setEvidence: () => {}, setFeedback: () => {},
      adminCall: async (action: string, body: unknown) => { sent.push({ action, body }); return null; },
      datesEvidenceRead: (_value: unknown, scope: unknown) => { scopes.push(scope); return null; } };
    vm.runInNewContext(compile(`${callback("readEvidence")}; exports.read = readEvidence;`), context);
    await context.exports.read({ preventDefault() {} });
    assert.equal(sent.length, 1); assert.equal(sent[0].action, "dates_moderation_evidence");
    assert.equal(sent[0].body.include_sensitive_location, mode === "ordinary");
    assert.equal(scopes[0].include_sensitive_location, mode === "ordinary");
  }
});

test("actual trail capture callback refuses external targets before parsing or dispatch", async () => {
  for (const mode of ["message", "event"] as const) {
    const data = sample(); if (mode === "event") data.case.target_type = "external_event";
    const context: any = { exports: {}, data, busy: false, isDatesExternalMessageCase,
      epochFromLocalInput: () => assert.fail("external targets have no trail-capture input"),
      mutate: () => assert.fail("external targets have no live-location capture") };
    vm.runInNewContext(compile(`${callback("captureTrailEvidence")}; exports.capture = captureTrailEvidence;`), context);
    await context.exports.capture({ preventDefault() {} });
  }
});
