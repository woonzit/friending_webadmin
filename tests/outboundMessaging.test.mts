import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  adminActionBodyLimit,
  adminPrincipalFrom,
  isAdminActionAllowed,
  isAdminActionAuthorized,
} from "../lib/adminActions.ts";
import {
  OUTBOUND_MESSAGING_ACTIONS,
  OUTBOUND_MESSAGING_AVAILABILITY,
  OUTBOUND_MESSAGING_CAPABILITIES,
  OUTBOUND_MESSAGING_CHANNELS,
  OUTBOUND_MESSAGING_ERROR_KEYS,
  OUTBOUND_MESSAGING_ERROR_STATUSES,
  OUTBOUND_MESSAGING_FAILURE_REASONS,
  OUTBOUND_MESSAGING_HISTORY_STATUSES,
  OUTBOUND_MESSAGING_OUTCOMES,
  OUTBOUND_MESSAGING_PUSH_MODES,
  OUTBOUND_MESSAGING_SKIPPED_REASONS,
  mergeOutboundHistoryPages,
  normalizeOutboundMessagingProxyBody,
  normalizeOutboundRequestId,
  normalizeOutboundUidList,
  outboundContentSha256,
  outboundHistoryDetailMatchesEntry,
  outboundHistoryDetailPayload,
  outboundHistoryDetailResponse,
  outboundHistoryEmailPreviewDocument,
  outboundHistoryPayload,
  outboundHistoryResponse,
  outboundMessageDraftMaterial,
  outboundMessagingCanSend,
  outboundMessagingErrorKey,
  outboundMessagingErrorResponse,
  outboundMessagingShouldRetainSend,
  outboundPendingSend,
  outboundPendingSendValue,
  outboundPendingStorageKey,
  outboundPreviewPayload,
  outboundRecipientConflictResponse,
  outboundRecipientPreviewResponse,
  outboundSendPayload,
  outboundSendResponse,
  parseOutboundUidList,
  type OutboundMessageDraft,
  type OutboundPreviewRequest,
  type OutboundRecipientPreviewData,
  type OutboundSendPayload,
} from "../lib/outboundMessaging.ts";
import {
  ADMIN_REQUEST_HEADER,
  ADMIN_REQUEST_HEADER_VALUE,
  isTrustedAdminRequest,
} from "../lib/requestGuard.ts";

type JsonObject = Record<string, unknown>;

const fixtures = JSON.parse(
  await readFile(new URL("./fixtures/outbound_messaging_contract_v1.json", import.meta.url), "utf8"),
) as Record<string, JsonObject>;

const NOW = 1_787_680_100;
const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function object(value: unknown): JsonObject {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as JsonObject;
}

function stringValue(value: unknown): string {
  assert.equal(typeof value, "string");
  return value;
}

function data(value: JsonObject): JsonObject {
  return object(value.data);
}

function headers(values: Record<string, string>) {
  const normalized = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return { get: (name: string) => normalized.get(name.toLowerCase()) ?? null };
}

function onePreview(): OutboundRecipientPreviewData {
  const request = outboundPreviewPayload([42]);
  assert.ok(request);
  const parsed = outboundRecipientPreviewResponse(fixtures.preview_one, request);
  assert.ok(parsed);
  return parsed;
}

function pushDraft(overrides: Partial<OutboundMessageDraft> = {}): OutboundMessageDraft {
  return {
    channel: "push",
    contentSource: "custom",
    templateId: "",
    templateRevision: 0,
    subject: "Profile reminder",
    body: "Add a little more about yourself.",
    allowPartial: false,
    auditReason: "Approved member support reminder",
    ...overrides,
  };
}

function sendPayload(): OutboundSendPayload {
  const result = outboundSendPayload(onePreview(), [42], pushDraft(), REQUEST_ID, NOW);
  assert.ok(result.ok);
  return result.value;
}

