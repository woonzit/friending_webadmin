import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  ADMIN_ACTIONS,
  adminActionAccess,
  adminPrincipalFrom,
  isAdminActionAuthorized,
} from "../lib/adminActions.ts";
import {
  PUSH_ADMIN_ERROR_STATUSES,
  PUSH_DELIVERY_MODES,
  pushAdminError,
  pushChannels,
  pushDeliverySavePayload,
  pushDeliverySetting,
  pushLocalWriteDenial,
  pushSettingsResponse,
} from "../lib/pushAdmin.ts";
import {
  ADMIN_REQUEST_HEADER,
  ADMIN_REQUEST_HEADER_VALUE,
  isTrustedAdminRequest,
} from "../lib/requestGuard.ts";
import { userDetail } from "../lib/userDetail.ts";

function setting(value: unknown = "both"): Record<string, unknown> {
  return {
    value,
    type: "enum",
    allowed_values: ["fcm", "onesignal", "both"],
    minimum: null,
    maximum: null,
    updated_at: 1_777_000_000,
    updated_by: "push-admin@friending.com",
  };
}

function success(pushSetting: unknown = setting()): Record<string, unknown> {
  return {
    success: true,
    status_code: 200,
    settings: {
      people_hero_enabled: { value: true },
      push_delivery_mode: pushSetting,
    },
    message: 200,
    status: 200,
    can_send: 0,
  };
}

function errorEnvelope(error: string, statusCode: number): Record<string, unknown> {
  return {
    success: false,
    status_code: statusCode,
    error,
    message: 200,
    status: 200,
    can_send: 0,
  };
}

function headers(values: Record<string, string>) {
  const normalized = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return { get: (name: string) => normalized.get(name.toLowerCase()) ?? null };
}

test("the managed push setting preserves exact enum metadata and round-trips canonical modes", () => {
  assert.deepEqual(PUSH_DELIVERY_MODES, ["fcm", "onesignal", "both"]);
  for (const mode of PUSH_DELIVERY_MODES) {
    const parsed = pushSettingsResponse(success(setting(mode)));
    assert.ok(parsed);
    assert.deepEqual(parsed.allowed_values, ["fcm", "onesignal", "both"]);
    assert.equal(parsed.type, "enum");
    assert.equal(parsed.minimum, null);
    assert.equal(parsed.maximum, null);
    assert.deepEqual(pushDeliverySavePayload(parsed.value), { push_delivery_mode: mode });

    const canonical = pushSettingsResponse(success(setting(
      pushDeliverySavePayload(parsed.value)?.push_delivery_mode,
    )));
    assert.equal(canonical?.value, mode);
  }
});

test("known setting metadata ignores unknown fields while the surrounding settings map stays additive", () => {
  const withFutureKey = success();
  (withFutureKey.settings as Record<string, unknown>).future_managed_setting = {
    value: "SENTINEL-MUST-NOT-ENTER-STATE",
  };
  const projected = pushSettingsResponse(withFutureKey);
  assert.ok(projected);
  assert.doesNotMatch(JSON.stringify(projected), /SENTINEL-MUST-NOT-ENTER-STATE/);
  assert.deepEqual(pushDeliverySetting({ ...setting(), unknown: true }), pushDeliverySetting(setting()));

  const malformed: Record<string, unknown>[] = [];
  for (const key of Object.keys(setting())) {
    const candidate = setting();
    delete candidate[key];
    malformed.push(candidate);
  }
  malformed.push(
    { ...setting(), value: "FCM" },
    { ...setting(), value: "firebase" },
    { ...setting(), type: "string" },
    { ...setting(), allowed_values: ["fcm", "both", "onesignal"] },
    { ...setting(), allowed_values: ["fcm", "onesignal", "both", "both"] },
    { ...setting(), minimum: 0 },
    { ...setting(), maximum: 1 },
    { ...setting(), updated_at: -1 },
    { ...setting(), updated_at: 1.5 },
    { ...setting(), updated_at: "1" },
    { ...setting(), updated_by: " Push-Admin@friending.com " },
    { ...setting(), updated_by: "push-admin" },
  );
  for (const candidate of malformed) {
    assert.equal(pushDeliverySetting(candidate), null, JSON.stringify(candidate));
    assert.equal(pushSettingsResponse(success(candidate)), null, JSON.stringify(candidate));
  }

  assert.ok(pushDeliverySetting({ ...setting(), updated_at: 0, updated_by: "" }));
});

