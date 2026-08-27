import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";
import {
  webadminDataSuccessEnvelope,
  webadminErrorEnvelope,
} from "@/lib/webadminEnvelope";
import {
  verificationUserDetailResponse,
  type VerificationAdminPrincipal,
  type VerificationUserProjection,
} from "@/lib/verificationAdmin";

/** Accepted T-125 admin-granted verification contract v1. */
export const ADMIN_GRANTED_VERIFICATION_CONTRACT_VERSION = 1 as const;
export const ADMIN_GRANTED_VERIFICATION_ACTIONS = [
  "verification_grant",
  "verification_revoke",
] as const;
export const ADMIN_GRANTED_VERIFICATION_CAPABILITIES = [
  "verification_grant_edit",
  "verification_grant_read",
] as const;
export const ADMIN_GRANTED_VERIFICATION_METHODS = ["video", "persona"] as const;
export const ADMIN_GRANTED_VERIFICATION_LEVELS = ["none", "light", "strong"] as const;
export const ADMIN_GRANTED_VERIFICATION_SOURCES = ["derived", "imported", "granted"] as const;
export const ADMIN_GRANTED_VERIFICATION_STATUSES = ["active", "expired", "revoked"] as const;

export type AdminGrantedVerificationAction = (typeof ADMIN_GRANTED_VERIFICATION_ACTIONS)[number];
export type AdminGrantedVerificationCapability = (typeof ADMIN_GRANTED_VERIFICATION_CAPABILITIES)[number];
export type AdminGrantedVerificationMethod = (typeof ADMIN_GRANTED_VERIFICATION_METHODS)[number];
export type AdminGrantedVerificationLevel = (typeof ADMIN_GRANTED_VERIFICATION_LEVELS)[number];
export type AdminGrantedVerificationSource = (typeof ADMIN_GRANTED_VERIFICATION_SOURCES)[number];
export type AdminGrantedVerificationStatus = (typeof ADMIN_GRANTED_VERIFICATION_STATUSES)[number];
export type AdminGrantedVerificationRole = "viewer" | "admin" | "owner";

export type AdminGrantedVerificationPrincipal = {
  role: AdminGrantedVerificationRole;
  capabilities: AdminGrantedVerificationCapability[];
};

export type AdminGrantedVerificationAdminMe = {
  contract_version: 1;
  contract_ready: boolean;
  principal: AdminGrantedVerificationPrincipal;
  actions: AdminGrantedVerificationAction[];
};

export type AdminGrantedSeal = {
  method: AdminGrantedVerificationMethod;
  level: "light" | "strong";
  method_hint: "admin_granted";
  reason_length: number;
  reason_sha256: string;
  granted_by: string;
  granted_at: number;
  expires_at: number | null;
  revision: number;
  status: AdminGrantedVerificationStatus;
  evaluated_at: number;
};

export type AdminGrantedVerificationResource = {
  schema_version: 1;
  uid: number;
  evaluated_at: number;
  enabled_methods: AdminGrantedVerificationMethod[];
  grant_revision: number;
  admin_grant: AdminGrantedSeal | null;
  effective_level: AdminGrantedVerificationLevel;
  effective_source: AdminGrantedVerificationSource;
  external_seal_would_show: boolean;
};

export type AdminGrantedVerificationSelectedDetail = {
  contract_version: 1;
  principal: VerificationAdminPrincipal;
  verification: VerificationUserProjection;
  admin_granted_verification: AdminGrantedVerificationResource;
};

export type AdminGrantedVerificationMutation = {
  contract_version: 1;
  principal: AdminGrantedVerificationPrincipal;
  admin_granted_verification: AdminGrantedVerificationResource;
  replayed: boolean;
};

export type AdminGrantedVerificationConflict = {
  error:
    | "verification-method-not-enabled"
    | "verification-grant-not-active"
    | "verification-conflict";
  contract_version: 1;
  admin_granted_verification: AdminGrantedVerificationResource;
};

