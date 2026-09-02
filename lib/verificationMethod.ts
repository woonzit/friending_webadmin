import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";
import {
  WAITING_ROOM_COPY_FIELDS,
  WAITING_ROOM_COPY_KEYS,
  WAITING_ROOM_LOCALES,
  emptyWaitingRoomCopyOverrideDraft,
  forcedCopyTrim,
  isForcedStorefront,
  parseWaitingRoomCopy,
  parseWaitingRoomCopyOverride,
  waitingRoomCopyDraft,
  waitingRoomCopyIssue,
  waitingRoomHelpUrlDraftIssue,
  type ForcedVerificationDraftIssue,
  type KeyPolicy,
  type WaitingRoomCopy,
  type WaitingRoomCopyDraft,
  type WaitingRoomCopyOverride,
  type WaitingRoomCopyOverrideDraft,
  type WaitingRoomLocale,
} from "@/lib/forcedVerification";
import { webadminDataSuccessEnvelope, webadminErrorEnvelope } from "@/lib/webadminEnvelope";
import { verificationAdminPrincipal, type VerificationAdminPrincipal } from "@/lib/verificationAdmin";

/**
 * Unified verification-method console — the Webadmin side of
 * `handoffs/verification-method-console-contract.md` (T-617, D-092 / D-092a /
 * D-092b), bound to deployed Core `b988f05`.
 *
 * ONE editor owns the mandatory method: a scalar `persona | video | none` for
 * the global row and for each App Store storefront override, with that row's
 * bilingual Waiting Room copy underneath it. Core owns availability,
 * validation, the single revision over `{draft, live}`, idempotency, the impact
 * scan, publication and audit; this module decodes Core's exact material, keeps
 * the editor draft coherent and refuses to forward anything Core would reject.
 *
 * The waiting-room copy vocabulary, its validators and the storefront catalogue
 * are shared with `lib/forcedVerification.ts` — Core reuses the same
 * `ForcedVerificationPolicy` normalizers for this document, so the two must not
 * drift apart.
 */

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/** Core sorts `admin_me.verification_method.actions` with `SORT_STRING`; this is that order. */
export const VERIFICATION_METHOD_ACTIONS = [
  "verification_method_apply",
  "verification_method_console",
  "verification_method_impact",
  "verification_method_save",
] as const;
export type VerificationMethodAction = (typeof VERIFICATION_METHOD_ACTIONS)[number];

export const VERIFICATION_METHOD_MUTATION_ACTIONS = [
  "verification_method_apply",
  "verification_method_save",
] as const;
export type VerificationMethodMutationAction = (typeof VERIFICATION_METHOD_MUTATION_ACTIONS)[number];

/**
 * The scalar a row carries. `none` is the explicit non-mandatory value — there
 * is no deactivate operation and no `both` (D-092a §6).
 */
export const MANDATORY_METHODS = ["persona", "video", "none"] as const;
export type MandatoryMethod = (typeof MANDATORY_METHODS)[number];

/** The two methods a deployment can actually start; `none` has no availability entry. */
export const VERIFICATION_START_METHODS = ["video", "persona"] as const;
export type VerificationStartMethod = (typeof VERIFICATION_START_METHODS)[number];

/** Core `VerificationMethodPolicy::MAX_OVERRIDES`, equal to the closed storefront catalogue size. */
export const VERIFICATION_METHOD_MAX_OVERRIDES = 249;
/** Core `VerificationMethodPolicy::MIN_REVISION`/`MAX_REVISION`. */
export const VERIFICATION_METHOD_REVISION_MAX = 9_007_199_254_740_991;
export const VERIFICATION_METHOD_CONFIRMATION_PHRASE = "PUBLISH VERIFICATION METHOD";
export const VERIFICATION_METHOD_STOREFRONT_HINT = "alpha-3";
export const VERIFICATION_METHOD_REASON_MAX = 300;

export const VERIFICATION_METHOD_PUBLISH_BLOCKING_CODES = [
  "verification-method-persona-unavailable",
  "verification-method-video-unavailable",
] as const;
export type VerificationMethodPublishBlockingCode =
  (typeof VERIFICATION_METHOD_PUBLISH_BLOCKING_CODES)[number];

export const VERIFICATION_METHOD_UNAVAILABLE_ERROR = "verification-method-unavailable";

// ---------------------------------------------------------------------------
// Types (contract §3)
// ---------------------------------------------------------------------------

export type VerificationMethodAvailability = {
  method: VerificationStartMethod;
  policy_enable_allowed: boolean;
  new_start_available: boolean;
  reason: null | "deployment_unlock_disabled" | "service_config_disabled" | "provider_unconfigured";
};

export type VerificationMethodAvailabilityMap = {
  video: VerificationMethodAvailability & { method: "video" };
  persona: VerificationMethodAvailability & { method: "persona" };
};

export type VerificationMethodDocument = {
  global: MandatoryMethod;
  /** Ascending ALPHA3; the key set equals `waiting_room_copy.overrides` exactly. */
  overrides: Record<string, MandatoryMethod>;
  waiting_room_copy: {
    default: Record<WaitingRoomLocale, WaitingRoomCopy>;
    overrides: Record<string, Record<WaitingRoomLocale, WaitingRoomCopyOverride>>;
  };
};

