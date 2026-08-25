import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  adminPrincipalFrom,
  isAdminActionAllowed,
  isAdminActionAuthorized,
} from "../lib/adminActions.ts";
import { REPORTED_CONTENT_CONTRACT_READY } from "../lib/contractReadiness.ts";
import {
  REPORTED_CONTENT_ERROR_KEYS,
  REPORTED_CONTENT_ERROR_STATUSES,
  normalizeReportedContentReason,
  reportedContentActionResponse,
  reportedContentCanDecide,
  reportedContentConflictResponse,
  reportedContentDecisionConverged,
  reportedContentDecisionPayload,
  reportedContentErrorKey,
  reportedContentErrorResponse,
  reportedContentListResponse,
  reportedContentPayloadFromPending,
  reportedContentPendingDecision,
  reportedContentPendingFromPayload,
  reportedContentPendingStorageKey,
  reportedContentReport,
  reportedContentReportConverged,
  reportedContentReportsAreOrdered,
  reportedContentShouldRetainDecision,
} from "../lib/reportedContent.ts";
import {
  ADMIN_REQUEST_HEADER,
  ADMIN_REQUEST_HEADER_VALUE,
  isTrustedAdminRequest,
} from "../lib/requestGuard.ts";

type JsonObject = Record<string, unknown>;

const fixtures = JSON.parse(
  await readFile(new URL("./fixtures/reported_content_contract_v1.json", import.meta.url), "utf8"),
) as Record<string, JsonObject>;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function object(value: unknown): JsonObject {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as JsonObject;
}

function data(value: JsonObject): JsonObject {
  return object(value.data);
}

function reports(value: JsonObject): JsonObject[] {
  return data(value).reports as JsonObject[];
}

function headers(values: Record<string, string>) {
  const normalized = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return { get: (name: string) => normalized.get(name.toLowerCase()) ?? null };
}

test("the accepted version-1 fixtures decode as exact queue, detail, action, and conflict shapes", () => {
  const pending = reportedContentListResponse(fixtures.pending_list);
  assert.ok(pending);
  assert.equal(pending.reports.length, 2);
  assert.equal(pending.reports[0].subject_content.kind, "chat_message");
  assert.equal(pending.next_cursor, "cGVuZGluZy1wYWdlLTI");
  assert.equal(pending.total, 3);

  const detail = reportedContentListResponse(fixtures.exact_detail);
  assert.ok(detail);
  assert.deepEqual(detail.filter, {
    status: "all",
    target_type: "all",
    report_id: "report-user-001",
  });
  assert.equal(detail.reports[0].status, "pending");

  const action = reportedContentActionResponse(fixtures.action_success);
  assert.ok(action);
  assert.equal(action.report.status, "rejected");
  assert.equal(action.report.revision, 2);
  assert.equal(action.replayed, false);

  const conflict = reportedContentConflictResponse(fixtures.conflict);
  assert.ok(conflict);
  assert.equal(conflict.report.status, "confirmed");
});

test("a valid empty result is proven and remains distinct from every malformed read", () => {
  const empty = reportedContentListResponse(fixtures.empty_list);
  assert.ok(empty);
  assert.deepEqual(empty.reports, []);
  assert.equal(empty.next_cursor, null);
  assert.equal(empty.total, 0);

  for (const mutate of [
    (raw: JsonObject) => { data(raw).total = 1; },
    (raw: JsonObject) => { data(raw).next_cursor = "another-page"; },
    (raw: JsonObject) => { delete data(raw).reports; },
    (raw: JsonObject) => { raw.success = false; },
    (raw: JsonObject) => { raw.status_code = 503; },
  ]) {
    const raw = clone(fixtures.empty_list);
    mutate(raw);
    assert.equal(reportedContentListResponse(raw), null, mutate.toString());
  }
});

