import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { RegistrationPlatformStatsView, type RegistrationStatsState } from "../components/RegistrationPlatformStats.tsx";
import {
  ADMIN_ACTIONS,
  adminActionAccess,
  adminPrincipalFrom,
  isAdminActionAuthorized,
} from "../lib/adminActions.ts";
import {
  registeredUserSignup,
  registeredUsersRefusal,
  signupPlatformFilterApplied,
} from "../lib/registeredUsers.ts";
import {
  SIGNUP_PLATFORMS,
  budapestDate,
  chartTicks,
  normalizeRegistrationPlatformStatsProxyBody,
  registrationPlatformStats,
  registrationStatsFailure,
  signupPlatformFilterFrom,
  signupPlatformFrom,
  type RegistrationPlatformStats,
} from "../lib/registrationStats.ts";

/**
 * Core's wire captures for P-092, copied byte-identical from Core main:
 * - registration_platform_stats_wire.json from e43b5960, the last commit touching it
 *   (`admin_registration_stats_storage_test.php --write`), the exact envelope the route returns
 *   for the seeded example, minus the legacy trio `Webadmin::noStoreReply` adds on the wire;
 * - list_users_phone_platform_wire.json from 7ae13ad2, the last commit touching it
 *   (`admin_phone_check_storage_test.php --write`): real list_users envelopes whose rows are
 *   reduced to uid + signup_platform + legacy_converted + phone_check.
 */
const STATS_FIXTURE = new URL("./fixtures/registration_platform_stats_wire.json", import.meta.url);
const STATS_SOURCE_COMMIT = "e43b5960c982015dc31f64c3d152d1cf036949c1";
const STATS_SHA256 = "d99b7900e90da03b0c911059dabdff72929ed29f4847be8f8784e7c3cda9c7ce";
const LIST_FIXTURE = new URL("./fixtures/list_users_phone_platform_wire.json", import.meta.url);
const LIST_SOURCE_COMMIT = "7ae13ad230de20f60d892d4cfb0e80deef5b01b7";
const LIST_SHA256 = "19f52ed162705930d7245f33e504e03166014c2e33428f4cee3bb070824b9bd6";

type Json = Record<string, any>;

const stats = JSON.parse(await readFile(STATS_FIXTURE, "utf8")) as Json;
const list = JSON.parse(await readFile(LIST_FIXTURE, "utf8")) as Json;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function refused(change: (data: Json) => void, why: string): void {
  const body = clone(stats);
  change(body.data);
  assert.equal(registrationPlatformStats(body, 30), null, why);
}

const MESSAGES = {
  en: JSON.parse(await readFile(new URL("../messages/en.json", import.meta.url), "utf8")),
  hu: JSON.parse(await readFile(new URL("../messages/hu.json", import.meta.url), "utf8")),
};

function render(locale: "en" | "hu", data: RegistrationPlatformStats | null, state: RegistrationStatsState): string {
  const noop = () => undefined;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale,
    messages: MESSAGES[locale],
    timeZone: "UTC",
    onError: (error: Error) => { throw error; },
  }, createElement(RegistrationPlatformStatsView, { data, state, range: 30, onRange: noop, onReload: noop })));
}

