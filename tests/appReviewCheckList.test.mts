import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import {
  APP_REVIEW_CHECK_KEYS,
  APP_REVIEW_COUNT_KEYS,
  APP_REVIEW_RESET_CONFIRMATION,
  appReviewSandboxStatus,
} from "../lib/appReviewSandbox.ts";
import {
  APP_REVIEW_NOT_APPLICABLE,
  AppReviewCheckList,
  appReviewCheckNotApplicable,
} from "../components/AppReviewCheckList.tsx";

/**
 * T-812. Core (`AppReviewSandboxService::NOT_APPLICABLE`, `api` f96b3935)
 * serves a check whose feature is switched off as
 * `{ ok: true, actual: "not_applicable", expected: <the normal expectation> }`.
 * Before this row the page printed that as a plain green tick, because it shows
 * `actual` only for a FAILING check — the owner was told the fixture had
 * content the reviewer cannot reach.
 *
 * Every status here goes through the shipped decoder from a literal payload:
 * the third state is a VALUE the existing scalar guard already accepts, so a
 * test that hand-built `AppReviewCheck` objects would prove nothing about what
 * the console actually receives. `lib/appReviewSandbox.ts` is unchanged.
 */

const NOT_APPLICABLE_KEY = "footprints";
const FAILED_KEY = "friend_requests";

function statusPayload(
  checks: (key: string) => Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const counts: Record<string, number> = {};
  for (const key of APP_REVIEW_COUNT_KEYS) counts[key] = 0;
  return {
    schema_version: 1,
    fixture: "app_review_v1",
    fixture_version: 3,
    content_complete: true,
    control: {
      present: true,
      state: "ready",
      review_uid: 626001,
      reset_revision: 2,
      fixture_version: 3,
      reset_state: "idle",
      last_reset_at: 1787000000,
      last_reset_by: "owner@friending.com",
      last_reset_request_id: "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
      reset_error: "",
      reprovision_state: "idle",
    },
    env: {
      login_enabled: true,
      uid_configured: 626001,
      uid_matches_control: true,
      code_configured: true,
      email_configured: true,
      phone_configured: true,
      email: "review@friending.com",
      phone: "15128014040",
      demo_system_enabled: true,
    },
    ready: true,
    reset_confirmation: APP_REVIEW_RESET_CONFIRMATION,
    counts,
    media: { expected: 58, valid: 58, ready: true },
    checks: APP_REVIEW_CHECK_KEYS.map((key) => ({ key, ...checks(key) })),
    ...extra,
  };
}

/** A passed check, a failed one and one behind a switched-off feature. */
function threeStatePayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return statusPayload((key) => {
    if (key === NOT_APPLICABLE_KEY) {
      // Exactly Core's shape: ok, with the normal expectation retained.
      return { ok: true, actual: APP_REVIEW_NOT_APPLICABLE, expected: 2 };
    }
    if (key === FAILED_KEY) return { ok: false, actual: 0, expected: 3 };
    return { ok: true, actual: 1, expected: 1 };
  }, extra);
}

async function renderChecks(
  locale: "en" | "hu",
  payload: Record<string, unknown> = threeStatePayload(),
): Promise<{ markup: string; rows: string[]; ready: boolean }> {
  const status = appReviewSandboxStatus(payload);
  assert.ok(status, `${locale}: the shipped decoder must accept the payload unchanged`);
  const messages = JSON.parse(
    await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"),
  );
  const markup = renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale, messages, timeZone: "UTC" },
    createElement(AppReviewCheckList, { checks: status.checks }),
  ));
  return {
    markup,
    rows: [...markup.matchAll(/<li class="check-[a-z]+">.*?<\/li>/g)].map((match) => match[0]),
    ready: status.ready,
  };
}

const COPY = {
  en: {
    notApplicable: "Not applicable (the feature is switched off)",
    label: "Footprints",
    failedLabel: "Friend requests",
    actual: "actual 0",
    expected: "expected 3",
  },
  hu: {
    notApplicable: "Nem alkalmazható (a funkció ki van kapcsolva)",
    label: "Lábnyomok",
    failedLabel: "Barátkérelmek",
    actual: "tényleges: 0",
    expected: "elvárt: 3",
  },
} as const;

