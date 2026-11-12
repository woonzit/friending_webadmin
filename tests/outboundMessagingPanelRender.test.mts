import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { outboundSendOutcome } from "../lib/outboundMessaging.ts";
import {
  outboundPanelInitial,
  outboundPanelNewSend,
  outboundPanelReducer,
  type OutboundPanelAction,
  type OutboundPanelState,
} from "../lib/outboundMessagingPanel.ts";

/**
 * The panel as the browser first receives it (a server render), in both languages, from states the reducer
 * reaches on Core's contract bodies. Effects do not run in a server render: what is asserted is what is on
 * the screen. The member page passes the display name and codename of its own read; Core's preview is the
 * authority once it is there.
 */

// tsx compiles JSX to `React.createElement`; the shared ConfirmDialog the panel opens does not import React itself.
(globalThis as { React?: typeof React }).React = React;

type Json = Record<string, any>;
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/outbound_messaging_contract_v1.json", import.meta.url), "utf8")) as Record<string, Json>;
const canned = JSON.parse(readFileSync(new URL("./fixtures/canned_templates_contract_v1.json", import.meta.url), "utf8")) as Record<string, Json>;
const messagesOf = (locale: string) => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const SENDER = { contract_version: 1, contract_ready: true, capabilities: ["outbound_messages_history_read", "outbound_messages_send"] };
const VIEWER = { contract_version: 1, contract_ready: true, capabilities: ["outbound_messages_history_read"] };
const me = (block: unknown) => ({ success: true, status_code: 200, message: 200, status: 200, can_send: 0, email: "operator@example.test", role: "owner", outbound_messaging: block });
const T0 = 1_800_000_000_000;
const REQUEST_ID = "0f1e2d3c-4b5a-4968-8776-655443322110";
const run = (state: OutboundPanelState, ...actions: OutboundPanelAction[]) => actions.reduce(outboundPanelReducer, state);

function opened(block: unknown, stored: unknown = null) {
  return run(outboundPanelInitial(42), { type: "accessAnswered", response: me(block), stored });
}
function loaded(): OutboundPanelState {
  const state = opened(SENDER);
  return run(state,
    { type: "historyAnswered", ticket: state.history.ticket, response: fixtures.history_page },
    { type: "previewAnswered", ticket: state.preview.ticket, response: fixtures.preview_one, now: T0 },
    { type: "templatesAnswered", ticket: state.templates.ticket, response: canned.list_email });
}
function confirming(): OutboundPanelState {
  const state = loaded();
  return run(state,
    { type: "channelChosen", channel: "push" },
    { type: "templatesAnswered", ticket: state.ticket + 1, response: { ...canned.list_sms_viewer_empty, data: { ...canned.list_sms_viewer_empty.data, channel: "push", query: "" } } },
    { type: "sourceChosen", source: "custom" },
    { type: "fieldTyped", field: "subject", value: "Profile reminder" },
    { type: "fieldTyped", field: "body", value: "Add a little more about yourself." },
    { type: "fieldTyped", field: "auditReason", value: "Approved support reminder" },
    { type: "reviewAsked", now: T0 + 1_000 });
}

async function render(locale: string, initialState?: OutboundPanelState) {
  const { default: OutboundMessagingPanel } = await import("../components/OutboundMessagingPanel.tsx");
  const errors: string[] = [];
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: messagesOf(locale), timeZone: "UTC", onError: (error: unknown) => errors.push(String(error)) },
    createElement(OutboundMessagingPanel as any, { uid: initialState?.uid ?? 42, displayName: "Page name", codename: "pagename", adminMe: async () => null, initialState })));
  assert.deepEqual(errors, [], "every message the panel asks for exists");
  return html;
}

for (const locale of ["en", "hu"]) test(`${locale}: before Core answers there is nothing to act on; without a v1 block there is no panel; an unreadable one is an error`, async () => {
  const copy = messagesOf(locale).outboundMessaging;
  const initial = await render(locale);
  assert.ok(initial.includes(escaped(copy.loading)));
  assert.doesNotMatch(initial, /<button|<textarea|<select/);
  assert.equal(await render(locale, opened({ ...SENDER, contract_ready: false })), "");
  const failed = await render(locale, opened({ ...SENDER, capabilities: [] }));
  assert.ok(failed.includes(escaped(copy.accessFailed)));
  assert.ok(failed.includes(escaped(copy.retry)));
  assert.equal(failed.includes(escaped(copy.history.empty)), false, "an unreadable answer is not an empty history");
});

