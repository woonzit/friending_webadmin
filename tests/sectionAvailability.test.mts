import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import {
  SECTION_AVAILABILITY_SETTING_KEYS,
  normalizeManagedSettingsProxyBody,
  sectionAvailabilityDraftAfterConflict,
  sectionAvailabilityDraftAtAuthority,
  sectionAvailabilityDraftIssue,
  sectionAvailabilityDraftWithSection,
  sectionAvailabilityForStorefront,
  sectionAvailabilityRefusal,
  sectionAvailabilitySavePayload,
  sectionAvailabilitySettingsResponse,
  sectionAvailabilityWireSettingsResponse,
  type SectionAvailabilityConfiguration,
} from "../lib/sectionAvailability.ts";
import {
  authPolicySavePayload,
  type AuthPolicyVocabulary,
} from "../lib/authPolicyConfiguration.ts";

const FIXTURE_DIRECTORY = new URL("./fixtures/section_availability_wire/", import.meta.url);
const FIXTURE_ACCEPTED_CORE_TIP = "8894352a7d8d462c0f9c7899114305ce8249a727";
const FIXTURE_SOURCE_COMMIT = "d9a6c6bab4cd2814e41dd22a1eba24dc0586ae13";
const FIXTURE_CONTRACT_MANIFEST_SHA256 = "3396392034cf102d25d306951d68a769b079d7237a76337dfdaba5b2bb1a5fdd";
const FIXTURE_GENERATOR_SHA256 = "539bbfc3998e1a5fce62eb93942671e6ba5d8934b999c7fdf842cdad6901b3a5";
const FIXTURE_SET_SHA256 = "1c26425543a77b05933ec9f38c52ab89855f24d287554196c0f997d2b89e4882";
const FIXTURE_MANIFEST_SHA256 = "992deaef94f800f9bfeec1761bf93e08b6da7724df33f639096b647411fa560b";

const FIXTURE_BODY_FILES = [
  "appconfig-compiled-defaults.json",
  "appconfig-dates-global-on.json",
  "appconfig-malformed-settings.json",
  "appconfig-malformed-storefront.json",
  "appconfig-no-storefront.json",
  "appconfig-override-dates-on-usa.json",
  "appconfig-override-travel-off-hun.json",
  "appconfig-storefront-without-override.json",
  "appconfig-unknown-alpha3.json",
  "refusal-overrides-storefront-unknown.json",
  "refusal-overrides-value-loose.json",
  "refusal-section-enabled-loose.json",
  "webadmin-settings-clean.json",
  "webadmin-settings-stale.json",
] as const;

const FIXTURE_SOURCE_PATHS = [
  "config/auth_policy_vocabulary.json",
  "src/Core/Response.php",
  "src/Http/Controllers/AppController.php",
  "src/Http/Controllers/WebadminController.php",
  "src/Services/AuthPolicyAdminService.php",
  "src/Support/AppSettings.php",
  "src/Support/AuthMethodPolicy.php",
  "src/Support/AuthPolicyVocabulary.php",
  "src/Support/DatesFeatureFlags.php",
  "src/Support/SectionAvailabilityPolicy.php",
  "src/Support/Webadmin.php",
  "tests/section_availability_fixture_dump.php",
] as const;

const TEST_VOCABULARY: AuthPolicyVocabulary = {
  storefronts: [
    { alpha3: "GBR", nameEn: "United Kingdom", nameHu: "Egyesült Királyság" },
    { alpha3: "HUN", nameEn: "Hungary", nameHu: "Magyarország" },
    { alpha3: "USA", nameEn: "United States", nameHu: "Egyesült Államok" },
  ],
  callingCodes: [],
  regions: [],
};

type Json = Record<string, any>;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fixture(file: string): Promise<Json> {
  return JSON.parse(await readFile(new URL(file, FIXTURE_DIRECTORY), "utf8"));
}

function managedSetting(
  value: unknown,
  type: "section_enabled" | "section_enabled_overrides",
  invalidCodes: string[] = [],
): Record<string, unknown> {
  return {
    value,
    type,
    allowed_values: [],
    minimum: null,
    maximum: null,
    updated_at: 1_788_200_000,
    updated_by: "owner@example.test",
    warning: invalidCodes.length > 0,
    invalid_codes: invalidCodes,
  };
}

