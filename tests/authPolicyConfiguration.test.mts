import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  AUTH_POLICY_COUNTRIES,
  AUTH_POLICY_EDITABLE_SETTING_KEYS,
  AUTH_POLICY_SETTING_KEYS,
  PHONE_DIAL_FORMAT_MAX_LENGTH,
  authPolicyDraftIssue,
  authPolicySavePayload,
  authPolicySettingsResponse,
  localizedAuthPolicyCountries,
  normalizeAuthPolicySettingsProxyBody,
  phoneDialFormatMask,
  phoneDialFormatRefusal,
  phoneDialMaskValid,
  renderPhoneDialFormatSample,
  updatePhoneDialFormat,
  type AuthPolicyConfiguration,
} from "../lib/authPolicyConfiguration.ts";

function setting(
  value: unknown,
  type = "json",
  updatedAt = 1_777_000_000,
  updatedBy = "policy-admin@friending.com",
): Record<string, unknown> {
  return {
    value,
    type,
    allowed_values: [],
    minimum: type === "integer" ? 1 : null,
    maximum: type === "integer" ? 9_223_372_036_854_776_000 : null,
    updated_at: updatedAt,
    updated_by: updatedBy,
  };
}

function settings(): Record<string, unknown> {
  return {
    auth_policy_default: setting({ phone: true, email: true }, "auth_policy"),
    auth_policy_overrides: setting({
      USA: { phone: true, email: false },
      HUN: { phone: false, email: true },
    }, "auth_policy_overrides"),
    phone_dial_codes_default: setting(["36", "1"], "phone_dial_codes"),
    phone_dial_codes_overrides: setting(
      { USA: ["1"], HUN: "ALL" },
      "phone_dial_codes_overrides",
    ),
    phone_dial_formats: setting([
      { code: "36", mask: "**/*** ****" },
      { code: "1", mask: "(***) *** ****" },
    ], "phone_dial_formats"),
    auth_policy_revision: setting(7, "integer", 1_777_000_007),
  };
}

function success(policySettings: Record<string, unknown> = settings()): Record<string, unknown> {
  return {
    success: true,
    status_code: 200,
    settings: policySettings,
    message: 200,
    status: 200,
    can_send: 0,
  };
}

function parsed(): AuthPolicyConfiguration {
  const value = authPolicySettingsResponse(success());
  assert.ok(value);
  return value;
}

test("the storefront catalogue is the closed ISO alpha-3 set with localized names and E.164 roots", () => {
  assert.equal(AUTH_POLICY_COUNTRIES.length, 249);
  assert.equal(new Set(AUTH_POLICY_COUNTRIES.map((country) => country.alpha3)).size, 249);
  assert.ok(AUTH_POLICY_COUNTRIES.every((country) => /^[A-Z]{3}$/.test(country.alpha3)));
  assert.ok(AUTH_POLICY_COUNTRIES.every((country) => (
    country.dialCodes.length > 0
      && country.dialCodes.every((code) => /^[1-9]\d{0,2}$/.test(code))
  )));

  const byCode = new Map(AUTH_POLICY_COUNTRIES.map((country) => [country.alpha3, country]));
  assert.deepEqual(byCode.get("HUN")?.dialCodes, ["36"]);
  assert.deepEqual(byCode.get("USA")?.dialCodes, ["1"]);
  assert.deepEqual(byCode.get("CAN")?.dialCodes, ["1"]);
  assert.deepEqual(byCode.get("BHS")?.dialCodes, ["1"]);
  assert.deepEqual(byCode.get("SJM")?.dialCodes, ["47"]);
  assert.deepEqual(byCode.get("CUW")?.dialCodes, ["599"]);

  const en = new Map(localizedAuthPolicyCountries("en").map((country) => [country.alpha3, country.name]));
  const hu = new Map(localizedAuthPolicyCountries("hu").map((country) => [country.alpha3, country.name]));
  assert.equal(en.get("HUN"), "Hungary");
  assert.equal(hu.get("HUN"), "Magyarország");
  assert.equal(en.get("USA"), "United States");
  assert.equal(hu.get("USA"), "Egyesült Államok");
});

