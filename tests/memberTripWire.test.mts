import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { MemberTripPanel } from "../components/MemberTripPanel.tsx";
import { TRIP_INTENTS, userDetail } from "../lib/userDetail.ts";

const bytes = await readFile(new URL("./fixtures/user_detail_trip_wire/user-detail-trip.json", import.meta.url));
const corpus = JSON.parse(bytes.toString("utf8"));

test("user_detail trip corpus is pinned to the captured Core main bytes", () => {
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "ba10a5ac41068f28550d0d4937b2d2741ff38e2bb2bac98510d99545d326e403");
  assert.equal(corpus.source_commit, "717fe3465a8d4e6d45aca6477f1aa5984098cd03");
  assert.equal(corpus.generator_sha256, "4c82643b96eff09ecf80c27d066a9d52855e04c7db095f185decd8ce0e089862");
  assert.equal(corpus.route, "/v1/webadmin/user_detail");
  assert.deepEqual(Object.keys(corpus.envelopes), ["absent_row", "active", "cancelled_hidden_past_travel_off"]);
});

test("the strict member-page decoder accepts each real empty and populated Core envelope", () => {
  for (const body of Object.values(corpus.envelopes) as Array<Record<string, unknown>>) {
    assert.equal(body.success, true);
    assert.equal(body.status_code, 200);
    const parsed = userDetail(body, true, true);
    assert.ok(parsed);
    assert.deepEqual(parsed.trip, body.trip);
    if (parsed.trip) {
      assert.deepEqual(Object.keys(parsed.trip).sort(), ["city", "country", "arrival_at", "departure_at", "show_to_locals", "intents", "status", "updated_at"].sort());
      assert.doesNotMatch(JSON.stringify(parsed.trip), /latitude|longitude|destination_geo|48\.2082|16\.3738/u);
    }
  }
  assert.deepEqual(corpus.envelopes.active.trip.intents, [...TRIP_INTENTS]);
  assert.equal(corpus.envelopes.absent_row.trip, null);
  const hidden = userDetail(corpus.envelopes.cancelled_hidden_past_travel_off, true, true)!.trip!;
  assert.equal(hidden.show_to_locals, false);
  assert.equal(hidden.status, "cancelled");
  assert.ok(hidden.departure_at < corpus.evaluated_at);
  assert.deepEqual(hidden.intents, []);
});

test("the member-page Trip block renders all captured Core cases in both locales", async () => {
  for (const locale of ["en", "hu"] as const) {
    const messages = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
    for (const body of Object.values(corpus.envelopes)) {
      const trip = userDetail(body, true, true)!.trip;
      const html = renderToStaticMarkup(createElement(NextIntlClientProvider,
        { locale, messages, timeZone: "UTC" }, createElement(MemberTripPanel, { trip })));
      if (trip === null) {
        assert.ok(html.includes(messages.userDetail.trip.empty));
        assert.doesNotMatch(html, /<time|<dl/u);
      } else {
        assert.match(html, /Vienna, Austria/u);
        assert.equal([...html.matchAll(/class="tag"/gu)].length, trip.intents.length);
        assert.ok(html.includes(messages.userDetail.trip.statuses[trip.status]));
      }
      assert.doesNotMatch(html, /<button|<input|<form/u);
    }
  }
});
