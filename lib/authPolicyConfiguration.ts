import { webadminEnvelope } from "@/lib/webadminEnvelope";

export const AUTH_POLICY_EDITABLE_SETTING_KEYS = [
  "auth_policy_default",
  "auth_policy_overrides",
  "phone_dial_codes_default",
  "phone_dial_codes_overrides",
  "phone_dial_formats",
  "phone_regions_default",
  "phone_regions_overrides",
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

export type RegionRule = "ALL" | string[];

export type AuthMethodOverride = AuthMethods & {
  storefront: string;
};

type DialCodeOverride = {
  storefront: string;
  dialCodes: DialCodeRule;
};

export type RegionOverride = {
  storefront: string;
  regions: RegionRule;
};

export type PhoneDialFormat = {
  code: string;
  mask: string;
};

export type AuthPolicyConfiguration = {
  defaultMethods: AuthMethods;
  methodOverrides: AuthMethodOverride[];
  defaultRegions: RegionRule;
  regionOverrides: RegionOverride[];
  phoneDialFormats: PhoneDialFormat[];
  vocabulary: AuthPolicyVocabulary;
  vocabularyWarnings: AuthPolicyVocabularyWarning[];
  revision: number;
  updatedAt: number;
  updatedBy: string;
};

export type AuthPolicyDraftIssue =
  | "noMethod"
  | "storefront"
  | "duplicateStorefront"
  | "regions"
  | "vocabulary"
  | "dialFormatCode"
  | "duplicateDialFormat"
  | "dialFormatMask"
  | "revision";

export type PhoneDialFormatRefusal = {
  field: "phone_dial_formats" | "code" | "mask";
  index: number | null;
};

export type PhoneRegionRefusal = {
  setting: "phone_regions_default" | "phone_regions_overrides";
  storefront: string | null;
  index: number | null;
};

export type AuthPolicyConflict = {
  currentRevision: number;
};

export type AuthPolicyStorefront = {
  alpha3: string;
  nameEn: string;
  nameHu: string;
};

export type AuthPolicyCallingCode = {
  code: string;
  exampleAlpha3: string;
};

export type AuthPolicyRegion = {
  alpha2: string;
  alpha3: string;
  callingCode: string;
};

export type AuthPolicyVocabulary = {
  storefronts: AuthPolicyStorefront[];
  callingCodes: AuthPolicyCallingCode[];
  regions: AuthPolicyRegion[];
};

export type LocalizedAuthPolicyStorefront = {
  alpha3: string;
  name: string;
};

export type LocalizedAuthPolicyCallingCode = AuthPolicyCallingCode & {
  exampleName: string;
};

export type LocalizedAuthPolicyRegion = AuthPolicyRegion & {
  name: string;
};

export type AuthPolicyVocabularyWarning = {
  setting: (typeof AUTH_POLICY_EDITABLE_SETTING_KEYS)[number];
  codes: string[];
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
const ADMIN_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Core publishes PHP_INT_MAX. JSON.parse rounds that 64-bit value to this
// exact JavaScript number, so the consumer closes on the observed wire value.
const CORE_64_BIT_INTEGER_MAX_ON_JSON_WIRE = 9_223_372_036_854_776_000;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

// Exact records are reserved for browser-owned save material; Core reads use requiredRecord.
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

const PHONE_DIAL_FORMAT_NON_DIGIT = /[^0-9]/;
const PHONE_DIAL_MASK_FORBIDDEN_CHARACTER = /[^* ()\-./]/;
const PHONE_DIAL_FORMAT_FIELD = /^phone_dial_formats\.(0|[1-9]\d*)\.(code|mask)(?![\s\S])/;
const PHONE_REGION_DEFAULT_FIELD = /^phone_regions_default(?:\.(0|[1-9]\d*))?(?![\s\S])/;
const PHONE_REGION_OVERRIDE_FIELD = /^phone_regions_overrides\.([A-Z]{3})(?:\.(0|[1-9]\d*))?(?![\s\S])/;

export const PHONE_DIAL_FORMAT_MAX_LENGTH = 32;

export function localizedAuthPolicyStorefronts(
  vocabulary: AuthPolicyVocabulary,
  locale: string,
): LocalizedAuthPolicyStorefront[] {
  const useHungarian = locale === "hu";
  const collator = new Intl.Collator(useHungarian ? "hu" : "en", { sensitivity: "base" });
  return vocabulary.storefronts.map((storefront) => ({
    alpha3: storefront.alpha3,
    name: useHungarian ? storefront.nameHu : storefront.nameEn,
  })).sort((left, right) => collator.compare(left.name, right.name));
}

export function localizedAuthPolicyCallingCodes(
  vocabulary: AuthPolicyVocabulary,
  locale: string,
): LocalizedAuthPolicyCallingCode[] {
  const storefronts = new Map(localizedAuthPolicyStorefronts(vocabulary, locale)
    .map((storefront) => [storefront.alpha3, storefront.name]));
  return vocabulary.callingCodes.map((callingCode) => ({
    ...callingCode,
    exampleName: storefronts.get(callingCode.exampleAlpha3) ?? callingCode.exampleAlpha3,
  }));
}

export function localizedAuthPolicyRegions(
  vocabulary: AuthPolicyVocabulary,
  locale: string,
): LocalizedAuthPolicyRegion[] {
  const storefronts = new Map(localizedAuthPolicyStorefronts(vocabulary, locale)
    .map((storefront) => [storefront.alpha3, storefront.name]));
  const collator = new Intl.Collator(locale === "hu" ? "hu" : "en", { sensitivity: "base" });
  return vocabulary.regions.map((region) => ({
    ...region,
    name: storefronts.get(region.alpha3) ?? region.alpha3,
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
  const source = requiredRecord(value, SETTING_KEYS);
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

function storefrontCode(value: unknown): string | null {
  return typeof value === "string"
    && /^[A-Z]{3}$/.test(value)
    && value !== "ALL"
    ? value
    : null;
}

function regionCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z]{2}$/.test(value) ? value : null;
}

function vocabulary(value: unknown): AuthPolicyVocabulary | null {
  const source = exactRecord(value, ["storefronts", "calling_codes", "regions"]);
  if (
    !source
    || !Array.isArray(source.storefronts)
    || !Array.isArray(source.calling_codes)
    || !Array.isArray(source.regions)
  ) {
    return null;
  }

  const storefronts: AuthPolicyStorefront[] = [];
  const storefrontCodes = new Set<string>();
  let previousStorefront = "";
  for (const entry of source.storefronts) {
    const row = exactRecord(entry, ["alpha3", "name_en", "name_hu"]);
    const alpha3 = storefrontCode(row?.alpha3);
    if (
      !row
      || !alpha3
      || typeof row.name_en !== "string"
      || row.name_en.length === 0
      || row.name_en.length > 128
      || row.name_en !== row.name_en.trim()
      || typeof row.name_hu !== "string"
      || row.name_hu.length === 0
      || row.name_hu.length > 128
      || row.name_hu !== row.name_hu.trim()
      || alpha3.localeCompare(previousStorefront) <= 0
    ) return null;
    storefronts.push({ alpha3, nameEn: row.name_en, nameHu: row.name_hu });
    storefrontCodes.add(alpha3);
    previousStorefront = alpha3;
  }
  if (storefronts.length === 0 || storefronts.length > 512) return null;

  const callingCodes: AuthPolicyCallingCode[] = [];
  let previousCallingCode = 0;
  for (const entry of source.calling_codes) {
    const row = exactRecord(entry, ["code", "example_alpha3"]);
    const code = phoneDialFormatCode(row?.code);
    const exampleAlpha3 = storefrontCode(row?.example_alpha3);
    if (
      !row
      || !code
      || Number(code) <= previousCallingCode
      || !exampleAlpha3
      || !storefrontCodes.has(exampleAlpha3)
    ) return null;
    callingCodes.push({ code, exampleAlpha3 });
    previousCallingCode = Number(code);
  }
  if (callingCodes.length === 0 || callingCodes.length > 1000) return null;

  const callingCodeSet = new Set(callingCodes.map((entry) => entry.code));
  const regions: AuthPolicyRegion[] = [];
  const regionStorefronts = new Set<string>();
  let previousRegion = "";
  for (const entry of source.regions) {
    const row = exactRecord(entry, ["alpha2", "alpha3", "calling_code"]);
    const alpha2 = regionCode(row?.alpha2);
    const alpha3 = storefrontCode(row?.alpha3);
    const callingCode = phoneDialFormatCode(row?.calling_code);
    if (
      !row
      || !alpha2
      || alpha2.localeCompare(previousRegion) <= 0
      || !alpha3
      || !storefrontCodes.has(alpha3)
      || regionStorefronts.has(alpha3)
      || !callingCode
      || !callingCodeSet.has(callingCode)
    ) return null;
    regions.push({ alpha2, alpha3, callingCode });
    regionStorefronts.add(alpha3);
    previousRegion = alpha2;
  }
  if (
    regions.length === 0
    || regions.length > 512
    || regions.length !== storefronts.length
    || regionStorefronts.size !== storefrontCodes.size
  ) return null;
  return { storefronts, callingCodes, regions };
}

export function authPolicyVocabularyResponse(value: unknown): AuthPolicyVocabulary | null {
  const envelope = webadminEnvelope(value, true, ["vocabulary"]);
  return envelope?.status_code === 200 ? vocabulary(envelope.vocabulary) : null;
}

function settingVocabularyMetadata(value: unknown): string[] | null {
  const source = requiredRecord(value, ["warning", "invalid_codes"]);
  if (!source || typeof source.warning !== "boolean" || !Array.isArray(source.invalid_codes)) {
    return null;
  }
  const codes: string[] = [];
  let previous = "";
  for (const code of source.invalid_codes) {
    if (
      typeof code !== "string"
      || (
        storefrontCode(code) === null
        && phoneDialFormatCode(code) === null
        && regionCode(code) === null
      )
      || code.localeCompare(previous) <= 0
    ) return null;
    codes.push(code);
    previous = code;
  }
  return source.warning === (codes.length > 0) ? codes : null;
}

function methods(value: unknown, exact = false): AuthMethods | null {
  // Browser-owned save material stays exact so no undeclared field can be forwarded to Core.
  const source = exact ? exactRecord(value, METHOD_KEYS) : requiredRecord(value, METHOD_KEYS);
  return source
    && typeof source.phone === "boolean"
    && typeof source.email === "boolean"
    ? { phone: source.phone, email: source.email }
    : null;
}

function methodOverrides(value: unknown, exact = false): AuthMethodOverride[] | null {
  // Core's associative PHP array becomes `[]` when the map is empty. Accept
  // only that exact wire ambiguity; a populated list is never an override map.
  if (Array.isArray(value)) return value.length === 0 ? [] : null;
  const source = record(value);
  if (!source || Object.keys(source).length > 512) return null;
  const output: AuthMethodOverride[] = [];
  for (const [rawStorefront, rawMethods] of Object.entries(source)) {
    const parsedStorefront = storefrontCode(rawStorefront);
    const parsedMethods = methods(rawMethods, exact);
    if (!parsedStorefront || !parsedMethods) return null;
    output.push({ storefront: parsedStorefront, ...parsedMethods });
  }
  return output.sort((left, right) => left.storefront.localeCompare(right.storefront));
}

function dialCodeRule(value: unknown): DialCodeRule | null {
  if (value === "ALL") return "ALL";
  if (!Array.isArray(value) || value.length > 1000) return null;
  const output: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const code = phoneDialFormatCode(entry);
    if (!code || seen.has(code)) return null;
    seen.add(code);
    output.push(code);
  }
  return output.sort((left, right) => Number(left) - Number(right));
}

function regionRule(value: unknown): RegionRule | null {
  if (value === "ALL") return "ALL";
  if (!Array.isArray(value) || value.length > 512) return null;
  const output: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const region = regionCode(entry);
    if (!region || seen.has(region)) return null;
    seen.add(region);
    output.push(region);
  }
  return output.sort((left, right) => left.localeCompare(right));
}

function regionOverrides(value: unknown): RegionOverride[] | null {
  // Same PHP empty-map representation as the other override families.
  if (Array.isArray(value)) return value.length === 0 ? [] : null;
  const source = record(value);
  if (!source || Object.keys(source).length > 512) return null;
  const output: RegionOverride[] = [];
  for (const [rawStorefront, rawRegions] of Object.entries(source)) {
    const parsedStorefront = storefrontCode(rawStorefront);
    const parsedRegions = regionRule(rawRegions);
    if (!parsedStorefront || parsedRegions === null) return null;
    output.push({ storefront: parsedStorefront, regions: parsedRegions });
  }
  return output.sort((left, right) => left.storefront.localeCompare(right.storefront));
}

export function authPolicyDialCodesForRegions(
  value: RegionRule,
  authVocabulary: AuthPolicyVocabulary,
): DialCodeRule | null {
  if (value === "ALL") return "ALL";
  const regionMap = new Map(authVocabulary.regions.map((region) => [region.alpha2, region.callingCode]));
  const codes: string[] = [];
  const seenRegions = new Set<string>();
  for (const region of value) {
    if (seenRegions.has(region)) return null;
    const callingCode = regionMap.get(region);
    if (!callingCode) return null;
    seenRegions.add(region);
    codes.push(callingCode);
  }
  // A complete country selection means ALL semantically, not merely the
  // vocabulary's current 249 entries. Keep that intent across vocabulary growth.
  if (seenRegions.size === authVocabulary.regions.length) return "ALL";
  return [...new Set(codes)].sort((left, right) => Number(left) - Number(right));
}

function canonicalRegionRule(
  value: RegionRule,
  authVocabulary: AuthPolicyVocabulary,
): RegionRule | null {
  const parsed = regionRule(value);
  if (parsed === null) return null;
  if (parsed === "ALL") return "ALL";
  const dialCodes = authPolicyDialCodesForRegions(parsed, authVocabulary);
  if (dialCodes === null) return null;
  return dialCodes === "ALL" ? "ALL" : parsed;
}

type DerivedCountryRule = {
  regions: RegionRule;
  dialCodes: DialCodeRule;
};

function derivedCountryRule(
  value: RegionRule,
  authVocabulary: AuthPolicyVocabulary,
): DerivedCountryRule | null {
  const regions = canonicalRegionRule(value, authVocabulary);
  if (regions === null) return null;
  const dialCodes = authPolicyDialCodesForRegions(regions, authVocabulary);
  return dialCodes === null ? null : { regions, dialCodes };
}

export function authPolicySelectedCallingCodes(value: AuthPolicyConfiguration): string[] {
  const rules = [value.defaultRegions, ...value.regionOverrides.map((row) => row.regions)];
  return [...new Set(rules.flatMap((rule) => {
    const codes = authPolicyDialCodesForRegions(rule, value.vocabulary);
    return codes === null || codes === "ALL" ? [] : codes;
  }))].sort((left, right) => Number(left) - Number(right));
}

function phoneDialFormatCode(value: unknown): string | null {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 3
    && value[0] !== "0"
    && !PHONE_DIAL_FORMAT_NON_DIGIT.test(value)
    ? value
    : null;
}

export function phoneDialMaskValid(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= PHONE_DIAL_FORMAT_MAX_LENGTH
    && value.includes("*")
    && !PHONE_DIAL_MASK_FORBIDDEN_CHARACTER.test(value);
}

function phoneDialFormats(value: unknown, exact = false): PhoneDialFormat[] | null {
  if (!Array.isArray(value)) return null;
  const output: PhoneDialFormat[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const source = exact
      ? exactRecord(entry, ["code", "mask"])
      : requiredRecord(entry, ["code", "mask"]);
    const code = phoneDialFormatCode(source?.code);
    if (!source || !code || seen.has(code) || !phoneDialMaskValid(source.mask)) return null;
    seen.add(code);
    output.push({ code, mask: source.mask });
  }
  return output.sort((left, right) => Number(left.code) - Number(right.code));
}

function phoneDialFormatsIssue(
  value: readonly PhoneDialFormat[],
): Extract<AuthPolicyDraftIssue, "dialFormatCode" | "duplicateDialFormat" | "dialFormatMask"> | null {
  if (!Array.isArray(value)) return "dialFormatCode";
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || phoneDialFormatCode(entry.code) === null) return "dialFormatCode";
    if (seen.has(entry.code)) return "duplicateDialFormat";
    seen.add(entry.code);
    if (!phoneDialMaskValid(entry.mask)) return "dialFormatMask";
  }
  return null;
}

