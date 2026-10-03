/**
 * T-891: the receipts of the Dates console's commands outside the journal,
 * each bound to the request that produced it.
 *
 * Proven on Core's genuine request / answer pairs (the corpus
 * tests/fixtures/dates_admin_command_wire, Core claude/core-hardening-20261002
 * 33265e46; the requests are those of its generator). A check binds on what
 * identifies the command - the target, the action, the revision the command
 * leaves behind - and tolerates any key it does not name. A success body that
 * does not pass is not a receipt: the page then says the outcome is not known
 * (`datesCommandOutcome` with `receipt: false`), never success, never failure.
 *
 * `request` is what the page sent, before the bridge encoded it.
 */

type Fields = Record<string, unknown>;
const record = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);
const integer = (value: unknown, minimum = 0): value is number => Number.isSafeInteger(value) && (value as number) >= minimum;
const epoch = (value: unknown): value is number => integer(value, 1) && value <= 4_102_444_800;
const id = (prefix: string, value: unknown): value is string => typeof value === "string" && new RegExp(`^${prefix}_[a-f0-9]{32}$`).test(value);
const token = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-z_]{0,63}$/.test(value);
/** The revision the request was sent with: a non-negative integer, or nothing can be bound to it. */
const sentRevision = (request: Fields): number | null => integer(request.expected_revision) ? request.expected_revision : null;

/** Core's envelope around a receipt, and the two fields every command receipt carries. */
function receipt(value: unknown): value is Fields {
  return record(value) && value.success === true && value.status_code === 200
    && id("aud", value.audit_id) && typeof value.idempotency_replayed === "boolean";
}

/** The activity lifecycles Core serves (as on every other activity row of the console). */
const LIFECYCLES: readonly string[] = ["draft", "active", "ended", "canceled"];

/**
 * `dates_activity_update` of a member activity: the same activity, one revision on.
 * Pair: admin-activity-update (+ -replay) - activity 11, expected_revision 1 -> revision 2 (generator lines 433-437).
 */
export function datesActivityUpdateReceipt(value: unknown, request: Fields): boolean {
  const expected = sentRevision(request);
  return expected !== null && receipt(value) && id("act", value.activity_id) && value.activity_id === request.activity_id
    && value.revision === expected + 1 && token(value.moderation_state);
}

/**
 * `dates_activity_command` of a member activity. end / cancel / soft_delete / restore move the revision by one and
 * echo the action with the state it leaves; a purge echoes no action, says `purged`, and names the revision that was
 * purged - the one the request expected.
 * Pairs (generator lines 443-461): end 1 -> 2 `ended`; cancel 1 -> 2 `canceled`; soft_delete 1 -> 2 soft-deleted;
 * restore 2 -> 3 not soft-deleted; purge 4 -> 4 `purged: true`.
 */
export function datesActivityCommandReceipt(value: unknown, request: Fields): boolean {
  const expected = sentRevision(request), action = request.action;
  if (expected === null || !receipt(value) || !id("act", value.activity_id) || value.activity_id !== request.activity_id) return false;
  if (action === "purge") return value.purged === true && value.revision === expected;
  if (value.action !== action || value.revision !== expected + 1 || typeof value.lifecycle !== "string" || !LIFECYCLES.includes(value.lifecycle)
    || typeof value.soft_deleted !== "boolean") return false;
  return action === "end" ? value.lifecycle === "ended" && !value.soft_deleted
    : action === "cancel" ? value.lifecycle === "canceled" && !value.soft_deleted
      : action === "soft_delete" ? value.soft_deleted
        : action === "restore" ? !value.soft_deleted : false;
}

export type DatesHostTransferReceipt = {
  transfer_id: string;
  /** The activity's revision after the request (T-891, with the command contract selector); `null` when not served. */
  activity_revision: number | null;
};

/**
 * `dates_activity_host_transfer`: a pending transfer of this activity to this member. With the command contract
 * selector Core also names the activity revision the request left (`activity_revision`, one on from the request's);
 * without it (a Core that does not know the selector) the key is absent, and the receipt is still the transfer's.
 * Pairs (generator lines 466-470 and 528-531): activity 15 / 16, target 70315 / 70316, expected_revision 1; the
 * selected answer carries `activity_revision: 2`.
 */
export function datesHostTransferReceipt(value: unknown, request: Fields): DatesHostTransferReceipt | null {
  const expected = sentRevision(request);
  if (expected === null || !receipt(value) || !id("trf", value.transfer_id) || !id("act", value.activity_id) || value.activity_id !== request.activity_id
    || !integer(value.target_uid, 1) || value.target_uid !== Number(request.target_uid) || value.transfer_status !== "pending"
    || !integer(value.outgoing_host_uid, 1) || !epoch(value.expires_at) || !integer(value.revision, 1)) return null;
  if (!Object.hasOwn(value, "activity_revision")) return { transfer_id: value.transfer_id, activity_revision: null };
  return value.activity_revision === expected + 1 ? { transfer_id: value.transfer_id, activity_revision: value.activity_revision } : null;
}

/**
 * `dates_configuration_save`: the setting that was saved, one revision on - also the first save of a setting that
 * had no stored row (`expected_revision: 0` -> revision 1). The value is Core's normalised one (a number for "12");
 * it is not compared with what was typed.
 * Pairs (generator lines 476-482): dates_report_sla_hours 1 -> 2; dates_reinvite_cooldown_hours 0 -> 1 (+ replay).
 */
export function datesSettingSaveReceipt(value: unknown, request: Fields): boolean {
  const expected = sentRevision(request);
  return expected !== null && receipt(value) && record(value.setting) && typeof request.key === "string"
    && value.setting.key === request.key && value.setting.revision === expected + 1 && Object.hasOwn(value.setting, "value");
}

/**
 * `dates_activity_type_save`: the type that was saved, one revision on (the type's own revision and the receipt's agree).
 * Pair (generator lines 485-489): sport, expected_revision 1 -> 2.
 */
export function datesActivityTypeSaveReceipt(value: unknown, request: Fields): boolean {
  const expected = sentRevision(request);
  return expected !== null && receipt(value) && record(value.activity_type) && typeof request.key === "string"
    && value.activity_type.key === request.key && value.revision === expected + 1 && value.activity_type.revision === expected + 1;
}

/**
 * `dates_reason_deactivate`: this reason, now inactive, one revision on.
 * Pair (generator lines 493-496): reason_activity_fixture_one, expected_revision 1 -> 2.
 */
export function datesReasonDeactivateReceipt(value: unknown, request: Fields): boolean {
  const expected = sentRevision(request);
  return expected !== null && receipt(value) && typeof request.reason_id === "string" && value.reason_id === request.reason_id
    && value.active === false && value.revision === expected + 1;
}

/**
 * `dates_moderation_resolve` of a member case: this case, this action, one decision, one revision on.
 * Pair (generator lines 504-510): case 4, expected_revision 2 -> 3, action dismiss -> case_status dismissed.
 */
export function datesCaseResolutionReceipt(value: unknown, request: Fields): boolean {
  const expected = sentRevision(request);
  return expected !== null && receipt(value) && id("cas", value.case_id) && value.case_id === request.case_id
    && token(request.action) && value.action === request.action && token(value.case_status) && id("dec", value.decision_id)
    && value.revision === expected + 1 && typeof value.break_glass_used === "boolean";
}
