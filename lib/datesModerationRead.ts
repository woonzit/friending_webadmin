import { DATES_EXTERNAL_MODERATION_ACTIONS, DATES_EXTERNAL_MESSAGE_ACTIONS, datesCaseInternalNotes, datesModerationSla, hasDatesCapability,
  type DatesAdminPrincipal, type DatesCaseSummary, type DatesModerationSla } from "./datesAdmin";
import { DATES_EXTERNAL_STATUSES } from "./datesExternalAdmin";

type LocalizedReason = { en: string | null; hu: string | null } | null;
type ReportReason = LocalizedReason | { locale: "en" | "hu"; label: string };
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
  report_id: string; reason_id: string; reason_key: string; reason_label_snapshot: ReportReason;
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
  // Bound on its fields; a key this console does not know is tolerated (D-143).
  return record(value) && Object.entries(rules).every(([key, rule]) => Object.hasOwn(value, key) && rule(value[key]));
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
  report_id: id("rpt"), reason_id: text(128), reason_key: text(80), reason_label_snapshot: (v: unknown) => reason(v)
    || shape(v, { locale: (locale) => locale === "en" || locale === "hu", label: text(500) }),
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

/**
 * Host moderation v1 (Core docs/EVENT_HOST_MODERATION_V1.md, "Console"): where
 * a message case's content lives, and the hosts who were shown the case. Core
 * appends four keys to every case row, for a request with the command contract
 * selector; a Core that does not know them serves none.
 * - `host_reviews` is the one rule for every case: one review per event whose
 *   host was shown it, each with its event; `[]` when no host was. A case
 *   about content has at most one; a case about a member is one case for the
 *   whole app and has one per event.
 * - `host_review` repeats the single review of a case about content without
 *   its event, and is `null` for a case about a member.
 * So: all four, each read as its neighbours are (a vocabulary is bounded text
 * - a value the page has no name for is printed as a machine key - a flag is
 * a boolean, a time an epoch, an event an event id), or none. Some of the four
 * without the others is not a row.
 */
const hostReviewRules: Record<string, Rule> = { state: text(40), decision: nullable(text(40)), by_uid: nullable(integer), at: nullable(epoch) };
const hostModerationRules: Record<string, Rule> = {
  surface: nullable(text(40)), host_visible: boolean, host_review: (value) => value === null || shape(value, hostReviewRules),
  host_reviews: (value) => Array.isArray(value) && value.every((entry) => shape(entry, { ...hostReviewRules, activity_id: id("act") })),
};
function hostModerationRead(value: Record<string, unknown>): boolean {
  const served = Object.keys(hostModerationRules).filter((key) => Object.hasOwn(value, key));
  return served.length === 0 || (served.length === Object.keys(hostModerationRules).length && shape(value, hostModerationRules));
}