test("the accepted v1 vocabulary and released boundary are closed", () => {
  assert.deepEqual(OUTBOUND_MESSAGING_ACTIONS, [
    "outbound_message_preview",
    "send_message",
    "user_history",
    "user_history_detail",
  ]);
  assert.deepEqual(OUTBOUND_MESSAGING_CHANNELS, ["email", "sms", "push"]);
  assert.deepEqual(OUTBOUND_MESSAGING_AVAILABILITY, [
    "available", "channel_absent", "opted_out", "banned", "not_migrated",
  ]);
  assert.deepEqual(OUTBOUND_MESSAGING_CAPABILITIES, [
    "outbound_messages_history_read", "outbound_messages_send",
  ]);
  assert.deepEqual(OUTBOUND_MESSAGING_OUTCOMES, ["sent", "queued", "skipped", "failed"]);
  assert.deepEqual(OUTBOUND_MESSAGING_HISTORY_STATUSES, [
    "queued", "sending", "retrying", "sent", "partially_sent", "failed", "skipped", "suppressed",
  ]);
  assert.deepEqual(OUTBOUND_MESSAGING_SKIPPED_REASONS, [
    "channel_absent", "opted_out", "banned", "not_migrated",
  ]);
  assert.deepEqual(OUTBOUND_MESSAGING_FAILURE_REASONS, [
    "provider_unavailable", "provider_rejected", "delivery_expired", "delivery_failed",
  ]);
  assert.deepEqual(OUTBOUND_MESSAGING_PUSH_MODES, ["fcm", "onesignal", "both"]);
});

test("canonical explicit UID helpers sort bounded browser input and reject loose wire lists", () => {
  assert.equal(normalizeOutboundUidList([991, 17, 204]), "17,204,991");
  assert.deepEqual(parseOutboundUidList("17,204,991"), [17, 204, 991]);
  assert.deepEqual(outboundPreviewPayload([991, 17, 204]), {
    contract_version: 1,
    uids: "17,204,991",
  });
  assert.equal(normalizeOutboundUidList(Array.from({ length: 100 }, (_, index) => 100 - index)),
    Array.from({ length: 100 }, (_, index) => index + 1).join(","));
  for (const invalid of [
    [],
    [1, 1],
    [0],
    [-1],
    [2_147_483_648],
    ["1"],
    Array.from({ length: 101 }, (_, index) => index + 1),
  ]) assert.equal(normalizeOutboundUidList(invalid), null);
  for (const invalid of [
    "", "0", "01", "2,1", "1,1", "1,", " 1", "1, 2", "1.0", "2147483648",
  ]) assert.equal(parseOutboundUidList(invalid), null, invalid);
});

test("preview success binds exact recipients, all five safe states, capabilities, expiry, and caps", () => {
  const request = outboundPreviewPayload([46, 42, 45, 43, 44]);
  assert.ok(request);
  const preview = outboundRecipientPreviewResponse(fixtures.preview_all_states, request);
  assert.ok(preview);
  assert.equal(preview.requested_count, 5);
  assert.deepEqual(preview.recipients.map((row) => row.uid), [42, 43, 44, 45, 46]);
  assert.deepEqual(preview.recipients.map((row) => row.channels.email), OUTBOUND_MESSAGING_AVAILABILITY);
  assert.equal(preview.expires_at - preview.evaluated_at, 300);
  assert.equal(preview.limits.overall.used + preview.limits.overall.remaining, 500);
  assert.equal(preview.limits.sms_push.used + preview.limits.sms_push.remaining, 200);
  assert.equal(outboundMessagingCanSend(preview.principal), true);

  const viewerWriter = clone(fixtures.preview_one);
  data(viewerWriter).principal = {
    role: "viewer",
    capabilities: ["outbound_messages_history_read", "outbound_messages_send"],
  };
  const parsedViewerWriter = outboundRecipientPreviewResponse(viewerWriter, outboundPreviewPayload([42])!);
  assert.ok(parsedViewerWriter);
  assert.equal(outboundMessagingCanSend(parsedViewerWriter.principal), true,
    "the Core-authored capability is authoritative; role inference is forbidden");
});

