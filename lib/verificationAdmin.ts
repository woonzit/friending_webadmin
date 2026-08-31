import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";
import {
  webadminDataSuccessEnvelope,
  webadminErrorEnvelope,
} from "@/lib/webadminEnvelope";

/** Accepted Verification Policy v1 contract. Every vocabulary is closed. */
export const VERIFICATION_CONTRACT_VERSION = 1 as const;
export const VERIFICATION_METHODS = ["video", "persona"] as const;
export const VERIFICATION_METHOD_STATUSES = ["not_started", "pending", "verified", "rejected"] as const;
export const VERIFICATION_LEVELS = ["none", "light", "strong"] as const;
export const VERIFICATION_REQUIREMENTS = ["inherit", "none", "light", "strong"] as const;
export const VERIFICATION_EFFECTIVE_REQUIREMENTS = ["none", "light", "strong"] as const;
export const VERIFICATION_SCOPE_KINDS = ["global", "country", "city"] as const;
export const VERIFICATION_SCOPE_FILTERS = ["all", ...VERIFICATION_SCOPE_KINDS] as const;
export const VERIFICATION_POLICY_OPERATIONS = ["publish", "deactivate", "tombstone", "restore"] as const;
export const VERIFICATION_GATE_VARIANTS = ["video", "persona", "both", "pending", "rejected"] as const;
export const VERIFICATION_BADGE_SLOTS = ["light", "strong", "pending"] as const;
export const VERIFICATION_LOCALES = ["en", "hu"] as const;
export const VERIFICATION_PROVENANCE = ["derived", "imported", "granted"] as const;
/** Every console tab, including the D-053 "Forced & waiting room" tab (T-471). */
export const VERIFICATION_TAB_KEYS = ["scopes", "requirements", "messages", "badges", "simulator", "forced"] as const;
export const VERIFICATION_FEATURE_KEYS = [
  "people.list",
  "profile.view",
  "chat.send",
  "friend.request",
  "dates.access",
  "dates.create",
  "dates.join",
  "footprints.send",
  "pinger.send",
  "album.private_request",
] as const;
export const VERIFICATION_CAPABILITIES = [
  "verification_badge_edit",
  "verification_copy_edit",
  "verification_grant_edit",
  "verification_grant_read",
  "verification_pending_read",
  "verification_policy_edit",
  "verification_policy_publish",
  "verification_policy_read",
  "verification_simulate",
] as const;
export const VERIFICATION_GRANT_CAPABILITIES = ["verification_grant_edit", "verification_grant_read"] as const;
export const VERIFICATION_ADMIN_ACTIONS = [
  "verification_console",
  "verification_policy_save_draft",
  "verification_policy_impact_preview",
  "verification_policy_apply",
  "verification_copy_save",
  "verification_copy_remove",
  "verification_pending_settings_save",
  "verification_badge_upload",
  "verification_badge_remove",
  "verification_places_city_search",
  "verification_places_city_detail",
  "verification_simulate",
  "verification_pending_summary",
  "verification_user_detail",
  "verification_grant_preview",
  "verification_grant_save",
  "verification_grant_remove",
] as const;
export const VERIFICATION_MUTATION_ACTIONS = [
  "verification_policy_save_draft",
  "verification_policy_apply",
  "verification_copy_save",
  "verification_copy_remove",
  "verification_pending_settings_save",
  "verification_badge_upload",
  "verification_badge_remove",
  "verification_grant_save",
  "verification_grant_remove",
] as const;

export const MAX_VERIFICATION_BADGE_BYTES = 2_097_152;
export const MAX_VERIFICATION_BADGE_FORM_BYTES = 3_145_728;
export const MAX_VERIFICATION_BADGE_DIMENSION = 2_048;
export const MIN_VERIFICATION_BADGE_DIMENSION = 16;
export const VERIFICATION_FIXTURE_EVALUATED_AT = 1_787_692_800;

export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];
export type VerificationMethodStatus = (typeof VERIFICATION_METHOD_STATUSES)[number];
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];
export type VerificationRequirement = (typeof VERIFICATION_REQUIREMENTS)[number];
export type VerificationEffectiveRequirement = (typeof VERIFICATION_EFFECTIVE_REQUIREMENTS)[number];
export type VerificationScopeKind = (typeof VERIFICATION_SCOPE_KINDS)[number];
export type VerificationScopeFilter = (typeof VERIFICATION_SCOPE_FILTERS)[number];
export type VerificationPolicyOperation = (typeof VERIFICATION_POLICY_OPERATIONS)[number];
export type VerificationGateVariant = (typeof VERIFICATION_GATE_VARIANTS)[number];
export type VerificationBadgeSlot = (typeof VERIFICATION_BADGE_SLOTS)[number];
export type VerificationLocale = (typeof VERIFICATION_LOCALES)[number];
export type VerificationProvenance = (typeof VERIFICATION_PROVENANCE)[number];
export type VerificationTabKey = (typeof VERIFICATION_TAB_KEYS)[number];
export type VerificationFeatureKey = (typeof VERIFICATION_FEATURE_KEYS)[number];
export type VerificationCapability = (typeof VERIFICATION_CAPABILITIES)[number];
export type VerificationAction = (typeof VERIFICATION_ADMIN_ACTIONS)[number];
export type VerificationMutationAction = (typeof VERIFICATION_MUTATION_ACTIONS)[number];

export type VerificationAdminPrincipal = {
  role: "viewer" | "admin" | "owner";
  capabilities: VerificationCapability[];
};

export type VerificationAdminMe = {
  contract_version: 1;
  contract_ready: boolean;
  principal: VerificationAdminPrincipal;
  actions: VerificationAction[];
};

export type VerificationAccess = {
  contract_version: 1;
  contract_ready: boolean;
  capabilities: Array<"verification_grant_read" | "verification_grant_edit">;
};

export type VerificationMethodAvailability = {
  method: VerificationMethod;
  policy_enable_allowed: boolean;
  new_start_available: boolean;
  reason: null | "deployment_unlock_disabled" | "service_config_disabled" | "provider_unconfigured";
};

export type VerificationScope = {
  kind: VerificationScopeKind;
  country_code: string | null;
  place_id: string | null;
  display: string;
};

export type VerificationStoredPolicyBlock = {
  enabled_methods: "inherit" | VerificationMethod[];
  feature_requirements: Record<VerificationFeatureKey, VerificationRequirement>;
};

export type VerificationSavedPolicyBlock = VerificationStoredPolicyBlock & {
  saved_at: number;
  saved_by: string;
};

export type VerificationEffectivePolicy = {
  enabled_methods: VerificationMethod[];
  enabled_methods_source_scope_key: string;
  tier_language: boolean;
  feature_requirements: Record<VerificationFeatureKey, {
    configured_requirement: VerificationEffectiveRequirement;
    required_tier: VerificationEffectiveRequirement;
    source_scope_key: string;
  }>;
};

export type VerificationPolicy = {
  schema_version: 1;
  scope_key: string;
  scope: VerificationScope;
  revision: number;
  active: boolean;
  deleted_at: number | null;
  draft: VerificationSavedPolicyBlock;
  live: VerificationSavedPolicyBlock | null;
  effective: VerificationEffectivePolicy | null;
  updated_at: number;
  updated_by: string;
};

export type VerificationPolicyLifecycle =
  | "active"
  | "draft_only"
  | "inactive"
  | "tombstoned_draft_only"
  | "tombstoned_live";

type VerificationPolicyState = Pick<VerificationPolicy, "scope" | "active" | "deleted_at" | "live">;

/**
 * Core owns policy transitions. This closed projection exists only to label the
 * returned state and to avoid offering operations that the v1 contract refuses.
 */
export function verificationPolicyLifecycle(policy: VerificationPolicyState): VerificationPolicyLifecycle {
  if (policy.deleted_at !== null) return policy.live === null ? "tombstoned_draft_only" : "tombstoned_live";
  if (policy.active) return "active";
  return policy.live === null ? "draft_only" : "inactive";
}

/**
 * A7 permits publish for a draft-only override. A8 keeps a draft-only
 * tombstone draft-only after restore, so it must be published separately.
 */
export function verificationPolicyOperationsFor(policy: VerificationPolicyState): VerificationPolicyOperation[] {
  if (policy.scope.kind === "global") return ["publish"];
  if (policy.deleted_at !== null) return ["restore"];
  return VERIFICATION_POLICY_OPERATIONS.filter((operation) => {
    if (operation === "publish") return policy.active || policy.live === null;
    if (operation === "deactivate") return policy.active;
    return operation === "tombstone";
  });
}

export type VerificationCopyBehavior = {
  icon: { kind: "asset"; asset_key: `verification.${VerificationGateVariant}` };
  primary_action: "automatic" | "open_verification_center" | "url" | "none";
  primary_url: string | null;
  secondary_action: "open_verification_center" | "url" | "none";
  secondary_url: string | null;
};

export type VerificationLocalizedGateCopy = {
  title: string;
  subtitle: string;
  description: string;
  overdue_description: string | null;
  attention_note: string | null;
  primary_label: string | null;
  secondary_label: string | null;
  cancel_label: string;
};

export type VerificationCopyPair = {
  schema_version: 1;
  copy_key: string;
  revision: number;
  active: boolean;
  deleted_at: number | null;
  behavior: VerificationCopyBehavior;
  locales: Record<VerificationLocale, VerificationLocalizedGateCopy>;
  updated_at: number;
  updated_by: string;
};

export type VerificationPendingSettings = {
  schema_version: 1;
  revision: number;
  overdue_after_seconds: number;
  queue_average_long_copy_enabled: boolean;
  queue_average_threshold_seconds: number;
  updated_at: number;
  updated_by: string;
};

export type VerificationBadgeAsset = {
  schema_version: 1;
  slot: VerificationBadgeSlot;
  revision: number;
  active: boolean;
  deleted_at: number | null;
  managed_url: string | null;
  mime: "image/png" | null;
  width: number | null;
  height: number | null;
  byte_size: number | null;
  content_sha256: string | null;
  updated_at: number;
  updated_by: string;
};

export type VerificationActivationGuard = {
  non_none_publish_ready: boolean;
  blocking_reasons: Array<"supported_client_unready" | "persona_force_receipt_unready" | "global_policy_invalid" | "method_unavailable">;
};

export type VerificationConsoleData = {
  contract_version: 1;
  principal: VerificationAdminPrincipal;
  evaluated_at: number;
  feature_keys: VerificationFeatureKey[];
  method_availability: Record<VerificationMethod, VerificationMethodAvailability>;
  policies: VerificationPolicy[];
  next_cursor: string | null;
  total_policies: number;
  copy_pairs: VerificationCopyPair[];
  pending_settings: VerificationPendingSettings;
  badges: [VerificationBadgeAsset, VerificationBadgeAsset, VerificationBadgeAsset];
  import_health: { evaluated_at: number; total: number; invalid: number };
  activation_guard: VerificationActivationGuard;
};

export type VerificationPolicyMutationData = {
  contract_version: 1;
  principal: VerificationAdminPrincipal;
  policy: VerificationPolicy;
  replayed: boolean;
};

export type VerificationFeatureImpact = {
  feature: VerificationFeatureKey;
  configured_before: VerificationEffectiveRequirement;
  configured_after: VerificationEffectiveRequirement;
  effective_before: VerificationEffectiveRequirement;
  effective_after: VerificationEffectiveRequirement;
  affected_members: number;
  newly_blocked: number;
  newly_unblocked: number;
};

export type VerificationPolicyImpactPreviewData = {
  contract_version: 1;
  principal: VerificationAdminPrincipal;
  evaluated_at: number;
  scope_key: string;
  operation: VerificationPolicyOperation;
  expected_revision: number;
  normalized_fingerprint: string;
  confirmation_phrase: string;
  method_availability: Record<VerificationMethod, VerificationMethodAvailability>;
  activation_guard: VerificationActivationGuard;
  impact: {
    members_evaluated: number;
    members_changed: number;
    newly_blocked: number;
    newly_unblocked: number;
    descendant_scope_count: number;
    features: VerificationFeatureImpact[];
  };
};

export type VerificationCopyMutationData = { contract_version: 1; principal: VerificationAdminPrincipal; copy_pair: VerificationCopyPair; replayed: boolean };
export type VerificationPendingSettingsMutationData = { contract_version: 1; principal: VerificationAdminPrincipal; pending_settings: VerificationPendingSettings; replayed: boolean };
export type VerificationBadgeMutationData = { contract_version: 1; principal: VerificationAdminPrincipal; badge: VerificationBadgeAsset; replayed: boolean };

export type VerificationCitySuggestion = { place_id: string; display: string; secondary: string; country_code: string };
export type VerificationCitySearchData = { contract_version: 1; principal: VerificationAdminPrincipal; search_token: string; suggestions: VerificationCitySuggestion[] };
export type VerificationCityDetailData = {
  contract_version: 1;
  principal: VerificationAdminPrincipal;
  city: { scope_key: string; kind: "city"; place_id: string; display: string; country_code: string; place_token: string; expires_at: number };
};