/** Explicit external variants stay closed before the ordinary metadata fallback. */
function caseRow(value: unknown): value is DatesCaseSummary {
  if (!record(value) || !hostModerationRead(value)) return false;
  if (Object.hasOwn(value, "external_message") || (value.target_type === "message" && value.case_kind === "prepublication")) {
    if (!shape(value, { ...caseRules,
      external_message: (v) => shape(v, {
        thread_id: nullable(id("thr")), revision: nullable((v) => integer(v) && Number(v) > 0),
        moderation_state: nullable((v) => typeof v === "string" && ["visible", "pending", "rejected"].includes(v)), available: boolean,
      }),
      allowed_actions: (v) => Array.isArray(v) && v.every((action) => typeof action === "string"
        && DATES_EXTERNAL_MESSAGE_ACTIONS.includes(action as typeof DATES_EXTERNAL_MESSAGE_ACTIONS[number])) && new Set(v).size === v.length,
    }) || value.target_type !== "message" || value.queue !== "messages" || value.case_kind !== "prepublication"
      || !id("msg")(value.target_id) || !id("act")(value.activity_id) || Number(value.target_uid) <= 1 || Number(value.revision) < 1) return false;
    const message = value.external_message as NonNullable<DatesCaseSummary["external_message"]>;
    const actions = value.allowed_actions as string[], caps = value.capabilities as DatesCaseSummary["capabilities"];
    const bound = message.thread_id !== null && message.revision !== null && message.moderation_state !== null;
    const unbound = message.thread_id === null && message.revision === null && message.moderation_state === null;
    if (!bound && !unbound) return false;
    if (!["new", "in_review", "appealed"].includes(String(value.status)) && (actions.length > 0 || caps.can_claim || caps.can_resolve)) return false;
    if (!message.available) return actions.length === 0 && !caps.can_claim && !caps.can_resolve;
    return bound && message.moderation_state === "pending" && (!caps.can_resolve || actions.length > 0);
  }
  if (value.target_type !== "external_event") return shape(value, caseRules);
  if (!shape(value, { ...caseRules,
    external_revision: nullable((v) => integer(v) && Number(v) > 0),
    external_status: nullable((v) => typeof v === "string" && DATES_EXTERNAL_STATUSES.includes(v as typeof DATES_EXTERNAL_STATUSES[number])),
    external_target_available: boolean,
    allowed_actions: (v) => Array.isArray(v) && v.every((action) => typeof action === "string"
      && DATES_EXTERNAL_MODERATION_ACTIONS.includes(action as typeof DATES_EXTERNAL_MODERATION_ACTIONS[number])) && new Set(v).size === v.length,
  }) || value.queue !== "activities" || value.case_kind !== "reports" || value.target_uid !== 0
    || !id("xev")(value.target_id) || !id("act")(value.activity_id)) return false;
  const actions = value.allowed_actions as string[], caps = value.capabilities as DatesCaseSummary["capabilities"];
  if (!["new", "in_review", "appealed"].includes(String(value.status)) && (actions.length > 0 || caps.can_claim || caps.can_resolve)) return false;
  return value.external_target_available
    ? value.external_revision !== null && value.external_status !== null && (!caps.can_resolve || actions.length > 0)
    : value.external_revision === null && value.external_status === null && actions.length === 0 && !caps.can_resolve;
}

function uniqueRows(rows: unknown[], rules: Record<string, Rule>, key: string): boolean {
  const seen = new Set<unknown>();
  return rows.every((row) => {
    if (!shape(row, rules) || seen.has(row[key])) return false;
    seen.add(row[key]);
    return true;
  });
}

export type DatesModerationQueue = { cases: DatesCaseSummary[]; page: number; limit: number; total: number };

/** Queue rows use the same metadata projection as detail, never evidence. */
export function datesModerationQueue(value: unknown, requested: { page: number; limit: number }): DatesModerationQueue | null {
  if (!shape(value, { ...envelope, cases: Array.isArray, page: integer, limit: integer,
    total: integer, server_now: epoch }) || value.page !== requested.page || value.limit !== requested.limit
    || Number(value.page) < 1 || Number(value.page) > 10000
    || Number(value.limit) < 1 || Number(value.limit) > 100) return null;
  const rows = value.cases as unknown[];
  if (rows.length > Number(value.limit) || !rows.every(caseRow)
    || new Set(rows.map((row) => row.case_id)).size !== rows.length) return null;
  // Core reads the page and count separately: concurrent changes can make them
  // disagree. Preserve both authoritative values instead of inventing rows/counts.
  return { cases: rows as DatesCaseSummary[], page: value.page as number,
    limit: value.limit as number, total: value.total as number };
}

/** The HTTP-200 legacy envelope must also represent a logical success. */
export function datesModerationConsoleSla(value: unknown): DatesModerationSla | null {
  if (!shape(value, { ...envelope, open_count: integer, unassigned_count: integer,
    sla_breach_count: integer, oldest_unassigned_at: nullable(epoch), age_buckets: (v) => shape(v, {
      under_1h: integer, "1h_to_6h": integer, "6h_to_24h": integer, over_24h: integer,
    }), median_seconds_to_claim: nullable(integer), median_seconds_to_resolve: nullable(integer),
    appeals_waiting: integer, server_now: epoch })) return null;
  return datesModerationSla(value);
}

const commandRules: Record<string, Record<string, Rule>> = {
  dates_moderation_claim: { case_status: (v) => v === "in_review", assignee_email: email,
    claim_expires_at: epoch, break_glass_used: boolean },
  dates_moderation_heartbeat: { case_status: (v) => v === "in_review", claim_expires_at: epoch },
  dates_moderation_release: { case_status: (v) => v === "new", claim_expires_at: (v) => v === null },
  dates_moderation_note: { note_id: id("nt") },
  dates_moderation_escalate: { escalated: (v) => v === true, severity: (v) => v === "critical" },
};

