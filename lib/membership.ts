/**
 * Strict projections for Membership V1 Webadmin responses.
 *
 * Membership controls access and has store-adjacent metadata. Browser code must
 * therefore consume a small, closed projection instead of carrying arbitrary
 * Core documents in React state.
 */

export const MEMBERSHIP_TIERS = ["free", "plus"] as const;
export type MembershipTier = (typeof MEMBERSHIP_TIERS)[number];

export const MEMBERSHIP_CAPABILITIES = [
  "invisible_presence",
  "hide_profile_visit",
  "vip_badge",
] as const;
export type MembershipCapabilityKey = (typeof MEMBERSHIP_CAPABILITIES)[number];

export const MEMBERSHIP_QUOTAS = [
  "footprint_send",
  "pinger_send",
  "private_album_access",
  "quick_phrase_slots",
] as const;
export type MembershipQuotaKey = (typeof MEMBERSHIP_QUOTAS)[number];

export type MembershipQuotaMode = "disabled" | "finite" | "unlimited";
export type MembershipQuotaScope = "utc_day" | "concurrent";

export type MembershipQuotaRule = {
  mode: MembershipQuotaMode;
  value: number | null;
};

export type MembershipPlanConfiguration = {
  schema_version: 1;
  revision: number;
  ready_for_enforcement: boolean;
  capabilities: Record<MembershipCapabilityKey, Record<MembershipTier, boolean>>;
  quotas: Record<MembershipQuotaKey, {
    scope: MembershipQuotaScope;
    free: MembershipQuotaRule;
    plus: MembershipQuotaRule;
  }>;
  admin_grant_presets: {
    plus_week: { tier: "plus"; period: "P1W" };
    plus_month: { tier: "plus"; period: "P1M" };
    plus_quarter: { tier: "plus"; period: "P3M" };
  };
  updated_at: number;
  updated_by: string;
};

export type MembershipConfiguration = {
  configuration: MembershipPlanConfiguration;
  bounds: Record<MembershipQuotaKey, {
    scope: MembershipQuotaScope;
    min: number;
    max: number;
  }>;
  rollout: {
    projection_writes_enabled: boolean;
    feature_enforcement_enabled: boolean;
    legacy_compat_enabled: boolean;
  };
  store_products: {
    apple: Array<{ product_id: string; tier: "plus"; period: "P1W" | "P1M" | "P3M" }>;
    google: Array<{ product_id: string; tier: "plus"; period: string }>;
  };
};

export type MembershipStoreProductRow = {
  platform: "apple" | "google";
  product_id: string;
  tier: "plus";
  period: string;
};

export const MEMBERSHIP_LIFECYCLE_STATES = [
  "none",
  "pending",
  "scheduled",
  "active",
  "grace",
  "billing_retry",
  "on_hold",
  "paused",
  "expired",
  "revoked",
  "invalid",
  "unavailable",
] as const;
export type MembershipLifecycleState = (typeof MEMBERSHIP_LIFECYCLE_STATES)[number];

export type MembershipStatus = {
  schema_version: 1;
  tier: MembershipTier | "unknown";
  entitled: boolean;
  lifecycle_state: MembershipLifecycleState;
  effective_starts_at: string | null;
  effective_expires_at: string | null;
  next_transition_at: string | null;
  first_subscribed_at: string | null;
  sources: Array<{
    kind: "apple" | "google" | "admin_grant" | "legacy_compat";
    state: Exclude<MembershipLifecycleState, "none" | "unavailable">;
    starts_at: string | null;
    expires_at: string | null;
    auto_renews: boolean | null;
    contributes_to_access: boolean;
  }>;
  revision: number;
  server_time: string | null;
  configuration_revision: number;
  configuration_ready_for_enforcement: boolean;
  capabilities: Record<MembershipCapabilityKey | "quick_phrases", boolean>;
  quotas: Record<MembershipQuotaKey, MembershipUsageRule>;
  badge: { eligible: boolean; hidden: boolean; visible: boolean };
};

export type MembershipUsageRule = {
  scope: MembershipQuotaScope;
  mode: MembershipQuotaMode;
  used: number;
  limit: number | null;
  remaining: number | null;
  reset_at: string | null;
};

export type MembershipAdminGrant = {
  grant_id: string;
  tier: "plus";
  preset_id: "plus_week" | "plus_month" | "plus_quarter" | "custom";
  starts_at: string;
  expires_at: string;
  status: "scheduled" | "active" | "expired" | "revoked";
  current: boolean;
  revision: number;
  reason: string;
  created_by: string;
  created_at: string | null;
  updated_by: string;
  updated_at: string | null;
  revoked_by: string;
  revoked_at: string | null;
};