export type VerificationMethodDraftSnapshot = {
  document: VerificationMethodDocument;
  saved_at: number;
  saved_by: string;
};

export type VerificationMethodLiveSnapshot = {
  document: VerificationMethodDocument;
  published_at: number;
  published_by: string;
};

export type VerificationMethodPolicy = {
  schema_version: 1;
  revision: number;
  draft: VerificationMethodDraftSnapshot;
  live: VerificationMethodLiveSnapshot;
  updated_at: number;
  updated_by: string;
};

export type VerificationMethodPublishGuard = {
  ready: boolean;
  blocking_codes: VerificationMethodPublishBlockingCode[];
};

export type VerificationMethodConsoleData = {
  contract_version: 1;
  principal: VerificationAdminPrincipal;
  evaluated_at: number;
  policy: VerificationMethodPolicy;
  method_availability: VerificationMethodAvailabilityMap;
  publish_guard: VerificationMethodPublishGuard;
  compiled_defaults: { waiting_room_copy: Record<WaitingRoomLocale, WaitingRoomCopy> };
  storefront_catalogue_hint: typeof VERIFICATION_METHOD_STOREFRONT_HINT;
};

export type VerificationMethodMutationData = {
  contract_version: 1;
  principal: VerificationAdminPrincipal;
  policy: VerificationMethodPolicy;
  method_availability: VerificationMethodAvailabilityMap;
  replayed: boolean;
};

export type VerificationMethodImpactCounts = {
  members_seen: number;
  currently_gated: number;
  would_be_gated: number;
  satisfied: number;
  newly_gated: number;
  newly_released: number;
};

export type VerificationMethodImpactRow = VerificationMethodImpactCounts & {
  storefront: string;
  live_method: MandatoryMethod;
  draft_method: MandatoryMethod;
};

export type VerificationMethodImpactUnknownRow = VerificationMethodImpactCounts & {
  live_method: MandatoryMethod;
  draft_method: MandatoryMethod;
};

export type VerificationMethodImpactData = {
  contract_version: 1;
  principal: VerificationAdminPrincipal;
  evaluated_at: number;
  expected_revision: number;
  normalized_fingerprint: string;
  confirmation_phrase: typeof VERIFICATION_METHOD_CONFIRMATION_PHRASE;
  method_availability: VerificationMethodAvailabilityMap;
  publish_guard: VerificationMethodPublishGuard;
  impact: {
    by_storefront: VerificationMethodImpactRow[];
    unknown_storefront: VerificationMethodImpactUnknownRow;
    totals: VerificationMethodImpactCounts;
  };
};

export type VerificationMethodConflictData = {
  contract_version: 1;
  policy: VerificationMethodPolicy;
  method_availability: VerificationMethodAvailabilityMap;
};

/** Core's per-operator projection, the sibling of the closed `admin_me.verification` block. */
export type VerificationMethodAdminMe = {
  contract_version: 1;
  contract_ready: boolean;
  actions: VerificationMethodAction[];
};

export type VerificationMethodAccess = {
  /** The method policy is readable (`verification_method_console`). */
  visible: boolean;
  /** Draft edits and "Save draft" (`verification_method_save`). */
  editable: boolean;
  /** Impact preview (`verification_method_impact`). */
  previewable: boolean;
  /** Publish (`verification_method_apply`). */
  publishable: boolean;
};

// ---------------------------------------------------------------------------
// Primitive parsers (fail closed: exact domains, exact types)
// ---------------------------------------------------------------------------

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredObject(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  const source = record(value);
  return source && keys.every((key) => Object.hasOwn(source, key)) ? source : null;
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  const source = record(value);
  if (!source) return null;
  const own = Object.keys(source);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(source, key)) ? source : null;
}

function oneOf<const T extends readonly string[]>(value: unknown, values: T): T[number] | null {
  return typeof value === "string" && (values as readonly string[]).includes(value)
    ? value as T[number]
    : null;
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function revision(value: unknown, minimum = 1): number | null {
  return integer(value, minimum, VERIFICATION_METHOD_REVISION_MAX);
}

function actor(value: unknown): string | null {
  return typeof value === "string" && value === value.trim() && value !== "" && value.length <= 320
    ? value
    : null;
}

function sha256Hex(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) ? value : null;
}

/** Core's `CONTROL_PATTERN`: C0 except TAB/LF/CR, DEL and the C1 range. */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

export function isVerificationMethodRequestId(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

/**
 * Core normalizes the publication reason with NFC + `trim()` and bounds it at
 * 300 scalars with no C0/C1 controls. The console applies exactly that before
 * it retains the command, so a retry replays the same bytes Core accepted.
 */
export function verificationMethodReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").trim();
  if (normalized === "" || [...normalized].length > VERIFICATION_METHOD_REASON_MAX) return null;
  return CONTROL_CHARACTERS.test(normalized) ? null : normalized;
}

// ---------------------------------------------------------------------------
// Material parsers (contract §3, §4)
// ---------------------------------------------------------------------------

