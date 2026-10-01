import { DATES_EXTERNAL_MODERATION_ACTIONS, datesAdminPrincipal, type DatesCaseSummary } from "./datesAdmin";
import { DATES_EXTERNAL_STATUSES, datesExternalRefusal } from "./datesExternalAdmin";
import { datesCaseDetail } from "./datesModerationRead";
import { DATES_EXTERNAL_RETRY_SECONDS, type DatesExternalStorage } from "./datesExternalMutations";

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: unknown, names: string[]): v is Record<string, unknown> => record(v)
  && Object.keys(v).length === names.length && names.every((name) => Object.hasOwn(v, name));
const positive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const id = (v: unknown, prefix: string): v is string => typeof v === "string" && new RegExp(`^${prefix}_[a-f0-9]{32}$`).test(v);
const text = (v: unknown, max: number, minimum = 3) => typeof v === "string" && [...v.trim()].length >= minimum && [...v].length <= max
  && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\uD800-\uDFFF]/u.test(v);
const actorValid = (v: unknown): v is string => typeof v === "string" && v === v.trim().toLowerCase() && v.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(v);
const actionValid = (v: unknown): v is typeof DATES_EXTERNAL_MODERATION_ACTIONS[number] => typeof v === "string"
  && DATES_EXTERNAL_MODERATION_ACTIONS.includes(v as typeof DATES_EXTERNAL_MODERATION_ACTIONS[number]);
type Send = (action: string, body: Record<string, unknown>) => Promise<unknown>;
export type DatesExternalResolutionBody = {
  case_id: string; expected_revision: number; expected_external_revision: number; action: typeof DATES_EXTERNAL_MODERATION_ACTIONS[number];
  reason: string; user_visible_reason_en: string; user_visible_reason_hu: string; expires_at: null; break_glass: boolean; idempotency_key: string;
};
function bodyValid(value: unknown): value is DatesExternalResolutionBody {
  return keys(value, ["case_id", "expected_revision", "expected_external_revision", "action", "reason", "user_visible_reason_en",
    "user_visible_reason_hu", "expires_at", "break_glass", "idempotency_key"])
    && id(value.case_id, "cas") && positive(value.expected_revision) && positive(value.expected_external_revision) && actionValid(value.action)
    && text(value.reason, 1000) && text(value.user_visible_reason_en, 500, 1) && text(value.user_visible_reason_hu, 500, 1)
    && value.expires_at === null && typeof value.break_glass === "boolean" && typeof value.idempotency_key === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(value.idempotency_key);
}

/** Member requests without the additive external CAS retain their old shape/hash. */
export function normalizeDatesExternalResolutionProxyBody(action: string, body: Record<string, unknown>) {
  if (action !== "dates_moderation_resolve" || !Object.hasOwn(body, "expected_external_revision")) return undefined;
  return bodyValid(body) ? body : null;
}
export function datesExternalResolutionAuthorized(membership: unknown): boolean {
  const principal = datesAdminPrincipal(membership);
  return principal !== null && ["dates_case_resolve", "dates_external_event_review"].every((capability) => principal.capabilities.includes(capability));
}

