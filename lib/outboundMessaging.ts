import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";
import {
  cannedTemplateEmailPreviewDocument,
  isCanonicalCannedEmailHtml,
} from "@/lib/cannedTemplates";
import {
  webadminDataSuccessEnvelope,
  webadminErrorEnvelope,
} from "@/lib/webadminEnvelope";

/** Closed browser model for the accepted outbound-messaging contract v1. */

export const OUTBOUND_MESSAGING_CONTRACT_VERSION = 1 as const;
export const OUTBOUND_MESSAGING_MAX_RECIPIENTS = 100;
export const OUTBOUND_MESSAGING_HISTORY_PAGE_SIZE = 25;
export const OUTBOUND_MESSAGING_PREVIEW_SECONDS = 300;
export const OUTBOUND_MESSAGING_OVERALL_LIMIT = 500;
export const OUTBOUND_MESSAGING_SMS_PUSH_LIMIT = 200;

export const OUTBOUND_MESSAGING_ACTIONS = [
  "outbound_message_preview",
  "send_message",
  "user_history",
  "user_history_detail",
] as const;

export const OUTBOUND_MESSAGING_CHANNELS = ["email", "sms", "push"] as const;
export const OUTBOUND_MESSAGING_AVAILABILITY = [
  "available",
  "channel_absent",
  "opted_out",
  "banned",
  "not_migrated",
] as const;
export const OUTBOUND_MESSAGING_CAPABILITIES = [
  "outbound_messages_history_read",
  "outbound_messages_send",
] as const;
export const OUTBOUND_MESSAGING_OUTCOMES = ["sent", "queued", "skipped", "failed"] as const;
export const OUTBOUND_MESSAGING_HISTORY_STATUSES = [
  "queued",
  "sending",
  "retrying",
  "sent",
  "partially_sent",
  "failed",
  "skipped",
  "suppressed",
] as const;
export const OUTBOUND_MESSAGING_SKIPPED_REASONS = [
  "channel_absent",
  "opted_out",
  "banned",
  "not_migrated",
] as const;
export const OUTBOUND_MESSAGING_FAILURE_REASONS = [
  "provider_unavailable",
  "provider_rejected",
  "delivery_expired",
  "delivery_failed",
] as const;
export const OUTBOUND_MESSAGING_PUSH_MODES = ["fcm", "onesignal", "both"] as const;

export type OutboundMessagingAction = (typeof OUTBOUND_MESSAGING_ACTIONS)[number];
export type OutboundMessagingChannel = (typeof OUTBOUND_MESSAGING_CHANNELS)[number];
export type OutboundChannelAvailability = (typeof OUTBOUND_MESSAGING_AVAILABILITY)[number];
export type OutboundMessagingCapability = (typeof OUTBOUND_MESSAGING_CAPABILITIES)[number];
export type OutboundMessageOutcome = (typeof OUTBOUND_MESSAGING_OUTCOMES)[number];
export type OutboundHistoryStatus = (typeof OUTBOUND_MESSAGING_HISTORY_STATUSES)[number];
export type OutboundSkippedReason = (typeof OUTBOUND_MESSAGING_SKIPPED_REASONS)[number];
export type OutboundFailureReason = (typeof OUTBOUND_MESSAGING_FAILURE_REASONS)[number];
export type OutboundHistoryReason = OutboundSkippedReason | OutboundFailureReason;
export type OutboundPushMode = (typeof OUTBOUND_MESSAGING_PUSH_MODES)[number];
export type OutboundContentSource = "custom" | "template";
export type OutboundMessageFormat = "sanitized_html" | "plain_text";

export type OutboundMessagingPrincipal = {
  role: "viewer" | "admin" | "owner";
  capabilities: OutboundMessagingCapability[];
};

export type OutboundRecipientPreview = {
  uid: number;
  display_name: string;
  codename: string;
  channels: Record<OutboundMessagingChannel, OutboundChannelAvailability>;
};

export type OutboundRateBucket = {
  limit: number;
  used: number;
  remaining: number;
};

export type OutboundRecipientPreviewData = {
  contract_version: 1;
  principal: OutboundMessagingPrincipal;
  preview_id: string;
  evaluated_at: number;
  expires_at: number;
  requested_count: number;
  recipients: OutboundRecipientPreview[];
  limits: {
    max_recipients_per_request: 100;
    window_seconds: 300;
    overall: OutboundRateBucket;
    sms_push: OutboundRateBucket;
  };
};

export type OutboundPreviewRequest = {
  contract_version: 1;
  uids: string;
};

export type OutboundMessageDraft = {
  channel: OutboundMessagingChannel;
  contentSource: OutboundContentSource;
  templateId: string;
  templateRevision: number;
  subject: string;
  body: string;
  allowPartial: boolean | 0 | 1;
  auditReason: string;
};

export type OutboundMessageDraftMaterial = {
  type: OutboundMessagingChannel;
  content_source: OutboundContentSource;
  template_id: string;
  template_revision: number;
  subject: string;
  body: string;
  allow_partial: 0 | 1;
  audit_reason: string;
};

export type OutboundSendPayload = OutboundMessageDraftMaterial & {
  contract_version: 1;
  preview_id: string;
  uids: string;
  expected_revision: 0;
  request_id: string;
};

export type OutboundRecipientResult =
  | { uid: number; message_id: string; outcome: "sent"; reason: null }
  | { uid: number; message_id: string; outcome: "queued"; reason: null }
  | { uid: number; message_id: null; outcome: "skipped"; reason: OutboundSkippedReason }
  | { uid: number; message_id: string; outcome: "failed"; reason: OutboundFailureReason };

export type OutboundMessageSendData = {
  contract_version: 1;
  request_id: string;
  preview_id: string;
  channel: OutboundMessagingChannel;
  requested_count: number;
  sent: number;
  queued: number;
  skipped: number;
  failed: number;
  results: OutboundRecipientResult[];
  replayed: boolean;
};

