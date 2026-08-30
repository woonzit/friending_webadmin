import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import {
  APPEARANCE_BRIDGE_REFUSAL_STATUSES,
  APPEARANCE_BRIDGE_UNCERTAIN_STATUSES,
  APPEARANCE_CORE_REFUSAL_STATUSES,
  APPEARANCE_CORE_UNCERTAIN_STATUSES,
  APPEARANCE_DEFAULT_LANDING,
  APPEARANCE_DEFAULT_PALETTE,
  APPEARANCE_LANDING_KEYS,
  appearanceRuleInputOf,
  appearanceRuleMaterialMatches,
  decodeAppearanceDeleteResponse,
  decodeAppearanceGeocodeResponse,
  decodeAppearanceListResponse,
  decodeAppearancePreviewResponse,
  decodeAppearanceSaveResponse,
  normalizeAppearanceProxyBody,
  parseAppearancePreviewPayload,
  parseAppearanceRule,
  resolveAppearanceHero,
  resolveAppearanceLanding,
  resolveAppearanceLandingFields,
  resolveAppearancePalette,
  type AppearanceRule,
} from "../lib/appearanceRules.ts";

/**
 * T-488's production-generated wire corpus (lead-accepted Core tip `fab53c14afd5191438b59ccc4e52d0da81a0d315`,
 * `tests/fixtures/appearance_rules_wire/`), copied byte-identically. The production decoders must
 * accept every Webadmin body exactly as Core publishes it and classify every refusal by the
 * manifest's closed status map — this is the cross-lane binding the released consumer rests on.
 */
const FIXTURE_DIRECTORY = new URL("./fixtures/appearance_rules_wire/", import.meta.url);
const FIXTURE_ACCEPTED_CORE_TIP = "fab53c14afd5191438b59ccc4e52d0da81a0d315";
const FIXTURE_SOURCE_COMMIT = "b50432bd04b571f52d6191bd4feac4a6cc376085";
const FIXTURE_GENERATOR_SHA256 = "01e0721c337ee3f3f2abd444888396d159c6ced779b6b93d5c9e947a40da97ce";
const FIXTURE_SET_SHA256 = "461e150eeadfd4cea1851d8f37571540e2aba9085d7b17f566221d48d2c69877";
const FIXTURE_MANIFEST_SHA256 = "24ada7317285fc3631e03870c370b60322c6c5e6e0ee68f7e05c9df0a01920e7";
const FIXTURE_BODY_FILES = [
  "app-appearance-default-en.json",
  "app-appearance-geo-hu.json",
  "app-appearance-schema-invalid.json",
  "app-appearance-v1-geo-none-hu.json",
  "app-appearance-v2-geo-none-hu.json",
  "app-appearance-v2-global-defaults-en.json",
  "app-appearance-v2-storefront-logo-en.json",
  "appconfig-appearance-geo-hu.json",
  "appconfig-appearance-schema-invalid.json",
  "appconfig-appearance-v2-geo-none-hu.json",
  "appconfig-appearance-v2-global-defaults-en.json",
  "appconfig-appearance-v2-storefront-logo-en.json",
  "landing-content-geo-hu.json",
  "people-discover-hero-geo-hu.json",
  "webadmin-conflict.json",
  "webadmin-delete.json",
  "webadmin-geocode.json",
  "webadmin-list-v2.json",
  "webadmin-list.json",
  "webadmin-preview-parent-global-hu.json",
  "webadmin-preview-parent-storefront-hu.json",
  "webadmin-preview-v2-geo-hu.json",
  "webadmin-preview.json",
  "webadmin-save-v2.json",
  "webadmin-save.json",
  "webadmin-validation-v2-field.json",
  "webadmin-validation.json",
] as const;
const FIXTURE_SOURCE_PATHS = [
  "config/routes.php",
  "src/Core/Mongo.php",
  "src/Core/Request.php",
  "src/Core/Response.php",
  "src/Http/Controllers/AppController.php",
  "src/Http/Controllers/AppearanceController.php",
  "src/Http/Controllers/WebadminAppearanceController.php",
  "src/Http/Controllers/WebadminController.php",
  "src/Http/Middleware/WebadminSecretMiddleware.php",
  "src/Services/AppearanceCityGeocodeService.php",
  "src/Services/AppearanceMigrationPlanner.php",
  "src/Services/AppearanceResolverService.php",
  "src/Services/AppearanceRuleService.php",
  "src/Services/AppearanceRulesAdminException.php",
  "src/Services/AppearanceRulesAdminService.php",
  "src/Services/AppearanceTransaction.php",
  "src/Services/PeopleService.php",
  "src/Support/AppearancePolicy.php",
  "src/Support/GoogleGeo.php",
  "src/Support/StrictJson.php",
  "src/Support/Webadmin.php",
  "src/Support/WebadminRolePolicy.php",
  "tests/appearance_rules_fixture_dump.php",
  "tests/appearance_rules_fixture_dump_test.php",
];