type JsonObject = Record<string, unknown>;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const EMAIL = /^[^\s@]+@[^\s@]+$/u;
const TERMINAL_INPUT_OR_CONFLICT_ERRORS: ReadonlySet<string> = new Set([
  "invalid-input",
  "too-large",
  "verification-contract-version-invalid",
  "verification-request-invalid",
  "verification-request-id-invalid",
  "verification-grant-invalid",
  "verification-user-not-found",
  "verification-method-not-enabled",
  "verification-grant-not-active",
  "verification-conflict",
  "verification-request-id-conflict",
]);
const LEVEL_RANK: Readonly<Record<AdminGrantedVerificationLevel, number>> = {
  none: 0,
  light: 1,
  strong: 2,
};

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
  return typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0)
    && value >= minimum && value <= maximum
    ? value
    : null;
}

function nullableInteger(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null | undefined {
  if (value === null) return null;
  const parsed = integer(value, minimum, maximum);
  return parsed === null ? undefined : parsed;
}

function orderedUnique<const T extends readonly string[]>(value: unknown, canonical: T): T[number][] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.map((entry) => oneOf(entry, canonical));
  if (rows.some((entry) => entry === null)) return null;
  const parsed = rows as T[number][];
  if (new Set(parsed).size !== parsed.length) return null;
  const expected = canonical.filter((entry) => parsed.includes(entry));
  return expected.length === parsed.length
    && expected.every((entry, index) => entry === parsed[index])
    ? parsed
    : null;
}

