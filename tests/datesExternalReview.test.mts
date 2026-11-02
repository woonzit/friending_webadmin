import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { isAdminActionAllowed, adminActionAccess } from "../lib/adminActions.ts";
import { isAdminClientReadAction } from "../lib/adminClientReadActions.ts";
import { DATES_EXTERNAL_ADMIN_V2_ROUTES, datesExternalAdminContractParams, withDatesAdminContract } from "../lib/datesAdminContract.ts";
import { DATES_ADMIN_NAMED, projectDatesAdminBody } from "../lib/datesAdminProjection.ts";
import {
  DATES_EXTERNAL_ACTIONS, datesExternalCorrections, datesExternalProxyCapabilityAuthorized,
  datesExternalRechecks, datesExternalRefusal, decodeDatesExternalCorrectionDecision, decodeDatesExternalCorrectionList,
  decodeDatesExternalDetail, decodeDatesExternalList, decodeDatesExternalRecheckReceipt, decodeDatesExternalReceipt,
  decodeDatesExternalReviewReceipt, normalizeDatesExternalProxyBody,
} from "../lib/datesExternalAdmin.ts";
import { decodeDatesExternalPending } from "../lib/datesExternalMutations.ts";
import {
  datesExternalCorrectionPrefill, datesExternalCorrectionRejectRequest, datesExternalOffsetForLocal, datesExternalReviewRefusalKey,
  datesExternalReviewRequest, prepareDatesExternalRecheck, readDatesExternalRecheckPending,
  runDatesExternalCorrectionReject, runDatesExternalRecheck, runDatesExternalReview,
} from "../lib/datesExternalReview.ts";

