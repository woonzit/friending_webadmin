import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  OUTBOUND_MESSAGING_BRIDGE_ERROR_KEYS,
  OUTBOUND_MESSAGING_ERROR_KEYS,
  OUTBOUND_MESSAGING_ERROR_STATUSES,
  outboundHistoryDetailPayload,
  outboundHistoryDetailResponse,
  outboundPendingSend,
  outboundPreviewCoreNow,
  outboundSendOutcome,
  type OutboundPendingSend,
} from "../lib/outboundMessaging.ts";
import {
  outboundPanelInitial,
  outboundPanelNewSend,
  outboundPanelReducer,
  outboundPanelUsablePreview,
  type OutboundPanelAction,
  type OutboundPanelState,
} from "../lib/outboundMessagingPanel.ts";

/**
 * The outbound message panel's rules (lib/outboundMessagingPanel.ts), driven with Core's contract bodies
 * (tests/fixtures/outbound_messaging_contract_v1.json, canned_templates_contract_v1.json): who sees what,
 * which reads it asks for, the preview's lifetime, and the one pending send's lifecycle.
 */

type Json = Record<string, any>;
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/outbound_messaging_contract_v1.json", import.meta.url), "utf8")) as Record<string, Json>;
const canned = JSON.parse(readFileSync(new URL("./fixtures/canned_templates_contract_v1.json", import.meta.url), "utf8")) as Record<string, Json>;
const messages = (locale: string) => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
const clone = <T,>(value: T): T => structuredClone(value);

const UID = 42;
const OPERATOR = "operator@example.test";
const REQUEST_ID = "0f1e2d3c-4b5a-4968-8776-655443322110";
const T0 = 1_800_000_000_000;
const SENDER = { contract_version: 1, contract_ready: true, capabilities: ["outbound_messages_history_read", "outbound_messages_send"] };
const VIEWER = { contract_version: 1, contract_ready: true, capabilities: ["outbound_messages_history_read"] };
const me = (block: unknown, extra: Json = {}) => ({ success: true, status_code: 200, message: 200, status: 200, can_send: 0, email: OPERATOR, role: "owner", outbound_messaging: block, ...extra });
const refusal = (error: string, status_code = OUTBOUND_MESSAGING_ERROR_STATUSES[error as keyof typeof OUTBOUND_MESSAGING_ERROR_STATUSES]) =>
  ({ success: false, status_code, error, message: 200, status: 200, can_send: 0 });
const run = (state: OutboundPanelState, ...actions: OutboundPanelAction[]) => actions.reduce(outboundPanelReducer, state);

function opened(block: unknown = SENDER, stored: unknown = null): OutboundPanelState {
  return run(outboundPanelInitial(UID), { type: "accessAnswered", response: me(block), stored });
}

/** A sender's panel with history, a live preview (arrived at T0) and the email templates read. */
function loaded(stored: unknown = null): OutboundPanelState {
  const state = opened(SENDER, stored);
  return run(state,
    { type: "historyAnswered", ticket: state.history.ticket, response: fixtures.history_page },
    { type: "previewAnswered", ticket: state.preview.ticket, response: fixtures.preview_one, now: T0 },
    { type: "templatesAnswered", ticket: state.templates.ticket, response: canned.list_email });
}

/** A custom push the preview allows (push is available for uid 42), confirmed. */
function confirmedPush(state = loaded()): OutboundPanelState {
  return run(state,
    { type: "channelChosen", channel: "push" },
    { type: "templatesAnswered", ticket: state.ticket + 1, response: { ...clone(canned.list_sms_viewer_empty), data: { ...clone(canned.list_sms_viewer_empty.data), channel: "push", query: "" } } },
    { type: "sourceChosen", source: "custom" },
    { type: "fieldTyped", field: "subject", value: "  Profile reminder " },
    { type: "fieldTyped", field: "body", value: "Add a little more about yourself." },
    { type: "fieldTyped", field: "auditReason", value: "Approved support reminder" },
    { type: "reviewAsked", now: T0 + 10_000 });
}

function newSend(state: OutboundPanelState, now = T0 + 20_000): OutboundPendingSend {
  const built = outboundPanelNewSend(state, REQUEST_ID, now);
  assert.ok(built.ok, JSON.stringify(built));
  return built.pending;
}

