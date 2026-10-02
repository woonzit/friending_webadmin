import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import DatesExternalEventForm from "../components/DatesExternalEventForm.tsx";
import { decodeDatesExternalPlaces, datesExternalPlaceQuery, normalizeDatesExternalProxyBody } from "../lib/datesExternalAdmin.ts";

// Injected shape controls; no Google service requests or claimed provider capture.
const sample = () => ({ success: true, status_code: 200, message: 200, status: 200, can_send: 0, server_now: 1_790_000_000,
  available: true, unavailable_reason: null, manual_entry: true, provider: "google_maps", attribution: "Google Maps", places: [{
    place_id: "place-test", name: "Public square", formatted_address: "Example Street 1", city: "Budapest", country_code: "HU",
    latitude: 47.5, longitude: 19.04, timezone: "Europe/Budapest", public_venue_warning: false,
    attributions: [{ provider: "Example source", uri: "https://source.example/" }],
  }] });

test("optional Places parser distinguishes zero matches from provider/rate unavailability", () => {
  assert.ok(decodeDatesExternalPlaces(sample()));
  assert.ok(decodeDatesExternalPlaces({ ...sample(), places: [] }));
  for (const unavailable_reason of ["provider_unavailable", "rate_limited"])
    assert.ok(decodeDatesExternalPlaces({ ...sample(), available: false, unavailable_reason, places: [] }));
  for (const change of [{ manual_entry: false }, { provider: "other" }, { attribution: "Google" }, { available: false },
    { unavailable_reason: "provider_unavailable" }, { available: "true" }, { places: undefined }])
    assert.equal(decodeDatesExternalPlaces({ ...sample(), ...change }), null);
  // D-143: bound on its fields; a key this console does not know is tolerated.
  assert.ok(decodeDatesExternalPlaces({ ...sample(), arbitrary: [] }));
});

test("Places rows are closed, bounded, deduplicated and never silently drop bad attribution", () => {
  for (const change of [{ latitude: "47.5" }, { longitude: 181 }, { place_id: "bad/id" }, { timezone: "Not/AZone" },
    { public_venue_warning: "false" }, { formatted_address: undefined }, { country_code: "HUN" }, { name: "bad\u0085name" },
    { attributions: [{ provider: "Missing URL" }] }, { attributions: [{ provider: "X", uri: "javascript:alert(1)" }] }]) {
    const value: any = sample(); Object.assign(value.places[0], change);
    assert.equal(decodeDatesExternalPlaces(value), null);
  }
  // D-143: an unknown key on a row is tolerated (nothing of it reaches the form: the picker copies the named fields).
  const wider: any = sample(); Object.assign(wider.places[0], { raw_provider: {} });
  assert.ok(decodeDatesExternalPlaces(wider));
  const value = sample(); value.places.push(value.places[0]);
  assert.equal(decodeDatesExternalPlaces(value), null);
  for (const key of Object.keys(sample().places[0])) {
    const value: any = sample(); delete value.places[0][key]; assert.equal(decodeDatesExternalPlaces(value), null, key);
  }
});

test("Places proxy admits only a bounded query and EN/HU, not provider credentials or URLs", () => {
  assert.equal(datesExternalPlaceQuery("👨‍👩‍👧‍👦".repeat(200)), true);
  for (const query of ["x", "  ", "a".repeat(201), "ab\ncd", "ab\u0085cd", true]) assert.equal(datesExternalPlaceQuery(query), false);
  const body = { query: "Public square Budapest", language: "hu" };
  assert.equal(normalizeDatesExternalProxyBody("dates_external_event_place_search", body), body);
  for (const change of [{ key: "not-allowed" }, { language: "fr" }, { url: "https://provider.example" }, { query: "x" }])
    assert.equal(normalizeDatesExternalProxyBody("dates_external_event_place_search", { ...body, ...change }), null);
});

for (const locale of ["en", "hu"]) test(`actual external form renders complete ${locale} fields without network or file upload`, () => {
  const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
  const errors: unknown[] = [];
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages, timeZone: "UTC", onError: (error) => errors.push(error) },
    createElement(DatesExternalEventForm, { disabled: true, submitLabel: messages.datesAdmin.external.editor.publish, onSubmit: () => {} })));
  assert.deepEqual(errors, []);
  assert.match(html, /<fieldset[^>]*disabled/);
  assert.match(html, /translate="no">Google Maps/);
  assert.ok(html.includes(messages.datesAdmin.external.form.imagePolicy));
  assert.doesNotMatch(html, /type="file"|api\.google|maps\.googleapis/);
});
