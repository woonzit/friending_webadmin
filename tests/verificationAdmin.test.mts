import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ADMIN_ACTIONS } from "../lib/adminActions.ts";
import { ADMIN_HELP_PAGES } from "../lib/adminHelp.ts";
import { VERIFICATION_CONTRACT_READY } from "../lib/contractReadiness.ts";
import {
  MAX_VERIFICATION_BADGE_BYTES,
  VERIFICATION_BADGE_SLOTS,
  VERIFICATION_FEATURE_KEYS,
  VERIFICATION_FIXTURE_EVALUATED_AT,
  VERIFICATION_FIXTURE_SYMBOLS,
  VERIFICATION_GATE_VARIANTS,
  VERIFICATION_GRANT_CAPABILITIES,
  VERIFICATION_LEVELS,
  VERIFICATION_METHODS,
  VERIFICATION_METHOD_STATUSES,
  VERIFICATION_REQUIREMENTS,
  VERIFICATION_SCOPE_STATES,
  VERIFICATION_TAB_KEYS,
  verificationBadgeFileError,
  verificationBadgeFixtures,
  verificationDerivedLevel,
  verificationEffectiveMethods,
  verificationEffectiveRequirement,
  verificationGateCopyErrors,
  verificationGrantDraftError,
  verificationIsoCountry,
  verificationMaxLevel,
  verificationScopeDraftError,
  verificationScopeFixtures,
  verificationSeedCopyPairs,
  verificationTabKey,
  verificationTextLength,
  verificationTierLanguageEnabled,
  verificationUserFixture,
  type VerificationGateCopyLocale,
  type VerificationScope,
} from "../lib/verificationAdmin.ts";

type JsonObject = Record<string, unknown>;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function object(value: unknown, label: string): JsonObject {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as JsonObject;
}

async function localeMessages(locale: "en" | "hu"): Promise<JsonObject> {
  return JSON.parse(
    await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"),
  ) as JsonObject;
}

function copyFixture(): VerificationGateCopyLocale {
  return {
    iconKind: "symbol",
    iconValue: "video.fill",
    title: "Video verification",
    subtitle: "A quick trust check",
    description: "Open Verification to continue.\nPending never unlocks access.",
    actionLabel: "Open Verification",
    actionKind: "open_verification_center",
    actionUrl: "",
    cancelLabel: "Not now",
  };
}

test("the dormant model pins the delivered design vocabulary and never activates itself", () => {
  assert.equal(VERIFICATION_CONTRACT_READY, false);
  assert.deepEqual(VERIFICATION_TAB_KEYS, ["scopes", "requirements", "messages", "badges", "simulator"]);
  assert.deepEqual(VERIFICATION_METHODS, ["video", "persona"]);
  assert.deepEqual(VERIFICATION_METHOD_STATUSES, ["not_started", "pending", "verified", "rejected"]);
  assert.deepEqual(VERIFICATION_LEVELS, ["none", "light", "strong"]);
  assert.deepEqual(VERIFICATION_REQUIREMENTS, ["inherit", "none", "light", "strong"]);
  assert.deepEqual(VERIFICATION_GATE_VARIANTS, ["video", "persona", "both", "pending", "rejected"]);
  assert.deepEqual(VERIFICATION_BADGE_SLOTS, ["verified", "pending", "rejected"]);
  assert.deepEqual(VERIFICATION_SCOPE_STATES, ["live", "draft", "off"]);
  assert.deepEqual(VERIFICATION_GRANT_CAPABILITIES, [
    "verification_grant_read",
    "verification_grant_edit",
  ]);
  assert.deepEqual(VERIFICATION_FIXTURE_SYMBOLS, [
    "video.fill",
    "person.text.rectangle.fill",
    "checkmark.shield.fill",
    "clock.fill",
    "exclamationmark.triangle.fill",
  ]);
  assert.deepEqual(VERIFICATION_FEATURE_KEYS, [
    "people.list",
    "profile.view",
    "chat.start",
    "chat.send",
    "friend.request",
    "dates.access",
    "dates.create",
    "dates.join",
    "footprints.send",
    "album.private_request",
    "profile.public_link",
  ]);
  assert.equal(new Set(VERIFICATION_FEATURE_KEYS).size, 11);
  assert.equal(MAX_VERIFICATION_BADGE_BYTES, 2_097_152);

  for (const tab of VERIFICATION_TAB_KEYS) assert.equal(verificationTabKey(tab), tab);
  for (const invalid of [undefined, null, "", "grant", "Scopes", ["scopes"]]) {
    assert.equal(verificationTabKey(invalid), "scopes");
  }
});