export type VerificationSimulationMethod = { status: VerificationMethodStatus; pending_age_seconds: number | null; attempt: number | null; retry_available: boolean };
export type VerificationSimulationInput = {
  video: VerificationSimulationMethod;
  persona: VerificationSimulationMethod;
  imported_level: VerificationLevel;
  imported_method_hint: "video" | "persona" | "manual" | null;
  grant_level: VerificationLevel;
  badge_visible: boolean;
};

export type VerificationModalAction = { kind: "start_video" | "start_persona" | "open_verification_center" | "url"; label: string; url: string | null };
export type VerificationModal = {
  kind: VerificationGateVariant;
  icon: { kind: "asset"; asset_key: `verification.${VerificationGateVariant}` };
  steps: Array<{ position: number; method: VerificationMethod; state: "complete" | "current" | "upcoming" }>;
  current_step: number | null;
  title: string;
  subtitle: string;
  description: string;
  attention_note: string | null;
  reason: string | null;
  attempt: number | null;
  max_attempts: number | null;
  manual_review_available: boolean;
  primary_action: VerificationModalAction | null;
  secondary_action: VerificationModalAction | null;
  cancel_label: string;
  provider_attribution: string | null;
};

export type VerificationSimulatedFeatureAccess = {
  feature: VerificationFeatureKey;
  configured_requirement: VerificationEffectiveRequirement;
  required_tier: VerificationEffectiveRequirement;
  allowed: boolean;
  missing_methods: VerificationMethod[];
  next_method: VerificationMethod | null;
  copy_key: string | null;
  modal: VerificationModal | null;
};

export type VerificationSimulationData = {
  contract_version: 1;
  principal: VerificationAdminPrincipal;
  evaluated_at: number;
  scope: VerificationScope;
  enabled_methods: VerificationMethod[];
  startable_methods: VerificationMethod[];
  tier_language: boolean;
  method_statuses: Record<VerificationMethod, VerificationMethodStatus>;
  derived_level: VerificationLevel;
  imported_level: VerificationLevel;
  granted_level: VerificationLevel;
  effective_level: VerificationLevel;
  effective_source: VerificationProvenance;
  external_seal_would_show: boolean;
  feature_access: VerificationSimulatedFeatureAccess[];
};

export type VerificationPendingMethodSummary = { method: VerificationMethod; total: number; in_sla: number; overdue: number; average_wait_seconds: number | null; oldest_pending_at: number | null };
export type VerificationPendingSummaryData = {
  contract_version: 1;
  principal: VerificationAdminPrincipal;
  evaluated_at: number;
  total: number;
  in_sla: number;
  overdue: number;
  average_wait_seconds: number | null;
  methods: [VerificationPendingMethodSummary, VerificationPendingMethodSummary];
};

export type VerificationAdminMethodProjection = {
  status: VerificationMethodStatus;
  raw_video_status: null | "not_started" | "missing_requirements" | "pending" | "verified" | "pending_re_review" | "awaiting_avatar" | "rejected" | "new_video_requested";
  can_start: boolean;
  pending_phase: "in_sla" | "overdue" | null;
  pending_since: number | null;
  member_safe_reason: string | null;
  attempt: number | null;
  max_attempts: number | null;
  manual_review_available: boolean;
  state_integrity: boolean;
};

export type VerificationGrant = {
  level: "light" | "strong";
  reason: string;
  granted_by: string;
  granted_at: number;
  expires_at: number | null;
  revision: number;
  status: "active" | "expired";
  evaluated_at: number;
};

export type VerificationUserProjection = {
  schema_version: 1;
  uid: number;
  display_name: string;
  evaluated_at: number;
  scope: VerificationScope & { scope_key: string; source: "current_location" | "registration_country" | "ip_country" | "global" };
  enabled_methods: VerificationMethod[];
  startable_methods: VerificationMethod[];
  tier_language: boolean;
  methods: Record<VerificationMethod, VerificationAdminMethodProjection>;
  badge_visible: boolean;
  derived_level: VerificationLevel;
  imported: null | { level: "light" | "strong"; method_hint: "persona" | "video" | "manual"; imported_from: "apifriending"; imported_at: number };
  import_integrity: "absent" | "valid" | "invalid";
  grant: VerificationGrant | null;
  grant_revision: number;
  effective_level: VerificationLevel;
  effective_source: VerificationProvenance;
  external_seal_would_show: boolean;
  feature_access: Array<{ feature: VerificationFeatureKey; configured_requirement: VerificationEffectiveRequirement; required_tier: VerificationEffectiveRequirement; allowed: boolean }>;
};

export type VerificationUserDetailData = { contract_version: 1; principal: VerificationAdminPrincipal; verification: VerificationUserProjection };
export type VerificationGrantPreviewData = {
  contract_version: 1;
  principal: VerificationAdminPrincipal;
  evaluated_at: number;
  current: VerificationUserProjection;
  preview: {
    granted_level: "light" | "strong";
    effective_level: VerificationLevel;
    effective_source: VerificationProvenance;
    external_seal_would_show: boolean;
    changes_effective_level: boolean;
    newly_allowed_features: VerificationFeatureKey[];
    still_blocked_features: VerificationFeatureKey[];
    strong_grant_warning: boolean;
  };
};
export type VerificationGrantMutationData = { contract_version: 1; principal: VerificationAdminPrincipal; verification: VerificationUserProjection; replayed: boolean };

type JsonObject = Record<string, unknown>;

function record(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function requiredObject(value: unknown, keys: readonly string[]): JsonObject | null {
  const source = record(value);
  return source && keys.every((key) => Object.hasOwn(source, key)) ? source : null;
}

// This exact object decoder is reserved for persisted retry identities.
function exactObject(value: unknown, keys: readonly string[]): JsonObject | null {
  const source = record(value);
  if (!source || Object.keys(source).length !== keys.length) return null;
  return keys.every((key) => Object.hasOwn(source, key)) ? source : null;
}

function oneOf<const T extends readonly string[]>(value: unknown, values: T): T[number] | null {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? value as T[number] : null;
}

function nullableOneOf<const T extends readonly string[]>(value: unknown, values: T): T[number] | null | undefined {
  if (value === null) return null;
  return oneOf(value, values) ?? undefined;
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function nullableInteger(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null | undefined {
  if (value === null) return null;
  const parsed = integer(value, minimum, maximum);
  return parsed === null ? undefined : parsed;
}

function scalarLength(value: string): number { return [...value].length; }

function hasUnsafeText(value: string, multiline: boolean): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
    if ((code < 0x20 && !(multiline && code === 0x0a)) || code === 0x7f) return true;
  }
  return false;
}

function canonicalText(value: unknown, minimum: number, maximum: number, multiline = false): string | null {
  if (typeof value !== "string" || value !== value.trim() || value !== value.normalize("NFC") || hasUnsafeText(value, multiline)) return null;
  const length = scalarLength(value);
  return length >= minimum && length <= maximum ? value : null;
}

function nullableText(value: unknown, minimum: number, maximum: number, multiline = false): string | null | undefined {
  if (value === null) return null;
  const parsed = canonicalText(value, minimum, maximum, multiline);
  return parsed === null ? undefined : parsed;
}

function canonicalEmail(value: unknown): string | null {
  const text = canonicalText(value, 3, 320);
  return text && text === text.toLowerCase() && /^[^\s@]+@[^\s@]+$/u.test(text) ? text : null;
}

function isoCountry(value: unknown): string | null { return typeof value === "string" && /^[A-Z]{2}$/u.test(value) ? value : null; }
function placeId(value: unknown): string | null { return typeof value === "string" && /^[\x21-\x7e]{1,256}$/u.test(value) ? value : null; }
function opaque(value: unknown, maximum: number): string | null { return typeof value === "string" && value.length >= 1 && value.length <= maximum && /^[A-Za-z0-9_-]+$/u.test(value) ? value : null; }
function requestId(value: unknown): string | null { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value) ? value : null; }
function sha256(value: unknown): string | null { return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) ? value : null; }

function safeHttpsUrl(value: unknown, managedImage = false): string | null {
  if (typeof value !== "string" || value !== value.trim() || value.length < 1
    || new TextEncoder().encode(value).byteLength > 2048 || hasUnsafeText(value, false)) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) return null;
    if (managedImage && parsed.origin.toLowerCase() !== "https://img.friending.co") return null;
    return parsed.href;
  } catch { return null; }
}

function nullableHttpsUrl(value: unknown): string | null | undefined {
  if (value === null) return null;
  return safeHttpsUrl(value) ?? undefined;
}

function orderedUnique<const T extends readonly string[]>(value: unknown, canonical: T): T[number][] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.map((entry) => oneOf(entry, canonical));
  if (rows.some((entry) => entry === null)) return null;
  const parsed = rows as T[number][];
  if (new Set(parsed).size !== parsed.length) return null;
  const expected = canonical.filter((entry) => parsed.includes(entry));
  return expected.length === parsed.length && expected.every((entry, index) => entry === parsed[index]) ? parsed : null;
}

function exactCanonical<const T extends readonly string[]>(value: unknown, canonical: T): T[number][] | null {
  const parsed = orderedUnique(value, canonical);
  return parsed && parsed.length === canonical.length ? parsed : null;
}

function scopeKey(value: unknown): string | null {
  if (value === "global") return value;
  if (typeof value !== "string") return null;
  if (/^country:[A-Z]{2}$/u.test(value)) return value;
  return value.startsWith("city:") && placeId(value.slice(5)) ? value : null;
}

function copyKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  for (const variant of VERIFICATION_GATE_VARIANTS) if (value === `default.${variant}`) return value;
  for (const feature of VERIFICATION_FEATURE_KEYS) for (const variant of VERIFICATION_GATE_VARIANTS) {
    if (value === `feature.${feature}.${variant}`) return value;
  }
  return null;
}

function methodArray(value: unknown): VerificationMethod[] | null { return orderedUnique(value, VERIFICATION_METHODS); }

const VERIFICATION_LEVEL_RANK: Record<VerificationLevel, number> = { none: 0, light: 1, strong: 2 };

function derivedLevelFromStatuses(statuses: Record<VerificationMethod, VerificationMethodStatus>): VerificationLevel {
  if (statuses.persona === "verified") return "strong";
  return statuses.video === "verified" ? "light" : "none";
}

function clampedRequirement(
  configured: VerificationEffectiveRequirement,
  enabledMethods: VerificationMethod[],
): VerificationEffectiveRequirement {
  if (enabledMethods.length === 0) return "none";
  if (enabledMethods.length === 1 && enabledMethods[0] === "video" && configured === "strong") return "light";
  return configured;
}

function effectiveLevelAndSource(
  derived: VerificationLevel,
  imported: VerificationLevel,
  granted: VerificationLevel,
): { level: VerificationLevel; source: VerificationProvenance } {
  const level = verificationMaxLevel(derived, imported, granted);
  if (derived === level) return { level, source: "derived" };
  if (imported === level) return { level, source: "imported" };
  return { level, source: "granted" };
}

function externalSealWouldShow(
  level: VerificationLevel,
  badgeVisible: boolean,
  enabledMethods: VerificationMethod[],
): boolean {
  return VERIFICATION_LEVEL_RANK[level] >= VERIFICATION_LEVEL_RANK.light
    && badgeVisible
    && enabledMethods.length > 0;
}

function featureRequirements(value: unknown, allowInherit: boolean): Record<VerificationFeatureKey, VerificationRequirement> | null {
  const raw = requiredObject(value, VERIFICATION_FEATURE_KEYS);
  if (!raw) return null;
  const output = Object.create(null) as Record<VerificationFeatureKey, VerificationRequirement>;
  for (const feature of VERIFICATION_FEATURE_KEYS) {
    const requirement = oneOf(raw[feature], VERIFICATION_REQUIREMENTS);
    if (!requirement || (!allowInherit && requirement === "inherit")) return null;
    output[feature] = requirement;
  }
  return output;
}

function principal(value: unknown): VerificationAdminPrincipal | null {
  const raw = requiredObject(value, ["role", "capabilities"]);
  const role = oneOf(raw?.role, ["viewer", "admin", "owner"] as const);
  const capabilities = orderedUnique(raw?.capabilities, VERIFICATION_CAPABILITIES);
  return role && capabilities ? { role, capabilities } : null;
}

export const VERIFICATION_ACTION_CAPABILITY: Record<VerificationAction, VerificationCapability> = {
  verification_console: "verification_policy_read",
  verification_policy_save_draft: "verification_policy_edit",
  verification_policy_impact_preview: "verification_policy_publish",
  verification_policy_apply: "verification_policy_publish",
  verification_copy_save: "verification_copy_edit",
  verification_copy_remove: "verification_copy_edit",
  verification_pending_settings_save: "verification_copy_edit",
  verification_badge_upload: "verification_badge_edit",
  verification_badge_remove: "verification_badge_edit",
  verification_places_city_search: "verification_policy_edit",
  verification_places_city_detail: "verification_policy_edit",
  verification_simulate: "verification_simulate",
  verification_pending_summary: "verification_pending_read",
  verification_user_detail: "verification_grant_read",
  verification_grant_preview: "verification_grant_edit",
  verification_grant_save: "verification_grant_edit",
  verification_grant_remove: "verification_grant_edit",
};