export type MembershipUserDetail = {
  schema_version: 1;
  uid: number;
  effective_membership: MembershipStatus;
  store_sources: Array<{
    platform: "apple" | "google";
    environment: string;
    product_id: string;
    base_plan_id: string;
    tier: "plus";
    provider_state: string;
    normalized_state: string;
    first_purchased_at: string | null;
    current_period_started_at: string | null;
    expires_at: string | null;
    grace_expires_at: string | null;
    auto_renews: boolean | null;
    verification_status: string;
    last_verified_at: string | null;
  }>;
  admin_grant: MembershipAdminGrant | null;
  history: Array<{
    kind: string;
    action: string;
    actor: string;
    reason: string;
    created_at: string | null;
  }>;
};

export type MembershipListSummary = {
  tier: MembershipTier | "unknown";
  entitled: boolean;
  lifecycle_state: MembershipLifecycleState;
  effective_expires_at: string | null;
  first_subscribed_at: string | null;
  source_kinds: Array<"apple" | "google" | "admin_grant" | "legacy_compat">;
};

export type MembershipGrantPreview = {
  uid: number;
  server_time: string;
  current_grant_revision: number;
  current_effective_expires_at: string | null;
  schedule: {
    tier: "plus";
    preset_id: "plus_week" | "plus_month" | "plus_quarter" | "custom";
    start_mode: "extend" | "start_now";
    base_at: string;
    starts_at: string;
    expires_at: string;
    status: "scheduled" | "active";
  };
  store_overlap: boolean;
  resulting_effective_expires_at: string;
};

export type MembershipExpiryChange = "invalid" | "unchanged" | "extend" | "shorten";

export const MEMBERSHIP_ADMIN_GRANT_PRESETS = [
  "plus_week",
  "plus_month",
  "plus_quarter",
] as const;
export type MembershipAdminGrantPresetKey = (typeof MEMBERSHIP_ADMIN_GRANT_PRESETS)[number];

export type MembershipPlanValidationIssue = {
  kind: "scope_mismatch" | "mode_invalid" | "finite_value_invalid" | "non_finite_value";
  quota: MembershipQuotaKey;
  tier: MembershipTier | null;
  expected_scope: MembershipQuotaScope;
  min: number;
  max: number;
};

export type MembershipPlanPreview = {
  tiers: Array<{
    tier: MembershipTier;
    capabilities: Array<{ key: MembershipCapabilityKey; enabled: boolean }>;
    quotas: Array<{
      key: MembershipQuotaKey;
      scope: MembershipQuotaScope;
      mode: MembershipQuotaMode;
      value: number | null;
    }>;
  }>;
  presets: Array<{
    key: MembershipAdminGrantPresetKey;
    tier: "plus";
    period: "P1W" | "P1M" | "P3M";
  }>;
};

export type MembershipAction =
  | "configuration_save"
  | "grant_preview"
  | "grant_create"
  | "expiry_update"
  | "grant_revoke";

export type MembershipActionErrorKey =
  | "configurationConflict"
  | "grantConflict"
  | "expiryConflict"
  | "revokeConflict"
  | "requestConflict"
  | "expiryInvalid"
  | "horizonExceeded"
  | "ownerRequired"
  | "writeRequired"
  | "accessRevoked"
  | "sessionInvalid"
  | "validation"
  | "unavailable"
  | "timeout"
  | "grantNotFound"
  | "useExpiryUpdate"
  | "userNotFound"
  | "invalidResponse"
  | "unknown";

const SOURCE_KINDS = ["apple", "google", "admin_grant", "legacy_compat"] as const;
const SOURCE_STATES = MEMBERSHIP_LIFECYCLE_STATES.filter(
  (state) => state !== "none" && state !== "unavailable",
) as Array<Exclude<MembershipLifecycleState, "none" | "unavailable">>;
const QUOTA_MODES = ["disabled", "finite", "unlimited"] as const;
const QUOTA_SCOPES = ["utc_day", "concurrent"] as const;
const PRESET_IDS = ["plus_week", "plus_month", "plus_quarter", "custom"] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteInteger(value: unknown, minimum = 0): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null;
}

function boundedText(value: unknown, maximum = 500): string | null {
  return typeof value === "string" && value.length <= maximum ? value : null;
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): T | null {
  return typeof value === "string" && values.includes(value as T) ? value as T : null;
}

function instant(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
    return undefined;
  }
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

function quotaRule(value: unknown, minimum: number, maximum: number): MembershipQuotaRule | null {
  const source = record(value);
  const mode = oneOf(source?.mode, QUOTA_MODES);
  if (!source || !mode) return null;
  if (mode !== "finite") {
    return source.value === null ? { mode, value: null } : null;
  }
  const parsed = finiteInteger(source.value, minimum);
  return parsed !== null && parsed <= maximum ? { mode, value: parsed } : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\u0000") === [...keys].sort().join("\u0000");
}