test("the panel exists only for Core's ready version-1 block; an unreadable answer is an error, never a grant", () => {
  for (const block of [undefined, { ...SENDER, contract_ready: false }, { ...SENDER, contract_version: 2 }]) {
    const state = run(outboundPanelInitial(UID), { type: "accessAnswered", response: me(block), stored: null });
    assert.deepEqual(state.access, { status: "hidden" }, JSON.stringify(block));
    assert.equal(state.history.status, "idle", "a hidden panel reads nothing");
    assert.equal(state.hydrated, false, "and leaves the tab's storage alone");
  }
  for (const response of [null, { success: false, status_code: 503, error: "admin-membership-unconfirmed" }, me(SENDER, { email: 7 }),
    me({ ...SENDER, capabilities: ["outbound_messages_send", "outbound_messages_history_read"] }), me({ ...SENDER, capabilities: ["outbound_messages_send"] }),
    me({ ...SENDER, capabilities: ["outbound_messages_history_read", "outbound_messages_everything"] }), me({ ...SENDER, contract_ready: "yes" }), me("ready")]) {
    const state = run(outboundPanelInitial(UID), { type: "accessAnswered", response, stored: null });
    assert.deepEqual(state.access, { status: "failed" }, JSON.stringify(response));
    assert.equal(state.history.status, "idle");
    assert.deepEqual(run(state, { type: "accessAsked" }).access, { status: "loading" }, "Retry asks again");
  }
});

test("a viewer reads history only; a sender also reads the preview and the templates of the chosen channel", () => {
  const viewer = opened(VIEWER);
  assert.deepEqual(viewer.access, { status: "ready", canSend: false, operator: OPERATOR });
  assert.equal(viewer.history.status, "loading");
  assert.equal(viewer.preview.status, "idle");
  assert.equal(viewer.templates.status, "idle");
  // The role is not consulted: an owner whose block grants only history is a viewer here.
  assert.equal(run(outboundPanelInitial(UID), { type: "accessAnswered", response: me(VIEWER, { role: "owner" }), stored: null }).access.status, "ready");
  for (const action of [{ type: "previewAsked" }, { type: "templatesAsked", more: false }, { type: "reviewAsked", now: T0 }, { type: "channelChosen", channel: "sms" }] as OutboundPanelAction[]) {
    assert.equal(run(viewer, action), viewer, `${action.type} does nothing without the send capability`);
  }
  const sender = opened();
  assert.deepEqual(sender.access, { status: "ready", canSend: true, operator: OPERATOR });
  assert.deepEqual([sender.history.status, sender.preview.status, sender.templates.status, sender.templates.channel], ["loading", "loading", "loading", "email"]);
  assert.equal(new Set([sender.history.ticket, sender.preview.ticket, sender.templates.ticket]).size, 3, "each read has its own ticket");
});

test("history: a failed read is a problem, never an empty list; a late answer is dropped; pages merge or start again", () => {
  const state = opened(VIEWER);
  const failed = run(state, { type: "historyAnswered", ticket: state.history.ticket, response: refusal("outbound-message-read-failed") });
  assert.equal(failed.history.status, "failed");
  assert.equal(failed.history.data, null);
  assert.deepEqual(failed.history.problem, { error: "outbound-message-read-failed", key: "readFailed" });
  const malformed = clone(fixtures.history_empty); malformed.data.total = 1;
  assert.equal(run(state, { type: "historyAnswered", ticket: state.history.ticket, response: malformed }).history.data, null);
  const empty = run(state, { type: "historyAnswered", ticket: state.history.ticket, response: fixtures.history_empty });
  assert.equal(empty.history.status, "ready");
  assert.equal(empty.history.data?.total, 0, "only Core's exact empty answer is an empty history");
  assert.equal(run(state, { type: "historyAnswered", ticket: state.history.ticket - 1, response: fixtures.history_page }), state, "an older ticket is dropped");

  const first = clone(fixtures.history_page); first.data.messages = first.data.messages.slice(0, 2); first.data.next_cursor = "page_2";
  const second = clone(fixtures.history_page); second.data.messages = second.data.messages.slice(2);
  const paged = run(state, { type: "historyAnswered", ticket: state.history.ticket, response: first });
  assert.equal(paged.history.data?.next_cursor, "page_2");
  const asking = run(paged, { type: "historyAsked", more: true });
  assert.equal(asking.history.more, true);
  const merged = run(asking, { type: "historyAnswered", ticket: asking.history.ticket, response: second });
  assert.equal(merged.history.data?.messages.length, 3);
  const changed = clone(second); changed.data.total = 4;
  const restarted = run(asking, { type: "historyAnswered", ticket: asking.history.ticket, response: changed });
  assert.equal(restarted.history.status, "loading");
  assert.equal(restarted.history.more, false, "a history that changed under the pages is read from the top again");
  const moreFailed = run(asking, { type: "historyAnswered", ticket: asking.history.ticket, response: null });
  assert.equal(moreFailed.history.status, "failed");
  assert.equal(moreFailed.history.data?.messages.length, 2, "the rows already read stay");
});

