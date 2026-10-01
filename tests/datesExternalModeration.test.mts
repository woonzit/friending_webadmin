import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { DATES_EXTERNAL_MODERATION_ACTIONS, datesAdminPrincipal, datesCaseInternalNotes, datesCaseClaimableByRole, datesExternalReviewAllowed, isDatesExternalMessageCase, permittedResolutionActions, resolutionActions } from "../lib/datesAdmin.ts";
import { DatesCaseReadFence, datesCaseDetail, datesModerationQueue } from "../lib/datesModerationRead.ts";
import { decodeDatesExternalDetail } from "../lib/datesExternalAdmin.ts";
import { datesExternalResolutionMatches, datesExternalResolutionReceipt, normalizeDatesExternalResolutionProxyBody, prepareDatesExternalResolution,
  readDatesExternalResolution, readDatesExternalResolutionAccess, runDatesExternalResolution } from "../lib/datesExternalModeration.ts";

// Explicit synthetic counterfactuals based on committed Core cea57550. Genuine
// routed moderation captures will be pinned separately, never synthesized here.
const now = 1_790_000_000, actor = "moderator@example.invalid";
const externalId = "xev_" + "a".repeat(32), activityId = "act_" + "b".repeat(32);
const caps = ["dates_case_claim", "dates_case_resolve", "dates_evidence_read", "dates_external_event_review"];
const principal = { email: actor, role: "moderator", rank: 20, linked_uid: null, sensitive_location: false, break_glass: false, capabilities: caps };
function sample() {
  const source = JSON.parse(readFileSync(new URL("./fixtures/dates_moderation_wire/admin-detail-report-viewer.json", import.meta.url), "utf8"));
  source.case = { ...source.case, queue: "activities", case_kind: "reports", target_type: "external_event", target_id: externalId, target_uid: 0,
    activity_id: activityId, revision: 2, status: "in_review", assignee_email: actor, claim_expires_at: now + 1000, conflict_of_interest: false,
    external_revision: 7, external_status: "published", external_target_available: true, allowed_actions: [...DATES_EXTERNAL_MODERATION_ACTIONS],
    capabilities: { can_claim: false, can_read_evidence: true, can_resolve: true, can_break_glass: false } };
  source.decisions = []; source.appeal = null;
  return source;
}
function request() {
  return { case_id: sample().case.case_id, expected_revision: 2, expected_external_revision: 7, action: "remove_content",
    reason: "Checked source and report", user_visible_reason_en: "Content removed", user_visible_reason_hu: "Tartalom eltávolítva",
    expires_at: null, break_glass: false, idempotency_key: "external-review:000000000001" };
}
const baseline = { external_event_id: externalId, activity_id: activityId, activity_revision: 11 };
const pending = () => prepareDatesExternalResolution(actor, request(), baseline, now)!;
function receipt() {
  return { success: true, status_code: 200, message: 200, status: 200, can_send: 0, server_now: now,
    case_id: request().case_id, case_status: "actioned", action: "remove_content", revision: 3, decision_id: "dec_" + "c".repeat(32),
    audit_id: "aud_" + "d".repeat(32), idempotency_replayed: false, break_glass_used: false,
    target_result: { target_type: "external_event", target_id: externalId, activity_id: activityId, subject_uid: 0, target_path: "published",
      before: { event_status: "published", revision: 7, activity_revision: 11, lifecycle: "active", moderation_state: "pending", soft_deleted: false },
      after: { event_status: "rejected", revision: 8, activity_revision: 12, lifecycle: "active", moderation_state: "removed", soft_deleted: false } } };
}
function storage() { const rows = new Map<string, string>(); return { rows, getItem: (k: string) => rows.get(k) ?? null, setItem: (k: string, v: string) => { rows.set(k, v); }, removeItem: (k: string) => { rows.delete(k); } }; }

