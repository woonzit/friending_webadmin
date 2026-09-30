import { DATES_REPORT_SCOPES, datesReasonEntryPoints } from "./datesAdmin";

export type DatesAdminReason = {
  reason_id: string; scope: string; key: string; name_en: string; name_hu: string;
  explanation_en: string | null; explanation_hu: string | null;
  active: boolean; order: number; severity: string; comment_required: boolean;
  entry_points: string[]; escalation_category: string | null; system_owned: boolean;
  catalog_version: number; revision: number; updated_at: number;
};

const rowKeys = ["reason_id", "scope", "key", "name_en", "name_hu", "explanation_en", "explanation_hu",
  "active", "order", "severity", "comment_required", "entry_points", "escalation_category", "system_owned",
  "catalog_version", "revision", "updated_at"];
const envelopeKeys = ["success", "status_code", "message", "status", "can_send", "server_now"];
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
const integer = (value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const text = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= maximum;
const nullableText = (value: unknown, maximum: number) => value === null || text(value, maximum);
function envelope(value: unknown, extra: string[]): value is Record<string, unknown> {
  return record(value) && keys(value, [...envelopeKeys, ...extra]) && value.success === true
    && value.status_code === 200 && value.message === 200 && value.status === 200 && value.can_send === 0
    && integer(value.server_now, 0);
}
function reasonRow(value: unknown): value is DatesAdminReason {
  if (!record(value) || !keys(value, rowKeys)
    || typeof value.scope !== "string" || !(DATES_REPORT_SCOPES as readonly string[]).includes(value.scope)
    || typeof value.key !== "string" || !/^[a-z][a-z0-9_]{1,63}$/.test(value.key)
    || typeof value.reason_id !== "string" || !/^reason_[a-z0-9_]{3,80}$/.test(value.reason_id)
    || !value.reason_id.startsWith(`reason_${value.scope}_`)
    || !text(value.name_en, 120) || !text(value.name_hu, 120)
    || !nullableText(value.explanation_en, 500) || !nullableText(value.explanation_hu, 500)
    || typeof value.active !== "boolean" || typeof value.comment_required !== "boolean" || typeof value.system_owned !== "boolean"
    || !integer(value.order, 0, 100000) || typeof value.severity !== "string" || !["low", "medium", "high", "critical"].includes(value.severity)
    || !(value.escalation_category === null || (typeof value.escalation_category === "string" && /^[a-z][a-z0-9_]{1,63}$/.test(value.escalation_category)))
    || value.catalog_version !== 1 || !integer(value.revision, 1) || !integer(value.updated_at, 0)
    || !Array.isArray(value.entry_points) || !value.entry_points.every((entry) => typeof entry === "string")) return false;
  const parsed = datesReasonEntryPoints(value.scope, value.entry_points.join(","));
  return parsed.ok && JSON.stringify(parsed.entryPoints) === JSON.stringify(value.entry_points);
}

/** Closed read boundary; malformed reasons never become an empty catalogue. */
export function datesAdminReasons(value: unknown, scope: string): DatesAdminReason[] | null {
  if (scope !== "all" && !(DATES_REPORT_SCOPES as readonly string[]).includes(scope)) return null;
  if (!envelope(value, ["catalog_version", "reasons"]) || value.catalog_version !== 1
    || !Array.isArray(value.reasons) || !value.reasons.every(reasonRow)
    || value.reasons.some((reason) => scope !== "all" && reason.scope !== scope)
    || new Set(value.reasons.map((reason) => reason.reason_id)).size !== value.reasons.length) return null;
  return value.reasons;
}

/** A successful save must acknowledge the submitted identity, CAS and edits. */
export function datesReasonSaveReceipt(value: unknown, submitted: Record<string, unknown>): DatesAdminReason | null {
  if (!envelope(value, ["reason", "revision", "audit_id", "idempotency_replayed"])
    || !reasonRow(value.reason) || typeof value.idempotency_replayed !== "boolean"
    || typeof value.audit_id !== "string" || !/^aud_[a-f0-9]{32}$/.test(value.audit_id)) return null;
  const expectedRevision = submitted.expected_revision ?? 0;
  if (!integer(expectedRevision, 0) || value.revision !== expectedRevision + 1 || value.reason.revision !== value.revision
    || value.reason.reason_id !== (submitted.reason_id || `reason_${submitted.scope}_${submitted.key}`)) return null;
  const reason = value.reason;
  const editable = ["scope", "key", "name_en", "name_hu", "explanation_en", "explanation_hu", "severity", "order",
    "active", "comment_required", "entry_points", "escalation_category"] as const;
  return editable.every((key) => JSON.stringify(reason[key]) === JSON.stringify(submitted[key])) ? reason : null;
}
