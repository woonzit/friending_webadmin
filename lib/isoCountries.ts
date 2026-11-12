import alpha2ToAlpha3 from "countries-list/minimal/countries.2to3.min.json";
import englishNames from "countries-list/minimal/countries.en.min.json";

/**
 * The ISO 3166-1 catalogue both country pickers use: the Appearance & placements
 * storefront and place rules (`lib/appearanceRules.ts`) and the forced-verification
 * storefronts (`lib/forcedVerification.ts`). Core's `AppearancePolicy::ALPHA2_TO_ALPHA3`
 * is the 249 current assignments (T-468b finding 17).
 *
 * It is built from `countries-list`'s two minimal tables (alpha-2 to alpha-3, and the
 * English names, about 7 KB) rather than its full data set (36 KB in the browser), of
 * which only these three fields were read. The rule is the one both modules applied
 * to the full set: drop the user-assigned code XK (Kosovo, the only entry the full
 * data marks `userAssigned`) and the CLDR territories AC/ASC and TA/TAA, which Core
 * refuses; keep well-formed codes; order by alpha-3. Operators see the names
 * `Intl.DisplayNames` gives in their locale; the English name is the fallback.
 * `tests/isoCountries.test.mts` holds it to the full data set's answer.
 */
export type IsoCountry = { readonly alpha2: string; readonly alpha3: string; readonly englishName: string };

const NOT_ISO_3166_1: ReadonlySet<string> = new Set(["XK", "AC", "TA"]);
const NAMES: Readonly<Record<string, string>> = englishNames;

export const ISO_COUNTRIES: readonly IsoCountry[] = Object.entries(alpha2ToAlpha3 as Readonly<Record<string, string>>)
  .filter(([alpha2]) => !NOT_ISO_3166_1.has(alpha2))
  .map(([alpha2, alpha3]) => ({ alpha2, alpha3, englishName: NAMES[alpha2] ?? "" }))
  .filter((country) => /^[A-Z]{2}$/.test(country.alpha2) && /^[A-Z]{3}$/.test(country.alpha3))
  .sort((left, right) => left.alpha3.localeCompare(right.alpha3));
