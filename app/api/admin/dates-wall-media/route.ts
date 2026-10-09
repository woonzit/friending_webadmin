import { NextRequest, NextResponse } from "next/server";
import { coreBinaryCall, coreCall } from "@/lib/core";
import { serveDatesWallMedia } from "@/lib/datesWallMediaBridge";
import { readAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * A private event-wall photo or clip of a moderation case's evidence, through
 * Core's audited `dates_wall_evidence_media`. POST only: the console's own
 * script asks with the mutation header, so a link, an embed and another site
 * cannot. Everything it decides is lib/datesWallMediaBridge.ts.
 */
export async function POST(request: NextRequest) {
  const reply = await serveDatesWallMedia(
    { headers: request.headers, body: request.body, signal: request.signal },
    { session: readAdminSession, core: coreCall, binary: coreBinaryCall },
  );
  return "bytes" in reply
    ? new NextResponse(Buffer.from(reply.bytes), { status: reply.status, headers: reply.headers })
    : NextResponse.json(reply.json, { status: reply.status, headers: reply.headers });
}
