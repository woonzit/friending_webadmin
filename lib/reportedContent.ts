import {
  webadminDataSuccessEnvelope,
  webadminErrorEnvelope,
} from "@/lib/webadminEnvelope";
import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";

/** Closed browser projection for the reported-content Webadmin contract. */

export const REPORTED_CONTENT_CONTRACT_VERSION = 1;
export const REPORTED_CONTENT_PAGE_SIZE = 50;

export const REPORTED_CONTENT_STATUSES = [
  "pending",
  "confirmed",
  "rejected",
] as const;
export const REPORTED_CONTENT_STATUS_FILTERS = [
  ...REPORTED_CONTENT_STATUSES,
  "all",
] as const;
export const REPORTED_CONTENT_TARGET_TYPES = ["user", "chat"] as const;
export const REPORTED_CONTENT_TARGET_FILTERS = [
  ...REPORTED_CONTENT_TARGET_TYPES,
  "all",
] as const;
export const REPORTED_CONTENT_DECISIONS = ["confirmed", "rejected"] as const;
export const REPORTED_CONTENT_CAPABILITIES = [
  "reported_content_decide",
  "reported_content_read",
] as const;

export type ReportedContentStatus = (typeof REPORTED_CONTENT_STATUSES)[number];
export type ReportedContentStatusFilter = (typeof REPORTED_CONTENT_STATUS_FILTERS)[number];
export type ReportedContentTargetType = (typeof REPORTED_CONTENT_TARGET_TYPES)[number];
export type ReportedContentTargetFilter = (typeof REPORTED_CONTENT_TARGET_FILTERS)[number];
export type ReportedContentDecision = (typeof REPORTED_CONTENT_DECISIONS)[number];
export type ReportedContentCapability = (typeof REPORTED_CONTENT_CAPABILITIES)[number];

export type ReportedContentPrincipal = {
  role: "viewer" | "admin" | "owner";
  capabilities: ReportedContentCapability[];
};

export type ReportedContentIdentity = {
  uid: number;
  display_name: string;
  username: string;
};

export type ReportedContentSubject =
  | { kind: "profile"; summary: string }
  | {
      kind: "chat_message";
      message_id: string | null;
      availability: "available" | "removed" | "unavailable";
      text: string;
      sent_at: number | null;
      has_restricted_evidence: boolean;
    };

export type ReportedContentResolution = null | {
  decision: ReportedContentDecision;
  reason: string;
  decided_at: number;
  decided_by: string;
};

export type ReportedContentReport = {
  report_id: string;
  status: ReportedContentStatus;
  revision: number;
  target_type: ReportedContentTargetType;
  reporter: ReportedContentIdentity;
  subject: ReportedContentIdentity;
  subject_content: ReportedContentSubject;
  reason_code: string;
  reason_text: string;
  reason_truncated: boolean;
  created_at: number;
  resolution: ReportedContentResolution;
};

export type ReportedContentListData = {
  contract_version: 1;
  principal: ReportedContentPrincipal;
  filter: {
    status: ReportedContentStatusFilter;
    target_type: ReportedContentTargetFilter;
    report_id: string | null;
  };
  reports: ReportedContentReport[];
  next_cursor: string | null;
  total: number;
};

export type ReportedContentActionData = {
  contract_version: 1;
  report: ReportedContentReport;
  replayed: boolean;
};

export type ReportedContentConflictData = {
  contract_version: 1;
  report: ReportedContentReport;
};

export type ReportedContentPendingDecision = {
  version: 1;
  reportId: string;
  action: ReportedContentDecision;
  reason: string;
  expectedRevision: number;
  requestId: string;
};

export type ReportedContentDecisionPayload = {
  contract_version: 1;
  report_id: string;
  action: ReportedContentDecision;
  reason: string;
  expected_revision: number;
  request_id: string;
};

const REPORT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REASON_CODE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,256}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DISALLOWED_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  const raw = object(value);
  if (!raw) return null;
  const actual = Object.keys(raw).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    return null;
  }
  return raw;
}

function integer(value: unknown, minimum: number, maximum = 2_147_483_647): number | null {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}

function boundedText(value: unknown, minimum: number, maximum: number): string | null {
  if (typeof value !== "string") return null;
  if (
    value.trim() !== value
    || value.normalize("NFC") !== value
    || DISALLOWED_CONTROL.test(value)
  ) return null;
  const length = Array.from(value).length;
  return length >= minimum && length <= maximum ? value : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? value as T
    : null;
}

function reportId(value: unknown): string | null {
  return typeof value === "string" && REPORT_ID.test(value) ? value : null;
}