export type OutboundPendingSend = {
  version: 1;
  action: "send";
  payload: OutboundSendPayload;
};

export type OutboundHistoryRequest = {
  contract_version: 1;
  uid: number;
  page_size: number;
  cursor: string;
};

export type OutboundHistoryDetailRequest = {
  contract_version: 1;
  uid: number;
  message_id: string;
};

export type OutboundHistoryTemplate = {
  template_id: string;
  revision: number;
};

export type OutboundHistoryEntry = {
  message_id: string;
  request_id: string;
  uid: number;
  channel: OutboundMessagingChannel;
  format: OutboundMessageFormat;
  subject: string;
  body_excerpt: string;
  content_sha256: string;
  template: OutboundHistoryTemplate | null;
  status: OutboundHistoryStatus;
  status_reason: OutboundHistoryReason | null;
  push_mode: OutboundPushMode | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  sent_by: string;
};

export type OutboundMessageHistoryData = {
  contract_version: 1;
  principal: OutboundMessagingPrincipal;
  uid: number;
  evaluated_at: number;
  messages: OutboundHistoryEntry[];
  next_cursor: string | null;
  total: number;
};

export type OutboundHistoryDetailEntry = Omit<OutboundHistoryEntry, "body_excerpt"> & {
  body: string;
};

export type OutboundMessageHistoryDetailData = {
  contract_version: 1;
  principal: OutboundMessagingPrincipal;
  evaluated_at: number;
  message: OutboundHistoryDetailEntry;
};

export type OutboundRecipientConflictData = {
  contract_version: 1;
  preview: OutboundRecipientPreviewData;
};

export type OutboundMessageDraftError =
  | "channel"
  | "contentSource"
  | "templateId"
  | "templateRevision"
  | "subject"
  | "body"
  | "allowPartial"
  | "auditReason"
  | "preview"
  | "previewExpired"
  | "uids"
  | "requestId";

export type OutboundMessageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: OutboundMessageDraftError };

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OBJECT_ID = /^[0-9a-f]{24}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const CURSOR = /^[A-Za-z0-9_=-]{1,256}$/u;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;
const ANY_CONTROL = /\p{Cc}/u;
const DISALLOWED_C0_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u;
const UNPAIRED_SURROGATE = /[\uD800-\uDFFF]/u;
const ACTION_SET: ReadonlySet<string> = new Set(OUTBOUND_MESSAGING_ACTIONS);

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

// Exact objects are reserved for browser-owned commands and persisted retry identities.
function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  const raw = object(value);
  if (!raw) return null;
  const actual = Object.keys(raw).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
    ? raw
    : null;
}

function requiredObject(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  const raw = object(value);
  return raw && keys.every((key) => Object.hasOwn(raw, key)) ? raw : null;
}

function integer(
  value: unknown,
  minimum: number,
  maximum = 2_147_483_647,
): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? value as T
    : null;
}

function scalarLength(value: string): number {
  return Array.from(value).length;
}

function canonicalWireText(
  value: unknown,
  minimum: number,
  maximum: number,
  controls: "text" | "body" = "body",
): string | null {
  if (typeof value !== "string"
    || value.trim() !== value
    || value.normalize("NFC") !== value
    || UNPAIRED_SURROGATE.test(value)
    || (controls === "text" ? ANY_CONTROL.test(value) : DISALLOWED_C0_CONTROL.test(value))) {
    return null;
  }
  const length = scalarLength(value);
  return length >= minimum && length <= maximum ? value : null;
}

function normalizedDraftText(
  value: unknown,
  minimum: number,
  maximum: number,
  controls: "text" | "body" = "body",
): string | null {
  if (typeof value !== "string" || UNPAIRED_SURROGATE.test(value)) return null;
  return canonicalWireText(value.trim().normalize("NFC"), minimum, maximum, controls);
}

function positiveUid(value: unknown): number | null {
  return integer(value, 1);
}

function requestId(value: unknown): string | null {
  return typeof value === "string" && REQUEST_ID.test(value) ? value : null;
}

function previewId(value: unknown): string | null {
  return requestId(value);
}

function objectId(value: unknown): string | null {
  return typeof value === "string" && OBJECT_ID.test(value) ? value : null;
}

function cursor(value: unknown, allowEmpty: boolean): string | null {
  if (allowEmpty && value === "") return "";
  return typeof value === "string" && CURSOR.test(value) ? value : null;
}

function canonicalEmail(value: unknown): string | null {
  const parsed = canonicalWireText(value, 3, 320, "text");
  return parsed && parsed === parsed.toLowerCase() && EMAIL.test(parsed) ? parsed : null;
}

function formatForChannel(channel: OutboundMessagingChannel): OutboundMessageFormat {
  return channel === "email" ? "sanitized_html" : "plain_text";
}

export function normalizeOutboundRequestId(value: unknown): string | null {
  return typeof value === "string" ? requestId(value.toLowerCase()) : null;
}

export function parseOutboundUidList(value: unknown): number[] | null {
  if (typeof value !== "string" || value === "") return null;
  const parts = value.split(",");
  if (parts.length < 1 || parts.length > OUTBOUND_MESSAGING_MAX_RECIPIENTS) return null;
  const uids: number[] = [];
  for (const part of parts) {
    if (!/^[1-9][0-9]*$/u.test(part)) return null;
    const uid = Number(part);
    if (positiveUid(uid) === null || (uids.length > 0 && uids[uids.length - 1] >= uid)) return null;
    uids.push(uid);
  }
  return uids;
}

