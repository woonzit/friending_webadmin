import { NextRequest, NextResponse } from "next/server";
import {
  AdminImageError,
  normalizeAdminImage,
} from "@/lib/adminImage";
import { MAX_ADMIN_IMAGE_INPUT_BYTES } from "@/lib/adminImageConfig";
import { createAdminImageUploadPayload } from "@/lib/adminImageUploadPayload";
import { coreCall } from "@/lib/core";
import { ADMIN_MEMBERSHIP_UNCONFIRMED } from "@/lib/adminMembership";
import { adminPostForwardError } from "@/lib/adminPostForward";
import { isTrustedAdminRequest } from "@/lib/requestGuard";
import { requireAdminWriter } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_MULTIPART_OVERHEAD = 512 * 1024;
const UPLOAD_TIMEOUT_MS = 30_000;

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
  if (
    declaredLength > MAX_ADMIN_IMAGE_INPUT_BYTES + MAX_MULTIPART_OVERHEAD
  ) {
    return errorResponse("image-too-large", 413);
  }

  // Writing bytes into public media storage is a write, so it needs the write
  // role and not only an active membership row.
  const writer = await requireAdminWriter(request.signal);
  if (!writer.ok) {
    return errorResponse(writer.error, writer.status);
  }
  const session = writer.session;

  let image: File;
  try {
    const form = await request.formData();
    if (request.signal?.aborted) return errorResponse(ADMIN_MEMBERSHIP_UNCONFIRMED, 503);
    const entry = form.get("image");
    if (!(entry instanceof File)) {
      return errorResponse("image-missing", 400);
    }
    image = entry;
  } catch {
    return errorResponse("invalid-input", 400);
  }

  if (image.size === 0) {
    return errorResponse("image-missing", 400);
  }
  if (image.size > MAX_ADMIN_IMAGE_INPUT_BYTES) {
    return errorResponse("image-too-large", 413);
  }

  let normalized;
  try {
    normalized = await normalizeAdminImage(Buffer.from(await image.arrayBuffer()));
  } catch (error) {
    if (error instanceof AdminImageError) {
      return errorResponse(error.code, error.status);
    }
    return errorResponse("image-upload-failed", 500);
  }

  if (request.signal?.aborted) return errorResponse(ADMIN_MEMBERSHIP_UNCONFIRMED, 503);
  const result = await coreCall<{
    success?: boolean;
    error?: string;
    media_url?: string;
    mime?: string;
    width?: number;
    height?: number;
    size_bytes?: number;
  }>(
    "upload_image",
    createAdminImageUploadPayload(session.email, normalized.buffer),
    UPLOAD_TIMEOUT_MS,
    { signal: request.signal, strictResponse: true },
  );
  const postForwardError = adminPostForwardError(result, session.email, request.signal?.aborted === true);
  if (postForwardError) return errorResponse(postForwardError.error, postForwardError.status);
  if (
    result.status !== 200
    || !result.data?.success
    || typeof result.data.media_url !== "string"
  ) {
    // Core returning 200 with success:true but no usable media_url is still a failure. Echoing its
    // body back would republish that success to the browser, which would then proceed with no URL.
    const failed = result.data && result.data.success !== true
      ? result.data
      : { success: false, error: "image-upload-failed" };
    return NextResponse.json(failed, { status: result.status === 200 ? 502 : (result.status || 502) });
  }

  return NextResponse.json(result.data, { status: 200 });
}