test("phone masks accept exactly the v1.6 grammar", () => {
  const accepted = [
    "*",
    "(***) *** ****",
    "** **-**.**/**",
    "*".repeat(PHONE_DIAL_FORMAT_MAX_LENGTH),
  ];
  for (const mask of accepted) assert.equal(phoneDialMaskValid(mask), true, mask);

  const refused: unknown[] = [
    "",
    " ",
    "() - ./",
    "*".repeat(PHONE_DIAL_FORMAT_MAX_LENGTH + 1),
    "+*",
    "1 (***) *** ****",
    "*_*",
    "*\\*",
    "*\n*",
    "*\n",
    "*\r",
    "*\u2028",
    "＊",
    123,
    null,
  ];
  for (const mask of refused) assert.equal(phoneDialMaskValid(mask), false, String(mask));
});

test("live phone-mask samples use deterministic placeholder digits", () => {
  assert.equal(renderPhoneDialFormatSample("1", "(***) *** ****"), "(212) 555 0134");
  assert.equal(renderPhoneDialFormatSample("36", "**/***-****"), "12/345-6789");
  assert.equal(renderPhoneDialFormatSample("36", "*".repeat(12)), "123456789012");
  assert.equal(renderPhoneDialFormatSample("000", "***"), null);
  assert.equal(renderPhoneDialFormatSample("1\n", "***"), null);
  assert.equal(renderPhoneDialFormatSample("1", "+***"), null);
});

test("format edits keep one sorted entry per code and empty input removes the override", () => {
  const initial = [
    { code: "36", mask: "**/*** ****" },
    { code: "1", mask: "(***) *** ****" },
  ];
  const replaced = updatePhoneDialFormat(initial, "1", "***-***-****");
  assert.deepEqual(replaced, [
    { code: "1", mask: "***-***-****" },
    { code: "36", mask: "**/*** ****" },
  ]);
  assert.equal(phoneDialFormatMask(replaced, "1"), "***-***-****");
  assert.equal(phoneDialFormatMask(replaced, "47"), "");
  assert.deepEqual(updatePhoneDialFormat(replaced, "1", ""), [
    { code: "36", mask: "**/*** ****" },
  ]);
});

test("format codes mirror the canonical 1–3 digit boundary while the UI catalogue stays narrower", () => {
  const candidate = settings();
  (candidate.phone_dial_formats as Record<string, unknown>).value = [
    { code: "999", mask: "***" },
    { code: "1", mask: "(***) *** ****" },
  ];
  const value = authPolicySettingsResponse(success(candidate));
  assert.ok(value);
  assert.deepEqual(value.phoneDialFormats, [
    { code: "1", mask: "(***) *** ****" },
    { code: "999", mask: "***" },
  ]);
  assert.deepEqual(authPolicySavePayload(value)?.phone_dial_formats, value.phoneDialFormats);
});

test("all six managed values parse while saves contain exactly the five editable values", () => {
  const value = parsed();
  assert.deepEqual(value, {
    defaultMethods: { phone: true, email: true },
    methodOverrides: [
      { storefront: "HUN", phone: false, email: true },
      { storefront: "USA", phone: true, email: false },
    ],
    defaultDialCodes: ["1", "36"],
    dialCodeOverrides: [
      { storefront: "HUN", dialCodes: "ALL" },
      { storefront: "USA", dialCodes: ["1"] },
    ],
    phoneDialFormats: [
      { code: "1", mask: "(***) *** ****" },
      { code: "36", mask: "**/*** ****" },
    ],
    revision: 7,
    updatedAt: 1_777_000_007,
    updatedBy: "policy-admin@friending.com",
  });
  assert.equal(authPolicyDraftIssue(value), null);

  const payload = authPolicySavePayload(value);
  assert.ok(payload);
  assert.deepEqual(Object.keys(payload), [...AUTH_POLICY_EDITABLE_SETTING_KEYS]);
  assert.deepEqual(payload, {
    auth_policy_default: { phone: true, email: true },
    auth_policy_overrides: {
      HUN: { phone: false, email: true },
      USA: { phone: true, email: false },
    },
    phone_dial_codes_default: ["1", "36"],
    phone_dial_codes_overrides: { HUN: "ALL", USA: ["1"] },
    phone_dial_formats: [
      { code: "1", mask: "(***) *** ****" },
      { code: "36", mask: "**/*** ****" },
    ],
  });
});

