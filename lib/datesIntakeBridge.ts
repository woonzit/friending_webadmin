import { adminBridgeCoreTransportError } from "@/lib/adminBridge";
import { invalidatesAdminSession } from "@/lib/adminActions";
import { datesAdminPrincipal, hasDatesCapability } from "@/lib/datesAdmin";
import { datesAdminContractParams } from "@/lib/datesAdminContract";
import { projectDatesAdminResponse } from "@/lib/datesAdminProjection";
import {
  DATES_INTAKE_MAX_IMAGE_BYTES, DATES_INTAKE_MAX_IMAGES, datesIntakeId, datesIntakeImageBytes, datesIntakeRefusal, datesIntakeUploadType,
  decodeDatesIntakeImage, normalizeDatesIntakeCreateFields, type DatesIntakeUploadType,
} from "@/lib/datesIntakeAdmin";
import { isTrustedAdminMediaRead, isTrustedAdminRequest } from "@/lib/requestGuard";

/**
 * The two server routes of the intake console that the generic action bridge
 * cannot serve: handing a flyer to Core (multipart) and showing the flyer
 * Core keeps (private bytes). The logic lives here, with the session and the
 * Core transport injected, so the tests run it as it is.
 *
 * Core is the authority on every rule; these routes re-check what the browser
 * claims and never widen what the operator may do.
 */
type HeaderReader = { get(name: string): string | null };
type CoreAnswer = { status: number; data: unknown };
export type DatesIntakeBridgeFile = { field: string; bytes: Uint8Array; mime: string; filename: string };
export type DatesIntakeBridgeDeps = {
  session: () => Promise<{ email: string } | null>;
  core: (action: string, payload: Record<string, unknown>, timeoutMs?: number) => Promise<CoreAnswer>;
  coreFiles: (action: string, payload: Record<string, unknown>, files: DatesIntakeBridgeFile[], timeoutMs?: number) => Promise<CoreAnswer>;
  requestId: () => string;
};
export type DatesIntakeBridgeReply =
  | { status: number; headers: Record<string, string>; json: unknown }
  | { status: 200; headers: Record<string, string>; bytes: Uint8Array };

/** Nothing this console answers about an intake may be kept by a browser, a proxy or a CDN. */
export const DATES_INTAKE_NO_STORE = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", Expires: "0" } as const;
/** The flyer is private evidence: same-origin only, inert, never sniffed and never referred. */
export const DATES_INTAKE_MEDIA_HEADERS = {
  ...DATES_INTAKE_NO_STORE,
  "Content-Type": "image/jpeg",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "Content-Disposition": "inline",
} as const;

/** Two flyers at Core's cap and their form fields; Core refuses a larger body itself. */
export const DATES_INTAKE_MAX_REQUEST_BYTES = DATES_INTAKE_MAX_IMAGES * DATES_INTAKE_MAX_IMAGE_BYTES + 1024 * 1024;
const MEDIA_TIMEOUT_MS = 30_000;
const CREATE_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 60_000;
const UPLOAD_MIME: Record<DatesIntakeUploadType, { mime: string; extension: string }> = {
  jpeg: { mime: "image/jpeg", extension: "jpg" }, png: { mime: "image/png", extension: "png" },
  webp: { mime: "image/webp", extension: "webp" }, heic: { mime: "image/heic", extension: "heic" },
};

function refusal(error: string, status: number): DatesIntakeBridgeReply {
  return { status, headers: { ...DATES_INTAKE_NO_STORE }, json: { success: false, status_code: status, error } };
}

/** Session, live membership and the Dates capability, checked on every call. */
async function operator(deps: DatesIntakeBridgeDeps, capability: string): Promise<{ email: string } | DatesIntakeBridgeReply> {
  const session = await deps.session();
  if (!session) return refusal("auth-required", 401);
  const membership = await deps.core("admin_me", { admin_email: session.email });
  const data = membership.data as { success?: unknown } | null;
  if (membership.status !== 200 || data?.success !== true) return refusal("auth-required", 401);
  const principal = datesAdminPrincipal(data);
  return principal && hasDatesCapability(principal, capability) ? { email: session.email } : refusal("dates-admin-capability-required", 403);
}

/** What Core answered when it is not the expected success: its own refusal, or a transport failure named as one. */
function coreFailure(result: CoreAnswer): DatesIntakeBridgeReply {
  const transport = adminBridgeCoreTransportError(result.status, result.data);
  if (transport) return refusal(transport.error, transport.status_code);
  const answered = datesIntakeRefusal(result.data);
  if (answered.kind === "unreadable") return refusal("invalid-core-response", 502);
  if (invalidatesAdminSession(answered.status, answered.error)) return refusal("auth-required", 401);
  // Core's refusal travels on as its six refusal keys, so the page can show exactly what Core said - and nothing beside it.
  return { status: answered.status, headers: { ...DATES_INTAKE_NO_STORE }, json: projectDatesAdminResponse("dates_event_intake_create", result.data) };
}

/**
 * GET: one flyer of an intake as the metadata-free JPEG Core keeps. Each read
 * is audited by Core. The image element of this console is the only reader:
 * a direct visit, another site and a script fetch are all refused.
 */
