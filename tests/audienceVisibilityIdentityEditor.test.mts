import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import AudienceVisibilityIdentityEditor, {
  audienceVisibilityAuditReasonValid,
} from "../components/AudienceVisibilityIdentityEditor.tsx";
import {
  audienceVisibilityMemberDetailResponse,
  type AudienceVisibilityIdentityDraft,
  type AudienceVisibilityMemberDetail,
} from "../lib/audienceVisibilityAdmin.ts";

const MESSAGES = {
  en: JSON.parse(readFileSync(new URL("../messages/en.json", import.meta.url), "utf8")),
  hu: JSON.parse(readFileSync(new URL("../messages/hu.json", import.meta.url), "utf8")),
};

const DETAIL_OPTIONS = [
  { key: "cis_man", label: "Cis man" },
  { key: "trans_man", label: "Trans man" },
];

function member(overrides: Record<string, unknown> = {}): AudienceVisibilityMemberDetail {
  const parsed = audienceVisibilityMemberDetailResponse({
    success: true,
    status_code: 200,
    message: 200,
    status: 200,
    can_send: 0,
    data: {
      contract_version: 1,
      uid: 880124,
      gender: "woman",
      visible_to: "female",
      revision: 2,
      group: {
        id: "000000000000000000000005",
        key: "female_for_female",
        legacy_segment: "female_lesbian",
      },
      identity_revision: 4,
      gender_detail: "trans_woman",
      show_gender_detail: true,
      ...overrides,
    },
  });
  assert.ok(parsed, "the fixture member must decode");
  return parsed;
}

function draft(overrides: Partial<AudienceVisibilityIdentityDraft> = {}): AudienceVisibilityIdentityDraft {
  return {
    gender: "woman",
    gender_detail: "trans_woman",
    visible_to: "female",
    audit_reason: "",
    ...overrides,
  };
}

function render(
  value: AudienceVisibilityMemberDetail,
  current: AudienceVisibilityIdentityDraft,
  locale: "en" | "hu" = "en",
  detailOptions = DETAIL_OPTIONS,
): string {
  return renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale, messages: MESSAGES[locale], timeZone: "UTC" },
    createElement(AudienceVisibilityIdentityEditor, {
      member: value,
      detailOptions,
      draft: current,
      busy: false,
      notice: null,
      onChange() {},
      onSubmit() {},
    }),
  ));
}

function options(markup: string, after: string): string[] {
  const select = markup.slice(markup.indexOf(after));
  const end = select.indexOf("</select>");
  return [...select.slice(0, end).matchAll(/<option value="([^"]*)"/gu)].map((match) => match[1]);
}

test("the gender control offers exactly the two genders D-097 #1 rules on", () => {
  const markup = render(member(), draft());
  assert.deepEqual(options(markup, ">Gender<"), ["woman", "man"]);
  assert.ok(!markup.includes("Nonbinary"), "nonbinary is never offered as an assignment");
  assert.deepEqual(options(markup, ">Detailed gender<"), ["", "cis_man", "trans_man"]);
  assert.deepEqual(options(markup, ">Who can see my profile<"), ["female", "male", "both"]);
});

test("an unresolved member gets an unchosen placeholder and no save until a gender is picked", () => {
  const unresolved = member({ gender: null, visible_to: "both", group: null, gender_detail: null, show_gender_detail: false });
  const markup = render(unresolved, draft({ gender: "", gender_detail: "", visible_to: "both", audit_reason: "Reviewed by support" }));
  assert.deepEqual(options(markup, ">Gender<"), ["", "woman", "man"]);
  assert.match(markup, /<button [^>]*disabled=""/u, "no gender means no command");
  // The detail control is inert until a gender is chosen: a detail belongs to
  // exactly one gender, so there is nothing valid to offer yet.
  assert.match(markup, /<span>Detailed gender<\/span><select disabled=""/u);
});

test("a stored nonbinary member is read-only, with the reason on screen", () => {
  const markup = render(member({ gender: "nonbinary", visible_to: "both", group: { id: "0c5e779988ceae850aeb6803", key: "nonbinary_for_both", legacy_segment: "other" }, gender_detail: null, show_gender_detail: false }), draft({ gender: "", gender_detail: "", visible_to: "both" }));
  assert.ok(!markup.includes("<select"), "a nonbinary member has no editable control here");
  assert.ok(!markup.includes("<button"), "and nothing to save");
  // React escapes the apostrophe, so the assertion matches the rendered form.
  assert.match(markup, /This member&#x27;s gender is edited elsewhere/u);
});

test("the save button is offered only for a real change carrying an audit reason", () => {
  const target = member();
  const noReason = render(target, draft({ gender: "man", gender_detail: "" }));
  assert.match(noReason, /<button [^>]*disabled=""/u);

  const noChange = render(target, draft({ audit_reason: "Reviewed with the member" }));
  assert.match(noChange, /<button [^>]*disabled=""/u, "an exact no-op still spends a receipt and an audit row");

  const ready = render(target, draft({ gender: "man", gender_detail: "", audit_reason: "Reviewed with the member" }));
  assert.doesNotMatch(ready, /<button [^>]*disabled=""/u);

  // Core's own bound: 1..300 NFC scalars, and no boundary whitespace.
  assert.equal(audienceVisibilityAuditReasonValid(""), false);
  assert.equal(audienceVisibilityAuditReasonValid(" x"), false);
  assert.equal(audienceVisibilityAuditReasonValid("x"), true);
  assert.equal(audienceVisibilityAuditReasonValid("é".repeat(300)), true);
  assert.equal(audienceVisibilityAuditReasonValid("x".repeat(301)), false);
});

test("both locales render the same controls, in the owner's words", () => {
  const target = member();
  const current = draft({ gender: "man", gender_detail: "", audit_reason: "Támogatói kérés" });
  const en = render(target, current, "en");
  const hu = render(target, current, "hu");
  assert.deepEqual(options(en, ">Gender<"), options(hu, ">Nem<"));
  assert.deepEqual(
    options(en, ">Who can see my profile<"),
    options(hu, ">Ki láthatja az adatlapomat<"),
  );
  for (const word of ["Nő", "Férfi", "Nők", "Férfiak", "Mindenki"]) {
    assert.ok(hu.includes(`>${word}<`), `the Hungarian editor must name ${word}`);
  }
  for (const word of ["Woman", "Man", "Women", "Men", "Everyone"]) {
    assert.ok(en.includes(`>${word}<`), `the English editor must name ${word}`);
  }
  // Neither locale leaks a raw message key or an untranslated placeholder.
  for (const markup of [en, hu]) {
    assert.ok(!markup.includes("editor."), markup.slice(0, 200));
    assert.ok(!markup.includes("{count}") && !markup.includes("{revision}"));
  }
});
