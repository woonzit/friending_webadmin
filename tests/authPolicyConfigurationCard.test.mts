import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import AuthPolicyConfigurationCard from "../components/AuthPolicyConfigurationCard.tsx";
import {
  authPolicySettingsResponse,
  type AuthPolicyConfiguration,
} from "../lib/authPolicyConfiguration.ts";

const messages = JSON.parse(readFileSync(
  new URL("../messages/en.json", import.meta.url),
  "utf8",
));

function policy(phoneDialFormats: AuthPolicyConfiguration["phoneDialFormats"]): AuthPolicyConfiguration {
  return {
    defaultMethods: { phone: true, email: true },
    methodOverrides: [],
    defaultRegions: ["HU", "US"],
    regionOverrides: [],
    phoneDialFormats,
    vocabulary: {
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
    },
    vocabularyWarnings: [],
    revision: 7,
    updatedAt: 1_777_000_007,
    updatedBy: "policy-admin@friending.com",
  };
}

function render(value: AuthPolicyConfiguration, conflictRevision: number | null = null): string {
  return renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale: "en", messages, timeZone: "UTC" },
    createElement(AuthPolicyConfigurationCard, {
      value,
      busy: false,
      conflictRevision,
      onSave() {},
      onChange() {},
    }),
  ));
}

test("selected countries render by country while their derived codes share mask inputs", () => {
  const html = render(policy([{ code: "1", mask: "(***) *** ****" }]));
  assert.match(html, /Hungary/);
  assert.match(html, /HU · \+36/);
  assert.match(html, /United States/);
  assert.match(html, /US · \+1/);
  assert.equal(html.match(/data-format-code=/g)?.length, 2);
  assert.match(html, /data-format-code="1"/);
  assert.match(html, /value="\(\*\*\*\) \*\*\* \*\*\*\*"/);
  assert.match(html, /Live sample: \(212\) 555 0134/);
  assert.match(html, /data-format-code="36"/);
  assert.match(html, /placeholder="Automatic formatting"/);
  assert.match(html, /No override — the app formats this code automatically\./);
});

test("an invalid non-empty mask renders an inline field error and no sample", () => {
  const html = render(policy([{ code: "1", mask: "+***" }]));
  assert.match(html, /data-format-code="1"/);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Use 1–32 characters/);
  assert.doesNotMatch(html, /Live sample:/);
});

test("stale vocabulary values and a CAS reload remain visible and explicitly flagged", () => {
  const value = policy([{ code: "999", mask: "***" }]);
  value.methodOverrides = [{ storefront: "ZZZ", phone: true, email: false }];
  value.defaultRegions = ["ZZ"];
  value.vocabularyWarnings = [
    { setting: "auth_policy_overrides", codes: ["ZZZ"] },
    { setting: "phone_dial_codes_default", codes: ["999"] },
    { setting: "phone_dial_formats", codes: ["999"] },
    { setting: "phone_regions_default", codes: ["ZZ"] },
  ];
  const html = render(value, 8);
  assert.match(html, /Revision 8 is now current/);
  assert.match(html, /Unsupported storefront · ZZZ/);
  assert.match(html, /value="ZZZ" selected=""/);
  assert.match(html, /Unsupported country · ZZ/);
  assert.match(html, /data-format-code="999"/);
  assert.match(html, /\+999 is outside Core&#x27;s current calling-code vocabulary/);
  assert.match(html, /must be replaced before saving: 999, ZZ, ZZZ/);
});

test("an additive managed-setting row still decodes and renders the same card", () => {
  function managed(value: unknown, type: string, updatedAt = 1_777_000_000) {
    return {
      value,
      type,
      allowed_values: [],
      minimum: type === "integer" ? 1 : null,
      maximum: type === "integer" ? 9_223_372_036_854_776_000 : null,
      updated_at: updatedAt,
      updated_by: "policy-admin@friending.com",
    };
  }
  const base = {
    success: true,
    status_code: 200,
    settings: {
      auth_policy_default: { ...managed({ phone: true, email: true }, "auth_policy"), warning: false, invalid_codes: [] },
      auth_policy_overrides: { ...managed({}, "auth_policy_overrides"), warning: false, invalid_codes: [] },
      phone_dial_codes_default: { ...managed(["1", "36"], "phone_dial_codes"), warning: false, invalid_codes: [] },
      phone_dial_codes_overrides: { ...managed({}, "phone_dial_codes_overrides"), warning: false, invalid_codes: [] },
      phone_dial_formats: { ...managed([{ code: "1", mask: "(***) *** ****" }], "phone_dial_formats"), warning: false, invalid_codes: [] },
      phone_regions_default: { ...managed(["HU", "US"], "phone_regions"), warning: false, invalid_codes: [] },
      phone_regions_overrides: { ...managed({}, "phone_regions_overrides"), warning: false, invalid_codes: [] },
      auth_policy_revision: managed(7, "integer", 1_777_000_007),
    },
    vocabulary: {
      storefronts: [
        { alpha3: "CAN", name_en: "Canada", name_hu: "Kanada" },
        { alpha3: "HUN", name_en: "Hungary", name_hu: "Magyarország" },
        { alpha3: "USA", name_en: "United States", name_hu: "Egyesült Államok" },
      ],
      calling_codes: [
        { code: "1", example_alpha3: "USA" },
        { code: "36", example_alpha3: "HUN" },
      ],
      regions: [
        { alpha2: "CA", alpha3: "CAN", calling_code: "1" },
        { alpha2: "HU", alpha3: "HUN", calling_code: "36" },
        { alpha2: "US", alpha3: "USA", calling_code: "1" },
      ],
    },
    message: 200,
    status: 200,
    can_send: 0,
  };
  const additive = structuredClone(base);
  Object.assign(additive.settings.auth_policy_default, { deprecated_at: null });
  const baseline = authPolicySettingsResponse(base);
  const decoded = authPolicySettingsResponse(additive);
  assert.ok(baseline && decoded);
  assert.deepEqual(decoded, baseline);
  assert.equal(render(decoded), render(baseline));
  assert.match(render(decoded), /Authentication policy/);
});
