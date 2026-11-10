import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";
import * as go from "../lib/friendinggo.ts";
import type { FriendingGoComposer, FriendingGoSelected } from "../lib/friendinggoConsole.ts";

// The shared components rely on the automatic JSX runtime of the Next build; tsx compiles them to
// React.createElement, so React is published before the components are loaded (tests/shellSidebarAccount).
const React = await import("react");
(globalThis as Record<string, unknown>).React = React;
const { createElement } = React;
const { FriendingGoPreordersView } = await import("../components/FriendingGoPreordersConsole.tsx");
const { FriendingGoEmailView } = await import("../components/FriendingGoEmailConsole.tsx");
const { FriendingGoCampaignListView, FriendingGoCampaignDetailView } = await import("../components/FriendingGoSentConsole.tsx");

type Json = Record<string, any>;
type Locale = "en" | "hu";
const fixture = (name: string): Json => JSON.parse(readFileSync(new URL(`./fixtures/go_preorders_wire/${name}.json`, import.meta.url), "utf8"));
const MESSAGES: Record<Locale, Json> = {
  en: JSON.parse(readFileSync(new URL("../messages/en.json", import.meta.url), "utf8")),
  hu: JSON.parse(readFileSync(new URL("../messages/hu.json", import.meta.url), "utf8")),
};
const ALL: go.FriendingGoListFilters = { ...go.DEFAULT_FRIENDINGGO_LIST_FILTERS };
const OWNER = go.friendingGoPreorders(fixture("webadmin-go-preorders-owner"), ALL)!;
const VIEWER = go.friendingGoPreorders(fixture("webadmin-go-preorders-viewer"), ALL)!;
const THREE = ["000000000000000000006001", "000000000000000000006003", "000000000000000000006004"];
const PREVIEW_BODY = fixture("webadmin-go-email-preview");
const CONTENT: go.FriendingGoEmailContent = { kind: "newsletter", subject: "FriendingGO update", preheader: "What is new with your cat tag",
  body_html: PREVIEW_BODY.data.body_html, audience: "selected", preorder_ids: THREE };
const PREVIEW = go.friendingGoPreview(PREVIEW_BODY, CONTENT)!;
const CAMPAIGNS = go.friendingGoCampaigns(fixture("webadmin-go-email-campaigns"), 1)!;
const DRAFTS = go.friendingGoCampaigns(fixture("webadmin-go-email-campaigns-drafts"), 1, "draft")!;
const STALLED = go.friendingGoCampaigns(fixture("webadmin-go-email-campaigns-sending"), 1, "sending")!;
const IDLE = { pending: null, busy: false, progress: null };
const DETAIL = go.friendingGoCampaignDetail(fixture("webadmin-go-email-campaign-detail"), "000000000000000000006002", 1)!;
const DETAIL_VIEWER = go.friendingGoCampaignDetail(fixture("webadmin-go-email-campaign-detail-viewer"), "000000000000000000006002", 1)!;
const noop = () => undefined;
const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };

