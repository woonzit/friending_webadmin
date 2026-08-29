import { getCountryDataList } from "countries-list";
import { webadminEnvelope } from "@/lib/webadminEnvelope";

export const AUTH_POLICY_EDITABLE_SETTING_KEYS = [
  "auth_policy_default",
  "auth_policy_overrides",
  "phone_dial_codes_default",
  "phone_dial_codes_overrides",
] as const;

export const AUTH_POLICY_SETTING_KEYS = [
  ...AUTH_POLICY_EDITABLE_SETTING_KEYS,
  "auth_policy_revision",
] as const;

export type AuthMethods = {
  phone: boolean;
  email: boolean;
};

export type DialCodeRule = "ALL" | string[];

export type AuthMethodOverride = AuthMethods & {
  storefront: string;
};

export type DialCodeOverride = {
  storefront: string;
  dialCodes: DialCodeRule;
};

export type AuthPolicyConfiguration = {
  defaultMethods: AuthMethods;
  methodOverrides: AuthMethodOverride[];
  defaultDialCodes: DialCodeRule;
  dialCodeOverrides: DialCodeOverride[];
  revision: number;
  updatedAt: number;
  updatedBy: string;
};

export type AuthPolicyDraftIssue =
  | "noMethod"
  | "storefront"
  | "duplicateStorefront"
  | "dialCodes"
  | "revision";

export type AuthPolicyCountry = {
  alpha2: string;
  alpha3: string;
  dialCodes: string[];
};

export type LocalizedAuthPolicyCountry = AuthPolicyCountry & {
  name: string;
};

const SETTING_KEYS = [
  "value",
  "type",
  "allowed_values",
  "minimum",
  "maximum",
  "updated_at",
  "updated_by",
] as const;
const METHOD_KEYS = ["phone", "email"] as const;
const NON_ISO_REGIONS = new Set(["AC", "TA"]);
const ADMIN_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Core publishes PHP_INT_MAX. JSON.parse rounds that 64-bit value to this
// exact JavaScript number, so the consumer closes on the observed wire value.
const CORE_64_BIT_INTEGER_MAX_ON_JSON_WIRE = 9_223_372_036_854_776_000;

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

/**
 * `countries-list` keeps NANP and a few shared plans as full national prefixes.
 * The Core contract stores the E.164 country calling code instead, so collapse
 * those three known shared plans to their ITU root.
 */
function e164CallingCode(value: number): string | null {
  const digits = String(value);
  if (/^[1-9]\d{0,2}$/.test(digits)) return digits;
  if (/^1\d{3}$/.test(digits)) return "1";
  if (digits === "4779") return "47";
  if (/^599\d$/.test(digits)) return "599";
  return null;
}

const COUNTRY_SOURCE = getCountryDataList()
  .filter((country) => !country.userAssigned && !NON_ISO_REGIONS.has(country.iso2));
const ENGLISH_COUNTRY_NAMES: ReadonlyMap<string, string> = new Map(
  COUNTRY_SOURCE.map((country) => [country.iso2, country.name]),
);
const COUNTRY_CATALOG: AuthPolicyCountry[] = COUNTRY_SOURCE
  .map((country) => ({
    alpha2: country.iso2,
    alpha3: country.iso3,
    dialCodes: [...new Set(country.phone.map(e164CallingCode).filter((code): code is string => code !== null))]
      .sort((left, right) => Number(left) - Number(right)),
  }))
  .filter((country) => /^[A-Z]{2}$/.test(country.alpha2)
    && /^[A-Z]{3}$/.test(country.alpha3)
    && country.dialCodes.length > 0)
  .sort((left, right) => left.alpha3.localeCompare(right.alpha3));

const STOREFRONT_CODES = new Set(COUNTRY_CATALOG.map((country) => country.alpha3));
const DIAL_CODES = new Set(COUNTRY_CATALOG.flatMap((country) => country.dialCodes));

export const AUTH_POLICY_COUNTRIES: readonly AuthPolicyCountry[] = COUNTRY_CATALOG;

