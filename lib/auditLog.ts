/**
 * Audit log row model and detail redaction.
 *
 * Two problems this replaces on `/audit`:
 *
 * 1. The page cast Core's success payload straight to `AuditRow[]` with no per-row validation, so a
 *    malformed row rendered `undefined` rather than an error — the exact thing `AGENTS.md` forbids
 *    ("Treat malformed success responses as errors").
 * 2. It rendered the whole `details` blob through `JSON.stringify`, into both the cell and its
 *    `title` tooltip. `WebadminController::writeAudit()` types `details` as a free-form array, and
 *    the richer Dates writer puts `before`, `after` and `reason` in the same collection. WEBADMIN-PLAN
 *    WA-06 is explicit: "Do not render secret or intimate answer values in list views."
 *
 * The redaction is an allow-list, not a denylist, because the set of things Core may one day put in
 * `details` is open and a denylist would have to predict it. An unrecognised key is withheld and
 * counted, so the operator can still see that data exists and ask for it through a purpose-built
 * projection rather than reading it out of a table cell.
 */

export type AuditRow = {
  id: string;
  actor_email: string;
  action: string;
  target: string;
  details: Record<string, unknown>;
  created_at: number;
};

/**
 * Keys safe to render in a list view: structural identifiers, revisions, states and counts. Every
 * one of them is metadata about *which* object changed, never the content of a member's answer.
 *
 * Adding a key here is a deliberate act and should be justified the same way a gender rule is: say
 * why the value cannot carry member content. `reason` is included because a stated reason is
 * admin-authored and is meant to be read — it is truncated rather than withheld.
 */
export const AUDIT_DETAIL_SAFE_KEYS = [
  "action",
  "active",
  "archived",
  "catalog_key",
  "count",
  "dates_break_glass",
  "dates_linked_uid",
  "dates_role",
  "dates_sensitive_location",
  "domain",
  "expected_revision",
  "field_key",
  "group_key",
  "is_active",
  "item_key",
  "key",
  "mode",
  "option_id",
  "outcome",
  "reason",
  "revision",
  "role",
  "schema_version",
  "sort_order",
  "status",
  "target_type",
  "uid",
] as const;

const SAFE_KEYS: ReadonlySet<string> = new Set(AUDIT_DETAIL_SAFE_KEYS);

/** Long enough for an identifier or a short stated reason, short enough for one table row. */
export const AUDIT_DETAIL_VALUE_MAX = 120;

export type AuditDetailSummary = {
  /** Allow-listed key/value pairs, in the order the keys are listed above. */
  shown: Array<{ key: string; value: string }>;
  /** How many keys were present but not rendered. Never the keys themselves. */
  withheld: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function primitive(value: unknown): string | null {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.length > AUDIT_DETAIL_VALUE_MAX
    ? `${trimmed.slice(0, AUDIT_DETAIL_VALUE_MAX)}…`
    : trimmed;
}

/**
 * Reduce a free-form `details` object to what may be shown in a list.
 *
 * A nested object or array is always withheld regardless of its key: that is the shape `before` and
 * `after` payloads take, and an allow-listed key is no guarantee about a nested value's content.
 */
function summarise(
  source: Record<string, unknown> | null,
  order: readonly string[],
  allowed: ReadonlySet<string>,
): AuditDetailSummary {
  if (!source) return { shown: [], withheld: 0 };

  const shown: AuditDetailSummary["shown"] = [];
  let withheld = 0;
  const seen = new Set<string>();

  for (const key of order) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    seen.add(key);
    const value = primitive(source[key]);
    if (value === null) {
      withheld += 1;
      continue;
    }
    shown.push({ key, value });
  }

  for (const key of Object.keys(source)) {
    if (!seen.has(key) && !allowed.has(key)) withheld += 1;
  }

  return { shown, withheld };
}

export function auditDetailSummary(details: unknown): AuditDetailSummary {
  return summarise(record(details), AUDIT_DETAIL_SAFE_KEYS, SAFE_KEYS);
}

/**
 * Keys safe to render for a Dates operational record — a report, notification, moderation decision
 * or audit-history row on the activity detail page.
 *
 * Deliberately narrower than the audit-details list. Core passes `moderation_decisions` and
 * `audit_history` through as whole documents (only `_id`, and for audit `session_metadata`, are
 * removed), so an unfiltered render printed `actor_email`, `actor_linked_uid` — the acting
 * moderator's own member UID — the free-text `reason` and the raw `before`/`after` blocks to every
 * active administrator, including a read-only one. Identities and free text are withheld here; an
 * operator who genuinely needs the whole document should get it through an explicit audited action,
 * not from the default render of a history panel.
 */
export const OPERATIONAL_RECORD_SAFE_KEYS = [
  "action",
  "actor_role",
  "audit_id",
  "category",
  "created_at",
  "decision_id",
  "notification_id",
  "outcome",
  "reason_key",
  "report_id",
  "reporter_identity_redacted",
  "resolved_at",
  "scope",
  "sensitive_read",
  "severity",
  "state",
  "status",
  "target_type",
  "type",
  "updated_at",
] as const;

const OPERATIONAL_SAFE_KEYS: ReadonlySet<string> = new Set(OPERATIONAL_RECORD_SAFE_KEYS);

export function operationalRecordSummary(value: unknown): AuditDetailSummary {
  return summarise(record(value), OPERATIONAL_RECORD_SAFE_KEYS, OPERATIONAL_SAFE_KEYS);
}

/**
 * Parse a Core `list_audit` payload, failing closed. A row missing a field the table renders is a
 * malformed response, not an empty cell.
 */
export function auditRows(value: unknown): AuditRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: AuditRow[] = [];
  for (const item of value) {
    const source = record(item);
    if (!source) return null;
    const id = source.id;
    const actor = source.actor_email;
    const action = source.action;
    const target = source.target;
    const createdAt = source.created_at;
    if (
      (typeof id !== "string" && typeof id !== "number")
      || typeof actor !== "string"
      || typeof action !== "string"
      || (target !== undefined && target !== null && typeof target !== "string")
      || !Number.isFinite(Number(createdAt))
    ) return null;
    // `details` is free-form by contract, so its absence or a non-object value is tolerated and
    // normalised to an empty object. Its *content* is never trusted — see `auditDetailSummary`.
    rows.push({
      id: String(id),
      actor_email: actor,
      action,
      target: typeof target === "string" ? target : "",
      details: record(source.details) ?? {},
      created_at: Number(createdAt),
    });
  }
  return rows;
}