function render(locale: Locale, pathname: string, element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never },
    createElement(PathnameContext.Provider, { value: pathname },
      createElement(NextIntlClientProvider, { locale, messages: MESSAGES[locale], timeZone: "UTC", onError: (error: Error) => { throw error; } }, element))));
}
function escaped(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

function preorders(locale: Locale, props: Partial<Parameters<typeof FriendingGoPreordersView>[0]> = {}): string {
  return render(locale, "/friendinggo", createElement(FriendingGoPreordersView, {
    data: OWNER, load: "ready", filters: ALL, selection: [], notice: null, pending: null, busy: false, exporting: false, confirm: null, exportConfirm: false,
    onFilters: noop, onReload: noop, onSelect: noop, onClearSelection: noop, onEmailSelected: noop, onAskStatus: noop, onCancelStatus: noop,
    onConfirmStatus: noop, onRetryStatus: noop, onDiscardStatus: noop, onAskExport: noop, onCancelExport: noop, onConfirmExport: noop, ...props,
  }));
}

test("Preorders renders Core's owner capture in both locales: tabs, cards, rows, statuses, the locked row and the writer's controls", () => {
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].friendinggo;
    const html = preorders(locale);
    for (const text of [copy.tabs.preorders, copy.tabs.email, copy.tabs.sent, copy.preorders.title, copy.preorders.cards.all, copy.preorders.export.button,
      copy.status.active, copy.status.unsubscribed, copy.status.bounced, copy.status.complained, copy.preorders.status.unsubscribe,
      copy.preorders.status.locked.self, copy.preorders.status.locked.bounced, copy.statusSource.self, copy.statusSource.feedback,
      copy.preorders.list.cityTyped, copy.preorders.selection.clear]) {
      assert.ok(html.includes(escaped(text)), `${locale}: ${text}`);
    }
    for (const row of OWNER.rows) {
      assert.ok(html.includes(escaped(row.name)) && html.includes(row.email), row.email);
    }
    assert.ok(html.includes("+19195550103"));
    assert.ok(html.includes('aria-current="page" href="/friendinggo"'), "the Preorders tab is current");
    assert.equal([...html.matchAll(/type="checkbox"/g)].length, OWNER.rows.length + 1, "a box per row and one for the page");
    assert.doesNotMatch(html, new RegExp(escaped(copy.readOnly)));
    assert.doesNotMatch(html, new RegExp(escaped(copy.preorders.filters.viewerSearch)));
    // Three active rows can be unsubscribed; Eve unsubscribed herself and Dan bounced, so both rows say why instead.
    assert.equal(html.split(`>${escaped(copy.preorders.status.unsubscribe)}<`).length - 1, 3, "Cleo, Ben and Ava are active");
    assert.equal(html.includes(`>${escaped(copy.preorders.status.resubscribe)}<`), false, "Core's can_resubscribe is false on every row");
  }
});

test("a viewer sees masked rows, the read-only notice and the search hint, and no write control at all", () => {
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].friendinggo;
    const html = preorders(locale, { data: VIEWER });
    assert.ok(html.includes(escaped(copy.readOnly)));
    assert.ok(html.includes(escaped(copy.preorders.filters.viewerSearch)), "viewers search names and cities only (contract §10.4)");
    assert.ok(html.includes("ev•••@example.com") && html.includes("+1•••••••103"));
    assert.equal(html.includes("eve.moss@example.com"), false);
    assert.doesNotMatch(html, /type="checkbox"/);
    for (const text of [copy.preorders.export.button, copy.preorders.status.unsubscribe, copy.preorders.status.resubscribe, copy.preorders.selection.clear]) {
      assert.equal(html.includes(`>${escaped(text)}<`), false, `${locale}: ${text}`);
    }
  }
});

test("the console's own unsubscribe can be undone: Resubscribe shows exactly where Core says can_resubscribe", () => {
  // Core's genuine row after the console unsubscribed Cleo (source admin, can_resubscribe true).
  const cleo = go.friendingGoStatusResult(fixture("webadmin-go-set-status-unsubscribe"))!.preorder;
  const rows = OWNER.rows.map((row) => row.id === cleo.id ? cleo : row);
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].friendinggo;
    const html = preorders(locale, { data: { ...OWNER, rows } });
    assert.equal(html.split(`>${escaped(copy.preorders.status.resubscribe)}<`).length - 1, 1);
    assert.equal(html.split(`>${escaped(copy.preorders.status.unsubscribe)}<`).length - 1, 2);
    assert.ok(html.includes(escaped(copy.statusSource.admin)));
    assert.ok(html.includes(escaped(copy.preorders.status.locked.self)), "Eve stays locked");
  }
});