export function updatePhoneDialFormat(
  formats: readonly PhoneDialFormat[],
  code: string,
  mask: string,
): PhoneDialFormat[] {
  const next = formats.filter((entry) => entry.code !== code);
  if (mask !== "") next.push({ code, mask });
  return next.sort((left, right) => Number(left.code) - Number(right.code));
}

export function phoneDialFormatMask(
  formats: readonly PhoneDialFormat[],
  code: string,
): string {
  return formats.find((entry) => entry.code === code)?.mask ?? "";
}

export function renderPhoneDialFormatSample(code: string, mask: string): string | null {
  if (phoneDialFormatCode(code) === null || !phoneDialMaskValid(mask)) return null;
  const seed = code === "1" ? "2125550134" : "1234567890";
  let digitIndex = 0;
  return [...mask].map((character) => {
    if (character !== "*") return character;
    const digit = seed[digitIndex % seed.length];
    digitIndex += 1;
    return digit;
  }).join("");
}

/** Decode only the v1.6 setting refusal and its ruled zero-based dotted field path. */
export function phoneDialFormatRefusal(value: unknown): PhoneDialFormatRefusal | null {
  const envelope = webadminEnvelope(value, false, ["error", "field"]);
  if (!envelope || envelope.status_code !== 422 || envelope.error !== "setting-invalid") return null;
  if (envelope.field === "phone_dial_formats") {
    return { field: "phone_dial_formats", index: null };
  }
  if (typeof envelope.field !== "string") return null;
  const match = PHONE_DIAL_FORMAT_FIELD.exec(envelope.field);
  if (!match) return null;
  const index = Number(match[1]);
  if (!Number.isSafeInteger(index)) return null;
  return { field: match[2] as "code" | "mask", index };
}

