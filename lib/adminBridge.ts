/** Logical refusal emitted by the authenticated Next.js admin bridge. */

export type AdminBridgeErrorEnvelope = {
  success: false;
  status_code: number;
  error: string;
};

const CORE_TRANSPORT_ERROR_STATUSES = {
  "core-unavailable": 502,
  "core-timeout": 504,
  "invalid-core-response": 502,
} as const;

/**
 * Recognize only the known failure fields synthesized by `coreCall` itself.
 * Core-owned refusals keep their original legacy envelope; this conversion is
 * solely the same-origin bridge adding the logical status that browsers need.
 */
export function adminBridgeCoreTransportError(
  status: number,
  value: unknown,
): AdminBridgeErrorEnvelope | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const error = source.error;
  if (!Object.hasOwn(source, "error")
    || !Object.hasOwn(source, "success")
    || source.success !== false
    || typeof error !== "string"
    || !Object.hasOwn(CORE_TRANSPORT_ERROR_STATUSES, error)
    || CORE_TRANSPORT_ERROR_STATUSES[error as keyof typeof CORE_TRANSPORT_ERROR_STATUSES] !== status) {
    return null;
  }
  return { success: false, status_code: status, error };
}

export function adminBridgeErrorEnvelope(value: unknown): AdminBridgeErrorEnvelope | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  // The complete legacy marker trio selects Core's sibling envelope variant;
  // ordinary unknown bridge fields remain additive and are ignored below.
  if (["message", "status", "can_send"].every((key) => Object.hasOwn(source, key))) return null;
  if (!Object.hasOwn(source, "error")
    || !Object.hasOwn(source, "status_code")
    || !Object.hasOwn(source, "success")
    || source.success !== false
    || typeof source.status_code !== "number"
    || !Number.isSafeInteger(source.status_code)
    || source.status_code < 400
    || source.status_code > 599
    || typeof source.error !== "string"
    || source.error === "") return null;
  return { success: false, status_code: source.status_code, error: source.error };
}