export function isDatesConsoleCommand(action: string): boolean {
  return Object.hasOwn(commandRules, action);
}

export type DatesConsoleCommandReceipt = {
  case_id: string; revision: number; audit_id: string; idempotency_replayed: boolean;
};

/** A durable receipt acknowledges this command, not the current case/lease state. */
export function datesConsoleCommandReceipt(value: unknown, action: string,
  expectedCaseId: string, expectedRevision: unknown): DatesConsoleCommandReceipt | null {
  if (!isDatesConsoleCommand(action) || !integer(expectedRevision)
    || !shape(value, { ...envelope, ...commandRules[action], case_id: id("cas"), revision: integer,
      audit_id: id("aud"), idempotency_replayed: boolean, server_now: epoch })
    || value.case_id !== expectedCaseId || value.revision !== Number(expectedRevision) + 1) return null;
  // A replay may contain an already-expired lease. Do not compare its timestamp
  // with server_now or install it as live state; the page re-reads case detail.
  return { case_id: value.case_id as string, revision: value.revision as number,
    audit_id: value.audit_id as string, idempotency_replayed: value.idempotency_replayed as boolean };
}

/** Legal holds have no case-CAS increment or break_glass_used receipt field. */
export function datesLegalHoldReceipt(value: unknown, caseId: string, action: unknown, reviewAt: unknown): boolean {
  return (action === "place" || action === "release")
    && shape(value, { ...envelope, case_id: id("cas"), legal_hold: boolean, review_at: nullable(epoch),
      evidence_count: integer, audit_id: id("aud"), idempotency_replayed: boolean, server_now: epoch })
    && value.case_id === caseId && value.legal_hold === (action === "place")
    && value.review_at === (action === "place" ? reviewAt : null)
    && (action !== "place" || (epoch(reviewAt) && Number(reviewAt) > 0));
}

export const DATES_LEGAL_HOLD_CHANGES = ["placed", "amended", "unchanged", "released"] as const;
export type DatesLegalHoldChange = typeof DATES_LEGAL_HOLD_CHANGES[number];
export type DatesLegalHoldCommandReceipt = {
  /** What the command did (T-891, served to a request with `expected_revision`); `null` from a Core that does not say. */
  hold_change: DatesLegalHoldChange | null;
  /** The case revision after the command; `null` when not served. */
  revision: number | null;
};

/**
 * The legal-hold receipt bound to the request the page sent. The released
 * fields bind as `datesLegalHoldReceipt` does (the case, the action, the
 * review date). A request that carries `expected_revision` is answered with
 * three more (T-891): `revision`, `hold_change` and `evidence_changed_count`.
 * When they are served they must agree with each other and with the request:
 * a place is placed / amended / unchanged, a release released / unchanged; a
 * write moves the case revision by one, `unchanged` writes nothing and moves
 * nothing (and changed no evidence row). When none of them is served (a Core
 * without T-891) the released receipt stands, and what the command did is not
 * said. Some but not all of them is no receipt.
 * Pairs (Core 33265e46, command corpus, generator lines 405-417): placed 1 -> 2, unchanged 2 -> 2, amended 2 -> 3,
 * released 3 -> 4, release unchanged 4 -> 4.
 */
export function datesLegalHoldCommandReceipt(value: unknown, request: Record<string, unknown>): DatesLegalHoldCommandReceipt | null {
  if (typeof request.case_id !== "string" || !datesLegalHoldReceipt(value, request.case_id, request.action, request.review_at)) return null;
  const served = value as Record<string, unknown>, extension = ["revision", "hold_change", "evidence_changed_count"].filter((key) => Object.hasOwn(served, key));
  if (extension.length === 0) return { hold_change: null, revision: null };
  // Each of the three is checked below: one that is missing fails its own check, so a part of the extension is no receipt.
  const expected = request.expected_revision;
  if (!Number.isSafeInteger(expected) || Number(expected) < 0 || !Number.isSafeInteger(served.revision)
    || !Number.isSafeInteger(served.evidence_changed_count) || Number(served.evidence_changed_count) < 0
    || Number(served.evidence_changed_count) > Number(served.evidence_count)) return null;
  const change = served.hold_change, allowed = request.action === "place" ? ["placed", "amended", "unchanged"] : ["released", "unchanged"];
  if (typeof change !== "string" || !allowed.includes(change)) return null;
  const unchanged = change === "unchanged";
  if (served.revision !== Number(expected) + (unchanged ? 0 : 1) || (unchanged && served.evidence_changed_count !== 0)) return null;
  return { hold_change: change as DatesLegalHoldChange, revision: served.revision as number };
}