export type DatesExternalResolutionBaseline = { external_event_id: string; activity_id: string; activity_revision: number };
export type DatesExternalResolutionPending = { version: 1; actor: string; issued_at: number; body: DatesExternalResolutionBody; baseline: DatesExternalResolutionBaseline };
export type DatesExternalResolutionRead = { kind: "empty" } | { kind: "blocked" } | { kind: "pending"; pending: DatesExternalResolutionPending };
function baselineValid(v: unknown): v is DatesExternalResolutionBaseline {
  return keys(v, ["external_event_id", "activity_id", "activity_revision"]) && id(v.external_event_id, "xev") && id(v.activity_id, "act") && positive(v.activity_revision);
}
function pendingValid(v: unknown, actor: string): v is DatesExternalResolutionPending {
  return keys(v, ["version", "actor", "issued_at", "body", "baseline"]) && v.version === 1 && actorValid(actor) && v.actor === actor
    && positive(v.issued_at) && v.issued_at <= 4_102_444_800 && bodyValid(v.body) && baselineValid(v.baseline);
}
const storageKey = (actor: string) => `friending:external-case:pending:v1:${encodeURIComponent(actor)}`;
const same = (a: DatesExternalResolutionPending, b: DatesExternalResolutionPending) => JSON.stringify(a) === JSON.stringify(b);
export function readDatesExternalResolution(storage: DatesExternalStorage | null, actor: string): DatesExternalResolutionRead {
  if (!storage || !actorValid(actor)) return { kind: "blocked" };
  try {
    const raw = storage.getItem(storageKey(actor));
    if (raw === null) return { kind: "empty" };
    if (raw.length > 16000) return { kind: "blocked" };
    const value: unknown = JSON.parse(raw);
    return pendingValid(value, actor) ? { kind: "pending", pending: value } : { kind: "blocked" };
  } catch { return { kind: "blocked" }; }
}
export function prepareDatesExternalResolution(actor: string, body: Record<string, unknown>, baseline: DatesExternalResolutionBaseline, serverNow: number): DatesExternalResolutionPending | null {
  try {
    const value: unknown = JSON.parse(JSON.stringify({ version: 1, actor, issued_at: serverNow, body, baseline }));
    return pendingValid(value, actor) ? value : null;
  } catch { return null; }
}
export async function readDatesExternalResolutionAccess(send: Send, caseId: string) {
  try {
    const [identity, body] = await Promise.all([send("admin_me", {}), send("dates_moderation_detail", { case_id: caseId })]);
    const principal = datesAdminPrincipal(identity);
    if (!principal || !actorValid(principal.email)) return { kind: "unconfirmed" as const };
    if (!datesExternalResolutionAuthorized(identity)) return { kind: "denied" as const };
    const detail = datesCaseDetail(body, caseId);
    if (!detail || detail.case.target_type !== "external_event"
      || !record(body) || !positive(body.server_now) || body.server_now > 4_102_444_800) return { kind: "unconfirmed" as const };
    return { kind: "authorized" as const, actor: principal.email, principal, item: detail.case, serverNow: body.server_now };
  } catch { return { kind: "unconfirmed" as const }; }
}
function targetState(v: unknown): v is Record<string, unknown> {
  return keys(v, ["event_status", "revision", "activity_revision", "lifecycle", "moderation_state", "soft_deleted"])
    && typeof v.event_status === "string" && DATES_EXTERNAL_STATUSES.includes(v.event_status as typeof DATES_EXTERNAL_STATUSES[number])
    && positive(v.revision) && positive(v.activity_revision) && typeof v.lifecycle === "string" && ["draft", "active", "ended", "canceled"].includes(v.lifecycle)
    && typeof v.moderation_state === "string" && ["ok", "pending", "approved", "rejected", "removed", "appealed"].includes(v.moderation_state) && typeof v.soft_deleted === "boolean";
}
/** Validate the full receipt, including the independent content CAS and no UID0 sanction. */
export function datesExternalResolutionReceipt(value: unknown, pending: DatesExternalResolutionPending): Record<string, unknown> | null {
  if (!pendingValid(pending, pending?.actor)) return null;
  if (!keys(value, ["success", "status_code", "message", "status", "can_send", "server_now", "case_id", "case_status", "action", "decision_id",
    "target_result", "revision", "break_glass_used", "audit_id", "idempotency_replayed"]) || value.success !== true || value.status_code !== 200
    || value.message !== 200 || value.status !== 200 || value.can_send !== 0 || !positive(value.server_now) || value.server_now > 4_102_444_800 || !positive(value.revision)
    || value.case_id !== pending.body.case_id || value.revision !== pending.body.expected_revision + 1 || value.action !== pending.body.action
    || value.case_status !== (pending.body.action === "dismiss" ? "dismissed" : "actioned") || !id(value.decision_id, "dec") || !id(value.audit_id, "aud")
    || typeof value.idempotency_replayed !== "boolean" || typeof value.break_glass_used !== "boolean" || (value.break_glass_used && !pending.body.break_glass)) return null;
  const result = value.target_result;
  if (!keys(result, ["target_type", "target_id", "activity_id", "subject_uid", "target_path", "before", "after"])
    || result.target_type !== "external_event" || result.target_id !== pending.baseline.external_event_id || result.activity_id !== pending.baseline.activity_id || result.subject_uid !== 0) return null;
  if (pending.body.action === "dismiss") return result.target_path === "unchanged" && result.before === null && result.after === null ? value : null;
  if (result.target_path !== "published" || !targetState(result.before) || !targetState(result.after)) return null;
  const before = result.before, after = result.after;
  if (before.revision !== pending.body.expected_external_revision || Number(before.activity_revision) < pending.baseline.activity_revision
    || after.revision !== Number(before.revision) + 1 || after.activity_revision !== Number(before.activity_revision) + 1 || after.soft_deleted !== before.soft_deleted) return null;
  const terminal = before.lifecycle !== "active" || ["canceled_upstream", "withdrawn", "ended", "merged_into"].includes(String(before.event_status));
  if (pending.body.action === "restore_content") return !terminal && before.soft_deleted === false
    && after.event_status === "published" && after.lifecycle === "active" && after.moderation_state === "approved" ? value : null;
  if (pending.body.action === "cancel_activity") return !terminal && after.event_status === "withdrawn"
    && after.lifecycle === "canceled" && after.moderation_state === before.moderation_state ? value : null;
  return after.event_status === (terminal ? before.event_status : "rejected") && after.lifecycle === before.lifecycle && after.moderation_state === "removed" ? value : null;
}
function clear(storage: DatesExternalStorage, pending: DatesExternalResolutionPending): boolean {
  const current = readDatesExternalResolution(storage, pending.actor);
  if (current.kind !== "pending" || !same(current.pending, pending)) return false;
  try { storage.removeItem(storageKey(pending.actor)); return storage.getItem(storageKey(pending.actor)) === null; } catch { return false; }
}
const noLand: Record<string, number> = { "dates-moderation-case-closed": 409, "dates-moderation-claim-required": 409,
  "dates-moderation-resolution-conflict": 409, "dates-moderation-action-invalid": 422, "dates-moderation-target-invalid": 422, "dates-user-visible-reason-invalid": 422 };
