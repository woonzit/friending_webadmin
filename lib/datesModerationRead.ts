import { datesCaseInternalNotes, hasDatesCapability, type DatesAdminPrincipal, type DatesCaseSummary } from "./datesAdmin";

type LocalizedReason = { en: string | null; hu: string | null } | null;
export type DatesDecisionMetadata = {
  decision_id: string; case_id: string; target_type: string; target_id: string;
  activity_id: string | null; target_path: string; action: string; severity: string;
  user_visible_reason: LocalizedReason; created_at: number; expires_at: number | null;
  appeal_outcome: string | null; appeal_resolved_at: number | null;
};
export type DatesAppealMetadata = {
  appeal_id: string; case_id: string; decision_id: string; original_case_id: string | null;
  target_type: string; target_id: string; status: string; resolution: string | null;
  user_visible_reason: LocalizedReason; created_at: number; updated_at: number; resolved_at: number | null;
};
export type DatesReportMetadata = {
  report_id: string; reason_id: string; reason_key: string; reason_label_snapshot: LocalizedReason;
  entry_point: string; note: string | null; severity: string; status: string;
  created_at: number; reporter_identity_redacted: true;
};
export type DatesCaseDetail = {
  case: DatesCaseSummary; reports: DatesReportMetadata[]; report_notes_withheld: boolean;
  decisions: DatesDecisionMetadata[]; appeal: DatesAppealMetadata | null;
  evidence_requires_separate_audited_read: true;
};
export type DatesAppealNote = { appeal_id: string; note: string | null; created_at: number };
export type DatesEvidenceRead = {
  case_id: string; evidence: Array<Record<string, unknown>>; appeal_note: DatesAppealNote | null;
  redacted_sensitive_location_count: number; break_glass_used: boolean; audit_id: string;
};
export type DatesEvidenceScope = {
  case_id: string; appeal_id: string | null; include_sensitive_location: boolean; break_glass: boolean;
};

type Rule = (value: unknown) => boolean;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function shape(value: unknown, rules: Record<string, Rule>): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === Object.keys(rules).length
    && Object.entries(rules).every(([key, rule]) => Object.hasOwn(value, key) && rule(value[key]));
}
const text = (limit: number): Rule => (value) => typeof value === "string" && value !== "" && Array.from(value).length <= limit;
const nullable = (rule: Rule): Rule => (value) => value === null || rule(value);
const id = (prefix: string): Rule => (value) => typeof value === "string" && new RegExp(`^${prefix}_[a-f0-9]{32}$`).test(value);
const integer: Rule = (value) => Number.isSafeInteger(value) && Number(value) >= 0;
const epoch: Rule = (value) => integer(value) && Number(value) <= 8_640_000_000_000;
const boolean: Rule = (value) => typeof value === "boolean";
const email: Rule = (value) => text(320)(value) && String(value).includes("@");
const reason: Rule = (value) => value === null || shape(value, { en: nullable(text(500)), hu: nullable(text(500)) });
const envelope = { success: (v: unknown) => v === true, status_code: (v: unknown) => v === 200,
  message: (v: unknown) => v === 200, status: (v: unknown) => v === 200, can_send: (v: unknown) => v === 0 };
const decisionRules = {
  decision_id: id("dec"), case_id: id("cas"), target_type: text(40), target_id: text(128),
  activity_id: nullable(id("act")), target_path: text(40), action: text(80), severity: text(40),
  user_visible_reason: reason, created_at: epoch, expires_at: nullable(epoch),
  appeal_outcome: nullable(text(40)), appeal_resolved_at: nullable(epoch),
};
const appealRules = {
  appeal_id: id("apl"), case_id: id("cas"), decision_id: id("dec"), original_case_id: nullable(id("cas")),
  target_type: text(40), target_id: text(128), status: text(40), resolution: nullable(text(40)),
  user_visible_reason: reason, created_at: epoch, updated_at: epoch, resolved_at: nullable(epoch),
};
const reportRules = {
  report_id: id("rpt"), reason_id: text(128), reason_key: text(80), reason_label_snapshot: reason,
  entry_point: text(80), note: nullable(text(1000)), severity: text(40), status: text(40),
  created_at: epoch, reporter_identity_redacted: (value: unknown) => value === true,
};
const caseRules = {
  case_id: id("cas"), queue: text(40), case_kind: text(40), target_type: text(40), target_id: text(128),
  target_uid: integer, activity_id: nullable(id("act")), status: text(40), severity: text(40),
  escalated: boolean, distinct_reporter_count: integer, report_count: integer,
  assignee_email: nullable(email), claimed_at: nullable(epoch), claim_expires_at: nullable(epoch),
  sla_due_at: epoch, sla_breached: boolean, revision: integer, created_at: epoch, updated_at: epoch,
  conflict_of_interest: boolean,
  capabilities: (value: unknown) => shape(value, { can_claim: boolean, can_read_evidence: boolean, can_resolve: boolean, can_break_glass: boolean }),
};