test("fresh environment-derived settings accept only Core's exact PHP empty-map wire ambiguity", () => {
  const fresh = settings();
  (fresh.auth_policy_default as Record<string, unknown>).value = { phone: true, email: false };
  (fresh.auth_policy_overrides as Record<string, unknown>).value = [];
  (fresh.phone_dial_codes_default as Record<string, unknown>).value = "ALL";
  (fresh.phone_dial_codes_overrides as Record<string, unknown>).value = [];
  (fresh.phone_dial_formats as Record<string, unknown>).value = [];
  (fresh.auth_policy_revision as Record<string, unknown>).value = 1;
  for (const row of Object.values(fresh)) {
    (row as Record<string, unknown>).updated_at = 0;
    (row as Record<string, unknown>).updated_by = "";
  }
  assert.deepEqual(authPolicySettingsResponse(success(fresh)), {
    defaultMethods: { phone: true, email: false },
    methodOverrides: [],
    defaultDialCodes: "ALL",
    dialCodeOverrides: [],
    phoneDialFormats: [],
    revision: 1,
    updatedAt: 0,
    updatedBy: "",
  });

  const populatedList = structuredClone(fresh);
  (populatedList.auth_policy_overrides as Record<string, unknown>).value = [
    { USA: { phone: true, email: false } },
  ];
  assert.equal(authPolicySettingsResponse(success(populatedList)), null);
});

test("the surrounding settings map and known setting rows ignore additive fields", () => {
  const additive = settings();
  additive.future_setting = { secret: "SENTINEL-MUST-NOT-ENTER-DRAFT" };
  const value = authPolicySettingsResponse(success(additive));
  assert.ok(value);
  assert.doesNotMatch(JSON.stringify(value), /SENTINEL-MUST-NOT-ENTER-DRAFT/);

  const additiveRows = structuredClone(settings());
  (additiveRows.auth_policy_default as Record<string, unknown>).deprecated_at = null;
  ((additiveRows.auth_policy_default as Record<string, unknown>).value as Record<string, unknown>).future_method = true;
  (((additiveRows.phone_dial_formats as Record<string, unknown>).value as Record<string, unknown>[])[0]).future_mask_metadata = true;
  assert.deepEqual(
    authPolicySettingsResponse(success(additiveRows)),
    authPolicySettingsResponse(success(settings())),
  );

  for (const missing of AUTH_POLICY_SETTING_KEYS) {
    const candidate = structuredClone(settings());
    delete candidate[missing];
    assert.equal(authPolicySettingsResponse(success(candidate)), null, `missing ${missing}`);
  }

  for (const key of Object.keys(setting({ phone: true, email: false }))) {
    const candidate = structuredClone(settings());
    delete (candidate.auth_policy_default as Record<string, unknown>)[key];
    assert.equal(authPolicySettingsResponse(success(candidate)), null, `missing wrapper ${key}`);
  }
});

