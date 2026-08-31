import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  AUTH_POLICY_EDITABLE_SETTING_KEYS,
  AUTH_POLICY_SETTING_KEYS,
  PHONE_DIAL_FORMAT_MAX_LENGTH,
  authPolicyConflict,
  authPolicyDialCodesForRegions,
  authPolicyDraftAfterConflict,
  authPolicyDraftIssue,
  authPolicyDraftWithChanges,
  authPolicySavePayload,
  authPolicySettingsResponse,
  authPolicyVocabularyResponse,
  localizedAuthPolicyCallingCodes,
  localizedAuthPolicyRegions,
  localizedAuthPolicyStorefronts,
  normalizeAuthPolicySettingsProxyBody,
  phoneDialFormatMask,
  phoneDialFormatRefusal,
  phoneDialMaskValid,
  phoneRegionRefusal,
  renderPhoneDialFormatSample,
  updatePhoneDialFormat,
  type AuthPolicyConfiguration,
  type AuthPolicyVocabulary,
} from "../lib/authPolicyConfiguration.ts";

const TEST_VOCABULARY: AuthPolicyVocabulary = {
  storefronts: [
    { alpha3: "CAN", nameEn: "Canada", nameHu: "Kanada" },
    { alpha3: "HUN", nameEn: "Hungary", nameHu: "Magyarország" },
    { alpha3: "USA", nameEn: "United States", nameHu: "Egyesült Államok" },
  ],
  callingCodes: [
    { code: "1", exampleAlpha3: "USA" },
    { code: "36", exampleAlpha3: "HUN" },
  ],
  regions: [
    { alpha2: "CA", alpha3: "CAN", callingCode: "1" },
    { alpha2: "HU", alpha3: "HUN", callingCode: "36" },
    { alpha2: "US", alpha3: "USA", callingCode: "1" },
  ],
};

function wireVocabulary(value: AuthPolicyVocabulary = TEST_VOCABULARY): Record<string, unknown> {
  return {
    storefronts: value.storefronts.map((row) => ({
      alpha3: row.alpha3,
      name_en: row.nameEn,
      name_hu: row.nameHu,
    })),
    calling_codes: value.callingCodes.map((row) => ({
      code: row.code,
      example_alpha3: row.exampleAlpha3,
    })),
    regions: value.regions.map((row) => ({
      alpha2: row.alpha2,
      alpha3: row.alpha3,
      calling_code: row.callingCode,
    })),
  };
}

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
    ...(type === "integer" ? {} : { warning: false, invalid_codes: [] }),
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
    phone_regions_default: setting(["US", "HU"], "phone_regions"),
    phone_regions_overrides: setting(
      { USA: ["US"], HUN: "ALL" },
      "phone_regions_overrides",
    ),
    auth_policy_revision: setting(7, "integer", 1_777_000_007),
  };
}

