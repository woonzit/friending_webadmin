import {
  webadminDataSuccessEnvelope,
  webadminEmptySuccessEnvelope,
  webadminErrorEnvelope,
} from "@/lib/webadminEnvelope";
import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";

/**
 * Closed consumer model for Persona Webadmin contract v1.
 *
 * The provider is intentionally dormant. This module contains no endpoint or
 * credential access; it validates decoded Core values, builds the exact public
 * browser material, and supplies the action-specific proxy boundary that will
 * become reachable only after the reviewed cutover.
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
  const trimmed = phpTrim(value);
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
  // Core's compatibility contract casts this field to a JSON number; it does
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

export function personaStartConfigResponse(value: unknown): PersonaStartConfig | null {
  const envelope = webadminDataSuccessEnvelope(value);
  return envelope ? personaStartConfig(envelope.data) : null;
}

export function personaStartUpdateResponse(value: unknown): PersonaStartConfig | null {
  return personaStartConfigResponse(value);
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
    ? value
    : null;
}

export function canonicalPersonaUid(value: string): number | null {
  if (!/^[1-9][0-9]*$/u.test(value)) return null;
  return canonicalUid(Number(value));
}

export function personaUidPayload(uid: number): { uid: string } | null {
  const parsed = canonicalUid(uid);
  return parsed === null ? null : { uid: String(parsed) };
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

/**
 * Action-specific server boundary.
 *
 * `undefined` means the action is not a Persona action, `null` is a rejected
 * Persona body, and an object is the only material the proxy may forward.
 */
export function normalizePersonaProxyBody(
  action: string,
  body: Record<string, unknown>,
): Record<string, string | number | boolean> | null | undefined {
  if (!PERSONA_ACTION_SET.has(action)) return undefined;
  if (action === "persona_start_get_config_admin") {
    return Object.keys(body).length === 0 ? Object.create(null) : null;
  }
  if (action === "persona_start_update_config") return exactNormalizedPatch(body);
  const source = exactObject(body, ["uid"]);
  const uid = typeof source?.uid === "string" ? canonicalPersonaUid(source.uid) : null;
  return uid === null
    ? null
    : Object.assign(Object.create(null), { uid: String(uid) });
}

export type PersonaEmptySuccess = {
  success: true;
  status_code: 200;
  message: 200;
  status: 200;
  can_send: 0;
};

export function personaEmptyMutationResponse(value: unknown): PersonaEmptySuccess | null {
  return webadminEmptySuccessEnvelope(value) as PersonaEmptySuccess | null;
}

export type PersonaForceSuccess = {
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

export function personaForceMutationResponse(value: unknown): PersonaForceSuccess | null {
  const envelope = webadminDataSuccessEnvelope(value);
  const data = exactObject(envelope?.data, ["verify_image_url"]);
  const verifyImageUrl = safeRelativeVerifyImage(data?.verify_image_url);
  return verifyImageUrl === null ? null : { verify_image_url: verifyImageUrl };
}

export const PERSONA_ADMIN_ERROR_STATUSES = {
  unauthorized: 401,
  "admin-session-invalid": 401,
  "admin-revoked": 403,
  "admin-write-required": 403,
  "query-failed": 500,
  "audit-write-failed": 500,
  "no-fields": 400,
  "db-write-failed": 500,
  "uid-invalid": 400,
  "uid-missing": 400,
  "user-not-found": 404,
  "already-verified-real": 409,
  "not-fake-persona": 409,
  "user-has-no-avatar": 422,
  "avatar-file-not-found": 422,
  "copy-failed": 500,
  "mark-failed": 500,
  "unmark-failed": 500,
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
  const envelope = webadminErrorEnvelope(value) ?? adminBridgeErrorEnvelope(value);
  if (!envelope) return null;
  const expectedStatus = ERROR_STATUS.get(envelope.error);
  if (expectedStatus === undefined || envelope.status_code !== expectedStatus) return null;
  return envelope as PersonaAdminFailure;
}

export function personaAdminErrorKey(value: unknown): PersonaAdminError | "generic" {
  return typeof value === "string" && ERROR_STATUS.has(value)
    ? value as PersonaAdminError
    : "generic";
}

export type PersonaTarget = { uid: number; displayName: string };

export type PersonaTargetLookupData = {
  uid: number;
  display_name: string;
};

export function personaTargetFromUserDetail(value: unknown): PersonaTarget | null {
  const source = record(value);
  const profile = record(source?.profile);
  const uid = canonicalUid(profile?.uid);
  if (!source || source.success !== true || source.status_code !== 200 || uid === null) return null;
  if (typeof profile?.display_name !== "string"
    || hasUnpairedSurrogate(profile.display_name)
    || containsUnsafeTextControl(profile.display_name)) return null;
  const displayName = phpTrim(profile.display_name);
  if (scalarLength(displayName) > 200) return null;
  return { uid, displayName };
}

/** Build the only two member fields the Persona browser workflow may receive. */
export function personaTargetLookupData(
  target: PersonaTarget,
): PersonaTargetLookupData | null {
  const uid = canonicalUid(target.uid);
  if (uid === null
    || typeof target.displayName !== "string"
    || hasUnpairedSurrogate(target.displayName)
    || containsUnsafeTextControl(target.displayName)
    || scalarLength(target.displayName) > 200) return null;
  return { uid, display_name: phpTrim(target.displayName) };
}

/** Decode the dedicated same-origin route; arbitrary user documents fail closed. */
export function personaTargetLookupResponse(value: unknown): PersonaTarget | null {
  const source = exactObject(value, ["success", "status_code", "data"]);
  const data = exactObject(source?.data, ["uid", "display_name"]);
  if (!source || source.success !== true || source.status_code !== 200 || !data) return null;
  const projected = personaTargetLookupData({
    uid: data.uid as number,
    displayName: data.display_name as string,
  });
  return projected
    ? { uid: projected.uid, displayName: projected.display_name }
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
