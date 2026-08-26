import { NextRequest, NextResponse } from "next/server";
import {
  normalizeAudienceVisibilityProxyBody,
  audienceVisibilityProxyCapabilityAuthorized,
} from "@/lib/audienceVisibilityAdmin";
import {
  adminActionBodyLimit,
  adminActionTimeoutMs,
  adminPrincipalFrom,
  invalidatesAdminSession,
  isAdminActionAllowed,
  isAdminActionAuthorized,
} from "@/lib/adminActions";
import { coreCall, mergeCoreParams } from "@/lib/core";
import {
  normalizePersonaProxyBody,
  personaProxyCapabilityAuthorized,
} from "@/lib/personaAdmin";
import { normalizeCannedTemplateProxyBody } from "@/lib/cannedTemplates";
import { normalizeOutboundMessagingProxyBody } from "@/lib/outboundMessaging";
import { isTrustedAdminRequest } from "@/lib/requestGuard";
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
    verification?: unknown;
    audience_visibility?: unknown;
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
  const personaAuthorized = personaProxyCapabilityAuthorized(action, membership.data);
  if (personaAuthorized === false) {
    return bridgeError("persona-capability-required", 403);
  }
  const verificationAuthorized = verificationProxyCapabilityAuthorized(action, membership.data);
  if (verificationAuthorized === false) {
    return bridgeError("verification-capability-required", 403);
  }
  const audienceVisibilityAuthorized = audienceVisibilityProxyCapabilityAuthorized(action, membership.data);
  if (audienceVisibilityAuthorized === false) {
    return bridgeError("catalog-admin-capability-required", 403);
  }
  if (!isAdminActionAuthorized(action, principal)) {
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

  const normalizedVerificationBody = normalizeVerificationProxyBody(action, body);
  if (normalizedVerificationBody === null) {
    return bridgeError("invalid-input", 400);
  }
  if (normalizedVerificationBody !== undefined) body = normalizedVerificationBody;

  const normalizedAudienceVisibilityBody = normalizeAudienceVisibilityProxyBody(action, body);
  if (normalizedAudienceVisibilityBody === null) {
    return bridgeError("invalid-input", 400);
  }
  if (normalizedAudienceVisibilityBody !== undefined) body = normalizedAudienceVisibilityBody;

  // The browser body is untrusted: reserved names are stripped from it before
  // the server-owned actor identity is applied, so `admin_email` no longer
  // depends on the order of an object literal to stay authoritative.
  const result = await coreCall(
    action,
    mergeCoreParams(body, { admin_email: session.email }),
    adminActionTimeoutMs(action),
  );
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