function planConfiguration(value: unknown): MembershipPlanConfiguration | null {
  const source = record(value);
  const revision = finiteInteger(source?.revision);
  const updatedAt = finiteInteger(source?.updated_at);
  const updatedBy = boundedText(source?.updated_by, 320);
  const capabilitiesSource = record(source?.capabilities);
  const quotasSource = record(source?.quotas);
  const presets = record(source?.admin_grant_presets);
  if (
    !source
    || source.schema_version !== 1
    || revision === null
    || updatedAt === null
    || updatedBy === null
    || typeof source.ready_for_enforcement !== "boolean"
    || !capabilitiesSource
    || !exactKeys(capabilitiesSource, MEMBERSHIP_CAPABILITIES)
    || !quotasSource
    || !exactKeys(quotasSource, MEMBERSHIP_QUOTAS)
    || !presets
  ) return null;

  const capabilities = {} as MembershipPlanConfiguration["capabilities"];
  for (const key of MEMBERSHIP_CAPABILITIES) {
    const tiers = record(capabilitiesSource[key]);
    if (!tiers || !exactKeys(tiers, MEMBERSHIP_TIERS)
      || typeof tiers.free !== "boolean" || typeof tiers.plus !== "boolean") return null;
    capabilities[key] = { free: tiers.free, plus: tiers.plus };
  }

  const quotas = {} as MembershipPlanConfiguration["quotas"];
  for (const key of MEMBERSHIP_QUOTAS) {
    const quota = record(quotasSource[key]);
    const scope = oneOf(quota?.scope, QUOTA_SCOPES);
    if (!quota || !scope) return null;
    // Bounds are validated a second time against the server-provided catalogue below.
    const free = quotaRule(quota.free, 0, 10_000);
    const plus = quotaRule(quota.plus, 0, 10_000);
    if (!free || !plus) return null;
    quotas[key] = { scope, free, plus };
  }

  const expectedPresets = {
    plus_week: { tier: "plus", period: "P1W" },
    plus_month: { tier: "plus", period: "P1M" },
    plus_quarter: { tier: "plus", period: "P3M" },
  } as const;
  for (const [key, expected] of Object.entries(expectedPresets)) {
    const preset = record(presets[key]);
    if (!preset || preset.tier !== expected.tier || preset.period !== expected.period) return null;
  }
  if (!exactKeys(presets, Object.keys(expectedPresets))) return null;

  return {
    schema_version: 1,
    revision,
    ready_for_enforcement: source.ready_for_enforcement,
    capabilities,
    quotas,
    admin_grant_presets: expectedPresets,
    updated_at: updatedAt,
    updated_by: updatedBy,
  };
}

export function membershipConfiguration(value: unknown): MembershipConfiguration | null {
  const source = record(value);
  const configuration = planConfiguration(source?.configuration);
  const boundsSource = record(source?.bounds);
  const rolloutSource = record(source?.rollout);
  const productsSource = record(source?.store_products);
  if (!source || !configuration || !boundsSource
    || !exactKeys(boundsSource, MEMBERSHIP_QUOTAS)
    || !rolloutSource || !productsSource
    || typeof rolloutSource.projection_writes_enabled !== "boolean"
    || typeof rolloutSource.feature_enforcement_enabled !== "boolean"
    || typeof rolloutSource.legacy_compat_enabled !== "boolean") return null;

  const bounds = {} as MembershipConfiguration["bounds"];
  for (const key of MEMBERSHIP_QUOTAS) {
    const bound = record(boundsSource[key]);
    const scope = oneOf(bound?.scope, QUOTA_SCOPES);
    const min = finiteInteger(bound?.min);
    const max = finiteInteger(bound?.max);
    if (!bound || !scope || min === null || max === null || max < min) return null;
    const quota = configuration.quotas[key];
    if (quota.scope !== scope) return null;
    for (const tier of MEMBERSHIP_TIERS) {
      const rule = quota[tier];
      if (rule.mode === "finite" && (rule.value === null || rule.value < min || rule.value > max)) {
        return null;
      }
    }
    bounds[key] = { scope, min, max };
  }

  const apple = productRows(productsSource.apple, ["P1W", "P1M", "P3M"] as const);
  const google = productRows(productsSource.google, null);
  if (!apple || !google) return null;
  return {
    configuration,
    bounds,
    rollout: {
      projection_writes_enabled: rolloutSource.projection_writes_enabled,
      feature_enforcement_enabled: rolloutSource.feature_enforcement_enabled,
      legacy_compat_enabled: rolloutSource.legacy_compat_enabled,
    },
    store_products: { apple, google },
  };
}

function productRows(
  value: unknown,
  periods: readonly ["P1W", "P1M", "P3M"],
): MembershipConfiguration["store_products"]["apple"] | null;
function productRows(
  value: unknown,
  periods: null,
): MembershipConfiguration["store_products"]["google"] | null;
function productRows(
  value: unknown,
  periods: readonly string[] | null,
): Array<{ product_id: string; tier: "plus"; period: string }> | null {
  if (!Array.isArray(value)) return null;
  const rows: Array<{ product_id: string; tier: "plus"; period: string }> = [];
  for (const entry of value) {
    const row = record(entry);
    const productId = boundedText(row?.product_id, 240);
    const period = boundedText(row?.period, 40);
    if (!row || !productId || row.tier !== "plus" || !period
      || (periods !== null && !periods.includes(period))) return null;
    rows.push({ product_id: productId, tier: "plus", period });
  }
  return rows;
}