function availability<M extends VerificationStartMethod>(
  value: unknown,
  expected: M,
): (VerificationMethodAvailability & { method: M }) | null {
  const raw = requiredObject(value, ["method", "policy_enable_allowed", "new_start_available", "reason"]);
  const reason = raw?.reason === null
    ? null
    : oneOf(raw?.reason, ["deployment_unlock_disabled", "service_config_disabled", "provider_unconfigured"] as const);
  if (!raw || raw.method !== expected
    || typeof raw.policy_enable_allowed !== "boolean"
    || typeof raw.new_start_available !== "boolean"
    || (raw.reason !== null && reason === null)
    || (reason === null) !== raw.new_start_available) return null;
  return {
    method: expected,
    policy_enable_allowed: raw.policy_enable_allowed,
    new_start_available: raw.new_start_available,
    reason,
  };
}

export function verificationMethodAvailabilityMap(value: unknown): VerificationMethodAvailabilityMap | null {
  const raw = requiredObject(value, VERIFICATION_START_METHODS);
  const video = availability(raw?.video, "video");
  const persona = availability(raw?.persona, "persona");
  return video && persona ? { video, persona } : null;
}

function mandatoryMethod(value: unknown): MandatoryMethod | null {
  return oneOf(value, MANDATORY_METHODS);
}

function sortedStorefrontMap<T>(
  value: unknown,
  parseValue: (entry: unknown) => T | null,
): Record<string, T> | null {
  const source = record(value);
  if (!source) return null;
  const keys = Object.keys(source);
  if (keys.length > VERIFICATION_METHOD_MAX_OVERRIDES) return null;
  const output: Record<string, T> = {};
  for (const key of [...keys].sort()) {
    if (!isForcedStorefront(key)) return null;
    const parsed = parseValue(source[key]);
    if (parsed === null) return null;
    output[key] = parsed;
  }
  return output;
}

function localeKeys(value: unknown, policy: KeyPolicy): Record<string, unknown> | null {
  return policy === "exact"
    ? exactObject(value, WAITING_ROOM_LOCALES)
    : requiredObject(value, WAITING_ROOM_LOCALES);
}

function localizedCopy(value: unknown, policy: KeyPolicy): Record<WaitingRoomLocale, WaitingRoomCopy> | null {
  const raw = localeKeys(value, policy);
  const en = parseWaitingRoomCopy(raw?.en, policy);
  const hu = parseWaitingRoomCopy(raw?.hu, policy);
  return raw && en && hu ? { en, hu } : null;
}

function localizedCopyOverride(
  value: unknown,
  policy: KeyPolicy,
): Record<WaitingRoomLocale, WaitingRoomCopyOverride> | null {
  const raw = localeKeys(value, policy);
  const en = parseWaitingRoomCopyOverride(raw?.en, policy);
  const hu = parseWaitingRoomCopyOverride(raw?.hu, policy);
  return raw && en && hu ? { en, hu } : null;
}

/**
 * The stored document. Core refuses a document whose `overrides` and
 * `waiting_room_copy.overrides` key sets differ, so the decoder refuses it too
 * rather than rendering half a row model.
 */
export function verificationMethodDocument(
  value: unknown,
  policy: KeyPolicy = "server",
): VerificationMethodDocument | null {
  const raw = policy === "exact"
    ? exactObject(value, ["global", "overrides", "waiting_room_copy"])
    : requiredObject(value, ["global", "overrides", "waiting_room_copy"]);
  const global = mandatoryMethod(raw?.global);
  const overrides = sortedStorefrontMap(raw?.overrides, mandatoryMethod);
  const copy = policy === "exact"
    ? exactObject(raw?.waiting_room_copy, ["default", "overrides"])
    : requiredObject(raw?.waiting_room_copy, ["default", "overrides"]);
  const copyDefault = localizedCopy(copy?.default, policy);
  const copyOverrides = sortedStorefrontMap(copy?.overrides, (entry) => localizedCopyOverride(entry, policy));
  if (!global || !overrides || !copyDefault || !copyOverrides) return null;
  const methodKeys = Object.keys(overrides);
  const copyKeys = Object.keys(copyOverrides);
  if (methodKeys.length !== copyKeys.length
    || methodKeys.some((key, index) => key !== copyKeys[index])) return null;
  return {
    global,
    overrides,
    waiting_room_copy: { default: copyDefault, overrides: copyOverrides },
  };
}

function draftSnapshot(value: unknown): VerificationMethodDraftSnapshot | null {
  const raw = requiredObject(value, ["document", "saved_at", "saved_by"]);
  const document = verificationMethodDocument(raw?.document);
  const savedAt = integer(raw?.saved_at);
  const savedBy = actor(raw?.saved_by);
  return document && savedAt !== null && savedBy
    ? { document, saved_at: savedAt, saved_by: savedBy }
    : null;
}

function liveSnapshot(value: unknown): VerificationMethodLiveSnapshot | null {
  const raw = requiredObject(value, ["document", "published_at", "published_by"]);
  const document = verificationMethodDocument(raw?.document);
  const publishedAt = integer(raw?.published_at);
  const publishedBy = actor(raw?.published_by);
  return document && publishedAt !== null && publishedBy
    ? { document, published_at: publishedAt, published_by: publishedBy }
    : null;
}

