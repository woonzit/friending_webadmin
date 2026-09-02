import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";
import {
  webadminDataSuccessEnvelope,
  webadminErrorEnvelope,
} from "@/lib/webadminEnvelope";

/** Accepted Webadmin feature-switch family contract v1 (T-126, widened by T-659). */
export const FEATURE_SWITCHES_CONTRACT_VERSION = 1 as const;
export const FEATURE_SWITCHES = ["hey", "footprints", "likes"] as const;
export const FEATURE_SWITCHES_CAPABILITIES = [
  "feature_switches_read",
  "feature_switches_edit",
] as const;
export const FEATURE_SWITCHES_ACTIONS = [
  "feature_switches_get",
  "feature_switches_set",
] as const;

export const FEATURE_SWITCHES_REASON_MAX = 300 as const;
export const FEATURE_SWITCHES_REVISION_MAX = 2_147_483_647 as const;

export type FeatureSwitch = (typeof FEATURE_SWITCHES)[number];
export type FeatureSwitchesCapability = (typeof FEATURE_SWITCHES_CAPABILITIES)[number];
export type FeatureSwitchesAction = (typeof FEATURE_SWITCHES_ACTIONS)[number];
export type FeatureSwitchesRole = "viewer" | "admin" | "owner";

export type FeatureSwitchesPrincipal = {
  role: FeatureSwitchesRole;
  capabilities: FeatureSwitchesCapability[];
};

export type FeatureSwitchesAdminMe = {
  contract_version: 1;
  contract_ready: boolean;
  /** Rendering hints only; mutations bind the revision from `feature_switches_get`. */
  hey_enabled: boolean;
  footprints_enabled: boolean;
  /** Null means this console is talking to a pre-T-659 Core. */
  likes_enabled: boolean | null;
  revision: number;
  principal: FeatureSwitchesPrincipal;
  actions: FeatureSwitchesAction[];
};

export type FeatureSwitchState = {
  enabled: boolean;
  updated_at: number;
  updated_by: string;
};

export type FeatureSwitchesState = {
  contract_version: 1;
  hey: FeatureSwitchState;
  footprints: FeatureSwitchState;
  /** Null means this console is talking to a pre-T-659 Core. */
  likes: FeatureSwitchState | null;
  revision: number;
};

export type FeatureSwitchesMutation = FeatureSwitchesState & {
  no_change: boolean;
  replayed: boolean;
};

export type FeatureSwitchesConflict = {
  current: FeatureSwitchesState;
};

type JsonObject = Record<string, unknown>;

