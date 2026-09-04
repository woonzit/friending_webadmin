import assert from "node:assert/strict";
import test from "node:test";
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
 * The shape asserted here is the one Core's own storage suite pins and its report quotes: the
 * populated, the empty and the `null` case. Phase 2 replaces the hand-written bodies below with the
 * captured corpus in `tests/fixtures/invite_configuration_wire/`.
 */
const POPULATED: InviteAttributionSummary = {
  schema_version: 1,
  generated_at: 1788547519,
  totals: {
    recorded: 9,
    converted: 4,
    senders: 4,
    converted_members: 2,
    expiring_within_7d: 2,
    by_channel: {
      device_sms: { recorded: 5, converted: 3, expiring_within_7d: 1 },
      server_sms: { recorded: 4, converted: 1, expiring_within_7d: 1 },
    },
  },
  senders: [
    { uid: 950101, display_name: "Invite Sender A", recorded: 4, converted: 2, last_recorded_at: 1788594000, last_converted_at: 1788599900 },
    { uid: 950102, display_name: "Invite Sender B", recorded: 2, converted: 1, last_recorded_at: 1788596000, last_converted_at: 1788599700 },
    { uid: 950104, display_name: "Invite Sender D", recorded: 2, converted: 1, last_recorded_at: 1788598000, last_converted_at: 1788599600 },
    { uid: 950103, display_name: "", recorded: 1, converted: 0, last_recorded_at: 1788597000, last_converted_at: 0 },
  ],
  limit: 100,
  truncated: false,
};

const EMPTY: InviteAttributionSummary = {
  schema_version: 1,
  generated_at: 1788600000,
  totals: {
    recorded: 0,
    converted: 0,
    senders: 0,
    converted_members: 0,
    expiring_within_7d: 0,
    by_channel: {
      device_sms: { recorded: 0, converted: 0, expiring_within_7d: 0 },
      server_sms: { recorded: 0, converted: 0, expiring_within_7d: 0 },
    },
  },
  senders: [],
  limit: 100,
  truncated: false,
};

/** The configuration half, exactly as Core serves it beside the summary. */
function configurationPayload(): Record<string, unknown> {
  return {
    configuration: {
      schema_version: 2,
      revision: 4,
      enabled: true,
      global: {
        mode: "device_sms",
        messages: { en: "Join me on Friending {user_url}", hu: "Csatlakozz hozzám: {user_url}" },
      },
      overrides: [],
      updated_at: 1788599500,
    },
    modes: ["server_sms", "device_sms"],
    placeholders: ["{user_url}", "{display_name}"],
    limits: { template_length: 600, overrides: 250 },
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function render(attribution: InviteAttributionSummary | null, locale: "en" | "hu"): Promise<string> {
  const messages = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
  return renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale, messages, timeZone: "UTC" },
    createElement(InviteAttributionPanel, { attribution }),
  ));
}

test("the served summary decodes field for field, in the order Core sent the senders", () => {
  const parsed = parseInviteAttributionSummary(clone(POPULATED));
  assert.deepEqual(parsed, POPULATED);
  assert.deepEqual(parsed?.senders.map((sender) => sender.uid), [950101, 950102, 950104, 950103]);
  // A sender whose account is gone keeps its counts and loses only the name, and a sender who has
  // converted nobody carries 0 — both are values, not absences.
  assert.equal(parsed?.senders[3]?.display_name, "");
  assert.equal(parsed?.senders[3]?.last_converted_at, 0);
});

test("an empty senders array is as valid as a populated one", () => {
  assert.deepEqual(parseInviteAttributionSummary(clone(EMPTY)), EMPTY);
  // RULES 47: the cohort's first recorded invite moves this array from empty to populated. A
  // decoder that accepted only one of the two shapes would break on that ordinary day.
  assert.notEqual(parseInviteAttributionSummary(clone(POPULATED)), null);
  const single = clone(EMPTY);
  single.senders = [{ uid: 7, display_name: "One", recorded: 1, converted: 0, last_recorded_at: 1788600000, last_converted_at: 0 }];
  assert.deepEqual(parseInviteAttributionSummary(single)?.senders.length, 1);
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

test("the page of senders may never exceed the limit Core states", () => {
  const overLimit = clone(POPULATED);
  overLimit.limit = 3;
  assert.equal(parseInviteAttributionSummary(overLimit), null, "four senders under a limit of three is not a page");

  const exact = clone(POPULATED);
  exact.limit = 4;
  exact.truncated = true;
  assert.equal(parseInviteAttributionSummary(exact)?.truncated, true, "a full page is legal and says it is truncated");
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
  const withSummary = { ...configurationPayload(), attribution: clone(POPULATED) };
  const parsed = parseInviteConfigurationPayload(withSummary);
  assert.ok(parsed);
  assert.deepEqual(parsed.attribution, POPULATED);
  assert.equal(parsed.configuration.revision, 4);

  // Fail-open: every broken statistics value still yields a working configuration console.
  for (const attribution of [undefined, null, {}, [], "nope", { ...clone(POPULATED), schema_version: 9 }]) {
    const value = attribution === undefined
      ? configurationPayload()
      : { ...configurationPayload(), attribution };
    const degraded = parseInviteConfigurationPayload(value);
    assert.ok(degraded, JSON.stringify(attribution ?? null));
    assert.equal(degraded.attribution, null);
    assert.deepEqual(degraded.configuration, parsed.configuration);
  }

  // Fail-closed, unchanged: a valid summary cannot rescue a broken configuration.
  const brokenRule = { ...configurationPayload(), attribution: clone(POPULATED) } as Record<string, unknown>;
  (brokenRule.configuration as { global: { mode: string } }).global.mode = "email";
  assert.equal(parseInviteConfigurationPayload(brokenRule), null);
});

test("the save body never carries the statistics back to Core", () => {
  const parsed = parseInviteConfigurationPayload({ ...configurationPayload(), attribution: clone(POPULATED) });
  assert.ok(parsed);
  const body = inviteSaveBody(cloneInviteConfiguration(parsed.configuration));
  assert.deepEqual(Object.keys(body).sort(), ["configuration", "expected_revision"]);
  assert.deepEqual(Object.keys(body.configuration as object).sort(), ["enabled", "global", "overrides"]);
  assert.equal(JSON.stringify(body).includes("attribution"), false);
  assert.equal(JSON.stringify(body).includes("950101"), false);
});

test("the conversion rate is a ratio, and an unanswerable one is null rather than zero", () => {
  assert.equal(inviteConversionRate(9, 4), 4 / 9);
  assert.equal(inviteConversionRate(0, 0), null);
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
    assert.match(html, /<a href="\/users\/950101">Invite Sender A<\/a>/);
    // 4 of 9 recorded.
    assert.match(html, locale === "hu" ? /44,4%/ : /44\.4%/);
    assert.match(html, new RegExp(formatDate(1788599900, locale).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    // last_converted_at 0 prints an em dash, never 1970.
    assert.doesNotMatch(html, /1970/);
    assert.match(html, /—/);
    assert.doesNotMatch(html, /invite-attribution-truncated/);
    assert.doesNotMatch(html, /empty-state-inner/);
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
  const truncated = clone(POPULATED);
  truncated.limit = 4;
  truncated.truncated = true;
  truncated.totals.senders = 87;
  assert.match(await render(truncated, "hu"), /Az első 4 meghívó látható/);
  assert.match(await render(truncated, "en"), /Showing the first 4 senders/);
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
  for (const locale of ["en", "hu"] as const) {
    const html = await render(null, locale);
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