test("scope fixtures are complete and resolve city to country to global without loose values", () => {
  const scopes = verificationScopeFixtures();
  assert.equal(scopes.length, 6);
  for (const scope of scopes) {
    assert.equal(verificationScopeDraftError(scope), null, scope.id);
    assert.deepEqual(Object.keys(scope.featureRequirements), [...VERIFICATION_FEATURE_KEYS]);
  }

  const global = scopes.find((scope) => scope.id === "global")!;
  const country = scopes.find((scope) => scope.id === "country:HU")!;
  const city = scopes.find((scope) => scope.id === "city:HU:budapest")!;
  const singleMethod = scopes.find((scope) => scope.id === "country:DE")!;
  const off = scopes.find((scope) => scope.id === "country:RS")!;
  assert.equal(global.id, "global");
  assert.equal(global.publishState, "live");
  assert.equal(global.defaultLevel, "light");
  assert.deepEqual(global.enabledMethods, ["video", "persona"]);
  assert.ok(Object.values(global.featureRequirements).every((value) => value === "none"));
  assert.deepEqual(verificationEffectiveMethods(country, scopes), ["video", "persona"]);
  assert.deepEqual(verificationEffectiveMethods(city, scopes), ["persona"]);
  assert.deepEqual(verificationEffectiveMethods(off, scopes), []);
  assert.equal(verificationTierLanguageEnabled(verificationEffectiveMethods(global, scopes)), true);
  assert.equal(verificationTierLanguageEnabled(verificationEffectiveMethods(singleMethod, scopes)), false);
  assert.equal(verificationTierLanguageEnabled(verificationEffectiveMethods(off, scopes)), false);
  assert.deepEqual(verificationEffectiveRequirement(city, "people.list", scopes), {
    value: "light",
    sourceId: city.id,
  });
  assert.deepEqual(verificationEffectiveRequirement(city, "chat.start", scopes), {
    value: "light",
    sourceId: country.id,
  });
  assert.deepEqual(verificationEffectiveRequirement(city, "profile.view", scopes), {
    value: "none",
    sourceId: global.id,
  });
  assert.deepEqual(verificationEffectiveRequirement(off, "people.list", scopes), {
    value: "none",
    sourceId: off.id,
  });

  assert.equal(verificationIsoCountry("hu"), "HU");
  assert.equal(verificationIsoCountry(" HU "), "HU");
  for (const invalid of ["", "H", "HUN", "H1", "*"]) assert.equal(verificationIsoCountry(invalid), null);

  const invalidGlobal = clone(global);
  invalidGlobal.publishState = "draft";
  assert.equal(verificationScopeDraftError(invalidGlobal), "global");

  const inheritedGlobal = clone(global);
  inheritedGlobal.featureRequirements["people.list"] = "inherit";
  assert.equal(verificationScopeDraftError(inheritedGlobal), "features");

  const looseCountry = clone(country);
  looseCountry.country = "hu";
  assert.equal(verificationScopeDraftError(looseCountry), "country");

  const duplicateMethods = clone(city);
  duplicateMethods.enabledMethods = ["persona", "persona"];
  assert.equal(verificationScopeDraftError(duplicateMethods), "methods");

  const unsafeNoMethods = clone(singleMethod);
  unsafeNoMethods.enabledMethods = [];
  unsafeNoMethods.defaultLevel = "light";
  assert.equal(verificationScopeDraftError(unsafeNoMethods), "guardrail");

  const unsafeOff = clone(off);
  unsafeOff.defaultLevel = "strong";
  assert.equal(verificationScopeDraftError(unsafeOff), "guardrail");

  const missingFeature = clone(city) as VerificationScope & {
    featureRequirements: Record<string, string>;
  };
  delete missingFeature.featureRequirements["chat.send"];
  assert.equal(verificationScopeDraftError(missingFeature as VerificationScope), "features");

  const extraFeature = clone(city) as VerificationScope & {
    featureRequirements: Record<string, string>;
  };
  extraFeature.featureRequirements["future.feature"] = "none";
  assert.equal(verificationScopeDraftError(extraFeature as VerificationScope), "features");

  const incompleteCity = clone(city);
  incompleteCity.placeId = null;
  assert.equal(verificationScopeDraftError(incompleteCity), "city");
});

