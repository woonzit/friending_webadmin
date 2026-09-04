import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { MemberTripPanel } from "../components/MemberTripPanel.tsx";
import { TRIP_INTENTS, userDetail, type UserDetailTrip } from "../lib/userDetail.ts";

const trip: UserDetailTrip = {
  city: "Vienna", country: "Austria",
  arrival_at: 1788480000, departure_at: 1788912000,
  show_to_locals: true, intents: ["new_friends", "local_tips"],
  status: "active", updated_at: 1788100007,
};
const response = { profile: { uid: 4242 }, trip };

async function render(value: UserDetailTrip | null, locale: "en" | "hu") {
  const messages = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
  return renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "UTC" }, createElement(MemberTripPanel, { trip: value })));
}

test("trip decodes populated, null and absent while leaving the member projection intact", () => {
  assert.deepEqual(userDetail(response)?.trip, trip);
  const empty = userDetail({ ...response, trip: null });
  const absent = userDetail({ profile: response.profile });
  assert.ok(empty);
  assert.deepEqual(empty, absent);
  assert.equal(empty.trip, null);
  const populated = userDetail(response)!;
  assert.deepEqual({ ...populated, trip: null }, empty);
});

test("malformed trip values degrade only this block and never coerce known types", () => {
  const invalid = [null, [], true, "trip", {},
    ...Object.keys(trip).map((key) => Object.fromEntries(Object.entries(trip).filter(([name]) => name !== key))),
    ...["1788480000", NaN, Infinity, -1, 0.5, 8_640_000_000_001].flatMap((value) =>
      ["arrival_at", "departure_at", "updated_at"].map((key) => ({ ...trip, [key]: value }))),
    ...["true", 1, 0, null].map((show_to_locals) => ({ ...trip, show_to_locals })),
    ...[["unknown"], ["new_friends", "new_friends"], [1], "local_tips", ["DATES"]].map((intents) => ({ ...trip, intents })),
    { ...trip, city: "" }, { ...trip, city: "x".repeat(121) }, { ...trip, country: false },
    { ...trip, country: "x".repeat(121) }, { ...trip, city: "City\nOther" },
    { ...trip, status: 1 }, { ...trip, status: "" }, { ...trip, status: "x".repeat(81) },
    { ...trip, departure_at: trip.arrival_at - 1 },
  ];
  for (const value of invalid) {
    const detail = userDetail({ ...response, trip: value });
    assert.ok(detail, JSON.stringify(value));
    assert.deepEqual(detail, userDetail({ ...response, trip: null }));
  }
});

test("trip projection drops coordinates and accepts stored hidden, past and non-active rows", () => {
  const stored = { ...trip, show_to_locals: false, status: "cancelled", arrival_at: 1700000000, departure_at: 1700086400, intents: [] };
  assert.deepEqual(userDetail({ ...response, trip: stored })?.trip, stored);
  assert.deepEqual(userDetail({ ...response, trip: { ...trip, latitude: 48.2082, longitude: 16.3738, destination_geo: { coordinates: [16.3738, 48.2082] } } })?.trip, trip);
  assert.equal(userDetail({ ...response, trip: { ...trip, country: "" } })?.trip?.country, "");
  assert.equal(userDetail({ ...response, trip: { ...trip, status: "archived" } })?.trip?.status, "archived");
});

test("existing malformed member fields still fail with a present, absent or malformed trip", () => {
  for (const value of [trip, null, undefined, { city: "invalid" }]) {
    for (const broken of [
      { profile: {} }, { profile: { uid: -1 } }, { images: {} }, { into_tags: {} },
      { membership: {} }, { push_channels: {} }, { verification_access: {} },
    ]) assert.equal(userDetail({ ...response, trip: value, ...broken }), null);
    assert.equal(userDetail({ ...response, trip: value }, true), null);
    assert.equal(userDetail({ ...response, trip: value }, false, true), null);
  }
});

