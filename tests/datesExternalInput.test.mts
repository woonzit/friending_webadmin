import assert from "node:assert/strict";
import test from "node:test";
import {
  DATES_EXTERNAL_CATEGORIES,
  datesExternalDefaultDuration,
  datesExternalDraft,
  datesExternalDraftInput,
  datesExternalHttpsUrl,
  datesExternalTimeFromInput,
  datesExternalTimeToInput,
  normalizeDatesExternalManualEvent,
  type DatesExternalManualEvent,
} from "../lib/datesExternalInput.ts";

// Synthetic manual-input controls, not a claimed Core response corpus.
function event(): DatesExternalManualEvent {
  return {
    title: "An evening concert", summary: { en: "Live music.", hu: "Élő zene." },
    category: "concert", sensitive: { flag: false, reason: null },
    start_at: 1_798_910_400, end_at: null, timezone: "Europe/Budapest", all_day: false,
    price_text: null, is_free: true, age_restriction: null,
    venue: { name: "Public venue", formatted_address: "1 Example Street", latitude: 47.5,
      longitude: 19.04, city: "Budapest", country_code: "HU" },
    organizer: { name: "Example organizer", website: null },
    links: { official_url: null, ticket_url: null }, source_url: "https://events.example/concert",
    attendee_list: "visible", confirmations: { source: true, public_venue: true, timezone: true, content_safe: true },
  };
}

test("manual event preserves the exact input identity without receipt-affecting coercion", () => {
  const value = event();
  value.title = "  An evening concert  ";
  const before = JSON.stringify(value);
  assert.equal(normalizeDatesExternalManualEvent(value), value);
  assert.equal(JSON.stringify(value), before);
  value.sensitive = { flag: true, reason: "Sensitive gathering" };
  assert.equal(normalizeDatesExternalManualEvent(value), value, "Core forces count_only; browser does not fabricate a receipt payload");
});

const invalid: Array<[string, (value: Record<string, any>) => void]> = [
  ["unknown top-level key", (v) => { v.ai_assisted = true; }],
  ["missing key", (v) => { delete v.title; }],
  ["short title", (v) => { v.title = "hi"; }],
  ["title grapheme cap", (v) => { v.title = "a".repeat(121); }],
  ["lone surrogate", (v) => { v.title = "bad\ud800"; }],
  ["title control", (v) => { v.title = "bad\nname"; }],
  ["empty summary", (v) => { v.summary.hu = ""; }],
  ["summary CR", (v) => { v.summary.en = "one\r\ntwo"; }],
  ["summary unknown language", (v) => { v.summary.fr = "bonjour"; }],
  ["unknown category", (v) => { v.category = "date"; }],
  ["string boolean", (v) => { v.sensitive.flag = "false"; }],
  ["sensitive reason missing", (v) => { v.sensitive.flag = true; }],
  ["string timestamp", (v) => { v.start_at = String(v.start_at); }],
  ["millisecond timestamp", (v) => { v.start_at *= 1000; }],
  ["fractional timestamp", (v) => { v.start_at += 0.5; }],
  ["invalid timezone", (v) => { v.timezone = "Machine/Implicit"; }],
  ["zero duration", (v) => { v.end_at = v.start_at; }],
  ["nonfestival duration over 24h", (v) => { v.end_at = v.start_at + 86401; }],
  ["festival duration over 14 days", (v) => { v.category = "festival"; v.end_at = v.start_at + 14 * 86400 + 1; }],
  ["age below adult", (v) => { v.age_restriction = 17; }],
  ["loose price boolean", (v) => { v.is_free = 1; }],
  ["paid without official link", (v) => { v.is_free = false; }],
  ["latitude out of range", (v) => { v.venue.latitude = 90.01; }],
  ["coordinate string", (v) => { v.venue.latitude = "47.5"; }],
  ["coordinate NaN", (v) => { v.venue.longitude = NaN; }],
  ["coordinate infinity", (v) => { v.venue.longitude = Infinity; }],
  ["country alpha3", (v) => { v.venue.country_code = "HUN"; }],
  ["fabricated Places result", (v) => { v.venue.place_id = "browser-claim"; }],
  ["absent source", (v) => { v.source_url = null; }],
  ["private image input", (v) => { v.image = { kind: "flyer", url: "https://events.example/flyer.jpg" }; }],
  ["unknown attendee policy", (v) => { v.attendee_list = "everyone"; }],
  ["unconfirmed source", (v) => { v.confirmations.source = false; }],
  ["unconfirmed public venue", (v) => { v.confirmations.public_venue = false; }],
  ["unconfirmed timezone", (v) => { v.confirmations.timezone = false; }],
  ["unconfirmed safety", (v) => { v.confirmations.content_safe = false; }],
  ["string confirmation", (v) => { v.confirmations.source = "true"; }],
];
for (const [name, mutate] of invalid) test(`manual input refuses ${name}`, () => {
  const value = event(); mutate(value); assert.equal(normalizeDatesExternalManualEvent(value), null);
});

