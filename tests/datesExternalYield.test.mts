import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import DatesExternalEventForm from "../components/DatesExternalEventForm.tsx";
import DatesExternalWhen from "../components/DatesExternalWhen.tsx";
import DatesResearchDropDetail from "../components/DatesResearchDropDetail.tsx";
import { projectDatesAdminBody } from "../lib/datesAdminProjection.ts";
import { datesExternalRefusal, decodeDatesExternalDetail, decodeDatesExternalList } from "../lib/datesExternalAdmin.ts";
import {
  datesExternalDraft, datesExternalDraftInput, datesExternalMaximumDuration, datesExternalMayBeOngoing, normalizeDatesExternalManualEvent,
  DATES_EXTERNAL_CATEGORIES,
} from "../lib/datesExternalInput.ts";
import { datesExternalLooksAllDay, datesExternalSchedule } from "../lib/datesExternalSchedule.ts";
import { decodeResearchDropDetail, decodeResearchRunDetail, DATES_RESEARCH_DROP_STAGES, DATES_RESEARCH_TITLE_MATCHES } from "../lib/datesResearchAdmin.ts";

// D-149 yield (Core ef10bc77, docs/DATES_EXTERNAL_ADMIN_V1.md "Editor rules" and `drop_detail`). Bodies are Core's
// genuine ones (tests/fixtures/dates_external_review_wire, tests/fixtures/dates_event_research_p3b_admin_wire); a case
// no genuine body has is a DERIVED mutation of one, named where it is made.
const review = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/dates_external_review_wire/${name}.json`, import.meta.url), "utf8"));
const research = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/dates_event_research_p3b_admin_wire/${name}.json`, import.meta.url), "utf8"));
const DAY = 86400;

test("Core's span rules, in one place: 62 days for a festival or market, 184 for an exhibition, 24 hours otherwise, an hour more all day", () => {
  for (const category of DATES_EXTERNAL_CATEGORIES) {
    const days = category === "festival" || category === "market" ? 62 : category === "exhibition" ? 184 : 1;
    assert.equal(datesExternalMaximumDuration(category), days * DAY, category);
    assert.equal(datesExternalMaximumDuration(category, true), days * DAY + 3600, `${category} all day (a clock-change day)`);
    assert.equal(datesExternalMayBeOngoing(category), days > 1, category);
  }
});

test("genuine festival, ongoing exhibition and date-only details decode; their spans and states are shown as Core means them", () => {
  const cases = [["festival", "xev_00000000000000000000000000000008"], ["exhibition-ongoing", "xev_00000000000000000000000000000009"],
    ["date-only", "xev_0000000000000000000000000000000a"]] as const;
  const read = Object.fromEntries(cases.map(([name]) => {
    const body = review(`webadmin-external-detail-${name}`);
    assert.deepEqual(projectDatesAdminBody("dates_external_event_detail", body), body, name);
    const detail = decodeDatesExternalDetail(body, body.event.external_event_id)!;
    assert.ok(detail, `${name}: a fail-closed decoder still reads it`);
    return [name, detail];
  }));
  const festival = read.festival.event, exhibition = read["exhibition-ongoing"].event, dateOnly = read["date-only"].event;
  assert.equal(festival.end_at - festival.start_at, 60 * 3600); assert.equal(exhibition.start_at < read["exhibition-ongoing"].server_now, true, "it began before now");
  assert.equal(dateOnly.facts.all_day, true);
  const at = (event: any, now: number, locale = "en") => datesExternalSchedule({ ...event, all_day: event.facts.all_day }, now, locale);
  const fest = at(festival, read.festival.server_now);
  assert.deepEqual([fest.allDay, fest.multiDay, fest.running, fest.until], [false, true, false, null]);
  assert.match(fest.text, /Nov 5, 2026, 10:00\s?AM\s?–\s?Nov 7, 2026, 10:00\s?PM/);
  const ongoing = at(exhibition, read["exhibition-ongoing"].server_now);
  assert.deepEqual([ongoing.allDay, ongoing.multiDay, ongoing.running], [false, true, true]); assert.equal(ongoing.until, "Oct 31, 2026", "until the day of its end");
  const day = at(dateOnly, read["date-only"].server_now);
  assert.deepEqual([day.allDay, day.multiDay, day.running, day.until], [true, false, false, null]);
  assert.equal(day.text, "Tuesday, November 10, 2026"); assert.doesNotMatch(day.text, /12:00|00:00/, "never a clock time for an all-day event");
  assert.equal(at(dateOnly, read["date-only"].server_now, "hu").text, "2026. november 10., kedd");
  // DERIVED: an all-day span shows its last day as the day before the exclusive end; a running one says until then.
  const span = { ...dateOnly, end_at: dateOnly.start_at + 3 * DAY, end_local: "2026-11-13T00:00:00+01:00" };
  assert.match(datesExternalSchedule({ ...span, all_day: true }, dateOnly.start_at + DAY, "en").text, /Nov 10\s?–\s?12, 2026/);
  assert.equal(datesExternalSchedule({ ...span, all_day: true }, dateOnly.start_at + DAY, "en").until, "Nov 12, 2026");
});

