import test from "node:test";
import assert from "node:assert/strict";
import {
  APPEARANCE_ACTIONS,
  APPEARANCE_DEFAULT_LANDING,
  APPEARANCE_DEFAULT_PALETTE,
  APPEARANCE_PALETTE_MODES,
  APPEARANCE_PALETTE_ROLES,
  appearanceLandingCoherent,
  appearanceLandingDraft,
  appearanceLandingWire,
  appearanceRuleDraft,
  appearanceRuleInputFromDraft,
  appearanceRuleIsLive,
  appearanceRuleMaterialMatches,
  appearanceTimestampFromLocalInput,
  appearanceTimestampToLocalInput,
  decodeAppearanceDeleteResponse,
  decodeAppearanceGeocodeResponse,
  decodeAppearanceListResponse,
  decodeAppearancePreviewResponse,
  decodeAppearanceSaveResponse,
  isAppearanceStorefront,
  localizedAppearanceCountries,
  newAppearanceRuleDraft,
  normalizeAppearancePaletteHex,
  normalizeAppearanceProxyBody,
  parseAppearanceGeocodePayload,
  parseAppearanceIpAddress,
  parseAppearanceListPayload,
  parseAppearancePreviewPayload,
  parseAppearanceRule,
  parseAppearanceRuleInput,
  parseAppearanceTimestamp,
  resolveAppearanceHero,
  resolveAppearanceLanding,
  resolveAppearancePalette,
  sortAppearanceRules,
  validateAppearanceRuleDraft,
  type AppearanceRule,
} from "../lib/appearanceRules.ts";
import {
  ADMIN_ACTIONS,
  ADMIN_ACTION_ACCESS,
  adminActionAccess,
  adminActionBodyLimit,
  isAdminActionAllowed,
} from "../lib/adminActions.ts";
import { APPEARANCE_RULES_CONTRACT_READY } from "../lib/contractReadiness.ts";

function heroItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "hero-1",
    media_url: "https://img.friending.co/api/cache/hero.jpg",
    type: "image",
    forward_url: "",
    title_en: "Pride week",
    title_hu: "Pride hét",
    subtitle_en: "",
    subtitle_hu: "",
    link_title_en: "",
    link_title_hu: "",
    title_size_web: null,
    title_color_web: "",
    title_weight_web: "",
    subtitle_size_web: null,
    subtitle_color_web: "",
    subtitle_weight_web: "",
    title_size_mobile: 24,
    title_color_mobile: "#ffffff",
    title_weight_mobile: "bold",
    subtitle_size_mobile: null,
    subtitle_color_mobile: "",
    subtitle_weight_mobile: "",
    sort_order: 10,
    active: true,
    ...overrides,
  };
}

function wireRule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "66d0a1b2c3d4e5f6a7b8c9d0",
    name: "Global appearance",
    scope: "global",
    storefront_country: "",
    country_code: "",
    center: null,
    radius_km: null,
    place_label: "",
    priority: 0,
    active: true,
    starts_at: null,
    ends_at: null,
    landing: {},
    hero: { mode: "replace", items: [heroItem()] },
    palette: { light: { accent: "#007F91" }, dark: {} },
    revision: 3,
    created_at: "2026-08-29T10:00:00Z",
    updated_at: "2026-08-29T11:00:00Z",
    updated_by: "lead@friending.com",
    ...overrides,
  };
}

function geoRule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return wireRule({
    id: "66d0a1b2c3d4e5f6a7b8c9d1",
    name: "Budapest pride",
    scope: "geo",
    country_code: "HU",
    center: { latitude: 47.4979, longitude: 19.0402 },
    radius_km: 25,
    place_label: "Budapest",
    priority: 10,
    starts_at: "2026-06-01T00:00:00Z",
    ends_at: "2026-07-01T00:00:00Z",
    landing: { background_type: "image", background_url: "https://img.friending.co/api/cache/pride.jpg" },
    hero: { mode: "inherit", items: [] },
    palette: { light: { accent: "#FF00AA", on_accent: "#000000" }, dark: { accent: "#FFAAEE" } },
    ...overrides,
  });
}

function storefrontRule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return wireRule({
    id: "66d0a1b2c3d4e5f6a7b8c9d2",
    name: "United States store",
    scope: "storefront",
    storefront_country: "USA",
    priority: 5,
    hero: { mode: "inherit", items: [] },
    palette: { light: {}, dark: {} },
    migrated_from: "country",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Rule parsing
// ---------------------------------------------------------------------------

test("a Core rule projection decodes exactly and keeps its provenance", () => {
  const global = parseAppearanceRule(wireRule());
  assert.ok(global);
  assert.equal(global.scope, "global");
  assert.equal(global.hero.items.length, 1);
  assert.equal(global.hero.items[0]?.title_size_mobile, 24);
  assert.equal(global.palette.light.accent, "#007F91");
  assert.equal(global.migrated_from, null);

  const geo = parseAppearanceRule(geoRule());
  assert.ok(geo);
  assert.deepEqual(geo.center, { latitude: 47.4979, longitude: 19.0402 });
  assert.equal(geo.radius_km, 25);
  assert.equal(geo.landing.background_url, "https://img.friending.co/api/cache/pride.jpg");
  assert.equal(geo.landing.title_text_en, undefined, "absent landing keys stay absent (inherit)");

  const storefront = parseAppearanceRule(storefrontRule());
  assert.ok(storefront);
  assert.equal(storefront.storefront_country, "USA");
  assert.equal(storefront.migrated_from, "country");
});

test("Core's empty-map encoding (`[]`) is read as the empty object for landing and palette modes only", () => {
  const rule = parseAppearanceRule(wireRule({ landing: [], palette: { light: [], dark: { accent: "#75F0F4" } } }));
  assert.ok(rule);
  assert.deepEqual(rule.landing, {});
  assert.deepEqual(rule.palette, { light: {}, dark: { accent: "#75F0F4" } });
  assert.equal(parseAppearanceRule(wireRule({ palette: [] })), null, "the palette container itself always carries its two modes");
  assert.equal(parseAppearanceRule(wireRule({ hero: [] })), null, "hero is never an array");
  assert.equal(parseAppearanceRule(wireRule({ center: [] })), null);
});

test("rule decoding fails closed on unknown, missing, loose, or scope-inconsistent material", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["extra key", wireRule({ extra: 1 })],
    ["missing revision", (() => { const rule = wireRule(); delete rule.revision; return rule; })()],
    ["string priority", wireRule({ priority: "0" })],
    ["priority above cap", wireRule({ priority: 10_001 })],
    ["string active", wireRule({ active: "true" })],
    ["revision zero", wireRule({ revision: 0 })],
    ["unknown scope", wireRule({ scope: "country" })],
    ["global with storefront", wireRule({ storefront_country: "HUN" })],
    ["storefront alpha-2", storefrontRule({ storefront_country: "US" })],
    ["storefront with center", storefrontRule({ center: { latitude: 1, longitude: 1 } })],
    ["geo without label", geoRule({ place_label: "" })],
    ["geo radius above cap", geoRule({ radius_km: 501 })],
    ["geo latitude out of range", geoRule({ center: { latitude: 91, longitude: 19 } })],
    ["geo center extra key", geoRule({ center: { latitude: 47, longitude: 19, altitude: 1 } })],
    ["geo bad alpha-2", geoRule({ country_code: "XX" })],
    ["window reversed", geoRule({ starts_at: "2026-07-01T00:00:00Z", ends_at: "2026-06-01T00:00:00Z" })],
    ["window loose timestamp", geoRule({ starts_at: "2026-06-01T00:00:00+02:00" })],
    ["window impossible date", geoRule({ starts_at: "2026-02-30T00:00:00Z" })],
    ["landing unknown key", wireRule({ landing: { colour: "red" } })],
    ["landing bad background type", wireRule({ landing: { background_type: "gif" } })],
    ["landing http-less url", wireRule({ landing: { background_url: "cdn.example.com/x.jpg" } })],
    ["landing description too long", wireRule({ landing: { description_en: "x".repeat(301) } })],
    ["hero unknown mode", wireRule({ hero: { mode: "append", items: [] } })],
    ["hero inherit with items", wireRule({ hero: { mode: "inherit", items: [heroItem()] } })],
    ["hero item missing key", wireRule({ hero: { mode: "replace", items: [(() => { const item = heroItem(); delete item.active; return item; })()] } })],
    ["hero item size out of range", wireRule({ hero: { mode: "replace", items: [heroItem({ title_size_web: 9 })] } })],
    ["hero item uppercase colour", wireRule({ hero: { mode: "replace", items: [heroItem({ title_color_web: "#FFFFFF" })] } })],
    ["hero item bad weight", wireRule({ hero: { mode: "replace", items: [heroItem({ title_weight_web: "heavy" })] } })],
    ["hero item media not a url", wireRule({ hero: { mode: "replace", items: [heroItem({ media_url: "" })] } })],
    ["palette unknown role", wireRule({ palette: { light: { primary: "#000000" }, dark: {} } })],
    ["palette mode as a non-empty array", wireRule({ palette: { light: ["#007F91"], dark: {} } })],
    ["landing as a non-empty array", wireRule({ landing: ["https://img.example/x.jpg"] })],
    ["palette lowercase hex", wireRule({ palette: { light: { accent: "#007f91" }, dark: {} } })],
    ["palette hex without hash", wireRule({ palette: { light: { accent: "007F91" }, dark: {} } })],
    ["palette unknown mode", wireRule({ palette: { light: {}, dark: {}, dim: {} } })],
    ["migrated_from foreign value", storefrontRule({ migrated_from: "city" })],
    ["control character in name", wireRule({ name: "badname" })],
  ];
  for (const [label, value] of cases) {
    assert.equal(parseAppearanceRule(value), null, label);
  }
  assert.equal(parseAppearanceRule(null), null);
  assert.equal(parseAppearanceRule([]), null);
  assert.equal(parseAppearanceRule("rule"), null);
});