/** Material body accepted by `save_membership_configuration`; storage metadata is omitted. */
export function membershipConfigurationCandidate(
  value: MembershipPlanConfiguration,
): Omit<MembershipPlanConfiguration, "revision" | "updated_at" | "updated_by"> {
  return {
    schema_version: 1,
    ready_for_enforcement: value.ready_for_enforcement,
    capabilities: value.capabilities,
    quotas: value.quotas,
    admin_grant_presets: value.admin_grant_presets,
  };
}

/** Compares only editable material; revision and audit metadata never create a false dirty state. */
export function membershipPlanIsDirty(
  authoritative: MembershipPlanConfiguration,
  draft: MembershipPlanConfiguration,
): boolean {
  if (authoritative.schema_version !== draft.schema_version
    || authoritative.ready_for_enforcement !== draft.ready_for_enforcement) return true;
  for (const capability of MEMBERSHIP_CAPABILITIES) {
    for (const tier of MEMBERSHIP_TIERS) {
      if (authoritative.capabilities[capability][tier]
        !== draft.capabilities[capability][tier]) return true;
    }
  }
  for (const quota of MEMBERSHIP_QUOTAS) {
    if (authoritative.quotas[quota].scope !== draft.quotas[quota].scope) return true;
    for (const tier of MEMBERSHIP_TIERS) {
      const current = authoritative.quotas[quota][tier];
      const candidate = draft.quotas[quota][tier];
      if (current.mode !== candidate.mode || current.value !== candidate.value) return true;
    }
  }
  for (const preset of MEMBERSHIP_ADMIN_GRANT_PRESETS) {
    const current = authoritative.admin_grant_presets[preset];
    const candidate = draft.admin_grant_presets[preset];
    if (current.tier !== candidate.tier || current.period !== candidate.period) return true;
  }
  return false;
}

/**
 * Identifies same-origin route changes that App Router can complete without firing beforeunload.
 * Hash-only movement is same-page state and must not trap ordinary page controls.
 */
export function membershipShouldGuardInternalNavigation(
  currentHref: string,
  destinationHref: string,
): boolean {
  try {
    const current = new URL(currentHref);
    const destination = new URL(destinationHref, current);
    return destination.origin === current.origin
      && (destination.pathname !== current.pathname || destination.search !== current.search);
  } catch {
    return false;
  }
}

/** Lists every locally invalid rule against the exact bounds supplied by Core. */
export function membershipPlanValidationIssues(
  draft: MembershipPlanConfiguration,
  bounds: MembershipConfiguration["bounds"],
): MembershipPlanValidationIssue[] {
  const issues: MembershipPlanValidationIssue[] = [];
  for (const quota of MEMBERSHIP_QUOTAS) {
    const definition = bounds[quota];
    const candidate = draft.quotas[quota];
    if (candidate.scope !== definition.scope) {
      issues.push({
        kind: "scope_mismatch",
        quota,
        tier: null,
        expected_scope: definition.scope,
        min: definition.min,
        max: definition.max,
      });
    }
    for (const tier of MEMBERSHIP_TIERS) {
      const rule = candidate[tier];
      if (!(QUOTA_MODES as readonly string[]).includes(rule.mode)) {
        issues.push({
          kind: "mode_invalid",
          quota,
          tier,
          expected_scope: definition.scope,
          min: definition.min,
          max: definition.max,
        });
        continue;
      }
      if (rule.mode === "finite") {
        if (!Number.isSafeInteger(rule.value)
          || rule.value === null
          || rule.value < definition.min
          || rule.value > definition.max) {
          issues.push({
            kind: "finite_value_invalid",
            quota,
            tier,
            expected_scope: definition.scope,
            min: definition.min,
            max: definition.max,
          });
        }
      } else if (rule.value !== null) {
        issues.push({
          kind: "non_finite_value",
          quota,
          tier,
          expected_scope: definition.scope,
          min: definition.min,
          max: definition.max,
        });
      }
    }
  }
  return issues;
}

/** Member-facing interpretation of the current editor draft, without claiming rollout state. */
export function membershipPlanPreview(
  draft: MembershipPlanConfiguration,
): MembershipPlanPreview {
  return {
    tiers: MEMBERSHIP_TIERS.map((tier) => ({
      tier,
      capabilities: MEMBERSHIP_CAPABILITIES.map((key) => ({
        key,
        enabled: draft.capabilities[key][tier],
      })),
      quotas: MEMBERSHIP_QUOTAS.map((key) => ({
        key,
        scope: draft.quotas[key].scope,
        mode: draft.quotas[key][tier].mode,
        value: draft.quotas[key][tier].value,
      })),
    })),
    presets: MEMBERSHIP_ADMIN_GRANT_PRESETS.map((key) => ({
      key,
      ...draft.admin_grant_presets[key],
    })),
  };
}