export function verificationMethodPolicy(value: unknown): VerificationMethodPolicy | null {
  const raw = requiredObject(value, [
    "schema_version", "revision", "draft", "live", "updated_at", "updated_by",
  ]);
  const parsedRevision = revision(raw?.revision);
  const draft = draftSnapshot(raw?.draft);
  const live = liveSnapshot(raw?.live);
  const updatedAt = integer(raw?.updated_at);
  const updatedBy = actor(raw?.updated_by);
  if (raw?.schema_version !== 1 || parsedRevision === null || !draft || !live
    || updatedAt === null || !updatedBy) return null;
  return {
    schema_version: 1,
    revision: parsedRevision,
    draft,
    live,
    updated_at: updatedAt,
    updated_by: updatedBy,
  };
}

function publishGuard(value: unknown): VerificationMethodPublishGuard | null {
  const raw = requiredObject(value, ["ready", "blocking_codes"]);
  if (!raw || typeof raw.ready !== "boolean" || !Array.isArray(raw.blocking_codes)) return null;
  const codes = raw.blocking_codes.map((code) => oneOf(code, VERIFICATION_METHOD_PUBLISH_BLOCKING_CODES));
  if (codes.some((code) => code === null)) return null;
  const parsed = codes as VerificationMethodPublishBlockingCode[];
  if (new Set(parsed).size !== parsed.length) return null;
  const expected = VERIFICATION_METHOD_PUBLISH_BLOCKING_CODES.filter((code) => parsed.includes(code));
  if (expected.length !== parsed.length || expected.some((code, index) => code !== parsed[index])) return null;
  // `ready` is exactly "no blocking code"; a disagreeing pair is not a proven state.
  return raw.ready === (parsed.length === 0) ? { ready: raw.ready, blocking_codes: parsed } : null;
}

function impactCounts(source: Record<string, unknown>): VerificationMethodImpactCounts | null {
  const seen = integer(source.members_seen);
  const currentlyGated = integer(source.currently_gated);
  const wouldBeGated = integer(source.would_be_gated);
  const satisfied = integer(source.satisfied);
  const newlyGated = integer(source.newly_gated);
  const newlyReleased = integer(source.newly_released);
  if (seen === null || currentlyGated === null || wouldBeGated === null || satisfied === null
    || newlyGated === null || newlyReleased === null) return null;
  if (currentlyGated > seen || wouldBeGated > seen || satisfied > seen
    || newlyGated > seen || newlyReleased > seen) return null;
  return {
    members_seen: seen,
    currently_gated: currentlyGated,
    would_be_gated: wouldBeGated,
    satisfied,
    newly_gated: newlyGated,
    newly_released: newlyReleased,
  };
}

const IMPACT_COUNT_KEYS = [
  "members_seen", "currently_gated", "would_be_gated", "satisfied", "newly_gated", "newly_released",
] as const;

function sumCounts(rows: VerificationMethodImpactCounts[]): VerificationMethodImpactCounts {
  const total = {
    members_seen: 0, currently_gated: 0, would_be_gated: 0, satisfied: 0, newly_gated: 0, newly_released: 0,
  };
  for (const row of rows) for (const key of IMPACT_COUNT_KEYS) total[key] += row[key];
  return total;
}

// ---------------------------------------------------------------------------
// Capability projection (contract §2.1)
// ---------------------------------------------------------------------------

/** `admin_me.verification_method` — absent or malformed means "no console" for this operator. */
export function verificationMethodAdminMe(value: unknown): VerificationMethodAdminMe | null {
  const raw = requiredObject(value, ["contract_version", "contract_ready", "actions"]);
  if (!raw || raw.contract_version !== 1 || typeof raw.contract_ready !== "boolean"
    || !Array.isArray(raw.actions)) return null;
  const parsed = raw.actions.map((action) => oneOf(action, VERIFICATION_METHOD_ACTIONS));
  if (parsed.some((action) => action === null)) return null;
  const actions = parsed as VerificationMethodAction[];
  if (new Set(actions).size !== actions.length) return null;
  const ordered = VERIFICATION_METHOD_ACTIONS.filter((action) => actions.includes(action));
  if (ordered.length !== actions.length || ordered.some((action, index) => action !== actions[index])) return null;
  if (!raw.contract_ready && ordered.length !== 0) return null;
  return { contract_version: 1, contract_ready: raw.contract_ready, actions: ordered };
}

/**
 * What this operator may do, from Core's projection ONLY. Navigation never
 * infers these actions from the top-level role or from the retired
 * `admin_me.verification_forced` block (contract §2.1, §6.2).
 */
export function verificationMethodAccess(
  projection: VerificationMethodAdminMe | null,
): VerificationMethodAccess {
  if (!projection?.contract_ready) {
    return { visible: false, editable: false, previewable: false, publishable: false };
  }
  const visible = projection.actions.includes("verification_method_console");
  return {
    visible,
    editable: visible && projection.actions.includes("verification_method_save"),
    previewable: visible && projection.actions.includes("verification_method_impact"),
    publishable: visible && projection.actions.includes("verification_method_apply"),
  };
}