function fullResponse(overrides: Record<string, unknown> = {}): Json {
  return {
    success: true,
    status_code: 200,
    settings: {
      travel_enabled: managedSetting(true, "section_enabled"),
      travel_enabled_overrides: managedSetting({ HUN: false }, "section_enabled_overrides"),
      dates_enabled: managedSetting(false, "section_enabled"),
      dates_enabled_overrides: managedSetting({ USA: true }, "section_enabled_overrides"),
      ...overrides,
    },
    message: 200,
    status: 200,
    can_send: 0,
  };
}

function parsed(): SectionAvailabilityConfiguration {
  const value = sectionAvailabilitySettingsResponse(fullResponse(), {
    vocabulary: TEST_VOCABULARY,
    revision: 7,
  });
  assert.ok(value);
  return value;
}

test("the accepted section-availability corpus is byte-identical, inventory-exact, and provenance-bound", async () => {
  const manifestWire = await readFile(new URL("manifest.json", FIXTURE_DIRECTORY));
  assert.equal(sha256(manifestWire), FIXTURE_MANIFEST_SHA256);
  const manifest = JSON.parse(manifestWire.toString("utf8")) as Json;
  assert.deepEqual(Object.keys(manifest).sort(), [
    "contract_manifest_sha256",
    "contract_version",
    "fixture_set_sha256",
    "fixtures",
    "provenance",
    "schema_version",
    "source_commit",
  ]);
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.contract_version, 1);
  assert.equal(manifest.source_commit, FIXTURE_SOURCE_COMMIT);
  assert.equal(manifest.contract_manifest_sha256, FIXTURE_CONTRACT_MANIFEST_SHA256);
  assert.equal(manifest.fixture_set_sha256, FIXTURE_SET_SHA256);
  assert.deepEqual(Object.keys(manifest.provenance).sort(), [
    "generator",
    "generator_sha256",
    "source_paths",
    "wire_adapters",
  ]);
  assert.equal(manifest.provenance.generator, "tests/section_availability_fixture_dump.php");
  assert.equal(manifest.provenance.generator_sha256, FIXTURE_GENERATOR_SHA256);
  assert.deepEqual(manifest.provenance.source_paths, FIXTURE_SOURCE_PATHS);
  assert.deepEqual(manifest.provenance.wire_adapters, {
    app_config: "Friending\\Core\\Response::wirePayload",
    webadmin: "Friending\\Support\\Webadmin::reply",
  });
  assert.deepEqual(manifest.fixtures.map((row: Json) => row.file), [...FIXTURE_BODY_FILES]);
  assert.equal(manifest.fixtures.length, 14);
  assert.deepEqual(
    (await readdir(FIXTURE_DIRECTORY)).sort(),
    [...FIXTURE_BODY_FILES, "manifest.json"].sort(),
  );

  const aggregateRows: string[] = [];
  const consumerCounts = new Map<string, number>();
  for (const row of manifest.fixtures as Json[]) {
    assert.deepEqual(Object.keys(row).sort(), ["case", "consumer", "file", "route", "sha256"]);
    assert.match(row.file, /^[a-z0-9-]+\.json$/u);
    assert.ok(["ios", "webadmin"].includes(row.consumer));
    assert.equal(
      row.route,
      row.consumer === "ios"
        ? "/v1/app/ios_appconfig"
        : row.file.startsWith("webadmin-settings-")
          ? "/v1/webadmin/get_settings"
          : "/v1/webadmin/set_settings",
    );
    const wire = await readFile(new URL(row.file, FIXTURE_DIRECTORY));
    assert.equal(sha256(wire), row.sha256, row.file);
    assert.doesNotThrow(() => JSON.parse(wire.toString("utf8")), row.file);
    assert.doesNotMatch(
      wire.toString("utf8"),
      /WEBADMIN_(?:API|SESSION)_SECRET|MONGODB_URI|review_code|verification_code/iu,
      row.file,
    );
    aggregateRows.push(`${row.file}\0${row.sha256}`);
    consumerCounts.set(row.consumer, (consumerCounts.get(row.consumer) ?? 0) + 1);
  }
  assert.equal(sha256(aggregateRows.join("\n")), FIXTURE_SET_SHA256);
  assert.deepEqual(Object.fromEntries([...consumerCounts].sort()), { ios: 9, webadmin: 5 });
  assert.match(FIXTURE_ACCEPTED_CORE_TIP, /^[a-f0-9]{40}$/u);
  assert.notEqual(FIXTURE_ACCEPTED_CORE_TIP, FIXTURE_SOURCE_COMMIT);
});