test("the local tier evaluator mirrors the frozen formula and pending never unlocks", () => {
  const statuses = { video: "not_started", persona: "not_started" } as const;
  assert.equal(verificationDerivedLevel(["video", "persona"], statuses), "none");
  assert.equal(verificationDerivedLevel(["video", "persona"], { ...statuses, video: "pending" }), "none");
  assert.equal(verificationDerivedLevel(["video", "persona"], { ...statuses, persona: "pending" }), "none");
  assert.equal(verificationDerivedLevel(["video", "persona"], { ...statuses, video: "rejected" }), "none");
  assert.equal(verificationDerivedLevel(["video", "persona"], { ...statuses, video: "verified" }), "light");
  assert.equal(verificationDerivedLevel(["video", "persona"], { ...statuses, persona: "verified" }), "strong");
  assert.equal(verificationDerivedLevel(["video"], { ...statuses, video: "verified" }), "strong");
  assert.equal(verificationDerivedLevel(["persona"], { ...statuses, persona: "verified" }), "strong");
  assert.equal(verificationDerivedLevel(["video"], { video: "pending", persona: "verified" }), "none");

  assert.equal(verificationMaxLevel("none", "none", "none"), "none");
  assert.equal(verificationMaxLevel("light", "none", "none"), "light");
  assert.equal(verificationMaxLevel("none", "strong", "light"), "strong");
  assert.equal(verificationMaxLevel("strong", "light", "strong"), "strong");
});

test("accepted EN/HU seed copy forms five atomic valid design-state pairs", async () => {
  const english = await localeMessages("en");
  const hungarian = await localeMessages("hu");
  const enSeed = object(object(english.verificationAdmin, "en.verificationAdmin").seedCopy, "en.seedCopy");
  const huSeed = object(object(hungarian.verificationAdmin, "hu.verificationAdmin").seedCopy, "hu.seedCopy");
  const pairs = verificationSeedCopyPairs(enSeed, huSeed);
  assert.ok(pairs);
  assert.deepEqual(pairs.map((pair) => pair.key), [
    "default.video",
    "default.persona",
    "default.both",
    "default.pending",
    "default.rejected",
  ]);
  assert.equal(pairs.flatMap((pair) => [pair.en, pair.hu]).flatMap((copy) => [
    copy.title,
    copy.subtitle,
    copy.description,
    copy.actionLabel,
    copy.cancelLabel,
  ]).length, 50);
  const expectedActions = ["start_video", "start_persona", "start_video", "dismiss", "start_video"];
  for (const [index, pair] of pairs.entries()) {
    assert.equal(pair.revision, 1);
    assert.equal(pair.en.actionKind, expectedActions[index]);
    assert.equal(pair.hu.actionKind, expectedActions[index]);
    assert.equal(pair.en.actionUrl, "");
    assert.equal(pair.hu.actionUrl, "");
    assert.deepEqual(verificationGateCopyErrors(pair.en), []);
    assert.deepEqual(verificationGateCopyErrors(pair.hu), []);
  }
  assert.equal(
    pairs[2].en.description,
    "Complete step 1 first. You may stop there and return for the ID check when you are ready.",
  );
  assert.equal(
    pairs[2].hu.description,
    "Először teljesítsd az első lépést. Ezután megállhatsz, és később visszatérhetsz a személyazonosság-ellenőrzéshez.",
  );
  assert.equal(pairs[3].en.actionLabel, "Got it");
  assert.equal(pairs[4].en.actionLabel, "Try again");

  const missing = clone(enSeed);
  delete object(missing.video, "video").title;
  assert.equal(verificationSeedCopyPairs(missing, huSeed), null);

  const additive = clone(enSeed);
  additive.future = clone(enSeed.video);
  assert.equal(verificationSeedCopyPairs(additive, huSeed), null);

  const overlong = clone(enSeed);
  object(overlong.video, "video").title = "x".repeat(81);
  assert.equal(verificationSeedCopyPairs(overlong, huSeed), null);
});