export function isVerificationMethodAction(action: string): action is VerificationMethodAction {
  return (VERIFICATION_METHOD_ACTIONS as readonly string[]).includes(action);
}

/** Per-call recheck of Core's projection at the proxy; `null` outside this family. */
export function verificationMethodProxyCapabilityAuthorized(
  action: string,
  membership: unknown,
): boolean | null {
  if (!isVerificationMethodAction(action)) return null;
  const block = verificationMethodAdminMe(record(membership)?.verification_method);
  return block !== null && block.contract_ready && block.actions.includes(action);
}

// ---------------------------------------------------------------------------
// Response decoders (contract §4, §5)
// ---------------------------------------------------------------------------

export const VERIFICATION_METHOD_ERROR_STATUSES = {
  // Core, `VerificationMethodAdminPolicy::errorStatus`.
  "verification-method-contract-version": 409,
  "verification-method-forbidden": 403,
  "verification-method-request-invalid": 422,
  "verification-method-revision-invalid": 422,
  "verification-method-storefront-invalid": 422,
  "verification-method-copy-default-invalid": 422,
  "verification-method-copy-overrides-invalid": 422,
  "verification-method-document-invalid": 422,
  "verification-method-request-id-invalid": 422,
  "verification-method-conflict": 409,
  "verification-method-video-unavailable": 409,
  "verification-method-persona-unavailable": 409,
  "verification-method-preview-stale": 409,
  "verification-method-confirmation-invalid": 422,
  "verification-method-request-id-conflict": 409,
  "verification-method-request-in-progress": 409,
  "verification-method-unavailable": 503,
  "verification-method-read-failed": 503,
  "verification-method-audit-write-failed": 503,
  "verification-method-write-failed": 503,
  // Same-origin bridge, `app/api/admin/[action]/route.ts`.
  "invalid-input": 400,
  "auth-required": 401,
  "bad-origin": 403,
  "admin-write-required": 403,
  "verification-capability-required": 403,
  "not-found": 404,
  "too-large": 413,
  "core-unavailable": 502,
  "core-timeout": 504,
} as const;

export type VerificationMethodError = keyof typeof VERIFICATION_METHOD_ERROR_STATUSES;

export function verificationMethodErrorResponse(value: unknown): VerificationMethodError | null {
  const core = webadminErrorEnvelope(value);
  // A versioned Core conflict carries `data`; the tolerant bridge subset must
  // never reinterpret it as the no-data form.
  const envelope = core ?? (webadminErrorEnvelope(value, "required") ? null : adminBridgeErrorEnvelope(value));
  const error = typeof envelope?.error === "string"
    && Object.hasOwn(VERIFICATION_METHOD_ERROR_STATUSES, envelope.error)
    ? envelope.error as VerificationMethodError
    : null;
  return envelope && error && envelope.status_code === VERIFICATION_METHOD_ERROR_STATUSES[error]
    ? error
    : null;
}

/**
 * The exact command stays retained only while the outcome is genuinely unknown:
 * no decodable answer at all, an in-progress receipt, or a 5xx. Every 4xx is a
 * terminal answer that proves the mutation did not land.
 */
export function verificationMethodShouldRetainMutation(error: VerificationMethodError | null): boolean {
  return error === null
    || error === "verification-method-request-in-progress"
    || VERIFICATION_METHOD_ERROR_STATUSES[error] >= 500;
}

function successData<T>(value: unknown, parse: (data: unknown) => T | null): T | null {
  const envelope = webadminDataSuccessEnvelope(value);
  return envelope ? parse(envelope.data) : null;
}

export function verificationMethodConsoleResponse(value: unknown): VerificationMethodConsoleData | null {
  return successData(value, (data) => {
    const raw = requiredObject(data, [
      "contract_version", "principal", "evaluated_at", "policy", "method_availability",
      "publish_guard", "compiled_defaults", "storefront_catalogue_hint",
    ]);
    const principal = verificationAdminPrincipal(raw?.principal);
    const evaluatedAt = integer(raw?.evaluated_at);
    const policy = verificationMethodPolicy(raw?.policy);
    const methodAvailability = verificationMethodAvailabilityMap(raw?.method_availability);
    const guard = publishGuard(raw?.publish_guard);
    const compiled = requiredObject(raw?.compiled_defaults, ["waiting_room_copy"]);
    const compiledCopy = localizedCopy(compiled?.waiting_room_copy, "server");
    if (raw?.contract_version !== 1 || !principal || evaluatedAt === null || !policy
      || !methodAvailability || !guard || !compiledCopy
      || raw.storefront_catalogue_hint !== VERIFICATION_METHOD_STOREFRONT_HINT) return null;
    return {
      contract_version: 1,
      principal,
      evaluated_at: evaluatedAt,
      policy,
      method_availability: methodAvailability,
      publish_guard: guard,
      compiled_defaults: { waiting_room_copy: compiledCopy },
      storefront_catalogue_hint: VERIFICATION_METHOD_STOREFRONT_HINT,
    };
  });
}