test("preview parsing fails closed on additive, partial, loose, reordered, or guessed material", () => {
  const request = outboundPreviewPayload([42]);
  assert.ok(request);
  const mutations: Array<(raw: JsonObject) => void> = [
    (raw) => { raw.trace = "extra"; },
    (raw) => { data(raw).contact = "hidden"; },
    (raw) => { data(raw).expires_at = 1_787_680_301; },
    (raw) => { data(raw).requested_count = "1"; },
    (raw) => { object(data(raw).principal).capabilities = ["outbound_messages_send", "outbound_messages_history_read"]; },
    (raw) => { object(data(raw).principal).capabilities = ["outbound_messages_history_read"]; },
    (raw) => { object(data(raw).limits).window_seconds = 301; },
    (raw) => { object(object(data(raw).limits).overall).remaining = 379; },
    (raw) => { object((data(raw).recipients as JsonObject[])[0]).display_name = " Ada "; },
    (raw) => { object((data(raw).recipients as JsonObject[])[0]).codename = "Ada"; },
    (raw) => { object(object((data(raw).recipients as JsonObject[])[0]).channels).push = "unknown"; },
    (raw) => { object(object((data(raw).recipients as JsonObject[])[0]).channels).token = "private"; },
  ];
  for (const mutate of mutations) {
    const raw = clone(fixtures.preview_one);
    mutate(raw);
    assert.equal(outboundRecipientPreviewResponse(raw, request), null, mutate.toString());
  }
  assert.equal(outboundRecipientPreviewResponse(fixtures.preview_one, outboundPreviewPayload([43])!), null);

  const reordered = clone(fixtures.preview_all_states);
  (data(reordered).recipients as unknown[]).reverse();
  assert.equal(outboundRecipientPreviewResponse(
    reordered,
    outboundPreviewPayload([42, 43, 44, 45, 46])!,
  ), null);
});

test("custom and exact-template drafts preserve channel bounds and never silently attribute edits", () => {
  const custom = outboundMessageDraftMaterial(pushDraft({
    subject: "  Café reminder  ",
    body: "  Keep your profile current.  ",
    auditReason: "  Approved reminder  ",
    allowPartial: true,
  }));
  assert.deepEqual(custom, {
    ok: true,
    value: {
      type: "push",
      content_source: "custom",
      template_id: "",
      template_revision: 0,
      subject: "Café reminder",
      body: "Keep your profile current.",
      allow_partial: 1,
      audit_reason: "Approved reminder",
    },
  });

  const template = outboundMessageDraftMaterial(pushDraft({
    contentSource: "template",
    templateId: "65a000000000000000000001",
    templateRevision: 3,
    subject: "",
    body: "",
  }));
  assert.equal(template.ok, true);
  if (template.ok) assert.deepEqual(template.value, {
    type: "push",
    content_source: "template",
    template_id: "65a000000000000000000001",
    template_revision: 3,
    subject: "",
    body: "",
    allow_partial: 0,
    audit_reason: "Approved member support reminder",
  });

  const emailSource = outboundMessageDraftMaterial(pushDraft({
    channel: "email",
    subject: "Account note",
    body: "<script>This raw source is never rendered</script>",
  }));
  assert.equal(emailSource.ok, true, "Core owns deterministic email sanitization; raw source stays text-only");

  for (const [override, error] of [
    [{ templateId: "65a000000000000000000001" }, "templateId"],
    [{ templateRevision: 1 }, "templateRevision"],
    [{ subject: "x".repeat(81) }, "subject"],
    [{ body: "\u0000" }, "body"],
    [{ auditReason: "" }, "auditReason"],
    [{ allowPartial: 2 as 0 }, "allowPartial"],
    [{ channel: "sms" as const, subject: "No SMS subject" }, "subject"],
    [{ contentSource: "template" as const, templateId: "bad", templateRevision: 1, subject: "", body: "" }, "templateId"],
    [{ contentSource: "template" as const, templateId: "65a000000000000000000001", templateRevision: 1, subject: "edited", body: "" }, "subject"],
  ] as const) {
    const result = outboundMessageDraftMaterial(pushDraft(override));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, error);
  }

  assert.equal(outboundMessageDraftMaterial(pushDraft({
    channel: "sms", subject: "", body: `Line one\n${"x".repeat(1_590)}`,
  })).ok, true);
  assert.equal(outboundMessageDraftMaterial(pushDraft({
    channel: "sms", subject: "", body: "x".repeat(1_601),
  })).ok, false);
});

