import { NextRequest, NextResponse } from "next/server";
import { coreMultipartCall } from "@/lib/core";
import { isTrustedAdminRequest } from "@/lib/requestGuard";
import { requireAdminWriter } from "@/lib/session";
import {
  AdminProfileIconError,
  MAX_ADMIN_PROFILE_ICON_BYTES,
  validateAdminProfileIcon,
} from "@/lib/adminProfileIcon";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_MULTIPART_OVERHEAD = 128 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/svg+xml"]);

function errorResponse(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function POST(request: NextRequest) {
  if (!isTrustedAdminRequest(request.headers)) return errorResponse("bad-origin", 403);
  const declaredLength = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declaredLength) || declaredLength <= 0) {
    return errorResponse("invalid-input", 400);
  }
  if (declaredLength > MAX_ADMIN_PROFILE_ICON_BYTES + MAX_MULTIPART_OVERHEAD) {
    return errorResponse("pinger-icon-too-large", 413);
  }

  const writer = await requireAdminWriter();
  if (!writer.ok) return errorResponse(writer.error, writer.status);

  let icon: File;
  let variant: "light" | "dark";
  try {
    const form = await request.formData();
    const entry = form.get("icon");
    const rawVariant = form.get("variant");
    if (!(entry instanceof File)) return errorResponse("pinger-icon-missing", 400);
    if (rawVariant !== "light" && rawVariant !== "dark") {
      return errorResponse("pinger-icon-variant-invalid", 422);
    }
    icon = entry;
    variant = rawVariant;
  } catch {
    return errorResponse("invalid-input", 400);
  }
  if (icon.size === 0) return errorResponse("pinger-icon-missing", 400);
  if (icon.size > MAX_ADMIN_PROFILE_ICON_BYTES) return errorResponse("pinger-icon-too-large", 413);
  if (!ALLOWED_MIME.has(icon.type)) return errorResponse("pinger-icon-format-invalid", 422);

  let validated;
  try {
    validated = validateAdminProfileIcon(Buffer.from(await icon.arrayBuffer()), icon.type);
  } catch (error) {
    if (error instanceof AdminProfileIconError) {
      const code = error.code.replace("profile-icon", "pinger-icon");
      return errorResponse(code, error.status);
    }
    return errorResponse("pinger-icon-upload-failed", 500);
  }

  const result = await coreMultipartCall(
    "upload_pinger_icon",
    {
      admin_email: writer.session.email,
      variant,
    },
    {
      buffer: validated.buffer,
      mime: validated.mime,
      filename: validated.mime === "image/svg+xml" ? "pinger.svg" : "pinger.png",
    },
    30_000,
  );
  if (result.status === 401 || result.status === 403) return errorResponse("auth-required", 401);
  const root = record(result.data);
  const data = record(root?.data);
  if (!root?.success || !data || typeof data.media_url !== "string") {
    const error = typeof root?.error === "string" ? root.error : "pinger-icon-upload-failed";
    return errorResponse(error, result.status || 502);
  }
  return NextResponse.json({ success: true, ...data }, { status: 200 });
}
