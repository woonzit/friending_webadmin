import { datesBridgeCoreFailure, datesBridgeOperator, datesBridgeRefusal, DATES_INTAKE_NO_STORE, type DatesIntakeBridgeDeps } from "@/lib/datesIntakeBridge";
import { decodeExternalMedia, normalizeExternalMediaRequest } from "@/lib/datesExternalMedia";
import { isTrustedAdminRequest } from "@/lib/requestGuard";
import type { NormalizedAdminImage } from "@/lib/adminImage";

type Deps = DatesIntakeBridgeDeps & { normalize: (bytes: Buffer) => Promise<NormalizedAdminImage> };
type Request = { headers: { get(name: string): string | null }; json: () => Promise<unknown>; form: () => Promise<FormData>; signal?: AbortSignal };
export async function serveExternalMedia(request: Request, deps: Deps) {
  if (!isTrustedAdminRequest(request.headers)) return datesBridgeRefusal("bad-origin", 403);
  const multipart = request.headers.get("content-type")?.startsWith("multipart/form-data") === true;
  const length = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(length) || length <= 0 || length > (multipart ? 11 * 1024 * 1024 : 16000)) return datesBridgeRefusal("invalid-input", 413);
  // Read access may be less privileged than uploads; determine only the
  // transport first. JSON's action is validated before a capability is used.
  const who = await datesBridgeOperator(deps, multipart ? "dates_external_event_manage" : "dates_external_event_read", request.signal);
  if (!("email" in who)) return who;
  let raw: unknown, image: File | null = null;
  try {
    if (multipart) {
      const form = await request.form();
      const fields: Record<string, unknown> = {};
      for (const key of new Set(form.keys())) {
        const entries = form.getAll(key);
        if (entries.length !== 1) return datesBridgeRefusal("invalid-input", 400);
        if (key === "image" && entries[0] instanceof File) image = entries[0];
        else if (typeof entries[0] === "string") fields[key] = entries[0];
        else return datesBridgeRefusal("invalid-input", 400);
      }
      raw = fields;
    } else raw = await request.json();
  } catch { return datesBridgeRefusal("invalid-input", 400); }
  if (request.signal?.aborted) return datesBridgeRefusal("admin-membership-unconfirmed", 503);
  const input = normalizeExternalMediaRequest(raw);
  if (!input || multipart !== (input.action === "upload")) return datesBridgeRefusal("invalid-input", 400);
  if (input.action !== "read" && !multipart) {
    const writer = await datesBridgeOperator(deps, "dates_external_event_manage", request.signal);
    if (!("email" in writer)) return writer;
    if (writer.email !== who.email) return datesBridgeRefusal("auth-required", 401);
  }
  const { action, ...fields } = input;
  const payload = { ...fields, admin_email: who.email, admin_request_id: deps.requestId(), ...(action === "feature" || action === "remove" ? { action } : {}) };
  let result;
  if (action === "upload") {
    if (!image || image.size <= 0 || image.size > 10 * 1024 * 1024) return datesBridgeRefusal("image-too-large", 413);
    let normalized;
    try { normalized = await deps.normalize(Buffer.from(await image.arrayBuffer())); }
    catch { return datesBridgeRefusal("image-invalid", 422); }
    if (request.signal?.aborted) return datesBridgeRefusal("admin-membership-unconfirmed", 503);
    result = await deps.coreFiles("dates_external_event_media_upload", payload,
      [{ field: "image", bytes: normalized.buffer, mime: normalized.mime, filename: normalized.mime === "image/png" ? "event-image.png" : "event-image.jpg" }], 60000, { signal: request.signal, strictResponse: true });
  } else result = await deps.core(action === "read" ? "dates_external_event_media" : "dates_external_event_media_command", payload, 30000,
    { signal: request.signal, strictResponse: true });
  if (request.signal?.aborted) return datesBridgeRefusal("core-timeout", 504);
  const media = decodeExternalMedia(result.data, input.external_event_id, action !== "read");
  if (!media || result.status !== 200) return datesBridgeCoreFailure(result, who.email);
  if (input.action !== "read" && media.revision !== input.expected_revision + 1) return datesBridgeRefusal("invalid-core-response", 502);
  const body = result.data as Record<string, unknown>;
  return { status: 200, headers: { ...DATES_INTAKE_NO_STORE }, json: { success: true, status_code: 200, message: 200, status: 200, can_send: 0,
    media, server_now: body.server_now, ...(action === "read" ? {} : { replayed: body.replayed, audit_id: body.audit_id }) } };
}