test("closed envelopes, principals, rows, and safe projections reject every shape surprise", () => {
  const mutations: Array<(raw: JsonObject) => void> = [
    (raw) => { raw.trace_id = "not-contracted"; },
    (raw) => { raw.status_code = "200"; },
    (raw) => { data(raw).contract_version = 2; },
    (raw) => { data(raw).debug = true; },
    (raw) => { delete object(data(raw).filter).report_id; },
    (raw) => { object(data(raw).principal).session_id = "private"; },
    (raw) => { object(data(raw).principal).role = "superadmin"; },
    (raw) => { object(data(raw).principal).capabilities = ["reported_content_read", "unknown"]; },
    (raw) => { object(data(raw).principal).capabilities = ["reported_content_read", "reported_content_read"]; },
    (raw) => { object(data(raw).principal).capabilities = ["reported_content_read", "reported_content_decide"]; },
    (raw) => { object(data(raw).principal).capabilities = []; },
    (raw) => { reports(raw)[0].direct_storage_url = "https://private.example.test/object"; },
    (raw) => { object(reports(raw)[0].reporter).email = "member@example.test"; },
    (raw) => { object(reports(raw)[0].subject).latitude = 47.5; },
    (raw) => { reports(raw)[0].revision = 1.5; },
    (raw) => { reports(raw)[0].created_at = -1; },
    (raw) => { reports(raw)[0].reason_code = "Not Canonical"; },
    (raw) => { reports(raw)[0].reason_text = " trailing "; },
    (raw) => { object(reports(raw)[0].reporter).display_name = "Cafe\u0301"; },
    (raw) => { reports(raw)[0].target_type = "user"; },
    (raw) => { reports(raw)[0].status = "confirmed"; },
    (raw) => { object(reports(raw)[0].subject_content).availability = "removed"; },
    (raw) => { object(reports(raw)[0].subject_content).message_id = null; },
    (raw) => { object(reports(raw)[0].subject_content).sent_at = null; },
    (raw) => { object(reports(raw)[0].subject_content).has_restricted_evidence = 1; },
    (raw) => { object(reports(raw)[1].subject_content).raw_document = {}; },
  ];

  for (const mutate of mutations) {
    const raw = clone(fixtures.pending_list);
    mutate(raw);
    assert.equal(reportedContentListResponse(raw), null, mutate.toString());
  }
  assert.equal(reportedContentListResponse(null), null);
  assert.equal(reportedContentListResponse([]), null);
  assert.equal(reportedContentReport({}), null);

  const removed = clone(fixtures.pending_list);
  const removedContent = object(reports(removed)[0].subject_content);
  removedContent.availability = "removed";
  removedContent.text = "";
  assert.ok(reportedContentListResponse(removed), "removed material retains stable metadata");
  removedContent.message_id = null;
  assert.equal(reportedContentListResponse(removed), null, "removed material needs its stable id");
});

test("filters, uniqueness, ordering, pagination, and exact-detail A1 semantics fail closed", () => {
  const invalidLists: Array<(raw: JsonObject) => void> = [
    (raw) => { reports(raw)[1] = clone(reports(raw)[0]); },
    (raw) => { (data(raw).reports as unknown[]).reverse(); },
    (raw) => { object(data(raw).filter).status = "all"; },
    (raw) => { object(data(raw).filter).target_type = "user"; },
    (raw) => { data(raw).next_cursor = "not+base64url"; },
    (raw) => { data(raw).total = 1; },
    (raw) => { data(raw).total = 2; data(raw).next_cursor = "page-two"; },
  ];
  for (const mutate of invalidLists) {
    const raw = clone(fixtures.pending_list);
    mutate(raw);
    assert.equal(reportedContentListResponse(raw), null, mutate.toString());
  }

  const invalidDetails: Array<(raw: JsonObject) => void> = [
    (raw) => { object(data(raw).filter).status = "pending"; },
    (raw) => { object(data(raw).filter).target_type = "user"; },
    (raw) => { object(data(raw).filter).report_id = "different-report"; },
    (raw) => { data(raw).next_cursor = "unexpected-page"; },
    (raw) => { data(raw).total = 2; },
    (raw) => { (data(raw).reports as unknown[]).push(clone(reports(raw)[0])); },
  ];
  for (const mutate of invalidDetails) {
    const raw = clone(fixtures.exact_detail);
    mutate(raw);
    assert.equal(reportedContentListResponse(raw), null, mutate.toString());
  }

  const missing = clone(fixtures.exact_detail);
  data(missing).reports = [];
  data(missing).total = 0;
  const parsedMissing = reportedContentListResponse(missing);
  assert.ok(parsedMissing);
  assert.deepEqual(parsedMissing.reports, []);

  const pending = reportedContentListResponse(fixtures.pending_list);
  assert.ok(pending);
  assert.equal(reportedContentReportsAreOrdered(pending.reports, "pending"), true);
  assert.equal(reportedContentReportsAreOrdered([...pending.reports].reverse(), "pending"), false);
});

