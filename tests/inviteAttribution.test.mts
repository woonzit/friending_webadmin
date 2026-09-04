import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { InviteAttributionPanel } from "../components/InviteAttributionPanel.tsx";
import { formatDate } from "../lib/format.ts";
import {
  cloneInviteConfiguration,
  inviteConversionRate,
  inviteSaveBody,
  parseInviteAttributionSummary,
  parseInviteConfigurationPayload,
  type InviteAttributionSummary,
} from "../lib/inviteConfiguration.ts";

/**
 * T-757 / D-126. The `attribution` block Core (T-768) appends to the invite-configuration envelope.
 *
 * Everything asserted here is checked against Core's own bytes:
 * `tests/fixtures/invite_configuration_wire/` is the in-process output of
 * `InviteConfigurationService::adminPayload()` and `InviteAttributionService::adminSummary()` at
 * Core `d47bb451`, over rows written by the real `record()` / `attributeRegistration()` writers —
 * not a hand-written stand-in. See that directory's README for the capture and the seed.
 */
const CORPUS = new URL(
  "./fixtures/invite_configuration_wire/t757-invite-configuration-envelopes.json",
  import.meta.url,
);
const CORPUS_SHA256 = "7f4252dc4106343a3c3548cf5182bf24494a88148a927c4a188634543b354f36";

type Envelope = { payload: Record<string, unknown> };
type Corpus = {
  capture: {
    configuration_with_attribution: Envelope;
    attribution_truncated_limit_2: { attribution: Record<string, unknown> };
    configuration_with_empty_attribution: Envelope;
    configuration_with_null_attribution: Envelope;
  };
};

const bytes = await readFile(CORPUS);
assert.equal(
  createHash("sha256").update(bytes).digest("hex"),
  CORPUS_SHA256,
  "the pinned Core corpus must match its published byte hash",
);
const capture = (JSON.parse(bytes.toString("utf8")) as Corpus).capture;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The served envelope, populated / empty / fail-soft, straight out of the corpus. */
const SERVED = clone(capture.configuration_with_attribution.payload);
const SERVED_EMPTY = clone(capture.configuration_with_empty_attribution.payload);
const SERVED_NULL = clone(capture.configuration_with_null_attribution.payload);
const TRUNCATED = clone(capture.attribution_truncated_limit_2.attribution);

function summary(envelope: Record<string, unknown>): InviteAttributionSummary {
  const parsed = parseInviteAttributionSummary(clone(envelope.attribution));
  assert.ok(parsed, "the corpus body must decode");
  return parsed;
}

const POPULATED = summary(SERVED);
const EMPTY = summary(SERVED_EMPTY);

async function render(attribution: InviteAttributionSummary | null, locale: "en" | "hu"): Promise<string> {
  const messages = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
  return renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale, messages, timeZone: "UTC" },
    createElement(InviteAttributionPanel, { attribution }),
  ));
}

test("Core's served envelope carries the four configuration keys and the additive fifth", () => {
  assert.deepEqual(
    Object.keys(SERVED),
    ["configuration", "modes", "placeholders", "limits", "attribution"],
    "the statistics key is a sibling appended after limits, never a replacement",
  );
  assert.deepEqual(Object.keys(SERVED_NULL), Object.keys(SERVED));
  assert.equal(SERVED_NULL.attribution, null, "the fail-soft case sends the key as null, never absent");
});

test("the served summary decodes field for field, in the order Core sent the senders", () => {
  assert.deepEqual(POPULATED, clone(SERVED.attribution));
  assert.deepEqual(POPULATED.senders.map((sender) => sender.uid), [950101, 950102, 950104, 950103]);
  // converted desc, recorded desc, uid asc — 950102 and 950104 tie on (1, 2).
  assert.deepEqual(POPULATED.senders.map((sender) => [sender.converted, sender.recorded]), [[2, 4], [1, 2], [1, 2], [0, 1]]);
  // Nine rows, four converted ROWS but only two distinct converted MEMBERS.
  assert.equal(POPULATED.totals.recorded, 9);
  assert.equal(POPULATED.totals.converted, 4);
  assert.equal(POPULATED.totals.senders, 4);
  assert.equal(POPULATED.totals.converted_members, 2);
  assert.equal(POPULATED.totals.expiring_within_7d, 2);
  assert.deepEqual(POPULATED.totals.by_channel.device_sms, { recorded: 5, converted: 3, expiring_within_7d: 1 });
  assert.deepEqual(POPULATED.totals.by_channel.server_sms, { recorded: 4, converted: 1, expiring_within_7d: 1 });
  // The per-channel counts add up to the flat ones, in all three columns.
  for (const key of ["recorded", "converted", "expiring_within_7d"] as const) {
    assert.equal(
      POPULATED.totals.by_channel.device_sms[key] + POPULATED.totals.by_channel.server_sms[key],
      POPULATED.totals[key],
    );
  }
  // A sender whose account is gone keeps its counts and loses only the name, and a sender who has
  // converted nobody carries 0 — both are values, not absences.
  assert.equal(POPULATED.senders[3]?.uid, 950103);
  assert.equal(POPULATED.senders[3]?.display_name, "");
  assert.equal(POPULATED.senders[3]?.last_converted_at, 0);
  assert.equal(POPULATED.senders[0]?.display_name, "Anna Kovacs");
});