function uniqueRows(rows: unknown[], rules: Record<string, Rule>, key: string): boolean {
  const seen = new Set<unknown>();
  return rows.every((row) => {
    if (!shape(row, rules) || seen.has(row[key])) return false;
    seen.add(row[key]);
    return true;
  });
}

/** Metadata is closed; raw before/after, actor identities and appeal notes fail closed. */
export function datesCaseDetail(value: unknown, expectedCaseId: string): DatesCaseDetail | null {
  if (!shape(value, { ...envelope, case: (v) => shape(v, caseRules), reports: Array.isArray,
    report_notes_withheld: boolean, decisions: Array.isArray, appeal: (v) => v === null || shape(v, appealRules),
    internal_notes: Array.isArray, internal_notes_withheld: boolean,
    evidence_requires_separate_audited_read: (v) => v === true, server_now: epoch })) return null;
  const item = value.case as DatesCaseSummary;
  const reports = value.reports as unknown[];
  const decisions = value.decisions as unknown[];
  const appeal = value.appeal as DatesAppealMetadata | null;
  if (item.case_id !== expectedCaseId || !uniqueRows(reports, reportRules, "report_id")
    || !uniqueRows(decisions, decisionRules, "decision_id")
    || value.report_notes_withheld !== item.conflict_of_interest
    || value.internal_notes_withheld !== item.conflict_of_interest
    || datesCaseInternalNotes(value).status === "invalid"
    || decisions.some((row) => (row as DatesDecisionMetadata).case_id !== expectedCaseId)
    || (item.conflict_of_interest && reports.some((row) => (row as DatesReportMetadata).note !== null))
    || (item.case_kind === "appeal" ? !appeal || appeal.case_id !== expectedCaseId || appeal.appeal_id !== item.target_id : appeal !== null)) return null;
  return { case: item, reports: reports as DatesReportMetadata[], report_notes_withheld: value.report_notes_withheld as boolean,
    decisions: decisions as DatesDecisionMetadata[], appeal, evidence_requires_separate_audited_read: true };
}

/** Only the separately authorized/audited response admits extensible evidence snapshots. */
export function datesEvidenceRead(value: unknown, scope: DatesEvidenceScope): DatesEvidenceRead | null {
  if (!shape(value, { ...envelope, case_id: id("cas"), evidence: Array.isArray,
    appeal_note: (v) => v === null || shape(v, { appeal_id: id("apl"), note: nullable(text(500)), created_at: epoch }),
    redacted_sensitive_location_count: integer, break_glass_used: boolean, audit_id: id("aud"), server_now: epoch })) return null;
  if (value.case_id !== scope.case_id || (value.break_glass_used && !scope.break_glass)) return null;
  const note = value.appeal_note as DatesAppealNote | null;
  if (scope.appeal_id === null ? note !== null : !note || note.appeal_id !== scope.appeal_id) return null;
  const rows = value.evidence as unknown[];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!record(row) || !id("evi")(row.evidence_id) || row.case_id !== scope.case_id
      || !text(80)(row.evidence_type) || !boolean(row.sensitive_location) || !epoch(row.created_at)
      || !record(row.snapshot) || (!scope.include_sensitive_location && row.sensitive_location)
      || seen.has(String(row.evidence_id))) return null;
    seen.add(String(row.evidence_id));
  }
  return { case_id: scope.case_id, evidence: rows as Array<Record<string, unknown>>, appeal_note: note,
    redacted_sensitive_location_count: value.redacted_sensitive_location_count as number,
    break_glass_used: value.break_glass_used as boolean, audit_id: value.audit_id as string };
}

/** An obsolete request cannot repopulate evidence after refresh, scope change or unmount. */
export class DatesCaseReadFence {
  private epoch = 0;
  begin(): number { return ++this.epoch; }
  invalidate(): void { this.epoch++; }
  accepts(ticket: number): boolean { return ticket === this.epoch; }
}

export function datesLegalHoldAllowed(item: DatesCaseSummary, principal: DatesAdminPrincipal, action: string, breakGlass: boolean): boolean {
  if (!hasDatesCapability(principal, "dates_legal_hold") || !["place", "release"].includes(action)) return false;
  if (item.conflict_of_interest && !(breakGlass && principal.break_glass && item.capabilities.can_break_glass)) return false;
  return action !== "release" || ["actioned", "dismissed", "closed"].includes(item.status);
}