test("manual text uses graphemes and permits the Core multiline subset", () => {
  const value = event();
  value.title = "👨‍👩‍👧‍👦".repeat(120);
  value.summary.en = "One\n\tTwo";
  assert.ok(normalizeDatesExternalManualEvent(value));
  value.title += "x";
  assert.equal(normalizeDatesExternalManualEvent(value), null);
  value.title = "a" + "\u0301".repeat(33_000);
  assert.equal(normalizeDatesExternalManualEvent(value), null, "grapheme bounds cannot bypass byte ceiling");
});

test("category defaults and duration bounds match the manual provider", () => {
  assert.equal(new Set(DATES_EXTERNAL_CATEGORIES).size, 15);
  for (const category of DATES_EXTERNAL_CATEGORIES) {
    const value = event(); value.category = category;
    assert.ok(normalizeDatesExternalManualEvent(value));
    const hours = category === "festival" ? 10 : category === "club_night" ? 5
      : ["concert", "theatre"].includes(category) ? 3 : 2;
    assert.equal(datesExternalDefaultDuration(category), hours * 3600);
  }
  const value = event(); value.category = "festival"; value.end_at = value.start_at + 14 * 86400;
  assert.ok(normalizeDatesExternalManualEvent(value));
});

test("navigation links are bounded HTTPS domains, not credentials, IPs or fetch authority", () => {
  for (const value of ["https://events.example/a?b=c#d", "HTTPS://EVENTS.EXAMPLE:443/a", "https://xn--bcher-kva.example/"])
    assert.equal(datesExternalHttpsUrl(value), true, value);
  for (const value of [null, 12, " http://events.example", "http://events.example", "javascript:alert(1)",
    "https://a:b@events.example/", "https://events.example:8443/", "https://127.0.0.1", "https://127.1",
    "https://[::1]/", "https://localhost/", "https://events.example./", "https://events.example\\@evil.example/",
    "https://events.example/\n", "https://events.example/ ", "https://ev_ents.example/", "https://events.example/" + "a".repeat(2048)])
    assert.equal(datesExternalHttpsUrl(value), false, String(value));
});

test("offset plus venue timezone identifies both occurrences of a DST fold", () => {
  const earlier = datesExternalTimeFromInput("2026-11-01T01:30", "-04:00", "America/New_York");
  const later = datesExternalTimeFromInput("2026-11-01T01:30", "-05:00", "America/New_York");
  assert.equal(earlier, Date.parse("2026-11-01T01:30:00-04:00") / 1000);
  assert.equal(later, earlier! + 3600);
  assert.deepEqual(datesExternalTimeToInput(earlier!, "America/New_York"), { local: "2026-11-01T01:30:00", offset: "-04:00" });
  assert.deepEqual(datesExternalTimeToInput(later!, "America/New_York"), { local: "2026-11-01T01:30:00", offset: "-05:00" });
});