/** Maps the closed Membership V1 machine vocabulary to safe localized UI copy keys. */
export function membershipActionErrorKey(
  action: MembershipAction,
  error: unknown,
): MembershipActionErrorKey {
  const code = typeof error === "string" ? error : "";
  if (code === "") return "invalidResponse";
  if (code === "membership-configuration-conflict") return "configurationConflict";
  if (code === "membership-admin-conflict") {
    if (action === "expiry_update") return "expiryConflict";
    if (action === "grant_revoke") return "revokeConflict";
    return "grantConflict";
  }
  if (code === "membership-configuration-request-id-conflict"
    || code === "membership-admin-request-id-conflict") return "requestConflict";
  if (code === "membership-admin-grant-expiry-invalid") return "expiryInvalid";
  if (code === "membership-admin-grant-horizon-exceeded") return "horizonExceeded";
  if (code === "admin-owner-required") return "ownerRequired";
  if (code === "admin-write-required") return "writeRequired";
  if (code === "admin-revoked") return "accessRevoked";
  if (code === "admin-session-invalid") return "sessionInvalid";
  if (code === "membership-admin-grant-not-found") return "grantNotFound";
  if (code === "membership-admin-use-expiry-update") return "useExpiryUpdate";
  if (code === "membership-user-not-found") return "userNotFound";
  if (code === "core-timeout") return "timeout";
  if (code === "core-unavailable"
    || code === "membership-configuration-unavailable"
    || code === "membership-configuration-write-failed"
    || code === "membership-configuration-stored-invalid"
    || code === "membership-admin-unavailable"
    || code === "membership-admin-write-failed") return "unavailable";
  if (code === "invalid-core-response" || code === "invalid-response") return "invalidResponse";
  if (code === "membership-configuration-invalid"
    || code === "membership-configuration-schema-invalid"
    || code === "membership-configuration-capabilities-invalid"
    || code === "membership-configuration-quotas-invalid"
    || code === "membership-configuration-presets-invalid"
    || code === "membership-admin-grant-invalid"
    || code === "membership-admin-reason-invalid"
    || code === "membership-admin-request-id-invalid"
    || code === "membership-admin-revision-invalid"
    || code === "membership-user-invalid") return "validation";
  return "unknown";
}

/** One truthful operator list; a populated Google catalogue must never disappear behind Apple. */
export function membershipStoreProductRows(
  value: MembershipConfiguration,
): MembershipStoreProductRow[] {
  return [
    ...value.store_products.apple.map((product) => ({ platform: "apple" as const, ...product })),
    ...value.store_products.google.map((product) => ({ platform: "google" as const, ...product })),
  ];
}

/** Classifies an exact-expiry edit before the UI chooses its confirmation strength. */
export function membershipExpiryChange(
  currentExpiry: string | null,
  candidateExpiry: string | null,
): MembershipExpiryChange {
  if (!currentExpiry || !candidateExpiry) return "invalid";
  const current = Date.parse(currentExpiry);
  const candidate = Date.parse(candidateExpiry);
  if (!Number.isFinite(current) || !Number.isFinite(candidate)) return "invalid";
  if (candidate === current) return "unchanged";
  return candidate < current ? "shorten" : "extend";
}

/**
 * Relates one safe Store-evidence row to Core's effective source projection.
 *
 * Store details intentionally omit provider IDs. We therefore report a contribution only when a
 * verified row has exactly one platform + Core-normalized start + expiry match, and no second
 * retained row maps to that same source window. An unverified row cannot contribute by Core
 * policy; an ambiguous or drifted verified row stays unknown instead of being presented as active
 * access.
 */
export function membershipStoreContribution(
  store: MembershipUserDetail["store_sources"][number],
  effectiveSources: MembershipStatus["sources"],
  retainedSources: MembershipUserDetail["store_sources"],
): boolean | null {
  if (store.verification_status !== "verified") return false;
  const startsAt = store.current_period_started_at ?? store.first_purchased_at;
  const expiresAt = store.normalized_state === "grace" && store.grace_expires_at !== null
    ? store.grace_expires_at
    : store.expires_at;
  if (startsAt === null || expiresAt === null) return null;
  const matches = effectiveSources.filter((source) => (
    source.kind === store.platform
    && source.starts_at === startsAt
    && source.expires_at === expiresAt
  ));
  if (matches.length !== 1) return null;
  const rowsForWindow = retainedSources.filter((row) => {
    if (row.verification_status !== "verified" || row.platform !== store.platform) return false;
    const rowStartsAt = row.current_period_started_at ?? row.first_purchased_at;
    const rowExpiresAt = row.normalized_state === "grace" && row.grace_expires_at !== null
      ? row.grace_expires_at
      : row.expires_at;
    return rowStartsAt === startsAt && rowExpiresAt === expiresAt;
  });
  return rowsForWindow.length === 1 ? matches[0].contributes_to_access : null;
}

