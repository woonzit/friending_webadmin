import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import DatesExternalProvenance from "../components/DatesExternalProvenance.tsx";
import DatesIntakeEventPanel, { datesIntakeFieldVerified } from "../components/DatesIntakeEventPanel.tsx";
import { DatesIntakeInputsPanel, DatesIntakeRunsPanel, DatesIntakeStatusPanel } from "../components/DatesIntakePanels.tsx";
import DatesIntakeRefusal from "../components/DatesIntakeRefusal.tsx";
import { decodeDatesExternalDetail } from "../lib/datesExternalAdmin.ts";
import { DATES_EXTERNAL_CATEGORIES } from "../lib/datesExternalInput.ts";
import {
  DATES_INTAKE_EVIDENCE_FIELDS, DATES_INTAKE_KNOWN_ATTENDANCE_MODES, DATES_INTAKE_KNOWN_LINK_FIELDS, DATES_INTAKE_KNOWN_PROHIBITED_CATEGORIES,
  DATES_INTAKE_KNOWN_STATUS_SIGNALS, DATES_INTAKE_KNOWN_TASKS, DATES_INTAKE_REFUSALS, DATES_INTAKE_VOCABULARIES, projectDatesIntakeDetail,
} from "../lib/datesIntakeAdmin.ts";

// Static EN/HU renders of the review screen's panels from the genuine Core
// bodies. A missing translation is an error here, not a fallback. These are
// server renders of real components: no browser, no mounted page, no effects.
const DIRECTORY = new URL("./fixtures/dates_event_intake_admin_wire/", import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, DIRECTORY), "utf8"));
const messagesOf = (locale: string) => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
const LOCALES = ["en", "hu"] as const;
// The retired brand name, spelled in two halves so that this file does not carry it either.
const RETIRED_BRAND = new RegExp(["free", "love"].join(""), "i");
const DETAILS = readdirSync(DIRECTORY).filter((name) => /^admin-detail-.*\.json$/.test(name) && !name.endsWith("-denied.json")).map((name) => name.slice(0, -5));

function render(locale: string, ...children: ReactNode[]) {
  const errors: string[] = [];
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: messagesOf(locale), timeZone: "UTC",
    onError: (error: unknown) => errors.push(String(error)) }, ...children));
  assert.deepEqual(errors, [], `${locale}: every message exists`);
  return html;
}
const escaped = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
const detail = (name: string) => { const body = fixture(name); return projectDatesIntakeDetail(body, body.intake.intake_id)!.intake; };

test("every genuine intake detail renders whole in English and Hungarian", () => {
  assert.equal(DETAILS.length, 33);
  for (const name of DETAILS) for (const locale of LOCALES) {
    const intake = detail(name), copy = messagesOf(locale).datesAdmin.intake;
    const html = render(locale, createElement(DatesIntakeStatusPanel, { intake }), createElement(DatesIntakeInputsPanel, { intake }),
      ...intake.events.map((event, index) => createElement(DatesIntakeEventPanel, { key: index, event: event!, total: intake.events.length })),
      createElement(DatesIntakeRunsPanel, { intake }));
    assert.ok(html.includes(escaped(copy.statusValues[intake.status])), `${name}/${locale}: status`);
    assert.ok(html.includes(escaped(copy.statusHelp[intake.status])), `${name}/${locale}: what the status means`);
    if (intake.status_detail) assert.ok(html.includes(escaped(copy.statusDetailHelp[intake.status_detail])), `${name}/${locale}: why it stopped`);
    for (const event of intake.events) {
      // Every extracted event is labelled as AI-extracted, and its blocking problems and warnings are in words.
      assert.ok(html.includes(escaped(event!.draft.title)));
      for (const fail of event!.validation?.hard_fails ?? []) assert.ok(html.includes(escaped(copy.hardFails[fail])), `${name}/${locale}: ${fail}`);
      for (const warning of event!.validation?.warnings ?? []) assert.ok(html.includes(escaped(copy.warnings[warning])), `${name}/${locale}: ${warning}`);
      for (const blocker of event!.validation?.auto_blockers ?? []) assert.ok(html.includes(escaped(copy.autoBlockers[blocker])), `${name}/${locale}: ${blocker}`);
    }
    assert.equal((html.match(new RegExp(escaped(copy.badgeExtracted), "g")) ?? []).length, intake.events.length, `${name}/${locale}: one AI label per event`);
    for (const run of intake.ai_runs.items) assert.ok(html.includes(escaped(run.model)), "the model that answered");
    // No machine token of a closed vocabulary leaks into the page as text.
    assert.doesNotMatch(html.replace(/<pre[\s\S]*?<\/pre>/g, "").replace(/<code>[\s\S]*?<\/code>/g, ""), /\b(in_review|awaiting_budget|single_source|start_is_doors_time|venue_unresolved|admin_draft|flyer_extract|VERY_UNLIKELY)\b/, `${name}/${locale}`);
    assert.doesNotMatch(html, RETIRED_BRAND);
  }
});

