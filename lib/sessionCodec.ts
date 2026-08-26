import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_VERSION = 1;
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export type SessionPayload = {
  v: number;
  email: string;
  iat: number;
  exp: number;
  nonce: string;
};

function normalizeEmail(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (email.length < 3 || email.length > 320 || !email.includes("@")) return "";
  return email;
}

function signature(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(encodedPayload).digest();
}

export function createSessionToken(
  rawEmail: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new Error("invalid-session-email");
  if (secret.length < 32) throw new Error("session-secret-too-short");

  const payload: SessionPayload = {
    v: SESSION_VERSION,
    email,
    iat: nowSeconds,
    exp: nowSeconds + SESSION_MAX_AGE_SECONDS,
    nonce: randomBytes(16).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded, secret).toString("base64url")}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): SessionPayload | null {
  if (!token || token.length > 2048 || secret.length < 32) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  let received: Buffer;
  try {
    received = Buffer.from(parts[1], "base64url");
  } catch {
    return null;
  }
  const expected = signature(parts[0], secret);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const data = parsed as Partial<SessionPayload>;
  const email = normalizeEmail(data.email);
  if (
    data.v !== SESSION_VERSION ||
    !email ||
    !Number.isInteger(data.iat) ||
    !Number.isInteger(data.exp) ||
    typeof data.nonce !== "string" ||
    !NONCE_PATTERN.test(data.nonce)
  ) {
    return null;
  }
  if (
    (data.iat as number) > nowSeconds + 60 ||
    (data.exp as number) <= nowSeconds ||
    (data.exp as number) - (data.iat as number) !== SESSION_MAX_AGE_SECONDS
  ) {
    return null;
  }

  return {
    v: SESSION_VERSION,
    email,
    iat: data.iat as number,
    exp: data.exp as number,
    nonce: data.nonce,
  };
}

export type SessionRevocationList = {
  revoke(nonce: string, expiresAtSeconds: number, nowSeconds?: number): void;
  isRevoked(nonce: string, nowSeconds?: number): boolean;
  size(): number;
};

/**
 * Bounded because the list is written by an authenticated action; the cap is a
 * belt-and-braces limit on memory, not a limit on abuse. Entries only have to
 * outlive the token they revoke, so pruning by `exp` keeps the list small on its
 * own and the cap is normally unreachable.
 */
export const SESSION_REVOCATION_MAX_ENTRIES = 4096;

export function createSessionRevocationList(
  maxEntries = SESSION_REVOCATION_MAX_ENTRIES,
): SessionRevocationList {
  const bound = Math.max(1, Math.floor(maxEntries));
  const entries = new Map<string, number>();

  function prune(nowSeconds: number): void {
    for (const [nonce, expiresAt] of entries) {
      if (expiresAt <= nowSeconds) entries.delete(nonce);
    }
  }

  return {
    revoke(nonce, expiresAtSeconds, nowSeconds = Math.floor(Date.now() / 1000)): void {
      if (!NONCE_PATTERN.test(nonce)) return;
      if (!Number.isInteger(expiresAtSeconds) || expiresAtSeconds <= nowSeconds) return;
      prune(nowSeconds);
      while (!entries.has(nonce) && entries.size >= bound) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
      entries.set(nonce, expiresAtSeconds);
    },
    isRevoked(nonce, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
      const expiresAt = entries.get(nonce);
      if (expiresAt === undefined) return false;
      if (expiresAt <= nowSeconds) {
        entries.delete(nonce);
        return false;
      }
      return true;
    },
    size(): number {
      return entries.size;
    },
  };
}

/**
 * The session is a stateless signed token: there is no server-side session store
 * to delete from, so sign-out is implemented as a revocation list this process
 * consults on every read. Honest limits, all of them process-local: it is not
 * shared with a second Next.js instance, and a PM2 restart empties it, after
 * which a token captured before sign-out verifies again until its own `exp`.
 * Deactivating the `admin_emails` row through Core remains the only revocation
 * that holds across processes and restarts.
 */
export const sessionRevocations = createSessionRevocationList();

export function verifyActiveSessionToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  revocations: SessionRevocationList = sessionRevocations,
): SessionPayload | null {
  const payload = verifySessionToken(token, secret, nowSeconds);
  if (!payload) return null;
  return revocations.isRevoked(payload.nonce, nowSeconds) ? null : payload;
}
