import {
  AUTH_POLICY_EDITABLE_SETTING_KEYS,
  authPolicySettingsMaterial,
  type AuthPolicyConfiguration,
  type AuthPolicyConflict,
  type AuthPolicyVocabulary,
} from "@/lib/authPolicyConfiguration";
import { webadminEnvelope } from "@/lib/webadminEnvelope";

export const SECTION_AVAILABILITY_SECTIONS = ["travel", "dates"] as const;

export const SECTION_AVAILABILITY_SETTING_KEYS = [
  "travel_enabled",
  "travel_enabled_overrides",
  "dates_enabled",
  "dates_enabled_overrides",
] as const;

export type SectionAvailabilitySection = (typeof SECTION_AVAILABILITY_SECTIONS)[number];
export type SectionAvailabilitySettingKey = (typeof SECTION_AVAILABILITY_SETTING_KEYS)[number];

export type SectionAvailabilityOverride = {
  storefront: string;
  enabled: boolean;
};

export type SectionAvailabilityControl = {
  enabled: boolean;
  overrides: SectionAvailabilityOverride[];
  invalidCodes: string[];
  enabledUpdatedAt: number;
  enabledUpdatedBy: string;
  overridesUpdatedAt: number;
  overridesUpdatedBy: string;
};

export type SectionAvailabilityConfiguration = {
  travel: SectionAvailabilityControl;
  dates: SectionAvailabilityControl;
  vocabulary: AuthPolicyVocabulary;
  revision: number;
};

export type SectionAvailabilityDraftIssue =
  | "storefront"
  | "duplicateStorefront"
  | "vocabulary"
  | "revision";

export type SectionAvailabilityRefusal = {
  setting: SectionAvailabilitySettingKey;
  storefront: string | null;
};

export type SectionAvailabilityWireSetting = {
  value: boolean | SectionAvailabilityOverride[];
  invalidCodes: string[];
};

export type SectionAvailabilityWireProjection = Partial<Record<
  SectionAvailabilitySettingKey,
  SectionAvailabilityWireSetting
>>;

type ManagedSettingMetadata = {
  updatedAt: number;
  updatedBy: string;
};

const MANAGED_SETTING_KEYS = [
  "value",
  "type",
  "allowed_values",
  "minimum",
  "maximum",
  "updated_at",
  "updated_by",
  "warning",
  "invalid_codes",
] as const;
const ADMIN_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SECTION_REFUSAL_FIELD = /^(travel_enabled|travel_enabled_overrides|dates_enabled|dates_enabled_overrides)(?:\.([A-Z]{3}))?$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  const source = record(value);
  if (!source) return null;
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
    ? source
    : null;
}

function requiredRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  const source = record(value);
  return source && keys.every((key) => Object.hasOwn(source, key)) ? source : null;
}

function storefrontCode(value: unknown): string | null {
  return typeof value === "string"
    && /^[A-Z]{3}$/.test(value)
    && value !== "ALL"
    ? value
    : null;
}

function canonicalAdminEmail(value: unknown): string | null {
  if (value === "") return "";
  return typeof value === "string"
    && value.length <= 320
    && value === value.trim()
    && value === value.toLowerCase()
    && ADMIN_EMAIL.test(value)
    ? value
    : null;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function overrideRows(value: unknown, browserOwned = false): SectionAvailabilityOverride[] | null {
  // Core's empty associative PHP map is `[]` on reads. Fresh browser writes use `{}`.
  if (Array.isArray(value)) return !browserOwned && value.length === 0 ? [] : null;
  const source = record(value);
  if (!source || Object.keys(source).length > 512) return null;
  const rows: SectionAvailabilityOverride[] = [];
  for (const [rawStorefront, enabled] of Object.entries(source)) {
    const storefront = storefrontCode(rawStorefront);
    if (!storefront || typeof enabled !== "boolean") return null;
    rows.push({ storefront, enabled });
  }
  return rows.sort((left, right) => left.storefront.localeCompare(right.storefront));
}

function invalidCodes(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 512) return null;
  const codes: string[] = [];
  let previous = "";
  for (const entry of value) {
    const code = storefrontCode(entry);
    if (!code || code.localeCompare(previous) <= 0) return null;
    codes.push(code);
    previous = code;
  }
  return codes;
}

function unknownOverrideCodes(
  rows: readonly SectionAvailabilityOverride[],
  vocabulary: AuthPolicyVocabulary,
): string[] {
  const storefronts = new Set(vocabulary.storefronts.map((entry) => entry.alpha3));
  return rows
    .map((row) => row.storefront)
    .filter((storefront) => storefrontCode(storefront) !== null && !storefronts.has(storefront))
    .sort((left, right) => left.localeCompare(right));
}