test("send material is preview-bound, expiry-bound, durable, and structurally exact", () => {
  const preview = onePreview();
  const result = outboundSendPayload(preview, [42], pushDraft(), REQUEST_ID.toUpperCase(), NOW);
  assert.ok(result.ok);
  assert.equal(result.value.request_id, REQUEST_ID);
  assert.equal(result.value.expected_revision, 0);
  assert.equal(result.value.uids, "42");
  assert.equal(normalizeOutboundRequestId(REQUEST_ID.toUpperCase()), REQUEST_ID);
  assert.equal(outboundSendPayload(preview, [43], pushDraft(), REQUEST_ID, NOW).ok, false);
  assert.equal(outboundSendPayload(preview, [42], pushDraft(), REQUEST_ID, preview.expires_at).ok, false);
  assert.equal(outboundSendPayload(preview, [42], pushDraft(), "not-v4", NOW).ok, false);

  const pending = outboundPendingSend(result.value);
  assert.deepEqual(outboundPendingSendValue(JSON.parse(JSON.stringify(pending))), pending);
  assert.equal(outboundPendingSendValue({ ...pending, provider_receipt: "private" }), null);
  assert.equal(outboundPendingSendValue({
    ...pending,
    payload: { ...pending.payload, admin_email: "attacker@example.test" },
  }), null);
  assert.equal(outboundPendingStorageKey(42), "friending.outbound-messaging.uid-42.pending-send.v1");
  assert.equal(outboundPendingStorageKey(0), null);
});

test("future proxy normalization accepts only exact browser-owned fields", () => {
  const preview = outboundPreviewPayload([42]);
  const send = sendPayload();
  const history = outboundHistoryPayload(42);
  const detail = outboundHistoryDetailPayload(42, "64f000000000000000000001");
  assert.ok(preview && history && detail);
  assert.equal(normalizeOutboundMessagingProxyBody("overview", {}), undefined);
  assert.deepEqual({ ...normalizeOutboundMessagingProxyBody("outbound_message_preview", preview) }, preview);
  assert.deepEqual({ ...normalizeOutboundMessagingProxyBody("send_message", send) }, send);
  assert.deepEqual({ ...normalizeOutboundMessagingProxyBody("user_history", history) }, history);
  assert.deepEqual({ ...normalizeOutboundMessagingProxyBody("user_history_detail", detail) }, detail);
  for (const [action, raw] of [
    ["outbound_message_preview", { ...preview, query: "all" }],
    ["send_message", { ...send, secret: "attacker" }],
    ["send_message", { ...send, admin_email: "attacker@example.test" }],
    ["send_message", { ...send, expected_revision: 1 }],
    ["send_message", { ...send, uids: "042" }],
    ["user_history", { ...history, page_size: 51 }],
    ["user_history_detail", { ...detail, message_id: "bad" }],
  ] as const) assert.equal(normalizeOutboundMessagingProxyBody(action, raw), null);
});