/**
 * The receipt of a live-trail capture, bound to its request: this case and
 * this window, by value; it names the snapshot Core stored.
 */
export function datesTrailEvidenceReceipt(value: unknown, caseId: string, capturedFrom: unknown, capturedTo: unknown): boolean {
  return record(value) && value.success === true && value.status_code === 200 && value.case_id === caseId
    && id("evi")(value.evidence_id) && id("aud")(value.audit_id) && epoch(capturedFrom) && epoch(capturedTo)
    && value.captured_from === capturedFrom && value.captured_to === capturedTo;
}

export type DatesTrailEvidenceCommandReceipt = {
  /** The window had been captured: the same snapshot, nothing stored (T-891, with the selector); `null` when not served. */
  existing: boolean | null;
  /** The case revision after the command; `null` when not served. */
  revision: number | null;
};

/**
 * The capture's receipt bound to the request the page sent, with what Core
 * serves to the command contract selector (T-891): `revision` and `existing`,
 * both or neither. A new snapshot moves the case revision by one; an existing
 * one moves nothing.
 * Pairs (Core 33265e46, command corpus, generator lines 518-522): captured 2 -> 3 `existing: false`; the same window
 * again at 3 -> 3 `existing: true`, the same evidence and audit ids.
 */
export function datesTrailEvidenceCommandReceipt(value: unknown, request: Record<string, unknown>): DatesTrailEvidenceCommandReceipt | null {
  if (typeof request.case_id !== "string" || !datesTrailEvidenceReceipt(value, request.case_id, request.captured_from, request.captured_to)) return null;
  const served = value as Record<string, unknown>, extension = ["revision", "existing"].filter((key) => Object.hasOwn(served, key));
  if (extension.length === 0) return { existing: null, revision: null };
  const expected = request.expected_revision;
  if (extension.length !== 2 || typeof served.existing !== "boolean" || !Number.isSafeInteger(expected) || Number(expected) < 0
    || served.revision !== Number(expected) + (served.existing ? 0 : 1)) return null;
  return { existing: served.existing, revision: served.revision as number };
}

/**
 * Case metadata, bound on its fields (D-143): every named field must be there
 * and valid, and a key this console does not know is tolerated and never read -
 * the screens print named fields only. What the metadata must not carry by
 * its own rules is still refused: a reporter that is not redacted, a note on a
 * conflicted case, a decision of another case.
 */
export function datesCaseDetail(value: unknown, expectedCaseId: string): DatesCaseDetail | null {
  if (!shape(value, { ...envelope, case: caseRow, reports: Array.isArray,
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
  if (item.target_type === "external_event" && decisions.some((row) => {
    const decision = row as DatesDecisionMetadata;
    return decision.target_type !== item.target_type || decision.target_id !== item.target_id || decision.activity_id !== item.activity_id
      || !DATES_EXTERNAL_MODERATION_ACTIONS.includes(decision.action as typeof DATES_EXTERNAL_MODERATION_ACTIONS[number])
      || decision.target_path !== (decision.action === "dismiss" ? "unchanged" : "published")
      || decision.expires_at !== null || decision.appeal_outcome !== null || decision.appeal_resolved_at !== null;
  })) return null;
  if (item.external_message && decisions.some((row) => {
    const decision = row as DatesDecisionMetadata;
    return decision.target_type !== "message" || decision.target_id !== item.target_id || decision.activity_id !== item.activity_id
      || !DATES_EXTERNAL_MESSAGE_ACTIONS.includes(decision.action as typeof DATES_EXTERNAL_MESSAGE_ACTIONS[number])
      || decision.target_path !== "published" || decision.expires_at !== null
      || decision.appeal_outcome !== null || decision.appeal_resolved_at !== null;
  })) return null;
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