test("malformed methods, storefronts, calling codes, metadata and revisions fail closed", () => {
  const mutations: Array<(candidate: Record<string, unknown>) => void> = [
    (candidate) => { (candidate.auth_policy_default as Record<string, unknown>).value = { phone: true }; },
    (candidate) => { (candidate.auth_policy_default as Record<string, unknown>).value = null; },
    (candidate) => { (candidate.auth_policy_default as Record<string, unknown>).value = { phone: 1, email: false }; },
    (candidate) => { (candidate.auth_policy_default as Record<string, unknown>).value = { phone: false, email: false }; },
    (candidate) => { (candidate.auth_policy_overrides as Record<string, unknown>).value = { US: { phone: true, email: false } }; },
    (candidate) => { (candidate.auth_policy_overrides as Record<string, unknown>).value = { hun: { phone: true, email: false } }; },
    (candidate) => { (candidate.auth_policy_overrides as Record<string, unknown>).value = { ZZZ: { phone: true, email: false } }; },
    (candidate) => { (candidate.phone_dial_codes_default as Record<string, unknown>).value = ["1", "1"]; },
    (candidate) => { (candidate.phone_dial_codes_default as Record<string, unknown>).value = ["+1"]; },
    (candidate) => { (candidate.phone_dial_codes_default as Record<string, unknown>).value = [1]; },
    (candidate) => { (candidate.phone_dial_codes_default as Record<string, unknown>).value = ["999"]; },
    (candidate) => { (candidate.phone_dial_formats as Record<string, unknown>).value = {}; },
    (candidate) => { (candidate.phone_dial_formats as Record<string, unknown>).value = [{ code: "1" }]; },
    (candidate) => { (candidate.phone_dial_formats as Record<string, unknown>).value = [{ code: "+1", mask: "***" }]; },
    (candidate) => { (candidate.phone_dial_formats as Record<string, unknown>).value = [{ code: "0", mask: "***" }]; },
    (candidate) => { (candidate.phone_dial_formats as Record<string, unknown>).value = [{ code: "01", mask: "***" }]; },
    (candidate) => { (candidate.phone_dial_formats as Record<string, unknown>).value = [{ code: 1, mask: "***" }]; },
    (candidate) => { (candidate.phone_dial_formats as Record<string, unknown>).value = [{ code: "1234", mask: "***" }]; },
    (candidate) => { (candidate.phone_dial_formats as Record<string, unknown>).value = [{ code: "1\n", mask: "***" }]; },
    (candidate) => { (candidate.phone_dial_formats as Record<string, unknown>).value = [{ code: "1", mask: "" }]; },
    (candidate) => { (candidate.phone_dial_formats as Record<string, unknown>).value = [{ code: "1", mask: "+***" }]; },
    (candidate) => {
      (candidate.phone_dial_formats as Record<string, unknown>).value = [
        { code: "1", mask: "***" },
        { code: "1", mask: "****" },
      ];
    },
    (candidate) => { (candidate.auth_policy_revision as Record<string, unknown>).value = 0; },
    (candidate) => { (candidate.auth_policy_revision as Record<string, unknown>).value = 1.5; },
    (candidate) => { (candidate.auth_policy_revision as Record<string, unknown>).value = "7"; },
    (candidate) => { (candidate.auth_policy_revision as Record<string, unknown>).updated_by = " Policy@friending.com "; },
    (candidate) => { (candidate.auth_policy_revision as Record<string, unknown>).updated_at = -1; },
    (candidate) => { (candidate.auth_policy_revision as Record<string, unknown>).allowed_values = ["x", "x"]; },
    (candidate) => { (candidate.auth_policy_revision as Record<string, unknown>).type = "Integer"; },
    (candidate) => { (candidate.auth_policy_revision as Record<string, unknown>).maximum = null; },
    (candidate) => { (candidate.auth_policy_default as Record<string, unknown>).type = "json"; },
    (candidate) => { (candidate.auth_policy_default as Record<string, unknown>).minimum = 0; },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(settings());
    mutate(candidate);
    assert.equal(authPolicySettingsResponse(success(candidate)), null, JSON.stringify(candidate));
  }

  const envelope = success();
  for (const key of Object.keys(envelope)) {
    const candidate = structuredClone(envelope);
    delete candidate[key];
    assert.equal(authPolicySettingsResponse(candidate), null, `missing envelope ${key}`);
  }
  assert.deepEqual(
    authPolicySettingsResponse({ ...envelope, extra: true }),
    authPolicySettingsResponse(envelope),
  );
});

test("draft validation blocks unsafe defaults, incomplete rows, duplicates and unknown calling codes", () => {
  const noMethod = parsed();
  noMethod.defaultMethods = { phone: false, email: false };
  assert.equal(authPolicyDraftIssue(noMethod), "noMethod");
  assert.equal(authPolicySavePayload(noMethod), null);

  const incomplete = parsed();
  incomplete.methodOverrides.push({ storefront: "", phone: true, email: false });
  assert.equal(authPolicyDraftIssue(incomplete), "storefront");

  const duplicate = parsed();
  duplicate.methodOverrides.push({ storefront: "USA", phone: false, email: false });
  assert.equal(authPolicyDraftIssue(duplicate), "duplicateStorefront");

  const emptyDial = parsed();
  emptyDial.defaultDialCodes = [];
  assert.equal(authPolicyDraftIssue(emptyDial), null);
  assert.deepEqual(authPolicySavePayload(emptyDial)?.phone_dial_codes_default, []);

  const unknownDial = parsed();
  unknownDial.defaultDialCodes = ["999"];
  assert.equal(authPolicyDraftIssue(unknownDial), "dialCodes");

  const duplicateDialStorefront = parsed();
  duplicateDialStorefront.dialCodeOverrides.push({ storefront: "USA", dialCodes: "ALL" });
  assert.equal(authPolicyDraftIssue(duplicateDialStorefront), "duplicateStorefront");

  const invalidFormatCode = parsed();
  invalidFormatCode.phoneDialFormats[0] = { code: "1234", mask: "***" };
  assert.equal(authPolicyDraftIssue(invalidFormatCode), "dialFormatCode");

  const duplicateFormat = parsed();
  duplicateFormat.phoneDialFormats.push({ code: "1", mask: "***-****" });
  assert.equal(authPolicyDraftIssue(duplicateFormat), "duplicateDialFormat");
  assert.equal(authPolicySavePayload(duplicateFormat), null);

  const invalidFormatMask = parsed();
  invalidFormatMask.phoneDialFormats[0] = { code: "1", mask: "+***" };
  assert.equal(authPolicyDraftIssue(invalidFormatMask), "dialFormatMask");
  assert.equal(authPolicySavePayload(invalidFormatMask), null);

  const stale = parsed();
  stale.revision = 0;
  assert.equal(authPolicyDraftIssue(stale), "revision");
});