test("the member page renders the stored Trip panel with populated and empty EN/HU states", async () => {
  const page = await readFile(new URL("../app/(dashboard)/users/[uid]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<MemberTripPanel trip=\{data\.trip\} \/>/u);
  assert.doesNotMatch(page, /travel_enabled|section_availability|feature_switches/u);
  for (const locale of ["en", "hu"] as const) {
    const html = await render(userDetail(response)!.trip, locale);
    assert.match(html, /Vienna, Austria/u);
    assert.match(html, /<time dateTime="2026-09-04T00:00:00\.000Z">/u);
    assert.match(html, locale === "hu" ? /Helyieknek látható<\/dt><dd>igen/u : /Visible to locals<\/dt><dd>yes/u);
    assert.match(html, locale === "hu" ? /<span class="tag">Új barátok<\/span>/u : /<span class="tag">New friends<\/span>/u);
    assert.match(html, locale === "hu" ? /<dd>Aktív<\/dd>/u : /<dd>Active<\/dd>/u);
    assert.doesNotMatch(html, /<button|<input|<form/u);
    for (const value of [null, undefined]) {
      const empty = await render(userDetail({ ...response, trip: value })!.trip, locale);
      assert.match(empty, locale === "hu" ? /Nincs aktív utazás/u : /No active trip/u);
      assert.doesNotMatch(empty, /<time|<dl/u);
    }
    const hidden = await render({ ...trip, show_to_locals: false, status: "cancelled", intents: [] }, locale);
    assert.match(hidden, locale === "hu" ? /Helyieknek látható<\/dt><dd>nem/u : /Visible to locals<\/dt><dd>no/u);
    assert.match(hidden, locale === "hu" ? /<dd>Lemondva<\/dd>/u : /<dd>Cancelled<\/dd>/u);
    assert.match(hidden, /Vienna, Austria/u);
    assert.doesNotMatch(hidden, /class="tag"/u);
  }
});

test("arrival and departure calendar days stay UTC-pinned across operator time zones", async () => {
  const previous = process.env.TZ;
  try {
    for (const locale of ["en", "hu"] as const) {
      const outputs = [];
      for (const timeZone of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"]) {
        process.env.TZ = timeZone;
        outputs.push(await render({ ...trip, departure_at: 1788998399 }, locale));
      }
      assert.equal(outputs[0], outputs[1]);
      assert.equal(outputs[0], outputs[2]);
      assert.match(outputs[0], locale === "hu" ? /2026\. szept\. 4\./u : /Sep 4, 2026/u);
      assert.match(outputs[0], locale === "hu" ? /2026\. szept\. 9\./u : /Sep 9, 2026/u);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("trip copy has identical exact EN/HU key sets and the complete closed intent vocabulary", async () => {
  const en = JSON.parse(await readFile(new URL("../messages/en.json", import.meta.url), "utf8")).userDetail.trip;
  const hu = JSON.parse(await readFile(new URL("../messages/hu.json", import.meta.url), "utf8")).userDetail.trip;
  const keys = ["title", "empty", "destination", "arrival", "departure", "visibleToLocals", "yes", "no", "intentsLabel", "intents", "status", "statuses", "updatedAt"].sort();
  const expected = ["new_friends", "activities", "networking", "local_tips", "events", "dates"];
  assert.deepEqual([...TRIP_INTENTS], expected);
  for (const copy of [en, hu]) {
    assert.deepEqual(Object.keys(copy).sort(), keys);
    assert.deepEqual(Object.keys(copy.intents).sort(), [...expected].sort());
    assert.deepEqual(Object.keys(copy.statuses).sort(), ["active", "cancelled"]);
  }
  assert.deepEqual(Object.values(hu.intents), ["Új barátok", "Közös programok", "Kapcsolatépítés", "Helyi tippek", "Események", "Randik"]);
  const populated = await render(userDetail({ ...response, trip: { ...trip, intents: expected } })!.trip, "hu");
  assert.equal([...populated.matchAll(/class="tag"/gu)].length, 6);
  for (const label of Object.values(hu.intents)) assert.ok(populated.includes(`>${label}<`));
});
