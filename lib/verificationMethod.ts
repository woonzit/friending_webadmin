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
 * ONE editor owns the mandatory method: a scalar `persona | video | photo |
 * none` for the global row and for each App Store storefront override, with
 * that row's bilingual Waiting Room copy underneath it. `photo` is the gesture
 * photo selfie (D-135, Core 60b7814e): it is chosen here and nowhere else, and
 * Core refuses to publish it (`verification-method-photo-unavailable`) until
 * the gesture catalogue can fill one set. Core owns availability,
 * validation, the single revision over `{draft, live}`, idempotency, the impact
 * scan, publication and audit; this module decodes Core's exact material, keeps
 * the editor draft coherent and refuses to forward anything Core would reject.
 *
 * The waiting-room copy vocabulary, its validators and the storefront catalogue
 * are shared with `lib/forcedVerification.ts` — Core reuses the same
 * `ForcedVerificationPolicy` normalizers for this document, so the two must not
 * drift apart.
 *
 * Contract v2 (D-151 §8, `team/handoffs/verification-explore-contract.md`)
 * adds the gate mode: `gate_mode: {global, overrides}` inside the same
 * document, each value `explore | full_block`. `admin_me` is unchanged: the
 * console asks for v2, and an older Core refuses it with
 * `verification-method-contract-version` (409), after which the console speaks
 * v1 for the session with the mode control hidden. An absent `gate_mode` means
 * Full block. The console never invents a mode:
 * the draft carries exactly what Core served plus what the operator changed,
 * and Core stores the key only when it differs from the default (canonical
 * omission, contract §8.1).
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
 * The scalar a row carries, in Core's `VerificationMethodPolicy::METHODS`
 * order. `none` is the explicit non-mandatory value — there is no deactivate
 * operation and no `both` (D-092a §6). `photo` is the gesture photo selfie
 * (D-135).
 */
export const MANDATORY_METHODS = ["persona", "video", "photo", "none"] as const;
export type MandatoryMethod = (typeof MANDATORY_METHODS)[number];

/** The methods a deployment can actually start; `none` has no availability entry. */
export const VERIFICATION_START_METHODS = ["video", "persona", "photo"] as const;
export type VerificationStartMethod = (typeof VERIFICATION_START_METHODS)[number];

/**
 * The console wire versions this Webadmin speaks. v1 is T-617 (three-key
 * document); v2 is D-151 §8.4 (the document gains `gate_mode`).
 */
export const VERIFICATION_METHOD_CONTRACT_VERSIONS = [1, 2] as const;
export type VerificationMethodContractVersion = (typeof VERIFICATION_METHOD_CONTRACT_VERSIONS)[number];

/**
 * D-151 §8.1: what a member who must verify (and has not) gets on a client
 * that asks for Explore. Closed, in Core's catalogue order. "Off" is not a
 * mode: it is the method `none`.
 */
export const VERIFICATION_GATE_MODES = ["explore", "full_block"] as const;
export type VerificationGateMode = (typeof VERIFICATION_GATE_MODES)[number];
/** An absent `gate_mode` (and an absent storefront entry under a Full block global) means Full block. */
export const VERIFICATION_GATE_MODE_ABSENT: VerificationGateMode = "full_block";
/** The member-request selector a client sends to opt into Explore (contract §2). */
export const VERIFICATION_GATE_MODE_CLIENT_SELECTOR = "forced_verification_contract_version";
/** A storefront row's mode control: its own explicit mode, or no key (it follows the global mode). */
export type VerificationGateModeChoice = VerificationGateMode | "inherit";

/**
 * Why a method cannot start, per method (Core
 * `VerificationMethodAvailabilityService`). Video and Persona keep the shared
 * three-value vocabulary the console always accepted; `photo` names the first
 * missing condition of its own four (the manifest's
 * `photo_availability_reasons`). `catalogue_insufficient` means the gesture
 * catalogue holds fewer gestures than `photo_gesture_count`.
 */
export const VERIFICATION_METHOD_AVAILABILITY_REASONS = {
  video: ["deployment_unlock_disabled", "service_config_disabled", "provider_unconfigured"],
  persona: ["deployment_unlock_disabled", "service_config_disabled", "provider_unconfigured"],
  photo: ["deployment_unlock_disabled", "service_config_disabled", "processing_unavailable", "catalogue_insufficient"],
} as const satisfies Record<VerificationStartMethod, readonly string[]>;
export type VerificationMethodAvailabilityReason =
  (typeof VERIFICATION_METHOD_AVAILABILITY_REASONS)[VerificationStartMethod][number];

/** Core `VerificationMethodPolicy::MAX_OVERRIDES`, equal to the closed storefront catalogue size. */
export const VERIFICATION_METHOD_MAX_OVERRIDES = 249;
/** Core `VerificationMethodPolicy::MIN_REVISION`/`MAX_REVISION`. */
export const VERIFICATION_METHOD_REVISION_MAX = 9_007_199_254_740_991;
export const VERIFICATION_METHOD_CONFIRMATION_PHRASE = "PUBLISH VERIFICATION METHOD";
export const VERIFICATION_METHOD_STOREFRONT_HINT = "alpha-3";
export const VERIFICATION_METHOD_REASON_MAX = 300;

/** Core `VerificationMethodPublicationGuard` sorts these with `SORT_STRING`; this is that order. */
export const VERIFICATION_METHOD_PUBLISH_BLOCKING_CODES = [
  "verification-method-persona-unavailable",
  "verification-method-photo-unavailable",
  "verification-method-video-unavailable",
] as const;
export type VerificationMethodPublishBlockingCode =
  (typeof VERIFICATION_METHOD_PUBLISH_BLOCKING_CODES)[number];

export const VERIFICATION_METHOD_UNAVAILABLE_ERROR = "verification-method-unavailable";

