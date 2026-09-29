import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  PHONE_CHECK_FILTERS,
  phoneCheckFilterApplied,
  phoneCheckFilterFrom,
  registeredUserPhoneCheck,
  registeredUsersRefusal,
  signupPlatformFilterApplied,
  type PhoneCheckFilter,
} from "../lib/registeredUsers.ts";

/**
 * Core's list_users capture for P-092/P-093, copied byte-identical from Core 7ae13ad2, the last
 * Core main commit touching tests/fixtures/list_users_phone_platform_wire.json
 * (`admin_phone_check_storage_test.php --write`). Rows are reduced to uid + signup_platform +
 * legacy_converted + phone_check; every phone filter value, both refusals and the early empty
 * answer are real controller envelopes.
 */
const FIXTURE = new URL("./fixtures/list_users_phone_platform_wire.json", import.meta.url);
const FIXTURE_SOURCE_COMMIT = "7ae13ad230de20f60d892d4cfb0e80deef5b01b7";
const FIXTURE_SHA256 = "19f52ed162705930d7245f33e504e03166014c2e33428f4cee3bb070824b9bd6";

type Json = Record<string, any>;
const corpus = JSON.parse(await readFile(FIXTURE, "utf8")) as Json;
const responses = corpus.responses as Record<string, Json>;

const MESSAGES = {
  en: JSON.parse(await readFile(new URL("../messages/en.json", import.meta.url), "utf8")),
  hu: JSON.parse(await readFile(new URL("../messages/hu.json", import.meta.url), "utf8")),
};

test("the vendored capture is byte-identical to Core's and names the console's filter values", async () => {
  assert.equal(createHash("sha256").update(await readFile(FIXTURE)).digest("hex"), FIXTURE_SHA256,
    `tests/fixtures/list_users_phone_platform_wire.json must stay byte-identical to Core ${FIXTURE_SOURCE_COMMIT}`);
  assert.deepEqual(corpus.filters.phone_check, [...PHONE_CHECK_FILTERS]);
});

test("every row's phone check decodes; only a proven phone carries a country", () => {
  assert.deepEqual((responses.all!.data as Json[]).map((row) => registeredUserPhoneCheck(row)), [
    { verified: false, country: "" },
    { verified: true, country: "US/CA" },
    { verified: true, country: "US/CA" },
    { verified: true, country: "HU" },
    { verified: true, country: "GB" },
    { verified: false, country: "" },
    { verified: false, country: "" },
  ]);
});

test("each filter answer echoes its value and holds only matching rows", () => {
  const expected: Record<Exclude<PhoneCheckFilter, "all">, (check: { verified: boolean; country: string }) => boolean> = {
    verified_any: (check) => check.verified,
    verified_nanp: (check) => check.verified && check.country === "US/CA",
    verified_hu: (check) => check.verified && check.country === "HU",
    unverified: (check) => !check.verified,
  };
  for (const [filter, holds] of Object.entries(expected) as Array<[Exclude<PhoneCheckFilter, "all">, (check: { verified: boolean; country: string }) => boolean]>) {
    const response = responses[`phone_check=${filter}`]!;
    assert.equal(phoneCheckFilterApplied(response, filter), true, filter);
    assert.equal(phoneCheckFilterApplied(response, "all"), false, filter);
    assert.ok((response.data as Json[]).length > 0, filter);
    for (const row of response.data as Json[]) {
      const check = registeredUserPhoneCheck(row);
      assert.ok(check && holds(check), `${filter}: uid ${row.uid}`);
    }
  }
  const combined = responses["phone_check=verified_any&signup_platform=ios"]!;
  assert.equal(phoneCheckFilterApplied(combined, "verified_any"), true);
  assert.equal(signupPlatformFilterApplied(combined, "ios"), true);
  assert.equal(phoneCheckFilterApplied(responses["early-empty"], "verified_hu"), true, "the early empty answer echoes too");
  assert.equal(phoneCheckFilterApplied(responses.all, "all"), true);
});

test("Core's refusal of a phone filter value is named; other failures are not", () => {
  assert.equal(registeredUsersRefusal(responses["phone_check-refused"]), "phoneCheckInvalid");
  assert.equal(registeredUsersRefusal(responses["signup_platform-refused"]), "signupPlatformInvalid");
  assert.equal(registeredUsersRefusal({ success: false, status_code: 422, error: "demo-mode-invalid" }), null);
  assert.equal(registeredUsersRefusal(null), null);
});

test("a phone check that is not Core's shape shows nothing instead of a guess", () => {
  for (const phoneCheck of [
    undefined,
    null,
    [],
    { phone_verified: true },
    { phone_verified: "true", phone_country: "HU" },
    { phone_verified: true, phone_country: 36 },
    { phone_verified: true, phone_country: "hu" },
    { phone_verified: true, phone_country: "US/" },
    { phone_verified: true, phone_country: "USA" },
    { phone_verified: false, phone_country: "HU" },
    { phone_verified: true, phone_country: "HU", verified_at: 1 },
  ]) {
    assert.equal(registeredUserPhoneCheck({ uid: 1, phone_check: phoneCheck }), null, JSON.stringify(phoneCheck));
  }
  assert.deepEqual(registeredUserPhoneCheck({ phone_check: { phone_verified: true, phone_country: "" } }), { verified: true, country: "" });
  assert.equal(phoneCheckFilterFrom("verified_hu"), "verified_hu");
  assert.equal(phoneCheckFilterFrom("VERIFIED_HU"), "all");
  assert.equal(phoneCheckFilterFrom(undefined), "all");
});

test("Registered users sends the phone filter, shows the column and names the refusal", async () => {
  const page = await readFile(new URL("../app/(dashboard)/users/page.tsx", import.meta.url), "utf8");
  assert.match(page, /phone_check: filters\.phoneCheck,/);
  assert.match(page, /PHONE_CHECK_FILTERS\.map\(\(filter\) => \(/);
  assert.match(page, /<th>\{t\("phoneCheck"\)\}<\/th>/);
  assert.match(page, /phoneCheckFilterApplied\(response, filters\.phoneCheck\)/);
  assert.match(page, /const phoneCheck = registeredUserPhoneCheck\(row\);/);
  for (const locale of ["en", "hu"] as const) {
    const users = MESSAGES[locale].users;
    assert.deepEqual(Object.keys(users.phoneCheckFilters), [...PHONE_CHECK_FILTERS]);
    for (const key of ["phoneCheckLabel", "phoneCheck", "phoneVerified", "phoneUnverified", "filterIgnored"]) {
      assert.equal(typeof users[key], "string", `${locale}.users.${key}`);
    }
    assert.equal(typeof users.filterRefused.phoneCheckInvalid, "string");
    assert.equal(users.platformFilterIgnored, undefined, "one warning covers both echoed filters");
  }
});
