import test from "node:test";
import assert from "node:assert/strict";
import {
  avatarUrl,
  formatDate,
  formatNumber,
  isHttpsUrl,
  isIsoCountryCode,
  isValidLatitude,
  isValidLongitude,
} from "../lib/format.ts";

test("hero URLs require HTTPS and allow an optional blank destination", () => {
  assert.equal(isHttpsUrl("https://cdn.example.com/hero.jpg"), true);
  assert.equal(isHttpsUrl("http://cdn.example.com/hero.jpg"), false);
  assert.equal(isHttpsUrl("javascript:alert(1)"), false);
  assert.equal(isHttpsUrl("", true), true);
  assert.equal(isHttpsUrl("", false), false);
});

test("avatar paths resolve against the Freelove image cache", () => {
  assert.equal(
    avatarUrl("ab/abc/hash_meetpic.jpeg"),
    "https://pic.freelove.hu/api/cache/ab/abc/hash_meetpic.jpeg",
  );
  assert.equal(avatarUrl("https://pic.freelove.hu/image.jpeg"), "https://pic.freelove.hu/image.jpeg");
  assert.equal(avatarUrl(""), "");
});

test("landing geo inputs use ISO-2 countries and bounded coordinates", () => {
  assert.equal(isIsoCountryCode("HU"), true);
  assert.equal(isIsoCountryCode("us"), true);
  assert.equal(isIsoCountryCode("HUN"), false);
  assert.equal(isValidLatitude(47.4979), true);
  assert.equal(isValidLatitude(91), false);
  assert.equal(isValidLongitude(19.0402), true);
  assert.equal(isValidLongitude(-181), false);
});

test("an out-of-range timestamp degrades to an em dash instead of throwing inside render", () => {
  // new Date(value * 1000) beyond ±8.64e15 ms is Invalid, and Intl.format(Invalid Date) throws a
  // RangeError — which in a React render replaces the whole page with a crash screen.
  assert.equal(formatDate(8_640_000_000_001, "en"), "—");
  assert.equal(formatDate(Number.MAX_SAFE_INTEGER, "hu"), "—");
  assert.doesNotThrow(() => formatDate(1e300, "en", true));
  // The boundary itself still formats.
  assert.notEqual(formatDate(8_640_000_000_000, "en"), "—");
  // Existing behaviour is unchanged.
  assert.equal(formatDate(0, "en"), "—");
  assert.equal(formatDate(-1, "en"), "—");
  assert.equal(formatDate("nonsense", "en"), "—");
});

test("an unreadable counter is an em dash, never a fabricated zero", () => {
  assert.equal(formatNumber(undefined, "en"), "—");
  assert.equal(formatNumber(null, "en"), "—");
  assert.equal(formatNumber("many", "en"), "—");
  assert.equal(formatNumber(Number.NaN, "hu"), "—");
  // Number(null), Number("") and Number([]) are all 0 — an absent counter must not become a zero.
  assert.equal(formatNumber("", "en"), "—");
  assert.equal(formatNumber([], "en"), "—");
  assert.equal(formatNumber({}, "en"), "—");
  // A numeric string is still a number.
  assert.equal(formatNumber("42", "en"), "42");
  // A real zero still renders as zero.
  assert.equal(formatNumber(0, "en"), "0");
  assert.equal(formatNumber(1234, "en"), "1,234");
});
