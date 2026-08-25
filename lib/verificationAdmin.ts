export const VERIFICATION_TAB_KEYS = [
  "scopes",
  "requirements",
  "messages",
  "badges",
  "simulator",
] as const;

export const VERIFICATION_METHODS = ["video", "persona"] as const;
export const VERIFICATION_METHOD_STATUSES = [
  "not_started",
  "pending",
  "verified",
  "rejected",
] as const;
export const VERIFICATION_LEVELS = ["none", "light", "strong"] as const;
export const VERIFICATION_REQUIREMENTS = ["inherit", "none", "light", "strong"] as const;
export const VERIFICATION_FEATURE_KEYS = [
  "people.list",
  "profile.view",
  "chat.start",
  "chat.send",
  "friend.request",
  "dates.access",
  "dates.create",
  "dates.join",
  "footprints.send",
  "album.private_request",
  "profile.public_link",
] as const;
export const VERIFICATION_GATE_VARIANTS = [
  "video",
  "persona",
  "both",
  "pending",
  "rejected",
] as const;
export const VERIFICATION_BADGE_SLOTS = ["verified", "pending", "rejected"] as const;
export const VERIFICATION_SCOPE_STATES = ["live", "draft", "off"] as const;
export const VERIFICATION_FIXTURE_SYMBOLS = [
  "video.fill",
  "person.text.rectangle.fill",
  "checkmark.shield.fill",
  "clock.fill",
  "exclamationmark.triangle.fill",
] as const;
export const VERIFICATION_GRANT_CAPABILITIES = [
  "verification_grant_read",
  "verification_grant_edit",
] as const;

export const MAX_VERIFICATION_BADGE_BYTES = 2 * 1024 * 1024;
export const VERIFICATION_FIXTURE_EVALUATED_AT = 1_787_680_000;

export type VerificationTabKey = (typeof VERIFICATION_TAB_KEYS)[number];
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];
export type VerificationMethodStatus = (typeof VERIFICATION_METHOD_STATUSES)[number];
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];
export type VerificationRequirement = (typeof VERIFICATION_REQUIREMENTS)[number];
export type VerificationFeatureKey = (typeof VERIFICATION_FEATURE_KEYS)[number];
export type VerificationGateVariant = (typeof VERIFICATION_GATE_VARIANTS)[number];
export type VerificationBadgeSlot = (typeof VERIFICATION_BADGE_SLOTS)[number];
export type VerificationScopeState = (typeof VERIFICATION_SCOPE_STATES)[number];
export type VerificationSource = "derived" | "granted" | "imported";

export type VerificationScope = {
  id: string;
  kind: "global" | "country" | "city";
  country: string | null;
  placeId: string | null;
  cityKey: string | null;
  display: string;
  publishState: VerificationScopeState;
  enabledMethods: VerificationMethod[] | null;
  defaultLevel: VerificationLevel;
  featureRequirements: Record<VerificationFeatureKey, VerificationRequirement>;
  revision: number;
};

export type VerificationGateCopyLocale = {
  iconKind: "asset" | "symbol";
  iconValue: string;
  title: string;
  subtitle: string;
  description: string;
  actionLabel: string;
  actionKind: "start_video" | "start_persona" | "open_verification_center" | "dismiss" | "url";
  actionUrl: string;
  cancelLabel: string;
};

export type VerificationGateCopyPair = {
  key: `default.${VerificationGateVariant}`;
  revision: number;
  en: VerificationGateCopyLocale;
  hu: VerificationGateCopyLocale;
};

export type VerificationBadgeFixture = {
  slot: VerificationBadgeSlot;
  managedUrl: string | null;
  mime: "image/png" | null;
};

export type VerificationUserFixture = {
  uid: number;
  evaluatedAt: number;
  scopeDisplay: string;
  enabledMethods: VerificationMethod[];
  methods: Record<VerificationMethod, VerificationMethodStatus>;
  rejection: null | {
    method: VerificationMethod;
    memberSafeReason: string;
    attempt: number;
    maxAttempts: number;
    manualReviewAvailable: boolean;
  };
  badgeVisible: boolean;
  derivedLevel: VerificationLevel;
  imported: null | {
    level: "light" | "strong";
    methodHint: "persona" | "video" | "manual";
    importedAt: number;
  };
  grant: null | {
    level: "light" | "strong";
    reason: string;
    grantedBy: string;
    grantedAt: number;
    expiresAt: number | null;
    status: "active" | "expired";
    revision: number;
  };
  effectiveLevel: VerificationLevel;
  effectiveSource: VerificationSource;
  capabilities: Array<(typeof VERIFICATION_GRANT_CAPABILITIES)[number]>;
};

