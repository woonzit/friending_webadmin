import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { DatesExternalCorrectionView } from "../components/DatesExternalCorrectionView.tsx";
import DatesExternalRecheckPanel, { DATES_EXTERNAL_RECHECK_REASONS } from "../components/DatesExternalRecheckPanel.tsx";
import DatesExternalReviewMark from "../components/DatesExternalReviewMark.tsx";
import DatesResearchBlocker from "../components/DatesResearchBlocker.tsx";
import { DATES_EXTERNAL_CORRECTION_REJECT_REASONS, datesExternalCorrections, decodeDatesExternalDetail } from "../lib/datesExternalAdmin.ts";
import { DATES_EXTERNAL_REVIEW_REFUSALS } from "../lib/datesExternalReview.ts";
import { projectDatesIntakeQueue } from "../lib/datesIntakeAdmin.ts";
import { decodeResearchRunDetail, DATES_RESEARCH_PUBLICATION_BLOCKERS } from "../lib/datesResearchAdmin.ts";

// D-149 (T-908): the console side - static renders of the real components in both locales (no browser, no mounted
// effects), page logic held to its source, and the W5 reads. Bodies are the PROVISIONAL ones of
// tests/fixtures/dates_external_autopub_admin_wire_provisional (see its provenance.txt) or genuine released bodies.
const PROVISIONAL = new URL("./fixtures/dates_external_autopub_admin_wire_provisional/", import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, PROVISIONAL), "utf8"));
const XEV = "xev_00000000000000000000000000000001";

test("every refusal the review workflow words has a sentence in both languages", () => {
  for (const locale of ["en", "hu"]) {
    const words = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")).datesAdmin.external.review.refusals;
    for (const key of [...new Set(Object.values(DATES_EXTERNAL_REVIEW_REFUSALS)), "other"]) assert.ok(typeof words[key] === "string" && words[key].length > 10, `${locale} ${key}`);
  }
});

test("W5: the system's not-publishable decision is read on the intake row and the run candidate, without changing the pinned vocabularies", () => {
  const queue = JSON.parse(readFileSync(new URL("./fixtures/dates_event_intake_admin_wire/admin-list-in-review.json", import.meta.url), "utf8"));
  const row = { ...queue.intakes[0], status: "rejected", status_detail: "research-not-publishable", publication_blocker: "venue_unverified" };
  const read = projectDatesIntakeQueue({ ...queue, intakes: [row] }, { page: queue.page, limit: queue.limit })!;
  assert.equal(read.intakes[0].status_detail, "research-not-publishable"); assert.equal(read.intakes[0].publication_blocker, "venue_unverified");
  assert.deepEqual(read.intakes[0].unreadable_fields, []);
  const odd = projectDatesIntakeQueue({ ...queue, intakes: [{ ...row, publication_blocker: { code: 1 } }] }, { page: queue.page, limit: queue.limit })!;
  assert.deepEqual(odd.intakes[0].unreadable_fields, ["publication_blocker"]); assert.equal(odd.intakes[0].publication_blocker, null);
  assert.equal(Object.hasOwn(projectDatesIntakeQueue(queue, { page: queue.page, limit: queue.limit })!.intakes[0], "publication_blocker"), false, "absent: not served");
  const run = { run_id: "run_1", kind: "area", dry_run: false, trigger: "schedule", source_id: null, area_id: "area_1", status: "completed", found: 2, imported: 2, duplicates: 0,
    dropped: [], cost_micro_usd: 10, started_at: 1789990000, finished_at: 1789990100,
    candidates: [{ title: "A", date_text: "Sat", url_host: "example.test", outcome: "published", reason: null, intake_id: "xin_1" },
      { title: "B", date_text: "Sun", url_host: "example.test", outcome: "not_publishable", reason: null, intake_id: "xin_2", publication_blocker: "time_unverified" }] };
  const detail = decodeResearchRunDetail({ success: true, status_code: 200, run }, "run_1")!;
  assert.deepEqual(detail.candidates!.rows.map((item) => [item.outcome, item.publication_blocker]), [["published", undefined], ["not_publishable", "time_unverified"]]);
});

// ---------------------------------------------------------------- static renders (no browser, no effects)

const messages = (locale: string) => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
function render(locale: string, ...children: ReactNode[]) {
  const errors: string[] = [];
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: messages(locale), timeZone: "UTC",
    onError: (error: unknown) => errors.push(String(error)) }, ...children));
  assert.deepEqual(errors, [], `${locale}: all rendered messages resolve`);
  return html;
}
const escaped = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");

