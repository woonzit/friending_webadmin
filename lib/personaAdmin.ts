import {
  webadminDataSuccessEnvelope,
  webadminErrorEnvelope,
} from "@/lib/webadminEnvelope";
import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";

/**
 * Closed consumer model for Persona Webadmin contract v1.
 *
 * The released provider remains gated by an exact runtime capability block.
 * This module contains no endpoint or credential access; it validates decoded
 * Core values, builds the exact public browser material, and supplies the
 * action-specific proxy boundary.
 */

export const PERSONA_ADMIN_CONTRACT_VERSION = 1 as const;

export const PERSONA_ADMIN_ACTIONS = [
  "persona_start_get_config_admin",
  "persona_start_update_config",
  "admin_force_persona_verify",
  "admin_apply_fake_persona",
  "admin_revoke_fake_persona",
] as const;

export type PersonaAdminAction = (typeof PERSONA_ADMIN_ACTIONS)[number];

export const PERSONA_ADMIN_CAPABILITY_ACTIONS = [
  "apply_fake",
  "revoke_fake",
  "force_verify",
  "read_start_config",
  "write_start_config",
] as const;

export type PersonaAdminCapabilityAction =
  (typeof PERSONA_ADMIN_CAPABILITY_ACTIONS)[number];

const VIEWER_ACTIONS = ["read_start_config"] as const;

export type PersonaAdminCapabilities = {
  contract_version: 1;
  contract_ready: boolean;
  can_read: true;
  can_write: boolean;
  actions: PersonaAdminCapabilityAction[];
};

export const PERSONA_START_BOOLEAN_KEYS = [
  "active",
  "progress_active",
  "trust_active",
  "safety_active",
  "skip_active",
] as const;

export const PERSONA_START_NUMBER_KEYS = ["progress_value"] as const;

export const PERSONA_START_INTEGER_KEYS = [
  "header_brand_size",
  "title_size",
  "subtitle_size",
  "benefit_title_size",
  "benefit_body_size",
  "trust_title_size",
  "trust_body_size",
  "cta_title_size",
  "secured_text_size",
  "about_title_size",
  "safety_title_size",
  "safety_body_size",
  "skip_title_size",
] as const;

export const PERSONA_START_STRING_KEYS = [
  "header_logo_url",
  "header_brand_text",
  "header_brand_color",
  "progress_filled_color",
  "progress_track_color",
  "title_main",
  "title_highlight",
  "title_color",
  "title_highlight_color",
  "subtitle_text",
  "subtitle_highlight",
  "subtitle_color",
  "subtitle_highlight_color",
  "benefit1_icon_url",
  "benefit1_icon_name",
  "benefit1_icon_color",
  "benefit1_icon_bg_color",
  "benefit1_title",
  "benefit1_body",
  "benefit2_icon_url",
  "benefit2_icon_name",
  "benefit2_icon_color",
  "benefit2_icon_bg_color",
  "benefit2_title",
  "benefit2_body",
  "benefit3_icon_url",
  "benefit3_icon_name",
  "benefit3_icon_color",
  "benefit3_icon_bg_color",
  "benefit3_title",
  "benefit3_body",
  "trust_icon_url",
  "trust_icon_name",
  "trust_icon_color",
  "trust_icon_bg_color",
  "trust_title",
  "trust_body_prefix",
  "trust_body_link_text",
  "trust_body_link_url",
  "trust_brand_logo_url",
  "trust_card_bg_color",
  "trust_text_color",
  "trust_link_color",
  "cta_title",
  "cta_icon_name",
  "cta_bg_color",
  "cta_text_color",
  "secured_text",
  "secured_text_color",
  "secured_icon_name",
  "about_title",
  "about_icon_name",
  "about_icon_color",
  "about_text_color",
  "about_pill_bg_color",
  "about_pill_border_color",
  "safety_icon_url",
  "safety_icon_name",
  "safety_icon_color",
  "safety_icon_bg_color",
  "safety_title",
  "safety_body",
  "safety_illustration_url",
  "safety_card_bg_color",
  "safety_title_color",
  "safety_body_color",
  "skip_title",
  "skip_text_color",
  "page_bg_color",
] as const;

export type PersonaStartBooleanKey = (typeof PERSONA_START_BOOLEAN_KEYS)[number];
export type PersonaStartNumberKey = (typeof PERSONA_START_NUMBER_KEYS)[number];
export type PersonaStartIntegerKey = (typeof PERSONA_START_INTEGER_KEYS)[number];
export type PersonaStartStringKey = (typeof PERSONA_START_STRING_KEYS)[number];
export type PersonaStartFieldKey =
  | PersonaStartBooleanKey
  | PersonaStartNumberKey
  | PersonaStartIntegerKey
  | PersonaStartStringKey;

export type PersonaStartConfig = {
  [Key in PersonaStartBooleanKey]: boolean;
} & {
  [Key in PersonaStartNumberKey | PersonaStartIntegerKey]: number;
} & {
  [Key in PersonaStartStringKey]: string;
};