test("removing an allowed calling code keeps its phone mask inert on the save wire", () => {
  const value = parsed();
  value.defaultDialCodes = ["36"];
  value.dialCodeOverrides = value.dialCodeOverrides.map((row) => (
    row.storefront === "USA" ? { ...row, dialCodes: [] } : row
  ));
  assert.equal(authPolicyDraftIssue(value), null);
  const payload = authPolicySavePayload(value);
  assert.ok(payload);
  assert.deepEqual(payload.phone_dial_codes_default, ["36"]);
  assert.deepEqual(payload.phone_dial_formats, [
    { code: "1", mask: "(***) *** ****" },
    { code: "36", mask: "**/*** ****" },
  ]);
});

test("the same-origin proxy closes the five editable values and rejects server-owned revision input", () => {
  const authPolicy = authPolicySavePayload(parsed());
  assert.ok(authPolicy);
  const body = {
    settings: {
      people_hero_enabled: true,
      ...authPolicy,
    },
  };
  const normalized = normalizeAuthPolicySettingsProxyBody("set_settings", body);
  assert.ok(normalized);
  assert.equal(Object.getPrototypeOf(normalized), null);
  assert.deepEqual(JSON.parse(JSON.stringify(normalized)), body);
  assert.equal(normalizeAuthPolicySettingsProxyBody("get_settings", {}), undefined);
  assert.deepEqual(
    JSON.parse(JSON.stringify(normalizeAuthPolicySettingsProxyBody("set_settings", {
      settings: { people_hero_enabled: false },
    }))),
    { settings: { people_hero_enabled: false } },
  );

  for (const key of AUTH_POLICY_EDITABLE_SETTING_KEYS) {
    const candidate = structuredClone(body);
    delete candidate.settings[key];
    assert.equal(normalizeAuthPolicySettingsProxyBody("set_settings", candidate), null);
  }
  assert.equal(normalizeAuthPolicySettingsProxyBody("set_settings", {
    settings: { ...body.settings, auth_policy_revision: 7 },
  }), null);
  assert.equal(normalizeAuthPolicySettingsProxyBody("set_settings", { ...body, admin_email: "x" }), null);
  assert.equal(normalizeAuthPolicySettingsProxyBody("set_settings", {
    settings: { ...body.settings, auth_policy_default: { phone: false, email: false } },
  }), null);
  assert.equal(normalizeAuthPolicySettingsProxyBody("set_settings", {
    settings: { ...body.settings, phone_dial_codes_default: ["+1"] },
  }), null);
  assert.equal(normalizeAuthPolicySettingsProxyBody("set_settings", {
    settings: {
      ...body.settings,
      phone_dial_formats: [
        { code: "1", mask: "***" },
        { code: "1", mask: "****" },
      ],
    },
  }), null);
});

