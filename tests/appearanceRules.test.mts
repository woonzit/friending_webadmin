import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import {
  APPEARANCE_ACTIONS,
  APPEARANCE_COUNTRIES,
  APPEARANCE_COUNTRY_COUNT,
  APPEARANCE_DEFAULT_LANDING,
  APPEARANCE_DEFAULT_PALETTE,
  APPEARANCE_LANDING_ALIGNS,
  APPEARANCE_LANDING_APPLE_STYLES,
  APPEARANCE_LANDING_FONTS,
  APPEARANCE_LANDING_FLAT_SOURCE_SCOPES,
  APPEARANCE_LANDING_KEYS,
  APPEARANCE_LANDING_LAYOUT_UNITS,
  APPEARANCE_LANDING_PREVIEW_STYLE_KEYS,
  APPEARANCE_PALETTE_MODES,
  APPEARANCE_PALETTE_ROLES,
  appearanceLandingCoherent,
  appearanceLandingBackgroundSelection,
  appearanceLandingDraft,
  appearanceLandingLogoHintVisible,
  appearanceLandingLogoSelection,
  appearanceLandingLayoutPairSelection,
  appearanceLandingLayoutPixels,
  appearanceFooterTextHasExactTags,
  appearancePreviewLandingFields,
  appearanceLandingWithTitleType,
  appearanceLandingPreviewDraft,
  appearanceLandingWire,
  appearanceRuleDraft,
  appearanceRuleInputFromDraft,
  appearanceRuleInputOf,
  appearanceRuleIsLive,
  appearanceRuleMaterialMatches,
  appearanceTrim,
  appearanceTimestampFromLocalInput,
  appearanceTimestampToLocalInput,
  decodeAppearanceDeleteResponse,
  decodeAppearanceGeocodeResponse,
  decodeAppearanceListResponse,
  decodeAppearancePreviewResponse,
  decodeAppearanceSaveResponse,
  isAppearanceAlpha2,
  isAppearanceHttpsUrl,
  isAppearanceStorefront,
  localizedAppearanceCountries,
  newAppearanceRuleDraft,
  normalizeAppearancePaletteHex,
  normalizeAppearanceProxyBody,
  parseAppearanceGeocodePayload,
  parseAppearanceIpAddress,
  parseAppearanceHero,
  parseAppearanceLanding,
  parseAppearanceListPayload,
  parseAppearancePreviewPayload,
  parseAppearanceRule,
  parseAppearanceRuleInput,
  reconcileAppearanceCreate,
  reconcileAppearanceUpdate,
  parseAppearanceTimestamp,
  resolveAppearanceHero,
  resolveAppearanceLanding,
  resolveAppearanceLandingFields,
  resolveAppearancePalette,
  sortAppearanceRules,
  validateAppearanceRuleDraft,
  wellFormedUtf16,
  type AppearanceRule,
} from "../lib/appearanceRules.ts";
import {
  ADMIN_ACTIONS,
  ADMIN_ACTION_ACCESS,
  adminActionAccess,
  adminActionBodyLimit,
  isAdminActionAllowed,
} from "../lib/adminActions.ts";

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

test("empty maps are JSON objects (Core container identity); an array container is refused everywhere", () => {
  const rule = parseAppearanceRule(wireRule({ landing: {}, palette: { light: {}, dark: { accent: "#75F0F4" } } }));
  assert.ok(rule);
  assert.deepEqual(rule.landing, {});
  assert.deepEqual(rule.palette, { light: {}, dark: { accent: "#75F0F4" } });
  assert.equal(parseAppearanceRule(wireRule({ landing: [] })), null, "`[]` is not an empty landing map");
  assert.equal(parseAppearanceRule(wireRule({ palette: { light: [], dark: {} } })), null, "`[]` is not an empty palette mode");
  assert.equal(parseAppearanceRule(wireRule({ palette: [] })), null, "the palette container itself always carries its two modes");
  assert.equal(parseAppearanceRule(wireRule({ hero: [] })), null, "hero is never an array");
  assert.equal(parseAppearanceRule(wireRule({ center: [] })), null);
  assert.equal(parseAppearanceRuleInput({ ...appearanceRuleInputOf(rule), landing: [] }), null, "the proxy refuses the array container too");
});

test("stored hero items carry non-empty unique ids; save input may leave an id empty for Core to mint", () => {
  const base = parseAppearanceRule(wireRule())!;
  const item = base.hero.items[0]!;
  assert.ok(item.id !== "");
  assert.equal(parseAppearanceRule(wireRule({ hero: { mode: "replace", items: [{ ...item, id: "" }] } })), null, "stored empty id");
  assert.equal(parseAppearanceRule(wireRule({ hero: { mode: "replace", items: [item, { ...item, id: "" }] } })), null, "stored empty id beside a valid one");
  assert.equal(parseAppearanceRule(wireRule({ hero: { mode: "replace", items: [item, { ...item }] } })), null, "stored duplicate id");
  assert.ok(parseAppearanceRule(wireRule({ hero: { mode: "replace", items: [item, { ...item, id: `${item.id}-2` }] } })), "distinct ids");
  const input = appearanceRuleInputOf(base);
  assert.ok(parseAppearanceRuleInput({ ...input, hero: { mode: "replace", items: [{ ...item, id: "" }] } }), "input without an id is legal before minting");
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
    ["control character in name", wireRule({ name: "bad\u0007name" })],
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
    rules: [wireRule()],
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
  assert.equal(parseAppearanceListPayload({ rules: [wireRule(), wireRule({ id: "66d0a1b2c3d4e5f6a7b8c9ee" })], defaults: DEFAULTS }), null, "two globals");
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
    content_version: "a3f1c9e2b7d4085f6c1e2a9b8d7c6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a",
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

// Contract-local schema-v2 fixture until the accepted T-488 Core corpus is pinned below.
// It is test input only and is never presented as cross-repository provenance.
function previewLandingV2(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    background: {
      type: "image",
      url: "https://img.friending.co/api/cache/pride.jpg",
      poster_url: "",
      overlay: { color: "#000000", alpha: 0.35 },
    },
    title: {
      type: "text",
      text: "friending.",
      image_url: "",
      image: { width_percent: 60, offset_percent: -10 },
      style: { font: "proxima_bold", size: 44, color: "#FFFFFF", align: "left" },
    },
    description: {
      text: "Meet people nearby.",
      hidden: false,
      style: { font: "proxima_regular", size: 17, color: "#F2F4F7", align: "left" },
      backdrop: { color: "#000000", alpha: 0 },
    },
    buttons: {
      corner_radius: 28,
      phone: { label: "Continue with phone number", background: "#FFFFFF", text_color: "#0B0E12", font: "proxima_semibold", size: 17 },
      email: { label: "Continue with e-mail", background: "#FFFFFF", text_color: "#0B0E12", font: "proxima_semibold", size: 17 },
      apple: { style: "white" },
    },
    footer: {
      text: "By continuing you accept our <terms>Terms</terms> and <privacy>Privacy Policy</privacy>.",
      background: { color: "#000000", alpha: 0.55 },
      style: { font: "proxima_regular", size: 12, color: "#E4E8ED" },
    },
    layout: {
      text_gap: { value: 24, unit: "pt" },
      footer_min_height: { value: 0, unit: "pt" },
    },
    qr: { enabled: true, background: "#000000", icon_color: "#FFFFFF" },
    ...overrides,
  };
}

function previewLandingFlat(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...Object.fromEntries(APPEARANCE_LANDING_KEYS.map((key) => [key, ""])),
    ...overrides,
  };
}

function previewLandingFlatSources(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...Object.fromEntries(APPEARANCE_LANDING_KEYS.map((key) => [key, { scope: "none", rule_id: "" }])),
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
    content_version: "0000c9e2b7d4085f6c1e2a9b8d7c6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a",
    hero: [],
    matched: { scope: "default", rule_id: "", location_source: "none" },
  }));
  assert.ok(defaults);
  assert.equal(defaults.content_version, "0000c9e2b7d4085f6c1e2a9b8d7c6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a");
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

