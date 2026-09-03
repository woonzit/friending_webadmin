import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import SignupIntentsLimitsDialog from "../components/SignupIntentsLimitsDialog.tsx";
import {
  signupPagesPayload,
  signupSelectionLimitsQuestion,
  type SignupSystemQuestion,
} from "../lib/signupPages.ts";

const envelopes = JSON.parse(readFileSync(
  new URL("./fixtures/signup_pages_handoff/t689-signup-composer-envelopes.json", import.meta.url),
  "utf8",
)) as Record<string, unknown>;
const lookingFor = JSON.parse(readFileSync(
  new URL("./fixtures/signup_pages_handoff/t702-looking-for-envelopes.json", import.meta.url),
  "utf8",
)) as { envelopes: Record<string, Record<string, unknown>> };

const MESSAGES = {
  en: JSON.parse(readFileSync(new URL("../messages/en.json", import.meta.url), "utf8")),
  hu: JSON.parse(readFileSync(new URL("../messages/hu.json", import.meta.url), "utf8")),
};

const source = readFileSync(
  new URL("../components/SignupIntentsLimitsDialog.tsx", import.meta.url),
  "utf8",
);

/** The real three-row read: the T-702 array spliced into the T-689 body. */
function question(raisedMinimum = false): SignupSystemQuestion {
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
  const parsed = signupPagesPayload(value);
  assert.ok(parsed, "the real three-row body must decode");
  const row = signupSelectionLimitsQuestion(parsed.system_questions);
  assert.ok(row, "the editable System row must be present");
  return row;
}

function render(locale: "en" | "hu", row: SignupSystemQuestion = question()): string {
  return renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale, messages: MESSAGES[locale], timeZone: "UTC" },
    createElement(SignupIntentsLimitsDialog, { question: row, onClose() {} }),
  ));
}

test("the settings dialog names both limits in both locales", () => {
  const en = render("en");
  const hu = render("hu");

  assert.match(en, /role="dialog"/u);
  assert.match(en, /aria-modal="true"/u);
  assert.match(en, /aria-labelledby="signup-intents-limits-title"/u);

  // The owner's own words for the two fields (D-114 Amendment 1).
  assert.match(hu, /Legfeljebb ennyi válasz/u);
  assert.match(hu, /Legalább ennyi válasz/u);
  assert.match(hu, /Beállítások/u);
  assert.match(en, /At most this many answers/u);
  assert.match(en, /At least this many answers/u);
  assert.match(en, /Answer limits/u);

  // The question is named in the locale being rendered, not in English twice.
  assert.match(en, /What are you looking for\?/u);
  assert.match(hu, /Mit keresel\?/u);
  assert.doesNotMatch(hu, /What are you looking for\?/u);

  for (const markup of [en, hu]) {
    // Integers only, and the browser is told the same bounds the validator uses.
    assert.match(markup, /type="number"[^>]*min="1"[^>]*max="5"[^>]*step="1"/u);
    assert.match(markup, /type="number"[^>]*min="0"[^>]*max="5"[^>]*step="1"/u);
    assert.equal([...markup.matchAll(/type="number"/gu)].length, 2);
    // The audit reason travels with every receipted write on this contract.
    assert.match(markup, /maxLength="300"|maxlength="300"/u);
  }
});

test("the dialog opens on the stored pair and cannot save before it has a revision", () => {
  const en = render("en");
  // Core ships the row at 0–2; the fields open on exactly that.
  assert.match(en, /type="number"[^>]*value="2"/u);
  assert.match(en, /type="number"[^>]*value="0"/u);
  assert.match(render("en", question(true)), /type="number"[^>]*value="1"/u);

  // `list_signup_options` serves no revision, so the catalogue read happens on
  // mount and nothing may be posted until it lands: every control is disabled
  // and the operator is told what is happening.
  assert.match(en, /Reading the current answer catalogue…/u);
  assert.match(render("hu"), /Az aktuális válaszkatalógus betöltése…/u);
  assert.equal([...en.matchAll(/ disabled=""/gu)].length, 4, "three fields and the save button");
  assert.match(en, /<button class="button button-primary" type="button" disabled=""/u);
  // Closing is never disabled by the read: an operator is not trapped.
  assert.match(en, /<button class="button button-secondary" type="button">Cancel<\/button>|>Close</u);

  // An untouched empty audit reason is not a mistake the operator has made yet:
  // it reads as a hint, and only becomes an error once they edit or try to save.
  assert.match(en, /class="field-hint">0 of 300 characters/u);
  assert.doesNotMatch(en, /field-error/u);
  assert.doesNotMatch(en, /Enter an audit reason/u);
});

test("a bare 422 is rendered as a per-field refusal on BOTH numbers", () => {
  // Core refuses in its pure parser and sends no `details`, and the draft has
  // already satisfied every rule this console knows, so the only honest
  // per-field statement is that Core refused the pair.
  assert.match(source, /setServerIssues\(\[\s*\{ field: "selection_max", code: "refused" \},\s*\{ field: "selection_required_min", code: "refused" \},\s*\]\)/u);
  assert.match(source, /"max-range": "limitsIssueMaxRange"/u);
  assert.match(source, /"min-above-max": "limitsIssueMinAboveMax"/u);
  assert.match(source, /refused: "limitsIssueRefused"/u);
  // Every issue code has copy in both locales.
  for (const locale of ["en", "hu"] as const) {
    for (const key of [
      "limitsIssueMaxRange",
      "limitsIssueMinRange",
      "limitsIssueMinAboveMax",
      "limitsIssueReasonRequired",
      "limitsIssueRefused",
    ]) {
      assert.equal(typeof MESSAGES[locale].signupOptions[key], "string", `${locale}.${key}`);
    }
  }
});

test("the write is receipted, revision-guarded and never repeated by accident", () => {
  // Durable identity: minted once, reused while the outcome is unknown, and
  // cleared only on a certain one (200, 409, 422).
  assert.match(source, /const request = requestRef\.current \?\? crypto\.randomUUID\(\)/u);
  assert.match(source, /writeStoredRequestId\(request\)/u);
  assert.match(source, /window\.sessionStorage/u);
  assert.equal([...source.matchAll(/writeStoredRequestId\(null\)/gu)].length, 3);

  // The revision comes from a read this browser made, never from a form field.
  assert.match(source, /signupIntentsLimitsRead\(response\)/u);
  assert.match(source, /signupIntentsLimitsBody\(draft, ceiling, request, limits\.intents_revision\)/u);

  // Each outcome has its own branch, and the unknown one keeps the id.
  assert.match(source, /signupIntentsLimitsSaved\(response\)/u);
  assert.match(source, /signupIntentsLimitsConflict\(response\)/u);
  assert.match(source, /signupIntentsLimitsRefused\(response\)/u);
  assert.match(source, /limitsReplayed/u);
  assert.match(source, /setReceipt\(\{ request_id: request/u);

  // Exactly one write call, and it is the action Core publishes.
  assert.equal([...source.matchAll(/adminCall\(/gu)].length, 2);
  assert.match(source, /adminCall\(SIGNUP_INTENTS_SELECTION_LIMITS_ACTION, body\)/u);
  assert.match(source, /adminCall\(SIGNUP_INTENTS_REVISION_READ_ACTION/u);
  assert.doesNotMatch(source, /"save_intents_selection_limits"/u);
});