type Json = Record<string, any>;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function fixtureManifest(): Promise<Json> {
  return JSON.parse(await readFile(new URL("manifest.json", FIXTURE_DIRECTORY), "utf8"));
}

async function fixture(file: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(file, FIXTURE_DIRECTORY), "utf8"));
}

test("the released appearance corpus is byte-identical, complete, and traceable to the Core source commit", async () => {
  const manifestWire = await readFile(new URL("manifest.json", FIXTURE_DIRECTORY), "utf8");
  assert.equal(sha256(manifestWire), FIXTURE_MANIFEST_SHA256);
  const manifest = JSON.parse(manifestWire) as Json;
  assert.deepEqual(Object.keys(manifest).sort(), [
    "control_plane_error_statuses",
    "fixture_set_sha256",
    "fixtures",
    "provenance",
    "schema_version",
    "source_commit",
  ]);
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.source_commit, FIXTURE_SOURCE_COMMIT);
  assert.equal(manifest.fixture_set_sha256, FIXTURE_SET_SHA256);
  assert.deepEqual(Object.keys(manifest.provenance).sort(), ["generator", "generator_sha256", "source_paths", "wire_adapters"]);
  assert.equal(manifest.provenance.generator, "tests/appearance_rules_fixture_dump.php");
  assert.equal(manifest.provenance.generator_sha256, FIXTURE_GENERATOR_SHA256);
  assert.deepEqual(manifest.provenance.source_paths, FIXTURE_SOURCE_PATHS);
  assert.deepEqual(manifest.provenance.wire_adapters, [
    "Friending\\Core\\Response::wirePayload",
    "Friending\\Support\\Webadmin::noStoreReply",
  ]);

  assert.deepEqual(manifest.fixtures.map((row: Json) => row.file), [...FIXTURE_BODY_FILES]);
  const inventory = (await readdir(FIXTURE_DIRECTORY)).sort();
  assert.deepEqual(inventory, [...FIXTURE_BODY_FILES, "manifest.json"].sort());

  const consumerCounts = new Map<string, number>();
  const aggregateRows: string[] = [];
  for (const row of manifest.fixtures as Json[]) {
    assert.deepEqual(Object.keys(row).sort(), ["case", "consumer", "file", "route", "sha256"]);
    assert.match(row.file, /^[a-z0-9-]+\.json$/u);
    assert.ok(["webadmin", "ios"].includes(row.consumer), row.file);
    if (row.consumer === "webadmin") {
      assert.match(row.route, /^\/v1\/webadmin\/(?:appearance_rules_(?:list|save|delete|preview)|appearance_city_geocode)$/u);
    } else {
      assert.ok(["/v1/app/appearance", "/v1/app/ios_appconfig", "/v1/app/landing_content", "/v1/people/discover"].includes(row.route), row.route);
    }
    const wire = await readFile(new URL(row.file, FIXTURE_DIRECTORY), "utf8");
    assert.equal(sha256(wire), row.sha256, `${row.file} must match its released byte hash`);
    assert.doesNotThrow(() => JSON.parse(wire));
    consumerCounts.set(row.consumer, (consumerCounts.get(row.consumer) ?? 0) + 1);
    aggregateRows.push(`${row.file}\0${row.sha256}`);
  }
  assert.deepEqual(Object.fromEntries([...consumerCounts].sort()), { ios: 14, webadmin: 13 });
  assert.equal(sha256(aggregateRows.join("\n")), FIXTURE_SET_SHA256);
  assert.match(FIXTURE_ACCEPTED_CORE_TIP, /^[0-9a-f]{40}$/);
  assert.notEqual(FIXTURE_ACCEPTED_CORE_TIP, FIXTURE_SOURCE_COMMIT, "the accepted provenance tip follows its source commit");
});