for (const locale of ["en", "hu"]) {
  test(`render ${locale}: the review mark, the re-research history, a correction side by side and the not-publishable reason`, () => {
    const copy = messages(locale).datesAdmin;
    const detail = decodeDatesExternalDetail(fixture("admin-detail-v2"), XEV)!;
    const mark = render(locale, createElement(DatesExternalReviewMark, { target: detail.event, review: detail.event.admin_review!, canManage: true, onSettled: () => undefined }));
    assert.ok(mark.includes(escaped(copy.external.review.reviewed))); assert.ok(mark.includes(escaped(copy.external.review.clear)));
    const unmarked = render(locale, createElement(DatesExternalReviewMark, { target: detail.event, review: { reviewed: false, by: null, at: null }, canManage: true, onSettled: () => undefined }));
    assert.ok(unmarked.includes(escaped(copy.external.review.notReviewed))); assert.match(unmarked, /<button[^>]*>[^<]*<\/button>/);
    assert.equal(render(locale, createElement(DatesExternalReviewMark, { target: detail.event, review: { reviewed: false, by: null, at: null }, canManage: false, onSettled: () => undefined })).includes("<button"), false,
      "no control without the manage capability");
    const panel = render(locale, createElement(DatesExternalRecheckPanel, { event: detail.event, serverNow: detail.server_now, actor: "operator@example.test", canManage: true, onFactsChanged: () => undefined }));
    for (const text of [copy.external.recheck.title, copy.external.recheck.statuses.applied, copy.external.recheck.statuses.failed, copy.external.recheck.reasons.not_same_event,
      "The organizer moved the start.\nCheck the venue page.", "a_future_reason_code"]) assert.ok(panel.includes(escaped(text)), text);
    assert.match(panel, /maxLength="2000"/); assert.match(panel, /<button[^>]*disabled=""[^>]*>[^<]*<\/button><\/div>/, "nothing starts before this tab's saved request is read");
    const corrections = datesExternalCorrections(detail.event, detail.server_now)!;
    const view = render(locale, createElement(DatesExternalCorrectionView, { correction: corrections.rows[0] }));
    for (const text of [copy.corrections.fields.starts_local, copy.corrections.fields.ends_local, copy.corrections.noEnd, "2026-09-23T16:13", "2026-09-23T18:00", "Anna",
      "The organizer's page says 18:00.\nNo end time is given."]) assert.ok(view.includes(escaped(text)), text);
    assert.equal(view.includes(escaped(copy.corrections.fields.title)), false, "an untouched fact is not listed");
    const rejected = render(locale, createElement(DatesExternalCorrectionView, { correction: corrections.rows[1], showEvent: false }));
    assert.ok(rejected.includes(escaped(copy.corrections.rejectReasons.not_verifiable))); assert.ok(rejected.includes(escaped(copy.corrections.statusValues.canceled)));
    assert.ok(rejected.includes(escaped(copy.corrections.decisionNote.replace("{note}", "No source mentions a cancellation."))));
    const purged = render(locale, createElement(DatesExternalCorrectionView, { correction: { ...corrections.rows[0], event_title: null, event_status: null, event_revision: null, current: null } }));
    assert.ok(purged.includes(escaped(copy.corrections.eventGone))); assert.equal(purged.includes("/dates/external/"), false, "no link to a purged event");
    assert.ok(rejected.includes(escaped(copy.corrections.member.replace("{uid}", "77"))), "an empty profile name is named by uid");
    const blocker = render(locale, createElement(DatesResearchBlocker, { code: "venue_unverified" }), createElement(DatesResearchBlocker, { code: "brand_new_code" }));
    assert.ok(blocker.includes(escaped(copy.research.publication.blockers.venue_unverified))); assert.ok(blocker.includes("<code>brand_new_code</code>"));
    for (const code of DATES_EXTERNAL_CORRECTION_REJECT_REASONS) assert.ok(copy.corrections.rejectReasons[code], code);
    for (const code of DATES_RESEARCH_PUBLICATION_BLOCKERS) assert.ok(copy.research.publication.blockers[code], code);
    for (const code of DATES_EXTERNAL_RECHECK_REASONS) assert.ok(copy.external.recheck.reasons[code], code);
  });
}

test("page logic: the list sends the reviewed filter only when chosen, the editor carries correction_id only while approving", () => {
  const list = readFileSync(new URL("../app/(dashboard)/dates/external/page.tsx", import.meta.url), "utf8");
  assert.match(list, /if \(filters\.reviewed\) body\.reviewed = filters\.reviewed;/);
  assert.match(list, /const RESEARCH_UNREVIEWED: Filters = \{ \.\.\.EMPTY_FILTERS, status: "published", channel: "ai_research", reviewed: "false" \};/);
  const editor = readFileSync(new URL("../components/DatesExternalEditorPage.tsx", import.meta.url), "utf8");
  assert.match(editor, /\.\.\.\(externalId && approving \? \{ correction_id: approving\.correction_id \} : \{\}\)/);
  assert.match(editor, /row\.correction_id === correctionId && row\.status === "pending"/);
  // A change made elsewhere never reloads the form under unsaved work.
  assert.match(editor, /if \(!formDirty\) \{ await load\(\); return; \}/);
  const route = readFileSync(new URL("../app/(dashboard)/dates/external/[externalId]/page.tsx", import.meta.url), "utf8");
  assert.match(route, /\/\^cor_\[a-f0-9\]\{32\}\$\/\.test\(correction\)/);
  const panel = readFileSync(new URL("../components/DatesExternalRecheckPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /if \(!open\) return;/, "the job is polled only while it is open");
});