test("detail: the hash-checked body of the chosen row, whose newer delivery state refreshes the list row", async () => {
  const state = run(opened(VIEWER), { type: "historyAnswered", ticket: 1, response: fixtures.history_page });
  const chosen = run(state, { type: "rowChosen", messageId: "64f000000000000000000001" });
  assert.equal(chosen.detail.status, "loading");
  assert.equal(run(state, { type: "rowChosen", messageId: "64f0000000000000000000ff" }), state, "only a listed row");
  const request = outboundHistoryDetailPayload(UID, "64f000000000000000000001")!;
  const moved = clone(fixtures.history_detail_email); moved.data.message.updated_at = 1_787_680_500; moved.data.message.completed_at = 1_787_680_500;
  const parsed = await outboundHistoryDetailResponse(moved, request);
  assert.ok(parsed);
  const ready = run(chosen, { type: "detailAnswered", ticket: chosen.detail.ticket, parsed, response: moved });
  assert.equal(ready.detail.status, "ready");
  assert.equal(ready.detail.value?.body, "<p>Welcome to <strong>Friending</strong>.</p>");
  assert.equal(ready.history.data?.messages[0].updated_at, 1_787_680_500, "the list shows the newer state");
  const other = clone(fixtures.history_detail_email); other.data.message.sent_by = "someone@example.test";
  const mismatch = run(chosen, { type: "detailAnswered", ticket: chosen.detail.ticket, parsed: await outboundHistoryDetailResponse(other, request), response: other });
  assert.deepEqual([mismatch.detail.status, mismatch.detail.problem?.key], ["failed", "storedInvalid"], "another message under the same id is refused");
  const missing = run(chosen, { type: "detailAnswered", ticket: chosen.detail.ticket, parsed: null, response: refusal("outbound-message-not-found") });
  assert.deepEqual([missing.detail.status, missing.detail.problem?.key], ["failed", "notFound"]);
});

test("the preview is used only within its lifetime on this browser's clock, then asked again, never reused", () => {
  const state = loaded();
  assert.equal(state.preview.status, "ready");
  assert.equal(state.preview.receivedAt, T0);
  const preview = state.preview.value!;
  assert.ok(outboundPanelUsablePreview(state, T0 + 284_000));
  assert.equal(outboundPanelUsablePreview(state, T0 + 285_000), null, "the last 15 seconds are not used");
  assert.equal(outboundPreviewCoreNow(preview, T0, T0 + 61_500), preview.evaluated_at + 61, "Core's clock is its evaluated_at plus the time elapsed here");
  assert.equal(run(state, { type: "previewLapsed", now: T0 + 100_000 }), state, "a timer that fired early changes nothing");
  const lapsed = run(state, { type: "previewLapsed", now: T0 + 285_000 });
  assert.equal(lapsed.preview.status, "expired");
  const refreshed = run(lapsed, { type: "previewAsked" });
  assert.equal(refreshed.preview.status, "loading");
  assert.ok(refreshed.preview.ticket > lapsed.preview.ticket);
  const failed = run(refreshed, { type: "previewAnswered", ticket: refreshed.preview.ticket, response: refusal("outbound-message-recipient-read-failed"), now: T0 + 290_000 });
  assert.deepEqual([failed.preview.status, failed.preview.value, failed.preview.problem?.key], ["failed", null, "recipientReadFailed"]);
  const wrongMember = clone(fixtures.preview_one); wrongMember.data.recipients[0].uid = 43;
  assert.equal(run(refreshed, { type: "previewAnswered", ticket: refreshed.preview.ticket, response: wrongMember, now: T0 }).preview.status, "failed");
});