test("send success binds the exact gesture and validates every aggregate result", () => {
  const payload = sendPayload();
  const parsed = outboundSendResponse(fixtures.send_one, payload);
  assert.ok(parsed);
  assert.equal(parsed.queued, 1);
  assert.equal(parsed.results[0].outcome, "queued");
  assert.equal(parsed.replayed, false);

  const mutations: Array<(raw: JsonObject) => void> = [
    (raw) => { data(raw).request_id = "223e4567-e89b-42d3-a456-426614174000"; },
    (raw) => { data(raw).preview_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; },
    (raw) => { data(raw).channel = "email"; },
    (raw) => { data(raw).queued = 0; },
    (raw) => { data(raw).requested_count = 2; },
    (raw) => { object((data(raw).results as JsonObject[])[0]).uid = 43; },
    (raw) => { object((data(raw).results as JsonObject[])[0]).message_id = null; },
    (raw) => { object((data(raw).results as JsonObject[])[0]).reason = "provider_rejected"; },
    (raw) => { object((data(raw).results as JsonObject[])[0]).destination = "hidden"; },
  ];
  for (const mutate of mutations) {
    const raw = clone(fixtures.send_one);
    mutate(raw);
    assert.equal(outboundSendResponse(raw, payload), null, mutate.toString());
  }

  const twoRecipientPreview = clone(onePreview());
  twoRecipientPreview.requested_count = 2;
  twoRecipientPreview.recipients.push({
    ...twoRecipientPreview.recipients[0],
    uid: 43,
  });
  const twoRecipientPayload = outboundSendPayload(
    twoRecipientPreview,
    [42, 43],
    pushDraft(),
    REQUEST_ID,
    NOW,
  );
  assert.ok(twoRecipientPayload.ok);
  const duplicateMessageId = clone(fixtures.send_one);
  data(duplicateMessageId).requested_count = 2;
  data(duplicateMessageId).queued = 2;
  const firstResult = object((data(duplicateMessageId).results as JsonObject[])[0]);
  data(duplicateMessageId).results = [firstResult, { ...firstResult, uid: 43 }];
  assert.equal(outboundSendResponse(duplicateMessageId, twoRecipientPayload.value), null);
});

test("history rows are ordered, bounded, role-independent, and proven empty only by exact success", () => {
  const request = outboundHistoryPayload(42);
  assert.ok(request);
  const history = outboundHistoryResponse(fixtures.history_page, request);
  assert.ok(history);
  assert.equal(history.messages.length, 3);
  assert.equal(history.total, 3);
  assert.equal(outboundMessagingCanSend(history.principal), false);
  assert.deepEqual(history.messages.map((row) => row.status), ["sent", "failed", "partially_sent"]);
  assert.deepEqual(history.messages.map((row) => row.channel), ["email", "sms", "push"]);
  assert.equal(history.messages[2].push_mode, "both");
  assert.equal(history.messages[0].body_excerpt, "Welcome to Friending.");

  const empty = outboundHistoryResponse(fixtures.history_empty, request);
  assert.ok(empty);
  assert.deepEqual(empty.messages, []);
  assert.equal(empty.total, 0);
  const falseEmpty = clone(fixtures.history_empty);
  data(falseEmpty).total = 1;
  assert.equal(outboundHistoryResponse(falseEmpty, request), null);

  const emptyLegacySubject = clone(fixtures.history_page);
  object((data(emptyLegacySubject).messages as JsonObject[])[0]).subject = "";
  assert.ok(outboundHistoryResponse(emptyLegacySubject, request),
    "the accepted history projection permits a bounded empty legacy subject");
});

test("one malformed or privacy-expanding history row fails the entire read", () => {
  const request = outboundHistoryPayload(42);
  assert.ok(request);
  const mutations: Array<(raw: JsonObject) => void> = [
    (raw) => { data(raw).raw_count = 3; },
    (raw) => { object((data(raw).messages as JsonObject[])[0]).destination = "hidden"; },
    (raw) => { object((data(raw).messages as JsonObject[])[0]).body_excerpt = "Welcome\n to Friending."; },
    (raw) => { object((data(raw).messages as JsonObject[])[0]).subject = "x".repeat(201); },
    (raw) => { object((data(raw).messages as JsonObject[])[0]).content_sha256 = "A".repeat(64); },
    (raw) => { object((data(raw).messages as JsonObject[])[0]).status_reason = "delivery_failed"; },
    (raw) => { object((data(raw).messages as JsonObject[])[1]).status_reason = null; },
    (raw) => { object((data(raw).messages as JsonObject[])[1]).push_mode = "both"; },
    (raw) => { object((data(raw).messages as JsonObject[])[2]).format = "sanitized_html"; },
    (raw) => { object((data(raw).messages as JsonObject[])[2]).updated_at = 1_787_680_099; },
    (raw) => { (data(raw).messages as unknown[]).reverse(); },
    (raw) => { data(raw).total = 4; },
  ];
  for (const mutate of mutations) {
    const raw = clone(fixtures.history_page);
    mutate(raw);
    assert.equal(outboundHistoryResponse(raw, request), null, mutate.toString());
  }
});

