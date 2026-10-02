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
import { decodeDatesActivityOriginDetail, decodeDatesExternalDetail, decodeDatesExternalList } from "../lib/datesExternalAdmin.ts";
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
  assert.equal(DETAILS.length, 49, "35 of the operators' drafts and 14 of members' suggestions");
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
  for (const key of ["aiNotice", "editor.notice", "editor.formNotice", "editor.confirm"]) assert.ok(review.includes(`t("${key}")`), key);
  assert.ok(readFileSync(new URL("../components/DatesIntakePanels.tsx", import.meta.url), "utf8").includes('t("detail.extractionNotice")'));
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

test("the published event carries the AI-assisted label, its Places venue and the way back to its intake on both detail surfaces", () => {
  const body = fixture("admin-external-detail-ai-assisted");
  const event = decodeDatesExternalDetail(body, body.event.external_event_id)!.event;
  const embedded = fixture("admin-activity-detail-ai-assisted");
  const activity = decodeDatesActivityOriginDetail(embedded, embedded.activity.activity_id, ["dates_external_event_read", "dates_external_event_manage"])!.external!;
  for (const locale of LOCALES) {
    const copy = messagesOf(locale).datesAdmin.external, channels = messagesOf(locale).datesAdmin.intake.channelValues;
    // The same panel serves the external detail and the activity detail; both genuine bodies render the same provenance.
    for (const source of [event, activity]) {
      const html = render(locale, createElement(DatesExternalProvenance, { event: source }));
      assert.ok(html.includes(escaped(copy.aiBadge)) && html.includes(escaped(copy.provenance.aiAssisted)));
      assert.equal(html.includes(escaped(copy.provenance.noAi)), false);
      assert.ok(html.includes(escaped(copy.provenance.venuePlaces)) && html.includes(source.venue.place_id!));
      assert.ok(html.includes(escaped(copy.provenance.adminEntered)), "published by an administrator, not credited to a member");
      // The link back to the intake the event was drafted from, its channel in words and which of its events this was.
      assert.ok(html.includes(`<a href="/dates/intakes/${source.intake!.intake_id}">${escaped(copy.provenance.intakeLink)}</a>`));
      assert.ok(html.includes(escaped(copy.provenance.intake)) && html.includes(escaped(channels.admin_draft)));
      assert.ok(html.includes(escaped(copy.provenance.intakeEvent.replace("{index}", "1"))), "Core's index 0 is the first event");
      assert.doesNotMatch(html.replace(/href="[^"]*"/g, ""), /admin_draft|xin_/, "no machine value as text");
    }
    // DERIVED: an event published from a member's suggestion names that channel (no genuine body until P2b).
    const member = render(locale, createElement(DatesExternalProvenance, { event: { ...event, intake: { ...event.intake!, channel: "member_suggestion", event_index: 2 } } }));
    assert.ok(member.includes(escaped(channels.member_suggestion)) && member.includes(escaped(copy.provenance.intakeEvent.replace("{index}", "3"))));
  }
  // A manually entered event still says so.
  const manual = JSON.parse(readFileSync(new URL("./fixtures/dates_external_admin_wire/admin-detail-admin.json", import.meta.url), "utf8"));
  const html = render("en", createElement(DatesExternalProvenance, { event: decodeDatesExternalDetail(manual, manual.event.external_event_id)!.event }));
  assert.ok(html.includes(escaped(messagesOf("en").datesAdmin.external.provenance.noAi)) && html.includes(escaped(messagesOf("en").datesAdmin.external.provenance.venuePin)));
  assert.equal(html.includes(messagesOf("en").datesAdmin.external.aiBadge), false);
  // ...and has no intake to link to (Core serves `intake: null`).
  assert.equal(manual.event.intake, null);
  assert.doesNotMatch(html, /\/dates\/intakes\//);
  assert.equal(html.includes(escaped(messagesOf("en").datesAdmin.external.provenance.intake)), false);
  // The badge is on the external list row, the editor page header, the activity detail and the Activities list.
  assert.match(readFileSync(new URL("../app/(dashboard)/dates/external/page.tsx", import.meta.url), "utf8"),
    /<span className="badge badge-demo">\{t\("badge"\)\}<\/span>\{row\.ai_assisted && <span className="badge badge-warning">\{t\("aiBadge"\)\}<\/span>\}/);
  // The genuine list with an AI-assisted row decodes with the flag the badge reads; every row of the manual lists has it false.
  const assistedList = fixture("admin-external-list-ai-assisted");
  assert.deepEqual(decodeDatesExternalList(assistedList, { page: 1, limit: 40 })!.events.map((row) => row.ai_assisted), [true]);
  const manualList = JSON.parse(readFileSync(new URL("./fixtures/dates_external_admin_wire/admin-list-admin.json", import.meta.url), "utf8"));
  assert.ok(decodeDatesExternalList(manualList, { page: manualList.page, limit: manualList.limit })!.events.every((row) => row.ai_assisted === false));
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
  GROUPS.member_confirmation_state = ["memberConfirmationValues", DATES_INTAKE_VOCABULARIES.member_confirmation_state];
  GROUPS.member_editable_field = ["memberFieldValues", DATES_INTAKE_VOCABULARIES.member_editable_field];
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
    const panel = (state: "available" | "disabled" | "noCapability" | "unknown") => render(locale, createElement(DatesIntakeSourcePanel, { entry: { state, actor: "admin@example.test" }, onCreated: () => undefined }));
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
  // One identity per source while the panel is open: kept across an unknown outcome, renewed when the source changes.
  // The panel holds no key itself, and nothing it stores can stop or decide a submission.
  assert.match(panel, /if \(attempts\.current === null\) attempts\.current = createDatesIntakeSourceAttempts\(\);/);
  assert.match(panel, /const outcome = await attempts\.current!\.send\(adminIntakeCreate, draft, files\.map\(\(item\) => item\.file\), locale\);/);
  assert.match(panel, /function changed\(\) \{ attempts\.current!\.changed\(\); setNotice\(null\); \}/);
  assert.doesNotMatch(panel, /idempotency|createDatesIntakeSourceKey|submitDatesIntakeSource|Tombstone|fingerprint|sha256|locked|expired|retire|evidence/i);
  // The only fieldset lock is "a request is running"; no input is ever disabled by an earlier outcome.
  assert.match(panel, /<fieldset className="dates-external-fields" disabled=\{busy\}>/);
  assert.equal((panel.match(/disabled=\{/g) ?? []).length, 1);
  // The reminder: read for the signed-in operator in an effect, shown only through the actor check, never consulted by submit.
  assert.match(panel, /useEffect\(\(\) => \{\s+setReminder\(actor === null \? null : \{ actor, hint: readDatesIntakeHint\(datesIntakeHintStorage\(\), actor\) \}\);\s+\}, \[actor\]\);/);
  assert.match(panel, /const hint = datesIntakeHintFor\(reminder, actor\);/);
  assert.match(panel, /\{hint && <DatesIntakeSubmissionReminder hint=\{hint\} onDismiss=\{\(\) => remind\(null\)\} \/>\}/);
  const submitBody = panel.slice(panel.indexOf("async function submit"), panel.indexOf("return <section")).replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(submitBody, /readDatesIntakeHint|datesIntakeHintFor|\breminder\b|\bhint\b/, "submit writes the reminder and never reads it: what is sent does not depend on it");
  assert.equal((submitBody.match(/\bremind\(/g) ?? []).length, 2, "forgotten when the same request is answered, written when it is not");
  assert.equal((panel.match(/Date\.now\(\)/g) ?? []).length, 1, "the clock is read once, to stamp the reminder with a time to show");
  assert.match(panel, /const problem = datesIntakeSourceProblem\(draft, files\);\s+if \(problem\) \{ setNotice\(\{ kind: "problem", key: problem \}\); return; \}/);
  assert.doesNotMatch(panel, /adminUploadImage|upload-image|canvas|createImageBitmap/, "never the public image upload, and no client-side resizing");
  const client = readFileSync(new URL("../lib/adminClient.ts", import.meta.url), "utf8");
  assert.match(client, /fetch\("\/api\/admin\/dates-intake-create", \{\s+method: "POST",\s+headers: \{ \[ADMIN_REQUEST_HEADER\]: ADMIN_REQUEST_HEADER_VALUE \}/);
  // The external events page offers the entry through a self-loading component that asks Core about the switch and the capability.
  assert.match(readFileSync(new URL("../app/(dashboard)/dates/external/page.tsx", import.meta.url), "utf8"), /<DatesAdminTabs \/>\s+<DatesIntakeSourceEntry \/>/);
  assert.match(readFileSync(new URL("../components/DatesIntakeSourceEntry.tsx", import.meta.url), "utf8"), /readDatesIntakeDraftEntry\(adminCall, controller\.signal\)/);
});

test("review finding: an intake's address is a link only over https; http and every other scheme stay text", async () => {
  const { datesIntakeLink } = await import("../lib/datesIntakeAdmin.ts");
  const { default: DatesIntakeUrl } = await import("../components/DatesIntakeUrl.tsx");
  for (const value of ["https://akvariumklub.hu/programok/acidarab/", "https://jegy.kekhold.example/osz2026", "HTTPS://Example.test/a?b=c#d"]) assert.equal(datesIntakeLink(value), value);
  for (const value of ["http://events.example/path", "HTTP://events.example/", "https://user:secret@example.test/", "https://user@example.test/", "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>", "ftp://example.test/a", "mailto:a@example.test", "file:///etc/passwd", "//example.test/a", "/dates/intakes", "example.test",
    "https://", "https:example.test", " https://example.test/", "https://example.test/a b", "https://example.test/\u0000", "", null, 7, {}])
    assert.equal(datesIntakeLink(value), null, String(value));
  for (const locale of LOCALES) {
    const copy = messagesOf(locale).datesAdmin.intake.detail;
    // DERIVED from the genuine link intake: Core accepts and fetches an http source; the reviewer sees it, but cannot click it.
    const body = fixture("admin-detail-in-review-url"), http = "http://events.example/path?id=1";
    const intake = projectDatesIntakeDetail({ ...body, intake: { ...body.intake, inputs: { ...body.intake.inputs, url: http },
      fetch: { ...body.intake.fetch, final_url: http },
      events: body.intake.events.map((event: any) => ({ ...event, validation: { ...event.validation, links: { ...event.validation.links,
        official_url: http, ticket_url: "javascript:alert(1)", organizer_url: "https://user:secret@example.test/" } } })) } }, body.intake.intake_id)!.intake;
    assert.deepEqual(intake.unreadable_sections, []);
    const html = render(locale, createElement(DatesIntakeInputsPanel, { intake }), ...intake.events.map((event, index) => createElement(DatesIntakeEventPanel, { key: index, event: event!, total: 1 })));
    assert.doesNotMatch(html, /href="(?!https:\/\/|\/dates\/)/, "no link that is not https or the console's own route");
    assert.doesNotMatch(html, /href="[^"]*(?:events\.example|javascript|user:secret)/);
    // The address is still shown, as text, with the note; three times for the http source (submitted, fetched, official link).
    assert.equal(html.split(escaped(http)).length - 1, 3);
    assert.ok(html.includes("javascript:alert(1)") && html.includes("https://user:secret@example.test/"));
    assert.equal(html.split(escaped(copy.notLinked)).length - 1, 5);
    // The genuine https source is a link, opened in a new tab without an opener, and carries no note.
    const genuine = render(locale, createElement(DatesIntakeInputsPanel, { intake: detail("admin-detail-in-review-official") }));
    assert.match(genuine, /<a href="https:\/\/akvariumklub\.hu\/programok\/acidarab\/" target="_blank" rel="noopener noreferrer">/);
    assert.equal(genuine.includes(escaped(copy.notLinked)), false);
    assert.equal(render(locale, createElement(DatesIntakeUrl, { value: null })), "—");
  }
  // One helper on these screens: no panel builds an anchor from an intake's address by itself.
  for (const file of ["../components/DatesIntakePanels.tsx", "../components/DatesIntakeEventPanel.tsx", "../components/DatesIntakeReviewPage.tsx", "../components/DatesIntakeSourcePanel.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /datesIntakeLink|<a href=/, file);
  }
});

test("review finding: a whole section that cannot be read is said to be unreadable, never worded as empty", async () => {
  const { DatesIntakeExtractionPanel, DatesIntakeRejectWarning } = await import("../components/DatesIntakePanels.tsx");
  const base = fixture("admin-detail-in-review-multi"), id = base.intake.intake_id;
  // DERIVED: the genuine four-event intake with its lists served in shapes this console does not know.
  const broken = (change: Record<string, unknown>) => projectDatesIntakeDetail({ ...base, intake: { ...base.intake, ...change } }, id)!.intake;
  for (const locale of LOCALES) {
    const copy = messagesOf(locale).datesAdmin.intake;
    const unreadable = broken({ events: { rows: base.intake.events }, ai_runs: "20 calls", source_texts: null });
    assert.deepEqual([unreadable.events, unreadable.ai_runs, unreadable.source_texts], [null, null, null]);
    const html = render(locale, createElement(DatesIntakeStatusPanel, { intake: unreadable }), createElement(DatesIntakeInputsPanel, { intake: unreadable }),
      createElement(DatesIntakeExtractionPanel, { intake: unreadable, manage: true, draftsOff: false }), createElement(DatesIntakeRunsPanel, { intake: unreadable }),
      createElement(DatesIntakeRejectWarning, { intake: unreadable }));
    // Each section says it could not be read...
    for (const key of ["eventsUnreadable", "runsUnreadable", "textsUnreadable"]) assert.ok(html.includes(escaped(copy.detail[key])), `${locale}: ${key}`);
    // ...and none of them claims that there is nothing: not "no event", not "no AI call".
    assert.equal(html.includes(escaped(copy.detail.noEvents)), false, "never 'the AI did not produce an event'");
    assert.equal(html.includes(escaped(copy.detail.noRuns)), false, "never 'no AI call has been made'");
    // The reviewer who rejects now is told that the extraction is not on screen.
    assert.ok(html.includes(escaped(copy.reject.eventsUnreadable)));
    // A result or a decision that cannot be read is not "no answer yet".
    const blind = broken({ result: "maybe", decision: { by: 7 } });
    const status = render(locale, createElement(DatesIntakeStatusPanel, { intake: blind }));
    assert.equal(status.includes(escaped(copy.detail.noResult)), false);
    assert.equal(status.split(escaped(copy.detail.couldNotRead)).length - 1, 2, "the result and the decision");
    // Genuinely empty lists keep the ordinary wording: an intake the worker has not touched has no event and no AI call.
    const received = detail("admin-detail-received");
    const plain = render(locale, createElement(DatesIntakeExtractionPanel, { intake: received, manage: true, draftsOff: false }), createElement(DatesIntakeRunsPanel, { intake: received }),
      createElement(DatesIntakeRejectWarning, { intake: received }));
    assert.ok(plain.includes(escaped(copy.detail.noEvents)) && plain.includes(escaped(copy.detail.noRuns)));
    for (const key of ["eventsUnreadable", "runsUnreadable"]) assert.equal(plain.includes(escaped(copy.detail[key])), false);
    assert.equal(plain.includes(escaped(copy.reject.eventsUnreadable)), false);
    // Some unreadable events: the rejection warning counts them; unreadable rows of AI calls do not turn into "no AI call".
    const partial = projectDatesIntakeDetail({ ...base, intake: { ...base.intake, events: base.intake.events.map((event: any, index: number) => index === 1 ? { ...event, draft: null } : event),
      ai_runs: [{ provider: "mistral" }] } }, id)!.intake;
    const some = render(locale, createElement(DatesIntakeRejectWarning, { intake: partial }), createElement(DatesIntakeRunsPanel, { intake: partial }));
    assert.ok(some.includes(escaped(copy.reject.someUnreadable.replace("{count}", "1"))));
    assert.ok(some.includes(escaped(copy.detail.unreadableRuns.replace("{count}", "1"))));
    assert.equal(some.includes(escaped(copy.detail.noRuns)), false);
  }
  // The page renders these states through the panels; it has no empty-state wording of its own.
  const review = readFileSync(new URL("../components/DatesIntakeReviewPage.tsx", import.meta.url), "utf8");
  assert.match(review, /<DatesIntakeExtractionPanel intake=\{intake\} manage=\{access\.manage\} draftsOff=\{result\?\.draftsEnabled === false\} \/>/);
  assert.match(review, /<DatesIntakeRejectWarning intake=\{intake\} \/>/);
  assert.doesNotMatch(review, /detail\.noEvents|detail\.noRuns/);
});

test("review finding: closing an intake with unread events is an explicit, worded choice whose default leaves it open", async () => {
  const { DatesIntakeCompletionChoice } = await import("../components/DatesIntakePanels.tsx");
  for (const locale of LOCALES) {
    const copy = messagesOf(locale).datesAdmin.intake.editor;
    const choice = (completion: { remaining: number; unreadable: number; mode: "last" | "choice" | "unreadable" }, close: boolean) =>
      render(locale, createElement(DatesIntakeCompletionChoice, { completion, close, disabled: false, onChange: () => undefined }));
    // Plainly the last event: nothing to choose.
    assert.equal(choice({ remaining: 0, unreadable: 0, mode: "last" }, false), "");
    // Other readable events: the existing "this is the last one" tick, unticked by default.
    const tick = choice({ remaining: 3, unreadable: 0, mode: "choice" }, false);
    assert.match(tick, /<input type="checkbox"\/?>/); assert.ok(tick.includes(escaped(copy.complete.replace("{remaining}", "3"))));
    // An unreadable sibling: two worded options, "leave open" selected, and the count of what could not be read in both.
    const open = choice({ remaining: 0, unreadable: 1, mode: "unreadable" }, false);
    assert.ok(open.includes(escaped(copy.unreadableSiblings.replace("{count}", "1"))));
    assert.ok(open.includes(escaped(copy.keepOpen)) && open.includes(escaped(copy.closeAnyway.replace("{count}", "1").replace("{remaining}", "0"))));
    assert.equal((open.match(/type="radio"/g) ?? []).length, 2); assert.equal((open.match(/checked=""/g) ?? []).length, 1);
    assert.ok(open.indexOf('checked=""') < open.indexOf(escaped(copy.keepOpen)), "the default is to leave the intake open");
    const closing = choice({ remaining: 2, unreadable: 1, mode: "unreadable" }, true);
    assert.ok(closing.indexOf('checked=""') > closing.indexOf(escaped(copy.keepOpen)));
    assert.ok(closing.includes(escaped(copy.closeAnyway.replace("{count}", "1").replace("{remaining}", "2"))));
    assert.match(copy.confirmCloseUnreadable, /\{count\}/);
  }
});

test("review finding: an unknown create outcome is worded as unknown and shows what was answered", async () => {
  const { DatesIntakeSourceNotice } = await import("../components/DatesIntakeSourcePanel.tsx");
  for (const locale of LOCALES) {
    const copy = messagesOf(locale).datesAdmin.intake;
    const notice = (value: Parameters<typeof DatesIntakeSourceNotice>[0]["notice"]) => render(locale, createElement(DatesIntakeSourceNotice, { notice: value }));
    assert.equal(notice(null), "");
    // No answer at all.
    const silent = notice({ kind: "uncertain", error: null });
    assert.ok(silent.includes(escaped(copy.source.uncertain))); assert.doesNotMatch(silent, /<code>/);
    // A transport failure and Core's in-progress reply: still unknown, with the token and its explanation beside it.
    for (const error of ["core-timeout", "core-unavailable", "invalid-core-response", "dates-admin-command-in-progress"]) {
      const html = notice({ kind: "uncertain", error });
      assert.ok(html.includes(escaped(copy.source.uncertain)), error);
      assert.ok(html.includes(`<code>${error}</code>`) && html.includes(escaped(copy.refusals[error])), error);
    }
    // A definitive refusal is Core's words alone: nothing claims that the outcome is unknown.
    const refused = notice({ kind: "refused", error: "dates-intake-source-not-readable" });
    assert.ok(refused.includes(escaped(copy.refusals["dates-intake-source-not-readable"])));
    assert.equal(refused.includes(escaped(copy.source.uncertain)), false);
    assert.ok(notice({ kind: "problem", key: "imageType" }).includes(escaped(copy.source.problems.imageType)));
    assert.equal(typeof copy.source.retry, "string");
    // Nothing of a lock, a record or an evidence-gated discard is left in the copy.
    for (const key of ["locked", "checkQueue", "discard", "discardHint", "pending"]) assert.equal(key in copy.source, false, key);
    assert.deepEqual(Object.keys(copy.source.problems), ["url", "text", "imageCount", "imageSize", "imageType"]);
  }
});

test("T-885 existing marker: the draft that was already there is announced as already submitted - not as new, not as an error", async () => {
  const { DatesIntakeAlreadySubmitted } = await import("../components/DatesIntakePanels.tsx");
  for (const locale of LOCALES) {
    const copy = messagesOf(locale).datesAdmin.intake.source;
    const html = render(locale, createElement(DatesIntakeAlreadySubmitted, { onDismiss: () => undefined }));
    assert.ok(html.includes(escaped(copy.existing)));
    // Information, not an error and not a success message; the operator may put it away.
    assert.match(html, /^<div class="alert alert-info" role="status">/); assert.doesNotMatch(html, /alert-error|alert-success|alert-warning/);
    assert.equal((html.match(/<button type="button"/g) ?? []).length, 1); assert.ok(html.includes(escaped(copy.hintDismiss)));
    // What it says: already submitted, still open, nothing new made.
    assert.match(copy.existing, locale === "en" ? /already been submitted/ : /már beküldted/);
    assert.match(copy.existing, locale === "en" ? /Nothing new was created/ : /Semmi új nem jött létre/);
    // The reminder beside it stays true: after a reload the operator may simply submit again.
    assert.match(copy.hint, locale === "en" ? /submit the same source again/ : /beküldheted újra ugyanazt a forrást/);
    assert.match(copy.hint, locale === "en" ? /instead of making a second one/ : /nem készít másodikat/);
  }
});

test("review recheck 2: the reminder of an unanswered submission is a dismissible note for one operator - a time, a kind and a link", async () => {
  const { DatesIntakeSubmissionReminder } = await import("../components/DatesIntakeSourcePanel.tsx");
  const { datesIntakeHintFor } = await import("../lib/datesIntakeConsole.ts");
  const hint = { at: 1790000000, kind: "images" as const };
  for (const locale of LOCALES) {
    const copy = messagesOf(locale).datesAdmin.intake;
    const html = render(locale, createElement(DatesIntakeSubmissionReminder, { hint, onDismiss: () => undefined }));
    const parts = copy.source.hint.split(/\{time\}|\{kind\}/);
    assert.equal(parts.length, 3, "the time and the kind");
    assert.ok(html.includes(escaped(parts[0])) && html.includes(escaped(parts[2])) && html.includes(escaped(copy.inputKindValues.images)));
    assert.match(html, /href="\/dates\/intakes"/);
    assert.ok(html.includes(escaped(copy.source.hintLink)) && html.includes(escaped(copy.source.hintDismiss)));
    assert.equal((html.match(/<button type="button"/g) ?? []).length, 1, "one button: dismiss");
    assert.doesNotMatch(html, /disabled/);
  }
  // Shown only to the operator it was read for, and to nobody while the operator is not known - synchronously, with no effect in between.
  assert.deepEqual(datesIntakeHintFor({ actor: "a@example.test", hint }, "a@example.test"), hint);
  assert.equal(datesIntakeHintFor({ actor: "a@example.test", hint }, "b@example.test"), null, "another operator's reminder is never painted");
  assert.equal(datesIntakeHintFor({ actor: "a@example.test", hint }, null), null);
  assert.equal(datesIntakeHintFor(null, "a@example.test"), null); assert.equal(datesIntakeHintFor({ actor: "a@example.test", hint: null }, "a@example.test"), null);
});
