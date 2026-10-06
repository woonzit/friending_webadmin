import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { coreCall, coreMultipartFilesCall } from "@/lib/core";
import { serveDatesIntakeMedia } from "@/lib/datesIntakeBridge";
import { readAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * A flyer of an event intake (T-865 P2a), as the metadata-free JPEG Core
 * keeps, through Core's audited `dates_event_intake_image`. Modelled on the
 * profile-verification evidence route: same-origin media element only,
 * session and live membership on every read, never a public or cacheable URL.
 */
export async function GET(request: NextRequest) {
  const reply = await serveDatesIntakeMedia(
    { headers: request.headers, searchParams: request.nextUrl.searchParams, signal: request.signal },
    { session: readAdminSession, core: coreCall, coreFiles: coreMultipartFilesCall, requestId: randomUUID },
  );
  return "bytes" in reply
    ? new NextResponse(Buffer.from(reply.bytes), { status: reply.status, headers: reply.headers })
    : NextResponse.json(reply.json, { status: reply.status, headers: reply.headers });
}