/** Decode only the accepted T-516 region refusals and their dotted field paths. */
export function phoneRegionRefusal(value: unknown): PhoneRegionRefusal | null {
  const envelope = webadminEnvelope(value, false, ["error", "field"]);
  if (
    !envelope
    || envelope.status_code !== 422
    || envelope.error !== "setting-invalid"
    || typeof envelope.field !== "string"
  ) return null;

  const defaultMatch = PHONE_REGION_DEFAULT_FIELD.exec(envelope.field);
  if (defaultMatch) {
    const parsedIndex = defaultMatch[1] === undefined ? null : Number(defaultMatch[1]);
    if (parsedIndex !== null && !Number.isSafeInteger(parsedIndex)) return null;
    return {
      setting: "phone_regions_default",
      storefront: null,
      index: parsedIndex,
    };
  }

  const overrideMatch = PHONE_REGION_OVERRIDE_FIELD.exec(envelope.field);
  if (!overrideMatch) return null;
  const parsedIndex = overrideMatch[2] === undefined ? null : Number(overrideMatch[2]);
  if (parsedIndex !== null && !Number.isSafeInteger(parsedIndex)) return null;
  return {
    setting: "phone_regions_overrides",
    storefront: overrideMatch[1],
    index: parsedIndex,
  };
}