export function verificationAdminMe(value: unknown): VerificationAdminMe | null {
  const raw = requiredObject(value, ["contract_version", "contract_ready", "principal", "actions"]);
  const parsedPrincipal = principal(raw?.principal);
  const actions = orderedUnique(raw?.actions, [...VERIFICATION_ADMIN_ACTIONS].sort() as VerificationAction[]);
  if (raw?.contract_version !== 1 || typeof raw.contract_ready !== "boolean" || !parsedPrincipal || !actions
    || (!raw.contract_ready && actions.length !== 0)
    || actions.some((action) => !parsedPrincipal.capabilities.includes(VERIFICATION_ACTION_CAPABILITY[action]))) return null;
  return { contract_version: 1, contract_ready: raw.contract_ready, principal: parsedPrincipal, actions };
}

export function verificationAccess(value: unknown): VerificationAccess | null {
  const raw = requiredObject(value, ["contract_version", "contract_ready", "capabilities"]);
  const capabilities = orderedUnique(raw?.capabilities, VERIFICATION_GRANT_CAPABILITIES);
  if (raw?.contract_version !== 1 || typeof raw.contract_ready !== "boolean" || !capabilities || (!raw.contract_ready && capabilities.length !== 0)) return null;
  return { contract_version: 1, contract_ready: raw.contract_ready, capabilities };
}

export function verificationProxyCapabilityAuthorized(action: string, membership: unknown): boolean | null {
  if (!(VERIFICATION_ADMIN_ACTIONS as readonly string[]).includes(action)) return null;
  const block = verificationAdminMe(record(membership)?.verification);
  if (!block?.contract_ready || !block.actions.includes(action as VerificationAction)) return false;
  return block.principal.capabilities.includes(VERIFICATION_ACTION_CAPABILITY[action as VerificationAction]);
}

function availability(value: unknown, expected: VerificationMethod): VerificationMethodAvailability | null {
  const raw = requiredObject(value, ["method", "policy_enable_allowed", "new_start_available", "reason"]);
  const reason = nullableOneOf(raw?.reason, ["deployment_unlock_disabled", "service_config_disabled", "provider_unconfigured"] as const);
  if (raw?.method !== expected || typeof raw.policy_enable_allowed !== "boolean" || typeof raw.new_start_available !== "boolean"
    || reason === undefined || (!raw.policy_enable_allowed && raw.new_start_available)
    || (reason === null) !== raw.new_start_available) return null;
  return { method: expected, policy_enable_allowed: raw.policy_enable_allowed, new_start_available: raw.new_start_available, reason };
}

function availabilityMap(value: unknown): VerificationConsoleData["method_availability"] | null {
  const raw = requiredObject(value, VERIFICATION_METHODS);
  const video = availability(raw?.video, "video");
  const persona = availability(raw?.persona, "persona");
  return video && persona ? { video, persona } : null;
}

function verificationScope(value: unknown): VerificationScope | null {
  const raw = requiredObject(value, ["kind", "country_code", "place_id", "display"]);
  const kind = oneOf(raw?.kind, VERIFICATION_SCOPE_KINDS);
  const display = canonicalText(raw?.display, 1, 120);
  if (!kind || !display) return null;
  if (kind === "global" && raw?.country_code === null && raw.place_id === null) return { kind, country_code: null, place_id: null, display };
  const country = isoCountry(raw?.country_code);
  if (!country) return null;
  if (kind === "country" && raw?.place_id === null) return { kind, country_code: country, place_id: null, display };
  const place = placeId(raw?.place_id);
  return kind === "city" && place ? { kind, country_code: country, place_id: place, display } : null;
}

function storedBlock(value: unknown, global: boolean): VerificationStoredPolicyBlock | null {
  const raw = requiredObject(value, ["enabled_methods", "feature_requirements"]);
  const methods = raw?.enabled_methods === "inherit" ? "inherit" : methodArray(raw?.enabled_methods);
  const features = featureRequirements(raw?.feature_requirements, !global);
  return methods && features && !(global && methods === "inherit") ? { enabled_methods: methods, feature_requirements: features } : null;
}

function savedBlock(value: unknown, global: boolean): VerificationSavedPolicyBlock | null {
  const raw = requiredObject(value, ["enabled_methods", "feature_requirements", "saved_at", "saved_by"]);
  const block = storedBlock(raw && { enabled_methods: raw.enabled_methods, feature_requirements: raw.feature_requirements }, global);
  const savedAt = integer(raw?.saved_at);
  const savedBy = canonicalEmail(raw?.saved_by);
  return block && savedAt !== null && savedBy ? { ...block, saved_at: savedAt, saved_by: savedBy } : null;
}

function effectivePolicy(value: unknown): VerificationEffectivePolicy | null {
  const raw = requiredObject(value, ["enabled_methods", "enabled_methods_source_scope_key", "tier_language", "feature_requirements"]);
  const methods = methodArray(raw?.enabled_methods);
  const source = scopeKey(raw?.enabled_methods_source_scope_key);
  const featuresRaw = requiredObject(raw?.feature_requirements, VERIFICATION_FEATURE_KEYS);
  if (!methods || !source || typeof raw?.tier_language !== "boolean" || raw.tier_language !== (methods.length === 2) || !featuresRaw) return null;
  const features = Object.create(null) as VerificationEffectivePolicy["feature_requirements"];
  for (const feature of VERIFICATION_FEATURE_KEYS) {
    const row = requiredObject(featuresRaw[feature], ["configured_requirement", "required_tier", "source_scope_key"]);
    const configured = oneOf(row?.configured_requirement, VERIFICATION_EFFECTIVE_REQUIREMENTS);
    const required = oneOf(row?.required_tier, VERIFICATION_EFFECTIVE_REQUIREMENTS);
    const featureSource = scopeKey(row?.source_scope_key);
    if (!configured || !required || !featureSource || required !== clampedRequirement(configured, methods)) return null;
    features[feature] = { configured_requirement: configured, required_tier: required, source_scope_key: featureSource };
  }
  return { enabled_methods: methods, enabled_methods_source_scope_key: source, tier_language: raw.tier_language, feature_requirements: features };
}

function policy(value: unknown): VerificationPolicy | null {
  const raw = requiredObject(value, ["schema_version", "scope_key", "scope", "revision", "active", "deleted_at", "draft", "live", "effective", "updated_at", "updated_by"]);
  const key = scopeKey(raw?.scope_key);
  const parsedScope = verificationScope(raw?.scope);
  const revision = integer(raw?.revision, 1, 2_147_483_647);
  const deleted = nullableInteger(raw?.deleted_at);
  const updated = integer(raw?.updated_at);
  const updatedBy = canonicalEmail(raw?.updated_by);
  if (raw?.schema_version !== 1 || !key || !parsedScope || revision === null || typeof raw.active !== "boolean"
    || deleted === undefined || updated === null || !updatedBy) return null;
  if ((key === "global") !== (parsedScope.kind === "global")) return null;
  if (parsedScope.kind === "country" && key !== `country:${parsedScope.country_code}`) return null;
  if (parsedScope.kind === "city" && key !== `city:${parsedScope.place_id}`) return null;
  if ((key === "global" && (!raw.active || deleted !== null)) || (deleted !== null && raw.active)) return null;
  const draft = savedBlock(raw.draft, key === "global");
  const live = raw.live === null ? null : savedBlock(raw.live, key === "global");
  const effective = raw.effective === null ? null : effectivePolicy(raw.effective);
  if (!draft || (raw.live !== null && !live) || (raw.effective !== null && !effective)) return null;
  const shouldHaveEffective = raw.active && deleted === null && live !== null;
  if ((effective !== null) !== shouldHaveEffective) return null;
  if (key === "global" && (!live || !effective)) return null;
  return { schema_version: 1, scope_key: key, scope: parsedScope, revision, active: raw.active, deleted_at: deleted, draft, live, effective, updated_at: updated, updated_by: updatedBy };
}

function copyBehavior(value: unknown): VerificationCopyBehavior | null {
  const raw = requiredObject(value, ["icon", "primary_action", "primary_url", "secondary_action", "secondary_url"]);
  const icon = requiredObject(raw?.icon, ["kind", "asset_key"]);
  const assets = VERIFICATION_GATE_VARIANTS.map((variant) => `verification.${variant}`) as Array<`verification.${VerificationGateVariant}`>;
  const asset = oneOf(icon?.asset_key, assets);
  const primary = oneOf(raw?.primary_action, ["automatic", "open_verification_center", "url", "none"] as const);
  const secondary = oneOf(raw?.secondary_action, ["open_verification_center", "url", "none"] as const);
  const primaryUrl = nullableHttpsUrl(raw?.primary_url);
  const secondaryUrl = nullableHttpsUrl(raw?.secondary_url);
  if (icon?.kind !== "asset" || !asset || !primary || !secondary || primaryUrl === undefined || secondaryUrl === undefined
    || (primary === "url") !== (primaryUrl !== null) || (secondary === "url") !== (secondaryUrl !== null)) return null;
  return { icon: { kind: "asset", asset_key: asset }, primary_action: primary, primary_url: primaryUrl, secondary_action: secondary, secondary_url: secondaryUrl };
}

function localizedCopy(value: unknown): VerificationLocalizedGateCopy | null {
  const raw = requiredObject(value, ["title", "subtitle", "description", "overdue_description", "attention_note", "primary_label", "secondary_label", "cancel_label"]);
  const title = canonicalText(raw?.title, 1, 80);
  const subtitle = canonicalText(raw?.subtitle, 0, 120);
  const description = canonicalText(raw?.description, 0, 600, true);
  const overdue = nullableText(raw?.overdue_description, 1, 600, true);
  const attention = nullableText(raw?.attention_note, 1, 300, true);
  const primary = nullableText(raw?.primary_label, 1, 40);
  const secondary = nullableText(raw?.secondary_label, 1, 40);
  const cancel = canonicalText(raw?.cancel_label, 1, 40);
  return title !== null && subtitle !== null && description !== null && overdue !== undefined && attention !== undefined
    && primary !== undefined && secondary !== undefined && cancel !== null
    ? { title, subtitle, description, overdue_description: overdue, attention_note: attention, primary_label: primary, secondary_label: secondary, cancel_label: cancel }
    : null;
}

function copyMaterial(value: unknown): Pick<VerificationCopyPair, "copy_key" | "behavior" | "locales"> | null {
  const raw = requiredObject(value, ["copy_key", "behavior", "locales"]);
  const key = copyKey(raw?.copy_key);
  const behavior = copyBehavior(raw?.behavior);
  const localesRaw = requiredObject(raw?.locales, VERIFICATION_LOCALES);
  const en = localizedCopy(localesRaw?.en);
  const hu = localizedCopy(localesRaw?.hu);
  if (!key || !behavior || !en || !hu
    || behavior.icon.asset_key !== `verification.${key.slice(key.lastIndexOf(".") + 1)}`
    || (behavior.primary_action === "none") !== (en.primary_label === null)
    || (behavior.primary_action === "none") !== (hu.primary_label === null)
    || (behavior.secondary_action === "none") !== (en.secondary_label === null)
    || (behavior.secondary_action === "none") !== (hu.secondary_label === null)) return null;
  return { copy_key: key, behavior, locales: { en, hu } };
}

function copyPair(value: unknown): VerificationCopyPair | null {
  const raw = requiredObject(value, ["schema_version", "copy_key", "revision", "active", "deleted_at", "behavior", "locales", "updated_at", "updated_by"]);
  const material = copyMaterial(raw && { copy_key: raw.copy_key, behavior: raw.behavior, locales: raw.locales });
  const revision = integer(raw?.revision, 1, 2_147_483_647);
  const deleted = nullableInteger(raw?.deleted_at);
  const updated = integer(raw?.updated_at);
  const updatedBy = canonicalEmail(raw?.updated_by);
  if (raw?.schema_version !== 1 || !material || revision === null || typeof raw.active !== "boolean" || deleted === undefined
    || updated === null || !updatedBy || raw.active !== (deleted === null)) return null;
  return { schema_version: 1, ...material, revision, active: raw.active, deleted_at: deleted, updated_at: updated, updated_by: updatedBy };
}

function pendingSettings(value: unknown): VerificationPendingSettings | null {
  const raw = requiredObject(value, ["schema_version", "revision", "overdue_after_seconds", "queue_average_long_copy_enabled", "queue_average_threshold_seconds", "updated_at", "updated_by"]);
  const revision = integer(raw?.revision, 1, 2_147_483_647);
  const overdue = integer(raw?.overdue_after_seconds, 300, 86_400);
  const threshold = integer(raw?.queue_average_threshold_seconds, 300, 86_400);
  const updated = integer(raw?.updated_at);
  const updatedBy = canonicalEmail(raw?.updated_by);
  return raw?.schema_version === 1 && revision !== null && overdue !== null && threshold !== null
    && typeof raw.queue_average_long_copy_enabled === "boolean" && updated !== null && updatedBy
    ? { schema_version: 1, revision, overdue_after_seconds: overdue, queue_average_long_copy_enabled: raw.queue_average_long_copy_enabled, queue_average_threshold_seconds: threshold, updated_at: updated, updated_by: updatedBy }
    : null;
}

