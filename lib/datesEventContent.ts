import { datesAdminPrincipal } from "./datesAdmin";

export const EVENT_CONTENT_KINDS = ["wall_post", "wall_comment", "message", "review", "hidden"] as const;
export type EventContentKind = typeof EVENT_CONTENT_KINDS[number];
export type EventReviewKind = Exclude<EventContentKind, "hidden"> | "activity";
export type EventContentRow = {
  id: string; kind: Exclude<EventContentKind, "hidden">; author_uid: number | null; text: string;
  content_kind: string; state: "active" | "pending" | "moderated" | "deleted";
  post_id: string | null; root_id: string | null; created_at: number; signal_at: number | null;
  has_media: boolean; hide_count: number; report_count: number; case_id: string | null; can_review: boolean;
};
export type EventContentPage = { items: EventContentRow[]; has_more: boolean; next_cursor: string | null };
export type EventReviewRequest = { activity_id: string; kind: EventReviewKind; target_id: string; reason: string;
  break_glass: boolean; idempotency_key: string };
const prefixes = { wall_post: "wpo", wall_comment: "wco", message: "msg", review: "rev", activity: "act" } as const;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown, prefix: string): v is string => typeof v === "string" && new RegExp(`^${prefix}_[a-f0-9]{32}$`).test(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const text = (v: unknown, min: number, max: number): v is string => typeof v === "string" && Array.from(v).length >= min && Array.from(v).length <= max;
const envelope = (v: unknown): v is Record<string, unknown> => record(v) && v.success === true && v.status_code === 200
  && v.message === 200 && v.status === 200 && v.can_send === 0 && v.event_content_version === 1;

export function eventContentPage(value: unknown, activityId: string, kind: EventContentKind, postId = ""): EventContentPage | null {
  if (!envelope(value) || value.activity_id !== activityId || !id(activityId, "act") || value.kind !== kind
    || !id(value.audit_id, "aud") || !count(value.server_now) || !Array.isArray(value.items) || value.items.length > 20
    || typeof value.has_more !== "boolean" || (value.has_more ? !text(value.next_cursor, 1, 4096) || value.items.length !== 20 : value.next_cursor !== null)) return null;
  const items: EventContentRow[] = [];
  for (const row of value.items) {
    if (!record(row) || !["wall_post", "wall_comment", "message", "review"].includes(String(row.kind))) return null;
    const rowKind = row.kind as EventContentRow["kind"];
    if ((kind === "hidden" ? !["wall_post", "wall_comment"].includes(rowKind) : rowKind !== kind)
      || !id(row.id, prefixes[rowKind]) || items.some(item => item.id === row.id)
      || !(row.author_uid === null || count(row.author_uid) && row.author_uid > 0) || !text(row.text, 0, 16000)
      || !["text", "photo", "video", "location", "link", "youtube", "tiktok"].includes(String(row.content_kind))
      || !["active", "pending", "moderated", "deleted"].includes(String(row.state))
      || !(row.post_id === null || id(row.post_id, "wpo")) || !(row.root_id === null || id(row.root_id, "wco"))
      || !count(row.created_at) || !(row.signal_at === null || count(row.signal_at))
      || (kind === "hidden" ? row.signal_at === null : row.signal_at !== null)
      || typeof row.has_media !== "boolean" || typeof row.can_review !== "boolean"
      || !count(row.hide_count) || !count(row.report_count) || !(row.case_id === null || id(row.case_id, "cas"))
      || (row.state === "deleted" && (row.text !== "" || row.author_uid !== null || row.can_review || row.has_media))
      || (rowKind === "wall_comment" && row.state !== "deleted" && row.post_id === null)
      || (postId !== "" && row.post_id !== postId)) return null;
    items.push(row as EventContentRow);
  }
  return { items, has_more: value.has_more, next_cursor: value.next_cursor as string | null };
}

export function eventContentReviewReceipt(value: unknown, request: EventReviewRequest): { case_id: string; created: boolean } | null {
  return envelope(value) && value.activity_id === request.activity_id && value.kind === request.kind && value.target_id === request.target_id
    && id(value.case_id, "cas") && id(value.audit_id, "aud") && typeof value.created === "boolean" && typeof value.idempotency_replayed === "boolean"
    ? { case_id: value.case_id, created: value.created } : null;
}

export function eventContentProxyAuthorized(action: string, membership: unknown): boolean | null {
  if (!["dates_event_content", "dates_event_content_review"].includes(action)) return null;
  const principal = datesAdminPrincipal(membership);
  return !!principal && principal.capabilities.includes("dates_evidence_read")
    && (action !== "dates_event_content_review" || principal.capabilities.includes("dates_case_claim"));
}

/** Closed request shape; actor and secret are still supplied only by the authenticated server. */
export function normalizeEventContentBody(action: string, body: Record<string, unknown>): Record<string, unknown> | null | undefined {
  if (!["dates_event_content", "dates_event_content_review"].includes(action)) return undefined;
  const write = action === "dates_event_content_review";
  const allowed = ["activity_id", "kind", "break_glass", "reason", ...(write ? ["target_id", "idempotency_key"] : ["post_id", "cursor"])];
  if (Object.keys(body).some(key => !allowed.includes(key)) || !id(body.activity_id, "act")
    || !(write ? Object.hasOwn(prefixes, String(body.kind)) : EVENT_CONTENT_KINDS.includes(body.kind as EventContentKind))
    || (body.break_glass !== undefined && typeof body.break_glass !== "boolean")
    || (body.reason !== undefined && !text(body.reason, 3, 1000))
    || ((write || body.break_glass === true) && !text(body.reason, 3, 1000))) return null;
  if (write) {
    if (!id(body.target_id, prefixes[body.kind as EventReviewKind]) || (body.kind === "activity" && body.target_id !== body.activity_id)
      || typeof body.idempotency_key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(body.idempotency_key)) return null;
  } else if ((body.post_id !== undefined && (body.kind !== "wall_comment" || !id(body.post_id, "wpo")))
    || (body.cursor !== undefined && !text(body.cursor, 1, 4096))) return null;
  return { ...body };
}