for (const locale of ["en", "hu"]) test(`${locale}: a viewer sees the member's history and its exact content, and no preview or composer`, async () => {
  const copy = messagesOf(locale).outboundMessaging;
  const state = run(opened(VIEWER), { type: "historyAnswered", ticket: 1, response: fixtures.history_page });
  const html = await render(locale, state);
  assert.ok(html.includes(escaped(copy.historyOnly)));
  assert.ok(html.includes(escaped(copy.history.title)));
  assert.ok(html.includes("Welcome to Friending."), "Core's excerpt");
  assert.ok(html.includes(escaped(copy.history.statuses.partially_sent)));
  for (const absent of [copy.availability.title, copy.preview.title, copy.content.title, copy.confirmation.review, copy.results.title]) {
    assert.equal(html.includes(escaped(absent)), false, absent);
  }
  assert.ok(html.includes(escaped(copy.privacy.sendUnavailable)));
  assert.equal((html.match(/<textarea|<select|<input/g) ?? []).length, 0);
  const empty = await render(locale, run(opened(VIEWER), { type: "historyAnswered", ticket: 1, response: fixtures.history_empty }));
  assert.ok(empty.includes(escaped(copy.history.empty)));
  const failed = await render(locale, run(opened(VIEWER), { type: "historyAnswered", ticket: 1, response: null }));
  assert.ok(failed.includes(escaped(copy.history.failed)));
  assert.equal(failed.includes(escaped(copy.history.empty)), false, "a failed read is never an empty history");
});

for (const locale of ["en", "hu"]) test(`${locale}: a sender sees Core's availability and capacity for this member, and the stored templates`, async () => {
  const copy = messagesOf(locale).outboundMessaging;
  const html = await render(locale, loaded());
  assert.equal(html.includes(escaped(copy.historyOnly)), false);
  // The identity is Core's preview (uid 42 is "Ada" there), not the page's own read.
  assert.ok(html.includes(">Ada<"));
  assert.ok(html.includes("@ada"));
  assert.ok(html.includes(escaped(copy.availability.states.channel_absent.label)), "SMS is channel_absent");
  assert.ok(html.includes(">380<") && html.includes(">156<"), "the remaining capacity figures");
  assert.ok(html.includes(escaped(copy.preview.lifetime.replace("{minutes}", "5"))));
  assert.ok(html.includes("Welcome email") && html.includes("Safety reminder"), "the canned templates of the email channel");
  assert.ok(html.includes(escaped(copy.confirmation.review)));
  assert.ok(html.includes(escaped(copy.content.chooseTemplateFirst)));
  // Nothing of the old mock remains on the screen.
  for (const gone of ["Contract preview only", "Csak szerződés-előnézet", "65a0000", "bbbbbbbb", "sendUnavailable"]) assert.equal(html.includes(gone), false, gone);
  const chosen = await render(locale, run(loaded(), { type: "templateChosen", templateId: "000000000000000000000001" }));
  assert.match(chosen, /<iframe class="canned-email-frame" sandbox=""/, "a canonical template email renders only in the sandbox");
  assert.ok(chosen.includes(escaped(copy.content.templateOption.replace("{name}", "Welcome email").replace("{revision}", "2"))));
});

for (const locale of ["en", "hu"]) test(`${locale}: the confirmation shows exactly who gets what on which channel before anything leaves`, async () => {
  const copy = messagesOf(locale).outboundMessaging;
  const state = confirming();
  assert.equal(state.confirming, true);
  const html = await render(locale, state);
  const dialog = html.slice(html.indexOf('role="alertdialog"'));
  assert.ok(dialog.includes(escaped(copy.confirmation.dialogTitle)));
  assert.ok(dialog.includes(escaped(`Ada · ${copy.preview.uid.replace("{uid}", "42")} · @ada`)));
  assert.ok(dialog.includes(escaped(copy.channels.push)));
  assert.ok(dialog.includes("Profile reminder") && dialog.includes("Add a little more about yourself."));
  assert.ok(dialog.includes("Approved support reminder"));
  assert.ok(dialog.includes(escaped(copy.confirmation.send)));
});

for (const locale of ["en", "hu"]) test(`${locale}: a send in doubt shows its request, locks the composer and offers only the same request again`, async () => {
  const copy = messagesOf(locale).outboundMessaging;
  const state = confirming();
  const built = outboundPanelNewSend(state, REQUEST_ID, T0 + 2_000);
  assert.ok(built.ok);
  const doubt = run(state, { type: "sendStarted", pending: built.pending }, { type: "sendAnswered", pending: built.pending, outcome: outboundSendOutcome(null, built.pending.payload) });
  const html = await render(locale, doubt);
  assert.ok(html.includes(escaped(copy.results.doubt.title)));
  assert.ok(html.includes(REQUEST_ID));
  assert.ok(html.includes(escaped(copy.results.doubt.retry)));
  assert.ok(html.includes(escaped(copy.results.doubt.checkHistory)));
  assert.match(html, new RegExp(`disabled="">${escaped(copy.confirmation.review)}<`), "no new send while one is in doubt");
  const restored = await render(locale, opened(SENDER, JSON.parse(JSON.stringify(built.pending))));
  assert.ok(restored.includes(escaped(copy.results.doubt.restored)), "a reload finds it again");
  const answer = structuredClone(fixtures.send_one); answer.data.request_id = REQUEST_ID;
  const sent = run(state, { type: "sendStarted", pending: built.pending }, { type: "sendAnswered", pending: built.pending, outcome: outboundSendOutcome(answer, built.pending.payload) });
  const result = await render(locale, sent);
  assert.ok(result.includes(escaped(copy.notices.sent)));
  assert.ok(result.includes(escaped(copy.results.outcomes.queued.label)));
  assert.equal(result.includes(escaped(copy.results.doubt.title)), false);
});

