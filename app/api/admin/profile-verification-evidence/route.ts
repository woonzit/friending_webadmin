import { NextRequest, NextResponse } from "next/server";
import { coreBinaryCall } from "@/lib/core";
import {
  isProfileVerificationEvidenceKind,
  profileVerificationEvidenceContentType,
} from "@/lib/profileVerification";
import { isTrustedAdminMediaRead } from "@/lib/requestGuard";
import { requireAdminWriter } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CASE_ID = /^[a-f0-9]{32}$/;
const RANGE = /^bytes=(?:\d+-\d*|-\d+)$/;

function jsonError(error: string, status: number) {
  return NextResponse.json(
    { success: false, error },
    { status, headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}

/**
 * Private verification evidence: the video, the case-time avatar snapshot and
 * (D-135) the gesture photos `photo_1` … `photo_10`, all through Core's
 * audited `profile_verification_evidence`. The request guard is unchanged for
 * every kind (T-863 S3/S9): same-origin, and with no Referer only a media
 * element's own Fetch Metadata (`Sec-Fetch-Site: same-origin` +
 * `Sec-Fetch-Dest: image|video|audio`).
 */
export async function GET(request: NextRequest) {
  if (!isTrustedAdminMediaRead(request.headers)) {
    return jsonError("bad-origin", 403);
  }
  const writer = await requireAdminWriter();
  if (!writer.ok) return jsonError(writer.error, writer.status);

  const caseId = (request.nextUrl.searchParams.get("case_id") ?? "").trim();
  const kind = (request.nextUrl.searchParams.get("kind") ?? "").trim();
  if (!CASE_ID.test(caseId) || !isProfileVerificationEvidenceKind(kind)) {
    return jsonError("profile-verification-evidence-invalid", 422);
  }
  const range = request.headers.get("range");
  if (range !== null && !RANGE.test(range)) {
    return new NextResponse(null, {
      status: 416,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }

  const upstream = await coreBinaryCall(
    "profile_verification_evidence",
    { admin_email: writer.session.email, case_id: caseId, kind },
    range,
  );
  if (!upstream) return jsonError("core-unavailable", 502);

  const contentType = upstream.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("application/json")) {
    let payload: Record<string, unknown> = { success: false, error: "invalid-core-response" };
    try {
      const parsed = await upstream.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      // Keep the fail-closed payload above.
    }
    const logical = Number(payload.status_code);
    const status = Number.isInteger(logical) && logical >= 400 && logical <= 599
      ? logical
      : 502;
    return NextResponse.json(payload, {
      status,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }

  const expectedType = profileVerificationEvidenceContentType(kind);
  if (![200, 206].includes(upstream.status) || !contentType.toLowerCase().startsWith(expectedType)) {
    upstream.body?.cancel().catch(() => undefined);
    return jsonError("invalid-core-response", 502);
  }

  const headers = new Headers({
    "Content-Type": expectedType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "Content-Disposition": "inline",
  });
  for (const name of ["content-length", "content-range"] as const) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
