import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAdminActionAllowed, adminActionAccess } from "../lib/adminActions.ts";
import { isAdminClientReadAction } from "../lib/adminClientReadActions.ts";
import { DATES_EXTERNAL_ADMIN_V2_ROUTES, datesExternalAdminContractParams, withDatesAdminContract } from "../lib/datesAdminContract.ts";
import {
  DATES_EXTERNAL_ACTIONS, datesExternalCorrections, datesExternalProxyCapabilityAuthorized, datesExternalRechecks, datesExternalRefusal,
  decodeDatesExternalCorrectionDecision, decodeDatesExternalCorrectionList, decodeDatesExternalDetail, decodeDatesExternalList,
  decodeDatesExternalRecheckReceipt, decodeDatesExternalReceipt, decodeDatesExternalReviewReceipt, normalizeDatesExternalProxyBody,
} from "../lib/datesExternalAdmin.ts";
import { datesExternalDraft, datesExternalDraftInput, normalizeDatesExternalEditorInput, normalizeDatesExternalManualEvent } from "../lib/datesExternalInput.ts";
import { decodeDatesExternalPending } from "../lib/datesExternalMutations.ts";
import {
  datesExternalCorrectionPrefill, datesExternalCorrectionRejectRequest, datesExternalOffsetForLocal, datesExternalReviewRefusalKey,
  datesExternalReviewRequest, prepareDatesExternalRecheck, readDatesExternalRecheckPending,
  runDatesExternalCorrectionReject, runDatesExternalRecheck, runDatesExternalReview,
} from "../lib/datesExternalReview.ts";
import { projectDatesIntakeDetail, projectDatesIntakeQueue } from "../lib/datesIntakeAdmin.ts";
import { decodeResearchRunDetail } from "../lib/datesResearchAdmin.ts";
import { decodeDatesSystemClosure } from "../lib/datesSystemClosure.ts";

