/**
 * Local decisions the console makes about its own public login bridge and about
 * the role required for a write. Pure and time-injectable so the whole policy is
 * covered by `tests/adminSessionLifecycle.test.mts`; Core stays authoritative for
 * code validation, bans, and every server-side authorization check.
 */

type HeaderReader = { get(name: string): string | null };

type TextRequest = {
  headers: HeaderReader;
  text(): Promise<string>;
};

export const AUTH_BODY_MAX_BYTES = 4_096;

export type BoundedJsonObject =
  | { kind: "ok"; value: Record<string, unknown> }
  | { kind: "invalid" }
  | { kind: "too-large" };

/**
 * Read a small JSON object without letting a public authentication route buffer
 * an unbounded request body. Content-Length is only an early rejection hint;
 * the actual UTF-8 byte count remains authoritative for chunked or dishonest
 * requests.
 */
export async function readBoundedJsonObject(
  request: TextRequest,
  maximumBytes = AUTH_BODY_MAX_BYTES,
): Promise<BoundedJsonObject> {
  const limit = Math.max(1, Math.floor(maximumBytes));
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) return { kind: "too-large" };

  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return { kind: "invalid" };
  }
  if (new TextEncoder().encode(raw).byteLength > limit) return { kind: "too-large" };

  try {
    const parsed = raw === "" ? {} : JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { kind: "invalid" };
    }
    return { kind: "ok", value: parsed as Record<string, unknown> };
  } catch {
    return { kind: "invalid" };
  }
}

export type ThrottleRule = {
  limit: number;
  windowSeconds: number;
};

export type ThrottleDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export type RequestThrottle = {
  check(key: string, nowSeconds?: number): ThrottleDecision;
  size(): number;
};

/**
 * Hard ceiling on tracked keys. The key is derived from attacker-supplied input
 * (forwarded address plus submitted email), so the limiter must never grow
 * without bound or it becomes a memory-exhaustion vector of its own. Expired
 * windows are pruned first; if the map is still full the oldest window is
 * evicted, because a fixed window length makes insertion order the same as
 * expiry order.
 */
export const THROTTLE_MAX_KEYS = 4096;