export type PersonaStartSectionKey =
  | "general"
  | "header"
  | "title"
  | "subtitle"
  | "benefits"
  | "trust"
  | "cta"
  | "secured"
  | "about"
  | "safety"
  | "skip";

export const PERSONA_START_SECTIONS: ReadonlyArray<{
  key: PersonaStartSectionKey;
  fields: readonly PersonaStartFieldKey[];
}> = [
  { key: "general", fields: ["active", "page_bg_color"] },
  {
    key: "header",
    fields: [
      "header_logo_url",
      "header_brand_text",
      "header_brand_color",
      "header_brand_size",
      "progress_active",
      "progress_value",
      "progress_filled_color",
      "progress_track_color",
    ],
  },
  {
    key: "title",
    fields: [
      "title_main",
      "title_highlight",
      "title_color",
      "title_highlight_color",
      "title_size",
    ],
  },
  {
    key: "subtitle",
    fields: [
      "subtitle_text",
      "subtitle_highlight",
      "subtitle_color",
      "subtitle_highlight_color",
      "subtitle_size",
    ],
  },
  {
    key: "benefits",
    fields: [
      "benefit1_icon_url",
      "benefit1_icon_name",
      "benefit1_icon_color",
      "benefit1_icon_bg_color",
      "benefit1_title",
      "benefit1_body",
      "benefit2_icon_url",
      "benefit2_icon_name",
      "benefit2_icon_color",
      "benefit2_icon_bg_color",
      "benefit2_title",
      "benefit2_body",
      "benefit3_icon_url",
      "benefit3_icon_name",
      "benefit3_icon_color",
      "benefit3_icon_bg_color",
      "benefit3_title",
      "benefit3_body",
      "benefit_title_size",
      "benefit_body_size",
    ],
  },
  {
    key: "trust",
    fields: [
      "trust_active",
      "trust_icon_url",
      "trust_icon_name",
      "trust_icon_color",
      "trust_icon_bg_color",
      "trust_title",
      "trust_body_prefix",
      "trust_body_link_text",
      "trust_body_link_url",
      "trust_brand_logo_url",
      "trust_card_bg_color",
      "trust_text_color",
      "trust_link_color",
      "trust_title_size",
      "trust_body_size",
    ],
  },
  {
    key: "cta",
    fields: [
      "cta_title",
      "cta_icon_name",
      "cta_bg_color",
      "cta_text_color",
      "cta_title_size",
    ],
  },
  {
    key: "secured",
    fields: [
      "secured_text",
      "secured_text_color",
      "secured_icon_name",
      "secured_text_size",
    ],
  },
  {
    key: "about",
    fields: [
      "about_title",
      "about_icon_name",
      "about_icon_color",
      "about_text_color",
      "about_pill_bg_color",
      "about_pill_border_color",
      "about_title_size",
    ],
  },
  {
    key: "safety",
    fields: [
      "safety_active",
      "safety_icon_url",
      "safety_icon_name",
      "safety_icon_color",
      "safety_icon_bg_color",
      "safety_title",
      "safety_body",
      "safety_illustration_url",
      "safety_card_bg_color",
      "safety_title_color",
      "safety_body_color",
      "safety_title_size",
      "safety_body_size",
    ],
  },
  {
    key: "skip",
    fields: ["skip_active", "skip_title", "skip_text_color", "skip_title_size"],
  },
];

export const PERSONA_START_FIELD_KEYS = [
  ...PERSONA_START_BOOLEAN_KEYS,
  ...PERSONA_START_NUMBER_KEYS,
  ...PERSONA_START_INTEGER_KEYS,
  ...PERSONA_START_STRING_KEYS,
] as const;

const BOOLEAN_KEY_SET: ReadonlySet<string> = new Set(PERSONA_START_BOOLEAN_KEYS);
const NUMBER_KEY_SET: ReadonlySet<string> = new Set(PERSONA_START_NUMBER_KEYS);
const INTEGER_KEY_SET: ReadonlySet<string> = new Set(PERSONA_START_INTEGER_KEYS);
const STRING_KEY_SET: ReadonlySet<string> = new Set(PERSONA_START_STRING_KEYS);
const FIELD_KEY_SET: ReadonlySet<string> = new Set(PERSONA_START_FIELD_KEYS);
const PERSONA_ACTION_SET: ReadonlySet<string> = new Set(PERSONA_ADMIN_ACTIONS);

export type PersonaStartFieldKind =
  | "boolean"
  | "progress"
  | "size"
  | "url"
  | "color"
  | "icon"
  | "multiline"
  | "text";

export function personaStartFieldKind(key: PersonaStartFieldKey): PersonaStartFieldKind {
  if (BOOLEAN_KEY_SET.has(key)) return "boolean";
  if (NUMBER_KEY_SET.has(key)) return "progress";
  if (INTEGER_KEY_SET.has(key)) return "size";
  const stringKey = key as PersonaStartStringKey;
  if (personaStartStringCap(stringKey) === 1000) return "url";
  if (personaStartStringCap(stringKey) === 16) return "color";
  if (personaStartStringCap(stringKey) === 60) return "icon";
  if (key.includes("body") || key.includes("subtitle") || key === "title_main") {
    return "multiline";
  }
  return "text";
}