test("history pagination merges only one consistent ordered UID-bound sequence", () => {
  const firstRaw = clone(fixtures.history_page);
  const secondRaw = clone(fixtures.history_page);
  data(firstRaw).messages = (data(firstRaw).messages as unknown[]).slice(0, 2);
  data(firstRaw).next_cursor = "page_2";
  data(secondRaw).messages = (data(secondRaw).messages as unknown[]).slice(2);
  data(secondRaw).next_cursor = null;
  const firstRequest = outboundHistoryPayload(42, "", 2);
  const secondRequest = outboundHistoryPayload(42, "page_2", 2);
  assert.ok(firstRequest && secondRequest);
  const first = outboundHistoryResponse(firstRaw, firstRequest);
  const second = outboundHistoryResponse(secondRaw, secondRequest);
  assert.ok(first && second);
  const merged = mergeOutboundHistoryPages(first, second);
  assert.ok(merged);
  assert.equal(merged.messages.length, 3);
  assert.equal(merged.next_cursor, null);
  assert.equal(mergeOutboundHistoryPages(first, {
    ...second,
    messages: [first.messages[0]],
  }), null);
});

test("detail reads verify UID ownership, exact metadata, canonical body hash, and inert email preview", async () => {
  const historyRequest = outboundHistoryPayload(42);
  const detailRequest = outboundHistoryDetailPayload(42, "64f000000000000000000001");
  assert.ok(historyRequest && detailRequest);
  const history = outboundHistoryResponse(fixtures.history_page, historyRequest);
  const detail = await outboundHistoryDetailResponse(fixtures.history_detail_email, detailRequest);
  assert.ok(history && detail);
  assert.equal(outboundHistoryDetailMatchesEntry(detail.message, history.messages[0]), true);
  assert.equal(await outboundContentSha256(
    detail.message.format,
    detail.message.subject,
    detail.message.body,
  ), detail.message.content_sha256);
  const document = outboundHistoryEmailPreviewDocument(detail.message);
  assert.ok(document);
  assert.match(document, /Content-Security-Policy/);
  assert.match(document, /default-src 'none'/);
  assert.doesNotMatch(document, /<script/u);

  const badHash = clone(fixtures.history_detail_email);
  object(data(badHash).message).content_sha256 = "0".repeat(64);
  assert.equal(await outboundHistoryDetailResponse(badHash, detailRequest), null);
  const emptyLegacySubject = clone(fixtures.history_detail_email);
  const emptySubjectMessage = object(data(emptyLegacySubject).message);
  emptySubjectMessage.subject = "";
  emptySubjectMessage.content_sha256 = await outboundContentSha256(
    "sanitized_html",
    "",
    stringValue(emptySubjectMessage.body),
  );
  assert.ok(await outboundHistoryDetailResponse(emptyLegacySubject, detailRequest));
  const hostile = clone(fixtures.history_detail_email);
  object(data(hostile).message).body = "<script>alert(1)</script>";
  assert.equal(await outboundHistoryDetailResponse(hostile, detailRequest), null);
  const extra = clone(fixtures.history_detail_email);
  object(data(extra).message).provider_response = "hidden";
  assert.equal(await outboundHistoryDetailResponse(extra, detailRequest), null);
  assert.equal(await outboundHistoryDetailResponse(
    fixtures.history_detail_email,
    outboundHistoryDetailPayload(43, "64f000000000000000000001")!,
  ), null);
});

test("recipient conflict adopts only a fresh exact safe preview for the same UID set", () => {
  const conflict = outboundRecipientConflictResponse(fixtures.recipient_conflict, [42]);
  assert.ok(conflict);
  assert.equal(conflict.preview.recipients[0].channels.push, "opted_out");
  assert.equal(outboundRecipientConflictResponse(fixtures.recipient_conflict, [43]), null);
  const extra = clone(fixtures.recipient_conflict);
  data(extra).reason = "raw";
  assert.equal(outboundRecipientConflictResponse(extra, [42]), null);
});

