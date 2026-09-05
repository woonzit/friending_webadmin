import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import AppearanceLandingPreview from "../components/AppearanceLandingPreview.tsx";
import {
  APPEARANCE_PREVIEW_LABELS,
  appearancePreviewLabels,
  type AppearancePreviewLanguage,
} from "../lib/appearancePreviewLabels.ts";
import {
  APPEARANCE_DEFAULT_LANDING,
  APPEARANCE_DEFAULT_PALETTE,
  resolveAppearanceLanding,
} from "../lib/appearanceRules.ts";

type JsonObject = Record<string, unknown>;

async function bundle(locale: AppearancePreviewLanguage): Promise<JsonObject> {
  return JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
}

function at(root: JsonObject, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (node, key) => (node && typeof node === "object" ? (node as JsonObject)[key] : undefined),
    root,
  );
}

/**
 * T-802. The constant is the preview's source of truth, so it must stay
 * byte-for-byte identical to the console copy an operator reads in the two
 * namespaces that used to feed these labels through `t()`.
 */
test("the preview chrome copy is pinned to both console namespaces in both bundles", async () => {
  for (const locale of ["en", "hu"] as const) {
    const messages = await bundle(locale);
    const expected = APPEARANCE_PREVIEW_LABELS[locale];

    assert.equal(at(messages, "appearance.landingComposer.preview.apple"), expected.apple);
    assert.equal(at(messages, "appearance.landingComposer.preview.divider"), expected.divider);
    assert.equal(at(messages, "appearance.landingComposer.preview.qr"), expected.qr);

    assert.equal(at(messages, "appearance.testPreview.appleButton"), expected.apple);
    assert.equal(at(messages, "appearance.testPreview.divider"), expected.divider);
    assert.equal(at(messages, "appearance.testPreview.qrButton"), expected.qr);
  }

  // The two languages must actually differ, or the whole task is untestable.
  assert.notEqual(APPEARANCE_PREVIEW_LABELS.en.apple, APPEARANCE_PREVIEW_LABELS.hu.apple);
  assert.notEqual(APPEARANCE_PREVIEW_LABELS.en.divider, APPEARANCE_PREVIEW_LABELS.hu.divider);
  assert.notEqual(APPEARANCE_PREVIEW_LABELS.en.qr, APPEARANCE_PREVIEW_LABELS.hu.qr);
});

/**
 * The bug the owner saw: a Hungarian console showing an EN preview rendered
 * the authored phone/e-mail labels in English beside "Folytatás Apple-lel"
 * and "vagy". The preview language alone must decide the chrome.
 */
function renderPreview(
  consoleLocale: AppearancePreviewLanguage,
  previewLanguage: AppearancePreviewLanguage,
  messages: JsonObject,
): string {
  return renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale: consoleLocale, messages, timeZone: "UTC" },
    createElement(AppearanceLandingPreview, {
      content: resolveAppearanceLanding([], APPEARANCE_DEFAULT_LANDING, previewLanguage),
      fallbackLabel: "Fallback",
      palette: APPEARANCE_DEFAULT_PALETTE.light,
      paletteMode: "light" as const,
      authMethods: "both" as const,
      labels: appearancePreviewLabels(previewLanguage),
    }),
  ));
}

test("the preview chrome follows the preview language, whatever the console locale is", async () => {
  const bundles = {
    en: await bundle("en"),
    hu: await bundle("hu"),
  };

  for (const consoleLocale of ["en", "hu"] as const) {
    const english = renderPreview(consoleLocale, "en", bundles[consoleLocale]);
    assert.match(english, /Continue with Apple/, `console ${consoleLocale}: EN preview must say "Continue with Apple"`);
    assert.match(english, /class="appearance-landing-divider">or</, `console ${consoleLocale}: EN preview divider must be "or"`);
    assert.match(english, /title="QR reader"/);
    assert.doesNotMatch(english, /Folytatás Apple-lel/);
    assert.doesNotMatch(english, /class="appearance-landing-divider">vagy</);

    const hungarian = renderPreview(consoleLocale, "hu", bundles[consoleLocale]);
    assert.match(hungarian, /Folytatás Apple-lel/, `console ${consoleLocale}: HU preview must say "Folytatás Apple-lel"`);
    assert.match(hungarian, /class="appearance-landing-divider">vagy</, `console ${consoleLocale}: HU preview divider must be "vagy"`);
    assert.match(hungarian, /title="QR-olvasó"/);
    assert.doesNotMatch(hungarian, /Continue with Apple/);
    assert.doesNotMatch(hungarian, /class="appearance-landing-divider">or</);
  }
});

/**
 * The wiring itself: neither composer may reach back to `t()` for the three
 * chrome labels, or the console locale leaks into the preview again.
 */
test("both preview callers resolve the chrome labels from the preview language", async () => {
  const composer = await readFile(new URL("../components/AppearanceLandingComposer.tsx", import.meta.url), "utf8");
  const testPreview = await readFile(new URL("../components/AppearanceTestPreview.tsx", import.meta.url), "utf8");

  assert.match(composer, /labels=\{appearancePreviewLabels\(language\)\}/);
  assert.match(testPreview, /labels=\{appearancePreviewLabels\(lang\)\}/);

  for (const source of [composer, testPreview]) {
    assert.doesNotMatch(source, /t\("preview\.(?:apple|divider|qr)"\)/);
    assert.doesNotMatch(source, /t\("(?:appleButton|divider|qrButton)"\)/);
  }
});