function wireSetting(
  value: unknown,
  key: SectionAvailabilitySettingKey,
  vocabulary: AuthPolicyVocabulary,
): SectionAvailabilityWireSetting | null {
  const source = requiredRecord(value, ["value", "warning", "invalid_codes"]);
  if (!source || typeof source.warning !== "boolean") return null;
  const overrides = key.endsWith("_overrides");
  const parsedValue = overrides ? overrideRows(source.value) : source.value;
  if (overrides ? parsedValue === null : typeof parsedValue !== "boolean") return null;
  const publishedInvalidCodes = invalidCodes(source.invalid_codes);
  if (!publishedInvalidCodes) return null;
  const expectedInvalidCodes = overrides
    ? unknownOverrideCodes(parsedValue as SectionAvailabilityOverride[], vocabulary)
    : [];
  if (
    source.warning !== (expectedInvalidCodes.length > 0)
    || !sameStrings(publishedInvalidCodes, expectedInvalidCodes)
  ) return null;
  return {
    value: parsedValue as boolean | SectionAvailabilityOverride[],
    invalidCodes: publishedInvalidCodes,
  };
}

/**
 * Decode the exact section rows projected by the accepted Core corpus. The
 * corpus intentionally omits generic managed-setting metadata, so the full
 * console decoder below adds that stricter layer before a draft can render.
 */
export function sectionAvailabilityWireSettingsResponse(
  value: unknown,
  vocabulary: AuthPolicyVocabulary,
): SectionAvailabilityWireProjection | null {
  const envelope = webadminEnvelope(value, true, ["settings"]);
  const settings = record(envelope?.settings);
  if (!envelope || envelope.status_code !== 200 || !settings) return null;
  const projection: SectionAvailabilityWireProjection = {};
  for (const key of SECTION_AVAILABILITY_SETTING_KEYS) {
    if (!Object.hasOwn(settings, key)) continue;
    const parsed = wireSetting(settings[key], key, vocabulary);
    if (!parsed) return null;
    projection[key] = parsed;
  }
  return Object.keys(projection).length > 0 ? projection : null;
}

function managedSettingMetadata(
  value: unknown,
  expectedType: "section_enabled" | "section_enabled_overrides",
): ManagedSettingMetadata | null {
  const source = requiredRecord(value, MANAGED_SETTING_KEYS);
  const updatedBy = canonicalAdminEmail(source?.updated_by);
  if (
    !source
    || source.type !== expectedType
    || !Array.isArray(source.allowed_values)
    || source.allowed_values.length !== 0
    || source.minimum !== null
    || source.maximum !== null
    || typeof source.updated_at !== "number"
    || !Number.isSafeInteger(source.updated_at)
    || source.updated_at < 0
    || updatedBy === null
  ) return null;
  return { updatedAt: source.updated_at, updatedBy };
}

/** A partial or malformed four-row snapshot never becomes an editable configuration. */
export function sectionAvailabilitySettingsResponse(
  value: unknown,
  authority: Pick<
    AuthPolicyConfiguration,
    "vocabulary" | "revision"
  >,
): SectionAvailabilityConfiguration | null {
  const envelope = webadminEnvelope(value, true, ["settings"]);
  const settings = record(envelope?.settings);
  const projection = sectionAvailabilityWireSettingsResponse(value, authority.vocabulary);
  if (!envelope || envelope.status_code !== 200 || !settings || !projection) return null;

  const travelEnabled = projection.travel_enabled;
  const travelOverrides = projection.travel_enabled_overrides;
  const datesEnabled = projection.dates_enabled;
  const datesOverrides = projection.dates_enabled_overrides;
  const travelEnabledMetadata = managedSettingMetadata(settings.travel_enabled, "section_enabled");
  const travelOverridesMetadata = managedSettingMetadata(
    settings.travel_enabled_overrides,
    "section_enabled_overrides",
  );
  const datesEnabledMetadata = managedSettingMetadata(settings.dates_enabled, "section_enabled");
  const datesOverridesMetadata = managedSettingMetadata(
    settings.dates_enabled_overrides,
    "section_enabled_overrides",
  );
  if (
    typeof travelEnabled?.value !== "boolean"
    || !Array.isArray(travelOverrides?.value)
    || typeof datesEnabled?.value !== "boolean"
    || !Array.isArray(datesOverrides?.value)
    || !travelEnabledMetadata
    || !travelOverridesMetadata
    || !datesEnabledMetadata
    || !datesOverridesMetadata
    || !Number.isSafeInteger(authority.revision)
    || authority.revision < 1
  ) return null;

  return {
    travel: {
      enabled: travelEnabled.value,
      overrides: travelOverrides.value,
      invalidCodes: travelOverrides.invalidCodes,
      enabledUpdatedAt: travelEnabledMetadata.updatedAt,
      enabledUpdatedBy: travelEnabledMetadata.updatedBy,
      overridesUpdatedAt: travelOverridesMetadata.updatedAt,
      overridesUpdatedBy: travelOverridesMetadata.updatedBy,
    },
    dates: {
      enabled: datesEnabled.value,
      overrides: datesOverrides.value,
      invalidCodes: datesOverrides.invalidCodes,
      enabledUpdatedAt: datesEnabledMetadata.updatedAt,
      enabledUpdatedBy: datesEnabledMetadata.updatedBy,
      overridesUpdatedAt: datesOverridesMetadata.updatedAt,
      overridesUpdatedBy: datesOverridesMetadata.updatedBy,
    },
    vocabulary: authority.vocabulary,
    revision: authority.revision,
  };
}

