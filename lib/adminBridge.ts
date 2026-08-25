/** Exact logical refusal emitted by the authenticated Next.js admin bridge. */

export type AdminBridgeErrorEnvelope = {
  success: false;
  status_code: number;
  error: string;
};

export function adminBridgeErrorEnvelope(value: unknown): AdminBridgeErrorEnvelope | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source).sort();
  if (keys.length !== 3
    || keys[0] !== "error"
    || keys[1] !== "status_code"
    || keys[2] !== "success"
    || source.success !== false
    || typeof source.status_code !== "number"
    || !Number.isSafeInteger(source.status_code)
    || source.status_code < 400
    || source.status_code > 599
    || typeof source.error !== "string"
    || source.error === "") return null;
  return source as AdminBridgeErrorEnvelope;
}
