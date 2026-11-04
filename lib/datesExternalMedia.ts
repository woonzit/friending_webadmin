import { webadminEnvelope, webadminErrorEnvelope } from "@/lib/webadminEnvelope";

export type ExternalMediaPhoto = { id: string; url: string; moderation_state: "pending" | "approved" | "rejected" | "removed" | "appealed" };
export type ExternalMedia = { contract_version: 1; external_event_id: string; activity_id: string; revision: number; activity_revision: number;
  maximum_photos: 8; photos: ExternalMediaPhoto[]; featured_photo_id: string | null; can_manage: boolean };
export type ExternalMediaRequest = { action: "read"; external_event_id: string } | {
  action: "upload" | "feature" | "remove"; external_event_id: string; expected_revision: number; reason: string; idempotency_key: string;
  provenance?: "ai_generated" | "owned"; rights_confirmed?: "1"; photo_id?: string;
};
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown, prefix: string): v is string => typeof v === "string" && new RegExp(`^${prefix}_[a-f0-9]{32}$`).test(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const exact = (v: Record<string, unknown>, keys: string[]) => keys.length === Object.keys(v).length && keys.every(k => Object.hasOwn(v, k));
const https = (v: unknown): v is string => {
  if (typeof v !== "string" || v.length > 2048) return false;
  try { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; }
};

/** Closed dedicated contract; never expose raw Core metadata or storage paths. */
export function decodeExternalMedia(body: unknown, expectedId: string, receipt = false): ExternalMedia | null {
  const envelope = webadminEnvelope(body, true, ["media", "server_now", ...(receipt ? ["replayed", "audit_id"] : [])]);
  if (!envelope || envelope.status_code !== 200 || !integer(envelope.server_now) || !record(body) || Object.hasOwn(body, "error")
    || (receipt && (typeof body.replayed !== "boolean" || !id(body.audit_id, "aud")))) return null;
  const m = envelope.media;
  if (!record(m) || !exact(m, ["contract_version", "external_event_id", "activity_id", "revision", "activity_revision", "maximum_photos", "photos", "featured_photo_id", "can_manage"])
    || m.contract_version !== 1 || m.maximum_photos !== 8 || m.external_event_id !== expectedId || !id(m.external_event_id, "xev") || !id(m.activity_id, "act")
    || !integer(m.revision) || !integer(m.activity_revision) || typeof m.can_manage !== "boolean" || !Array.isArray(m.photos) || m.photos.length > 8) return null;
  const photos: ExternalMediaPhoto[] = [];
  for (const p of m.photos) {
    if (!record(p) || !exact(p, ["id", "url", "moderation_state"]) || !id(p.id, "pic") || !https(p.url)
      || !["pending", "approved", "rejected", "removed", "appealed"].includes(p.moderation_state as string) || photos.some(row => row.id === p.id)) return null;
    photos.push(p as ExternalMediaPhoto);
  }
  if (m.featured_photo_id !== (photos[0]?.id ?? null)) return null;
  return { contract_version: 1, external_event_id: expectedId, activity_id: m.activity_id, revision: m.revision, activity_revision: m.activity_revision,
    maximum_photos: 8, photos, featured_photo_id: m.featured_photo_id as string | null, can_manage: m.can_manage };
}

export function normalizeExternalMediaRequest(v: unknown): ExternalMediaRequest | null {
  if (!record(v) || !id(v.external_event_id, "xev")) return null;
  if (v.action === "read") return exact(v, ["action", "external_event_id"]) ? v as ExternalMediaRequest : null;
  if (!["upload", "feature", "remove"].includes(v.action as string)) return null;
  const keys = ["action", "external_event_id", "expected_revision", "reason", "idempotency_key",
    ...(v.action === "upload" ? ["provenance", "rights_confirmed"] : ["photo_id"])];
  if (!exact(v, keys)) return null;
  const revision = typeof v.expected_revision === "string" && /^[1-9][0-9]{0,9}$/.test(v.expected_revision) ? Number(v.expected_revision) : v.expected_revision;
  if (!integer(revision) || typeof v.reason !== "string" || v.reason.trim().length < 3 || [...v.reason].length > 1000
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v.reason)
    || typeof v.idempotency_key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(v.idempotency_key)) return null;
  if (v.action === "upload" ? !["ai_generated", "owned"].includes(v.provenance as string) || v.rights_confirmed !== "1" : !id(v.photo_id, "pic")) return null;
  return { ...v, expected_revision: revision } as ExternalMediaRequest;
}

export type ExternalMediaPending = { version: 1; actor: string; request: Exclude<ExternalMediaRequest, { action: "read" }>; file_sha256: string | null };
export function decodeExternalMediaPending(value: unknown, actor: string, eventId: string): ExternalMediaPending | null {
  if (!record(value) || !exact(value, ["version", "actor", "request", "file_sha256"]) || value.version !== 1 || value.actor !== actor) return null;
  const request = normalizeExternalMediaRequest(value.request);
  if (!request || request.action === "read" || request.external_event_id !== eventId
    || (request.action === "upload" ? typeof value.file_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.file_sha256) : value.file_sha256 !== null)) return null;
  return { version: 1, actor, request, file_sha256: value.file_sha256 as string | null };
}

/** Only proven no-write refusals allow choosing another file or revision. */
export function externalMediaNoWrite(body: unknown): "invalidFile" | "conflict" | "duplicate" | "publishingDisabled" | null {
  if (!record(body) || body.success !== false) return null;
  // These three names are emitted only by this bridge before forwarding.
  if ((body.status_code === 422 && body.error === "image-invalid") || (body.status_code === 413 && body.error === "image-too-large")
    || (body.status_code === 400 && body.error === "invalid-input")) return "invalidFile";
  const refusal = webadminErrorEnvelope(body);
  if (!refusal) return null;
  if (refusal.status_code === 403 && refusal.error === "dates-external-publishing-disabled") return "publishingDisabled";
  if (refusal.status_code === 409 && ["dates-external-conflict", "dates-external-media-state-invalid", "dates-external-media-limit",
    "dates-external-media-required", "dates-external-media-duplicate"].includes(refusal.error))
    return refusal.error === "dates-external-media-duplicate" ? "duplicate" : "conflict";
  if ([400, 413, 422].includes(refusal.status_code) && /^dates-photo-(missing|too-large|invalid|format-invalid|dimensions-invalid|upload-failed|processing-failed)$/.test(refusal.error)) return "invalidFile";
  return null;
}