export function normalizeOutboundUidList(values: readonly unknown[]): string | null {
  if (values.length < 1 || values.length > OUTBOUND_MESSAGING_MAX_RECIPIENTS) return null;
  const parsed: number[] = [];
  for (const value of values) {
    const uid = positiveUid(value);
    if (uid === null || parsed.includes(uid)) return null;
    parsed.push(uid);
  }
  parsed.sort((left, right) => left - right);
  return parsed.join(",");
}

export function outboundPreviewPayload(values: readonly unknown[]): OutboundPreviewRequest | null {
  const uids = normalizeOutboundUidList(values);
  return uids ? { contract_version: 1, uids } : null;
}

function structuralPreviewPayload(value: unknown): OutboundPreviewRequest | null {
  // Browser command bodies remain exact so undeclared fields cannot reach Core.
  const raw = exactObject(value, ["contract_version", "uids"]);
  return raw?.contract_version === 1 && parseOutboundUidList(raw.uids)
    ? { contract_version: 1, uids: raw.uids as string }
    : null;
}

export function outboundMessagingPrincipal(value: unknown): OutboundMessagingPrincipal | null {
  const raw = requiredObject(value, ["role", "capabilities"]);
  const role = oneOf(raw?.role, ["viewer", "admin", "owner"] as const);
  if (!raw || !role || !Array.isArray(raw.capabilities)) return null;
  const capabilities: OutboundMessagingCapability[] = [];
  for (const value of raw.capabilities) {
    const capability = oneOf(value, OUTBOUND_MESSAGING_CAPABILITIES);
    if (!capability || capabilities.includes(capability)) return null;
    capabilities.push(capability);
  }
  if (!capabilities.includes("outbound_messages_history_read")
    || capabilities.some((value, index) => index > 0 && capabilities[index - 1] > value)) return null;
  return { role, capabilities };
}

export function outboundMessagingCanSend(principal: OutboundMessagingPrincipal): boolean {
  return principal.capabilities.includes("outbound_messages_send");
}

function channelAvailability(value: unknown): Record<OutboundMessagingChannel, OutboundChannelAvailability> | null {
  const raw = requiredObject(value, OUTBOUND_MESSAGING_CHANNELS);
  const email = oneOf(raw?.email, OUTBOUND_MESSAGING_AVAILABILITY);
  const sms = oneOf(raw?.sms, OUTBOUND_MESSAGING_AVAILABILITY);
  const push = oneOf(raw?.push, OUTBOUND_MESSAGING_AVAILABILITY);
  return raw && email && sms && push ? { email, sms, push } : null;
}

function recipientPreview(value: unknown): OutboundRecipientPreview | null {
  const raw = requiredObject(value, ["uid", "display_name", "codename", "channels"]);
  const uid = positiveUid(raw?.uid);
  const displayName = canonicalWireText(raw?.display_name, 0, 120, "text");
  const codename = canonicalWireText(raw?.codename, 0, 64, "text");
  const channels = channelAvailability(raw?.channels);
  return raw && uid !== null && displayName !== null && codename !== null
    && codename === codename.toLowerCase() && channels
    ? { uid, display_name: displayName, codename, channels }
    : null;
}

function rateBucket(value: unknown, limit: number): OutboundRateBucket | null {
  const raw = requiredObject(value, ["limit", "used", "remaining"]);
  const used = integer(raw?.used, 0, limit);
  const remaining = integer(raw?.remaining, 0, limit);
  return raw?.limit === limit && used !== null && remaining !== null && used + remaining === limit
    ? { limit, used, remaining }
    : null;
}

export function outboundRecipientPreviewData(
  value: unknown,
  expectedUids?: readonly number[],
): OutboundRecipientPreviewData | null {
  const raw = requiredObject(value, [
    "contract_version",
    "principal",
    "preview_id",
    "evaluated_at",
    "expires_at",
    "requested_count",
    "recipients",
    "limits",
  ]);
  const principal = outboundMessagingPrincipal(raw?.principal);
  const id = previewId(raw?.preview_id);
  const evaluatedAt = integer(raw?.evaluated_at, 0, Number.MAX_SAFE_INTEGER);
  const expiresAt = integer(raw?.expires_at, 0, Number.MAX_SAFE_INTEGER);
  const requestedCount = integer(raw?.requested_count, 1, OUTBOUND_MESSAGING_MAX_RECIPIENTS);
  const limitsRaw = requiredObject(raw?.limits, [
    "max_recipients_per_request", "window_seconds", "overall", "sms_push",
  ]);
  const overall = rateBucket(limitsRaw?.overall, OUTBOUND_MESSAGING_OVERALL_LIMIT);
  const smsPush = rateBucket(limitsRaw?.sms_push, OUTBOUND_MESSAGING_SMS_PUSH_LIMIT);
  if (!raw || raw.contract_version !== 1 || !principal || !outboundMessagingCanSend(principal)
    || !id || evaluatedAt === null || expiresAt !== evaluatedAt + OUTBOUND_MESSAGING_PREVIEW_SECONDS
    || requestedCount === null || !Array.isArray(raw.recipients)
    || raw.recipients.length !== requestedCount || !limitsRaw
    || limitsRaw.max_recipients_per_request !== OUTBOUND_MESSAGING_MAX_RECIPIENTS
    || limitsRaw.window_seconds !== OUTBOUND_MESSAGING_PREVIEW_SECONDS || !overall || !smsPush) return null;

  const recipients: OutboundRecipientPreview[] = [];
  for (const value of raw.recipients) {
    const parsed = recipientPreview(value);
    if (!parsed || (recipients.length > 0 && recipients[recipients.length - 1].uid >= parsed.uid)) return null;
    recipients.push(parsed);
  }
  if (expectedUids && (expectedUids.length !== recipients.length
    || expectedUids.some((uid, index) => uid !== recipients[index].uid))) return null;
  return {
    contract_version: 1,
    principal,
    preview_id: id,
    evaluated_at: evaluatedAt,
    expires_at: expiresAt,
    requested_count: requestedCount,
    recipients,
    limits: {
      max_recipients_per_request: 100,
      window_seconds: 300,
      overall,
      sms_push: smsPush,
    },
  };
}