function usageRule(value: unknown): MembershipUsageRule | null {
  const source = record(value);
  const scope = oneOf(source?.scope, QUOTA_SCOPES);
  const mode = oneOf(source?.mode, QUOTA_MODES);
  const used = finiteInteger(source?.used);
  if (!source || !scope || !mode || used === null) return null;
  const limit = source.limit === undefined ? null : finiteInteger(source.limit);
  const remaining = source.remaining === undefined ? null : finiteInteger(source.remaining);
  const resetAt = instant(source.reset_at);
  if (resetAt === undefined) return null;
  if (mode === "finite" && (limit === null || remaining === null)) return null;
  if (mode !== "finite" && (source.limit !== undefined || source.remaining !== undefined)) return null;
  return { scope, mode, used, limit, remaining, reset_at: resetAt };
}

function membershipStatus(value: unknown): MembershipStatus | null {
  const source = record(value);
  const tier = oneOf(source?.tier, [...MEMBERSHIP_TIERS, "unknown"] as const);
  const lifecycle = oneOf(source?.lifecycle_state, MEMBERSHIP_LIFECYCLE_STATES);
  if (!source || !tier || !lifecycle || typeof source.entitled !== "boolean") return null;

  // `user_detail` deliberately has one diagnosable fallback when the membership
  // subsystem is unavailable. It grants nothing and carries no mutable state.
  if (tier === "unknown" && lifecycle === "unavailable" && source.entitled === false) {
    return unavailableMembershipStatus();
  }
  if (source.schema_version !== 1 || tier === "unknown") return null;
  const effectiveStart = instant(source.effective_starts_at);
  const effectiveExpiry = instant(source.effective_expires_at);
  const nextTransition = instant(source.next_transition_at);
  const firstSubscribed = instant(source.first_subscribed_at);
  const serverTime = instant(source.server_time);
  const revision = finiteInteger(source.revision);
  const configurationRevision = finiteInteger(source.configuration_revision);
  const capabilitiesSource = record(source.capabilities);
  const quotasSource = record(source.quotas);
  const badgeSource = record(source.badge);
  if ([effectiveStart, effectiveExpiry, nextTransition, firstSubscribed, serverTime].includes(undefined)
    || revision === null || configurationRevision === null
    || typeof source.configuration_ready_for_enforcement !== "boolean"
    || !Array.isArray(source.sources) || !capabilitiesSource || !quotasSource || !badgeSource
    || typeof badgeSource.eligible !== "boolean"
    || typeof badgeSource.hidden !== "boolean"
    || typeof badgeSource.visible !== "boolean") return null;

  const sources: MembershipStatus["sources"] = [];
  for (const entry of source.sources) {
    const row = record(entry);
    const kind = oneOf(row?.kind, SOURCE_KINDS);
    const state = oneOf(row?.state, SOURCE_STATES);
    const startsAt = instant(row?.starts_at);
    const expiresAt = instant(row?.expires_at);
    if (!row || !kind || !state || startsAt === undefined || expiresAt === undefined
      || !(row.auto_renews === null || typeof row.auto_renews === "boolean")
      || typeof row.contributes_to_access !== "boolean") return null;
    sources.push({
      kind,
      state,
      starts_at: startsAt,
      expires_at: expiresAt,
      auto_renews: row.auto_renews,
      contributes_to_access: row.contributes_to_access,
    });
  }

  const capabilities = {} as MembershipStatus["capabilities"];
  for (const key of [...MEMBERSHIP_CAPABILITIES, "quick_phrases"] as const) {
    if (typeof capabilitiesSource[key] !== "boolean") return null;
    capabilities[key] = capabilitiesSource[key];
  }
  const quotas = {} as MembershipStatus["quotas"];
  for (const key of MEMBERSHIP_QUOTAS) {
    const parsed = usageRule(quotasSource[key]);
    if (!parsed) return null;
    quotas[key] = parsed;
  }

  return {
    schema_version: 1,
    tier,
    entitled: source.entitled,
    lifecycle_state: lifecycle,
    effective_starts_at: effectiveStart ?? null,
    effective_expires_at: effectiveExpiry ?? null,
    next_transition_at: nextTransition ?? null,
    first_subscribed_at: firstSubscribed ?? null,
    sources,
    revision,
    server_time: serverTime ?? null,
    configuration_revision: configurationRevision,
    configuration_ready_for_enforcement: source.configuration_ready_for_enforcement,
    capabilities,
    quotas,
    badge: {
      eligible: badgeSource.eligible,
      hidden: badgeSource.hidden,
      visible: badgeSource.visible,
    },
  };
}

