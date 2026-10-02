import { DATES_EXTERNAL_MESSAGE_ACTIONS, datesAdminPrincipal, isDatesExternalMessageCase, permittedResolutionActions,
  type DatesAdminPrincipal, type DatesCaseSummary } from "./datesAdmin";
import { datesCaseDetail } from "./datesModerationRead";
import { DATES_EXTERNAL_RETRY_SECONDS, type DatesExternalStorage } from "./datesExternalMutations";

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** Exact: the console's own request and its own saved row carry these keys and no other. */
const keys = (v: unknown, names: string[]): v is Record<string, unknown> => record(v)
  && Object.keys(v).length === names.length && names.every((name) => Object.hasOwn(v, name));
/** A body of Core is bound on its fields; a key this console does not know is tolerated (D-143). */
const fields = (v: unknown, names: string[]): v is Record<string, unknown> => record(v) && names.every((name) => Object.hasOwn(v, name));
/** Core's refusal: the legacy envelope with its fixed values, whatever else it carries. */
const coreRefused = (v: unknown): v is Record<string, unknown> => fields(v, ["success", "status_code", "error", "message", "status", "can_send"])
  && v.success === false && v.message === 200 && v.status === 200 && v.can_send === 0 && typeof v.error === "string";
const positive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const revision = (v: unknown): v is number => positive(v) && v < Number.MAX_SAFE_INTEGER;
const clock = (v: unknown): v is number => positive(v) && v <= 4_102_444_800;
const id = (v: unknown, prefix: string): v is string => typeof v === "string" && new RegExp(`^${prefix}_[a-f0-9]{32}$`).test(v);
const text = (v: unknown, max: number, minimum = 1) => typeof v === "string" && [...v.trim()].length >= minimum && [...v].length <= max
  && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\uD800-\uDFFF]/u.test(v);
const actorValid = (v: unknown): v is string => typeof v === "string" && v === v.trim().toLowerCase()
  && v.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(v);
type Send = (action: string, body: Record<string, unknown>) => Promise<unknown>;
type Action = typeof DATES_EXTERNAL_MESSAGE_ACTIONS[number];
const actionValid = (v: unknown): v is Action => typeof v === "string" && DATES_EXTERNAL_MESSAGE_ACTIONS.includes(v as Action);

/** No invented target-CAS parameter: Core binds the immutable message in the case. */
export type DatesExternalMessageResolutionBody = {
  case_id: string; expected_revision: number; action: Action; reason: string;
  user_visible_reason_en: string; user_visible_reason_hu: string; expires_at: null;
  break_glass: boolean; idempotency_key: string;
};
function bodyValid(v: unknown): v is DatesExternalMessageResolutionBody {
  return keys(v, ["case_id", "expected_revision", "action", "reason", "user_visible_reason_en", "user_visible_reason_hu",
    "expires_at", "break_glass", "idempotency_key"])
    && id(v.case_id, "cas") && revision(v.expected_revision) && actionValid(v.action)
    && text(v.reason, 1000, 3) && text(v.user_visible_reason_en, 500) && text(v.user_visible_reason_hu, 500)
    && v.expires_at === null && typeof v.break_glass === "boolean" && typeof v.idempotency_key === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(v.idempotency_key);
}

/** Safe target identity only; never persist the message or its evidence snapshot. */
export type DatesExternalMessageResolutionBaseline = {
  message_id: string; activity_id: string; thread_id: string; target_uid: number; revision: number;
};
export type DatesExternalMessageResolutionPending = {
  version: 1; actor: string; issued_at: number; body: DatesExternalMessageResolutionBody; baseline: DatesExternalMessageResolutionBaseline;
};
export type DatesExternalMessageResolutionRead = { kind: "empty" } | { kind: "blocked" }
  | { kind: "pending"; pending: DatesExternalMessageResolutionPending };