test("selection, pending change, confirmation and export dialogs say what they will do", () => {
  const selection: FriendingGoSelected[] = [{ id: OWNER.rows[0]!.id, name: OWNER.rows[0]!.name, status: "unsubscribed" }, { id: OWNER.rows[2]!.id, name: OWNER.rows[2]!.name, status: "active" }];
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].friendinggo;
    const html = preorders(locale, {
      selection,
      pending: { version: 1, command: { preorder_id: OWNER.rows[2]!.id, status: "unsubscribed", request_id: "00000001-0000-4000-8000-000000000001" }, name: "Cleo Park" },
      confirm: { row: OWNER.rows[3]!, next: "unsubscribed" },
    });
    assert.ok(html.includes(locale === "en" ? "2 people selected" : "2 fő kijelölve"));
    assert.ok(html.includes(locale === "en" ? "(1 of them is not active and will be left out.)" : "(Közülük 1 fő nem aktív, ő kimarad.)"));
    assert.ok(html.includes(locale === "en" ? "Email selected (2)" : "E-mail a kijelölteknek (2)"));
    assert.ok(html.includes(escaped(copy.pending.title)) && html.includes(escaped(copy.pending.retry)));
    assert.ok(html.includes(locale === "en" ? "Unsubscribing Cleo Park may not have been saved." : "Lehet, hogy Cleo Park leiratkoztatása nem mentődött el."));
    assert.match(html, /role="alertdialog"/);
    assert.ok(html.includes("ben.carter@example.net"), "the confirmation names the address");
    // While a change is pending nothing else can be changed.
    assert.match(html, /<button class="button button-secondary button-small" type="button" disabled="">/);
    const exportHtml = preorders(locale, { exportConfirm: true });
    assert.ok(exportHtml.includes(escaped(copy.preorders.export.title)));
    assert.ok(exportHtml.includes(locale === "en" ? "5 sign-ups" : "5 feliratkozását"));
    assert.ok(exportHtml.includes(locale === "en" ? "at most 5,000" : "legfeljebb 5000"));
  }
});

test("a failed or loading read never renders cards, rows or zeros", () => {
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].friendinggo;
    for (const load of ["invalid", "unavailable", "error"] as const) {
      const html = preorders(locale, { data: null, load });
      assert.ok(html.includes(escaped(copy.preorders.failures[load])), `${locale} ${load}`);
      assert.doesNotMatch(html, /<table|stat-card/u);
    }
    const loading = preorders(locale, { data: null, load: "loading" });
    assert.match(loading, /loading-state/);
    assert.doesNotMatch(loading, /<table|stat-card/u);
    const empty = preorders(locale, { data: { ...OWNER, rows: [], matching: 0, totals: { all: 0, active: 0, unsubscribed: 0, bounced: 0, complained: 0 } } });
    assert.ok(empty.includes(escaped(copy.preorders.list.empty)));
    assert.doesNotMatch(empty, /<table/u);
  }
});

const COMPOSER: FriendingGoComposer = { kind: "newsletter", audience: "selected", subject: CONTENT.subject, preheader: CONTENT.preheader, body: CONTENT.body_html, campaignId: "" };
const PEOPLE: FriendingGoSelected[] = [
  { id: THREE[0]!, name: "Ava Stone", status: "active" }, { id: THREE[1]!, name: "Ben Carter", status: "active" }, { id: THREE[2]!, name: "Eve Moss", status: "unsubscribed" },
];
const KEY = JSON.stringify([CONTENT.kind, CONTENT.subject, CONTENT.preheader, CONTENT.body_html, CONTENT.audience, THREE.join(",")]);

const WRITER = { load: "ready", canWrite: true, active: 3 } as const;
function email(locale: Locale, props: Partial<Parameters<typeof FriendingGoEmailView>[0]> = {}): string {
  return render(locale, "/friendinggo/email", createElement(FriendingGoEmailView, {
    access: WRITER, hydrated: true, composer: COMPOSER, selection: PEOPLE, preview: { kind: "idle" }, currentKey: KEY, problems: [],
    drafts: { load: "ready", drafts: [], more: false }, command: { pending: null, busy: false, progress: null }, notice: null, confirm: null,
    onChange: noop, onClearAudience: noop, onPreview: noop, onStart: noop, onAskSend: noop, onCancelConfirm: noop, onConfirm: noop,
    onRetryPending: noop, onAskDiscard: noop, onOpenDraft: noop, onAskNew: noop, onReloadDrafts: noop, ...props,
  }));
}

