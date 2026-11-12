import test from "node:test";
import assert from "node:assert/strict";
import { getCountryDataList } from "countries-list";
import { ISO_COUNTRIES } from "../lib/isoCountries.ts";
import {
  APPEARANCE_COUNTRIES,
  APPEARANCE_COUNTRY_COUNT,
  isAppearanceAlpha2,
  isAppearanceStorefront,
  localizedAppearanceCountries,
} from "../lib/appearanceRules.ts";
import { FORCED_STOREFRONTS, forcedStorefrontName, isForcedStorefront, localizedForcedStorefronts } from "../lib/forcedVerification.ts";

/**
 * Audit finding 8. Both country pickers used to filter `countries-list`'s full data
 * set (36 KB in the browser) with the same rule, written twice. They now share
 * `lib/isoCountries.ts`, built from the package's two minimal tables. The OLD rule is
 * kept here, verbatim, as the reference: what an operator sees (names, their order,
 * the codes accepted) must not change, in either locale.
 */
const NON_ISO_REGIONS = new Set(["AC", "TA"]);
const OLD_SOURCE = getCountryDataList().filter((country) => !country.userAssigned && !NON_ISO_REGIONS.has(country.iso2));
const OLD_CATALOG = OLD_SOURCE
  .map((country) => ({ alpha2: country.iso2, alpha3: country.iso3, englishName: country.name }))
  .filter((country) => /^[A-Z]{2}$/.test(country.alpha2) && /^[A-Z]{3}$/.test(country.alpha3))
  .sort((left, right) => left.alpha3.localeCompare(right.alpha3));
const OLD_ENGLISH = new Map(OLD_SOURCE.map((country) => [country.iso2, country.name]));

function oldAppearance(locale: string) {
  const displayNames = new Intl.DisplayNames([locale === "hu" ? "hu" : "en"], { type: "region" });
  return OLD_CATALOG.map(({ alpha2, alpha3 }) => ({
    alpha2, alpha3, name: displayNames.of(alpha2) ?? OLD_ENGLISH.get(alpha2) ?? alpha3,
  })).sort((left, right) => left.name.localeCompare(right.name, locale === "hu" ? "hu" : "en"));
}

function oldForced(locale: string) {
  const supportedLocale = locale === "hu" ? "hu" : "en";
  const displayNames = new Intl.DisplayNames([supportedLocale], { type: "region" });
  const collator = new Intl.Collator(supportedLocale, { sensitivity: "base" });
  return OLD_CATALOG.map((country) => ({ ...country, name: displayNames.of(country.alpha2) ?? country.englishName }))
    .sort((left, right) => collator.compare(left.name, right.name));
}

test("the shared catalogue is the full data set's answer: 249 entries, same codes, names and order", () => {
  assert.deepEqual(ISO_COUNTRIES.map((country) => ({ ...country })), OLD_CATALOG);
  assert.equal(ISO_COUNTRIES.length, APPEARANCE_COUNTRY_COUNT);
  assert.deepEqual(getCountryDataList().filter((country) => country.userAssigned).map((country) => country.iso2), ["XK"],
    "XK is the only user-assigned code; a package update that adds one fails here");
  for (const code of ["XK", "AC", "TA"]) assert.ok(!ISO_COUNTRIES.some((country) => country.alpha2 === code), code);
});

test("Appearance & placements: the same countries, names and order in both locales, the same codes accepted", () => {
  assert.deepEqual(APPEARANCE_COUNTRIES.map((country) => ({ ...country })), OLD_CATALOG.map(({ alpha2, alpha3 }) => ({ alpha2, alpha3 })));
  for (const locale of ["en", "hu"]) assert.deepEqual(localizedAppearanceCountries(locale), oldAppearance(locale), locale);
  const every = getCountryDataList();
  for (const country of every) {
    const kept = OLD_CATALOG.some((entry) => entry.alpha2 === country.iso2);
    assert.equal(isAppearanceStorefront(country.iso3), kept, country.iso3);
    assert.equal(isAppearanceAlpha2(country.iso2), kept, country.iso2);
  }
});

test("forced verification: the same storefronts, names and order in both locales, the same codes accepted", () => {
  assert.deepEqual(FORCED_STOREFRONTS.map((country) => ({ ...country })), OLD_CATALOG);
  for (const locale of ["en", "hu"]) {
    assert.deepEqual(localizedForcedStorefronts(locale), oldForced(locale), locale);
    for (const country of OLD_CATALOG) assert.equal(forcedStorefrontName(country.alpha3, locale), new Intl.DisplayNames([locale], { type: "region" }).of(country.alpha2) ?? country.alpha3);
  }
  for (const country of getCountryDataList()) {
    assert.equal(isForcedStorefront(country.iso3), OLD_CATALOG.some((entry) => entry.alpha3 === country.iso3), country.iso3);
  }
});