function requestId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return REQUEST_ID.test(normalized) ? normalized : null;
}

function cursor(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && CURSOR.test(value) ? value : undefined;
}

function email(value: unknown): string | null {
  const parsed = boundedText(value, 3, 320);
  return parsed && parsed === parsed.toLowerCase() && EMAIL.test(parsed) ? parsed : null;
}

function identity(value: unknown): ReportedContentIdentity | null {
  const raw = exactObject(value, ["uid", "display_name", "username"]);
  if (!raw) return null;
  const uid = integer(raw.uid, 1);
  const displayName = boundedText(raw.display_name, 0, 100);
  const username = boundedText(raw.username, 0, 80);
  return uid === null || displayName === null || username === null
    ? null
    : { uid, display_name: displayName, username };
}

function subjectContent(value: unknown): ReportedContentSubject | null {
  const raw = object(value);
  if (raw?.kind === "profile") {
    const profile = exactObject(raw, ["kind", "summary"]);
    const summary = boundedText(profile?.summary, 0, 500);
    return profile && summary !== null ? { kind: "profile", summary } : null;
  }
  if (raw?.kind !== "chat_message") return null;
  const chat = exactObject(raw, [
    "kind",
    "message_id",
    "availability",
    "text",
    "sent_at",
    "has_restricted_evidence",
  ]);
  if (!chat) return null;
  const messageId = chat.message_id === null ? null : reportId(chat.message_id);
  const availability = oneOf(chat.availability, ["available", "removed", "unavailable"] as const);
  const text = boundedText(chat.text, 0, 2000);
  const sentAt = chat.sent_at === null ? null : integer(chat.sent_at, 0, Number.MAX_SAFE_INTEGER);
  if (
    (chat.message_id !== null && messageId === null)
    || availability === null
    || text === null
    || (chat.sent_at !== null && sentAt === null)
    || typeof chat.has_restricted_evidence !== "boolean"
    || (availability === "available" && (messageId === null || sentAt === null))
    || (availability === "removed" && (messageId === null || sentAt === null))
    || (availability !== "available" && text !== "")
  ) return null;
  return {
    kind: "chat_message",
    message_id: messageId,
    availability,
    text,
    sent_at: sentAt,
    has_restricted_evidence: chat.has_restricted_evidence,
  };
}

function resolution(value: unknown): ReportedContentResolution | undefined {
  if (value === null) return null;
  const raw = exactObject(value, ["decision", "reason", "decided_at", "decided_by"]);
  if (!raw) return undefined;
  const decision = oneOf(raw.decision, REPORTED_CONTENT_DECISIONS);
  const reason = boundedText(raw.reason, 1, 500);
  const decidedAt = integer(raw.decided_at, 0, Number.MAX_SAFE_INTEGER);
  const decidedBy = email(raw.decided_by);
  return decision === null || reason === null || decidedAt === null || decidedBy === null
    ? undefined
    : { decision, reason, decided_at: decidedAt, decided_by: decidedBy };
}

export function reportedContentReport(value: unknown): ReportedContentReport | null {
  const raw = exactObject(value, [
    "report_id",
    "status",
    "revision",
    "target_type",
    "reporter",
    "subject",
    "subject_content",
    "reason_code",
    "reason_text",
    "reason_truncated",
    "created_at",
    "resolution",
  ]);
  if (!raw) return null;
  const id = reportId(raw.report_id);
  const status = oneOf(raw.status, REPORTED_CONTENT_STATUSES);
  const revisionNumber = integer(raw.revision, 1);
  const targetType = oneOf(raw.target_type, REPORTED_CONTENT_TARGET_TYPES);
  const reporter = identity(raw.reporter);
  const subject = identity(raw.subject);
  const content = subjectContent(raw.subject_content);
  const reasonCode = typeof raw.reason_code === "string" && REASON_CODE.test(raw.reason_code)
    ? raw.reason_code
    : null;
  const reasonText = boundedText(raw.reason_text, 0, 500);
  const reasonTruncated = typeof raw.reason_truncated === "boolean"
    ? raw.reason_truncated
    : null;
  const createdAt = integer(raw.created_at, 0, Number.MAX_SAFE_INTEGER);
  const parsedResolution = resolution(raw.resolution);
  if (
    id === null
    || status === null
    || revisionNumber === null
    || targetType === null
    || !reporter
    || !subject
    || !content
    || reasonCode === null
    || reasonText === null
    || reasonTruncated === null
    || createdAt === null
    || parsedResolution === undefined
    || (targetType === "user" && content.kind !== "profile")
    || (targetType === "chat" && content.kind !== "chat_message")
    || (status === "pending" && parsedResolution !== null)
    || (status !== "pending" && parsedResolution?.decision !== status)
  ) return null;
  return {
    report_id: id,
    status,
    revision: revisionNumber,
    target_type: targetType,
    reporter,
    subject,
    subject_content: content,
    reason_code: reasonCode,
    reason_text: reasonText,
    reason_truncated: reasonTruncated,
    created_at: createdAt,
    resolution: parsedResolution,
  };
}

