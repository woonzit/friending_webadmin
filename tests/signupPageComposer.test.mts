import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import SignupPageComposer from "../components/SignupPageComposer.tsx";
import {
  signupPagesPayload,
  type SignupDroppedItem,
  type SignupPageIssue,
  type SignupPageLayout,
} from "../lib/signupPages.ts";

const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/signup_pages_handoff/list-signup-options.json", import.meta.url),
  "utf8",
));
const payload = signupPagesPayload(fixture);
assert.ok(payload, "the handoff fixture must decode");

const MESSAGES = {
  en: JSON.parse(readFileSync(new URL("../messages/en.json", import.meta.url), "utf8")),
  hu: JSON.parse(readFileSync(new URL("../messages/hu.json", import.meta.url), "utf8")),
};

function render(
  locale: "en" | "hu",
  layout: SignupPageLayout,
  issues: SignupPageIssue[] = [],
  droppedItems: SignupDroppedItem[] = [],
): string {
  return renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale, messages: MESSAGES[locale], timeZone: "UTC" },
    createElement(SignupPageComposer, {
      layout,
      eligibleFields: payload.eligible_fields,
      systemQuestions: payload.system_questions,
      droppedItems,
      issues,
      busy: false,
      dirty: true,
      onChange() {},
      onCreatePage() {},
      onReset() {},
      onSave() {},
    }),
  ));
}

function emptyLayout(): SignupPageLayout {
  return {
    revision: payload.pages.revision,
    updated_at: payload.pages.updated_at,
    updated_by: payload.pages.updated_by,
    pages: [],
  };
}

test("the deliberate empty state renders its first-page action in both locales", () => {
  const en = render("en", emptyLayout());
  const hu = render("hu", emptyLayout());
  assert.match(en, /No signup pages yet/u);
  assert.match(en, /Create first page/u);
  assert.match(hu, /Még nincs signup oldal/u);
  assert.match(hu, /Első oldal létrehozása/u);
});

test("the two Core-served System cards are locked and no retired card is invented", () => {
  for (const locale of ["en", "hu"] as const) {
    const markup = render(locale, emptyLayout());
    assert.equal([...markup.matchAll(/data-system-question=/gu)].length, 2, locale);
    assert.match(markup, /data-system-question="gender"/u);
    assert.match(markup, /data-system-question="visible_to"/u);
    assert.doesNotMatch(markup, /relationship_status|subgender/u);
  }
  assert.match(render("en", emptyLayout()), /Gender/u);
  assert.match(render("en", emptyLayout()), /Who can see my profile/u);
  assert.match(render("hu", emptyLayout()), />Nem</u);
  assert.match(render("hu", emptyLayout()), /Ki láthatja az adatlapomat/u);
});

test("a composed page renders bilingual copy, ordered answers and the Profile fields anchor", () => {
  const en = render("en", payload.pages);
  const hu = render("hu", payload.pages);
  assert.match(en, /More about you/u);
  assert.match(en, /Smoking/u);
  assert.match(en, /Socially/u);
  assert.match(en, /href="\/profile-fields#smoking"/u);
  assert.match(hu, /Még egy kicsit rólad/u);
  assert.match(hu, /Dohányzás/u);
  assert.match(hu, /Társaságban/u);
  assert.match(hu, /Válaszok szerkesztése/u);
  assert.match(hu, /Elrendezés-revízió: 7/u);
});

test("a 422 item reason renders beside that item in English and Hungarian", () => {
  const issues: SignupPageIssue[] = [{
    code: "field-archived",
    page_key: "p_12ab34cd",
    field_key: "smoking",
  }];
  const en = render("en", payload.pages, issues);
  const hu = render("hu", payload.pages, issues);
  assert.match(en, /The field “smoking” is archived and cannot be placed on a signup page\./u);
  assert.match(hu, /A\(z\) „smoking” archivált, ezért signup oldalra nem helyezhető\./u);
  assert.match(en, /signup-item-errors/u);
  assert.match(hu, /signup-item-errors/u);
});

test("Core-reported dropped placements render as a bilingual notice", () => {
  const droppedItems: SignupDroppedItem[] = [{
    page_key: "p_12ab34cd",
    field_key: "retired_field",
  }];
  const en = render("en", payload.pages, [], droppedItems);
  const hu = render("hu", payload.pages, [], droppedItems);
  assert.match(en, /Missing placements removed/u);
  assert.match(en, /retired_field/u);
  assert.match(hu, /Hiányzó elhelyezések eltávolítva/u);
  assert.match(hu, /retired_field/u);
});