test("every released Webadmin body passes the production section decoder", async () => {
  assert.deepEqual(
    sectionAvailabilityWireSettingsResponse(
      await fixture("webadmin-settings-clean.json"),
      TEST_VOCABULARY,
    ),
    {
      travel_enabled: { value: true, invalidCodes: [] },
      travel_enabled_overrides: {
        value: [{ storefront: "HUN", enabled: false }],
        invalidCodes: [],
      },
      dates_enabled: { value: false, invalidCodes: [] },
      dates_enabled_overrides: {
        value: [{ storefront: "USA", enabled: true }],
        invalidCodes: [],
      },
    },
  );
  assert.deepEqual(
    sectionAvailabilityWireSettingsResponse(
      await fixture("webadmin-settings-stale.json"),
      TEST_VOCABULARY,
    ),
    {
      travel_enabled_overrides: {
        value: [{ storefront: "ZZZ", enabled: false }],
        invalidCodes: ["ZZZ"],
      },
      dates_enabled_overrides: {
        value: [
          { storefront: "USA", enabled: true },
          { storefront: "ZZY", enabled: true },
        ],
        invalidCodes: ["ZZY"],
      },
    },
  );
  assert.deepEqual(sectionAvailabilityRefusal(
    await fixture("refusal-section-enabled-loose.json"),
  ), { setting: "travel_enabled", storefront: null });
  assert.deepEqual(sectionAvailabilityRefusal(
    await fixture("refusal-overrides-value-loose.json"),
  ), { setting: "dates_enabled_overrides", storefront: null });
  assert.deepEqual(sectionAvailabilityRefusal(
    await fixture("refusal-overrides-storefront-unknown.json"),
  ), { setting: "travel_enabled_overrides", storefront: "ZZZ" });
});

test("the editable decoder requires all four complete managed rows and exact warning semantics", () => {
  const value = parsed();
  assert.deepEqual(value.travel.overrides, [{ storefront: "HUN", enabled: false }]);
  assert.equal(value.dates.enabled, false);
  assert.equal(value.revision, 7);

  for (const key of SECTION_AVAILABILITY_SETTING_KEYS) {
    const candidate = fullResponse();
    delete candidate.settings[key];
    assert.equal(sectionAvailabilitySettingsResponse(candidate, {
      vocabulary: TEST_VOCABULARY,
      revision: 7,
    }), null, `missing ${key}`);
  }
  for (const candidate of [
    fullResponse({ travel_enabled: managedSetting(1, "section_enabled") }),
    fullResponse({ dates_enabled_overrides: managedSetting({ USA: "true" }, "section_enabled_overrides") }),
    fullResponse({ travel_enabled: { ...managedSetting(true, "section_enabled"), type: "boolean" } }),
    fullResponse({ travel_enabled: { ...managedSetting(true, "section_enabled"), minimum: 0 } }),
    fullResponse({ travel_enabled: { ...managedSetting(true, "section_enabled"), updated_at: "1" } }),
    fullResponse({ travel_enabled: { ...managedSetting(true, "section_enabled"), updated_by: "Owner@example.test" } }),
    fullResponse({ travel_enabled_overrides: {
      ...managedSetting({ HUN: false }, "section_enabled_overrides"),
      warning: true,
      invalid_codes: ["HUN"],
    } }),
  ]) {
    assert.equal(sectionAvailabilitySettingsResponse(candidate, {
      vocabulary: TEST_VOCABULARY,
      revision: 7,
    }), null);
  }
  assert.equal(sectionAvailabilitySettingsResponse(fullResponse(), {
    vocabulary: TEST_VOCABULARY,
    revision: 0,
  }), null);
});

test("historical unknown storefronts stay visible but block fresh saves", () => {
  const response = fullResponse({
    travel_enabled_overrides: managedSetting(
      { HUN: false, ZZZ: true },
      "section_enabled_overrides",
      ["ZZZ"],
    ),
  });
  const value = sectionAvailabilitySettingsResponse(response, {
    vocabulary: TEST_VOCABULARY,
    revision: 7,
  });
  assert.ok(value);
  assert.deepEqual(value.travel.overrides, [
    { storefront: "HUN", enabled: false },
    { storefront: "ZZZ", enabled: true },
  ]);
  assert.deepEqual(value.travel.invalidCodes, ["ZZZ"]);
  assert.equal(sectionAvailabilityDraftIssue(value), "vocabulary");
  assert.equal(sectionAvailabilitySavePayload(value), null);
});