function badge(value: unknown): VerificationBadgeAsset | null {
  const raw = requiredObject(value, ["schema_version", "slot", "revision", "active", "deleted_at", "managed_url", "mime", "width", "height", "byte_size", "content_sha256", "updated_at", "updated_by"]);
  const slot = oneOf(raw?.slot, VERIFICATION_BADGE_SLOTS);
  const revision = integer(raw?.revision, 1, 2_147_483_647);
  const deleted = nullableInteger(raw?.deleted_at);
  const updated = integer(raw?.updated_at);
  const updatedBy = canonicalEmail(raw?.updated_by);
  if (raw?.schema_version !== 1 || !slot || revision === null || typeof raw.active !== "boolean" || deleted === undefined
    || updated === null || !updatedBy || (deleted !== null && raw.active)) return null;
  const media = [raw.managed_url, raw.mime, raw.width, raw.height, raw.byte_size, raw.content_sha256];
  if (raw.managed_url === null) {
    if (raw.active || media.some((entry) => entry !== null)) return null;
    return { schema_version: 1, slot, revision, active: raw.active, deleted_at: deleted, managed_url: null, mime: null, width: null, height: null, byte_size: null, content_sha256: null, updated_at: updated, updated_by: updatedBy };
  }
  const url = safeHttpsUrl(raw.managed_url, true);
  const width = integer(raw.width, 16, 2_048);
  const height = integer(raw.height, 16, 2_048);
  const bytes = integer(raw.byte_size, 1, MAX_VERIFICATION_BADGE_BYTES);
  const hash = sha256(raw.content_sha256);
  return raw.active && deleted === null && url && raw.mime === "image/png" && width !== null && width === height && bytes !== null && hash
    ? { schema_version: 1, slot, revision, active: raw.active, deleted_at: deleted, managed_url: url, mime: "image/png", width, height, byte_size: bytes, content_sha256: hash, updated_at: updated, updated_by: updatedBy }
    : null;
}

function activationGuard(value: unknown): VerificationActivationGuard | null {
  const raw = requiredObject(value, ["non_none_publish_ready", "blocking_reasons"]);
  const reasons = orderedUnique(raw?.blocking_reasons, ["global_policy_invalid", "method_unavailable", "persona_force_receipt_unready", "supported_client_unready"] as const);
  return typeof raw?.non_none_publish_ready === "boolean" && reasons
    && raw.non_none_publish_ready === (reasons.length === 0)
    ? { non_none_publish_ready: raw.non_none_publish_ready, blocking_reasons: reasons }
    : null;
}

function policyOrder(rows: VerificationPolicy[]): boolean {
  const rank: Record<VerificationScopeKind, number> = { global: 0, country: 1, city: 2 };
  if (new Set(rows.map((row) => row.scope_key)).size !== rows.length) return false;
  return rows.every((current, index) => {
    if (index === 0) return true;
    const previous = rows[index - 1];
    const comparison = rank[previous.scope.kind] - rank[current.scope.kind]
      || previous.scope.display.localeCompare(current.scope.display)
      || previous.scope_key.localeCompare(current.scope_key);
    return comparison < 0;
  });
}

function consoleData(value: unknown): VerificationConsoleData | null {
  const raw = requiredObject(value, ["contract_version", "principal", "evaluated_at", "feature_keys", "method_availability", "policies", "next_cursor", "total_policies", "copy_pairs", "pending_settings", "badges", "import_health", "activation_guard"]);
  const parsedPrincipal = principal(raw?.principal);
  const evaluated = integer(raw?.evaluated_at);
  const features = exactCanonical(raw?.feature_keys, VERIFICATION_FEATURE_KEYS);
  const methods = availabilityMap(raw?.method_availability);
  const total = integer(raw?.total_policies);
  const cursor = raw?.next_cursor === null ? null : opaque(raw?.next_cursor, 256);
  const settings = pendingSettings(raw?.pending_settings);
  const guard = activationGuard(raw?.activation_guard);
  if (raw?.contract_version !== 1 || !parsedPrincipal || evaluated === null || !features || !methods || total === null
    || cursor === undefined || !settings || !guard || !Array.isArray(raw.policies) || !Array.isArray(raw.copy_pairs) || !Array.isArray(raw.badges)) return null;
  const policies = raw.policies.map(policy);
  const copies = raw.copy_pairs.map(copyPair);
  const badgeRows = raw.badges.map(badge);
  if (policies.some((row) => row === null) || copies.some((row) => row === null) || badgeRows.some((row) => row === null)) return null;
  const parsedPolicies = policies as VerificationPolicy[];
  const parsedCopies = copies as VerificationCopyPair[];
  const parsedBadges = badgeRows as VerificationBadgeAsset[];
  if (!policyOrder(parsedPolicies) || parsedCopies.length > 55 || new Set(parsedCopies.map((row) => row.copy_key)).size !== parsedCopies.length
    || parsedCopies.some((row, index) => index > 0 && parsedCopies[index - 1].copy_key.localeCompare(row.copy_key) >= 0)
    || parsedBadges.length !== 3 || !VERIFICATION_BADGE_SLOTS.every((slot, index) => parsedBadges[index].slot === slot)) return null;
  for (const variant of VERIFICATION_GATE_VARIANTS) {
    const required = parsedCopies.find((row) => row.copy_key === `default.${variant}`);
    if (!required?.active || required.deleted_at !== null) return null;
  }
  if (parsedPolicies.length > total || (total === 0 && (parsedPolicies.length !== 0 || cursor !== null))) return null;
  const health = requiredObject(raw.import_health, ["evaluated_at", "total", "invalid"]);
  const healthAt = integer(health?.evaluated_at);
  const healthTotal = integer(health?.total);
  const healthInvalid = integer(health?.invalid);
  if (healthAt === null || healthAt !== evaluated || healthTotal === null || healthInvalid === null || healthInvalid > healthTotal) return null;
  return {
    contract_version: 1,
    principal: parsedPrincipal,
    evaluated_at: evaluated,
    feature_keys: features,
    method_availability: methods,
    policies: parsedPolicies,
    next_cursor: cursor,
    total_policies: total,
    copy_pairs: parsedCopies,
    pending_settings: settings,
    badges: parsedBadges as VerificationConsoleData["badges"],
    import_health: { evaluated_at: healthAt, total: healthTotal, invalid: healthInvalid },
    activation_guard: guard,
  };
}

function successData<T>(value: unknown, parse: (data: unknown) => T | null): T | null {
  const envelope = webadminDataSuccessEnvelope(value);
  return envelope ? parse(envelope.data) : null;
}

export function verificationConsoleResponse(value: unknown): VerificationConsoleData | null { return successData(value, consoleData); }

function mutationBase(value: unknown, materialKey: string): { principal: VerificationAdminPrincipal; material: unknown; replayed: boolean } | null {
  const raw = requiredObject(value, ["contract_version", "principal", materialKey, "replayed"]);
  const parsedPrincipal = principal(raw?.principal);
  return raw?.contract_version === 1 && parsedPrincipal && typeof raw.replayed === "boolean"
    ? { principal: parsedPrincipal, material: raw[materialKey], replayed: raw.replayed }
    : null;
}

export function verificationPolicyMutationResponse(value: unknown): VerificationPolicyMutationData | null {
  return successData(value, (data) => {
    const base = mutationBase(data, "policy");
    const parsed = policy(base?.material);
    return base && parsed ? { contract_version: 1, principal: base.principal, policy: parsed, replayed: base.replayed } : null;
  });
}

function featureImpact(value: unknown, expected: VerificationFeatureKey): VerificationFeatureImpact | null {
  const raw = requiredObject(value, ["feature", "configured_before", "configured_after", "effective_before", "effective_after", "affected_members", "newly_blocked", "newly_unblocked"]);
  const configuredBefore = oneOf(raw?.configured_before, VERIFICATION_EFFECTIVE_REQUIREMENTS);
  const configuredAfter = oneOf(raw?.configured_after, VERIFICATION_EFFECTIVE_REQUIREMENTS);
  const effectiveBefore = oneOf(raw?.effective_before, VERIFICATION_EFFECTIVE_REQUIREMENTS);
  const effectiveAfter = oneOf(raw?.effective_after, VERIFICATION_EFFECTIVE_REQUIREMENTS);
  const affected = integer(raw?.affected_members);
  const blocked = integer(raw?.newly_blocked);
  const unblocked = integer(raw?.newly_unblocked);
  return raw?.feature === expected && configuredBefore && configuredAfter && effectiveBefore && effectiveAfter
    && affected !== null && blocked !== null && unblocked !== null && blocked <= affected && unblocked <= affected
    ? { feature: expected, configured_before: configuredBefore, configured_after: configuredAfter, effective_before: effectiveBefore, effective_after: effectiveAfter, affected_members: affected, newly_blocked: blocked, newly_unblocked: unblocked }
    : null;
}

export function verificationPolicyImpactPreviewResponse(value: unknown): VerificationPolicyImpactPreviewData | null {
  return successData(value, (data) => {
    const raw = requiredObject(data, ["contract_version", "principal", "evaluated_at", "scope_key", "operation", "expected_revision", "normalized_fingerprint", "confirmation_phrase", "method_availability", "activation_guard", "impact"]);
    const parsedPrincipal = principal(raw?.principal);
    const evaluated = integer(raw?.evaluated_at);
    const key = scopeKey(raw?.scope_key);
    const operation = oneOf(raw?.operation, VERIFICATION_POLICY_OPERATIONS);
    const revision = integer(raw?.expected_revision, 1, 2_147_483_647);
    const fingerprint = sha256(raw?.normalized_fingerprint);
    const methods = availabilityMap(raw?.method_availability);
    const guard = activationGuard(raw?.activation_guard);
    const impact = requiredObject(raw?.impact, ["members_evaluated", "members_changed", "newly_blocked", "newly_unblocked", "descendant_scope_count", "features"]);
    const membersEvaluated = integer(impact?.members_evaluated);
    const membersChanged = integer(impact?.members_changed);
    const newlyBlocked = integer(impact?.newly_blocked);
    const newlyUnblocked = integer(impact?.newly_unblocked);
    const descendants = integer(impact?.descendant_scope_count);
    if (raw?.contract_version !== 1 || !parsedPrincipal || evaluated === null || !key || !operation || revision === null || !fingerprint
      || raw.confirmation_phrase !== `${operation.toUpperCase()} ${key}` || !methods || !guard || membersEvaluated === null
      || membersChanged === null || newlyBlocked === null || newlyUnblocked === null || descendants === null
      || membersChanged > membersEvaluated || newlyBlocked > membersEvaluated || newlyUnblocked > membersEvaluated
      || !Array.isArray(impact?.features) || impact.features.length !== VERIFICATION_FEATURE_KEYS.length) return null;
    const impactFeatures = impact.features as unknown[];
    const features = VERIFICATION_FEATURE_KEYS.map((feature, index) => featureImpact(impactFeatures[index], feature));
    if (features.some((row) => row === null)) return null;
    return { contract_version: 1, principal: parsedPrincipal, evaluated_at: evaluated, scope_key: key, operation, expected_revision: revision, normalized_fingerprint: fingerprint, confirmation_phrase: raw.confirmation_phrase, method_availability: methods, activation_guard: guard, impact: { members_evaluated: membersEvaluated, members_changed: membersChanged, newly_blocked: newlyBlocked, newly_unblocked: newlyUnblocked, descendant_scope_count: descendants, features: features as VerificationFeatureImpact[] } };
  });
}

export function verificationCopyMutationResponse(value: unknown): VerificationCopyMutationData | null {
  return successData(value, (data) => { const base = mutationBase(data, "copy_pair"); const parsed = copyPair(base?.material); return base && parsed ? { contract_version: 1, principal: base.principal, copy_pair: parsed, replayed: base.replayed } : null; });
}
export function verificationPendingSettingsMutationResponse(value: unknown): VerificationPendingSettingsMutationData | null {
  return successData(value, (data) => { const base = mutationBase(data, "pending_settings"); const parsed = pendingSettings(base?.material); return base && parsed ? { contract_version: 1, principal: base.principal, pending_settings: parsed, replayed: base.replayed } : null; });
}
export function verificationBadgeMutationResponse(value: unknown): VerificationBadgeMutationData | null {
  return successData(value, (data) => { const base = mutationBase(data, "badge"); const parsed = badge(base?.material); return base && parsed ? { contract_version: 1, principal: base.principal, badge: parsed, replayed: base.replayed } : null; });
}

function citySuggestion(value: unknown): VerificationCitySuggestion | null {
  const raw = requiredObject(value, ["place_id", "display", "secondary", "country_code"]);
  const place = placeId(raw?.place_id);
  const display = canonicalText(raw?.display, 1, 120);
  const secondary = canonicalText(raw?.secondary, 0, 120);
  const country = isoCountry(raw?.country_code);
  return place && display && secondary !== null && country ? { place_id: place, display, secondary, country_code: country } : null;
}

export function verificationCitySearchResponse(value: unknown): VerificationCitySearchData | null {
  return successData(value, (data) => {
    const raw = requiredObject(data, ["contract_version", "principal", "search_token", "suggestions"]);
    const parsedPrincipal = principal(raw?.principal);
    const token = requestId(raw?.search_token);
    if (raw?.contract_version !== 1 || !parsedPrincipal || !token || !Array.isArray(raw.suggestions) || raw.suggestions.length > 10) return null;
    const suggestions = raw.suggestions.map(citySuggestion);
    if (suggestions.some((row) => row === null) || new Set(suggestions.map((row) => row?.place_id)).size !== suggestions.length) return null;
    return { contract_version: 1, principal: parsedPrincipal, search_token: token, suggestions: suggestions as VerificationCitySuggestion[] };
  });
}