export function personaStartStringCap(key: PersonaStartStringKey): number {
  if (key.includes("_url") || key.endsWith("url")) return 1000;
  if (key.includes("_color")) return 16;
  if (key.includes("_icon_name")) return 60;
  if (key.includes("body")) return 600;
  if (key.includes("subtitle")) return 400;
  return 200;
}

export function personaStartHtmlMaxLength(key: PersonaStartStringKey): number {
  // HTML counts UTF-16 code units, while Core caps Unicode scalars.
  return personaStartStringCap(key) * 2;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  const source = record(value);
  if (!source) return null;
  const actual = Object.keys(source);
  if (actual.length !== keys.length) return null;
  const expected = new Set(keys);
  return actual.every((key) => expected.has(key)) ? source : null;
}

function scalarLength(value: string): number {
  return Array.from(value).length;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return true;
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return true;
    }
  }
  return false;
}

function phpTrim(value: string): string {
  // PHP trim()'s default six characters, not JavaScript's broader Unicode trim.
  return value.replace(/^[\u0000\u0009-\u000B\u000D\u0020]+|[\u0000\u0009-\u000B\u000D\u0020]+$/gu, "");
}

function containsUnsafeTextControl(value: string): boolean {
  // LF is retained for multiline copy. All other C0/C1 controls are refused.
  return /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/u.test(value);
}

function validHttpsUrl(value: string): boolean {
  if (value === "" || hasUnpairedSurrogate(value) || containsUnsafeTextControl(value)) {
    return value === "";
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && parsed.username === ""
      && parsed.password === ""
      && parsed.hostname !== "";
  } catch {
    return false;
  }
}

function normalizedString(key: PersonaStartStringKey, value: unknown): string | null {
  if (typeof value !== "string" || hasUnpairedSurrogate(value)) return null;
  const trimmed = phpTrim(value.normalize("NFC"));
  if (containsUnsafeTextControl(trimmed)) return null;
  const capped = Array.from(trimmed).slice(0, personaStartStringCap(key)).join("");
  if (personaStartStringCap(key) === 1000 && !validHttpsUrl(capped)) return null;
  return capped;
}

function strictResponseString(key: PersonaStartStringKey, value: unknown): string | null {
  if (typeof value !== "string"
    || hasUnpairedSurrogate(value)
    || containsUnsafeTextControl(value)
    || scalarLength(value) > personaStartStringCap(key)) return null;
  if (personaStartStringCap(key) === 1000 && !validHttpsUrl(value)) return null;
  return value;
}

function configFrom(value: unknown, normalize: boolean): PersonaStartConfig | null {
  const source = exactObject(value, PERSONA_START_FIELD_KEYS);
  if (!source) return null;
  const output = Object.create(null) as Record<string, string | number | boolean>;

  for (const key of PERSONA_START_BOOLEAN_KEYS) {
    if (typeof source[key] !== "boolean") return null;
    output[key] = source[key];
  }

  const progress = source.progress_value;
  if (typeof progress !== "number" || !Number.isFinite(progress)) return null;
  // Core's Persona configuration contract casts this field to a JSON number; it does
  // not clamp it to 0...1. The editor may suggest a usual proportion without
  // rejecting or silently changing an authoritative contract-legal value.
  output.progress_value = progress;

  for (const key of PERSONA_START_INTEGER_KEYS) {
    const valueAtKey = source[key];
    if (typeof valueAtKey !== "number" || !Number.isFinite(valueAtKey)) return null;
    if (!normalize && (!Number.isInteger(valueAtKey) || valueAtKey < 8 || valueAtKey > 80)) {
      return null;
    }
    output[key] = normalize
      ? Math.max(8, Math.min(80, Math.trunc(valueAtKey)))
      : valueAtKey;
  }

  for (const key of PERSONA_START_STRING_KEYS) {
    const parsed = normalize
      ? normalizedString(key, source[key])
      : strictResponseString(key, source[key]);
    if (parsed === null) return null;
    output[key] = parsed;
  }

  return output as PersonaStartConfig;
}

export function personaStartConfig(value: unknown): PersonaStartConfig | null {
  return configFrom(value, false);
}

export function normalizePersonaStartDraft(value: unknown): PersonaStartConfig | null {
  return configFrom(value, true);
}

export function clonePersonaStartConfig(value: PersonaStartConfig): PersonaStartConfig {
  return { ...value };
}

export function personaStartDraftWithValue(
  current: PersonaStartConfig,
  key: PersonaStartFieldKey,
  value: string | number | boolean,
): PersonaStartConfig {
  const next = { ...current } as Record<string, string | number | boolean>;
  next[key] = value;
  return next as PersonaStartConfig;
}

export type PersonaStartPatch = {
  normalized: PersonaStartConfig;
  fields: PersonaStartFieldKey[];
  payload: Record<string, string | number | boolean>;
};