type SeedCopyMessage = {
  title: string;
  subtitle: string;
  description: string;
  actionLabel: string;
  cancelLabel: string;
};

type SeedCopyMessages = Record<VerificationGateVariant, SeedCopyMessage>;

const DEFAULT_SYMBOLS: Record<VerificationGateVariant, string> = {
  video: "video.fill",
  persona: "person.text.rectangle.fill",
  both: "checkmark.shield.fill",
  pending: "clock.fill",
  rejected: "exclamationmark.triangle.fill",
};

const DEFAULT_ACTION_KINDS: Record<
  VerificationGateVariant,
  VerificationGateCopyLocale["actionKind"]
> = {
  video: "start_video",
  persona: "start_persona",
  both: "start_video",
  pending: "dismiss",
  rejected: "start_video",
};

const GATE_COPY_FIELDS = [
  "iconKind",
  "iconValue",
  "title",
  "subtitle",
  "description",
  "actionLabel",
  "actionKind",
  "actionUrl",
  "cancelLabel",
] as const;

export function verificationTabKey(value: unknown): VerificationTabKey {
  return typeof value === "string"
    ? VERIFICATION_TAB_KEYS.find((candidate) => candidate === value) ?? "scopes"
    : "scopes";
}

function requirements(
  overrides: Partial<Record<VerificationFeatureKey, VerificationRequirement>> = {},
  fallback: VerificationRequirement = "inherit",
): Record<VerificationFeatureKey, VerificationRequirement> {
  return Object.fromEntries(
    VERIFICATION_FEATURE_KEYS.map((key) => [key, overrides[key] ?? fallback]),
  ) as Record<VerificationFeatureKey, VerificationRequirement>;
}

export function verificationScopeFixtures(): VerificationScope[] {
  return [
    {
      id: "global",
      kind: "global",
      country: null,
      placeId: null,
      cityKey: null,
      display: "Global",
      publishState: "live",
      enabledMethods: ["video", "persona"],
      defaultLevel: "light",
      featureRequirements: requirements({}, "none"),
      revision: 1,
    },
    {
      id: "country:HU",
      kind: "country",
      country: "HU",
      placeId: null,
      cityKey: null,
      display: "Hungary · HU",
      publishState: "live",
      enabledMethods: null,
      defaultLevel: "light",
      featureRequirements: requirements({
        "chat.start": "light",
        "chat.send": "light",
        "dates.create": "strong",
      }),
      revision: 3,
    },
    {
      id: "city:HU:budapest",
      kind: "city",
      country: "HU",
      placeId: "fixture-budapest-place",
      cityKey: "budapest",
      display: "Budapest · HU",
      publishState: "draft",
      enabledMethods: ["persona"],
      defaultLevel: "light",
      featureRequirements: requirements({
        "people.list": "light",
        "dates.access": "strong",
      }),
      revision: 2,
    },
    {
      id: "country:DE",
      kind: "country",
      country: "DE",
      placeId: null,
      cityKey: null,
      display: "Germany · DE",
      publishState: "live",
      enabledMethods: ["video"],
      defaultLevel: "light",
      featureRequirements: requirements(),
      revision: 1,
    },
    {
      id: "country:PL",
      kind: "country",
      country: "PL",
      placeId: null,
      cityKey: null,
      display: "Poland · PL",
      publishState: "draft",
      enabledMethods: ["video", "persona"],
      defaultLevel: "none",
      featureRequirements: requirements(),
      revision: 1,
    },
    {
      id: "country:RS",
      kind: "country",
      country: "RS",
      placeId: null,
      cityKey: null,
      display: "Serbia · RS",
      publishState: "off",
      enabledMethods: [],
      defaultLevel: "none",
      featureRequirements: requirements(),
      revision: 1,
    },
  ];
}

export function verificationBadgeFixtures(): VerificationBadgeFixture[] {
  return VERIFICATION_BADGE_SLOTS.map((slot) => ({ slot, managedUrl: null, mime: null }));
}