test("external case is a separate closed metadata variant, preserving case and ledger revisions", () => {
  const body = sample(); assert.ok(datesCaseDetail(body, body.case.case_id));
  const queue = { success: true, status_code: 200, message: 200, status: 200, can_send: 0, server_now: now, cases: [body.case], page: 1, limit: 40, total: 1 };
  assert.equal(datesModerationQueue(queue, { page: 1, limit: 40 })?.cases[0].external_revision, 7);
  for (const change of [{ target_uid: 1 }, { target_uid: "0" }, { activity_id: null }, { target_id: activityId }, { queue: "users" },
    { case_kind: "prepublication" }, { external_revision: "7" }, { external_status: "invented" }, { external_target_available: 1 },
    { allowed_actions: ["warn"] }, { allowed_actions: ["dismiss", "dismiss"] }, { private_field: true }]) {
    const value = sample(); Object.assign(value.case, change); assert.equal(datesCaseDetail(value, value.case.case_id), null, JSON.stringify(change));
  }
  for (const key of ["external_revision", "external_status", "external_target_available", "allowed_actions"]) {
    const value = sample(); delete value.case[key]; assert.equal(datesCaseDetail(value, value.case.case_id), null, key);
  }
});
test("purged closed external case remains readable but has neither invented revision nor actions", () => {
  const body = sample(); Object.assign(body.case, { status: "closed", external_revision: null, external_status: null, external_target_available: false,
    allowed_actions: [], capabilities: { ...body.case.capabilities, can_claim: false, can_resolve: false } });
  assert.ok(datesCaseDetail(body, body.case.case_id));
  assert.deepEqual(permittedResolutionActions(body.case, { capabilities: caps }), []);
  body.case.external_revision = 7; assert.equal(datesCaseDetail(body, body.case.case_id), null);
});
test("external action set cannot fall through to member sanctions, appeal or prepublication actions", () => {
  const item = sample().case;
  assert.deepEqual(resolutionActions(item), [...DATES_EXTERNAL_MODERATION_ACTIONS]);
  assert.deepEqual(permittedResolutionActions(item, { capabilities: caps }), [...DATES_EXTERNAL_MODERATION_ACTIONS]);
  for (const missing of ["dates_case_resolve", "dates_external_event_review"])
    assert.deepEqual(permittedResolutionActions(item, { capabilities: caps.filter((cap) => cap !== missing) }), []);
  for (const change of [{ queue: "appeals", case_kind: "appeal" }, { case_kind: "prepublication" }, { allowed_actions: ["warn", "suspend_account"] }])
    assert.deepEqual(resolutionActions({ ...item, ...change }), []);
  assert.equal(datesCaseClaimableByRole(item, { capabilities: ["dates_case_claim"] }), false);
  assert.equal(datesExternalReviewAllowed(item, { capabilities: ["dates_evidence_read"] }), false);
  assert.equal(datesCaseClaimableByRole(item, { capabilities: caps }), true);
});
test("external resolution body is closed and only opts in when the independent revision is present", () => {
  assert.ok(normalizeDatesExternalResolutionProxyBody("dates_moderation_resolve", request()));
  const member: any = request(); delete member.expected_external_revision;
  assert.equal(normalizeDatesExternalResolutionProxyBody("dates_moderation_resolve", member), undefined);
  for (const change of [{ expected_external_revision: "07" }, { expected_external_revision: null }, { action: "warn" }, { expires_at: now + 3600 },
    { admin_email: actor }, { subject_uid: 0 }, { user_visible_reason_en: "x".repeat(501) }])
    assert.equal(normalizeDatesExternalResolutionProxyBody("dates_moderation_resolve", { ...request(), ...change }), null);
});
test("external resolution receipt binds both identities, both revision domains and exact side effects", () => {
  assert.ok(datesExternalResolutionReceipt(receipt(), pending()));
  for (const mutate of [(v: any) => { v.revision = 8; }, (v: any) => { v.target_result.subject_uid = 1; },
    (v: any) => { v.target_result.target_id = activityId; }, (v: any) => { v.target_result.before.revision = 6; },
    (v: any) => { v.target_result.after.activity_revision = 11; }, (v: any) => { v.target_result.after.event_status = "published"; },
    (v: any) => { v.target_result.after.soft_deleted = true; }, (v: any) => { v.break_glass_used = true; }, (v: any) => { v.private = {}; }]) {
    const value = receipt(); mutate(value); assert.equal(datesExternalResolutionReceipt(value, pending()), null);
  }
  const dismiss: any = receipt(); Object.assign(dismiss, { case_status: "dismissed", action: "dismiss" });
  Object.assign(dismiss.target_result, { target_path: "unchanged", before: null, after: null });
  assert.ok(datesExternalResolutionReceipt(dismiss, prepareDatesExternalResolution(actor, { ...request(), action: "dismiss" }, baseline, now)!));
  const cancel: any = receipt(); cancel.action = "cancel_activity";
  Object.assign(cancel.target_result.after, { event_status: "withdrawn", lifecycle: "canceled", moderation_state: "pending" });
  const cancelPending = prepareDatesExternalResolution(actor, { ...request(), action: "cancel_activity" }, baseline, now)!;
  assert.ok(datesExternalResolutionReceipt(cancel, cancelPending));
  cancel.target_result.after.event_status = "canceled_upstream"; assert.equal(datesExternalResolutionReceipt(cancel, cancelPending), null);
});
test("unknown resolution is saved before dispatch and retries the exact immutable pair after reload", async () => {
  const store = storage(), original = pending(), sent: string[] = [];
  const send = async (_: string, body: unknown) => { assert.equal(store.rows.size, 1); sent.push(JSON.stringify(body)); throw new Error("lost reply"); };
  assert.equal((await runDatesExternalResolution(original, store, now, send)).kind, "uncertain");
  const saved = readDatesExternalResolution(store, actor); assert.equal(saved.kind, "pending");
  if (saved.kind !== "pending") return;
  assert.equal((await runDatesExternalResolution(saved.pending, store, now + 1, send)).kind, "uncertain");
  assert.equal(sent[0], sent[1]);
  assert.equal((await runDatesExternalResolution(saved.pending, store, now + 2, async () => ({ ...receipt(), idempotency_replayed: true }))).kind, "success");
  assert.equal(store.rows.size, 0);
});
test("fresh authorization is required even when a closed case can replay an old receipt", async () => {
  const body = sample(); Object.assign(body.case, { status: "actioned", allowed_actions: [], capabilities: { ...body.case.capabilities, can_resolve: false } });
  const send = async (action: string) => action === "admin_me" ? { success: true, dates: principal } : body;
  assert.equal((await readDatesExternalResolutionAccess(send, body.case.case_id)).kind, "authorized");
  assert.deepEqual(await readDatesExternalResolutionAccess(async (action) => action === "admin_me" ? { success: true, dates: { ...principal, capabilities: ["dates_case_resolve"] } } : body, body.case.case_id), { kind: "denied" });
});
test("auth/transport/key conflict retain resolution identity; known content/case conflicts release only this identity", async () => {
  for (const [error, status, expected] of [["dates-admin-capability-required", 403, "uncertain"], ["dates-admin-idempotency-conflict", 409, "uncertain"],
    ["dates-external-conflict", 409, "refused"], ["dates-moderation-case-closed", 409, "refused"], ["dates-moderation-action-invalid", 422, "refused"]] as const) {
    const store = storage(); const result = await runDatesExternalResolution(pending(), store, now, async () => ({ success: false, status_code: status, error, message: 200, status: 200, can_send: 0 }));
    assert.equal(result.kind, expected); assert.equal(store.rows.size, expected === "uncertain" ? 1 : 0);
  }
});
test("expired, corrupt, inaccessible or competing journals never dispatch or erase another request", async () => {
  let calls = 0; const send = async () => { calls++; return receipt(); }, store = storage();
  assert.equal((await runDatesExternalResolution(pending(), null, now, send)).kind, "blocked");
  assert.equal((await runDatesExternalResolution(pending(), store, now + 6 * 86400, send)).kind, "expired");
  await runDatesExternalResolution(pending(), store, now, async () => null);
  const key = [...store.rows.keys()][0]; store.rows.set(key, "broken JSON");
  assert.equal((await runDatesExternalResolution(pending(), store, now, send)).kind, "blocked");
  const replacement = pending(); replacement.body.idempotency_key = "another-request:00000000001";
  store.rows.set(key, JSON.stringify(replacement));
  assert.equal((await runDatesExternalResolution(pending(), store, now, send)).kind, "blocked");
  assert.equal(calls, 0);
});
test("a late receipt cannot erase a replacement journal, and failed removal remains recoverable", async () => {
  for (const mode of ["replaced", "remove-fails"] as const) {
    const store = storage();
    if (mode === "remove-fails") store.removeItem = () => { throw new Error("storage denied"); };
    const result = await runDatesExternalResolution(pending(), store, now, async () => {
      if (mode === "replaced") {
        const other = pending(); other.body.idempotency_key = "replacement-request:00000001";
        store.rows.set([...store.rows.keys()][0], JSON.stringify(other));
      }
      return receipt();
    });
    assert.deepEqual(result, { kind: "success", retained: true }); assert.equal(store.rows.size, 1);
    if (mode === "replaced") assert.match([...store.rows.values()][0], /replacement-request/);
  }
});
test("report labels accept only a captured locale/label or the historical bilingual shape", () => {
  const body = sample(); assert.ok(body.reports.length > 0);
  for (const label of [{ locale: "hu", label: "Hibás adatok" }, { en: "Wrong details", hu: "Hibás adatok" }, null]) {
    body.reports[0].reason_label_snapshot = label; assert.ok(datesCaseDetail(body, body.case.case_id));
  }
  for (const label of [{ locale: "de", label: "Unreviewed locale" }, { locale: "hu", label: 1 }, { locale: "hu", label: "" },
    { locale: "hu", label: "Hibás adatok", reporter_uid: 5 }, { locale: "hu", label: "Hibás adatok", en: "Wrong details" }]) {
    body.reports[0].reason_label_snapshot = label; assert.equal(datesCaseDetail(body, body.case.case_id), null);
  }
});