export function outboundRecipientPreviewResponse(
  value: unknown,
  expected: OutboundPreviewRequest,
): OutboundRecipientPreviewData | null {
  const request = structuralPreviewPayload(expected);
  const uids = request ? parseOutboundUidList(request.uids) : null;
  const envelope = webadminDataSuccessEnvelope(value);
  return envelope && uids ? outboundRecipientPreviewData(envelope.data, uids) : null;
}

function normalizePartial(value: unknown): 0 | 1 | null {
  if (value === false || value === 0) return 0;
  if (value === true || value === 1) return 1;
  return null;
}

export function outboundMessageDraftMaterial(
  value: OutboundMessageDraft,
): OutboundMessageResult<OutboundMessageDraftMaterial> {
  const channel = oneOf(value.channel, OUTBOUND_MESSAGING_CHANNELS);
  if (!channel) return { ok: false, error: "channel" };
  const contentSource = oneOf(value.contentSource, ["custom", "template"] as const);
  if (!contentSource) return { ok: false, error: "contentSource" };
  const allowPartial = normalizePartial(value.allowPartial);
  if (allowPartial === null) return { ok: false, error: "allowPartial" };
  const auditReason = normalizedDraftText(value.auditReason, 1, 500, "body");
  if (!auditReason) return { ok: false, error: "auditReason" };

  if (contentSource === "template") {
    const templateId = objectId(value.templateId);
    const templateRevision = integer(value.templateRevision, 1);
    if (!templateId) return { ok: false, error: "templateId" };
    if (templateRevision === null) return { ok: false, error: "templateRevision" };
    if (value.subject !== "") return { ok: false, error: "subject" };
    if (value.body !== "") return { ok: false, error: "body" };
    return {
      ok: true,
      value: {
        type: channel,
        content_source: "template",
        template_id: templateId,
        template_revision: templateRevision,
        subject: "",
        body: "",
        allow_partial: allowPartial,
        audit_reason: auditReason,
      },
    };
  }

  if (value.templateId !== "") return { ok: false, error: "templateId" };
  if (value.templateRevision !== 0) return { ok: false, error: "templateRevision" };
  const subject = channel === "sms"
    ? value.subject === "" ? "" : null
    : normalizedDraftText(value.subject, 1, channel === "push" ? 80 : 200, "text");
  if (subject === null) return { ok: false, error: "subject" };
  const body = normalizedDraftText(
    value.body,
    1,
    channel === "email" ? 50_000 : channel === "sms" ? 1_600 : 1_000,
    "body",
  );
  if (!body) return { ok: false, error: "body" };
  return {
    ok: true,
    value: {
      type: channel,
      content_source: "custom",
      template_id: "",
      template_revision: 0,
      subject,
      body,
      allow_partial: allowPartial,
      audit_reason: auditReason,
    },
  };
}

export function outboundSendPayload(
  preview: OutboundRecipientPreviewData,
  uidValues: readonly unknown[],
  draft: OutboundMessageDraft,
  requestIdValue: unknown,
  nowSeconds: number,
): OutboundMessageResult<OutboundSendPayload> {
  const uids = normalizeOutboundUidList(uidValues);
  if (!uids) return { ok: false, error: "uids" };
  const expectedUids = parseOutboundUidList(uids);
  if (!expectedUids || expectedUids.length !== preview.recipients.length
    || expectedUids.some((uid, index) => uid !== preview.recipients[index].uid)) {
    return { ok: false, error: "preview" };
  }
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0 || nowSeconds >= preview.expires_at) {
    return { ok: false, error: "previewExpired" };
  }
  const id = normalizeOutboundRequestId(requestIdValue);
  if (!id) return { ok: false, error: "requestId" };
  const material = outboundMessageDraftMaterial(draft);
  if (!material.ok) return material;
  return {
    ok: true,
    value: {
      contract_version: 1,
      preview_id: preview.preview_id,
      uids,
      ...material.value,
      expected_revision: 0,
      request_id: id,
    },
  };
}

function structuralSendPayload(value: unknown): OutboundSendPayload | null {
  const raw = exactObject(value, [
    "contract_version",
    "preview_id",
    "uids",
    "type",
    "content_source",
    "template_id",
    "template_revision",
    "subject",
    "body",
    "allow_partial",
    "expected_revision",
    "request_id",
    "audit_reason",
  ]);
  const id = previewId(raw?.preview_id);
  const uids = typeof raw?.uids === "string" && parseOutboundUidList(raw.uids) ? raw.uids : null;
  const request = requestId(raw?.request_id);
  if (!raw || raw.contract_version !== 1 || !id || !uids || !request || raw.expected_revision !== 0) return null;
  const material = outboundMessageDraftMaterial({
    channel: raw.type as OutboundMessagingChannel,
    contentSource: raw.content_source as OutboundContentSource,
    templateId: typeof raw.template_id === "string" ? raw.template_id : "\u0000",
    templateRevision: typeof raw.template_revision === "number" ? raw.template_revision : -1,
    subject: typeof raw.subject === "string" ? raw.subject : "\u0000",
    body: typeof raw.body === "string" ? raw.body : "\u0000",
    allowPartial: raw.allow_partial as 0 | 1,
    auditReason: typeof raw.audit_reason === "string" ? raw.audit_reason : "\u0000",
  });
  if (!material.ok
    || Object.entries(material.value).some(([key, parsed]) => raw[key] !== parsed)) return null;
  return {
    contract_version: 1,
    preview_id: id,
    uids,
    ...material.value,
    expected_revision: 0,
    request_id: request,
  };
}