test("Email: the composer with counters, merge-tag hints, the audience and the writer's actions, in both locales", () => {
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].friendinggo;
    const html = email(locale);
    for (const text of [copy.email.title, copy.email.composer.subject, copy.email.composer.preheader, copy.email.composer.body, copy.email.composer.mergeTags,
      copy.kind.newsletter, copy.kind.direct, copy.email.audience.allActive, copy.email.actions.preview, copy.email.actions.test, copy.email.actions.saveDraft,
      copy.email.actions.send, copy.email.preview.idle, copy.email.drafts.empty]) {
      assert.ok(html.includes(escaped(text)), `${locale}: ${text}`);
    }
    for (const tag of go.FRIENDINGGO_MERGE_TAGS) assert.ok(html.includes(`<code>${escaped(tag)}</code>`), tag);
    assert.ok(html.includes("18 / 150"), "the subject counter");
    assert.ok(html.includes(locale === "en" ? "/ 50,000" : "/ 50\u00a0000"), "the body counter at Core's one body limit");
    assert.ok(html.includes(locale === "en" ? "Everyone active (3)" : "Minden aktív feliratkozó (3)"), "the active count from Core's answer");
    assert.ok(html.includes("Ava Stone, Ben Carter, Eve Moss"));
    assert.ok(html.includes(locale === "en" ? "Selected people (3)" : "Kiválasztott címzettek (3)"));
    assert.match(html, new RegExp(`disabled="">${escaped(copy.email.actions.send)}<`), "no send without a preview of this content");
  }
});

test("Email: a fresh preview shows the counts, who is left out and why, and the real layout in a sandboxed frame", () => {
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].friendinggo;
    const html = email(locale, { preview: { kind: "ready", key: KEY, data: PREVIEW } });
    for (const text of [copy.email.preview.counts.selected, copy.email.preview.counts.sendable, copy.email.preview.counts.suppressed]) assert.ok(html.includes(escaped(text)));
    assert.ok(html.includes(locale === "en" ? "Left out: Unsubscribed (1)." : "Kimarad: Leiratkozott (1 fő)."), "Core's reasons");
    assert.match(html, /<iframe class="friendinggo-email-frame" sandbox="" srcDoc="/);
    assert.ok(html.includes(escaped("<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src https://friending.com;")), "the frame's own policy");
    assert.ok(html.includes("Hi Alex!"));
    assert.doesNotMatch(html, new RegExp(`disabled="">${escaped(copy.email.actions.send)}<`), "send is offered");
    // A preview of other content is marked out of date and cannot be sent.
    const stale = email(locale, { preview: { kind: "ready", key: KEY, data: PREVIEW }, currentKey: "other" });
    assert.ok(stale.includes(escaped(copy.email.preview.stale)));
    assert.match(stale, new RegExp(`disabled="">${escaped(copy.email.actions.send)}<`));
    // The confirmation states the exact number and how many are left out.
    const confirm = email(locale, { preview: { kind: "ready", key: KEY, data: PREVIEW }, confirm: { kind: "send" } });
    assert.ok(confirm.includes(locale === "en" ? "Send to 2 people?" : "Elküldöd 2 főnek?"));
    assert.ok(confirm.includes(locale === "en" ? "1 selected person is left out" : "A kiválasztottak közül 1 fő kimarad"));
    assert.equal(confirm.split(locale === "en" ? "Left out: Unsubscribed (1)." : "Kimarad: Leiratkozott (1 fő).").length - 1, 2, "the panel and the dialog both name the reasons");
    assert.ok(confirm.includes(escaped(copy.email.confirm.final)));
  }
});