export function verificationCityDetailResponse(value: unknown): VerificationCityDetailData | null {
  return successData(value, (data) => {
    const raw = requiredObject(data, ["contract_version", "principal", "city"]);
    const parsedPrincipal = principal(raw?.principal);
    const city = requiredObject(raw?.city, ["scope_key", "kind", "place_id", "display", "country_code", "place_token", "expires_at"]);
    const key = scopeKey(city?.scope_key);
    const place = placeId(city?.place_id);
    const display = canonicalText(city?.display, 1, 120);
    const country = isoCountry(city?.country_code);
    const token = opaque(city?.place_token, 512);
    const expires = integer(city?.expires_at, 1, 2_147_483_647);
    return raw?.contract_version === 1 && parsedPrincipal && city?.kind === "city" && place && key === `city:${place}` && display && country && token && expires !== null
      ? { contract_version: 1, principal: parsedPrincipal, city: { scope_key: key, kind: "city", place_id: place, display, country_code: country, place_token: token, expires_at: expires } }
      : null;
  });
}

function simulationMethod(value: unknown, personaMethod: boolean): VerificationSimulationMethod | null {
  const raw = requiredObject(value, ["status", "pending_age_seconds", "attempt", "retry_available"]);
  if (!raw) return null;
  const status = oneOf(raw?.status, VERIFICATION_METHOD_STATUSES);
  const pendingAge = nullableInteger(raw?.pending_age_seconds, 0, 2_592_000);
  const attempt = nullableInteger(raw?.attempt, 1, personaMethod ? 2_147_483_647 : 5);
  if (!status || pendingAge === undefined || attempt === undefined || typeof raw.retry_available !== "boolean" || (status === "pending") !== (pendingAge !== null)) return null;
  return { status, pending_age_seconds: pendingAge, attempt, retry_available: raw.retry_available };
}

function simulationInput(value: unknown): VerificationSimulationInput | null {
  const raw = requiredObject(value, ["video", "persona", "imported_level", "imported_method_hint", "grant_level", "badge_visible"]);
  if (!raw) return null;
  const video = simulationMethod(raw?.video, false);
  const persona = simulationMethod(raw?.persona, true);
  const imported = oneOf(raw?.imported_level, VERIFICATION_LEVELS);
  const hint = nullableOneOf(raw?.imported_method_hint, ["video", "persona", "manual"] as const);
  const grant = oneOf(raw?.grant_level, VERIFICATION_LEVELS);
  if (!video || !persona || !imported || hint === undefined || !grant || typeof raw.badge_visible !== "boolean" || (imported === "none") !== (hint === null)) return null;
  return { video, persona, imported_level: imported, imported_method_hint: hint, grant_level: grant, badge_visible: raw.badge_visible };
}

function modalAction(value: unknown): VerificationModalAction | null {
  const raw = requiredObject(value, ["kind", "label", "url"]);
  const kind = oneOf(raw?.kind, ["start_video", "start_persona", "open_verification_center", "url"] as const);
  const label = canonicalText(raw?.label, 1, 40);
  const url = nullableHttpsUrl(raw?.url);
  return kind && label && url !== undefined && (kind === "url") === (url !== null) ? { kind, label, url } : null;
}

function modal(value: unknown): VerificationModal | null {
  const raw = requiredObject(value, ["kind", "icon", "steps", "current_step", "title", "subtitle", "description", "attention_note", "reason", "attempt", "max_attempts", "manual_review_available", "primary_action", "secondary_action", "cancel_label", "provider_attribution"]);
  if (!raw) return null;
  const kind = oneOf(raw?.kind, VERIFICATION_GATE_VARIANTS);
  const icon = requiredObject(raw?.icon, ["kind", "asset_key"]);
  const asset = oneOf(icon?.asset_key, VERIFICATION_GATE_VARIANTS.map((variant) => `verification.${variant}`) as Array<`verification.${VerificationGateVariant}`>);
  const title = canonicalText(raw?.title, 1, 80);
  const subtitle = canonicalText(raw?.subtitle, 0, 120);
  const description = canonicalText(raw?.description, 0, 600, true);
  const attention = nullableText(raw?.attention_note, 1, 300, true);
  const reason = nullableText(raw?.reason, 1, 300, true);
  const attempt = nullableInteger(raw?.attempt, 1);
  const maximum = nullableInteger(raw?.max_attempts, 1);
  const current = nullableInteger(raw?.current_step, 1, 2);
  const primary = raw?.primary_action === null ? null : modalAction(raw?.primary_action);
  const secondary = raw?.secondary_action === null ? null : modalAction(raw?.secondary_action);
  const cancel = canonicalText(raw?.cancel_label, 1, 40);
  const provider = nullableText(raw?.provider_attribution, 1, 80);
  if (!kind || icon?.kind !== "asset" || asset !== `verification.${kind}` || !title || subtitle === null || description === null
    || attention === undefined || reason === undefined || attempt === undefined || maximum === undefined || current === undefined
    || (raw.primary_action !== null && !primary) || (raw.secondary_action !== null && !secondary) || !cancel || provider === undefined
    || typeof raw.manual_review_available !== "boolean" || !Array.isArray(raw.steps) || raw.steps.length < 1 || raw.steps.length > 2) return null;
  const steps: VerificationModal["steps"] = [];
  for (let index = 0; index < raw.steps.length; index += 1) {
    const step = requiredObject(raw.steps[index], ["position", "method", "state"]);
    const method = oneOf(step?.method, VERIFICATION_METHODS);
    const state = oneOf(step?.state, ["complete", "current", "upcoming"] as const);
    if (step?.position !== index + 1 || !method || !state || steps.some((row) => row.method === method)) return null;
    steps.push({ position: index + 1, method, state });
  }
  const currentSteps = steps.filter((step) => step.state === "current");
  if (currentSteps.length > 1 || (current === null) !== (currentSteps.length === 0) || (current !== null && currentSteps[0]?.position !== current)
    || (kind === "pending" && [primary, secondary].some((action) => action?.kind.startsWith("start_"))) || (attempt === null) !== (maximum === null)
    || (attempt !== null && maximum !== null && attempt > maximum)) return null;
  return { kind, icon: { kind: "asset", asset_key: asset }, steps, current_step: current, title, subtitle, description, attention_note: attention, reason, attempt, max_attempts: maximum, manual_review_available: raw.manual_review_available, primary_action: primary, secondary_action: secondary, cancel_label: cancel, provider_attribution: provider };
}

function simulatedFeature(value: unknown, expected: VerificationFeatureKey): VerificationSimulatedFeatureAccess | null {
  const raw = requiredObject(value, ["feature", "configured_requirement", "required_tier", "allowed", "missing_methods", "next_method", "copy_key", "modal"]);
  const configured = oneOf(raw?.configured_requirement, VERIFICATION_EFFECTIVE_REQUIREMENTS);
  const required = oneOf(raw?.required_tier, VERIFICATION_EFFECTIVE_REQUIREMENTS);
  const missing = methodArray(raw?.missing_methods);
  const next = nullableOneOf(raw?.next_method, VERIFICATION_METHODS);
  const key = raw?.copy_key === null ? null : copyKey(raw?.copy_key) ?? undefined;
  const parsedModal = raw?.modal === null ? null : modal(raw?.modal);
  if (raw?.feature !== expected || !configured || !required || typeof raw.allowed !== "boolean" || !missing || next === undefined || key === undefined || (raw.modal !== null && !parsedModal)) return null;
  if ((raw.allowed && (missing.length !== 0 || next !== null || key !== null || parsedModal !== null)) || (!raw.allowed && (key === null || parsedModal === null))) return null;
  return { feature: expected, configured_requirement: configured, required_tier: required, allowed: raw.allowed, missing_methods: missing, next_method: next, copy_key: key, modal: parsedModal };
}

export function verificationSimulationResponse(value: unknown): VerificationSimulationData | null {
  return successData(value, (data) => {
    const raw = requiredObject(data, ["contract_version", "principal", "evaluated_at", "scope", "enabled_methods", "startable_methods", "tier_language", "method_statuses", "derived_level", "imported_level", "granted_level", "effective_level", "effective_source", "external_seal_would_show", "feature_access"]);
    const parsedPrincipal = principal(raw?.principal);
    const evaluated = integer(raw?.evaluated_at);
    const parsedScope = verificationScope(raw?.scope);
    const enabled = methodArray(raw?.enabled_methods);
    const startable = methodArray(raw?.startable_methods);
    const statuses = requiredObject(raw?.method_statuses, VERIFICATION_METHODS);
    const video = oneOf(statuses?.video, VERIFICATION_METHOD_STATUSES);
    const personaStatus = oneOf(statuses?.persona, VERIFICATION_METHOD_STATUSES);
    const derived = oneOf(raw?.derived_level, VERIFICATION_LEVELS);
    const imported = oneOf(raw?.imported_level, VERIFICATION_LEVELS);
    const granted = oneOf(raw?.granted_level, VERIFICATION_LEVELS);
    const effective = oneOf(raw?.effective_level, VERIFICATION_LEVELS);
    const source = oneOf(raw?.effective_source, VERIFICATION_PROVENANCE);
    const expectedDerived = video && personaStatus
      ? derivedLevelFromStatuses({ video, persona: personaStatus })
      : null;
    const expectedEffective = derived && imported && granted
      ? effectiveLevelAndSource(derived, imported, granted)
      : null;
    if (raw?.contract_version !== 1 || !parsedPrincipal || evaluated === null || !parsedScope || !enabled || !startable || startable.some((method) => !enabled.includes(method))
      || typeof raw.tier_language !== "boolean" || raw.tier_language !== (enabled.length === 2) || !video || !personaStatus || !derived || !imported
      || !granted || !effective || !source || typeof raw.external_seal_would_show !== "boolean" || !Array.isArray(raw.feature_access)
      || raw.feature_access.length !== VERIFICATION_FEATURE_KEYS.length || derived !== expectedDerived
      || effective !== expectedEffective?.level || source !== expectedEffective?.source
      || (raw.external_seal_would_show && !externalSealWouldShow(effective, true, enabled))) return null;
    const featureAccess = raw.feature_access as unknown[];
    const access = VERIFICATION_FEATURE_KEYS.map((feature, index) => simulatedFeature(featureAccess[index], feature));
    if (access.some((row) => row === null)) return null;
    for (const row of access as VerificationSimulatedFeatureAccess[]) {
      if (row.required_tier !== clampedRequirement(row.configured_requirement, enabled)
        || row.allowed !== (VERIFICATION_LEVEL_RANK[effective] >= VERIFICATION_LEVEL_RANK[row.required_tier])) return null;
    }
    return { contract_version: 1, principal: parsedPrincipal, evaluated_at: evaluated, scope: parsedScope, enabled_methods: enabled, startable_methods: startable, tier_language: raw.tier_language, method_statuses: { video, persona: personaStatus }, derived_level: derived, imported_level: imported, granted_level: granted, effective_level: effective, effective_source: source, external_seal_would_show: raw.external_seal_would_show, feature_access: access as VerificationSimulatedFeatureAccess[] };
  });
}

function pendingMethodSummary(value: unknown, expected: VerificationMethod): VerificationPendingMethodSummary | null {
  const raw = requiredObject(value, ["method", "total", "in_sla", "overdue", "average_wait_seconds", "oldest_pending_at"]);
  const total = integer(raw?.total);
  const inSla = integer(raw?.in_sla);
  const overdue = integer(raw?.overdue);
  const average = nullableInteger(raw?.average_wait_seconds);
  const oldest = nullableInteger(raw?.oldest_pending_at);
  return raw?.method === expected && total !== null && inSla !== null && overdue !== null && inSla + overdue === total && average !== undefined && oldest !== undefined
    ? { method: expected, total, in_sla: inSla, overdue, average_wait_seconds: average, oldest_pending_at: oldest }
    : null;
}

export function verificationPendingSummaryResponse(value: unknown): VerificationPendingSummaryData | null {
  return successData(value, (data) => {
    const raw = requiredObject(data, ["contract_version", "principal", "evaluated_at", "total", "in_sla", "overdue", "average_wait_seconds", "methods"]);
    const parsedPrincipal = principal(raw?.principal);
    const evaluated = integer(raw?.evaluated_at);
    const total = integer(raw?.total);
    const inSla = integer(raw?.in_sla);
    const overdue = integer(raw?.overdue);
    const average = nullableInteger(raw?.average_wait_seconds);
    if (raw?.contract_version !== 1 || !parsedPrincipal || evaluated === null || total === null || inSla === null || overdue === null || inSla + overdue !== total
      || average === undefined || !Array.isArray(raw.methods) || raw.methods.length !== 2) return null;
    const video = pendingMethodSummary(raw.methods[0], "video");
    const persona = pendingMethodSummary(raw.methods[1], "persona");
    return video && persona && video.total + persona.total === total && video.in_sla + persona.in_sla === inSla && video.overdue + persona.overdue === overdue
      ? { contract_version: 1, principal: parsedPrincipal, evaluated_at: evaluated, total, in_sla: inSla, overdue, average_wait_seconds: average, methods: [video, persona] }
      : null;
  });
}