test("the corpus carries no phone number, no hash and no converted member uid", () => {
  const encoded = bytes.toString("utf8");
  assert.doesNotMatch(encoded, /phone_hash|converted_uid/);
  assert.doesNotMatch(encoded, /[0-9a-f]{64}/);
  assert.doesNotMatch(encoded, /\+?362011100\d\d/);
  for (const member of ["960001", "960002"]) {
    assert.equal(encoded.includes(member), false, "a converted member uid must never reach the console");
  }
});

test("an empty senders array is as valid as a populated one", () => {
  assert.deepEqual(EMPTY, clone(SERVED_EMPTY.attribution));
  assert.deepEqual(EMPTY.senders, []);
  assert.equal(EMPTY.totals.recorded, 0);
  assert.deepEqual(Object.keys(EMPTY.totals.by_channel).sort(), ["device_sms", "server_sms"]);
  // RULES 47: the cohort's first recorded invite moves this array from empty to populated. A
  // decoder that accepted only one of the two shapes would break on that ordinary day.
  assert.notEqual(parseInviteAttributionSummary(clone(SERVED.attribution)), null);
});

test("absent, null and every malformed summary degrade to null and never throw", () => {
  for (const value of [undefined, null, [], "attribution", 1, true, {}]) {
    assert.equal(parseInviteAttributionSummary(value), null, JSON.stringify(value ?? null));
  }

  const malformed: unknown[] = [
    { ...clone(POPULATED), schema_version: 2 },
    { ...clone(POPULATED), schema_version: "1" },
    { ...clone(POPULATED), generated_at: -1 },
    { ...clone(POPULATED), generated_at: 1.5 },
    { ...clone(POPULATED), truncated: "false" },
    { ...clone(POPULATED), limit: 0 },
    { ...clone(POPULATED), limit: -100 },
    { ...clone(POPULATED), senders: null },
    { ...clone(POPULATED), senders: {} },
    { ...clone(POPULATED), totals: null },
  ];
  for (const key of ["recorded", "converted", "senders", "converted_members", "expiring_within_7d"]) {
    const missing = clone(POPULATED) as unknown as { totals: Record<string, unknown> };
    delete missing.totals[key];
    malformed.push(missing);
    const negative = clone(POPULATED) as unknown as { totals: Record<string, unknown> };
    negative.totals[key] = -1;
    malformed.push(negative);
  }
  for (const key of ["uid", "recorded", "converted", "last_recorded_at", "last_converted_at", "display_name"]) {
    const missing = clone(POPULATED);
    delete (missing.senders[0] as unknown as Record<string, unknown>)[key];
    malformed.push(missing);
  }
  malformed.push({ ...clone(POPULATED), senders: [{ ...clone(POPULATED).senders[0], uid: 0 }] });
  malformed.push({ ...clone(POPULATED), senders: [{ ...clone(POPULATED).senders[0], display_name: 42 }] });
  malformed.push({ ...clone(POPULATED), senders: [{ ...clone(POPULATED).senders[0], recorded: "4" }] });
  malformed.push({ ...clone(POPULATED), senders: [null] });

  for (const value of malformed) {
    assert.equal(parseInviteAttributionSummary(value), null, JSON.stringify(value));
  }
});

test("a truncated page is Core's own, and the page may never exceed the stated limit", () => {
  const truncated = parseInviteAttributionSummary(clone(TRUNCATED));
  assert.ok(truncated, "the captured limit-2 page must decode");
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.limit, 2);
  assert.deepEqual(truncated.senders.map((sender) => sender.uid), [950101, 950102]);
  // The page is cut; the totals still describe the whole collection.
  assert.deepEqual(truncated.totals, POPULATED.totals);

  const overLimit = clone(POPULATED);
  overLimit.limit = 3;
  assert.equal(parseInviteAttributionSummary(overLimit), null, "four senders under a limit of three is not a page");
  const exact = clone(POPULATED);
  exact.limit = 4;
  assert.equal(parseInviteAttributionSummary(exact)?.senders.length, 4, "a full page is legal");
});