export function localizedAuthPolicyCountries(locale: string): LocalizedAuthPolicyCountry[] {
  const supportedLocale = locale === "hu" ? "hu" : "en";
  const displayNames = new Intl.DisplayNames([supportedLocale], { type: "region" });
  const collator = new Intl.Collator(supportedLocale, { sensitivity: "base" });
  return COUNTRY_CATALOG.map((country) => ({
    ...country,
    name: displayNames.of(country.alpha2)
      ?? ENGLISH_COUNTRY_NAMES.get(country.alpha2)
      ?? country.alpha3,
  })).sort((left, right) => collator.compare(left.name, right.name));
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

type ParsedSetting<T> = {
  value: T;
  updatedAt: number;
  updatedBy: string;
};

function managedSetting<T>(
  value: unknown,
  parseValue: (candidate: unknown) => T | null,
  expectedType: string,
  expectedMinimum: number | null = null,
  expectedMaximum: number | null = null,
): ParsedSetting<T> | null {
  const source = exactRecord(value, SETTING_KEYS);
  const parsedValue = parseValue(source?.value);
  const updatedBy = canonicalAdminEmail(source?.updated_by);
  const allowedValues = source?.allowed_values;
  if (
    !source
    || parsedValue === null
    || source.type !== expectedType
    || !Array.isArray(allowedValues)
    || allowedValues.length !== 0
    || source.minimum !== expectedMinimum
    || source.maximum !== expectedMaximum
    || typeof source.updated_at !== "number"
    || !Number.isSafeInteger(source.updated_at)
    || source.updated_at < 0
    || updatedBy === null
  ) return null;
  return { value: parsedValue, updatedAt: source.updated_at, updatedBy };
}

function methods(value: unknown): AuthMethods | null {
  const source = exactRecord(value, METHOD_KEYS);
  return source
    && typeof source.phone === "boolean"
    && typeof source.email === "boolean"
    ? { phone: source.phone, email: source.email }
    : null;
}

function storefront(value: unknown): string | null {
  return typeof value === "string" && STOREFRONT_CODES.has(value) ? value : null;
}

function methodOverrides(value: unknown): AuthMethodOverride[] | null {
  // Core's associative PHP array becomes `[]` when the map is empty. Accept
  // only that exact wire ambiguity; a populated list is never an override map.
  if (Array.isArray(value)) return value.length === 0 ? [] : null;
  const source = record(value);
  if (!source || Object.keys(source).length > COUNTRY_CATALOG.length) return null;
  const output: AuthMethodOverride[] = [];
  for (const [rawStorefront, rawMethods] of Object.entries(source)) {
    const parsedStorefront = storefront(rawStorefront);
    const parsedMethods = methods(rawMethods);
    if (!parsedStorefront || !parsedMethods) return null;
    output.push({ storefront: parsedStorefront, ...parsedMethods });
  }
  return output.sort((left, right) => left.storefront.localeCompare(right.storefront));
}

function dialCodeRule(value: unknown): DialCodeRule | null {
  if (value === "ALL") return "ALL";
  if (!Array.isArray(value) || value.length > DIAL_CODES.size) return null;
  const output: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !DIAL_CODES.has(entry) || seen.has(entry)) return null;
    seen.add(entry);
    output.push(entry);
  }
  return output.sort((left, right) => Number(left) - Number(right));
}

function dialCodeOverrides(value: unknown): DialCodeOverride[] | null {
  // Same PHP empty-map representation as auth_policy_overrides above.
  if (Array.isArray(value)) return value.length === 0 ? [] : null;
  const source = record(value);
  if (!source || Object.keys(source).length > COUNTRY_CATALOG.length) return null;
  const output: DialCodeOverride[] = [];
  for (const [rawStorefront, rawDialCodes] of Object.entries(source)) {
    const parsedStorefront = storefront(rawStorefront);
    const parsedDialCodes = dialCodeRule(rawDialCodes);
    if (!parsedStorefront || parsedDialCodes === null) return null;
    output.push({ storefront: parsedStorefront, dialCodes: parsedDialCodes });
  }
  return output.sort((left, right) => left.storefront.localeCompare(right.storefront));
}

function revision(value: unknown): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 1
    ? value
    : null;
}

/** Parse all five managed values; a partial or malformed policy never becomes an editable draft. */
export function authPolicySettingsResponse(value: unknown): AuthPolicyConfiguration | null {
  const envelope = webadminEnvelope(value, true, ["settings"]);
  const settings = record(envelope?.settings);
  if (!envelope || envelope.status_code !== 200 || !settings) return null;

  const defaultMethods = managedSetting(settings.auth_policy_default, methods, "auth_policy");
  const overrides = managedSetting(
    settings.auth_policy_overrides,
    methodOverrides,
    "auth_policy_overrides",
  );
  const defaultDialCodes = managedSetting(
    settings.phone_dial_codes_default,
    dialCodeRule,
    "phone_dial_codes",
  );
  const dialOverrides = managedSetting(
    settings.phone_dial_codes_overrides,
    dialCodeOverrides,
    "phone_dial_codes_overrides",
  );
  const policyRevision = managedSetting(
    settings.auth_policy_revision,
    revision,
    "integer",
    1,
    CORE_64_BIT_INTEGER_MAX_ON_JSON_WIRE,
  );
  if (!defaultMethods || !overrides || !defaultDialCodes || !dialOverrides || !policyRevision) {
    return null;
  }

  const configuration: AuthPolicyConfiguration = {
    defaultMethods: defaultMethods.value,
    methodOverrides: overrides.value,
    defaultDialCodes: defaultDialCodes.value,
    dialCodeOverrides: dialOverrides.value,
    revision: policyRevision.value,
    updatedAt: policyRevision.updatedAt,
    updatedBy: policyRevision.updatedBy,
  };
  return authPolicyDraftIssue(configuration) === null ? configuration : null;
}