test("time entry refuses DST gaps, guessed zones, rollover dates and loose clock syntax", () => {
  for (const [local, offset, timezone] of [
    ["2026-03-08T02:30", "-05:00", "America/New_York"],
    ["2026-03-08T02:30", "-04:00", "America/New_York"],
    ["2026-02-30T12:00", "+01:00", "Europe/Budapest"],
    ["2026-10-05T24:00", "+02:00", "Europe/Budapest"],
    ["2026-10-05T12:00", "+01:00", "Europe/Budapest"],
    ["2026-10-05T12:00", "", "Europe/Budapest"],
    ["2026-10-05T12:00", "+02:00", "unknown"],
    ["2026-10-05T12:00", "+15:00", "UTC"],
    ["2026-10-05T12:00", "+00:99", "UTC"],
    ["next Thursday", "+00:00", "UTC"],
  ]) assert.equal(datesExternalTimeFromInput(local, offset, timezone), null, `${local}/${offset}/${timezone}`);
});

test("time entry roundtrips UTC, fractional-hour zones and local midnight without browser timezone", () => {
  for (const [timezone, offset] of [["UTC", "+00:00"], ["Asia/Kathmandu", "+05:45"],
    ["Pacific/Kiritimati", "+14:00"], ["Europe/Budapest", "+02:00"]]) {
    const instant = datesExternalTimeFromInput("2026-10-05T00:00:03", offset, timezone);
    assert.notEqual(instant, null);
    assert.deepEqual(datesExternalTimeToInput(instant!, timezone), { local: "2026-10-05T00:00:03", offset });
  }
  assert.equal(datesExternalTimeToInput(NaN, "UTC"), null);
  assert.equal(datesExternalTimeToInput(1_800_000_000, "unknown"), null);
});

test("editing manual facts requires fresh attestations rather than copying the original confirmations", () => {
  const initial = event();
  const draft = datesExternalDraft(initial);
  assert.deepEqual([draft.confirmSource, draft.confirmPublicVenue, draft.confirmTimezone, draft.confirmContentSafe], [false, false, false, false]);
  assert.deepEqual(datesExternalDraftInput(draft), { ok: false, error: "confirmations" });
  Object.assign(draft, { confirmSource: true, confirmPublicVenue: true, confirmTimezone: true, confirmContentSafe: true });
  assert.deepEqual(datesExternalDraftInput(draft), { ok: true, event: initial });
  draft.sensitive = true; draft.sensitiveReason = "Sensitive gathering";
  const sensitive = datesExternalDraftInput(draft);
  assert.equal(sensitive.ok && sensitive.event.attendee_list, "count_only");
});

test("draft conversion does not invent zero coordinates, a timezone or an end time", () => {
  const blank = datesExternalDraft();
  assert.equal(blank.timezone, "");
  assert.equal(blank.startOffset, "");
  assert.equal(blank.latitude, "");
  assert.deepEqual(datesExternalDraftInput(blank), { ok: false, error: "startTime" });
  const draft = datesExternalDraft(event());
  Object.assign(draft, { confirmSource: true, confirmPublicVenue: true, confirmTimezone: true, confirmContentSafe: true });
  for (const invalid of ["", " ", "1e2", "0x10", "47,5", "47.5junk"]) {
    assert.deepEqual(datesExternalDraftInput({ ...draft, latitude: invalid }), { ok: false, error: "facts" }, invalid);
  }
  assert.deepEqual(datesExternalDraftInput({ ...draft, endLocal: "2026-10-05T19:00", endOffset: "" }), { ok: false, error: "endTime" });
  for (const age of ["17", "100", "2e1", "20.0", "020"]) {
    assert.deepEqual(datesExternalDraftInput({ ...draft, ageRestriction: age }), { ok: false, error: "facts" });
  }
});