test("availability resolves from the selected setting alone for every required storefront case", () => {
  const value = parsed();
  assert.equal(sectionAvailabilityForStorefront(value, "travel", null), true, "global answer");
  assert.equal(sectionAvailabilityForStorefront(value, "travel", "HUN"), false, "override");
  assert.equal(sectionAvailabilityForStorefront(value, "travel", "GBR"), true, "known without override");
  assert.equal(sectionAvailabilityForStorefront(value, "travel", "ZZZ"), true, "unknown without override");
  assert.equal(sectionAvailabilityForStorefront(value, "dates", "US"), true, "normalized override");
  assert.equal(sectionAvailabilityForStorefront(value, "dates", "???"), false, "malformed storefront");

  const unrelatedInputsChanged = {
    ...value,
    vocabulary: { storefronts: [], callingCodes: [], regions: [] },
    revision: 999,
  };
  assert.equal(sectionAvailabilityForStorefront(
    unrelatedInputsChanged,
    "travel",
    "HUN",
  ), false, "vocabulary and revision are not availability inputs");
});

test("switching either section away and back restores the exact prior state", () => {
  for (const section of ["travel", "dates"] as const) {
    const before = parsed();
    const away = sectionAvailabilityDraftWithSection(before, section, {
      enabled: !before[section].enabled,
    });
    const restored = sectionAvailabilityDraftWithSection(away, section, {
      enabled: before[section].enabled,
    });
    assert.deepEqual(restored, before, section);
  }
});

test("fresh payloads contain one real-boolean pair per section and no derived inputs", () => {
  const value = parsed();
  assert.equal(sectionAvailabilityDraftIssue(value), null);
  assert.deepEqual(sectionAvailabilitySavePayload(value), {
    travel_enabled: true,
    travel_enabled_overrides: { HUN: false },
    dates_enabled: false,
    dates_enabled_overrides: { USA: true },
  });
  const pending = sectionAvailabilityDraftWithSection(value, "travel", {
    overrides: [...value.travel.overrides, { storefront: "", enabled: true }],
  });
  assert.equal(sectionAvailabilityDraftIssue(pending), "storefront");
  assert.deepEqual(pending.travel.invalidCodes, [], "a blank draft row is not a stored vocabulary warning");
  const duplicate = sectionAvailabilityDraftWithSection(value, "travel", {
    overrides: [...value.travel.overrides, { storefront: "HUN", enabled: true }],
  });
  assert.equal(sectionAvailabilityDraftIssue(duplicate), "duplicateStorefront");
});

test("the same-origin boundary closes section pairs, real booleans, and shared CAS", () => {
  const settings = sectionAvailabilitySavePayload(parsed());
  assert.ok(settings);
  const body = { settings, expected_revision: 7 };
  const normalized = normalizeManagedSettingsProxyBody("set_settings", body);
  assert.ok(normalized);
  assert.equal(Object.getPrototypeOf(normalized), null);
  assert.deepEqual(JSON.parse(JSON.stringify(normalized)), body);
  assert.equal(normalizeManagedSettingsProxyBody("get_settings", {}), undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeManagedSettingsProxyBody("set_settings", {
    settings: { people_hero_enabled: true },
  }))), { settings: { people_hero_enabled: true } });
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeManagedSettingsProxyBody("set_settings", {
    settings: { travel_enabled: false, travel_enabled_overrides: {} },
    expected_revision: 7,
  }))), {
    settings: { travel_enabled: false, travel_enabled_overrides: {} },
    expected_revision: 7,
  });
  // The bridge owns shape, while Core owns membership in its generated vocabulary and exact refusal.
  assert.ok(normalizeManagedSettingsProxyBody("set_settings", {
    settings: { travel_enabled: false, travel_enabled_overrides: { ZZZ: true } },
    expected_revision: 7,
  }));
  const authPolicy = authPolicySavePayload({
    defaultMethods: { phone: false, email: true },
    methodOverrides: [],
    defaultRegions: "ALL",
    regionOverrides: [],
    phoneDialFormats: [],
    vocabulary: TEST_VOCABULARY,
    vocabularyWarnings: [],
    revision: 7,
    updatedAt: 0,
    updatedBy: "",
  });
  assert.ok(authPolicy);
  assert.ok(normalizeManagedSettingsProxyBody("set_settings", {
    settings: { ...authPolicy, ...settings },
    expected_revision: 7,
  }), "the existing complete auth family remains valid beside section pairs");

  for (const candidate of [
    { settings: { travel_enabled: true }, expected_revision: 7 },
    { settings: { dates_enabled_overrides: {} }, expected_revision: 7 },
    { settings: { travel_enabled: 1, travel_enabled_overrides: {} }, expected_revision: 7 },
    { settings: { travel_enabled: true, travel_enabled_overrides: { HUN: "false" } }, expected_revision: 7 },
    { settings: { travel_enabled: true, travel_enabled_overrides: [] }, expected_revision: 7 },
    { settings: { people_hero_enabled: true }, expected_revision: 7 },
    { settings: { ...settings, auth_policy_revision: 7 }, expected_revision: 7 },
    { settings, expected_revision: "7" },
    { settings, expected_revision: 0 },
    { settings, expected_revision: 7, admin_email: "attacker@example.test" },
  ]) assert.equal(normalizeManagedSettingsProxyBody("set_settings", candidate), null);
});