function principal(value: unknown): ReportedContentPrincipal | null {
  const raw = exactObject(value, ["role", "capabilities"]);
  const role = oneOf(raw?.role, ["viewer", "admin", "owner"] as const);
  if (!raw || role === null || !Array.isArray(raw.capabilities)) return null;
  const capabilities: ReportedContentCapability[] = [];
  for (const item of raw.capabilities) {
    const capability = oneOf(item, REPORTED_CONTENT_CAPABILITIES);
    if (capability === null || capabilities.includes(capability)) return null;
    capabilities.push(capability);
  }
  if (
    !capabilities.includes("reported_content_read")
    || capabilities.some((value, index) => index > 0 && capabilities[index - 1] > value)
  ) return null;
  return { role, capabilities };
}

function compareReportIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function reportedContentReportsAreOrdered(
  reports: ReportedContentReport[],
  status: ReportedContentStatusFilter,
): boolean {
  const direction = status === "pending" ? 1 : -1;
  for (let index = 1; index < reports.length; index += 1) {
    const previous = reports[index - 1];
    const current = reports[index];
    const timeComparison = previous.created_at - current.created_at;
    const idComparison = compareReportIds(previous.report_id, current.report_id);
    const comparison = timeComparison === 0 ? idComparison : timeComparison;
    if (comparison * direction > 0) return false;
  }
  return true;
}

/** Decode the exact version-1 `moderation_reported_list` data object. */
export function reportedContentListData(value: unknown): ReportedContentListData | null {
  const raw = exactObject(value, [
    "contract_version",
    "principal",
    "filter",
    "reports",
    "next_cursor",
    "total",
  ]);
  if (!raw || raw.contract_version !== REPORTED_CONTENT_CONTRACT_VERSION) return null;
  const actor = principal(raw.principal);
  const filterRaw = exactObject(raw.filter, ["status", "target_type", "report_id"]);
  const status = oneOf(filterRaw?.status, REPORTED_CONTENT_STATUS_FILTERS);
  const targetType = oneOf(filterRaw?.target_type, REPORTED_CONTENT_TARGET_FILTERS);
  const exactReportId = filterRaw?.report_id === null ? null : reportId(filterRaw?.report_id);
  const nextCursor = cursor(raw.next_cursor);
  const total = integer(raw.total, 0, Number.MAX_SAFE_INTEGER);
  if (
    !actor
    || !filterRaw
    || status === null
    || targetType === null
    || (filterRaw.report_id !== null && exactReportId === null)
    || (exactReportId !== null && (status !== "all" || targetType !== "all"))
    || !Array.isArray(raw.reports)
    || raw.reports.length > 100
    || nextCursor === undefined
    || total === null
  ) return null;

  const reports: ReportedContentReport[] = [];
  const ids = new Set<string>();
  for (const item of raw.reports) {
    const report = reportedContentReport(item);
    if (!report || ids.has(report.report_id)) return null;
    if (exactReportId !== null) {
      if (report.report_id !== exactReportId) return null;
    } else {
      if (status !== "all" && report.status !== status) return null;
      if (targetType !== "all" && report.target_type !== targetType) return null;
    }
    ids.add(report.report_id);
    reports.push(report);
  }

  if (
    total < reports.length
    || !reportedContentReportsAreOrdered(reports, status)
    || (reports.length === 0 && (total !== 0 || nextCursor !== null))
    || (nextCursor !== null && total <= reports.length)
    || (exactReportId !== null && (
      reports.length > 1
      || nextCursor !== null
      || total !== reports.length
    ))
  ) return null;

  return {
    contract_version: 1,
    principal: actor,
    filter: { status, target_type: targetType, report_id: exactReportId },
    reports,
    next_cursor: nextCursor,
    total,
  };
}

/** Decode the exact successful legacy envelope around a list/detail response. */
export function reportedContentListResponse(value: unknown): ReportedContentListData | null {
  const envelope = webadminDataSuccessEnvelope(value);
  return envelope
    ? reportedContentListData(envelope.data)
    : null;
}

