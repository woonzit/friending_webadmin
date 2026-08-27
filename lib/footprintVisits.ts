import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";
import {
  webadminDataSuccessEnvelope,
  webadminErrorEnvelope,
} from "@/lib/webadminEnvelope";

/**
 * Accepted T-123 Core ↔ Webadmin Footprints visits-switch contract v1,
 * including lead amendments A1–A3.
 *
 * The switch governs the VISITS half of Footprints only. Badges, the
 * photo-likes collector and the chat gate are a different surface and are
 * deliberately not decoded here.
 */
export const FOOTPRINT_VISITS_CONTRACT_VERSION = 1 as const;
export const FOOTPRINT_VISITS_CAPABILITIES = [
  "footprints_visits_read",
  "footprints_visits_edit",
] as const;
export const FOOTPRINT_VISITS_ACTIONS = [
  "footprints_visits_get",
  "footprints_visits_set",
] as const;

export const FOOTPRINT_VISITS_REASON_MAX = 300 as const;
export const FOOTPRINT_VISITS_REVISION_MAX = 2_147_483_647 as const;

export type FootprintVisitsCapability = (typeof FOOTPRINT_VISITS_CAPABILITIES)[number];
export type FootprintVisitsAction = (typeof FOOTPRINT_VISITS_ACTIONS)[number];
export type FootprintVisitsRole = "viewer" | "admin" | "owner";

export type FootprintVisitsPrincipal = {
  role: FootprintVisitsRole;
  capabilities: FootprintVisitsCapability[];
};

export type FootprintVisitsAdminMe = {
  contract_version: 1;
  contract_ready: boolean;
  /** A rendering hint only — a mutation still binds the revision from `get`. */
  visits_enabled: boolean;
  revision: number;
  principal: FootprintVisitsPrincipal;
  actions: FootprintVisitsAction[];
};

export type FootprintVisitsState = {
  visits_enabled: boolean;
  revision: number;
  updated_at: number;
  updated_by: string;
};

export type FootprintVisitsMutation = FootprintVisitsState & {
  no_change: boolean;
  replayed: boolean;
};

export type FootprintVisitsConflict = {
  current: FootprintVisitsState;
};

type JsonObject = Record<string, unknown>;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PLAIN_TEXT_CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