test("gate copy validation is canonical, bounded, closed, and URL safe", () => {
  const valid = copyFixture();
  assert.deepEqual(verificationGateCopyErrors(valid), []);
  assert.equal(verificationTextLength("  🛡️🛡️  "), 4, "Unicode scalar count includes both scalar values per emoji");

  const cases: Array<[string, VerificationGateCopyLocale, string]> = [
    ["blank required title", { ...valid, title: "" }, "title"],
    ["overlong title", { ...valid, title: "x".repeat(81) }, "title"],
    ["uncanonical whitespace", { ...valid, title: " Video verification" }, "title"],
    ["non-NFC text", { ...valid, title: "Cafe\u0301" }, "title"],
    ["control text", { ...valid, description: "unsafe\u0001text" }, "description"],
    ["unpaired surrogate", { ...valid, description: "unsafe\ud800text" }, "description"],
    ["unknown symbol", { ...valid, iconValue: "unfrozen.symbol" }, "iconValue"],
    ["arbitrary asset URL", { ...valid, iconKind: "asset", iconValue: "https://example.test/icon.svg" }, "iconValue"],
    ["URL missing", { ...valid, actionKind: "url" }, "actionUrl"],
    ["HTTP URL", { ...valid, actionKind: "url", actionUrl: "http://example.test/path" }, "actionUrl"],
    ["credential URL", { ...valid, actionKind: "url", actionUrl: "https://user:pass@example.test/path" }, "actionUrl"],
    ["URL on native action", { ...valid, actionUrl: "https://example.test/path" }, "actionUrl"],
  ];
  for (const [label, copy, error] of cases) {
    assert.ok(verificationGateCopyErrors(copy).includes(error), label);
  }
  assert.deepEqual(verificationGateCopyErrors({
    ...valid,
    actionKind: "url",
    actionUrl: "https://example.test/verification",
  }), []);

  const additive = { ...valid, future: true } as VerificationGateCopyLocale;
  assert.deepEqual(verificationGateCopyErrors(additive), ["shape"]);
  const unknownAction = { ...valid, actionKind: "future" } as unknown as VerificationGateCopyLocale;
  assert.ok(verificationGateCopyErrors(unknownAction).includes("actionKind"));
});