// Core's own bodies (tests/fixtures/outbound_messaging_wire, pinned in tests/outboundMessagingWire.test.mts).
const wire = (file: string) => JSON.parse(readFileSync(new URL(`./fixtures/outbound_messaging_wire/${file}`, import.meta.url), "utf8"));
function openedFor(uid: number, file: string, stored: unknown = null) {
  return run(outboundPanelInitial(uid), { type: "accessAnswered", response: me(wire(file)), stored });
}

for (const locale of ["en", "hu"]) test(`${locale}: Core's bodies on the screen: a viewer's whole history, an imported member's codename`, async () => {
  const copy = messagesOf(locale).outboundMessaging;
  const viewer = openedFor(4201, "admin-me-outbound-viewer.json");
  const history = run(viewer, { type: "historyAnswered", ticket: viewer.history.ticket, response: wire("history-full-viewer.json") });
  const html = await render(locale, history);
  assert.equal((html.match(/aria-pressed="false"/g) ?? []).length, 7, "seven rows");
  for (const status of ["queued", "partially_sent", "sent", "failed"]) assert.ok(html.includes(escaped(copy.history.statuses[status])), status);
  assert.equal(html.includes(escaped(copy.preview.title)), false);
  const suppressedState = openedFor(4207, "admin-me-outbound-viewer.json");
  const suppressed = await render(locale, run(suppressedState, { type: "historyAnswered", ticket: suppressedState.history.ticket, response: wire("history-suppressed.json") }));
  assert.ok(suppressed.includes(escaped(copy.history.statuses.suppressed)), "W1: a suppressed row is shown, not an unreadable history");

  const sender = openedFor(4208, "admin-me-outbound-admin.json");
  const legacy = run(sender, { type: "previewAnswered", ticket: sender.preview.ticket, response: wire("preview-legacy-codename.json"), now: T0 });
  const { default: OutboundMessagingPanel } = await import("../components/OutboundMessagingPanel.tsx");
  const shown = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: messagesOf(locale), timeZone: "UTC" },
    createElement(OutboundMessagingPanel as any, { uid: 4208, displayName: "Page name", codename: "", adminMe: async () => null, initialState: legacy })));
  assert.ok(shown.includes("@Hana4208"), "W2: the legacy atom as Core serves it");
  assert.ok(shown.includes(escaped(copy.availability.states.opted_out.label)) && shown.includes(escaped(copy.availability.states.channel_absent.label)));
});

for (const locale of ["en", "hu"]) test(`${locale}: a retried send Core replays shows the history's current state, never the replayed "queued" as news`, async () => {
  const copy = messagesOf(locale).outboundMessaging;
  const replay = wire("send-replay-after-delivery.json");
  const pending = {
    version: 1 as const, action: "send" as const, operator: "operator@example.test", stored_at: 1_790_000_100,
    payload: {
      contract_version: 1 as const, preview_id: replay.data.preview_id, uids: "4201", type: "sms" as const, content_source: "custom" as const,
      template_id: "", template_revision: 0, subject: "", body: "Your Friending profile check-in is ready.", allow_partial: 0 as const,
      expected_revision: 0 as const, request_id: replay.data.request_id, audit_reason: "Support follow-up",
    },
  };
  const restored = openedFor(4201, "admin-me-outbound-admin.json", JSON.parse(JSON.stringify(pending)));
  assert.equal(restored.command.status, "doubt");
  const answered = run(restored, { type: "sendStarted", pending }, { type: "sendAnswered", pending, outcome: outboundSendOutcome(replay, pending.payload) });
  assert.equal(answered.result?.replayed, true);
  assert.equal(answered.notice?.key, "notices.replayed");
  assert.equal(answered.history.status, "loading", "the history is read for the current state");
  const reading = await render(locale, answered);
  const resultsOf = (html: string) => html.slice(html.indexOf('id="outbound-results-title"'), html.indexOf('id="outbound-history-title"'));
  assert.ok(resultsOf(reading).includes(escaped(copy.results.replayedTitle)));
  assert.ok(resultsOf(reading).includes(escaped(copy.results.replayedReading)));
  assert.equal(resultsOf(reading).includes(escaped(copy.results.outcomes.queued.label)), false, "the replayed snapshot is not shown as an outcome");
  const current = run(answered, { type: "historyAnswered", ticket: answered.history.ticket, response: wire("history-full-viewer.json") });
  const html = await render(locale, current);
  assert.ok(resultsOf(html).includes(escaped(copy.history.statuses.failed)), "the SMS failed after its admission, and that is what the panel says");
  assert.equal(resultsOf(html).includes(escaped(copy.results.outcomes.queued.label)), false);
});