test("external decision history cannot smuggle a member target, appeal, sanction or expiry", () => {
  const decision = { decision_id: "dec_" + "c".repeat(32), case_id: request().case_id, target_type: "external_event", target_id: externalId,
    activity_id: activityId, target_path: "published", action: "remove_content", severity: "medium", user_visible_reason: { en: "Removed", hu: "Eltávolítva" },
    created_at: now, expires_at: null, appeal_outcome: null, appeal_resolved_at: null };
  const body = sample(); body.decisions = [decision]; assert.ok(datesCaseDetail(body, body.case.case_id));
  for (const change of [{ target_type: "user" }, { target_id: activityId }, { activity_id: null }, { action: "warn" },
    { expires_at: now }, { appeal_outcome: "overturned" }, { target_path: "membership" }]) {
    body.decisions = [{ ...decision, ...change }]; assert.equal(datesCaseDetail(body, body.case.case_id), null);
  }
});

// Execute the actual page callbacks with controlled I/O. These are not browser
// mounts or genuine provider captures; the provider corpus is tested separately.
const pageSource = readFileSync(new URL("../app/(dashboard)/dates/moderation/[caseId]/page.tsx", import.meta.url), "utf8");
const pageTree = ts.createSourceFile("page.tsx", pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = pageTree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "DatesModerationCase");
assert.ok(component?.body);
const execute = component.body.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "executeExternalResolution");
const loader = component.body.statements.flatMap((node) => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
  .find((node) => node.name.getText(pageTree) === "load");
assert.ok(execute && loader?.initializer && ts.isCallExpression(loader.initializer));
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
test("actual report-label display preserves the captured language without inventing a translation", () => {
  const formatter = pageTree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "displayReason");
  assert.ok(formatter); const context: any = { exports: {} };
  vm.runInNewContext(compile(`${formatter.getText(pageTree)}; exports.format = displayReason;`), context);
  for (const locale of ["en", "hu"]) assert.equal(context.exports.format({ locale: "hu", label: "Hibás adatok" }, locale), "Hibás adatok");
  assert.equal(context.exports.format({ en: "Wrong details", hu: "Hibás adatok" }, "en"), "Wrong details");
  assert.equal(context.exports.format(null, "hu"), "—");
});
function deferred() { let resolve!: (value: any) => void; const promise = new Promise<any>((done) => { resolve = done; }); return { promise, resolve }; }
const flush = () => new Promise((done) => setImmediate(done));
function pageHarness(store = storage()) {
  const access = deferred(), response = deferred(), state: any = {}, writes: string[] = [], sent: Array<{ action: string; body: unknown }> = [];
  const readFence = new DatesCaseReadFence(), lifetime = { current: 0 };
  const context: any = { exports: {}, JSON, principal, writeLocked: false, mutationBusy: { current: false }, readFence, lifetime,
    externalEvent: { external_event_id: externalId, activity_id: activityId, activity_revision: 11 },
    external: (key: string) => key, readDatesExternalResolutionAccess, datesExternalResolutionMatches, permittedResolutionActions,
    prepareDatesExternalResolution, runDatesExternalResolution, readDatesExternalResolution, datesExternalBrowserStorage: () => store,
    adminCall: async (action: string, body: unknown) => {
      if (action === "admin_me" || action === "dates_moderation_detail") {
        const fresh = await access.promise; return action === "admin_me" ? fresh.identity : fresh.detail;
      }
      sent.push({ action, body }); return response.promise;
    }, load: async () => { writes.push("load"); } };
  for (const name of ["Busy", "Evidence", "Feedback", "Confirmed", "ExternalNeedsReload", "ExternalPending", "ResolutionReason", "VisibleReasonEn", "VisibleReasonHu"])
    context[`set${name}`] = (value: unknown) => { state[name] = value; writes.push(name); };
  vm.runInNewContext(compile(`${execute.getText(pageTree)}; exports.execute = executeExternalResolution;`), context);
  return { store, access, response, state, writes, sent, readFence, lifetime, context,
    execute: context.exports.execute as (operation: unknown, retry?: unknown) => Promise<void>,
    authorize: (detail = sample(), identity: unknown = { success: true, dates: principal }) => access.resolve({ detail, identity }),
    unmount: () => { readFence.invalidate(); lifetime.current++; } };
}
const operation = () => ({ kind: "resolve", label: "Remove content", payload: request() });