test("the complete legacy success envelope ignores unknown fields and never guesses a missing mode", () => {
  const base = success();
  assert.deepEqual(pushSettingsResponse({ ...base, extra: true }), pushSettingsResponse(base));
  for (const key of Object.keys(base)) {
    const candidate = structuredClone(base);
    delete candidate[key];
    assert.equal(pushSettingsResponse(candidate), null, `missing ${key}`);
  }
  for (const candidate of [
    { ...base, success: 1 },
    { ...base, status_code: "200" },
    { ...base, message: "200" },
    { ...base, status: 201 },
    { ...base, can_send: false },
    { ...base, settings: [] },
    { ...base, settings: {} },
    { ...base, settings: { push_delivery_mode: null } },
  ]) {
    assert.equal(pushSettingsResponse(candidate), null, JSON.stringify(candidate));
  }

  for (const invalid of ["Both", "firebase", "", 1, true, null, undefined, {}]) {
    assert.equal(pushDeliverySavePayload(invalid), null);
  }
});

test("all four member channel combinations parse without retaining identifiers", () => {
  for (const fcm of [false, true]) {
    for (const onesignal of [false, true]) {
      assert.deepEqual(pushChannels({
        fcm_token_present: fcm,
        onesignal_id_present: onesignal,
      }), {
        fcm_token_present: fcm,
        onesignal_id_present: onesignal,
      });
    }
  }

  const channels = { fcm_token_present: true, onesignal_id_present: false };
  assert.deepEqual(pushChannels({ ...channels, token: "RAW" }), pushChannels(channels));

  for (const malformed of [
    null,
    [],
    {},
    { fcm_token_present: true },
    { onesignal_id_present: false },
    { fcm_token_present: 1, onesignal_id_present: false },
    { fcm_token_present: true, onesignal_id_present: "false" },
  ]) {
    assert.equal(pushChannels(malformed), null, JSON.stringify(malformed));
  }
});

test("user detail tolerates an absent dormant block but requires and validates it at cutover", () => {
  const base = {
    success: true,
    profile: { uid: 7001, display_name: "Member" },
    push_token: "RAW-FCM-TOKEN-SENTINEL",
    onesignal_identifier: "RAW-ONESIGNAL-ID-SENTINEL",
    provider_private_key: "PROVIDER-CREDENTIAL-SENTINEL",
  };
  const dormant = userDetail(base);
  assert.ok(dormant);
  assert.equal(dormant.push_channels, null);
  assert.equal(userDetail(base, true), null);

  const active = userDetail({
    ...base,
    push_channels: { fcm_token_present: true, onesignal_id_present: false },
  }, true);
  assert.ok(active);
  assert.deepEqual(active.push_channels, {
    fcm_token_present: true,
    onesignal_id_present: false,
  });
  const serialized = JSON.stringify(active);
  for (const leak of [
    "RAW-FCM-TOKEN-SENTINEL",
    "RAW-ONESIGNAL-ID-SENTINEL",
    "PROVIDER-CREDENTIAL-SENTINEL",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(leak));
  }

  const additive = userDetail({
    ...base,
    push_channels: {
      fcm_token_present: true,
      onesignal_id_present: true,
      raw_identifier: "RAW-ONESIGNAL-ID-SENTINEL",
    },
  }, true);
  assert.deepEqual(additive?.push_channels, { fcm_token_present: true, onesignal_id_present: true });
  assert.doesNotMatch(JSON.stringify(additive), /RAW-ONESIGNAL-ID-SENTINEL/);

  for (const malformed of [
    null,
    { fcm_token_present: true },
    { fcm_token_present: true, onesignal_id_present: 0 },
  ]) {
    const payload = { ...base, push_channels: malformed };
    assert.equal(userDetail(payload), null, "present malformed blocks fail even while dormant");
    assert.equal(userDetail(payload, true), null);
  }
});

test("logical errors require their exact status and known legacy envelope fields", () => {
  for (const [error, status] of Object.entries(PUSH_ADMIN_ERROR_STATUSES)) {
    assert.equal(pushAdminError(errorEnvelope(error, status)), error);
    assert.equal(pushAdminError(errorEnvelope(error, status === 500 ? 422 : 500)), null);
  }
  assert.equal(pushAdminError(errorEnvelope("provider-secret-invalid", 422)), null);
  assert.equal(pushAdminError({ success: false, error: "admin-write-required" }), null);
  assert.equal(
    pushLocalWriteDenial({
      success: false,
      status_code: 403,
      error: "admin-write-required",
    }),
    "admin-write-required",
  );
  assert.equal(pushLocalWriteDenial({
    success: false,
    error: "admin-write-required",
  }), null);
  assert.equal(pushLocalWriteDenial({
    success: false,
    status_code: 403,
    error: "owner-required",
  }), null);
  assert.equal(pushAdminError({ ...errorEnvelope("query-failed", 500), extra: true }), "query-failed");
});

