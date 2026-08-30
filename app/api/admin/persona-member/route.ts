import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_GRANTED_VERIFICATION_CONTRACT_READY,
} from "@/lib/contractReadiness";
import { coreCall } from "@/lib/core";
import {
  PERSONA_ADMIN_CONTRACT_VERSION,
  canonicalPersonaUid,
  personaAdminCapabilitiesFrom,
  personaCapabilityAllows,
  personaTargetFromUserDetail,
  personaTargetLookupData,
} from "@/lib/personaAdmin";
import { isTrustedAdminRequest } from "@/lib/requestGuard";
import { requireAdminWriter } from "@/lib/session";

export const dynamic = "force-dynamic";

const BODY_LIMIT = 256;

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function errorResponse(error: string, status: number) {
  return json({ success: false, status_code: status, error }, status);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Server-side data-minimising bridge for the Persona target confirmation.
 * Core's broad `user_detail` document is parsed here and never forwarded to
 * the browser; the response contains only canonical uid, display name, and the
 * shared receipt-era member revision needed for an optimistic mutation.
 */
export async function POST(request: NextRequest) {
  if (!isTrustedAdminRequest(request.headers)) return errorResponse("bad-origin", 403);

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > BODY_LIMIT) {
    return errorResponse("too-large", 413);
  }

  const writer = await requireAdminWriter();
  if (!writer.ok) return errorResponse(writer.error, writer.status);
  const capabilities = personaAdminCapabilitiesFrom(
    writer.membership,
    ADMIN_GRANTED_VERIFICATION_CONTRACT_READY,
  );
  if (!["apply_fake", "revoke_fake", "force_verify"].some((action) => (
    personaCapabilityAllows(capabilities, action as "apply_fake" | "revoke_fake" | "force_verify")
  ))) {
    return errorResponse("persona-capability-required", 403);
  }

  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > BODY_LIMIT) return errorResponse("too-large", 413);
    const parsed = raw ? JSON.parse(raw) : null;
    body = record(parsed) ?? Object.create(null);
  } catch {
    return errorResponse("invalid-input", 400);
  }
  if (Object.keys(body).length !== 1 || !Object.hasOwn(body, "uid")) {
    return errorResponse("invalid-input", 400);
  }
  const uid = typeof body.uid === "string" ? canonicalPersonaUid(body.uid) : null;
  if (uid === null) return errorResponse("invalid-input", 400);

  const result = await coreCall("user_detail", {
    persona_contract_version: PERSONA_ADMIN_CONTRACT_VERSION,
    uid: String(uid),
    admin_email: writer.session.email,
  });
  if (result.status === 401 || result.status === 403) {
    return errorResponse("auth-required", 401);
  }

  const target = personaTargetFromUserDetail(result.data);
  const data = target ? personaTargetLookupData(target) : null;
  if (!data || data.uid !== uid) {
    const coreError = record(result.data)?.error;
    if (result.status === 404 && coreError === "user-not-found") {
      return errorResponse("user-not-found", 404);
    }
    const status = result.status >= 400 && result.status <= 599 ? result.status : 502;
    return errorResponse("persona-member-lookup-failed", status);
  }

  return json({ success: true, status_code: 200, data }, 200);
}