export function verificationMethodMutationResponse(value: unknown): VerificationMethodMutationData | null {
  return successData(value, (data) => {
    const raw = requiredObject(data, [
      "contract_version", "principal", "policy", "method_availability", "replayed",
    ]);
    const principal = verificationAdminPrincipal(raw?.principal);
    const policy = verificationMethodPolicy(raw?.policy);
    const methodAvailability = verificationMethodAvailabilityMap(raw?.method_availability);
    if (raw?.contract_version !== 1 || !principal || !policy || !methodAvailability
      || typeof raw.replayed !== "boolean") return null;
    return {
      contract_version: 1,
      principal,
      policy,
      method_availability: methodAvailability,
      replayed: raw.replayed,
    };
  });
}

export function verificationMethodImpactResponse(value: unknown): VerificationMethodImpactData | null {
  return successData(value, (data) => {
    const raw = requiredObject(data, [
      "contract_version", "principal", "evaluated_at", "expected_revision", "normalized_fingerprint",
      "confirmation_phrase", "method_availability", "publish_guard", "impact",
    ]);
    const principal = verificationAdminPrincipal(raw?.principal);
    const evaluatedAt = integer(raw?.evaluated_at);
    const expectedRevision = revision(raw?.expected_revision);
    const fingerprint = sha256Hex(raw?.normalized_fingerprint);
    const methodAvailability = verificationMethodAvailabilityMap(raw?.method_availability);
    const guard = publishGuard(raw?.publish_guard);
    const impact = requiredObject(raw?.impact, ["by_storefront", "unknown_storefront", "totals"]);
    if (raw?.contract_version !== 1 || !principal || evaluatedAt === null || expectedRevision === null
      || !fingerprint || raw.confirmation_phrase !== VERIFICATION_METHOD_CONFIRMATION_PHRASE
      || !methodAvailability || !guard || !impact
      || !Array.isArray(impact.by_storefront)
      || impact.by_storefront.length > VERIFICATION_METHOD_MAX_OVERRIDES) return null;

    const rows: VerificationMethodImpactRow[] = [];
    for (const entry of impact.by_storefront) {
      const row = requiredObject(entry, [
        "storefront", "live_method", "draft_method", ...IMPACT_COUNT_KEYS,
      ]);
      if (!row || !isForcedStorefront(row.storefront)) return null;
      const live = mandatoryMethod(row.live_method);
      const draft = mandatoryMethod(row.draft_method);
      const counts = impactCounts(row);
      if (!live || !draft || !counts) return null;
      rows.push({ storefront: row.storefront, live_method: live, draft_method: draft, ...counts });
    }
    const keys = rows.map((row) => row.storefront);
    if (new Set(keys).size !== keys.length) return null;
    if (keys.some((key, index) => index > 0 && key <= keys[index - 1])) return null;

    const unknownRaw = requiredObject(impact.unknown_storefront, ["live_method", "draft_method", ...IMPACT_COUNT_KEYS]);
    const unknownLive = mandatoryMethod(unknownRaw?.live_method);
    const unknownDraft = mandatoryMethod(unknownRaw?.draft_method);
    const unknownCounts = unknownRaw ? impactCounts(unknownRaw) : null;
    const totalsRaw = requiredObject(impact.totals, IMPACT_COUNT_KEYS);
    const totals = totalsRaw ? impactCounts(totalsRaw) : null;
    if (!unknownLive || !unknownDraft || !unknownCounts || !totals) return null;
    // Contract §4.3: `totals` is the exact sum of the storefront rows plus the
    // unknown row. A total that does not add up is not a proven count.
    const expectedTotals = sumCounts([...rows, unknownCounts]);
    if (IMPACT_COUNT_KEYS.some((key) => totals[key] !== expectedTotals[key])) return null;

    return {
      contract_version: 1,
      principal,
      evaluated_at: evaluatedAt,
      expected_revision: expectedRevision,
      normalized_fingerprint: fingerprint,
      confirmation_phrase: VERIFICATION_METHOD_CONFIRMATION_PHRASE,
      method_availability: methodAvailability,
      publish_guard: guard,
      impact: {
        by_storefront: rows,
        unknown_storefront: { live_method: unknownLive, draft_method: unknownDraft, ...unknownCounts },
        totals,
      },
    };
  });
}

/** The two authoritative conflict bodies of contract §5 — every other refusal carries no `data`. */
export function verificationMethodConflictResponse(
  value: unknown,
): { error: "verification-method-conflict" | "verification-method-preview-stale"; data: VerificationMethodConflictData } | null {
  const envelope = webadminErrorEnvelope(value, "required");
  if (!envelope || envelope.status_code !== 409) return null;
  const error = oneOf(envelope.error, ["verification-method-conflict", "verification-method-preview-stale"] as const);
  if (!error) return null;
  const raw = requiredObject(envelope.data, ["contract_version", "policy", "method_availability"]);
  const policy = verificationMethodPolicy(raw?.policy);
  const methodAvailability = verificationMethodAvailabilityMap(raw?.method_availability);
  if (raw?.contract_version !== 1 || !policy || !methodAvailability) return null;
  return { error, data: { contract_version: 1, policy, method_availability: methodAvailability } };
}

// ---------------------------------------------------------------------------
// Editor draft ↔ document (contract §7.1: ONE row model)
// ---------------------------------------------------------------------------