function baselineValid(v: unknown): v is DatesExternalMessageResolutionBaseline {
  return keys(v, ["message_id", "activity_id", "thread_id", "target_uid", "revision"])
    && id(v.message_id, "msg") && id(v.activity_id, "act") && id(v.thread_id, "thr")
    && positive(v.target_uid) && v.target_uid > 1 && revision(v.revision);
}
function pendingValid(v: unknown, actor: string): v is DatesExternalMessageResolutionPending {
  return keys(v, ["version", "actor", "issued_at", "body", "baseline"]) && v.version === 1 && actorValid(actor)
    && v.actor === actor && clock(v.issued_at) && bodyValid(v.body) && baselineValid(v.baseline);
}
const storageKey = (actor: string) => `friending:external-message-case:pending:v1:${encodeURIComponent(actor)}`;
const same = (a: DatesExternalMessageResolutionPending, b: DatesExternalMessageResolutionPending) => JSON.stringify(a) === JSON.stringify(b);

export function readDatesExternalMessageResolution(storage: DatesExternalStorage | null, actor: string): DatesExternalMessageResolutionRead {
  if (!storage || !actorValid(actor)) return { kind: "blocked" };
  try {
    const raw = storage.getItem(storageKey(actor));
    if (raw === null) return { kind: "empty" };
    if (raw.length > 16000) return { kind: "blocked" };
    const value: unknown = JSON.parse(raw);
    return pendingValid(value, actor) ? { kind: "pending", pending: value } : { kind: "blocked" };
  } catch { return { kind: "blocked" }; }
}

export function prepareDatesExternalMessageResolution(actor: string, body: Record<string, unknown>,
  baseline: DatesExternalMessageResolutionBaseline, serverNow: number): DatesExternalMessageResolutionPending | null {
  const value = { version: 1, actor, issued_at: serverNow, body, baseline };
  if (!pendingValid(value, actor)) return null;
  // The form and its later edits do not own an uncertain command's bytes.
  return { ...value, body: { ...value.body }, baseline: { ...value.baseline } };
}

export function datesExternalMessageResolutionBaseline(item: DatesCaseSummary): DatesExternalMessageResolutionBaseline | null {
  const value = { message_id: item.target_id, activity_id: item.activity_id, thread_id: item.external_message?.thread_id,
    target_uid: item.target_uid, revision: item.external_message?.revision };
  return isDatesExternalMessageCase(item) && baselineValid(value) ? value : null;
}

/** Closed cases remain readable for exact-key recovery, but never grant a new decision. */
export async function readDatesExternalMessageResolutionAccess(send: Send, caseId: string) {
  if (!id(caseId, "cas")) return null;
  try {
    const [identity, body] = await Promise.all([send("admin_me", {}), send("dates_moderation_detail", { case_id: caseId })]);
    const principal = datesAdminPrincipal(identity), detail = datesCaseDetail(body, caseId);
    if (!principal || !actorValid(principal.email) || !principal.capabilities.includes("dates_case_resolve")
      || !detail || !isDatesExternalMessageCase(detail.case) || !record(body) || !clock(body.server_now)) return null;
    return { actor: principal.email, principal, item: detail.case, serverNow: body.server_now };
  } catch { return null; }
}

export function datesExternalMessageResolutionMayStart(item: DatesCaseSummary, principal: DatesAdminPrincipal,
  body: Record<string, unknown>, baseline: DatesExternalMessageResolutionBaseline, serverNow: number): boolean {
  if (!bodyValid(body) || !baselineValid(baseline) || !clock(serverNow) || !isDatesExternalMessageCase(item)
    || item.case_id !== body.case_id || item.revision !== body.expected_revision || item.target_id !== baseline.message_id
    || item.activity_id !== baseline.activity_id || item.target_uid !== baseline.target_uid
    || item.external_message?.thread_id !== baseline.thread_id || item.external_message.revision !== baseline.revision
    || !permittedResolutionActions(item, principal).includes(body.action)
    || item.assignee_email?.toLowerCase() !== principal.email || !positive(item.claim_expires_at) || item.claim_expires_at <= serverNow) return false;
  return item.capabilities.can_resolve || (item.conflict_of_interest && body.break_glass && principal.break_glass && item.capabilities.can_break_glass);
}

function targetState(v: unknown): v is { moderation_state: string; revision: number; sequence: number } {
  return fields(v, ["moderation_state", "revision", "sequence"]) && typeof v.moderation_state === "string"
    && ["visible", "pending", "rejected"].includes(v.moderation_state) && positive(v.revision) && positive(v.sequence);
}