test("all closed refusals have exact statuses, localized keys, and an explicit retry policy", () => {
  assert.equal(Object.keys(OUTBOUND_MESSAGING_ERROR_KEYS).length, 38);
  for (const [error, key] of Object.entries(OUTBOUND_MESSAGING_ERROR_KEYS)) {
    const response = {
      success: false,
      status_code: OUTBOUND_MESSAGING_ERROR_STATUSES[
        error as keyof typeof OUTBOUND_MESSAGING_ERROR_STATUSES
      ],
      error,
      message: 200,
      status: 200,
      can_send: 0,
    };
    assert.equal(outboundMessagingErrorResponse(response), error);
    assert.equal(outboundMessagingErrorKey(error), key);
  }
  assert.equal(outboundMessagingErrorKey("future-provider-error"), "generic");
  assert.equal(outboundMessagingErrorResponse({
    success: false,
    status_code: 500,
    error: "outbound-message-body-invalid",
    message: 200,
    status: 200,
    can_send: 0,
  }), null);
  assert.equal(outboundMessagingErrorResponse({
    success: false,
    status_code: 403,
    error: "admin-write-required",
  }), "admin-write-required");
  for (const error of [
    null,
    "outbound-message-request-in-progress",
    "outbound-message-audit-write-failed",
    "outbound-message-receipt-write-failed",
    "outbound-message-recipient-read-failed",
    "outbound-message-stored-invalid",
    "outbound-message-read-failed",
    "outbound-message-write-failed",
    "future-provider-error",
  ]) assert.equal(outboundMessagingShouldRetainSend(error), true, String(error));
  for (const error of [
    "outbound-message-preview-expired",
    "outbound-message-recipient-conflict",
    "outbound-message-rate-limited",
    "outbound-message-request-id-conflict",
    "outbound-message-body-invalid",
  ]) assert.equal(outboundMessagingShouldRetainSend(error), false, error);
});