export async function serveDatesIntakeMedia(request: { headers: HeaderReader; searchParams: URLSearchParams }, deps: DatesIntakeBridgeDeps):
  Promise<DatesIntakeBridgeReply> {
  if (!isTrustedAdminMediaRead(request.headers)) return refusal("bad-origin", 403);
  const who = await operator(deps, "dates_external_event_review");
  if (!("email" in who)) return who;
  const intakeId = request.searchParams.get("intake_id") ?? "", rawIndex = request.searchParams.get("index") ?? "";
  if ([...request.searchParams.keys()].some((key) => key !== "intake_id" && key !== "index") || !datesIntakeId(intakeId)
    || !/^[1-9]$/.test(rawIndex) || Number(rawIndex) > DATES_INTAKE_MAX_IMAGES) return refusal("invalid-input", 400);
  const index = Number(rawIndex);
  const result = await deps.core("dates_event_intake_image",
    { admin_email: who.email, intake_id: intakeId, index, admin_request_id: deps.requestId(), ...datesAdminContractParams("dates_event_intake_image") }, MEDIA_TIMEOUT_MS);
  const read = decodeDatesIntakeImage(result.data, index);
  if (!read) return coreFailure(result);
  const bytes = datesIntakeImageBytes(read);
  if (!bytes) return refusal("invalid-core-response", 502);
  return { status: 200, headers: { ...DATES_INTAKE_MEDIA_HEADERS, "Content-Length": String(bytes.length) }, bytes };
}

const CREATE_FIELDS = ["kind", "url", "text", "locale", "idempotency_key"];
const IMAGE_FIELDS = ["image_1", "image_2"];

/**
 * POST (multipart): "Draft from source". A link, a line of text, or one or
 * two flyer photos, each at most 10 MiB and one of the types Core decodes.
 * The files go to Core as they are: Core re-encodes them, and nothing is
 * resized or stored here.
 */
export async function serveDatesIntakeCreate(request: { headers: HeaderReader; form: () => Promise<FormData> }, deps: DatesIntakeBridgeDeps):
  Promise<DatesIntakeBridgeReply> {
  if (!isTrustedAdminRequest(request.headers)) return refusal("bad-origin", 403);
  const declared = Number(request.headers.get("content-length") ?? "");
  if (!Number.isFinite(declared) || declared <= 0) return refusal("invalid-input", 400);
  if (declared > DATES_INTAKE_MAX_REQUEST_BYTES) return refusal("image-too-large", 413);
  const who = await operator(deps, "dates_external_event_manage");
  if (!("email" in who)) return who;

  let form: FormData;
  try { form = await request.form(); } catch { return refusal("invalid-input", 400); }
  const scalars: Record<string, unknown> = {}, uploads: Blob[] = [];
  for (const key of new Set(form.keys())) {
    const values = form.getAll(key);
    if (values.length !== 1) return refusal("invalid-input", 400);
    if (CREATE_FIELDS.includes(key) && typeof values[0] === "string") scalars[key] = values[0];
    else if (!IMAGE_FIELDS.includes(key) || typeof values[0] === "string") return refusal("invalid-input", 400);
  }
  for (const field of IMAGE_FIELDS) {
    const value = form.get(field);
    if (value === null) continue;
    // A second flyer without a first is not a list Core would read the same way.
    if (typeof value === "string" || uploads.length !== IMAGE_FIELDS.indexOf(field)) return refusal("invalid-input", 400);
    uploads.push(value);
  }
  const fields = normalizeDatesIntakeCreateFields(scalars, uploads.length);
  if (!fields) return refusal("invalid-input", 400);

  const payload: Record<string, unknown> = { admin_email: who.email, kind: fields.kind, locale: fields.locale,
    idempotency_key: fields.idempotency_key, admin_request_id: deps.requestId(), ...datesAdminContractParams("dates_event_intake_create") };
  if (fields.kind === "url") payload.url = fields.url;
  else if (fields.text !== null) payload.text = fields.text;

  let result: CoreAnswer;
  if (fields.kind === "images") {
    const files: DatesIntakeBridgeFile[] = [];
    for (const [position, upload] of uploads.entries()) {
      if (upload.size < 1) return refusal("invalid-input", 400);
      if (upload.size > DATES_INTAKE_MAX_IMAGE_BYTES) return refusal("image-too-large", 413);
      const bytes = new Uint8Array(await upload.arrayBuffer());
      const type = datesIntakeUploadType(bytes.subarray(0, 16));
      if (bytes.length !== upload.size || type === null) return refusal("image-type-unsupported", 415);
      files.push({ field: IMAGE_FIELDS[position], bytes, mime: UPLOAD_MIME[type].mime, filename: `flyer-${position + 1}.${UPLOAD_MIME[type].extension}` });
    }
    result = await deps.coreFiles("dates_event_intake_create", payload, files, UPLOAD_TIMEOUT_MS);
  } else {
    result = await deps.core("dates_event_intake_create", payload, CREATE_TIMEOUT_MS);
  }
  const data = result.data as { success?: unknown } | null;
  // The browser is handed the receipt's named fields only (lib/datesAdminProjection.ts), never Core's raw body.
  if (result.status === 200 && data?.success === true)
    return { status: 200, headers: { ...DATES_INTAKE_NO_STORE }, json: projectDatesAdminResponse("dates_event_intake_create", result.data) };
  return coreFailure(result);
}