/** Decode only the optional-CAS conflict shipped by Core for auth-policy writes. */
export function authPolicyConflict(value: unknown): AuthPolicyConflict | null {
  const envelope = webadminEnvelope(value, false, ["error", "current_revision"]);
  const currentRevision = revision(envelope?.current_revision);
  return envelope
    && envelope.status_code === 409
    && envelope.error === "auth-policy-conflict"
    && currentRevision !== null
    ? { currentRevision }
    : null;
}

function dialCodeOverrides(value: unknown): DialCodeOverride[] | null {
  // Same PHP empty-map representation as auth_policy_overrides above.
  if (Array.isArray(value)) return value.length === 0 ? [] : null;
  const source = record(value);
  if (!source || Object.keys(source).length > 512) return null;
  const output: DialCodeOverride[] = [];
  for (const [rawStorefront, rawDialCodes] of Object.entries(source)) {
    const parsedStorefront = storefrontCode(rawStorefront);
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

function sortedStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

type AuthPolicyVocabularyWarningSource = Pick<AuthPolicyConfiguration,
  "methodOverrides" | "defaultRegions" | "regionOverrides" | "phoneDialFormats"> & {
    defaultDialCodes: DialCodeRule | null;
    dialCodeOverrides: DialCodeOverride[];
  };

function collectVocabularyWarnings(
  value: AuthPolicyVocabularyWarningSource,
  authVocabulary: AuthPolicyVocabulary,
): AuthPolicyVocabularyWarning[] {
  const storefronts = new Set(authVocabulary.storefronts.map((entry) => entry.alpha3));
  const callingCodes = new Set(authVocabulary.callingCodes.map((entry) => entry.code));
  const regions = new Set(authVocabulary.regions.map((entry) => entry.alpha2));
  const warnings: AuthPolicyVocabularyWarning[] = [];
  const add = (
    setting: AuthPolicyVocabularyWarning["setting"],
    codes: Iterable<string>,
  ) => {
    const sorted = sortedStrings(codes);
    if (sorted.length > 0) warnings.push({ setting, codes: sorted });
  };

  add(
    "auth_policy_overrides",
    value.methodOverrides
      .map((row) => row.storefront)
      .filter((code) => !storefronts.has(code)),
  );
  add(
    "phone_dial_codes_default",
    value.defaultDialCodes === null || value.defaultDialCodes === "ALL"
      ? []
      : value.defaultDialCodes.filter((code) => !callingCodes.has(code)),
  );
  add(
    "phone_dial_codes_overrides",
    value.dialCodeOverrides.flatMap((row) => [
      ...(storefronts.has(row.storefront) ? [] : [row.storefront]),
      ...(row.dialCodes === "ALL"
        ? []
        : row.dialCodes.filter((code) => !callingCodes.has(code))),
    ]),
  );
  add(
    "phone_dial_formats",
    value.phoneDialFormats
      .map((row) => row.code)
      .filter((code) => !callingCodes.has(code)),
  );
  add(
    "phone_regions_default",
    value.defaultRegions === "ALL"
      ? []
      : value.defaultRegions.filter((code) => !regions.has(code)),
  );
  add(
    "phone_regions_overrides",
    value.regionOverrides.flatMap((row) => [
      ...(storefronts.has(row.storefront) ? [] : [row.storefront]),
      ...(row.regions === "ALL"
        ? []
        : row.regions.filter((code) => !regions.has(code))),
    ]),
  );
  return warnings;
}

export function authPolicyVocabularyWarnings(
  value: Pick<AuthPolicyConfiguration,
    "methodOverrides" | "defaultRegions" | "regionOverrides" | "phoneDialFormats">,
  authVocabulary: AuthPolicyVocabulary,
): AuthPolicyVocabularyWarning[] {
  const defaultDialCodes = authPolicyDialCodesForRegions(value.defaultRegions, authVocabulary);
  const dialCodeOverrides = value.regionOverrides.flatMap((row): DialCodeOverride[] => {
    const dialCodes = authPolicyDialCodesForRegions(row.regions, authVocabulary);
    return dialCodes === null ? [] : [{ storefront: row.storefront, dialCodes }];
  });
  return collectVocabularyWarnings({ ...value, defaultDialCodes, dialCodeOverrides }, authVocabulary);
}

const COUNTRY_SETTING_KEYS = new Set<AuthPolicyVocabularyWarning["setting"]>([
  "phone_dial_codes_default",
  "phone_dial_codes_overrides",
  "phone_regions_default",
  "phone_regions_overrides",
]);

/**
 * Keep server-published historical warnings visible until the operator edits
 * the one country control that will replace both setting families.
 */
export function authPolicyDraftWithChanges(
  value: AuthPolicyConfiguration,
  changes: Partial<AuthPolicyConfiguration>,
): AuthPolicyConfiguration {
  const candidate = { ...value, ...changes };
  const countryControlChanged = Object.hasOwn(changes, "defaultRegions")
    || Object.hasOwn(changes, "regionOverrides");
  const computed = authPolicyVocabularyWarnings(candidate, candidate.vocabulary);
  const preserved = countryControlChanged
    ? []
    : value.vocabularyWarnings.filter((warning) => COUNTRY_SETTING_KEYS.has(warning.setting));
  const bySetting = new Map<AuthPolicyVocabularyWarning["setting"], Set<string>>();
  for (const warning of [...computed, ...preserved]) {
    const codes = bySetting.get(warning.setting) ?? new Set<string>();
    warning.codes.forEach((code) => codes.add(code));
    bySetting.set(warning.setting, codes);
  }
  const vocabularyWarnings = AUTH_POLICY_EDITABLE_SETTING_KEYS.flatMap((setting) => {
    const codes = bySetting.get(setting);
    return codes && codes.size > 0
      ? [{ setting, codes: sortedStrings(codes) }]
      : [];
  });
  return { ...candidate, vocabularyWarnings };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

/** Parse the complete managed snapshot; a partial or malformed policy never becomes an editable draft. */
export function authPolicySettingsResponse(
  value: unknown,
  fallbackVocabulary?: AuthPolicyVocabulary,
): AuthPolicyConfiguration | null {
  const envelope = webadminEnvelope(value, true, ["settings"]);
  const settings = record(envelope?.settings);
  const rawEnvelope = record(value);
  const authVocabulary = rawEnvelope && Object.hasOwn(rawEnvelope, "vocabulary")
    ? authPolicyVocabularyResponse(value)
    : fallbackVocabulary ?? null;
  if (!envelope || envelope.status_code !== 200 || !settings || !authVocabulary) return null;

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
  const dialFormats = managedSetting(
    settings.phone_dial_formats,
    phoneDialFormats,
    "phone_dial_formats",
  );
  const defaultRegions = managedSetting(
    settings.phone_regions_default,
    regionRule,
    "phone_regions",
  );
  const parsedRegionOverrides = managedSetting(
    settings.phone_regions_overrides,
    regionOverrides,
    "phone_regions_overrides",
  );
  const policyRevision = managedSetting(
    settings.auth_policy_revision,
    revision,
    "integer",
    1,
    CORE_64_BIT_INTEGER_MAX_ON_JSON_WIRE,
  );
  if (
    !defaultMethods
    || !overrides
    || !defaultDialCodes
    || !dialOverrides
    || !dialFormats
    || !defaultRegions
    || !parsedRegionOverrides
    || !policyRevision
  ) {
    return null;
  }

  const configurationWithoutWarnings = {
    defaultMethods: defaultMethods.value,
    methodOverrides: overrides.value,
    defaultRegions: defaultRegions.value,
    regionOverrides: parsedRegionOverrides.value,
    phoneDialFormats: dialFormats.value,
  };
  if (!configurationWithoutWarnings.defaultMethods.phone
    && !configurationWithoutWarnings.defaultMethods.email) return null;

  const vocabularyWarnings = collectVocabularyWarnings({
    ...configurationWithoutWarnings,
    defaultDialCodes: defaultDialCodes.value,
    dialCodeOverrides: dialOverrides.value,
  }, authVocabulary);
  const expectedWarnings = new Map(vocabularyWarnings.map((warning) => [warning.setting, warning.codes]));
  for (const key of AUTH_POLICY_EDITABLE_SETTING_KEYS) {
    const published = settingVocabularyMetadata(settings[key]);
    if (!published || !sameStrings(published, expectedWarnings.get(key) ?? [])) return null;
  }

  return {
    ...configurationWithoutWarnings,
    vocabulary: authVocabulary,
    vocabularyWarnings,
    revision: policyRevision.value,
    updatedAt: policyRevision.updatedAt,
    updatedBy: policyRevision.updatedBy,
  };
}

function rowsIssue<T extends { storefront: string }>(
  rows: readonly T[],
  authVocabulary: AuthPolicyVocabulary,
): AuthPolicyDraftIssue | null {
  const storefronts = new Set(authVocabulary.storefronts.map((entry) => entry.alpha3));
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.storefront)) return "duplicateStorefront";
    if (!storefrontCode(row.storefront) || !storefronts.has(row.storefront)) return "storefront";
    seen.add(row.storefront);
  }
  return rows.length > storefronts.size ? "storefront" : null;
}

