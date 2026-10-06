import "server-only";
import { cookies } from "next/headers";
import { coreCall } from "@/lib/core";
import { ADMIN_MEMBERSHIP_UNCONFIRMED, classifyAdminMembership } from "@/lib/adminMembership";
import {
  ADMIN_GRANTED_VERIFICATION_CONTRACT_READY,
  PROFILE_TEXT_MODERATION_CONTRACT_READY,
} from "@/lib/contractReadiness";
import {
  audienceVisibilityAdminMe,
  audienceVisibilityIdentityWriteAuthorized,
} from "@/lib/audienceVisibilityAdmin";
import { profileTextModerationAdminMe } from "@/lib/profileTextModeration";
import { isAdminWriteRole } from "@/lib/authPolicy";
import {
  personaAdminCapabilitiesFrom,
  personaCapabilityAllows,
} from "@/lib/personaAdmin";
import { verificationAdminMe } from "@/lib/verificationAdmin";
import {
  verificationMethodAccess,
  verificationMethodAdminMe,
  type VerificationMethodAccess,
} from "@/lib/verificationMethod";
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
  /**
   * T-653. Core's SIBLING `admin_me.audience_visibility_identity` block, and
   * nothing else: never the four-capability `audience_visibility` block beside
   * it, and never the top-level role. A Core that predates the amendment serves
   * no such key, which reads as `false` and keeps the member-identity editor
   * hidden.
   */
  audienceVisibilityIdentityWrite: boolean;
  profileTextModerationConsoleReady: boolean;
  /**
   * T-617 mandatory-method policy, from Core's `admin_me.verification_method`
   * sibling block ONLY (contract §2.1). Never inferred from the role or from
   * the retired `admin_me.verification_forced` block.
   */
  verificationMethod: VerificationMethodAccess;
};

export type AdminWriter =
  | {
      ok: true;
      session: SessionPayload;
      role: string;
      membership: Record<string, unknown>;
    }
  | { ok: false; error: "auth-required" | "admin-write-required"; status: 401 | 403 }
  | { ok: false; error: typeof ADMIN_MEMBERSHIP_UNCONFIRMED; status: 503 };

/** A failed read is neither an identity nor a definite signed-out result. */
export class AdminMembershipUnconfirmedError extends Error {
  constructor() { super(ADMIN_MEMBERSHIP_UNCONFIRMED); this.name = "AdminMembershipUnconfirmedError"; }
}

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

export async function adminMe(signal?: AbortSignal): Promise<AdminIdentity | null> {
  let session;
  try { session = await readAdminSession(); } catch { throw new AdminMembershipUnconfirmedError(); }
  if (signal?.aborted) throw new AdminMembershipUnconfirmedError();
  if (!session) return null;
  let result;
  try {
    result = await coreCall("admin_me", { admin_email: session.email }, undefined, { signal, membershipCheck: true });
  } catch { throw new AdminMembershipUnconfirmedError(); }
  const decision = classifyAdminMembership(result, session.email, signal?.aborted === true);
  if (decision.kind === "revoked") return null;
  if (decision.kind !== "confirmed") throw new AdminMembershipUnconfirmedError();
  const data = decision.membership;
  const persona = personaAdminCapabilitiesFrom(
    data,
    ADMIN_GRANTED_VERIFICATION_CONTRACT_READY,
  );
  const verification = verificationAdminMe(data.verification);
  const audienceVisibility = audienceVisibilityAdminMe(data.audience_visibility);
  const profileTextModeration = profileTextModerationAdminMe(data.profile_text_moderation);
  return {
    email: decision.email,
    role: decision.role,
    personaConsoleReady: personaCapabilityAllows(persona, "read_start_config"),
    verificationConsoleReady: verification?.contract_ready === true
      && verification.actions.includes("verification_console"),
    audienceVisibilityConsoleReady: audienceVisibility?.contract_ready === true
      && audienceVisibility.actions.includes("audience_visibility_catalog"),
    audienceVisibilityIdentityWrite: audienceVisibilityIdentityWriteAuthorized(data),
    profileTextModerationConsoleReady: PROFILE_TEXT_MODERATION_CONTRACT_READY
      && profileTextModeration?.contract_ready === true
      && profileTextModeration.actions.includes("moderation_profile_text_list"),
    verificationMethod: verificationMethodAccess(verificationMethodAdminMe(data.verification_method)),
  };
}

/**
 * Session, active-membership and role in one gate for routes that write. Core
 * remains the authoritative check; this stops a read-only principal before the
 * console spends a Core round trip or an upload decode on it.
 */
export async function requireAdminWriter(signal?: AbortSignal): Promise<AdminWriter> {
  let session;
  try { session = await readAdminSession(); } catch { return { ok: false, error: ADMIN_MEMBERSHIP_UNCONFIRMED, status: 503 }; }
  if (signal?.aborted) return { ok: false, error: ADMIN_MEMBERSHIP_UNCONFIRMED, status: 503 };
  if (!session) return { ok: false, error: "auth-required", status: 401 };
  let result;
  try {
    result = await coreCall("admin_me", { admin_email: session.email }, undefined, { signal, membershipCheck: true });
  } catch { return { ok: false, error: ADMIN_MEMBERSHIP_UNCONFIRMED, status: 503 }; }
  const decision = classifyAdminMembership(result, session.email, signal?.aborted === true);
  if (decision.kind === "revoked") return { ok: false, error: "auth-required", status: 401 };
  if (decision.kind !== "confirmed") return { ok: false, error: ADMIN_MEMBERSHIP_UNCONFIRMED, status: 503 };
  if (!isAdminWriteRole(decision.role)) {
    return { ok: false, error: "admin-write-required", status: 403 };
  }
  return {
    ok: true,
    session,
    role: decision.role,
    membership: decision.membership,
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
