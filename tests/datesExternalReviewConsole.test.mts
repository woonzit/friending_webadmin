import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { DatesExternalCorrectionView } from "../components/DatesExternalCorrectionView.tsx";
import DatesExternalEventForm from "../components/DatesExternalEventForm.tsx";
import DatesExternalProvenance from "../components/DatesExternalProvenance.tsx";
import DatesExternalRecheckPanel, { DATES_EXTERNAL_RECHECK_REASONS } from "../components/DatesExternalRecheckPanel.tsx";
import DatesExternalReviewMark from "../components/DatesExternalReviewMark.tsx";
import DatesSystemClosureNote from "../components/DatesSystemClosure.tsx";
import { DATES_EXTERNAL_CORRECTION_REJECT_REASONS, datesExternalCorrections, decodeDatesExternalDetail } from "../lib/datesExternalAdmin.ts";
import { DATES_EXTERNAL_REVIEW_REFUSALS } from "../lib/datesExternalReview.ts";
import { DATES_RESEARCH_GATE_BLOCKERS } from "../lib/datesSystemClosure.ts";

// D-149 (T-908): the console side - static renders of the real components in both locales (no browser, no mounted
// effects) on Core-B's genuine bodies (tests/fixtures/dates_external_review_wire), and page logic held to its source.
const genuine = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/dates_external_review_wire/${name}.json`, import.meta.url), "utf8"));
const XEV = "xev_00000000000000000000000000000001", XEV6 = "xev_00000000000000000000000000000006";
const messages = (locale: string) => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
function render(locale: string, ...children: ReactNode[]) {
  const errors: string[] = [];
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: messages(locale), timeZone: "UTC",
    onError: (error: unknown) => errors.push(String(error)) }, ...children));
  assert.deepEqual(errors, [], `${locale}: all rendered messages resolve`);
  return html;
}
const escaped = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
/** DERIVED, as in tests/datesExternalReview.test.mts: the genuine detail turned into a research event with no organizer and no free/paid status. */
function researchUnknown() {
  const body = genuine("webadmin-external-detail"), event = body.event;
  event.credit_channel = "ai_research"; event.credit = { channel: "ai_research", submitted_by_uid: null, anonymous: true, first_submitter_uid: null };
  event.organizer_name = null; event.organizer.name = null; event.editor_input.organizer.name = null;
  event.facts.is_free = null; event.facts.price_text = null; event.editor_input.is_free = null; event.editor_input.price_text = null;
  return decodeDatesExternalDetail(body, XEV)!;
}

test("every closed value the review workflow shows has words in both languages", () => {
  for (const locale of ["en", "hu"]) {
    const copy = messages(locale).datesAdmin;
    for (const key of [...new Set(Object.values(DATES_EXTERNAL_REVIEW_REFUSALS)), "other"]) assert.ok(copy.external.review.refusals[key]?.length > 10, `${locale} ${key}`);
    for (const code of DATES_EXTERNAL_CORRECTION_REJECT_REASONS) assert.ok(copy.corrections.rejectReasons[code], code);
    for (const code of DATES_RESEARCH_GATE_BLOCKERS) assert.ok(copy.research.closure.blockers[code], code);
    for (const code of DATES_EXTERNAL_RECHECK_REASONS) assert.ok(copy.external.recheck.reasons[code], code);
    for (const key of ["correctionNoChange", "correctionClosed", "correctionApproved", "changedElsewhere"]) assert.ok(copy.external.feedback[key], key);
  }
});

for (const locale of ["en", "hu"]) {
  test(`render ${locale}: the review mark, the re-research history in every state, a correction side by side`, () => {
    const copy = messages(locale).datesAdmin;
    const detail = decodeDatesExternalDetail(genuine("webadmin-external-detail-recheck-failed"), XEV6)!;
    const marked = render(locale, createElement(DatesExternalReviewMark, { target: detail.event, review: { reviewed: true, by: "admin@example.test", at: 1790000000 }, canManage: true, onSettled: () => undefined }));
    assert.ok(marked.includes(escaped(copy.external.review.reviewed))); assert.ok(marked.includes(escaped(copy.external.review.clear)));
    const unmarked = render(locale, createElement(DatesExternalReviewMark, { target: detail.event, review: detail.event.admin_review!, canManage: true, onSettled: () => undefined }));
    assert.ok(unmarked.includes(escaped(copy.external.review.notReviewed))); assert.match(unmarked, /<button[^>]*>[^<]*<\/button>/);
    assert.equal(render(locale, createElement(DatesExternalReviewMark, { target: detail.event, review: detail.event.admin_review!, canManage: false, onSettled: () => undefined })).includes("<button"),
      false, "no control without the manage capability");
    const panel = render(locale, createElement(DatesExternalRecheckPanel, { event: detail.event, serverNow: detail.server_now, actor: "admin@example.test", canManage: true, onFactsChanged: () => undefined }));
    for (const text of [copy.external.recheck.title, copy.external.recheck.statuses.failed, copy.external.recheck.statuses.no_change, copy.external.recheck.statuses.applied,
      copy.external.recheck.reasons.no_page, copy.external.recheck.reasons.same_facts, "Check the start time on the organizer's own page."]) assert.ok(panel.includes(escaped(text)), text);
    // The applied job moved the start: epoch seconds shown in the event's own zone (Europe/Budapest).
    const job = detail.event.rechecks!.find((item: any) => item.status === "applied") as any;
    const zone = (seconds: number) => new Intl.DateTimeFormat(locale, { timeZone: detail.event.timezone, dateStyle: "medium", timeStyle: "short" }).format(seconds * 1000);
    assert.ok(panel.includes(escaped(zone(job.changes[0].before)))); assert.ok(panel.includes(escaped(zone(job.changes[0].after))));
    assert.match(panel, /<button[^>]*disabled=""[^>]*>[^<]*<\/button><\/div>/, "nothing starts before this tab's saved request is read");
    for (const state of ["queued", "running"]) {
      const open = decodeDatesExternalDetail(genuine(`webadmin-external-detail-recheck-${state}`), XEV6)!;
      const html = render(locale, createElement(DatesExternalRecheckPanel, { event: open.event, serverNow: open.server_now, actor: "admin@example.test", canManage: true, onFactsChanged: () => undefined }));
      assert.ok(html.includes(escaped(copy.external.recheck.statuses[state])), state);
    }
    const corrections = datesExternalCorrections(decodeDatesExternalDetail(genuine("webadmin-external-detail"), XEV)!.event, 1790000000)!.rows;
    const view = render(locale, createElement(DatesExternalCorrectionView, { correction: corrections[0] }));
    for (const text of [copy.corrections.fields.title, copy.corrections.fields.starts_local, copy.corrections.fields.venue, "Community jazz concert", "2026-10-31T16:43",
      "Kossuth tér 2, Budapest", "Anna", "The organizer moved it to the other square and starts later."]) assert.ok(view.includes(escaped(text)), text);
    assert.equal(view.includes(escaped(copy.corrections.fields.official_url)), false, "an untouched fact is not listed");
    const status = render(locale, createElement(DatesExternalCorrectionView, { correction: corrections[2], showEvent: false }));
    assert.ok(status.includes(escaped(copy.corrections.statusValues.postponed))); assert.ok(status.includes(escaped(copy.corrections.noEnd)));
    const noteOnly = render(locale, createElement(DatesExternalCorrectionView, { correction: corrections[1], showEvent: false }));
    assert.equal(noteOnly.includes("<table"), false, "a note-only correction has no facts to compare"); assert.ok(noteOnly.includes("Check number 1."));
  });

  test(`render ${locale}: unknown organizer and price, and the system's closure, in words`, () => {
    const copy = messages(locale).datesAdmin;
    const research = researchUnknown();
    const provenance = render(locale, createElement(DatesExternalProvenance, { event: research.event }));
    assert.ok(provenance.includes(escaped(copy.external.provenance.unknownFacts))); assert.ok(provenance.includes(escaped(copy.external.form.organizerName)));
    const form = render(locale, createElement(DatesExternalEventForm, { initial: research.event.editor_input, disabled: false, submitLabel: "Save", onSubmit: () => undefined, unknownAllowed: true }));
    for (const text of [copy.external.form.organizerUnknown, copy.external.form.freeUnknown, copy.external.form.unknownHint]) assert.ok(form.includes(escaped(text)), text);
    assert.match(form, new RegExp(`checked=""[^>]*/><span>${escaped(copy.external.form.organizerUnknown)}`), "the unknown organizer is shown as such");
    const manual = render(locale, createElement(DatesExternalEventForm, { initial: decodeDatesExternalDetail(genuine("webadmin-external-detail"), XEV)!.event.editor_input,
      disabled: false, submitLabel: "Save", onSubmit: () => undefined }));
    assert.equal(manual.includes(escaped(copy.external.form.organizerUnknown)), false, "a manual event offers no unknown");
    const closures = render(locale, createElement(DatesSystemClosureNote, { closure: { decision: "research_not_publishable", blocker: "canceled-or-postponed" } }),
      createElement(DatesSystemClosureNote, { closure: { decision: "duplicate", blocker: "duplicate" } }),
      createElement(DatesSystemClosureNote, { closure: { decision: "research_not_publishable", blocker: "dates-external-ticket-domain-invalid" } }));
    for (const text of [copy.research.closure.notPublishable, copy.research.closure.blockers["canceled-or-postponed"], copy.research.closure.duplicate])
      assert.ok(closures.includes(escaped(text)), text);
    assert.ok(closures.includes("<code>dates-external-ticket-domain-invalid</code>"), "a writer's code is shown as Core wrote it");
  });
}