test("Email: a read-only operator may preview, but sees no test, draft or send; problems and unknown outcomes are said plainly", () => {
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].friendinggo;
    // Core's answer said can_write false (a viewer, or an unrecognised stored role Core treats as read-only).
    const viewer = email(locale, { access: { load: "ready", canWrite: false, active: 3 } });
    assert.ok(viewer.includes(escaped(copy.email.readOnly)));
    assert.ok(viewer.includes(`>${escaped(copy.email.actions.preview)}<`));
    for (const text of [copy.email.actions.test, copy.email.actions.saveDraft, copy.email.actions.send]) assert.equal(viewer.includes(`>${escaped(text)}<`), false, text);
    const problems = email(locale, { problems: ["subject", "body", "directTooMany"] });
    assert.match(problems, /friendinggo-problems" role="alert"/);
    assert.ok(problems.includes(locale === "en" ? "Write a subject of 1 to 150 characters, on one line." : "Írj 1–150 karakteres, egysoros tárgyat."));
    assert.ok(problems.includes(locale === "en" ? "at most 100 people" : "legfeljebb 100 főnek"));
    const pending = email(locale, { command: { pending: { version: 1, command: { ...CONTENT, mode: "send", campaign_id: "", request_id: "00000011-0000-4000-8000-000000000011", expected_sendable: 2 }, running: false }, busy: false, progress: null } });
    assert.ok(pending.includes(escaped(copy.pending.retry)) && pending.includes(escaped(copy.email.pending.copy)));
    assert.ok(pending.includes(locale === "en" ? "We don&#x27;t know whether “FriendingGO update” was sent." : "Nem tudjuk, elment-e a(z) „FriendingGO update”."));
    assert.match(pending, /<fieldset class="friendinggo-fieldset" disabled="">/, "the composer is locked while a request is pending");
    const discard = email(locale, { command: { pending: { version: 1, command: { ...CONTENT, mode: "send", campaign_id: "", request_id: "00000011-0000-4000-8000-000000000011", expected_sendable: 2 }, running: false }, busy: false, progress: null }, confirm: { kind: "discard" } });
    assert.ok(discard.includes(escaped(copy.email.discard.copySend)), "forgetting a send warns about a double send");
    const drafts = email(locale, { drafts: { load: "ready", drafts: DRAFTS.campaigns, more: true } });
    assert.ok(drafts.includes("Spring update (draft)") && drafts.includes(escaped(copy.email.drafts.open)) && drafts.includes(escaped(copy.email.drafts.more)));
    // Until Core answers, the write controls are there but disabled; when it cannot be read, nothing is offered as writable.
    const loading = email(locale, { access: { load: "loading", canWrite: false, active: null } });
    assert.match(loading, new RegExp(`disabled="">${escaped(copy.email.actions.test)}<`));
    const failed = email(locale, { access: { load: "error", canWrite: false, active: null } });
    assert.ok(failed.includes(escaped(copy.email.accessError)));
    assert.equal(failed.includes(`>${escaped(copy.email.actions.test)}<`), false);
    // A sliced send shows how far it is, and a wait on an earlier attempt says so.
    const command = { ...CONTENT, mode: "send" as const, campaign_id: "", request_id: "0000001f-0000-4000-8000-00000000001f", expected_sendable: 2 };
    const progress = email(locale, { command: { busy: true, pending: { version: 1, command, running: true }, progress: { progress: { processed: 50, total: 101 }, waitSeconds: null, waitReason: null } } });
    assert.ok(progress.includes(locale === "en" ? "Sending in parts: 50 of 101 people done." : "Küldés részletekben: 50 / 101 fő kész."));
    assert.match(progress, /<progress max="101" value="50">/);
    const waiting = email(locale, { command: { busy: true, pending: { version: 1, command, running: true }, progress: { progress: { processed: 50, total: 101 }, waitSeconds: 8, waitReason: "in_progress" } } });
    assert.ok(waiting.includes(locale === "en" ? "Core is still busy with an earlier call of this send. The console asks again with the same request in 8 s."
      : "A Core még a küldés egy korábbi hívásán dolgozik. A konzol 8 mp múlva ugyanazzal a kéréssel újra rákérdez."), "the wait names what waits (review P3-9)");
    const testCommand = { mode: "test" as const, kind: "newsletter" as const, subject: CONTENT.subject, preheader: CONTENT.preheader, body_html: CONTENT.body_html, request_id: "0000000b-0000-4000-8000-00000000000b" };
    const testWaiting = email(locale, { command: { busy: true, pending: { version: 1, command: testCommand, running: false }, progress: { progress: null, waitSeconds: 8, waitReason: "in_progress" } } });
    assert.ok(testWaiting.includes(locale === "en" ? "Core is still working on this test send." : "A Core még dolgozik ezen a tesztküldésen."));
    const timedOut = email(locale, { command: { busy: true, pending: { version: 1, command, running: true }, progress: { progress: { processed: 50, total: 101 }, waitSeconds: 2, waitReason: "timeout" } } });
    assert.ok(timedOut.includes(locale === "en" ? "A part of the send took too long to answer." : "A küldés egy része túl sokáig nem válaszolt."));
  }
});