test("decision and conflict parsers accept only authoritative exact state", () => {
  const pendingAction = clone(fixtures.action_success);
  const pendingReport = object(data(pendingAction).report);
  pendingReport.status = "pending";
  pendingReport.revision = 1;
  pendingReport.resolution = null;
  assert.equal(reportedContentActionResponse(pendingAction), null);

  for (const mutate of [
    (raw: JsonObject) => { data(raw).side_effect = "hidden"; },
    (raw: JsonObject) => { data(raw).replayed = 0; },
    (raw: JsonObject) => { raw.status_code = 201; },
    (raw: JsonObject) => { object(object(data(raw).report).resolution).decision = "confirmed"; },
  ]) {
    const raw = clone(fixtures.action_success);
    mutate(raw);
    assert.equal(reportedContentActionResponse(raw), null, mutate.toString());
  }

  for (const mutate of [
    (raw: JsonObject) => { raw.error = "reported-content-request-id-conflict"; },
    (raw: JsonObject) => { raw.success = true; },
    (raw: JsonObject) => { raw.status_code = 200; },
    (raw: JsonObject) => { data(raw).replayed = false; },
  ]) {
    const raw = clone(fixtures.conflict);
    mutate(raw);
    assert.equal(reportedContentConflictResponse(raw), null, mutate.toString());
  }
});

test("capabilities, never role names, govern decision controls", () => {
  const viewer = reportedContentListResponse(fixtures.empty_list);
  assert.ok(viewer);
  assert.equal(viewer.principal.role, "viewer");
  assert.equal(reportedContentCanDecide(viewer.principal), false);

  const ownerReadOnly = clone(fixtures.empty_list);
  object(data(ownerReadOnly).principal).role = "owner";
  const parsedOwner = reportedContentListResponse(ownerReadOnly);
  assert.ok(parsedOwner);
  assert.equal(reportedContentCanDecide(parsedOwner.principal), false);

  const viewerWithExplicitCapability = clone(fixtures.pending_list);
  object(data(viewerWithExplicitCapability).principal).role = "viewer";
  const parsedViewer = reportedContentListResponse(viewerWithExplicitCapability);
  assert.ok(parsedViewer);
  assert.equal(reportedContentCanDecide(parsedViewer.principal), true);
});

