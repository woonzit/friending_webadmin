import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HERO_IMAGE_MAX_ASPECT_RATIO,
  HERO_IMAGE_MIN_ASPECT_RATIO,
  classifyHeroImageRatio,
} from "../lib/appearanceHeroImage.ts";

function object(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function keyPaths(value: unknown, prefix = "", output: string[] = []): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const path = prefix ? `${prefix}.${key}` : key;
    output.push(path);
    keyPaths((value as Record<string, unknown>)[key], path, output);
  }
  return output;
}

test("hero image ratio guidance classifies only dimensions outside the soft range", () => {
  assert.equal(HERO_IMAGE_MIN_ASPECT_RATIO, 1.75);
  assert.equal(HERO_IMAGE_MAX_ASPECT_RATIO, 2);
  assert.equal(classifyHeroImageRatio(1875, 1000), "within-range");
  assert.equal(classifyHeroImageRatio(1320, 704), "within-range");
  assert.equal(classifyHeroImageRatio(1750, 1000), "within-range", "the lower boundary is accepted");
  assert.equal(classifyHeroImageRatio(2000, 1000), "within-range", "the upper boundary is accepted");
  assert.equal(classifyHeroImageRatio(1200, 800), "crop-top-bottom");
  assert.equal(classifyHeroImageRatio(1749, 1000), "crop-top-bottom");
  assert.equal(classifyHeroImageRatio(2001, 1000), "crop-left-right");
  assert.equal(classifyHeroImageRatio(1, 0), "unavailable");
  assert.equal(classifyHeroImageRatio(Number.NaN, 1000), "unavailable");
});

test("the hero editor exposes paired guidance, a live centered crop preview and non-blocking warnings", () => {
  const english = JSON.parse(readFileSync(new URL("../messages/en.json", import.meta.url), "utf8")) as unknown;
  const hungarian = JSON.parse(readFileSync(new URL("../messages/hu.json", import.meta.url), "utf8")) as unknown;
  assert.deepEqual(keyPaths(english), keyPaths(hungarian));

  const enHero = object(object(english).appearance);
  const huHero = object(object(hungarian).appearance);
  const enCopy = object(enHero.hero);
  const huCopy = object(huHero.hero);
  assert.deepEqual(Object.keys(enCopy).sort(), Object.keys(huCopy).sort());
  for (const key of [
    "campaignImageRecommendation",
    "cropPreviewTitle",
    "imageDimensions",
    "cropTopBottom",
    "cropLeftRight",
    "dimensionsUnavailable",
    "replaceEmptyGlobal",
  ]) {
    assert.equal(typeof enCopy[key], "string", `en.appearance.hero.${key}`);
    assert.equal(typeof huCopy[key], "string", `hu.appearance.hero.${key}`);
  }
  assert.equal(
    enCopy.campaignImageRecommendation,
    "Recommended size: 1875 × 1000 px (1.875 : 1), min 1320 × 704.",
  );
  assert.equal(
    huCopy.campaignImageRecommendation,
    "Ajánlott méret: 1875 × 1000 px (1.875 : 1), minimum 1320 × 704.",
  );

  const enHelpHero = object(object(object(object(english).adminHelp).pages).appearance);
  const huHelpHero = object(object(object(object(hungarian).adminHelp).pages).appearance);
  const enHelp = object(object(enHelpHero.sections).hero);
  const huHelp = object(object(huHelpHero.sections).hero);
  assert.equal(typeof object(enHelp.actions)["3"], "string");
  assert.equal(typeof object(huHelp.actions)["3"], "string");
  assert.match(String(object(enHelp.actions)["3"]), /1\.875:1.*1320 × 704/u);
  assert.match(String(object(huHelp.actions)["3"]), /1\.875:1.*1320 × 704/u);
  assert.match(String(enHelp.guidance), /does not hide the global hero/u);
  assert.match(String(huHelp.guidance), /nem rejti el a globális hero-t/u);

  const editor = readFileSync(new URL("../components/AppearanceHeroEditor.tsx", import.meta.url), "utf8");
  const rules = readFileSync(new URL("../lib/appearanceRules.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const guideEn = readFileSync(new URL("../docs/operator-guide-appearance-and-mandatory-verification.en.md", import.meta.url), "utf8");
  const guideHu = readFileSync(new URL("../docs/operator-guide-appearance-and-mandatory-verification.hu.md", import.meta.url), "utf8");
  assert.match(editor, /classifyHeroImageRatio\(currentMeasurement\.width, currentMeasurement\.height\)/u);
  assert.match(editor, /naturalWidth: width, naturalHeight: height/u);
  assert.match(editor, /className="appearance-hero-ratio-warning" role="status"/u);
  assert.doesNotMatch(rules, /classifyHeroImageRatio/u, "ratio guidance must not become save validation");
  assert.match(css, /\.appearance-hero-crop-frame \{[^}]*aspect-ratio: 1\.875 \/ 1;/su);
  assert.match(css, /\.appearance-hero-crop-frame img \{[^}]*object-fit: cover;[^}]*object-position: center;/su);
  assert.match(guideEn, /1\.875:1[\s\S]*1320 × 704[\s\S]*does not hide the global hero/u);
  assert.match(guideHu, /1\.875:1[\s\S]*1320 × 704[\s\S]*nem rejti el a globális hero-t/u);
});