function exactOrdered(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
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

function canonicalEmail(value: unknown): string | null {
  return typeof value === "string" && value.length >= 3 && value.length <= 320
    && value === value.trim() && value === value.normalize("NFC")
    && value === value.toLowerCase() && !hasUnpairedSurrogate(value)
    && !/\p{Cc}/u.test(value) && EMAIL.test(value)
    ? value
    : null;
}

function expectedCapabilities(role: AdminGrantedVerificationRole): AdminGrantedVerificationCapability[] {
  return role === "viewer"
    ? ["verification_grant_read"]
    : [...ADMIN_GRANTED_VERIFICATION_CAPABILITIES];
}

function adminGrantedVerificationPrincipal(value: unknown): AdminGrantedVerificationPrincipal | null {
  const source = exactObject(value, ["role", "capabilities"]);
  const role = oneOf(source?.role, ["viewer", "admin", "owner"] as const);
  if (!role || !exactOrdered(source?.capabilities, expectedCapabilities(role))) return null;
  return { role, capabilities: expectedCapabilities(role) };
}

export function adminGrantedVerificationAdminMe(value: unknown): AdminGrantedVerificationAdminMe | null {
  const source = exactObject(value, ["contract_version", "contract_ready", "principal", "actions"]);
  const principal = adminGrantedVerificationPrincipal(source?.principal);
  if (source?.contract_version !== 1 || typeof source.contract_ready !== "boolean" || !principal) return null;
  const expectedActions = source.contract_ready && principal.capabilities.includes("verification_grant_edit")
    ? [...ADMIN_GRANTED_VERIFICATION_ACTIONS]
    : [];
  if (!exactOrdered(source.actions, expectedActions)) return null;
  return {
    contract_version: 1,
    contract_ready: source.contract_ready,
    principal,
    actions: expectedActions,
  };
}

export function adminGrantedVerificationProxyCapabilityAuthorized(
  action: string,
  membership: unknown,
): boolean | null {
  if (!(ADMIN_GRANTED_VERIFICATION_ACTIONS as readonly string[]).includes(action)) return null;
  const block = adminGrantedVerificationAdminMe(record(membership)?.admin_granted_verification);
  return Boolean(block?.contract_ready
    && block.actions.includes(action as AdminGrantedVerificationAction)
    && block.principal.capabilities.includes("verification_grant_edit"));
}

/** The additive selector is a read, but still belongs to this independent capability block. */
export function adminGrantedVerificationSelectedReadAuthorized(membership: unknown): boolean {
  const block = adminGrantedVerificationAdminMe(record(membership)?.admin_granted_verification);
  return Boolean(block?.contract_ready
    && block.principal.capabilities.includes("verification_grant_read"));
}

const LEGACY_RECEIPT_MUTATION_ACTIONS = [
  "verification_grant_save",
  "verification_grant_remove",
  "admin_apply_fake_persona",
  "admin_revoke_fake_persona",
] as const;

/**
 * Once the old actions are unadvertised, a receipt saved by the legacy panel
 * must still be replayable through the one-release compatibility adapters.
 * New legacy gestures stay absent from the UI; authorization comes from the
 * exact replacement block, never from a broad role.
 */
export function adminGrantedVerificationLegacyReceiptRetryAuthorized(
  action: string,
  membership: unknown,
): boolean | null {
  if (!(LEGACY_RECEIPT_MUTATION_ACTIONS as readonly string[]).includes(action)) return null;
  const block = adminGrantedVerificationAdminMe(record(membership)?.admin_granted_verification);
  return Boolean(block?.contract_ready
    && block.principal.capabilities.includes("verification_grant_edit"));
}

function adminGrantedSeal(value: unknown, evaluatedAt: number): AdminGrantedSeal | null {
  const source = exactObject(value, [
    "method", "level", "method_hint", "reason_length", "reason_sha256", "granted_by",
    "granted_at", "expires_at", "revision", "status", "evaluated_at",
  ]);
  const method = oneOf(source?.method, ADMIN_GRANTED_VERIFICATION_METHODS);
  const level = oneOf(source?.level, ["light", "strong"] as const);
  const reasonLength = integer(source?.reason_length, 1, 300);
  const reasonSha256 = typeof source?.reason_sha256 === "string" && SHA256.test(source.reason_sha256)
    ? source.reason_sha256
    : null;
  const grantedBy = canonicalEmail(source?.granted_by);
  const grantedAt = integer(source?.granted_at);
  const expiresAt = nullableInteger(source?.expires_at, 1);
  const revision = integer(source?.revision, 1, 2_147_483_647);
  const status = oneOf(source?.status, ADMIN_GRANTED_VERIFICATION_STATUSES);
  if (!method || !level || level !== (method === "video" ? "light" : "strong")
    || source?.method_hint !== "admin_granted" || reasonLength === null || !reasonSha256
    || !grantedBy || grantedAt === null || expiresAt === undefined || revision === null || !status
    || source.evaluated_at !== evaluatedAt || grantedAt > evaluatedAt) return null;
  const timeActive = expiresAt === null || expiresAt > evaluatedAt;
  if ((status === "active" && !timeActive)
    || (status === "expired" && timeActive)) return null;
  return {
    method,
    level,
    method_hint: "admin_granted",
    reason_length: reasonLength,
    reason_sha256: reasonSha256,
    granted_by: grantedBy,
    granted_at: grantedAt,
    expires_at: expiresAt,
    revision,
    status,
    evaluated_at: evaluatedAt,
  };
}

export function adminGrantedVerificationResource(value: unknown): AdminGrantedVerificationResource | null {
  const source = exactObject(value, [
    "schema_version", "uid", "evaluated_at", "enabled_methods", "grant_revision",
    "admin_grant", "effective_level", "effective_source", "external_seal_would_show",
  ]);
  const uid = integer(source?.uid, 1, 2_147_483_647);
  const evaluatedAt = integer(source?.evaluated_at);
  const enabledMethods = orderedUnique(source?.enabled_methods, ADMIN_GRANTED_VERIFICATION_METHODS);
  const grantRevision = integer(source?.grant_revision, 0, 2_147_483_647);
  const effectiveLevel = oneOf(source?.effective_level, ADMIN_GRANTED_VERIFICATION_LEVELS);
  const effectiveSource = oneOf(source?.effective_source, ADMIN_GRANTED_VERIFICATION_SOURCES);
  if (source?.schema_version !== 1 || uid === null || evaluatedAt === null || !enabledMethods
    || grantRevision === null || !effectiveLevel || !effectiveSource
    || typeof source.external_seal_would_show !== "boolean") return null;
  const adminGrant = source.admin_grant === null ? null : adminGrantedSeal(source.admin_grant, evaluatedAt);
  if ((source.admin_grant !== null && !adminGrant)
    || (adminGrant === null) !== (grantRevision === 0)
    || (adminGrant !== null && adminGrant.revision !== grantRevision)) return null;
  const activeGrant = adminGrant?.status === "active" ? adminGrant : null;
  if (activeGrant && LEVEL_RANK[effectiveLevel] < LEVEL_RANK[activeGrant.level]) return null;
  if (effectiveSource === "granted"
    && (!activeGrant || effectiveLevel !== activeGrant.level)) return null;
  if (effectiveLevel === "none" && effectiveSource !== "derived") return null;
  if (source.external_seal_would_show
    && (effectiveLevel === "none" || enabledMethods.length === 0)) return null;
  return {
    schema_version: 1,
    uid,
    evaluated_at: evaluatedAt,
    enabled_methods: enabledMethods,
    grant_revision: grantRevision,
    admin_grant: adminGrant,
    effective_level: effectiveLevel,
    effective_source: effectiveSource,
    external_seal_would_show: source.external_seal_would_show,
  };
}

export function adminGrantedVerificationSelectedDetailResponse(
  value: unknown,
): AdminGrantedVerificationSelectedDetail | null {
  const envelope = webadminDataSuccessEnvelope(value);
  const source = exactObject(envelope?.data, [
    "contract_version", "principal", "verification", "admin_granted_verification",
  ]);
  if (!envelope || source?.contract_version !== 1) return null;
  const legacy = verificationUserDetailResponse({
    success: true,
    status_code: 200,
    data: {
      contract_version: source.contract_version,
      principal: source.principal,
      verification: source.verification,
    },
    message: 200,
    status: 200,
    can_send: 0,
  });
  const selected = adminGrantedVerificationResource(source.admin_granted_verification);
  const projectionsAgree = legacy && selected
    && legacy.principal.capabilities.includes("verification_grant_read")
    && legacy.verification.uid === selected.uid
    && legacy.verification.evaluated_at === selected.evaluated_at
    && legacy.verification.grant_revision === selected.grant_revision
    && legacy.verification.effective_level === selected.effective_level
    && legacy.verification.effective_source === selected.effective_source
    && legacy.verification.external_seal_would_show === selected.external_seal_would_show
    && exactOrdered(legacy.verification.enabled_methods, selected.enabled_methods);
  return legacy && selected && projectionsAgree
    ? {
      contract_version: 1,
      principal: legacy.principal,
      verification: legacy.verification,
      admin_granted_verification: selected,
    }
    : null;
}

export function adminGrantedVerificationMutationResponse(
  value: unknown,
): AdminGrantedVerificationMutation | null {
  const envelope = webadminDataSuccessEnvelope(value);
  const source = exactObject(envelope?.data, [
    "contract_version", "principal", "admin_granted_verification", "replayed",
  ]);
  const principal = adminGrantedVerificationPrincipal(source?.principal);
  const resource = adminGrantedVerificationResource(source?.admin_granted_verification);
  return source?.contract_version === 1 && principal
    && principal.capabilities.includes("verification_grant_edit")
    && resource && typeof source.replayed === "boolean"
    ? {
      contract_version: 1,
      principal,
      admin_granted_verification: resource,
      replayed: source.replayed,
    }
    : null;
}

const CONFLICT_ERRORS = [
  "verification-method-not-enabled",
  "verification-grant-not-active",
  "verification-conflict",
] as const;

export function adminGrantedVerificationConflictResponse(
  value: unknown,
): AdminGrantedVerificationConflict | null {
  const envelope = webadminErrorEnvelope(value, "required");
  const error = oneOf(envelope?.error, CONFLICT_ERRORS);
  const source = exactObject(envelope?.data, ["contract_version", "admin_granted_verification"]);
  const resource = adminGrantedVerificationResource(source?.admin_granted_verification);
  return envelope?.status_code === 409 && error && source?.contract_version === 1 && resource
    ? { error, contract_version: 1, admin_granted_verification: resource }
    : null;
}

export const ADMIN_GRANTED_VERIFICATION_ERROR_STATUSES: Readonly<Record<string, number>> = {
  unauthorized: 401,
  "auth-required": 401,
  "admin-session-invalid": 401,
  "admin-revoked": 403,
  "verification-capability-required": 403,
  "bad-origin": 403,
  "admin-write-required": 403,
  "not-found": 404,
  "verification-user-not-found": 404,
  "invalid-input": 400,
  "too-large": 413,
  "verification-contract-version-invalid": 422,
  "verification-request-invalid": 422,
  "verification-request-id-invalid": 422,
  "verification-grant-invalid": 422,
  "verification-method-not-enabled": 409,
  "verification-grant-not-active": 409,
  "verification-conflict": 409,
  "verification-request-id-conflict": 409,
  "verification-request-in-progress": 409,
  "verification-schema-unavailable": 503,
  "verification-stored-invalid": 503,
  "verification-read-failed": 503,
  "verification-write-failed": 503,
  "verification-audit-write-failed": 503,
  "core-unavailable": 502,
  "invalid-core-response": 502,
  "core-timeout": 504,
};

export function adminGrantedVerificationError(value: unknown): string | null {
  const conflict = adminGrantedVerificationConflictResponse(value);
  if (conflict) return conflict.error;
  const envelope = webadminErrorEnvelope(value) ?? adminBridgeErrorEnvelope(value);
  const error = envelope?.error;
  return error && Object.hasOwn(ADMIN_GRANTED_VERIFICATION_ERROR_STATUSES, error)
    && ADMIN_GRANTED_VERIFICATION_ERROR_STATUSES[error] === envelope.status_code
    ? error
    : null;
}

export type AdminGrantedVerificationErrorKey =
  | "sessionInvalid"
  | "forbidden"
  | "routeNotFound"
  | "memberNotFound"
  | "requestInvalid"
  | "tooLarge"
  | "contractVersion"
  | "requestIdInvalid"
  | "grantInvalid"
  | "methodNotEnabled"
  | "grantNotActive"
  | "conflict"
  | "requestIdConflict"
  | "requestInProgress"
  | "schemaUnavailable"
  | "storedInvalid"
  | "readFailed"
  | "writeFailed"
  | "auditWriteFailed"
  | "temporarilyUnavailable"
  | "invalidResponse"
  | "generic";

const ERROR_KEYS: Readonly<Record<string, AdminGrantedVerificationErrorKey>> = {
  unauthorized: "sessionInvalid",
  "auth-required": "sessionInvalid",
  "admin-session-invalid": "sessionInvalid",
  "admin-revoked": "sessionInvalid",
  "verification-capability-required": "forbidden",
  "admin-write-required": "forbidden",
  "bad-origin": "forbidden",
  "not-found": "routeNotFound",
  "verification-user-not-found": "memberNotFound",
  "invalid-input": "requestInvalid",
  "verification-request-invalid": "requestInvalid",
  "too-large": "tooLarge",
  "verification-contract-version-invalid": "contractVersion",
  "verification-request-id-invalid": "requestIdInvalid",
  "verification-grant-invalid": "grantInvalid",
  "verification-method-not-enabled": "methodNotEnabled",
  "verification-grant-not-active": "grantNotActive",
  "verification-conflict": "conflict",
  "verification-request-id-conflict": "requestIdConflict",
  "verification-request-in-progress": "requestInProgress",
  "verification-schema-unavailable": "schemaUnavailable",
  "verification-stored-invalid": "storedInvalid",
  "verification-read-failed": "readFailed",
  "verification-write-failed": "writeFailed",
  "verification-audit-write-failed": "auditWriteFailed",
  "core-unavailable": "temporarilyUnavailable",
  "core-timeout": "temporarilyUnavailable",
  "invalid-core-response": "invalidResponse",
};

export function adminGrantedVerificationErrorKey(error: string | null): AdminGrantedVerificationErrorKey {
  return error && Object.hasOwn(ERROR_KEYS, error) ? ERROR_KEYS[error] : "generic";
}

export function adminGrantedVerificationNormalizeReason(value: unknown): string | null {
  if (typeof value !== "string" || hasUnpairedSurrogate(value)) return null;
  const normalized = value.normalize("NFC").trim();
  if (/[\r\n\p{Cc}]/u.test(normalized)) return null;
  const length = [...normalized].length;
  return length >= 1 && length <= 300 ? normalized : null;
}

export function adminGrantedVerificationTextLength(value: string): number {
  return [...value].length;
}

function normalizeCommandBody(
  action: AdminGrantedVerificationAction,
  body: JsonObject,
): JsonObject | null {
  const source = exactObject(body, [
    "contract_version", "uid", "method", "reason", "request_id", "expected_revision",
  ]);
  const uid = integer(source?.uid, 1, 2_147_483_647);
  const method = oneOf(source?.method, ADMIN_GRANTED_VERIFICATION_METHODS);
  const reason = adminGrantedVerificationNormalizeReason(source?.reason);
  const requestId = typeof source?.request_id === "string" && UUID_V4.test(source.request_id)
    ? source.request_id
    : null;
  const revision = integer(
    source?.expected_revision,
    action === "verification_grant" ? 0 : 1,
    2_147_483_647,
  );
  return source?.contract_version === 1 && uid !== null && method && reason && requestId && revision !== null
    ? Object.assign(Object.create(null), {
      contract_version: 1,
      uid,
      method,
      reason,
      request_id: requestId,
      expected_revision: revision,
    })
    : null;
}

/** `undefined` is another action family, `null` is refused, and only an exact object reaches Core. */
export function normalizeAdminGrantedVerificationProxyBody(
  action: string,
  body: JsonObject,
): JsonObject | null | undefined {
  if (!(ADMIN_GRANTED_VERIFICATION_ACTIONS as readonly string[]).includes(action)) return undefined;
  return normalizeCommandBody(action as AdminGrantedVerificationAction, body);
}

export type AdminGrantedVerificationPendingMutation = {
  version: 1;
  action: AdminGrantedVerificationAction;
  target: string;
  payload: JsonObject;
};

export const ADMIN_GRANTED_VERIFICATION_PENDING_STORAGE_KEY =
  "friending.admin-granted-verification.pending-mutation.v1";

export function adminGrantedVerificationPendingMutation(
  action: AdminGrantedVerificationAction,
  body: JsonObject,
): AdminGrantedVerificationPendingMutation | null {
  const payload = normalizeCommandBody(action, body);
  return payload
    ? { version: 1, action, target: `uid:${payload.uid}`, payload }
    : null;
}

export function adminGrantedVerificationPendingFrom(
  value: unknown,
): AdminGrantedVerificationPendingMutation | null {
  const source = exactObject(value, ["version", "action", "target", "payload"]);
  const action = oneOf(source?.action, ADMIN_GRANTED_VERIFICATION_ACTIONS);
  if (source?.version !== 1 || !action || typeof source.target !== "string") return null;
  const pending = adminGrantedVerificationPendingMutation(action, record(source.payload) ?? {});
  return pending?.target === source.target ? pending : null;
}

export async function adminGrantedVerificationPersistBeforeMutation<T>(
  storage: Pick<Storage, "setItem">,
  pending: AdminGrantedVerificationPendingMutation,
  mutate: () => Promise<T>,
): Promise<{ ok: true; response: T } | { ok: false }> {
  const canonical = adminGrantedVerificationPendingFrom(pending);
  if (!canonical) return { ok: false };
  try {
    storage.setItem(ADMIN_GRANTED_VERIFICATION_PENDING_STORAGE_KEY, JSON.stringify(canonical));
  } catch {
    return { ok: false };
  }
  return { ok: true, response: await mutate() };
}

export async function adminGrantedVerificationReasonSha256(reason: string): Promise<string | null> {
  const normalized = adminGrantedVerificationNormalizeReason(reason);
  if (!normalized) return null;
  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

export async function adminGrantedVerificationResourceConverged(
  pending: AdminGrantedVerificationPendingMutation,
  resource: AdminGrantedVerificationResource,
): Promise<boolean> {
  const canonical = adminGrantedVerificationPendingFrom(pending);
  if (!canonical) return false;
  const payload = canonical.payload;
  const expectedRevision = Number(payload.expected_revision) + 1;
  const grant = resource.admin_grant;
  if (resource.uid !== payload.uid || resource.grant_revision !== expectedRevision || !grant
    || grant.revision !== expectedRevision || grant.method !== payload.method) return false;
  if (canonical.action === "verification_revoke") return grant.status === "revoked";
  const hash = await adminGrantedVerificationReasonSha256(String(payload.reason));
  return grant.status === "active" && grant.expires_at === null
    && grant.reason_length === [...String(payload.reason)].length
    && hash !== null && grant.reason_sha256 === hash;
}

export async function adminGrantedVerificationMutationConverged(
  pending: AdminGrantedVerificationPendingMutation,
  mutation: AdminGrantedVerificationMutation,
): Promise<boolean> {
  return adminGrantedVerificationResourceConverged(
    pending,
    mutation.admin_granted_verification,
  );
}

export function adminGrantedVerificationConflictMatchesPending(
  pending: AdminGrantedVerificationPendingMutation,
  conflict: AdminGrantedVerificationConflict,
): boolean {
  const canonical = adminGrantedVerificationPendingFrom(pending);
  return Boolean(canonical && conflict.admin_granted_verification.uid === canonical.payload.uid);
}

export function adminGrantedVerificationShouldRetainMutation(error: string | null): boolean {
  return error === null || !TERMINAL_INPUT_OR_CONFLICT_ERRORS.has(error);
}