// D-149 (T-908). Every body is Core-B's genuine one (tests/fixtures/dates_external_review_wire, see provenance.txt).
// A case no genuine body has is a DERIVED mutation of a genuine body, named as such where it is made.
const genuine = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/dates_external_review_wire/${name}.json`, import.meta.url), "utf8"));
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const XEV = "xev_00000000000000000000000000000001", ACT = "act_00000000000000000000000000000001";
const XEV6 = "xev_00000000000000000000000000000006";
const COR = "cor_00000000000000000000000000000001";
const KEY = "dates-external-test:00000000-0000-4000-8000-000000000001";

test("the three new routes are allow-listed, classified and gated by the external capabilities", () => {
  for (const action of ["dates_external_event_recheck", "dates_external_correction_list", "dates_external_correction_decide"]) {
    assert.ok((DATES_EXTERNAL_ACTIONS as readonly string[]).includes(action), action);
    assert.equal(isAdminActionAllowed(action), true, action);
  }
  assert.equal(adminActionAccess("dates_external_correction_list"), "dates_read");
  assert.equal(isAdminClientReadAction("dates_external_correction_list"), true);
  for (const action of ["dates_external_event_recheck", "dates_external_correction_decide"]) {
    assert.equal(adminActionAccess(action), "dates_write"); assert.equal(isAdminClientReadAction(action), false);
  }
  const member = (capabilities: string[]) => ({ success: true, role: "admin", dates: { email: "operator@example.test", role: "administrator", rank: 40,
    linked_uid: null, sensitive_location: false, break_glass: false, capabilities } });
  // Core-B: the queue and a rejection need the review capability (moderator and above); a re-research, manage.
  for (const action of ["dates_external_correction_list", "dates_external_correction_decide"]) {
    assert.equal(datesExternalProxyCapabilityAuthorized(action, member(["dates_external_event_read", "dates_external_event_manage"])), false, action);
    assert.equal(datesExternalProxyCapabilityAuthorized(action, member(["dates_external_event_review"])), true, action);
  }
  assert.equal(datesExternalProxyCapabilityAuthorized("dates_external_event_recheck", member(["dates_external_event_read", "dates_external_event_review"])), false);
  assert.equal(datesExternalProxyCapabilityAuthorized("dates_external_event_recheck", member(["dates_external_event_read", "dates_external_event_manage"])), true);
});

test("the v2 selector goes with exactly the routes Core-B names, and the browser cannot set or unset it", () => {
  assert.deepEqual([...DATES_EXTERNAL_ADMIN_V2_ROUTES].sort(), ["dates_event_intake_detail", "dates_event_intake_list", "dates_event_research_run_detail",
    "dates_external_correction_decide", "dates_external_correction_list", "dates_external_event_command", "dates_external_event_detail",
    "dates_external_event_list", "dates_external_event_recheck", "dates_external_event_update"]);
  for (const action of DATES_EXTERNAL_ADMIN_V2_ROUTES) assert.deepEqual(datesExternalAdminContractParams(action), { dates_external_admin_contract_version: 2 });
  // On any other route selector 2 changes nothing, so their released requests stay as they are.
  for (const action of ["dates_external_event_publish", "dates_external_event_place_search", "dates_activity_detail", "dates_event_research_run_list", "users_list"])
    assert.deepEqual(datesExternalAdminContractParams(action), {}, action);
  const merged = Object.assign(Object.create(null), { external_event_id: XEV, dates_external_admin_contract_version: 9, admin_email: "operator@example.test" });
  assert.equal(withDatesAdminContract("dates_external_event_recheck", merged).dates_external_admin_contract_version, 2);
  const unset = Object.assign(Object.create(null), { page: 1, admin_email: "operator@example.test" });
  assert.equal(Object.hasOwn(withDatesAdminContract("dates_external_event_publish", unset), "dates_external_admin_contract_version"), false);
});

test("closed browser requests: re-research, corrections queue and decision, review marks, approvals by edit or by command", () => {
  const recheck = { external_event_id: XEV, idempotency_key: KEY };
  assert.equal(normalizeDatesExternalProxyBody("dates_external_event_recheck", recheck), recheck);
  assert.ok(normalizeDatesExternalProxyBody("dates_external_event_recheck", { ...recheck, instructions: "Look at the venue page.\nThe time moved." }));
  assert.ok(normalizeDatesExternalProxyBody("dates_external_event_recheck", { ...recheck, instructions: "é".repeat(1000) }));
  for (const bad of [{ ...recheck, instructions: "é".repeat(1001) }, { ...recheck, instructions: "   " }, { ...recheck, instructions: "a\u0000b" }, { ...recheck, instructions: 5 },
    { ...recheck, external_event_id: ACT }, { idempotency_key: KEY }, { ...recheck, idempotency_key: "short" }, { ...recheck, reason: "extra" }])
    assert.equal(normalizeDatesExternalProxyBody("dates_external_event_recheck", bad), null, JSON.stringify(bad).slice(0, 80));
  for (const good of [{}, { page: 2 }, { status: "" }, { status: "pending", page: 1 }, { status: "rejected" }])
    assert.ok(normalizeDatesExternalProxyBody("dates_external_correction_list", good), JSON.stringify(good));
  for (const bad of [{ status: "open" }, { page: 0 }, { page: "01" }, { status: "pending", external_event_id: XEV }])
    assert.equal(normalizeDatesExternalProxyBody("dates_external_correction_list", bad), null, JSON.stringify(bad));
  const decide = { correction_id: COR, decision: "reject", reason_code: "not_accurate", idempotency_key: KEY };
  assert.ok(normalizeDatesExternalProxyBody("dates_external_correction_decide", decide));
  assert.ok(normalizeDatesExternalProxyBody("dates_external_correction_decide", { ...decide, note: "👍🏽".repeat(500) }), "500 graphemes");
  assert.ok(normalizeDatesExternalProxyBody("dates_external_correction_decide", { ...decide, reason_code: "other", note: "Explained." }));
  for (const bad of [{ ...decide, decision: "approve" }, { ...decide, reason_code: "Not Accurate" }, { ...decide, note: "" }, { ...decide, correction_id: XEV },
    { ...decide, expected_revision: 1 }, { ...decide, reason_code: "other" }, { ...decide, note: "a".repeat(501) }])
    assert.equal(normalizeDatesExternalProxyBody("dates_external_correction_decide", bad), null, JSON.stringify(bad).slice(0, 80));
  const mark = { external_event_id: XEV, expected_revision: 3, action: "mark_reviewed", idempotency_key: KEY };
  assert.ok(normalizeDatesExternalProxyBody("dates_external_event_command", mark));
  assert.ok(normalizeDatesExternalProxyBody("dates_external_event_command", { ...mark, reason: "Facts match the source" }));
  assert.equal(normalizeDatesExternalProxyBody("dates_external_event_command", { ...mark, action: "clear_reviewed" }), null, "clearing needs a reason");
  assert.ok(normalizeDatesExternalProxyBody("dates_external_event_command", { ...mark, action: "clear_reviewed", reason: "Needs another look" }));
  for (const bad of [{ ...mark, reason: "ab" }, { ...mark, expected_revision: 0 }, { ...mark, confirmations: {} }, { ...mark, text: "x" }, { ...mark, correction_id: COR }])
    assert.equal(normalizeDatesExternalProxyBody("dates_external_event_command", bad), null, JSON.stringify(bad).slice(0, 80));
  // A status-only correction is approved by `cancel` or `official_update` with its id; no other command takes one.
  const command = { external_event_id: XEV, expected_revision: 1, reason: "Organizer confirmed", idempotency_key: KEY };
  assert.ok(normalizeDatesExternalProxyBody("dates_external_event_command", { ...command, action: "cancel", correction_id: COR }));
  assert.ok(normalizeDatesExternalProxyBody("dates_external_event_command", { ...command, action: "official_update", text: "Postponed to November.", correction_id: COR }));
  for (const action of ["withdraw", "reverify"])
    assert.equal(normalizeDatesExternalProxyBody("dates_external_event_command", { ...command, action, correction_id: COR,
      ...(action === "reverify" ? { confirmations: { source: true, public_venue: true, timezone: true, content_safe: true } } : {}) }), null, action);
  assert.equal(normalizeDatesExternalProxyBody("dates_external_event_command", { ...command, action: "cancel", correction_id: XEV }), null);
  for (const reviewed of ["", "true", "false"]) assert.ok(normalizeDatesExternalProxyBody("dates_external_event_list", { page: 1, limit: 40, reviewed }), reviewed);
  for (const reviewed of [true, "yes", "1"]) assert.equal(normalizeDatesExternalProxyBody("dates_external_event_list", { page: 1, reviewed }), null, String(reviewed));
  const event = genuine("webadmin-external-detail").event.editor_input;
  event.confirmations = { source: true, public_venue: true, timezone: true, content_safe: true };
  const update = { event, reason: "Approved correction", idempotency_key: KEY, external_event_id: XEV, expected_revision: 1 };
  assert.ok(normalizeDatesExternalProxyBody("dates_external_event_update", { ...update, correction_id: COR }));
  assert.equal(normalizeDatesExternalProxyBody("dates_external_event_update", { ...update, correction_id: XEV }), null);
  const { external_event_id: _id, expected_revision: _revision, ...publish } = update;
  assert.equal(normalizeDatesExternalProxyBody("dates_external_event_publish", { ...publish, correction_id: COR }), null, "only an update approves a correction");
});

test("list v2 (genuine): the review fields and the whole last job are read; the released list decodes without them; damage fails the page", () => {
  const notReviewed = decodeDatesExternalList(genuine("webadmin-external-list-not-reviewed"), { page: 1, limit: 40 })!;
  assert.deepEqual(notReviewed.events[0].admin_review, { reviewed: false, by: null, at: null });
  assert.equal(notReviewed.events[0].open_corrections, 1); assert.equal(notReviewed.events[0].open_reports, 1);
  const reviewed = decodeDatesExternalList(genuine("webadmin-external-list-reviewed"), { page: 1, limit: 40 })!;
  assert.deepEqual(reviewed.events[0].admin_review, { reviewed: true, by: "admin@example.test", at: 1790000000 });
  const recheck = decodeDatesExternalList(genuine("webadmin-external-list-recheck"), { page: 1, limit: 40 })!;
  assert.equal(recheck.events[0].last_recheck?.status, "applied"); assert.deepEqual(recheck.events[0].last_recheck?.changes[0].field, "start_at");
  assert.equal(decodeDatesExternalList(genuine("webadmin-external-list-released"), { page: 1, limit: 40 })!.events[0].admin_review, undefined);
  // DERIVED from the genuine bodies: each contradiction fails the page (a list is all-or-nothing).
  const broken: Array<[string, (row: any) => void]> = [
    ["not-reviewed", (r) => { r.admin_review = { reviewed: true, by: null, at: null }; }], ["not-reviewed", (r) => { r.admin_review.reviewed = "yes"; }],
    ["not-reviewed", (r) => { r.possible_duplicate_of = r.external_event_id; }], ["not-reviewed", (r) => { r.open_corrections = -1; }],
    ["recheck", (r) => { r.last_recheck.finished_at = null; }], ["recheck", (r) => { r.last_recheck.changes = []; }],
    ["recheck", (r) => { r.last_recheck.recheck_id = "job_1"; }], ["recheck", (r) => { r.last_recheck.status = "paused"; }],
    ["not-reviewed", (r) => { r.organizer_name = null; }]];
  for (const [file, change] of broken) {
    const body = genuine(`webadmin-external-list-${file}`); change(body.events[0]);
    assert.equal(decodeDatesExternalList(body, { page: 1, limit: 40 }), null, change.toString());
  }
});

test("detail v2 (genuine): jobs in every state and corrections read row by row; a damaged one never hides the event", () => {
  for (const [file, statuses] of [["queued", ["queued"]], ["running", ["running"]], ["applied", ["applied"]], ["no-change", ["no_change", "applied"]],
    ["failed", ["failed", "no_change", "applied"]]] as const) {
    const detail = decodeDatesExternalDetail(genuine(`webadmin-external-detail-recheck-${file}`), XEV6)!;
    assert.ok(detail, file);
    const jobs = datesExternalRechecks(detail.event, detail.server_now)!;
    assert.deepEqual(jobs.rows.map((job) => job.status), statuses, file); assert.deepEqual(jobs.unreadable, [], file);
  }
  const detail = decodeDatesExternalDetail(genuine("webadmin-external-detail"), XEV)!;
  const corrections = datesExternalCorrections(detail.event, detail.server_now)!;
  assert.deepEqual(corrections.rows.map((row) => `${row.correction_id.slice(-1)}:${row.status}`), ["1:pending", "3:pending", "2:rejected"]);
  assert.deepEqual(corrections.unreadable, []); assert.deepEqual(corrections.rows[1].proposed, {}, "a note-only correction: an empty object");
  const released = decodeDatesExternalDetail(genuine("webadmin-external-detail-released"), XEV)!;
  assert.equal(datesExternalRechecks(released.event, released.server_now), null); assert.equal(datesExternalCorrections(released.event, released.server_now), null);
  // DERIVED: damaged jobs and corrections are listed as unreadable; the event and its editor stay.
  const body = genuine("webadmin-external-detail-recheck-failed");
  body.event.rechecks[1].status = "running";                 // open with a finish time
  body.event.rechecks[2].changes = [];                       // applied, yet nothing changed
  const damaged = decodeDatesExternalDetail(body, XEV6)!;
  assert.ok(damaged); assert.deepEqual(datesExternalRechecks(damaged.event, damaged.server_now)!.unreadable.map((row) => row.index), [1, 2]);
  const corrected = genuine("webadmin-external-detail");
  corrected.event.corrections[0].decided_at = 1790000000;    // pending, yet decided
  corrected.event.corrections.push(copy(corrected.event.corrections[2])); // duplicate id: both unreadable
  corrected.event.corrections[1].proposed = [];              // an array where an object is named
  assert.deepEqual(datesExternalCorrections(decodeDatesExternalDetail(corrected, XEV)!.event, 1790000000)!.unreadable.map((row) => row.index), [0, 1, 2, 3]);
  const stale = genuine("webadmin-external-detail"); stale.event.admin_review = { reviewed: true, by: "a@example.test", at: 1790000000, at_revision: 2 };
  assert.equal(decodeDatesExternalDetail(stale, XEV), null, "a mark cannot be set at a revision the event has not reached");
});

test("the corrections queue (genuine): page binding, filtered status, per-row tolerance", () => {
  const list = decodeDatesExternalCorrectionList(genuine("webadmin-correction-list-pending"), { page: 1, status: "pending" })!;
  assert.equal(list.rows.length, 3); assert.equal(list.total, 12); assert.equal(list.limit, 3); assert.deepEqual(list.unreadable, []);
  assert.equal(decodeDatesExternalCorrectionList(genuine("webadmin-correction-list-pending"), { page: 2, status: "pending" }), null);
  assert.equal(decodeDatesExternalCorrectionList(genuine("webadmin-correction-list-pending"), { page: 1, status: "approved" })!.unreadable.length, 3, "rows of another status");
  for (const [file, status] of [["approved", "approved"], ["rejected", "rejected"]] as const) {
    const value = genuine(`webadmin-correction-list-${file}`), read = decodeDatesExternalCorrectionList(value, { page: value.page, status })!;
    assert.deepEqual(read.unreadable, []); assert.ok(read.rows.every((row) => row.decided_at !== null && row.decided_by !== null));
  }
  // DERIVED: a damaged row is unreadable, its neighbours stay.
  const body = genuine("webadmin-correction-list-pending");
  body.corrections[1].proposed = { status: "moved" }; body.corrections[2].created_at = 1790000001;
  const read = decodeDatesExternalCorrectionList(body, { page: 1, status: "pending" })!;
  assert.deepEqual(read.rows.map((row) => row.correction_id), [COR]); assert.deepEqual(read.unreadable.map((row) => row.index), [1, 2]);
});

test("receipts bind to what was asked (genuine): re-research, decision, mark, approving edit, cancellation and official update", () => {
  const recheck = { external_event_id: XEV6, idempotency_key: KEY, instructions: "Check the start time on the organizer's own page." };
  const queued = genuine("webadmin-recheck-queued");
  assert.equal(queued.status, 200, "the legacy envelope keeps its own status: the job is nested");
  assert.deepEqual(decodeDatesExternalRecheckReceipt(queued, recheck), { recheck_id: queued.recheck.recheck_id, status: "queued", replayed: false });
  assert.equal(decodeDatesExternalRecheckReceipt(genuine("webadmin-recheck-queued-replay"), recheck)?.replayed, true);
  assert.equal(decodeDatesExternalRecheckReceipt(queued, { ...recheck, external_event_id: XEV }), null);
  assert.equal(decodeDatesExternalRecheckReceipt({ ...queued, recheck: { ...queued.recheck, status: "running" } }, recheck), null, "a new job is queued");
  const decide = { correction_id: "cor_00000000000000000000000000000002", decision: "reject", reason_code: "not_accurate", idempotency_key: KEY };
  const rejected = genuine("webadmin-correction-decide-reject");
  assert.deepEqual(decodeDatesExternalCorrectionDecision(rejected, decide), { correction_id: decide.correction_id, status: "rejected" });
  assert.ok(decodeDatesExternalCorrectionDecision(genuine("webadmin-correction-decide-reject-replay"), decide));
  assert.equal(decodeDatesExternalCorrectionDecision({ ...rejected, correction_status: "approved" }, decide), null);
  assert.equal(decodeDatesExternalCorrectionDecision(rejected, { ...decide, correction_id: COR }), null);
  const target = { external_event_id: XEV, activity_id: ACT, revision: 1, status: "published" as const };
  const mark = { external_event_id: XEV, expected_revision: 1, action: "mark_reviewed", idempotency_key: KEY };
  assert.equal(decodeDatesExternalReviewReceipt(genuine("webadmin-command-mark-reviewed"), mark, target), true);
  assert.equal(decodeDatesExternalReviewReceipt(genuine("webadmin-command-mark-reviewed"), { ...mark, action: "clear_reviewed" }, target), false, "the other action");
  assert.equal(decodeDatesExternalReviewReceipt(genuine("webadmin-command-mark-reviewed"), { ...mark, expected_revision: 2 }, target), false);
  const { admin_review: _review, ...bare } = genuine("webadmin-command-mark-reviewed");
  assert.equal(decodeDatesExternalReviewReceipt(bare, mark, target), false, "the receipt says what the mark is now");
  // Approvals: the receipt names the correction it approved, and only when one was sent.
  for (const [file, action, extra] of [["update-with-correction", "dates_external_event_update", {}], ["command-cancel-with-correction", "dates_external_event_command", { action: "cancel" }],
    ["command-official-update-with-correction", "dates_external_event_command", { action: "official_update" }]] as const) {
    const value = genuine(`webadmin-${file}`), correction = value.correction.correction_id;
    const baseline = { external_event_id: value.external_event_id, activity_id: value.activity_id, revision: value.revision - 1, activity_revision: value.activity_revision - 1,
      status: "published" as const, lifecycle: "active" as const, soft_deleted: false };
    const body = { external_event_id: value.external_event_id, expected_revision: value.revision - 1, ...extra, correction_id: correction };
    assert.ok(decodeDatesExternalReceipt(value, action, body, baseline), file);
    assert.equal(decodeDatesExternalReceipt(value, action, { ...body, correction_id: "cor_" + "9".repeat(32) }, baseline), null, `${file}: another correction`);
    const { correction_id: _c, ...plain } = body;
    assert.equal(decodeDatesExternalReceipt(value, action, plain, baseline), null, `${file}: a change without a correction approves none`);
    const { correction: _r, ...unapproved } = value;
    assert.equal(decodeDatesExternalReceipt(unapproved, action, body, baseline), null, `${file}: an approval says so`);
  }
});

test("refusals (genuine): the no-write tokens settle a request; capability and contract refusals do not; each has words", () => {
  for (const name of ["recheck-open-denied", "recheck-budget-paused-denied", "recheck-unavailable-denied", "recheck-instructions-denied", "correction-decide-state-denied",
    "update-with-correction-no-change-denied", "command-withdraw-with-correction-denied", "update-with-correction-state-denied", "update-with-correction-other-event-denied"]) {
    const refusal = datesExternalRefusal(genuine(`webadmin-${name}`));
    assert.equal(refusal.kind, "refused", name); assert.notEqual(datesExternalReviewRefusalKey(refusal.error), "other", name);
  }
  for (const name of ["recheck-moderator-denied", "recheck-selector-denied"]) assert.equal(datesExternalRefusal(genuine(`webadmin-${name}`)).kind, "uncertain", name);
  assert.equal(datesExternalRefusal({ ...genuine("webadmin-recheck-open-denied"), status_code: 503 }).kind, "uncertain");
  assert.equal(datesExternalReviewRefusalKey("something-new"), "other"); assert.equal(datesExternalReviewRefusalKey(null), "other");
});

function memoryStorage() {
  const map = new Map<string, string>();
  return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
}

test("re-research keeps its identity: saved before sending, the same key after a lost answer, cleared by a receipt or a no-write refusal", async () => {
  const storage = memoryStorage(), actor = "operator@example.test";
  const pending = prepareDatesExternalRecheck(actor, XEV6, "Check the start time on the organizer's own page.", 1790000000)!;
  assert.ok(pending); assert.match(pending.body.idempotency_key, /^dates-external-recheck:/);
  assert.equal(prepareDatesExternalRecheck(actor, XEV6, "é".repeat(1001), 1790000000), null);
  assert.equal(Object.hasOwn(prepareDatesExternalRecheck(actor, XEV6, "   ", 1790000000)!.body, "instructions"), false, "blank instructions are not sent");
  const sent: Array<Record<string, unknown>> = [];
  assert.deepEqual(await runDatesExternalRecheck(async (action, body) => { sent.push({ action, ...body }); throw new Error("network"); }, storage, pending), { kind: "uncertain", error: null });
  const saved = readDatesExternalRecheckPending(storage, actor, XEV6);
  assert.equal(saved.kind, "pending"); assert.deepEqual(saved.kind === "pending" && saved.pending, pending);
  assert.equal((await runDatesExternalRecheck(async () => ({ success: false, status_code: 502, error: "core-unavailable" }), storage, pending)).kind, "uncertain");
  assert.equal((await runDatesExternalRecheck(async () => genuine("webadmin-recheck-moderator-denied"), storage, pending)).kind, "uncertain", "a capability refusal proves nothing");
  assert.equal(readDatesExternalRecheckPending(storage, actor, XEV6).kind, "pending");
  const other = prepareDatesExternalRecheck(actor, XEV6, "", 1790000000)!;
  assert.deepEqual(await runDatesExternalRecheck(async () => genuine("webadmin-recheck-queued"), storage, other), { kind: "blocked" }, "a second request waits for the first");
  const done = await runDatesExternalRecheck(async (action, body) => { sent.push({ action, ...body }); return genuine("webadmin-recheck-queued-replay"); }, storage, pending);
  assert.equal(done.kind, "success"); assert.equal(readDatesExternalRecheckPending(storage, actor, XEV6).kind, "empty");
  assert.deepEqual(sent.map((item) => item.idempotency_key), [pending.body.idempotency_key, pending.body.idempotency_key], "the retry is the same request");
  for (const name of ["recheck-open-denied", "recheck-budget-paused-denied", "recheck-unavailable-denied", "recheck-instructions-denied"]) {
    const next = prepareDatesExternalRecheck(actor, XEV6, "", 1790000000)!;
    assert.equal((await runDatesExternalRecheck(async () => genuine(`webadmin-${name}`), storage, next)).kind, "refused", name);
    assert.equal(readDatesExternalRecheckPending(storage, actor, XEV6).kind, "empty", name);
  }
  storage.setItem(`friending:dates-external:recheck:v1:${encodeURIComponent(actor)}:${XEV6}`, "{not json");
  assert.equal(readDatesExternalRecheckPending(storage, actor, XEV6).kind, "blocked", "unreadable evidence blocks, it is never cleared silently");
  assert.deepEqual(await runDatesExternalRecheck(async () => genuine("webadmin-recheck-queued"), storage, pending), { kind: "blocked" });
  assert.equal(readDatesExternalRecheckPending(null, actor, XEV6).kind, "blocked");
});

test("review marks and rejections are revision- or state-fenced: a new key each time, every readable refusal answers", async () => {
  const target = { external_event_id: XEV, activity_id: ACT, revision: 1, status: "published" as const };
  const first = datesExternalReviewRequest(target, "mark_reviewed"), second = datesExternalReviewRequest(target, "mark_reviewed");
  assert.notEqual(first.idempotency_key, second.idempotency_key); assert.equal(Object.hasOwn(first, "reason"), false);
  assert.equal(datesExternalReviewRequest(target, "clear_reviewed", "  Needs another look ").reason, "Needs another look");
  assert.deepEqual(await runDatesExternalReview(async () => genuine("webadmin-command-mark-reviewed"), target, first), { kind: "success" });
  assert.deepEqual(await runDatesExternalReview(async () => genuine("webadmin-command-mark-reviewed-state-denied"), target, first),
    { kind: "refused", error: "dates-external-command-state-invalid" });
  assert.equal((await runDatesExternalReview(async () => genuine("webadmin-command-mark-reviewed-moderator-denied"), target, first)).kind, "refused", "fresh: a readable refusal below 500 answers");
  assert.deepEqual(await runDatesExternalReview(async () => { throw new Error("lost"); }, target, first), { kind: "uncertain", error: null });
  const reject = datesExternalCorrectionRejectRequest("cor_00000000000000000000000000000002", "not_accurate", "");
  assert.equal(Object.hasOwn(reject, "note"), false); assert.ok(normalizeDatesExternalProxyBody("dates_external_correction_decide", reject));
  assert.deepEqual(await runDatesExternalCorrectionReject(async () => genuine("webadmin-correction-decide-reject"), reject), { kind: "success" });
  assert.deepEqual(await runDatesExternalCorrectionReject(async () => genuine("webadmin-correction-decide-state-denied"), reject), { kind: "refused", error: "dates-correction-state-invalid" });
  // The durable publication journal never holds a review mark.
  const baseline = { external_event_id: XEV, activity_id: ACT, revision: 1, activity_revision: 1, status: "published", lifecycle: "active", soft_deleted: false };
  assert.equal(decodeDatesExternalPending({ version: 1, actor: "operator@example.test", issued_at: 1790000000, action: "dates_external_event_command", body: first, baseline },
    "operator@example.test"), null);
});

test("approve and edit (genuine corrections): proposed facts reach the editor or its hints; the checks stay fresh", () => {
  const detail = decodeDatesExternalDetail(genuine("webadmin-external-detail"), XEV)!;
  const rows = datesExternalCorrections(detail.event, detail.server_now)!.rows;
  const facts = datesExternalCorrectionPrefill(detail.event.editor_input, rows[0]);
  assert.deepEqual(facts.applied, ["title", "starts_local"]); assert.equal(facts.venue, rows[0].proposed.venue); assert.equal(facts.status, null);
  assert.equal(facts.draft.title, "Community jazz concert"); assert.equal(facts.draft.startLocal, "2026-10-31T16:43:00"); assert.equal(facts.draft.startOffset, "+01:00");
  assert.equal(facts.draft.venueName, detail.event.editor_input.venue.name, "free text never replaces the resolved venue");
  assert.deepEqual([facts.draft.confirmSource, facts.draft.confirmPublicVenue, facts.draft.confirmTimezone, facts.draft.confirmContentSafe], [false, false, false, false]);
  const status = datesExternalCorrectionPrefill(detail.event.editor_input, rows[2]);
  assert.equal(status.status, "postponed"); assert.deepEqual(status.applied, ["ends_local", "official_url"]);
  assert.equal(status.draft.endLocal, ""); assert.equal(status.draft.officialUrl, "https://orchestra.example.test/concert-1-new");
  const note = datesExternalCorrectionPrefill(detail.event.editor_input, rows[1]);
  assert.deepEqual([note.applied, note.unapplied, note.venue, note.status], [[], [], null, null], "a note-only correction prefills nothing");
  assert.equal(datesExternalOffsetForLocal("2026-03-29T02:30", "Europe/Budapest"), "", "DST gap");
  assert.equal(datesExternalOffsetForLocal("2026-10-25T02:30", "Europe/Budapest"), "", "repeated hour");
  assert.equal(datesExternalOffsetForLocal("2026-07-15T20:00", "America/Los_Angeles"), "-07:00");
});

/**
 * DERIVED (no genuine console body has one yet): Core-B's genuine detail of an administrator's event, turned into a
 * research event whose page stated no organizer and no free/paid status, exactly as Core serves one
 * (docs/DATES_EXTERNAL_ADMIN_V1.md "Unknown organizer and price").
 */
function researchUnknown(body = genuine("webadmin-external-detail")) {
  const event = body.event;
  event.credit_channel = "ai_research"; event.credit = { channel: "ai_research", submitted_by_uid: null, anonymous: true, first_submitter_uid: null };
  event.organizer_name = null; event.organizer.name = null; event.editor_input.organizer.name = null;
  event.facts.is_free = null; event.facts.price_text = null; event.editor_input.is_free = null; event.editor_input.price_text = null;
  return body;
}

test("unknown organizer and price: read on a research event, refused on a manual one, and saved back only by an update", () => {
  const detail = decodeDatesExternalDetail(researchUnknown(), XEV)!;
  assert.ok(detail); assert.equal(detail.event.organizer.name, null); assert.equal(detail.event.facts.is_free, null);
  const manual = researchUnknown(); manual.event.credit_channel = "admin"; manual.event.credit = genuine("webadmin-external-detail").event.credit;
  assert.equal(decodeDatesExternalDetail(manual, XEV), null, "a manual event never has unknown facts");
  const priced = researchUnknown(); priced.event.facts.price_text = "2000 Ft"; priced.event.editor_input.price_text = "2000 Ft";
  assert.equal(decodeDatesExternalDetail(priced, XEV), null, "an unknown free/paid status has no price text");
  const list = genuine("webadmin-external-list-not-reviewed"); const row = list.events[0];
  row.credit_channel = "ai_research"; row.organizer_name = null;
  assert.equal(decodeDatesExternalList(list, { page: 1, limit: 40 })!.events[0].organizer_name, null);
  assert.ok(normalizeDatesExternalEditorInput(detail.event.editor_input), "the editor seed reads");
  // The editor: unknown only where it is allowed; a research edit may save it back unchanged.
  const draft = datesExternalDraft(detail.event.editor_input);
  assert.equal(draft.organizerUnknown, true); assert.equal(draft.freeUnknown, true);
  Object.assign(draft, { confirmSource: true, confirmPublicVenue: true, confirmTimezone: true, confirmContentSafe: true, officialUrl: "" });
  const saved = datesExternalDraftInput(draft, true);
  assert.ok(saved.ok); assert.equal(saved.ok && saved.event.organizer.name, null); assert.equal(saved.ok && saved.event.is_free, null);
  assert.equal(saved.ok && saved.event.price_text, null); assert.equal(saved.ok && saved.event.links.official_url, null, "an unknown price needs no official link");
  assert.deepEqual(datesExternalDraftInput(draft, false), { ok: false, error: "facts" }, "a manual event still needs both");
  const update = { event: saved.ok && saved.event, reason: "Kept unknown", idempotency_key: KEY, external_event_id: XEV, expected_revision: 1 };
  assert.ok(normalizeDatesExternalProxyBody("dates_external_event_update", update));
  const { external_event_id: _id, expected_revision: _revision, ...publish } = update;
  assert.equal(normalizeDatesExternalProxyBody("dates_external_event_publish", publish), null, "a publication is manual: both are needed");
  assert.equal(normalizeDatesExternalManualEvent({ ...(saved.ok && saved.event), is_free: false }, true), null, "a known paid event still needs its official link");
});

test("W5 (genuine): the system's closure is read on the intake list, the intake detail and the run's candidates", () => {
  const list = genuine("webadmin-intake-list-system-closure");
  const queue = projectDatesIntakeQueue(list, { page: list.page, limit: list.limit })!;
  assert.deepEqual(queue.intakes[0].system_closure, { decision: "research_not_publishable", blocker: "canceled-or-postponed" });
  assert.deepEqual(queue.intakes[0].unreadable_fields, []);
  const released = genuine("webadmin-intake-list-system-closure-released");
  assert.equal(Object.hasOwn(projectDatesIntakeQueue(released, { page: released.page, limit: released.limit })!.intakes[0], "system_closure"), false, "absent: not served");
  const detail = projectDatesIntakeDetail(genuine("webadmin-intake-detail-system-closure"), "xin_00000000000000000000000000000001")!;
  assert.deepEqual(detail.intake.system_closure, { decision: "research_not_publishable", blocker: "canceled-or-postponed" }); assert.deepEqual(detail.intake.unreadable_sections, []);
  const duplicate = genuine("webadmin-intake-detail-system-duplicate");
  assert.deepEqual(projectDatesIntakeDetail(duplicate, duplicate.intake.intake_id)!.intake.system_closure, { decision: "duplicate", blocker: "duplicate" });
  const run = decodeResearchRunDetail(genuine("webadmin-research-run-detail-system-closure"), "rru_00000000000000000000000000000001")!;
  assert.deepEqual(run.candidates!.rows.map((row) => row.system_closure?.decision ?? null), [null, "research_not_publishable", "duplicate"]);
  assert.deepEqual(run.candidates!.unreadable, []);
  // DERIVED: an unreadable closure is named, never read as "not closed"; the writer's own codes pass as written.
  const odd = copy(list); odd.intakes[0].system_closure = { decision: "closed", blocker: "x" };
  const oddRow = projectDatesIntakeQueue(odd, { page: odd.page, limit: odd.limit })!.intakes[0];
  assert.equal(oddRow.system_closure, null); assert.deepEqual(oddRow.unreadable_fields, ["system_closure"]);
  assert.deepEqual(decodeDatesSystemClosure({ decision: "research_not_publishable", blocker: "dates-external-paid-official-link-required" }),
    { decision: "research_not_publishable", blocker: "dates-external-paid-official-link-required" });
  for (const bad of [{ decision: "duplicate", blocker: "sensitive" }, { decision: "research_not_publishable", blocker: "x".repeat(97) }, [], "duplicate"])
    assert.equal(decodeDatesSystemClosure(bad), null, JSON.stringify(bad));
});