test("the channel map must name exactly the two known delivery modes", () => {
  const cases: unknown[] = [
    (() => { const value = clone(POPULATED); delete (value.totals.by_channel as unknown as Record<string, unknown>).server_sms; return value; })(),
    (() => { const value = clone(POPULATED); (value.totals.by_channel as unknown as Record<string, unknown>).email = { recorded: 0, converted: 0, expiring_within_7d: 0 }; return value; })(),
    (() => { const value = clone(POPULATED); (value.totals as unknown as Record<string, unknown>).by_channel = null; return value; })(),
    (() => { const value = clone(POPULATED); (value.totals.by_channel as unknown as Record<string, unknown>).device_sms = { recorded: 5, converted: 3 }; return value; })(),
    (() => { const value = clone(POPULATED); value.totals.by_channel.device_sms.expiring_within_7d = -1; return value; })(),
  ];
  for (const value of cases) {
    assert.equal(parseInviteAttributionSummary(value), null, JSON.stringify(value));
  }
});

test("the configuration half is fail-closed and the statistics half is fail-open, in the same envelope", () => {
  const parsed = parseInviteConfigurationPayload(clone(SERVED));
  assert.ok(parsed);
  assert.deepEqual(parsed.attribution, POPULATED);
  assert.equal(parsed.configuration.revision, 1);
  assert.equal(parsed.configuration.overrides[0]?.storefront, "HUN");

  // The fail-soft envelope Core really serves when the aggregation throws.
  const soft = parseInviteConfigurationPayload(clone(SERVED_NULL));
  assert.ok(soft, "an unreadable statistics collection must not take the console down");
  assert.equal(soft.attribution, null);
  assert.deepEqual(soft.configuration, parsed.configuration);

  // Fail-open for every other broken shape too, including the key being absent.
  const withoutKey = clone(SERVED) as Record<string, unknown>;
  delete withoutKey.attribution;
  for (const attribution of [undefined, null, {}, [], "nope", { ...clone(POPULATED), schema_version: 9 }]) {
    const value = attribution === undefined ? withoutKey : { ...clone(SERVED), attribution };
    const degraded = parseInviteConfigurationPayload(value);
    assert.ok(degraded, JSON.stringify(attribution ?? null));
    assert.equal(degraded.attribution, null);
    assert.deepEqual(degraded.configuration, parsed.configuration);
  }

  // Fail-closed, unchanged: a valid summary cannot rescue a broken configuration.
  const brokenRule = clone(SERVED) as Record<string, unknown>;
  (brokenRule.configuration as { global: { mode: string } }).global.mode = "email";
  assert.equal(parseInviteConfigurationPayload(brokenRule), null);
});

test("the save body never carries the statistics back to Core", () => {
  const parsed = parseInviteConfigurationPayload(clone(SERVED));
  assert.ok(parsed);
  const body = inviteSaveBody(cloneInviteConfiguration(parsed.configuration));
  assert.deepEqual(Object.keys(body).sort(), ["configuration", "expected_revision"]);
  assert.deepEqual(Object.keys(body.configuration as object).sort(), ["enabled", "global", "overrides"]);
  assert.equal(JSON.stringify(body).includes("attribution"), false);
  assert.equal(JSON.stringify(body).includes("950101"), false);
});

test("the conversion rate is a ratio, and an unanswerable one is null rather than zero", () => {
  assert.equal(inviteConversionRate(POPULATED.totals.recorded, POPULATED.totals.converted), 4 / 9);
  assert.equal(inviteConversionRate(EMPTY.totals.recorded, EMPTY.totals.converted), null);
  assert.equal(inviteConversionRate(4, 4), 1);
});