test("the readiness list renders three states, and only the third one is muted", async () => {
  for (const locale of ["en", "hu"] as const) {
    const { markup, rows, ready } = await renderChecks(locale);

    assert.equal(rows.length, APP_REVIEW_CHECK_KEYS.length, `${locale}: one row per closed check key`);
    const na = rows.filter((row) => row.startsWith('<li class="check-na">'));
    const failed = rows.filter((row) => row.startsWith('<li class="check-failed">'));
    const ok = rows.filter((row) => row.startsWith('<li class="check-ok">'));
    assert.equal(na.length, 1, `${locale}: exactly one not-applicable row`);
    assert.equal(failed.length, 1, `${locale}: the failed row is untouched by this change`);
    assert.equal(ok.length, APP_REVIEW_CHECK_KEYS.length - 2, `${locale}: every other check still passes`);

    // `ok: true` semantics are unchanged — readiness stays exactly as the payload said.
    assert.equal(ready, true, `${locale}: a not-applicable check does not turn readiness red`);

    assert.equal(
      na[0],
      '<li class="check-na">'
      + '<span class="badge badge-muted" aria-hidden="true">—</span>'
      + `<span>${COPY[locale].label}</span>`
      + `<small> ${COPY[locale].notApplicable}</small>`
      + "</li>",
      `${locale}: the muted third state, glyph hidden from assistive technology`,
    );

    // The exact row above already says it, and it is the point of the state:
    // the operator never meets Core's raw sentinel, and the muted row is not
    // dressed as a measurement — no actual/expected pair on a check nobody can
    // meet, and no green tick claiming content that is out of reach.
    assert.doesNotMatch(markup, /not_applicable/);

    assert.equal(
      failed[0],
      '<li class="check-failed">'
      + '<span class="badge badge-error" aria-hidden="true">✕</span>'
      + `<span>${COPY[locale].failedLabel}</span>`
      + `<small> ${COPY[locale].actual} · ${COPY[locale].expected}</small>`
      + "</li>",
      `${locale}: the failed row keeps its glyph, badge and actual/expected pair`,
    );

    assert.match(ok[0], /^<li class="check-ok"><span class="badge badge-success" aria-hidden="true">✓<\/span><span>[^<]+<\/span><\/li>$/);
    assert.equal(markup.split("<small>").length - 1, 2, `${locale}: only the muted and the failed row carry a note`);
  }
});

test("the muted state is exactly Core's sentinel on a passing check, and nothing else", async () => {
  assert.equal(APP_REVIEW_NOT_APPLICABLE, "not_applicable");
  assert.equal(
    appReviewCheckNotApplicable({ key: "footprints", ok: true, actual: "not_applicable", expected: 2 }),
    true,
  );
  // A failing check is a failure whatever it says, and a near-miss value is not the sentinel.
  for (const check of [
    { key: "footprints", ok: false, actual: "not_applicable", expected: 2 },
    { key: "footprints", ok: true, actual: "NOT_APPLICABLE", expected: 2 },
    { key: "footprints", ok: true, actual: "not applicable", expected: 2 },
    { key: "footprints", ok: true, actual: 0, expected: 2 },
  ] as const) {
    assert.equal(appReviewCheckNotApplicable(check), false, JSON.stringify(check));
  }

  // Rendered: `ok: false` with the sentinel is a red row, never a muted one.
  const { rows } = await renderChecks("en", statusPayload((key) => (
    key === NOT_APPLICABLE_KEY
      ? { ok: false, actual: APP_REVIEW_NOT_APPLICABLE, expected: 2 }
      : { ok: true, actual: 1, expected: 1 }
  ), { ready: false }));
  assert.equal(rows.filter((row) => row.startsWith('<li class="check-na">')).length, 0);
  assert.equal(rows.filter((row) => row.startsWith('<li class="check-failed">')).length, 1);
});

test("every check may be not applicable at once without the list losing a row", async () => {
  const { rows, ready } = await renderChecks("hu", statusPayload(() => (
    { ok: true, actual: APP_REVIEW_NOT_APPLICABLE, expected: 1 }
  )));
  assert.equal(rows.length, APP_REVIEW_CHECK_KEYS.length);
  assert.equal(rows.filter((row) => row.startsWith('<li class="check-na">')).length, APP_REVIEW_CHECK_KEYS.length);
  assert.equal(ready, true);
});

test("both locales carry the new copy key and nothing else moved", async () => {
  const [en, hu] = await Promise.all(["en", "hu"].map(async (locale) => JSON.parse(
    await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"),
  )));
  assert.equal(en.appReview.checkNotApplicable, COPY.en.notApplicable);
  assert.equal(hu.appReview.checkNotApplicable, COPY.hu.notApplicable);
  // The two states that already existed keep their copy.
  assert.equal(en.appReview.checkActual, "actual {actual}");
  assert.equal(hu.appReview.checkActual, "tényleges: {actual}");
  assert.equal(en.appReview.readyYes, "Ready for review");
  assert.equal(hu.appReview.readyYes, "Review-kész");
});