export type FeatureSwitchesSetPayload = JsonObject & {
  contract_version: 1;
  switch: FeatureSwitch;
  enabled: "true" | "false";
  expected_revision: number;
  reason: string;
  request_id: string;
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PLAIN_TEXT_CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

function record(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

// Exact objects are reserved for browser-owned commands and persisted retry identities.
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

function requiredObject(value: unknown, keys: readonly string[]): JsonObject | null {
  const source = record(value);
  return source && keys.every((key) => Object.hasOwn(source, key)) ? source : null;
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

/** NFC-normalized, trimmed, control-free internal text of 1–300 scalars. */
function canonicalReason(value: unknown): string | null {
  if (typeof value !== "string" || hasUnpairedSurrogate(value)
    || value !== value.normalize("NFC") || value !== value.trim()) return null;
  if (PLAIN_TEXT_CONTROL.test(value)) return null;
  const length = scalarLength(value);
  return length >= 1 && length <= FEATURE_SWITCHES_REASON_MAX ? value : null;
}

export function featureSwitchesReasonIsValid(value: unknown): value is string {
  return canonicalReason(value) !== null;
}

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

function expectedActions(principal: FeatureSwitchesPrincipal): FeatureSwitchesAction[] {
  return FEATURE_SWITCHES_ACTIONS.filter((action) => action === "feature_switches_get"
    ? principal.capabilities.includes("feature_switches_read")
    : principal.capabilities.includes("feature_switches_edit"));
}

function featureSwitchesPrincipal(value: unknown): FeatureSwitchesPrincipal | null {
  const source = requiredObject(value, ["role", "capabilities"]);
  const role = oneOf(source?.role, ["viewer", "admin", "owner"] as const);
  const capabilities = orderedUnique(source?.capabilities, FEATURE_SWITCHES_CAPABILITIES);
  if (!role || !capabilities) return null;
  const valid = role === "viewer"
    ? capabilities.length === 0 || exactOrdered(capabilities, ["feature_switches_read"])
    : exactOrdered(capabilities, FEATURE_SWITCHES_CAPABILITIES);
  if (!valid) return null;
  return { role, capabilities };
}

export function featureSwitchesAdminMe(value: unknown): FeatureSwitchesAdminMe | null {
  const source = requiredObject(value, [
    "contract_version",
    "contract_ready",
    "hey_enabled",
    "footprints_enabled",
    "revision",
    "principal",
    "actions",
  ]);
  const principal = featureSwitchesPrincipal(source?.principal);
  const revision = integer(source?.revision, 0, FEATURE_SWITCHES_REVISION_MAX);
  const servesLikes = Boolean(source && Object.hasOwn(source, "likes_enabled"));
  if (source?.contract_version !== 1
    || typeof source.hey_enabled !== "boolean"
    || typeof source.footprints_enabled !== "boolean"
    || (servesLikes && typeof source.likes_enabled !== "boolean")
    || typeof source.contract_ready !== "boolean"
    || revision === null
    || !principal) return null;
  const actions = source.contract_ready ? expectedActions(principal) : [];
  if (!exactOrdered(source.actions, actions)) return null;
  return {
    contract_version: 1,
    contract_ready: source.contract_ready,
    hey_enabled: source.hey_enabled,
    footprints_enabled: source.footprints_enabled,
    likes_enabled: servesLikes ? source.likes_enabled as boolean : null,
    revision,
    principal,
    actions,
  };
}

export const FEATURE_SWITCHES_ACTION_CAPABILITY: Record<
  FeatureSwitchesAction,
  FeatureSwitchesCapability
> = {
  feature_switches_get: "feature_switches_read",
  feature_switches_set: "feature_switches_edit",
};

export function featureSwitchesProxyCapabilityAuthorized(action: string, membership: unknown): boolean | null {
  if (!(FEATURE_SWITCHES_ACTIONS as readonly string[]).includes(action)) return null;
  const block = featureSwitchesAdminMe(record(membership)?.feature_switches);
  const typedAction = action as FeatureSwitchesAction;
  return Boolean(block?.contract_ready
    && block.actions.includes(typedAction)
    && block.principal.capabilities.includes(FEATURE_SWITCHES_ACTION_CAPABILITY[typedAction]));
}

function featureSwitchState(value: unknown): FeatureSwitchState | null {
  const source = requiredObject(value, ["enabled", "updated_at", "updated_by"]);
  const updatedAt = integer(source?.updated_at, 0, Number.MAX_SAFE_INTEGER);
  const updatedBy = canonicalActor(source?.updated_by);
  if (typeof source?.enabled !== "boolean" || updatedAt === null || updatedBy === null) return null;
  // Provenance is independently all absent or all present for each switch.
  if ((updatedAt === 0) !== (updatedBy === "")) return null;
  return { enabled: source.enabled, updated_at: updatedAt, updated_by: updatedBy };
}

function featureSwitchesState(value: unknown): FeatureSwitchesState | null {
  const source = requiredObject(value, ["contract_version", "hey", "footprints", "revision"]);
  const revision = integer(source?.revision, 0, FEATURE_SWITCHES_REVISION_MAX);
  const hey = featureSwitchState(source?.hey);
  const footprints = featureSwitchState(source?.footprints);
  const servesLikes = Boolean(source && Object.hasOwn(source, "likes"));
  const likes = servesLikes ? featureSwitchState(source?.likes) : null;
  return source?.contract_version === 1 && revision !== null && hey && footprints
    && (!servesLikes || likes)
    ? { contract_version: 1, hey, footprints, likes, revision }
    : null;
}

export function featureSwitchesStateResponse(value: unknown): FeatureSwitchesState | null {
  const envelope = webadminDataSuccessEnvelope(value);
  const data = record(envelope?.data);
  // `no_change` and `replayed` select the mutation-success variant. They are
  // recognized sibling fields, not arbitrary additions to a read response.
  if (data && (Object.hasOwn(data, "no_change") || Object.hasOwn(data, "replayed"))) return null;
  return envelope ? featureSwitchesState(envelope.data) : null;
}

export function featureSwitchesMutationResponse(value: unknown): FeatureSwitchesMutation | null {
  const envelope = webadminDataSuccessEnvelope(value);
  const source = requiredObject(envelope?.data, [
    "contract_version",
    "hey",
    "footprints",
    "revision",
    "no_change",
    "replayed",
  ]);
  if (!source || typeof source.no_change !== "boolean" || typeof source.replayed !== "boolean") return null;
  const state = featureSwitchesState({
    contract_version: source.contract_version,
    hey: source.hey,
    footprints: source.footprints,
    ...(Object.hasOwn(source, "likes") ? { likes: source.likes } : {}),
    revision: source.revision,
  });
  return state ? { ...state, no_change: source.no_change, replayed: source.replayed } : null;
}

/** The only refusal allowed to carry data; malformed `current` fails closed. */
export function featureSwitchesConflictResponse(value: unknown): FeatureSwitchesConflict | null {
  const envelope = webadminErrorEnvelope(value, "required");
  if (envelope?.error !== "feature-switches-conflict" || envelope.status_code !== 409) return null;
  const source = requiredObject(envelope.data, ["current"]);
  const current = featureSwitchesState(source?.current);
  return current ? { current } : null;
}

export const FEATURE_SWITCHES_ERROR_STATUSES: Readonly<Record<string, number>> = {
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
  "feature-switches-read-required": 403,
  "feature-switches-edit-required": 403,
  "feature-switches-contract-version-required": 422,
  "feature-switches-contract-version-invalid": 422,
  "feature-switches-request-invalid": 422,
  "feature-switches-switch-invalid": 422,
  "feature-switches-value-invalid": 422,
  "feature-switches-revision-invalid": 422,
  "feature-switches-reason-invalid": 422,
  "feature-switches-request-id-invalid": 422,
  "feature-switches-conflict": 409,
  "feature-switches-request-id-conflict": 409,
  "feature-switches-request-in-progress": 409,
  "feature-switches-stored-invalid": 503,
  "feature-switches-schema-unavailable": 503,
  "feature-switches-read-failed": 503,
  "feature-switches-audit-write-failed": 503,
  "feature-switches-receipt-write-failed": 503,
  "feature-switches-write-failed": 503,
};

/**
 * Decode only no-data refusals. The conflict branch is parsed above and is
 * deliberately excluded here; malformed conflict data must remain unknown so
 * the durable identity cannot be cleared by a partial response (T-424 B1).
 */
export function featureSwitchesError(value: unknown): string | null {
  const envelope = webadminErrorEnvelope(value) ?? adminBridgeErrorEnvelope(value);
  const error = envelope?.error;
  return error && error !== "feature-switches-conflict"
    && Object.hasOwn(FEATURE_SWITCHES_ERROR_STATUSES, error)
    && FEATURE_SWITCHES_ERROR_STATUSES[error] === envelope.status_code
    ? error
    : null;
}

export type FeatureSwitchesErrorKey =
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
  | "switchInvalid"
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

const FEATURE_SWITCHES_ERROR_KEYS: Readonly<Record<string, FeatureSwitchesErrorKey>> = {
  unauthorized: "sessionInvalid",
  "auth-required": "sessionInvalid",
  "admin-session-invalid": "sessionInvalid",
  "admin-revoked": "sessionInvalid",
  "bad-origin": "badOrigin",
  "not-found": "routeNotFound",
  "feature-switches-read-required": "readRequired",
  "admin-write-required": "editRequired",
  "feature-switches-edit-required": "editRequired",
  "invalid-input": "requestInvalid",
  "feature-switches-request-invalid": "requestInvalid",
  "too-large": "tooLarge",
  "core-unavailable": "temporarilyUnavailable",
  "core-timeout": "temporarilyUnavailable",
  "feature-switches-read-failed": "temporarilyUnavailable",
  "invalid-core-response": "invalidResponse",
  "feature-switches-contract-version-required": "contractVersion",
  "feature-switches-contract-version-invalid": "contractVersion",
  "feature-switches-switch-invalid": "switchInvalid",
  "feature-switches-value-invalid": "valueInvalid",
  "feature-switches-revision-invalid": "revisionInvalid",
  "feature-switches-reason-invalid": "reasonInvalid",
  "feature-switches-request-id-invalid": "requestIdInvalid",
  "feature-switches-conflict": "conflict",
  "feature-switches-request-id-conflict": "requestIdConflict",
  "feature-switches-request-in-progress": "requestInProgress",
  "feature-switches-stored-invalid": "storedInvalid",
  "feature-switches-schema-unavailable": "schemaUnavailable",
  "feature-switches-audit-write-failed": "auditWriteFailed",
  "feature-switches-receipt-write-failed": "receiptWriteFailed",
  "feature-switches-write-failed": "writeFailed",
};

export function featureSwitchesErrorKey(error: string | null): FeatureSwitchesErrorKey {
  return error && Object.hasOwn(FEATURE_SWITCHES_ERROR_KEYS, error)
    ? FEATURE_SWITCHES_ERROR_KEYS[error]
    : "generic";
}

export function featureSwitchesShouldRetainMutation(error: string | null): boolean {
  return error === null
    || !Object.hasOwn(FEATURE_SWITCHES_ERROR_STATUSES, error)
    || error === "feature-switches-request-in-progress"
    || FEATURE_SWITCHES_ERROR_STATUSES[error] >= 500;
}

function normalizeGetBody(body: JsonObject): JsonObject | null {
  // Same-origin request bodies remain exact so undeclared fields cannot reach Core.
  const source = exactObject(body, ["contract_version"]);
  return source?.contract_version === 1
    ? Object.assign(Object.create(null), { contract_version: 1 })
    : null;
}

function normalizeSetBody(body: JsonObject): FeatureSwitchesSetPayload | null {
  const source = exactObject(body, [
    "contract_version", "switch", "enabled", "expected_revision", "reason", "request_id",
  ]);
  const selectedSwitch = oneOf(source?.switch, FEATURE_SWITCHES);
  const enabled = oneOf(source?.enabled, ["true", "false"] as const);
  const revision = integer(source?.expected_revision, 0, FEATURE_SWITCHES_REVISION_MAX);
  const reason = canonicalReason(source?.reason);
  const requestId = typeof source?.request_id === "string" && UUID_V4.test(source.request_id)
    ? source.request_id
    : null;
  return source?.contract_version === 1 && selectedSwitch && enabled
    && revision !== null && reason && requestId
    ? Object.assign(Object.create(null), {
      contract_version: 1,
      switch: selectedSwitch,
      enabled,
      expected_revision: revision,
      reason,
      request_id: requestId,
    }) as FeatureSwitchesSetPayload
    : null;
}

/** `undefined` is another family, `null` is refused, and an object alone may reach Core. */
export function normalizeFeatureSwitchesProxyBody(
  action: string,
  body: JsonObject,
): JsonObject | null | undefined {
  if (!(FEATURE_SWITCHES_ACTIONS as readonly string[]).includes(action)) return undefined;
  return action === "feature_switches_get" ? normalizeGetBody(body) : normalizeSetBody(body);
}

export type FeatureSwitchesPendingMutation = {
  version: 1;
  action: "feature_switches_set";
  target: string;
  payload: FeatureSwitchesSetPayload;
};

export const FEATURE_SWITCHES_PENDING_STORAGE_KEY = "friending.feature-switches.pending-mutation.v1";

export function featureSwitchesTarget(selectedSwitch: FeatureSwitch): string {
  return `feature_switches:v1:${selectedSwitch}`;
}

export function featureSwitchesPendingMutation(
  target: string,
  body: JsonObject,
): FeatureSwitchesPendingMutation | null {
  const payload = normalizeSetBody(body);
  return payload && target === featureSwitchesTarget(payload.switch)
    ? { version: 1, action: "feature_switches_set", target, payload }
    : null;
}

export function featureSwitchesPendingFrom(value: unknown): FeatureSwitchesPendingMutation | null {
  // Persisted retry identity remains exact so replay cannot acquire new semantics.
  const source = exactObject(value, ["version", "action", "target", "payload"]);
  return source?.version === 1 && source.action === "feature_switches_set"
    && typeof source.target === "string"
    ? featureSwitchesPendingMutation(source.target, record(source.payload) ?? {})
    : null;
}

export async function featureSwitchesPersistBeforeMutation<T>(
  storage: Pick<Storage, "setItem">,
  pending: FeatureSwitchesPendingMutation,
  mutate: () => Promise<T>,
): Promise<{ ok: true; response: T } | { ok: false }> {
  const canonical = featureSwitchesPendingFrom(pending);
  if (!canonical) return { ok: false };
  try {
    storage.setItem(FEATURE_SWITCHES_PENDING_STORAGE_KEY, JSON.stringify(canonical));
  } catch {
    return { ok: false };
  }
  return { ok: true, response: await mutate() };
}

export function featureSwitchesValue(
  state: FeatureSwitchesState,
  selectedSwitch: FeatureSwitch,
): boolean | null {
  return state[selectedSwitch]?.enabled ?? null;
}

export function featureSwitchesProvenance(
  state: FeatureSwitchesState,
  selectedSwitch: FeatureSwitch,
): { updated_at: number; updated_by: string } | null {
  const selected = state[selectedSwitch];
  return selected ? {
    updated_at: selected.updated_at,
    updated_by: selected.updated_by,
  } : null;
}

function pendingIntent(pending: FeatureSwitchesPendingMutation): {
  selectedSwitch: FeatureSwitch;
  enabled: boolean;
  expectedRevision: number;
} | null {
  const canonical = featureSwitchesPendingFrom(pending);
  return canonical ? {
    selectedSwitch: canonical.payload.switch,
    enabled: canonical.payload.enabled === "true",
    expectedRevision: canonical.payload.expected_revision,
  } : null;
}

/** A decoded mutation proves either the exact no-op or one revision transition. */
export function featureSwitchesMutationConverged(
  pending: FeatureSwitchesPendingMutation,
  result: FeatureSwitchesMutation,
): boolean {
  const intent = pendingIntent(pending);
  if (!intent || featureSwitchesValue(result, intent.selectedSwitch) !== intent.enabled) return false;
  return result.no_change
    ? result.revision === intent.expectedRevision
    : result.revision === intent.expectedRevision + 1;
}

/**
 * A GET after reload may prove a lost response converged without another
 * write. Only the target-bound requested value at the exact no-op or one-step
 * transition revision is sufficient; later/ambiguous revisions stay pending.
 */
export function featureSwitchesStateConverged(
  pending: FeatureSwitchesPendingMutation,
  state: FeatureSwitchesState,
): boolean {
  const intent = pendingIntent(pending);
  return Boolean(intent
    && featureSwitchesValue(state, intent.selectedSwitch) === intent.enabled
    && (state.revision === intent.expectedRevision || state.revision === intent.expectedRevision + 1));
}

export function featureSwitchesConflictSatisfiesPending(
  pending: FeatureSwitchesPendingMutation,
  conflict: FeatureSwitchesConflict,
): boolean {
  const intent = pendingIntent(pending);
  return Boolean(intent
    && featureSwitchesValue(conflict.current, intent.selectedSwitch) === intent.enabled);
}