test("the production refusal maps equal Core's published control-plane status map exactly", async () => {
  const manifest = await fixtureManifest();
  const published = manifest.control_plane_error_statuses as Record<string, number>;
  assert.equal(Object.keys(published).length, 53);
  const local = new Map<string, number>([...APPEARANCE_CORE_REFUSAL_STATUSES, ...APPEARANCE_CORE_UNCERTAIN_STATUSES]);
  assert.equal(local.size, APPEARANCE_CORE_REFUSAL_STATUSES.size + APPEARANCE_CORE_UNCERTAIN_STATUSES.size, "no name is both refused and uncertain");
  assert.deepEqual(
    [...local].sort(([left], [right]) => left.localeCompare(right)),
    Object.entries(published).sort(([left], [right]) => left.localeCompare(right)),
  );
  // Only the 503 family is uncertain; everything else Core publishes proves a no-land.
  for (const [error, status] of Object.entries(published)) {
    assert.equal(APPEARANCE_CORE_UNCERTAIN_STATUSES.has(error), status === 503, error);
  }
  // The bridge vocabulary is the console's own and never overlaps Core's, except the shared editor gate.
  const overlap = [...APPEARANCE_BRIDGE_REFUSAL_STATUSES.keys(), ...APPEARANCE_BRIDGE_UNCERTAIN_STATUSES.keys()].filter((name) => local.has(name));
  assert.deepEqual(overlap, ["admin-write-required"]);
});