export function reportedContentActionData(value: unknown): ReportedContentActionData | null {
  const raw = exactObject(value, ["contract_version", "report", "replayed"]);
  const report = reportedContentReport(raw?.report);
  return raw?.contract_version === 1
    && report
    && report.status !== "pending"
    && typeof raw.replayed === "boolean"
    ? { contract_version: 1, report, replayed: raw.replayed }
    : null;
}

export function reportedContentActionResponse(value: unknown): ReportedContentActionData | null {
  const envelope = webadminDataSuccessEnvelope(value);
  return envelope
    ? reportedContentActionData(envelope.data)
    : null;
}

export function reportedContentConflictResponse(value: unknown): ReportedContentConflictData | null {
  const envelope = webadminErrorEnvelope(value, "required");
  const data = exactObject(envelope?.data, ["contract_version", "report"]);
  const report = reportedContentReport(data?.report);
  return envelope?.status_code === 409
    && envelope.error === "reported-content-conflict"
    && data?.contract_version === 1
    && report
    ? { contract_version: 1, report }
    : null;
}

export const REPORTED_CONTENT_ERROR_KEYS = {
  "reported-content-contract-version-invalid": "contractVersionInvalid",
  "reported-content-parameter-invalid": "parameterInvalid",
  "reported-content-filter-invalid": "filterInvalid",
  "reported-content-cursor-invalid": "cursorInvalid",
  "reported-content-report-id-invalid": "reportIdInvalid",
  "reported-content-decision-invalid": "decisionInvalid",
  "reported-content-reason-invalid": "reasonInvalid",
  "reported-content-revision-invalid": "revisionInvalid",
  "reported-content-request-id-invalid": "requestIdInvalid",
  "reported-content-not-found": "notFound",
  "reported-content-conflict": "conflict",
  "reported-content-request-id-conflict": "requestIdConflict",
  "reported-content-request-in-progress": "requestInProgress",
  "reported-content-read-required": "readRequired",
  "reported-content-decision-required": "decisionRequired",
  "reported-content-audit-write-failed": "auditWriteFailed",
  "reported-content-stored-invalid": "storedInvalid",
  "reported-content-read-failed": "readFailed",
  "reported-content-write-failed": "writeFailed",
  "admin-revoked": "sessionInvalid",
  "admin-session-invalid": "sessionInvalid",
  "admin-write-required": "decisionRequired",
} as const;

export const REPORTED_CONTENT_ERROR_STATUSES: Record<
  keyof typeof REPORTED_CONTENT_ERROR_KEYS,
  number
> = {
  "reported-content-contract-version-invalid": 400,
  "reported-content-parameter-invalid": 400,
  "reported-content-filter-invalid": 422,
  "reported-content-cursor-invalid": 422,
  "reported-content-report-id-invalid": 422,
  "reported-content-decision-invalid": 422,
  "reported-content-reason-invalid": 422,
  "reported-content-revision-invalid": 422,
  "reported-content-request-id-invalid": 422,
  "reported-content-not-found": 404,
  "reported-content-conflict": 409,
  "reported-content-request-id-conflict": 409,
  "reported-content-request-in-progress": 409,
  "reported-content-read-required": 403,
  "reported-content-decision-required": 403,
  "reported-content-audit-write-failed": 503,
  "reported-content-stored-invalid": 503,
  "reported-content-read-failed": 503,
  "reported-content-write-failed": 503,
  "admin-revoked": 403,
  "admin-session-invalid": 403,
  "admin-write-required": 403,
};

export type ReportedContentErrorKey =
  | (typeof REPORTED_CONTENT_ERROR_KEYS)[keyof typeof REPORTED_CONTENT_ERROR_KEYS]
  | "generic";

const ERROR_KEY_MAP = new Map<string, ReportedContentErrorKey>(
  Object.entries(REPORTED_CONTENT_ERROR_KEYS),
);

