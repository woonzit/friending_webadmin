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
import DatesSuggestionConsentStatus from "../components/DatesSuggestionConsentStatus.tsx";
import { decodeDatesActivityOriginDetail, decodeDatesExternalDetail, decodeDatesExternalList } from "../lib/datesExternalAdmin.ts";
import { DATES_EXTERNAL_CATEGORIES } from "../lib/datesExternalInput.ts";
import {
  DATES_INTAKE_EVIDENCE_FIELDS, DATES_INTAKE_KNOWN_ATTENDANCE_MODES, DATES_INTAKE_KNOWN_LINK_FIELDS, DATES_INTAKE_KNOWN_PROHIBITED_CATEGORIES,
  DATES_INTAKE_KNOWN_STATUS_SIGNALS, DATES_INTAKE_KNOWN_TASKS, DATES_INTAKE_REFUSALS, DATES_INTAKE_VOCABULARIES, datesSuggestionConsent, projectDatesIntakeDetail,
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
  // A manually entered event still says so, in both shapes Core serves it (D-143): with the selector (`intake: null`,
  // the genuine admin-external-detail-manual) and without it (no `intake` key at all - the released P1 body).
  const withSelector = fixture("admin-external-detail-manual");
  const without = JSON.parse(readFileSync(new URL("./fixtures/dates_external_admin_wire/admin-detail-admin.json", import.meta.url), "utf8"));
  assert.equal(withSelector.event.intake, null); assert.equal(Object.hasOwn(without.event, "intake"), false);
  for (const manual of [withSelector, without]) {
    const html = render("en", createElement(DatesExternalProvenance, { event: decodeDatesExternalDetail(manual, manual.event.external_event_id)!.event }));
    assert.ok(html.includes(escaped(messagesOf("en").datesAdmin.external.provenance.noAi)) && html.includes(escaped(messagesOf("en").datesAdmin.external.provenance.venuePin)));
    assert.equal(html.includes(messagesOf("en").datesAdmin.external.aiBadge), false);
    // ...and has no intake to link to.
    assert.doesNotMatch(html, /\/dates\/intakes\//);
    assert.equal(html.includes(escaped(messagesOf("en").datesAdmin.external.provenance.intake)), false);
  }
  // An AI-assisted event as a request WITHOUT the selector is served it (the genuine `-released-console` body): the
  // label is there, the reference is not - the panel says AI-assisted and offers no link back.
  const unlinked = fixture("admin-external-detail-released-console");
  assert.equal(unlinked.event.ai_assisted, true); assert.equal(Object.hasOwn(unlinked.event, "intake"), false);
  const bare = render("en", createElement(DatesExternalProvenance, { event: decodeDatesExternalDetail(unlinked, unlinked.event.external_event_id)!.event }));
  assert.ok(bare.includes(escaped(messagesOf("en").datesAdmin.external.provenance.aiAssisted))); assert.doesNotMatch(bare, /\/dates\/intakes\//);
  // The badge is on the external list row, the editor page header, the activity detail and the Activities list.
  assert.match(readFileSync(new URL("../app/(dashboard)/dates/external/page.tsx", import.meta.url), "utf8"),
    /<span className="badge badge-demo">\{t\("badge"\)\}<\/span>\{row\.ai_assisted && <span className="badge badge-warning">\{t\("aiBadge"\)\}<\/span>\}/);
  // The genuine list with an AI-assisted row decodes with the flag the badge reads; every row of the manual lists has it false.
  const assistedList = fixture("admin-external-list-ai-assisted");
  assert.deepEqual(decodeDatesExternalList(assistedList, { page: 1, limit: 40 })!.events.map((row) => row.ai_assisted), [true]);
  // A manual event's row with the selector says `false` (genuine admin-external-list-manual); without the selector the
  // row carries no label at all (the released P1 list) - either way the badge, which asks for `true`, is not drawn.
  const manualList = fixture("admin-external-list-manual");
  assert.ok(decodeDatesExternalList(manualList, { page: manualList.page, limit: manualList.limit })!.events.every((row) => row.ai_assisted === false));
  const releasedList = JSON.parse(readFileSync(new URL("./fixtures/dates_external_admin_wire/admin-list-admin.json", import.meta.url), "utf8"));
  assert.ok(decodeDatesExternalList(releasedList, { page: releasedList.page, limit: releasedList.limit })!.events.every((row) => row.ai_assisted === undefined));
  // ... and the same AI-assisted row, read without the selector, has no label: the released console never drew the badge.
  const unlabelled = fixture("admin-external-list-released-console");
  assert.deepEqual(decodeDatesExternalList(unlabelled, { page: unlabelled.page, limit: unlabelled.limit })!.events.map((row) => row.ai_assisted), [undefined]);
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
  // Every vocabulary of the manifest but `category` (the P1 table), `lease_action` (button labels) and `consent_text_status`
  // (the configuration page's, below) has its own group.
  assert.deepEqual(Object.keys(DATES_INTAKE_VOCABULARIES).filter((name) => !Object.hasOwn(GROUPS, name)).sort(), ["category", "consent_text_status", "lease_action"]);
  for (const locale of LOCALES) {
    const consent = messagesOf(locale).datesAdmin.configuration.suggestionConsent;
    for (const status of DATES_INTAKE_VOCABULARIES.consent_text_status) { assert.ok(consent[status].length > 20, status); assert.ok(consent[`${status}Title`].length > 5, status); }
    assert.ok(consent.unreadable.length > 20);
  }
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

// ---------------------------------------------------------------- T-886: the member-intake side

const MEMBER_DETAILS = DETAILS.filter((name) => name.startsWith("admin-detail-member-"));
const text = (template: string, values: Record<string, string | number> = {}) => Object.entries(values).reduce((made, [key, value]) => made.replaceAll(`{${key}}`, String(value)), template);

test("T-886: the member's side renders for every genuine suggestion exactly what Core serves - and nothing of the member beyond it", async () => {
  const { default: DatesIntakeMemberPanel } = await import("../components/DatesIntakeMemberPanel.tsx");
  assert.equal(MEMBER_DETAILS.length, 14);
  for (const name of MEMBER_DETAILS) for (const locale of LOCALES) {
    const body = fixture(name), intake = detail(name), served = body.intake.member, copy = messagesOf(locale).datesAdmin.intake, member = copy.member;
    const html = render(locale, createElement(DatesIntakeMemberPanel, { intake }));
    const label = `${name} ${locale}`;
    assert.ok(html.includes(escaped(member.title)), label);
    // Who: a member number as served, or the erased account - no name, no address, no link to a profile.
    assert.ok(html.includes(escaped(served.submitter_uid === null ? member.erased : text(member.submitterValue, { uid: served.submitter_uid }))), label);
    assert.doesNotMatch(html, /<a[ >]|href=|<img/, `${label}: no link and no image`);
    // The one address that can appear is the reviewer's who made the first decision, as Core serves it - never a member's.
    assert.deepEqual(html.match(/[\w.+-]+@[\w.-]+/g) ?? [], served.re_review?.first_decision ? [served.re_review.first_decision.by] : [], label);
    // The only numbers of a member on the panel are the served ones.
    for (const uid of html.match(/\b19\d{3}\b/g) ?? []) assert.equal(Number(uid), served.submitter_uid, label);
    // What they chose.
    assert.ok(html.includes(escaped(served.submitter_uid === null ? member.creditErased : served.anonymous ? member.anonymous : member.named)), label);
    assert.ok(html.includes(escaped(served.auto_going ? member.goingYes : member.goingNo)), label);
    assert.ok(html.includes(escaped(served.consent_version === null ? member.consentNone : text(member.consentVersion, { version: served.consent_version }))), label);
    // Where their look at the draft stands, in words; what a reviewer asked, with the note as text.
    if (served.confirmation === null) assert.ok(html.includes(escaped(member.confirmationNone)), label);
    else {
      assert.ok(html.includes(`<span class="badge">${escaped(copy.memberConfirmationValues[served.confirmation.state])}</span>`), label);
      assert.equal(html.includes(escaped(member.askedByReviewer)), served.confirmation.asked_by_reviewer, label);
      for (const field of served.confirmation.fields) assert.ok(html.includes(escaped(copy.memberFieldValues[field])), `${label} ${field}`);
      if (served.confirmation.note !== null) assert.ok(html.includes(`<blockquote class="preserve-whitespace">${escaped(served.confirmation.note)}</blockquote>`), label);
    }
    // The diff: every change, old and new value, as text.
    if (served.corrections.length === 0) assert.ok(html.includes(escaped(member.correctionsNone)), label);
    else {
      assert.equal(html.includes(escaped(member.correctionsNone)), false, label);
      assert.equal((html.match(/<tr>/g) ?? []).length, served.corrections.length + 1, label);
      for (const row of served.corrections) for (const value of [row.from, row.to]) assert.ok(html.includes(escaped(String(value))), `${label}: ${value}`);
    }
    // The second look, with the first decision and the member's own words.
    if (served.re_review === null) assert.ok(html.includes(escaped(member.secondLookNone)), label);
    else {
      assert.ok(html.includes(`<blockquote class="preserve-whitespace">${escaped(served.re_review.note)}</blockquote>`), label);
      assert.ok(html.includes(escaped(copy.decisionValues[served.re_review.first_decision.action])) && html.includes(escaped(copy.rejectReasons[served.re_review.first_decision.reason_code])), label);
      assert.ok(html.includes(escaped(served.re_review.decided_at === null ? member.secondLookWaiting : member.secondDecision)), label);
    }
    // Standing: the strikes as served, and a ban said as a ban.
    if (served.standing === null) assert.ok(html.includes(escaped(member.standingNone)), label);
    else {
      assert.ok(html.includes(escaped(text(member.strikes, { strikes: served.standing.strikes, limit: served.standing.strike_limit }))), label);
      assert.equal(html.includes(escaped(member.notBanned)), served.standing.banned_until === null, label);
      assert.equal(/<strong>[^<]*<\/strong>/.test(html), served.standing.banned_until !== null, label);
    }
    assert.equal(html.includes(escaped(member.partUnreadable)), false, label); assert.equal(html.includes(escaped(member.unreadable)), false, label);
    assert.doesNotMatch(html, RETIRED_BRAND);
  }
  // An operator's draft has no member's side at all.
  for (const locale of LOCALES) assert.equal(render(locale, createElement(DatesIntakeMemberPanel, { intake: detail("admin-detail-in-review-official") })), "");
});

test("T-886: the member's own words are plain text, and a part that cannot be read is said to be unreadable - never shown as none", async () => {
  const { default: DatesIntakeMemberPanel } = await import("../components/DatesIntakeMemberPanel.tsx");
  const genuine = fixture("admin-detail-member-re-review");
  const hostile = "<script>alert(1)</script> <a href=\"https://evil.example/\">https://evil.example/</a> <img src=x onerror=alert(1)>";
  const made = (change: (member: any) => void) => { const body = JSON.parse(JSON.stringify(genuine)); change(body.intake.member); return projectDatesIntakeDetail(body, body.intake.intake_id)!.intake; };
  for (const locale of LOCALES) {
    const member = messagesOf(locale).datesAdmin.intake.member;
    // Member-supplied text in every place it can appear: the note of a second look, a corrected value, the reviewer's note.
    const html = render(locale, createElement(DatesIntakeMemberPanel, { intake: made((block) => {
      block.re_review.note = hostile; block.corrections = [{ index: 0, field: "title", from: hostile, to: `${hostile}!` }, { index: 1, field: "is_free", from: false, to: true },
        { index: 0, field: "price_text", from: null, to: "" }];
      block.confirmation = { ...block.confirmation, state: "awaiting", due_at: 1790259200, asked_by_reviewer: true, fields: ["title"], note: hostile };
    }) }));
    assert.equal((html.match(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/g) ?? []).length, 4, "the note, two values and the reviewer's note - all escaped");
    // No tag and no attribute came of it: what looks like markup is escaped text.
    assert.doesNotMatch(html, /<script|<a[ >]|<img|href="|onerror="|src="/); assert.equal(html.includes("<script>"), false);
    assert.ok(html.includes("&lt;a href=&quot;https://evil.example/&quot;&gt;https://evil.example/&lt;/a&gt;"));
    // A boolean reads Yes / No, an empty or absent value reads "(empty)".
    assert.ok(html.includes(`<td>${escaped(member.no)}</td><td>${escaped(member.yes)}</td>`));
    assert.equal((html.match(new RegExp(`<em>${escaped(member.empty).replace(/[()]/g, "\\$&")}</em>`, "g")) ?? []).length, 2);
    // Each part, unreadable: the page says so in that place and does not print the word for "none".
    const NONE: Record<string, string> = { confirmation: member.confirmationNone, corrections: member.correctionsNone, re_review: member.secondLookNone, standing: member.standingNone };
    for (const [part, value] of [["confirmation", { state: "sleeping" }], ["corrections", "none"], ["re_review", { requested_at: "yesterday" }], ["standing", { strikes: -1 }]] as const) {
      const intake = made((block) => { block[part] = value; });
      assert.deepEqual(intake.member!.unreadable, [part]); assert.equal(intake.member!.can_ask, false, "nobody is asked on a block that could not be read whole");
      const broken = render(locale, createElement(DatesIntakeMemberPanel, { intake }));
      assert.equal((broken.match(new RegExp(escaped(member.partUnreadable), "g")) ?? []).length, 1, `${locale} ${part}`);
      assert.equal(broken.includes(escaped(NONE[part])), false, `${locale} ${part}: unknown is not none`);
    }
    // One change that cannot be read is counted beside the ones that can; the rest of the diff is still shown.
    const partly = made((block) => { block.corrections = [{ index: 0, field: "title", from: "A", to: "B" }, { index: 0, field: "password", from: "x", to: "y" }, { index: 0, field: "venue_city" }]; });
    assert.deepEqual(partly.member!.unreadable, []); assert.equal(partly.member!.corrections.items.length, 1); assert.equal(partly.member!.corrections.unreadable.length, 2);
    const some = render(locale, createElement(DatesIntakeMemberPanel, { intake: partly }));
    assert.ok(some.includes(escaped(text(member.correctionsUnreadable, { count: 2 })))); assert.equal(some.includes(escaped(member.correctionsNone)), false);
    // The block itself untrustworthy (or missing on a suggestion): the whole side is unreadable, never "no member".
    for (const change of [(block: any) => { block.submitter_uid = "19602"; }, (block: any) => { delete block.anonymous; }, (block: any) => { delete block.can_ask; }]) {
      const intake = made(change);
      assert.equal(intake.member, null); assert.ok(intake.unreadable_sections.includes("member"));
      const whole = render(locale, createElement(DatesIntakeMemberPanel, { intake }));
      assert.ok(whole.includes(escaped(member.unreadable))); assert.doesNotMatch(whole, /19602/);
    }
    // D-143: a key Core might add to the block - or to a part of it - is tolerated, and it goes nowhere: the member's
    // side is built from the named fields, so nothing of the member beyond the contract is kept or shown.
    const widened = made((block) => { block.email = "member@example.test"; block.display_name = "Kovács Anna"; block.standing.reason = "three fakes";
      block.confirmation.device = "iPhone"; block.re_review.ip = "203.0.113.9"; });
    assert.deepEqual(widened.member!.unreadable, []); assert.equal(widened.unreadable_sections.includes("member"), false);
    assert.deepEqual(Object.keys(widened.member!).sort(), ["anonymous", "auto_going", "can_ask", "confirmation", "consent_version", "corrections", "re_review", "standing",
      "submitter_uid", "unreadable"]);
    assert.doesNotMatch(JSON.stringify(widened.member), /member@example\.test|Kovács Anna|three fakes|iPhone|203\.0\.113\.9/, "not kept in the block or in any part of it");
    const kept = render(locale, createElement(DatesIntakeMemberPanel, { intake: widened }));
    assert.doesNotMatch(kept, /member@example\.test|Kovács Anna|three fakes|iPhone|203\.0\.113\.9/);
    assert.ok(kept.includes(escaped(text(member.submitterValue, { uid: 19602 }))));
    const missing = JSON.parse(JSON.stringify(genuine)); missing.intake.member = null;
    const without = projectDatesIntakeDetail(missing, missing.intake.intake_id)!.intake;
    assert.ok(without.unreadable_sections.includes("member"), "a suggestion without its member block");
    assert.ok(render(locale, createElement(DatesIntakeMemberPanel, { intake: without })).includes(escaped(member.unreadable)));
    // An operator's draft that carries a member block is unreadable in that part too - not silently a suggestion.
    const draft = fixture("admin-detail-in-review-official"); draft.intake.member = genuine.intake.member;
    const odd = projectDatesIntakeDetail(draft, draft.intake.intake_id)!.intake;
    assert.equal(odd.member, null); assert.ok(render(locale, createElement(DatesIntakeMemberPanel, { intake: odd })).includes(escaped(member.unreadable)));
  }
});

test("T-886: before a rejection or a publication the reviewer is told what it means for the member, from Core's figures", async () => {
  const { DatesIntakeMemberRejectNotes, DatesIntakeMemberPublishNotes, datesIntakeSecondLookOpen, datesIntakeSecondLookStrike } = await import("../components/DatesIntakeMemberPanel.tsx");
  for (const locale of LOCALES) {
    const copy = messagesOf(locale).datesAdmin.intake, reject = copy.reject, editor = copy.editor;
    const notes = (name: string, reasonCode: string, namesEvent = false, change?: (intake: any) => void) => { const intake = detail(name); change?.(intake);
      return render(locale, createElement(DatesIntakeMemberRejectNotes, { intake, reasonCode, namesEvent })); };
    // An operator's draft: nothing about a member.
    assert.equal(notes("admin-detail-in-review-official", "spam_or_fake"), "");
    // A strike is said with the member's figures as served: 0 of 3 for the suggestion in review.
    const strike = notes("admin-detail-member-in-review", "spam_or_fake");
    assert.ok(strike.includes(escaped(text(reject.strike, { strikes: 0, limit: 3 }))) && strike.includes(escaped(reject.memberStatement)));
    // Any other reason is no strike; a named duplicate is no strike either and says what the member is told instead.
    for (const reason of ["duplicate", "not_an_event", "unverifiable", "outside_area"]) assert.doesNotMatch(notes("admin-detail-member-in-review", reason), /alert-warning/, reason);
    const named = notes("admin-detail-member-in-review", "duplicate", true);
    assert.ok(named.includes(escaped(reject.memberDuplicate))); assert.equal(named.includes(escaped(reject.memberStatement)), false); assert.doesNotMatch(named, /alert-warning/);
    // The second look (review finding of opus-review-p2, LOW). The genuine body: the first decision rejected it as
    // spam_or_fake, a strike Core counts per suggestion from its current decision. Rejecting as spam again keeps that one
    // strike and adds none - so the line about a NEW strike is not shown; rejecting again is final either way.
    const second = notes("admin-detail-member-re-review", "spam_or_fake");
    assert.ok(second.includes(escaped(reject.secondLookStrikeKept)) && second.includes(escaped(reject.secondLook)));
    assert.equal(second.includes(escaped(text(reject.strike, { strikes: 2, limit: 3 }))), false, "no new strike is announced");
    assert.equal(second.includes(escaped(reject.secondLookStrikeTakenBack)), false);
    // Another reason takes that strike back, and can end the ban it caused (Core: DatesEventIntakeAdminService `wasStrike`).
    for (const reason of ["not_an_event", "duplicate", "unverifiable"]) {
      const other = notes("admin-detail-member-re-review", reason);
      assert.ok(other.includes(escaped(reject.secondLookStrikeTakenBack)) && other.includes(escaped(reject.secondLook)), reason);
      assert.equal(other.includes(escaped(reject.secondLookStrikeKept)), false, reason);
    }
    // DERIVED: a second look whose first decision was no strike says nothing about strikes beyond the usual line.
    const noStrike = (intake: any) => { intake.member.re_review.first_decision.reason_code = "not_an_event"; };
    const plainSecond = notes("admin-detail-member-re-review", "spam_or_fake", false, noStrike);
    assert.ok(plainSecond.includes(escaped(text(reject.strike, { strikes: 2, limit: 3 })))); assert.equal(plainSecond.includes(escaped(reject.secondLookStrikeKept)), false);
    assert.equal(notes("admin-detail-member-re-review", "not_an_event", false, noStrike).includes(escaped(reject.secondLookStrikeTakenBack)), false);
    // ... nor once the second decision is on record, nor on a suggestion that is not on a second look.
    const decided = (intake: any) => { intake.member.re_review.decided_at = 1790000000; intake.second_look = false; };
    assert.equal(notes("admin-detail-member-re-review", "not_an_event", false, decided).includes(escaped(reject.secondLookStrikeTakenBack)), false);
    assert.equal(notes("admin-detail-member-in-review", "spam_or_fake").includes(escaped(reject.secondLook)), false);
    assert.deepEqual([datesIntakeSecondLookStrike(detail("admin-detail-member-re-review")), datesIntakeSecondLookStrike(detail("admin-detail-member-in-review"))], [true, false]);
    // A standing the console could not read is said to be unknown; an erased account is a strike against nobody.
    assert.ok(notes("admin-detail-member-in-review", "spam_or_fake", false, (intake) => { intake.member.unreadable = ["standing"]; intake.member.standing = null; }).includes(escaped(reject.strikeUnknown)));
    assert.ok(notes("admin-detail-member-in-review", "spam_or_fake", false, (intake) => { intake.member = null; }).includes(escaped(reject.strikeUnknown)));
    assert.ok(notes("admin-detail-member-in-review", "spam_or_fake", false, (intake) => { intake.member.standing = null; intake.member.submitter_uid = null; }).includes(escaped(reject.strikeNobody)));
    // Publishing: credit by number, or no name; "going" only where Core would join them.
    const publish = (member: any, events = 1, secondLookStrike = false) => render(locale, createElement(DatesIntakeMemberPublishNotes, { member, events, secondLookStrike }));
    const credited = detail("admin-detail-member-in-review").member!, anonymous = detail("admin-detail-member-re-review").member!, erased = detail("admin-detail-member-erased").member!;
    assert.deepEqual([credited.anonymous, credited.auto_going, anonymous.anonymous, anonymous.auto_going, erased.submitter_uid], [false, true, true, false, null]);
    const first = publish(credited);
    assert.ok(first.includes(escaped(text(editor.memberCredit, { uid: 19601 }))) && first.includes(escaped(editor.memberGoing)));
    assert.ok(publish(credited, 3).includes(escaped(editor.memberGoingProgramme))); assert.equal(publish(credited, 3).includes(escaped(editor.memberGoing)), false);
    const hidden = publish(anonymous);
    assert.ok(hidden.includes(escaped(editor.memberAnonymous))); assert.doesNotMatch(hidden, /19602/, "an anonymous member's number is not repeated in the confirmation");
    assert.equal(hidden.includes(escaped(editor.memberGoing)), false);
    assert.ok(publish(erased).includes(escaped(editor.memberErased)));
    // Publishing after a second look whose first decision counted a strike takes it back (Core: DatesExternalEventPublisher).
    const takenBack = publish(anonymous, 1, datesIntakeSecondLookStrike(detail("admin-detail-member-re-review")));
    assert.ok(takenBack.includes(escaped(editor.memberSecondLookStrikeTakenBack)));
    assert.equal(publish(credited).includes(escaped(editor.memberSecondLookStrikeTakenBack)), false);
    assert.ok(publish(null).includes(escaped(editor.memberUnreadable)));
  }
  // The second look is open exactly while the member has asked and no second decision is on record.
  assert.deepEqual(Object.fromEntries(MEMBER_DETAILS.map((name) => [name.replace("admin-detail-member-", ""), datesIntakeSecondLookOpen(detail(name))]).filter(([, open]) => open)), { "re-review": true });
  // DERIVED: decided - Core's mark is gone and the block carries the second decision.
  const decided = detail("admin-detail-member-re-review"); decided.member!.re_review!.decided_at = 1790000000; decided.second_look = false;
  assert.equal(datesIntakeSecondLookOpen(decided), false);
  // DERIVED: either source says it. Core's mark alone (the member block could not be read) ...
  const markOnly = detail("admin-detail-member-re-review"); markOnly.member = null;
  assert.equal(markOnly.second_look, true); assert.equal(datesIntakeSecondLookOpen(markOnly), true);
  // ... and the member block alone (a Core that does not serve the mark).
  const blockOnly = detail("admin-detail-member-re-review"); blockOnly.second_look = false;
  assert.equal(datesIntakeSecondLookOpen(blockOnly), true);
  const neither = detail("admin-detail-member-in-review"); assert.equal(datesIntakeSecondLookOpen(neither), false);
});

test("T-886: the ask form offers the eight editable fields and says why it is closed", async () => {
  const { DatesIntakeAskSection } = await import("../components/DatesIntakeMemberPanel.tsx");
  const noop = () => undefined;
  for (const locale of LOCALES) {
    const copy = messagesOf(locale).datesAdmin.intake, ask = copy.ask;
    const section = (state: unknown, retry = false) => render(locale, createElement(DatesIntakeAskSection, { state: state as never, busy: false, retry, onChanged: noop, onReview: noop, onRetry: noop }));
    assert.equal(section({ offered: false }), "");
    const open = section({ offered: true, allowed: true });
    assert.equal((open.match(/type="checkbox"/g) ?? []).length, 8);
    for (const field of DATES_INTAKE_VOCABULARIES.member_editable_field) assert.ok(open.includes(`<span>${escaped(copy.memberFieldValues[field])}</span>`), field);
    assert.ok(open.includes(escaped(ask.copy)) && open.includes(escaped(text(ask.noteHint, { maximum: 500 }))) && open.includes(escaped(ask.reasonHint)));
    assert.match(open, /<fieldset class="dates-external-fields">/, "open");
    // Nothing is chosen at first, so nothing can be reviewed yet; the retry button is there only for an unanswered request.
    assert.match(open, /<button type="submit" class="button button-primary" disabled="">/);
    assert.equal(open.includes(escaped(ask.retry)), false); assert.ok(section({ offered: true, allowed: true }, true).includes(escaped(ask.retry)));
    for (const why of ["unreadable", "notAskable", "switchOff", "holdFirst"]) {
      const closed = section({ offered: true, allowed: false, why });
      assert.ok(closed.includes(escaped(ask.why[why])), why); assert.match(closed, /<fieldset class="dates-external-fields" disabled="">/, why);
      assert.equal(/alert-error/.test(closed), why === "unreadable", why);
    }
    assert.deepEqual(Object.keys(ask.why).sort(), ["holdFirst", "notAskable", "switchOff", "unreadable"]);
    // The words say who reads what.
    assert.match(ask.noteHint, locale === "en" ? /The member reads this/ : /Ezt a tag olvassa/); assert.match(ask.reasonHint, locale === "en" ? /never shown to the member/ : /a tag soha nem látja/);
  }
});

test("T-886: an event that came from a member's suggestion says who is credited, and one Core published by itself says nobody confirmed it", () => {
  const credit = fixture("admin-external-detail-member-credit"), auto = fixture("admin-external-detail-auto-published");
  const credited = decodeDatesExternalDetail(credit, credit.event.external_event_id)!.event, alone = decodeDatesExternalDetail(auto, auto.event.external_event_id)!.event;
  for (const locale of LOCALES) {
    const copy = messagesOf(locale).datesAdmin.external, channels = messagesOf(locale).datesAdmin.intake.channelValues;
    const reviewed = render(locale, createElement(DatesExternalProvenance, { event: credited }));
    assert.ok(reviewed.includes(escaped(text(copy.provenance.member, { uid: 19601 }))) && reviewed.includes(escaped(channels.member_suggestion)));
    assert.ok(reviewed.includes(escaped(copy.tierValues.admin))); assert.equal(reviewed.includes(escaped(copy.provenance.unconfirmed)), false);
    assert.equal(reviewed.includes(escaped(copy.provenance.partlyConfirmed)), false);
    const unreviewed = render(locale, createElement(DatesExternalProvenance, { event: alone }));
    assert.ok(unreviewed.includes(escaped(copy.provenance.unconfirmed)) && unreviewed.includes(escaped(copy.tierValues.single_source)));
    assert.ok(unreviewed.includes(escaped(text(copy.provenance.member, { uid: 19604 }))));
    // DERIVED: three of four confirmations - said as incomplete, not as "published without a reviewer".
    const partly = { ...credited, verification: { ...credited.verification, admin_confirmations: { ...credited.verification.admin_confirmations, timezone: false } } };
    const some = render(locale, createElement(DatesExternalProvenance, { event: partly }));
    assert.ok(some.includes(escaped(copy.provenance.partlyConfirmed))); assert.equal(some.includes(escaped(copy.provenance.unconfirmed)), false);
    // D-143: the four confirmations are counted by name; a key Core might add beside them is not a fifth confirmation.
    const widened = { ...alone, verification: { ...alone.verification, admin_confirmations: { ...alone.verification.admin_confirmations, reviewed: true } } };
    assert.ok(render(locale, createElement(DatesExternalProvenance, { event: widened as typeof alone })).includes(escaped(copy.provenance.unconfirmed)));
    // The P1 event entered by an administrator is unchanged: no such line.
    const p1 = fixture("admin-external-detail-ai-assisted"), manual = decodeDatesExternalDetail(p1, p1.event.external_event_id)!.event;
    assert.doesNotMatch(render(locale, createElement(DatesExternalProvenance, { event: manual })), /alert-warning" role="status"/);
  }
});

test("the state of the consent text is said beside the member switch: draft and approved as states, missing as a problem", () => {
  const page = readFileSync(new URL("../app/(dashboard)/dates/configuration/page.tsx", import.meta.url), "utf8");
  // Read from the configuration body the page loaded, and drawn directly under the switch that opens the member channel.
  assert.match(page, /setConsent\(datesSuggestionConsent\(configuration\)\);/);
  assert.match(page, /const DATES_SUGGESTIONS_SWITCH = "dates_external_suggestions_enabled";/);
  assert.match(page, /\.\.\.\(setting\.key === DATES_SUGGESTIONS_SWITCH \? \[<DatesSuggestionConsentStatus key="suggestion-consent" consent=\{consent\} \/>\] : \[\]\)/);
  for (const locale of LOCALES) {
    const copy = messagesOf(locale).datesAdmin.configuration.suggestionConsent;
    // The genuine body: version 1, a draft - a state, said as a warning the operator decides with; not an error.
    const draft = render(locale, createElement(DatesSuggestionConsentStatus, { consent: datesSuggestionConsent(fixture("admin-configuration")) }));
    assert.ok(draft.includes(escaped(copy.draftTitle)) && draft.includes(escaped(copy.draft.replace("{version}", "1"))), locale);
    assert.match(draft, /^<p class="alert alert-warning" role="status">/);
    const approved = render(locale, createElement(DatesSuggestionConsentStatus, { consent: { kind: "known", required_version: 3, text_status: "approved" } }));
    assert.ok(approved.includes(escaped(copy.approvedTitle)) && approved.includes(escaped(copy.approved.replace("{version}", "3"))), locale);
    assert.match(approved, /^<p class="alert alert-info" role="status">/);
    // Missing: the member channel is closed whatever the switch says - an alert, and it says so.
    const missing = render(locale, createElement(DatesSuggestionConsentStatus, { consent: { kind: "known", required_version: 2, text_status: "missing" } }));
    assert.match(missing, /^<p class="alert alert-error" role="alert">/);
    assert.ok(missing.includes(escaped(copy.missingTitle)) && missing.includes(escaped(copy.missing.replace("{version}", "2"))), locale);
    assert.equal(missing.includes(escaped(copy.approvedTitle)) || missing.includes(escaped(copy.draftTitle)), false);
    // Unreadable is said, and is neither of the three; a Core that does not serve the block (no selector) draws nothing.
    const unreadable = render(locale, createElement(DatesSuggestionConsentStatus, { consent: datesSuggestionConsent({ event_suggestion_consent: { required_version: 1, text_status: "pending" } }) }));
    assert.match(unreadable, /^<p class="alert alert-error" role="status">/); assert.ok(unreadable.includes(escaped(copy.unreadable)));
    for (const key of ["draftTitle", "approvedTitle", "missingTitle"]) assert.equal(unreadable.includes(escaped(copy[key])), false, key);
    assert.equal(render(locale, createElement(DatesSuggestionConsentStatus, { consent: datesSuggestionConsent(fixture("admin-configuration-released-console")) })), "");
  }
  assert.match(messagesOf("en").datesAdmin.configuration.suggestionConsent.missingTitle, /closed/);
  assert.match(messagesOf("en").datesAdmin.configuration.consentVersionNoText, /no text yet/);
});

test("T-886: the queue filters by channel and says when the member channel is switched off", () => {
  const queue = readFileSync(new URL("../app/(dashboard)/dates/intakes/page.tsx", import.meta.url), "utf8");
  assert.match(queue, /readDatesIntakeQueue\(adminCall, \{ status, channel, page, limit: PAGE_SIZE, \.\.\.\(secondLook === "" \? \{\} : \{ second_look: secondLook === "only" \}\) \}, signal\)/);
  assert.match(queue, /\}, \[status, channel, secondLook, page\]\);/);
  // The second look (Core b5b2b299): a filter, the count of those waiting with the way to them, a badge on the row.
  assert.match(queue, /<select value=\{secondLook\} onChange=\{\(event\) => \{ setPage\(1\); setSecondLook\(event\.target\.value as "" \| "only" \| "without"\); \}\}>/);
  assert.match(queue, /\{queue\.second_look_count !== null && queue\.second_look_count > 0 && secondLook !== "only" && <p className="alert alert-warning" role="status">/);
  assert.match(queue, /\{row\.second_look && <> <span className="badge badge-warning">\{t\("queue\.secondLookBadge"\)\}<\/span><\/>\}/);
  assert.match(queue, /t\(secondLook === "only" \? "queue\.orderSecondLook" : status === "in_review" \? "queue\.orderReview" : "queue\.orderNewest"\)/);
  assert.match(queue, /<select value=\{channel\} onChange=\{\(event\) => \{ setPage\(1\); setChannel\(event\.target\.value\); \}\}>/);
  assert.match(queue, /\{DATES_INTAKE_QUEUE_CHANNELS\.map\(\(value\) => <option key=\{value\} value=\{value\}>\{t\(`channelValues\.\$\{value\}`\)\}<\/option>\)\}/);
  assert.match(queue, /\{!queue\.suggestions_enabled && <p className="alert alert-info">\{t\("queue\.suggestionsOff"\)\}<\/p>\}/);
  assert.match(queue, /draftsEnabled: queue\?\.drafts_enabled === true, suggestionsEnabled: queue\?\.suggestions_enabled === true \};/);
  for (const locale of LOCALES) {
    const copy = messagesOf(locale).datesAdmin.intake;
    for (const key of ["channelFilter", "channelAll", "suggestionsOff", "secondLookFilter", "secondLookAll", "secondLookOnly", "secondLookWithout", "secondLookBadge",
      "secondLooksWaiting", "secondLooksShow", "orderSecondLook"]) assert.ok(copy.queue[key].length > 5, key);
    assert.match(copy.queue.secondLooksWaiting, /\{count\}/);
    assert.match(copy.queue.suggestionsOff, /dates_external_suggestions_enabled/); assert.match(copy.detail.suggestionsOff, /dates_external_suggestions_enabled/);
    // Every statement of the member panel, the ask form and the notes exists in both languages (the key trees are compared elsewhere).
    assert.ok(Object.keys(copy.member).length >= 40 && Object.keys(copy.ask).length >= 15);
  }
});
