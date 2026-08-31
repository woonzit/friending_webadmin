import { webadminEnvelope } from "@/lib/webadminEnvelope";
import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";

/** Closed browser model for the additive dual-push Webadmin contract. */

export const PUSH_DELIVERY_MODES = ["fcm", "onesignal", "both"] as const;

export type PushDeliveryMode = (typeof PUSH_DELIVERY_MODES)[number];

export type PushDeliverySetting = {
  value: PushDeliveryMode;
  type: "enum";
  allowed_values: ["fcm", "onesignal", "both"];
  minimum: null;
  maximum: null;
  updated_at: number;
  updated_by: string;
};

export type PushChannels = {
  fcm_token_present: boolean;
  onesignal_id_present: boolean;
};

export const PUSH_ADMIN_ERROR_STATUSES = {
  unauthorized: 401,
  "admin-session-invalid": 401,
  "admin-revoked": 403,
  "admin-write-required": 403,
  "settings-invalid": 422,
  "setting-invalid": 422,
  "query-failed": 500,
  "write-failed": 500,
  "user-not-found": 404,
} as const;

export type PushAdminError = keyof typeof PUSH_ADMIN_ERROR_STATUSES;

const SETTING_KEYS = [
  "value",
  "type",
  "allowed_values",
  "minimum",
  "maximum",
  "updated_at",
  "updated_by",
] as const;
const CHANNEL_KEYS = ["fcm_token_present", "onesignal_id_present"] as const;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredObject(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  const raw = object(value);
  return raw && keys.every((key) => Object.hasOwn(raw, key)) ? raw : null;
}

function mode(value: unknown): PushDeliveryMode | null {
  return typeof value === "string"
    && (PUSH_DELIVERY_MODES as readonly string[]).includes(value)
    ? value as PushDeliveryMode
    : null;
}

function canonicalAdminEmail(value: unknown): string | null {
  if (value === "") return "";
  return typeof value === "string"
    && value.length <= 320
    && value === value.trim()
    && value === value.toLowerCase()
    && EMAIL.test(value)
    ? value
    : null;
}

/** Parse the known managed setting without retaining any other settings entry. */
export function pushDeliverySetting(value: unknown): PushDeliverySetting | null {
  const raw = requiredObject(value, SETTING_KEYS);
  const parsedMode = mode(raw?.value);
  const updatedBy = canonicalAdminEmail(raw?.updated_by);
  if (
    !raw
    || parsedMode === null
    || raw.type !== "enum"
    || !Array.isArray(raw.allowed_values)
    || raw.allowed_values.length !== PUSH_DELIVERY_MODES.length
    || !raw.allowed_values.every((entry, index) => entry === PUSH_DELIVERY_MODES[index])
    || raw.minimum !== null
    || raw.maximum !== null
    || typeof raw.updated_at !== "number"
    || !Number.isSafeInteger(raw.updated_at)
    || raw.updated_at < 0
    || updatedBy === null
  ) return null;

  return {
    value: parsedMode,
    type: "enum",
    allowed_values: [...PUSH_DELIVERY_MODES],
    minimum: null,
    maximum: null,
    updated_at: raw.updated_at,
    updated_by: updatedBy,
  };
}

/**
 * Parse the complete legacy success envelope, then project only the push setting.
 * The settings map stays open for future managed keys, and its known entry ignores additive fields.
 */
export function pushSettingsResponse(value: unknown): PushDeliverySetting | null {
  const raw = webadminEnvelope(value, true, ["settings"]);
  const settings = object(raw?.settings);
  if (
    !raw
    || raw.status_code !== 200
    || !settings
  ) return null;
  return pushDeliverySetting(settings.push_delivery_mode);
}

/** Build the only browser-owned material added by this contract. */
export function pushDeliverySavePayload(value: unknown): { push_delivery_mode: PushDeliveryMode } | null {
  const parsed = mode(value);
  return parsed === null ? null : { push_delivery_mode: parsed };
}

/** Parse the identifier-free per-member channel projection. */
export function pushChannels(value: unknown): PushChannels | null {
  const raw = requiredObject(value, CHANNEL_KEYS);
  return raw
    && typeof raw.fcm_token_present === "boolean"
    && typeof raw.onesignal_id_present === "boolean"
    ? {
      fcm_token_present: raw.fcm_token_present,
      onesignal_id_present: raw.onesignal_id_present,
    }
    : null;
}

/** Parse Core's closed logical-error envelope without treating unknown errors as known. */
export function pushAdminError(value: unknown): PushAdminError | null {
  const raw = webadminEnvelope(value, false, ["error"]);
  if (
    !raw
    || typeof raw.error !== "string"
    || !Object.hasOwn(PUSH_ADMIN_ERROR_STATUSES, raw.error)
  ) return null;
  const error = raw.error as PushAdminError;
  return raw.status_code === PUSH_ADMIN_ERROR_STATUSES[error] ? error : null;
}

/** The same-origin bridge enforces the editor role before Core and returns this closed denial. */
export function pushLocalWriteDenial(value: unknown): "admin-write-required" | null {
  const raw = adminBridgeErrorEnvelope(value);
  return raw?.status_code === 403 && raw.error === "admin-write-required"
    ? "admin-write-required"
    : null;
}