test("every released Webadmin body decodes through the production decoders with target binding", async () => {
  const list = decodeAppearanceListResponse(await fixture("webadmin-list.json"));
  assert.ok(list.ok, "list");
  // T-467b finding 11: the list arrives in Core's canonical production order (scope ascending, then the
  // service's stored order), so the console's own precedence sort is what puts geo → storefront → global first.
  assert.deepEqual(list.value.rules.map((rule) => [rule.id, rule.scope, rule.revision]), [
    ["600000000000000000000004", "geo", 2],
    ["600000000000000000000005", "geo", 3],
    ["600000000000000000000000", "geo", 4],
    ["600000000000000000000003", "geo", 9],
    ["600000000000000000000001", "global", 7],
    ["600000000000000000000002", "storefront", 11],
  ]);
  assert.deepEqual(list.value.defaults.palette, APPEARANCE_DEFAULT_PALETTE, "Core's compiled palette equals the console's display constants");
  assert.deepEqual(list.value.defaults.landing, APPEARANCE_DEFAULT_LANDING);
  const byId = (id: string): AppearanceRule => list.value.rules.find((rule) => rule.id === id)!;
  const global = byId("600000000000000000000001");
  const storefront = byId("600000000000000000000002");
  const geo = byId("600000000000000000000003");
  // Empty maps are JSON objects (finding 8/15): the storefront rule's light palette, the global rule's dark
  // palette and the plain geo rules' landing/palette maps are `{}`, never `[]`.
  assert.deepEqual(storefront.palette, { light: {}, dark: { inactive: "#405060" } });
  assert.deepEqual(global.palette, { light: { accent_pressed: "#102030" }, dark: {} });
  assert.deepEqual(byId("600000000000000000000004").landing, {});
  assert.deepEqual(byId("600000000000000000000004").palette, { light: {}, dark: {} });
  assert.deepEqual(storefront.landing, { title_text_hu: "Store cím", description_hu: "Storefront Hungarian description" });
  assert.deepEqual(geo.landing, { title_text_en: "Geo English title", description_en: "Geo English description" });
  assert.ok(list.value.rules.every((rule) => rule.hero.items.every((item) => item.id !== "")), "stored hero ids are minted");
  assert.equal(global.hero.items[0]?.sort_order, 1);
  assert.equal(geo.hero.items[0]?.title_color_mobile, "#aabbcc");

  // The preview fixture is the resolver's answer for the same three rules: the console's own
  // rule → global layering must agree with Core wherever the storefront tier does not intervene.
  const preview = decodeAppearancePreviewResponse(await fixture("webadmin-preview.json"));
  assert.ok(preview.ok, "preview");
  assert.deepEqual(preview.value.matched, { scope: "geo", rule_id: geo.id, location_source: "gps" });
  assert.equal(preview.value.revision, 11);
  const layered = resolveAppearancePalette([geo.palette, storefront.palette, global.palette], list.value.defaults.palette);
  assert.deepEqual(layered.values, preview.value.palette, "geo → storefront → global → defaults per role");
  const landing = resolveAppearanceLanding([geo.landing, storefront.landing, global.landing], list.value.defaults.landing, "hu");
  // Amendment v1.5 + finding 17 pinned by the corpus: the geo rule sets English title/description only, the
  // storefront rule Hungarian only — for lang=hu the storefront Hungarian wins over the higher layer's English,
  // and the background (video + poster) inherits per field from the global rule.
  assert.equal(preview.value.landing.title.text, "Store cím");
  assert.equal(preview.value.landing.description, "Storefront Hungarian description");
  assert.equal(landing.titleType, preview.value.landing.title.type);
  assert.equal(landing.backgroundType, preview.value.landing.background.type);
  assert.equal(landing.backgroundUrl, preview.value.landing.background.url);
  assert.equal(landing.posterUrl, preview.value.landing.background.poster_url);
  assert.equal(landing.titleText, preview.value.landing.title.text);
  assert.equal(landing.description, preview.value.landing.description);
  assert.deepEqual(resolveAppearanceHero([geo.hero, storefront.hero, global.hero]).map((item) => item.id), preview.value.hero.map((item) => item.id));
  assert.equal(preview.value.hero[0]?.text_style.mobile.title_size, 24);

  const saveBody = await fixture("webadmin-save.json");
  const savedRule = parseAppearanceRule((saveBody as Json).data.rule);
  assert.ok(savedRule);
  // Finding 11: the fixture is the CAS successor of the geo rule (8 → 9) with its full material.
  const update = decodeAppearanceSaveResponse(saveBody, { id: geo.id, expected_revision: geo.revision - 1, input: appearanceRuleInputOf(geo) });
  assert.ok(update.ok, "save bound by id, material and successor revision on update");
  assert.equal(update.value.revision, 9);
  assert.deepEqual(decodeAppearanceSaveResponse(saveBody, { id: geo.id, expected_revision: geo.revision, input: appearanceRuleInputOf(geo) }), { ok: false, kind: "uncertain", error: "unbound-revision" }, "a non-successor revision never adopts");
  assert.deepEqual(decodeAppearanceSaveResponse(saveBody, { id: geo.id, expected_revision: geo.revision - 1, input: { ...appearanceRuleInputOf(geo), name: "Other name" } }), { ok: false, kind: "uncertain", error: "unbound-material" }, "same id, different material never adopts");
  const create = decodeAppearanceSaveResponse(saveBody, { id: "", expected_revision: 0, input: appearanceRuleInputOf(savedRule) });
  assert.deepEqual(create, { ok: false, kind: "uncertain", error: "unbound-revision" }, "a create answer is always revision 1; this fixture is an update");
  assert.equal(appearanceRuleMaterialMatches(savedRule, appearanceRuleInputOf(geo)), true);
  assert.equal(decodeAppearanceSaveResponse(saveBody, { id: storefront.id, expected_revision: storefront.revision, input: appearanceRuleInputOf(storefront) }).ok, false, "another target never adopts this rule");
  // What the console would send back for this rule is exactly the fourteen-key body Core accepts.
  const roundTrip = normalizeAppearanceProxyBody("appearance_rules_save", { id: geo.id, expected_revision: geo.revision, rule: appearanceRuleInputOf(geo) });
  assert.ok(roundTrip);
  assert.deepEqual(Object.keys(roundTrip.rule as object).sort(), [
    "active", "center", "country_code", "ends_at", "hero", "landing", "name", "palette",
    "place_label", "priority", "radius_km", "scope", "starts_at", "storefront_country",
  ]);

  const remove = decodeAppearanceDeleteResponse(await fixture("webadmin-delete.json"), storefront.id);
  assert.deepEqual(remove, { ok: true, value: { id: storefront.id } });
  assert.equal(decodeAppearanceDeleteResponse(await fixture("webadmin-delete.json"), geo.id).ok, false);

  const geocode = decodeAppearanceGeocodeResponse(await fixture("webadmin-geocode.json"));
  assert.ok(geocode.ok);
  assert.deepEqual(geocode.value, [{
    place_id: "budapest-place",
    place_label: "Budapest, Hungary",
    country_code: "HU",
    center: { latitude: 47.4979, longitude: 19.0402 },
    radius_km: 28,
  }]);

  const conflict = await fixture("webadmin-conflict.json");
  for (const decoded of [
    decodeAppearanceSaveResponse(conflict, { id: geo.id, expected_revision: geo.revision, input: appearanceRuleInputOf(geo) }),
    decodeAppearanceDeleteResponse(conflict, geo.id),
    decodeAppearanceListResponse(conflict),
  ]) {
    assert.deepEqual(decoded, { ok: false, kind: "refused", error: "appearance-rule-conflict", status: 409 });
  }
  const validation = await fixture("webadmin-validation.json");
  assert.deepEqual(
    decodeAppearanceSaveResponse(validation, { id: "", expected_revision: 0, input: appearanceRuleInputOf(geo) }),
    { ok: false, kind: "refused", error: "appearance-rule-palette-color-invalid", status: 422 },
  );
});

