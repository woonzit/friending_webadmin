import { NextRequest, NextResponse } from "next/server";
import { adminBridgeCoreTransportError } from "@/lib/adminBridge";
import {
  adminGrantedVerificationLegacyReceiptRetryAuthorized,
  adminGrantedVerificationProxyCapabilityAuthorized,
  adminGrantedVerificationSelectedReadAuthorized,
  normalizeAdminGrantedVerificationProxyBody,
} from "@/lib/adminGrantedVerification";
import {
  normalizeAudienceVisibilityProxyBody,
  audienceVisibilityProxyCapabilityAuthorized,
} from "@/lib/audienceVisibilityAdmin";
import { normalizeAppearanceProxyBody } from "@/lib/appearanceRules";
import { datesAvailabilityWriteIsRetired } from "@/lib/datesAdmin";
import {
  featureSwitchesProxyCapabilityAuthorized,
  normalizeFeatureSwitchesProxyBody,
} from "@/lib/featureSwitches";
import {
  forcedVerificationProxyCapabilityAuthorized,
  normalizeForcedVerificationProxyBody,
} from "@/lib/forcedVerification";
import {
  normalizeProfileTextModerationProxyBody,
  profileTextModerationProxyCapabilityAuthorized,
} from "@/lib/profileTextModeration";
import {
  adminActionBodyLimit,
  adminActionTimeoutMs,
  adminPrincipalFrom,
  invalidatesAdminSession,
  isAdminActionAllowed,
  isAdminBridgeActionAuthorized,
} from "@/lib/adminActions";
import { ADMIN_GRANTED_VERIFICATION_CONTRACT_READY } from "@/lib/contractReadiness";
import { coreCall, mergeCoreParams } from "@/lib/core";
import {
  normalizePersonaProxyBody,
  personaProxyCapabilityAuthorized,
} from "@/lib/personaAdmin";
import {
  normalizePersonaScreensProxyBody,
  personaScreensProxyCapabilityAuthorized,
} from "@/lib/personaScreens";
import { normalizeCannedTemplateProxyBody } from "@/lib/cannedTemplates";
import { normalizeOutboundMessagingProxyBody } from "@/lib/outboundMessaging";
import { isTrustedAdminRequest } from "@/lib/requestGuard";
import { normalizeManagedSettingsProxyBody } from "@/lib/sectionAvailability";
import { readAdminSession } from "@/lib/session";
import {
  normalizeVerificationProxyBody,
  verificationProxyCapabilityAuthorized,
} from "@/lib/verificationAdmin";