function record(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function exactObject(value: unknown, keys: readonly string[]): JsonObject | null {
  const source = record(value);
  if (!source) return null;
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
    ? source
    : null;
}

function oneOf<const T extends readonly string[]>(value: unknown, values: T): T[number] | null {
  return typeof value === "string" && (values as readonly string[]).includes(value)
    ? value as T[number]
    : null;
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= minimum && value <= maximum
    ? value
    : null;
}

function scalarLength(value: string): number {
  return [...value].length;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * NFC-normalized, boundary-trimmed, control-free internal text of 1–300
 * scalars. Internal whitespace is preserved; it is never member-facing.
 */
function canonicalReason(value: unknown): string | null {
  if (typeof value !== "string" || hasUnpairedSurrogate(value)
    || value !== value.normalize("NFC") || value !== value.trim()) return null;
  if (PLAIN_TEXT_CONTROL.test(value)) return null;
  const length = scalarLength(value);
  return length >= 1 && length <= FOOTPRINT_VISITS_REASON_MAX ? value : null;
}

export function footprintVisitsReasonIsValid(value: unknown): value is string {
  return canonicalReason(value) !== null;
}

/**
 * The actor email Core echoes back. Bounded and control-free, and rendered
 * only as plain text.
 */
function canonicalActor(value: unknown): string | null {
  if (typeof value !== "string" || hasUnpairedSurrogate(value)) return null;
  if (value !== value.normalize("NFC") || PLAIN_TEXT_CONTROL.test(value)) return null;
  return scalarLength(value) <= 320 ? value : null;
}

function orderedUnique<const T extends readonly string[]>(value: unknown, canonical: T): T[number][] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value.map((entry) => oneOf(entry, canonical));
  if (parsed.some((entry) => entry === null)) return null;
  const rows = parsed as T[number][];
  if (new Set(rows).size !== rows.length) return null;
  const expected = canonical.filter((entry) => rows.includes(entry));
  return expected.length === rows.length && expected.every((entry, index) => entry === rows[index])
    ? rows
    : null;
}

function exactOrdered(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function expectedCapabilities(role: FootprintVisitsRole): FootprintVisitsCapability[] {
  return role === "viewer"
    ? ["footprints_visits_read"]
    : [...FOOTPRINT_VISITS_CAPABILITIES];
}

function expectedActions(principal: FootprintVisitsPrincipal): FootprintVisitsAction[] {
  return FOOTPRINT_VISITS_ACTIONS.filter((action) => action === "footprints_visits_get"
    ? principal.capabilities.includes("footprints_visits_read")
    : principal.capabilities.includes("footprints_visits_edit"));
}

function footprintVisitsPrincipal(value: unknown): FootprintVisitsPrincipal | null {
  const source = exactObject(value, ["role", "capabilities"]);
  const role = oneOf(source?.role, ["viewer", "admin", "owner"] as const);
  const capabilities = orderedUnique(source?.capabilities, FOOTPRINT_VISITS_CAPABILITIES);
  if (!role || !capabilities || !exactOrdered(capabilities, expectedCapabilities(role))) return null;
  return { role, capabilities };
}

export function footprintVisitsAdminMe(value: unknown): FootprintVisitsAdminMe | null {
  const source = exactObject(value, [
    "contract_version", "contract_ready", "visits_enabled", "revision", "principal", "actions",
  ]);
  const principal = footprintVisitsPrincipal(source?.principal);
  const revision = integer(source?.revision, 0, FOOTPRINT_VISITS_REVISION_MAX);
  if (source?.contract_version !== 1
    || typeof source.contract_ready !== "boolean"
    || typeof source.visits_enabled !== "boolean"
    || revision === null
    || !principal) return null;
  const actions = source.contract_ready ? expectedActions(principal) : [];
  if (!exactOrdered(source.actions, actions)) return null;
  return {
    contract_version: 1,
    contract_ready: source.contract_ready,
    visits_enabled: source.visits_enabled,
    revision,
    principal,
    actions,
  };
}

export const FOOTPRINT_VISITS_ACTION_CAPABILITY: Record<
  FootprintVisitsAction,
  FootprintVisitsCapability
> = {
  footprints_visits_get: "footprints_visits_read",
  footprints_visits_set: "footprints_visits_edit",
};

export function footprintVisitsProxyCapabilityAuthorized(action: string, membership: unknown): boolean | null {
  if (!(FOOTPRINT_VISITS_ACTIONS as readonly string[]).includes(action)) return null;
  const block = footprintVisitsAdminMe(record(membership)?.footprints_visits);
  const typedAction = action as FootprintVisitsAction;
  return Boolean(block?.contract_ready
    && block.actions.includes(typedAction)
    && block.principal.capabilities.includes(FOOTPRINT_VISITS_ACTION_CAPABILITY[typedAction]));
}

function footprintVisitsState(value: unknown): FootprintVisitsState | null {
  const source = exactObject(value, ["visits_enabled", "revision", "updated_at", "updated_by"]);
  const revision = integer(source?.revision, 0, FOOTPRINT_VISITS_REVISION_MAX);
  const updatedAt = integer(source?.updated_at, 0, Number.MAX_SAFE_INTEGER);
  const updatedBy = canonicalActor(source?.updated_by);
  if (typeof source?.visits_enabled !== "boolean" || revision === null
    || updatedAt === null || updatedBy === null) return null;
  // Provenance is either wholly absent (never set through this action) or
  // wholly present. A timestamp without an actor, or an actor without a
  // timestamp, is a shape Core does not produce.
  if ((updatedAt === 0) !== (updatedBy === "")) return null;
  return {
    visits_enabled: source.visits_enabled,
    revision,
    updated_at: updatedAt,
    updated_by: updatedBy,
  };
}

export function footprintVisitsStateResponse(value: unknown): FootprintVisitsState | null {
  const envelope = webadminDataSuccessEnvelope(value);
  return envelope ? footprintVisitsState(envelope.data) : null;
}

export function footprintVisitsMutationResponse(value: unknown): FootprintVisitsMutation | null {
  const envelope = webadminDataSuccessEnvelope(value);
  const source = exactObject(envelope?.data, [
    "visits_enabled", "revision", "updated_at", "updated_by", "no_change", "replayed",
  ]);
  if (!source || typeof source.no_change !== "boolean" || typeof source.replayed !== "boolean") return null;
  const state = footprintVisitsState({
    visits_enabled: source.visits_enabled,
    revision: source.revision,
    updated_at: source.updated_at,
    updated_by: source.updated_by,
  });
  return state ? { ...state, no_change: source.no_change, replayed: source.replayed } : null;
}

export function footprintVisitsConflictResponse(value: unknown): FootprintVisitsConflict | null {
  const envelope = webadminErrorEnvelope(value, "required");
  if (envelope?.error !== "footprints-visits-conflict" || envelope.status_code !== 409) return null;
  const source = exactObject(envelope.data, ["current"]);
  const current = footprintVisitsState(source?.current);
  return current ? { current } : null;
}

export const FOOTPRINT_VISITS_ERROR_STATUSES: Readonly<Record<string, number>> = {
  unauthorized: 401,
  "auth-required": 401,
  "bad-origin": 403,
  "not-found": 404,
  "admin-write-required": 403,
  "invalid-input": 400,
  "too-large": 413,
  "core-unavailable": 502,
  "core-timeout": 504,
  "invalid-core-response": 502,
  "admin-session-invalid": 401,
  "admin-revoked": 403,
  "footprints-visits-read-required": 403,
  "footprints-visits-edit-required": 403,
  "footprints-visits-contract-version-required": 422,
  "footprints-visits-contract-version-invalid": 422,
  "footprints-visits-request-invalid": 422,
  "footprints-visits-value-invalid": 422,
  "footprints-visits-revision-invalid": 422,
  "footprints-visits-reason-invalid": 422,
  "footprints-visits-request-id-invalid": 422,
  "footprints-visits-conflict": 409,
  "footprints-visits-request-id-conflict": 409,
  "footprints-visits-request-in-progress": 409,
  "footprints-visits-stored-invalid": 503,
  "footprints-visits-schema-unavailable": 503,
  "footprints-visits-read-failed": 503,
  "footprints-visits-audit-write-failed": 503,
  "footprints-visits-receipt-write-failed": 503,
  "footprints-visits-write-failed": 503,
};

export function footprintVisitsError(value: unknown): string | null {
  const envelope = webadminErrorEnvelope(value)
    ?? webadminErrorEnvelope(value, "required")
    ?? adminBridgeErrorEnvelope(value);
  const error = envelope?.error;
  return error && Object.hasOwn(FOOTPRINT_VISITS_ERROR_STATUSES, error)
    && FOOTPRINT_VISITS_ERROR_STATUSES[error] === envelope.status_code
    ? error
    : null;
}

export type FootprintVisitsErrorKey =
  | "sessionInvalid"
  | "badOrigin"
  | "routeNotFound"
  | "readRequired"
  | "editRequired"
  | "requestInvalid"
  | "tooLarge"
  | "temporarilyUnavailable"
  | "invalidResponse"
  | "contractVersion"
  | "valueInvalid"
  | "revisionInvalid"
  | "reasonInvalid"
  | "requestIdInvalid"
  | "conflict"
  | "requestIdConflict"
  | "requestInProgress"
  | "storedInvalid"
  | "schemaUnavailable"
  | "auditWriteFailed"
  | "receiptWriteFailed"
  | "writeFailed"
  | "generic";

const FOOTPRINT_VISITS_ERROR_KEYS: Readonly<Record<string, FootprintVisitsErrorKey>> = {
  unauthorized: "sessionInvalid",
  "auth-required": "sessionInvalid",
  "admin-session-invalid": "sessionInvalid",
  "admin-revoked": "sessionInvalid",
  "bad-origin": "badOrigin",
  "not-found": "routeNotFound",
  "footprints-visits-read-required": "readRequired",
  "admin-write-required": "editRequired",
  "footprints-visits-edit-required": "editRequired",
  "invalid-input": "requestInvalid",
  "footprints-visits-request-invalid": "requestInvalid",
  "too-large": "tooLarge",
  "core-unavailable": "temporarilyUnavailable",
  "core-timeout": "temporarilyUnavailable",
  "footprints-visits-read-failed": "temporarilyUnavailable",
  "invalid-core-response": "invalidResponse",
  "footprints-visits-contract-version-required": "contractVersion",
  "footprints-visits-contract-version-invalid": "contractVersion",
  "footprints-visits-value-invalid": "valueInvalid",
  "footprints-visits-revision-invalid": "revisionInvalid",
  "footprints-visits-reason-invalid": "reasonInvalid",
  "footprints-visits-request-id-invalid": "requestIdInvalid",
  "footprints-visits-conflict": "conflict",
  "footprints-visits-request-id-conflict": "requestIdConflict",
  "footprints-visits-request-in-progress": "requestInProgress",
  "footprints-visits-stored-invalid": "storedInvalid",
  "footprints-visits-schema-unavailable": "schemaUnavailable",
  "footprints-visits-audit-write-failed": "auditWriteFailed",
  "footprints-visits-receipt-write-failed": "receiptWriteFailed",
  "footprints-visits-write-failed": "writeFailed",
};

export function footprintVisitsErrorKey(error: string | null): FootprintVisitsErrorKey {
  return error && Object.hasOwn(FOOTPRINT_VISITS_ERROR_KEYS, error)
    ? FOOTPRINT_VISITS_ERROR_KEYS[error]
    : "generic";
}

/**
 * Keep the durable identity after anything that leaves the outcome uncertain:
 * an unknown error, a transport failure, in-progress, or any 5xx. A conflict
 * and the input refusals are terminal — the operator must act again.
 */
export function footprintVisitsShouldRetainMutation(error: string | null): boolean {
  return error === null
    || !Object.hasOwn(FOOTPRINT_VISITS_ERROR_STATUSES, error)
    || error === "footprints-visits-request-in-progress"
    || error === "footprints-visits-audit-write-failed"
    || error === "footprints-visits-receipt-write-failed"
    || error === "footprints-visits-write-failed"
    || FOOTPRINT_VISITS_ERROR_STATUSES[error] >= 500;
}

function normalizeGetBody(body: JsonObject): JsonObject | null {
  const source = exactObject(body, ["contract_version"]);
  return source?.contract_version === 1
    ? Object.assign(Object.create(null), { contract_version: 1 })
    : null;
}

function normalizeSetBody(body: JsonObject): JsonObject | null {
  const source = exactObject(body, [
    "contract_version", "visits_enabled", "expected_revision", "reason", "request_id",
  ]);
  const revision = integer(source?.expected_revision, 0, FOOTPRINT_VISITS_REVISION_MAX);
  const reason = canonicalReason(source?.reason);
  const requestId = typeof source?.request_id === "string" && UUID_V4.test(source.request_id)
    ? source.request_id
    : null;
  // The closed value vocabulary is the exact strings "true" and "false". Core
  // refuses 1/0/on/yes, so the browser must never send a looser form and then
  // surface a request-invalid as if the operator had done something wrong.
  const enabled = oneOf(source?.visits_enabled, ["true", "false"] as const);
  return source?.contract_version === 1 && enabled && revision !== null && reason && requestId
    ? Object.assign(Object.create(null), {
      contract_version: 1,
      visits_enabled: enabled,
      expected_revision: revision,
      reason,
      request_id: requestId,
    })
    : null;
}

/** `undefined` is another family, `null` is refused, and an object alone may reach Core. */
export function normalizeFootprintVisitsProxyBody(
  action: string,
  body: JsonObject,
): JsonObject | null | undefined {
  if (!(FOOTPRINT_VISITS_ACTIONS as readonly string[]).includes(action)) return undefined;
  return action === "footprints_visits_get" ? normalizeGetBody(body) : normalizeSetBody(body);
}

export type FootprintVisitsPendingMutation = {
  version: 1;
  action: "footprints_visits_set";
  target: string;
  payload: JsonObject;
};

export const FOOTPRINT_VISITS_PENDING_STORAGE_KEY = "friending.footprint-visits.pending-mutation.v1";

/** One singleton, so the target is constant — but it is still bound and checked. */
export const FOOTPRINT_VISITS_TARGET = "footprint_settings:footprints" as const;

export function footprintVisitsPendingMutation(
  target: string,
  body: JsonObject,
): FootprintVisitsPendingMutation | null {
  const payload = normalizeSetBody(body);
  return payload && target === FOOTPRINT_VISITS_TARGET
    ? { version: 1, action: "footprints_visits_set", target, payload }
    : null;
}

export function footprintVisitsPendingFrom(value: unknown): FootprintVisitsPendingMutation | null {
  const source = exactObject(value, ["version", "action", "target", "payload"]);
  return source?.version === 1 && source.action === "footprints_visits_set"
    && typeof source.target === "string"
    ? footprintVisitsPendingMutation(source.target, record(source.payload) ?? {})
    : null;
}

export async function footprintVisitsPersistBeforeMutation<T>(
  storage: Pick<Storage, "setItem">,
  pending: FootprintVisitsPendingMutation,
  mutate: () => Promise<T>,
): Promise<{ ok: true; response: T } | { ok: false }> {
  const canonical = footprintVisitsPendingFrom(pending);
  if (!canonical) return { ok: false };
  try {
    storage.setItem(FOOTPRINT_VISITS_PENDING_STORAGE_KEY, JSON.stringify(canonical));
  } catch {
    return { ok: false };
  }
  return { ok: true, response: await mutate() };
}

/**
 * A saved command has converged when the authoritative state matches what it
 * asked for. A no-op leaves the revision where it was; a real transition
 * advances it by exactly one.
 */
export function footprintVisitsMutationConverged(
  pending: FootprintVisitsPendingMutation,
  result: FootprintVisitsMutation,
): boolean {
  const canonical = footprintVisitsPendingFrom(pending);
  if (!canonical) return false;
  const payload = canonical.payload;
  const requested = payload.visits_enabled === "true";
  const expected = Number(payload.expected_revision);
  if (result.visits_enabled !== requested) return false;
  return result.no_change
    ? result.revision === expected
    : result.revision === expected + 1;
}

/**
 * A conflict converges a saved command only when the authoritative state
 * already holds the requested value — otherwise the operator must decide
 * again against the state they can now see.
 */
export function footprintVisitsConflictSatisfiesPending(
  pending: FootprintVisitsPendingMutation,
  conflict: FootprintVisitsConflict,
): boolean {
  const canonical = footprintVisitsPendingFrom(pending);
  if (!canonical) return false;
  return conflict.current.visits_enabled === (canonical.payload.visits_enabled === "true");
}