export function authPolicyDraftIssue(value: AuthPolicyConfiguration): AuthPolicyDraftIssue | null {
  if (!methods(value.defaultMethods)) return "noMethod";
  if (!value.defaultMethods.phone && !value.defaultMethods.email) return "noMethod";

  const methodRowsIssue = rowsIssue(value.methodOverrides, value.vocabulary);
  if (methodRowsIssue) return methodRowsIssue;
  if (value.methodOverrides.some((row) => methods({ phone: row.phone, email: row.email }) === null)) {
    return "storefront";
  }

  const defaultRegions = regionRule(value.defaultRegions);
  if (
    defaultRegions === null
    || authPolicyDialCodesForRegions(defaultRegions, value.vocabulary) === null
  ) return "regions";
  const regionRowsIssue = rowsIssue(value.regionOverrides, value.vocabulary);
  if (regionRowsIssue) return regionRowsIssue;
  if (value.regionOverrides.some((row) => {
    const regions = regionRule(row.regions);
    return regions === null || authPolicyDialCodesForRegions(regions, value.vocabulary) === null;
  })) return "regions";

  const callingCodes = new Set(value.vocabulary.callingCodes.map((entry) => entry.code));
  const formatsIssue = phoneDialFormatsIssue(value.phoneDialFormats);
  if (formatsIssue) return formatsIssue;
  if (value.phoneDialFormats.some((row) => !callingCodes.has(row.code))) return "dialFormatCode";
  if (value.vocabularyWarnings.length > 0) return "vocabulary";
  return revision(value.revision) === null ? "revision" : null;
}