const TERMINAL_DECISION_ERRORS = new Set([
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

export function reportedContentErrorKey(value: unknown): ReportedContentErrorKey {
  return ERROR_KEY_MAP.get(typeof value === "string" ? value : "") ?? "generic";
}

/** Decode a refusal without conflict data; malformed/unknown envelopes stay uncertain. */
export function reportedContentErrorResponse(value: unknown): string | null {
  const envelope = webadminErrorEnvelope(value) ?? adminBridgeErrorEnvelope(value);
  const error = typeof envelope?.error === "string"
    && Object.prototype.hasOwnProperty.call(REPORTED_CONTENT_ERROR_STATUSES, envelope.error)
    ? envelope.error as keyof typeof REPORTED_CONTENT_ERROR_STATUSES
    : null;
  return envelope !== null
    && error !== null
    && error !== "reported-content-conflict"
    && envelope.status_code === REPORTED_CONTENT_ERROR_STATUSES[error]
    ? error
    : null;
}

/** Retain the exact request for network, unknown, in-progress, and service failures. */
export function reportedContentShouldRetainDecision(value: unknown): boolean {
  const error = typeof value === "string" ? value : "";
  return !TERMINAL_DECISION_ERRORS.has(error);
}

export function isReportedContentReportId(value: unknown): value is string {
  return reportId(value) !== null;
}

export function normalizeReportedContentReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().normalize("NFC");
  return boundedText(normalized, 1, 500);
}

export function reportedContentDecisionPayload(
  report: Pick<ReportedContentReport, "report_id" | "revision">,
  action: unknown,
  reason: unknown,
  rawRequestId: unknown,
): ReportedContentDecisionPayload | null {
  const id = reportId(report.report_id);
  const revisionNumber = integer(report.revision, 1);
  const decision = oneOf(action, REPORTED_CONTENT_DECISIONS);
  const normalizedReason = normalizeReportedContentReason(reason);
  const normalizedRequestId = requestId(rawRequestId);
  return id && revisionNumber !== null && decision && normalizedReason && normalizedRequestId
    ? {
        contract_version: 1,
        report_id: id,
        action: decision,
        reason: normalizedReason,
        expected_revision: revisionNumber,
        request_id: normalizedRequestId,
      }
    : null;
}

export function reportedContentPendingDecision(
  value: unknown,
): ReportedContentPendingDecision | null {
  const raw = exactObject(value, [
    "version",
    "reportId",
    "action",
    "reason",
    "expectedRevision",
    "requestId",
  ]);
  if (!raw || raw.version !== 1) return null;
  const payload = reportedContentDecisionPayload(
    { report_id: raw.reportId as string, revision: raw.expectedRevision as number },
    raw.action,
    raw.reason,
    raw.requestId,
  );
  if (!payload || payload.reason !== raw.reason || payload.request_id !== raw.requestId) return null;
  return {
    version: 1,
    reportId: payload.report_id,
    action: payload.action,
    reason: payload.reason,
    expectedRevision: payload.expected_revision,
    requestId: payload.request_id,
  };
}

export function reportedContentPendingFromPayload(
  payload: ReportedContentDecisionPayload,
): ReportedContentPendingDecision {
  return {
    version: 1,
    reportId: payload.report_id,
    action: payload.action,
    reason: payload.reason,
    expectedRevision: payload.expected_revision,
    requestId: payload.request_id,
  };
}

export function reportedContentPayloadFromPending(
  pending: ReportedContentPendingDecision,
): ReportedContentDecisionPayload {
  return {
    contract_version: 1,
    report_id: pending.reportId,
    action: pending.action,
    reason: pending.reason,
    expected_revision: pending.expectedRevision,
    request_id: pending.requestId,
  };
}

export function reportedContentDecisionConverged(
  result: ReportedContentActionData,
  pending: ReportedContentPendingDecision,
): boolean {
  return reportedContentReportConverged(result.report, pending);
}

/** A detail reload may prove a lost response converged without issuing another mutation. */
export function reportedContentReportConverged(
  report: ReportedContentReport,
  pending: ReportedContentPendingDecision,
): boolean {
  return report.report_id === pending.reportId
    && report.revision === pending.expectedRevision + 1
    && report.status === pending.action
    && report.resolution?.decision === pending.action
    && report.resolution.reason === pending.reason;
}

export function reportedContentCanDecide(principalValue: ReportedContentPrincipal): boolean {
  return principalValue.capabilities.includes("reported_content_decide");
}

export function reportedContentPendingStorageKey(reportIdValue: string): string {
  return `friending.reported-content.pending-decision.v1:${reportIdValue}`;
}

export type ReportedContentPersistedMutation<T> =
  | { ok: true; response: T }
  | { ok: false };

/**
 * Persist the exact durable identity before starting a mutation. Browsers may
 * expose `sessionStorage` while throwing on writes (private browsing/quota), so
 * the callback is deliberately unreachable until `setItem` has succeeded.
 */
export async function reportedContentPersistBeforeMutation<T>(
  storage: Pick<Storage, "setItem">,
  pending: ReportedContentPendingDecision,
  mutate: () => Promise<T>,
): Promise<ReportedContentPersistedMutation<T>> {
  const canonical = reportedContentPendingDecision(pending);
  if (!canonical) return { ok: false };
  try {
    storage.setItem(
      reportedContentPendingStorageKey(canonical.reportId),
      JSON.stringify(canonical),
    );
  } catch {
    return { ok: false };
  }
  return { ok: true, response: await mutate() };
}
