export const IDENTITY_ACTIONS = ["identity_verification_configuration", "identity_verification_configuration_save"] as const;
export type IdentityProvider = "persona" | "didit" | "disabled";
export type IdentityConfiguration = { provider: IdentityProvider; min_ios_build: number; workflow_id: string };
export type IdentityPayload = {
  contract_version: 1;
  configuration: IdentityConfiguration & { revision: number };
  didit: { environment: "live" | "sandbox"; api_key: boolean; webhook_secret: boolean;
    application_id: boolean; media_hosts: boolean; environment_allowed: boolean; ready: boolean };
  legacy_provider: "persona";
  can_write: boolean;
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function integer(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= 2147483647;
}
export function parseIdentityConfiguration(value: unknown): IdentityConfiguration | null {
  if (!object(value) || !exact(value, ["provider", "min_ios_build", "workflow_id"])
    || typeof value.provider !== "string" || !["persona", "didit", "disabled"].includes(value.provider)
    || !integer(value.min_ios_build, 245) || typeof value.workflow_id !== "string"
    || (value.workflow_id !== "" && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.workflow_id))
    || (value.provider === "didit" && value.workflow_id === "")) return null;
  return { provider: value.provider as IdentityProvider, min_ios_build: value.min_ios_build, workflow_id: value.workflow_id };
}
export function parseIdentityPayload(value: unknown): IdentityPayload | null {
  if (!object(value) || !exact(value, ["contract_version", "configuration", "didit", "legacy_provider", "can_write"])
    || value.contract_version !== 1 || value.legacy_provider !== "persona" || typeof value.can_write !== "boolean"
    || !object(value.configuration) || !exact(value.configuration, ["provider", "min_ios_build", "workflow_id", "revision"])
    || !integer(value.configuration.revision) || !object(value.didit)
    || !exact(value.didit, ["environment", "api_key", "webhook_secret", "application_id", "media_hosts", "environment_allowed", "ready"])
    || typeof value.didit.environment !== "string" || !["live", "sandbox"].includes(value.didit.environment)) return null;
  const { revision, ...candidate } = value.configuration;
  const configuration = parseIdentityConfiguration(candidate);
  const d = value.didit;
  if (!configuration || [d.api_key, d.webhook_secret, d.application_id, d.media_hosts, d.environment_allowed, d.ready].some(v => typeof v !== "boolean")
    || d.ready !== (d.api_key && d.webhook_secret && d.application_id && d.media_hosts && d.environment_allowed)) return null;
  return { contract_version: 1, configuration: { ...configuration, revision }, legacy_provider: "persona",
    can_write: value.can_write, didit: { environment: d.environment as "live" | "sandbox",
      api_key: d.api_key as boolean, webhook_secret: d.webhook_secret as boolean, application_id: d.application_id as boolean,
      media_hosts: d.media_hosts as boolean,
      environment_allowed: d.environment_allowed as boolean, ready: d.ready as boolean } };
}
export function normalizeIdentityBody(action: string, body: Record<string, unknown>): Record<string, unknown> | null | undefined {
  if (!IDENTITY_ACTIONS.includes(action as typeof IDENTITY_ACTIONS[number])) return undefined;
  if (action === IDENTITY_ACTIONS[0]) return Object.keys(body).length === 0 ? {} : null;
  if (!exact(body, ["expected_revision", "configuration_json"]) || !integer(body.expected_revision)
    || typeof body.configuration_json !== "string" || body.configuration_json.length > 1024) return null;
  try {
    const candidate = parseIdentityConfiguration(JSON.parse(body.configuration_json));
    return candidate ? { expected_revision: body.expected_revision, configuration_json: JSON.stringify(candidate) } : null;
  } catch { return null; }
}
// Core answers every identity action with HTTP 200 and a logical status_code. Any other
// transport status means the outcome is unknown, whatever the body says.
export function normalizeIdentityResponse(value: unknown, httpStatus: number): Record<string, unknown> | null {
  if (!object(value) || httpStatus !== 200) return null;
  if (value.success === true && value.status_code === 200) {
    const data = parseIdentityPayload(value.data);
    return data ? { success: true, status_code: 200, data } : null;
  }
  const errors = new Set(["identity-configuration-invalid", "identity-configuration-conflict", "didit-configuration-unavailable",
    "identity-unavailable", "admin-session-invalid", "admin-revoked", "admin-write-required"]);
  if (value.success === false && integer(value.status_code, 400) && value.status_code <= 599
    && typeof value.error === "string" && errors.has(value.error)) {
    return { success: false, status_code: value.status_code, error: value.error };
  }
  return null;
}
