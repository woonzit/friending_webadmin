import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import SignupPageComposer from "../components/SignupPageComposer.tsx";
import {
  signupPageSaveIssues,
  signupPagesPayload,
  type SignupDroppedItem,
  type SignupPageIssue,
  type SignupPageLayout,
  type SignupPagesPayload,
} from "../lib/signupPages.ts";

const envelopes = JSON.parse(readFileSync(
  new URL("./fixtures/signup_pages_handoff/t689-signup-composer-envelopes.json", import.meta.url),
  "utf8",
)) as Record<string, unknown>;

const payload = signupPagesPayload(envelopes["list_signup_options.composed"]);
assert.ok(payload, "the captured read envelope must decode");
const lookingFor = JSON.parse(readFileSync(
  new URL("./fixtures/signup_pages_handoff/t702-looking-for-envelopes.json", import.meta.url),
  "utf8",
)) as { envelopes: Record<string, Record<string, unknown>> };

/**
 * The composer read as Core will serve it: the T-702 capture's REAL three-row
 * `system_questions` array spliced into the T-689 capture's whole body.
 * `tests/signupPages.test.mts` proves the array's first two rows are exactly
 * the two rows this replaces, so nothing here is hand-written.
 */
function threeRowRead(raisedMinimum = false): Record<string, unknown> {
  const value = structuredClone(envelopes["list_signup_options.composed"]) as Record<string, unknown>;
  const rows = structuredClone(
    lookingFor.envelopes.list_signup_options_system_questions.system_questions,
  ) as Record<string, unknown>[];
  if (raisedMinimum) {
    rows[2] = structuredClone(
      lookingFor.envelopes.list_signup_options_system_questions_minimum_one.intents_row,
    ) as Record<string, unknown>;
  }
  value.system_questions = rows;
  return value;
}

const systemIntentsPayload = signupPagesPayload(threeRowRead());
assert.ok(systemIntentsPayload, "the real three-row envelope must decode");
const raisedMinimumPayload = signupPagesPayload(threeRowRead(true));
assert.ok(raisedMinimumPayload, "the raised-minimum row must decode");

const MESSAGES = {
  en: JSON.parse(readFileSync(new URL("../messages/en.json", import.meta.url), "utf8")),
  hu: JSON.parse(readFileSync(new URL("../messages/hu.json", import.meta.url), "utf8")),
};