test("Core phone-format refusals require setting-invalid and the ruled dotted field paths", () => {
  function refusal(field: unknown, error = "setting-invalid", statusCode = 422) {
    return {
      success: false,
      status_code: statusCode,
      error,
      field,
      message: 200,
      status: 200,
      can_send: 0,
    };
  }

  assert.deepEqual(phoneDialFormatRefusal(refusal("phone_dial_formats")), {
    field: "phone_dial_formats",
    index: null,
  });
  assert.deepEqual(phoneDialFormatRefusal(refusal("phone_dial_formats.0.code")), {
    field: "code",
    index: 0,
  });
  assert.deepEqual(phoneDialFormatRefusal(refusal("phone_dial_formats.12.mask")), {
    field: "mask",
    index: 12,
  });
  assert.deepEqual(phoneDialFormatRefusal(refusal("phone_dial_formats.999.mask")), {
    field: "mask",
    index: 999,
  });
  assert.deepEqual(
    phoneDialFormatRefusal({ ...refusal("phone_dial_formats.0.mask"), extra: true }),
    phoneDialFormatRefusal(refusal("phone_dial_formats.0.mask")),
  );
  for (const candidate of [
    refusal("phone_dial_formats[0].mask"),
    refusal("phone_dial_formats.01.mask"),
    refusal("phone_dial_formats.-1.code"),
    refusal("phone_dial_formats.9007199254740992.mask"),
    refusal("phone_dial_formats.0.value"),
    refusal("phone_dial_formats.0.mask\n"),
    refusal("phone_dial_formats.0.mask", "settings-invalid"),
    refusal("phone_dial_formats.0.mask", "setting-invalid", 400),
  ]) {
    assert.equal(phoneDialFormatRefusal(candidate), null, JSON.stringify(candidate));
  }
});

test("the maximal bounded policy fits the named settings bridge ceiling", async () => {
  const { adminActionBodyLimit } = await import("../lib/adminActions.ts");
  const allDialCodes = [...new Set(AUTH_POLICY_COUNTRIES.flatMap((country) => country.dialCodes))];
  const maximal = authPolicySavePayload({
    defaultMethods: { phone: true, email: true },
    methodOverrides: AUTH_POLICY_COUNTRIES.map((country) => ({
      storefront: country.alpha3,
      phone: true,
      email: true,
    })),
    defaultDialCodes: [...allDialCodes],
    dialCodeOverrides: AUTH_POLICY_COUNTRIES.map((country) => ({
      storefront: country.alpha3,
      dialCodes: [...allDialCodes],
    })),
    phoneDialFormats: allDialCodes.map((code) => ({ code, mask: "*".repeat(32) })),
    revision: Number.MAX_SAFE_INTEGER,
    updatedAt: 0,
    updatedBy: "",
  });
  assert.ok(maximal);
  const bytes = Buffer.byteLength(JSON.stringify({ settings: maximal }), "utf8");
  assert.ok(bytes > 256_000, "the raised ceiling must remain justified");
  assert.ok(bytes < adminActionBodyLimit("set_settings"));
  assert.equal(adminActionBodyLimit("set_settings"), 400_000);
});

test("the Configuration page uses one audited settings mutation and renders immutable Apple plus previews", async () => {
  const [page, card, proxy, en, hu] = await Promise.all([
    readFile(new URL("../app/(dashboard)/configuration/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/AuthPolicyConfigurationCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../messages/en.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../messages/hu.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.equal(page.match(/adminCall\("set_settings"/g)?.length, 1);
  assert.match(page, /authPolicySavePayload\(authPolicy\)/);
  assert.match(page, /commitSettings\(authPolicyPayload, "authPolicy"\)/);
  assert.match(page, /setAuthPolicy\(saved\.authPolicy\)/);
  assert.match(card, /<input type="checkbox" checked disabled readOnly \/>/);
  assert.equal(card.match(/<MethodPreview/g)?.length, 2);
  assert.match(card, /localizedAuthPolicyCountries\(locale\)/);
  assert.match(card, /phoneDialFormatMask\(formats, code\)/);
  assert.match(card, /renderPhoneDialFormatSample\(code, mask\)/);
  assert.match(card, /updatePhoneDialFormat\(value\.phoneDialFormats, code, mask\)/);
  assert.match(card, /data-format-code=\{code\}/);
  assert.match(page, /phoneDialFormatRefusal\(response\)/);
  assert.match(proxy, /normalizeAuthPolicySettingsProxyBody\(action, body\)/);
  for (const key of [
    "savePolicy",
    "saved",
    "writeRequired",
    "saveError",
    "noCallingCodes",
    "dialFormatHelp",
    "dialFormatLabel",
    "dialFormatSample",
    "dialFormatInvalid",
  ] as const) {
    assert.equal(typeof en.configuration.authPolicy[key], "string", `missing EN ${key}`);
    assert.equal(typeof hu.configuration.authPolicy[key], "string", `missing HU ${key}`);
  }

  function keyTree(value: unknown): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, keyTree(child)]));
  }
  assert.deepEqual(keyTree(en.configuration.authPolicy), keyTree(hu.configuration.authPolicy));
});
