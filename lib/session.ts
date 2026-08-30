import "server-only";
import { cookies } from "next/headers";
import { coreCall } from "@/lib/core";
import {
  ADMIN_GRANTED_VERIFICATION_CONTRACT_READY,
  AUDIENCE_VISIBILITY_CONTRACT_READY,
  PROFILE_TEXT_MODERATION_CONTRACT_READY,
} from "@/lib/contractReadiness";
import { audienceVisibilityAdminMe } from "@/lib/audienceVisibilityAdmin";
import {
  forcedVerificationAccess,
  parseForcedVerificationAdminMe,
  type ForcedVerificationAccess,
} from "@/lib/forcedVerification";
import { profileTextModerationAdminMe } from "@/lib/profileTextModeration";
import { isAdminWriteRole, normalizeAdminRole } from "@/lib/authPolicy";
import {
  personaAdminCapabilitiesFrom,
  personaCapabilityAllows,
} from "@/lib/personaAdmin";
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
  personaConsoleReady: boolean;
  verificationConsoleReady: boolean;
  audienceVisibilityConsoleReady: boolean;
  profileTextModerationConsoleReady: boolean;
  /** D-053 "Forced & waiting room" tab, from Core's `admin_me.verification_forced` block. */
  forcedVerification: ForcedVerificationAccess;
};

export type AdminWriter =
  | {
      ok: true;
      session: SessionPayload;
      role: string;
      membership: Record<string, unknown>;
    }
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
    persona?: unknown;
    verification?: unknown;
    verification_forced?: unknown;
    audience_visibility?: unknown;
    profile_text_moderation?: unknown;
  }>("admin_me", { admin_email: session.email });
  if (result.status !== 200 || !result.data?.success) return null;
  const role = normalizeAdminRole(result.data.role);
  if (!role) return null;
  const persona = personaAdminCapabilitiesFrom(
    result.data,
    ADMIN_GRANTED_VERIFICATION_CONTRACT_READY,
  );
  const verification = verificationAdminMe(result.data.verification);
  const audienceVisibility = audienceVisibilityAdminMe(result.data.audience_visibility);
  const profileTextModeration = profileTextModerationAdminMe(result.data.profile_text_moderation);
  return {
    email: String(result.data.email ?? session.email),
    role,
    personaConsoleReady: personaCapabilityAllows(persona, "read_start_config"),
    verificationConsoleReady: verification?.contract_ready === true
      && verification.actions.includes("verification_console"),
    audienceVisibilityConsoleReady: AUDIENCE_VISIBILITY_CONTRACT_READY
      && audienceVisibility?.contract_ready === true
      && audienceVisibility.actions.includes("audience_visibility_catalog"),
    profileTextModerationConsoleReady: PROFILE_TEXT_MODERATION_CONTRACT_READY
      && profileTextModeration?.contract_ready === true
      && profileTextModeration.actions.includes("moderation_profile_text_list"),
    forcedVerification: forcedVerificationAccess(parseForcedVerificationAdminMe(result.data.verification_forced)),
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
  const result = await coreCall<Record<string, unknown> & { success?: boolean; role?: string }>("admin_me", {
    admin_email: session.email,
  });
  if (result.status !== 200 || !result.data?.success) {
    return { ok: false, error: "auth-required", status: 401 };
  }
  if (!isAdminWriteRole(result.data.role)) {
    return { ok: false, error: "admin-write-required", status: 403 };
  }
  return {
    ok: true,
    session,
    role: normalizeAdminRole(result.data.role),
    membership: result.data,
  };
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