function escaped(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

test("the vendored captures are byte-identical to Core's", async () => {
  assert.equal(createHash("sha256").update(await readFile(STATS_FIXTURE)).digest("hex"), STATS_SHA256,
    `tests/fixtures/registration_platform_stats_wire.json must stay byte-identical to Core ${STATS_SOURCE_COMMIT}`);
  assert.equal(createHash("sha256").update(await readFile(LIST_FIXTURE)).digest("hex"), LIST_SHA256,
    `tests/fixtures/list_users_phone_platform_wire.json must stay byte-identical to Core ${LIST_SOURCE_COMMIT}`);
  assert.deepEqual(list.filters.signup_platform, ["all", ...SIGNUP_PLATFORMS]);
  assert.equal(list.route, "/v1/webadmin/list_users");
});

test("the strict parser accepts Core's capture, with and without the wire trio", () => {
  const parsed = registrationPlatformStats(stats, 30);
  assert.ok(parsed);
  assert.deepEqual(parsed, stats.data, "the parse is the capture, nothing added or dropped");
  assert.ok(registrationPlatformStats({ ...stats, message: 200, status: 200, can_send: 0 }, 30));
  assert.equal(parsed.daily.length, 30);
  assert.equal(parsed.daily.at(-1)!.date, "2026-09-26");
  assert.equal(budapestDate(parsed.generated_at), "2026-09-26");
});

test("an answer for another range, or not a success, is never shown", () => {
  assert.equal(registrationPlatformStats(stats, 90), null, "a 30-day answer is not the 90-day view");
  for (const envelope of [
    null, "x", [], {},
    { ...stats, success: false },
    { ...stats, status_code: 500 },
    { ...stats, error: "registration-stats-unavailable" },
    { ...stats, data: [] },
  ]) {
    assert.equal(registrationPlatformStats(envelope, 30), null, JSON.stringify(envelope).slice(0, 60));
  }
});

test("a loosely typed or self-contradicting capture is refused", () => {
  refused((data) => { data.schema_version = 2; }, "schema");
  refused((data) => { data.timezone = "UTC"; }, "Budapest days only");
  refused((data) => { data.generated_at = 0; }, "generated time");
  refused((data) => { data.platforms.web.accounts = "4"; }, "string counter");
  refused((data) => { data.platforms.web.accounts = -1; }, "negative counter");
  refused((data) => { data.platforms.web.new_today = 1.5; }, "fractional counter");
  refused((data) => { delete data.platforms.unknown; }, "all four platforms");
  refused((data) => { data.platforms = { ios: data.platforms.ios, web: data.platforms.web, android: data.platforms.android, unknown: data.platforms.unknown }; }, "Core's platform order");
  refused((data) => { data.platforms.windows = data.platforms.web; }, "no fifth platform");
  refused((data) => { data.platforms.web.registered = 6; data.all.registered = 11; }, "registered = accounts + deleted");
  refused((data) => { data.platforms.web.gender.male = 4; data.all.gender.male = 7; }, "genders add up to accounts");
  refused((data) => { data.platforms.web.new_today = 5; data.all.new_today = 5; }, "today within 7 days");
  refused((data) => { data.platforms.web.with_photo = 5; data.all.with_photo = 5; }, "photos within accounts");
  refused((data) => { data.platforms.android.legacy_converted = 2; data.all.legacy_converted = 2; }, "imports within accounts");
  refused((data) => { data.all.accounts = 9; data.all.registered = 11; }, "all is the sum of the platforms");
  refused((data) => { data.all.gender.male = 5; data.all.gender.other = 2; }, "all genders are the platform sums");
  refused((data) => { data.all.signed_in_30_days = 5; }, "overall sign-ins at most the platform sum");
  refused((data) => { data.platforms.web.top_countries.reverse(); }, "largest country first");
  refused((data) => { data.all.top_countries = [data.all.top_countries[2], data.all.top_countries[0], data.all.top_countries[1]]; }, "unknown country last");
  refused((data) => { data.platforms.web.top_countries[0].country_code = "hu"; }, "upper-case codes");
  refused((data) => { data.platforms.web.top_countries[1].country_code = "HU"; }, "unique codes");
  refused((data) => { data.platforms.web.top_countries[0].count = 0; }, "positive country counts");
  refused((data) => { data.platforms.web.top_countries.push({ country_code: "AT", count: 1 }, { country_code: "DE", count: 1 }, { country_code: "SK", count: 1 }, { country_code: "RO", count: 1 }); }, "at most five countries");
  refused((data) => { data.daily.pop(); }, "one row per day");
  refused((data) => { data.daily.reverse(); }, "oldest first");
  refused((data) => { data.daily[3].date = "2026-02-30"; }, "real dates");
  refused((data) => { data.daily[5].date = data.daily[4].date; }, "consecutive days");
  refused((data) => { data.generated_at += 86_400; }, "the series ends on the day it was generated");
  refused((data) => { data.daily[0].web = "0"; }, "string day counter");
  refused((data) => { delete data.daily[0].deleted; }, "day deletions");
});

test("failures are classified: Core's two refusals and everything else", () => {
  assert.equal(registrationStatsFailure({ success: false, status_code: 422, error: "registration-stats-days-invalid", message: 200, status: 200, can_send: 0 }), "daysInvalid");
  assert.equal(registrationStatsFailure({ success: false, status_code: 503, error: "registration-stats-unavailable", message: 200, status: 200, can_send: 0 }), "unavailable");
  for (const value of [null, stats, { success: false, status_code: 403, error: "admin-revoked" }, { success: false, status_code: 503, error: "core-unavailable" }]) {
    assert.equal(registrationStatsFailure(value), "error");
  }
});

test("the statistics are an allow-listed read any active administrator may run, with a closed body", async () => {
  assert.equal(ADMIN_ACTIONS.filter((action) => action === "registration_platform_stats").length, 1);
  assert.equal(adminActionAccess("registration_platform_stats"), "read");
  for (const role of ["viewer", "admin", "owner"]) {
    assert.equal(isAdminActionAuthorized("registration_platform_stats", adminPrincipalFrom({ role })), true, role);
  }
  assert.deepEqual(normalizeRegistrationPlatformStatsProxyBody("registration_platform_stats", {}), {});
  assert.deepEqual(normalizeRegistrationPlatformStatsProxyBody("registration_platform_stats", { days: 30 }), { days: 30 });
  assert.deepEqual(normalizeRegistrationPlatformStatsProxyBody("registration_platform_stats", { days: 90 }), { days: 90 });
  for (const body of [{ days: "30" }, { days: 14 }, { days: 30, extra: 1 }, { admin_email: "x@example.test" }]) {
    assert.equal(normalizeRegistrationPlatformStatsProxyBody("registration_platform_stats", body), null, JSON.stringify(body));
  }
  assert.equal(normalizeRegistrationPlatformStatsProxyBody("list_users", { anything: 1 }), undefined);
  const route = await readFile(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8");
  assert.match(route, /normalizeRegistrationPlatformStatsProxyBody\(action, body\)/);
  assert.match(route, /if \(normalizedRegistrationStatsBody === null\) \{\s*return bridgeError\("invalid-input", 400\);/);
});

test("the panel renders the capture in both locales: cards, list links, details and notes", () => {
  const data = registrationPlatformStats(stats, 30)!;
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].registrationStats;
    const html = render(locale, data, "ready");
    assert.ok(html.includes(escaped(copy.title)));
    for (const platform of SIGNUP_PLATFORMS) {
      // Unknown shows because two registrations in the capture lack a platform.
      assert.ok(html.includes(`href="/users?platform=${platform}"`), platform);
      assert.ok(html.includes(escaped(copy.platforms[platform])), platform);
    }
    assert.equal([...html.matchAll(/<a [^>]*href="\/users\?platform=/g)].length, 4);
    assert.ok(html.includes(escaped(copy.detailsTitle)));
    assert.ok(html.includes(escaped(copy.rows.legacy)));
    assert.ok(html.includes("HU 5 · US 2 · ?"), "top countries in Core's order, unknown last");
    for (const note of ["scope", "deleted", "legacy", "signedIn"] as const) {
      assert.ok(html.includes(escaped(copy.notes[note])), note);
    }
    assert.equal([...html.matchAll(/<table/g)].length, 2, "the daily table and the details table");
    assert.doesNotMatch(html, /role="alert"/);
  }
});

test("the unknown platform is hidden while no registration lacks one", () => {
  const body = clone(stats);
  const unknown = body.data.platforms.unknown;
  const zero = { ...unknown, registered: 0, accounts: 0, new_7_days: 0, new_30_days: 0, active_7_days: 0,
    signed_in_30_days: 0, gender: { male: 0, female: 0, other: 0 }, top_countries: [] };
  for (const key of ["registered", "accounts", "new_7_days", "new_30_days", "active_7_days"] as const) {
    body.data.all[key] -= unknown[key];
  }
  body.data.all.gender.male -= 2;
  body.data.all.top_countries = [{ country_code: "HU", count: 4 }, { country_code: "US", count: 2 }];
  body.data.platforms.unknown = zero;
  for (const row of body.data.daily) { row.unknown = 0; }
  const data = registrationPlatformStats(body, 30);
  assert.ok(data);
  const html = render("en", data, "ready");
  assert.doesNotMatch(html, /\/users\?platform=unknown/);
  assert.equal([...html.matchAll(/href="\/users\?platform=/g)].length, 3);
});

test("a failed read says why and never renders zeros", () => {
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].registrationStats;
    for (const state of ["daysInvalid", "unavailable", "error"] as const) {
      const html = render(locale, null, state);
      assert.ok(html.includes(escaped(copy.failures[state])), state);
      assert.doesNotMatch(html, /<table|registration-tile/u);
    }
    const loading = render(locale, null, "loading");
    assert.ok(loading.includes(escaped(copy.loading)));
    assert.doesNotMatch(loading, /<table/u);
  }
});

test("Registered users rows carry the signup platform and the old-app import marker", () => {
  const rows = list.responses.all.data as Json[];
  assert.deepEqual(rows.map((row) => registeredUserSignup(row)), [
    { platform: "ios", legacyConverted: false },
    { platform: "ios", legacyConverted: false },
    { platform: "android", legacyConverted: false },
    { platform: "ios", legacyConverted: false },
    { platform: "ios", legacyConverted: true },
    { platform: "unknown", legacyConverted: false },
    { platform: "unknown", legacyConverted: false },
  ]);
  // A row without the fields (an older Core) shows nothing rather than a guessed "unknown".
  assert.deepEqual(registeredUserSignup({ uid: 1 }), { platform: null, legacyConverted: false });
  assert.deepEqual(registeredUserSignup({ uid: 1, signup_platform: "IOS", legacy_converted: "true" }), { platform: null, legacyConverted: false });
  assert.equal(signupPlatformFrom("windows"), null);
  assert.equal(signupPlatformFilterFrom("android"), "android");
  assert.equal(signupPlatformFilterFrom("Android"), "all");
  assert.equal(signupPlatformFilterFrom(null), "all");
});

test("Core echoes the applied platform filter in every successful envelope; refusals are named", () => {
  const responses = list.responses as Record<string, Json>;
  assert.equal(signupPlatformFilterApplied(responses.all, "all"), true);
  assert.equal(signupPlatformFilterApplied(responses["phone_check=verified_any&signup_platform=ios"], "ios"), true);
  assert.equal(signupPlatformFilterApplied(responses["early-empty"], "all"), true, "the early empty answer echoes too");
  assert.equal(signupPlatformFilterApplied(responses.all, "web"), false);
  assert.equal(signupPlatformFilterApplied({ ...responses.all, signup_platform: undefined }, "all"), false);
  assert.equal(registeredUsersRefusal(responses["signup_platform-refused"]), "signupPlatformInvalid");
  assert.equal(registeredUsersRefusal(responses.all), null);
  assert.equal(registeredUsersRefusal({ success: false, status_code: 500, error: "query-failed" }), null);
});

test("Registered users sends the filter, follows ?platform= and shows the column", async () => {
  const page = await readFile(new URL("../app/(dashboard)/users/page.tsx", import.meta.url), "utf8");
  assert.match(page, /signup_platform: filters\.platform,/);
  assert.match(page, /signupPlatformFilterFrom\(search\.get\("platform"\)\)/);
  assert.match(page, /<Suspense fallback=\{<LoadingPanel \/>\}>/);
  assert.match(page, /<th>\{t\("signupPlatform"\)\}<\/th>/);
  assert.match(page, /t\(`filterRefused\.\$\{refusal\}`\)/);
  assert.match(page, /signupPlatformFilterApplied\(response, filters\.platform\)/);
  const overview = await readFile(new URL("../app/(dashboard)/page.tsx", import.meta.url), "utf8");
  assert.match(overview, /<RegistrationPlatformStats \/>/);
  const component = await readFile(new URL("../components/RegistrationPlatformStats.tsx", import.meta.url), "utf8");
  assert.match(component, /adminCall\("registration_platform_stats", \{ days \}, controller\.signal\)/);
  for (const locale of ["en", "hu"] as const) {
    const users = MESSAGES[locale].users;
    for (const key of ["platformLabel", "platformAll", "signupPlatform", "legacyConverted", "platformFilterIgnored"]) {
      assert.equal(typeof users[key], "string", `${locale}.users.${key}`);
    }
    assert.equal(typeof users.filterRefused.signupPlatformInvalid, "string");
  }
});

test("chart ticks are clean integers from zero", () => {
  assert.deepEqual(chartTicks(0), [0, 1]);
  assert.deepEqual(chartTicks(3), [0, 1, 2, 3]);
  assert.deepEqual(chartTicks(9), [0, 5, 10]);
  assert.deepEqual(chartTicks(37), [0, 10, 20, 30, 40]);
});
