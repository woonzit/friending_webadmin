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
  appearanceRuleInputOf,
  appearanceRuleMaterialMatches,
  decodeAppearanceDeleteResponse,
  decodeAppearanceGeocodeResponse,
  decodeAppearanceListResponse,
  decodeAppearancePreviewResponse,
  decodeAppearanceSaveResponse,
  normalizeAppearanceProxyBody,
  parseAppearanceRule,
  resolveAppearanceHero,
  resolveAppearanceLanding,
  resolveAppearancePalette,
  type AppearanceRule,
} from "../lib/appearanceRules.ts";

/**
 * T-467's production-generated wire corpus (Core replacement tip `d5e7494c032076b4a23e2bfc2a26d4665f88664f`,
 * `tests/fixtures/appearance_rules_wire/`), copied byte-identically. The production decoders must
 * accept every Webadmin body exactly as Core publishes it and classify every refusal by the
 * manifest's closed status map — this is the cross-lane binding the readiness switch depends on.
 */
const FIXTURE_DIRECTORY = new URL("./fixtures/appearance_rules_wire/", import.meta.url);
// Core T-467 round-2 delta `done` (2026-08-29 16:32Z): exact tip d5e7494c032076b4a23e2bfc2a26d4665f88664f,
// source provenance commit 448202998…, fixture set 7a225897… and generator b0cb5a6d… unchanged (payload
// bodies byte-identical to 31e74cf; only `manifest.json.source_commit` moved).
const FIXTURE_SOURCE_COMMIT = "448202998826dc82b8764d03eae7862279204240";
const FIXTURE_GENERATOR_SHA256 = "b0cb5a6db69c42f0e4c4a2b7bf24272ba9e313f5fbc44b6821f28249f6cf20f8";
const FIXTURE_SET_SHA256 = "7a225897dc0d83bf208016b392fe4329c978faabe2b4c389ab822d2614482952";
const FIXTURE_BODY_FILES = [
  "app-appearance-default-en.json",
  "app-appearance-geo-hu.json",
  "appconfig-appearance-geo-hu.json",
  "landing-content-geo-hu.json",
  "people-discover-hero-geo-hu.json",
  "webadmin-conflict.json",
  "webadmin-delete.json",
  "webadmin-geocode.json",
  "webadmin-list.json",
  "webadmin-preview.json",
  "webadmin-save.json",
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
  const manifest = await fixtureManifest();
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
  assert.deepEqual(Object.fromEntries([...consumerCounts].sort()), { ios: 5, webadmin: 7 });
  assert.equal(sha256(aggregateRows.join("\n")), FIXTURE_SET_SHA256);
});

test("the production refusal maps equal Core's published control-plane status map exactly", async () => {
  const manifest = await fixtureManifest();
  const published = manifest.control_plane_error_statuses as Record<string, number>;
  assert.equal(Object.keys(published).length, 52);
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

test("the iOS bodies never enter a Webadmin material decoder except the shared appearance payload", async () => {
  // `/v1/app/appearance` is the same payload the preview action returns, so both app fixtures decode.
  for (const file of ["app-appearance-default-en.json", "app-appearance-geo-hu.json"]) {
    const decoded = decodeAppearancePreviewResponse(await fixture(file));
    assert.ok(decoded.ok, file);
  }
  const defaults = decodeAppearancePreviewResponse(await fixture("app-appearance-default-en.json"));
  assert.ok(defaults.ok);
  assert.deepEqual(defaults.value.matched, { scope: "default", rule_id: "", location_source: "none" });
  assert.equal(defaults.value.revision, 0);
  assert.deepEqual(defaults.value.palette, APPEARANCE_DEFAULT_PALETTE);
  assert.deepEqual(defaults.value.hero, []);

  // The cold-start fragment, the legacy landing and the People projection are not Webadmin envelopes.
  for (const file of ["appconfig-appearance-geo-hu.json", "landing-content-geo-hu.json", "people-discover-hero-geo-hu.json"]) {
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