test("each field stands next to its evidence quote and Core's verdict on it", () => {
  for (const locale of LOCALES) {
    const copy = messagesOf(locale).datesAdmin.intake;
    // A link whose every quote Core found in the page.
    const official = detail("admin-detail-in-review-official").events[0]!;
    const html = render(locale, createElement(DatesIntakeEventPanel, { event: official, total: 1 }));
    for (const field of DATES_INTAKE_EVIDENCE_FIELDS) {
      assert.ok(html.includes(`<td>${escaped(copy.evidenceFields[field])}</td>`));
      assert.ok(html.includes(`<q>${escaped(official.field_evidence![field].quote!)}</q>`), `${field}: its quote`);
    }
    assert.ok(html.includes(escaped(copy.detail.allVerified)));
    assert.equal((html.match(new RegExp(`badge badge-active">${escaped(copy.detail.verified)}<`, "g")) ?? []).length, 7);
    assert.equal(html.includes(`badge badge-warning">${escaped(copy.detail.unverified)}<`), false);
    assert.ok(html.includes(escaped(official.validation!.venue!.formatted_address!)), "the venue Core resolved");
    assert.ok(html.includes(escaped(copy.tierValues.official)));
    assert.match(html, /href="https:\/\/akvariumklub\.hu\/programok\/acidarab\/" target="_blank" rel="noopener noreferrer"/);
    // The fallback provider joined two lines into one quote: Core did not find it, and the page says so.
    const fallback = detail("admin-detail-in-review-fallback").events[0]!;
    const unverified = DATES_INTAKE_EVIDENCE_FIELDS.filter((field) => !datesIntakeFieldVerified(fallback.field_evidence![field]));
    assert.ok(unverified.length > 0);
    const marked = render(locale, createElement(DatesIntakeEventPanel, { event: fallback, total: 1 }));
    assert.ok(marked.includes(escaped(copy.detail.unverifiedFields.replace("{fields}", unverified.map((field) => copy.evidenceFields[field]).join(", ")))));
    assert.equal((marked.match(new RegExp(`badge badge-warning">${escaped(copy.detail.unverified)}<`, "g")) ?? []).length, unverified.length);
    assert.ok(marked.includes(escaped(copy.warnings.fallback_provider)));
    // A draft Core could not tie to a date: in words, with no machine code.
    const vague = render(locale, createElement(DatesIntakeEventPanel, { event: detail("admin-detail-in-review-needs-info").events[0]!, total: 1 }));
    assert.ok(vague.includes(escaped(copy.hardFails.relative_date_unconfirmed)) && vague.includes(escaped(copy.detail.needsMoreInfo)));
    // A venue that may be a private address needs the reviewer's explicit confirmation.
    const privateAddress = detail("admin-detail-in-review-private-address").events[0]!;
    assert.equal(privateAddress.validation!.needs_public_venue_confirmation, true);
    assert.ok(render(locale, createElement(DatesIntakeEventPanel, { event: privateAddress, total: 1 })).includes(escaped(copy.detail.publicVenueConfirmation)));
    // An unresolved venue is said, not left blank.
    const unresolved = DETAILS.map(detail).flatMap((intake) => intake.events).find((event) => event!.validation && event!.validation.venue === null)!;
    assert.ok(render(locale, createElement(DatesIntakeEventPanel, { event: unresolved, total: 1 })).includes(escaped(copy.detail.venueUnresolved)));
  }
});

test("only the verdict of Core counts as verified", () => {
  const state = { quoted: true, verified: true, denotes: null, match: "exact" as const, source: "page:1", quote: "x", model_confidence: 1, confidence: 1 };
  assert.equal(datesIntakeFieldVerified(state), true);
  assert.equal(datesIntakeFieldVerified({ ...state, denotes: true }), true);
  // Found in the source but saying something else, not found, or never quoted: unverified, whatever the model's confidence.
  for (const change of [{ denotes: false }, { verified: false }, { quoted: false, verified: false, quote: null }, { quoted: false }])
    assert.equal(datesIntakeFieldVerified({ ...state, ...change }), false);
});