test("review: a template or valid custom content, an available channel and capacity, on a usable preview", () => {
  const state = loaded();
  assert.deepEqual(run(state, { type: "reviewAsked", now: T0 }).notice, { tone: "error", key: "validation.templateRequired" });
  const chosen = run(state, { type: "templateChosen", templateId: "000000000000000000000001" });
  assert.equal(chosen.draft.template?.revision, 2);
  assert.equal(run(state, { type: "templateChosen", templateId: "0000000000000000000000ff" }), state, "only a listed template");
  assert.deepEqual(run(chosen, { type: "reviewAsked", now: T0 }).notice, { tone: "error", key: "validation.auditReason" });
  const reasoned = run(chosen, { type: "fieldTyped", field: "auditReason", value: "Welcome follow-up" });
  const confirming = run(reasoned, { type: "reviewAsked", now: T0 + 1_000 });
  assert.equal(confirming.confirming, true);

  const sms = run(state, { type: "channelChosen", channel: "sms" }, { type: "sourceChosen", source: "custom" },
    { type: "fieldTyped", field: "body", value: "Hello" }, { type: "fieldTyped", field: "auditReason", value: "Check" });
  assert.equal(sms.templates.channel, "sms", "a channel change reads that channel's templates");
  assert.deepEqual(run(sms, { type: "reviewAsked", now: T0 }).notice,
    { tone: "error", key: "notices.channelUnavailable", values: { channel: "sms", state: "channel_absent" } }, "SMS is channel_absent for uid 42");

  const exhausted = clone(fixtures.preview_one); exhausted.data.limits.sms_push = { limit: 200, used: 200, remaining: 0 };
  const full = run(confirmedPush(), { type: "reviewClosed" }, { type: "previewAsked" });
  const noCapacity = run(full, { type: "previewAnswered", ticket: full.preview.ticket, response: exhausted, now: T0 }, { type: "reviewAsked", now: T0 });
  assert.deepEqual(noCapacity.notice, { tone: "error", key: "notices.capacityExhausted" });

  // An expired preview is asked again, and the review opens when the fresh one arrives.
  const late = run(reasoned, { type: "reviewAsked", now: T0 + 290_000 });
  assert.equal(late.confirming, false);
  assert.deepEqual([late.preview.status, late.preview.reviewWhenReady, late.notice?.key], ["loading", true, "notices.previewRefreshing"]);
  const fresh = run(late, { type: "previewAnswered", ticket: late.preview.ticket, response: fixtures.preview_one, now: T0 + 291_000 });
  assert.equal(fresh.confirming, true);
  assert.equal(fresh.preview.receivedAt, T0 + 291_000);
  // An open confirmation closes when its preview lapses.
  const lapsed = run(confirming, { type: "previewLapsed", now: T0 + 300_000 });
  assert.deepEqual([lapsed.confirming, lapsed.notice?.key], [false, "notices.previewLapsed"]);
});

test("a new send: one minted id bound to this preview, member, content and operator; nothing else builds one", () => {
  const state = confirmedPush();
  assert.equal(state.confirming, true, JSON.stringify(state.notice));
  const pending = newSend(state);
  assert.deepEqual(pending.payload, {
    contract_version: 1, preview_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", uids: "42", type: "push", content_source: "custom",
    template_id: "", template_revision: 0, subject: "Profile reminder", body: "Add a little more about yourself.", allow_partial: 0,
    expected_revision: 0, request_id: REQUEST_ID, audit_reason: "Approved support reminder",
  });
  assert.equal(pending.operator, OPERATOR);
  assert.equal(pending.stored_at, Math.floor((T0 + 20_000) / 1000));
  const template = run(loaded(), { type: "templateChosen", templateId: "000000000000000000000002" },
    { type: "fieldTyped", field: "auditReason", value: "Safety" }, { type: "reviewAsked", now: T0 });
  assert.deepEqual(
    (({ type, content_source, template_id, template_revision, subject, body }) => ({ type, content_source, template_id, template_revision, subject, body }))(newSend(template).payload),
    { type: "email", content_source: "template", template_id: "000000000000000000000002", template_revision: 1, subject: "", body: "" },
    "a template send names the exact listed revision and carries no content of its own");
  assert.equal(outboundPanelNewSend(state, REQUEST_ID, T0 + 290_000).ok, false, "not on a lapsed preview");
  assert.equal(outboundPanelNewSend(run(state, { type: "reviewClosed" }), REQUEST_ID, T0).ok, false, "only from the confirmation");
  assert.equal(outboundPanelNewSend(state, "not-a-uuid", T0).ok, false);
});

