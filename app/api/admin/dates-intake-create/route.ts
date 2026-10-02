import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { coreCall, coreMultipartFilesCall } from "@/lib/core";
import { serveDatesIntakeCreate } from "@/lib/datesIntakeBridge";
import { readAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "Draft from source" (T-865 P2a): a link, a line of text or one or two flyer
 * photos become an intake through Core's `dates_event_intake_create`. The
 * flyers travel to Core as multipart and are stored nowhere on this side.
 */
export async function POST(request: NextRequest) {
  const reply = await serveDatesIntakeCreate(
    { headers: request.headers, form: () => request.formData() },
    { session: readAdminSession, core: coreCall, coreFiles: coreMultipartFilesCall, requestId: randomUUID },
  );
  return NextResponse.json("json" in reply ? reply.json : null, { status: reply.status, headers: reply.headers });
}