test("page logic: filters, approvals by edit or by command, unknown facts, change elsewhere", () => {
  const list = readFileSync(new URL("../app/(dashboard)/dates/external/page.tsx", import.meta.url), "utf8");
  assert.match(list, /if \(filters\.reviewed\) body\.reviewed = filters\.reviewed;/);
  assert.match(list, /const RESEARCH_UNREVIEWED: Filters = \{ \.\.\.EMPTY_FILTERS, status: "published", channel: "ai_research", reviewed: "false" \};/);
  assert.match(list, /row\.organizer_name \?\? t\("unknownFact"\)/);
  const editor = readFileSync(new URL("../components/DatesExternalEditorPage.tsx", import.meta.url), "utf8");
  assert.match(editor, /\.\.\.\(externalId && approving \? \{ correction_id: approving\.correction_id \} : \{\}\)/);
  assert.match(editor, /row\.correction_id === correctionId && row\.status === "pending"/);
  // A status-only correction: cancel for "canceled", official update for "postponed", each carrying the correction.
  assert.match(editor, /prefill\.status === "canceled" && <button[^]*?startApproveCommand\("cancel"\)/);
  assert.match(editor, /prefill\.status === "postponed" && <button[^]*?startApproveCommand\("official_update"\)/);
  assert.match(editor, /if \(commandApproves\) body\.correction_id = commandCorrection;/);
  assert.match(editor, /result\.error === "dates-correction-no-change" \? "correctionNoChange"/);
  assert.match(editor, /unknownAllowed=\{externalId !== undefined && event !== undefined && datesExternalUnknownFactsAllowed\(event\)\}/);
  // A change made elsewhere never reloads the form under unsaved work.
  assert.match(editor, /if \(!formDirty\) \{ await load\(\); return; \}/);
  const route = readFileSync(new URL("../app/(dashboard)/dates/external/[externalId]/page.tsx", import.meta.url), "utf8");
  assert.match(route, /\/\^cor_\[a-f0-9\]\{32\}\$\/\.test\(correction\)/);
  const panel = readFileSync(new URL("../components/DatesExternalRecheckPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /if \(!open\) return;/, "the job is polled only while it is open");
  for (const file of ["../app/(dashboard)/dates/intakes/page.tsx", "../components/DatesIntakePanels.tsx", "../components/DatesResearchRuns.tsx"])
    assert.match(readFileSync(new URL(file, import.meta.url), "utf8"), /<DatesSystemClosureNote closure=\{/, file);
});