/** One storefront row: its method and its copy override travel together. */
export type VerificationMethodOverrideRow = {
  storefront: string;
  method: MandatoryMethod;
  copy: WaitingRoomCopyOverrideDraft;
};

export type VerificationMethodDraft = {
  global: MandatoryMethod;
  copy_default: Record<WaitingRoomLocale, WaitingRoomCopyDraft>;
  overrides: VerificationMethodOverrideRow[];
};

export type VerificationMethodDraftIssue = ForcedVerificationDraftIssue;

export function verificationMethodDraft(document: VerificationMethodDocument): VerificationMethodDraft {
  const overrides: VerificationMethodOverrideRow[] = [];
  for (const storefront of Object.keys(document.overrides).sort()) {
    const copy = emptyWaitingRoomCopyOverrideDraft();
    const stored = document.waiting_room_copy.overrides[storefront];
    for (const locale of WAITING_ROOM_LOCALES) {
      const override = stored?.[locale];
      if (!override) continue;
      for (const key of WAITING_ROOM_COPY_KEYS) copy[locale][key] = override[key] ?? "";
    }
    overrides.push({ storefront, method: document.overrides[storefront], copy });
  }
  return {
    global: document.global,
    copy_default: {
      en: waitingRoomCopyDraft(document.waiting_room_copy.default.en),
      hu: waitingRoomCopyDraft(document.waiting_room_copy.default.hu),
    },
    overrides,
  };
}

/** Conservative client validation; Core's named refusals remain the authority. */
export function validateVerificationMethodDraft(
  draft: VerificationMethodDraft,
): VerificationMethodDraftIssue | null {
  if (draft.overrides.length > VERIFICATION_METHOD_MAX_OVERRIDES) return "storefront";
  const seen = new Set<string>();
  for (const row of draft.overrides) {
    if (!isForcedStorefront(row.storefront)) return "storefront";
    if (seen.has(row.storefront)) return "duplicateStorefront";
    seen.add(row.storefront);
  }
  for (const locale of WAITING_ROOM_LOCALES) {
    for (const field of WAITING_ROOM_COPY_FIELDS) {
      const issue = waitingRoomCopyIssue(draft.copy_default[locale][field], field, true);
      if (issue) return issue;
    }
    const helpIssue = waitingRoomHelpUrlDraftIssue(draft.copy_default[locale].help_url);
    if (helpIssue) return helpIssue;
  }
  for (const row of draft.overrides) {
    for (const locale of WAITING_ROOM_LOCALES) {
      for (const field of WAITING_ROOM_COPY_FIELDS) {
        const issue = waitingRoomCopyIssue(row.copy[locale][field], field, false);
        if (issue) return issue;
      }
      const helpIssue = waitingRoomHelpUrlDraftIssue(row.copy[locale].help_url);
      if (helpIssue) return helpIssue;
    }
  }
  return null;
}

/**
 * The canonical document for a valid draft (`null` otherwise). Every override
 * row emits BOTH a method entry and a copy container, even when the operator
 * overrode no copy at all: Core refuses a document whose two override key sets
 * differ, so an empty `{en:{},hu:{}}` is the correct "method only" row and is
 * never dropped.
 */
