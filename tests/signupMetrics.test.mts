import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  isRegistrationPeriod, parseSignupMetrics, REGISTRATION_PERIODS, registrationRange,
} from "../lib/signupMetrics.ts";

const valid = {
  schema_version: 1, as_of: 1800000000,
  last_24h: { total: 11, persona_verified: 2 },
  last_7d: { total: 13, persona_verified: 4 },
};

test("all rolling presets use exact elapsed seconds and one frozen inclusive range", () => {
  assert.deepEqual(REGISTRATION_PERIODS, ["all", "24h", "48h", "72h", "7d"]);
  for (const [period, seconds] of [["24h", 86400], ["48h", 172800], ["72h", 259200], ["7d", 604800]] as const) {
    const range = registrationRange(period, valid.as_of);
    assert.deepEqual(range, { registered_after: valid.as_of - seconds, registered_before: valid.as_of });
    assert.deepEqual(registrationRange(period, valid.as_of), range, "pagination must not move the clock");
  }
  assert.deepEqual(registrationRange("all", 0), {});
  assert.equal(isRegistrationPeriod("24h"), true);
  for (const period of ["today", "yesterday", "week", "", "24H"]) assert.equal(isRegistrationPeriod(period), false);
  for (const instant of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => registrationRange("24h", instant));
  }
});

test("metrics decode numeric zero and a populated Persona subset", () => {
  assert.deepEqual(parseSignupMetrics(valid), valid);
  const zero = { ...valid, last_24h: { total: 0, persona_verified: 0 }, last_7d: { total: 0, persona_verified: 0 } };
  assert.deepEqual(parseSignupMetrics(zero), zero);
});

test("old Core absence and malformed shapes are unavailable rather than fabricated zero", () => {
  for (const value of [undefined, null, false, [], {}, "0", { ...valid, schema_version: 2 }, { ...valid, extra: 1 }]) {
    assert.equal(parseSignupMetrics(value), null);
  }
  for (const key of Object.keys(valid)) {
    const value = { ...valid } as Record<string, unknown>;
    delete value[key];
    assert.equal(parseSignupMetrics(value), null);
  }
  for (const count of ["1", true, null, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    for (const field of ["total", "persona_verified"]) {
      assert.equal(parseSignupMetrics({ ...valid, last_24h: { ...valid.last_24h, [field]: count } }), null);
    }
  }
  assert.equal(parseSignupMetrics({ ...valid, last_24h: [] }), null);
  assert.equal(parseSignupMetrics({ ...valid, last_7d: { ...valid.last_7d, extra: 1 } }), null);
});

test("Persona is a subset and the rolling day cannot exceed its week", () => {
  for (const last_24h of [
    { total: 11, persona_verified: 12 },
    { total: 14, persona_verified: 2 },
    { total: 11, persona_verified: 5 },
  ]) assert.equal(parseSignupMetrics({ ...valid, last_24h }), null);
});

test("both locales expose every registration period and the two signup/Persona cards", () => {
  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
    assert.deepEqual(Object.keys(messages.users.registrationPeriods), [...REGISTRATION_PERIODS]);
    for (const period of REGISTRATION_PERIODS) assert.ok(messages.users.registrationPeriods[period].length > 0);
    for (const key of ["signupsTitle", "signups24h", "signups7d", "signupsWithPersona", "signupsNote", "signupsUnavailable", "signupsAsOf", "refreshSignups"]) {
      assert.equal(typeof messages.overview[key], "string");
    }
    assert.match(messages.overview.signupsWithPersona, /\{count\}/);
  }
});

test("the shipped pages use server-side range parameters and validated cohort data", () => {
  const users = readFileSync(new URL("../app/(dashboard)/users/page.tsx", import.meta.url), "utf8");
  assert.match(users, /registrationRange\(filters.registrationPeriod, filters.registrationAsOf\)/);
  assert.match(users, /registrationAsOf: Math.floor\(Date.now\(\) \/ 1000\)/);
  assert.match(users, /if \(signal\?\.aborted\) return/);
  const overview = readFileSync(new URL("../app/(dashboard)/page.tsx", import.meta.url), "utf8");
  assert.match(overview, /parseSignupMetrics\(data.signup_metrics\)/);
  assert.match(overview, /signupsUnavailable/);
});

test("the exact Core controller corpus exercises populated and numeric counts", () => {
  const bytes = readFileSync(new URL("./fixtures/webadmin_signup_metrics_wire/overview.json", import.meta.url));
  const wire = JSON.parse(bytes.toString("utf8"));
  const manifest = JSON.parse(readFileSync(new URL("./fixtures/webadmin_signup_metrics_wire/manifest.json", import.meta.url), "utf8"));
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.equal(manifest.fixtures.length, 1);
  assert.equal(manifest.fixtures[0].file, "overview.json");
  assert.equal(manifest.fixtures[0].sha256, digest);
  assert.equal(manifest.fixture_set_sha256, createHash("sha256").update(`overview.json\0${digest}`).digest("hex"));
  assert.match(manifest.source_commit, /^[a-f0-9]{40}$/);
  assert.equal(wire.success, true);
  assert.equal(wire.status_code, 200);
  assert.deepEqual(parseSignupMetrics(wire.data.signup_metrics), valid);
});