export function createRequestThrottle(
  rule: ThrottleRule,
  maxKeys = THROTTLE_MAX_KEYS,
): RequestThrottle {
  const limit = Math.max(1, Math.floor(rule.limit));
  const windowSeconds = Math.max(1, Math.floor(rule.windowSeconds));
  const bound = Math.max(1, Math.floor(maxKeys));
  const windows = new Map<string, { start: number; count: number }>();

  function prune(nowSeconds: number): void {
    for (const [key, window] of windows) {
      if (nowSeconds - window.start >= windowSeconds) windows.delete(key);
    }
  }

  return {
    check(key: string, nowSeconds = Math.floor(Date.now() / 1000)): ThrottleDecision {
      const window = windows.get(key);
      if (window && nowSeconds - window.start < windowSeconds) {
        if (window.count >= limit) {
          return {
            allowed: false,
            retryAfterSeconds: Math.max(1, window.start + windowSeconds - nowSeconds),
          };
        }
        window.count += 1;
        return { allowed: true, retryAfterSeconds: 0 };
      }
      if (!window) {
        prune(nowSeconds);
        while (windows.size >= bound) {
          const oldest = windows.keys().next();
          if (oldest.done) break;
          windows.delete(oldest.value);
        }
      }
      windows.set(key, { start: nowSeconds, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    },
    size(): number {
      return windows.size;
    },
  };
}

/**
 * These budgets are deliberately loose enough that a real administrator never
 * meets them: a sign-in costs one `request_code` and one or two `verify_code`
 * calls. What they bound is volume from one caller — address sweeps and code
 * grinding.
 *
 * What they do NOT do, stated plainly: they do not stop a targeted lockout of a
 * single administrator. Core bans the *target account* after three wrong codes,
 * and driving that costs an attacker one `request_code` plus three `verify_code`
 * calls per hour, far below any budget a real administrator can live with.
 * Closing that needs the Core-side change of scoping the ban to the failing
 * source rather than to the account it names.
 */
export const REQUEST_CODE_CALLER_RULE: ThrottleRule = { limit: 5, windowSeconds: 600 };
export const VERIFY_CODE_CALLER_RULE: ThrottleRule = { limit: 10, windowSeconds: 600 };
export const AUTH_ADDRESS_RULE: ThrottleRule = { limit: 40, windowSeconds: 600 };

/**
 * Process-local state. Webadmin deploys as a single Next.js process on
 * `127.0.0.1:3006` behind Apache, so this is a real control for that topology
 * and only for that topology: it is not shared across instances, it does not
 * survive a PM2 restart, and it is not a substitute for an edge/WAF rule.
 */
export const requestCodeCallerThrottle = createRequestThrottle(REQUEST_CODE_CALLER_RULE);
export const verifyCodeCallerThrottle = createRequestThrottle(VERIFY_CODE_CALLER_RULE);
export const authAddressThrottle = createRequestThrottle(AUTH_ADDRESS_RULE);

/**
 * Apache proxies with `ProxyPreserveHost` and appends the real peer to any
 * caller-supplied `X-Forwarded-For`, so the LAST entry is the address Apache
 * saw. Reading the first entry would let a caller pick its own throttle key.
 *
 * Returns "" when no forwarded address is available. Callers must then skip the
 * per-address rule: a single shared key for every caller is not caller-scoped,
 * so throttling on it would hand an attacker a global sign-in lockout — exactly
 * the failure this limiter exists to prevent. The per-caller rule still applies.
 */
export function clientAddress(headers: HeaderReader): string {
  const forwarded = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const peer = forwarded[forwarded.length - 1] ?? (headers.get("x-real-ip") ?? "").trim();
  return (peer ?? "").slice(0, 64).toLowerCase();
}

export function throttleKey(address: string, email: string): string {
  return `${address}|${email}`;
}

export type LoginFailure = {
  status: number;
  error: string;
};

/**
 * Locally generated transport failures. They describe this server, not the account, and are all
 * collapsed into one client-facing answer so a failing Core cannot become an account oracle.
 *
 * `core-timeout` (504) is in here for the same reason as `core-unavailable` (502): on the login
 * path the distinction between "Core is down" and "Core was slow" tells the caller nothing about
 * the address they submitted, and leaking a second transport code would only widen what an
 * unauthenticated caller can distinguish. The timeout/unavailable split matters on the *admin*
 * bridge, where an operator has to know whether a mutation may still have landed; it does not
 * matter here, where nothing has been mutated.
 */
const TRANSPORT_ERRORS = new Set(["core-unavailable", "invalid-core-response", "core-timeout"]);
const TRANSPORT_STATUSES = new Set([502, 504]);

function transportFailure(status: number, error: string): LoginFailure | null {
  return TRANSPORT_STATUSES.has(status) && TRANSPORT_ERRORS.has(error)
    ? { status: 502, error: "request-failed" }
    : null;
}

/**
 * Collapse every Core `verify_code` outcome into one client-facing answer.
 *
 * Core separates "unknown or inactive address" (401 `invalid`), "active address
 * with no outstanding code" (410 `expired`) and "active address with a live code"
 * (401 `invalid-code`), and none of them consumes an attempt counter — so
 * forwarding them lets an unauthenticated caller enumerate the administrator
 * allow list. `banned` stays distinguishable because the caller must already have
 * driven that account into a ban to see it, and the localized copy matters there.
 */
export function verifyCodeFailure(status: number, rawError: unknown): LoginFailure {
  const error = String(rawError ?? "");
  return transportFailure(status, error)
    ?? (error === "banned" ? { status: 429, error: "banned" } : { status: 401, error: "invalid" });
}

/**
 * `request_code` already answers `{ok:true}` for unknown addresses on purpose.
 * Its remaining failure strings (`cooldown`, hourly cap, validation, query
 * failures) are account state, so they collapse the same way.
 */
export function requestCodeFailure(status: number, rawError: unknown): LoginFailure {
  const error = String(rawError ?? "");
  return transportFailure(status, error)
    ?? (error === "banned" ? { status: 429, error: "banned" } : { status: 502, error: "request-failed" });
}

/**
 * Core denies writes to `viewer` (`WebadminController::requireAdminEditor`) and
 * always answers `admin_me` with one of `owner`/`admin`/`viewer`. The console
 * mirrors that as an allow list rather than as a deny list, so a role Core never
 * emits — including an absent one — fails closed here. This is the same rule the
 * generic bridge applies through `lib/adminActions.ts`; the two must not drift.
 */
export const ADMIN_ROLES = ["owner", "admin", "viewer"] as const;
export const ADMIN_WRITE_ROLES = ["owner", "admin"] as const;

export function isAdminWriteRole(value: unknown): boolean {
  const role = String(value ?? "").trim().toLowerCase();
  return (ADMIN_WRITE_ROLES as readonly string[]).includes(role);
}

/**
 * Display-only normalization that still fails closed. Returning an invented
 * `admin` role for a malformed `admin_me` response would disagree with the
 * bridge authorization policy and could turn into authority during a later
 * refactor.
 */
export function normalizeAdminRole(value: unknown): string {
  const role = String(value ?? "").trim().toLowerCase();
  return (ADMIN_ROLES as readonly string[]).includes(role) ? role : "";
}
