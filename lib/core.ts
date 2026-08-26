import "server-only";

export type CoreResult<T = Record<string, unknown>> = {
  status: number;
  data: T | null;
};

const CORE_API_BASE = (process.env.CORE_API_BASE ?? "https://core.freelove.hu").replace(/\/+$/, "");

/**
 * Parameters Core treats as authoritative, which a request body may therefore
 * never supply:
 *
 * - `secret` is the shared credential `Support\Webadmin::assertSecret()` compares.
 * - `admin_email` is the ONLY actor signal Core has. `WebadminController::
 *   requireAdminActor()` looks the `admin_emails` row — and therefore the role —
 *   up from that value, so a caller-influenced `admin_email` would collapse the
 *   whole role model.
 *
 * Listing the exact lowercase spellings is sufficient because `coreCall` drops
 * every key that is not `^[a-z][a-z0-9_]{0,63}$`. That grammar also kills PHP's
 * parameter-name folding vectors: `admin.email`, `admin email` and `admin[email`
 * would all arrive as `$_POST['admin_email']` but never reach the wire.
 */
export const RESERVED_CORE_PARAMS = ["secret", "admin_email"] as const;

const RESERVED_CORE_PARAM_SET: ReadonlySet<string> = new Set(RESERVED_CORE_PARAMS);

export function isReservedCoreParam(key: string): boolean {
  return RESERVED_CORE_PARAM_SET.has(key);
}

/**
 * Assemble a Core payload from untrusted, request-derived parameters plus the
 * parameters the server owns. Reserved names are dropped from the untrusted half
 * FIRST and the server-owned values are applied LAST, so neither a crafted body
 * key nor a later reordering of this merge can reach Core's credential or actor
 * identity. Route handlers must pass request bodies through here rather than
 * spreading them straight into `coreCall`.
 */
export function mergeCoreParams(
  requestBody: Record<string, unknown>,
  serverOwned: Record<string, unknown>,
): Record<string, unknown> {
  // Null prototype: a JSON body may carry a literal `__proto__` key, and writing
  // that onto an object literal would reassign the result's prototype.
  const merged = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(requestBody)) {
    if (isReservedCoreParam(key)) continue;
    merged[key] = value;
  }
  for (const [key, value] of Object.entries(serverOwned)) {
    merged[key] = value;
  }
  return merged;
}

function apiSecret(): string {
  const secret = process.env.WEBADMIN_API_SECRET ?? "";
  if (secret.length < 32) throw new Error("WEBADMIN_API_SECRET is missing or too short");
  return secret;
}

function encodeValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number" || typeof value === "string") return String(value);
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

export async function coreCall<T = Record<string, unknown>>(
  action: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 10_000,
): Promise<CoreResult<T>> {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(action)) {
    return { status: 404, data: null };
  }

  const body = new URLSearchParams();
  // Caller-derived parameters first, and `secret` is rejected outright: this
  // module owns that key and no caller has a legitimate reason to send it.
  for (const [key, value] of Object.entries(payload)) {
    if (key === "secret") continue;
    if (/^[a-z][a-z0-9_]{0,63}$/.test(key)) body.set(key, encodeValue(value));
  }
  // The credential is written last and unconditionally, so a future reordering
  // of the loop above cannot overwrite it either. `admin_email` cannot be
  // protected here — this module has no session context and every caller has to
  // supply it — so request bodies must be filtered with `mergeCoreParams` before
  // they get this far.
  body.set("secret", apiSecret());

  let response: Response;
  try {
    response = await fetch(`${CORE_API_BASE}/v1/webadmin/${action}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: body.toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // A timeout is reported distinctly from an unreachable Core. They need different operator
    // copy: "Core is down" is a wait-and-retry, while a timeout on a *mutating* call means the
    // write may still have landed and must be re-read before it is retried. `AbortSignal.timeout`
    // rejects with a `TimeoutError` DOMException; a caller-supplied abort would be `AbortError`.
    const name = (error as { name?: unknown } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      return { status: 504, data: { success: false, error: "core-timeout" } as T };
    }
    return { status: 502, data: { success: false, error: "core-unavailable" } as T };
  }

  let data: T | null = null;
  try {
    data = (await response.json()) as T;
  } catch {
    return { status: 502, data: { success: false, error: "invalid-core-response" } as T };
  }

  const logicalStatus = Number((data as Record<string, unknown> | null)?.status_code);
  const status =
    Number.isInteger(logicalStatus) && logicalStatus >= 100 && logicalStatus <= 599
      ? logicalStatus
      : response.status;
  return { status, data };
}

/** Multipart bridge used only for already-normalized, bounded first-party admin media. */
export async function coreMultipartCall<T = Record<string, unknown>>(
  action: string,
  payload: Record<string, unknown>,
  image: { buffer: Buffer; mime: string; filename: string },
  timeoutMs = 30_000,
): Promise<CoreResult<T>> {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(action)) {
    return { status: 404, data: null };
  }
  const body = new FormData();
  for (const [key, value] of Object.entries(payload)) {
    if (key === "secret") continue;
    if (/^[a-z][a-z0-9_]{0,63}$/.test(key)) body.set(key, encodeValue(value));
  }
  body.set("secret", apiSecret());
  body.set(
    "image",
    new Blob([Uint8Array.from(image.buffer)], { type: image.mime }),
    image.filename,
  );

  let response: Response;
  try {
    response = await fetch(`${CORE_API_BASE}/v1/webadmin/${action}`, {
      method: "POST",
      headers: { Accept: "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      return { status: 504, data: { success: false, error: "core-timeout" } as T };
    }
    return { status: 502, data: { success: false, error: "core-unavailable" } as T };
  }

  let data: T | null;
  try {
    data = (await response.json()) as T;
  } catch {
    return { status: 502, data: { success: false, error: "invalid-core-response" } as T };
  }
  const logicalStatus = Number((data as Record<string, unknown> | null)?.status_code);
  const status = Number.isInteger(logicalStatus) && logicalStatus >= 100 && logicalStatus <= 599
    ? logicalStatus
    : response.status;
  return { status, data };
}

/**
 * Server-only binary bridge used for private verification evidence.
 *
 * The ordinary `coreCall` intentionally insists on JSON. Evidence is the one
 * Webadmin surface that must retain Core's byte stream and Range semantics, so
 * this helper returns the upstream response without ever exposing the shared
 * secret or local evidence path to the browser. Callers must still authenticate
 * the admin session and classify the action before invoking it.
 */
export async function coreBinaryCall(
  action: string,
  payload: Record<string, unknown>,
  range: string | null,
  timeoutMs = 30_000,
): Promise<Response | null> {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(action)) return null;
  if (range !== null && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return null;

  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (key === "secret") continue;
    if (/^[a-z][a-z0-9_]{0,63}$/.test(key)) body.set(key, encodeValue(value));
  }
  body.set("secret", apiSecret());

  const headers: Record<string, string> = {
    Accept: "video/mp4,image/jpeg,application/json",
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
  };
  if (range) headers.Range = range;

  try {
    return await fetch(`${CORE_API_BASE}/v1/webadmin/${action}`, {
      method: "POST",
      headers,
      body: body.toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
}