export function outboundPendingSend(payload: OutboundSendPayload): OutboundPendingSend {
  return { version: 1, action: "send", payload: { ...payload } };
}

export function outboundPendingSendValue(value: unknown): OutboundPendingSend | null {
  // Persisted retry identity remains exact so replay cannot acquire new semantics.
  const raw = exactObject(value, ["version", "action", "payload"]);
  const payload = structuralSendPayload(raw?.payload);
  return raw?.version === 1 && raw.action === "send" && payload
    ? outboundPendingSend(payload)
    : null;
}

export function outboundPendingStorageKey(uidValue: unknown): string | null {
  const uid = positiveUid(uidValue);
  return uid === null ? null : `friending.outbound-messaging.uid-${uid}.pending-send.v1`;
}

export function outboundHistoryPayload(
  uidValue: unknown,
  cursorValue: unknown = "",
  pageSizeValue: unknown = OUTBOUND_MESSAGING_HISTORY_PAGE_SIZE,
): OutboundHistoryRequest | null {
  const uid = positiveUid(uidValue);
  const parsedCursor = cursor(cursorValue, true);
  const pageSize = integer(pageSizeValue, 1, 50);
  return uid !== null && parsedCursor !== null && pageSize !== null
    ? { contract_version: 1, uid, page_size: pageSize, cursor: parsedCursor }
    : null;
}

function structuralHistoryPayload(value: unknown): OutboundHistoryRequest | null {
  const raw = exactObject(value, ["contract_version", "uid", "page_size", "cursor"]);
  return raw?.contract_version === 1
    ? outboundHistoryPayload(raw.uid, raw.cursor, raw.page_size)
    : null;
}

export function outboundHistoryDetailPayload(
  uidValue: unknown,
  messageIdValue: unknown,
): OutboundHistoryDetailRequest | null {
  const uid = positiveUid(uidValue);
  const messageId = objectId(messageIdValue);
  return uid !== null && messageId
    ? { contract_version: 1, uid, message_id: messageId }
    : null;
}

function structuralHistoryDetailPayload(value: unknown): OutboundHistoryDetailRequest | null {
  const raw = exactObject(value, ["contract_version", "uid", "message_id"]);
  return raw?.contract_version === 1
    ? outboundHistoryDetailPayload(raw.uid, raw.message_id)
    : null;
}

/** Normalize strict browser-owned fields before forwarding an outbound action to Core. */
export function normalizeOutboundMessagingProxyBody(
  action: string,
  body: Record<string, unknown>,
): Record<string, unknown> | null | undefined {
  if (!ACTION_SET.has(action)) return undefined;
  const parsed = action === "outbound_message_preview"
    ? structuralPreviewPayload(body)
    : action === "send_message"
      ? structuralSendPayload(body)
      : action === "user_history"
        ? structuralHistoryPayload(body)
        : structuralHistoryDetailPayload(body);
  return parsed ? Object.assign(Object.create(null), parsed) : null;
}

function recipientResult(value: unknown): OutboundRecipientResult | null {
  const raw = requiredObject(value, ["uid", "message_id", "outcome", "reason"]);
  const uid = positiveUid(raw?.uid);
  const outcome = oneOf(raw?.outcome, OUTBOUND_MESSAGING_OUTCOMES);
  if (!raw || uid === null || !outcome) return null;
  if (outcome === "skipped") {
    const reason = oneOf(raw.reason, OUTBOUND_MESSAGING_SKIPPED_REASONS);
    return raw.message_id === null && reason
      ? { uid, message_id: null, outcome, reason }
      : null;
  }
  const messageId = objectId(raw.message_id);
  if (!messageId) return null;
  if (outcome === "failed") {
    const reason = oneOf(raw.reason, OUTBOUND_MESSAGING_FAILURE_REASONS);
    return reason ? { uid, message_id: messageId, outcome, reason } : null;
  }
  return raw.reason === null ? { uid, message_id: messageId, outcome, reason: null } : null;
}

export function outboundSendResponse(
  value: unknown,
  expected: OutboundSendPayload,
): OutboundMessageSendData | null {
  const expectedPayload = structuralSendPayload(expected);
  const expectedUids = expectedPayload ? parseOutboundUidList(expectedPayload.uids) : null;
  const envelope = webadminDataSuccessEnvelope(value);
  const raw = requiredObject(envelope?.data, [
    "contract_version",
    "request_id",
    "preview_id",
    "channel",
    "requested_count",
    "sent",
    "queued",
    "skipped",
    "failed",
    "results",
    "replayed",
  ]);
  const channel = oneOf(raw?.channel, OUTBOUND_MESSAGING_CHANNELS);
  const requestedCount = integer(raw?.requested_count, 1, OUTBOUND_MESSAGING_MAX_RECIPIENTS);
  const sent = integer(raw?.sent, 0, OUTBOUND_MESSAGING_MAX_RECIPIENTS);
  const queued = integer(raw?.queued, 0, OUTBOUND_MESSAGING_MAX_RECIPIENTS);
  const skipped = integer(raw?.skipped, 0, OUTBOUND_MESSAGING_MAX_RECIPIENTS);
  const failed = integer(raw?.failed, 0, OUTBOUND_MESSAGING_MAX_RECIPIENTS);
  if (!raw || raw.contract_version !== 1 || !expectedPayload || !expectedUids
    || raw.request_id !== expectedPayload.request_id || raw.preview_id !== expectedPayload.preview_id
    || channel !== expectedPayload.type || requestedCount !== expectedUids.length
    || sent === null || queued === null || skipped === null || failed === null
    || sent + queued + skipped + failed !== requestedCount || !Array.isArray(raw.results)
    || raw.results.length !== requestedCount || typeof raw.replayed !== "boolean") return null;
  const results: OutboundRecipientResult[] = [];
  const messageIds = new Set<string>();
  for (const [index, value] of raw.results.entries()) {
    const result = recipientResult(value);
    if (!result || result.uid !== expectedUids[index]
      || (result.message_id !== null && messageIds.has(result.message_id))) return null;
    if (result.message_id !== null) messageIds.add(result.message_id);
    results.push(result);
  }
  const counts = { sent: 0, queued: 0, skipped: 0, failed: 0 };
  for (const result of results) counts[result.outcome] += 1;
  if (counts.sent !== sent || counts.queued !== queued
    || counts.skipped !== skipped || counts.failed !== failed) return null;
  return {
    contract_version: 1,
    request_id: expectedPayload.request_id,
    preview_id: expectedPayload.preview_id,
    channel,
    requested_count: requestedCount,
    sent,
    queued,
    skipped,
    failed,
    results,
    replayed: raw.replayed,
  };
}