export function sectionAvailabilityDraftWithSection(
  value: SectionAvailabilityConfiguration,
  section: SectionAvailabilitySection,
  changes: Partial<Pick<SectionAvailabilityControl, "enabled" | "overrides">>,
): SectionAvailabilityConfiguration {
  const control = { ...value[section], ...changes };
  const overrides = control.overrides.map((row) => ({ ...row }));
  return {
    ...value,
    [section]: {
      ...control,
      overrides,
      invalidCodes: unknownOverrideCodes(overrides, value.vocabulary),
    },
  };
}

export function sectionAvailabilityDraftIssue(
  value: SectionAvailabilityConfiguration,
): SectionAvailabilityDraftIssue | null {
  const storefronts = new Set(value.vocabulary.storefronts.map((entry) => entry.alpha3));
  for (const section of SECTION_AVAILABILITY_SECTIONS) {
    const control = value[section];
    if (typeof control?.enabled !== "boolean" || !Array.isArray(control.overrides)) {
      return "storefront";
    }
    const seen = new Set<string>();
    for (const row of control.overrides) {
      if (!row || !storefrontCode(row.storefront) || typeof row.enabled !== "boolean") {
        return "storefront";
      }
      if (seen.has(row.storefront)) return "duplicateStorefront";
      if (!storefronts.has(row.storefront)) return "vocabulary";
      seen.add(row.storefront);
    }
    if (control.overrides.length > storefronts.size) return "storefront";
    if (!sameStrings(control.invalidCodes, unknownOverrideCodes(control.overrides, value.vocabulary))) {
      return "vocabulary";
    }
  }
  return Number.isSafeInteger(value.revision) && value.revision >= 1 ? null : "revision";
}

/** Save both rows for both section controls; the shared revision is a sibling field. */
export function sectionAvailabilitySavePayload(
  value: SectionAvailabilityConfiguration,
): Record<SectionAvailabilitySettingKey, unknown> | null {
  if (sectionAvailabilityDraftIssue(value)) return null;
  const overrides = (section: SectionAvailabilitySection) => Object.fromEntries(
    [...value[section].overrides]
      .sort((left, right) => left.storefront.localeCompare(right.storefront))
      .map((row) => [row.storefront, row.enabled]),
  );
  return {
    travel_enabled: value.travel.enabled,
    travel_enabled_overrides: overrides("travel"),
    dates_enabled: value.dates.enabled,
    dates_enabled_overrides: overrides("dates"),
  };
}

/** Rebase values the operator is editing onto the latest shared authority. */
export function sectionAvailabilityDraftAtAuthority(
  draft: SectionAvailabilityConfiguration,
  authoritative: SectionAvailabilityConfiguration,
): SectionAvailabilityConfiguration {
  const rebased = (section: SectionAvailabilitySection): SectionAvailabilityControl => ({
    ...draft[section],
    invalidCodes: unknownOverrideCodes(draft[section].overrides, authoritative.vocabulary),
    enabledUpdatedAt: authoritative[section].enabledUpdatedAt,
    enabledUpdatedBy: authoritative[section].enabledUpdatedBy,
    overridesUpdatedAt: authoritative[section].overridesUpdatedAt,
    overridesUpdatedBy: authoritative[section].overridesUpdatedBy,
  });
  return {
    travel: rebased("travel"),
    dates: rebased("dates"),
    vocabulary: authoritative.vocabulary,
    revision: authoritative.revision,
  };
}