test("list rows (DERIVED from a genuine row): spans up to the category's longest, running spans and midnight rows decode; longer ones fail the page", () => {
  const base = review("webadmin-external-list-not-reviewed"), row = base.events[0];
  const list = (change: (r: any) => void) => { const body = JSON.parse(JSON.stringify(base)); change(body.events[0]); return decodeDatesExternalList(body, { page: 1, limit: 40 }); };
  assert.ok(list((r) => { r.category = "exhibition"; r.end_at = r.start_at + 184 * DAY; }), "an exhibition of 184 days");
  assert.ok(list((r) => { r.category = "festival"; r.end_at = r.start_at + 62 * DAY; }), "a festival of 62 days");
  assert.ok(list((r) => { r.category = "community"; r.end_at = r.start_at + DAY + 3600; }), "an all-day clock-change day (the list cannot tell)");
  assert.ok(list((r) => { r.category = "exhibition"; r.start_at = base.server_now - 30 * DAY; r.end_at = base.server_now + 30 * DAY; }), "running: its start is in the past");
  assert.equal(list((r) => { r.category = "exhibition"; r.end_at = r.start_at + 184 * DAY + 3601; }), null);
  assert.equal(list((r) => { r.category = "concert"; r.end_at = r.start_at + DAY + 3601; }), null);
  // The list row says nothing of all_day: a local midnight-to-midnight span is shown as all day.
  assert.equal(datesExternalLooksAllDay({ ...row, start_local: "2026-11-10T00:00:00+01:00", end_local: "2026-11-11T00:00:00+01:00", end_at: row.start_at + DAY }), true);
  assert.equal(datesExternalLooksAllDay(row), false);
});