test("the accepted v2 Webadmin cases bind the complete composer, parent-only merge, and closed field refusal", async () => {
  const list = decodeAppearanceListResponse(await fixture("webadmin-list-v2.json"));
  assert.ok(list.ok, "v2 list");
  assert.deepEqual(Object.keys(list.value.defaults.landing), [...APPEARANCE_LANDING_KEYS]);
  assert.deepEqual(list.value.defaults.landing, APPEARANCE_DEFAULT_LANDING);
  assert.deepEqual(list.value.rules.map((rule) => [rule.id, rule.scope, rule.revision]), [
    ["620000000000000000000003", "geo", 22],
    ["620000000000000000000001", "global", 20],
    ["620000000000000000000002", "storefront", 21],
  ]);
  const geo = list.value.rules.find((rule) => rule.scope === "geo")!;
  assert.equal(Object.keys(geo.landing).length, 38, "the fixture exercises a broad sparse composer override");
  assert.equal(geo.landing.title_type, "none");
  assert.equal(geo.landing.description_hu, undefined, "the HU description must exercise the English rule fallback");

  const saved = decodeAppearanceSaveResponse(await fixture("webadmin-save-v2.json"), {
    id: geo.id,
    expected_revision: 21,
    input: appearanceRuleInputOf(geo),
  });
  assert.ok(saved.ok, "v2 save is bound to its exact CAS successor and full material");
  assert.equal(saved.value.revision, 22);

  const parentGlobal = decodeAppearancePreviewResponse(await fixture("webadmin-preview-parent-global-hu.json"));
  const parentStorefront = decodeAppearancePreviewResponse(await fixture("webadmin-preview-parent-storefront-hu.json"));
  const resolved = decodeAppearancePreviewResponse(await fixture("webadmin-preview-v2-geo-hu.json"));
  assert.ok(parentGlobal.ok && parentStorefront.ok && resolved.ok);
  for (const preview of [parentGlobal.value, parentStorefront.value, resolved.value]) {
    assert.equal(preview.landing.schema, 2);
    assert.ok(preview.landing_flat && preview.landing_flat_sources && preview.landing_flat_defaults);
    assert.deepEqual(preview.landing_flat_defaults, APPEARANCE_DEFAULT_LANDING);
  }
  assert.deepEqual(parentGlobal.value.matched, { scope: "default", rule_id: "", location_source: "none" });
  assert.ok(APPEARANCE_LANDING_KEYS.every((key) => parentGlobal.value.landing_flat![key] === ""));
  assert.ok(APPEARANCE_LANDING_KEYS.every((key) => {
    const source = parentGlobal.value.landing_flat_sources![key];
    return source.scope === "none" && source.rule_id === "";
  }));
  assert.deepEqual(parentStorefront.value.matched, {
    scope: "storefront",
    rule_id: "620000000000000000000002",
    location_source: "none",
  });
  assert.equal(parentStorefront.value.landing_flat!.title_type, "image");
  assert.equal(parentStorefront.value.landing_flat_sources!.title_image_url.scope, "storefront");

  const localFlat = resolveAppearanceLandingFields(
    [geo.landing, parentStorefront.value.landing_flat!],
    parentStorefront.value.landing_flat_defaults!,
  );
  const local = resolveAppearanceLanding(
    [geo.landing, parentStorefront.value.landing_flat!],
    parentStorefront.value.landing_flat_defaults!,
    "hu",
  );
  assert.equal(local.description, "English-only geo description", "HU falls through both rule layers to the geo EN value before defaults");
  assert.equal(local.titleType, "none");
  assert.equal(localFlat.title_image_url, "https://img.example/friending-logo.png", "the pre-fallback parent logo remains present");
  assert.equal(resolved.value.landing.title.image_url, "", "the presentation gates hidden logo material by title type");
  assert.equal(local.effective.overlay_color, resolved.value.landing.v2!.background.overlay.color);
  assert.equal(local.effective.qr_enabled, resolved.value.landing.v2!.qr.enabled ? "true" : "false");

  const validation = await fixture("webadmin-validation-v2-field.json");
  assert.deepEqual(
    decodeAppearanceSaveResponse(validation, { id: geo.id, expected_revision: 21, input: appearanceRuleInputOf(geo) }),
    { ok: false, kind: "refused", error: "appearance-rule-invalid", status: 422 },
  );
});