test("released actions keep history viewer-readable and sending editor-only", async () => {
  for (const action of OUTBOUND_MESSAGING_ACTIONS) {
    const historyRead = action === "user_history" || action === "user_history_detail";
    assert.equal(isAdminActionAllowed(action), true);
    assert.equal(
      isAdminActionAuthorized(action, adminPrincipalFrom({ role: "viewer" })),
      historyRead,
    );
    assert.equal(isAdminActionAuthorized(action, adminPrincipalFrom({ role: "owner" })), true);
    assert.equal(adminActionBodyLimit(action), 256_000, `${action} keeps the default body ceiling`);
  }
  assert.equal(isTrustedAdminRequest(headers({
    origin: "https://friendingapp.com",
    host: "friendingapp.com",
    "sec-fetch-site": "same-origin",
    [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE,
  })), true);
  assert.equal(isTrustedAdminRequest(headers({
    origin: "https://hostile.example.test",
    host: "friendingapp.com",
    "sec-fetch-site": "cross-site",
    [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE,
  })), false);

  const proxy = await readFile(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8");
  const originGate = proxy.indexOf("isTrustedAdminRequest(request.headers)");
  const allowListGate = proxy.indexOf("isAdminActionAllowed(action)");
  const sessionGate = proxy.indexOf("readAdminSession()");
  assert.ok(originGate >= 0 && allowListGate > originGate && sessionGate > allowListGate);
  assert.match(proxy, /if \(!session\)[\s\S]*?bridgeError\("auth-required", 401\)/);
  assert.match(proxy, /if \(!isTrustedAdminRequest\(request\.headers\)\)[\s\S]*?bridgeError\("bad-origin", 403\)/);
  assert.match(proxy, /if \(!isAdminActionAllowed\(action\)\)[\s\S]*?bridgeError\("not-found", 404\)/);
  const bodyGate = proxy.indexOf("normalizeOutboundMessagingProxyBody(action, body)");
  const identityMerge = proxy.indexOf("mergeCoreParams(body, { admin_email: session.email })");
  assert.ok(bodyGate > sessionGate && identityMerge > bodyGate);
  assert.match(proxy, /normalizeOutboundMessagingProxyBody\(action, body\)/);
});

test("fixture browser state contains no contact or delivery-provider identifier fields", () => {
  const forbiddenKey = /(?:address|phone|token|destination|provider_id|device_id|credential|http_status|http_body)/iu;
  function visit(value: unknown, path = "fixture") {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as JsonObject)) {
      assert.doesNotMatch(key, forbiddenKey, `${path}.${key}`);
      visit(child, `${path}.${key}`);
    }
  }
  visit(fixtures);
});

test("user-detail shell, safe previews, locales, and seven Help sections stay bound to the released surface", async () => {
  const [page, component, actions, route, model, enRaw, huRaw] = await Promise.all([
    readFile(new URL("../app/(dashboard)/users/[uid]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/OutboundMessagingPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/adminActions.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/outboundMessaging.ts", import.meta.url), "utf8"),
    readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
    readFile(new URL("../messages/hu.json", import.meta.url), "utf8"),
  ]);
  assert.match(actions, /OUTBOUND_MESSAGING_ACTIONS/);
  assert.match(actions, /\.\.\.ACTIVE_OUTBOUND_MESSAGING_ACTIONS/);
  assert.match(route, /normalizeOutboundMessagingProxyBody/);
  assert.doesNotMatch(component, /adminCall|coreCall|core\.friending\.com|WEBADMIN_API_SECRET|console\./);
  assert.match(component, /outboundMessageDraftMaterial/);
  assert.match(component, /sandbox=""/);
  assert.match(component, /<pre>\{draft\.body\}<\/pre>/);
  assert.equal(component.match(/aria-pressed=/gu)?.length, 3);
  assert.match(component, /t\.raw\("fixture\.custom\.email\.body"\)/);
  assert.match(component, /t\.raw\("fixture\.templates\.email\.body"\)/);
  assert.match(component, /t\.raw\("fixture\.history\.emailBody"\)/);
  assert.match(component, /disabled=\{preview\.requested_count === 1\}/);
  assert.match(component, /historyDetail\.sent_by/);
  assert.match(component, /historyDetail\.push_mode/);
  assert.match(model, /globalThis\.crypto\.subtle\.digest\("SHA-256"/);
  assert.match(model, /cannedTemplateEmailPreviewDocument/);

  const en = JSON.parse(enRaw) as JsonObject;
  const hu = JSON.parse(huRaw) as JsonObject;
  const enMessaging = object(en.outboundMessaging);
  const huMessaging = object(hu.outboundMessaging);
  assert.deepEqual(Object.keys(enMessaging).sort(), Object.keys(huMessaging).sort());
  const expectedErrorKeys = new Set([
    ...Object.values(OUTBOUND_MESSAGING_ERROR_KEYS),
    "generic",
  ]);
  assert.deepEqual(new Set(Object.keys(object(enMessaging.errors))), expectedErrorKeys);
  assert.deepEqual(new Set(Object.keys(object(huMessaging.errors))), expectedErrorKeys);
  for (const messaging of [enMessaging, huMessaging]) {
    const historyFixture = object(object(messaging.fixture).history);
    for (const [format, subject, body] of [
      ["sanitized_html", historyFixture.emailSubject, historyFixture.emailBody],
      ["plain_text", "", historyFixture.smsBody],
      ["plain_text", historyFixture.pushSubject, historyFixture.pushBody],
    ] as const) {
      const hash = await outboundContentSha256(
        format,
        stringValue(subject),
        stringValue(body),
      );
      assert.ok(hash && component.includes(hash), "localized fixture content hash must be pinned");
    }
  }
  assert.deepEqual(
    Object.keys(object(object(object(en.adminHelp).pages).userDetail).sections).sort(),
    Object.keys(object(object(object(hu.adminHelp).pages).userDetail).sections).sort(),
  );
  for (const key of [
    "outboundAvailability",
    "outboundPreview",
    "outboundContent",
    "outboundConfirmation",
    "outboundResults",
    "outboundHistory",
    "outboundPrivacy",
  ]) {
    assert.ok(object(object(object(object(en.adminHelp).pages).userDetail).sections)[key]);
  }
});
