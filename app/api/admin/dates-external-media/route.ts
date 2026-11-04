import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { normalizeAdminImage } from "@/lib/adminImage";
import { coreCall, coreMultipartFilesCall } from "@/lib/core";
import { serveExternalMedia } from "@/lib/datesExternalMediaBridge";
import { readAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const result = await serveExternalMedia({ headers: request.headers, signal: request.signal,
    json: () => request.json(), form: () => request.formData() },
  { session: readAdminSession, core: coreCall, coreFiles: coreMultipartFilesCall, normalize: normalizeAdminImage, requestId: randomUUID });
  return NextResponse.json("json" in result ? result.json : { success: false, error: "invalid-core-response" }, { status: result.status, headers: result.headers });
}