function rowsIssue<T extends { storefront: string }>(rows: readonly T[]): AuthPolicyDraftIssue | null {
  if (rows.length > COUNTRY_CATALOG.length) return "storefront";
  const seen = new Set<string>();
  for (const row of rows) {
    if (!storefront(row.storefront)) return "storefront";
    if (seen.has(row.storefront)) return "duplicateStorefront";
    seen.add(row.storefront);
  }
  return null;
}

export function authPolicyDraftIssue(value: AuthPolicyConfiguration): AuthPolicyDraftIssue | null {
  if (!methods(value.defaultMethods)) return "noMethod";
  if (!value.defaultMethods.phone && !value.defaultMethods.email) return "noMethod";

  const methodRowsIssue = rowsIssue(value.methodOverrides);
  if (methodRowsIssue) return methodRowsIssue;
  if (value.methodOverrides.some((row) => methods({ phone: row.phone, email: row.email }) === null)) {
    return "storefront";
  }

  if (dialCodeRule(value.defaultDialCodes) === null) return "dialCodes";
  const dialRowsIssue = rowsIssue(value.dialCodeOverrides);
  if (dialRowsIssue) return dialRowsIssue;
  if (value.dialCodeOverrides.some((row) => dialCodeRule(row.dialCodes) === null)) {
    return "dialCodes";
  }
  return revision(value.revision) === null ? "revision" : null;
}

/** The browser sends the four editable values; Core exclusively owns the revision. */
export function authPolicySavePayload(value: AuthPolicyConfiguration): Record<string, unknown> | null {
  if (authPolicyDraftIssue(value)) return null;
  const methodRows = [...value.methodOverrides].sort(
    (left, right) => left.storefront.localeCompare(right.storefront),
  );
  const dialRows = [...value.dialCodeOverrides].sort(
    (left, right) => left.storefront.localeCompare(right.storefront),
  );
  return {
    auth_policy_default: { ...value.defaultMethods },
    auth_policy_overrides: Object.fromEntries(methodRows.map((row) => [
      row.storefront,
      { phone: row.phone, email: row.email },
    ])),
    phone_dial_codes_default: value.defaultDialCodes === "ALL"
      ? "ALL"
      : [...value.defaultDialCodes].sort((left, right) => Number(left) - Number(right)),
    phone_dial_codes_overrides: Object.fromEntries(dialRows.map((row) => [
      row.storefront,
      row.dialCodes === "ALL"
        ? "ALL"
        : [...row.dialCodes].sort((left, right) => Number(left) - Number(right)),
    ])),
  };
}

function authPolicySaveMaterial(value: unknown): Record<string, unknown> | null {
  const settings = record(value);
  if (!settings) return null;
  const defaultMethods = methods(settings.auth_policy_default);
  const overrides = methodOverrides(settings.auth_policy_overrides);
  const defaultDialCodes = dialCodeRule(settings.phone_dial_codes_default);
  const dialOverrides = dialCodeOverrides(settings.phone_dial_codes_overrides);
  if (
    !defaultMethods
    || !overrides
    || defaultDialCodes === null
    || !dialOverrides
  ) return null;
  return authPolicySavePayload({
    defaultMethods,
    methodOverrides: overrides,
    defaultDialCodes,
    dialCodeOverrides: dialOverrides,
    revision: 1,
    updatedAt: 0,
    updatedBy: "",
  });
}

/**
 * Close the browser-owned authentication material again at the same-origin
 * boundary. Other managed runtime keys stay additive and remain Core-owned.
 */
export function normalizeAuthPolicySettingsProxyBody(
  action: string,
  value: unknown,
): Record<string, unknown> | null | undefined {
  if (action !== "set_settings") return undefined;
  const body = exactRecord(value, ["settings"]);
  const settings = record(body?.settings);
  if (!body || !settings) return null;

  if (Object.hasOwn(settings, "auth_policy_revision")) return null;
  const presentKeys = AUTH_POLICY_EDITABLE_SETTING_KEYS.filter((key) => Object.hasOwn(settings, key));
  if (presentKeys.length !== 0 && presentKeys.length !== AUTH_POLICY_EDITABLE_SETTING_KEYS.length) {
    return null;
  }
  const authPolicy = presentKeys.length === 0 ? null : authPolicySaveMaterial(settings);
  if (presentKeys.length > 0 && !authPolicy) return null;

  const normalizedSettings = Object.assign(Object.create(null), settings, authPolicy ?? {});
  return Object.assign(Object.create(null), { settings: normalizedSettings });
}
