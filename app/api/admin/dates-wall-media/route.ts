import { NextRequest, NextResponse } from "next/server";
import { coreBinaryCall, coreCall } from "@/lib/core";
import { readAdminSession } from "@/lib/session";
import { serveDatesWallMedia } from "@/lib/datesWallMediaBridge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function boundedBody(request: NextRequest): Promise<unknown> {
  if (!request.body) throw new Error("empty-body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 8192) { await reader.cancel(); throw new Error("body-too-large"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function POST(request: NextRequest) {
  const reply = await serveDatesWallMedia({ headers: request.headers, body: () => boundedBody(request), signal: request.signal },
    { session: readAdminSession, core: coreCall, binary: coreBinaryCall });
  return reply.bytes ? new NextResponse(Buffer.from(reply.bytes), { status: reply.status, headers: reply.headers })
    : NextResponse.json(reply.json, { status: reply.status, headers: reply.headers });
}