test("the editor follows Core: per-category span limits, an all-day hour, an ongoing start left to Core; refusals in words", () => {
  const detail = decodeDatesExternalDetail(review("webadmin-external-detail-festival"), "xev_00000000000000000000000000000008")!;
  const draft = { ...datesExternalDraft(detail.event.editor_input), confirmSource: true, confirmPublicVenue: true, confirmTimezone: true, confirmContentSafe: true };
  const saved = datesExternalDraftInput(draft, true);
  assert.ok(saved.ok, "a genuine 60-hour festival saves back");
  const at = (local: string) => ({ endLocal: local });
  assert.equal(datesExternalDraftInput({ ...draft, ...at("2027-01-06T10:00:00") }, true).ok, true, "exactly 62 days (Nov 5 10:00 to Jan 6 10:00)");
  assert.deepEqual(datesExternalDraftInput({ ...draft, ...at("2027-01-06T11:00:00") }, true), { ok: false, error: "duration" }, "62 days and an hour");
  assert.equal(datesExternalDraftInput({ ...draft, category: "exhibition", ...at("2027-01-06T11:00:00") }, true).ok, true, "an exhibition may run that long");
  assert.deepEqual(datesExternalDraftInput({ ...draft, category: "concert" }, true), { ok: false, error: "duration" }, "a concert of 60 hours");
  // A past start is Core's to judge (it knows the clock and whether the end is stated); the console does not refuse it.
  const ongoing = decodeDatesExternalDetail(review("webadmin-external-detail-exhibition-ongoing"), "xev_00000000000000000000000000000009")!;
  const kept = datesExternalDraftInput({ ...datesExternalDraft(ongoing.event.editor_input), confirmSource: true, confirmPublicVenue: true, confirmTimezone: true, confirmContentSafe: true }, true);
  assert.ok(kept.ok); assert.equal(kept.ok && kept.event.start_at, ongoing.event.start_at, "the real, past start is sent unchanged");
  const event = saved.ok ? saved.event : null;
  assert.ok(normalizeDatesExternalManualEvent({ ...event, end_at: event!.start_at + 62 * DAY }, true));
  assert.equal(normalizeDatesExternalManualEvent({ ...event, end_at: event!.start_at + 62 * DAY + 1 }, true), null);
  assert.ok(normalizeDatesExternalManualEvent({ ...event, category: "community", all_day: true, end_at: event!.start_at + DAY + 3600 }, true), "an all-day clock-change day");
  assert.equal(normalizeDatesExternalManualEvent({ ...event, category: "community", all_day: false, end_at: event!.start_at + DAY + 3600 }, true), null);
  for (const error of ["dates-external-duration-invalid", "dates-external-start-invalid"])
    assert.equal(datesExternalRefusal({ success: false, status_code: 422, error, message: 200, status: 200, can_send: 0 }).kind, "refused", error);
  const editor = readFileSync(new URL("../components/DatesExternalEditorPage.tsx", import.meta.url), "utf8");
  assert.match(editor, /result\.error === "dates-external-duration-invalid" \? "durationInvalid" : result\.error === "dates-external-start-invalid" \? "startInvalid"/);
});