// D-149 (T-908). The bodies are PROVISIONAL (tests/fixtures/dates_external_autopub_admin_wire_provisional/provenance.txt):
// written from the specification until Core-B's genuine admin bodies are vendored. Released P1 bodies are genuine.
const PROVISIONAL = new URL("./fixtures/dates_external_autopub_admin_wire_provisional/", import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, PROVISIONAL), "utf8"));
const released = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/dates_external_admin_wire/${name}.json`, import.meta.url), "utf8"));
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const XEV = "xev_00000000000000000000000000000001", ACT = "act_00000000000000000000000000000001", COR = "cor_" + "1".padStart(32, "0");
const KEY = "dates-external-test:00000000-0000-4000-8000-000000000001";
const ROUTES: Record<string, string> = {
  "admin-list-v2": "dates_external_event_list", "admin-list-v2-reviewed": "dates_external_event_list", "admin-detail-v2": "dates_external_event_detail",
  "admin-recheck-queued": "dates_external_event_recheck", "admin-correction-list-pending": "dates_external_correction_list",
  "admin-correction-decide-rejected": "dates_external_correction_decide", "admin-command-mark-reviewed": "dates_external_event_command",
  "admin-command-clear-reviewed": "dates_external_event_command", "admin-update-correction-approved": "dates_external_event_update",
};

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
  assert.equal(datesExternalProxyCapabilityAuthorized("dates_external_correction_list", member(["dates_external_event_read"])), true);
  for (const action of ["dates_external_event_recheck", "dates_external_correction_decide"]) {
    assert.equal(datesExternalProxyCapabilityAuthorized(action, member(["dates_external_event_read"])), false, action);
    assert.equal(datesExternalProxyCapabilityAuthorized(action, member(["dates_external_event_read", "dates_external_event_manage"])), true, action);
  }
});

test("the v2 selector goes with the external / correction routes only, and the browser cannot set or unset it", () => {
  assert.deepEqual([...DATES_EXTERNAL_ADMIN_V2_ROUTES].sort(), ["dates_external_correction_decide", "dates_external_correction_list", "dates_external_event_command",
    "dates_external_event_detail", "dates_external_event_list", "dates_external_event_recheck", "dates_external_event_update"]);
  for (const action of DATES_EXTERNAL_ADMIN_V2_ROUTES) assert.deepEqual(datesExternalAdminContractParams(action), { dates_external_admin_contract_version: 2 });
  for (const action of ["dates_external_event_publish", "dates_external_event_place_search", "dates_activity_detail", "dates_event_intake_list", "users_list"])
    assert.deepEqual(datesExternalAdminContractParams(action), {}, action);
  const merged = Object.assign(Object.create(null), { external_event_id: XEV, dates_external_admin_contract_version: 9, admin_email: "operator@example.test" });
  assert.equal(withDatesAdminContract("dates_external_event_recheck", merged).dates_external_admin_contract_version, 2);
  const unset = Object.assign(Object.create(null), { page: 1, admin_email: "operator@example.test" });
  assert.equal(Object.hasOwn(withDatesAdminContract("dates_external_event_publish", unset), "dates_external_admin_contract_version"), false);
});

test("closed browser requests: re-research, corrections queue and decision, review marks, the reviewed filter, an approving update", () => {
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
  assert.ok(normalizeDatesExternalProxyBody("dates_external_correction_decide", { ...decide, note: "Checked the organizer page." }));
  assert.ok(normalizeDatesExternalProxyBody("dates_external_correction_decide", { ...decide, reason_code: "a_core_code_the_console_does_not_list" }), "Core owns the vocabulary");
  for (const bad of [{ ...decide, decision: "approve" }, { ...decide, reason_code: "Not Accurate" }, { ...decide, note: "" }, { ...decide, correction_id: XEV },
    { ...decide, expected_revision: 1 }])
    assert.equal(normalizeDatesExternalProxyBody("dates_external_correction_decide", bad), null, JSON.stringify(bad).slice(0, 80));
  const mark = { external_event_id: XEV, expected_revision: 3, action: "mark_reviewed", idempotency_key: KEY };
  assert.ok(normalizeDatesExternalProxyBody("dates_external_event_command", mark));
  assert.ok(normalizeDatesExternalProxyBody("dates_external_event_command", { ...mark, reason: "Facts match the source" }));
  assert.equal(normalizeDatesExternalProxyBody("dates_external_event_command", { ...mark, action: "clear_reviewed" }), null, "clearing needs a reason");
  assert.ok(normalizeDatesExternalProxyBody("dates_external_event_command", { ...mark, action: "clear_reviewed", reason: "Needs another look" }));
  for (const bad of [{ ...mark, reason: "ab" }, { ...mark, expected_revision: 0 }, { ...mark, confirmations: {} }, { ...mark, text: "x" }])
    assert.equal(normalizeDatesExternalProxyBody("dates_external_event_command", bad), null, JSON.stringify(bad).slice(0, 80));
  for (const reviewed of ["", "true", "false"]) assert.ok(normalizeDatesExternalProxyBody("dates_external_event_list", { page: 1, limit: 40, reviewed }), reviewed);
  for (const reviewed of [true, "yes", "1"]) assert.equal(normalizeDatesExternalProxyBody("dates_external_event_list", { page: 1, reviewed }), null, String(reviewed));
  const event = released("admin-detail-admin").event.editor_input;
  event.confirmations = { source: true, public_venue: true, timezone: true, content_safe: true };
  const update = { event, reason: "Approved correction", idempotency_key: KEY, external_event_id: XEV, expected_revision: 1 };
  assert.ok(normalizeDatesExternalProxyBody("dates_external_event_update", { ...update, correction_id: COR }));
  assert.equal(normalizeDatesExternalProxyBody("dates_external_event_update", { ...update, correction_id: XEV }), null);
  const { external_event_id: _id, expected_revision: _revision, ...publish } = update;
  assert.equal(normalizeDatesExternalProxyBody("dates_external_event_publish", { ...publish, correction_id: COR }), null, "only an update approves a correction");
});

test("every provisional success body is its own projection, and an unnamed key is dropped at any depth", () => {
  const files = readdirSync(PROVISIONAL).filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -5));
  assert.equal(files.length, 13);
  for (const name of files) {
    const body = fixture(name);
    if (body.success !== true) {
      assert.deepEqual(projectDatesAdminBody("dates_external_event_recheck", { ...body, debug: "UNNAMED" }), body, name);
      continue;
    }
    const route = ROUTES[name]; assert.ok(route && Object.hasOwn(DATES_ADMIN_NAMED, route), name);
    const lines: string[] = [];
    assert.deepEqual(projectDatesAdminBody(route, body, (line) => lines.push(line)), body, name);
    assert.deepEqual(lines, []);
  }
  const list = fixture("admin-correction-list-pending");
  list.corrections[0].submitter.email = "member@example.test"; list.corrections[0].internal = { secret: "UNNAMED" };
  const sent = JSON.stringify(projectDatesAdminBody("dates_external_correction_list", list));
  assert.equal(sent.includes("member@example.test"), false); assert.equal(sent.includes("UNNAMED"), false);
  const detail = fixture("admin-detail-v2");
  detail.event.rechecks[0].prompt = "provider prompt"; detail.event.rechecks[0].changes[0].raw = { html: "x" };
  assert.equal(JSON.stringify(projectDatesAdminBody("dates_external_event_detail", detail)).includes("provider prompt"), false);
});

test("list v2: the review fields are read and bound; the released list still decodes without them", () => {
  const list = decodeDatesExternalList(fixture("admin-list-v2"), { page: 1, limit: 40 })!;
  assert.ok(list);
  const row = list.events[0];
  assert.deepEqual(row.admin_review, { reviewed: false, by: null, at: null });
  assert.equal(row.possible_duplicate_of, "xev_00000000000000000000000000000002"); assert.equal(row.open_corrections, 1); assert.equal(row.open_reports, 2);
  assert.deepEqual(row.last_recheck, { status: "running", finished_at: null });
  assert.ok(decodeDatesExternalList(fixture("admin-list-v2-reviewed"), { page: 1, limit: 40 }));
  const plain = decodeDatesExternalList(released("admin-list-admin"), { page: 1, limit: 40 })!;
  assert.equal(plain.events[0].admin_review, undefined, "not served: nothing to render");
  const broken: Array<(row: any) => void> = [
    (r) => { r.admin_review = { reviewed: true, by: null, at: null }; }, (r) => { r.admin_review = { reviewed: "yes", by: null, at: null }; },
    (r) => { r.admin_review = { reviewed: true, by: "a@example.test", at: 1790000001 }; }, (r) => { r.possible_duplicate_of = r.external_event_id; },
    (r) => { r.possible_duplicate_of = "act_00000000000000000000000000000002"; }, (r) => { r.open_corrections = -1; }, (r) => { r.open_reports = 1.5; },
    (r) => { r.last_recheck = { status: "running", finished_at: 1789990000 }; }, (r) => { r.last_recheck = { status: "applied", finished_at: null }; },
    (r) => { r.last_recheck = { status: "paused", finished_at: null }; }];
  for (const change of broken) {
    const body = fixture("admin-list-v2"); change(body.events[0]);
    assert.equal(decodeDatesExternalList(body, { page: 1, limit: 40 }), null, change.toString());
  }
});

test("detail v2: jobs and corrections are read row by row; a damaged one never hides the event", () => {
  const detail = decodeDatesExternalDetail(fixture("admin-detail-v2"), XEV)!;
  assert.ok(detail); assert.equal(detail.event.admin_review?.at_revision, 1);
  const jobs = datesExternalRechecks(detail.event, detail.server_now)!;
  assert.deepEqual(jobs.rows.map((job) => job.status), ["applied", "failed", "no_change"]); assert.deepEqual(jobs.unreadable, []);
  assert.deepEqual(jobs.rows[0].changes[1], { field: "is_free", before: false, after: true });
  const corrections = datesExternalCorrections(detail.event, detail.server_now)!;
  assert.deepEqual(corrections.rows.map((row) => row.status), ["pending", "rejected"]);
  const released1 = decodeDatesExternalDetail(released("admin-detail-admin"), XEV)!;
  assert.equal(datesExternalRechecks(released1.event, released1.server_now), null); assert.equal(datesExternalCorrections(released1.event, released1.server_now), null);
  const body = fixture("admin-detail-v2");
  body.event.rechecks[1].status = "running";                       // open with a finish time
  body.event.rechecks[2].changes = [{ field: "title", before: "a", after: "b" }]; // changed nothing, yet a change set
  body.event.corrections[0].decided_at = 1789995000;               // pending, yet decided
  body.event.corrections.push({ ...body.event.corrections[1] });   // duplicate id: both unreadable
  const damaged = decodeDatesExternalDetail(body, XEV)!;
  assert.ok(damaged, "the event and its editor stay");
  assert.deepEqual(datesExternalRechecks(damaged.event, damaged.server_now)!.rows.map((job) => job.status), ["applied"]);
  assert.deepEqual(datesExternalCorrections(damaged.event, damaged.server_now)!.unreadable.map((row) => row.index), [0, 1, 2]);
  const other = fixture("admin-detail-v2"); other.event.corrections[0].external_event_id = "xev_00000000000000000000000000000009";
  assert.deepEqual(datesExternalCorrections(decodeDatesExternalDetail(other, XEV)!.event, 1790000000)!.unreadable.map((row) => row.index), [0], "another event's correction is not shown here");
  const stale = fixture("admin-detail-v2"); stale.event.admin_review.at_revision = 2;
  assert.equal(decodeDatesExternalDetail(stale, XEV), null, "a mark cannot be set at a revision the event has not reached");
});

test("the corrections queue: page binding, per-row tolerance, filtered status and a correction's own rules", () => {
  const list = decodeDatesExternalCorrectionList(fixture("admin-correction-list-pending"), { page: 1, status: "pending" })!;
  assert.equal(list.rows.length, 1); assert.equal(list.total, 1); assert.equal(list.limit, 40);
  assert.equal(list.rows[0].note, "The organizer's page says 18:00.\nNo end time is given.");
  assert.equal(decodeDatesExternalCorrectionList(fixture("admin-correction-list-pending"), { page: 2, status: "pending" }), null);
  assert.equal(decodeDatesExternalCorrectionList({ ...fixture("admin-correction-list-pending"), success: false }, { page: 1, status: "" }), null);
  assert.equal(decodeDatesExternalCorrectionList(fixture("admin-correction-list-pending"), { page: 1, status: "approved" })!.unreadable.length, 1, "a row of another status");
  const body = fixture("admin-correction-list-pending"), row = body.corrections[0];
  body.corrections = [row, { ...row, correction_id: "cor_" + "2".padStart(32, "0"), proposed: {}, note: null }, { ...row, correction_id: "cor_" + "3".padStart(32, "0"), proposed: { status: "moved" } },
    { ...row, correction_id: "cor_" + "4".padStart(32, "0"), created_at: 1790000001 }, { ...row, correction_id: "cor_" + "5".padStart(32, "0"), status: "approved", decided_at: null },
    { ...row, correction_id: "cor_" + "6".padStart(32, "0"), proposed: { title: "Concert", venue: "Main square, Budapest" }, extra_key: true }];
  const decoded = decodeDatesExternalCorrectionList(body, { page: 1, status: "" })!;
  assert.deepEqual(decoded.rows.map((item) => item.correction_id.slice(-1)), ["1", "6"]); assert.deepEqual(decoded.unreadable.map((item) => item.index), [1, 2, 3, 4]);
});

test("receipts bind to what was asked: re-research, decision, review mark, approving update", () => {
  const recheck = { external_event_id: XEV, idempotency_key: KEY };
  const queued = fixture("admin-recheck-queued");
  assert.equal(queued.status, 200, "the legacy envelope keeps its own status: the job's state is nested");
  assert.deepEqual(decodeDatesExternalRecheckReceipt(queued, recheck), { recheck_id: queued.recheck.recheck_id, status: "queued", replayed: false });
  assert.equal(decodeDatesExternalRecheckReceipt(queued, { ...recheck, external_event_id: "xev_" + "9".repeat(32) }), null);
  assert.equal(decodeDatesExternalRecheckReceipt({ ...queued, recheck: { ...queued.recheck, status: "running" } }, recheck), null, "a new job is queued");
  assert.ok(decodeDatesExternalRecheckReceipt({ ...queued, recheck: { ...queued.recheck, status: "running" }, replayed: true }, recheck), "a replay answers with the job as it stands");
  const { recheck: job, ...envelopeOnly } = queued;
  assert.ok(decodeDatesExternalRecheckReceipt({ ...envelopeOnly, recheck_id: job.recheck_id, recheck_status: "queued" }, recheck), "read flat with recheck_status as well");
  assert.equal(decodeDatesExternalRecheckReceipt({ ...envelopeOnly, recheck_id: job.recheck_id, status: "queued" }, recheck), null, "never in place of the envelope's status");
  const decide = { correction_id: COR, decision: "reject", reason_code: "not_accurate", idempotency_key: KEY };
  const rejected = fixture("admin-correction-decide-rejected");
  assert.deepEqual(decodeDatesExternalCorrectionDecision(rejected, decide), { correction_id: COR, status: "rejected" });
  const { correction: _decided, ...decisionEnvelope } = rejected;
  assert.ok(decodeDatesExternalCorrectionDecision({ ...decisionEnvelope, correction_id: COR, correction_status: "rejected" }, decide), "read flat with correction_status as well");
  assert.equal(decodeDatesExternalCorrectionDecision({ ...rejected, correction: { ...rejected.correction, status: "approved" } }, decide), null);
  assert.equal(decodeDatesExternalCorrectionDecision(rejected, { ...decide, correction_id: "cor_" + "2".padStart(32, "0") }), null);
  const target = { external_event_id: XEV, activity_id: ACT, revision: 1, status: "published" as const };
  const mark = { external_event_id: XEV, expected_revision: 1, action: "mark_reviewed", idempotency_key: KEY };
  assert.equal(decodeDatesExternalReviewReceipt(fixture("admin-command-mark-reviewed"), mark, target), true);
  assert.equal(decodeDatesExternalReviewReceipt(fixture("admin-command-clear-reviewed"), { ...mark, action: "clear_reviewed", reason: "Again" }, target), true);
  assert.equal(decodeDatesExternalReviewReceipt(fixture("admin-command-mark-reviewed"), { ...mark, action: "clear_reviewed", reason: "Again" }, target), false, "the other action");
  assert.equal(decodeDatesExternalReviewReceipt({ ...fixture("admin-command-mark-reviewed"), admin_review: { reviewed: false, by: null, at: null } }, mark, target), false);
  assert.equal(decodeDatesExternalReviewReceipt({ ...fixture("admin-command-mark-reviewed"), revision: 3 }, mark, target), false);
  assert.equal(decodeDatesExternalReviewReceipt({ ...fixture("admin-command-mark-reviewed"), event_status: "withdrawn" }, mark, target), false);
  assert.equal(decodeDatesExternalReviewReceipt(fixture("admin-command-mark-reviewed"), { ...mark, expected_revision: 2 }, target), false);
  const { admin_review: _review, ...bare } = fixture("admin-command-mark-reviewed");
  assert.equal(decodeDatesExternalReviewReceipt({ ...bare, revision: 1 }, mark, target), true, "a mark that does not move the revision, without the echo");
  const baseline = { external_event_id: XEV, activity_id: ACT, revision: 1, activity_revision: 1, status: "published" as const, lifecycle: "active" as const, soft_deleted: false };
  const update = { external_event_id: XEV, expected_revision: 1, correction_id: COR };
  assert.ok(decodeDatesExternalReceipt(fixture("admin-update-correction-approved"), "dates_external_event_update", update, baseline));
  assert.equal(decodeDatesExternalReceipt(fixture("admin-update-correction-approved"), "dates_external_event_update", { ...update, correction_id: "cor_" + "2".padStart(32, "0") }, baseline), null);
  assert.equal(decodeDatesExternalReceipt({ ...fixture("admin-update-correction-approved"), correction_status: "pending" }, "dates_external_event_update", update, baseline), null);
  const { correction_id: _c, correction_status: _s, ...plainUpdate } = fixture("admin-update-correction-approved");
  assert.ok(decodeDatesExternalReceipt(plainUpdate, "dates_external_event_update", update, baseline), "a Core that does not echo the correction");
});

test("refusals: the specified tokens settle a request; transport and server failures do not; each has words", () => {
  for (const name of ["admin-recheck-open-denied", "admin-recheck-budget-paused-denied", "admin-recheck-unavailable-denied", "admin-correction-decide-decided-denied"]) {
    const refusal = datesExternalRefusal(fixture(name));
    assert.equal(refusal.kind, "refused", name); assert.notEqual(datesExternalReviewRefusalKey(refusal.error), "other", name);
  }
  assert.equal(datesExternalRefusal({ success: false, status_code: 503, error: "dates-recheck-open", message: 200, status: 200, can_send: 0 }).kind, "uncertain");
  assert.equal(datesExternalReviewRefusalKey("something-new"), "other"); assert.equal(datesExternalReviewRefusalKey(null), "other");
});

function memoryStorage() {
  const map = new Map<string, string>();
  return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
}

test("re-research keeps its identity: saved before sending, the same key after a lost answer, cleared by a receipt or a no-write refusal", async () => {
  const storage = memoryStorage(), actor = "operator@example.test";
  const pending = prepareDatesExternalRecheck(actor, XEV, "Check the venue page.", 1790000000)!;
  assert.ok(pending); assert.match(pending.body.idempotency_key, /^dates-external-recheck:/);
  assert.equal(prepareDatesExternalRecheck(actor, XEV, "é".repeat(1001), 1790000000), null);
  assert.equal(Object.hasOwn(prepareDatesExternalRecheck(actor, XEV, "   ", 1790000000)!.body, "instructions"), false, "blank instructions are not sent");
  const sent: Array<Record<string, unknown>> = [];
  const lost = await runDatesExternalRecheck(async (action, body) => { sent.push({ action, ...body }); throw new Error("network"); }, storage, pending);
  assert.deepEqual(lost, { kind: "uncertain", error: null });
  const saved = readDatesExternalRecheckPending(storage, actor, XEV);
  assert.equal(saved.kind, "pending"); assert.deepEqual(saved.kind === "pending" && saved.pending, pending);
  const server = await runDatesExternalRecheck(async () => ({ success: false, status_code: 502, error: "core-unavailable" }), storage, pending);
  assert.equal(server.kind, "uncertain"); assert.equal(readDatesExternalRecheckPending(storage, actor, XEV).kind, "pending");
  const other = prepareDatesExternalRecheck(actor, XEV, "", 1790000000)!;
  assert.deepEqual(await runDatesExternalRecheck(async () => fixture("admin-recheck-queued"), storage, other), { kind: "blocked" }, "a second request waits for the first");
  const done = await runDatesExternalRecheck(async (action, body) => { sent.push({ action, ...body }); return fixture("admin-recheck-queued"); }, storage, pending);
  assert.equal(done.kind, "success"); assert.equal(readDatesExternalRecheckPending(storage, actor, XEV).kind, "empty");
  assert.deepEqual(sent.map((item) => item.idempotency_key), [pending.body.idempotency_key, pending.body.idempotency_key], "the retry is the same request");
  assert.deepEqual(sent.map((item) => item.action), ["dates_external_event_recheck", "dates_external_event_recheck"]);
  for (const name of ["admin-recheck-open-denied", "admin-recheck-budget-paused-denied", "admin-recheck-unavailable-denied"]) {
    const next = prepareDatesExternalRecheck(actor, XEV, "", 1790000000)!;
    const refused = await runDatesExternalRecheck(async () => fixture(name), storage, next);
    assert.equal(refused.kind, "refused", name); assert.equal(readDatesExternalRecheckPending(storage, actor, XEV).kind, "empty", name);
  }
  storage.map.set([...storage.map.keys()][0] ?? `friending:dates-external:recheck:v1:${encodeURIComponent(actor)}:${XEV}`, "{not json");
  storage.setItem(`friending:dates-external:recheck:v1:${encodeURIComponent(actor)}:${XEV}`, "{not json");
  assert.equal(readDatesExternalRecheckPending(storage, actor, XEV).kind, "blocked", "unreadable evidence blocks, it is never cleared silently");
  assert.deepEqual(await runDatesExternalRecheck(async () => fixture("admin-recheck-queued"), storage, pending), { kind: "blocked" });
  assert.equal(readDatesExternalRecheckPending(null, actor, XEV).kind, "blocked");
});

test("review marks and correction rejections are revision- or state-fenced: a new key each time, every readable refusal answers", async () => {
  const target = { external_event_id: XEV, activity_id: ACT, revision: 1, status: "published" as const };
  const first = datesExternalReviewRequest(target, "mark_reviewed"), second = datesExternalReviewRequest(target, "mark_reviewed");
  assert.notEqual(first.idempotency_key, second.idempotency_key); assert.equal(Object.hasOwn(first, "reason"), false);
  assert.equal(datesExternalReviewRequest(target, "clear_reviewed", "  Needs another look ").reason, "Needs another look");
  assert.ok(normalizeDatesExternalProxyBody("dates_external_event_command", first));
  const calls: string[] = [];
  assert.deepEqual(await runDatesExternalReview(async (action) => { calls.push(action); return fixture("admin-command-mark-reviewed"); }, target, first), { kind: "success" });
  assert.deepEqual(calls, ["dates_external_event_command"]);
  const stale = { success: false, status_code: 409, error: "dates-admin-stale-revision", message: 200, status: 200, can_send: 0 };
  assert.deepEqual(await runDatesExternalReview(async () => stale, target, first), { kind: "refused", error: "dates-admin-stale-revision" });
  assert.deepEqual(await runDatesExternalReview(async () => { throw new Error("lost"); }, target, first), { kind: "uncertain", error: null });
  assert.equal((await runDatesExternalReview(async () => ({ ...stale, status_code: 500, error: "server-error" }), target, first)).kind, "uncertain");
  assert.equal((await runDatesExternalReview(async () => ({ ...fixture("admin-command-mark-reviewed"), action: "clear_reviewed" }), target, first)).kind, "uncertain", "a receipt that does not bind");
  const reject = datesExternalCorrectionRejectRequest(COR, "not_accurate", "");
  assert.equal(Object.hasOwn(reject, "note"), false); assert.ok(normalizeDatesExternalProxyBody("dates_external_correction_decide", reject));
  assert.deepEqual(await runDatesExternalCorrectionReject(async () => fixture("admin-correction-decide-rejected"), reject), { kind: "success" });
  assert.deepEqual(await runDatesExternalCorrectionReject(async () => fixture("admin-correction-decide-decided-denied"), reject), { kind: "refused", error: "dates-correction-state-invalid" });
  assert.equal((await runDatesExternalCorrectionReject(async () => { throw new Error("lost"); }, reject)).kind, "uncertain");
  // The durable publication journal never holds a review mark.
  const baseline = { external_event_id: XEV, activity_id: ACT, revision: 1, activity_revision: 1, status: "published", lifecycle: "active", soft_deleted: false };
  const journal = { version: 1, actor: "operator@example.test", issued_at: 1790000000, action: "dates_external_event_command", body: first, baseline };
  assert.equal(decodeDatesExternalPending(journal, "operator@example.test"), null);
});

test("approve and edit: the editor is prefilled with the proposed facts; what it cannot take is reported, the checks stay fresh", () => {
  const detail = decodeDatesExternalDetail(fixture("admin-detail-v2"), XEV)!;
  const pending = datesExternalCorrections(detail.event, detail.server_now)!.rows[0];
  const prefill = datesExternalCorrectionPrefill(detail.event.editor_input, pending);
  assert.deepEqual(prefill.applied, ["starts_local", "ends_local", "official_url"]); assert.deepEqual(prefill.unapplied, []);
  assert.equal(prefill.draft.startLocal, "2026-09-23T18:00:00"); assert.equal(prefill.draft.startOffset, "+02:00");
  assert.equal(prefill.draft.endLocal, ""); assert.equal(prefill.draft.endOffset, "", "ends_local null clears the end");
  assert.equal(prefill.draft.officialUrl, "https://orchestra.example.test/concert-2026"); assert.equal(prefill.draft.title, "Közösségi koncert");
  assert.deepEqual([prefill.draft.confirmSource, prefill.draft.confirmPublicVenue, prefill.draft.confirmTimezone, prefill.draft.confirmContentSafe], [false, false, false, false]);
  assert.equal(prefill.venue, null); assert.equal(prefill.status, null);
  const other = { ...pending, proposed: { title: "Közösségi koncert a téren", venue: "Fő tér, Budapest", status: "postponed", official_url: "http://insecure.example.test/" } };
  const second = datesExternalCorrectionPrefill(detail.event.editor_input, other);
  assert.deepEqual(second.applied, ["title"]); assert.deepEqual(second.unapplied, ["official_url"]);
  assert.equal(second.venue, "Fő tér, Budapest"); assert.equal(second.status, "postponed");
  assert.equal(second.draft.officialUrl, detail.event.editor_input.links.official_url, "an http link is shown, not copied in");
  assert.equal(second.draft.venueName, detail.event.editor_input.venue.name, "free text never replaces the resolved venue");
  // The offset of a venue-local wall time: one when it is unique, none in a gap or a repeated hour.
  assert.equal(datesExternalOffsetForLocal("2026-01-15T20:00", "Europe/Budapest"), "+01:00");
  assert.equal(datesExternalOffsetForLocal("2026-07-15T20:00", "Europe/Budapest"), "+02:00");
  assert.equal(datesExternalOffsetForLocal("2026-03-29T02:30", "Europe/Budapest"), "", "DST gap");
  assert.equal(datesExternalOffsetForLocal("2026-10-25T02:30", "Europe/Budapest"), "", "repeated hour");
  assert.equal(datesExternalOffsetForLocal("2026-07-15T20:00", "America/Los_Angeles"), "-07:00");
  assert.equal(datesExternalOffsetForLocal("not a time", "Europe/Budapest"), "");
});