function adminMethod(value: unknown, method: VerificationMethod): VerificationAdminMethodProjection | null {
  const raw = requiredObject(value, ["status", "raw_video_status", "can_start", "pending_phase", "pending_since", "member_safe_reason", "attempt", "max_attempts", "manual_review_available", "state_integrity"]);
  if (!raw) return null;
  const status = oneOf(raw?.status, VERIFICATION_METHOD_STATUSES);
  const videoRaw = nullableOneOf(raw?.raw_video_status, ["not_started", "missing_requirements", "pending", "verified", "pending_re_review", "awaiting_avatar", "rejected", "new_video_requested"] as const);
  const phase = nullableOneOf(raw?.pending_phase, ["in_sla", "overdue"] as const);
  const pendingSince = nullableInteger(raw?.pending_since);
  const reason = nullableText(raw?.member_safe_reason, 1, 300, true);
  const attempt = nullableInteger(raw?.attempt, 1);
  const maximum = nullableInteger(raw?.max_attempts, 1);
  if (!status || videoRaw === undefined || (method === "persona" && videoRaw !== null) || phase === undefined || pendingSince === undefined || reason === undefined
    || attempt === undefined || maximum === undefined || typeof raw.can_start !== "boolean" || typeof raw.manual_review_available !== "boolean"
    || typeof raw.state_integrity !== "boolean" || (status !== "pending" && (phase !== null || pendingSince !== null))
    || (attempt === null) !== (maximum === null) || (attempt !== null && maximum !== null && attempt > maximum)) return null;
  return { status, raw_video_status: videoRaw, can_start: raw.can_start, pending_phase: phase, pending_since: pendingSince, member_safe_reason: reason, attempt, max_attempts: maximum, manual_review_available: raw.manual_review_available, state_integrity: raw.state_integrity };
}

function grant(value: unknown): VerificationGrant | null {
  const raw = requiredObject(value, ["level", "reason", "granted_by", "granted_at", "expires_at", "revision", "status", "evaluated_at"]);
  const level = oneOf(raw?.level, ["light", "strong"] as const);
  const reason = canonicalText(raw?.reason, 1, 300, true);
  const actor = canonicalEmail(raw?.granted_by);
  const grantedAt = integer(raw?.granted_at);
  const expires = nullableInteger(raw?.expires_at, 1, 2_147_483_647);
  const revision = integer(raw?.revision, 1, 2_147_483_647);
  const status = oneOf(raw?.status, ["active", "expired"] as const);
  const evaluated = integer(raw?.evaluated_at);
  if (!level || !reason || !actor || grantedAt === null || expires === undefined || revision === null || !status || evaluated === null
    || ((expires === null || expires > evaluated) !== (status === "active"))) return null;
  return { level, reason, granted_by: actor, granted_at: grantedAt, expires_at: expires, revision, status, evaluated_at: evaluated };
}

function userProjection(value: unknown): VerificationUserProjection | null {
  const raw = requiredObject(value, ["schema_version", "uid", "display_name", "evaluated_at", "scope", "enabled_methods", "startable_methods", "tier_language", "methods", "badge_visible", "derived_level", "imported", "import_integrity", "grant", "grant_revision", "effective_level", "effective_source", "external_seal_would_show", "feature_access"]);
  const uid = integer(raw?.uid, 1, 2_147_483_647);
  const display = canonicalText(raw?.display_name, 0, 100);
  const evaluated = integer(raw?.evaluated_at);
  const scopeRaw = requiredObject(raw?.scope, ["kind", "country_code", "place_id", "display", "scope_key", "source"]);
  const parsedScope = verificationScope(scopeRaw && { kind: scopeRaw.kind, country_code: scopeRaw.country_code, place_id: scopeRaw.place_id, display: scopeRaw.display });
  const key = scopeKey(scopeRaw?.scope_key);
  const scopeSource = oneOf(scopeRaw?.source, ["current_location", "registration_country", "ip_country", "global"] as const);
  const enabled = methodArray(raw?.enabled_methods);
  const startable = methodArray(raw?.startable_methods);
  const methodsRaw = requiredObject(raw?.methods, VERIFICATION_METHODS);
  const video = adminMethod(methodsRaw?.video, "video");
  const personaMethod = adminMethod(methodsRaw?.persona, "persona");
  const derived = oneOf(raw?.derived_level, VERIFICATION_LEVELS);
  const integrity = oneOf(raw?.import_integrity, ["absent", "valid", "invalid"] as const);
  const parsedGrant = raw?.grant === null ? null : grant(raw?.grant);
  const grantRevision = integer(raw?.grant_revision, 0, 2_147_483_647);
  const effective = oneOf(raw?.effective_level, VERIFICATION_LEVELS);
  const effectiveSource = oneOf(raw?.effective_source, VERIFICATION_PROVENANCE);
  if (raw?.schema_version !== 1 || uid === null || display === null || evaluated === null || !parsedScope || !key || !scopeSource || !enabled || !startable
    || startable.some((method) => !enabled.includes(method)) || typeof raw.tier_language !== "boolean" || raw.tier_language !== (enabled.length === 2)
    || !video || !personaMethod || typeof raw.badge_visible !== "boolean" || !derived || !integrity || (raw.grant !== null && !parsedGrant)
    || grantRevision === null || !effective || !effectiveSource || typeof raw.external_seal_would_show !== "boolean"
    || !Array.isArray(raw.feature_access) || raw.feature_access.length !== VERIFICATION_FEATURE_KEYS.length) return null;
  if ((parsedScope.kind === "global" && key !== "global")
    || (parsedScope.kind === "country" && key !== `country:${parsedScope.country_code}`)
    || (parsedScope.kind === "city" && key !== `city:${parsedScope.place_id}`)) return null;
  let imported: VerificationUserProjection["imported"] = null;
  if (raw.imported !== null) {
    const row = requiredObject(raw.imported, ["level", "method_hint", "imported_from", "imported_at"]);
    const level = oneOf(row?.level, ["light", "strong"] as const);
    const hint = oneOf(row?.method_hint, ["persona", "video", "manual"] as const);
    const importedAt = integer(row?.imported_at);
    const expectedImportedLevel = hint === "persona" ? "strong" : "light";
    if (!level || !hint || level !== expectedImportedLevel || row?.imported_from !== "apifriending" || importedAt === null || integrity !== "valid") return null;
    imported = { level, method_hint: hint, imported_from: "apifriending", imported_at: importedAt };
  } else if (integrity === "valid") return null;
  if (parsedGrant !== null && (parsedGrant.revision !== grantRevision
    || parsedGrant.evaluated_at !== evaluated
    || parsedGrant.granted_at > evaluated)) return null;
  const expectedStartable = VERIFICATION_METHODS.filter((method) => (
    enabled.includes(method) && (method === "video" ? video : personaMethod).can_start
  ));
  if (startable.length !== expectedStartable.length
    || startable.some((method, index) => method !== expectedStartable[index])) return null;
  const access: VerificationUserProjection["feature_access"] = [];
  for (let index = 0; index < VERIFICATION_FEATURE_KEYS.length; index += 1) {
    const row = requiredObject(raw.feature_access[index], ["feature", "configured_requirement", "required_tier", "allowed"]);
    const configured = oneOf(row?.configured_requirement, VERIFICATION_EFFECTIVE_REQUIREMENTS);
    const required = oneOf(row?.required_tier, VERIFICATION_EFFECTIVE_REQUIREMENTS);
    if (row?.feature !== VERIFICATION_FEATURE_KEYS[index] || !configured || !required || typeof row.allowed !== "boolean") return null;
    access.push({ feature: VERIFICATION_FEATURE_KEYS[index], configured_requirement: configured, required_tier: required, allowed: row.allowed });
  }
  const expectedDerived = derivedLevelFromStatuses({ video: video.status, persona: personaMethod.status });
  const importedLevel = imported?.level ?? "none";
  const grantedLevel = parsedGrant?.status === "active" ? parsedGrant.level : "none";
  const expectedEffective = effectiveLevelAndSource(expectedDerived, importedLevel, grantedLevel);
  if (derived !== expectedDerived || effective !== expectedEffective.level || effectiveSource !== expectedEffective.source
    || raw.external_seal_would_show !== externalSealWouldShow(effective, raw.badge_visible, enabled)) return null;
  for (const row of access) {
    if (row.required_tier !== clampedRequirement(row.configured_requirement, enabled)
      || row.allowed !== (VERIFICATION_LEVEL_RANK[effective] >= VERIFICATION_LEVEL_RANK[row.required_tier])) return null;
  }
  return { schema_version: 1, uid, display_name: display, evaluated_at: evaluated, scope: { ...parsedScope, scope_key: key, source: scopeSource }, enabled_methods: enabled, startable_methods: startable, tier_language: raw.tier_language, methods: { video, persona: personaMethod }, badge_visible: raw.badge_visible, derived_level: derived, imported, import_integrity: integrity, grant: parsedGrant, grant_revision: grantRevision, effective_level: effective, effective_source: effectiveSource, external_seal_would_show: raw.external_seal_would_show, feature_access: access };
}

export function verificationUserDetailResponse(value: unknown): VerificationUserDetailData | null {
  return successData(value, (data) => {
    const raw = requiredObject(data, ["contract_version", "principal", "verification"]);
    const parsedPrincipal = principal(raw?.principal);
    const verification = userProjection(raw?.verification);
    return raw?.contract_version === 1 && parsedPrincipal && verification ? { contract_version: 1, principal: parsedPrincipal, verification } : null;
  });
}

export function verificationGrantPreviewResponse(value: unknown): VerificationGrantPreviewData | null {
  return successData(value, (data) => {
    const raw = requiredObject(data, ["contract_version", "principal", "evaluated_at", "current", "preview"]);
    const parsedPrincipal = principal(raw?.principal);
    const evaluated = integer(raw?.evaluated_at);
    const current = userProjection(raw?.current);
    const preview = requiredObject(raw?.preview, ["granted_level", "effective_level", "effective_source", "external_seal_would_show", "changes_effective_level", "newly_allowed_features", "still_blocked_features", "strong_grant_warning"]);
    const granted = oneOf(preview?.granted_level, ["light", "strong"] as const);
    const effective = oneOf(preview?.effective_level, VERIFICATION_LEVELS);
    const source = oneOf(preview?.effective_source, VERIFICATION_PROVENANCE);
    const newly = orderedUnique(preview?.newly_allowed_features, VERIFICATION_FEATURE_KEYS);
    const blocked = orderedUnique(preview?.still_blocked_features, VERIFICATION_FEATURE_KEYS);
    const expected = current && granted
      ? effectiveLevelAndSource(
        current.derived_level,
        current.imported?.level ?? "none",
        granted,
      )
      : null;
    if (raw?.contract_version !== 1 || !parsedPrincipal || evaluated === null || !current || current.evaluated_at !== evaluated || !granted || !effective || !source
      || typeof preview?.external_seal_would_show !== "boolean" || typeof preview.changes_effective_level !== "boolean" || !newly || !blocked
      || typeof preview.strong_grant_warning !== "boolean" || preview.strong_grant_warning !== (granted === "strong")
      || effective !== expected?.level || source !== expected?.source
      || preview.changes_effective_level !== (effective !== current.effective_level)
      || preview.external_seal_would_show !== externalSealWouldShow(effective, current.badge_visible, current.enabled_methods)
      || newly.some((feature) => blocked.includes(feature))) return null;
    const expectedNewly = current.feature_access
      .filter((row) => !row.allowed && VERIFICATION_LEVEL_RANK[effective] >= VERIFICATION_LEVEL_RANK[row.required_tier])
      .map((row) => row.feature);
    const expectedBlocked = current.feature_access
      .filter((row) => VERIFICATION_LEVEL_RANK[effective] < VERIFICATION_LEVEL_RANK[row.required_tier])
      .map((row) => row.feature);
    if (newly.length !== expectedNewly.length || newly.some((feature, index) => feature !== expectedNewly[index])
      || blocked.length !== expectedBlocked.length || blocked.some((feature, index) => feature !== expectedBlocked[index])) return null;
    return { contract_version: 1, principal: parsedPrincipal, evaluated_at: evaluated, current, preview: { granted_level: granted, effective_level: effective, effective_source: source, external_seal_would_show: preview.external_seal_would_show, changes_effective_level: preview.changes_effective_level, newly_allowed_features: newly, still_blocked_features: blocked, strong_grant_warning: preview.strong_grant_warning } };
  });
}

export function verificationGrantMutationResponse(value: unknown): VerificationGrantMutationData | null {
  return successData(value, (data) => { const base = mutationBase(data, "verification"); const parsed = userProjection(base?.material); return base && parsed ? { contract_version: 1, principal: base.principal, verification: parsed, replayed: base.replayed } : null; });
}

function exactBody(body: JsonObject, required: readonly string[], optional: readonly string[] = []): JsonObject | null {
  // Same-origin request bodies remain exact so undeclared fields cannot reach Core.
  const keys = Object.keys(body);
  return required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || optional.includes(key)) ? body : null;
}

