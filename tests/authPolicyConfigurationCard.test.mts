import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import AuthPolicyConfigurationCard from "../components/AuthPolicyConfigurationCard.tsx";
import type { AuthPolicyConfiguration } from "../lib/authPolicyConfiguration.ts";

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
