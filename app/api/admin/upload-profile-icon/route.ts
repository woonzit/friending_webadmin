import { NextRequest, NextResponse } from "next/server";
import { coreCall } from "@/lib/core";
import { isTrustedAdminRequest } from "@/lib/requestGuard";
import { requireAdminWriter } from "@/lib/session";
import {
  AdminProfileIconError,
  MAX_ADMIN_PROFILE_ICON_BYTES,
  validateAdminProfileIcon,
} from "@/lib/adminProfileIcon";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_ICON_BYTES = MAX_ADMIN_PROFILE_ICON_BYTES;
const MAX_MULTIPART_OVERHEAD = 128 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/svg+xml"]);

function errorResponse(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function POST(request: NextRequest) {
  if (!isTrustedAdminRequest(request.headers)) {
    return errorResponse("bad-origin", 403);
  }
  const lengthHeader = request.headers.get("content-length");
  const declaredLength = Number(lengthHeader);
  if (!lengthHeader || !Number.isFinite(declaredLength) || declaredLength <= 0) {
    return errorResponse("invalid-input", 400);
  }
  if (declaredLength > MAX_ICON_BYTES + MAX_MULTIPART_OVERHEAD) {
    return errorResponse("profile-icon-too-large", 413);
  }
  // Writing bytes into public media storage is a write, so it needs the write
  // role and not only an active membership row.
  const writer = await requireAdminWriter();
  if (!writer.ok) return errorResponse(writer.error, writer.status);
  const session = writer.session;

  let icon: File;
  try {
    const form = await request.formData();
    const entry = form.get("icon");
    if (!(entry instanceof File)) return errorResponse("profile-icon-missing", 400);
    icon = entry;
  } catch {
    return errorResponse("invalid-input", 400);
  }
  if (icon.size === 0) return errorResponse("profile-icon-missing", 400);
  if (icon.size > MAX_ICON_BYTES) return errorResponse("profile-icon-too-large", 413);
  if (!ALLOWED_MIME.has(icon.type)) {
    return errorResponse("profile-icon-format-invalid", 422);
  }

  let validated;
  try {
    validated = validateAdminProfileIcon(Buffer.from(await icon.arrayBuffer()), icon.type);
  } catch (error) {
    if (error instanceof AdminProfileIconError) {
      return errorResponse(error.code, error.status);
    }
    return errorResponse("profile-icon-upload-failed", 500);
  }

  const result = await coreCall<{
    success?: boolean;
    error?: string;
    media_url?: string;
    mime?: string;
    size_bytes?: number;
  }>("upload_profile_icon", {
    admin_email: session.email,
    icon_mime: validated.mime,
    icon_b64: validated.buffer.toString("base64"),
  }, 30_000);
  if (result.status === 401 || result.status === 403) {
    return errorResponse("auth-required", 401);
  }
  return NextResponse.json(
    result.data ?? { success: false, error: "profile-icon-upload-failed" },
    { status: result.status || 502 },
  );
}