export function personaStartConfigPatch(
  authoritative: PersonaStartConfig,
  draft: PersonaStartConfig,
): PersonaStartPatch | null {
  // Preserve untouched authoritative values byte-for-byte. Defaults predating
  // the update normalizer may legitimately contain presentation whitespace;
  // Core trims only fields included in a patch.
  const normalized = clonePersonaStartConfig(authoritative);
  const fields: PersonaStartFieldKey[] = [];
  const payload = Object.create(null) as Record<string, string | number | boolean>;
  for (const key of PERSONA_START_FIELD_KEYS) {
    const draftValue = draft[key];
    if (Object.is(authoritative[key], draftValue)) continue;
    let normalizedValue: string | number | boolean | null = null;
    if (BOOLEAN_KEY_SET.has(key)) {
      normalizedValue = typeof draftValue === "boolean" ? draftValue : null;
    } else if (NUMBER_KEY_SET.has(key)) {
      normalizedValue = typeof draftValue === "number" && Number.isFinite(draftValue)
        ? draftValue
        : null;
    } else if (INTEGER_KEY_SET.has(key)) {
      normalizedValue = typeof draftValue === "number" && Number.isFinite(draftValue)
        ? Math.max(8, Math.min(80, Math.trunc(draftValue)))
        : null;
    } else if (STRING_KEY_SET.has(key)) {
      normalizedValue = normalizedString(key as PersonaStartStringKey, draftValue);
    }
    if (normalizedValue === null) return null;
    normalized[key] = normalizedValue as never;
    if (!Object.is(authoritative[key], normalizedValue)) {
      fields.push(key);
      payload[key] = normalizedValue;
    }
  }
  return { normalized, fields, payload };
}

export function personaStartFullPayload(
  config: PersonaStartConfig,
): Record<string, string | number | boolean> | null {
  const normalized = normalizePersonaStartDraft(config);
  if (!normalized) return null;
  const payload = Object.create(null) as Record<string, string | number | boolean>;
  for (const key of PERSONA_START_FIELD_KEYS) payload[key] = normalized[key];
  return payload;
}

function revision(value: unknown, minimum = 0): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= 2_147_483_647
    ? value
    : null;
}

export type PersonaStartConfigResource = {
  contract_version: 1;
  resource_revision: number;
  config: PersonaStartConfig;
};

export type PersonaStartConfigMutation = PersonaStartConfigResource & {
  replayed: boolean;
};

function personaStartResourceData(value: unknown): PersonaStartConfigResource | null {
  const source = exactObject(
    value,
    ["contract_version", "resource_revision", "config"],
  );
  const resourceRevision = revision(source?.resource_revision);
  const config = personaStartConfig(source?.config);
  return source?.contract_version === PERSONA_ADMIN_CONTRACT_VERSION
    && resourceRevision !== null
    && config
    ? { contract_version: 1, resource_revision: resourceRevision, config }
    : null;
}

/** Decode the exact receipt-era configuration read envelope. */
export function personaStartConfigResponse(value: unknown): PersonaStartConfigResource | null {
  const envelope = webadminDataSuccessEnvelope(value);
  return envelope ? personaStartResourceData(envelope.data) : null;
}

/** Decode the exact receipt-era configuration mutation receipt. */
export function personaStartUpdateResponse(value: unknown): PersonaStartConfigMutation | null {
  const envelope = webadminDataSuccessEnvelope(value);
  const source = exactObject(
    envelope?.data,
    ["contract_version", "resource_revision", "config", "replayed"],
  );
  if (!source || typeof source.replayed !== "boolean") return null;
  const resource = personaStartResourceData({
    contract_version: source.contract_version,
    resource_revision: source.resource_revision,
    config: source.config,
  });
  return resource && resource.resource_revision >= 1
    ? { ...resource, replayed: source.replayed }
    : null;
}

export function personaAdminCapabilitiesFrom(value: unknown): PersonaAdminCapabilities | null {
  const outer = record(value);
  if (!outer || outer.success !== true || outer.status_code !== 200) return null;
  const source = exactObject(
    outer.persona,
    ["contract_version", "contract_ready", "can_read", "can_write", "actions"],
  );
  if (!source
    || source.contract_version !== PERSONA_ADMIN_CONTRACT_VERSION
    || typeof source.contract_ready !== "boolean"
    || source.can_read !== true
    || typeof source.can_write !== "boolean"
    || !Array.isArray(source.actions)) return null;

  const expected = source.can_write ? PERSONA_ADMIN_CAPABILITY_ACTIONS : VIEWER_ACTIONS;
  if (source.actions.length !== expected.length
    || !source.actions.every((action, index) => action === expected[index])) return null;

  return {
    contract_version: 1,
    contract_ready: source.contract_ready,
    can_read: true,
    can_write: source.can_write,
    actions: [...source.actions] as PersonaAdminCapabilityAction[],
  };
}

export function personaCapabilityAllows(
  capabilities: PersonaAdminCapabilities | null,
  action: PersonaAdminCapabilityAction,
): boolean {
  return capabilities?.contract_ready === true && capabilities.actions.includes(action);
}

