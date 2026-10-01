import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import DatesExternalEventForm from "../components/DatesExternalEventForm.tsx";
import DatesExternalProvenance from "../components/DatesExternalProvenance.tsx";
import { decodeDatesExternalDetail, decodeDatesExternalList } from "../lib/datesExternalAdmin.ts";
import { datesExternalDraft, datesExternalDraftInput } from "../lib/datesExternalInput.ts";

// Actual Core Router/Webadmin list and detail captures, not synthetic DTOs.
// The independent complete-corpus provenance pins live in datesExternalWire.
const cases = [
  ["match", "sport_match"], ["participation", "sport_participation"],
  ["paid", "concert"], ["sensitive", "community"], ["pacific", "workshop"],
] as const;
const fixture = (name: string, read: "list" | "detail") => JSON.parse(readFileSync(
  new URL(`./fixtures/dates_external_admin_wire/admin-variety-${name}-${read}.json`, import.meta.url), "utf8"));

for (const [name, category] of cases) {
  test(`genuine variety ${name} list preserves its category, identity and Core-local clock`, () => {
    const body = fixture(name, "list");
    assert.deepEqual(decodeDatesExternalList(body, { page: 1, limit: 40 }), body);
    assert.equal(body.events.length, 1);
    assert.equal(body.total, 1);
    const row = body.events[0], detail = fixture(name, "detail").event;
    assert.equal(row.category, category);
    for (const key of ["external_event_id", "activity_id", "revision", "activity_revision", "organizer_name", "start_local", "end_local", "timezone"])
      assert.equal(row[key], detail[key], key);
    if (name === "match") assert.equal(row.organizer_name, "Community Sport\u00a0");
    if (name === "pacific") {
      assert.equal(row.timezone, "America/Los_Angeles");
      assert.equal(row.start_local, "2026-09-23T07:13:20-07:00");
      assert.equal(row.end_local, "2026-09-23T09:13:20-07:00");
      assert.equal(row.city, "San Francisco");
      assert.equal(row.country_code, "US");
    }
  });

  test(`genuine variety ${name} detail preserves paid, privacy and organizer facts without repair`, () => {
    const body = fixture(name, "detail");
    assert.deepEqual(decodeDatesExternalDetail(body, body.event.external_event_id), body);
    const event = body.event;
    assert.equal(event.category, category);
    assert.equal(event.facts.category, category);
    assert.equal(event.editor_input.category, category);
    assert.equal(event.attendee_list, name === "sensitive" ? "count_only" : "visible");
    assert.equal(event.sensitive, name === "sensitive");
    assert.equal(event.facts.sensitive.flag, name === "sensitive");
    assert.equal(event.facts.is_free, name !== "paid");
    assert.equal(event.facts.price_text, name === "paid" ? "25 EUR" : null);
    assert.equal(event.facts.age_restriction, name === "paid" ? 18 : null);
    assert.equal(event.links.ticket_url, name === "paid" ? "https://variety.example.test/tickets" : null);
    assert.deepEqual(event.credit, { channel: "admin", submitted_by_uid: null, anonymous: true, first_submitter_uid: null });
    assert.ok(Object.values(event.editor_input.confirmations).every((value) => value === false));
    if (name === "match") assert.equal(event.editor_input.organizer.name, "Community Sport\u00a0");
    if (name === "sensitive") assert.equal(event.editor_input.sensitive.reason, "Sensitive community gathering.");
  });

  test(`genuine variety ${name} editor roundtrip requires fresh attestations and retains every input fact`, () => {
    const body = fixture(name, "detail");
    const event = decodeDatesExternalDetail(body, body.event.external_event_id)!.event;
    const draft = datesExternalDraft(event.editor_input);
    assert.deepEqual(datesExternalDraftInput(draft), { ok: false, error: "confirmations" });
    const parsed = datesExternalDraftInput({ ...draft,
      confirmSource: true, confirmPublicVenue: true, confirmTimezone: true, confirmContentSafe: true });
    assert.deepEqual(parsed, { ok: true, event: { ...event.editor_input,
      confirmations: { source: true, public_venue: true, timezone: true, content_safe: true } } });
  });

  for (const locale of ["en", "hu"]) test(`genuine variety ${name} form and safe provenance render in ${locale}`, () => {
    const body = fixture(name, "detail");
    const event = decodeDatesExternalDetail(body, body.event.external_event_id)!.event;
    const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
    const errors: unknown[] = [];
    // Controlled SSR only: no mounted browser, provider request or mutation.
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider,
      { locale, messages, timeZone: "UTC", onError: (error) => errors.push(error) },
      createElement(DatesExternalEventForm, { initial: event.editor_input, disabled: false,
        submitLabel: "Save", onSubmit: () => {} }), createElement(DatesExternalProvenance, { event })));
    assert.deepEqual(errors, []);
    assert.ok(html.includes(messages.datesAdmin.external.form.categories[category]));
    assert.match(html, new RegExp(`<option[^>]*value="${category}"[^>]*selected=`));
    assert.ok(html.includes(event.sources[0].url));
    assert.ok(html.includes(messages.datesAdmin.external.provenance.adminEntered));
    assert.doesNotMatch(html, /UID[ :]+0|admin_email|private_evidence/);
    if (name === "paid") {
      assert.ok(html.includes("25 EUR"));
      assert.ok(html.includes('value="18"'));
      assert.ok(html.includes('href="https://variety.example.test/tickets"'));
    }
    if (name === "match") assert.ok(html.includes("Community Sport\u00a0"));
    if (name === "pacific") {
      assert.ok(html.includes('value="America/Los_Angeles"'));
      assert.ok(html.includes('value="2026-09-23T07:13:20"'));
      assert.ok(html.includes('value="-07:00"'));
    }
    if (name === "sensitive") assert.match(html, /<option[^>]*value="count_only"[^>]*selected=/);
  });
}

test("synthetic variety counterfactuals retain strict external identity and fact consistency fences", () => {
  for (const [name] of cases) {
    const body = fixture(name, "detail"), eventId = body.event.external_event_id;
    for (const change of [{ external_event_id: "xev_damaged" }, { revision: 0 },
      { organizer_name: "Contradictory organizer" }, { category: "unreleased_category" }]) {
      const invalid = structuredClone(body); Object.assign(invalid.event, change);
      assert.equal(decodeDatesExternalDetail(invalid, eventId), null, `${name}:${JSON.stringify(change)}`);
    }
  }
  const sensitive = fixture("sensitive", "detail");
  sensitive.event.attendee_list = "visible";
  sensitive.event.editor_input.attendee_list = "visible";
  assert.equal(decodeDatesExternalDetail(sensitive, sensitive.event.external_event_id), null);
  const paid = fixture("paid", "detail");
  paid.event.facts.age_restriction = 17;
  paid.event.editor_input.age_restriction = 17;
  assert.equal(decodeDatesExternalDetail(paid, paid.event.external_event_id), null);
});