function baseRequest(body: JsonObject, required: readonly string[], optional: readonly string[] = []): JsonObject | null {
  const raw = exactBody(body, ["contract_version", ...required], optional);
  return raw?.contract_version === 1 ? raw : null;
}

function parseJsonMaterial<T>(value: unknown, parse: (candidate: unknown) => T | null): T | null {
  let decoded = value;
  if (typeof value === "string") {
    try { decoded = JSON.parse(value); } catch { return null; }
  }
  return parse(decoded);
}

function canonicalReason(value: unknown): string | null { return canonicalText(value, 1, 300, true); }

function uint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

export type VerificationBadgeFileError = "empty" | "size" | "type" | "signature" | "dimensions";

/** Cheap browser/proxy PNG checks. Core still owns bounded chunk/pixel decode and re-encoding. */
export function verificationPngBytesError(bytes: Uint8Array, totalSize = bytes.byteLength): VerificationBadgeFileError | null {
  if (!Number.isInteger(totalSize) || totalSize < 1) return "empty";
  if (totalSize > MAX_VERIFICATION_BADGE_BYTES) return "size";
  if (bytes.byteLength < 24) return "signature";
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value) || uint32(bytes, 8) !== 13
    || bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) return "signature";
  const width = uint32(bytes, 16);
  const height = uint32(bytes, 20);
  return width === height && width >= MIN_VERIFICATION_BADGE_DIMENSION && width <= MAX_VERIFICATION_BADGE_DIMENSION ? null : "dimensions";
}

export async function verificationBadgeFileError(file: Pick<File, "size" | "type" | "slice">): Promise<VerificationBadgeFileError | null> {
  if (!Number.isInteger(file.size) || file.size < 1) return "empty";
  if (file.size > MAX_VERIFICATION_BADGE_BYTES) return "size";
  if (file.type !== "image/png") return "type";
  return verificationPngBytesError(new Uint8Array(await file.slice(0, 24).arrayBuffer()), file.size);
}

function canonicalBase64(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 4 || value.length > 2_796_204 || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) return null;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const decodedSize = (value.length / 4) * 3 - padding;
  if (decodedSize < 1 || decodedSize > MAX_VERIFICATION_BADGE_BYTES) return null;
  try {
    const prefix = Uint8Array.from(atob(value.slice(0, 44)), (character) => character.charCodeAt(0));
    return verificationPngBytesError(prefix, decodedSize) === null ? value : null;
  } catch { return null; }
}

function normalizeConsole(body: JsonObject): JsonObject | null {
  const raw = baseRequest(body, [], ["scope_kind", "page_size", "cursor"]);
  if (!raw) return null;
  const filter = raw.scope_kind === undefined ? undefined : oneOf(raw.scope_kind, VERIFICATION_SCOPE_FILTERS);
  const pageSize = raw.page_size === undefined ? undefined : integer(raw.page_size, 1, 100);
  const cursor = raw.cursor === undefined ? undefined : opaque(raw.cursor, 256);
  if (filter === null || pageSize === null || cursor === null) return null;
  return Object.assign(Object.create(null), { contract_version: 1 }, filter ? { scope_kind: filter } : {}, pageSize ? { page_size: pageSize } : {}, cursor ? { cursor } : {});
}

function normalizePolicyDraft(body: JsonObject): JsonObject | null {
  const raw = baseRequest(body, ["scope_key", "draft_json", "expected_revision", "request_id"], ["place_token"]);
  const key = scopeKey(raw?.scope_key);
  const draft = key ? parseJsonMaterial(raw?.draft_json, (value) => storedBlock(value, key === "global")) : null;
  const revision = integer(raw?.expected_revision, 0, 2_147_483_647);
  const id = requestId(raw?.request_id);
  const token = raw?.place_token === undefined ? undefined : opaque(raw.place_token, 512);
  const needsCityToken = key?.startsWith("city:") === true && revision === 0;
  if (!key || !draft || revision === null || !id || token === null || (key === "global" && revision === 0)
    || (token !== undefined) !== needsCityToken) return null;
  return Object.assign(Object.create(null), { contract_version: 1, scope_key: key, draft_json: JSON.stringify(draft), expected_revision: revision, request_id: id }, token ? { place_token: token } : {});
}

function normalizeImpact(body: JsonObject): JsonObject | null {
  const raw = baseRequest(body, ["scope_key", "operation", "expected_revision"]);
  const key = scopeKey(raw?.scope_key);
  const operation = oneOf(raw?.operation, VERIFICATION_POLICY_OPERATIONS);
  const revision = integer(raw?.expected_revision, 1, 2_147_483_647);
  return key && operation && revision !== null ? Object.assign(Object.create(null), { contract_version: 1, scope_key: key, operation, expected_revision: revision }) : null;
}

function normalizeApply(body: JsonObject): JsonObject | null {
  const raw = baseRequest(body, ["scope_key", "operation", "expected_revision", "normalized_fingerprint", "confirmation_phrase", "reason", "request_id"]);
  if (!raw) return null;
  const impact = normalizeImpact({ contract_version: 1, scope_key: raw?.scope_key, operation: raw?.operation, expected_revision: raw?.expected_revision });
  const fingerprint = sha256(raw?.normalized_fingerprint);
  const reason = canonicalReason(raw?.reason);
  const id = requestId(raw?.request_id);
  if (!impact || !fingerprint || raw?.confirmation_phrase !== `${String(raw.operation).toUpperCase()} ${String(raw.scope_key)}` || !reason || !id) return null;
  return Object.assign(Object.create(null), impact, { normalized_fingerprint: fingerprint, confirmation_phrase: raw.confirmation_phrase, reason, request_id: id });
}

function normalizeCopySave(body: JsonObject): JsonObject | null {
  const raw = baseRequest(body, ["copy_json", "expected_revision", "request_id"]);
  const material = parseJsonMaterial(raw?.copy_json, copyMaterial);
  const revision = integer(raw?.expected_revision, 0, 2_147_483_647);
  const id = requestId(raw?.request_id);
  return material && revision !== null && id ? Object.assign(Object.create(null), { contract_version: 1, copy_json: JSON.stringify(material), expected_revision: revision, request_id: id }) : null;
}

function normalizeRevisionMutation(body: JsonObject, targetName: "copy_key" | "slot" | "uid"): JsonObject | null {
  const raw = baseRequest(body, [targetName, "reason", "expected_revision", "request_id"]);
  const target = targetName === "copy_key" ? copyKey(raw?.copy_key) : targetName === "slot" ? oneOf(raw?.slot, VERIFICATION_BADGE_SLOTS) : integer(raw?.uid, 1, 2_147_483_647);
  const reason = canonicalReason(raw?.reason);
  const revision = integer(raw?.expected_revision, 1, 2_147_483_647);
  const id = requestId(raw?.request_id);
  if (target === null || !reason || revision === null || !id || (targetName === "copy_key" && !String(target).startsWith("feature."))) return null;
  return Object.assign(Object.create(null), { contract_version: 1, [targetName]: target, reason, expected_revision: revision, request_id: id });
}

function normalizePendingSettings(body: JsonObject): JsonObject | null {
  const raw = baseRequest(body, ["overdue_after_seconds", "queue_average_long_copy_enabled", "queue_average_threshold_seconds", "expected_revision", "request_id"]);
  const overdue = integer(raw?.overdue_after_seconds, 300, 86_400);
  const threshold = integer(raw?.queue_average_threshold_seconds, 300, 86_400);
  const revision = integer(raw?.expected_revision, 1, 2_147_483_647);
  const id = requestId(raw?.request_id);
  return overdue !== null && raw?.queue_average_long_copy_enabled === false && threshold !== null && revision !== null && id
    ? Object.assign(Object.create(null), { contract_version: 1, overdue_after_seconds: overdue, queue_average_long_copy_enabled: false, queue_average_threshold_seconds: threshold, expected_revision: revision, request_id: id })
    : null;
}

function normalizeBadgeUpload(body: JsonObject): JsonObject | null {
  const raw = baseRequest(body, ["slot", "png_base64", "expected_revision", "request_id"]);
  const slot = oneOf(raw?.slot, VERIFICATION_BADGE_SLOTS);
  const png = canonicalBase64(raw?.png_base64);
  const revision = integer(raw?.expected_revision, 1, 2_147_483_647);
  const id = requestId(raw?.request_id);
  return slot && png && revision !== null && id ? Object.assign(Object.create(null), { contract_version: 1, slot, png_base64: png, expected_revision: revision, request_id: id }) : null;
}

function normalizeCitySearch(body: JsonObject): JsonObject | null {
  const raw = baseRequest(body, ["search_token", "query"], ["country_code"]);
  const token = requestId(raw?.search_token);
  const query = canonicalText(raw?.query, 2, 120);
  const country = raw?.country_code === undefined ? undefined : isoCountry(raw.country_code);
  return token && query && country !== null ? Object.assign(Object.create(null), { contract_version: 1, search_token: token, query }, country ? { country_code: country } : {}) : null;
}

function normalizeCityDetail(body: JsonObject): JsonObject | null {
  const raw = baseRequest(body, ["search_token", "place_id"]);
  const token = requestId(raw?.search_token);
  const place = placeId(raw?.place_id);
  return token && place ? Object.assign(Object.create(null), { contract_version: 1, search_token: token, place_id: place }) : null;
}

function normalizeSimulation(body: JsonObject): JsonObject | null {
  const raw = baseRequest(body, ["scope_key", "locale", "simulation_json"]);
  const key = scopeKey(raw?.scope_key);
  const locale = oneOf(raw?.locale, VERIFICATION_LOCALES);
  const simulation = parseJsonMaterial(raw?.simulation_json, simulationInput);
  return key && locale && simulation ? Object.assign(Object.create(null), { contract_version: 1, scope_key: key, locale, simulation_json: JSON.stringify(simulation) }) : null;
}

function normalizeContractOnly(body: JsonObject): JsonObject | null {
  return baseRequest(body, []) ? Object.assign(Object.create(null), { contract_version: 1 }) : null;
}

function normalizeUserDetail(
  body: JsonObject,
  adminGrantedVerificationSelectorAllowed: boolean,
): JsonObject | null {
  const selector = "admin_granted_verification_contract_version";
  const raw = baseRequest(
    body,
    ["uid"],
    adminGrantedVerificationSelectorAllowed ? [selector] : [],
  );
  const uid = integer(raw?.uid, 1, 2_147_483_647);
  if (uid === null || (raw?.[selector] !== undefined && raw[selector] !== 1)) return null;
  return Object.assign(
    Object.create(null),
    { contract_version: 1, uid },
    raw?.[selector] === 1 ? { [selector]: 1 } : {},
  );
}

function grantBase(body: JsonObject): JsonObject | null {
  const raw = baseRequest(body, ["uid", "level", "reason", "expected_revision"], ["expires_at"]);
  const uid = integer(raw?.uid, 1, 2_147_483_647);
  const level = oneOf(raw?.level, ["light", "strong"] as const);
  const reason = canonicalReason(raw?.reason);
  const revision = integer(raw?.expected_revision, 0, 2_147_483_647);
  const expiry = raw?.expires_at === undefined ? undefined : integer(raw.expires_at, 1, 2_147_483_647);
  return uid !== null && level && reason && revision !== null && expiry !== null
    ? Object.assign(Object.create(null), { contract_version: 1, uid, level, reason, expected_revision: revision }, expiry ? { expires_at: expiry } : {})
    : null;
}

function normalizeGrantSave(body: JsonObject): JsonObject | null {
  const raw = exactBody(body, ["contract_version", "uid", "level", "reason", "expected_revision", "request_id"], ["expires_at"]);
  const base = raw && grantBase(Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "request_id")));
  const id = requestId(raw?.request_id);
  return base && id ? Object.assign(Object.create(null), base, { request_id: id }) : null;
}

/** `undefined` is not Verification, `null` is refused, and an object is the only forwarded material. */
export function normalizeVerificationProxyBody(
  action: string,
  body: JsonObject,
  adminGrantedVerificationSelectorAllowed = false,
): JsonObject | null | undefined {
  if (!(VERIFICATION_ADMIN_ACTIONS as readonly string[]).includes(action)) return undefined;
  switch (action as VerificationAction) {
    case "verification_console": return normalizeConsole(body);
    case "verification_policy_save_draft": return normalizePolicyDraft(body);
    case "verification_policy_impact_preview": return normalizeImpact(body);
    case "verification_policy_apply": return normalizeApply(body);
    case "verification_copy_save": return normalizeCopySave(body);
    case "verification_copy_remove": return normalizeRevisionMutation(body, "copy_key");
    case "verification_pending_settings_save": return normalizePendingSettings(body);
    case "verification_badge_upload": return normalizeBadgeUpload(body);
    case "verification_badge_remove": return normalizeRevisionMutation(body, "slot");
    case "verification_places_city_search": return normalizeCitySearch(body);
    case "verification_places_city_detail": return normalizeCityDetail(body);
    case "verification_simulate": return normalizeSimulation(body);
    case "verification_pending_summary": return normalizeContractOnly(body);
    case "verification_user_detail": return normalizeUserDetail(
      body,
      adminGrantedVerificationSelectorAllowed,
    );
    case "verification_grant_preview": return grantBase(body);
    case "verification_grant_save": return normalizeGrantSave(body);
    case "verification_grant_remove": return normalizeRevisionMutation(body, "uid");
  }
}