/** The browser sends the editable values; the revision travels as a sibling CAS field. */
export function authPolicySavePayload(value: AuthPolicyConfiguration): Record<string, unknown> | null {
  if (authPolicyDraftIssue(value)) return null;
  const methodRows = [...value.methodOverrides].sort(
    (left, right) => left.storefront.localeCompare(right.storefront),
  );
  const regionRows = [...value.regionOverrides].sort(
    (left, right) => left.storefront.localeCompare(right.storefront),
  );
  const defaultCountryRule = derivedCountryRule(value.defaultRegions, value.vocabulary);
  if (defaultCountryRule === null) return null;
  const derivedOverrides: Array<{ storefront: string; rule: DerivedCountryRule }> = [];
  for (const row of regionRows) {
    const rule = derivedCountryRule(row.regions, value.vocabulary);
    if (rule === null) return null;
    derivedOverrides.push({ storefront: row.storefront, rule });
  }
  return {
    auth_policy_default: { ...value.defaultMethods },
    auth_policy_overrides: Object.fromEntries(methodRows.map((row) => [
      row.storefront,
      { phone: row.phone, email: row.email },
    ])),
    phone_dial_codes_default: defaultCountryRule.dialCodes,
    phone_dial_codes_overrides: Object.fromEntries(derivedOverrides.map((row) => [
      row.storefront,
      row.rule.dialCodes,
    ])),
    phone_dial_formats: [...value.phoneDialFormats]
      .sort((left, right) => Number(left.code) - Number(right.code))
      .map((entry) => ({ code: entry.code, mask: entry.mask })),
    phone_regions_default: defaultCountryRule.regions,
    phone_regions_overrides: Object.fromEntries(derivedOverrides.map((row) => [
      row.storefront,
      row.rule.regions,
    ])),
  };
}

