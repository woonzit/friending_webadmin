import { NextRequest, NextResponse } from "next/server";
import { readBoundedText } from "@/lib/boundedStream";
import { coreCall } from "@/lib/core";
import { ADMIN_MEMBERSHIP_UNCONFIRMED } from "@/lib/adminMembership";
import { adminPostForwardError } from "@/lib/adminPostForward";
import {
  FRIENDINGGO_CONTRACT_VERSION,
  friendingGoConsoleReady,
  friendingGoError,
  friendingGoExport,
  friendingGoExportFilters,
} from "@/lib/friendinggo";
import { friendingGoCsv, friendingGoExportFilename } from "@/lib/friendinggoExport";
import { isTrustedAdminRequest } from "@/lib/requestGuard";
import { requireAdminWriter } from "@/lib/session";

export const dynamic = "force-dynamic";

/** `{"q": <at most 100 characters>, "status": "..."}` with room for escaping; nothing else is accepted. */
const BODY_LIMIT = 1_024;

function errorResponse(error: string, status: number) {
  return NextResponse.json({ success: false, status_code: status, error }, { status, headers: { "Cache-Control": "no-store" } });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * FriendingGO preorder CSV (D-153, T-937). An export is a WRITE on Core's ladder (it is audited before
 * anything is read, and it carries every address unmasked), so this dedicated route requires a
 * write-capable administrator and Core's `admin_me.friendinggo` block, asks Core's `go_preorders`
 * with `export=1` for exactly the list's two filters, and answers the parsed rows as a CSV file. Core
 * rechecks the role and writes the audit row; the browser never receives Core's body.
 */
export async function POST(request: NextRequest) {
  if (!isTrustedAdminRequest(request.headers)) return errorResponse("bad-origin", 403);
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > BODY_LIMIT) return errorResponse("too-large", 413);

  const writer = await requireAdminWriter(request.signal);
  if (!writer.ok) return errorResponse(writer.error, writer.status);
  if (!friendingGoConsoleReady(writer.membership)) return errorResponse("friendinggo-capability-required", 403);

  let filters;
  try {
    const raw = await readBoundedText(request.body, BODY_LIMIT);
    if (raw === null) return errorResponse("too-large", 413);
    const body = record(raw ? JSON.parse(raw) : {});
    filters = body ? friendingGoExportFilters(body) : null;
  } catch {
    return errorResponse("invalid-input", 400);
  }
  if (!filters) return errorResponse("invalid-input", 400);
  if (request.signal?.aborted) return errorResponse(ADMIN_MEMBERSHIP_UNCONFIRMED, 503);

  const result = await coreCall("go_preorders", {
    contract_version: FRIENDINGGO_CONTRACT_VERSION,
    q: filters.q,
    status: filters.status,
    export: 1,
    admin_email: writer.session.email,
  }, undefined, { signal: request.signal, strictResponse: true });
  const postForwardError = adminPostForwardError(result, writer.session.email, request.signal?.aborted === true);
  // A timeout keeps its own status, so the page can say the export may already be in the audit log (review P3-6).
  if (postForwardError) return errorResponse(postForwardError.error, postForwardError.error === "core-timeout" ? 504 : postForwardError.status);

  const exported = friendingGoExport(result.data, filters);
  if (!exported) {
    // Core's named refusal (a filter it refuses, the write role) keeps its name; anything else is unknown.
    const refusal = friendingGoError(result.data);
    return refusal && result.status >= 400 && result.status < 500
      ? errorResponse(refusal, result.status)
      : errorResponse("invalid-core-response", 502);
  }
  return new NextResponse(friendingGoCsv(exported.rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${friendingGoExportFilename(new Date())}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-FriendingGO-Row-Count": String(exported.row_count),
      "X-FriendingGO-Truncated": exported.truncated ? "1" : "0",
    },
  });
}