function render(
  locale: "en" | "hu",
  layout: SignupPageLayout,
  issues: SignupPageIssue[] = [],
  droppedItems: SignupDroppedItem[] = [],
  source: SignupPagesPayload = payload,
  editable = true,
): string {
  return renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale, messages: MESSAGES[locale], timeZone: "UTC" },
    createElement(SignupPageComposer, {
      layout,
      eligibleFields: source.eligible_fields,
      systemQuestions: source.system_questions,
      warnings: source.warnings,
      droppedItems,
      issues,
      busy: false,
      dirty: true,
      onChange() {},
      onCreatePage() {},
      onReset() {},
      onSave() {},
      onSelectionLimitsSaved: editable ? () => {} : undefined,
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

function systemBlock(markup: string): string {
  const block = /<section class="panel signup-system-panel">.*?<\/section>/su.exec(markup);
  assert.ok(block, "the System block must render");
  return block[0];
}

function systemCard(markup: string, key: string): string {
  const card = new RegExp(
    `<article class="signup-system-card"[^>]*data-system-question="${key}"[\\s\\S]*?<\\/article>`,
    "u",
  ).exec(markup);
  assert.ok(card, `the ${key} System card must render`);
  return card[0];
}

test("the two Core-served System cards are locked and no retired card is invented", () => {
  for (const locale of ["en", "hu"] as const) {
    const markup = render(locale, emptyLayout());
    assert.equal([...markup.matchAll(/data-system-question=/gu)].length, 2, locale);
    assert.match(markup, /data-system-question="gender"/u);
    assert.match(markup, /data-system-question="visible_to"/u);
    // D-103 moved relationship_status OUT of the System block and into the
    // catalogue, so it must be a palette row here and never a System card;
    // subgender (R2) is not offered anywhere on this page.
    assert.doesNotMatch(systemBlock(markup), /relationship_status|subgender/u);
    assert.doesNotMatch(markup, /subgender/u);
    assert.match(markup, /signup-palette-card[\s\S]*?<code>relationship_status<\/code>/u);
  }
  assert.match(render("en", emptyLayout()), /Gender/u);
  assert.match(render("en", emptyLayout()), /Who can see my profile/u);
  assert.match(render("hu", emptyLayout()), />Nem</u);
  assert.match(render("hu", emptyLayout()), /Ki láthatja az adatlapomat/u);
  assert.equal([...render("en", emptyLayout()).matchAll(/>OPTIONAL<\/span>/gu)].length, 2);
  assert.equal([...render("hu", emptyLayout()).matchAll(/>OPCIONÁLIS<\/span>/gu)].length, 2);
  assert.doesNotMatch(render("en", emptyLayout()), /At least \d+ answers required/u);
  assert.doesNotMatch(render("hu", emptyLayout()), /Legalább \d+ válasz kötelező/u);
});

test("the real third System card renders 14 read-only answers and its current range", () => {
  const en = render("en", systemIntentsPayload.pages, [], [], systemIntentsPayload);
  const hu = render("hu", systemIntentsPayload.pages, [], [], systemIntentsPayload);
  assert.equal([...en.matchAll(/data-system-question=/gu)].length, 3);
  assert.equal([...hu.matchAll(/data-system-question=/gu)].length, 3);

  const enCard = systemCard(en, "intents");
  const huCard = systemCard(hu, "intents");
  assert.match(enCard, /What are you looking for\?/u);
  assert.match(huCard, /Mit keresel\?/u);
  assert.equal([...enCard.matchAll(/<li>/gu)].length, 14);
  assert.equal([...huCard.matchAll(/<li>/gu)].length, 14);
  assert.match(enCard, /People to meet IRL/u);
  assert.match(enCard, /Anything/u);
  assert.match(huCard, /Élőben találkozni/u);
  assert.match(huCard, /Bármi/u);
  assert.match(enCard, /<span class="badge badge-warning">SYSTEM<\/span>/u);

  // D-114: the card names the stored pair and offers the settings dialog. Core
  // ships the row at 0–2; the minimum only moves when the owner saves.
  assert.match(enCard, /<span class="signup-system-limits-range">0–2 answers<\/span>/u);
  assert.match(huCard, /<span class="signup-system-limits-range">0–2 válasz<\/span>/u);
  assert.match(enCard, />Settings</u);
  assert.match(huCard, />Beállítások</u);
  assert.match(enCard, /<span class="badge badge-inactive">OPTIONAL<\/span>/u);
  assert.doesNotMatch(enCard, /At least \d+ answers required/u);

  // The answers themselves stay read-only: the settings button is the ONLY
  // interactive element the locked card gained.
  for (const card of [enCard, huCard]) {
    assert.equal([...card.matchAll(/<(?:a|button|input|select|textarea)\b/gu)].length, 1);
    assert.equal([...card.matchAll(/<button/gu)].length, 1);
  }

  // The other two System cards carry neither the range nor the control: their
  // maximum is structural, not admin-settable.
  for (const key of ["gender", "visible_to"]) {
    assert.doesNotMatch(systemCard(en, key), /signup-system-limits/u);
    assert.doesNotMatch(systemCard(en, key), /<button/u);
  }

  // A caller that cannot re-read after a save is not offered the control.
  const readOnly = systemCard(
    render("en", systemIntentsPayload.pages, [], [], systemIntentsPayload, false),
    "intents",
  );
  assert.match(readOnly, /0–2 answers/u);
  assert.doesNotMatch(readOnly, /<(?:a|button|input|select|textarea)\b/u);
});

test("the raised minimum renders as REQUIRED, its caption and a 1–2 range", () => {
  const en = render("en", raisedMinimumPayload.pages, [], [], raisedMinimumPayload);
  const hu = render("hu", raisedMinimumPayload.pages, [], [], raisedMinimumPayload);
  const enCard = systemCard(en, "intents");
  const huCard = systemCard(hu, "intents");
  assert.match(enCard, /<span class="badge badge-active">REQUIRED<\/span>/u);
  assert.match(huCard, /<span class="badge badge-active">KÖTELEZŐ<\/span>/u);
  assert.match(enCard, /At least 1 answers required/u);
  assert.match(huCard, /Legalább 1 válasz kötelező/u);
  assert.match(enCard, /1–2 answers/u);
  assert.match(huCard, /1–2 válasz/u);
});

test("an unknown fourth System key is omitted from the cards and rendered as a warning", () => {
  const value = threeRowRead();
  (value.system_questions as Record<string, unknown>[]).push({ key: "future_system_question" });
  const parsed = signupPagesPayload(value);
  assert.ok(parsed);
  const en = render("en", parsed.pages, [], [], parsed);
  assert.equal([...en.matchAll(/data-system-question=/gu)].length, 3);
  assert.doesNotMatch(systemBlock(en), /data-system-question="future_system_question"/u);
  assert.match(en, /Core returned unsupported System question\(s\), which were skipped: future_system_question\./u);
});

test("a composed page renders bilingual copy, ordered answers and the Profile fields anchor", () => {
  const en = render("en", payload.pages);
  const hu = render("hu", payload.pages);
  assert.match(en, /More about you/u);
  assert.match(en, /Smoking/u);
  assert.match(en, /I smoke sometimes/u);
  assert.match(en, /href="\/profile-fields#smoking"/u);
  // D-103 put relationship_status in the catalogue, so it is a placed item
  // here rather than a System card.
  assert.match(en, /href="\/profile-fields#relationship_status"/u);
  assert.match(hu, /Többet rólad/u);
  assert.match(hu, /Dohányzás/u);
  assert.match(hu, /Alkalmanként dohányzom/u);
  assert.match(hu, /Válaszok szerkesztése/u);
  assert.match(hu, /Elrendezés-revízió: 1/u);
});

test("Core's 422 rows render as a reason beside the item or on the page they name", () => {
  const issues = signupPageSaveIssues(envelopes["save_signup_page_layout.422"]);
  assert.ok(issues, "the captured refusal must decode");
  assert.equal(issues.length, 2);

  // The captured refusal was produced in its own run, so its minted page keys
  // are not the composed layout's. Re-point the two cards at them: the reasons,
  // the field key and the row-to-card mapping under test are Core's own.
  const layout: SignupPageLayout = {
    ...payload.pages,
    pages: payload.pages.pages.map((page, index) => ({
      ...page,
      key: issues[index].page_key ?? page.key,
    })),
  };

  const en = render("en", layout, issues);
  const hu = render("hu", layout, issues);
  assert.match(en, /The field “smoking” appears on more than one signup page\./u);
  assert.match(hu, /A\(z\) „smoking” mező egynél több signup oldalon szerepel\./u);
  assert.match(en, /Enter a non-blank English and Hungarian title for this page\./u);
  assert.match(hu, /Adj meg nem üres angol és magyar címet ehhez az oldalhoz\./u);
  // The duplicate-field row names an item and lands inside it; the blank-title
  // row names no field and stays on the page card.
  assert.match(en, /signup-item-errors/u);
  assert.match(hu, /signup-item-errors/u);
  assert.equal([...en.matchAll(/signup-item-errors/gu)].length, 1);
});

test("Core-reported dropped placements render as a bilingual notice", () => {
  const droppedItems: SignupDroppedItem[] = [{
    index: 0,
    page_key: payload.pages.pages[0].key,
    field_key: "retired_field",
    reason: "unknown-field",
  }];
  const en = render("en", payload.pages, [], droppedItems);
  const hu = render("hu", payload.pages, [], droppedItems);
  assert.match(en, /Missing placements removed/u);
  assert.match(en, /retired_field/u);
  assert.match(hu, /Hiányzó elhelyezések eltávolítva/u);
  assert.match(hu, /retired_field/u);

  // A healed row about the page rather than one of its items carries an empty
  // field key; the notice names the page instead of printing a gap.
  const pageLevel = render("en", payload.pages, [], [{
    index: 0,
    page_key: payload.pages.pages[0].key,
    field_key: "",
    reason: "item-limit",
  }]);
  assert.match(pageLevel, new RegExp(`: ${payload.pages.pages[0].key}\\.`, "u"));
});
