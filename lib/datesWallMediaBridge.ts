import { classifyAdminMembership } from "@/lib/adminMembership";
import { datesAdminPrincipal, hasDatesCapability } from "@/lib/datesAdmin";
import type { CoreCallOptions } from "@/lib/core";
import { isTrustedAdminRequest } from "@/lib/requestGuard";

export const WALL_MEDIA_LIMIT = 12 * 1024 * 1024;
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", "X-Content-Type-Options": "nosniff" };
type Reply = { status: number; headers: Record<string, string>; bytes?: Uint8Array; json?: { success: false; error: string } };
type Dependencies = {
  session: () => Promise<{ email: string } | null>;
  core: (action: string, payload: Record<string, unknown>, timeout?: number, options?: CoreCallOptions) => Promise<{ status: number; data: unknown }>;
  binary: (action: string, payload: Record<string, unknown>, range: string | null) => Promise<Response | null>;
};
const refusal = (error: string, status: number): Reply => ({ status, headers: NO_STORE, json: { success: false, error } });

/** POST-only, live-authorized, bounded private evidence. Never accept a browser-supplied actor. */
export async function serveDatesWallMedia(request: {
  headers: { get(name: string): string | null }; body: () => Promise<unknown>; signal?: AbortSignal;
}, deps: Dependencies): Promise<Reply> {
  if (!isTrustedAdminRequest(request.headers)) return refusal("bad-origin", 403);
  if (Number(request.headers.get("content-length") ?? 0) > 8192) return refusal("invalid-input", 413);
  let body: unknown;
  try { body = await request.body(); } catch { return refusal("invalid-input", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return refusal("invalid-input", 400);
  const row = body as Record<string, unknown>;
  if (Object.keys(row).some((key) => !["case_id", "evidence_id", "break_glass", "include_sensitive_location", "reason"].includes(key))
    || typeof row.case_id !== "string" || !/^cas_[a-f0-9]{32}$/.test(row.case_id)
    || typeof row.evidence_id !== "string" || !/^evi_[a-f0-9]{32}$/.test(row.evidence_id)
    || typeof row.break_glass !== "boolean" || typeof row.include_sensitive_location !== "boolean"
    || !(row.reason === null || typeof row.reason === "string" && row.reason.length <= 1000)) return refusal("invalid-input", 400);
  try {
    const session = await deps.session();
    if (!session) return refusal("auth-required", 401);
    const membership = classifyAdminMembership(await deps.core("admin_me", { admin_email: session.email }, undefined,
      { signal: request.signal, membershipCheck: true }), session.email, request.signal?.aborted);
    if (membership.kind === "revoked") return refusal("auth-required", 401);
    if (membership.kind !== "confirmed") return refusal("admin-membership-unconfirmed", 503);
    const principal = datesAdminPrincipal(membership.membership);
    if (!principal || !hasDatesCapability(principal, "dates_evidence_read")) return refusal("dates-admin-capability-required", 403);
    const upstream = await deps.binary("dates_wall_evidence_media", { ...row, admin_email: session.email }, null);
    if (!upstream || request.signal?.aborted) return refusal("core-unavailable", 503);
    const mime = upstream.headers.get("content-type")?.split(";")[0].trim();
    if (upstream.status !== 200 || !["image/jpeg", "video/mp4"].includes(mime ?? "") || !upstream.body) {
      await upstream.body?.cancel();
      return refusal("dates-evidence-unavailable", 403);
    }
    const reader = upstream.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (request.signal?.aborted || length > WALL_MEDIA_LIMIT) { await reader.cancel(); return refusal("invalid-core-response", 502); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    if (!length) return refusal("invalid-core-response", 502);
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { status: 200, headers: { ...NO_STORE, "Content-Type": mime!, "Content-Length": String(length),
      "Cross-Origin-Resource-Policy": "same-origin", "Referrer-Policy": "no-referrer" }, bytes };
  } catch { return refusal("core-unavailable", 503); }
}