function unavailableMembershipStatus(): MembershipStatus {
  const disabledUsage = (scope: MembershipQuotaScope): MembershipUsageRule => ({
    scope,
    mode: "disabled",
    used: 0,
    limit: null,
    remaining: null,
    reset_at: null,
  });
  return {
    schema_version: 1,
    tier: "unknown",
    entitled: false,
    lifecycle_state: "unavailable",
    effective_starts_at: null,
    effective_expires_at: null,
    next_transition_at: null,
    first_subscribed_at: null,
    sources: [],
    revision: 0,
    server_time: null,
    configuration_revision: 0,
    configuration_ready_for_enforcement: false,
    capabilities: {
      invisible_presence: false,
      hide_profile_visit: false,
      vip_badge: false,
      quick_phrases: false,
    },
    quotas: {
      footprint_send: disabledUsage("utc_day"),
      pinger_send: disabledUsage("utc_day"),
      private_album_access: disabledUsage("concurrent"),
      quick_phrase_slots: disabledUsage("concurrent"),
    },
    badge: { eligible: false, hidden: false, visible: false },
  };
}

/**
 * Compatibility projection for a Core version that predates Membership V1.
 * It is intentionally non-entitled and has no mutation revision.
 */
export function unavailableMembershipUserDetail(uid: number): MembershipUserDetail {
  return {
    schema_version: 1,
    uid,
    effective_membership: unavailableMembershipStatus(),
    store_sources: [],
    admin_grant: null,
    history: [],
  };
}

function adminGrant(value: unknown): MembershipAdminGrant | null | undefined {
  if (value === null || value === undefined) return null;
  const source = record(value);
  const preset = oneOf(source?.preset_id, PRESET_IDS);
  const status = oneOf(source?.status, ["scheduled", "active", "expired", "revoked"] as const);
  const startsAt = instant(source?.starts_at);
  const expiresAt = instant(source?.expires_at);
  const createdAt = instant(source?.created_at);
  const updatedAt = instant(source?.updated_at);
  const revokedAt = instant(source?.revoked_at);
  const revision = finiteInteger(source?.revision);
  const grantId = boundedText(source?.grant_id, 120);
  const reason = boundedText(source?.reason, 500);
  const createdBy = boundedText(source?.created_by, 320);
  const updatedBy = boundedText(source?.updated_by, 320);
  const revokedBy = boundedText(source?.revoked_by, 320);
  if (!source || !preset || !status || !grantId || source.tier !== "plus"
    || startsAt === null || startsAt === undefined || expiresAt === null || expiresAt === undefined
    || createdAt === undefined || updatedAt === undefined || revokedAt === undefined
    || revision === null || reason === null || createdBy === null || updatedBy === null
    || revokedBy === null || typeof source.current !== "boolean") return undefined;
  return {
    grant_id: grantId,
    tier: "plus",
    preset_id: preset,
    starts_at: startsAt,
    expires_at: expiresAt,
    status,
    current: source.current,
    revision,
    reason,
    created_by: createdBy,
    created_at: createdAt,
    updated_by: updatedBy,
    updated_at: updatedAt,
    revoked_by: revokedBy,
    revoked_at: revokedAt,
  };
}

export function membershipUserDetail(value: unknown): MembershipUserDetail | null {
  const source = record(value);
  const uid = finiteInteger(source?.uid, 1);
  const status = membershipStatus(source?.effective_membership);
  const grant = adminGrant(source?.admin_grant);
  if (!source || source.schema_version !== 1 || uid === null || !status || grant === undefined
    || !Array.isArray(source.store_sources) || !Array.isArray(source.history)) return null;

  const storeSources: MembershipUserDetail["store_sources"] = [];
  for (const entry of source.store_sources) {
    const row = record(entry);
    const platform = oneOf(row?.platform, ["apple", "google"] as const);
    const tier = oneOf(row?.tier, ["plus"] as const);
    const firstPurchased = instant(row?.first_purchased_at);
    const periodStarted = instant(row?.current_period_started_at);
    const expiresAt = instant(row?.expires_at);
    const graceAt = instant(row?.grace_expires_at);
    const lastVerified = instant(row?.last_verified_at);
    const environment = boundedText(row?.environment, 80);
    const productId = boundedText(row?.product_id, 240);
    const basePlanId = boundedText(row?.base_plan_id, 240);
    const providerState = boundedText(row?.provider_state, 120);
    const normalizedState = boundedText(row?.normalized_state, 120);
    const verificationStatus = boundedText(row?.verification_status, 120);
    if (!row || !platform || !tier
      || [firstPurchased, periodStarted, expiresAt, graceAt, lastVerified].includes(undefined)
      || environment === null || productId === null || basePlanId === null
      || providerState === null || normalizedState === null || verificationStatus === null
      || !(row.auto_renews === null || typeof row.auto_renews === "boolean")) return null;
    storeSources.push({
      platform,
      environment,
      product_id: productId,
      base_plan_id: basePlanId,
      tier,
      provider_state: providerState,
      normalized_state: normalizedState,
      first_purchased_at: firstPurchased ?? null,
      current_period_started_at: periodStarted ?? null,
      expires_at: expiresAt ?? null,
      grace_expires_at: graceAt ?? null,
      auto_renews: row.auto_renews,
      verification_status: verificationStatus,
      last_verified_at: lastVerified ?? null,
    });
  }

  const history: MembershipUserDetail["history"] = [];
  for (const entry of source.history) {
    const row = record(entry);
    const kind = boundedText(row?.kind, 80);
    const action = boundedText(row?.action, 160);
    const actor = boundedText(row?.actor, 320);
    const reason = boundedText(row?.reason, 500);
    const createdAt = instant(row?.created_at);
    if (!row || kind === null || action === null || actor === null || reason === null
      || createdAt === undefined) return null;
    history.push({ kind, action, actor, reason, created_at: createdAt ?? null });
  }

  return {
    schema_version: 1,
    uid,
    effective_membership: status,
    store_sources: storeSources,
    admin_grant: grant,
    history,
  };
}