/**
 * The photo blocker: a draft uses `photo` somewhere while the method cannot
 * start. In practice this is the gesture catalogue (it starts empty), so the
 * console points the operator at the catalogue editor on /configuration.
 */
export const VERIFICATION_METHOD_PHOTO_UNAVAILABLE = "verification-method-photo-unavailable";

/** The gesture catalogue editor: its anchor inside the profile-verification configuration panel. */
export const VERIFICATION_METHOD_PHOTO_CATALOGUE_ANCHOR = "profile-verification-photo";
export const VERIFICATION_METHOD_PHOTO_CATALOGUE_HREF = `/configuration#${VERIFICATION_METHOD_PHOTO_CATALOGUE_ANCHOR}`;

// ---------------------------------------------------------------------------
// Types (contract §3)
// ---------------------------------------------------------------------------

export type VerificationMethodAvailability = {
  method: VerificationStartMethod;
  policy_enable_allowed: boolean;
  new_start_available: boolean;
  reason: null | VerificationMethodAvailabilityReason;
};

export type VerificationMethodAvailabilityMap = {
  video: VerificationMethodAvailability & { method: "video" };
  persona: VerificationMethodAvailability & { method: "persona" };
  photo: VerificationMethodAvailability & { method: "photo" };
};

export type VerificationGateModePolicy = {
  global: VerificationGateMode;
  /** Ascending ALPHA3, independent of the method overrides: mode(sf) = overrides[sf] ?? global. */
  overrides: Record<string, VerificationGateMode>;
};

export type VerificationGateModeCatalogue = {
  modes: VerificationGateMode[];
  recommended: VerificationGateMode;
  client_selector: typeof VERIFICATION_GATE_MODE_CLIENT_SELECTOR;
};

export type VerificationMethodDocument = {
  global: MandatoryMethod;
  /** Ascending ALPHA3; the key set equals `waiting_room_copy.overrides` exactly. */
  overrides: Record<string, MandatoryMethod>;
  waiting_room_copy: {
    default: Record<WaitingRoomLocale, WaitingRoomCopy>;
    overrides: Record<string, Record<WaitingRoomLocale, WaitingRoomCopyOverride>>;
  };
  /**
   * Contract v2 only, and then always present (an absent stored key is
   * materialized as Full block). A v1 document never carries it.
   */
  gate_mode?: VerificationGateModePolicy;
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
  contract_version: VerificationMethodContractVersion;
  principal: VerificationAdminPrincipal;
  evaluated_at: number;
  policy: VerificationMethodPolicy;
  method_availability: VerificationMethodAvailabilityMap;
  publish_guard: VerificationMethodPublishGuard;
  compiled_defaults: {
    waiting_room_copy: Record<WaitingRoomLocale, WaitingRoomCopy>;
    /** v2 only. */
    gate_mode?: VerificationGateModePolicy;
  };
  storefront_catalogue_hint: typeof VERIFICATION_METHOD_STOREFRONT_HINT;
  /** v2 only: the closed mode list and the one Core recommends where a method is forced. */
  gate_mode_catalogue?: VerificationGateModeCatalogue;
};

export type VerificationMethodMutationData = {
  contract_version: VerificationMethodContractVersion;
  principal: VerificationAdminPrincipal;
  policy: VerificationMethodPolicy;
  method_availability: VerificationMethodAvailabilityMap;
  replayed: boolean;
  /** v1 only, and only while Core stores a mode this wire cannot show (D-151 review). */
  gate_mode_hidden?: true;
};

export type VerificationMethodImpactCounts = {
  members_seen: number;
  currently_gated: number;
  would_be_gated: number;
  satisfied: number;
  newly_gated: number;
  newly_released: number;
};

/** v2 only (contract §8.4): the counts do not depend on the mode; the mode says what a held member gets. */
export type VerificationMethodImpactGateModes = {
  live_gate_mode?: VerificationGateMode;
  draft_gate_mode?: VerificationGateMode;
};

export type VerificationMethodImpactRow = VerificationMethodImpactCounts & VerificationMethodImpactGateModes & {
  storefront: string;
  live_method: MandatoryMethod;
  draft_method: MandatoryMethod;
};

export type VerificationMethodImpactUnknownRow = VerificationMethodImpactCounts & VerificationMethodImpactGateModes & {
  live_method: MandatoryMethod;
  draft_method: MandatoryMethod;
};

export type VerificationMethodImpactData = {
  contract_version: VerificationMethodContractVersion;
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
  /** v1 only, and only while Core stores a mode this wire cannot show (D-151 review). */
  gate_mode_hidden?: true;
};

/** Core's 422 `verification-method-gate-mode-invalid` body when a scope in Explore does not force Persona. */
export type VerificationMethodGateModeConflict = {
  reason: "explore_requires_persona";
  /** `global` first when it conflicts, then storefronts ascending (Core `gateModeMethodConflicts`). */
  scopes: string[];
};