function authPolicySaveMaterial(value: unknown): Record<string, unknown> | null {
  const settings = record(value);
  if (!settings) return null;
  const defaultMethods = methods(settings.auth_policy_default, true);
  const overrides = methodOverrides(settings.auth_policy_overrides, true);
  const defaultDialCodes = dialCodeRule(settings.phone_dial_codes_default);
  const dialOverrides = dialCodeOverrides(settings.phone_dial_codes_overrides);
  const dialFormats = phoneDialFormats(settings.phone_dial_formats, true);
  const defaultRegions = regionRule(settings.phone_regions_default);
  const parsedRegionOverrides = regionOverrides(settings.phone_regions_overrides);
  if (
    !defaultMethods
    || !overrides
    || defaultDialCodes === null
    || !dialOverrides
    || !dialFormats
    || defaultRegions === null
    || !parsedRegionOverrides
  ) return null;
  if (!defaultMethods.phone && !defaultMethods.email) return null;
  if ((defaultRegions === "ALL") !== (defaultDialCodes === "ALL")) return null;
  const dialOverrideMap = new Map(dialOverrides.map((row) => [row.storefront, row.dialCodes]));
  if (
    parsedRegionOverrides.length !== dialOverrides.length
    || parsedRegionOverrides.some((row) => {
      const codes = dialOverrideMap.get(row.storefront);
      return codes === undefined || (row.regions === "ALL") !== (codes === "ALL");
    })
  ) return null;
  return {
    auth_policy_default: { ...defaultMethods },
    auth_policy_overrides: Object.fromEntries(overrides.map((row) => [
      row.storefront,
      { phone: row.phone, email: row.email },
    ])),
    phone_dial_codes_default: defaultDialCodes,
    phone_dial_codes_overrides: Object.fromEntries(dialOverrides.map((row) => [
      row.storefront,
      row.dialCodes,
    ])),
    phone_dial_formats: dialFormats.map((entry) => ({ ...entry })),
    phone_regions_default: defaultRegions,
    phone_regions_overrides: Object.fromEntries(parsedRegionOverrides.map((row) => [
      row.storefront,
      row.regions,
    ])),
  };
}