const ACTION_CAPABILITY: ReadonlyMap<string, PersonaAdminCapabilityAction> = new Map([
  ["persona_start_get_config_admin", "read_start_config"],
  ["persona_start_update_config", "write_start_config"],
  ["admin_force_persona_verify", "force_verify"],
  ["admin_apply_fake_persona", "apply_fake"],
  ["admin_revoke_fake_persona", "revoke_fake"],
]);

export function personaProxyCapabilityAuthorized(
  action: string,
  adminMe: unknown,
): boolean | null {
  const required = ACTION_CAPABILITY.get(action);
  if (!required) return null;
  return personaCapabilityAllows(personaAdminCapabilitiesFrom(adminMe), required);
}

function canonicalUid(value: unknown): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0
    && value <= 2_147_483_647
    ? value
    : null;
}

export function canonicalPersonaUid(value: string): number | null {
  if (!/^[1-9][0-9]*$/u.test(value)) return null;
  return canonicalUid(Number(value));
}

export function canonicalPersonaRequestId(value: unknown): string | null {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
    ? value
    : null;
}

/**
 * Canonicalize the operator reason before it is persisted in sessionStorage.
 * The proxy accepts only this exact output, so neither it nor Core silently
 * changes receipt material after the browser has made it durable.
 */
export function normalizePersonaReason(value: unknown): string | null {
  if (typeof value !== "string" || hasUnpairedSurrogate(value)) return null;
  const normalized = value.trim().normalize("NFC");
  if (normalized === ""
    || scalarLength(normalized) > 300
    || /[\u0000-\u001F\u007F-\u009F]/u.test(normalized)) return null;
  return normalized;
}

function canonicalPersonaReason(value: unknown): string | null {
  const normalized = normalizePersonaReason(value);
  return normalized !== null && normalized === value ? normalized : null;
}

function exactNormalizedPatch(
  body: Record<string, unknown>,
): Record<string, string | number | boolean> | null {
  const keys = Object.keys(body);
  if (keys.length === 0 || keys.some((key) => !FIELD_KEY_SET.has(key))) return null;
  const output = Object.create(null) as Record<string, string | number | boolean>;
  for (const key of keys) {
    const value = body[key];
    if (BOOLEAN_KEY_SET.has(key)) {
      if (typeof value !== "boolean") return null;
      output[key] = value;
      continue;
    }
    if (NUMBER_KEY_SET.has(key)) {
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      output[key] = value;
      continue;
    }
    if (INTEGER_KEY_SET.has(key)) {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 8 || value > 80) {
        return null;
      }
      output[key] = value;
      continue;
    }
    if (STRING_KEY_SET.has(key)) {
      const stringKey = key as PersonaStartStringKey;
      const normalized = normalizedString(stringKey, value);
      if (normalized === null || normalized !== value) return null;
      output[key] = normalized;
      continue;
    }
    return null;
  }
  return output;
}

export const PERSONA_ADMIN_MUTATION_ACTIONS = [
  "persona_start_update_config",
  "admin_apply_fake_persona",
  "admin_revoke_fake_persona",
  "admin_force_persona_verify",
] as const;

export type PersonaAdminMutationAction =
  (typeof PERSONA_ADMIN_MUTATION_ACTIONS)[number];

const PERSONA_MUTATION_ACTION_SET: ReadonlySet<string> = new Set(
  PERSONA_ADMIN_MUTATION_ACTIONS,
);

export type PersonaProxyPayload = Record<string, string | number | boolean>;

function normalizedPersonaMutationBase(
  source: Record<string, unknown> | null,
  minimumRevision: number,
): { request_id: string; expected_revision: number; reason: string } | null {
  const requestId = canonicalPersonaRequestId(source?.request_id);
  const expectedRevision = revision(source?.expected_revision, minimumRevision);
  const reason = canonicalPersonaReason(source?.reason);
  return source?.contract_version === PERSONA_ADMIN_CONTRACT_VERSION
    && requestId
    && expectedRevision !== null
    && reason
    ? { request_id: requestId, expected_revision: expectedRevision, reason }
    : null;
}

/**
 * Action-specific server boundary.
 *
 * `undefined` means the action is not a Persona action, `null` is a rejected
 * Persona body, and an object is the only material the proxy may forward.
 */