export type VerificationPendingMutation = { version: 1; action: VerificationMutationAction; target: string; payload: JsonObject };
export const VERIFICATION_PENDING_STORAGE_KEY = "friending.verification.pending-mutation.v1";

export function verificationPendingMutation(action: VerificationMutationAction, target: string, body: JsonObject): VerificationPendingMutation | null {
  const canonicalTarget = canonicalText(target, 1, 512);
  const payload = normalizeVerificationProxyBody(action, body);
  return canonicalTarget && payload ? { version: 1, action, target: canonicalTarget, payload } : null;
}

export function verificationPendingFrom(value: unknown): VerificationPendingMutation | null {
  const raw = exactObject(value, ["version", "action", "target", "payload"]);
  const action = oneOf(raw?.action, VERIFICATION_MUTATION_ACTIONS);
  const target = canonicalText(raw?.target, 1, 512);
  return raw?.version === 1 && action && target ? verificationPendingMutation(action, target, record(raw.payload) ?? {}) : null;
}

export async function verificationPersistBeforeMutation<T>(storage: Pick<Storage, "setItem">, pending: VerificationPendingMutation, mutate: () => Promise<T>): Promise<{ ok: true; response: T } | { ok: false }> {
  const canonical = verificationPendingFrom(pending);
  if (!canonical) return { ok: false };
  try { storage.setItem(VERIFICATION_PENDING_STORAGE_KEY, JSON.stringify(canonical)); } catch { return { ok: false }; }
  return { ok: true, response: await mutate() };
}

export const VERIFICATION_ERROR_STATUSES = {
  unauthorized: 401,
  "admin-session-invalid": 401,
  "admin-revoked": 403,
  "verification-capability-required": 403,
  "verification-contract-version-invalid": 422,
  "verification-request-invalid": 422,
  "verification-request-id-invalid": 422,
  "verification-request-id-conflict": 409,
  "verification-request-in-progress": 409,
  "verification-conflict": 409,
  "verification-schema-unavailable": 503,
  "verification-stored-invalid": 503,
  "verification-read-failed": 503,
  "verification-write-failed": 503,
  "verification-audit-write-failed": 503,
  "verification-scope-invalid": 422,
  "verification-policy-not-found": 404,
  "verification-policy-inheritance-invalid": 422,
  "verification-policy-method-locked": 422,
  "verification-policy-operation-invalid": 422,
  "verification-policy-preview-stale": 409,
  "verification-policy-confirmation-invalid": 422,
  "verification-policy-activation-blocked": 409,
  "verification-copy-key-invalid": 422,
  "verification-copy-invalid": 422,
  "verification-copy-default-required": 409,
  "verification-pending-settings-invalid": 422,
  "verification-badge-invalid": 422,
  "verification-badge-too-large": 413,
  "verification-badge-storage-failed": 503,
  "verification-places-rate-limited": 429,
  "verification-places-query-invalid": 422,
  "verification-places-result-invalid": 422,
  "verification-places-unavailable": 503,
  "verification-simulation-invalid": 422,
  "verification-user-not-found": 404,
  "verification-import-invalid": 503,
  "verification-grant-invalid": 422,
  "verification-grant-not-active": 409,
  "bad-origin": 403,
  "not-found": 404,
  "auth-required": 401,
  "admin-write-required": 403,
  "invalid-input": 400,
  "too-large": 413,
  "core-unavailable": 502,
  "core-timeout": 504,
} as const;

export type VerificationError = keyof typeof VERIFICATION_ERROR_STATUSES;

export function verificationErrorResponse(value: unknown): VerificationError | null {
  const core = webadminErrorEnvelope(value);
  // Conflict `data` selects the authoritative conflict parser; the tolerant
  // bridge subset must not reinterpret a versioned Core conflict as no-data.
  const envelope = core ?? (webadminErrorEnvelope(value, "required") ? null : adminBridgeErrorEnvelope(value));
  const error = typeof envelope?.error === "string" && Object.prototype.hasOwnProperty.call(VERIFICATION_ERROR_STATUSES, envelope.error) ? envelope.error as VerificationError : null;
  return envelope && error && envelope.status_code === VERIFICATION_ERROR_STATUSES[error] ? error : null;
}

export function verificationShouldRetainMutation(error: VerificationError | null): boolean {
  return error === null || error === "verification-request-in-progress" || VERIFICATION_ERROR_STATUSES[error] >= 500;
}

export type VerificationConflict =
  | { kind: "policy"; policy: VerificationPolicy }
  | { kind: "copy"; copy_pair: VerificationCopyPair }
  | { kind: "pending"; pending_settings: VerificationPendingSettings }
  | { kind: "badge"; badge: VerificationBadgeAsset }
  | { kind: "grant"; verification: VerificationUserProjection };

export function verificationConflictResponse(value: unknown): VerificationConflict | null {
  const envelope = webadminErrorEnvelope(value, "required");
  if (envelope?.status_code !== 409 || envelope.error !== "verification-conflict") return null;
  const data = record(envelope.data);
  const branches = ["policy", "copy_pair", "pending_settings", "badge", "verification"] as const;
  const presentBranches = data ? branches.filter((key) => Object.hasOwn(data, key)) : [];
  if (data?.contract_version !== 1 || presentBranches.length !== 1) return null;
  if (Object.prototype.hasOwnProperty.call(data, "policy")) { const parsed = policy(data.policy); return parsed ? { kind: "policy", policy: parsed } : null; }
  if (Object.prototype.hasOwnProperty.call(data, "copy_pair")) { const parsed = copyPair(data.copy_pair); return parsed ? { kind: "copy", copy_pair: parsed } : null; }
  if (Object.prototype.hasOwnProperty.call(data, "pending_settings")) { const parsed = pendingSettings(data.pending_settings); return parsed ? { kind: "pending", pending_settings: parsed } : null; }
  if (Object.prototype.hasOwnProperty.call(data, "badge")) { const parsed = badge(data.badge); return parsed ? { kind: "badge", badge: parsed } : null; }
  if (Object.prototype.hasOwnProperty.call(data, "verification")) { const parsed = userProjection(data.verification); return parsed ? { kind: "grant", verification: parsed } : null; }
  return null;
}

export function verificationTabKey(value: unknown): VerificationTabKey { return oneOf(value, VERIFICATION_TAB_KEYS) ?? "scopes"; }
export function verificationTextLength(value: string): number { return scalarLength(value); }
export function verificationMaxLevel(...levels: VerificationLevel[]): VerificationLevel {
  const rank: Record<VerificationLevel, number> = { none: 0, light: 1, strong: 2 };
  return levels.reduce((best, level) => rank[level] > rank[best] ? level : best, "none");
}

export function verificationGrantDraftError(draft: { level: unknown; reason: unknown; expiresAt: unknown }, evaluatedAt: number): "level" | "reason" | "expiry" | null {
  if (!oneOf(draft.level, ["light", "strong"] as const)) return "level";
  if (!canonicalReason(draft.reason)) return "reason";
  if (draft.expiresAt === null) return null;
  const expiry = integer(draft.expiresAt, 1, 2_147_483_647);
  return expiry !== null && expiry > evaluatedAt ? null : "expiry";
}

function fixturePrincipal(): VerificationAdminPrincipal {
  return { role: "owner", capabilities: [...VERIFICATION_CAPABILITIES] };
}

function fixtureRequirements(value: VerificationRequirement): Record<VerificationFeatureKey, VerificationRequirement> {
  return Object.fromEntries(VERIFICATION_FEATURE_KEYS.map((feature) => [feature, value])) as Record<VerificationFeatureKey, VerificationRequirement>;
}

function fixtureSavedBlock(): VerificationSavedPolicyBlock {
  return { enabled_methods: ["persona"], feature_requirements: fixtureRequirements("none"), saved_at: VERIFICATION_FIXTURE_EVALUATED_AT, saved_by: "owner@friending.com" };
}

function fixtureEffective(): VerificationEffectivePolicy {
  return {
    enabled_methods: ["persona"],
    enabled_methods_source_scope_key: "global",
    tier_language: false,
    feature_requirements: Object.fromEntries(VERIFICATION_FEATURE_KEYS.map((feature) => [feature, {
      configured_requirement: "none",
      required_tier: "none",
      source_scope_key: "global",
    }])) as VerificationEffectivePolicy["feature_requirements"],
  };
}

function fixtureLocale(variant: VerificationGateVariant, locale: VerificationLocale): VerificationLocalizedGateCopy {
  return {
    title: locale === "en" ? `Verification ${variant}` : `Ellenőrzés ${variant}`,
    subtitle: "",
    description: "Verification guidance.",
    overdue_description: variant === "pending" ? "Verification is taking longer." : null,
    attention_note: null,
    primary_label: variant === "pending" ? null : "Continue",
    secondary_label: null,
    cancel_label: "Cancel",
  };
}

function fixtureCopy(variant: VerificationGateVariant): VerificationCopyPair {
  return {
    schema_version: 1,
    copy_key: `default.${variant}`,
    revision: 1,
    active: true,
    deleted_at: null,
    behavior: {
      icon: { kind: "asset", asset_key: `verification.${variant}` },
      primary_action: variant === "pending" ? "none" : "automatic",
      primary_url: null,
      secondary_action: "none",
      secondary_url: null,
    },
    locales: { en: fixtureLocale(variant, "en"), hu: fixtureLocale(variant, "hu") },
    updated_at: VERIFICATION_FIXTURE_EVALUATED_AT,
    updated_by: "owner@friending.com",
  };
}

function fixtureBadge(slot: VerificationBadgeSlot): VerificationBadgeAsset {
  return { schema_version: 1, slot, revision: 1, active: false, deleted_at: null, managed_url: null, mime: null, width: null, height: null, byte_size: null, content_sha256: null, updated_at: VERIFICATION_FIXTURE_EVALUATED_AT, updated_by: "owner@friending.com" };
}

/** Exact all-none launch fixture used only by tests and visual development. */
export function verificationConsoleFixture(): VerificationConsoleData {
  const block = fixtureSavedBlock();
  const globalPolicy: VerificationPolicy = {
    schema_version: 1,
    scope_key: "global",
    scope: { kind: "global", country_code: null, place_id: null, display: "Global" },
    revision: 1,
    active: true,
    deleted_at: null,
    draft: structuredClone(block),
    live: structuredClone(block),
    effective: fixtureEffective(),
    updated_at: VERIFICATION_FIXTURE_EVALUATED_AT,
    updated_by: "owner@friending.com",
  };
  return {
    contract_version: 1,
    principal: fixturePrincipal(),
    evaluated_at: VERIFICATION_FIXTURE_EVALUATED_AT,
    feature_keys: [...VERIFICATION_FEATURE_KEYS],
    method_availability: {
      video: { method: "video", policy_enable_allowed: false, new_start_available: false, reason: "deployment_unlock_disabled" },
      persona: { method: "persona", policy_enable_allowed: true, new_start_available: true, reason: null },
    },
    policies: [globalPolicy],
    next_cursor: null,
    total_policies: 1,
    copy_pairs: VERIFICATION_GATE_VARIANTS.map(fixtureCopy).sort((left, right) => left.copy_key.localeCompare(right.copy_key)),
    pending_settings: { schema_version: 1, revision: 1, overdue_after_seconds: 1_800, queue_average_long_copy_enabled: false, queue_average_threshold_seconds: 1_800, updated_at: VERIFICATION_FIXTURE_EVALUATED_AT, updated_by: "owner@friending.com" },
    badges: [fixtureBadge("light"), fixtureBadge("strong"), fixtureBadge("pending")],
    import_health: { evaluated_at: VERIFICATION_FIXTURE_EVALUATED_AT, total: 0, invalid: 0 },
    activation_guard: { non_none_publish_ready: false, blocking_reasons: ["persona_force_receipt_unready", "supported_client_unready"] },
  };
}

function fixtureMethod(status: VerificationMethodStatus, raw: VerificationAdminMethodProjection["raw_video_status"]): VerificationAdminMethodProjection {
  return { status, raw_video_status: raw, can_start: status === "not_started", pending_phase: null, pending_since: null, member_safe_reason: null, attempt: null, max_attempts: null, manual_review_available: false, state_integrity: true };
}

export function verificationUserFixture(uid = 7001): VerificationUserProjection {
  return {
    schema_version: 1,
    uid,
    display_name: "Fixture member",
    evaluated_at: VERIFICATION_FIXTURE_EVALUATED_AT,
    scope: { kind: "global", country_code: null, place_id: null, display: "Global", scope_key: "global", source: "global" },
    enabled_methods: ["persona"],
    startable_methods: ["persona"],
    tier_language: false,
    methods: { video: fixtureMethod("not_started", "not_started"), persona: fixtureMethod("not_started", null) },
    badge_visible: true,
    derived_level: "none",
    imported: null,
    import_integrity: "absent",
    grant: null,
    grant_revision: 0,
    effective_level: "none",
    effective_source: "derived",
    external_seal_would_show: false,
    feature_access: VERIFICATION_FEATURE_KEYS.map((feature) => ({ feature, configured_requirement: "none", required_tier: "none", allowed: true })),
  };
}