function success(policySettings: Record<string, unknown> = settings()): Record<string, unknown> {
  return {
    success: true,
    status_code: 200,
    settings: policySettings,
    vocabulary: wireVocabulary(),
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

test("Core's storefront, calling-code and region vocabulary drives every localized picker", () => {
  const response = success();
  assert.deepEqual(authPolicyVocabularyResponse(response), TEST_VOCABULARY);
  const en = new Map(localizedAuthPolicyStorefronts(TEST_VOCABULARY, "en")
    .map((country) => [country.alpha3, country.name]));
  const hu = new Map(localizedAuthPolicyStorefronts(TEST_VOCABULARY, "hu")
    .map((country) => [country.alpha3, country.name]));
  assert.equal(en.get("HUN"), "Hungary");
  assert.equal(hu.get("HUN"), "Magyarország");
  assert.equal(en.get("USA"), "United States");
  assert.equal(hu.get("USA"), "Egyesült Államok");
  assert.deepEqual(localizedAuthPolicyCallingCodes(TEST_VOCABULARY, "hu"), [
    { code: "1", exampleAlpha3: "USA", exampleName: "Egyesült Államok" },
    { code: "36", exampleAlpha3: "HUN", exampleName: "Magyarország" },
  ]);
  assert.deepEqual(localizedAuthPolicyRegions(TEST_VOCABULARY, "hu"), [
    { alpha2: "US", alpha3: "USA", callingCode: "1", name: "Egyesült Államok" },
    { alpha2: "CA", alpha3: "CAN", callingCode: "1", name: "Kanada" },
    { alpha2: "HU", alpha3: "HUN", callingCode: "36", name: "Magyarország" },
  ]);
});

test("the Core vocabulary fails closed on malformed, duplicate, unsorted, or additive material", () => {
  const mutations: Array<(candidate: Record<string, any>) => void> = [
    (candidate) => { delete candidate.vocabulary.storefronts; },
    (candidate) => { candidate.vocabulary.future = []; },
    (candidate) => { candidate.vocabulary.storefronts[0].future = true; },
    (candidate) => { candidate.vocabulary.storefronts.reverse(); },
    (candidate) => { candidate.vocabulary.storefronts[2].alpha3 = "HUN"; },
    (candidate) => { candidate.vocabulary.storefronts[0].name_en = " Hungary "; },
    (candidate) => { candidate.vocabulary.calling_codes.reverse(); },
    (candidate) => { candidate.vocabulary.calling_codes[1].code = "1"; },
    (candidate) => { candidate.vocabulary.calling_codes[0].code = "+1"; },
    (candidate) => { candidate.vocabulary.calling_codes[0].example_alpha3 = "GBR"; },
    (candidate) => { delete candidate.vocabulary.regions; },
    (candidate) => { candidate.vocabulary.regions.reverse(); },
    (candidate) => { candidate.vocabulary.regions[0].alpha2 = "hu"; },
    (candidate) => { candidate.vocabulary.regions[0].alpha3 = "USA"; },
    (candidate) => { candidate.vocabulary.regions[0].calling_code = "999"; },
    (candidate) => { candidate.vocabulary.regions[0].future = true; },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(success()) as Record<string, any>;
    mutate(candidate);
    assert.equal(authPolicyVocabularyResponse(candidate), null, JSON.stringify(candidate.vocabulary));
  }
  assert.deepEqual(
    authPolicyVocabularyResponse({ ...success(), future_top_level: true }),
    TEST_VOCABULARY,
  );
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

test("shape-valid stored format codes outside Core's vocabulary remain visible and block resave", () => {
  const candidate = settings();
  (candidate.phone_dial_formats as Record<string, unknown>).value = [
    { code: "999", mask: "***" },
    { code: "1", mask: "(***) *** ****" },
  ];
  (candidate.phone_dial_formats as Record<string, unknown>).warning = true;
  (candidate.phone_dial_formats as Record<string, unknown>).invalid_codes = ["999"];
  const value = authPolicySettingsResponse(success(candidate));
  assert.ok(value);
  assert.deepEqual(value.phoneDialFormats, [
    { code: "1", mask: "(***) *** ****" },
    { code: "999", mask: "***" },
  ]);
  assert.deepEqual(value.vocabularyWarnings, [
    { setting: "phone_dial_formats", codes: ["999"] },
  ]);
  assert.equal(authPolicyDraftIssue(value), "dialFormatCode");
  assert.equal(authPolicySavePayload(value), null);
});

test("all eight managed values parse while one country source writes all seven editable values", () => {
  const value = parsed();
  assert.deepEqual(value, {
    defaultMethods: { phone: true, email: true },
    methodOverrides: [
      { storefront: "HUN", phone: false, email: true },
      { storefront: "USA", phone: true, email: false },
    ],
    defaultRegions: ["HU", "US"],
    regionOverrides: [
      { storefront: "HUN", regions: "ALL" },
      { storefront: "USA", regions: ["US"] },
    ],
    phoneDialFormats: [
      { code: "1", mask: "(***) *** ****" },
      { code: "36", mask: "**/*** ****" },
    ],
    vocabulary: TEST_VOCABULARY,
    vocabularyWarnings: [],
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
    phone_regions_default: ["HU", "US"],
    phone_regions_overrides: { HUN: "ALL", USA: ["US"] },
  });
});

test("fresh environment-derived settings accept only Core's exact PHP empty-map wire ambiguity", () => {
  const fresh = settings();
  (fresh.auth_policy_default as Record<string, unknown>).value = { phone: true, email: false };
  (fresh.auth_policy_overrides as Record<string, unknown>).value = [];
  (fresh.phone_dial_codes_default as Record<string, unknown>).value = "ALL";
  (fresh.phone_dial_codes_overrides as Record<string, unknown>).value = [];
  (fresh.phone_dial_formats as Record<string, unknown>).value = [];
  (fresh.phone_regions_default as Record<string, unknown>).value = "ALL";
  (fresh.phone_regions_overrides as Record<string, unknown>).value = [];
  (fresh.auth_policy_revision as Record<string, unknown>).value = 1;
  for (const row of Object.values(fresh)) {
    (row as Record<string, unknown>).updated_at = 0;
    (row as Record<string, unknown>).updated_by = "";
  }
  assert.deepEqual(authPolicySettingsResponse(success(fresh)), {
    defaultMethods: { phone: true, email: false },
    methodOverrides: [],
    defaultRegions: "ALL",
    regionOverrides: [],
    phoneDialFormats: [],
    vocabulary: TEST_VOCABULARY,
    vocabularyWarnings: [],
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
    (candidate) => { (candidate.phone_regions_default as Record<string, unknown>).value = { HU: true }; },
    (candidate) => { (candidate.phone_regions_default as Record<string, unknown>).value = ["hu"]; },
    (candidate) => { (candidate.phone_regions_default as Record<string, unknown>).value = ["HU", "HU"]; },
    (candidate) => { (candidate.phone_regions_overrides as Record<string, unknown>).value = [{ HUN: ["HU"] }]; },
    (candidate) => { (candidate.phone_regions_overrides as Record<string, unknown>).value = { HU: ["HU"] }; },
    (candidate) => { (candidate.phone_regions_overrides as Record<string, unknown>).value = { HUN: ["hu"] }; },
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

test("draft validation blocks unsafe defaults, incomplete rows, duplicates and unknown countries", () => {
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

  const emptyCountries = parsed();
  emptyCountries.defaultRegions = [];
  assert.equal(authPolicyDraftIssue(emptyCountries), null);
  assert.deepEqual(authPolicySavePayload(emptyCountries)?.phone_regions_default, []);
  assert.deepEqual(authPolicySavePayload(emptyCountries)?.phone_dial_codes_default, []);

  const unknownCountry = parsed();
  unknownCountry.defaultRegions = ["ZZ"];
  assert.equal(authPolicyDraftIssue(unknownCountry), "regions");

  const duplicateRegionStorefront = parsed();
  duplicateRegionStorefront.regionOverrides.push({ storefront: "USA", regions: "ALL" });
  assert.equal(authPolicyDraftIssue(duplicateRegionStorefront), "duplicateStorefront");

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

test("removing an allowed country derives both families and keeps its phone mask inert", () => {
  const value = parsed();
  value.defaultRegions = ["HU"];
  value.regionOverrides = value.regionOverrides.map((row) => (
    row.storefront === "USA" ? { ...row, regions: [] } : row
  ));
  assert.equal(authPolicyDraftIssue(value), null);
  const payload = authPolicySavePayload(value);
  assert.ok(payload);
  assert.deepEqual(payload.phone_dial_codes_default, ["36"]);
  assert.deepEqual(payload.phone_regions_default, ["HU"]);
  assert.deepEqual(payload.phone_dial_codes_overrides, { HUN: "ALL", USA: [] });
  assert.deepEqual(payload.phone_regions_overrides, { HUN: "ALL", USA: [] });
  assert.deepEqual(payload.phone_dial_formats, [
    { code: "1", mask: "(***) *** ****" },
    { code: "36", mask: "**/*** ****" },
  ]);
});

test("every country-control save path derives matching region and calling-code families", () => {
  const value = parsed();
  assert.deepEqual(authPolicyDialCodesForRegions(["US", "HU"], value.vocabulary), ["1", "36"]);

  value.defaultRegions = ["US"];
  let payload = authPolicySavePayload(value);
  assert.ok(payload);
  assert.deepEqual(payload.phone_regions_default, ["US"]);
  assert.deepEqual(payload.phone_dial_codes_default, ["1"]);

  value.regionOverrides = [
    { storefront: "HUN", regions: ["HU"] },
    { storefront: "USA", regions: ["HU", "US"] },
  ];
  payload = authPolicySavePayload(value);
  assert.ok(payload);
  assert.deepEqual(payload.phone_regions_overrides, { HUN: ["HU"], USA: ["HU", "US"] });
  assert.deepEqual(payload.phone_dial_codes_overrides, { HUN: ["36"], USA: ["1", "36"] });

  value.regionOverrides = [
    { storefront: "HUN", regions: ["HU", "US"] },
    { storefront: "USA", regions: ["US"] },
  ];
  payload = authPolicySavePayload(value);
  assert.ok(payload);
  assert.deepEqual(payload.phone_regions_overrides, { HUN: ["HU", "US"], USA: ["US"] });
  assert.deepEqual(payload.phone_dial_codes_overrides, { HUN: ["1", "36"], USA: ["1"] });
});

test("stored unknown values remain visible until the country control replaces both families", () => {
  const candidate = settings();
  (candidate.phone_dial_codes_default as Record<string, unknown>).value = ["999"];
  (candidate.phone_dial_codes_default as Record<string, unknown>).warning = true;
  (candidate.phone_dial_codes_default as Record<string, unknown>).invalid_codes = ["999"];
  (candidate.phone_regions_default as Record<string, unknown>).value = ["ZZ"];
  (candidate.phone_regions_default as Record<string, unknown>).warning = true;
  (candidate.phone_regions_default as Record<string, unknown>).invalid_codes = ["ZZ"];
  const value = authPolicySettingsResponse(success(candidate));
  assert.ok(value);
  assert.deepEqual(value.defaultRegions, ["ZZ"]);
  assert.deepEqual(value.vocabularyWarnings, [
    { setting: "phone_dial_codes_default", codes: ["999"] },
    { setting: "phone_regions_default", codes: ["ZZ"] },
  ]);
  const unrelatedEdit = authPolicyDraftWithChanges(value, {
    defaultMethods: { phone: true, email: false },
  });
  assert.deepEqual(unrelatedEdit.vocabularyWarnings, value.vocabularyWarnings);
  assert.equal(authPolicySavePayload(unrelatedEdit), null);

  const replaced = authPolicyDraftWithChanges(unrelatedEdit, { defaultRegions: ["HU"] });
  assert.deepEqual(replaced.vocabularyWarnings, []);
  assert.deepEqual(authPolicySavePayload(replaced)?.phone_regions_default, ["HU"]);
  assert.deepEqual(authPolicySavePayload(replaced)?.phone_dial_codes_default, ["36"]);
});

test("the same-origin proxy closes all seven editable values and rejects server-owned revision input", () => {
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
  assert.deepEqual(
    JSON.parse(JSON.stringify(normalizeAuthPolicySettingsProxyBody("set_settings", {
      ...body,
      expected_revision: 7,
    }))),
    { ...body, expected_revision: 7 },
  );
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
  assert.equal(normalizeAuthPolicySettingsProxyBody("set_settings", {
    settings: { people_hero_enabled: false },
    expected_revision: 7,
  }), null);
  assert.equal(normalizeAuthPolicySettingsProxyBody("set_settings", {
    ...body,
    expected_revision: 0,
  }), null);
  assert.equal(normalizeAuthPolicySettingsProxyBody("set_settings", {
    ...body,
    expected_revision: "7",
  }), null);
  assert.equal(normalizeAuthPolicySettingsProxyBody("set_settings", { ...body, admin_email: "x" }), null);
  assert.equal(normalizeAuthPolicySettingsProxyBody("set_settings", {
    settings: { ...body.settings, auth_policy_default: { phone: false, email: false } },
  }), null);
  assert.equal(normalizeAuthPolicySettingsProxyBody("set_settings", {
    settings: { ...body.settings, phone_dial_codes_default: ["+1"] },
  }), null);
  assert.equal(normalizeAuthPolicySettingsProxyBody("set_settings", {
    settings: { ...body.settings, phone_regions_default: "ALL" },
  }), null);
  assert.equal(normalizeAuthPolicySettingsProxyBody("set_settings", {
    settings: { ...body.settings, phone_regions_overrides: { HUN: "ALL" } },
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

test("a ruled CAS conflict reloads the authoritative revision without losing the operator draft", () => {
  function conflict(currentRevision: unknown, error = "auth-policy-conflict", statusCode = 409) {
    return {
      success: false,
      status_code: statusCode,
      error,
      current_revision: currentRevision,
      message: 200,
      status: 200,
      can_send: 0,
    };
  }

  assert.deepEqual(authPolicyConflict(conflict(8)), { currentRevision: 8 });
  for (const candidate of [
    conflict(0),
    conflict("8"),
    conflict(8, "setting-invalid"),
    conflict(8, "auth-policy-conflict", 422),
    { ...conflict(8), current_revision: 8.5 },
  ]) assert.equal(authPolicyConflict(candidate), null);

  const draft = parsed();
  draft.defaultMethods = { phone: false, email: true };
  draft.defaultRegions = ["HU"];
  const authoritative = parsed();
  authoritative.revision = 8;
  authoritative.updatedAt = 1_777_000_008;
  authoritative.defaultMethods = { phone: true, email: false };
  authoritative.defaultRegions = ["US"];
  const rebased = authPolicyDraftAfterConflict(draft, authoritative, { currentRevision: 8 });
  assert.ok(rebased);
  assert.deepEqual(rebased.defaultMethods, { phone: false, email: true });
  assert.deepEqual(rebased.defaultRegions, ["HU"]);
  assert.equal(rebased.revision, 8);
  assert.equal(rebased.updatedAt, 1_777_000_008);

  const staleDraft = parsed();
  staleDraft.vocabularyWarnings = [
    { setting: "phone_dial_codes_default", codes: ["999"] },
  ];
  const staleRebased = authPolicyDraftAfterConflict(
    authPolicyDraftWithChanges(staleDraft, {
      defaultMethods: { phone: false, email: true },
    }),
    authoritative,
    { currentRevision: 8 },
  );
  assert.ok(staleRebased);
  assert.deepEqual(staleRebased.vocabularyWarnings, staleDraft.vocabularyWarnings);
  assert.equal(authPolicySavePayload(staleRebased), null);

  assert.equal(authPolicyDraftAfterConflict(draft, { ...authoritative, revision: 7 }, {
    currentRevision: 8,
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

test("Core phone-region refusals require setting-invalid and only accepted dotted paths", () => {
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
  assert.deepEqual(phoneRegionRefusal(refusal("phone_regions_default")), {
    setting: "phone_regions_default",
    storefront: null,
    index: null,
  });
  assert.deepEqual(phoneRegionRefusal(refusal("phone_regions_default.0")), {
    setting: "phone_regions_default",
    storefront: null,
    index: 0,
  });
  assert.deepEqual(phoneRegionRefusal(refusal("phone_regions_overrides.HUN")), {
    setting: "phone_regions_overrides",
    storefront: "HUN",
    index: null,
  });
  assert.deepEqual(phoneRegionRefusal(refusal("phone_regions_overrides.HUN.12")), {
    setting: "phone_regions_overrides",
    storefront: "HUN",
    index: 12,
  });
  for (const candidate of [
    refusal("phone_regions_default[0]"),
    refusal("phone_regions_default.01"),
    refusal("phone_regions_overrides.HU"),
    refusal("phone_regions_overrides.hun.0"),
    refusal("phone_regions_overrides.HUN.0.extra"),
    refusal("phone_regions_default", "settings-invalid"),
    refusal("phone_regions_default", "setting-invalid", 400),
  ]) assert.equal(phoneRegionRefusal(candidate), null, JSON.stringify(candidate));
});

test("the maximal bounded policy fits the named settings bridge ceiling", async () => {
  const { adminActionBodyLimit } = await import("../lib/adminActions.ts");
  const vocabularyFixture = JSON.parse(await readFile(
    new URL("./fixtures/auth_policy_wire/webadmin-vocabulary-clean.json", import.meta.url),
    "utf8",
  ));
  const fullVocabulary = authPolicyVocabularyResponse(vocabularyFixture);
  assert.ok(fullVocabulary);
  assert.equal(fullVocabulary.storefronts.length, 249);
  assert.equal(fullVocabulary.callingCodes.length, 205);
  assert.equal(fullVocabulary.regions.length, 249);
  const allDialCodes = fullVocabulary.callingCodes.map((entry) => entry.code);
  const allRegions = fullVocabulary.regions.map((entry) => entry.alpha2);
  assert.deepEqual(authPolicyDialCodesForRegions(["BS", "US"], fullVocabulary), ["1"]);
  assert.equal(authPolicyDialCodesForRegions(allRegions, fullVocabulary), "ALL");
  const collapsed = authPolicySavePayload({
    defaultMethods: { phone: true, email: true },
    methodOverrides: [],
    defaultRegions: [...allRegions],
    regionOverrides: [{ storefront: "HUN", regions: [...allRegions] }],
    phoneDialFormats: [],
    vocabulary: fullVocabulary,
    vocabularyWarnings: [],
    revision: 1,
    updatedAt: 0,
    updatedBy: "",
  });
  assert.ok(collapsed);
  assert.equal(collapsed.phone_regions_default, "ALL");
  assert.equal(collapsed.phone_dial_codes_default, "ALL");
  assert.deepEqual(collapsed.phone_regions_overrides, { HUN: "ALL" });
  assert.deepEqual(collapsed.phone_dial_codes_overrides, { HUN: "ALL" });
  assert.ok(normalizeAuthPolicySettingsProxyBody("set_settings", {
    settings: collapsed,
    expected_revision: 1,
  }));

  // The true maximum is 248/249 countries: selecting all 249 collapses to ALL.
  // Omit one shared-code region so all 205 derived calling codes remain present.
  const maximalRegions = allRegions.filter((region) => region !== "US");
  assert.equal(maximalRegions.length, 248);
  assert.deepEqual(authPolicyDialCodesForRegions(maximalRegions, fullVocabulary), allDialCodes);
  const maximal = authPolicySavePayload({
    defaultMethods: { phone: true, email: true },
    methodOverrides: fullVocabulary.storefronts.map((storefront) => ({
      storefront: storefront.alpha3,
      phone: true,
      email: true,
    })),
    defaultRegions: [...maximalRegions],
    regionOverrides: fullVocabulary.storefronts.map((storefront) => ({
      storefront: storefront.alpha3,
      regions: [...maximalRegions],
    })),
    phoneDialFormats: allDialCodes.map((code) => ({ code, mask: "*".repeat(32) })),
    vocabulary: fullVocabulary,
    vocabularyWarnings: [],
    revision: Number.MAX_SAFE_INTEGER,
    updatedAt: 0,
    updatedBy: "",
  });
  assert.ok(maximal);
  const bytes = Buffer.byteLength(JSON.stringify({
    settings: maximal,
    expected_revision: Number.MAX_SAFE_INTEGER,
  }), "utf8");
  assert.equal(bytes, 629_851);
  assert.ok(bytes > 256_000, "the raised ceiling must remain justified");
  assert.ok(bytes < adminActionBodyLimit("set_settings"));
  assert.ok(adminActionBodyLimit("set_settings") - bytes >= Math.floor(bytes / 10));
  assert.equal(adminActionBodyLimit("set_settings"), 694_000);
});

test("the Configuration page uses one audited settings mutation and renders immutable Apple plus previews", async () => {
  const [page, card, model, proxy, en, hu] = await Promise.all([
    readFile(new URL("../app/(dashboard)/configuration/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/AuthPolicyConfigurationCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/authPolicyConfiguration.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../messages/en.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../messages/hu.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.equal(page.match(/adminCall\("set_settings"/g)?.length, 1);
  assert.match(page, /authPolicySavePayload\(authPolicy\)/);
  assert.match(page, /commitSettings\(authPolicyPayload, "authPolicy", authPolicy\.revision\)/);
  assert.match(page, /setAuthPolicy\(saved\.authPolicy\)/);
  assert.match(page, /authPolicyConflict\(response\)/);
  assert.match(page, /authPolicyDraftAfterConflict\(currentAuthPolicy, recovered\.authPolicy, conflict\)/);
  assert.match(page, /setAuthPolicyConflictRevision\(rebased\.revision\)/);
  assert.match(card, /<input type="checkbox" checked disabled readOnly \/>/);
  assert.equal(card.match(/<MethodPreview/g)?.length, 2);
  assert.match(card, /localizedAuthPolicyStorefronts\(value\.vocabulary, locale\)/);
  assert.match(card, /localizedAuthPolicyCallingCodes\(value\.vocabulary, locale\)/);
  assert.match(card, /localizedAuthPolicyRegions\(value\.vocabulary, locale\)/);
  assert.doesNotMatch(`${card}\n${model}`, /from ["']countries-list["']/);
  assert.doesNotMatch(`${card}\n${model}`, /e164CallingCode/);
  assert.match(card, /authPolicySelectedCallingCodes\(value\)/);
  assert.match(card, /phoneDialFormatMask\(formats, code\)/);
  assert.match(card, /renderPhoneDialFormatSample\(code, mask\)/);
  assert.match(card, /updatePhoneDialFormat\(value\.phoneDialFormats, code, mask\)/);
  assert.match(card, /data-format-code=\{code\}/);
  assert.match(page, /phoneDialFormatRefusal\(response\)/);
  assert.match(page, /phoneRegionRefusal\(response\)/);
  assert.match(proxy, /normalizeAuthPolicySettingsProxyBody\(action, body\)/);
  for (const key of [
    "savePolicy",
    "saved",
    "writeRequired",
    "saveError",
    "conflictReloaded",
    "vocabularyWarning",
    "unknownStorefront",
    "unknownCallingCode",
    "noCountries",
    "unknownCountry",
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