export function normalizePersonaProxyBody(
  action: string,
  body: Record<string, unknown>,
): PersonaProxyPayload | null | undefined {
  if (!PERSONA_ACTION_SET.has(action)) return undefined;
  if (action === "persona_start_get_config_admin") {
    const source = exactObject(body, ["contract_version"]);
    return source?.contract_version === PERSONA_ADMIN_CONTRACT_VERSION
      ? Object.assign(Object.create(null), { contract_version: 1 })
      : null;
  }
  if (action === "persona_start_update_config") {
    const keys = Object.keys(body);
    const metadata = new Set([
      "contract_version",
      "request_id",
      "expected_revision",
      "reason",
    ]);
    const fieldKeys = keys.filter((key) => !metadata.has(key));
    if (fieldKeys.length === 0
      || keys.length !== fieldKeys.length + metadata.size
      || fieldKeys.some((key) => !FIELD_KEY_SET.has(key))) return null;
    const base = normalizedPersonaMutationBase(body, 0);
    const patch = exactNormalizedPatch(
      Object.fromEntries(fieldKeys.map((key) => [key, body[key]])),
    );
    return base && patch
      ? Object.assign(
          Object.create(null),
          { contract_version: 1, ...base },
          patch,
        )
      : null;
  }
  const source = exactObject(
    body,
    ["contract_version", "uid", "request_id", "expected_revision", "reason"],
  );
  const base = normalizedPersonaMutationBase(source, 1);
  const uid = canonicalUid(source?.uid);
  return base && uid !== null
    ? Object.assign(
        Object.create(null),
        { contract_version: 1, uid, ...base },
      )
    : null;
}

export type PersonaPendingMutation = {
  version: 1;
  action: PersonaAdminMutationAction;
  target: string;
  payload: PersonaProxyPayload;
};

export const PERSONA_PENDING_STORAGE_KEY = "friending.persona.pending-mutation.v1";

function personaPendingTarget(
  action: PersonaAdminMutationAction,
  payload: PersonaProxyPayload,
): string | null {
  if (action === "persona_start_update_config") return "config:start";
  const uid = canonicalUid(payload.uid);
  return uid === null ? null : `uid:${uid}`;
}

/** Build one canonical, target-bound mutation for durable browser retry. */
export function personaPendingMutation(
  action: PersonaAdminMutationAction,
  body: Record<string, unknown>,
): PersonaPendingMutation | null {
  const payload = normalizePersonaProxyBody(action, body);
  if (!payload) return null;
  const target = personaPendingTarget(action, payload);
  return target ? { version: 1, action, target, payload } : null;
}

/** Decode sessionStorage without accepting widened or target-mismatched rows. */
export function personaPendingFrom(value: unknown): PersonaPendingMutation | null {
  const source = exactObject(value, ["version", "action", "target", "payload"]);
  const action = typeof source?.action === "string"
    && PERSONA_MUTATION_ACTION_SET.has(source.action)
    ? source.action as PersonaAdminMutationAction
    : null;
  const payload = record(source?.payload);
  if (source?.version !== 1 || !action || typeof source.target !== "string" || !payload) {
    return null;
  }
  const pending = personaPendingMutation(action, payload);
  return pending && pending.target === source.target ? pending : null;
}

/** Persist the exact identity before the first byte of a mutation is sent. */
export async function personaPersistBeforeMutation<T>(
  storage: Pick<Storage, "setItem">,
  pending: PersonaPendingMutation,
  mutate: () => Promise<T>,
): Promise<{ ok: true; response: T } | { ok: false }> {
  const canonical = personaPendingFrom(pending);
  if (!canonical) return { ok: false };
  try {
    storage.setItem(PERSONA_PENDING_STORAGE_KEY, JSON.stringify(canonical));
  } catch {
    return { ok: false };
  }
  return { ok: true, response: await mutate() };
}

export type PersonaMemberMutation = {
  contract_version: 1;
  uid: number;
  revision: number;
  replayed: boolean;
};

export type PersonaForceMutation = PersonaMemberMutation & {
  verify_image_url: string;
};

function safeRelativeVerifyImage(value: unknown): string | null {
  if (typeof value !== "string"
    || value !== phpTrim(value)
    || scalarLength(value) > 1000
    || hasUnpairedSurrogate(value)
    || containsUnsafeTextControl(value)
    || value.startsWith("/")
    || value.includes("\\")
    || value.includes("?")
    || value.includes("#")) return null;
  const segments = value.split("/");
  if (segments.length !== 3
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }
  return /_meetpic\.jpeg$/u.test(segments[2]) ? value : null;
}

function personaMemberMutationData(value: unknown): PersonaMemberMutation | null {
  const source = exactObject(
    value,
    ["contract_version", "uid", "revision", "replayed"],
  );
  const uid = canonicalUid(source?.uid);
  const nextRevision = revision(source?.revision, 1);
  return source?.contract_version === PERSONA_ADMIN_CONTRACT_VERSION
    && uid !== null
    && nextRevision !== null
    && typeof source.replayed === "boolean"
    ? {
        contract_version: 1,
        uid,
        revision: nextRevision,
        replayed: source.replayed,
      }
    : null;
}

/** Apply/revoke share the same exact receipt material. */
export function personaMemberMutationResponse(value: unknown): PersonaMemberMutation | null {
  const envelope = webadminDataSuccessEnvelope(value);
  return envelope ? personaMemberMutationData(envelope.data) : null;
}

export function personaForceMutationResponse(value: unknown): PersonaForceMutation | null {
  const envelope = webadminDataSuccessEnvelope(value);
  const source = exactObject(
    envelope?.data,
    ["contract_version", "uid", "revision", "verify_image_url", "replayed"],
  );
  if (!source) return null;
  const member = personaMemberMutationData({
    contract_version: source.contract_version,
    uid: source.uid,
    revision: source.revision,
    replayed: source.replayed,
  });
  const verifyImageUrl = safeRelativeVerifyImage(source.verify_image_url);
  return member && verifyImageUrl !== null
    ? { ...member, verify_image_url: verifyImageUrl }
    : null;
}