test("a flyer is private evidence: fetched only on request through the console's route, and never an event image", () => {
  for (const locale of LOCALES) {
    const copy = messagesOf(locale).datesAdmin.intake;
    const intake = detail("admin-detail-in-review-images");
    assert.equal(intake.inputs!.images.items.length, 1);
    const html = render(locale, createElement(DatesIntakeInputsPanel, { intake }));
    assert.ok(html.includes(escaped(copy.detail.flyerPrivate)));
    assert.ok(html.includes(escaped(copy.detail.flyerShow)));
    // Nothing is fetched until the reviewer asks: the first render carries no image and no flyer URL.
    assert.doesNotMatch(html, /<img|dates-intake-media|data:image/);
    assert.ok(html.includes(escaped(copy.sourceLabels.image.replace("{number}", "1"))), "the text Core read from the flyer");
    // A flyer Core could not decode has no re-encoded copy: nothing is offered to show.
    const waiting = render(locale, createElement(DatesIntakeInputsPanel, { intake: detail("admin-detail-failed-image") }));
    assert.ok(waiting.includes(escaped(copy.detail.flyerNotReady)));
    assert.equal(waiting.includes(escaped(copy.detail.flyerShow)), false);
    const screened = render(locale, createElement(DatesIntakeInputsPanel, { intake: detail("admin-detail-rejected-screening") }));
    assert.ok(screened.includes(escaped(copy.likelihoodValues.LIKELY)));
  }
  const panels = readFileSync(new URL("../components/DatesIntakePanels.tsx", import.meta.url), "utf8");
  // The image element is the console's own route, same-origin referrer, and only after the reviewer's click.
  assert.match(panels, /visible\s+\/\/[^\n]*\n\s+\? <img src=\{src\} alt=\{t\("detail\.flyerAlt", \{ index: image\.index \}\)\} referrerPolicy="same-origin"/);
  assert.match(panels, /const src = datesIntakeMediaUrl\(intake\.intake_id, image\.index\)/);
  assert.equal((panels.match(/datesIntakeMediaUrl/g) ?? []).length, 2, "one import, one use");
  // The flyer never reaches the editor, the publish command or the event: the only image policy of an event is category art.
  for (const file of ["../components/DatesIntakeReviewPage.tsx", "../components/DatesIntakeEventPanel.tsx", "../components/DatesExternalEventForm.tsx",
    "../components/DatesIntakeSourcePanel.tsx", "../lib/datesIntakeConsole.ts", "../lib/datesExternalInput.ts"])
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), "utf8"), /datesIntakeMediaUrl|dates-intake-media|image_url|data_base64/, file);
  const review = readFileSync(new URL("../components/DatesIntakeReviewPage.tsx", import.meta.url), "utf8");
  assert.match(review, /<DatesExternalEventForm key=\{`\$\{intakeId\}:\$\{openEvent\}`\} initialDraft=\{datesIntakeEditorDraft\(editing\.editor_input\)\}/);
  for (const locale of LOCALES) assert.match(messagesOf(locale).datesAdmin.external.form.imagePolicy, /flyer/i);
});