const DEFAULTS = { palette: APPEARANCE_DEFAULT_PALETTE, landing: APPEARANCE_DEFAULT_LANDING };

test("the list payload demands unique ids, at most one global rule, and Core's exact defaults", () => {
  const list = parseAppearanceListPayload({ rules: [wireRule(), geoRule(), storefrontRule()], defaults: DEFAULTS });
  assert.ok(list);
  assert.equal(list.rules.length, 3);
  assert.deepEqual(list.defaults.palette, APPEARANCE_DEFAULT_PALETTE);
  assert.deepEqual(list.defaults.landing, APPEARANCE_DEFAULT_LANDING);

  const withDefaults = parseAppearanceListPayload({
    rules: [],
    defaults: {
      palette: { light: { ...APPEARANCE_DEFAULT_PALETTE.light, accent: "#123456" }, dark: APPEARANCE_DEFAULT_PALETTE.dark },
      landing: { ...APPEARANCE_DEFAULT_LANDING, title_text_en: "friending" },
    },
  });
  assert.ok(withDefaults);
  assert.equal(withDefaults.defaults.palette.light.accent, "#123456");
  assert.equal(withDefaults.defaults.landing.title_text_en, "friending");

  assert.equal(parseAppearanceListPayload({ rules: [wireRule()] }), null, "missing defaults are never substituted locally");
  assert.equal(parseAppearanceListPayload({ rules: [wireRule(), wireRule()], defaults: DEFAULTS }), null, "duplicate id");
  assert.equal(parseAppearanceListPayload({ rules: [wireRule(), wireRule({ id: "other" })], defaults: DEFAULTS }), null, "two globals");
  assert.equal(parseAppearanceListPayload({ rules: [wireRule({ priority: "0" })], defaults: DEFAULTS }), null, "one bad rule poisons the list");
  assert.equal(parseAppearanceListPayload({ rules: [], defaults: { palette: APPEARANCE_DEFAULT_PALETTE } }), null, "partial defaults");
  assert.equal(parseAppearanceListPayload({ rules: [], defaults: { palette: { light: {}, dark: {} }, landing: APPEARANCE_DEFAULT_LANDING } }), null, "incomplete default palette");
  assert.equal(parseAppearanceListPayload({ rules: [], defaults: { palette: APPEARANCE_DEFAULT_PALETTE, landing: { title_text_en: "x" } } }), null, "incomplete default landing");
  assert.equal(parseAppearanceListPayload({ rules: {}, defaults: DEFAULTS }), null);
  assert.equal(parseAppearanceListPayload([]), null);
  assert.equal(parseAppearanceListPayload({ rules: [], defaults: DEFAULTS, extra: true }), null);
});

// ---------------------------------------------------------------------------
// Preview and geocode payloads
// ---------------------------------------------------------------------------

function previewPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    revision: 7,
    content_version: "7:2026-08-29T11:00:00Z",
    landing: {
      background: { type: "image", url: "https://img.friending.co/api/cache/pride.jpg", poster_url: "" },
      title: { type: "text", text: "friending.", image_url: "" },
      description: "Meet people near you.",
    },
    hero: [{
      id: "hero-1",
      media_url: "https://img.friending.co/api/cache/hero.jpg",
      type: "image",
      forward_url: "https://friending.com/pride",
      image_url: "https://img.friending.co/api/cache/hero.jpg",
      destination_url: "https://friending.com/pride",
      title: "Pride week",
      subtitle: "",
      link_title: "",
      text_style: {
        web: { title_size: null, title_color: "", title_weight: "", subtitle_size: null, subtitle_color: "", subtitle_weight: "" },
        mobile: { title_size: 24, title_color: "#ffffff", title_weight: "bold", subtitle_size: null, subtitle_color: "", subtitle_weight: "" },
      },
    }],
    palette: APPEARANCE_DEFAULT_PALETTE,
    matched: { scope: "geo", rule_id: "66d0a1b2c3d4e5f6a7b8c9d1", location_source: "gps" },
    ...overrides,
  };
}