test("the iOS bodies never enter a Webadmin material decoder except the shared appearance payload", async () => {
  // `/v1/app/appearance` is the same payload the preview action returns, so both app fixtures decode.
  for (const file of [
    "app-appearance-default-en.json",
    "app-appearance-geo-hu.json",
    "app-appearance-v1-geo-none-hu.json",
    "app-appearance-v2-geo-none-hu.json",
    "app-appearance-v2-global-defaults-en.json",
    "app-appearance-v2-storefront-logo-en.json",
  ]) {
    const decoded = decodeAppearancePreviewResponse(await fixture(file));
    assert.ok(decoded.ok, file);
  }
  const defaults = decodeAppearancePreviewResponse(await fixture("app-appearance-default-en.json"));
  assert.ok(defaults.ok);
  assert.deepEqual(defaults.value.matched, { scope: "default", rule_id: "", location_source: "none" });
  assert.equal(defaults.value.revision, 0);
  assert.deepEqual(defaults.value.palette, APPEARANCE_DEFAULT_PALETTE);
  assert.deepEqual(defaults.value.hero, []);

  const v1None = decodeAppearancePreviewResponse(await fixture("app-appearance-v1-geo-none-hu.json"));
  const v2Geo = decodeAppearancePreviewResponse(await fixture("app-appearance-v2-geo-none-hu.json"));
  const v2Defaults = decodeAppearancePreviewResponse(await fixture("app-appearance-v2-global-defaults-en.json"));
  const v2Logo = decodeAppearancePreviewResponse(await fixture("app-appearance-v2-storefront-logo-en.json"));
  assert.ok(v1None.ok && v2Geo.ok && v2Defaults.ok && v2Logo.ok);
  assert.equal(v1None.value.landing.schema, 1);
  assert.deepEqual(v1None.value.landing.title, { type: "text", text: "", image_url: "" });
  assert.equal(v2Geo.value.landing.schema, 2);
  assert.equal(v2Geo.value.landing.v2!.description.backdrop.alpha, 0.3);
  assert.equal(v2Geo.value.landing.v2!.qr.enabled, false);
  assert.equal(v2Defaults.value.landing.v2!.description.backdrop.alpha, 0, "integral JSON alpha is a valid number");
  assert.equal(v2Logo.value.landing.title.type, "image");
  assert.equal(v2Logo.value.landing.title.image_url, "https://img.example/friending-logo.png");

  assert.deepEqual(decodeAppearancePreviewResponse(await fixture("app-appearance-schema-invalid.json")), {
    ok: false,
    kind: "refused",
    error: "appearance-schema-invalid",
    status: 422,
  });
  assert.deepEqual(decodeAppearancePreviewResponse(await fixture("appconfig-appearance-schema-invalid.json")), {
    ok: false,
    kind: "refused",
    error: "appearance-schema-invalid",
    status: 422,
  });

  for (const file of [
    "appconfig-appearance-v2-geo-none-hu.json",
    "appconfig-appearance-v2-global-defaults-en.json",
    "appconfig-appearance-v2-storefront-logo-en.json",
  ]) {
    const body = await fixture(file) as Json;
    const nested = parseAppearancePreviewPayload(body.data.appearance);
    assert.ok(nested, file);
    assert.equal(nested.landing.schema, 2, file);
    assert.equal(nested.landing_flat, null, `${file} stays on the app-only shape`);
  }

  // The cold-start fragment, the legacy landing and the People projection are not Webadmin envelopes.
  for (const file of [
    "appconfig-appearance-geo-hu.json",
    "appconfig-appearance-v2-geo-none-hu.json",
    "appconfig-appearance-v2-global-defaults-en.json",
    "appconfig-appearance-v2-storefront-logo-en.json",
    "landing-content-geo-hu.json",
    "people-discover-hero-geo-hu.json",
  ]) {
    const body = await fixture(file);
    for (const [name, decoded] of Object.entries({
      list: decodeAppearanceListResponse(body),
      preview: decodeAppearancePreviewResponse(body),
      geocode: decodeAppearanceGeocodeResponse(body),
      remove: decodeAppearanceDeleteResponse(body, "x"),
    })) {
      assert.equal(decoded.ok, false, `${file} must not decode as ${name}`);
    }
  }
});
