import "server-only";
import { cookies } from "next/headers";
import { coreCall } from "@/lib/core";
import { VERIFICATION_CONTRACT_READY } from "@/lib/contractReadiness";
import { isAdminWriteRole, normalizeAdminRole } from "@/lib/authPolicy";
import { verificationAdminMe } from "@/lib/verificationAdmin";
import {
  createSessionToken,
  SESSION_MAX_AGE_SECONDS,
  sessionRevocations,
  verifyActiveSessionToken,
  type SessionPayload,
} from "@/lib/sessionCodec";

export const ADMIN_COOKIE = "flwa_session";
export { SESSION_MAX_AGE_SECONDS as COOKIE_MAX_AGE };

export type AdminIdentity = {
  email: string;
  role: string;
  verificationConsoleReady: boolean;
};

export type AdminWriter =
  | { ok: true; session: SessionPayload; role: string }
  | { ok: false; error: "auth-required" | "admin-write-required"; status: 401 | 403 };

function sessionSecret(): string {
  const secret = process.env.WEBADMIN_SESSION_SECRET ?? "";
  if (secret.length < 32) throw new Error("WEBADMIN_SESSION_SECRET is missing or too short");
  return secret;
}

export function issueAdminSession(email: string): string {
  return createSessionToken(email, sessionSecret());
}

export async function readAdminSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value ?? "";
  return verifyActiveSessionToken(token, sessionSecret());
}

/**
 * Sign-out for a stateless signed token: record the token's own nonce so this
 * process stops accepting a copy of it. See `lib/sessionCodec.ts` for the
 * limits this does and does not deliver.
 */
export async function revokeCurrentAdminSession(): Promise<boolean> {
  const session = await readAdminSession();
  if (!session) return false;
  sessionRevocations.revoke(session.nonce, session.exp);
  return true;
}

export async function adminMe(): Promise<AdminIdentity | null> {
  const session = await readAdminSession();
  if (!session) return null;
  const result = await coreCall<{
    success?: boolean;
    email?: string;
    role?: string;
    verification?: unknown;
  }>("admin_me", { admin_email: session.email });
  if (result.status !== 200 || !result.data?.success) return null;
  const role = normalizeAdminRole(result.data.role);
  if (!role) return null;
  const verification = verificationAdminMe(result.data.verification);
  return {
    email: String(result.data.email ?? session.email),
    role,
    verificationConsoleReady: VERIFICATION_CONTRACT_READY
      && verification?.contract_ready === true
      && verification.actions.includes("verification_console"),
  };
}

/**
 * Session, active-membership and role in one gate for routes that write. Core
 * remains the authoritative check; this stops a read-only principal before the
 * console spends a Core round trip or an upload decode on it.
 */
export async function requireAdminWriter(): Promise<AdminWriter> {
  const session = await readAdminSession();
  if (!session) return { ok: false, error: "auth-required", status: 401 };
  const result = await coreCall<{ success?: boolean; role?: string }>("admin_me", {
    admin_email: session.email,
  });
  if (result.status !== 200 || !result.data?.success) {
    return { ok: false, error: "auth-required", status: 401 };
  }
  if (!isAdminWriteRole(result.data.role)) {
    return { ok: false, error: "admin-write-required", status: 403 };
  }
  return { ok: true, session, role: normalizeAdminRole(result.data.role) };
}

export function adminCookieOptions(maxAge = SESSION_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
