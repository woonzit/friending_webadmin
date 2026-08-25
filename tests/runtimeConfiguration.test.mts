import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeRuntimeSettings,
  runtimeSettingsSavePayload,
  SESSION_IDLE_MINUTES_MAX,
  SESSION_IDLE_MINUTES_MIN,
  sessionIdleMinutesValid,
} from "../lib/runtimeConfiguration.ts";

function payload(minutes: unknown) {
  return {
    people_hero_enabled: { value: true, updated_at: 1, updated_by: "a@test.invalid" },
    demo_system_enabled: { value: false, updated_at: 2, updated_by: "b@test.invalid" },
    app_appearance_mode: { value: "system", updated_at: 3, updated_by: "" },
    join_session_idle_minutes: {
      value: minutes,
      type: "integer",
      minimum: SESSION_IDLE_MINUTES_MIN,
      maximum: SESSION_IDLE_MINUTES_MAX,
      updated_at: 4,
      updated_by: "c@test.invalid",
    },
  };
}

test("runtime configuration preserves the bounded Join idle timeout", () => {
  const normalized = normalizeRuntimeSettings(payload(43_200));
  assert.ok(normalized);
  assert.equal(normalized.join_session_idle_minutes.value, 43_200);
  assert.deepEqual(runtimeSettingsSavePayload(normalized), {
    people_hero_enabled: true,
    demo_system_enabled: false,
    app_appearance_mode: "system",
    join_session_idle_minutes: 43_200,
  });
});

test("runtime configuration refuses fractional, textual and out-of-range minutes", () => {
  for (const value of [29, 525_601, 90.5, "90", null]) {
    assert.equal(sessionIdleMinutesValid(value), false);
    assert.equal(normalizeRuntimeSettings(payload(value)), null);
  }
  assert.equal(sessionIdleMinutesValid(30), true);
  assert.equal(sessionIdleMinutesValid(525_600), true);
});

test("a Core that does not manage the profile base still renders the page", () => {
  // The whole settings payload used to be all-or-nothing. An older Core simply
  // omits this key, and rejecting the payload over it would blank every other
  // setting on the page rather than hide one section.
  const normalized = normalizeRuntimeSettings(payload(43_200));
  assert.ok(normalized);
  assert.equal(normalized.public_profile_base_url.value, "");
  assert.deepEqual(normalized.public_profile_base_url.allowed_values, []);

  // And it must not be sent back: Core validates every key it is given, so one
  // unmanaged value would refuse the save for the settings that ARE managed.
  const saved = runtimeSettingsSavePayload(normalized);
  assert.equal("public_profile_base_url" in saved, false);
});

test("the profile base is taken only from what the server offers", () => {
  const withBase = {
    ...payload(43_200),
    public_profile_base_url: {
      value: "https://friending.com",
      type: "enum",
      allowed_values: ["https://friending.com"],
      updated_at: 9,
      updated_by: "ops@test.invalid",
    },
  };
  const normalized = normalizeRuntimeSettings(withBase);
  assert.ok(normalized);
  assert.equal(normalized.public_profile_base_url.value, "https://friending.com");
  assert.equal(
    runtimeSettingsSavePayload(normalized).public_profile_base_url,
    "https://friending.com",
  );

  // A stored value outside the offered set falls back to the first offer
  // instead of being echoed back to a server that would refuse it.
  const stale = normalizeRuntimeSettings({
    ...withBase,
    public_profile_base_url: {
      ...withBase.public_profile_base_url,
      value: "https://retired.example",
    },
  });
  assert.ok(stale);
  assert.equal(stale.public_profile_base_url.value, "https://friending.com");
});

test("the website origin is carried through and omitted when unmanaged", () => {
  const absent = normalizeRuntimeSettings(payload(43_200));
  assert.ok(absent);
  assert.equal(absent.public_web_base.value, "");
  assert.equal("public_web_base" in runtimeSettingsSavePayload(absent), false);

  const managed = normalizeRuntimeSettings({
    ...payload(43_200),
    public_web_base: {
      value: "https://friending.com",
      type: "origin",
      updated_at: 11,
      updated_by: "ops@test.invalid",
    },
  });
  assert.ok(managed);
  assert.equal(managed.public_web_base.value, "https://friending.com");
  assert.equal(
    runtimeSettingsSavePayload(managed).public_web_base,
    "https://friending.com",
  );
});