export function membershipListSummary(value: unknown): MembershipListSummary {
  const source = record(value);
  const tier = oneOf(source?.tier, [...MEMBERSHIP_TIERS, "unknown"] as const);
  const lifecycle = oneOf(source?.lifecycle_state, MEMBERSHIP_LIFECYCLE_STATES);
  const expiry = instant(source?.effective_expires_at);
  const first = instant(source?.first_subscribed_at);
  if (!source || !tier || !lifecycle || typeof source.entitled !== "boolean"
    || expiry === undefined || first === undefined || !Array.isArray(source.source_kinds)) {
    return {
      tier: "unknown",
      entitled: false,
      lifecycle_state: "unavailable",
      effective_expires_at: null,
      first_subscribed_at: null,
      source_kinds: [],
    };
  }
  const kinds: MembershipListSummary["source_kinds"] = [];
  for (const entry of source.source_kinds) {
    const kind = oneOf(entry, SOURCE_KINDS);
    if (!kind) return { tier: "unknown", entitled: false, lifecycle_state: "unavailable", effective_expires_at: null, first_subscribed_at: null, source_kinds: [] };
    if (!kinds.includes(kind)) kinds.push(kind);
  }
  const coherentPlus = tier === "plus"
    && source.entitled
    && (lifecycle === "active" || lifecycle === "grace")
    && expiry !== null
    && kinds.length > 0;
  const coherentFree = tier === "free"
    && !source.entitled
    && lifecycle !== "active"
    && lifecycle !== "grace"
    && lifecycle !== "unavailable"
    && expiry === null
    && (lifecycle === "none" ? kinds.length === 0 : kinds.length > 0);
  if (!coherentPlus && !coherentFree) {
    return {
      tier: "unknown",
      entitled: false,
      lifecycle_state: "unavailable",
      effective_expires_at: null,
      first_subscribed_at: null,
      source_kinds: [],
    };
  }
  return {
    tier,
    entitled: source.entitled,
    lifecycle_state: lifecycle,
    effective_expires_at: expiry ?? null,
    first_subscribed_at: first ?? null,
    source_kinds: kinds,
  };
}

/** Renders the strict wire instant without applying the operator device's local timezone. */
export function membershipUtcInstant(value: string | null): string | null {
  const parsed = instant(value);
  if (parsed === undefined || parsed === null) return null;
  return `${parsed.slice(0, 10)} ${parsed.slice(11, 19)} UTC`;
}

export function membershipGrantPreview(value: unknown): MembershipGrantPreview | null {
  const source = record(value);
  const schedule = record(source?.schedule);
  const uid = finiteInteger(source?.uid, 1);
  const revision = finiteInteger(source?.current_grant_revision);
  const serverTime = instant(source?.server_time);
  const currentExpiry = instant(source?.current_effective_expires_at);
  const resultingExpiry = instant(source?.resulting_effective_expires_at);
  const preset = oneOf(schedule?.preset_id, PRESET_IDS);
  const startMode = oneOf(schedule?.start_mode, ["extend", "start_now"] as const);
  const baseAt = instant(schedule?.base_at);
  const startsAt = instant(schedule?.starts_at);
  const expiresAt = instant(schedule?.expires_at);
  const status = oneOf(schedule?.status, ["scheduled", "active"] as const);
  if (!source || source.schema_version !== 1 || !schedule || schedule.tier !== "plus"
    || uid === null || revision === null || serverTime === null || serverTime === undefined
    || currentExpiry === undefined || resultingExpiry === null || resultingExpiry === undefined
    || !preset || !startMode || baseAt === null || baseAt === undefined
    || startsAt === null || startsAt === undefined || expiresAt === null || expiresAt === undefined
    || !status || typeof source.store_overlap !== "boolean") return null;
  return {
    uid,
    server_time: serverTime,
    current_grant_revision: revision,
    current_effective_expires_at: currentExpiry ?? null,
    schedule: {
      tier: "plus",
      preset_id: preset,
      start_mode: startMode,
      base_at: baseAt,
      starts_at: startsAt,
      expires_at: expiresAt,
      status,
    },
    store_overlap: source.store_overlap,
    resulting_effective_expires_at: resultingExpiry,
  };
}
