import { ADMIN_MEMBERSHIP_UNCONFIRMED } from "@/lib/adminMembership";
import { readBoundedStream } from "@/lib/boundedStream";
import type { CoreCallOptions } from "@/lib/core";
import { datesBodyKeys, datesBoolean, datesId, datesRecord } from "@/lib/datesExternalAdmin";
import {
  DATES_INTAKE_MEDIA_HEADERS, datesBridgeCoreFailure, datesBridgeOperator, datesBridgeRefusal, type DatesIntakeBridgeReply,
} from "@/lib/datesIntakeBridge";
import { WALL_MEDIA_LIMIT, isWallMediaType, type DatesWallMediaType } from "@/lib/datesWallMedia";
import { isTrustedAdminRequest } from "@/lib/requestGuard";

/**
 * POST: the private photo or clip of one evidence row of a moderation case, as
 * Core's audited `dates_wall_evidence_media` serves it. The session, the
 * membership and the Core transport are injected, so the tests run this as it
 * is. Core is the authority on the case, the conflict of interest, break-glass
 * and the audit; this bridge re-checks who is asking, sends exactly the five
 * fields of the read, and hands the browser bytes of one of two types or a
 * refusal - never a storage URL.
 */
type HeaderReader = { get(name: string): string | null };
export type DatesWallMediaDeps = {
  session: () => Promise<{ email: string } | null>;
  core: (action: string, payload: Record<string, unknown>, timeoutMs?: number, options?: CoreCallOptions) => Promise<{ status: number; data: unknown }>;
  binary: (action: string, payload: Record<string, unknown>, range: string | null, timeoutMs?: number, signal?: AbortSignal) => Promise<Response | null>;
};

/** The five fields as JSON, with room to spare for a reason at its cap in four-byte characters. */
export const WALL_MEDIA_REQUEST_LIMIT = 8192;
/** A refusal of Core is a few hundred bytes; a longer answer that is not media is not read to its end. */
const REFUSAL_LIMIT = 64 * 1024;
const MEDIA_TIMEOUT_MS = 30_000;
const REQUEST_FIELDS = ["case_id", "evidence_id", "break_glass", "include_sensitive_location", "reason"];

/** A reason as Core's evidence read takes one (`DatesModerationReadService::reason`): none, or text that is not blank. */
const auditReason = (value: unknown): boolean => value === null
  || (typeof value === "string" && value.trim() !== "" && value.length <= 4000 && Array.from(value).length <= 1000);

/** The request's five fields, `"too-large"`, or `null`: not the JSON of exactly these fields. Never an actor: that is the session's. */
async function requestFields(body: ReadableStream<Uint8Array> | null): Promise<Record<string, unknown> | "too-large" | null> {
  if (!body) return null;
  let parsed: unknown;
  try {
    const bytes = await readBoundedStream(body, WALL_MEDIA_REQUEST_LIMIT);
    if (!bytes) return "too-large";
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { return null; }
  return datesRecord(parsed) && datesBodyKeys(parsed, REQUEST_FIELDS) && datesId("cas")(parsed.case_id) && datesId("evi")(parsed.evidence_id)
    && datesBoolean(parsed.break_glass) && datesBoolean(parsed.include_sensitive_location) && auditReason(parsed.reason) ? parsed : null;
}

const mediaType = (upstream: Response): DatesWallMediaType | null => {
  const type = upstream.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  return isWallMediaType(type) ? type : null;
};

/**
 * What Core said when it did not serve media: its JSON, under the status
 * `coreCall` would give it (Core answers a refusal with HTTP 200 and the
 * status in the body). Anything else is an answer this bridge cannot read.
 */
async function coreAnswer(upstream: Response): Promise<{ status: number; data: unknown }> {
  const unreadable = { status: 502, data: { success: false, error: "invalid-core-response" } };
  try {
    const bytes = upstream.body ? await readBoundedStream(upstream.body, REFUSAL_LIMIT) : null;
    if (!bytes) return unreadable;
    const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const logical = datesRecord(data) ? data.status_code : null;
    return typeof logical === "number" && Number.isInteger(logical) && logical >= 100 && logical <= 599 ? { status: logical, data } : unreadable;
  } catch { return unreadable; }
}

const dropped = (upstream: Response | null): void => { void upstream?.body?.cancel().catch(() => undefined); };

export async function serveDatesWallMedia(request: { headers: HeaderReader; body: ReadableStream<Uint8Array> | null; signal?: AbortSignal },
  deps: DatesWallMediaDeps): Promise<DatesIntakeBridgeReply> {
  if (!isTrustedAdminRequest(request.headers)) return datesBridgeRefusal("bad-origin", 403);
  if (Number(request.headers.get("content-length") ?? 0) > WALL_MEDIA_REQUEST_LIMIT) return datesBridgeRefusal("too-large", 413);
  // Who is asking comes before what is asked: a caller without a session or the capability learns nothing about a valid request.
  const who = await datesBridgeOperator(deps, "dates_evidence_read", request.signal);
  if (!("email" in who)) return who;
  const fields = await requestFields(request.body);
  if (fields === "too-large") return datesBridgeRefusal("too-large", 413);
  if (fields === null) return datesBridgeRefusal("invalid-input", 400);
  if (request.signal?.aborted) return datesBridgeRefusal(ADMIN_MEMBERSHIP_UNCONFIRMED, 503);

  let upstream: Response | null;
  // The browser gave up: the read of Core stops with it, and nothing of a late answer is kept.
  try { upstream = await deps.binary("dates_wall_evidence_media", { ...fields, admin_email: who.email }, null, MEDIA_TIMEOUT_MS, request.signal); }
  catch { upstream = null; }
  if (request.signal?.aborted) { dropped(upstream); return datesBridgeRefusal("core-timeout", 504); }
  if (!upstream) return datesBridgeRefusal("core-unavailable", 502);
  // Core answers this route with HTTP 200 or not at all: another status is its web server's, not an answer.
  if (upstream.status !== 200) { dropped(upstream); return datesBridgeRefusal("invalid-core-response", 502); }
  const type = mediaType(upstream);
  // Not media: Core's refusal (a conflict, a case that is gone, a reason that is required) travels on as its six keys under
  // its own status; a revoked operator is signed out; a failure of Core is named as one.
  if (type === null) return datesBridgeCoreFailure(await coreAnswer(upstream), who.email);

  let bytes: Uint8Array | null;
  try { bytes = upstream.body ? await readBoundedStream(upstream.body, WALL_MEDIA_LIMIT, request.signal) : null; } catch { bytes = null; }
  if (request.signal?.aborted) return datesBridgeRefusal("core-timeout", 504);
  if (!bytes || bytes.byteLength === 0) return datesBridgeRefusal("invalid-core-response", 502);
  // Private evidence: same-origin only, inert, never sniffed, cached or referred - the headers of the intake flyer, with this type.
  return { status: 200, headers: { ...DATES_INTAKE_MEDIA_HEADERS, "Content-Type": type, "Content-Length": String(bytes.byteLength) }, bytes };
}