test("badge metadata and grant drafts fail locally at every known boundary", () => {
  assert.deepEqual(verificationBadgeFixtures().map((badge) => badge.slot), VERIFICATION_BADGE_SLOTS);
  assert.equal(verificationBadgeFileError({ size: 1, type: "image/png" }), null);
  assert.equal(verificationBadgeFileError({ size: MAX_VERIFICATION_BADGE_BYTES, type: "image/svg+xml" }), "type");
  assert.equal(verificationBadgeFileError({ size: 0, type: "image/png" }), "empty");
  assert.equal(verificationBadgeFileError({ size: 1.5, type: "image/png" }), "empty");
  assert.equal(verificationBadgeFileError({ size: MAX_VERIFICATION_BADGE_BYTES + 1, type: "image/png" }), "size");
  assert.equal(verificationBadgeFileError({ size: 10, type: "image/jpeg" }), "type");

  const now = VERIFICATION_FIXTURE_EVALUATED_AT;
  assert.equal(verificationGrantDraftError({ level: "light", reason: "Support decision", expiresAt: null }, now), null);
  assert.equal(verificationGrantDraftError({ level: "strong", reason: "Support decision", expiresAt: now + 1 }, now), null);
  assert.equal(verificationGrantDraftError({ level: "none", reason: "Support decision", expiresAt: null }, now), "level");
  assert.equal(verificationGrantDraftError({ level: "light", reason: "", expiresAt: null }, now), "reason");
  assert.equal(verificationGrantDraftError({ level: "light", reason: " reason ", expiresAt: null }, now), "reason");
  assert.equal(verificationGrantDraftError({ level: "light", reason: "x".repeat(301), expiresAt: null }, now), "reason");
  assert.equal(verificationGrantDraftError({ level: "light", reason: "Support decision", expiresAt: now }, now), "expiry");
  assert.equal(verificationGrantDraftError({ level: "light", reason: "Support decision", expiresAt: now + 0.5 }, now), "expiry");

  const fixture = verificationUserFixture(
    7001,
    "Migration support grant",
    "The face moved outside the guide.",
  );
  assert.equal(fixture.uid, 7001);
  assert.equal(fixture.evaluatedAt, VERIFICATION_FIXTURE_EVALUATED_AT);
  assert.equal(fixture.effectiveSource, "granted");
  assert.equal(fixture.effectiveLevel, "strong");
  assert.equal(fixture.badgeVisible, true);
  assert.deepEqual(fixture.rejection, {
    method: "video",
    memberSafeReason: "The face moved outside the guide.",
    attempt: 2,
    maxAttempts: 5,
    manualReviewAvailable: true,
  });
  assert.deepEqual(fixture.capabilities, VERIFICATION_GRANT_CAPABILITIES);
});