test("an answer settles the send; a definite refusal settles it and asks again what it was refused over", () => {
  const state = confirmedPush();
  const pending = newSend(state);
  const sending = run(state, { type: "sendStarted", pending });
  assert.equal(sending.command.status, "sending");
  assert.equal(run(sending, { type: "sendStarted", pending: { ...pending, stored_at: 1 } }), sending, "one send at a time");

  const answer = clone(fixtures.send_one); answer.data.request_id = REQUEST_ID;
  const sent = run(sending, { type: "sendAnswered", pending, outcome: outboundSendOutcome(answer, pending.payload) });
  assert.deepEqual(sent.command, { status: "idle" });
  assert.equal(sent.result?.queued, 1);
  assert.deepEqual(sent.notice, { tone: "success", key: "notices.sent" });
  assert.equal(sent.confirming, false);
  assert.deepEqual([sent.draft.subject, sent.draft.body, sent.draft.auditReason], ["", "", ""]);
  assert.deepEqual([sent.history.status, sent.preview.status], ["loading", "loading"], "history is read again; the used preview is asked again");
  const replay = clone(answer); replay.data.replayed = true;
  assert.equal(run(sending, { type: "sendAnswered", pending, outcome: outboundSendOutcome(replay, pending.payload) }).notice?.key, "notices.replayed");

  const conflict = run(sending, { type: "sendAnswered", pending, outcome: outboundSendOutcome(clone(fixtures.recipient_conflict), pending.payload) });
  assert.deepEqual(conflict.command, { status: "idle" });
  assert.equal(conflict.notice?.key, "errors.recipientConflict");
  assert.equal(conflict.preview.status, "loading", "the refused preview is asked again, not reused");
  for (const error of ["outbound-message-preview-expired", "outbound-message-rate-limited", "outbound-message-preview-conflict"]) {
    const refused = run(sending, { type: "sendAnswered", pending, outcome: outboundSendOutcome(refusal(error), pending.payload) });
    assert.deepEqual([refused.command.status, refused.preview.status], ["idle", "loading"], error);
  }
  const template = run(sending, { type: "sendAnswered", pending, outcome: outboundSendOutcome(refusal("outbound-message-template-conflict"), pending.payload) });
  assert.deepEqual([template.templates.status, template.draft.template], ["loading", null], "templates are read again");
  assert.equal(template.history.status, "loading", "after any refusal the authoritative history is read");
});

test("an unknown outcome keeps the same identity; only that record is sent again; history settles it", () => {
  const state = confirmedPush();
  const pending = newSend(state);
  const sending = run(state, { type: "sendStarted", pending });
  for (const response of [null, refusal("outbound-message-write-failed"), refusal("outbound-message-request-in-progress"),
    { success: false, status_code: 504, error: "core-timeout" }, { success: false, status_code: 502, error: "admin-request-outcome-unknown" },
    { success: true, status_code: 200, message: 200, status: 200, can_send: 0, data: { contract_version: 1 } }]) {
    const doubt = run(sending, { type: "sendAnswered", pending, outcome: outboundSendOutcome(response, pending.payload) });
    assert.equal(doubt.command.status, "doubt", JSON.stringify(response));
    assert.equal(doubt.command.status === "doubt" && doubt.command.pending, pending);
    assert.equal(doubt.history.status, "loading", "history is read to see whether Core admitted it");
  }
  const doubt = run(sending, { type: "sendAnswered", pending, outcome: outboundSendOutcome(null, pending.payload) });
  // Nothing else can start while it is in doubt.
  for (const action of [{ type: "reviewAsked", now: T0 }, { type: "channelChosen", channel: "email" }, { type: "fieldTyped", field: "body", value: "x" },
    { type: "previewAsked" }, { type: "sendStarted", pending: { ...pending, payload: { ...pending.payload, request_id: "1f1e2d3c-4b5a-4968-8776-655443322110" } } }] as OutboundPanelAction[]) {
    assert.equal(run(doubt, action), doubt, action.type);
  }
  assert.equal(outboundPanelNewSend(doubt, REQUEST_ID, T0).ok, false);
  const retry = run(doubt, { type: "sendStarted", pending: structuredClone(pending) });
  assert.equal(retry.command.status, "sending", "Retry sends exactly the stored record");

  const without = run(doubt, { type: "historyAnswered", ticket: doubt.history.ticket, response: fixtures.history_page });
  assert.equal(without.command.status, "doubt", "a history without this request settles nothing");
  const admitted = clone(fixtures.history_page);
  admitted.data.messages[0] = { ...admitted.data.messages[0], request_id: REQUEST_ID, channel: "push", format: "plain_text", subject: "Profile reminder",
    body_excerpt: "Add a little more about yourself.", content_sha256: admitted.data.messages[2].content_sha256, template: null, status: "queued",
    completed_at: null, push_mode: null };
  admitted.data.messages[0].status_reason = null;
  const observed = run(doubt, { type: "historyAnswered", ticket: doubt.history.ticket, response: admitted });
  assert.deepEqual(observed.command, { status: "idle" }, "a history row with this request id is the observed outcome");
  assert.deepEqual(observed.notice, { tone: "success", key: "notices.earlierRecorded", values: { status: "queued" } });
});

