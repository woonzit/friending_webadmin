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
      copy.preorders.status.resubscribe, copy.preorders.status.locked.bounced, copy.statusSource.unsubscribe_link, copy.statusSource.mailgun_failed,
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
    // Three active rows can be unsubscribed, one unsubscribed row resubscribed; the bounced row is locked.
    assert.equal(html.split(`>${escaped(copy.preorders.status.unsubscribe)}<`).length - 1, 3, "Cleo, Ben and Ava are active");
    assert.equal(html.split(`>${escaped(copy.preorders.status.resubscribe)}<`).length - 1, 1);
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

test("Core's round-2 can_resubscribe locks a self unsubscribe with its reason instead of a button (DERIVED)", () => {
  const rows = OWNER.rows.map((row) => row.status === "unsubscribed" ? { ...row, can_resubscribe: false } : row);
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].friendinggo;
    const html = preorders(locale, { data: { ...OWNER, rows } });
    assert.ok(html.includes(escaped(copy.preorders.status.locked.unsubscribed)));
    assert.equal(html.includes(`>${escaped(copy.preorders.status.resubscribe)}<`), false);
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

function email(locale: Locale, props: Partial<Parameters<typeof FriendingGoEmailView>[0]> = {}): string {
  return render(locale, "/friendinggo/email", createElement(FriendingGoEmailView, {
    canWrite: true, hydrated: true, composer: COMPOSER, selection: PEOPLE, preview: { kind: "idle" }, currentKey: KEY, problems: [],
    drafts: { load: "ready", drafts: [], more: false }, pending: null, busy: false, notice: null, confirm: null,
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
    assert.ok(html.includes(locale === "en" ? "/ 60,000" : "/ 60 000"), "the body counter at Core's cap");
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
    assert.ok(html.includes(locale === "en" ? "Left out: Unsubscribed (1)." : "Kimarad: Leiratkozott (1 fő)."));
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
    assert.ok(confirm.includes(escaped(copy.email.confirm.final)));
  }
});

test("Email: a read-only operator may preview, but sees no test, draft or send; problems and unknown outcomes are said plainly", () => {
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].friendinggo;
    const viewer = email(locale, { canWrite: false });
    assert.ok(viewer.includes(escaped(copy.email.readOnly)));
    assert.ok(viewer.includes(`>${escaped(copy.email.actions.preview)}<`));
    for (const text of [copy.email.actions.test, copy.email.actions.saveDraft, copy.email.actions.send]) assert.equal(viewer.includes(`>${escaped(text)}<`), false, text);
    const problems = email(locale, { problems: ["subject", "body", "directTooMany"] });
    assert.match(problems, /friendinggo-problems" role="alert"/);
    assert.ok(problems.includes(locale === "en" ? "Write a subject of 1 to 150 characters, on one line." : "Írj 1–150 karakteres, egysoros tárgyat."));
    assert.ok(problems.includes(locale === "en" ? "at most 100 people" : "legfeljebb 100 főnek"));
    const pending = email(locale, { pending: { version: 1, command: { ...CONTENT, mode: "send", campaign_id: "", request_id: "00000011-0000-4000-8000-000000000011", expected_sendable: 2 } } });
    assert.ok(pending.includes(escaped(copy.pending.retry)) && pending.includes(escaped(copy.email.pending.copy)));
    assert.ok(pending.includes(locale === "en" ? "We don&#x27;t know whether “FriendingGO update” was sent." : "Nem tudjuk, elment-e a(z) „FriendingGO update”."));
    assert.match(pending, /<fieldset class="friendinggo-fieldset" disabled="">/, "the composer is locked while a request is pending");
    const discard = email(locale, { pending: { version: 1, command: { ...CONTENT, mode: "send", campaign_id: "", request_id: "00000011-0000-4000-8000-000000000011", expected_sendable: 2 } }, confirm: { kind: "discard" } });
    assert.ok(discard.includes(escaped(copy.email.discard.copySend)), "forgetting a send warns about a double send");
    const drafts = email(locale, { drafts: { load: "ready", drafts: [{ ...CAMPAIGNS.campaigns[0]!, id: "000000000000000000006009", state: "draft", counts: null, sent_by: null, sent_at: null }], more: true } });
    assert.ok(drafts.includes(escaped(copy.email.drafts.open)) && drafts.includes(escaped(copy.email.drafts.more)));
  }
});

test("Sent: the campaign list and one campaign's recipients, in both locales; a viewer sees masked addresses", () => {
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].friendinggo;
    const list = render(locale, "/friendinggo/sent", createElement(FriendingGoCampaignListView, { data: CAMPAIGNS, load: "ready", page: 1, onPage: noop, onReload: noop, onOpen: noop }));
    for (const text of [copy.sent.title, copy.sent.list.subject, copy.kind.newsletter, copy.kind.direct, copy.campaignState.sent, copy.sent.audience.allActiveCount.replace("{count}", "3")]) {
      assert.ok(list.includes(escaped(text)), `${locale}: ${text}`);
    }
    assert.ok(list.includes("owner@example.test"));
    assert.ok(list.includes(">2 / 1<"), "emailed / left out");
    const withDraft = render(locale, "/friendinggo/sent", createElement(FriendingGoCampaignListView, {
      data: { ...CAMPAIGNS, campaigns: [{ ...CAMPAIGNS.campaigns[3]!, state: "draft", counts: null, sent_by: null, sent_at: null }] }, load: "ready", page: 1, onPage: noop, onReload: noop, onOpen: noop,
    }));
    assert.ok(withDraft.includes(`href="/friendinggo/email?draft=000000000000000000006009"`) && withDraft.includes(escaped(copy.sent.list.editDraft)));
    const detail = render(locale, "/friendinggo/sent", createElement(FriendingGoCampaignDetailView, { data: DETAIL, load: "ready", page: 1, onPage: noop, onReload: noop, onBack: noop }));
    for (const text of [copy.sent.recipients.title, copy.delivery.delivered, copy.delivery.failed, copy.delivery.purged, copy.sent.recipients.suppressed, copy.status.unsubscribed, copy.sent.detail.back]) {
      assert.ok(detail.includes(escaped(text)), `${locale}: ${text}`);
    }
    assert.ok(detail.includes("ava.stone@example.com"));
    assert.match(detail, /<iframe class="friendinggo-email-frame is-content" sandbox="" srcDoc="/);
    assert.doesNotMatch(detail, new RegExp(escaped(copy.maskedNote)));
    const masked = render(locale, "/friendinggo/sent", createElement(FriendingGoCampaignDetailView, { data: DETAIL_VIEWER, load: "ready", page: 1, onPage: noop, onReload: noop, onBack: noop }));
    assert.ok(masked.includes(escaped(copy.maskedNote)) && masked.includes("av•••@example.com"));
    assert.equal(masked.includes("ava.stone@example.com"), false);
    for (const load of ["invalid", "unavailable", "error"] as const) {
      const failed = render(locale, "/friendinggo/sent", createElement(FriendingGoCampaignListView, { data: null, load, page: 1, onPage: noop, onReload: noop, onOpen: noop }));
      assert.ok(failed.includes(escaped(copy.sent.failures[load])));
      assert.doesNotMatch(failed, /<table/u);
    }
  }
});