export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function bridgeError(error: string, status: number) {
  return NextResponse.json(
    { success: false, status_code: status, error },
    { status, headers: NO_STORE_HEADERS },
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ action: string }> },
) {
  if (!isTrustedAdminRequest(request.headers)) {
    return bridgeError("bad-origin", 403);
  }
  // Exact membership of a closed set: no prefix, case-insensitive or normalised
  // matching, so a crafted segment cannot reach an action that is not listed.
  const { action } = await context.params;
  if (!isAdminActionAllowed(action)) {
    return bridgeError("not-found", 404);
  }
  const bodyLimit = adminActionBodyLimit(action);

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > bodyLimit) {
    return bridgeError("too-large", 413);
  }
  const session = await readAdminSession();
  if (!session) {
    return bridgeError("auth-required", 401);
  }

  // Revocation is authoritative in Core. This is deliberately checked on every
  // bridge call, not only when the dashboard layout is rendered.
  const membership = await coreCall<{
    success?: boolean;
    role?: string;
    dates?: unknown;
    persona?: unknown;
    persona_screens?: unknown;
    verification?: unknown;
    admin_granted_verification?: unknown;
    audience_visibility?: unknown;
    profile_text_moderation?: unknown;
    feature_switches?: unknown;
  }>(
    "admin_me",
    { admin_email: session.email },
  );
  if (membership.status !== 200 || !membership.data?.success) {
    return bridgeError("auth-required", 401);
  }

  // Membership is not authorization: `viewer` is a deliberately read-only role,
  // and Core still runs several mutating handlers on its permissive actor gate.
  // The classification is exhaustive and an unclassified action is denied, so a
  // newly allow-listed action cannot silently become writable. This is a 403 on
  // purpose: the session is valid, so `adminClient` must not send the operator
  // back to /login.
  const principal = adminPrincipalFrom(membership.data);
  const legacyAdminGrantRetryAuthorized = ADMIN_GRANTED_VERIFICATION_CONTRACT_READY
    ? adminGrantedVerificationLegacyReceiptRetryAuthorized(action, membership.data)
    : null;
  const personaAuthorized = personaProxyCapabilityAuthorized(
    action,
    membership.data,
    ADMIN_GRANTED_VERIFICATION_CONTRACT_READY,
  );
  if (personaAuthorized === false && legacyAdminGrantRetryAuthorized !== true) {
    return bridgeError("persona-capability-required", 403);
  }
  const verificationAuthorized = verificationProxyCapabilityAuthorized(action, membership.data);
  if (verificationAuthorized === false && legacyAdminGrantRetryAuthorized !== true) {
    return bridgeError("verification-capability-required", 403);
  }
  const adminGrantedVerificationAuthorized = adminGrantedVerificationProxyCapabilityAuthorized(
    action,
    membership.data,
  );
  if (adminGrantedVerificationAuthorized === false) {
    return bridgeError("verification-capability-required", 403);
  }
  const forcedVerificationAuthorized = forcedVerificationProxyCapabilityAuthorized(action, membership.data);
  if (forcedVerificationAuthorized === false) {
    return bridgeError("verification-capability-required", 403);
  }
  // The Persona screens console carries its own `admin_me` projection and its
  // own revision; it deliberately does not share the Persona receipt block or
  // the forced-verification one, so it answers with its own refusal name.
  const personaScreensAuthorized = personaScreensProxyCapabilityAuthorized(action, membership.data);
  if (personaScreensAuthorized === false) {
    return bridgeError("persona-screens-capability-required", 403);
  }
  const audienceVisibilityAuthorized = audienceVisibilityProxyCapabilityAuthorized(action, membership.data);
  if (audienceVisibilityAuthorized === false) {
    return bridgeError("catalog-admin-capability-required", 403);
  }
  const profileTextModerationAuthorized = profileTextModerationProxyCapabilityAuthorized(action, membership.data);
  if (profileTextModerationAuthorized === false) {
    return bridgeError(action === "moderation_profile_text_list"
      ? "profile-text-moderation-read-required"
      : "profile-text-moderation-decision-required", 403);
  }
  const featureSwitchesAuthorized = featureSwitchesProxyCapabilityAuthorized(action, membership.data);
  if (featureSwitchesAuthorized === false) {
    return bridgeError(action === "feature_switches_get"
      ? "feature-switches-read-required"
      : "feature-switches-edit-required", 403);
  }
  if (!isAdminBridgeActionAuthorized(
    action,
    principal,
    audienceVisibilityAuthorized,
    profileTextModerationAuthorized,
    featureSwitchesAuthorized,
  )) {
    return bridgeError("admin-write-required", 403);
  }

  let body: Record<string, unknown> = {};
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > bodyLimit) {
      return bridgeError("too-large", 413);
    }
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return bridgeError("invalid-input", 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return bridgeError("invalid-input", 400);
  }

  if (datesAvailabilityWriteIsRetired(action, body)) {
    return bridgeError("invalid-input", 400);
  }

  const normalizedPersonaBody = normalizePersonaProxyBody(action, body);
  if (normalizedPersonaBody === null) {
    return bridgeError("invalid-input", 400);
  }
  if (normalizedPersonaBody !== undefined) body = normalizedPersonaBody;

  const normalizedCannedBody = normalizeCannedTemplateProxyBody(action, body);
  if (normalizedCannedBody === null) {
    return bridgeError("invalid-input", 400);
  }
  if (normalizedCannedBody !== undefined) body = normalizedCannedBody;

  const normalizedOutboundBody = normalizeOutboundMessagingProxyBody(action, body);
  if (normalizedOutboundBody === null) {
    return bridgeError("invalid-input", 400);
  }
  if (normalizedOutboundBody !== undefined) body = normalizedOutboundBody;

  const normalizedManagedSettingsBody = normalizeManagedSettingsProxyBody(action, body);
  if (normalizedManagedSettingsBody === null) {
    return bridgeError("invalid-input", 400);
  }
  if (normalizedManagedSettingsBody !== undefined) body = normalizedManagedSettingsBody;

  const normalizedForcedVerificationBody = normalizeForcedVerificationProxyBody(action, body);
  if (normalizedForcedVerificationBody === null) {
    return bridgeError("invalid-input", 400);
  }
  if (normalizedForcedVerificationBody !== undefined) body = normalizedForcedVerificationBody;

  // `document` travels as the canonical JSON string of exactly `{copy_default}`;
  // anything the strict parser refuses is answered here rather than forwarded.
  const normalizedPersonaScreensBody = normalizePersonaScreensProxyBody(action, body);
  if (normalizedPersonaScreensBody === null) {
    return bridgeError("invalid-input", 400);
  }
  if (normalizedPersonaScreensBody !== undefined) body = normalizedPersonaScreensBody;

  const normalizedVerificationBody = normalizeVerificationProxyBody(
    action,
    body,
    ADMIN_GRANTED_VERIFICATION_CONTRACT_READY,
  );
  if (normalizedVerificationBody === null) {
    return bridgeError("invalid-input", 400);
  }
  if (normalizedVerificationBody?.admin_granted_verification_contract_version === 1
    && !adminGrantedVerificationSelectedReadAuthorized(membership.data)) {
    return bridgeError("verification-capability-required", 403);
  }
  if (normalizedVerificationBody !== undefined) body = normalizedVerificationBody;

  const normalizedAdminGrantedVerificationBody = normalizeAdminGrantedVerificationProxyBody(action, body);
  if (normalizedAdminGrantedVerificationBody === null) {
    return bridgeError("invalid-input", 400);
  }
  if (normalizedAdminGrantedVerificationBody !== undefined) body = normalizedAdminGrantedVerificationBody;

  const normalizedAudienceVisibilityBody = normalizeAudienceVisibilityProxyBody(action, body);
  if (normalizedAudienceVisibilityBody === null) {
    return bridgeError("invalid-input", 400);
  }
  if (normalizedAudienceVisibilityBody !== undefined) body = normalizedAudienceVisibilityBody;

  const normalizedProfileTextModerationBody = normalizeProfileTextModerationProxyBody(action, body);
  if (normalizedProfileTextModerationBody === null) {
    return bridgeError("invalid-input", 400);
  }
  if (normalizedProfileTextModerationBody !== undefined) body = normalizedProfileTextModerationBody;

  const normalizedFeatureSwitchesBody = normalizeFeatureSwitchesProxyBody(action, body);
  if (normalizedFeatureSwitchesBody === null) {
    return bridgeError("invalid-input", 400);
  }
  if (normalizedFeatureSwitchesBody !== undefined) body = normalizedFeatureSwitchesBody;

  // Appearance rules travel as one strict fourteen-key document; anything the
  // contract does not list is refused here rather than forwarded for Core to
  // reject, and the nested rule is JSON-encoded into one form field by coreCall.
  const normalizedAppearanceBody = normalizeAppearanceProxyBody(action, body);
  if (normalizedAppearanceBody === null) {
    return bridgeError("invalid-input", 400);
  }
  if (normalizedAppearanceBody !== undefined) body = normalizedAppearanceBody;

  // The browser body is untrusted: reserved names are stripped from it before
  // the server-owned actor identity is applied, so `admin_email` no longer
  // depends on the order of an object literal to stay authoritative.
  const result = await coreCall(
    action,
    mergeCoreParams(body, { admin_email: session.email }),
    adminActionTimeoutMs(action),
  );
  const transportError = adminBridgeCoreTransportError(result.status, result.data);
  if (transportError) {
    return bridgeError(transportError.error, transportError.status_code);
  }
  const coreError = (result.data as Record<string, unknown> | null)?.error;
  if (invalidatesAdminSession(result.status, coreError)) {
    return bridgeError("auth-required", 401);
  }
  if (result.data === null) return bridgeError("core-unavailable", result.status || 502);
  return NextResponse.json(
    result.data,
    { status: result.status || 502, headers: NO_STORE_HEADERS },
  );
}
