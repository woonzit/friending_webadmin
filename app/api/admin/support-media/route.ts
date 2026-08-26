import { NextRequest, NextResponse } from "next/server";
import { coreMultipartCall } from "@/lib/core";
import { isTrustedAdminRequest } from "@/lib/requestGuard";
import { requireAdminWriter } from "@/lib/session";
import {
  MAX_SUPPORT_IMAGE_INPUT_BYTES,
  normalizeSupportImage,
  SupportImageError,
} from "@/lib/supportImage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_MULTIPART_OVERHEAD = 512 * 1024;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function POST(request: NextRequest) {
  if (!isTrustedAdminRequest(request.headers)) return failure("bad-origin", 403);

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength <= 0) {
    return failure("invalid-input", 400);
  }
  if (declaredLength > MAX_SUPPORT_IMAGE_INPUT_BYTES + MAX_MULTIPART_OVERHEAD) {
    return failure("support-image-too-large", 413);
  }

  const writer = await requireAdminWriter();
  if (!writer.ok) return failure(writer.error, writer.status);

  let image: File;
  let uid = 0;
  let requestId = "";
  try {
    const form = await request.formData();
    const entry = form.get("image");
    if (!(entry instanceof File)) return failure("support-image-missing", 400);
    image = entry;
    uid = Number(form.get("uid"));
    requestId = String(form.get("request_id") ?? "").trim().toLowerCase();
  } catch {
    return failure("invalid-input", 400);
  }
  if (!Number.isSafeInteger(uid) || uid <= 0 || !REQUEST_ID.test(requestId)) {
    return failure("invalid-input", 422);
  }
  if (image.size === 0) return failure("support-image-missing", 400);
  if (image.size > MAX_SUPPORT_IMAGE_INPUT_BYTES) {
    return failure("support-image-too-large", 413);
  }

  let normalized;
  try {
    normalized = await normalizeSupportImage(Buffer.from(await image.arrayBuffer()));
  } catch (error) {
    if (error instanceof SupportImageError) return failure(error.code, error.status);
    return failure("support-image-upload-failed", 500);
  }

  const result = await coreMultipartCall<{
    success?: boolean;
    status_code?: number;
    error?: string;
    message?: unknown;
  }>(
    "support_send",
    {
      uid,
      request_id: requestId,
      admin_email: writer.session.email,
    },
    { buffer: normalized.buffer, mime: normalized.mime, filename: "support.jpg" },
    35_000,
  );
  if (result.status === 401 || result.status === 403) {
    return failure("auth-required", 401);
  }
  if (!result.data) return failure("core-unavailable", result.status || 502);
  return NextResponse.json(result.data, { status: result.status || 502 });
}