test("Sent: the campaign list and one campaign's recipients, in both locales; a viewer sees masked addresses", () => {
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].friendinggo;
    const list = render(locale, "/friendinggo/sent", createElement(FriendingGoCampaignListView, { data: CAMPAIGNS, load: "ready", page: 1, state: "", onPage: noop, onState: noop, onReload: noop, onOpen: noop, canWrite: true, notice: null, command: IDLE, onAskResume: noop, onRetryPending: noop, onAskDiscard: noop }));
    for (const text of [copy.sent.title, copy.sent.list.subject, copy.kind.newsletter, copy.kind.direct, copy.campaignState.sent, copy.campaignState.draft,
      copy.sent.audience.allActiveCount.replace("{count}", "3"), copy.sent.filters.state, copy.sent.filters.all, copy.sent.list.editDraft]) {
      assert.ok(list.includes(escaped(text)), `${locale}: ${text}`);
    }
    assert.ok(list.includes("owner@example.test"));
    assert.ok(list.includes(">2 / 1<"), "emailed / left out");
    // Core's genuine draft (the drafts filter's answer) is opened in the composer.
    const drafts = render(locale, "/friendinggo/sent", createElement(FriendingGoCampaignListView, { data: DRAFTS, load: "ready", page: 1, state: "draft", onPage: noop, onState: noop, onReload: noop, onOpen: noop, canWrite: true, notice: null, command: IDLE, onAskResume: noop, onRetryPending: noop, onAskDiscard: noop }));
    assert.ok(drafts.includes(`href="/friendinggo/email?draft=000000000000000000006007"`));
    assert.match(drafts, /<option value="draft" selected="">/);
    const none = render(locale, "/friendinggo/sent", createElement(FriendingGoCampaignListView, { data: { ...DRAFTS, campaigns: [] }, load: "ready", page: 1, state: "draft", onPage: noop, onState: noop, onReload: noop, onOpen: noop, canWrite: true, notice: null, command: IDLE, onAskResume: noop, onRetryPending: noop, onAskDiscard: noop }));
    assert.ok(none.includes(escaped(copy.sent.list.emptyFiltered)));
    const detail = render(locale, "/friendinggo/sent", createElement(FriendingGoCampaignDetailView, { data: DETAIL, load: "ready", page: 1, onPage: noop, onReload: noop, onBack: noop, canWrite: true, notice: null, command: IDLE, onAskResume: noop, onRetryPending: noop, onAskDiscard: noop }));
    for (const text of [copy.sent.recipients.title, copy.delivery.delivered, copy.delivery.failed, copy.delivery.purged, copy.sent.recipients.suppressed, copy.status.unsubscribed, copy.sent.detail.back]) {
      assert.ok(detail.includes(escaped(text)), `${locale}: ${text}`);
    }
    assert.ok(detail.includes("ava.stone@example.com"));
    assert.ok(detail.includes(locale === "en" ? "Left out: Unsubscribed (1)." : "Kimarad: Leiratkozott (1 fő)."), "Core's reasons on the campaign");
    assert.match(detail, /<iframe class="friendinggo-email-frame is-content" sandbox="" srcDoc="/);
    assert.doesNotMatch(detail, new RegExp(escaped(copy.maskedNote)));
    const masked = render(locale, "/friendinggo/sent", createElement(FriendingGoCampaignDetailView, { data: DETAIL_VIEWER, load: "ready", page: 1, onPage: noop, onReload: noop, onBack: noop, canWrite: true, notice: null, command: IDLE, onAskResume: noop, onRetryPending: noop, onAskDiscard: noop }));
    assert.ok(masked.includes(escaped(copy.maskedNote)) && masked.includes("av•••@example.com"));
    assert.equal(masked.includes("ava.stone@example.com"), false);
    for (const load of ["invalid", "unavailable", "error"] as const) {
      const failed = render(locale, "/friendinggo/sent", createElement(FriendingGoCampaignListView, { data: null, load, page: 1, state: "", onPage: noop, onState: noop, onReload: noop, onOpen: noop, canWrite: true, notice: null, command: IDLE, onAskResume: noop, onRetryPending: noop, onAskDiscard: noop }));
      assert.ok(failed.includes(escaped(copy.sent.failures[load])));
      assert.doesNotMatch(failed, /<table/u);
    }
  }
});