export function verificationUserFixture(
  uid: number,
  reason: string,
  rejectionReason: string,
): VerificationUserFixture {
  return {
    uid,
    evaluatedAt: VERIFICATION_FIXTURE_EVALUATED_AT,
    scopeDisplay: "Hungary · HU",
    enabledMethods: ["video", "persona"],
    methods: { video: "rejected", persona: "pending" },
    rejection: {
      method: "video",
      memberSafeReason: rejectionReason,
      attempt: 2,
      maxAttempts: 5,
      manualReviewAvailable: true,
    },
    badgeVisible: true,
    derivedLevel: "none",
    imported: null,
    grant: {
      level: "strong",
      reason,
      grantedBy: "operator@example.test",
      grantedAt: VERIFICATION_FIXTURE_EVALUATED_AT - 3_600,
      expiresAt: null,
      status: "active",
      revision: 1,
    },
    effectiveLevel: "strong",
    effectiveSource: "granted",
    capabilities: [...VERIFICATION_GRANT_CAPABILITIES],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function seedMessages(value: unknown): SeedCopyMessages | null {
  if (!isRecord(value) || !exactKeys(value, VERIFICATION_GATE_VARIANTS)) return null;
  const result = {} as SeedCopyMessages;
  const fields = ["title", "subtitle", "description", "actionLabel", "cancelLabel"] as const;
  for (const variant of VERIFICATION_GATE_VARIANTS) {
    const raw = value[variant];
    if (!isRecord(raw) || !exactKeys(raw, fields)) return null;
    const message = {} as SeedCopyMessage;
    for (const field of fields) {
      if (typeof raw[field] !== "string") return null;
      message[field] = raw[field];
    }
    result[variant] = message;
  }
  return result;
}

export function verificationSeedCopyPairs(
  english: unknown,
  hungarian: unknown,
): VerificationGateCopyPair[] | null {
  const en = seedMessages(english);
  const hu = seedMessages(hungarian);
  if (!en || !hu) return null;
  const pairs = VERIFICATION_GATE_VARIANTS.map((variant) => ({
    key: `default.${variant}` as const,
    revision: 1,
    en: {
      iconKind: "symbol" as const,
      iconValue: DEFAULT_SYMBOLS[variant],
      ...en[variant],
      actionKind: DEFAULT_ACTION_KINDS[variant],
      actionUrl: "",
    },
    hu: {
      iconKind: "symbol" as const,
      iconValue: DEFAULT_SYMBOLS[variant],
      ...hu[variant],
      actionKind: DEFAULT_ACTION_KINDS[variant],
      actionUrl: "",
    },
  }));
  return pairs.every((pair) => (
    verificationGateCopyErrors(pair.en).length === 0
    && verificationGateCopyErrors(pair.hu).length === 0
  )) ? pairs : null;
}

export function verificationTextLength(value: string): number {
  return Array.from(value.trim().normalize("NFC")).length;
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

function canonicalPlainText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const canonical = value.trim().normalize("NFC");
  if (value !== canonical) return null;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) return null;
  if (hasUnpairedSurrogate(value)) return null;
  return canonical;
}

function safeHttpsUrl(value: string): boolean {
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && Boolean(url.hostname)
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function verificationGateCopyErrors(copy: VerificationGateCopyLocale): string[] {
  const errors: string[] = [];
  if (!isRecord(copy) || !exactKeys(copy, GATE_COPY_FIELDS)) return ["shape"];
  const fields: Array<[keyof VerificationGateCopyLocale, number, boolean]> = [
    ["title", 80, true],
    ["subtitle", 120, false],
    ["description", 600, false],
    ["actionLabel", 40, true],
    ["cancelLabel", 40, true],
  ];
  for (const [field, maximum, required] of fields) {
    const value = canonicalPlainText(copy[field]);
    if (value === null) {
      errors.push(field);
      continue;
    }
    const length = verificationTextLength(value);
    if ((required && length < 1) || length > maximum) errors.push(field);
  }
  if (copy.iconKind !== "symbol" && copy.iconKind !== "asset") {
    errors.push("iconKind");
  } else if (copy.iconKind === "symbol" && !VERIFICATION_FIXTURE_SYMBOLS.some((symbol) => symbol === copy.iconValue)) {
    errors.push("iconValue");
  } else if (copy.iconKind === "asset" && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(copy.iconValue)) {
    errors.push("iconValue");
  }
  if (!["start_video", "start_persona", "open_verification_center", "dismiss", "url"].includes(copy.actionKind)) {
    errors.push("actionKind");
  } else if (copy.actionKind === "url") {
    if (!safeHttpsUrl(copy.actionUrl)) errors.push("actionUrl");
  } else if (copy.actionUrl !== "") {
    errors.push("actionUrl");
  }
  return [...new Set(errors)];
}

export function verificationIsoCountry(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/u.test(normalized) ? normalized : null;
}

export function verificationScopeDraftError(scope: VerificationScope): string | null {
  if (scope.kind === "global") {
    if (
      scope.id !== "global"
      || scope.country !== null
      || scope.placeId !== null
      || scope.cityKey !== null
      || scope.publishState !== "live"
    ) {
      return "global";
    }
  } else {
    if (!scope.country || verificationIsoCountry(scope.country) !== scope.country) return "country";
    if (scope.kind === "country" && (scope.placeId !== null || scope.cityKey !== null)) return "country";
    if (scope.kind === "city" && (
      !scope.placeId
      || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(scope.cityKey ?? "")
      || verificationTextLength(scope.display) < 1
    )) return "city";
  }
  if (!VERIFICATION_SCOPE_STATES.includes(scope.publishState)) return "state";
  if (!VERIFICATION_LEVELS.includes(scope.defaultLevel)) return "level";
  if (scope.enabledMethods !== null) {
    if (new Set(scope.enabledMethods).size !== scope.enabledMethods.length) {
      return "methods";
    }
    if (scope.enabledMethods.some((method) => !VERIFICATION_METHODS.includes(method))) return "methods";
  } else if (scope.kind === "global") return "methods";
  if (scope.enabledMethods?.length === 0 && scope.defaultLevel !== "none") return "guardrail";
  if (scope.publishState === "off" && scope.defaultLevel !== "none") return "guardrail";
  if (!exactKeys(scope.featureRequirements, VERIFICATION_FEATURE_KEYS)) return "features";
  for (const requirement of Object.values(scope.featureRequirements)) {
    if (!VERIFICATION_REQUIREMENTS.includes(requirement)) return "features";
    if (scope.kind === "global" && requirement === "inherit") return "features";
  }
  return null;
}

export function verificationEffectiveMethods(
  scope: VerificationScope,
  allScopes: readonly VerificationScope[],
): VerificationMethod[] {
  if (scope.publishState === "off") return [];
  if (scope.enabledMethods) return [...scope.enabledMethods];
  const country = scope.country
    ? allScopes.find((candidate) => (
      candidate.kind === "country"
      && candidate.country === scope.country
      && candidate.publishState !== "off"
    ))
    : null;
  if (country?.enabledMethods) return [...country.enabledMethods];
  return [...(allScopes.find((candidate) => candidate.kind === "global")?.enabledMethods ?? [])];
}

export function verificationEffectiveRequirement(
  scope: VerificationScope,
  feature: VerificationFeatureKey,
  allScopes: readonly VerificationScope[],
): { value: Exclude<VerificationRequirement, "inherit">; sourceId: string } | null {
  if (verificationEffectiveMethods(scope, allScopes).length === 0) {
    return { value: "none", sourceId: scope.id };
  }
  const current = scope.featureRequirements[feature];
  if (current !== "inherit") return { value: current, sourceId: scope.id };
  const country = scope.country
    ? allScopes.find((candidate) => (
      candidate.kind === "country"
      && candidate.country === scope.country
      && candidate.publishState !== "off"
    ))
    : null;
  if (country && country.id !== scope.id) {
    const inherited = country.featureRequirements[feature];
    if (inherited !== "inherit") return { value: inherited, sourceId: country.id };
  }
  const global = allScopes.find((candidate) => candidate.kind === "global");
  const fallback = global?.featureRequirements[feature];
  return fallback && fallback !== "inherit" ? { value: fallback, sourceId: "global" } : null;
}

const LEVEL_RANK: Record<VerificationLevel, number> = { none: 0, light: 1, strong: 2 };

export function verificationMaxLevel(...levels: VerificationLevel[]): VerificationLevel {
  return levels.reduce((highest, level) => (
    LEVEL_RANK[level] > LEVEL_RANK[highest] ? level : highest
  ), "none" as VerificationLevel);
}

export function verificationDerivedLevel(
  methods: readonly VerificationMethod[],
  statuses: Record<VerificationMethod, VerificationMethodStatus>,
): VerificationLevel {
  const personaVerified = methods.includes("persona") && statuses.persona === "verified";
  if (personaVerified) return "strong";
  const anyVerified = methods.some((method) => statuses[method] === "verified");
  if (!anyVerified) return "none";
  return methods.length === 1 ? "strong" : "light";
}

export function verificationTierLanguageEnabled(
  methods: readonly VerificationMethod[],
): boolean {
  return methods.length > 1;
}

export function verificationGrantDraftError(
  draft: { level: string; reason: string; expiresAt: number | null },
  evaluatedAt: number,
): "level" | "reason" | "expiry" | null {
  if (draft.level !== "light" && draft.level !== "strong") return "level";
  const reason = canonicalPlainText(draft.reason);
  if (reason === null) return "reason";
  const reasonLength = verificationTextLength(reason);
  if (reasonLength < 1 || reasonLength > 300) return "reason";
  if (draft.expiresAt !== null && (!Number.isInteger(draft.expiresAt) || draft.expiresAt <= evaluatedAt)) {
    return "expiry";
  }
  return null;
}

export function verificationBadgeFileError(file: {
  size: number;
  type: string;
}): "empty" | "size" | "type" | null {
  if (!Number.isInteger(file.size) || file.size < 1) return "empty";
  if (file.size > MAX_VERIFICATION_BADGE_BYTES) return "size";
  if (file.type !== "image/png") return "type";
  return null;
}