test("the test-location preview decodes the app payload and refuses vocabulary drift", () => {
  const preview = parseAppearancePreviewPayload(previewPayload());
  assert.ok(preview);
  assert.equal(preview.revision, 7);
  assert.equal(preview.matched.scope, "geo");
  assert.equal(preview.hero[0]?.title, "Pride week");
  assert.equal(preview.landing.title.text, "friending.");

  const defaults = parseAppearancePreviewPayload(previewPayload({
    revision: 0,
    content_version: 0,
    hero: [],
    matched: { scope: "default", rule_id: "", location_source: "none" },
  }));
  assert.ok(defaults);
  assert.equal(defaults.content_version, "0");
  assert.equal(defaults.matched.scope, "default");

  assert.equal(preview.hero[0]?.text_style.mobile.title_size, 24);
  assert.equal(parseAppearancePreviewPayload(previewPayload({ matched: { scope: "country", rule_id: "x", location_source: "ip" } })), null, "dropped country tier");
  assert.equal(parseAppearancePreviewPayload(previewPayload({ matched: { scope: "default", rule_id: "x", location_source: "ip" } })), null, "default with a rule id");
  assert.equal(parseAppearancePreviewPayload(previewPayload({ matched: { scope: "geo", rule_id: "", location_source: "gps" } })), null, "a matched rule must be named");
  assert.equal(parseAppearancePreviewPayload(previewPayload({ matched: { scope: "global", rule_id: "", location_source: "none" } })), null, "global match without its id");
  const heroItem = (previewPayload().hero as Record<string, unknown>[])[0]!;
  assert.equal(parseAppearancePreviewPayload(previewPayload({ hero: [{ ...heroItem, text_style: { web: {}, mobile: {} } }] })), null, "text_style must carry the six style keys");
  assert.equal(parseAppearancePreviewPayload(previewPayload({ hero: [{ ...heroItem, text_style: { web: heroItem.text_style, mobile: {}, print: {} } }] })), null, "text_style platforms are closed");
  assert.equal(parseAppearancePreviewPayload(previewPayload({ hero: [{ ...heroItem, text_style: { ...(heroItem.text_style as object), mobile: { title_size: 500, title_color: "", title_weight: "", subtitle_size: null, subtitle_color: "", subtitle_weight: "" } } }] })), null, "text_style sizes stay bounded");
  assert.equal(parseAppearancePreviewPayload(previewPayload({ matched: { scope: "geo", rule_id: "x", location_source: "wifi" } })), null, "unknown location source");
  assert.equal(parseAppearancePreviewPayload(previewPayload({ palette: { light: {}, dark: {} } })), null, "incomplete palette");
  assert.equal(parseAppearancePreviewPayload(previewPayload({ landing: { background: { type: "image", url: "", poster_url: "" }, title: { type: "text", text: "", image_url: "" } } })), null, "missing description");
  assert.equal(parseAppearancePreviewPayload(previewPayload({ revision: -1 })), null);
  assert.equal(parseAppearancePreviewPayload(previewPayload({ extra: 1 })), null);
  assert.equal(parseAppearancePreviewPayload(previewPayload({ hero: [{ id: "x" }] })), null, "partial hero item");
});

test("geocode candidates decode exactly", () => {
  const candidates = parseAppearanceGeocodePayload({
    candidates: [{
      place_id: "ChIJyc_U0TTDQUcRYBEeDCnEAAQ",
      place_label: "Budapest, Hungary",
      country_code: "HU",
      center: { latitude: 47.4979, longitude: 19.0402 },
      radius_km: 23,
    }],
  });
  assert.ok(candidates);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.radius_km, 23);

  assert.deepEqual(parseAppearanceGeocodePayload({ candidates: [] }), []);
  assert.equal(parseAppearanceGeocodePayload({ candidates: [{ place_id: "x", place_label: "Nowhere", country_code: "ZZ", center: { latitude: 0, longitude: 0 }, radius_km: 5 }] }), null, "unknown alpha-2");
  assert.equal(parseAppearanceGeocodePayload({ candidates: [{ place_id: "x", place_label: "Nowhere", country_code: "", center: { latitude: 0, longitude: 0 }, radius_km: 0.5 }] }), null, "radius below the floor");
  assert.equal(parseAppearanceGeocodePayload({ results: [] }), null);
});

// ---------------------------------------------------------------------------
// Inheritance
// ---------------------------------------------------------------------------