function historyTemplate(value: unknown): OutboundHistoryTemplate | null {
  const raw = requiredObject(value, ["template_id", "revision"]);
  const templateId = objectId(raw?.template_id);
  const revision = integer(raw?.revision, 1);
  return templateId && revision !== null ? { template_id: templateId, revision } : null;
}

function canonicalExcerpt(value: unknown): string | null {
  const text = canonicalWireText(value, 0, 500, "body");
  return text !== null && text.replace(/\s+/gu, " ") === text ? text : null;
}

type HistoryMetadata = Omit<OutboundHistoryEntry, "body_excerpt">;

function historyMetadata(value: Record<string, unknown>, expectedUid: number): HistoryMetadata | null {
  const messageId = objectId(value.message_id);
  const id = requestId(value.request_id);
  const uid = positiveUid(value.uid);
  const channel = oneOf(value.channel, OUTBOUND_MESSAGING_CHANNELS);
  const format = oneOf(value.format, ["sanitized_html", "plain_text"] as const);
  if (!messageId || !id || uid !== expectedUid || !channel || format !== formatForChannel(channel)) return null;
  const subject = channel === "sms"
    ? value.subject === "" ? "" : null
    : canonicalWireText(value.subject, 0, 200, "text");
  const contentSha256 = typeof value.content_sha256 === "string" && SHA256.test(value.content_sha256)
    ? value.content_sha256
    : null;
  const template = value.template === null ? null : historyTemplate(value.template);
  if (subject === null || !contentSha256 || (value.template !== null && !template)) return null;
  const status = oneOf(value.status, OUTBOUND_MESSAGING_HISTORY_STATUSES);
  const skippedReason = oneOf(value.status_reason, OUTBOUND_MESSAGING_SKIPPED_REASONS);
  const failureReason = oneOf(value.status_reason, OUTBOUND_MESSAGING_FAILURE_REASONS);
  let statusReason: OutboundHistoryReason | null = null;
  if (status === "failed") statusReason = failureReason;
  else if (status === "skipped" || status === "suppressed") statusReason = skippedReason;
  else if (value.status_reason !== null) return null;
  if (!status || ((status === "failed" || status === "skipped" || status === "suppressed") && !statusReason)) return null;
  const pushMode = value.push_mode === null ? null : oneOf(value.push_mode, OUTBOUND_MESSAGING_PUSH_MODES);
  if ((channel !== "push" && value.push_mode !== null) || (value.push_mode !== null && !pushMode)) return null;
  const createdAt = integer(value.created_at, 0, Number.MAX_SAFE_INTEGER);
  const updatedAt = integer(value.updated_at, 0, Number.MAX_SAFE_INTEGER);
  const completedAt = value.completed_at === null
    ? null
    : integer(value.completed_at, 0, Number.MAX_SAFE_INTEGER);
  const sentBy = canonicalEmail(value.sent_by);
  if (createdAt === null || updatedAt === null || updatedAt < createdAt
    || (value.completed_at !== null && (completedAt === null || completedAt < updatedAt)) || !sentBy) return null;
  return {
    message_id: messageId,
    request_id: id,
    uid,
    channel,
    format,
    subject,
    content_sha256: contentSha256,
    template,
    status,
    status_reason: statusReason,
    push_mode: pushMode,
    created_at: createdAt,
    updated_at: updatedAt,
    completed_at: completedAt,
    sent_by: sentBy,
  };
}

export function outboundHistoryEntry(value: unknown, expectedUid: number): OutboundHistoryEntry | null {
  const raw = requiredObject(value, [
    "message_id",
    "request_id",
    "uid",
    "channel",
    "format",
    "subject",
    "body_excerpt",
    "content_sha256",
    "template",
    "status",
    "status_reason",
    "push_mode",
    "created_at",
    "updated_at",
    "completed_at",
    "sent_by",
  ]);
  if (!raw) return null;
  const metadata = historyMetadata(raw, expectedUid);
  const excerpt = canonicalExcerpt(raw.body_excerpt);
  return metadata && excerpt !== null ? { ...metadata, body_excerpt: excerpt } : null;
}

function historyRowsAreOrdered(rows: readonly OutboundHistoryEntry[]): boolean {
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (previous.created_at < current.created_at) return false;
    if (previous.created_at === current.created_at && previous.message_id > current.message_id) return false;
  }
  return true;
}