export function verificationMethodDocumentFromDraft(
  draft: VerificationMethodDraft,
): VerificationMethodDocument | null {
  if (validateVerificationMethodDraft(draft) !== null) return null;
  const overrides: Record<string, MandatoryMethod> = {};
  const copyOverrides: VerificationMethodDocument["waiting_room_copy"]["overrides"] = {};
  const rows = [...draft.overrides].sort((left, right) => left.storefront.localeCompare(right.storefront));
  for (const row of rows) {
    overrides[row.storefront] = row.method;
    // `en` before `hu`: Core compares the locale key list exactly.
    const locales = {} as Record<WaitingRoomLocale, WaitingRoomCopyOverride>;
    for (const locale of WAITING_ROOM_LOCALES) {
      const override: WaitingRoomCopyOverride = {};
      for (const field of WAITING_ROOM_COPY_FIELDS) {
        const text = forcedCopyTrim(row.copy[locale][field]);
        if (text !== "") override[field] = text;
      }
      // A blank help URL inherits by omission; `null` is not an override value.
      const help = row.copy[locale].help_url;
      if (help !== "") override.help_url = help;
      locales[locale] = override;
    }
    copyOverrides[row.storefront] = locales;
  }
  const trimCopy = (copy: WaitingRoomCopyDraft): WaitingRoomCopy => ({
    title: forcedCopyTrim(copy.title),
    subtitle: forcedCopyTrim(copy.subtitle),
    description: forcedCopyTrim(copy.description),
    // Always present on the global default (`null` = no help button), and last.
    help_url: copy.help_url === "" ? null : copy.help_url,
  });
  return {
    global: draft.global,
    overrides,
    waiting_room_copy: {
      default: { en: trimCopy(draft.copy_default.en), hu: trimCopy(draft.copy_default.hu) },
      overrides: copyOverrides,
    },
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const source = record(value);
  if (source) {
    return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function verificationMethodDocumentsEqual(
  left: VerificationMethodDocument,
  right: VerificationMethodDocument,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/** The mandatory method a document resolves for one storefront (override → global). */
export function resolveMandatoryMethod(
  document: VerificationMethodDocument,
  storefront: string | null,
): MandatoryMethod {
  if (storefront !== null && Object.hasOwn(document.overrides, storefront)) {
    return document.overrides[storefront];
  }
  return document.global;
}

/** Every storefront whose LIVE method is `video`, ascending — the `/configuration` coverage line. */
export function liveVideoStorefronts(document: VerificationMethodDocument): string[] {
  return Object.keys(document.overrides).filter((key) => document.overrides[key] === "video").sort();
}

/** Every storefront whose LIVE method is NOT `video`, ascending. */
export function liveNonVideoStorefronts(document: VerificationMethodDocument): string[] {
  return Object.keys(document.overrides).filter((key) => document.overrides[key] !== "video").sort();
}

// ---------------------------------------------------------------------------
// Retained-command persistence (contract §4.4)
// ---------------------------------------------------------------------------

export type VerificationMethodPendingMutation = {
  version: 1;
  action: VerificationMethodMutationAction;
  payload: Record<string, unknown>;
};

export const VERIFICATION_METHOD_PENDING_STORAGE_KEY = "friending.verification-method.pending-mutation.v1";

export function verificationMethodPendingMutation(
  action: VerificationMethodMutationAction,
  body: Record<string, unknown>,
): VerificationMethodPendingMutation | null {
  const payload = normalizeVerificationMethodProxyBody(action, body);
  return payload ? { version: 1, action, payload } : null;
}

export function verificationMethodPendingFrom(value: unknown): VerificationMethodPendingMutation | null {
  const raw = exactObject(value, ["version", "action", "payload"]);
  const action = oneOf(raw?.action, VERIFICATION_METHOD_MUTATION_ACTIONS);
  return raw?.version === 1 && action
    ? verificationMethodPendingMutation(action, record(raw.payload) ?? {})
    : null;
}

export async function verificationMethodPersistBeforeMutation<T>(
  storage: Pick<Storage, "setItem">,
  pending: VerificationMethodPendingMutation,
  mutate: () => Promise<T>,
): Promise<{ ok: true; response: T } | { ok: false }> {
  const canonical = verificationMethodPendingFrom(pending);
  if (!canonical) return { ok: false };
  try {
    storage.setItem(VERIFICATION_METHOD_PENDING_STORAGE_KEY, JSON.stringify(canonical));
  } catch {
    return { ok: false };
  }
  return { ok: true, response: await mutate() };
}

// ---------------------------------------------------------------------------
// Proxy body normalization (`app/api/admin/[action]/route.ts`)
// ---------------------------------------------------------------------------

function exactKeys(source: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(source);
  return own.length === keys.length
    && new Set(own).size === own.length
    && keys.every((key) => Object.hasOwn(source, key));
}

/**
 * The browser sends JSON; Core receives a form body where `draft_json` is the
 * canonical JSON string of exactly `{global, overrides, waiting_room_copy}`
 * (`lib/core.ts` serialises nested objects). Anything the strict parsers refuse
 * is answered `invalid-input` here, before Core is called at all.
 */
export function normalizeVerificationMethodProxyBody(
  action: string,
  body: Record<string, unknown>,
): Record<string, unknown> | null | undefined {
  if (!isVerificationMethodAction(action)) return undefined;
  if (body.contract_version !== 1) return null;
  switch (action) {
    case "verification_method_console":
      return exactKeys(body, ["contract_version"]) ? { contract_version: 1 } : null;
    case "verification_method_save": {
      if (!exactKeys(body, ["contract_version", "draft_json", "expected_revision", "request_id"])) return null;
      const expectedRevision = revision(body.expected_revision);
      const document = verificationMethodDocument(body.draft_json, "exact");
      if (expectedRevision === null || !document || !isVerificationMethodRequestId(body.request_id)) return null;
      return {
        contract_version: 1,
        draft_json: document,
        expected_revision: expectedRevision,
        request_id: body.request_id,
      };
    }
    case "verification_method_impact": {
      if (!exactKeys(body, ["contract_version", "expected_revision"])) return null;
      const expectedRevision = revision(body.expected_revision);
      return expectedRevision === null ? null : { contract_version: 1, expected_revision: expectedRevision };
    }
    case "verification_method_apply": {
      if (!exactKeys(body, [
        "contract_version", "expected_revision", "normalized_fingerprint",
        "confirmation_phrase", "reason", "request_id",
      ])) return null;
      const expectedRevision = revision(body.expected_revision);
      const fingerprint = sha256Hex(body.normalized_fingerprint);
      const reason = verificationMethodReason(body.reason);
      if (expectedRevision === null || !fingerprint || !reason
        || body.confirmation_phrase !== VERIFICATION_METHOD_CONFIRMATION_PHRASE
        || !isVerificationMethodRequestId(body.request_id)) return null;
      return {
        contract_version: 1,
        expected_revision: expectedRevision,
        normalized_fingerprint: fingerprint,
        confirmation_phrase: VERIFICATION_METHOD_CONFIRMATION_PHRASE,
        reason,
        request_id: body.request_id,
      };
    }
    default:
      return null;
  }
}