test("the schema-v2 preview decodes exactly and flattens the requested language for comparison", () => {
  const preview = parseAppearancePreviewPayload(previewPayload({ landing: previewLandingV2() }));
  assert.ok(preview);
  assert.equal(preview.landing.schema, 2);
  assert.equal(preview.landing.v2?.title.style.font, "proxima_bold");
  assert.equal(preview.landing.v2?.description.hidden, false);
  assert.deepEqual(preview.landing.v2?.layout.text_gap, { value: 24, unit: "pt" });
  assert.equal(preview.landing.v2?.qr.enabled, true);
  assert.equal(preview.landing_flat, null, "the app schema-2 shape has no Webadmin siblings");
  assert.equal(preview.landing_flat_sources, null);
  assert.equal(preview.landing_flat_defaults, null);
  const fields = appearancePreviewLandingFields(preview.landing, "en");
  assert.equal(fields.overlay_alpha, "0.35");
  assert.equal(fields.description_backdrop_alpha, "0.00");
  assert.equal(fields.title_image_offset_percent, "-10");
  assert.equal(fields.button_phone_label_en, "Continue with phone number");
  assert.equal(fields.button_phone_label_hu, undefined, "the wire projects only the requested language");
  assert.equal(fields.qr_enabled, "true");
  assert.equal(fields.description_hidden, "false");
  assert.equal(fields.text_gap_value, "24");
  assert.equal(fields.text_gap_unit, "pt");
  assert.equal(fields.footer_min_height_value, "0");
  assert.equal(fields.footer_min_height_unit, "pt");

  const webadmin = parseAppearancePreviewPayload(previewPayload({
    landing: previewLandingV2(),
    landing_flat: previewLandingFlat({
      title_text_en: "Parent title",
      description_en: "Meet people nearby.",
      overlay_color: "#010203",
      overlay_alpha: "0.50",
    }),
    landing_flat_sources: previewLandingFlatSources({
      title_text_en: { scope: "global", rule_id: "66d0a1b2c3d4e5f6a7b8c9d2" },
      description_en: { scope: "global", rule_id: "66d0a1b2c3d4e5f6a7b8c9d2" },
      overlay_color: { scope: "global", rule_id: "66d0a1b2c3d4e5f6a7b8c9d2" },
      overlay_alpha: { scope: "global", rule_id: "66d0a1b2c3d4e5f6a7b8c9d2" },
    }),
    landing_flat_defaults: APPEARANCE_DEFAULT_LANDING,
  }));
  assert.ok(webadmin);
  assert.equal(webadmin.landing_flat?.description_en, "Meet people nearby.");
  assert.equal(webadmin.landing_flat_defaults?.description_hu, APPEARANCE_DEFAULT_LANDING.description_hu);
  assert.deepEqual(webadmin.landing_flat_sources?.title_text_en, {
    scope: "global",
    rule_id: "66d0a1b2c3d4e5f6a7b8c9d2",
  });

  for (const [label, overrides] of [
    ["missing flat defaults sibling", { landing_flat: previewLandingFlat(), landing_flat_sources: previewLandingFlatSources() }],
    ["orphan flat defaults", { landing_flat_defaults: APPEARANCE_DEFAULT_LANDING }],
    ["partial flat fields", { landing_flat: { title_type: "text" }, landing_flat_sources: previewLandingFlatSources(), landing_flat_defaults: APPEARANCE_DEFAULT_LANDING }],
    ["partial flat sources", { landing_flat: previewLandingFlat(), landing_flat_sources: { title_type: { scope: "none", rule_id: "" } }, landing_flat_defaults: APPEARANCE_DEFAULT_LANDING }],
    ["partial flat defaults", { landing_flat: previewLandingFlat(), landing_flat_sources: previewLandingFlatSources(), landing_flat_defaults: { title_type: "text" } }],
    ["empty required flat default", { landing_flat: previewLandingFlat(), landing_flat_sources: previewLandingFlatSources(), landing_flat_defaults: { ...APPEARANCE_DEFAULT_LANDING, title_font: "" } }],
    ["none source with id", { landing_flat: previewLandingFlat(), landing_flat_sources: previewLandingFlatSources({ title_type: { scope: "none", rule_id: "66d0a1b2c3d4e5f6a7b8c9d2" } }), landing_flat_defaults: APPEARANCE_DEFAULT_LANDING }],
    ["none source with a value", { landing_flat: previewLandingFlat({ title_type: "text" }), landing_flat_sources: previewLandingFlatSources(), landing_flat_defaults: APPEARANCE_DEFAULT_LANDING }],
    ["rule source without id", { landing_flat: previewLandingFlat({ title_type: "text" }), landing_flat_sources: previewLandingFlatSources({ title_type: { scope: "global", rule_id: "" } }), landing_flat_defaults: APPEARANCE_DEFAULT_LANDING }],
    ["rule source without a value", { landing_flat: previewLandingFlat(), landing_flat_sources: previewLandingFlatSources({ title_type: { scope: "global", rule_id: "66d0a1b2c3d4e5f6a7b8c9d2" } }), landing_flat_defaults: APPEARANCE_DEFAULT_LANDING }],
    ["split coherent pair", {
      landing_flat: previewLandingFlat({ overlay_color: "#000000", overlay_alpha: "0.35" }),
      landing_flat_sources: previewLandingFlatSources({
        overlay_color: { scope: "geo", rule_id: "66d0a1b2c3d4e5f6a7b8c9d1" },
        overlay_alpha: { scope: "global", rule_id: "66d0a1b2c3d4e5f6a7b8c9d2" },
      }),
      landing_flat_defaults: APPEARANCE_DEFAULT_LANDING,
    }],
    ["rule-only image type without asset", {
      landing_flat: previewLandingFlat({ title_type: "image" }),
      landing_flat_sources: previewLandingFlatSources({ title_type: { scope: "global", rule_id: "66d0a1b2c3d4e5f6a7b8c9d2" } }),
      landing_flat_defaults: APPEARANCE_DEFAULT_LANDING,
    }],
    ["retired default source", { landing_flat: previewLandingFlat(), landing_flat_sources: previewLandingFlatSources({ title_type: { scope: "default", rule_id: "" } }), landing_flat_defaults: APPEARANCE_DEFAULT_LANDING }],
    ["flat siblings on schema 1", { landing_flat: previewLandingFlat(), landing_flat_sources: previewLandingFlatSources(), landing_flat_defaults: APPEARANCE_DEFAULT_LANDING }],
  ] as const) {
    const landing = label === "flat siblings on schema 1" ? previewPayload().landing : previewLandingV2();
    assert.equal(parseAppearancePreviewPayload(previewPayload({ landing, ...overrides })), null, label);
  }

  const base = previewLandingV2();
  const background = base.background as Record<string, unknown>;
  const title = base.title as Record<string, unknown>;
  const description = base.description as Record<string, unknown>;
  const buttons = base.buttons as Record<string, unknown>;
  const footer = base.footer as Record<string, unknown>;
  const layout = base.layout as Record<string, unknown>;
  for (const [label, landing] of [
    ["lowercase v2 colour", { ...base, background: { ...background, overlay: { color: "#abcdef", alpha: 0.5 } } }],
    ["v2 alpha exceeds storage precision", { ...base, background: { ...background, overlay: { color: "#000000", alpha: 0.351 } } }],
    ["unknown v2 font", { ...base, title: { ...title, style: { font: "serif", size: 44, color: "#FFFFFF", align: "left" } } }],
    ["title size out of range", { ...base, title: { ...title, style: { font: "proxima_bold", size: 73, color: "#FFFFFF", align: "left" } } }],
    ["empty resolved description", { ...base, description: { ...description, text: "" } }],
    ["loose description visibility", { ...base, description: { ...description, hidden: "false" } }],
    ["missing description visibility", { ...base, description: { text: description.text, style: description.style, backdrop: description.backdrop } }],
    ["custom Apple colour vocabulary", { ...base, buttons: { ...buttons, apple: { style: "pink" } } }],
    ["footer without markers", { ...base, footer: { ...footer, text: "Terms and privacy" } }],
    ["text gap out of range", { ...base, layout: { ...layout, text_gap: { value: 201, unit: "pt" } } }],
    ["unknown text gap unit", { ...base, layout: { ...layout, text_gap: { value: 24, unit: "px" } } }],
    ["footer minimum out of range", { ...base, layout: { ...layout, footer_min_height: { value: 301, unit: "pt" } } }],
    ["partial layout", { ...base, layout: { text_gap: { value: 24, unit: "pt" } } }],
    ["unknown v2 key", { ...base, future: true }],
  ] as const) assert.equal(parseAppearancePreviewPayload(previewPayload({ landing })), null, label);

  const noneTitle = { ...title, type: "none", text: "", image_url: "" };
  assert.ok(parseAppearancePreviewPayload(previewPayload({ landing: previewLandingV2({ title: noneTitle }) })));
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
  assert.equal(hu.titleText, "Global title", "no Hungarian title anywhere in the chain → the chain's English title beats the compiled Hungarian default (Core localizedLandingField)");
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

test("the D-061 landing vocabulary is closed and canonical while every draft field can inherit", () => {
  assert.equal(APPEARANCE_LANDING_KEYS.length, 52);
  assert.equal(new Set(APPEARANCE_LANDING_KEYS).size, APPEARANCE_LANDING_KEYS.length);
  assert.equal(APPEARANCE_LANDING_FONTS.length, 14);
  assert.deepEqual(APPEARANCE_LANDING_FLAT_SOURCE_SCOPES, ["geo", "storefront", "global", "none"]);
  assert.deepEqual(APPEARANCE_LANDING_ALIGNS, ["left", "center", "right"]);
  assert.deepEqual(APPEARANCE_LANDING_APPLE_STYLES, ["white", "white_outline", "black"]);
  assert.deepEqual(APPEARANCE_LANDING_LAYOUT_UNITS, ["pt", "percent"]);
  assert.ok(parseAppearanceLanding(APPEARANCE_DEFAULT_LANDING), "all compiled defaults satisfy the closed flat model");

  const blank = appearanceLandingDraft({});
  assert.deepEqual(Object.keys(blank), [...APPEARANCE_LANDING_KEYS]);
  assert.ok(APPEARANCE_LANDING_KEYS.every((key) => blank[key] === ""));
  assert.deepEqual(appearanceLandingWire(blank), {});

  const valid = {
    overlay_color: "#001122",
    overlay_alpha: "0.30",
    title_type: "none",
    title_font: "proxima_cond_semibold",
    title_size: "72",
    title_align: "right",
    title_image_offset_percent: "-40",
    description_hidden: "true",
    text_gap_value: "200",
    text_gap_unit: "percent",
    footer_min_height_value: "300",
    footer_min_height_unit: "pt",
    button_apple_style: "white_outline",
    qr_enabled: "false",
  };
  assert.deepEqual(parseAppearanceLanding(valid), valid);
  for (const [label, landing] of [
    ["lowercase colour", { overlay_color: "#aabbcc" }],
    ["alpha needs two decimals", { overlay_alpha: "0.3" }],
    ["alpha is bounded", { overlay_alpha: "1.01" }],
    ["integer is canonical", { title_size: "072" }],
    ["integer is bounded", { title_size: "73" }],
    ["offset has no plus spelling", { title_image_offset_percent: "+10" }],
    ["font vocabulary is closed", { title_font: "proxima_cond_bold" }],
    ["alignment vocabulary is closed", { title_align: "justify" }],
    ["Apple vocabulary is closed", { button_apple_style: "grey" }],
    ["subtitle visibility is a string boolean", { description_hidden: "1" }],
    ["text gap value has a lower bound", { text_gap_value: "-1" }],
    ["text gap value is bounded", { text_gap_value: "201" }],
    ["text gap value is canonical", { text_gap_value: "024" }],
    ["text gap unit is closed", { text_gap_unit: "px" }],
    ["footer minimum has a lower bound", { footer_min_height_value: "-1" }],
    ["footer minimum is bounded", { footer_min_height_value: "301" }],
    ["footer minimum unit is closed", { footer_min_height_unit: "vh" }],
    ["QR is a string boolean", { qr_enabled: "1" }],
    ["unknown flat key", { future_style: "x" }],
  ] as const) {
    assert.equal(parseAppearanceLanding(landing), null, label);
  }
});

test("D-061 pair coherence and footer markers fail closed before save", () => {
  const footer = "Read our <terms>Terms</terms> and <privacy>Privacy</privacy>.";
  assert.equal(appearanceFooterTextHasExactTags(footer), true);
  for (const invalid of [
    "Read our Terms and Privacy.",
    "<terms>Terms</terms> <terms>Again</terms> <privacy>Privacy</privacy>",
    "<terms></terms> <privacy>Privacy</privacy>",
    "<terms><privacy>Nested</privacy></terms>",
    "<terms>Terms</privacy> <privacy>Privacy</terms>",
  ]) assert.equal(appearanceFooterTextHasExactTags(invalid), false, invalid);

  assert.equal(appearanceLandingCoherent({ overlay_color: "#000000" }), false);
  assert.equal(appearanceLandingCoherent({ overlay_color: "#000000", overlay_alpha: "0.25" }), true);
  assert.equal(appearanceLandingCoherent({ description_backdrop_alpha: "0.00" }), false);
  assert.equal(appearanceLandingCoherent({ footer_bg_color: "#000000" }), false);
  assert.equal(appearanceLandingCoherent({ text_gap_value: "24" }), false);
  assert.equal(appearanceLandingCoherent({ text_gap_unit: "pt" }), false);
  assert.equal(appearanceLandingCoherent({ text_gap_value: "24", text_gap_unit: "pt" }), true);
  assert.equal(appearanceLandingCoherent({ footer_min_height_value: "20" }), false);
  assert.equal(appearanceLandingCoherent({ footer_min_height_value: "20", footer_min_height_unit: "percent" }), true);
  assert.equal(appearanceLandingCoherent({ title_type: "none" }), true);
  assert.equal(appearanceLandingCoherent({ title_type: "image" }), false);
  assert.equal(appearanceLandingCoherent({ footer_text_en: footer }), true);
  assert.equal(parseAppearanceLanding({ footer_text_en: "Terms and privacy" }), null);

  const draft = appearanceRuleDraft(parseAppearanceRule(geoRule())!);
  draft.landing.overlay_color = "#000000";
  assert.equal(validateAppearanceRuleDraft(draft), "landingPair");
  draft.landing.overlay_alpha = "0.3";
  assert.equal(validateAppearanceRuleDraft(draft), "landingValue");
  draft.landing.overlay_alpha = "0.30";
  draft.landing.footer_text_en = "Terms and privacy";
  assert.equal(validateAppearanceRuleDraft(draft), "footerTags");
  draft.landing.footer_text_en = footer;
  assert.equal(validateAppearanceRuleDraft(draft), null);
});

test("the local D-061 merge resolves all flat fields and localized button/footer copy", () => {
  const effective = resolveAppearanceLandingFields([
    { overlay_alpha: "0.80", button_phone_label_hu: "Telefonnal", footer_text_hu: "<terms>Feltételek</terms> és <privacy>Adatvédelem</privacy>" },
    { overlay_color: "#123456", title_font: "system_bold" },
  ], APPEARANCE_DEFAULT_LANDING);
  assert.equal(effective.overlay_color, "#123456");
  assert.equal(effective.overlay_alpha, "0.80");
  assert.equal(effective.title_font, "system_bold");
  assert.equal(effective.button_email_bg, APPEARANCE_DEFAULT_LANDING.button_email_bg);

  const resolved = resolveAppearanceLanding([effective], APPEARANCE_DEFAULT_LANDING, "hu");
  assert.equal(resolved.phoneLabel, "Telefonnal");
  assert.equal(resolved.emailLabel, APPEARANCE_DEFAULT_LANDING.button_email_label_hu);
  assert.equal(resolved.footerText, "<terms>Feltételek</terms> és <privacy>Adatvédelem</privacy>");
  assert.equal(resolved.effective.overlay_alpha, "0.80");

  const parentRulesOnly = appearanceLandingDraft({ title_text_en: "Parent English" });
  const compiledDefaults = { ...APPEARANCE_DEFAULT_LANDING, title_text_en: "Default English", title_text_hu: "Alapértelmezett magyar" };
  const unsaved = appearanceLandingWire({ ...appearanceLandingDraft({}), title_text_en: "Draft English" });
  assert.equal(
    resolveAppearanceLanding([unsaved, parentRulesOnly], compiledDefaults, "hu").titleText,
    "Draft English",
    "Amendment v1.4a exhausts the HU rule chain and then the EN rule chain before either compiled default",
  );
});

test("subtitle visibility has inherit, shown and hidden states without deleting its text (D-061b)", () => {
  const parent = appearanceLandingDraft({
    description_en: "Keep this copy",
    description_hidden: "true",
  });
  const inherited = resolveAppearanceLanding([appearanceLandingWire(appearanceLandingDraft({})), parent], APPEARANCE_DEFAULT_LANDING, "en");
  assert.equal(inherited.descriptionHidden, true);
  assert.equal(inherited.description, "Keep this copy");

  const shown = resolveAppearanceLanding([
    appearanceLandingWire(appearanceLandingDraft({ description_hidden: "false" })),
    parent,
  ], APPEARANCE_DEFAULT_LANDING, "en");
  assert.equal(shown.descriptionHidden, false);
  assert.equal(shown.description, "Keep this copy");

  const hidden = resolveAppearanceLanding([
    appearanceLandingWire(appearanceLandingDraft({ description_hidden: "true" })),
  ], APPEARANCE_DEFAULT_LANDING, "en");
  assert.equal(hidden.descriptionHidden, true);
  assert.equal(hidden.description, APPEARANCE_DEFAULT_LANDING.description_en);
  assert.deepEqual(parseAppearanceLanding({ description_hidden: "false" }), { description_hidden: "false" });
  assert.deepEqual(parseAppearanceLanding({ description_hidden: "true" }), { description_hidden: "true" });
});

test("layout controls keep value and unit atomic and convert pt/percent on the phone-height axis (D-061c)", () => {
  const blank = appearanceLandingDraft({});
  const effective = appearanceLandingDraft({
    text_gap_value: "24",
    text_gap_unit: "pt",
    footer_min_height_value: "10",
    footer_min_height_unit: "percent",
  });

  const textValue = appearanceLandingLayoutPairSelection(blank, effective, "text_gap", "value", "40");
  assert.equal(textValue.text_gap_value, "40");
  assert.equal(textValue.text_gap_unit, "pt", "setting the value materializes the effective unit in the same draft patch");
  assert.equal(appearanceLandingCoherent(appearanceLandingWire(textValue)), true);

  const textUnit = appearanceLandingLayoutPairSelection(blank, effective, "text_gap", "unit", "percent");
  assert.equal(textUnit.text_gap_value, "24", "setting the unit materializes the effective value in the same draft patch");
  assert.equal(textUnit.text_gap_unit, "percent");
  const textCleared = appearanceLandingLayoutPairSelection(textUnit, effective, "text_gap", "unit", "");
  assert.equal(textCleared.text_gap_value, "");
  assert.equal(textCleared.text_gap_unit, "");

  const footerValue = appearanceLandingLayoutPairSelection(blank, effective, "footer_min_height", "value", "120");
  assert.equal(footerValue.footer_min_height_value, "120");
  assert.equal(footerValue.footer_min_height_unit, "percent");
  const footerUnit = appearanceLandingLayoutPairSelection(footerValue, effective, "footer_min_height", "unit", "pt");
  assert.equal(footerUnit.footer_min_height_value, "120");
  assert.equal(footerUnit.footer_min_height_unit, "pt");
  const footerCleared = appearanceLandingLayoutPairSelection(footerUnit, effective, "footer_min_height", "value", "");
  assert.equal(footerCleared.footer_min_height_value, "");
  assert.equal(footerCleared.footer_min_height_unit, "");

  assert.deepEqual(appearanceLandingLayoutPixels(APPEARANCE_DEFAULT_LANDING), { textGap: 24, footerMinHeight: 0 });
  assert.deepEqual(appearanceLandingLayoutPixels(appearanceLandingDraft({
    text_gap_value: "37",
    text_gap_unit: "pt",
    footer_min_height_value: "120",
    footer_min_height_unit: "pt",
  })), { textGap: 37, footerMinHeight: 120 });
  assert.deepEqual(appearanceLandingLayoutPixels(appearanceLandingDraft({
    text_gap_value: "10",
    text_gap_unit: "percent",
    footer_min_height_value: "25",
    footer_min_height_unit: "percent",
  })), { textGap: 84.4, footerMinHeight: 211 });
  assert.deepEqual(appearanceLandingLayoutPixels(appearanceLandingDraft({
    text_gap_value: "10",
    text_gap_unit: "percent",
    footer_min_height_value: "25",
    footer_min_height_unit: "percent",
  }), 1000), { textGap: 100, footerMinHeight: 250 });

  const merged = resolveAppearanceLandingFields([
    { text_gap_value: "10", text_gap_unit: "percent" },
    { footer_min_height_value: "120", footer_min_height_unit: "pt" },
  ], APPEARANCE_DEFAULT_LANDING);
  assert.equal(merged.text_gap_value, "10");
  assert.equal(merged.text_gap_unit, "percent");
  assert.equal(merged.footer_min_height_value, "120");
  assert.equal(merged.footer_min_height_unit, "pt");
  assert.deepEqual(appearanceLandingLayoutPixels(merged), { textGap: 84.4, footerMinHeight: 120 });
});

test("the landing preview rejects malformed style strings and inherits safe values", () => {
  const invalidValues = {
    overlay_alpha: "1.25",
    title_color: "red;background:url(x)",
    title_font: "serif",
    title_size: "12px;color:red",
    title_align: "justify",
    title_image_width_percent: "101",
    title_image_offset_percent: "-41",
    description_size: "41",
    description_hidden: "maybe",
    button_corner_radius: "33",
    button_apple_style: "rainbow",
    footer_size: "9",
    text_gap_value: "201",
    text_gap_unit: "px",
    footer_min_height_value: "301",
    footer_min_height_unit: "vh",
  } as const;
  const draft = appearanceLandingDraft(invalidValues);
  const preview = appearanceLandingPreviewDraft(draft);
  assert.deepEqual(
    [...preview.invalidFields].sort(),
    Object.keys(invalidValues).sort(),
  );
  for (const key of preview.invalidFields) {
    assert.equal(Object.hasOwn(preview.landing, key), false, `${key} cannot reach the preview merge`);
  }

  const parent = appearanceLandingDraft({
    overlay_alpha: "0.20",
    title_color: "#123456",
    title_font: "system_bold",
    title_size: "52",
    title_align: "right",
    title_image_width_percent: "75",
    title_image_offset_percent: "5",
    description_size: "20",
    description_hidden: "false",
    button_corner_radius: "12",
    button_apple_style: "black",
    footer_size: "14",
    text_gap_value: "32",
    text_gap_unit: "pt",
    footer_min_height_value: "12",
    footer_min_height_unit: "percent",
  });
  const resolved = resolveAppearanceLanding([preview.landing, parent], APPEARANCE_DEFAULT_LANDING, "en");
  for (const [key, expected] of Object.entries(parent)) {
    if (expected !== "") assert.equal(resolved.effective[key as keyof typeof parent], expected, key);
  }
  assert.equal(JSON.stringify(resolved.effective).includes("background:url"), false);
  assert.equal(JSON.stringify(resolved.effective).includes("color:red"), false);

  const valid = appearanceLandingPreviewDraft(appearanceLandingDraft({
    overlay_alpha: "1.00",
    title_color: "#AABBCC",
    title_font: "proxima_regular",
    title_size: "12",
    title_align: "center",
    title_image_width_percent: "100",
    title_image_offset_percent: "-40",
    description_hidden: "true",
    button_corner_radius: "0",
    button_apple_style: "white_outline",
    footer_size: "18",
    text_gap_value: "200",
    text_gap_unit: "percent",
    footer_min_height_value: "300",
    footer_min_height_unit: "pt",
  }));
  assert.deepEqual(valid.invalidFields, []);
  assert.equal(valid.landing.title_color, "#AABBCC");
  assert.equal(new Set(APPEARANCE_LANDING_PREVIEW_STYLE_KEYS).size, APPEARANCE_LANDING_PREVIEW_STYLE_KEYS.length);
});

test("a background type remains a pending upload choice until media completes the pair", () => {
  const blank = appearanceLandingDraft({});
  const pendingVideo = appearanceLandingBackgroundSelection(blank, "video");
  assert.equal(pendingVideo.pendingType, "video");
  assert.equal(pendingVideo.draft.background_type, "");
  assert.equal(pendingVideo.draft.background_url, "");
  assert.equal(appearanceLandingCoherent(appearanceLandingWire(pendingVideo.draft)), true);

  const image = appearanceLandingDraft({
    background_type: "image",
    background_url: "https://cdn.friending.co/background.jpg",
  });
  const switched = appearanceLandingBackgroundSelection(image, "video");
  assert.equal(switched.pendingType, "video");
  assert.equal(switched.draft.background_type, "");
  assert.equal(switched.draft.background_url, "");

  const unchanged = appearanceLandingBackgroundSelection(image, "image");
  assert.equal(unchanged.pendingType, null);
  assert.equal(unchanged.draft, image);

  const cleared = appearanceLandingBackgroundSelection(image, "");
  assert.equal(cleared.pendingType, null);
  assert.equal(cleared.draft.background_type, "");
  assert.equal(cleared.draft.background_url, "");

  const repairedHalfPair = appearanceLandingBackgroundSelection(
    appearanceLandingDraft({ background_type: "video" }),
    "video",
  );
  assert.equal(repairedHalfPair.pendingType, "video");
  assert.equal(repairedHalfPair.draft.background_type, "");
  assert.equal(repairedHalfPair.draft.background_url, "");
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
  const rules = [wireRule(), storefrontRule(), geoRule(), geoRule({ id: "66d0a1b2c3d4e5f6a7b8c9e1", name: "Aachen", priority: 10 }), geoRule({ id: "66d0a1b2c3d4e5f6a7b8c9e2", name: "Zürich", priority: 20 })]
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
  assert.equal(hu.length, APPEARANCE_COUNTRY_COUNT, "exactly Core's 249 ISO 3166-1 pairs");
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
  const save = normalizeAppearanceProxyBody("appearance_rules_save", { id: "66d0a1b2c3d4e5f6a7b8c9d1", expected_revision: 3, rule });
  assert.ok(save);
  assert.deepEqual(Object.keys(save).sort(), ["expected_revision", "id", "rule"]);
  assert.deepEqual(save.rule, rule);
  assert.ok(normalizeAppearanceProxyBody("appearance_rules_save", { id: "", expected_revision: 0, rule }), "create");
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_save", { id: "", expected_revision: 3, rule }), null, "create with a revision");
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_save", { id: "66d0a1b2c3d4e5f6a7b8c9d1", expected_revision: 0, rule }), null, "update without a revision");
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_save", { id: "66d0a1b2c3d4e5f6a7b8c9d1", expected_revision: 3, rule, admin_email: "x" }), null, "reserved key");
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_save", { id: "66d0a1b2c3d4e5f6a7b8c9d1", expected_revision: "3", rule }), null, "string revision");
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_save", { id: "66d0a1b2c3d4e5f6a7b8c9d1", expected_revision: 3, rule: { ...rule, extra: 1 } }), null, "unknown rule key");
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_save", { id: "66d0a1b2c3d4e5f6a7b8c9d1", expected_revision: 3, rule: { ...rule, palette: { light: { accent: "#007f91" }, dark: {} } } }), null, "lowercase palette hex");
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_save", { id: "66d0a1b2c3d4e5f6a7b8c9d1", expected_revision: 3 }), null, "missing rule");

  assert.deepEqual(normalizeAppearanceProxyBody("appearance_rules_delete", { id: "66d0a1b2c3d4e5f6a7b8c9d1", expected_revision: 3 }), { id: "66d0a1b2c3d4e5f6a7b8c9d1", expected_revision: 3 });
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_delete", { id: "66d0a1b2c3d4e5f6a7b8c9d1", expected_revision: 0 }), null);
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_delete", { id: "", expected_revision: 1 }), null);
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_delete", { id: "66d0a1b2c3d4e5f6a7b8c9d1", expected_revision: 1, force: true }), null);

  assert.deepEqual(normalizeAppearanceProxyBody("appearance_rules_preview", {}), {});
  assert.deepEqual(
    normalizeAppearanceProxyBody("appearance_rules_preview", { storefront_country: "HUN", latitude: 47.5, longitude: 19.04, ip: "", lang: "hu" }),
    { storefront_country: "HUN", latitude: 47.5, longitude: 19.04, lang: "hu" },
  );
  assert.deepEqual(normalizeAppearanceProxyBody("appearance_rules_preview", { ip: "203.0.113.7" }), { ip: "203.0.113.7" });
  assert.deepEqual(normalizeAppearanceProxyBody("appearance_rules_preview", { ip: "2001:db8::1" }), { ip: "2001:db8::1" });
  assert.deepEqual(normalizeAppearanceProxyBody("appearance_rules_preview", {
    appearance_schema: 2,
    exclude_rule_id: "66d0a1b2c3d4e5f6a7b8c9d1",
    location_mode: "none",
    storefront_country: "HUN",
    lang: "en",
  }), {
    appearance_schema: 2,
    exclude_rule_id: "66d0a1b2c3d4e5f6a7b8c9d1",
    location_mode: "none",
    storefront_country: "HUN",
    lang: "en",
  });
  assert.deepEqual(normalizeAppearanceProxyBody("appearance_rules_preview", {
    location_mode: "auto",
    latitude: 47.5,
    longitude: 19.04,
  }), { location_mode: "auto", latitude: 47.5, longitude: 19.04 });
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_preview", { appearance_schema: 3 }), null);
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_preview", { appearance_schema: "2" }), null);
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_preview", { exclude_rule_id: "not-an-object-id" }), null);
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_preview", { location_mode: "gps" }), null);
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_preview", { location_mode: "none", latitude: 0, longitude: 0 }), null);
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_preview", { location_mode: "none", ip: "" }), null, "even an empty location input conflicts with none");
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

test("the five appearance actions are allow-listed and classified as designed", () => {
  assert.equal(APPEARANCE_ACTIONS.length, 5);
  for (const action of APPEARANCE_ACTIONS) {
    assert.equal(isAdminActionAllowed(action), true, action);
    assert.equal((ADMIN_ACTIONS as readonly string[]).includes(action), true, action);
  }
  assert.equal(adminActionAccess("appearance_rules_list"), "read");
  assert.equal(adminActionAccess("appearance_rules_preview"), "read");
  assert.equal(adminActionAccess("appearance_rules_save"), "write");
  assert.equal(adminActionAccess("appearance_rules_delete"), "write");
  assert.equal(adminActionAccess("appearance_city_geocode"), "write");
  // The raised save ceiling is a static table entry.
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

  const update = decodeAppearanceSaveResponse(envelope({ rule: geoRule({ revision: 4 }) }), { id: stored.id, expected_revision: 3, input });
  assert.ok(update.ok);
  assert.equal(update.value.revision, 4);
  const otherId = decodeAppearanceSaveResponse(envelope({ rule: geoRule({ id: "66d0a1b2c3d4e5f6a7b8c9d9", revision: 4 }) }), { id: stored.id, expected_revision: 3, input });
  assert.deepEqual(otherId, { ok: false, kind: "uncertain", error: "unbound-target" });

  const create = decodeAppearanceSaveResponse(envelope({ rule: geoRule({ id: "66d0a1b2c3d4e5f6a7b8c9dd", revision: 1 }) }), { id: "", expected_revision: 0, input });
  assert.ok(create.ok, "create adopts the minted id when the material is what was sent");
  assert.equal(create.value.id, "66d0a1b2c3d4e5f6a7b8c9dd");
  const drifted = decodeAppearanceSaveResponse(envelope({ rule: geoRule({ id: "66d0a1b2c3d4e5f6a7b8c9dd", revision: 1, priority: 99 }) }), { id: "", expected_revision: 0, input });
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
    const decoded = decodeAppearanceSaveResponse(value, { id: stored.id, expected_revision: 3, input });
    assert.equal(decoded.ok, false, label);
    assert.equal(!decoded.ok && decoded.kind, "uncertain", label);
  }
  assert.deepEqual(
    decodeAppearanceSaveResponse(coreRefusal("appearance-rule-conflict", 409), { id: stored.id, expected_revision: 3, input }),
    { ok: false, kind: "refused", error: "appearance-rule-conflict", status: 409 },
  );
});

test("the refusal vocabulary is closed: unknown names and wrong statuses are uncertain, never a proven no-land", () => {
  const stored = parseAppearanceRule(geoRule());
  assert.ok(stored);
  const input = appearanceRuleInputFromDraft(appearanceRuleDraft(stored));
  assert.ok(input);
  const save = (value: unknown) => decodeAppearanceSaveResponse(value, { id: stored.id, expected_revision: stored.revision, input });
  const remove = (value: unknown) => decodeAppearanceDeleteResponse(value, stored.id);

  for (const decode of [save, remove]) {
    // Known no-land refusals at their exact statuses.
    assert.deepEqual(decode(coreRefusal("appearance-rule-conflict", 409)), { ok: false, kind: "refused", error: "appearance-rule-conflict", status: 409 });
    assert.deepEqual(decode(coreRefusal("appearance-rule-global-protected", 409)), { ok: false, kind: "refused", error: "appearance-rule-global-protected", status: 409 });
    assert.deepEqual(decode(coreRefusal("appearance-rule-not-found", 404)), { ok: false, kind: "refused", error: "appearance-rule-not-found", status: 404 });
    assert.deepEqual(decode(coreRefusal("appearance-rule-hero-item-invalid", 422)), { ok: false, kind: "refused", error: "appearance-rule-hero-item-invalid", status: 422 });
    assert.deepEqual(decode(coreRefusal("appearance-rule-revision-invalid", 422)), { ok: false, kind: "refused", error: "appearance-rule-revision-invalid", status: 422 });
    assert.deepEqual(decode({ ...coreRefusal("appearance-rule-invalid", 422), field: "overlay_alpha" }), { ok: false, kind: "refused", error: "appearance-rule-invalid", status: 422 });
    assert.deepEqual(decode({ ...coreRefusal("appearance-rule-invalid", 422), field: "location_mode" }), { ok: false, kind: "refused", error: "appearance-rule-invalid", status: 422 });
    assert.deepEqual(decode({ ...coreRefusal("appearance-rule-invalid", 422), field: "future_field" }), { ok: false, kind: "uncertain", error: "malformed-envelope" });
    assert.deepEqual(decode({ ...coreRefusal("appearance-rule-conflict", 409), field: "overlay_alpha" }), { ok: false, kind: "uncertain", error: "malformed-envelope" });
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
  assert.deepEqual(decodeAppearanceDeleteResponse(envelope({ id: "66d0a1b2c3d4e5f6a7b8c9d1" }), "66d0a1b2c3d4e5f6a7b8c9d1"), { ok: true, value: { id: "66d0a1b2c3d4e5f6a7b8c9d1" } });
  assert.deepEqual(decodeAppearanceDeleteResponse(envelope({ id: "66d0a1b2c3d4e5f6a7b8c9d9" }), "66d0a1b2c3d4e5f6a7b8c9d1"), { ok: false, kind: "uncertain", error: "unbound-target" });
  assert.equal(decodeAppearanceDeleteResponse({ success: true }, "66d0a1b2c3d4e5f6a7b8c9d1").ok, false, "a bare success removes nothing");
  assert.equal(decodeAppearanceDeleteResponse(envelope({}), "66d0a1b2c3d4e5f6a7b8c9d1").ok, false);
  assert.equal(decodeAppearanceDeleteResponse(envelope({ id: "66d0a1b2c3d4e5f6a7b8c9d1", deleted: true }), "66d0a1b2c3d4e5f6a7b8c9d1").ok, false);
  assert.equal(decodeAppearanceDeleteResponse(null, "66d0a1b2c3d4e5f6a7b8c9d1").ok, false);
  assert.deepEqual(
    decodeAppearanceDeleteResponse(coreRefusal("appearance-rule-global-protected", 409), "66d0a1b2c3d4e5f6a7b8c9d1"),
    { ok: false, kind: "refused", error: "appearance-rule-global-protected", status: 409 },
  );
});

test("the stored actor mirrors Core's bounds: non-empty after trim, at most 320 code points, never repaired", () => {
  assert.ok(parseAppearanceRule(wireRule({ updated_by: "lead@friending.com" })));
  assert.equal(parseAppearanceRule(wireRule({ updated_by: "" })), null, "empty actor");
  assert.equal(parseAppearanceRule(wireRule({ updated_by: "   " })), null, "whitespace-only actor");
  const boundary = "a".repeat(320);
  const stored = parseAppearanceRule(wireRule({ updated_by: boundary }));
  assert.ok(stored, "320 code points fit");
  assert.equal(stored.updated_by, boundary, "projected unrepaired");
  assert.equal(parseAppearanceRule(wireRule({ updated_by: "a".repeat(321) })), null, "321 code points are over the bound");
  const astral = "🙂".repeat(320);
  assert.ok(parseAppearanceRule(wireRule({ updated_by: astral })), "the bound counts code points, not UTF-16 units");
  assert.equal(parseAppearanceRule(wireRule({ updated_by: `${astral}x` })), null);
  const padded = " lead@friending.com ";
  assert.equal(parseAppearanceRule(wireRule({ updated_by: padded }))?.updated_by, padded, "surrounding whitespace is kept, not trimmed away");
  assert.equal(parseAppearanceListPayload({ rules: [wireRule({ updated_by: "" })], defaults: { palette: APPEARANCE_DEFAULT_PALETTE, landing: APPEARANCE_DEFAULT_LANDING } }), null, "a malformed actor makes the whole list untrusted");
});

test("migrated_from is the closed released marker union and survives the full list decoder", () => {
  const reactivated = parseAppearanceRule(wireRule({ migrated_from: "inactive_global_landing" }));
  assert.ok(reactivated);
  assert.equal(reactivated.migrated_from, "inactive_global_landing", "the marker is preserved");
  assert.equal(parseAppearanceRule(wireRule({ migrated_from: "country" }))?.migrated_from, "country");
  assert.equal(parseAppearanceRule(wireRule())?.migrated_from, null, "absent marker");
  for (const foreign of ["city", "", null, "INACTIVE_GLOBAL_LANDING", 1, true, ["country"]]) {
    assert.equal(parseAppearanceRule(wireRule({ migrated_from: foreign })), null, `foreign marker ${JSON.stringify(foreign)}`);
  }
  const list = parseAppearanceListPayload({
    rules: [wireRule({ migrated_from: "inactive_global_landing" }), storefrontRule({ migrated_from: "country" }), geoRule()],
    defaults: { palette: APPEARANCE_DEFAULT_PALETTE, landing: APPEARANCE_DEFAULT_LANDING },
  });
  assert.ok(list, "a list carrying the reactivated-global marker decodes in full");
  assert.deepEqual(list.rules.map((rule) => rule.migrated_from), ["inactive_global_landing", "country", null]);
  const decoded = decodeAppearanceListResponse({ message: 200, status: 200, can_send: 0, success: true, status_code: 200, data: {
    rules: [wireRule({ migrated_from: "inactive_global_landing" })],
    defaults: { palette: APPEARANCE_DEFAULT_PALETTE, landing: APPEARANCE_DEFAULT_LANDING },
  } });
  assert.ok(decoded.ok && decoded.value.rules[0]?.migrated_from === "inactive_global_landing");
});

test("save input refuses repeated non-empty hero ids while empty ids stay legal for Core to mint", () => {
  const stored = parseAppearanceRule(wireRule())!;
  const item = stored.hero.items[0]!;
  const input = appearanceRuleInputOf(stored);
  const withItems = (items: typeof stored.hero.items) => ({ ...input, hero: { mode: "replace" as const, items } });
  const save = (rule: unknown) => normalizeAppearanceProxyBody("appearance_rules_save", { id: stored.id, expected_revision: stored.revision, rule });
  assert.equal(save(withItems([item, { ...item }])), null, "duplicate non-empty id refused at the proxy");
  assert.equal(parseAppearanceRuleInput(withItems([item, { ...item }])), null);
  assert.ok(save(withItems([item, { ...item, id: "" }])), "mixed empty + unique non-empty accepted");
  assert.ok(save(withItems([{ ...item, id: "" }, { ...item, id: "" }])), "multiple empty ids accepted");
  assert.ok(save(withItems([item, { ...item, id: `${item.id}-2` }])), "distinct non-empty ids accepted");
  assert.equal(parseAppearanceRule(wireRule({ hero: { mode: "replace", items: [{ ...item, id: "" }, { ...item, id: "" }] } })), null, "the stored path keeps the stronger rule");
});

test("localized landing text follows Core: requested-language chain, English chain, then compiled defaults", () => {
  const real = APPEARANCE_DEFAULT_LANDING;
  // English-only HIGH rule under Hungarian: the chain's English beats the compiled Hungarian default.
  const highEnglish = resolveAppearanceLanding([{ title_text_en: "Geo English", description_en: "Geo copy" }, {}], real, "hu");
  assert.equal(highEnglish.titleText, "Geo English");
  assert.equal(highEnglish.description, "Geo copy");
  // English-only LOWER rule under Hungarian: still the chain's English before any default.
  const lowEnglish = resolveAppearanceLanding([{}, { title_text_en: "Global English" }], real, "hu");
  assert.equal(lowEnglish.titleText, "Global English");
  // Higher English versus lower Hungarian: the requested-language chain wins first.
  const mixed = resolveAppearanceLanding([{ title_text_en: "Geo English" }, { title_text_hu: "Globális cím" }], real, "hu");
  assert.equal(mixed.titleText, "Globális cím");
  assert.equal(resolveAppearanceLanding([{ title_text_en: "Geo English" }, { title_text_hu: "Globális cím" }], real, "en").titleText, "Geo English");
  // Defaults only: requested language, then English.
  const defaultsOnly = resolveAppearanceLanding([], real, "hu");
  assert.equal(defaultsOnly.titleText, real.title_text_hu);
  assert.equal(defaultsOnly.description, real.description_hu);
  assert.equal(resolveAppearanceLanding([], { ...real, description_hu: "" }, "hu").description, real.description_en, "a blank compiled Hungarian default falls to the compiled English one last");
});

test("the preview refuses state combinations released Core cannot emit", () => {
  const ok = parseAppearancePreviewPayload(previewPayload());
  assert.ok(ok);
  const landing = (patch: Record<string, unknown>) => ({ ...(previewPayload().landing as Record<string, unknown>), ...patch });
  const image = { type: "image", url: "https://img.friending.co/api/cache/pride.jpg", poster_url: "" };
  assert.equal(parseAppearancePreviewPayload(previewPayload({ landing: landing({ background: { ...image, poster_url: "https://img.friending.co/api/cache/p.jpg" } }) })), null, "image background with a poster");
  assert.equal(parseAppearancePreviewPayload(previewPayload({ landing: landing({ background: { type: "video", url: "", poster_url: "" } }) })), null, "video background without a URL");
  assert.ok(parseAppearancePreviewPayload(previewPayload({ landing: landing({ background: { type: "video", url: "https://cdn.friending.co/a.mp4", poster_url: "https://img.friending.co/api/cache/p.jpg" } }) })), "video with URL and poster");
  assert.equal(parseAppearancePreviewPayload(previewPayload({ landing: landing({ title: { type: "text", text: "friending.", image_url: "https://img.friending.co/api/cache/t.png" } }) })), null, "text title with an image URL");
  assert.ok(parseAppearancePreviewPayload(previewPayload({ landing: landing({ title: { type: "text", text: "", image_url: "" } }) })), "v2 none projects to a legacy text title with empty text");
  assert.equal(parseAppearancePreviewPayload(previewPayload({ landing: landing({ title: { type: "image", text: "", image_url: "" } }) })), null, "image title without an image");
  assert.equal(parseAppearancePreviewPayload(previewPayload({ landing: landing({ title: { type: "image", text: "friending.", image_url: "https://img.friending.co/api/cache/t.png" } }) })), null, "image title with text");
  assert.ok(parseAppearancePreviewPayload(previewPayload({ landing: landing({ title: { type: "image", text: "", image_url: "https://img.friending.co/api/cache/t.png" } }) })), "image title with only its image");
  assert.equal(parseAppearancePreviewPayload(previewPayload({ landing: landing({ description: "" }) })), null, "the compiled fallback makes the description non-empty");
  const envelope = (data: unknown) => ({ message: 200, status: 200, can_send: 0, success: true, status_code: 200, data });
  assert.deepEqual(decodeAppearancePreviewResponse(envelope(previewPayload({ landing: landing({ description: "" }) }))), { ok: false, kind: "uncertain", error: "malformed-material" }, "malformed success through the decoder");

  // Finding 10: matched invariants.
  assert.equal(parseAppearancePreviewPayload(previewPayload({ revision: 1, matched: { scope: "default", rule_id: "", location_source: "none" } })), null, "default match at revision 1");
  assert.ok(parseAppearancePreviewPayload(previewPayload({ revision: 0, matched: { scope: "default", rule_id: "", location_source: "gps" } })), "gps evidence stays legal on a default answer");
  assert.equal(parseAppearancePreviewPayload(previewPayload({ revision: 0, matched: { scope: "geo", rule_id: "66d0a1b2c3d4e5f6a7b8c9d1", location_source: "gps" } })), null, "geo match at revision 0");
  assert.equal(parseAppearancePreviewPayload(previewPayload({ matched: { scope: "geo", rule_id: "66d0a1b2c3d4e5f6a7b8c9d1", location_source: "none" } })), null, "geo match without location evidence");
  assert.ok(parseAppearancePreviewPayload(previewPayload({ matched: { scope: "storefront", rule_id: "66d0a1b2c3d4e5f6a7b8c9d2", location_source: "none" } })), "a storefront match needs no location evidence");
  assert.ok(parseAppearancePreviewPayload(previewPayload({ matched: { scope: "global", rule_id: "66d0a1b2c3d4e5f6a7b8c9d0", location_source: "ip" } })), "ip evidence stays legal on a global answer");

  // Finding 7: identity and version domains.
  assert.equal(parseAppearancePreviewPayload(previewPayload({ content_version: "7:2026-08-29T11:00:00Z" })), null, "content_version is a lowercase sha256 hex digest");
  assert.equal(parseAppearancePreviewPayload(previewPayload({ content_version: "A3F1C9E2B7D4085F6C1E2A9B8D7C6F5E4D3C2B1A0F9E8D7C6B5A4F3E2D1C0B9A" })), null, "uppercase digest");
  assert.equal(parseAppearancePreviewPayload(previewPayload({ content_version: 0 })), null, "numeric version");
  assert.equal(parseAppearancePreviewPayload(previewPayload({ matched: { scope: "geo", rule_id: "x", location_source: "gps" } })), null, "a matched rule id is 24 lowercase hex");
  assert.equal(parseAppearancePreviewPayload(previewPayload({ matched: { scope: "geo", rule_id: "66D0A1B2C3D4E5F6A7B8C9D1", location_source: "gps" } })), null, "uppercase rule id");
  const heroItem = (previewPayload().hero as Record<string, unknown>[])[0]!;
  assert.equal(parseAppearancePreviewPayload(previewPayload({ hero: [{ ...heroItem, id: "" }] })), null, "empty hero id");
  assert.equal(parseAppearancePreviewPayload(previewPayload({ hero: [heroItem, { ...heroItem }] })), null, "duplicate hero id");
  assert.ok(parseAppearancePreviewPayload(previewPayload({ hero: Array.from({ length: 10 }, (_, index) => ({ ...heroItem, id: `hero-${index}` })) })), "ten items fit");
  assert.equal(parseAppearancePreviewPayload(previewPayload({ hero: Array.from({ length: 11 }, (_, index) => ({ ...heroItem, id: `hero-${index}` })) })), null, "eleven items are over the wire cap");
});

test("geocode candidates mirror Core's output bounds exactly", () => {
  const candidate = (patch: Record<string, unknown> = {}) => ({ place_id: "ChIJyc_U0TTDQUcRYBEeDCnEAAQ", place_label: "Budapest, Hungary", country_code: "HU", center: { latitude: 47.4979, longitude: 19.0402 }, radius_km: 23, ...patch });
  assert.equal(parseAppearanceGeocodePayload({ candidates: Array.from({ length: 5 }, (_, index) => candidate({ place_id: `place-${index}` })) })?.length, 5, "five candidates fit");
  assert.equal(parseAppearanceGeocodePayload({ candidates: Array.from({ length: 6 }, (_, index) => candidate({ place_id: `place-${index}` })) }), null, "six candidates are over the cap");
  assert.equal(parseAppearanceGeocodePayload({ candidates: [candidate(), candidate()] }), null, "duplicate place_id");
  assert.equal(parseAppearanceGeocodePayload({ candidates: [candidate({ country_code: "" })] }), null, "empty country");
  assert.equal(parseAppearanceGeocodePayload({ candidates: [candidate({ radius_km: 23.5 })] }), null, "fractional radius");
  assert.equal(parseAppearanceGeocodePayload({ candidates: [candidate({ radius_km: 501 })] }), null, "radius above the cap");
  assert.ok(parseAppearanceGeocodePayload({ candidates: [candidate({ radius_km: 500 })] }));
  assert.ok(parseAppearanceGeocodePayload({ candidates: [candidate({ place_id: "a".repeat(256) })] }), "256 bytes fit");
  assert.equal(parseAppearanceGeocodePayload({ candidates: [candidate({ place_id: "a".repeat(257) })] }), null, "257 bytes are over the cap");
  assert.equal(parseAppearanceGeocodePayload({ candidates: [candidate({ place_id: "é".repeat(200) })] }), null, "the cap counts UTF-8 bytes, not characters");
  assert.equal(parseAppearanceGeocodePayload({ candidates: [candidate({ place_id: "" })] }), null, "empty place_id");
});

test("landing pairing needs a non-empty URL at the proxy boundary; poster-only and text-only overrides stay legal", () => {
  const rule = appearanceRuleInputFromDraft(appearanceRuleDraft(parseAppearanceRule(geoRule())!))!;
  const save = (landing: unknown) => normalizeAppearanceProxyBody("appearance_rules_save", { id: rule ? "66d0a1b2c3d4e5f6a7b8c9d1" : "", expected_revision: 9, rule: { ...rule, landing } });
  for (const landing of [
    { background_type: "image", background_url: "" },
    { background_type: "image", background_url: "   " },
    { title_type: "image", title_image_url: "" },
    { title_type: "image", title_image_url: " " },
    { background_poster_url: "" },
    { title_image_url: "" },
  ]) {
    assert.equal(parseAppearanceRuleInput({ ...rule, landing }), null, `parser refuses ${JSON.stringify(landing)}`);
    assert.equal(save(landing), null, `proxy refuses ${JSON.stringify(landing)}`);
  }
  for (const landing of [
    { background_poster_url: "https://cdn.friending.co/p.jpg" },
    { title_type: "text", title_text_hu: "Cím" },
    { background_type: "image", background_url: "https://cdn.friending.co/a.jpg" },
    { title_type: "image", title_image_url: "https://cdn.friending.co/t.png" },
  ]) {
    assert.ok(parseAppearanceRuleInput({ ...rule, landing }), `parser accepts ${JSON.stringify(landing)}`);
    assert.ok(save(landing), `proxy accepts ${JSON.stringify(landing)}`);
  }
});

test("a save success is the exact CAS successor with the submitted material, on create and update alike", () => {
  const envelope = (data: unknown) => ({ message: 200, status: 200, can_send: 0, success: true, status_code: 200, data });
  const stored = parseAppearanceRule(geoRule())!;
  const input = appearanceRuleInputOf(stored);
  const ok = decodeAppearanceSaveResponse(envelope({ rule: geoRule({ revision: stored.revision + 1 }) }), { id: stored.id, expected_revision: stored.revision, input });
  assert.ok(ok.ok);
  assert.deepEqual(decodeAppearanceSaveResponse(envelope({ rule: geoRule({ revision: stored.revision + 2 }) }), { id: stored.id, expected_revision: stored.revision, input }), { ok: false, kind: "uncertain", error: "unbound-revision" }, "skipped successor");
  assert.deepEqual(decodeAppearanceSaveResponse(envelope({ rule: geoRule({ revision: stored.revision }) }), { id: stored.id, expected_revision: stored.revision, input }), { ok: false, kind: "uncertain", error: "unbound-revision" }, "unchanged revision");
  assert.deepEqual(decodeAppearanceSaveResponse(envelope({ rule: geoRule({ revision: stored.revision + 1, name: "Renamed" }) }), { id: stored.id, expected_revision: stored.revision, input }), { ok: false, kind: "uncertain", error: "unbound-material" }, "same id, different material on update");
  assert.deepEqual(decodeAppearanceSaveResponse(envelope({ rule: geoRule({ id: "66d0a1b2c3d4e5f6a7b8c9dd", revision: 2 }) }), { id: "", expected_revision: 0, input }), { ok: false, kind: "uncertain", error: "unbound-revision" }, "a new row is always revision 1");
  assert.ok(decodeAppearanceSaveResponse(envelope({ rule: geoRule({ id: "66d0a1b2c3d4e5f6a7b8c9dd", revision: 1 }) }), { id: "", expected_revision: 0, input }).ok);
  // Stored identity and audit timestamps are exact (finding 6).
  assert.equal(parseAppearanceRule(geoRule({ id: "x" })), null, "stored id is 24 lowercase hex");
  assert.equal(parseAppearanceRule(geoRule({ id: "66D0A1B2C3D4E5F6A7B8C9D1" })), null, "uppercase id");
  assert.equal(parseAppearanceRule(geoRule({ created_at: null })), null, "created_at never null");
  assert.equal(parseAppearanceRule(geoRule({ updated_at: null })), null, "updated_at never null");
  assert.equal(parseAppearanceRule(geoRule({ updated_at: "2026-08-29 11:00:00" })), null, "loose timestamp");
  assert.ok(parseAppearanceRule(geoRule({ starts_at: null, ends_at: null })), "the window stays nullable");
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_save", { id: "abc", expected_revision: 3, rule: input }), null, "loose update target id");
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_delete", { id: "abc", expected_revision: 3 }), null, "loose delete target id");
  assert.ok(normalizeAppearanceProxyBody("appearance_rules_save", { id: "", expected_revision: 0, rule: input }), "create target is empty");
  assert.deepEqual(decodeAppearanceDeleteResponse(envelope({ id: "abc" }), "abc"), { ok: false, kind: "uncertain", error: "malformed-material" }, "a loose delete id is malformed success");
});

test("a successful list carries exactly one global rule and at most 100 rules", () => {
  const DEFAULTS = { palette: APPEARANCE_DEFAULT_PALETTE, landing: APPEARANCE_DEFAULT_LANDING };
  assert.equal(parseAppearanceListPayload({ rules: [], defaults: DEFAULTS }), null, "zero globals is Core's schema-unavailable boundary, never a success");
  assert.equal(parseAppearanceListPayload({ rules: [storefrontRule(), geoRule()], defaults: DEFAULTS }), null, "no global among overrides");
  assert.equal(parseAppearanceListPayload({ rules: [wireRule(), wireRule({ id: "66d0a1b2c3d4e5f6a7b8c9e9", name: "Second global" })], defaults: DEFAULTS }), null, "two globals");
  const geoRules = (count: number) => Array.from({ length: count }, (_, index) => geoRule({ id: `66d0a1b2c3d4e5f6a7b8${String(index).padStart(4, "0")}`, name: `Geo ${index}` }));
  const hundred = parseAppearanceListPayload({ rules: [wireRule(), ...geoRules(99)], defaults: DEFAULTS });
  assert.equal(hundred?.rules.length, 100, "one hundred rules fit");
  assert.equal(parseAppearanceListPayload({ rules: [wireRule(), ...geoRules(100)], defaults: DEFAULTS }), null, "101 rules are over Core's MAX_RULES");
  const envelope = (data: unknown) => ({ message: 200, status: 200, can_send: 0, success: true, status_code: 200, data });
  assert.deepEqual(decodeAppearanceListResponse(envelope({ rules: [wireRule(), ...geoRules(100)], defaults: DEFAULTS })), { ok: false, kind: "uncertain", error: "malformed-material" });
  assert.deepEqual(decodeAppearanceListResponse(envelope({ rules: [], defaults: DEFAULTS })), { ok: false, kind: "uncertain", error: "malformed-material" });
});

test("a title-type change touches only title_type; text and image overrides persist until cleared", () => {
  const start = { ...appearanceLandingDraft({}), title_type: "text", title_text_en: "Hello", title_text_hu: "Szia", title_image_url: "https://cdn.friending.co/t.png" };
  const image = appearanceLandingWithTitleType(start, "image");
  assert.equal(image.title_type, "image");
  assert.equal(image.title_text_en, "Hello");
  assert.equal(image.title_text_hu, "Szia");
  assert.equal(image.title_image_url, "https://cdn.friending.co/t.png");
  const text = appearanceLandingWithTitleType(image, "text");
  assert.deepEqual(text, start, "text → image → text is lossless");
  const inherited = appearanceLandingWithTitleType(text, "");
  assert.equal(inherited.title_type, "");
  assert.equal(inherited.title_image_url, "https://cdn.friending.co/t.png");
  assert.equal(appearanceLandingWithTitleType(start, "text"), start, "no-op returns the same object");
  assert.equal(appearanceLandingWithTitleType(start, "banner").title_type, "", "an unknown type falls to inherited, nothing else changes");
  assert.equal(appearanceLandingWithTitleType(start, "banner").title_text_hu, "Szia");
});

test("a landed logo upload switches the draft title type to image; removal returns it to inherit (T-492)", () => {
  const logo = "https://cdn.friending.co/logo.png";
  // Inherited draft type over a text-titled parent: the upload patch flips the draft to image…
  const uploaded = appearanceLandingLogoSelection(appearanceLandingDraft({}), logo);
  assert.equal(uploaded.title_type, "image");
  assert.equal(uploaded.title_image_url, logo);
  assert.equal(appearanceLandingCoherent(appearanceLandingWire(uploaded)), true, "the save-time coherence rule is satisfied in the same patch");
  // …and the merged preview shows the logo immediately.
  const preview = resolveAppearanceLanding(
    [appearanceLandingPreviewDraft(uploaded).landing, { title_type: "text", title_text_en: "Global title" }],
    APPEARANCE_DEFAULT_LANDING,
    "en",
  );
  assert.equal(preview.titleType, "image");
  assert.equal(preview.titleImageUrl, logo);
  // Explicit text and none both flip too: uploading a logo clearly asks to show it.
  for (const titleType of ["text", "none"] as const) {
    const selected = appearanceLandingLogoSelection({ ...appearanceLandingDraft({}), title_type: titleType }, logo);
    assert.equal(selected.title_type, "image", `${titleType} switches to image`);
    assert.equal(selected.title_image_url, logo);
  }
  assert.equal(appearanceLandingLogoSelection(uploaded, logo), uploaded, "a no-op returns the same object");
  // Removing the logo from an image draft returns the type to inherit — no image-without-URL draft remains.
  const removed = appearanceLandingLogoSelection(uploaded, "");
  assert.equal(removed.title_type, "");
  assert.equal(removed.title_image_url, "");
  assert.equal(appearanceLandingCoherent(appearanceLandingWire(removed)), true);
  // Removal has one result even after the operator manually changed the type.
  for (const titleType of ["text", "none"] as const) {
    const reset = appearanceLandingLogoSelection({ ...appearanceLandingDraft({}), title_type: titleType, title_image_url: logo }, "");
    assert.equal(reset.title_type, "", `${titleType} resets to inherit`);
    assert.equal(reset.title_image_url, "");
  }
  // The persistent hint: a draft logo the effective title type will not render (T-468b overrides persist).
  const manualText = appearanceLandingWithTitleType(uploaded, "text");
  const effective = resolveAppearanceLanding([appearanceLandingPreviewDraft(manualText).landing], APPEARANCE_DEFAULT_LANDING, "en");
  assert.equal(effective.titleType, "text");
  assert.equal(appearanceLandingLogoHintVisible(effective.titleImageUrl, effective.titleType), true, "manual text with a logo present shows the hint");
  assert.equal(appearanceLandingLogoHintVisible(effective.titleImageUrl, "none"), true, "every effective non-image type shows the hint");
  assert.equal(appearanceLandingLogoHintVisible(preview.titleImageUrl, preview.titleType), false, "an image title needs no hint");
  const inheritedLogo = resolveAppearanceLanding([
    { title_type: "text" },
    { title_image_url: logo },
  ], APPEARANCE_DEFAULT_LANDING, "en");
  assert.equal(appearanceLandingLogoHintVisible(inheritedLogo.titleImageUrl, inheritedLogo.titleType), true, "an inherited logo also gets the dependency hint");
  assert.equal(appearanceLandingLogoHintVisible("", "text"), false, "no logo, no hint");
});

test("the effective hero list is capped at Core's ten-item output ceiling", () => {
  const base = parseAppearanceRule(wireRule())!;
  const item = base.hero.items[0]!;
  const items = (count: number) => Array.from({ length: count }, (_, index) => ({ ...item, id: `hero-${index}`, sort_order: count - index, active: true }));
  const ten = resolveAppearanceHero([{ mode: "replace", items: items(10) }]);
  assert.equal(ten.length, 10, "ten items pass through");
  const eleven = resolveAppearanceHero([{ mode: "replace", items: items(11) }]);
  assert.equal(eleven.length, 10, "eleven active items are truncated to the first ten after sorting");
  assert.deepEqual(eleven.map((entry) => entry.sort_order), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "the ten lowest sort orders survive");
  const withInactive = resolveAppearanceHero([{ mode: "replace", items: [...items(10), { ...item, id: "hero-off", sort_order: 0, active: false }] }]);
  assert.equal(withInactive.length, 10, "inactive items never take a slot");
  assert.ok(parseAppearanceHero({ mode: "replace", items: items(100) }), "the 100-item storage ceiling stays separate");
  assert.equal(parseAppearanceHero({ mode: "replace", items: items(101) }), null);
});

test("the country catalogue is exactly Core's 249 ISO 3166-1 pairs; the CLDR extras are refused", () => {
  assert.equal(APPEARANCE_COUNTRIES.length, 249);
  assert.equal(new Set(APPEARANCE_COUNTRIES.map((country) => country.alpha3)).size, 249, "alpha-3 codes are unique");
  assert.equal(new Set(APPEARANCE_COUNTRIES.map((country) => country.alpha2)).size, 249, "alpha-2 codes are unique");
  for (const country of APPEARANCE_COUNTRIES) {
    assert.match(country.alpha2, /^[A-Z]{2}$/);
    assert.match(country.alpha3, /^[A-Z]{3}$/);
  }
  for (const [alpha2, alpha3] of [["AC", "ASC"], ["TA", "TAA"]] as const) {
    assert.equal(isAppearanceAlpha2(alpha2), false, `${alpha2} is not an ISO country`);
    assert.equal(isAppearanceStorefront(alpha3), false, `${alpha3} is not an App Store storefront`);
    assert.equal(APPEARANCE_COUNTRIES.some((country) => country.alpha2 === alpha2 || country.alpha3 === alpha3), false);
  }
  for (const [alpha2, alpha3] of [["HU", "HUN"], ["US", "USA"], ["DE", "DEU"], ["SH", "SHN"]] as const) {
    assert.equal(isAppearanceAlpha2(alpha2), true);
    assert.equal(isAppearanceStorefront(alpha3), true);
  }
  assert.equal(localizedAppearanceCountries("hu").length, 249, "localized labels come from the pinned package after the closed set is selected");
});

test("appearance URLs are capped at 2048 UTF-8 bytes and refuse control characters anywhere in the original string", () => {
  const prefix = "https://cdn.friending.co/";
  const multibyte = (bytes: number) => prefix + "é".repeat(Math.floor((bytes - prefix.length) / 2)) + "a".repeat((bytes - prefix.length) % 2);
  const exact = multibyte(2048);
  assert.equal(new TextEncoder().encode(exact).length, 2048);
  assert.ok(exact.length < 2048, "the UTF-16 length is shorter than the byte length");
  assert.equal(isAppearanceHttpsUrl(exact), true, "2048 bytes fit");
  const over = multibyte(2049);
  assert.equal(new TextEncoder().encode(over).length, 2049);
  assert.equal(isAppearanceHttpsUrl(over), false, "2049 bytes are over the cap even though the UTF-16 length is under it");
  assert.ok(parseAppearanceLanding({ background_type: "image", background_url: exact }));
  assert.equal(parseAppearanceLanding({ background_type: "image", background_url: over }), null);
  const heroItem = parseAppearanceRule(wireRule())!.hero.items[0]!;
  assert.ok(parseAppearanceHero({ mode: "replace", items: [{ ...heroItem, media_url: exact }] }));
  assert.equal(parseAppearanceHero({ mode: "replace", items: [{ ...heroItem, media_url: over }] }), null);
  const controlCases: ReadonlyArray<[string, string]> = [
    ["leading", "\u0001https://cdn.friending.co/a.jpg"],
    ["trailing", "https://cdn.friending.co/a.jpg\u0007"],
    ["embedded", "https://cdn.friending.co/a\u001fb.jpg"],
    ["trailing newline", "https://cdn.friending.co/a.jpg\n"],
  ];
  for (const [label, url] of controlCases) {
    assert.equal(isAppearanceHttpsUrl(url), false, `${label} control refused by the draft validator`);
    assert.equal(parseAppearanceLanding({ background_type: "image", background_url: url }), null, `${label} control refused by the landing parser, never repaired by trimming`);
    assert.equal(parseAppearanceLanding({ background_poster_url: url }), null, `${label} control refused on a poster`);
    assert.equal(parseAppearanceHero({ mode: "replace", items: [{ ...heroItem, media_url: url }] }), null, `${label} control refused on a hero URL`);
  }
  assert.ok(isAppearanceHttpsUrl("  https://cdn.friending.co/a.jpg  "), "plain surrounding whitespace is still trimmed");
  assert.equal(isAppearanceHttpsUrl("http://cdn.friending.co/a.jpg"), false, "the editor stays HTTPS-only");
});

test("Core-valid Unicode whitespace survives every canonicalisation point; only PHP's ASCII trim set is stripped", () => {
  const nbsp = "\u00A0";
  const emSpace = "\u2003";
  for (const pad of [nbsp, emSpace]) {
    const name = `${pad}Name${pad}`;
    const title = `${pad}Title${pad}`;
    const stored = parseAppearanceRule(wireRule({ name, landing: { title_type: "text", title_text_en: title, description_en: `${pad}Copy${pad}` } }));
    assert.ok(stored, "parse keeps the padded material");
    assert.equal(stored.name, name);
    assert.equal(stored.landing.title_text_en, title);
    const draft = appearanceRuleDraft(stored);
    assert.equal(draft.name, name);
    assert.equal(draft.landing.title_text_en, title);
    const input = appearanceRuleInputFromDraft(draft);
    assert.ok(input);
    assert.equal(input.name, name, "the save input carries the padding back to Core");
    assert.equal(input.landing.title_text_en, title);
    assert.equal(appearanceRuleMaterialMatches(stored, input), true, "open-and-save is a no-op on Core-valid material");
    const resolved = resolveAppearanceLanding([stored.landing], APPEARANCE_DEFAULT_LANDING, "en");
    assert.equal(resolved.titleText, title, "the local resolver treats the padded text as content, not blank");
    assert.equal(resolved.description, `${pad}Copy${pad}`);
    assert.equal(resolveAppearanceLanding([{ title_text_en: pad }], APPEARANCE_DEFAULT_LANDING, "en").titleText, pad, "a Unicode-space-only field is content for Core, so it is content here");
    const body = normalizeAppearanceProxyBody("appearance_rules_save", { id: stored.id, expected_revision: stored.revision, rule: input });
    assert.ok(body && (body.rule as { name: string }).name === name, "the proxy forwards it untouched");
  }
  // Ordinary ASCII padding is still normalised on the way to Core, as Core itself does.
  assert.equal(appearanceTrim(" \t Name \n\r\0\x0B"), "Name");
  assert.equal(appearanceTrim(`${nbsp}Name${nbsp}`), `${nbsp}Name${nbsp}`);
  const spaced = appearanceRuleInputFromDraft({ ...appearanceRuleDraft(parseAppearanceRule(wireRule())!), name: "  Spaced  " });
  assert.equal(spaced?.name, "Spaced");
  assert.equal(resolveAppearanceLanding([{ title_text_en: "   " }], APPEARANCE_DEFAULT_LANDING, "en").titleText, APPEARANCE_DEFAULT_LANDING.title_text_en, "ASCII-space-only is blank");
  // Strict wire timestamps are never trimmed.
  assert.equal(parseAppearanceRule(wireRule({ updated_at: " 2026-08-29T11:00:00Z" })), null);
  assert.equal(parseAppearanceRule(wireRule({ starts_at: "2026-06-01T00:00:00Z " })), null);
});

test("the URL syntax gate never lets the WHATWG parser repair what Core rejects, and keeps Core-accepted raw forms", () => {
  const heroItem = parseAppearanceRule(wireRule())!.hero.items[0]!;
  const accepted = ["https://example.com\\path", "https://user:pass@example.com/path", "https://cdn.friending.co/a.jpg"];
  const refused = ["https:\\\\example.com\\path", "https:example.com", "https:///example.com", "https://example.com:99999/path", "http://example.com/path", "HTTPS://example.com/path", "https://", "https:// example.com"];
  for (const url of accepted) {
    assert.equal(isAppearanceHttpsUrl(url), true, `draft accepts ${url}`);
    assert.equal(parseAppearanceLanding({ background_type: "image", background_url: url })?.background_url, url, `landing keeps the raw value ${url}`);
    assert.equal(parseAppearanceHero({ mode: "replace", items: [{ ...heroItem, media_url: url }] })?.items[0]?.media_url, url, `hero keeps the raw value ${url}`);
  }
  for (const url of refused) {
    assert.equal(isAppearanceHttpsUrl(url), false, `draft refuses ${url}`);
    assert.equal(parseAppearanceLanding({ background_type: "image", background_url: url }), null, `landing refuses ${url}`);
    assert.equal(parseAppearanceHero({ mode: "replace", items: [{ ...heroItem, media_url: url }] }), null, `hero refuses ${url}`);
  }
  assert.equal(parseAppearancePreviewPayload(previewPayload({ landing: { ...(previewPayload().landing as object), background: { type: "image", url: "https:///example.com", poster_url: "" } } })), null, "the response reader shares the gate");
});

test("uncertain updates reconcile by revision: convergence adopts, an unchanged revision proves no-land, a newer row is never a rebase", () => {
  const stored = parseAppearanceRule(geoRule())!;
  const input = appearanceRuleInputOf(stored);
  const other = { ...input, name: "Someone else's edit" };
  const attempted = { id: stored.id, expected_revision: stored.revision, input: { ...input, name: "My edit" } };
  const row = (patch: Record<string, unknown>) => parseAppearanceRule(geoRule(patch))!;
  assert.deepEqual(reconcileAppearanceUpdate(attempted, null), { outcome: "missing", retry: false, adopt: null });
  const unchanged = row({ revision: stored.revision });
  assert.deepEqual(reconcileAppearanceUpdate(attempted, unchanged), { outcome: "not-landed", retry: true, adopt: null }, "same revision, other material: proof that nothing was written");
  const mineAtSuccessor = row({ revision: stored.revision + 1, name: "My edit" });
  assert.deepEqual(reconcileAppearanceUpdate(attempted, mineAtSuccessor), { outcome: "landed", retry: false, adopt: mineAtSuccessor }, "matching successor: landed");
  const theirsAtSuccessor = row({ revision: stored.revision + 1, name: other.name });
  assert.deepEqual(reconcileAppearanceUpdate(attempted, theirsAtSuccessor), { outcome: "conflict", retry: false, adopt: theirsAtSuccessor }, "different successor: conflict, never a rebase");
  const mineLater = row({ revision: stored.revision + 3, name: "My edit" });
  assert.deepEqual(reconcileAppearanceUpdate(attempted, mineLater), { outcome: "landed", retry: false, adopt: mineLater }, "matching later revision: converged");
  const theirsLater = row({ revision: stored.revision + 2, name: other.name });
  assert.deepEqual(reconcileAppearanceUpdate(attempted, theirsLater), { outcome: "superseded", retry: false, adopt: theirsLater }, "different later revision: ambiguous supersession, never retried");
  for (const decision of [reconcileAppearanceUpdate(attempted, theirsAtSuccessor), reconcileAppearanceUpdate(attempted, theirsLater)]) {
    assert.equal(decision.retry, false);
    assert.notEqual(decision.adopt?.revision, attempted.expected_revision, "the authoritative revision is adopted, never stamped onto the stale draft");
  }
  // Component-level: the console routes every uncertain update through the helper, carries the attempted
  // revision in the pending identity and never stamps a newer revision onto the stale draft.
  const consoleSource = readFileSync(new URL("../components/AppearanceConsole.tsx", import.meta.url), "utf8");
  assert.match(consoleSource, /kind: "update"; id: string; expected_revision: number; input: AppearanceRuleInput/);
  assert.match(consoleSource, /reconcileAppearanceUpdate\(pending, /);
  assert.doesNotMatch(consoleSource, /revision: current\.revision/);
  assert.match(consoleSource, /case "conflict":\s*\n\s*case "superseded":\s*\n[\s\S]*?setDraft\(null\)/, "a newer mismatching row closes the stale draft instead of enabling its save");
});

test("landing strings are refused for controls on the ORIGINAL value — parser, proxy and draft alike — while ASCII spaces still canonicalise", () => {
  const stored = parseAppearanceRule(geoRule())!;
  const input = appearanceRuleInputOf(stored);
  const cases: ReadonlyArray<[string, Record<string, string>]> = [
    ["trailing newline on a title", { title_type: "text", title_text_en: "Hello\n" }],
    ["carriage return on the background type", { background_type: "image\r", background_url: "https://cdn.friending.co/a.jpg" }],
    ["tab on the title type", { title_type: "text\t" }],
    ["vertical tab on a description", { description_hu: "Body\u000B" }],
  ];
  for (const [label, landing] of cases) {
    assert.equal(parseAppearanceLanding(landing), null, `parser refuses ${label}`);
    assert.equal(parseAppearanceRuleInput({ ...input, landing }), null, `rule input refuses ${label}`);
    assert.equal(normalizeAppearanceProxyBody("appearance_rules_save", { id: stored.id, expected_revision: stored.revision, rule: { ...input, landing } }), null, `proxy refuses ${label}`);
    const draft = appearanceRuleDraft(stored);
    draft.landing = { ...draft.landing, ...landing };
    assert.equal(validateAppearanceRuleDraft(draft), "landingControl", `draft validation refuses ${label} before the wire could trim it`);
    assert.equal(appearanceRuleInputFromDraft(draft), null);
  }
  // ASCII-space control: ordinary padding is canonicalised, never refused.
  const padded = appearanceRuleDraft(stored);
  padded.landing = { ...padded.landing, title_type: "text", title_text_en: "  Hello  " };
  assert.equal(validateAppearanceRuleDraft(padded), null);
  assert.equal(appearanceRuleInputFromDraft(padded)?.landing.title_text_en, "Hello");
  assert.deepEqual(parseAppearanceLanding({ title_text_en: "  Hello  " }), { title_text_en: "Hello" });
  assert.equal(parseAppearanceRule(wireRule({ name: "Name\n" })), null, "the same rule holds for the rule name");
});

test("Core-bound strings must be well-formed UTF-16: unpaired surrogates are refused everywhere, valid non-BMP pairs pass", () => {
  const high = "\uD800";
  const low = "\uDC00";
  const pair = "\uD83D\uDE42"; // one emoji, two code units, four UTF-8 bytes
  assert.equal(wellFormedUtf16(pair), true);
  assert.equal(wellFormedUtf16(high), false);
  assert.equal(wellFormedUtf16(low), false);
  assert.equal(wellFormedUtf16(`a${high}b`), false);
  assert.equal(wellFormedUtf16(`${low}${high}`), false, "a reversed pair is two lone surrogates");
  assert.equal(new TextEncoder().encode(pair).length, 4, "the byte count control counts the real pair");
  const stored = parseAppearanceRule(geoRule())!;
  const input = appearanceRuleInputOf(stored);
  for (const bad of [high, low]) {
    assert.equal(parseAppearanceRule(geoRule({ name: `Name${bad}` })), null, "stored name");
    assert.equal(parseAppearanceRule(geoRule({ updated_by: `lead${bad}@friending.com` })), null, "stored actor");
    assert.equal(parseAppearanceRule(geoRule({ place_label: `Budapest${bad}` })), null, "stored place label");
    assert.equal(parseAppearanceLanding({ description_en: `Body${bad}` }), null, "landing description");
    assert.equal(parseAppearanceLanding({ background_type: "image", background_url: `https://cdn.friending.co/${bad}.jpg` }), null, "landing URL");
    assert.equal(isAppearanceHttpsUrl(`https://cdn.friending.co/${bad}.jpg`), false, "draft URL validator");
    assert.equal(parseAppearanceRuleInput({ ...input, name: `Name${bad}` }), null, "rule input name");
    assert.equal(normalizeAppearanceProxyBody("appearance_rules_save", { id: stored.id, expected_revision: stored.revision, rule: { ...input, name: `Name${bad}` } }), null, "proxy");
    const heroItem = parseAppearanceRule(wireRule())!.hero.items[0]!;
    assert.equal(parseAppearanceHero({ mode: "replace", items: [{ ...heroItem, title_en: `Pride${bad}` }] }), null, "hero copy");
    assert.equal(parseAppearanceHero({ mode: "replace", items: [{ ...heroItem, id: `hero${bad}` }] }), null, "hero id");
    assert.equal(parseAppearanceGeocodePayload({ candidates: [{ place_id: `place${bad}`, place_label: "Budapest, Hungary", country_code: "HU", center: { latitude: 47.5, longitude: 19.04 }, radius_km: 23 }] }), null, "geocode string");
    const draft = appearanceRuleDraft(stored);
    draft.name = `Name${bad}`;
    assert.equal(validateAppearanceRuleDraft(draft), "name", "draft name");
    const landingDraft = appearanceRuleDraft(stored);
    landingDraft.landing = { ...landingDraft.landing, description_en: `Body${bad}` };
    assert.equal(validateAppearanceRuleDraft(landingDraft), "landingControl", "draft landing");
    assert.equal(appearanceRuleInputFromDraft(landingDraft), null);
  }
  assert.ok(parseAppearanceRule(geoRule({ name: `Pride ${pair}` })), "a valid pair in a name");
  assert.deepEqual(parseAppearanceLanding({ description_en: `Body ${pair}` }), { description_en: `Body ${pair}` });
  assert.equal(isAppearanceHttpsUrl(`https://cdn.friending.co/${pair}.jpg`), true);
  const draft = appearanceRuleDraft(stored);
  draft.name = `Pride ${pair}`;
  assert.equal(validateAppearanceRuleDraft(draft), null);
  assert.equal(appearanceRuleInputFromDraft(draft)?.name, `Pride ${pair}`);
});

test("an uncertain create is proven only by a NEW row: a pre-existing material-equal rule is never evidence", () => {
  const existing = parseAppearanceRule(geoRule())!;
  const input = appearanceRuleInputOf(existing);
  const baseline = [existing.id, "66d0a1b2c3d4e5f6a7b8c9d0"];
  const attempted = { input, baseline_ids: baseline };
  assert.deepEqual(reconcileAppearanceCreate(attempted, [existing]), { outcome: "not-landed", adopt: null }, "old match only: never recovered");
  const fresh = parseAppearanceRule(geoRule({ id: "66d0a1b2c3d4e5f6a7b8c9ef", revision: 1 }))!;
  assert.deepEqual(reconcileAppearanceCreate(attempted, [existing, fresh]), { outcome: "landed", adopt: fresh }, "old + new: the new identity is adopted");
  assert.deepEqual(reconcileAppearanceCreate(attempted, [fresh]), { outcome: "landed", adopt: fresh }, "new match only");
  assert.deepEqual(reconcileAppearanceCreate(attempted, []), { outcome: "not-landed", adopt: null }, "no match");
  const other = parseAppearanceRule(geoRule({ id: "66d0a1b2c3d4e5f6a7b8c9ee", revision: 1, name: "Different" }))!;
  assert.deepEqual(reconcileAppearanceCreate(attempted, [existing, other]), { outcome: "not-landed", adopt: null }, "a new row with other material is not this create");
  // The minted-empty-hero-id exception stays bound to the newly observed identity.
  const heroStored = parseAppearanceRule(wireRule())!;
  const heroInput = appearanceRuleInputOf(heroStored);
  const withoutIds = { ...heroInput, hero: { mode: "replace" as const, items: heroInput.hero.items.map((item) => ({ ...item, id: "" })) } };
  assert.equal(reconcileAppearanceCreate({ input: withoutIds, baseline_ids: [heroStored.id] }, [heroStored]).outcome, "not-landed", "a pre-existing row with minted ids is still old");
  const minted = parseAppearanceRule(wireRule({ id: "66d0a1b2c3d4e5f6a7b8c9e5", revision: 1 }))!;
  assert.equal(reconcileAppearanceCreate({ input: withoutIds, baseline_ids: [heroStored.id] }, [heroStored, minted]).adopt?.id, minted.id);
  // Component-level: the pending create carries the baseline ids captured at request time and the console reconciles through the helper.
  const consoleSource = readFileSync(new URL("../components/AppearanceConsole.tsx", import.meta.url), "utf8");
  assert.match(consoleSource, /kind: "create"; baseline_ids: string\[\]; input: AppearanceRuleInput/);
  assert.match(consoleSource, /kind: "create", baseline_ids: rules\.map\(\(rule\) => rule\.id\), input/);
  assert.match(consoleSource, /reconcileAppearanceCreate\(pending, fresh\.rules\)/);
  assert.doesNotMatch(consoleSource, /fresh\.rules\.find\(\(rule\) => appearanceRuleMaterialMatches\(rule, pending\.input\)\)/, "material alone never closes the draft");
});

test("the four component pre-normalisation paths use the PHP-compatible trim, so Unicode padding reaches the strict boundary", () => {
  const nbsp = "\u00A0";
  // Geocode query: preserved by the trim helper and forwarded by the proxy exactly as typed.
  const paddedQuery = `${nbsp}Budapest${nbsp}`;
  assert.equal(appearanceTrim(paddedQuery), paddedQuery);
  assert.deepEqual(normalizeAppearanceProxyBody("appearance_city_geocode", { query: paddedQuery }), { query: paddedQuery });
  assert.deepEqual(normalizeAppearanceProxyBody("appearance_city_geocode", { query: "  Budapest  " }), { query: "Budapest" }, "ASCII padding still canonicalises");
  // Preview IP: a padded IP is refused at the proxy boundary — the component must not strip the evidence first.
  const paddedIp = `${nbsp}203.0.113.7${nbsp}`;
  assert.equal(appearanceTrim(paddedIp), paddedIp);
  assert.equal(normalizeAppearanceProxyBody("appearance_rules_preview", { ip: paddedIp }), null);
  assert.deepEqual(normalizeAppearanceProxyBody("appearance_rules_preview", { ip: " 203.0.113.7 " }), { ip: "203.0.113.7" });
  // Palette colour: a padded value is refused by the strict normaliser once the component stops pre-stripping it.
  const paddedHex = `${nbsp}#aabbcc${nbsp}`;
  assert.equal(normalizeAppearancePaletteHex(appearanceTrim(paddedHex)), null);
  assert.equal(normalizeAppearancePaletteHex(appearanceTrim(" #aabbcc ")), "#AABBCC");
  // Hero colour: the draft keeps the padded value and the hero parser refuses it; ASCII padding canonicalises.
  const item = parseAppearanceRule(wireRule())!.hero.items[0]!;
  const paddedColour = appearanceTrim(`${nbsp}#aabbcc${nbsp}`).toLowerCase();
  assert.equal(paddedColour, `${nbsp}#aabbcc${nbsp}`);
  assert.equal(parseAppearanceHero({ mode: "replace", items: [{ ...item, title_color_web: paddedColour }] }), null);
  assert.equal(parseAppearanceHero({ mode: "replace", items: [{ ...item, title_color_web: appearanceTrim(" #AABBCC ").toLowerCase() }] })?.items[0]?.title_color_web, "#aabbcc");
  // Source assertions: the four Core-bound paths no longer call JavaScript trim; display-only coordinate checks stay out of scope.
  const read = (file: string) => readFileSync(new URL(`../components/${file}`, import.meta.url), "utf8");
  const picker = read("AppearanceMapPicker.tsx");
  assert.match(picker, /const trimmed = appearanceTrim\(query\);/);
  assert.doesNotMatch(picker, /query\.trim\(\)/);
  const preview = read("AppearanceTestPreview.tsx");
  assert.match(preview, /const ipValue = appearanceTrim\(ip\);/);
  assert.doesNotMatch(preview, /ip\.trim\(\)/);
  const palette = read("AppearancePaletteEditor.tsx");
  assert.match(palette, /const raw = appearanceTrim\(event\.target\.value\);/);
  assert.doesNotMatch(palette, /value\.trim\(\)/);
  const hero = read("AppearanceHeroEditor.tsx");
  assert.match(hero, /appearanceTrim\(event\.target\.value\)\.toLowerCase\(\)/);
  assert.doesNotMatch(hero, /\.trim\(\)/);
});

test("the landing composer wires every closed field, parent-only v2 previews, PNG preflight and the exact phone frame", () => {
  const composer = readFileSync(new URL("../components/AppearanceLandingComposer.tsx", import.meta.url), "utf8");
  const preview = readFileSync(new URL("../components/AppearanceLandingPreview.tsx", import.meta.url), "utf8");
  const testPreview = readFileSync(new URL("../components/AppearanceTestPreview.tsx", import.meta.url), "utf8");
  const uploader = readFileSync(new URL("../components/ImageUploadField.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const key of APPEARANCE_LANDING_KEYS) assert.ok(composer.includes(key), key);
  for (const key of APPEARANCE_LANDING_PREVIEW_STYLE_KEYS) {
    assert.ok(composer.includes(`previewError("${key}")`), `${key} needs its own preview validation error`);
  }
  assert.match(composer, /appearance_schema:\s*2/);
  assert.match(composer, /exclude_rule_id/);
  assert.match(composer, /location_mode:\s*"none"/);
  assert.match(composer, /testStorefront/);
  assert.match(composer, /lang:\s*"en"/);
  assert.doesNotMatch(composer, /lang:\s*"hu"/, "Amendment v1.4 needs one pre-fallback parent read per target");
  assert.match(composer, /decoded\.value\.landing_flat/);
  assert.match(composer, /decoded\.value\.landing_flat_sources/);
  assert.match(composer, /decoded\.value\.landing_flat_defaults/);
  assert.match(composer, /parentPreview\.value\.landing_flat_defaults/);
  assert.match(composer, /source\.scope/);
  assert.match(composer, /title_text_hu:\s*contentByLanguage\.hu\.titleText/);
  assert.match(composer, /draftWire\[englishFallback\]/, "a local English draft fallback never receives invented Core provenance");
  assert.match(composer, /appearanceLandingPreviewDraft\(rule\.landing\)/, "draft styles are validated before the local merge");
  assert.match(composer, /invalidPreviewValue/, "invalid style fields receive an inline error");
  assert.match(composer, /appearanceLandingBackgroundSelection\(rule\.landing, value\)/, "background type is only staged until an upload completes the pair");
  assert.match(composer, /appearanceLandingLogoSelection\(rule\.landing, url\)/, "a landed logo upload and a removal adjust the draft title type in the same patch (T-492)");
  assert.match(composer, /appearanceLandingLogoHintVisible\(content\.titleImageUrl, content\.titleType\)/, "the logo-visibility hint keys off the resolved URL and effective title type");
  assert.ok(composer.includes('t("title.logoTypeHint")'), "the hint copy is localized");
  assert.match(composer, /patch\("description_hidden", value\)/, "the three-state subtitle control writes only the new flat field");
  assert.match(composer, /appearanceLandingLayoutPairSelection\(rule\.landing, effective, pair, member, value\)/, "layout pair edits are atomic");
  assert.ok(composer.includes('previewError("description_hidden")'));
  assert.ok(composer.includes('previewError("text_gap_value")'));
  assert.ok(composer.includes('previewError("footer_min_height_value")'));
  assert.match(composer, /effectiveValueApproximate/, "non-authoritative inherited placeholders are labelled");
  assert.match(composer, /parentState\.kind !== "ready" \|\| comparison\.kind === "loading"/, "Core comparison waits for an authoritative parent read");
  assert.match(composer, /\[targetKey, rule\.id, parentReload\]/);
  assert.match(composer, /compareAppearanceLandingWithPreview/);
  assert.match(testPreview, /appearance_schema:\s*2/);
  assert.match(testPreview, /landing\.schema !== 2/);
  assert.match(testPreview, /landing_flat === null/);
  assert.match(testPreview, /landing_flat_defaults === null/);
  assert.match(uploader, /pngOnly \? file\.type !== "image\/png"/);
  assert.match(uploader, /MAX_LANDING_LOGO_INPUT_BYTES/);
  assert.match(uploader, /invalidPngType/);
  assert.match(uploader, /logoTooLarge/);
  assert.match(preview, /fields\.qr_enabled === "true"/);
  assert.match(preview, /!content\.descriptionHidden && content\.description !== ""/, "hidden subtitle removes the text and backdrop element together");
  assert.match(preview, /marginBottom: `\$\{layout\.textGap\}px`/, "the text block ends at the configured gap above actions");
  assert.match(preview, /minHeight: `\$\{layout\.footerMinHeight\}px`/, "the footer grows to at least the configured height");
  assert.match(preview, /appearance-landing-composition-footer-copy[\s\S]*<FooterText/, "tagged footer text remains one layout child");
  assert.match(preview, /top: `\$\{50 \+ number\(fields\.title_image_offset_percent, -10\)\}%`/, "the image logo keeps its independent centre-offset placement");
  assert.match(preview, /appearanceLandingPreviewDraft\(content\.effective\)/, "the inline-style render boundary validates defensively too");
  assert.match(css, /\.appearance-landing-apple-button\.is-white_outline/);
  assert.match(preview, //);
  assert.match(css, /\.appearance-landing-composition-phone\s*\{[^}]*width:\s*390px;[^}]*height:\s*844px;/s);
  assert.match(css, /appearance-landing-safe-area-top/);
  assert.match(css, /\.appearance-landing-composition-content\s*\{[^}]*inset:\s*108px 0 0;[^}]*justify-content:\s*flex-end;/s, "the content/footer stack is bottom anchored");
  assert.match(css, /\.appearance-landing-composition-footer\s*\{[^}]*padding:\s*14px 24px 38px;/s, "footer text clears the bottom safe area while its background reaches the edge");
  // Byte pins copied from the read-only iOS bundle at bd9ea0d.
  const fontPins = {
    "ProximaNova-Light.otf": "0f77660e06a5f61a45c4dbdab511722357cf29e7f5ba1b2cf097550afdb0ed20",
    "ProximaNova-Medium.otf": "cfdedf92a4ab9532861ee2fd415824f86bed7ce47cb80b763c2487a2cd09eba0",
    "ProximaNova-Extrabold.otf": "792e4c168c69ba6b3ef762f0244a951d32641f2c49bf5a480906eab92555f8e0",
    "ProximaNova-Black.otf": "4f7fa48c8dae49f947bd0f9e7bc4a9e9ba6b9384511414fc8dd07aed93f113b0",
    "ProximaNovaCond-Light.otf": "e359124f197ecb566c676e553d883e1060c31690f45664cd339cf21292bb03d1",
    "ProximaNovaCond-Regular.otf": "6dc01117ee71847aef8fb9f4e33bc37bb30325694dbae886ebf8c3b37bfa694a",
    "ProximaNovaCond-Medium.otf": "60bb68b2ac8c5758e153ce4b2a75fde7bbf62c1244202c7399b9ff57582c869c",
    "ProximaNovaCond-Semibold.otf": "8ea7075762c251265449265282459721b09b1641c09e1766a571f86bb08b55df",
  } as const;
  for (const [font, expected] of Object.entries(fontPins)) {
    const asset = new URL(`../public/fonts/${font}`, import.meta.url);
    assert.ok(statSync(asset).size > 0, font);
    assert.equal(createHash("sha256").update(readFileSync(asset)).digest("hex"), expected, font);
  }
});

test("the retired active-hero overview card is gone from the dashboard", () => {
  // D-060 removed the switch that used to show it. The count Core still keeps
  // for the legacy people_hero rows is stale by construction after the D-052
  // cutover, so nothing may render it until a replacement has its own contract.
  const page = readFileSync(new URL("../app/(dashboard)/page.tsx", import.meta.url), "utf8");
  // Core still sends the field, so the response type keeps it; what must be
  // gone is any rendering of it.
  assert.doesNotMatch(page, /data\.active_heroes/, "the stale legacy metric is never read for display");
  assert.doesNotMatch(page, /activeHeroes/, "its overview card and label are gone");
  assert.doesNotMatch(page, /legacyHeroOverviewCardVisible/, "the retired helper is gone with its switch");
});