test("the populated panel renders five tiles, both channels and one row per sender", async () => {
  for (const locale of ["en", "hu"] as const) {
    const html = await render(POPULATED, locale);
    assert.match(html, /data-invite-attribution="populated"/);
    for (const tile of ["recorded", "converted", "rate", "senders", "expiring"]) {
      assert.match(html, new RegExp(`data-invite-tile="${tile}"`), `${locale} must draw the ${tile} tile`);
    }
    assert.match(html, /data-invite-channel="device_sms"/);
    assert.match(html, /data-invite-channel="server_sms"/);
    assert.equal((html.match(/data-invite-sender-uid="/g) ?? []).length, 4);
    for (const uid of [950101, 950102, 950103, 950104]) {
      assert.match(html, new RegExp(`href="/users/${uid}"`), `${locale} must link ${uid} to its member page`);
      assert.match(html, new RegExp(`<code>${uid}</code>`));
    }
    // The erased sender is labelled by its uid, because "" is not a name.
    assert.match(html, /<a href="\/users\/950103">950103<\/a>/);
    assert.match(html, /<a href="\/users\/950101">Anna Kovacs<\/a>/);
    // 4 of 9 recorded.
    assert.match(html, locale === "hu" ? /44,4%/ : /44\.4%/);
    const lastConversion = POPULATED.senders[0]!.last_converted_at;
    assert.match(html, new RegExp(formatDate(lastConversion, locale).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    // last_converted_at 0 prints an em dash, never 1970.
    assert.doesNotMatch(html, /1970/);
    assert.match(html, /—/);
    assert.doesNotMatch(html, /invite-attribution-truncated/);
    assert.doesNotMatch(html, /empty-state-inner/);
    // Nothing about the invited people can appear, because nothing about them was served.
    assert.doesNotMatch(html, /960001|960002/, "a converted member uid must never be rendered");
    assert.doesNotMatch(html, /\d{8}/, "no phone-shaped digit run may appear in the panel");
  }

  const hu = await render(POPULATED, "hu");
  assert.match(hu, /Meghívások eredménye/);
  assert.match(hu, /Készülékről küldött SMS/);
  assert.match(hu, /Szerverről küldött SMS/);
  assert.match(hu, /7 napon belül lejár/);
  assert.match(hu, /2 különböző tag lépett be/);
  const en = await render(POPULATED, "en");
  assert.match(en, /Invite results/);
  assert.match(en, /Device SMS/);
  assert.match(en, /Server SMS/);
  assert.match(en, /Expiring within 7 days/);
  assert.match(en, /2 distinct members joined/);
});

test("a truncated page says so with the limit Core stated", async () => {
  const truncated = parseInviteAttributionSummary(clone(TRUNCATED));
  assert.ok(truncated);
  assert.match(await render(truncated, "hu"), /Az első 2 meghívó látható/);
  assert.match(await render(truncated, "en"), /Showing the first 2 senders/);
  // The table is the page; the tiles keep answering for the whole collection.
  const html = await render(truncated, "en");
  assert.equal((html.match(/data-invite-sender-uid="/g) ?? []).length, 2);
  assert.match(html, /<span class="stat-value">4<\/span>/);
});

test("an empty collection reads as nothing recorded yet, with the zeros still shown", async () => {
  for (const locale of ["en", "hu"] as const) {
    const html = await render(EMPTY, locale);
    assert.match(html, /data-invite-attribution="empty"/);
    assert.doesNotMatch(html, /data-invite-sender-uid/);
    assert.doesNotMatch(html, /<table/);
    assert.match(html, /data-invite-tile="recorded"/);
    assert.match(html, /data-invite-channel="server_sms"/);
    // recorded 0 has no answerable rate.
    assert.match(html, /—/);
  }
  assert.match(await render(EMPTY, "hu"), /Még nincs rögzített meghívás/);
  assert.match(await render(EMPTY, "en"), /No invites recorded yet/);
});

test("an unavailable summary is one muted line, never an error panel and never a fabricated zero", async () => {
  const soft = parseInviteConfigurationPayload(clone(SERVED_NULL));
  assert.ok(soft);
  for (const locale of ["en", "hu"] as const) {
    const html = await render(soft.attribution, locale);
    assert.match(html, /data-invite-attribution="unavailable"/);
    assert.match(html, /invite-attribution-unavailable/);
    assert.doesNotMatch(html, /data-invite-tile/);
    assert.doesNotMatch(html, /data-invite-channel/);
    assert.doesNotMatch(html, /stat-value/);
    assert.doesNotMatch(html, /error-panel|state-panel/);
    // The panel still names itself, so the operator sees WHICH block is missing.
    assert.match(html, /invite-attribution-title/);
  }
  assert.match(await render(null, "hu"), /A statisztika most nem érhető el/);
  assert.match(await render(null, "en"), /Statistics are not available right now/);
});

test("the console page mounts the panel from the decoded payload and never from the draft", async () => {
  const page = await readFile(new URL("../app/(dashboard)/invite-configuration/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<InviteAttributionPanel attribution=\{attribution\} \/>/);
  assert.match(page, /setAttribution\(parsed\.attribution\)/);
  // The panel sits between the overrides panel and the sticky footer.
  const overrides = page.indexOf("invite-overrides");
  const panel = page.indexOf("<InviteAttributionPanel");
  const footer = page.indexOf("invite-sticky-actions");
  assert.ok(overrides > 0 && panel > overrides && footer > panel, "the panel must sit between the overrides and the footer");
  assert.equal(page.includes("attribution: "), false, "the draft must never carry the summary");
});