test("existing bridge actions retain viewer-read and editor-write policy without inventing push routes", () => {
  const viewer = adminPrincipalFrom({ role: "viewer" });
  const admin = adminPrincipalFrom({ role: "admin" });
  const owner = adminPrincipalFrom({ role: "owner" });

  assert.equal(adminActionAccess("get_settings"), "read");
  assert.equal(adminActionAccess("user_detail"), "read");
  assert.equal(adminActionAccess("set_settings"), "write");
  assert.equal(isAdminActionAuthorized("get_settings", viewer), true);
  assert.equal(isAdminActionAuthorized("user_detail", viewer), true);
  assert.equal(isAdminActionAuthorized("set_settings", viewer), false);
  assert.equal(isAdminActionAuthorized("set_settings", admin), true);
  assert.equal(isAdminActionAuthorized("set_settings", owner), true);

  assert.equal(ADMIN_ACTIONS.filter((action) => action === "get_settings").length, 1);
  assert.equal(ADMIN_ACTIONS.filter((action) => action === "set_settings").length, 1);
  assert.equal(ADMIN_ACTIONS.filter((action) => action === "user_detail").length, 1);
  for (const forbidden of ["push_send", "push_credentials"]) {
    assert.equal((ADMIN_ACTIONS as readonly string[]).includes(forbidden), false);
  }
});

test("push reads and writes inherit the bridge's guest, origin, actor and secret boundaries", async () => {
  const sameOrigin = headers({
    origin: "https://friendingapp.com",
    host: "friendingapp.com",
    "sec-fetch-site": "same-origin",
    [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE,
  });
  const foreignOrigin = headers({
    origin: "https://hostile.example.test",
    host: "friendingapp.com",
    "sec-fetch-site": "cross-site",
    [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE,
  });
  assert.equal(isTrustedAdminRequest(sameOrigin), true);
  assert.equal(isTrustedAdminRequest(foreignOrigin), false);
  assert.equal(isTrustedAdminRequest(headers({ host: "friendingapp.com" })), false);

  const proxy = await readFile(
    new URL("../app/api/admin/[action]/route.ts", import.meta.url),
    "utf8",
  );
  const originGate = proxy.indexOf("isTrustedAdminRequest(request.headers)");
  const allowListGate = proxy.indexOf("isAdminActionAllowed(action)");
  const guestGate = proxy.indexOf("readAdminSession()");
  const actorMerge = proxy.indexOf("mergeCoreParams(body, { admin_email: session.email })");
  assert.ok(originGate >= 0 && allowListGate > originGate && guestGate > allowListGate);
  assert.ok(actorMerge > guestGate);
  assert.match(proxy, /bridgeError\("auth-required", 401\)/);

  const core = await readFile(new URL("../lib/core.ts", import.meta.url), "utf8");
  assert.match(core, /body\.set\("secret", apiSecret\(\)\)/);
  assert.doesNotMatch(proxy, /WEBADMIN_API_SECRET/);
});

test("both released UI projections share one cutover and lock uncertain saves through reload", async () => {
  const configuration = await readFile(
    new URL("../app/(dashboard)/configuration/page.tsx", import.meta.url),
    "utf8",
  );
  const userPage = await readFile(
    new URL("../app/(dashboard)/users/[uid]/page.tsx", import.meta.url),
    "utf8",
  );

  const lock = configuration.indexOf("setBusy(true)");
  const mutation = configuration.indexOf('adminCall("set_settings"');
  const recovery = configuration.indexOf('configurationSnapshot(await adminCall("get_settings"))');
  const recoveryUnlock = configuration.indexOf("setBusy(false)", recovery);
  assert.ok(lock >= 0 && mutation > lock && recovery > mutation && recoveryUnlock > recovery);
  assert.match(configuration, /if \(saveInFlight\.current\) return/);
  assert.match(configuration, /saveInFlight\.current = true[\s\S]*setBusy\(true\)/);
  assert.match(configuration, /disabled=\{busy\}/);
  assert.doesNotMatch(configuration, /console\.(?:log|warn|error)/);
  assert.doesNotMatch(userPage, /console\.(?:log|warn|error)/);
});

test("English and Hungarian include the same mode, presence and Help key trees", async () => {
  const [en, hu] = await Promise.all(["en", "hu"].map(async (locale) => (
    JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"))
  )));
  const keys = (value: Record<string, unknown>) => Object.keys(value).sort();
  assert.deepEqual(keys(en.configuration.push), keys(hu.configuration.push));
  assert.deepEqual(keys(en.configuration.push.modes), ["both", "fcm", "onesignal"]);
  assert.deepEqual(keys(en.configuration.push.modes), keys(hu.configuration.push.modes));
  assert.deepEqual(keys(en.userDetail.pushChannels), keys(hu.userDetail.pushChannels));
  assert.deepEqual(
    keys(en.adminHelp.pages.configuration.sections.pushDelivery),
    keys(hu.adminHelp.pages.configuration.sections.pushDelivery),
  );
  assert.deepEqual(
    keys(en.adminHelp.pages.userDetail.sections.pushChannels),
    keys(hu.adminHelp.pages.userDetail.sections.pushChannels),
  );
});