test("actual external decision callback blocks double clicks and persists before dispatch", async () => {
  const h = pageHarness(), first = h.execute(operation()); await h.execute(operation());
  assert.equal(h.sent.length, 0); h.authorize(); await flush();
  assert.equal(h.sent.length, 1); assert.equal(readDatesExternalResolution(h.store, actor).kind, "pending");
  h.response.resolve(null); await first;
  assert.equal(h.state.Feedback.text, "feedback.uncertain");
  assert.equal(h.state.ExternalPending.kind, "pending"); assert.equal(h.state.Busy, false);
});
test("actual decision callback rejects stale case/content pairs and changed capabilities without losing written reasons", async () => {
  for (const changed of ["case", "event", "identity", "capability"] as const) {
    const h = pageHarness(), first = h.execute(operation()), detail = sample();
    const identity = { success: true, dates: { ...principal, capabilities: [...caps] } };
    if (changed === "case") detail.case.revision++;
    if (changed === "event") detail.case.external_revision++;
    if (changed === "identity") identity.dates.email = "other@example.invalid";
    if (changed === "capability") identity.dates.capabilities = ["dates_case_resolve"];
    h.authorize(detail, identity); await first;
    assert.equal(h.sent.length, 0); assert.equal(readDatesExternalResolution(h.store, actor).kind, "empty");
    assert.equal(h.writes.includes("ResolutionReason"), false);
    if (changed === "case" || changed === "event") assert.equal(h.state.ExternalNeedsReload, true);
    else assert.equal(h.state.Feedback.text, "moderation.reviewRequired");
  }
});
test("an unconfirmed fresh access read never claims permission was denied or dispatches a decision", async () => {
  const h = pageHarness(), first = h.execute(operation());
  h.authorize(null, { success: false, status_code: 503 }); await first;
  assert.equal(h.sent.length, 0); assert.equal(h.state.Feedback.text, "moderation.accessUnconfirmed");
  assert.equal(h.writes.includes("ResolutionReason"), false); assert.equal(h.state.Busy, false);
  assert.equal(readDatesExternalResolution(h.store, actor).kind, "empty");
});
test("fresh access distinguishes confirmed capability loss from failed or undecodable reads", async () => {
  const detail = sample(), identity = { success: true, dates: principal };
  for (const [me, body] of [[null, detail], [{ success: false, status_code: 503 }, detail], [identity, null], [identity, { success: true }]]) {
    assert.deepEqual(await readDatesExternalResolutionAccess(async (action) => action === "admin_me" ? me : body, detail.case.case_id), { kind: "unconfirmed" });
  }
  assert.deepEqual(await readDatesExternalResolutionAccess(async () => { throw new Error("network"); }, detail.case.case_id), { kind: "unconfirmed" });
  for (const capabilities of [[], ["dates_case_resolve"], ["dates_external_event_review"]]) {
    assert.deepEqual(await readDatesExternalResolutionAccess(async (action) => action === "admin_me"
      ? { success: true, dates: { ...principal, capabilities } } : detail, detail.case.case_id), { kind: "denied" });
  }
});
test("actual decision retry replays the frozen pair after the authoritative case is already closed", async () => {
  const original = pageHarness(), first = original.execute(operation()); original.authorize(); await flush(); original.response.resolve(null); await first;
  const saved = readDatesExternalResolution(original.store, actor); assert.equal(saved.kind, "pending"); if (saved.kind !== "pending") return;
  const h = pageHarness(original.store), retry = h.execute(null, saved.pending), detail = sample();
  Object.assign(detail.case, { revision: 3, external_revision: 8, status: "actioned", allowed_actions: [], capabilities: { ...detail.case.capabilities, can_resolve: false } });
  h.authorize(detail); await flush();
  assert.equal(JSON.stringify(h.sent), JSON.stringify(original.sent));
  h.response.resolve({ ...receipt(), idempotency_replayed: true }); await retry;
  assert.equal(readDatesExternalResolution(h.store, actor).kind, "empty"); assert.ok(h.writes.includes("load"));
});
test("actual decision callback does not dispatch dismissal removed by a fresh held-case read", async () => {
  const h = pageHarness(), proposed = operation(); proposed.payload.action = "dismiss";
  const first = h.execute(proposed), detail = sample();
  detail.case.allowed_actions = ["restore_content", "remove_content", "cancel_activity", "remove_activity"];
  detail.case.external_status = "in_review";
  h.authorize(detail); await first;
  assert.equal(h.sent.length, 0);
  assert.equal(readDatesExternalResolution(h.store, actor).kind, "empty");
  assert.equal(h.writes.includes("ResolutionReason"), false);
});
test("actual decision navigation fence blocks preflight dispatch and post-dispatch UI adoption", async () => {
  for (const stage of ["before", "after"] as const) {
    const h = pageHarness(), first = h.execute(operation());
    if (stage === "after") { h.authorize(); await flush(); }
    h.unmount(); const writes = [...h.writes];
    if (stage === "before") h.authorize(); else h.response.resolve(null);
    await first; assert.deepEqual(h.writes, writes);
    assert.equal(h.sent.length, stage === "before" ? 0 : 1);
    assert.equal(readDatesExternalResolution(h.store, actor).kind, stage === "before" ? "empty" : "pending");
  }
});
test("actual case loader preserves history and durable recovery but blocks writes when facts are unavailable or stale", async () => {
  for (const variant of ["unavailable", "mismatch"] as const) {
    const state: any = {}, journal = pending(), context: any = { exports: {}, caseId: request().case_id, readFence: new DatesCaseReadFence(),
      datesAdminPrincipal, datesCaseDetail, datesCaseInternalNotes, decodeDatesExternalDetail, permittedResolutionActions, isDatesExternalMessageCase,
      datesExternalBrowserStorage: () => null, readDatesExternalResolution: () => ({ kind: "pending", pending: journal }), external: (key: string) => key,
      adminCall: async (action: string) => action === "admin_me" ? { success: true, dates: principal } : action === "dates_moderation_detail" ? sample()
        : variant === "unavailable" ? null : JSON.parse(readFileSync(new URL("./fixtures/dates_external_admin_wire/admin-detail-admin.json", import.meta.url), "utf8")) };
    for (const name of ["Evidence", "Data", "ExternalEvent", "Principal", "Confirmed", "BreakGlass", "EvidenceSensitive", "State", "Feedback", "Notes", "ExternalPending", "ExternalNeedsReload", "MessagePending", "MessageNeedsReload", "ResolutionAction"])
      context[`set${name}`] = (value: unknown) => { state[name] = value; };
    vm.runInNewContext(compile(`exports.load = ${loader.initializer.arguments[0].getText(pageTree)};`), context);
    await context.exports.load(); assert.equal(state.State, "ready"); assert.equal(state.Data.case.case_id, request().case_id);
    assert.equal(state.ExternalEvent, null); assert.equal(state.ExternalNeedsReload, true); assert.equal(state.ExternalPending.pending, journal);
    assert.equal(state.Feedback.text, "moderation.factsUnavailable");
  }
});