test("decision payloads normalize bounded text and persist one exact retry identity", () => {
  const detail = reportedContentListResponse(fixtures.exact_detail);
  assert.ok(detail);
  const requestId = "6F1C2D3E-4A5B-4C6D-8E9F-0A1B2C3D4E5F";
  const payload = reportedContentDecisionPayload(
    detail.reports[0],
    "rejected",
    "  No Cafe\u0301 policy violation.  ",
    requestId,
  );
  assert.deepEqual(payload, {
    contract_version: 1,
    report_id: "report-user-001",
    action: "rejected",
    reason: "No Café policy violation.",
    expected_revision: 1,
    request_id: requestId.toLowerCase(),
  });
  assert.ok(payload);

  const pending = reportedContentPendingFromPayload(payload);
  assert.deepEqual(reportedContentPendingDecision(pending), pending);
  assert.deepEqual(reportedContentPayloadFromPending(pending), payload);
  assert.equal(
    reportedContentPendingStorageKey(pending.reportId),
    "friending.reported-content.pending-decision.v1:report-user-001",
  );

  for (const invalid of [
    { ...pending, extra: true },
    { ...pending, version: 2 },
    { ...pending, requestId: requestId },
    { ...pending, reason: ` ${pending.reason}` },
    { ...pending, expectedRevision: 0 },
  ]) {
    assert.equal(reportedContentPendingDecision(invalid), null);
  }

  assert.equal(normalizeReportedContentReason("  Café  "), "Café");
  assert.equal(normalizeReportedContentReason("   "), null);
  assert.equal(normalizeReportedContentReason("bad\u0007reason"), null);
  assert.equal(normalizeReportedContentReason("x".repeat(501)), null);
  assert.equal(reportedContentDecisionPayload(detail.reports[0], "ignored", "reason", requestId), null);
  assert.equal(reportedContentDecisionPayload(detail.reports[0], "rejected", "reason", "not-v4"), null);
  assert.equal(reportedContentDecisionPayload({ report_id: "bad/id", revision: 1 }, "rejected", "reason", requestId), null);
  assert.equal(reportedContentDecisionPayload({ report_id: "valid", revision: 0 }, "rejected", "reason", requestId), null);
});

test("convergence clears only the exact completed gesture", () => {
  const result = reportedContentActionResponse(fixtures.action_success);
  assert.ok(result);
  const pending = reportedContentPendingDecision({
    version: 1,
    reportId: "report-user-001",
    action: "rejected",
    reason: "No policy violation was found.",
    expectedRevision: 1,
    requestId: "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
  });
  assert.ok(pending);
  assert.equal(reportedContentDecisionConverged(result, pending), true);
  assert.equal(reportedContentReportConverged(result.report, pending), true);
  assert.equal(reportedContentDecisionConverged(result, { ...pending, reportId: "another-report" }), false);
  assert.equal(reportedContentDecisionConverged(result, { ...pending, expectedRevision: 2 }), false);
  assert.equal(reportedContentDecisionConverged(result, { ...pending, action: "confirmed" }), false);
  assert.equal(reportedContentDecisionConverged(result, { ...pending, reason: "Different reason" }), false);
});

test("every closed refusal has localized routing and the documented retry policy", () => {
  const terminal = new Set([
    "reported-content-contract-version-invalid",
    "reported-content-parameter-invalid",
    "reported-content-filter-invalid",
    "reported-content-cursor-invalid",
    "reported-content-report-id-invalid",
    "reported-content-decision-invalid",
    "reported-content-reason-invalid",
    "reported-content-revision-invalid",
    "reported-content-request-id-invalid",
    "reported-content-not-found",
    "reported-content-conflict",
    "reported-content-request-id-conflict",
    "reported-content-read-required",
    "reported-content-decision-required",
    "admin-revoked",
    "admin-session-invalid",
    "admin-write-required",
  ]);
  const retryable = new Set([
    "reported-content-request-in-progress",
    "reported-content-audit-write-failed",
    "reported-content-stored-invalid",
    "reported-content-read-failed",
    "reported-content-write-failed",
  ]);

  assert.equal(terminal.size + retryable.size, Object.keys(REPORTED_CONTENT_ERROR_KEYS).length);
  for (const [error, key] of Object.entries(REPORTED_CONTENT_ERROR_KEYS)) {
    assert.equal(reportedContentErrorKey(error), key, error);
    assert.equal(reportedContentShouldRetainDecision(error), retryable.has(error), error);
    assert.equal(terminal.has(error) || retryable.has(error), true, error);
    if (error !== "reported-content-conflict") {
      assert.equal(reportedContentErrorResponse({
        success: false,
        status_code: REPORTED_CONTENT_ERROR_STATUSES[
          error as keyof typeof REPORTED_CONTENT_ERROR_STATUSES
        ],
        error,
        message: 200,
        status: 200,
        can_send: 0,
      }), error);
    }
  }
  assert.equal(reportedContentErrorKey("future-error"), "generic");
  assert.equal(reportedContentErrorKey("constructor"), "generic");
  assert.equal(reportedContentErrorResponse({
    success: false,
    status_code: 503,
    error: "reported-content-reason-invalid",
    message: 200,
    status: 200,
    can_send: 0,
  }), null, "a known error with the wrong status stays uncertain");
  assert.equal(reportedContentErrorResponse({
    success: false,
    status_code: 422,
    error: "reported-content-reason-invalid",
    message: 200,
    status: 200,
    can_send: 0,
    detail: "not contracted",
  }), null, "extra refusal data stays uncertain");
  assert.equal(reportedContentErrorResponse({
    success: false,
    status_code: 500,
    error: "future-error",
    message: 200,
    status: 200,
    can_send: 0,
  }), null);
  assert.equal(reportedContentShouldRetainDecision("future-error"), true);
  assert.equal(reportedContentShouldRetainDecision(undefined), true);
});