test("round 3 and the review fixes: over-cap send is off, a stalled send can be finished, a pending email blocks the hand-over", async () => {
  const { FriendingGoResumeDialog } = await import("../components/FriendingGoSentConsole.tsx");
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].friendinggo;
    // DERIVED: Core's preview with more active people than the newsletter cap (Core's preview does not refuse it).
    const overCap = { ...PREVIEW, counts: { selected: 5001, sendable: 5001, suppressed: 0, suppressed_by_reason: { unsubscribed: 0, bounced: 0, complained: 0 } } };
    const html = email(locale, { preview: { kind: "ready", key: KEY, data: overCap } });
    assert.match(html, new RegExp(`disabled="">${escaped(copy.email.actions.send)}<`), "Send is off above the cap (review P3-1)");
    assert.ok(html.includes(locale === "en" ? "Send is off: this audience is larger than 5,000 people." : "A küldés nem lehetséges: ez a kör nagyobb 5000 főnél."));
    // Core's stalled campaign: marked, with how far it got, and "Finish sending" for a writer only.
    const stalled = render(locale, "/friendinggo/sent", createElement(FriendingGoCampaignListView, { data: STALLED, load: "ready", page: 1, state: "sending",
      onPage: noop, onState: noop, onReload: noop, onOpen: noop, canWrite: true, notice: null, command: IDLE, onAskResume: noop, onRetryPending: noop, onAskDiscard: noop }));
    for (const text of [copy.sent.stalled, copy.sent.resume.button, copy.sent.sendingNote, "Abandoned news"]) assert.ok(stalled.includes(escaped(text)), `${locale}: ${text}`);
    assert.ok(stalled.includes(locale === "en" ? "50 / 101 done" : "50 / 101 kész"));
    const viewer = render(locale, "/friendinggo/sent", createElement(FriendingGoCampaignListView, { data: STALLED, load: "ready", page: 1, state: "sending",
      onPage: noop, onState: noop, onReload: noop, onOpen: noop, canWrite: false, notice: null, command: IDLE, onAskResume: noop, onRetryPending: noop, onAskDiscard: noop }));
    assert.equal(viewer.includes(`>${escaped(copy.sent.resume.button)}<`), false, "a reader cannot finish a send");
    const resume = render(locale, "/friendinggo/sent", createElement(FriendingGoResumeDialog, { campaign: STALLED.campaigns[0]!, onCancel: noop, onConfirm: noop }));
    assert.ok(resume.includes(escaped(copy.sent.resume.title)) && resume.includes("Abandoned news"));
    assert.ok(resume.includes(locale === "en" ? "stopped at 50 of 101 people" : "50 / 101 főnél megállt"));
    // A resume whose outcome is unknown waits for the operator on the Sent tab too.
    const pendingResume = render(locale, "/friendinggo/sent", createElement(FriendingGoCampaignListView, { data: STALLED, load: "ready", page: 1, state: "sending",
      onPage: noop, onState: noop, onReload: noop, onOpen: noop, canWrite: true, notice: null,
      command: { pending: { version: 1, command: { mode: "resume", campaign_id: "000000000000000000006016", request_id: "00000022-0000-4000-8000-000000000022" }, running: false }, busy: false, progress: null },
      onAskResume: noop, onRetryPending: noop, onAskDiscard: noop }));
    assert.ok(pendingResume.includes(escaped(copy.email.pending.resume)) && pendingResume.includes(escaped(copy.pending.retry)));
    assert.equal(pendingResume.includes(`>${escaped(copy.sent.resume.button)}<`), false, "one email command at a time");
    // An email command of this tab blocks a new hand-over from Preorders (review P3-7).
    const blocked = preorders(locale, { selection: [{ id: OWNER.rows[2]!.id, name: OWNER.rows[2]!.name, status: "active" }], emailPending: true });
    assert.ok(blocked.includes(escaped(copy.preorders.selection.emailPending)));
    assert.ok(blocked.includes(`disabled="">${escaped(locale === "en" ? "Email selected (1)" : "E-mail a kijelölteknek (1)")}<`));
  }
  // The Sent help says what really happens to a send left behind (review P2-1), in both languages.
  for (const locale of ["en", "hu"] as const) {
    const help = JSON.stringify(MESSAGES[locale].adminHelp.pages.friendingGoSent);
    assert.doesNotMatch(help, /still being written by Core|a Core még írja/u);
    assert.ok(help.includes(MESSAGES[locale].friendinggo.sent.resume.button));
  }
  assert.equal(MESSAGES.hu.friendinggo.preorders.status.unsubscribed, "{name} leiratkoztatva.");
});