export function personaStartResourceConverged(
  resource: PersonaStartConfigResource,
  pending: PersonaPendingMutation,
): boolean {
  const expectedRevision = revision(pending.payload.expected_revision);
  if (pending.action !== "persona_start_update_config"
    || expectedRevision === null
    || resource.resource_revision !== expectedRevision + 1) return false;
  for (const key of PERSONA_START_FIELD_KEYS) {
    if (Object.hasOwn(pending.payload, key)
      && !Object.is(resource.config[key], pending.payload[key])) return false;
  }
  return true;
}

export function personaMemberMutationConverged(
  result: PersonaMemberMutation,
  pending: PersonaPendingMutation,
): boolean {
  const uid = canonicalUid(pending.payload.uid);
  const expectedRevision = revision(pending.payload.expected_revision, 1);
  if (pending.action === "persona_start_update_config"
    || uid === null
    || expectedRevision === null
    || result.uid !== uid) return false;
  return pending.action === "admin_apply_fake_persona"
    ? result.revision === expectedRevision || result.revision === expectedRevision + 1
    : result.revision === expectedRevision + 1;
}

export const PERSONA_ADMIN_CORE_ERROR_STATUSES = {
  unauthorized: 401,
  "admin-session-invalid": 401,
  "admin-revoked": 403,
  "admin-write-required": 403,
  "user-not-found": 404,
  "already-verified-real": 409,
  "not-fake-persona": 409,
  "user-has-no-avatar": 422,
  "avatar-file-not-found": 422,
  "persona-contract-version-required": 422,
  "persona-contract-version-invalid": 422,
  "persona-request-invalid": 422,
  "persona-request-id-invalid": 422,
  "persona-request-id-conflict": 409,
  "persona-request-in-progress": 409,
  "persona-conflict": 409,
  "persona-schema-unavailable": 503,
  "persona-write-failed": 503,
  "persona-audit-write-failed": 503,
} as const;

export const PERSONA_ADMIN_BRIDGE_ERROR_STATUSES = {
  "persona-capability-required": 403,
  "bad-origin": 403,
  "not-found": 404,
  "auth-required": 401,
  "invalid-input": 400,
  "too-large": 413,
  "core-unavailable": 502,
  "core-timeout": 504,
  "invalid-core-response": 502,
} as const;

export const PERSONA_ADMIN_ERROR_STATUSES = {
  ...PERSONA_ADMIN_CORE_ERROR_STATUSES,
  ...PERSONA_ADMIN_BRIDGE_ERROR_STATUSES,
} as const;

export type PersonaAdminError = keyof typeof PERSONA_ADMIN_ERROR_STATUSES;

export const PERSONA_ADMIN_ERROR_KEYS = Object.keys(
  PERSONA_ADMIN_ERROR_STATUSES,
) as PersonaAdminError[];

const ERROR_STATUS: ReadonlyMap<string, number> = new Map(
  Object.entries(PERSONA_ADMIN_ERROR_STATUSES),
);

type PersonaAdminFailureBase = {
  success: false;
  status_code: number;
  error: PersonaAdminError;
};

export type PersonaAdminCoreFailure = PersonaAdminFailureBase & {
  message: 200;
  status: 200;
  can_send: 0;
};

export type PersonaAdminBridgeFailure = PersonaAdminFailureBase & {
  message?: never;
  status?: never;
  can_send?: never;
};

export type PersonaAdminFailure = PersonaAdminCoreFailure | PersonaAdminBridgeFailure;

export function personaAdminFailureResponse(value: unknown): PersonaAdminFailure | null {
  const core = webadminErrorEnvelope(value);
  if (core) {
    const expectedStatus = Object.prototype.hasOwnProperty.call(
      PERSONA_ADMIN_CORE_ERROR_STATUSES,
      core.error,
    ) ? PERSONA_ADMIN_CORE_ERROR_STATUSES[
        core.error as keyof typeof PERSONA_ADMIN_CORE_ERROR_STATUSES
      ] : undefined;
    return expectedStatus !== undefined && core.status_code === expectedStatus
      ? core as PersonaAdminCoreFailure
      : null;
  }
  const bridge = adminBridgeErrorEnvelope(value);
  if (!bridge) return null;
  const expectedStatus = Object.prototype.hasOwnProperty.call(
    PERSONA_ADMIN_BRIDGE_ERROR_STATUSES,
    bridge.error,
  ) ? PERSONA_ADMIN_BRIDGE_ERROR_STATUSES[
      bridge.error as keyof typeof PERSONA_ADMIN_BRIDGE_ERROR_STATUSES
    ] : undefined;
  return expectedStatus !== undefined && bridge.status_code === expectedStatus
    ? bridge as PersonaAdminBridgeFailure
    : null;
}