test("the dormant bridge is unreachable for guests, foreign origins, viewers, and owners", async () => {
  assert.equal(REPORTED_CONTENT_CONTRACT_READY, false);
  const actions = ["moderation_reported_list", "moderation_report_action"];
  for (const action of actions) {
    assert.equal(isAdminActionAllowed(action), false);
    assert.equal(isAdminActionAuthorized(action, adminPrincipalFrom({ role: "viewer" })), false);
    assert.equal(isAdminActionAuthorized(action, adminPrincipalFrom({ role: "owner" })), false);
  }

  assert.equal(isTrustedAdminRequest(headers({
    origin: "https://friendingapp.com",
    host: "friendingapp.com",
    "sec-fetch-site": "same-origin",
    [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE,
  })), true);
  assert.equal(isTrustedAdminRequest(headers({
    origin: "https://hostile.example.test",
    host: "friendingapp.com",
    "sec-fetch-site": "cross-site",
    [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE,
  })), false);

  const proxy = await readFile(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8");
  const originGate = proxy.indexOf("isTrustedAdminRequest(request.headers)");
  const allowListGate = proxy.indexOf("isAdminActionAllowed(action)");
  const sessionGate = proxy.indexOf("readAdminSession()");
  assert.ok(originGate >= 0 && allowListGate > originGate && sessionGate > allowListGate);
  assert.match(proxy, /if \(!session\)[\s\S]*?status: 401/);
  assert.match(proxy, /if \(!isAdminActionAllowed\(action\)\)[\s\S]*?status: 404/);
});

test("queue, detail, navigation, and proxy activation remain one explicit dormant cutover", async () => {
  const [queuePage, detailPage, queue, detail, shell] = await Promise.all([
    readFile(new URL("../app/(dashboard)/reported-content/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(dashboard)/reported-content/[reportId]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ReportedContentQueue.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ReportedContentDetail.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/Shell.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(queuePage, /if \(!REPORTED_CONTENT_CONTRACT_READY\) notFound\(\)/);
  assert.match(detailPage, /if \(!REPORTED_CONTENT_CONTRACT_READY\) notFound\(\)/);
  assert.match(shell, /ready: REPORTED_CONTENT_CONTRACT_READY/);
  assert.match(shell, /NAV\.filter\(\(item\) => item\.ready !== false\)/);
  assert.match(queue, /adminCall\("moderation_reported_list"/);
  assert.match(detail, /adminCall\("moderation_reported_list"/);
  assert.match(detail, /adminCall\("moderation_report_action"/);
  assert.match(detail, /window\.sessionStorage\.setItem/);
  assert.match(detail, /reportedContentConflictResponse/);
  assert.match(detail, /reportedContentErrorResponse/);
  assert.match(detail, /reportedContentReportConverged/);
  assert.doesNotMatch(`${queue}\n${detail}`, /coreCall|core\.friending\.com|WEBADMIN_API_SECRET/);
});