/** Audit/case CAS plus the immutable target identity, revision and decision effect. */
export function datesExternalMessageResolutionReceipt(value: unknown, pending: DatesExternalMessageResolutionPending): Record<string, unknown> | null {
  if (!pendingValid(pending, pending?.actor)) return null;
  if (!fields(value, ["success", "status_code", "message", "status", "can_send", "server_now", "case_id", "case_status", "action", "decision_id",
    "target_result", "revision", "break_glass_used", "audit_id", "idempotency_replayed"])
    || value.success !== true || value.status_code !== 200 || value.message !== 200 || value.status !== 200 || value.can_send !== 0
    || !clock(value.server_now) || value.case_id !== pending.body.case_id || value.case_status !== "actioned"
    || value.action !== pending.body.action || value.revision !== pending.body.expected_revision + 1
    || !id(value.decision_id, "dec") || !id(value.audit_id, "aud") || typeof value.idempotency_replayed !== "boolean"
    || typeof value.break_glass_used !== "boolean" || (value.break_glass_used && !pending.body.break_glass)) return null;
  const result = value.target_result;
  if (!fields(result, ["target_type", "target_id", "activity_id", "subject_uid", "target_path", "before", "after"])
    || result.target_type !== "message" || result.target_id !== pending.baseline.message_id || result.activity_id !== pending.baseline.activity_id
    || result.subject_uid !== pending.baseline.target_uid || result.target_path !== "published"
    || !targetState(result.before) || !targetState(result.after)) return null;
  const before = result.before, after = result.after;
  if (before.moderation_state !== "pending" || before.revision !== pending.baseline.revision || after.revision !== before.revision + 1) return null;
  return pending.body.action === "approve_content"
    ? after.moderation_state === "visible" && after.sequence > before.sequence ? value : null
    : after.moderation_state === "rejected" && after.sequence === before.sequence ? value : null;
}

function clear(storage: DatesExternalStorage, pending: DatesExternalMessageResolutionPending): boolean {
  const current = readDatesExternalMessageResolution(storage, pending.actor);
  if (current.kind !== "pending" || !same(current.pending, pending)) return false;
  try { storage.removeItem(storageKey(pending.actor)); return storage.getItem(storageKey(pending.actor)) === null; } catch { return false; }
}
const noLand: Record<string, number> = {
  // Core checks the claimed case revision inside the receipted transaction,
  // before applying the target decision; a failed CAS cannot have landed.
  "dates-admin-stale-revision": 409,
  "dates-moderation-case-closed": 409, "dates-moderation-case-conflict": 409, "dates-moderation-claim-required": 409,
  "dates-moderation-resolution-conflict": 409, "dates-moderation-target-stale": 409,
  "dates-moderation-action-invalid": 422, "dates-moderation-target-invalid": 422, "dates-user-visible-reason-invalid": 422,
};

export async function runDatesExternalMessageResolution(pending: DatesExternalMessageResolutionPending, storage: DatesExternalStorage | null,
  serverNow: number, send: Send) {
  if (!storage || !pendingValid(pending, pending?.actor) || !clock(serverNow) || pending.issued_at > serverNow + 300) return { kind: "blocked" as const };
  const attempt = prepareDatesExternalMessageResolution(pending.actor, pending.body, pending.baseline, pending.issued_at)!;
  if (serverNow - attempt.issued_at >= DATES_EXTERNAL_RETRY_SECONDS) return { kind: "expired" as const };
  const previous = readDatesExternalMessageResolution(storage, attempt.actor);
  if (previous.kind === "blocked" || (previous.kind === "pending" && !same(previous.pending, attempt))) return { kind: "blocked" as const };
  try {
    if (previous.kind === "empty") storage.setItem(storageKey(attempt.actor), JSON.stringify(attempt));
    const saved = readDatesExternalMessageResolution(storage, attempt.actor);
    if (saved.kind !== "pending" || !same(saved.pending, attempt)) return { kind: "blocked" as const };
  } catch { return { kind: "blocked" as const }; }
  let value: unknown;
  try { value = await send("dates_moderation_resolve", { ...attempt.body }); } catch { return { kind: "uncertain" as const }; }
  if (datesExternalMessageResolutionReceipt(value, attempt)) return { kind: "success" as const, retained: !clear(storage, attempt) };
  if (coreRefused(value) && Object.hasOwn(noLand, value.error as string) && value.status_code === noLand[value.error as string]) {
    return { kind: "refused" as const, retained: !clear(storage, attempt) };
  }
  return { kind: "uncertain" as const };
}