export type VerificationMethodConflictData = {
  contract_version: VerificationMethodContractVersion;
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
    : oneOf(raw?.reason, VERIFICATION_METHOD_AVAILABILITY_REASONS[expected]);
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

/**
 * Core 60b7814e projects all three start methods on every console, impact,
 * mutation and conflict body; a map without `photo` is not proven material.
 */
export function verificationMethodAvailabilityMap(value: unknown): VerificationMethodAvailabilityMap | null {
  const raw = requiredObject(value, VERIFICATION_START_METHODS);
  const video = availability(raw?.video, "video");
  const persona = availability(raw?.persona, "persona");
  const photo = availability(raw?.photo, "photo");
  return video && persona && photo ? { video, persona, photo } : null;
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

function gateMode(value: unknown): VerificationGateMode | null {
  return oneOf(value, VERIFICATION_GATE_MODES);
}

/** The default an absent `gate_mode` stands for (contract §8.1). */
export function defaultVerificationGateModePolicy(): VerificationGateModePolicy {
  return { global: VERIFICATION_GATE_MODE_ABSENT, overrides: {} };
}

/**
 * `gate_mode` is closed on every key policy: exactly `{global, overrides}`,
 * values `explore | full_block`, override keys from the storefront catalogue.
 * The console writes this object back, so a key it does not know could only
 * be dropped silently; it refuses the material instead.
 */
export function verificationGateModePolicy(value: unknown): VerificationGateModePolicy | null {
  const raw = exactObject(value, ["global", "overrides"]);
  const global = gateMode(raw?.global);
  const overrides = sortedStorefrontMap(raw?.overrides, gateMode);
  return global && overrides ? { global, overrides } : null;
}

const DOCUMENT_KEYS_V1 = ["global", "overrides", "waiting_room_copy"] as const;
const DOCUMENT_KEYS_V2 = [...DOCUMENT_KEYS_V1, "gate_mode"] as const;

/**
 * The stored document. Core refuses a document whose `overrides` and
 * `waiting_room_copy.overrides` key sets differ, so the decoder refuses it too
 * rather than rendering half a row model.
 *
 * `version` 2 (D-151 §8.4) adds `gate_mode`, always present on that wire: Core
 * materializes the Full block default on a read, and a save command ("exact")
 * carries exactly the four keys. A v1 document never yields `gate_mode`.
 */
export function verificationMethodDocument(
  value: unknown,
  policy: KeyPolicy = "server",
  version: VerificationMethodContractVersion = 1,
): VerificationMethodDocument | null {
  const raw = policy === "exact"
    ? exactObject(value, version === 2 ? DOCUMENT_KEYS_V2 : DOCUMENT_KEYS_V1)
    : requiredObject(value, DOCUMENT_KEYS_V1);
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
  const document: VerificationMethodDocument = {
    global,
    overrides,
    waiting_room_copy: { default: copyDefault, overrides: copyOverrides },
  };
  if (version === 1) return document;
  // Review round 2: Core materializes the mode on every v2 document. A missing
  // key must never read as Full block here — that would fail open on the
  // downgrade indicator — so it is not proven material.
  const gate = raw && Object.hasOwn(raw, "gate_mode") ? verificationGateModePolicy(raw.gate_mode) : null;
  return gate ? { ...document, gate_mode: gate } : null;
}

function draftSnapshot(
  value: unknown,
  version: VerificationMethodContractVersion,
): VerificationMethodDraftSnapshot | null {
  const raw = requiredObject(value, ["document", "saved_at", "saved_by"]);
  const document = verificationMethodDocument(raw?.document, "server", version);
  const savedAt = integer(raw?.saved_at);
  const savedBy = actor(raw?.saved_by);
  return document && savedAt !== null && savedBy
    ? { document, saved_at: savedAt, saved_by: savedBy }
    : null;
}

function liveSnapshot(
  value: unknown,
  version: VerificationMethodContractVersion,
): VerificationMethodLiveSnapshot | null {
  const raw = requiredObject(value, ["document", "published_at", "published_by"]);
  const document = verificationMethodDocument(raw?.document, "server", version);
  const publishedAt = integer(raw?.published_at);
  const publishedBy = actor(raw?.published_by);
  return document && publishedAt !== null && publishedBy
    ? { document, published_at: publishedAt, published_by: publishedBy }
    : null;
}

/** The policy keeps `schema_version: 1` on both wires; only its documents differ (contract §8.4). */
export function verificationMethodPolicy(
  value: unknown,
  version: VerificationMethodContractVersion = 1,
): VerificationMethodPolicy | null {
  const raw = requiredObject(value, [
    "schema_version", "revision", "draft", "live", "updated_at", "updated_by",
  ]);
  const parsedRevision = revision(raw?.revision);
  const draft = draftSnapshot(raw?.draft, version);
  const live = liveSnapshot(raw?.live, version);
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

/** The closed mode catalogue: exactly Core's list in its order, a recommended member of it, the named selector. */
function gateModeCatalogue(value: unknown): VerificationGateModeCatalogue | null {
  const raw = requiredObject(value, ["modes", "recommended", "client_selector"]);
  if (!raw || !Array.isArray(raw.modes)
    || raw.modes.length !== VERIFICATION_GATE_MODES.length
    || raw.modes.some((mode, index) => mode !== VERIFICATION_GATE_MODES[index])) return null;
  const recommended = gateMode(raw.recommended);
  if (!recommended || raw.client_selector !== VERIFICATION_GATE_MODE_CLIENT_SELECTOR) return null;
  return {
    modes: [...VERIFICATION_GATE_MODES],
    recommended,
    client_selector: VERIFICATION_GATE_MODE_CLIENT_SELECTOR,
  };
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
  // D-151 §8.2: a `gate_mode` that is not exactly `{global, overrides}` with closed values.
  "verification-method-gate-mode-invalid": 422,
  "verification-method-request-id-invalid": 422,
  "verification-method-conflict": 409,
  "verification-method-video-unavailable": 409,
  "verification-method-persona-unavailable": 409,
  "verification-method-photo-unavailable": 409,
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

/**
 * `version` is the wire the request asked for; Core answers in that version
 * or refuses it (`verification-method-contract-version`), so an answer in any
 * other version is not proven material.
 */
export function verificationMethodConsoleResponse(
  value: unknown,
  version: VerificationMethodContractVersion = 1,
): VerificationMethodConsoleData | null {
  return successData(value, (data) => {
    const raw = requiredObject(data, [
      "contract_version", "principal", "evaluated_at", "policy", "method_availability",
      "publish_guard", "compiled_defaults", "storefront_catalogue_hint",
      ...(version === 2 ? ["gate_mode_catalogue"] : []),
    ]);
    const principal = verificationAdminPrincipal(raw?.principal);
    const evaluatedAt = integer(raw?.evaluated_at);
    const policy = verificationMethodPolicy(raw?.policy, version);
    const methodAvailability = verificationMethodAvailabilityMap(raw?.method_availability);
    const guard = publishGuard(raw?.publish_guard);
    const compiled = requiredObject(raw?.compiled_defaults, version === 2 ? ["waiting_room_copy", "gate_mode"] : ["waiting_room_copy"]);
    const compiledCopy = localizedCopy(compiled?.waiting_room_copy, "server");
    if (raw?.contract_version !== version || !principal || evaluatedAt === null || !policy
      || !methodAvailability || !guard || !compiledCopy
      || raw.storefront_catalogue_hint !== VERIFICATION_METHOD_STOREFRONT_HINT) return null;
    const material: VerificationMethodConsoleData = {
      contract_version: version,
      principal,
      evaluated_at: evaluatedAt,
      policy,
      method_availability: methodAvailability,
      publish_guard: guard,
      compiled_defaults: { waiting_room_copy: compiledCopy },
      storefront_catalogue_hint: VERIFICATION_METHOD_STOREFRONT_HINT,
    };
    if (version === 1) return material;
    const compiledGate = verificationGateModePolicy(compiled?.gate_mode);
    const catalogue = gateModeCatalogue(raw.gate_mode_catalogue);
    if (!compiledGate || !catalogue) return null;
    return {
      ...material,
      compiled_defaults: { waiting_room_copy: compiledCopy, gate_mode: compiledGate },
      gate_mode_catalogue: catalogue,
    };
  });
}

export type VerificationMethodConsoleLoad =
  | { ok: true; version: VerificationMethodContractVersion; data: VerificationMethodConsoleData }
  | { ok: false; version: VerificationMethodContractVersion; error: VerificationMethodError | null };

/**
 * The console read with its wire probe (contract §8.4/§15: `admin_me` does not
 * advertise v2). It asks for `preferred`; only Core's named
 * `verification-method-contract-version` refusal of a v2 read — what a Core
 * older than D-151 answers — is followed by exactly one v1 read, and the
 * result's `version` is then 1 for the rest of the session. Any other failure,
 * an undecodable success included, is returned as is: it never falls back.
 */
export async function loadVerificationMethodConsole(
  call: (action: "verification_method_console", body: { contract_version: VerificationMethodContractVersion }) => Promise<unknown>,
  preferred: VerificationMethodContractVersion,
): Promise<VerificationMethodConsoleLoad> {
  const response = await call("verification_method_console", { contract_version: preferred });
  const parsed = verificationMethodConsoleResponse(response, preferred);
  if (parsed) return { ok: true, version: preferred, data: parsed };
  const error = verificationMethodErrorResponse(response);
  if (preferred !== 2 || error !== "verification-method-contract-version") return { ok: false, version: preferred, error };
  const fallback = await call("verification_method_console", { contract_version: 1 });
  const legacy = verificationMethodConsoleResponse(fallback, 1);
  return legacy
    ? { ok: true, version: 1, data: legacy }
    : { ok: false, version: 1, error: verificationMethodErrorResponse(fallback) };
}

export function verificationMethodMutationResponse(
  value: unknown,
  version: VerificationMethodContractVersion = 1,
): VerificationMethodMutationData | null {
  return successData(value, (data) => {
    const raw = requiredObject(data, [
      "contract_version", "principal", "policy", "method_availability", "replayed",
    ]);
    const principal = verificationAdminPrincipal(raw?.principal);
    const policy = verificationMethodPolicy(raw?.policy, version);
    const methodAvailability = verificationMethodAvailabilityMap(raw?.method_availability);
    const hidden = raw ? gateModeHidden(raw, version) : undefined;
    if (raw?.contract_version !== version || !principal || !policy || !methodAvailability
      || typeof raw.replayed !== "boolean" || !hidden) return null;
    return {
      contract_version: version,
      principal,
      policy,
      method_availability: methodAvailability,
      replayed: raw.replayed,
      ...hidden,
    };
  });
}

/**
 * `gate_mode_hidden` (D-151 review): an optional boolean on v1 save, impact
 * and apply answers while a mode is stored. v2 shows the modes and never
 * carries it. `undefined` = refused; `{}` or `{gate_mode_hidden: true}` = material.
 */
function gateModeHidden(
  source: Record<string, unknown>,
  version: VerificationMethodContractVersion,
): { gate_mode_hidden?: true } | undefined {
  if (!Object.hasOwn(source, "gate_mode_hidden")) return {};
  if (version === 2 || typeof source.gate_mode_hidden !== "boolean") return undefined;
  return source.gate_mode_hidden ? { gate_mode_hidden: true } : {};
}

/** v2 rows (contract §8.4) also name the live and draft gate mode; v1 rows never do. */
function impactGateModes(
  source: Record<string, unknown>,
  version: VerificationMethodContractVersion,
): VerificationMethodImpactGateModes | null {
  if (version === 1) return {};
  const live = gateMode(source.live_gate_mode);
  const draft = gateMode(source.draft_gate_mode);
  return live && draft ? { live_gate_mode: live, draft_gate_mode: draft } : null;
}

export function verificationMethodImpactResponse(
  value: unknown,
  version: VerificationMethodContractVersion = 1,
): VerificationMethodImpactData | null {
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
    const hidden = raw ? gateModeHidden(raw, version) : undefined;
    if (raw?.contract_version !== version || !hidden || !principal || evaluatedAt === null || expectedRevision === null
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
      const modes = impactGateModes(row, version);
      if (!live || !draft || !counts || !modes) return null;
      rows.push({ storefront: row.storefront, live_method: live, draft_method: draft, ...modes, ...counts });
    }
    const keys = rows.map((row) => row.storefront);
    if (new Set(keys).size !== keys.length) return null;
    if (keys.some((key, index) => index > 0 && key <= keys[index - 1])) return null;

    const unknownRaw = requiredObject(impact.unknown_storefront, ["live_method", "draft_method", ...IMPACT_COUNT_KEYS]);
    const unknownLive = mandatoryMethod(unknownRaw?.live_method);
    const unknownDraft = mandatoryMethod(unknownRaw?.draft_method);
    const unknownCounts = unknownRaw ? impactCounts(unknownRaw) : null;
    const unknownModes = unknownRaw ? impactGateModes(unknownRaw, version) : null;
    const totalsRaw = requiredObject(impact.totals, IMPACT_COUNT_KEYS);
    const totals = totalsRaw ? impactCounts(totalsRaw) : null;
    if (!unknownLive || !unknownDraft || !unknownCounts || !unknownModes || !totals) return null;
    // Contract §4.3: `totals` is the exact sum of the storefront rows plus the
    // unknown row. A total that does not add up is not a proven count.
    const expectedTotals = sumCounts([...rows, unknownCounts]);
    if (IMPACT_COUNT_KEYS.some((key) => totals[key] !== expectedTotals[key])) return null;

    return {
      contract_version: version,
      principal,
      evaluated_at: evaluatedAt,
      expected_revision: expectedRevision,
      normalized_fingerprint: fingerprint,
      confirmation_phrase: VERIFICATION_METHOD_CONFIRMATION_PHRASE,
      method_availability: methodAvailability,
      publish_guard: guard,
      impact: {
        by_storefront: rows,
        unknown_storefront: { live_method: unknownLive, draft_method: unknownDraft, ...unknownModes, ...unknownCounts },
        totals,
      },
      ...hidden,
    };
  });
}

/** The two authoritative conflict bodies of contract §5 — every other refusal carries no `data`. */
export function verificationMethodConflictResponse(
  value: unknown,
  version: VerificationMethodContractVersion = 1,
): { error: "verification-method-conflict" | "verification-method-preview-stale"; data: VerificationMethodConflictData } | null {
  const envelope = webadminErrorEnvelope(value, "required");
  if (!envelope || envelope.status_code !== 409) return null;
  const error = oneOf(envelope.error, ["verification-method-conflict", "verification-method-preview-stale"] as const);
  if (!error) return null;
  const raw = requiredObject(envelope.data, ["contract_version", "policy", "method_availability"]);
  const policy = verificationMethodPolicy(raw?.policy, version);
  const methodAvailability = verificationMethodAvailabilityMap(raw?.method_availability);
  if (raw?.contract_version !== version || !policy || !methodAvailability) return null;
  return { error, data: { contract_version: version, policy, method_availability: methodAvailability } };
}

/**
 * The save refusal of D-151's review: a scope whose effective mode is Explore
 * while its effective method is video or photo. The body carries `data`, so
 * the plain error parser declines it; without this parser it would read as an
 * unknown outcome and be retained. A 422 proves nothing was written. Publish
 * answers the same code with no `data`, which the plain parser handles.
 */
export function verificationMethodGateModeConflictResponse(value: unknown): VerificationMethodGateModeConflict | null {
  const envelope = webadminErrorEnvelope(value, "required");
  if (!envelope || envelope.status_code !== 422 || envelope.error !== "verification-method-gate-mode-invalid") return null;
  const raw = exactObject(envelope.data, ["reason", "scopes"]);
  if (!raw || raw.reason !== "explore_requires_persona" || !Array.isArray(raw.scopes) || raw.scopes.length === 0) return null;
  const scopes: string[] = [];
  for (const [index, scope] of raw.scopes.entries()) {
    if (scope === "global" && index === 0) {
      scopes.push(scope);
      continue;
    }
    if (!isForcedStorefront(scope)) return null;
    const previous = scopes[scopes.length - 1];
    if (previous !== undefined && previous !== "global" && scope <= previous) return null;
    scopes.push(scope);
  }
  return { reason: "explore_requires_persona", scopes };
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
  /**
   * Contract v2: exactly what Core served plus the operator's own changes —
   * never a mode the console chose by itself. `null` on the v1 wire, where the
   * document is the three-key shape and the control is hidden.
   */
  gate_mode: VerificationGateModePolicy | null;
};

/**
 * `gateMode`: a mode entry outside the storefront catalogue or the closed mode
 * list. `exploreRequiresPersona`: a scope resolves to Explore while its method
 * is video or photo, which Core refuses (D-151 review).
 */
export type VerificationMethodDraftIssue = ForcedVerificationDraftIssue | "gateMode" | "exploreRequiresPersona";

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
    gate_mode: document.gate_mode
      ? { global: document.gate_mode.global, overrides: { ...document.gate_mode.overrides } }
      : null,
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
  if (draft.gate_mode !== null) {
    const modeKeys = Object.keys(draft.gate_mode.overrides);
    if (gateMode(draft.gate_mode.global) === null
      || modeKeys.length > VERIFICATION_METHOD_MAX_OVERRIDES
      || modeKeys.some((key) => !isForcedStorefront(key) || gateMode(draft.gate_mode!.overrides[key]) === null)) {
      return "gateMode";
    }
    if (draftGateModeConflicts(draft).length > 0) return "exploreRequiresPersona";
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
  const document: VerificationMethodDocument = {
    global: draft.global,
    overrides,
    waiting_room_copy: {
      default: { en: trimCopy(draft.copy_default.en), hu: trimCopy(draft.copy_default.hu) },
      overrides: copyOverrides,
    },
  };
  if (draft.gate_mode === null) return document;
  // Fourth and last, `global` before `overrides`, storefronts ascending. An
  // inheriting storefront has no key; Core drops the whole object again when
  // it equals the Full block default (canonical omission, contract §8.1).
  const modeOverrides: Record<string, VerificationGateMode> = {};
  for (const storefront of Object.keys(draft.gate_mode.overrides).sort()) {
    modeOverrides[storefront] = draft.gate_mode.overrides[storefront];
  }
  return { ...document, gate_mode: { global: draft.gate_mode.global, overrides: modeOverrides } };
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

/** Whether a document mandates `method` anywhere: globally or in one storefront override. */
export function documentUsesMethod(document: VerificationMethodDocument, method: MandatoryMethod): boolean {
  return document.global === method || Object.values(document.overrides).includes(method);
}

// ---------------------------------------------------------------------------
// Gate mode (D-151 §8.1)
// ---------------------------------------------------------------------------

/** The mode a storefront resolves to (its own entry → global); `null` is the global row / an unknown storefront. */
export function resolveGateMode(gate: VerificationGateModePolicy, storefront: string | null): VerificationGateMode {
  return storefront !== null && Object.hasOwn(gate.overrides, storefront) ? gate.overrides[storefront] : gate.global;
}

/** What a row's control shows: the global mode, or a storefront's own entry, or `inherit` when it has none. */
export function gateModeChoice(gate: VerificationGateModePolicy, storefront: string | null): VerificationGateModeChoice {
  if (storefront === null) return gate.global;
  return Object.hasOwn(gate.overrides, storefront) ? gate.overrides[storefront] : "inherit";
}

/**
 * The policy after ONE operator choice on one row. `inherit` removes the
 * storefront's key; nothing else changes. The global row has no `inherit`.
 */
export function withGateModeChoice(
  gate: VerificationGateModePolicy,
  storefront: string | null,
  choice: VerificationGateModeChoice,
): VerificationGateModePolicy {
  if (storefront === null) return choice === "inherit" ? gate : { ...gate, global: choice };
  const overrides = { ...gate.overrides };
  if (choice === "inherit") delete overrides[storefront];
  else overrides[storefront] = choice;
  return { global: gate.global, overrides };
}

/**
 * Storefronts that carry a mode but no method row, ascending. Core allows the
 * two override maps to differ (contract §8.1); this console never creates one,
 * but it shows and preserves one it is served.
 */
export function gateModeOnlyStorefronts(draft: VerificationMethodDraft): string[] {
  if (draft.gate_mode === null) return [];
  const methodRows = new Set(draft.overrides.map((row) => row.storefront));
  return Object.keys(draft.gate_mode.overrides).filter((key) => !methodRows.has(key)).sort();
}

/**
 * True when Core stores no `gate_mode`: every effective mode is Full block —
 * the global mode and every storefront entry (D-151 review canonical form, Core
 * `allFullBlock`). Then the document is the released three-key shape an older
 * Core reads.
 */
export function isDefaultGateModePolicy(gate: VerificationGateModePolicy | undefined): boolean {
  return gate === undefined || (gate.global === VERIFICATION_GATE_MODE_ABSENT
    && Object.values(gate.overrides).every((mode) => mode === VERIFICATION_GATE_MODE_ABSENT));
}

/**
 * Whether Core stores `gate_mode` in the saved draft OR the live document.
 * A Core older than D-151 normalizes both on every gated request, so either
 * one with modes makes it fail closed for everybody (Core `storesGateMode`).
 */
export function verificationMethodPolicyStoresGateMode(policy: VerificationMethodPolicy): boolean {
  return !isDefaultGateModePolicy(policy.draft.document.gate_mode)
    || !isDefaultGateModePolicy(policy.live.document.gate_mode);
}

/**
 * The mode a row stores although its method is None (`null` when it stores
 * none, or only Full block). Core keeps it — None may hold any mode — so it
 * still blocks the three-key rollback form and comes back into force when the
 * method changes. Global: its own mode; a storefront: its own entry only.
 */
export function gateModeStoredUnderNone(
  gate: VerificationGateModePolicy,
  storefront: string | null,
): VerificationGateMode | null {
  const own = storefront === null ? gate.global : gate.overrides[storefront];
  return own !== undefined && own !== VERIFICATION_GATE_MODE_ABSENT ? own : null;
}

/** What removing a row did to that storefront's own mode, for the operator's notice. */
export type GateModeRemovalNotice =
  /** Its own mode is gone and the storefront now gets a different one (Global's). */
  | { kind: "dropped"; reason: "none" | "persona"; mode: VerificationGateMode; global: VerificationGateMode }
  /** Its own mode is gone but equals Global's: the storefront still gets `mode`. */
  | { kind: "follows-global"; mode: VerificationGateMode };

/**
 * The modes after a storefront's method row is removed; the storefront then
 * runs under `globalMethod`.
 * - Review round 1: an own entry equal to the global mode is dropped silently
 *   (nothing changes); a different one stays as a mode-only row, so the
 *   storefront's members get what they got before.
 * - Review round 2: under a removed None method, an own mode other than Full
 *   block had no effect and would come alive under Global's method: dropped.
 * - Review round 3: an own Explore that would sit under a non-Persona global
 *   method can only ever be refused: dropped too.
 * The notice says what the storefront gets afterwards, never more (round 3):
 * a drop is reported only when the resulting mode differs.
 */
export function gateModeAfterRowRemoval(
  gate: VerificationGateModePolicy,
  storefront: string,
  removedMethod: MandatoryMethod,
  globalMethod: MandatoryMethod,
): { gate_mode: VerificationGateModePolicy; notice: GateModeRemovalNotice | null } {
  if (!Object.hasOwn(gate.overrides, storefront)) return { gate_mode: gate, notice: null };
  const own = gate.overrides[storefront];
  const without = withGateModeChoice(gate, storefront, "inherit");
  const reason = removedMethod === "none" && own !== VERIFICATION_GATE_MODE_ABSENT
    ? "none"
    : own === "explore" && !gateModeExploreAllowed(globalMethod)
      ? "persona"
      : null;
  if (reason !== null) {
    return {
      gate_mode: without,
      notice: own === gate.global
        ? { kind: "follows-global", mode: gate.global }
        : { kind: "dropped", reason, mode: own, global: gate.global },
    };
  }
  return own === gate.global ? { gate_mode: without, notice: null } : { gate_mode: gate, notice: null };
}

/**
 * Storefront method rows that force a method and have no mode of their own:
 * Global's mode is in effect for them whatever Global's own method is — also
 * under a Global None (review round 2). Ascending.
 */
export function gateModeGlobalInheritors(draft: VerificationMethodDraft): string[] {
  if (draft.gate_mode === null) return [];
  const gate = draft.gate_mode;
  return draft.overrides
    .filter((row) => row.method !== "none" && !Object.hasOwn(gate.overrides, row.storefront))
    .map((row) => row.storefront)
    .sort();
}

/**
 * Whether Explore can stand on a Global row whose method is None (review
 * round 3): only when at least one storefront that follows it forces Persona.
 * Otherwise every follower would be refused, so the draft could never save.
 */
export function gateModeGlobalFollowersAllowExplore(draft: VerificationMethodDraft): boolean {
  const followers = new Set(gateModeGlobalInheritors(draft));
  return draft.overrides.some((row) => followers.has(row.storefront) && gateModeExploreAllowed(row.method));
}

/**
 * Explicit Full block entries Core drops on save: while every scope is Full
 * block it stores no gate mode at all (lead ruling, rollback safety). Empty as
 * soon as some scope uses Explore. Ascending.
 */
export function gateModePinsDroppedOnSave(gate: VerificationGateModePolicy | null): string[] {
  if (gate === null || !isDefaultGateModePolicy(gate)) return [];
  return Object.keys(gate.overrides).sort();
}

/** Storefront entries a save sent that Core did not store (canonical form). Ascending. */
export function gateModeEntriesDropped(
  sent: VerificationGateModePolicy | undefined,
  stored: VerificationGateModePolicy | undefined,
): string[] {
  if (!sent) return [];
  return Object.keys(sent.overrides).filter((key) => !stored || !Object.hasOwn(stored.overrides, key)).sort();
}

// ---------------------------------------------------------------------------
// Draft operations and commands (the table calls these; they are tested)
// ---------------------------------------------------------------------------

/**
 * Adds a storefront row that changes nothing by itself: it starts from the
 * method it inherits and an empty copy override. It writes no gate mode — a
 * new row follows Global until the operator picks one (D-151a point 4).
 * `null` when the storefront already has a row or is not in the catalogue.
 */
export function verificationMethodDraftWithStorefront(
  draft: VerificationMethodDraft,
  storefront: string,
): VerificationMethodDraft | null {
  if (!isForcedStorefront(storefront) || draft.overrides.some((row) => row.storefront === storefront)) return null;
  return {
    ...draft,
    overrides: [...draft.overrides, { storefront, method: draft.global, copy: emptyWaitingRoomCopyOverrideDraft() }],
  };
}

/**
 * Removes a storefront row: its method and copy override together (contract
 * §7.1), and its own gate mode per `gateModeAfterRowRemoval`.
 */
export function verificationMethodDraftWithoutStorefront(
  draft: VerificationMethodDraft,
  storefront: string,
): { draft: VerificationMethodDraft; notice: GateModeRemovalNotice | null } {
  const row = draft.overrides.find((entry) => entry.storefront === storefront);
  if (!row) return { draft, notice: null };
  const overrides = draft.overrides.filter((entry) => entry.storefront !== storefront);
  if (draft.gate_mode === null) return { draft: { ...draft, overrides }, notice: null };
  const next = gateModeAfterRowRemoval(draft.gate_mode, storefront, row.method, draft.global);
  return { draft: { ...draft, overrides, gate_mode: next.gate_mode }, notice: next.notice };
}

/** The publish command, bound to the version, revision and fingerprint of the impact it was previewed with (v1 and v2 fingerprints differ). */
export function verificationMethodApplyCommand(
  impact: VerificationMethodImpactData,
  reason: string,
  requestId: string,
): Record<string, unknown> {
  return {
    contract_version: impact.contract_version,
    expected_revision: impact.expected_revision,
    normalized_fingerprint: impact.normalized_fingerprint,
    confirmation_phrase: impact.confirmation_phrase,
    reason,
    request_id: requestId,
  };
}

/**
 * Whether a v1 command's answer proves that Core speaks v2, so the session
 * should switch back to v2 and re-read: `gate_mode_hidden` on a success
 * (round 2), or the Persona-rule refusal of a v1 save whose carried mode
 * conflicts (round 3) — both exist only on a D-151 Core.
 */
export function verificationMethodOutcomeProvesV2(
  outcome: VerificationMethodMutationOutcome,
  commandVersion: VerificationMethodContractVersion,
): boolean {
  if (commandVersion !== 1) return false;
  return (outcome.kind === "success" && outcome.data.gate_mode_hidden === true)
    || outcome.kind === "gate-mode-conflict";
}

export type VerificationMethodMutationOutcome =
  | { kind: "success"; data: VerificationMethodMutationData }
  | { kind: "gate-mode-conflict"; conflict: VerificationMethodGateModeConflict }
  | { kind: "conflict"; error: "verification-method-conflict" | "verification-method-preview-stale"; data: VerificationMethodConflictData }
  | { kind: "refused"; error: VerificationMethodError | null; retain: boolean };

/**
 * One mutation answer, classified in the only safe order: success, the
 * Persona-rule refusal (a 422 with `data`, which the plain parser declines and
 * would otherwise read as an unknown outcome), the CAS conflict, then every
 * other refusal — retained only while the outcome is genuinely unknown.
 */
export function verificationMethodMutationOutcome(
  response: unknown,
  version: VerificationMethodContractVersion,
): VerificationMethodMutationOutcome {
  const success = verificationMethodMutationResponse(response, version);
  if (success) return { kind: "success", data: success };
  const gateConflict = verificationMethodGateModeConflictResponse(response);
  if (gateConflict) return { kind: "gate-mode-conflict", conflict: gateConflict };
  const conflict = verificationMethodConflictResponse(response, version);
  if (conflict) return { kind: "conflict", error: conflict.error, data: conflict.data };
  const error = verificationMethodErrorResponse(response);
  return { kind: "refused", error, retain: verificationMethodShouldRetainMutation(error) };
}

/** The one method Explore may run under (D-151 review): the T-713 boundary it relaxes is Persona's. */
export const VERIFICATION_GATE_MODE_EXPLORE_METHOD = "persona" as const satisfies MandatoryMethod;

/** Whether a row whose effective method is `method` may choose Explore. */
export function gateModeExploreAllowed(method: MandatoryMethod): boolean {
  return method === VERIFICATION_GATE_MODE_EXPLORE_METHOD;
}

type GateModeMaterial = {
  global: MandatoryMethod;
  overrides: Record<string, MandatoryMethod>;
  gate_mode?: VerificationGateModePolicy | null;
};

/**
 * Core `VerificationMethodPolicy::gateModeMethodConflicts`: the scopes whose
 * effective mode is Explore while the effective method is video or photo —
 * `global` first, then every storefront named by either override map,
 * ascending. A scope with method `none` may hold any mode; it affects nobody.
 */
export function gateModeMethodConflicts(material: GateModeMaterial): string[] {
  const gate = material.gate_mode;
  if (!gate) return [];
  const conflict = (method: MandatoryMethod, mode: VerificationGateMode) =>
    mode === "explore" && (method === "video" || method === "photo");
  const scopes: string[] = [];
  if (conflict(material.global, gate.global)) scopes.push("global");
  const storefronts = [...new Set([...Object.keys(material.overrides), ...Object.keys(gate.overrides)])].sort();
  for (const storefront of storefronts) {
    const method = Object.hasOwn(material.overrides, storefront) ? material.overrides[storefront] : material.global;
    if (conflict(method, resolveGateMode(gate, storefront))) scopes.push(storefront);
  }
  return scopes;
}

/** The same check over the editor draft, before any document exists. */
export function draftGateModeConflicts(draft: VerificationMethodDraft): string[] {
  const overrides: Record<string, MandatoryMethod> = {};
  for (const row of draft.overrides) overrides[row.storefront] = row.method;
  return gateModeMethodConflicts({ global: draft.global, overrides, gate_mode: draft.gate_mode });
}

/** Every storefront whose method is `photo`, ascending. */
export function photoStorefronts(document: VerificationMethodDocument): string[] {
  return Object.keys(document.overrides).filter((key) => document.overrides[key] === "photo").sort();
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

/**
 * Contextual guidance, not a diagnosis: these Core codes can also reject other
 * copy fields. Inspect the retained save, never an editor that changed in flight.
 * Core alone validates the effective photo help links, including inheritance.
 */
export function verificationMethodPhotoCopyGuidance(
  error: VerificationMethodError | null,
  pending: unknown,
): "default" | "overrides" | null {
  if (error !== "verification-method-copy-default-invalid"
    && error !== "verification-method-copy-overrides-invalid") return null;
  const command = verificationMethodPendingFrom(pending);
  if (command?.action !== "verification_method_save") return null;
  const version = command.payload.contract_version === 2 ? 2 : 1;
  const document = verificationMethodDocument(command.payload.draft_json, "exact", version);
  if (!document) return null;
  if (error === "verification-method-copy-default-invalid" && document.global === "photo") {
    return "default";
  }
  if (error === "verification-method-copy-overrides-invalid"
    && Object.values(document.overrides).includes("photo")) return "overrides";
  return null;
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
 * canonical JSON string of exactly `{global, overrides, waiting_room_copy}` on
 * contract v1 and of exactly those plus `gate_mode` on contract v2 (`lib/core.ts`
 * serialises nested objects). Anything the strict parsers refuse is answered
 * `invalid-input` here, before Core is called at all. Core remains the judge of
 * whether it speaks the requested version (`verification-method-contract-version`).
 */
export function normalizeVerificationMethodProxyBody(
  action: string,
  body: Record<string, unknown>,
): Record<string, unknown> | null | undefined {
  if (!isVerificationMethodAction(action)) return undefined;
  const version = body.contract_version === 1 || body.contract_version === 2 ? body.contract_version : null;
  if (version === null) return null;
  switch (action) {
    case "verification_method_console":
      return exactKeys(body, ["contract_version"]) ? { contract_version: version } : null;
    case "verification_method_save": {
      if (!exactKeys(body, ["contract_version", "draft_json", "expected_revision", "request_id"])) return null;
      const expectedRevision = revision(body.expected_revision);
      const document = verificationMethodDocument(body.draft_json, "exact", version);
      if (expectedRevision === null || !document || !isVerificationMethodRequestId(body.request_id)) return null;
      return {
        contract_version: version,
        draft_json: document,
        expected_revision: expectedRevision,
        request_id: body.request_id,
      };
    }
    case "verification_method_impact": {
      if (!exactKeys(body, ["contract_version", "expected_revision"])) return null;
      const expectedRevision = revision(body.expected_revision);
      return expectedRevision === null ? null : { contract_version: version, expected_revision: expectedRevision };
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
        contract_version: version,
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