test("the review screen says in both languages that the content is AI-extracted, and publishes only through the P1 publisher", () => {
  const review = readFileSync(new URL("../components/DatesIntakeReviewPage.tsx", import.meta.url), "utf8");
  for (const key of ["aiNotice", "detail.extractionNotice", "editor.notice", "editor.formNotice", "editor.confirm"]) assert.ok(review.includes(`t("${key}")`), key);
  assert.match(review, /runDatesIntakePublish\(adminCall, storage, actor/);
  assert.doesNotMatch(review, /adminCall\("dates_(event_intake_publish|external_event_publish)"/, "publication never bypasses the journal");
  assert.match(review, /<ConfirmDialog title=\{external\("editor\.publish"\)\}/);
  // The reviewer's hold is renewed, and never while a saved publish command holds its revision.
  assert.match(review, /if \(life !== lifetime\.current \|\| busyRef\.current \|\| pendingRef\.current \|\| revision\.current === null\) return;/);
  assert.match(review, /DATES_INTAKE_HEARTBEAT_SECONDS \* 1000/);
  // A reply to an earlier read never replaces a newer one, and a failed background check changes nothing.
  assert.match(review, /if \(signal\?\.aborted \|\| current !== generation\.current\) return;/);
  assert.match(review, /if \(mode !== "initial" && next\.kind === "unconfirmed"\) \{/);
  for (const locale of LOCALES) {
    const copy = messagesOf(locale).datesAdmin.intake;
    assert.match(copy.aiNotice, locale === "en" ? /extracted by AI.*until a person/s : /MI olvasott ki.*amíg egy ember/s);
    assert.match(copy.editor.confirm, locale === "en" ? /AI-assisted/ : /MI-segítséggel/);
    assert.match(copy.source.copy, locale === "en" ? /never publishes/ : /soha nem publikál/);
  }
});

test("the published event carries the AI-assisted label and its Places venue on both detail surfaces", () => {
  const body = fixture("admin-external-detail-ai-assisted");
  const event = decodeDatesExternalDetail(body, body.event.external_event_id)!.event;
  for (const locale of LOCALES) {
    const copy = messagesOf(locale).datesAdmin.external;
    const html = render(locale, createElement(DatesExternalProvenance, { event }));
    assert.ok(html.includes(escaped(copy.aiBadge)) && html.includes(escaped(copy.provenance.aiAssisted)));
    assert.equal(html.includes(escaped(copy.provenance.noAi)), false);
    assert.ok(html.includes(escaped(copy.provenance.venuePlaces)) && html.includes(event.venue.place_id!));
    assert.ok(html.includes(escaped(copy.provenance.adminEntered)), "published by an administrator, not credited to a member");
  }
  // A manually entered event still says so.
  const manual = JSON.parse(readFileSync(new URL("./fixtures/dates_external_admin_wire/admin-detail-admin.json", import.meta.url), "utf8"));
  const html = render("en", createElement(DatesExternalProvenance, { event: decodeDatesExternalDetail(manual, manual.event.external_event_id)!.event }));
  assert.ok(html.includes(escaped(messagesOf("en").datesAdmin.external.provenance.noAi)) && html.includes(escaped(messagesOf("en").datesAdmin.external.provenance.venuePin)));
  assert.equal(html.includes(messagesOf("en").datesAdmin.external.aiBadge), false);
  // The badge is on the editor page header, the activity detail and the activities list - where Core serves the flag.
  assert.match(readFileSync(new URL("../components/DatesExternalEditorPage.tsx", import.meta.url), "utf8"), /event\.ai_assisted && <span className="badge badge-warning">\{t\("aiBadge"\)\}/);
  assert.match(readFileSync(new URL("../app/(dashboard)/dates/[activityId]/page.tsx", import.meta.url), "utf8"), /data\.external_event\.ai_assisted && <span className="badge badge-warning">\{external\("aiBadge"\)\}/);
  assert.match(readFileSync(new URL("../app/(dashboard)/dates/page.tsx", import.meta.url), "utf8"), /row\.host === null && row\.ai_assisted && <span className="badge badge-warning">\{external\("aiBadge"\)\}/);
});

test("every closed value of the wire has words in both languages, and both trees are identical", () => {
  const en = messagesOf("en").datesAdmin.intake, hu = messagesOf("hu").datesAdmin.intake;
  const keys = (value: unknown, prefix = ""): string[] => value && typeof value === "object"
    ? Object.entries(value).flatMap(([key, item]) => keys(item, `${prefix}${key}/`)) : [prefix];
  assert.deepEqual(keys(en), keys(hu));
  const GROUPS: Record<string, [string, readonly string[]]> = {
    status: ["statusValues", DATES_INTAKE_VOCABULARIES.status], status_detail: ["statusDetailValues", DATES_INTAKE_VOCABULARIES.status_detail],
    channel: ["channelValues", DATES_INTAKE_VOCABULARIES.channel], input_kind: ["inputKindValues", DATES_INTAKE_VOCABULARIES.input_kind],
    decision_action: ["decisionValues", DATES_INTAKE_VOCABULARIES.decision_action], reject_reason: ["rejectReasons", DATES_INTAKE_VOCABULARIES.reject_reason],
    result: ["resultValues", DATES_INTAKE_VOCABULARIES.result], hard_fail: ["hardFails", DATES_INTAKE_VOCABULARIES.hard_fail],
    warning: ["warnings", DATES_INTAKE_VOCABULARIES.warning], auto_blocker: ["autoBlockers", DATES_INTAKE_VOCABULARIES.auto_blocker],
    tier: ["tierValues", DATES_INTAKE_VOCABULARIES.tier], witness_verdict: ["witnessValues", DATES_INTAKE_VOCABULARIES.witness_verdict],
    evidence_field: ["evidenceFields", DATES_INTAKE_VOCABULARIES.evidence_field], evidence_match: ["matchValues", DATES_INTAKE_VOCABULARIES.evidence_match],
    dedupe_decision: ["dedupeValues", DATES_INTAKE_VOCABULARIES.dedupe_decision], dedupe_verdict: ["dedupeVerdicts", DATES_INTAKE_VOCABULARIES.dedupe_verdict],
    dedupe_candidate_kind: ["dedupeKinds", DATES_INTAKE_VOCABULARIES.dedupe_candidate_kind], link_drop_reason: ["linkDropReasons", DATES_INTAKE_VOCABULARIES.link_drop_reason],
    provider: ["providerValues", DATES_INTAKE_VOCABULARIES.provider], ai_outcome: ["outcomeValues", DATES_INTAKE_VOCABULARIES.ai_outcome],
    safe_search_likelihood: ["likelihoodValues", DATES_INTAKE_VOCABULARIES.safe_search_likelihood],
    status_help: ["statusHelp", DATES_INTAKE_VOCABULARIES.status], status_detail_help: ["statusDetailHelp", DATES_INTAKE_VOCABULARIES.status_detail],
    attendance: ["attendanceModes", DATES_INTAKE_KNOWN_ATTENDANCE_MODES], signals: ["statusSignals", DATES_INTAKE_KNOWN_STATUS_SIGNALS],
    prohibited: ["prohibitedCategories", DATES_INTAKE_KNOWN_PROHIBITED_CATEGORIES], tasks: ["taskValues", DATES_INTAKE_KNOWN_TASKS],
    links: ["linkFields", DATES_INTAKE_KNOWN_LINK_FIELDS],
  };
  // Every vocabulary of the manifest but `category` (the P1 table) and `lease_action` (button labels) has its own group.
  assert.deepEqual(Object.keys(DATES_INTAKE_VOCABULARIES).filter((name) => !Object.hasOwn(GROUPS, name)).sort(), ["category", "lease_action"]);
  for (const [group, values] of Object.values(GROUPS)) for (const copy of [en, hu]) {
    assert.deepEqual(Object.keys(copy[group]).sort(), [...values].sort(), group);
    for (const value of values) assert.ok(String(copy[group][value]).trim().length > 1, `${group}.${value}`);
  }
  for (const action of DATES_INTAKE_VOCABULARIES.lease_action) for (const copy of [en, hu]) assert.ok(copy.lease.done[action]);
  // Categories follow the canonical fifteen-name table the console already has.
  for (const locale of LOCALES) assert.deepEqual(Object.keys(messagesOf(locale).datesAdmin.external.form.categories).sort(), [...DATES_EXTERNAL_CATEGORIES].sort());
  // The mode is called AreYouIn; an intake is "beküldés", a draft "vázlat".
  assert.equal(hu.queue.title, "Beküldések"); assert.equal(hu.source.title, "Vázlat forrásból"); assert.equal(en.source.title, "Draft from source");
  assert.equal(messagesOf("hu").datesAdmin.tabs.intakes, "Beküldések");
  assert.match(hu.rejectReasons.outside_area, /AreYouIn/);
  const flat = (value: unknown): string[] => typeof value === "string" ? [value] : Object.values(value as object).flatMap(flat);
  for (const text of [...flat(en), ...flat(hu)]) { assert.doesNotMatch(text, RETIRED_BRAND); assert.doesNotMatch(text, /Are You In\b|\bAYI\b/i); assert.ok(text.trim() === text && text.length > 0); }
  // Hungarian copy is Hungarian: a sentence that is identical in both files is a name or a unit, never prose.
  const same = keys(en).filter((path) => { const read = (tree: any) => path.split("/").filter(Boolean).reduce((node, key) => node[key], tree); return read(en) === read(hu); });
  assert.deepEqual(same.sort(), ["attendanceModes/online/", "inputKindValues/url/", "lease/other/", "providerValues/anthropic/", "providerValues/gemini/", "providerValues/openai/"]);
});

test("every refusal Core's contract names, and every bridge refusal of the two routes, is explained in both languages beside its token", () => {
  const corpus = readdirSync(DIRECTORY).filter((name) => name.endsWith("-denied.json")).map((name) => fixture(name.slice(0, -5)).error as string);
  const bridge = ["bad-origin", "auth-required", "invalid-input", "too-large", "image-too-large", "image-type-unsupported", "core-unavailable", "core-timeout",
    "invalid-core-response", "dates-admin-capability-required"];
  for (const locale of LOCALES) {
    const copy = messagesOf(locale).datesAdmin.intake.refusals;
    for (const token of new Set([...Object.keys(DATES_INTAKE_REFUSALS), ...corpus, ...bridge])) {
      assert.ok(copy[token]?.length > 10, `${locale}: ${token}`);
      const html = render(locale, createElement(DatesIntakeRefusal, { error: token }));
      assert.ok(html.includes(escaped(copy[token])) && html.includes(`<code>${token}</code>`), "the explanation and the genuine token");
    }
    // A token this console has never heard of is still shown as what Core said.
    const unknown = render(locale, createElement(DatesIntakeRefusal, { error: "dates-intake-future-rule" }));
    assert.ok(unknown.includes(escaped(copy.unknown)) && unknown.includes("<code>dates-intake-future-rule</code>"));
  }
});

test("\"Draft from source\" is offered, disabled with its reason, or absent - in both languages", async () => {
  const { default: DatesIntakeSourcePanel } = await import("../components/DatesIntakeSourcePanel.tsx");
  for (const locale of LOCALES) {
    const copy = messagesOf(locale).datesAdmin.intake.source;
    const panel = (state: "available" | "disabled" | "noCapability" | "unknown") => render(locale, createElement(DatesIntakeSourcePanel, { entry: { state }, onCreated: () => undefined }));
    const available = panel("available");
    assert.ok(available.includes(escaped(copy.title)) && available.includes(escaped(copy.open)) && available.includes(escaped(copy.copy)));
    assert.equal(available.includes(escaped(copy.disabled)), false);
    // Off: the entry is shown without its button, with the reason and the way to the switch.
    const disabled = panel("disabled");
    assert.ok(disabled.includes(escaped(copy.disabled)) && disabled.includes('href="/dates/configuration"'));
    assert.match(disabled, /dates_external_admin_drafts_enabled/);
    assert.equal(disabled.includes(escaped(copy.open)), false);
    // An operator who could never create a draft is not shown the entry at all.
    assert.equal(panel("noCapability"), "");
    // A failed read is not "off": the entry stays and says that Core will answer.
    const unknown = panel("unknown");
    assert.ok(unknown.includes(escaped(copy.unknown)) && unknown.includes(escaped(copy.open)));
  }
  const panel = readFileSync(new URL("../components/DatesIntakeSourcePanel.tsx", import.meta.url), "utf8");
  // One identity per source, renewed when the source changes; the flyer goes to the console's own route and nowhere else.
  assert.match(panel, /if \(key\.current === ""\) key\.current = createDatesIntakeSourceKey\(\);/);
  assert.match(panel, /function changed\(\) \{ key\.current = ""; setNotice\(null\); \}/);
  assert.match(panel, /submitDatesIntakeSource\(adminIntakeCreate, draft, files\.map\(\(item\) => item\.file\), locale, key\.current\)/);
  assert.match(panel, /const problem = datesIntakeSourceProblem\(draft, files\);\s+if \(problem\) \{ setNotice\(\{ kind: "problem", key: problem \}\); return; \}/);
  assert.doesNotMatch(panel, /adminUploadImage|upload-image|canvas|createImageBitmap/, "never the public image upload, and no client-side resizing");
  const client = readFileSync(new URL("../lib/adminClient.ts", import.meta.url), "utf8");
  assert.match(client, /fetch\("\/api\/admin\/dates-intake-create", \{\s+method: "POST",\s+headers: \{ \[ADMIN_REQUEST_HEADER\]: ADMIN_REQUEST_HEADER_VALUE \}/);
  // The external events page offers the entry through a self-loading component that asks Core about the switch and the capability.
  assert.match(readFileSync(new URL("../app/(dashboard)/dates/external/page.tsx", import.meta.url), "utf8"), /<DatesAdminTabs \/>\s+<DatesIntakeSourceEntry \/>/);
  assert.match(readFileSync(new URL("../components/DatesIntakeSourceEntry.tsx", import.meta.url), "utf8"), /readDatesIntakeDraftEntry\(adminCall, controller\.signal\)/);
});