test("a reload adopts the tab's stored send only for its operator, this member and a sender", () => {
  const stored = newSend(confirmedPush());
  const restored = opened(SENDER, JSON.parse(JSON.stringify(stored)));
  assert.deepEqual(restored.command, { status: "doubt", pending: stored, problem: null, restored: true });
  assert.equal(restored.hydrated, true);
  const other = outboundPendingSend(stored.payload, "colleague@example.test", stored.stored_at);
  for (const [label, block, value] of [
    ["another operator", SENDER, other],
    ["another member", SENDER, { ...stored, payload: { ...stored.payload, uids: "43" } }],
    ["a viewer now", VIEWER, stored],
    ["a widened record", SENDER, { ...stored, note: "x" }],
    ["a changed payload", SENDER, { ...stored, payload: { ...stored.payload, admin_email: OPERATOR } }],
  ] as const) {
    const state = opened(block, JSON.parse(JSON.stringify(value)));
    assert.deepEqual(state.command, { status: "idle" }, label);
    assert.equal(state.hydrated, true, `${label}: the tab's storage then drops what nobody here can settle`);
  }
});

test("every Core refusal and bridge failure maps to its EN/HU message and to keep-or-settle", () => {
  const pending = newSend(confirmedPush());
  const keep = new Set(["outbound-message-request-in-progress", "outbound-message-audit-write-failed", "outbound-message-receipt-write-failed",
    "outbound-message-recipient-read-failed", "outbound-message-stored-invalid", "outbound-message-read-failed", "outbound-message-write-failed",
    "core-timeout", "core-unavailable", "invalid-core-response", "admin-request-outcome-unknown", "admin-membership-unconfirmed"]);
  const en = messages("en").outboundMessaging.errors, hu = messages("hu").outboundMessaging.errors;
  const rows: Array<[string, unknown, string]> = [
    ...Object.keys(OUTBOUND_MESSAGING_ERROR_KEYS).map((error) => [error, error === "outbound-message-recipient-conflict" ? fixtures.recipient_conflict : refusal(error), OUTBOUND_MESSAGING_ERROR_KEYS[error as keyof typeof OUTBOUND_MESSAGING_ERROR_KEYS]] as [string, unknown, string]),
    ...Object.entries(OUTBOUND_MESSAGING_BRIDGE_ERROR_KEYS).map(([error, key]) => [error, { success: false, status_code: 502, error }, key] as [string, unknown, string]),
  ];
  assert.equal(rows.length, 46);
  for (const [error, response, key] of rows) {
    const outcome = outboundSendOutcome(response, pending.payload);
    assert.equal(outcome.kind, keep.has(error) ? "unknown" : "refused", error);
    assert.equal(outcome.kind !== "sent" && outcome.error, error);
    assert.equal(outcome.kind !== "sent" && outcome.key, key);
    assert.equal(typeof en[key], "string", `EN errors.${key}`);
    assert.equal(typeof hu[key], "string", `HU errors.${key}`);
  }
  // A Core name at another status, or an unknown name, is not a refusal: the identity is kept.
  for (const response of [refusal("outbound-message-body-invalid", 500), refusal("outbound-message-new-future-error", 409)]) {
    assert.deepEqual(outboundSendOutcome(response, pending.payload), { kind: "unknown", error: null, key: "generic" });
  }
  assert.equal(typeof en.generic, "string");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(hu).sort());
});