export type PersonaConfigConflict = {
  kind: "config";
  contract_version: 1;
  resource_revision: number;
};

export type PersonaMemberConflict = {
  kind: "member";
  contract_version: 1;
  uid: number;
  revision: number;
};

export type PersonaConflict = PersonaConfigConflict | PersonaMemberConflict;

/** Only `persona-conflict` may carry one of these two exact authoritative rows. */
export function personaConflictResponse(value: unknown): PersonaConflict | null {
  const envelope = webadminErrorEnvelope(value, "required");
  if (!envelope || envelope.status_code !== 409 || envelope.error !== "persona-conflict") {
    return null;
  }
  const config = exactObject(
    envelope.data,
    ["contract_version", "resource_revision"],
  );
  const configRevision = revision(config?.resource_revision);
  if (config?.contract_version === 1 && configRevision !== null) {
    return { kind: "config", contract_version: 1, resource_revision: configRevision };
  }
  const member = exactObject(
    envelope.data,
    ["contract_version", "uid", "revision"],
  );
  const uid = canonicalUid(member?.uid);
  const memberRevision = revision(member?.revision, 1);
  return member?.contract_version === 1 && uid !== null && memberRevision !== null
    ? { kind: "member", contract_version: 1, uid, revision: memberRevision }
    : null;
}

export function personaAdminErrorKey(value: unknown): PersonaAdminError | "generic" {
  return typeof value === "string" && ERROR_STATUS.has(value)
    ? value as PersonaAdminError
    : "generic";
}

/** Unknown, in-progress, transport, and 5xx results retain the exact UUID/material. */
export function personaShouldRetainMutation(value: unknown): boolean {
  if (typeof value !== "string") return true;
  if (value === "persona-request-in-progress") return true;
  const status = ERROR_STATUS.get(value);
  return status === undefined || status >= 500;
}

export type PersonaTarget = { uid: number; displayName: string; revision: number };

export type PersonaTargetLookupData = {
  uid: number;
  display_name: string;
  revision: number;
};

export function personaTargetFromUserDetail(value: unknown): PersonaTarget | null {
  const source = record(value);
  const profile = record(source?.profile);
  const personaAdmin = exactObject(
    source?.persona_admin,
    ["contract_version", "revision"],
  );
  const uid = canonicalUid(profile?.uid);
  const memberRevision = revision(personaAdmin?.revision, 1);
  if (!source
    || source.success !== true
    || source.status_code !== 200
    || personaAdmin?.contract_version !== PERSONA_ADMIN_CONTRACT_VERSION
    || uid === null
    || memberRevision === null) return null;
  if (typeof profile?.display_name !== "string"
    || hasUnpairedSurrogate(profile.display_name)
    || containsUnsafeTextControl(profile.display_name)) return null;
  const displayName = phpTrim(profile.display_name);
  if (scalarLength(displayName) > 200) return null;
  return { uid, displayName, revision: memberRevision };
}

/** Build the only three member fields the Persona browser workflow may receive. */
export function personaTargetLookupData(
  target: PersonaTarget,
): PersonaTargetLookupData | null {
  const uid = canonicalUid(target.uid);
  const memberRevision = revision(target.revision, 1);
  if (uid === null
    || memberRevision === null
    || typeof target.displayName !== "string"
    || hasUnpairedSurrogate(target.displayName)
    || containsUnsafeTextControl(target.displayName)
    || scalarLength(target.displayName) > 200) return null;
  return { uid, display_name: phpTrim(target.displayName), revision: memberRevision };
}

/** Decode the dedicated same-origin route; arbitrary user documents fail closed. */
export function personaTargetLookupResponse(value: unknown): PersonaTarget | null {
  const source = exactObject(value, ["success", "status_code", "data"]);
  const data = exactObject(source?.data, ["uid", "display_name", "revision"]);
  if (!source || source.success !== true || source.status_code !== 200 || !data) return null;
  const projected = personaTargetLookupData({
    uid: data.uid as number,
    displayName: data.display_name as string,
    revision: data.revision as number,
  });
  return projected
    ? {
        uid: projected.uid,
        displayName: projected.display_name,
        revision: projected.revision,
      }
    : null;
}

export type PersonaHighlightPart = { text: string; highlighted: boolean };

export function personaHighlightParts(
  template: string,
  highlight: string,
): PersonaHighlightPart[] {
  const pieces = template.split("{{highlight}}");
  const parts: PersonaHighlightPart[] = [];
  pieces.forEach((piece, index) => {
    if (piece !== "") parts.push({ text: piece, highlighted: false });
    if (index < pieces.length - 1 && highlight !== "") {
      parts.push({ text: highlight, highlighted: true });
    }
  });
  return parts;
}

export function personaPreviewColor(value: string, fallback: string): string {
  return /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/u.test(value) ? value : fallback;
}

export function personaPreviewImageUrl(value: string): string | null {
  if (!validHttpsUrl(value) || value === "") return null;
  try {
    const parsed = new URL(value);
    return parsed.origin.toLowerCase() === "https://img.friending.co" ? value : null;
  } catch {
    return null;
  }
}
