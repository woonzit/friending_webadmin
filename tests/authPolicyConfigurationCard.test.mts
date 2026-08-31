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
    defaultDialCodes: ["1", "36"],
    dialCodeOverrides: [],
    phoneDialFormats,
    revision: 7,
    updatedAt: 1_777_000_007,
    updatedBy: "policy-admin@friending.com",
  };
}

function render(value: AuthPolicyConfiguration): string {
  return renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale: "en", messages, timeZone: "UTC" },
    createElement(AuthPolicyConfigurationCard, {
      value,
      busy: false,
      onSave() {},
      onChange() {},
    }),
  ));
}

test("every explicitly allowed calling-code chip renders its shared mask input and live sample", () => {
  const html = render(policy([{ code: "1", mask: "(***) *** ****" }]));
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
      auth_policy_default: managed({ phone: true, email: true }, "auth_policy"),
      auth_policy_overrides: managed({}, "auth_policy_overrides"),
      phone_dial_codes_default: managed(["1", "36"], "phone_dial_codes"),
      phone_dial_codes_overrides: managed({}, "phone_dial_codes_overrides"),
      phone_dial_formats: managed([{ code: "1", mask: "(***) *** ****" }], "phone_dial_formats"),
      auth_policy_revision: managed(7, "integer", 1_777_000_007),
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