test("a shared revision conflict preserves both section edits and adopts authority metadata", () => {
  const draft = sectionAvailabilityDraftWithSection(parsed(), "travel", { enabled: false });
  const authoritative = {
    ...parsed(),
    revision: 9,
    travel: {
      ...parsed().travel,
      enabled: true,
      enabledUpdatedAt: 1_788_300_000,
      enabledUpdatedBy: "other@example.test",
    },
  };
  const rebased = sectionAvailabilityDraftAfterConflict(draft, authoritative, {
    currentRevision: 9,
  });
  assert.ok(rebased);
  assert.equal(rebased.travel.enabled, false);
  assert.deepEqual(rebased.travel.overrides, draft.travel.overrides);
  assert.equal(rebased.travel.enabledUpdatedAt, authoritative.travel.enabledUpdatedAt);
  assert.equal(rebased.revision, 9);
  assert.equal(sectionAvailabilityDraftAfterConflict(draft, {
    ...authoritative,
    revision: 8,
  }, { currentRevision: 9 }), null);
  assert.deepEqual(sectionAvailabilityDraftAtAuthority(draft, authoritative), rebased);
});

test("the Configuration source renders one unconditional control per section without a second gate", async () => {
  const [page, card, model, route, en, hu] = await Promise.all([
    readFile(new URL("../app/(dashboard)/configuration/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/SectionAvailabilityConfigurationCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/sectionAvailability.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../messages/en.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../messages/hu.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.equal(page.match(/adminCall\("set_settings"/g)?.length, 1);
  assert.match(page, /<SectionAvailabilityConfigurationCard/);
  assert.doesNotMatch(page, /SECTION_AVAILABILITY_CONTRACT_READY/);
  assert.doesNotMatch(`${card}\n${model}`, /contractReadiness|CONTRACT_READY|capabilit(?:y|ies)|build constant/iu);
  assert.doesNotMatch(`${card}\n${model}`, /from ["']countries-list["']/u);
  assert.equal(card.match(/type="checkbox"/g)?.length, 1, "one global switch source repeated once per section");
  assert.match(card, /SECTION_AVAILABILITY_SECTIONS\.map/);
  assert.match(page, /sectionAvailabilitySavePayload\(sectionAvailability\)/);
  assert.match(page, /commitSettings\(payload, "sectionAvailability", sectionAvailability\.revision\)/);
  assert.match(page, /sectionAvailabilityDraftAtAuthority/);
  assert.match(route, /normalizeManagedSettingsProxyBody\(action, body\)/);
  assert.match(en.configuration.sectionAvailability.visibilityOnly, /not an authorization/iu);
  assert.match(hu.configuration.sectionAvailability.visibilityOnly, /Nem jogosultsági/iu);

  function keyTree(value: unknown): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, keyTree(child)]));
  }
  assert.deepEqual(
    keyTree(en.configuration.sectionAvailability),
    keyTree(hu.configuration.sectionAvailability),
  );
});
