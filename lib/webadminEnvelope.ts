/**
 * Transport envelope emitted by Core's shared `Webadmin::reply()` helper.
 *
 * Domain parsers remain responsible for their material (`data`/`error`) shape
 * and logical status. This helper owns the legacy transport trio and required
 * top-level fields so individual consoles cannot drift from A-ENV again.
 */

export const WEBADMIN_LEGACY_MESSAGE = 200 as const;
export const WEBADMIN_LEGACY_STATUS = 200 as const;
export const WEBADMIN_LEGACY_CAN_SEND = 0 as const;

const BASE_KEYS = [
  "success",
  "status_code",
  "message",
  "status",
  "can_send",
] as const;

export type WebadminEnvelope = Record<string, unknown> & {
  success: boolean;
  status_code: number;
  message: typeof WEBADMIN_LEGACY_MESSAGE;
  status: typeof WEBADMIN_LEGACY_STATUS;
  can_send: typeof WEBADMIN_LEGACY_CAN_SEND;
};

export type WebadminDataSuccessEnvelope = WebadminEnvelope & {
  success: true;
  status_code: 200;
  data: unknown;
};

export type WebadminEmptySuccessEnvelope = WebadminEnvelope & {
  success: true;
  status_code: 200;
};

export type WebadminErrorEnvelope = WebadminEnvelope & {
  success: false;
  error: string;
  data?: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => Object.hasOwn(value, key));
}

/**
 * Parse one Webadmin envelope with a caller-declared required material key set.
 * Prefer the success/error wrappers below for versioned A-ENV consumers.
 */
export function webadminEnvelope(
  value: unknown,
  expectedSuccess: boolean,
  materialKeys: readonly string[],
): WebadminEnvelope | null {
  const source = record(value);
  if (!source || !requiredKeys(source, [...BASE_KEYS, ...materialKeys])) return null;
  if (source.success !== expectedSuccess
    || typeof source.status_code !== "number"
    || !Number.isSafeInteger(source.status_code)
    || source.status_code < 100
    || source.status_code > 599
    || source.message !== WEBADMIN_LEGACY_MESSAGE
    || source.status !== WEBADMIN_LEGACY_STATUS
    || source.can_send !== WEBADMIN_LEGACY_CAN_SEND) return null;
  const decoded: Record<string, unknown> = {
    success: source.success,
    status_code: source.status_code,
    message: source.message,
    status: source.status,
    can_send: source.can_send,
  };
  for (const key of materialKeys) decoded[key] = source[key];
  return decoded as WebadminEnvelope;
}

export function webadminDataSuccessEnvelope(value: unknown): WebadminDataSuccessEnvelope | null {
  const raw = record(value);
  if (raw && Object.hasOwn(raw, "error")) return null;
  const source = webadminEnvelope(value, true, ["data"]);
  return source?.status_code === 200 ? source as WebadminDataSuccessEnvelope : null;
}

/** Legacy actions that intentionally return no material data use this form. */
export function webadminEmptySuccessEnvelope(value: unknown): WebadminEmptySuccessEnvelope | null {
  const raw = record(value);
  if (raw && (Object.hasOwn(raw, "data") || Object.hasOwn(raw, "error"))) return null;
  const source = webadminEnvelope(value, true, []);
  return source?.status_code === 200 ? source as WebadminEmptySuccessEnvelope : null;
}

export function webadminErrorEnvelope(
  value: unknown,
  data: "forbidden" | "required" = "forbidden",
): WebadminErrorEnvelope | null {
  const raw = record(value);
  if (raw && data === "forbidden" && Object.hasOwn(raw, "data")) return null;
  const materialKeys = data === "required" ? ["error", "data"] : ["error"];
  const source = webadminEnvelope(value, false, materialKeys);
  return source && typeof source.error === "string" && source.error !== ""
    ? source as WebadminErrorEnvelope
    : null;
}