export async function runDatesExternalResolution(pending: DatesExternalResolutionPending, storage: DatesExternalStorage | null, serverNow: number, send: Send) {
  if (!storage || !pendingValid(pending, pending.actor) || !positive(serverNow) || pending.issued_at > serverNow + 300) return { kind: "blocked" as const };
  if (serverNow - pending.issued_at >= DATES_EXTERNAL_RETRY_SECONDS) return { kind: "expired" as const };
  const previous = readDatesExternalResolution(storage, pending.actor);
  if (previous.kind === "blocked" || (previous.kind === "pending" && !same(previous.pending, pending))) return { kind: "blocked" as const };
  try {
    if (previous.kind === "empty") storage.setItem(storageKey(pending.actor), JSON.stringify(pending));
    const saved = readDatesExternalResolution(storage, pending.actor);
    if (saved.kind !== "pending" || !same(saved.pending, pending)) return { kind: "blocked" as const };
  } catch { return { kind: "blocked" as const }; }
  let value: unknown;
  try { value = await send("dates_moderation_resolve", pending.body); } catch { return { kind: "uncertain" as const }; }
  if (datesExternalResolutionReceipt(value, pending)) return { kind: "success" as const, retained: !clear(storage, pending) };
  const refusal = datesExternalRefusal(value);
  const coreRefusal = keys(value, ["success", "status_code", "error", "message", "status", "can_send"])
    && value.success === false && value.message === 200 && value.status === 200 && value.can_send === 0
    && typeof value.error === "string" && Object.hasOwn(noLand, value.error) && value.status_code === noLand[value.error];
  if (refusal.kind === "refused" || coreRefusal) return { kind: "refused" as const, error: refusal.error, retained: !clear(storage, pending) };
  return { kind: "uncertain" as const };
}

/** New decisions use the current case/content pair; receipt retries do not invent a new pair. */
export function datesExternalResolutionMatches(item: DatesCaseSummary, body: Record<string, unknown>, baseline: DatesExternalResolutionBaseline): boolean {
  return item.target_type === "external_event" && item.target_id === baseline.external_event_id && item.activity_id === baseline.activity_id
    && item.case_id === body.case_id && item.revision === body.expected_revision && item.external_revision === body.expected_external_revision;
}