test("the dormant UI has five tabs, responsive previews, Help, and no Core or proxy boundary", async () => {
  const [
    route,
    consoleSource,
    userPanel,
    userPage,
    shell,
    actions,
    styles,
  ] = await Promise.all([
    readFile(new URL("../app/(dashboard)/verification/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/VerificationAdminConsole.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/VerificationUserPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(dashboard)/users/[uid]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/Shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/adminActions.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(route, /if \(!VERIFICATION_CONTRACT_READY\) notFound\(\)/);
  assert.match(route, /verificationTabKey\(requestedTab\)/);
  assert.match(route, /previewCopy=\{\{/);
  assert.match(shell, /href: "\/verification"[\s\S]*ready: VERIFICATION_CONTRACT_READY/);
  assert.match(shell, /NAV\.filter\(\(item\) => item\.ready !== false\)/);
  assert.match(userPage, /VERIFICATION_CONTRACT_READY \? <VerificationUserPanel/);
  assert.match(consoleSource, /role="tablist"/);
  assert.match(consoleSource, /role="tabpanel"/);
  assert.match(consoleSource, /ArrowLeft/);
  assert.match(consoleSource, /history\.replaceState/);
  assert.match(consoleSource, /type="file" accept="image\/png"/);
  assert.doesNotMatch(consoleSource, /image\/svg\+xml/);
  assert.match(consoleSource, /type="search" value="" readOnly/);
  assert.match(consoleSource, /VERIFICATION_SCOPE_STATES/);
  assert.match(consoleSource, /verification-guardrails-card/);
  assert.match(consoleSource, /verification-queue-metric/);
  assert.match(consoleSource, /verification-stepper/);
  assert.match(consoleSource, /verification-rejection-preview/);
  assert.match(consoleSource, /const preview = previewCopy\[locale\]/);
  assert.match(consoleSource, /preview\.steps\.video/);
  assert.match(consoleSource, /preview\.pending\.wait/);
  assert.match(consoleSource, /preview\.rejected\.reason/);
  assert.match(consoleSource, /verification-badge-placements/);
  assert.match(consoleSource, /\(\[16, 24, 40\] as const\)/);
  assert.match(consoleSource, /stage-dark/);
  assert.match(consoleSource, /stage-light/);
  assert.match(consoleSource, /URL\.createObjectURL/);
  assert.match(consoleSource, /URL\.revokeObjectURL/);
  assert.match(userPanel, /verification_grant_read/);
  assert.match(userPanel, /verification_grant_edit/);
  assert.match(userPanel, /data\.evaluatedAt/);
  assert.match(userPanel, /data\.effectiveSource/);
  assert.match(userPanel, /data\.badgeVisible/);
  assert.match(userPanel, /data\.rejection/);
  assert.match(styles, /@media \(max-width: 980px\)[\s\S]*verification-compact-scope/);
  assert.match(styles, /\.verification-gate-preview/);
  assert.match(styles, /\.verification-badge-previews/);
  assert.match(styles, /\.slot-verified[\s\S]*#f23b8d/i);
  assert.match(styles, /\.verification-scopes-workspace/);

  for (const source of [route, consoleSource, userPanel]) {
    assert.doesNotMatch(source, /adminCall\s*\(|fetch\s*\(|sessionStorage|localStorage|\/api\/admin\//);
    assert.doesNotMatch(source, /status_code|\/v1\/|core\.friending\.com/i);
  }
  assert.doesNotMatch(userPage, /adminCall\("verification[_-]/);
  assert.doesNotMatch(actions, /"verification_[a-z_]+"/);
  assert.ok(ADMIN_ACTIONS.every((action) => !action.startsWith("verification_")));

  const help = ADMIN_HELP_PAGES.find((page) => page.route === "/verification");
  assert.ok(help);
  assert.deepEqual(help.sections, [
    "overview",
    "methodsAndLevels",
    "scopePrecedence",
    "scopeEditing",
    "featureMatrix",
    "gateMessages",
    "badges",
    "simulator",
    "teamGrant",
    "conflictsAndRetry",
    "privacyAndAudit",
  ]);
  const userHelp = ADMIN_HELP_PAGES.find((page) => page.route === "/users/[uid]");
  assert.ok(userHelp?.sections.includes("verificationGrant"));
});

test("verification UI and user-grant locale subtrees stay exactly paired", async () => {
  const english = await localeMessages("en");
  const hungarian = await localeMessages("hu");
  const enVerification = object(english.verificationAdmin, "en.verificationAdmin");
  const huVerification = object(hungarian.verificationAdmin, "hu.verificationAdmin");
  const enGrant = object(object(english.userDetail, "en.userDetail").verificationGrant, "en.verificationGrant");
  const huGrant = object(object(hungarian.userDetail, "hu.userDetail").verificationGrant, "hu.verificationGrant");

  function keyTree(value: unknown): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) return typeof value;
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, keyTree(nested)]),
    );
  }

  assert.deepEqual(keyTree(enVerification), keyTree(huVerification));
  assert.deepEqual(keyTree(enGrant), keyTree(huGrant));
  assert.equal(object(enVerification.levels, "en.levels").light, "Light");
  assert.equal(object(enVerification.levels, "en.levels").strong, "Strong");
  assert.equal(object(huVerification.levels, "hu.levels").light, "Alapszintű");
  assert.equal(object(huVerification.levels, "hu.levels").strong, "Erős");
  assert.equal(Object.keys(object(enVerification.features, "en.features")).length, 7);
  for (const feature of VERIFICATION_FEATURE_KEYS) {
    const segments = feature.split(".");
    let current: unknown = enVerification.features;
    for (const segment of segments) current = object(current, feature)[segment];
    assert.ok(current, `${feature} must have localized copy`);
  }
});
