import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import PingerSectionHelp from "../components/PingerSectionHelp.tsx";
import { PINGER_HELP_SECTIONS, pingerAvailability, pingerDuration, type PingerHelpSection } from "../lib/pingerHelp.ts";

const locales = ["en", "hu"] as const;
const messages = Object.fromEntries(locales.map((locale) => [
  locale, JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")),
]));

test("every Pinger panel has complete bilingual help with purpose, effect and example", () => {
  const topics = Object.values(PINGER_HELP_SECTIONS).flat();
  assert.equal(topics.length, 11);
  assert.equal(new Set(topics).size, topics.length);
  for (const locale of locales) {
    const help = messages[locale].pinger.sectionHelp;
    assert.deepEqual(Object.keys(help.sections).sort(), Object.keys(PINGER_HELP_SECTIONS).sort());
    assert.deepEqual(Object.keys(help.topics).sort(), [...topics].sort());
    for (const topic of topics) {
      for (const key of ["title", "purpose", "effect", "example"]) {
        assert.ok(help.topics[topic][key].length >= (key === "title" ? 12 : 50), `${locale}.${topic}.${key}`);
        // A brace would be parsed as an ICU argument and break rendering; placeholders are named in prose.
        assert.doesNotMatch(help.topics[topic][key], /[{}]/u, `${locale}.${topic}.${key}`);
      }
    }
    for (const section of Object.keys(PINGER_HELP_SECTIONS) as PingerHelpSection[]) {
      const errors: unknown[] = [];
      const html = renderToStaticMarkup(createElement(
        NextIntlClientProvider,
        { locale, messages: messages[locale], timeZone: "UTC", onError: (error) => errors.push(error) },
        createElement(PingerSectionHelp, { section }),
      ));
      assert.deepEqual(errors, [], `${locale}.${section} translations must render`);
      assert.match(html, /<details[^>]*><summary>/);
      assert.equal((html.match(/<article>/g) ?? []).length, PINGER_HELP_SECTIONS[section].length);
      assert.doesNotMatch(html, /MISSING_MESSAGE|INVALID_MESSAGE|pinger\.sectionHelp\./);
    }
  }
});

test("the overview names Friending's Hey and the product-wide switch in both languages", () => {
  for (const locale of locales) {
    const copy = messages[locale];
    // Friending keeps Pinger as the page and wire name and Hey as the member-facing product.
    assert.equal(copy.pinger.title, "Pinger");
    assert.equal(copy.nav.pinger, "Pinger");
    assert.deepEqual(Object.keys(copy.pinger.overview.states).sort(), ["globalOff", "off", "on", "unknown"]);
    for (const state of Object.values(copy.pinger.overview.states) as string[]) assert.match(state, /Hey/u);
    assert.match(copy.pinger.overview.copy, locale === "en" ? /Configuration/u : /Konfiguráció/u);
    // Footprints and photo likes are separate switches, not part of this page.
    assert.match(copy.pinger.overview.boundary, /Footprints/u);
  }
});

test("saved Hey availability needs both switches and never invents a state", () => {
  for (const central of [false, true, null]) assert.equal(pingerAvailability(false, central), "off");
  assert.equal(pingerAvailability(true, false), "globalOff");
  assert.equal(pingerAvailability(true, true), "on");
  assert.equal(pingerAvailability(true, null), "unknown");
});

test("duration hints explain seconds without changing their wire units", () => {
  assert.equal(pingerDuration(86400, "hu"), "1 nap");
  assert.equal(pingerDuration(604800, "en"), "7 days");
  assert.equal(pingerDuration(3661, "hu"), "1 óra 1 perc 1 másodperc");
  assert.equal(pingerDuration(0, "en"), "0 seconds");
  assert.equal(pingerDuration(60, "en"), "1 minute");
  assert.equal(pingerDuration(7776000, "en"), "90 days");
  for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(pingerDuration(value, "hu"), null);
  }
});

test("the Pinger editor keeps the action key read-only and reads, never writes, the feature switch", () => {
  const page = readFileSync(new URL("../app/(dashboard)/pinger/page.tsx", import.meta.url), "utf8");
  for (const section of Object.keys(PINGER_HELP_SECTIONS)) {
    assert.ok(page.includes(`<PingerSectionHelp section="${section}" />`), section);
  }
  assert.match(page, /value=\{draft\.actionKey\} readOnly/);
  assert.doesNotMatch(page, /patch\(\{\s*actionKey|adminCall\("feature_switches_set"/);
  assert.match(page, /adminCall\("feature_switches_get", \{ contract_version: 1 \}\)/);
  assert.match(page, /featureSwitchesStateResponse\(switches\)\?\.hey\.enabled \?\? null/);
  assert.match(page, /pingerAvailability\(saved\?\.enabled \?\? false, globalEnabled\)/);
  assert.match(page, /href="\/configuration#feature-switches"/);
  // Existing save guards are untouched.
  assert.match(page, /expected_revision: draft\.revision/);
  assert.match(page, /disabled=\{busy \|\| \(!chatContractReady && draft\.chatContractVersion === 0\)\}/);
  // The feature-switch read is best effort: the page still loads from pinger_admin alone.
  assert.match(page, /setState\(response\?\.success && adopt\(response\) \? "ready" : "error"\)/);
});