export function outboundHistoryData(
  value: unknown,
  expected: OutboundHistoryRequest,
): OutboundMessageHistoryData | null {
  const request = structuralHistoryPayload(expected);
  const raw = requiredObject(value, [
    "contract_version",
    "principal",
    "uid",
    "evaluated_at",
    "messages",
    "next_cursor",
    "total",
  ]);
  const principal = outboundMessagingPrincipal(raw?.principal);
  const evaluatedAt = integer(raw?.evaluated_at, 0, Number.MAX_SAFE_INTEGER);
  const nextCursor = raw?.next_cursor === null ? null : cursor(raw?.next_cursor, false);
  const total = integer(raw?.total, 0, Number.MAX_SAFE_INTEGER);
  if (!request || !raw || raw.contract_version !== 1 || !principal
    || raw.uid !== request.uid || evaluatedAt === null || !Array.isArray(raw.messages)
    || raw.messages.length > request.page_size || (raw.next_cursor !== null && !nextCursor)
    || total === null || (nextCursor !== null && nextCursor === request.cursor)) return null;
  const messages: OutboundHistoryEntry[] = [];
  const ids = new Set<string>();
  for (const value of raw.messages) {
    const row = outboundHistoryEntry(value, request.uid);
    if (!row || ids.has(row.message_id)) return null;
    ids.add(row.message_id);
    messages.push(row);
  }
  if (!historyRowsAreOrdered(messages) || total < messages.length
    || (messages.length === 0 && (total !== 0 || nextCursor !== null))
    || (request.cursor === "" && nextCursor === null && total !== messages.length)
    || (nextCursor !== null && total <= messages.length)) return null;
  return {
    contract_version: 1,
    principal,
    uid: request.uid,
    evaluated_at: evaluatedAt,
    messages,
    next_cursor: nextCursor,
    total,
  };
}

export function outboundHistoryResponse(
  value: unknown,
  expected: OutboundHistoryRequest,
): OutboundMessageHistoryData | null {
  const envelope = webadminDataSuccessEnvelope(value);
  return envelope ? outboundHistoryData(envelope.data, expected) : null;
}

export function mergeOutboundHistoryPages(
  current: OutboundMessageHistoryData,
  next: OutboundMessageHistoryData,
): OutboundMessageHistoryData | null {
  if (current.next_cursor === null || current.uid !== next.uid || current.total !== next.total
    || JSON.stringify(current.principal) !== JSON.stringify(next.principal)) return null;
  const messages = [...current.messages, ...next.messages];
  if (new Set(messages.map((row) => row.message_id)).size !== messages.length
    || !historyRowsAreOrdered(messages) || messages.length > current.total
    || (next.next_cursor === null && messages.length !== current.total)
    || (next.next_cursor !== null && messages.length >= current.total)) return null;
  return { ...next, messages };
}

function historyDetailEntry(value: unknown, expectedUid: number): OutboundHistoryDetailEntry | null {
  const raw = requiredObject(value, [
    "message_id",
    "request_id",
    "uid",
    "channel",
    "format",
    "subject",
    "body",
    "content_sha256",
    "template",
    "status",
    "status_reason",
    "push_mode",
    "created_at",
    "updated_at",
    "completed_at",
    "sent_by",
  ]);
  if (!raw) return null;
  const metadata = historyMetadata(raw, expectedUid);
  if (!metadata) return null;
  const body = metadata.channel === "email"
    ? isCanonicalCannedEmailHtml(raw.body) ? raw.body : null
    : canonicalWireText(raw.body, 1, metadata.channel === "sms" ? 1_600 : 1_000, "body");
  return body ? { ...metadata, body } : null;
}