test("the palette resolves per role down the chain and records where each value came from", () => {
  const geo = parseAppearanceRule(geoRule());
  const global = parseAppearanceRule(wireRule());
  assert.ok(geo && global);
  const resolved = resolveAppearancePalette([geo.palette, global.palette], APPEARANCE_DEFAULT_PALETTE);
  assert.equal(resolved.values.light.accent, "#FF00AA");
  assert.equal(resolved.sources.light.accent, "rule");
  assert.equal(resolved.values.light.on_accent, "#000000");
  assert.equal(resolved.values.light.accent_pressed, "#006776");
  assert.equal(resolved.sources.light.accent_pressed, "default");
  assert.equal(resolved.values.dark.accent, "#FFAAEE");
  assert.equal(resolved.values.dark.inactive, "#8A9497");

  const inherited = resolveAppearancePalette([{ light: {}, dark: {} }, global.palette], APPEARANCE_DEFAULT_PALETTE);
  assert.equal(inherited.values.light.accent, "#007F91");
  assert.equal(inherited.sources.light.accent, "inherited");
  for (const mode of APPEARANCE_PALETTE_MODES) {
    for (const role of APPEARANCE_PALETTE_ROLES) {
      assert.match(inherited.values[mode][role], /^#[0-9A-F]{6}$/);
    }
  }
});

test("landing inherits per field (Amendment v1.5) with the language fallback and hero replaces or inherits", () => {
  const geo = parseAppearanceRule(geoRule({ landing: { background_type: "video", background_url: "https://cdn.friending.co/pride.mp4", background_poster_url: "https://cdn.friending.co/pride.jpg", description_hu: "Budapesti pride." } }));
  const global = parseAppearanceRule(wireRule({ landing: { title_type: "text", title_text_en: "Global title", description_en: "Global copy" } }));
  assert.ok(geo && global);

  const hu = resolveAppearanceLanding([geo.landing, global.landing], APPEARANCE_DEFAULT_LANDING, "hu");
  assert.equal(hu.backgroundType, "video");
  assert.equal(hu.backgroundUrl, "https://cdn.friending.co/pride.mp4");
  assert.equal(hu.posterUrl, "https://cdn.friending.co/pride.jpg");
  assert.equal(hu.titleType, "text");
  assert.equal(hu.titleText, APPEARANCE_DEFAULT_LANDING.title_text_hu, "the Hungarian title inherits per field down to the compiled default");
  assert.equal(hu.description, "Budapesti pride.");

  const en = resolveAppearanceLanding([geo.landing, global.landing], APPEARANCE_DEFAULT_LANDING, "en");
  assert.equal(en.titleText, "Global title");
  assert.equal(en.description, "Global copy", "an override without English copy does not win the English description");

  // The reviewed storefront poster-only case: the poster wins on its own while the video stays global.
  const posterOnly = resolveAppearanceLanding([{ background_poster_url: "https://cdn.friending.co/store.jpg" }, geo.landing, global.landing], APPEARANCE_DEFAULT_LANDING, "en");
  assert.equal(posterOnly.backgroundUrl, "https://cdn.friending.co/pride.mp4");
  assert.equal(posterOnly.posterUrl, "https://cdn.friending.co/store.jpg");

  // The poster is dropped whenever the effective background is not a video.
  const imageOverPoster = resolveAppearanceLanding([{ background_type: "image", background_url: "https://cdn.friending.co/still.jpg" }, geo.landing], APPEARANCE_DEFAULT_LANDING, "en");
  assert.equal(imageOverPoster.backgroundType, "image");
  assert.equal(imageOverPoster.backgroundUrl, "https://cdn.friending.co/still.jpg");
  assert.equal(imageOverPoster.posterUrl, "");

  // A text without a title type does not change the inherited image title.
  const imageTitle = resolveAppearanceLanding([{ title_text_hu: "Store cím" }, { title_type: "image", title_image_url: "https://cdn.friending.co/title.png" }], APPEARANCE_DEFAULT_LANDING, "hu");
  assert.equal(imageTitle.titleType, "image");
  assert.equal(imageTitle.titleImageUrl, "https://cdn.friending.co/title.png");
  assert.equal(imageTitle.titleText, "Store cím");

  // Blank-to-English fallback applies after per-field resolution.
  const fallback = resolveAppearanceLanding([{ description_en: "Only English" }], { ...APPEARANCE_DEFAULT_LANDING, description_hu: "" }, "hu");
  assert.equal(fallback.description, "Only English");

  // T-467b finding 17: a higher layer's English never outranks a lower layer's requested language.
  const crossLayer = [{ description_en: "Geo English", title_text_en: "Geo title" }, { description_hu: "Globális leírás", title_text_hu: "Globális cím" }];
  const crossHu = resolveAppearanceLanding(crossLayer, { ...APPEARANCE_DEFAULT_LANDING, description_hu: "", title_text_hu: "" }, "hu");
  assert.equal(crossHu.description, "Globális leírás");
  assert.equal(crossHu.titleText, "Globális cím");
  const crossEn = resolveAppearanceLanding(crossLayer, APPEARANCE_DEFAULT_LANDING, "en");
  assert.equal(crossEn.description, "Geo English");
  assert.equal(crossEn.titleText, "Geo title");
  const noHungarian = resolveAppearanceLanding([{ description_en: "Geo English" }, { description_en: "Global English" }], { ...APPEARANCE_DEFAULT_LANDING, description_hu: "" }, "hu");
  assert.equal(noHungarian.description, "Geo English", "English falls back only when the whole chain has no Hungarian");

  const defaultsOnly = resolveAppearanceLanding([], APPEARANCE_DEFAULT_LANDING, "hu");
  assert.equal(defaultsOnly.titleText, "friending.");
  assert.equal(defaultsOnly.description, APPEARANCE_DEFAULT_LANDING.description_hu);

  const globalRule = parseAppearanceRule(wireRule());
  assert.ok(globalRule);
  assert.equal(resolveAppearanceHero([geo.hero, globalRule.hero]).length, 1, "inherit keeps the global list");
  const replaced = parseAppearanceRule(geoRule({ hero: { mode: "replace", items: [] } }));
  assert.ok(replaced);
  assert.equal(resolveAppearanceHero([replaced.hero, globalRule.hero]).length, 0, "replace with no items hides the carousel");
  assert.equal(resolveAppearanceHero([]).length, 0);
});

// ---------------------------------------------------------------------------
// Editor draft ↔ wire
// ---------------------------------------------------------------------------

test("blank editor fields inherit; filled fields reach the wire per field (Amendment v1.5)", () => {
  const blank = appearanceLandingDraft({});
  assert.equal(blank.title_type, "", "no stored title type is the inherited state");
  assert.deepEqual(appearanceLandingWire(blank), {});

  const filled = { ...blank, background_type: "video", background_url: "https://cdn.friending.co/a.mp4", background_poster_url: "https://cdn.friending.co/a.jpg", description_en: "Hello", title_text_hu: "Szia" };
  assert.deepEqual(appearanceLandingWire(filled), {
    background_type: "video",
    background_url: "https://cdn.friending.co/a.mp4",
    background_poster_url: "https://cdn.friending.co/a.jpg",
    title_text_hu: "Szia",
    description_en: "Hello",
  }, "blank localized siblings are absent, never empty strings");

  const posterOnly = { ...blank, background_poster_url: "https://cdn.friending.co/store.jpg" };
  assert.deepEqual(appearanceLandingWire(posterOnly), { background_poster_url: "https://cdn.friending.co/store.jpg" }, "a poster inherits on its own");

  const textMode = { ...blank, title_type: "text" };
  assert.deepEqual(appearanceLandingWire(textMode), { title_type: "text" }, "an explicit text title keeps the inherited texts");

  const imageTitleWithoutAsset = { ...blank, title_type: "image" };
  assert.deepEqual(appearanceLandingWire(imageTitleWithoutAsset), { title_type: "image" });
  assert.equal(appearanceLandingCoherent(appearanceLandingWire(imageTitleWithoutAsset)), false, "an image title without its asset is not coherent");

  const stored = { title_text_hu: "Store cím" };
  assert.deepEqual(appearanceLandingWire(appearanceLandingDraft(stored)), stored, "a per-field stored rule round-trips without gaining a title type");
  const roundTrip = appearanceLandingDraft(appearanceLandingWire(filled));
  assert.equal(roundTrip.background_url, filled.background_url);
  assert.equal(roundTrip.title_type, "");
  assert.equal(roundTrip.title_image_url, "");
});

test("the save-time pairing rule is applied before Core sees the body", () => {
  assert.equal(appearanceLandingCoherent({}), true);
  assert.equal(appearanceLandingCoherent({ background_type: "image", background_url: "https://cdn.friending.co/a.jpg", background_poster_url: "https://cdn.friending.co/p.jpg", title_type: "image", title_image_url: "https://cdn.friending.co/t.png" }), true);
  assert.equal(appearanceLandingCoherent({ background_poster_url: "https://cdn.friending.co/p.jpg" }), true);
  assert.equal(appearanceLandingCoherent({ title_type: "text" }), true);
  assert.equal(appearanceLandingCoherent({ background_type: "video" }), false, "type without url");
  assert.equal(appearanceLandingCoherent({ background_url: "https://cdn.friending.co/a.mp4" }), false, "url without type");
  assert.equal(appearanceLandingCoherent({ title_type: "image" }), false, "image title without asset");

  const rule = appearanceRuleInputFromDraft(appearanceRuleDraft(parseAppearanceRule(geoRule())!));
  assert.ok(rule);
  assert.ok(parseAppearanceRuleInput({ ...rule, landing: { background_poster_url: "https://cdn.friending.co/p.jpg" } }));
  assert.ok(parseAppearanceRuleInput({ ...rule, landing: { title_text_hu: "Store cím" } }));
  assert.equal(parseAppearanceRuleInput({ ...rule, landing: { background_type: "video" } }), null);
  assert.equal(parseAppearanceRuleInput({ ...rule, landing: { background_url: "https://cdn.friending.co/a.mp4" } }), null);
  assert.equal(parseAppearanceRuleInput({ ...rule, landing: { title_type: "image" } }), null);
});

test("loosely typed rule scalars are refused at the proxy with their exact wire types", () => {
  const geo = appearanceRuleInputFromDraft(appearanceRuleDraft(parseAppearanceRule(geoRule())!));
  const global = appearanceRuleInputFromDraft(appearanceRuleDraft(parseAppearanceRule(wireRule())!));
  assert.ok(geo && global);
  assert.ok(parseAppearanceRuleInput(geo));
  assert.ok(parseAppearanceRuleInput(global));
  assert.equal(parseAppearanceRuleInput({ ...geo, starts_at: "" }), null, "an empty string is not a nullable timestamp");
  assert.equal(parseAppearanceRuleInput({ ...geo, ends_at: "" }), null);
  assert.equal(parseAppearanceRuleInput({ ...geo, priority: "3" }), null, "decimal string priority");
  assert.equal(parseAppearanceRuleInput({ ...geo, priority: 3.5 }), null, "fractional priority");
  assert.equal(parseAppearanceRuleInput({ ...geo, radius_km: "25" }), null, "string radius");
  assert.equal(parseAppearanceRuleInput({ ...geo, active: "true" }), null, "string flag");
  assert.equal(parseAppearanceRuleInput({ ...geo, storefront_country: null }), null, "null in a string position");
  assert.equal(parseAppearanceRuleInput({ ...geo, center: { latitude: "47.5", longitude: 19.04 } }), null, "string coordinate");
  assert.equal(parseAppearanceRuleInput({ ...global, center: "" }), null, "empty string in a null position");
  assert.equal(parseAppearanceRuleInput({ ...global, radius_km: "" }), null);
  assert.equal(parseAppearanceRuleInput({ ...global, radius_km: 0 }), null, "zero is not the neutral radius");
  assert.equal(parseAppearanceRuleInput({ ...global, place_label: null }), null);
  assert.equal(parseAppearanceRuleInput({ ...global, country_code: null }), null);
  assert.equal(parseAppearanceRuleInput({ ...global, center: [] }), null, "an array is not null");
});

test("a rule round-trips through the editor draft into the exact fourteen-key save body", () => {
  const rule = parseAppearanceRule(geoRule());
  assert.ok(rule);
  const draft = appearanceRuleDraft(rule);
  assert.equal(draft.latitude, "47.4979");
  assert.equal(draft.revision, 3);
  assert.equal(validateAppearanceRuleDraft(draft), null);
  const input = appearanceRuleInputFromDraft(draft);
  assert.ok(input);
  assert.deepEqual(Object.keys(input).sort(), [
    "active", "center", "country_code", "ends_at", "hero", "landing", "name", "palette",
    "place_label", "priority", "radius_km", "scope", "starts_at", "storefront_country",
  ]);
  assert.deepEqual(input.center, { latitude: 47.4979, longitude: 19.0402 });
  assert.equal(input.radius_km, 25);
  assert.deepEqual(input.landing, { background_type: "image", background_url: "https://img.friending.co/api/cache/pride.jpg" });
  assert.deepEqual(input.hero, { mode: "inherit", items: [] });
  assert.equal(parseAppearanceRuleInput(input) !== null, true);

  const storefront = newAppearanceRuleDraft("storefront", "US store", 5);
  assert.equal(validateAppearanceRuleDraft(storefront), "storefront");
  storefront.storefront_country = "USA";
  assert.equal(validateAppearanceRuleDraft(storefront), null);
  const storefrontInput = appearanceRuleInputFromDraft(storefront);
  assert.ok(storefrontInput);
  assert.equal(storefrontInput.center, null);
  assert.equal(storefrontInput.place_label, "");
  assert.deepEqual(storefrontInput.palette, { light: {}, dark: {} });
});

test("draft validation names the first failing group", () => {
  const geo = newAppearanceRuleDraft("geo", "", 0);
  assert.equal(validateAppearanceRuleDraft(geo), "name");
  geo.name = "Budapest";
  assert.equal(validateAppearanceRuleDraft(geo), "geo");
  geo.latitude = "0";
  geo.longitude = "0";
  geo.radius_km = "25";
  geo.place_label = "Null Island";
  assert.equal(validateAppearanceRuleDraft(geo), null, "0,0 is a valid coordinate pair; blank means unset");
  geo.latitude = "47.5";
  geo.longitude = "19.04";
  geo.radius_km = "600";
  geo.place_label = "Budapest";
  assert.equal(validateAppearanceRuleDraft(geo), "geo");
  geo.radius_km = "25";
  geo.country_code = "H";
  assert.equal(validateAppearanceRuleDraft(geo), "countryCode");
  geo.country_code = "HU";
  geo.priority = 10_001;
  assert.equal(validateAppearanceRuleDraft(geo), "priority");
  geo.priority = 10;
  geo.starts_at = "2026-07-01T00:00:00Z";
  geo.ends_at = "2026-06-01T00:00:00Z";
  assert.equal(validateAppearanceRuleDraft(geo), "window");
  geo.ends_at = "2026-08-01T00:00:00Z";
  geo.landing.background_url = "http://insecure.example.com/a.jpg";
  assert.equal(validateAppearanceRuleDraft(geo), "background");
  geo.landing.background_url = "";
  geo.landing.title_type = "image";
  assert.equal(validateAppearanceRuleDraft(geo), "titleImageRequired", "an image title needs its asset in the same rule");
  geo.landing.title_image_url = "ftp://x";
  assert.equal(validateAppearanceRuleDraft(geo), "titleImage");
  geo.landing.title_type = "";
  assert.equal(validateAppearanceRuleDraft(geo), "titleImage", "an inherited title type still validates the image address");
  geo.landing.title_image_url = "";
  geo.hero = { mode: "replace", items: [{ ...(parseAppearanceRule(wireRule())!.hero.items[0]!), media_url: "" }] };
  assert.equal(validateAppearanceRuleDraft(geo), "heroItem");
  geo.hero = { mode: "replace", items: [{ ...(parseAppearanceRule(wireRule())!.hero.items[0]!), title_size_web: 500 }] };
  assert.equal(validateAppearanceRuleDraft(geo), "heroTypography");
  geo.hero = { mode: "inherit", items: [] };
  geo.palette = { light: { accent: "#12345g" }, dark: {} };
  assert.equal(validateAppearanceRuleDraft(geo), "palette");
  geo.palette = { light: { accent: "#123456" }, dark: {} };
  assert.equal(validateAppearanceRuleDraft(geo), null);
  assert.ok(appearanceRuleInputFromDraft(geo));
});

test("palette hex input is normalised to the uppercase wire form or refused", () => {
  assert.equal(normalizeAppearancePaletteHex("#007f91"), "#007F91");
  assert.equal(normalizeAppearancePaletteHex("007f91"), "#007F91");
  assert.equal(normalizeAppearancePaletteHex(" #DDFBFC "), "#DDFBFC");
  assert.equal(normalizeAppearancePaletteHex("#fff"), null);
  assert.equal(normalizeAppearancePaletteHex("teal"), null);
  assert.equal(normalizeAppearancePaletteHex(""), null);
});

test("timestamps are exact UTC wire strings and the local input converts both ways", () => {
  assert.equal(parseAppearanceTimestamp("2026-08-29T11:00:00Z"), "2026-08-29T11:00:00Z");
  assert.equal(parseAppearanceTimestamp("2026-08-29T11:00:00.000Z"), null);
  assert.equal(parseAppearanceTimestamp("2026-08-29T11:00Z"), null);
  assert.equal(parseAppearanceTimestamp("2026-13-01T00:00:00Z"), null);
  assert.equal(parseAppearanceTimestamp(1_756_465_200), null);

  const wire = appearanceTimestampFromLocalInput(appearanceTimestampToLocalInput("2026-08-29T11:00:00Z"));
  assert.equal(wire, "2026-08-29T11:00:00Z");
  assert.equal(appearanceTimestampFromLocalInput(""), null);
  assert.equal(appearanceTimestampFromLocalInput("not a date"), undefined);
  assert.equal(appearanceTimestampFromLocalInput("2026-02-30T10:00"), undefined, "an impossible local date is refused, not normalised");
  assert.equal(appearanceTimestampFromLocalInput("2026-04-31T10:00"), undefined);
  assert.equal(appearanceTimestampFromLocalInput("2026-08-29T24:00"), undefined);
  assert.equal(appearanceTimestampFromLocalInput("2026-08-29T23:60"), undefined);
  assert.match(appearanceTimestampFromLocalInput("2024-02-29T10:00") ?? "", /^2024-02-29T\d{2}:00:00Z$|^2024-02-28T\d{2}:00:00Z$|^2024-03-01T\d{2}:00:00Z$/, "a real leap day converts");
  assert.equal(appearanceTimestampToLocalInput(null), "");

  const rule = parseAppearanceRule(geoRule());
  assert.ok(rule);
  assert.equal(appearanceRuleIsLive(rule, Date.parse("2026-06-15T00:00:00Z")), true);
  assert.equal(appearanceRuleIsLive(rule, Date.parse("2026-05-31T23:59:59Z")), false, "starts_at is inclusive");
  assert.equal(appearanceRuleIsLive(rule, Date.parse("2026-07-01T00:00:00Z")), false, "ends_at is exclusive");
  assert.equal(appearanceRuleIsLive({ ...rule, active: false }, Date.parse("2026-06-15T00:00:00Z")), false);
});

test("the operator list reads in resolution order: geo, storefront, global", () => {
  const rules = [wireRule(), storefrontRule(), geoRule(), geoRule({ id: "z", name: "Aachen", priority: 10 }), geoRule({ id: "y", name: "Zürich", priority: 20 })]
    .map((value) => parseAppearanceRule(value))
    .filter((rule): rule is AppearanceRule => rule !== null);
  assert.equal(rules.length, 5);
  assert.deepEqual(sortAppearanceRules(rules).map((rule) => rule.name), [
    "Zürich", "Aachen", "Budapest pride", "United States store", "Global appearance",
  ]);
});

test("the store-country catalogue is ISO alpha-3 with localized names", () => {
  assert.equal(isAppearanceStorefront("HUN"), true);
  assert.equal(isAppearanceStorefront("USA"), true);
  assert.equal(isAppearanceStorefront("HU"), false);
  assert.equal(isAppearanceStorefront("hun"), false);
  const hu = localizedAppearanceCountries("hu");
  const en = localizedAppearanceCountries("en");
  assert.ok(hu.length >= 240);
  assert.equal(hu.length, en.length);
  assert.equal(en.find((country) => country.alpha3 === "HUN")?.name, "Hungary");
  assert.equal(hu.find((country) => country.alpha3 === "HUN")?.name, "Magyarország");
  assert.equal(en.find((country) => country.alpha3 === "HUN")?.alpha2, "HU");
});

// ---------------------------------------------------------------------------
// Proxy normalization and action classification
// ---------------------------------------------------------------------------

test("the proxy forwards only the exact bodies the contract lists", () => {
  assert.equal(normalizeAppearanceProxyBody("list_users", { anything: 1 }), undefined);
  assert.deepEqual(normalizeAppearanceProxyBody("appearance_rules_list", { admin_email: "x", page: 2 }), {});

  const rule = appearanceRuleInputFromDraft(appearanceRuleDraft(parseAppearanceRule(geoRule())!));
  assert.ok(rule);
  const save = normalizeAppearanceProxyBody("appearance_rules_save", { id: "abc", expected_revision: 3, rule });
  assert.ok(save);
  assert.deepEqual(Object.keys(save).sort(), ["expected_revision", "id", "rule"]);
  assert.deepEqual(save.rule, rule);
  assert.ok(normalizeAppearanceProxyBody("appearance_rules_save", { id: "", expected_revision: 0, rule }), "create");
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_save", { id: "", expected_revision: 3, rule }), null, "create with a revision");
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_save", { id: "abc", expected_revision: 0, rule }), null, "update without a revision");
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_save", { id: "abc", expected_revision: 3, rule, admin_email: "x" }), null, "reserved key");
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_save", { id: "abc", expected_revision: "3", rule }), null, "string revision");
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_save", { id: "abc", expected_revision: 3, rule: { ...rule, extra: 1 } }), null, "unknown rule key");
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_save", { id: "abc", expected_revision: 3, rule: { ...rule, palette: { light: { accent: "#007f91" }, dark: {} } } }), null, "lowercase palette hex");
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_save", { id: "abc", expected_revision: 3 }), null, "missing rule");

  assert.deepEqual(normalizeAppearanceProxyBody("appearance_rules_delete", { id: "abc", expected_revision: 3 }), { id: "abc", expected_revision: 3 });
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_delete", { id: "abc", expected_revision: 0 }), null);
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_delete", { id: "", expected_revision: 1 }), null);
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_delete", { id: "abc", expected_revision: 1, force: true }), null);

  assert.deepEqual(normalizeAppearanceProxyBody("appearance_rules_preview", {}), {});
  assert.deepEqual(
    normalizeAppearanceProxyBody("appearance_rules_preview", { storefront_country: "HUN", latitude: 47.5, longitude: 19.04, ip: "", lang: "hu" }),
    { storefront_country: "HUN", latitude: 47.5, longitude: 19.04, lang: "hu" },
  );
  assert.deepEqual(normalizeAppearanceProxyBody("appearance_rules_preview", { ip: "203.0.113.7" }), { ip: "203.0.113.7" });
  assert.deepEqual(normalizeAppearanceProxyBody("appearance_rules_preview", { ip: "2001:db8::1" }), { ip: "2001:db8::1" });
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_preview", { latitude: 47.5 }), null, "latitude without longitude");
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_preview", { storefront_country: "HU" }), null);
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_preview", { ip: "not-an-ip" }), null);
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_preview", { lang: "de" }), null);
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_preview", { uid: 1 }), null);

  assert.deepEqual(normalizeAppearanceProxyBody("appearance_city_geocode", { query: "  Budapest " }), { query: "Budapest" });
  assert.deepEqual(normalizeAppearanceProxyBody("appearance_city_geocode", { query: "Budapest", lang: "hu" }), { query: "Budapest", lang: "hu" });
  assert.equal(normalizeAppearanceProxyBody("appearance_city_geocode", { query: "" }), null);
  assert.equal(normalizeAppearanceProxyBody("appearance_city_geocode", { query: "x".repeat(121) }), null);
  assert.equal(normalizeAppearanceProxyBody("appearance_city_geocode", { query: "Budapest", lang: "de" }), null);
  assert.equal(normalizeAppearanceProxyBody("appearance_city_geocode", { q: "Budapest" }), null);
});

test("the five appearance actions stay dormant until the readiness switch flips, then classify as designed", () => {
  assert.equal(APPEARANCE_ACTIONS.length, 5);
  for (const action of APPEARANCE_ACTIONS) {
    assert.equal(isAdminActionAllowed(action), APPEARANCE_RULES_CONTRACT_READY, action);
    assert.equal((ADMIN_ACTIONS as readonly string[]).includes(action), APPEARANCE_RULES_CONTRACT_READY, action);
  }
  if (APPEARANCE_RULES_CONTRACT_READY) {
    assert.equal(adminActionAccess("appearance_rules_list"), "read");
    assert.equal(adminActionAccess("appearance_rules_preview"), "read");
    assert.equal(adminActionAccess("appearance_rules_save"), "write");
    assert.equal(adminActionAccess("appearance_rules_delete"), "write");
    assert.equal(adminActionAccess("appearance_city_geocode"), "write");
  } else {
    for (const action of APPEARANCE_ACTIONS) {
      assert.equal(adminActionAccess(action), null, action);
      assert.equal(action in ADMIN_ACTION_ACCESS, false, action);
    }
  }
  // The raised save ceiling is a static table entry, independent of the switch.
  assert.equal(adminActionBodyLimit("appearance_rules_save"), 1_100_000);
  assert.equal(adminActionBodyLimit("appearance_rules_list"), 256_000);
});


test("the preview IP field accepts only real IPv4/IPv6 addresses", () => {
  for (const ip of [
    "203.0.113.7", "0.0.0.0", "255.255.255.255",
    "::", "::1", "1::", "2001:db8::1", "2001:db8:0:0:0:0:0:1", "2001:db8::0:1",
    "1:2:3:4:5:6:7:8", "1:2:3:4:5:6:7::", "::ffff:192.0.2.1", "64:ff9b::192.0.2.33", "fe80::1", "::1:80",
    "::192.0.2.1", "1:2:3:4:5:6:192.0.2.1", "1::2:192.0.2.1",
    "ABCD:EF01:2345:6789:abcd:ef01:2345:6789",
  ]) {
    assert.equal(parseAppearanceIpAddress(ip), ip, ip);
    assert.deepEqual(normalizeAppearanceProxyBody("appearance_rules_preview", { ip }), { ip }, ip);
  }
  for (const ip of [
    "::::", "1::2::3", ":::", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8::", ":1:2:3:4:5:6:7",
    "1:2:3:4:5:6:7:", "12345::1", "g::1", "fe80::1%eth0", "[::1]", "[::1]:80", "2001:db8::/32",
    "::ffff:999.0.2.1", "192.0.2.1::1", "1.2.3", "256.1.1.1", "1.2.3.4.5", "01.2.3.4", " ", "not-an-ip",
    // A dotted quad is the final 32 bits: nothing, not even `::`, may follow it.
    "192.0.2.1::", "2001:db8:192.0.2.1::", "1:2:3:4:5:6:192.0.2.1:7", "::192.0.2.1:1",
  ]) {
    assert.equal(parseAppearanceIpAddress(ip), null, ip);
    assert.equal(normalizeAppearanceProxyBody("appearance_rules_preview", { ip }), null, ip);
  }
});

function envelope(data: unknown, statusCode = 200): Record<string, unknown> {
  return { success: true, status_code: statusCode, message: 200, status: 200, can_send: 0, data };
}

function coreRefusal(error: string, statusCode: number): Record<string, unknown> {
  return { success: false, status_code: statusCode, message: 200, status: 200, can_send: 0, error };
}

test("every action decodes Core's exact legacy envelope or the bridge refusal — never a bare success flag", () => {
  const list = decodeAppearanceListResponse(envelope({ rules: [wireRule()], defaults: DEFAULTS }));
  assert.ok(list.ok);
  assert.equal(list.value.rules.length, 1);

  // The reviewer's probes: a bare success flag and a "successful" 409 envelope are both refused.
  for (const [label, value] of [
    ["bare success", { success: true, data: { rules: [], defaults: DEFAULTS } }],
    ["successful 409", envelope({ rules: [], defaults: DEFAULTS }, 409)],
    ["missing trio", { success: true, status_code: 200, data: { rules: [], defaults: DEFAULTS } }],
    ["extra key", { ...envelope({ rules: [], defaults: DEFAULTS }), extra: 1 }],
    ["null", null],
    ["string", "ok"],
    ["material without defaults", envelope({ rules: [] })],
  ] as const) {
    const decoded = decodeAppearanceListResponse(value);
    assert.equal(decoded.ok, false, label);
    assert.equal(!decoded.ok && decoded.kind, "uncertain", label);
  }

  const refused = decodeAppearanceListResponse(coreRefusal("admin-revoked", 403));
  assert.deepEqual(refused, { ok: false, kind: "refused", error: "admin-revoked", status: 403 });
  const bridgeRefused = decodeAppearanceListResponse({ success: false, status_code: 403, error: "admin-write-required" });
  assert.deepEqual(bridgeRefused, { ok: false, kind: "refused", error: "admin-write-required", status: 403 });
  for (const error of ["core-timeout", "core-unavailable", "invalid-core-response"]) {
    const decoded = decodeAppearanceListResponse({ success: false, status_code: error === "core-timeout" ? 504 : 502, error });
    assert.deepEqual(decoded, { ok: false, kind: "uncertain", error }, error);
  }
  const withData = decodeAppearanceListResponse({ ...coreRefusal("appearance-rule-conflict", 409), data: { revision: 4 } });
  assert.deepEqual(withData, { ok: false, kind: "uncertain", error: "refusal-with-data" }, "the wire contracts no refusal material");
  assert.deepEqual(decodeAppearanceListResponse(coreRefusal("appearance-rule-read-failed", 503)), { ok: false, kind: "uncertain", error: "appearance-rule-read-failed" });

  assert.ok(decodeAppearancePreviewResponse(envelope(previewPayload())).ok);
  assert.equal(decodeAppearancePreviewResponse({ success: true, data: previewPayload() }).ok, false);
  assert.ok(decodeAppearanceGeocodeResponse(envelope({ candidates: [] })).ok);
  assert.equal(decodeAppearanceGeocodeResponse(envelope({ results: [] })).ok, false);
});

test("a save success is bound to its target: the same id on update, the same material on create", () => {
  const stored = parseAppearanceRule(geoRule());
  assert.ok(stored);
  const input = appearanceRuleInputFromDraft(appearanceRuleDraft(stored));
  assert.ok(input);

  const update = decodeAppearanceSaveResponse(envelope({ rule: geoRule({ revision: 4 }) }), { id: stored.id, input });
  assert.ok(update.ok);
  assert.equal(update.value.revision, 4);
  const otherId = decodeAppearanceSaveResponse(envelope({ rule: geoRule({ id: "someone-else" }) }), { id: stored.id, input });
  assert.deepEqual(otherId, { ok: false, kind: "uncertain", error: "unbound-target" });

  const create = decodeAppearanceSaveResponse(envelope({ rule: geoRule({ id: "minted", revision: 1 }) }), { id: "", input });
  assert.ok(create.ok, "create adopts the minted id when the material is what was sent");
  assert.equal(create.value.id, "minted");
  const drifted = decodeAppearanceSaveResponse(envelope({ rule: geoRule({ id: "minted", revision: 1, priority: 99 }) }), { id: "", input });
  assert.deepEqual(drifted, { ok: false, kind: "uncertain", error: "unbound-material" });

  // Hero item ids are minted by Core on create and are the only tolerated difference.
  const heroRule = parseAppearanceRule(wireRule());
  assert.ok(heroRule);
  const heroInput = appearanceRuleInputFromDraft(appearanceRuleDraft(heroRule));
  assert.ok(heroInput);
  const submittedWithoutIds = { ...heroInput, hero: { mode: "replace" as const, items: heroInput.hero.items.map((item) => ({ ...item, id: "" })) } };
  assert.equal(appearanceRuleMaterialMatches(heroRule, submittedWithoutIds), true);
  assert.equal(appearanceRuleMaterialMatches(heroRule, heroInput), true);
  assert.equal(appearanceRuleMaterialMatches({ ...heroRule, hero: { mode: "replace", items: [] } }, heroInput), false);
  assert.equal(appearanceRuleMaterialMatches(heroRule, { ...heroInput, name: "Other" }), false);

  for (const [label, value] of [
    ["bare success", { success: true, rule: geoRule() }],
    ["data without rule", envelope({})],
    ["data with extra", envelope({ rule: geoRule(), warning: "x" })],
    ["invalid rule", envelope({ rule: geoRule({ priority: "10" }) })],
    ["null", null],
  ] as const) {
    const decoded = decodeAppearanceSaveResponse(value, { id: stored.id, input });
    assert.equal(decoded.ok, false, label);
    assert.equal(!decoded.ok && decoded.kind, "uncertain", label);
  }
  assert.deepEqual(
    decodeAppearanceSaveResponse(coreRefusal("appearance-rule-conflict", 409), { id: stored.id, input }),
    { ok: false, kind: "refused", error: "appearance-rule-conflict", status: 409 },
  );
});

test("the refusal vocabulary is closed: unknown names and wrong statuses are uncertain, never a proven no-land", () => {
  const stored = parseAppearanceRule(geoRule());
  assert.ok(stored);
  const input = appearanceRuleInputFromDraft(appearanceRuleDraft(stored));
  assert.ok(input);
  const save = (value: unknown) => decodeAppearanceSaveResponse(value, { id: stored.id, input });
  const remove = (value: unknown) => decodeAppearanceDeleteResponse(value, stored.id);

  for (const decode of [save, remove]) {
    // Known no-land refusals at their exact statuses.
    assert.deepEqual(decode(coreRefusal("appearance-rule-conflict", 409)), { ok: false, kind: "refused", error: "appearance-rule-conflict", status: 409 });
    assert.deepEqual(decode(coreRefusal("appearance-rule-global-protected", 409)), { ok: false, kind: "refused", error: "appearance-rule-global-protected", status: 409 });
    assert.deepEqual(decode(coreRefusal("appearance-rule-not-found", 404)), { ok: false, kind: "refused", error: "appearance-rule-not-found", status: 404 });
    assert.deepEqual(decode(coreRefusal("appearance-rule-hero-item-invalid", 422)), { ok: false, kind: "refused", error: "appearance-rule-hero-item-invalid", status: 422 });
    assert.deepEqual(decode(coreRefusal("appearance-rule-revision-invalid", 422)), { ok: false, kind: "refused", error: "appearance-rule-revision-invalid", status: 422 });
    assert.deepEqual(decode({ success: false, status_code: 403, error: "admin-write-required" }), { ok: false, kind: "refused", error: "admin-write-required", status: 403 });
    assert.deepEqual(decode({ success: false, status_code: 400, error: "invalid-input" }), { ok: false, kind: "refused", error: "invalid-input", status: 400 });
    assert.deepEqual(decode({ success: false, status_code: 404, error: "not-found" }), { ok: false, kind: "refused", error: "not-found", status: 404 });
    assert.deepEqual(decode(coreRefusal("unauthorized", 401)), { ok: false, kind: "refused", error: "unauthorized", status: 401 }, "published Core name");
    assert.deepEqual(decode(coreRefusal("unauthorized", 403)), { ok: false, kind: "uncertain", error: "unknown-refusal" });
    // The reviewer's probes: an unknown bridge transport name, an unknown Core name, a known name at the wrong status.
    assert.deepEqual(decode({ success: false, status_code: 502, error: "future-transport" }), { ok: false, kind: "uncertain", error: "unknown-refusal" });
    assert.deepEqual(decode(coreRefusal("appearance-rule-future", 418)), { ok: false, kind: "uncertain", error: "unknown-refusal" });
    assert.deepEqual(decode(coreRefusal("appearance-rule-conflict", 200)), { ok: false, kind: "uncertain", error: "unknown-refusal" });
    assert.deepEqual(decode(coreRefusal("appearance-rule-conflict", 409.5)), { ok: false, kind: "uncertain", error: "malformed-envelope" });
    assert.deepEqual(decode(coreRefusal("appearance-rule-not-found", 409)), { ok: false, kind: "uncertain", error: "unknown-refusal" });
    assert.deepEqual(decode({ success: false, status_code: 500, error: "admin-write-required" }), { ok: false, kind: "uncertain", error: "unknown-refusal" });
    assert.deepEqual(decode({ success: false, status_code: 504, error: "core-unavailable" }), { ok: false, kind: "uncertain", error: "unknown-refusal" }, "a transport name at the wrong status is still uncertain");
    // Envelope-source closure: a Core name in the bridge's three-key shape, a bridge name in the
    // legacy Core trio shape, and a known Core error carrying additive `data` are all uncertain.
    assert.deepEqual(decode({ success: false, status_code: 409, error: "appearance-rule-conflict" }), { ok: false, kind: "uncertain", error: "unknown-refusal" }, "Core name in bridge shape");
    assert.deepEqual(decode({ success: false, status_code: 404, error: "appearance-rule-not-found" }), { ok: false, kind: "uncertain", error: "unknown-refusal" });
    assert.deepEqual(decode({ success: false, status_code: 503, error: "appearance-rule-write-failed" }), { ok: false, kind: "uncertain", error: "unknown-refusal" }, "Core 503 name in bridge shape is not a named uncertainty either");
    assert.deepEqual(decode(coreRefusal("invalid-input", 400)), { ok: false, kind: "uncertain", error: "unknown-refusal" }, "bridge name in Core shape");
    assert.deepEqual(decode(coreRefusal("not-found", 404)), { ok: false, kind: "uncertain", error: "unknown-refusal" });
    assert.deepEqual(decode(coreRefusal("core-timeout", 504)), { ok: false, kind: "uncertain", error: "unknown-refusal" }, "bridge transport name in Core shape");
    assert.deepEqual(decode({ ...coreRefusal("appearance-rule-conflict", 409), data: { anything: "accepted" } }), { ok: false, kind: "uncertain", error: "refusal-with-data" }, "known Core error with additive data");
    assert.deepEqual(decode({ ...coreRefusal("appearance-rule-not-found", 404), data: {} }), { ok: false, kind: "uncertain", error: "refusal-with-data" });
    assert.deepEqual(decode({ ...coreRefusal("appearance-rule-conflict", 409), data: { revision: 4 }, extra: 1 }), { ok: false, kind: "uncertain", error: "malformed-envelope" });
    // `admin-write-required` is legitimately emitted by both sources at 403.
    assert.deepEqual(decode(coreRefusal("admin-write-required", 403)), { ok: false, kind: "refused", error: "admin-write-required", status: 403 });
    // Core's 503 family: the write may have landed.
    assert.deepEqual(decode(coreRefusal("appearance-rule-write-failed", 503)), { ok: false, kind: "uncertain", error: "appearance-rule-write-failed" });
    assert.deepEqual(decode(coreRefusal("appearance-rule-audit-write-failed", 503)), { ok: false, kind: "uncertain", error: "appearance-rule-audit-write-failed" });
    assert.deepEqual(decode(coreRefusal("appearance-rule-write-failed", 500)), { ok: false, kind: "uncertain", error: "unknown-refusal" });
    for (const [error, status] of [["core-timeout", 504], ["core-unavailable", 502], ["invalid-core-response", 502]] as const) {
      assert.deepEqual(decode({ success: false, status_code: status, error }), { ok: false, kind: "uncertain", error });
    }
  }
});

test("a delete success must name the deleted rule", () => {
  assert.deepEqual(decodeAppearanceDeleteResponse(envelope({ id: "abc" }), "abc"), { ok: true, value: { id: "abc" } });
  assert.deepEqual(decodeAppearanceDeleteResponse(envelope({ id: "other" }), "abc"), { ok: false, kind: "uncertain", error: "unbound-target" });
  assert.equal(decodeAppearanceDeleteResponse({ success: true }, "abc").ok, false, "a bare success removes nothing");
  assert.equal(decodeAppearanceDeleteResponse(envelope({}), "abc").ok, false);
  assert.equal(decodeAppearanceDeleteResponse(envelope({ id: "abc", deleted: true }), "abc").ok, false);
  assert.equal(decodeAppearanceDeleteResponse(null, "abc").ok, false);
  assert.deepEqual(
    decodeAppearanceDeleteResponse(coreRefusal("appearance-rule-global-protected", 409), "abc"),
    { ok: false, kind: "refused", error: "appearance-rule-global-protected", status: 409 },
  );
});