export function sectionAvailabilityDraftAfterConflict(
  draft: SectionAvailabilityConfiguration,
  authoritative: SectionAvailabilityConfiguration,
  conflict: AuthPolicyConflict,
): SectionAvailabilityConfiguration | null {
  return authoritative.revision < conflict.currentRevision
    ? null
    : sectionAvailabilityDraftAtAuthority(draft, authoritative);
}

function normalizedStorefront(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const storefront = value.trim().toUpperCase();
  if (storefront === "US") return "USA";
  if (storefront === "CA") return "CAN";
  return storefrontCode(storefront);
}

/** The resolved answer uses only the chosen section's default and override map. */
export function sectionAvailabilityForStorefront(
  value: SectionAvailabilityConfiguration,
  section: SectionAvailabilitySection,
  storefront: unknown,
): boolean {
  const normalized = normalizedStorefront(storefront);
  if (!normalized) return value[section].enabled;
  return value[section].overrides.find((row) => row.storefront === normalized)?.enabled
    ?? value[section].enabled;
}

export function sectionAvailabilityRefusal(value: unknown): SectionAvailabilityRefusal | null {
  const envelope = webadminEnvelope(value, false, ["error", "field"]);
  if (
    !envelope
    || envelope.status_code !== 422
    || envelope.error !== "setting-invalid"
    || typeof envelope.field !== "string"
  ) return null;
  const match = SECTION_REFUSAL_FIELD.exec(envelope.field);
  if (!match) return null;
  const setting = match[1] as SectionAvailabilitySettingKey;
  const storefront = match[2] ?? null;
  if (storefront !== null && !setting.endsWith("_overrides")) return null;
  return { setting, storefront };
}

/** Close a browser-owned section pair without introducing a second vocabulary source. */
export function sectionAvailabilitySettingsMaterial(
  value: unknown,
): Record<string, unknown> | null {
  const settings = record(value);
  if (!settings) return null;
  const output: Record<string, unknown> = Object.create(null);
  for (const section of SECTION_AVAILABILITY_SECTIONS) {
    const enabledKey = `${section}_enabled` as SectionAvailabilitySettingKey;
    const overridesKey = `${section}_enabled_overrides` as SectionAvailabilitySettingKey;
    const enabledPresent = Object.hasOwn(settings, enabledKey);
    const overridesPresent = Object.hasOwn(settings, overridesKey);
    if (enabledPresent !== overridesPresent) return null;
    if (!enabledPresent) continue;
    const enabled = settings[enabledKey];
    const overrides = overrideRows(settings[overridesKey], true);
    if (typeof enabled !== "boolean" || !overrides) return null;
    output[enabledKey] = enabled;
    output[overridesKey] = Object.fromEntries(overrides.map((row) => [row.storefront, row.enabled]));
  }
  return output;
}

/**
 * Close all shared-revision browser material at the same-origin boundary.
 * Ordinary runtime keys remain additive and Core-owned, while each managed
 * family must arrive complete enough to represent one console control.
 */
export function normalizeManagedSettingsProxyBody(
  action: string,
  value: unknown,
): Record<string, unknown> | null | undefined {
  if (action !== "set_settings") return undefined;
  const rawBody = record(value);
  const expectedRevisionProvided = rawBody !== null && Object.hasOwn(rawBody, "expected_revision");
  const body = exactRecord(
    value,
    expectedRevisionProvided ? ["settings", "expected_revision"] : ["settings"],
  );
  const settings = record(body?.settings);
  if (!body || !settings || Object.keys(settings).length === 0) return null;
  if (Object.hasOwn(settings, "auth_policy_revision")) return null;

  const authKeys = AUTH_POLICY_EDITABLE_SETTING_KEYS.filter((key) => Object.hasOwn(settings, key));
  if (authKeys.length !== 0 && authKeys.length !== AUTH_POLICY_EDITABLE_SETTING_KEYS.length) {
    return null;
  }
  const authPolicy = authKeys.length === 0 ? {} : authPolicySettingsMaterial(settings);
  if (!authPolicy) return null;
  const sections = sectionAvailabilitySettingsMaterial(settings);
  if (!sections) return null;
  const hasManagedMaterial = authKeys.length > 0 || Object.keys(sections).length > 0;
  const expectedRevision = body.expected_revision;
  if (
    expectedRevisionProvided
    && (
      typeof expectedRevision !== "number"
      || !Number.isSafeInteger(expectedRevision)
      || expectedRevision < 1
      || !hasManagedMaterial
    )
  ) return null;

  const normalizedSettings = Object.assign(Object.create(null), settings, authPolicy, sections);
  return Object.assign(
    Object.create(null),
    { settings: normalizedSettings },
    expectedRevisionProvided ? { expected_revision: expectedRevision } : {},
  );
}