/** Rebase a stale operator draft onto an authoritative revision without discarding its edits. */
export function authPolicyDraftAfterConflict(
  draft: AuthPolicyConfiguration,
  authoritative: AuthPolicyConfiguration,
  conflict: AuthPolicyConflict,
): AuthPolicyConfiguration | null {
  if (authoritative.revision < conflict.currentRevision) return null;
  return authPolicyDraftWithChanges(draft, {
    vocabulary: authoritative.vocabulary,
    revision: authoritative.revision,
    updatedAt: authoritative.updatedAt,
    updatedBy: authoritative.updatedBy,
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
  // The same-origin command body is a closed browser/Core boundary, not a server response.
  const rawBody = record(value);
  const expectedRevisionProvided = rawBody !== null && Object.hasOwn(rawBody, "expected_revision");
  const body = exactRecord(
    value,
    expectedRevisionProvided ? ["settings", "expected_revision"] : ["settings"],
  );
  const settings = record(body?.settings);
  if (!body || !settings) return null;

  if (Object.hasOwn(settings, "auth_policy_revision")) return null;
  const presentKeys = AUTH_POLICY_EDITABLE_SETTING_KEYS.filter((key) => Object.hasOwn(settings, key));
  if (presentKeys.length !== 0 && presentKeys.length !== AUTH_POLICY_EDITABLE_SETTING_KEYS.length) {
    return null;
  }
  const authPolicy = presentKeys.length === 0 ? null : authPolicySaveMaterial(settings);
  if (presentKeys.length > 0 && !authPolicy) return null;
  const expectedRevision = expectedRevisionProvided ? revision(body.expected_revision) : null;
  if (expectedRevisionProvided && (expectedRevision === null || !authPolicy)) return null;

  const normalizedSettings = Object.assign(Object.create(null), settings, authPolicy ?? {});
  return Object.assign(
    Object.create(null),
    { settings: normalizedSettings },
    expectedRevisionProvided ? { expected_revision: expectedRevision } : {},
  );
}