export async function outboundContentSha256(
  format: OutboundMessageFormat,
  subject: string,
  body: string,
): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const bytes = new TextEncoder().encode(`${format}\u0000${subject}\u0000${body}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function outboundHistoryDetailResponse(
  value: unknown,
  expected: OutboundHistoryDetailRequest,
): Promise<OutboundMessageHistoryDetailData | null> {
  const request = structuralHistoryDetailPayload(expected);
  const envelope = webadminDataSuccessEnvelope(value);
  const raw = requiredObject(envelope?.data, ["contract_version", "principal", "evaluated_at", "message"]);
  const principal = outboundMessagingPrincipal(raw?.principal);
  const evaluatedAt = integer(raw?.evaluated_at, 0, Number.MAX_SAFE_INTEGER);
  const message = request ? historyDetailEntry(raw?.message, request.uid) : null;
  if (!raw || raw.contract_version !== 1 || !request || !principal
    || evaluatedAt === null || !message || message.message_id !== request.message_id) return null;
  const hash = await outboundContentSha256(message.format, message.subject, message.body);
  return hash === message.content_sha256
    ? { contract_version: 1, principal, evaluated_at: evaluatedAt, message }
    : null;
}

export function outboundHistoryDetailMatchesEntry(
  detail: OutboundHistoryDetailEntry,
  row: OutboundHistoryEntry,
): boolean {
  const { body: _body, ...detailMetadata } = detail;
  const { body_excerpt: _excerpt, ...rowMetadata } = row;
  return JSON.stringify(detailMetadata) === JSON.stringify(rowMetadata);
}

export function outboundHistoryEmailPreviewDocument(
  detail: OutboundHistoryDetailEntry,
): string | null {
  return detail.channel === "email" && detail.format === "sanitized_html"
    ? cannedTemplateEmailPreviewDocument(detail.body)
    : null;
}

export function outboundRecipientConflictResponse(
  value: unknown,
  expectedUids: readonly number[],
): OutboundRecipientConflictData | null {
  const envelope = webadminErrorEnvelope(value, "required");
  const raw = requiredObject(envelope?.data, ["contract_version", "preview"]);
  const preview = outboundRecipientPreviewData(raw?.preview, expectedUids);
  return envelope?.status_code === 409
    && envelope.error === "outbound-message-recipient-conflict"
    && raw?.contract_version === 1 && preview
    ? { contract_version: 1, preview }
    : null;
}

export const OUTBOUND_MESSAGING_ERROR_KEYS = {
  "outbound-message-contract-version-invalid": "contractVersionInvalid",
  "outbound-message-parameter-invalid": "parameterInvalid",
  "outbound-message-uids-invalid": "uidsInvalid",
  "outbound-message-recipient-limit": "recipientLimit",
  "outbound-message-preview-id-invalid": "previewIdInvalid",
  "outbound-message-preview-expired": "previewExpired",
  "outbound-message-preview-conflict": "previewConflict",
  "outbound-message-recipient-conflict": "recipientConflict",
  "outbound-message-channel-invalid": "channelInvalid",
  "outbound-message-content-source-invalid": "contentSourceInvalid",
  "outbound-message-template-id-invalid": "templateIdInvalid",
  "outbound-message-template-revision-invalid": "templateRevisionInvalid",
  "outbound-message-template-not-found": "templateNotFound",
  "outbound-message-template-conflict": "templateConflict",
  "outbound-message-subject-invalid": "subjectInvalid",
  "outbound-message-body-invalid": "bodyInvalid",
  "outbound-message-html-invalid": "htmlInvalid",
  "outbound-message-partial-invalid": "partialInvalid",
  "outbound-message-audit-reason-invalid": "auditReasonInvalid",
  "outbound-message-revision-invalid": "revisionInvalid",
  "outbound-message-request-id-invalid": "requestIdInvalid",
  "outbound-message-rate-limited": "rateLimited",
  "outbound-message-request-id-conflict": "requestIdConflict",
  "outbound-message-request-in-progress": "requestInProgress",
  "outbound-message-cursor-invalid": "cursorInvalid",
  "outbound-message-message-id-invalid": "messageIdInvalid",
  "outbound-message-not-found": "notFound",
  "outbound-message-send-required": "sendRequired",
  "outbound-message-history-read-required": "historyReadRequired",
  "outbound-message-audit-write-failed": "auditWriteFailed",
  "outbound-message-receipt-write-failed": "receiptWriteFailed",
  "outbound-message-recipient-read-failed": "recipientReadFailed",
  "outbound-message-stored-invalid": "storedInvalid",
  "outbound-message-read-failed": "readFailed",
  "outbound-message-write-failed": "writeFailed",
  "admin-revoked": "sessionInvalid",
  "admin-session-invalid": "sessionInvalid",
  "admin-write-required": "sendRequired",
} as const;

export const OUTBOUND_MESSAGING_ERROR_STATUSES: Record<
  keyof typeof OUTBOUND_MESSAGING_ERROR_KEYS,
  number
> = {
  "outbound-message-contract-version-invalid": 400,
  "outbound-message-parameter-invalid": 400,
  "outbound-message-uids-invalid": 422,
  "outbound-message-recipient-limit": 422,
  "outbound-message-preview-id-invalid": 422,
  "outbound-message-preview-expired": 409,
  "outbound-message-preview-conflict": 409,
  "outbound-message-recipient-conflict": 409,
  "outbound-message-channel-invalid": 422,
  "outbound-message-content-source-invalid": 422,
  "outbound-message-template-id-invalid": 422,
  "outbound-message-template-revision-invalid": 422,
  "outbound-message-template-not-found": 404,
  "outbound-message-template-conflict": 409,
  "outbound-message-subject-invalid": 422,
  "outbound-message-body-invalid": 422,
  "outbound-message-html-invalid": 422,
  "outbound-message-partial-invalid": 422,
  "outbound-message-audit-reason-invalid": 422,
  "outbound-message-revision-invalid": 422,
  "outbound-message-request-id-invalid": 422,
  "outbound-message-rate-limited": 429,
  "outbound-message-request-id-conflict": 409,
  "outbound-message-request-in-progress": 409,
  "outbound-message-cursor-invalid": 422,
  "outbound-message-message-id-invalid": 422,
  "outbound-message-not-found": 404,
  "outbound-message-send-required": 403,
  "outbound-message-history-read-required": 403,
  "outbound-message-audit-write-failed": 503,
  "outbound-message-receipt-write-failed": 503,
  "outbound-message-recipient-read-failed": 503,
  "outbound-message-stored-invalid": 503,
  "outbound-message-read-failed": 503,
  "outbound-message-write-failed": 503,
  "admin-revoked": 403,
  "admin-session-invalid": 403,
  "admin-write-required": 403,
};

export type OutboundMessagingErrorKey =
  | (typeof OUTBOUND_MESSAGING_ERROR_KEYS)[keyof typeof OUTBOUND_MESSAGING_ERROR_KEYS]
  | "generic";

const ERROR_KEY_MAP = new Map<string, OutboundMessagingErrorKey>(
  Object.entries(OUTBOUND_MESSAGING_ERROR_KEYS),
);

const RETAIN_PENDING_ERRORS: ReadonlySet<string | null> = new Set([
  null,
  "outbound-message-request-in-progress",
  "outbound-message-audit-write-failed",
  "outbound-message-receipt-write-failed",
  "outbound-message-recipient-read-failed",
  "outbound-message-stored-invalid",
  "outbound-message-read-failed",
  "outbound-message-write-failed",
]);

export function outboundMessagingErrorKey(value: unknown): OutboundMessagingErrorKey {
  return typeof value === "string" ? ERROR_KEY_MAP.get(value) ?? "generic" : "generic";
}

export function outboundMessagingErrorResponse(value: unknown): string | null {
  const envelope = webadminErrorEnvelope(value) ?? adminBridgeErrorEnvelope(value);
  if (!envelope) return null;
  const status = OUTBOUND_MESSAGING_ERROR_STATUSES[
    envelope.error as keyof typeof OUTBOUND_MESSAGING_ERROR_STATUSES
  ];
  return status !== undefined && envelope.status_code === status ? envelope.error : null;
}

export function outboundMessagingShouldRetainSend(error: string | null): boolean {
  return error === null
    || !Object.prototype.hasOwnProperty.call(OUTBOUND_MESSAGING_ERROR_STATUSES, error)
    || RETAIN_PENDING_ERRORS.has(error);
}