test("drop_detail (genuine contract-2 run details): read whole, bound to a candidate without an intake, unknown codes kept as written", () => {
  for (const name of ["admin-area-run-real-completed-contract2", "admin-area-run-dry-completed-contract2", "admin-run-candidate-fetch-robots-validation-contract2",
    "admin-run-candidate-outside-area-contract2"]) {
    const body = research(name);
    assert.deepEqual(projectDatesAdminBody("dates_event_research_run_detail", body), body, name);
    const run = decodeResearchRunDetail(body, body.run.run_id)!;
    assert.deepEqual(run.candidates!.unreadable, [], name);
    for (const row of run.candidates!.rows) assert.equal(row.drop_detail === null, row.reason === null, `${name}: a stopped candidate says why`);
  }
  const outside = decodeResearchRunDetail(research("admin-run-candidate-outside-area-contract2"), "rru_0000000000000000000000000000000e")!.candidates!.rows[0].drop_detail!;
  assert.deepEqual(outside, { stage: "area", provider_outcome: "sheet", extraction_result: "event", events_extracted: 1, title_match: "exact",
    extracted_title: "Őszi Kamarakoncert", hard_fails: [], gate: "outside-area", http_status: null });
  const fetch = decodeResearchRunDetail(research("admin-run-candidate-fetch-robots-validation-contract2"), "rru_0000000000000000000000000000000d")!.candidates!.rows;
  assert.deepEqual(fetch.map((row) => [row.reason, row.drop_detail?.stage ?? null, row.drop_detail?.http_status ?? null]),
    [["fetch_failed", "fetch", 404], ["robots_disallowed", "fetch", null], [null, null, null], ["validation_failed", "page", null]]);
  // The released body (no selector) has no drop_detail key: nothing is shown.
  const released = decodeResearchRunDetail(research("admin-run-candidate-fetch-robots-validation"), "rru_0000000000000000000000000000000d");
  assert.ok(released); assert.ok(released.candidates!.rows.every((row) => !Object.hasOwn(row, "drop_detail")));
  // DERIVED: a new stage or code is read as written; a missing key, a bad type or a stop on an intake is unreadable.
  assert.equal(decodeResearchDropDetail({ ...outside, stage: "dedupe", gate: "brand-new-gate", hard_fails: ["new_fail"] })?.stage, "dedupe");
  for (const bad of [{ ...outside, http_status: "404" }, (({ gate: _g, ...rest }) => rest)(outside), { ...outside, hard_fails: "none" }, { ...outside, extracted_title: "x".repeat(301) }])
    assert.equal(decodeResearchDropDetail(bad), null, JSON.stringify(bad).slice(0, 60));
  const onIntake = research("admin-run-candidate-outside-area-contract2"); onIntake.run.candidates[0].intake_id = "xin_00000000000000000000000000000001";
  assert.equal(decodeResearchRunDetail(onIntake, onIntake.run.run_id)!.candidates!.unreadable.length, 1);
});

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
  test(`render ${locale}: the stop detail, all-day, running and span times, and the editor's span and all-day notes`, () => {
    const copy = messages(locale).datesAdmin;
    for (const stage of DATES_RESEARCH_DROP_STAGES) assert.ok(copy.research.dropDetail.stages[stage], stage);
    for (const match of DATES_RESEARCH_TITLE_MATCHES) assert.ok(copy.research.dropDetail.titleMatches[match], match);
    const outside = decodeResearchRunDetail(research("admin-run-candidate-outside-area-contract2"), "rru_0000000000000000000000000000000e")!.candidates!.rows[0].drop_detail!;
    const fetch = decodeResearchRunDetail(research("admin-run-candidate-fetch-robots-validation-contract2"), "rru_0000000000000000000000000000000d")!.candidates!.rows[0].drop_detail!;
    const html = render(locale, createElement(DatesResearchDropDetail, { detail: outside }), createElement(DatesResearchDropDetail, { detail: fetch }),
      createElement(DatesResearchDropDetail, { detail: { ...outside, stage: "dedupe", gate: "brand-new-gate", hard_fails: ["time_missing", "new_fail"] } }));
    for (const text of [copy.research.dropDetail.stages.area, copy.research.dropDetail.stages.fetch, copy.research.dropDetail.titleMatches.exact,
      copy.research.closure.blockers["outside-area"], copy.intake.resultValues.event, copy.intake.outcomeValues.sheet, copy.intake.hardFails.time_missing, "HTTP 404", "Őszi Kamarakoncert"])
      assert.ok(html.includes(escaped(text)), text);
    for (const raw of ["dedupe", "brand-new-gate", "new_fail"]) assert.ok(html.includes(`<code>${raw}</code>`), raw);
    const dateOnly = decodeDatesExternalDetail(review("webadmin-external-detail-date-only"), "xev_0000000000000000000000000000000a")!;
    const ongoing = decodeDatesExternalDetail(review("webadmin-external-detail-exhibition-ongoing"), "xev_00000000000000000000000000000009")!;
    const when = render(locale, createElement(DatesExternalWhen, { row: { ...dateOnly.event, all_day: true }, now: dateOnly.server_now, detail: true }),
      createElement(DatesExternalWhen, { row: { ...ongoing.event, all_day: false }, now: ongoing.server_now }));
    assert.ok(when.includes(escaped(copy.external.schedule.allDay))); assert.ok(when.includes(escaped(copy.external.schedule.allDayStored)));
    const until = new Intl.DateTimeFormat(locale, { timeZone: "Europe/Budapest", dateStyle: "medium" }).format(ongoing.event.end_at * 1000);
    assert.ok(when.includes(escaped(copy.external.schedule.until.replace("{date}", until))));
    const form = render(locale, createElement(DatesExternalEventForm, { initial: dateOnly.event.editor_input, disabled: false, submitLabel: "Save", onSubmit: () => undefined, unknownAllowed: true }));
    for (const text of [copy.external.form.spanHint, copy.external.form.allDayHint]) assert.ok(form.includes(escaped(text)), text);
    for (const key of ["durationInvalid", "startInvalid"]) assert.ok(copy.external.feedback[key]?.length > 20, key);
    assert.ok(copy.external.form.errors.duration);
  });
}
