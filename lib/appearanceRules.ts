import { getCountryDataList } from "countries-list";
import { adminBridgeErrorEnvelope } from "@/lib/adminBridge";
import { webadminDataSuccessEnvelope, webadminEnvelope, webadminErrorEnvelope } from "@/lib/webadminEnvelope";

/**
 * Appearance & placement rules (D-052, `handoffs/appearance-rules-contract.md`
 * v1 + Amendments v1.1/v1.2).
 *
 * This module is deliberately free of `server-only`: the same strict parsers
 * classify Core's responses in the browser and normalize the browser's bodies
 * on the proxy, and the tests import it under plain Node. Nothing here holds a
 * credential or an environment fallback; Core remains the authority for
 * resolution, revisions, persistence and audit.
 */

export const APPEARANCE_ACTIONS = [
  "appearance_rules_list",
  "appearance_rules_save",
  "appearance_rules_delete",
  "appearance_rules_preview",
  "appearance_city_geocode",
] as const;
export type AppearanceAction = (typeof APPEARANCE_ACTIONS)[number];

export const APPEARANCE_SCOPES = ["global", "storefront", "geo"] as const;
export type AppearanceScope = (typeof APPEARANCE_SCOPES)[number];

/** Resolution vocabulary (Amendment v1.2): `default` = the compiled defaults. */
export const APPEARANCE_MATCHED_SCOPES = ["geo", "storefront", "global", "default"] as const;
export type AppearanceMatchedScope = (typeof APPEARANCE_MATCHED_SCOPES)[number];

export const APPEARANCE_LOCATION_SOURCES = ["gps", "ip", "none"] as const;
export type AppearanceLocationSource = (typeof APPEARANCE_LOCATION_SOURCES)[number];

export const APPEARANCE_PALETTE_ROLES = [
  "accent",
  "accent_pressed",
  "accent_faint_bg",
  "on_accent",
  "inactive",
] as const;
export type AppearancePaletteRole = (typeof APPEARANCE_PALETTE_ROLES)[number];

export const APPEARANCE_PALETTE_MODES = ["light", "dark"] as const;
export type AppearancePaletteMode = (typeof APPEARANCE_PALETTE_MODES)[number];

/** A rule sets any subset of roles per mode; an absent role inherits. */
export type AppearancePaletteValues = Partial<Record<AppearancePaletteRole, string>>;
export type AppearancePalette = Record<AppearancePaletteMode, AppearancePaletteValues>;
export type AppearanceFullPaletteValues = Record<AppearancePaletteRole, string>;
export type AppearanceFullPalette = Record<AppearancePaletteMode, AppearanceFullPaletteValues>;

/** Contract §1 — the compiled app default (light and dark differ). */
export const APPEARANCE_DEFAULT_PALETTE: AppearanceFullPalette = {
  light: {
    accent: "#007F91",
    accent_pressed: "#006776",
    accent_faint_bg: "#DDFBFC",
    on_accent: "#FFFFFF",
    inactive: "#6B7478",
  },
  dark: {
    accent: "#75F0F4",
    accent_pressed: "#8DFDFF",
    accent_faint_bg: "#12373B",
    on_accent: "#071516",
    inactive: "#8A9497",
  },
};

/** The D-052/v1 landing keys. Kept as an explicit compatibility witness. */
export const APPEARANCE_LANDING_V1_KEYS = [
  "background_type",
  "background_url",
  "background_poster_url",
  "title_type",
  "title_text_en",
  "title_text_hu",
  "title_image_url",
  "description_en",
  "description_hu",
] as const;

/** D-061 contract §2: adding a value requires coordinated Core and app releases. */
export const APPEARANCE_LANDING_FONTS = [
  "proxima_light",
  "proxima_regular",
  "proxima_medium",
  "proxima_semibold",
  "proxima_bold",
  "proxima_extrabold",
  "proxima_black",
  "proxima_cond_light",
  "proxima_cond_regular",
  "proxima_cond_medium",
  "proxima_cond_semibold",
  "system_regular",
  "system_semibold",
  "system_bold",
] as const;
export type AppearanceLandingFont = (typeof APPEARANCE_LANDING_FONTS)[number];

export const APPEARANCE_LANDING_ALIGNS = ["left", "center", "right"] as const;
export type AppearanceLandingAlign = (typeof APPEARANCE_LANDING_ALIGNS)[number];

export const APPEARANCE_LANDING_APPLE_STYLES = ["white", "white_outline", "black"] as const;
export type AppearanceLandingAppleStyle = (typeof APPEARANCE_LANDING_APPLE_STYLES)[number];

/** D-061c / contract v1.7: closed units for vertical landing layout measurements. */
export const APPEARANCE_LANDING_LAYOUT_UNITS = ["pt", "percent"] as const;
export type AppearanceLandingLayoutUnit = (typeof APPEARANCE_LANDING_LAYOUT_UNITS)[number];

/** The contract's fixed phone-frame height; percentage layout values use this axis. */
export const APPEARANCE_LANDING_PREVIEW_HEIGHT = 844;

/**
 * D-061 contract §1. The list is closed on both the stored-rule and browser
 * boundaries; every value remains a string and an empty editor value means
 * inherit.
 */
export const APPEARANCE_LANDING_KEYS = [
  ...APPEARANCE_LANDING_V1_KEYS,
  "overlay_color",
  "overlay_alpha",
  "title_font",
  "title_size",
  "title_color",
  "title_align",
  "title_image_width_percent",
  "title_image_offset_percent",
  "description_font",
  "description_size",
  "description_color",
  "description_align",
  "description_backdrop_color",
  "description_backdrop_alpha",
  "button_corner_radius",
  "button_phone_label_en",
  "button_phone_label_hu",
  "button_phone_bg",
  "button_phone_text_color",
  "button_phone_font",
  "button_phone_size",
  "button_email_label_en",
  "button_email_label_hu",
  "button_email_bg",
  "button_email_text_color",
  "button_email_font",
  "button_email_size",
  "button_apple_style",
  "footer_text_en",
  "footer_text_hu",
  "footer_bg_color",
  "footer_bg_alpha",
  "footer_text_color",
  "footer_font",
  "footer_size",
  "qr_enabled",
  "qr_bg_color",
  "qr_icon_color",
  // Amendments v1.6/v1.7 append their five flat keys to Core's closed
  // LANDING_KEYS order. Preserve that provider order for flat wire parity.
  "description_hidden",
  "text_gap_value",
  "text_gap_unit",
  "footer_min_height_value",
  "footer_min_height_unit",
] as const;
export type AppearanceLandingKey = (typeof APPEARANCE_LANDING_KEYS)[number];
/** Wire form: only the keys a rule sets are present; an absent key inherits. */
export type AppearanceLanding = Partial<Record<AppearanceLandingKey, string>>;
/**
 * Editor form: every key present, blank = inherit (Amendment v1.5: per field).
 * `title_type` may also be `""` (inherited); `background_type` is only sent
 * together with a `background_url`, so it needs no inherited state of its own.
 */
export type AppearanceLandingDraft = Record<AppearanceLandingKey, string>;

const LANDING_LIMITS: Record<AppearanceLandingKey, number> = {
  background_type: 16,
  background_url: 2048,
  background_poster_url: 2048,
  title_type: 16,
  title_text_en: 80,
  title_text_hu: 80,
  title_image_url: 2048,
  description_en: 300,
  description_hu: 300,
  overlay_color: 7,
  overlay_alpha: 4,
  title_font: 24,
  title_size: 2,
  title_color: 7,
  title_align: 6,
  title_image_width_percent: 3,
  title_image_offset_percent: 3,
  description_font: 24,
  description_size: 2,
  description_color: 7,
  description_align: 6,
  description_backdrop_color: 7,
  description_backdrop_alpha: 4,
  description_hidden: 5,
  button_corner_radius: 2,
  button_phone_label_en: 40,
  button_phone_label_hu: 40,
  button_phone_bg: 7,
  button_phone_text_color: 7,
  button_phone_font: 24,
  button_phone_size: 2,
  button_email_label_en: 40,
  button_email_label_hu: 40,
  button_email_bg: 7,
  button_email_text_color: 7,
  button_email_font: 24,
  button_email_size: 2,
  button_apple_style: 13,
  footer_text_en: 300,
  footer_text_hu: 300,
  footer_bg_color: 7,
  footer_bg_alpha: 4,
  footer_text_color: 7,
  footer_font: 24,
  footer_size: 2,
  text_gap_value: 3,
  text_gap_unit: 7,
  footer_min_height_value: 3,
  footer_min_height_unit: 7,
  qr_enabled: 5,
  qr_bg_color: 7,
  qr_icon_color: 7,
};

/** Core's compiled landing default (`AppearancePolicy::defaultLanding`), flattened. */
export const APPEARANCE_DEFAULT_LANDING: AppearanceLandingDraft = {
  background_type: "image",
  background_url: "",
  background_poster_url: "",
  title_type: "text",
  title_text_en: "friending.",
  title_text_hu: "friending.",
  title_image_url: "",
  description_en: "Meet people near you — and wherever you're headed next.",
  description_hu: "Ismerj meg embereket a közeledben — és bárhol, ahová tartasz.",
  overlay_color: "#000000",
  overlay_alpha: "0.35",
  title_font: "proxima_bold",
  title_size: "44",
  title_color: "#FFFFFF",
  title_align: "left",
  title_image_width_percent: "60",
  title_image_offset_percent: "-10",
  description_font: "proxima_regular",
  description_size: "17",
  description_color: "#F2F4F7",
  description_align: "left",
  description_backdrop_color: "#000000",
  description_backdrop_alpha: "0.00",
  button_corner_radius: "28",
  button_phone_label_en: "Continue with phone number",
  button_phone_label_hu: "Folytatás telefonszámmal",
  button_phone_bg: "#FFFFFF",
  button_phone_text_color: "#0B0E12",
  button_phone_font: "proxima_semibold",
  button_phone_size: "17",
  button_email_label_en: "Continue with e-mail",
  button_email_label_hu: "Folytatás e-mailben",
  button_email_bg: "#FFFFFF",
  button_email_text_color: "#0B0E12",
  button_email_font: "proxima_semibold",
  button_email_size: "17",
  button_apple_style: "white",
  footer_text_en: "By continuing you accept our <terms>Terms</terms> and <privacy>Privacy Policy</privacy>.",
  footer_text_hu: "A folytatással elfogadod a <terms>Felhasználási feltételeket</terms> és az <privacy>Adatvédelmi nyilatkozatot</privacy>.",
  footer_bg_color: "#000000",
  footer_bg_alpha: "0.55",
  footer_text_color: "#E4E8ED",
  footer_font: "proxima_regular",
  footer_size: "12",
  // Core replaces this compiled value with the legacy `allowProductQR`
  // setting when it publishes defaults/effective v2 material.
  qr_enabled: "true",
  qr_bg_color: "#000000",
  qr_icon_color: "#FFFFFF",
  description_hidden: "false",
  text_gap_value: "24",
  text_gap_unit: "pt",
  footer_min_height_value: "0",
  footer_min_height_unit: "pt",
};

/**
 * Released Core migration markers (T-467b finding 9): a rule migrated from a
 * legacy country row, or an inactive legacy global landing reactivated by the
 * migration to keep an active hero. Any other value is malformed.
 */
export const APPEARANCE_MIGRATION_MARKERS = ["country", "inactive_global_landing"] as const;
export type AppearanceMigrationMarker = (typeof APPEARANCE_MIGRATION_MARKERS)[number];
/** Core's stored actor bound (T-467b finding 23): non-empty after trim, at most 320 raw code points. */
export const MAX_APPEARANCE_ACTOR_LENGTH = 320;

export const APPEARANCE_HERO_MODES = ["inherit", "replace"] as const;
export type AppearanceHeroMode = (typeof APPEARANCE_HERO_MODES)[number];
export const APPEARANCE_HERO_TEXT_WEIGHTS = ["", "normal", "semibold", "bold"] as const;
export const MAX_APPEARANCE_HERO_ITEMS = 100;

export type AppearanceHeroPlatform = "web" | "mobile";
export type AppearanceHeroText = "title" | "subtitle";

export type AppearanceHeroItem = {
  id: string;
  media_url: string;
  type: "image" | "video";
  forward_url: string;
  title_en: string;
  title_hu: string;
  subtitle_en: string;
  subtitle_hu: string;
  link_title_en: string;
  link_title_hu: string;
  title_size_web: number | null;
  title_color_web: string;
  title_weight_web: string;
  subtitle_size_web: number | null;
  subtitle_color_web: string;
  subtitle_weight_web: string;
  title_size_mobile: number | null;
  title_color_mobile: string;
  title_weight_mobile: string;
  subtitle_size_mobile: number | null;
  subtitle_color_mobile: string;
  subtitle_weight_mobile: string;
  sort_order: number;
  active: boolean;
};

const HERO_ITEM_KEYS = [
  "id", "media_url", "type", "forward_url",
  "title_en", "title_hu", "subtitle_en", "subtitle_hu",
  "link_title_en", "link_title_hu",
  "title_size_web", "title_color_web", "title_weight_web",
  "subtitle_size_web", "subtitle_color_web", "subtitle_weight_web",
  "title_size_mobile", "title_color_mobile", "title_weight_mobile",
  "subtitle_size_mobile", "subtitle_color_mobile", "subtitle_weight_mobile",
  "sort_order", "active",
] as const;

export type AppearanceHero = {
  mode: AppearanceHeroMode;
  items: AppearanceHeroItem[];
};

export type AppearanceCenter = { latitude: number; longitude: number };

/** One rule exactly as Core projects it (`AppearanceRuleService::wire()`). */
export type AppearanceRule = {
  id: string;
  name: string;
  scope: AppearanceScope;
  storefront_country: string;
  country_code: string;
  center: AppearanceCenter | null;
  radius_km: number | null;
  place_label: string;
  priority: number;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  landing: AppearanceLanding;
  hero: AppearanceHero;
  palette: AppearancePalette;
  revision: number;
  created_at: string;
  updated_at: string;
  updated_by: string;
  migrated_from: AppearanceMigrationMarker | null;
};

/** The exact fourteen keys Core's `normalizeInput` accepts on save. */
export type AppearanceRuleInput = {
  name: string;
  scope: AppearanceScope;
  storefront_country: string;
  country_code: string;
  center: AppearanceCenter | null;
  radius_km: number | null;
  place_label: string;
  priority: number;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  landing: AppearanceLanding;
  hero: AppearanceHero;
  palette: AppearancePalette;
};

const RULE_INPUT_KEYS = [
  "name", "scope", "storefront_country", "country_code", "center", "radius_km",
  "place_label", "priority", "active", "starts_at", "ends_at", "landing", "hero",
  "palette",
] as const;

const RULE_WIRE_KEYS = [
  ...RULE_INPUT_KEYS,
  "id", "revision", "created_at", "updated_at", "updated_by",
] as const;

export type AppearanceListPayload = {
  rules: AppearanceRule[];
  defaults: {
    palette: AppearanceFullPalette;
    landing: AppearanceLandingDraft;
  };
};

export type AppearancePreviewLandingV2 = {
  background: {
    type: "image" | "video";
    url: string;
    poster_url: string;
    overlay: { color: string; alpha: number };
  };
  title: {
    type: "text" | "image" | "none";
    text: string;
    image_url: string;
    image: { width_percent: number; offset_percent: number };
    style: { font: AppearanceLandingFont; size: number; color: string; align: AppearanceLandingAlign };
  };
  description: {
    text: string;
    hidden: boolean;
    style: { font: AppearanceLandingFont; size: number; color: string; align: AppearanceLandingAlign };
    backdrop: { color: string; alpha: number };
  };
  layout: {
    text_gap: { value: number; unit: AppearanceLandingLayoutUnit };
    footer_min_height: { value: number; unit: AppearanceLandingLayoutUnit };
  };
  buttons: {
    corner_radius: number;
    phone: { label: string; background: string; text_color: string; font: AppearanceLandingFont; size: number };
    email: { label: string; background: string; text_color: string; font: AppearanceLandingFont; size: number };
    apple: { style: AppearanceLandingAppleStyle };
  };
  footer: {
    text: string;
    background: { color: string; alpha: number };
    style: { font: AppearanceLandingFont; size: number; color: string };
  };
  qr: { enabled: boolean; background: string; icon_color: string };
};

/** Normalized preview view: v1 callers keep their fields; v2 adds `v2`. */
export type AppearancePreviewLanding = {
  schema: 1 | 2;
  background: { type: "image" | "video"; url: string; poster_url: string };
  title: { type: "text" | "image" | "none"; text: string; image_url: string };
  description: string;
  v2: AppearancePreviewLandingV2 | null;
};

export const APPEARANCE_LANDING_FLAT_SOURCE_SCOPES = ["geo", "storefront", "global", "none"] as const;
export type AppearanceLandingFlatSourceScope = (typeof APPEARANCE_LANDING_FLAT_SOURCE_SCOPES)[number];

export type AppearanceLandingFlatSource = {
  scope: AppearanceLandingFlatSourceScope;
  rule_id: string;
};

export type AppearanceLandingFlatSources = Record<AppearanceLandingKey, AppearanceLandingFlatSource>;

export type AppearancePreviewHeroStyle = {
  title_size: number | null;
  title_color: string;
  title_weight: string;
  subtitle_size: number | null;
  subtitle_color: string;
  subtitle_weight: string;
};

export type AppearancePreviewHeroItem = {
  id: string;
  media_url: string;
  type: "image" | "video";
  forward_url: string;
  title: string;
  subtitle: string;
  link_title: string;
  text_style: Record<AppearanceHeroPlatform, AppearancePreviewHeroStyle>;
};

export type AppearancePreviewPayload = {
  revision: number;
  content_version: string;
  landing: AppearancePreviewLanding;
  hero: AppearancePreviewHeroItem[];
  palette: AppearanceFullPalette;
  matched: {
    scope: AppearanceMatchedScope;
    rule_id: string;
    location_source: AppearanceLocationSource;
  };
  /** Webadmin schema-2 only: complete rule-chain values, blank when no rule sets the exact key. */
  landing_flat: AppearanceLandingDraft | null;
  /** Webadmin schema-2 only: the exact source selected for every flat field. */
  landing_flat_sources: AppearanceLandingFlatSources | null;
  /** Webadmin schema-2 only: complete compiled defaults, consulted after both rule-language chains. */
  landing_flat_defaults: AppearanceLandingDraft | null;
};

export type AppearanceGeocodeCandidate = {
  place_id: string;
  place_label: string;
  country_code: string;
  center: AppearanceCenter;
  radius_km: number;
};

export const MAX_APPEARANCE_NAME_LENGTH = 120;
export const MAX_APPEARANCE_PLACE_LABEL_LENGTH = 160;
export const MAX_APPEARANCE_GEOCODE_QUERY_LENGTH = 120;
export const MAX_APPEARANCE_PRIORITY = 10_000;
export const MIN_APPEARANCE_RADIUS_KM = 1;
export const MAX_APPEARANCE_RADIUS_KM = 500;
const MAX_ID_LENGTH = 128;
/** Core rule identity is a BSON ObjectId: exactly 24 lowercase hex characters on the wire (T-468b finding 6). */
const RULE_ID = /^[0-9a-f]{24}$/;
/** Core's `content_version` is a lowercase SHA-256 hex digest (T-468b finding 7). */
const CONTENT_VERSION = /^[0-9a-f]{64}$/;
/** `AppearanceRuleService::heroWire()` emits at most ten active items (T-468b finding 7). */
const MAX_APPEARANCE_PREVIEW_HERO_ITEMS = 10;
/** `AppearanceCityGeocodeService` returns at most five de-duplicated candidates (T-468b finding 8). */
const MAX_APPEARANCE_GEOCODE_CANDIDATES = 5;
/** `AppearancePolicy::MAX_RULES`: a successful list never carries more rows (T-468b finding 13). */
export const MAX_APPEARANCE_RULES = 100;
/** `AppearanceRuleService::heroWire()` output ceiling — the app and the preview see at most ten items (T-468b finding 15). */
export const MAX_APPEARANCE_EFFECTIVE_HERO_ITEMS = 10;
const MAX_APPEARANCE_PLACE_ID_BYTES = 256;

/** The one exact rule-id reader: stored ids and update/delete targets. */
export function appearanceRuleId(value: unknown): string | null {
  return typeof value === "string" && RULE_ID.test(value) ? value : null;
}
const MAX_URL_LENGTH = 2048;

// ---------------------------------------------------------------------------
// Country catalogue (store countries are App Store storefronts, ISO 3166-1
// alpha-3; geo place metadata is alpha-2). `countries-list` ships both codes.
// ---------------------------------------------------------------------------

export type AppearanceCountry = { alpha2: string; alpha3: string };
export type LocalizedAppearanceCountry = AppearanceCountry & { name: string };

/**
 * Core `AppearancePolicy::ALPHA2_TO_ALPHA3` is the 249 current ISO 3166-1
 * assignments (T-468b finding 17). `countries-list` additionally carries the
 * CLDR subdivision-style territories AC/ASC and TA/TAA, which Core refuses.
 */
const NON_ISO_REGIONS: ReadonlySet<string> = new Set(["AC", "TA"]);
export const APPEARANCE_COUNTRY_COUNT = 249;
const COUNTRY_SOURCE = getCountryDataList().filter((country) => !country.userAssigned && !NON_ISO_REGIONS.has(country.iso2));
const ENGLISH_COUNTRY_NAMES: ReadonlyMap<string, string> = new Map(
  COUNTRY_SOURCE.map((country) => [country.iso2, country.name]),
);
const COUNTRY_CATALOG: AppearanceCountry[] = COUNTRY_SOURCE
  .map((country) => ({ alpha2: country.iso2, alpha3: country.iso3 }))
  .filter((country) => /^[A-Z]{2}$/.test(country.alpha2) && /^[A-Z]{3}$/.test(country.alpha3))
  .sort((left, right) => left.alpha3.localeCompare(right.alpha3));
const ALPHA3_CODES: ReadonlySet<string> = new Set(COUNTRY_CATALOG.map((country) => country.alpha3));
const ALPHA2_CODES: ReadonlySet<string> = new Set(COUNTRY_CATALOG.map((country) => country.alpha2));

export const APPEARANCE_COUNTRIES: readonly AppearanceCountry[] = COUNTRY_CATALOG;

export function localizedAppearanceCountries(locale: string): LocalizedAppearanceCountry[] {
  const displayNames = new Intl.DisplayNames([locale === "hu" ? "hu" : "en"], { type: "region" });
  return COUNTRY_CATALOG.map((country) => ({
    ...country,
    name: displayNames.of(country.alpha2) ?? ENGLISH_COUNTRY_NAMES.get(country.alpha2) ?? country.alpha3,
  })).sort((left, right) => left.name.localeCompare(right.name, locale === "hu" ? "hu" : "en"));
}

export function isAppearanceStorefront(value: string): boolean {
  return ALPHA3_CODES.has(value);
}

export function isAppearanceAlpha2(value: string): boolean {
  return ALPHA2_CODES.has(value);
}

// ---------------------------------------------------------------------------
// Primitive readers. Every reader returns `null` for anything it does not
// recognise so a partial or loosely typed payload never renders as proof.
// ---------------------------------------------------------------------------

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const actual = Object.keys(value);
  if (actual.some((key) => !required.includes(key) && !optional.includes(key))) return false;
  return required.every((key) => Object.hasOwn(value, key));
}

function subsetKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;
/**
 * Well-formed UTF-16 (T-468b finding 24): PHP's JSON decoder refuses an
 * unpaired surrogate escape and Core requires valid UTF-8, while JavaScript
 * happily materialises a lone surrogate — and `TextEncoder` would silently
 * replace it with U+FFFD. Every Core-bound string helper requires this BEFORE
 * trimming, byte counting or URL parsing.
 */
export function wellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}
/** Core-bound text material: a string that is well-formed UTF-16 and carries no control character on the ORIGINAL value. */
function coreString(value: unknown): value is string {
  return typeof value === "string" && wellFormedUtf16(value) && !CONTROL_CHARACTERS.test(value);
}
/**
 * PHP's default `trim()` character list — space, tab, newline, carriage
 * return, NUL and vertical tab — which is what Core canonicalises appearance
 * text with (T-468b finding 19). JavaScript `appearanceTrim(String.prototype)` would
 * also strip Unicode whitespace such as U+00A0, which Core keeps as content.
 */
const PHP_TRIM_EDGE = /^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g;
export function appearanceTrim(value: string): string {
  return value.replace(PHP_TRIM_EDGE, "");
}

/** Bounded text as Core reads it: controls are refused on the ORIGINAL string (never repaired by trimming), then PHP-trimmed and measured in code points. */
function boundedText(value: unknown, minimum: number, maximum: number): string | null {
  if (!coreString(value)) return null;
  const trimmed = appearanceTrim(value);
  const length = [...trimmed].length;
  if (length < minimum || length > maximum) return null;
  return trimmed;
}

function integer(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  return value >= minimum && value <= maximum ? value : null;
}

function finite(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value >= minimum && value <= maximum ? value : null;
}

function boolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** Core's `AppearancePolicy::hex()` — `#RRGGBB`, uppercase on the wire. */
export function parseAppearancePaletteHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^#[0-9A-F]{6}$/.test(value) ? value : null;
}

/** Operator input is normalised to the wire form; anything else is refused. */
export function normalizeAppearancePaletteHex(value: string): string | null {
  const trimmed = appearanceTrim(value).toUpperCase();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return /^#[0-9A-F]{6}$/.test(withHash) ? withHash : null;
}

/** Hero typography colours stay lowercase `#rrggbb` (the legacy hero contract). */
function heroColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = appearanceTrim(value);
  if (trimmed === "") return "";
  return /^#[0-9a-f]{6}$/.test(trimmed) ? trimmed : null;
}

/** Core `AppearancePolicy::webUrl()`: no control character anywhere in the ORIGINAL string, trimmed URL ≤ 2048 UTF-8 bytes (T-468b finding 16). */
function webUrl(value: unknown, allowEmpty: boolean): string | null {
  if (!coreString(value)) return null;
  const trimmed = appearanceTrim(value);
  if (trimmed === "") return allowEmpty ? "" : null;
  if (new TextEncoder().encode(trimmed).length > MAX_URL_LENGTH) return null;
  return httpsWireUrl(trimmed) ? trimmed : null;
}

/**
 * Non-repairing syntax gate (T-468b finding 20): the raw wire value must start
 * with the literal `https://` followed by a non-empty authority BEFORE the
 * WHATWG parser sees it, because `new URL()` repairs forms Core's
 * `AppearancePolicy::webUrl()` rejects (`https:\\host`, `https:host`,
 * `https:///host`). The raw value is what is kept and compared — never the
 * serialised `new URL()` form — so Core-accepted forms such as a backslash
 * after the host or credentials survive exactly. HTTPS only (finding 16).
 */
const HTTPS_WIRE_URL = /^https:\/\/[^\/\\?#]+/;
/** Shared with the forced-verification console's Waiting Room help URL (Amendment v1.5): one https gate, one behaviour. */
export function httpsWireUrl(trimmed: string): boolean {
  if (!HTTPS_WIRE_URL.test(trimmed)) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" && url.hostname !== "";
  } catch {
    return false;
  }
}

export function isAppearanceHttpsUrl(value: string, optional = false): boolean {
  if (!coreString(value)) return false;
  const trimmed = appearanceTrim(value);
  if (trimmed === "") return optional;
  if (new TextEncoder().encode(trimmed).length > MAX_URL_LENGTH) return false;
  return httpsWireUrl(trimmed);
}

const WIRE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Exact UTC wire timestamp (`YYYY-MM-DDTHH:MM:SSZ`) that round-trips through Date. */
export function parseAppearanceTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !WIRE_TIMESTAMP.test(value)) return null;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return null;
  return new Date(millis).toISOString().replace(/\.\d{3}Z$/, "Z") === value ? value : null;
}

/** `null` or an exact UTC timestamp; an empty string is not a nullable timestamp. */
function nullableTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  const parsed = parseAppearanceTimestamp(value);
  return parsed === null ? undefined : parsed;
}

export function appearanceTimestampsOrdered(startsAt: string | null, endsAt: string | null): boolean {
  if (startsAt === null || endsAt === null) return true;
  return Date.parse(startsAt) < Date.parse(endsAt);
}

/** `<input type="datetime-local">` value (operator local time) for a wire timestamp. */
export function appearanceTimestampToLocalInput(value: string | null): string {
  if (value === null) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The inverse: a local datetime input becomes the exact UTC wire form, `""` clears. */
export function appearanceTimestampFromLocalInput(value: string): string | null | undefined {
  const trimmed = appearanceTrim(value);
  if (trimmed === "") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? 0));
  const date = new Date(year!, month! - 1, day!, hour!, minute!, second!);
  // `Date` normalises an impossible local date (30 February → 2 March) and a
  // time inside a DST gap; only an input that reads back unchanged is real.
  if (!Number.isFinite(date.getTime())
    || date.getFullYear() !== year || date.getMonth() !== month! - 1 || date.getDate() !== day
    || date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) return undefined;
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ---------------------------------------------------------------------------
// Rule parsers
// ---------------------------------------------------------------------------

function parseCenter(value: unknown): AppearanceCenter | null {
  const source = record(value);
  if (!source || !exactKeys(source, ["latitude", "longitude"])) return null;
  const latitude = finite(source.latitude, -90, 90);
  const longitude = finite(source.longitude, -180, 180);
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
}

export const APPEARANCE_LANDING_COLOR_KEYS = [
  "overlay_color",
  "title_color",
  "description_color",
  "description_backdrop_color",
  "button_phone_bg",
  "button_phone_text_color",
  "button_email_bg",
  "button_email_text_color",
  "footer_bg_color",
  "footer_text_color",
  "qr_bg_color",
  "qr_icon_color",
] as const satisfies readonly AppearanceLandingKey[];

export const APPEARANCE_LANDING_ALPHA_KEYS = [
  "overlay_alpha",
  "description_backdrop_alpha",
  "footer_bg_alpha",
] as const satisfies readonly AppearanceLandingKey[];

const APPEARANCE_LANDING_FONT_KEYS = [
  "title_font",
  "description_font",
  "button_phone_font",
  "button_email_font",
  "footer_font",
] as const satisfies readonly AppearanceLandingKey[];

const APPEARANCE_LANDING_ALIGN_KEYS = [
  "title_align",
  "description_align",
] as const satisfies readonly AppearanceLandingKey[];

const APPEARANCE_LANDING_LAYOUT_UNIT_KEYS = [
  "text_gap_unit",
  "footer_min_height_unit",
] as const satisfies readonly AppearanceLandingKey[];

const APPEARANCE_LANDING_INTEGER_BOUNDS: Partial<Record<AppearanceLandingKey, readonly [number, number]>> = {
  title_size: [12, 72],
  title_image_width_percent: [20, 100],
  title_image_offset_percent: [-40, 40],
  description_size: [10, 40],
  button_corner_radius: [0, 32],
  button_phone_size: [12, 24],
  button_email_size: [12, 24],
  footer_size: [10, 18],
  text_gap_value: [0, 200],
  footer_min_height_value: [0, 300],
};

/** Fields whose draft values affect `AppearanceLandingPreview` rendering or inline styles. */
export const APPEARANCE_LANDING_PREVIEW_STYLE_KEYS = [
  ...APPEARANCE_LANDING_COLOR_KEYS,
  ...APPEARANCE_LANDING_ALPHA_KEYS,
  ...APPEARANCE_LANDING_FONT_KEYS,
  ...APPEARANCE_LANDING_ALIGN_KEYS,
  "title_size",
  "title_image_width_percent",
  "title_image_offset_percent",
  "description_size",
  "button_corner_radius",
  "button_phone_size",
  "button_email_size",
  "footer_size",
  "button_apple_style",
  "description_hidden",
  "text_gap_value",
  "text_gap_unit",
  "footer_min_height_value",
  "footer_min_height_unit",
] as const satisfies readonly AppearanceLandingKey[];

const LANDING_ALPHA = /^(?:0\.\d{2}|1\.00)$/;
const LANDING_INTEGER = /^(?:0|[1-9]\d*|-[1-9]\d*)$/;

/** Canonical persisted alpha: 0.00–1.00 with exactly two decimals. */
export function parseAppearanceLandingAlpha(value: string): number | null {
  if (!LANDING_ALPHA.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 0 && parsed <= 1 ? parsed : null;
}

function parseAppearanceLandingInteger(value: string, minimum: number, maximum: number): number | null {
  if (!LANDING_INTEGER.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

/**
 * Footer markup is deliberately not HTML. Each supported marker must form
 * one non-empty, non-nested pair; the app turns only those spans into links.
 */
export function appearanceFooterTextHasExactTags(value: string): boolean {
  const tags = ["terms", "privacy"] as const;
  for (const tag of tags) {
    if (value.split(`<${tag}>`).length !== 2 || value.split(`</${tag}>`).length !== 2) return false;
    const pair = new RegExp(`<${tag}>(?:(?!<\\/?(?:terms|privacy)>)[\\s\\S])+<\\/${tag}>`);
    if (!pair.test(value)) return false;
  }
  return true;
}

function appearanceLandingFieldValid(key: AppearanceLandingKey, value: string): boolean {
  // Empty values are the explicit Webadmin draft representation of inherit;
  // `appearanceLandingWire` omits them before save.
  if (value === "") return true;
  if (key === "background_type") return value === "image" || value === "video";
  if (key === "title_type") return value === "text" || value === "image" || value === "none";
  if (key === "background_url" || key === "background_poster_url" || key === "title_image_url") {
    return webUrl(value, false) !== null;
  }
  if ((APPEARANCE_LANDING_COLOR_KEYS as readonly string[]).includes(key)) return parseAppearancePaletteHex(value) !== null;
  if ((APPEARANCE_LANDING_ALPHA_KEYS as readonly string[]).includes(key)) return parseAppearanceLandingAlpha(value) !== null;
  if ((APPEARANCE_LANDING_FONT_KEYS as readonly string[]).includes(key)) return (APPEARANCE_LANDING_FONTS as readonly string[]).includes(value);
  if ((APPEARANCE_LANDING_ALIGN_KEYS as readonly string[]).includes(key)) return (APPEARANCE_LANDING_ALIGNS as readonly string[]).includes(value);
  const integerBounds = APPEARANCE_LANDING_INTEGER_BOUNDS[key];
  if (integerBounds) return parseAppearanceLandingInteger(value, integerBounds[0], integerBounds[1]) !== null;
  if ((APPEARANCE_LANDING_LAYOUT_UNIT_KEYS as readonly string[]).includes(key)) {
    return (APPEARANCE_LANDING_LAYOUT_UNITS as readonly string[]).includes(value);
  }
  if (key === "button_apple_style") return (APPEARANCE_LANDING_APPLE_STYLES as readonly string[]).includes(value);
  if (key === "description_hidden" || key === "qr_enabled") return value === "true" || value === "false";
  if (key === "footer_text_en" || key === "footer_text_hu") return appearanceFooterTextHasExactTags(value);
  return true;
}

/** A JSON object even when empty (Core container identity, T-467b finding 8/15); an array is never a landing map. */
export function parseAppearanceLanding(value: unknown): AppearanceLanding | null {
  const source = record(value);
  if (!source || !subsetKeys(source, APPEARANCE_LANDING_KEYS)) return null;
  const landing: AppearanceLanding = {};
  for (const key of APPEARANCE_LANDING_KEYS) {
    if (!Object.hasOwn(source, key)) continue;
    const raw = source[key];
    // Findings 16/24: controls and malformed UTF-16 are refused on the ORIGINAL string, before trimming can repair them.
    if (!coreString(raw)) return null;
    const trimmed = appearanceTrim(raw);
    if ([...trimmed].length > LANDING_LIMITS[key]) return null;
    if (!appearanceLandingFieldValid(key, trimmed)) return null;
    landing[key] = trimmed;
  }
  return landing;
}

function parseHeroItem(value: unknown, position: number): AppearanceHeroItem | null {
  const source = record(value);
  if (!source || !exactKeys(source, HERO_ITEM_KEYS)) return null;
  const id = boundedText(source.id, 0, MAX_ID_LENGTH);
  const media = webUrl(source.media_url, false);
  const type = source.type === "image" || source.type === "video" ? source.type : null;
  const forward = webUrl(source.forward_url, true);
  if (id === null || media === null || type === null || forward === null) return null;
  const item: AppearanceHeroItem = {
    id,
    media_url: media,
    type,
    forward_url: forward,
    title_en: "",
    title_hu: "",
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
    title_size_mobile: null,
    title_color_mobile: "",
    title_weight_mobile: "",
    subtitle_size_mobile: null,
    subtitle_color_mobile: "",
    subtitle_weight_mobile: "",
    sort_order: position,
    active: true,
  };
  const textLimits: Array<[keyof AppearanceHeroItem, number]> = [
    ["title_en", 160], ["title_hu", 160], ["subtitle_en", 160], ["subtitle_hu", 160],
    ["link_title_en", 80], ["link_title_hu", 80],
  ];
  for (const [key, limit] of textLimits) {
    const text = boundedText(source[key], 0, limit);
    if (text === null) return null;
    (item as Record<string, unknown>)[key] = text;
  }
  for (const platform of ["web", "mobile"] as const) {
    for (const text of ["title", "subtitle"] as const) {
      const sizeKey = `${text}_size_${platform}` as const;
      const colorKey = `${text}_color_${platform}` as const;
      const weightKey = `${text}_weight_${platform}` as const;
      const sizeRaw = source[sizeKey];
      const size = sizeRaw === null ? null : integer(sizeRaw, 10, 120);
      if (sizeRaw !== null && size === null) return null;
      const color = heroColor(source[colorKey]);
      if (color === null) return null;
      const weight = source[weightKey];
      if (typeof weight !== "string" || !(APPEARANCE_HERO_TEXT_WEIGHTS as readonly string[]).includes(weight)) return null;
      item[sizeKey] = size;
      item[colorKey] = color;
      item[weightKey] = weight;
    }
  }
  const sortOrder = integer(source.sort_order, 0, MAX_APPEARANCE_PRIORITY);
  const active = boolean(source.active);
  if (sortOrder === null || active === null) return null;
  item.sort_order = sortOrder;
  item.active = active;
  return item;
}

export function parseAppearanceHero(value: unknown): AppearanceHero | null {
  const source = record(value);
  if (!source || !exactKeys(source, ["mode", "items"])) return null;
  const mode = source.mode === "inherit" || source.mode === "replace" ? source.mode : null;
  if (mode === null || !Array.isArray(source.items) || source.items.length > MAX_APPEARANCE_HERO_ITEMS) return null;
  if (mode === "inherit" && source.items.length > 0) return null;
  const items: AppearanceHeroItem[] = [];
  for (const [position, raw] of source.items.entries()) {
    const item = parseHeroItem(raw, position);
    if (!item) return null;
    items.push(item);
  }
  return { mode, items };
}

export function parseAppearancePalette(value: unknown): AppearancePalette | null {
  const source = record(value);
  if (!source || !subsetKeys(source, APPEARANCE_PALETTE_MODES)) return null;
  const palette: AppearancePalette = { light: {}, dark: {} };
  for (const mode of APPEARANCE_PALETTE_MODES) {
    if (!Object.hasOwn(source, mode)) continue;
    const modeSource = record(source[mode]);
    if (!modeSource || !subsetKeys(modeSource, APPEARANCE_PALETTE_ROLES)) return null;
    for (const role of APPEARANCE_PALETTE_ROLES) {
      if (!Object.hasOwn(modeSource, role)) continue;
      const hex = parseAppearancePaletteHex(modeSource[role]);
      if (hex === null) return null;
      palette[mode][role] = hex;
    }
  }
  return palette;
}

export function parseAppearanceFullPalette(value: unknown): AppearanceFullPalette | null {
  const source = record(value);
  if (!source || !exactKeys(source, APPEARANCE_PALETTE_MODES)) return null;
  const palette = { light: {}, dark: {} } as AppearanceFullPalette;
  for (const mode of APPEARANCE_PALETTE_MODES) {
    const modeSource = record(source[mode]);
    if (!modeSource || !exactKeys(modeSource, APPEARANCE_PALETTE_ROLES)) return null;
    for (const role of APPEARANCE_PALETTE_ROLES) {
      const hex = parseAppearancePaletteHex(modeSource[role]);
      if (hex === null) return null;
      palette[mode][role] = hex;
    }
  }
  return palette;
}

type ScopeFields = Pick<AppearanceRuleInput, "storefront_country" | "country_code" | "center" | "radius_km" | "place_label">;

/**
 * Scope-neutral fields carry their exact wire type: an empty string for
 * `storefront_country`, `country_code` and `place_label`, `null` for `center`
 * and `radius_km`. `null`, `""` and a missing key are not interchangeable.
 */
function parseScopeFields(scope: AppearanceScope, source: Record<string, unknown>): ScopeFields | null {
  const blank = (value: unknown) => value === "";
  const absent = (value: unknown) => value === null;
  if (scope === "storefront") {
    const storefront = typeof source.storefront_country === "string" ? source.storefront_country : "";
    if (!isAppearanceStorefront(storefront)) return null;
    if (!blank(source.country_code) || !absent(source.center) || !absent(source.radius_km) || !blank(source.place_label)) return null;
    return { storefront_country: storefront, country_code: "", center: null, radius_km: null, place_label: "" };
  }
  if (scope === "geo") {
    if (!blank(source.storefront_country)) return null;
    let country = "";
    if (!blank(source.country_code)) {
      if (typeof source.country_code !== "string" || !isAppearanceAlpha2(source.country_code)) return null;
      country = source.country_code;
    }
    const center = parseCenter(source.center);
    const radius = finite(source.radius_km, MIN_APPEARANCE_RADIUS_KM, MAX_APPEARANCE_RADIUS_KM);
    const placeLabel = boundedText(source.place_label, 1, MAX_APPEARANCE_PLACE_LABEL_LENGTH);
    if (!center || radius === null || placeLabel === null) return null;
    return { storefront_country: "", country_code: country, center, radius_km: radius, place_label: placeLabel };
  }
  if (!blank(source.storefront_country) || !blank(source.country_code) || !blank(source.place_label)
    || !absent(source.center) || !absent(source.radius_km)) return null;
  return { storefront_country: "", country_code: "", center: null, radius_km: null, place_label: "" };
}

function parseRuleInputFields(source: Record<string, unknown>): AppearanceRuleInput | null {
  const name = boundedText(source.name, 1, MAX_APPEARANCE_NAME_LENGTH);
  const scope = typeof source.scope === "string" && (APPEARANCE_SCOPES as readonly string[]).includes(source.scope)
    ? source.scope as AppearanceScope
    : null;
  const priority = integer(source.priority, 0, MAX_APPEARANCE_PRIORITY);
  const active = boolean(source.active);
  const startsAt = nullableTimestamp(source.starts_at);
  const endsAt = nullableTimestamp(source.ends_at);
  if (name === null || scope === null || priority === null || active === null
    || startsAt === undefined || endsAt === undefined
    || !appearanceTimestampsOrdered(startsAt, endsAt)) return null;
  const scopeFields = parseScopeFields(scope, source);
  const landing = parseAppearanceLanding(source.landing);
  const hero = parseAppearanceHero(source.hero);
  const palette = parseAppearancePalette(source.palette);
  if (!scopeFields || !landing || !appearanceLandingCoherent(landing) || !hero || !palette) return null;
  return {
    name,
    scope,
    ...scopeFields,
    priority,
    active,
    starts_at: startsAt,
    ends_at: endsAt,
    landing,
    hero,
    palette,
  };
}

/** Strict save body: exactly the fourteen keys, every value in its closed domain. */
export function parseAppearanceRuleInput(value: unknown): AppearanceRuleInput | null {
  const source = record(value);
  if (!source || !exactKeys(source, RULE_INPUT_KEYS)) return null;
  const input = parseRuleInputFields(source);
  if (!input) return null;
  // Finding 14 / T-468b finding 3: save input may carry several EMPTY hero ids for
  // Core to mint, but every non-empty id must already be unique.
  const namedIds = input.hero.items.map((item) => item.id).filter((heroId) => heroId !== "");
  if (new Set(namedIds).size !== namedIds.length) return null;
  return input;
}

/** One stored rule exactly as Core projects it. */
export function parseAppearanceRule(value: unknown): AppearanceRule | null {
  const source = record(value);
  if (!source || !exactKeys(source, RULE_WIRE_KEYS, ["migrated_from"])) return null;
  const input = parseRuleInputFields(source);
  const id = appearanceRuleId(source.id);
  const revision = integer(source.revision, 1, Number.MAX_SAFE_INTEGER);
  // Finding 6: stored audit timestamps are strict UTC strings, never null (nullable only for starts_at / ends_at).
  const createdAt = parseAppearanceTimestamp(source.created_at);
  const updatedAt = parseAppearanceTimestamp(source.updated_at);
  // Finding 23: the stored actor mirrors Core's bounds — non-empty after trim, ≤ 320 raw code
  // points — and is projected unrepaired; a violation makes the whole body untrusted.
  const updatedBy = coreString(source.updated_by)
    && appearanceTrim(source.updated_by) !== ""
    && [...source.updated_by].length <= MAX_APPEARANCE_ACTOR_LENGTH
    ? source.updated_by
    : null;
  const migratedFrom = Object.hasOwn(source, "migrated_from")
    ? ((APPEARANCE_MIGRATION_MARKERS as readonly unknown[]).includes(source.migrated_from) ? source.migrated_from as AppearanceMigrationMarker : undefined)
    : null;
  if (!input || id === null || revision === null || createdAt === null || updatedAt === null || updatedBy === null || migratedFrom === undefined) return null;
  // T-467b finding 14: an empty hero id is legal only in save input (Core mints
  // it); a STORED rule carries non-empty, unique hero ids or is malformed.
  const heroIds = input.hero.items.map((item) => item.id);
  if (heroIds.some((heroId) => heroId === "") || new Set(heroIds).size !== heroIds.length) return null;
  return {
    id,
    ...input,
    revision,
    created_at: createdAt,
    updated_at: updatedAt,
    updated_by: updatedBy,
    migrated_from: migratedFrom,
  };
}

function parseLandingDefaults(value: unknown): AppearanceLandingDraft | null {
  const source = record(value);
  if (!source || !exactKeys(source, APPEARANCE_LANDING_KEYS)) return null;
  const landing = parseAppearanceLanding(source);
  if (!landing) return null;
  if (landing.background_type === undefined || landing.title_type === undefined) return null;
  return landing as AppearanceLandingDraft;
}

/**
 * `appearance_rules_list` material: the rules plus Core's compiled defaults
 * (the same §1 palette and landing this module compiles for its own display
 * constants). Both halves are required; a partial payload is refused.
 */
export function parseAppearanceListPayload(value: unknown): AppearanceListPayload | null {
  const source = record(value);
  if (!source || !exactKeys(source, ["rules", "defaults"])) return null;
  if (!Array.isArray(source.rules)) return null;
  const rules: AppearanceRule[] = [];
  const seen = new Set<string>();
  let globalCount = 0;
  for (const raw of source.rules) {
    const rule = parseAppearanceRule(raw);
    if (!rule || seen.has(rule.id)) return null;
    seen.add(rule.id);
    if (rule.scope === "global") globalCount += 1;
    rules.push(rule);
  }
  // Findings 12/13: Core emits a successful list only with EXACTLY one global rule and at most
  // `AppearancePolicy::MAX_RULES` rows; anything else is its `appearance-rule-schema-unavailable`
  // boundary, so such a "success" is malformed material here.
  if (globalCount !== 1 || rules.length > MAX_APPEARANCE_RULES) return null;
  // The binding list wire carries Core's compiled defaults; the console never
  // substitutes its own table for missing provider material.
  const defaultsSource = record(source.defaults);
  if (!defaultsSource || !exactKeys(defaultsSource, ["palette", "landing"])) return null;
  const palette = parseAppearanceFullPalette(defaultsSource.palette);
  const landing = parseLandingDefaults(defaultsSource.landing);
  if (!palette || !landing) return null;
  return { rules, defaults: { palette, landing } };
}

function previewLandingColor(value: unknown): string | null {
  return parseAppearancePaletteHex(value);
}

function previewLandingAlpha(value: unknown): number | null {
  const alpha = finite(value, 0, 1);
  return alpha !== null && Number(alpha.toFixed(2)) === alpha ? alpha : null;
}

function previewLandingFont(value: unknown): AppearanceLandingFont | null {
  return typeof value === "string" && (APPEARANCE_LANDING_FONTS as readonly string[]).includes(value)
    ? value as AppearanceLandingFont
    : null;
}

function previewLandingAlign(value: unknown): AppearanceLandingAlign | null {
  return typeof value === "string" && (APPEARANCE_LANDING_ALIGNS as readonly string[]).includes(value)
    ? value as AppearanceLandingAlign
    : null;
}

function previewLandingLayoutUnit(value: unknown): AppearanceLandingLayoutUnit | null {
  return typeof value === "string" && (APPEARANCE_LANDING_LAYOUT_UNITS as readonly string[]).includes(value)
    ? value as AppearanceLandingLayoutUnit
    : null;
}

function parsePreviewLandingV1(source: Record<string, unknown>): AppearancePreviewLanding | null {
  if (!exactKeys(source, ["background", "title", "description"])) return null;
  const background = record(source.background);
  const title = record(source.title);
  if (!background || !exactKeys(background, ["type", "url", "poster_url"])) return null;
  if (!title || !exactKeys(title, ["type", "text", "image_url"])) return null;
  const backgroundType = background.type === "image" || background.type === "video" ? background.type : null;
  const backgroundUrl = webUrl(background.url, true);
  const posterUrl = webUrl(background.poster_url, true);
  const titleType = title.type === "text" || title.type === "image" ? title.type : null;
  const titleText = boundedText(title.text, 0, LANDING_LIMITS.title_text_en);
  const titleImage = webUrl(title.image_url, true);
  const description = boundedText(source.description, 0, LANDING_LIMITS.description_en);
  if (backgroundType === null || backgroundUrl === null || posterUrl === null || titleType === null
    || titleText === null || titleImage === null || description === null) return null;
  // The released v1 projection remains byte-for-byte strict.
  if (backgroundType === "image" && posterUrl !== "") return null;
  if (backgroundType === "video" && backgroundUrl === "") return null;
  // D-061 projects v2 `none` to the legacy text shape with an empty string.
  if (titleType === "text" && titleImage !== "") return null;
  if (titleType === "image" && (titleImage === "" || titleText !== "")) return null;
  if (description === "") return null;
  return {
    schema: 1,
    background: { type: backgroundType, url: backgroundUrl, poster_url: posterUrl },
    title: { type: titleType, text: titleText, image_url: titleImage },
    description,
    v2: null,
  };
}

function parsePreviewLandingV2(source: Record<string, unknown>): AppearancePreviewLanding | null {
  if (!exactKeys(source, ["background", "title", "description", "layout", "buttons", "footer", "qr"])) return null;
  const background = record(source.background);
  const title = record(source.title);
  const description = record(source.description);
  const layout = record(source.layout);
  const buttons = record(source.buttons);
  const footer = record(source.footer);
  const qr = record(source.qr);
  if (!background || !exactKeys(background, ["type", "url", "poster_url", "overlay"])
    || !title || !exactKeys(title, ["type", "text", "image_url", "image", "style"])
    || !description || !exactKeys(description, ["text", "hidden", "style", "backdrop"])
    || !layout || !exactKeys(layout, ["text_gap", "footer_min_height"])
    || !buttons || !exactKeys(buttons, ["corner_radius", "phone", "email", "apple"])
    || !footer || !exactKeys(footer, ["text", "background", "style"])
    || !qr || !exactKeys(qr, ["enabled", "background", "icon_color"])) return null;

  const overlay = record(background.overlay);
  const titleImageLayout = record(title.image);
  const titleStyle = record(title.style);
  const descriptionStyle = record(description.style);
  const descriptionBackdrop = record(description.backdrop);
  const phone = record(buttons.phone);
  const email = record(buttons.email);
  const apple = record(buttons.apple);
  const footerBackground = record(footer.background);
  const footerStyle = record(footer.style);
  const textGap = record(layout.text_gap);
  const footerMinHeight = record(layout.footer_min_height);
  if (!overlay || !exactKeys(overlay, ["color", "alpha"])
    || !titleImageLayout || !exactKeys(titleImageLayout, ["width_percent", "offset_percent"])
    || !titleStyle || !exactKeys(titleStyle, ["font", "size", "color", "align"])
    || !descriptionStyle || !exactKeys(descriptionStyle, ["font", "size", "color", "align"])
    || !descriptionBackdrop || !exactKeys(descriptionBackdrop, ["color", "alpha"])
    || !phone || !exactKeys(phone, ["label", "background", "text_color", "font", "size"])
    || !email || !exactKeys(email, ["label", "background", "text_color", "font", "size"])
    || !apple || !exactKeys(apple, ["style"])
    || !footerBackground || !exactKeys(footerBackground, ["color", "alpha"])
    || !footerStyle || !exactKeys(footerStyle, ["font", "size", "color"])
    || !textGap || !exactKeys(textGap, ["value", "unit"])
    || !footerMinHeight || !exactKeys(footerMinHeight, ["value", "unit"])) return null;

  const backgroundType = background.type === "image" || background.type === "video" ? background.type : null;
  const backgroundUrl = webUrl(background.url, true);
  const posterUrl = webUrl(background.poster_url, true);
  const overlayColor = previewLandingColor(overlay.color);
  const overlayAlpha = previewLandingAlpha(overlay.alpha);
  const titleType = title.type === "text" || title.type === "image" || title.type === "none" ? title.type : null;
  const titleText = boundedText(title.text, 0, LANDING_LIMITS.title_text_en);
  const titleImageUrl = webUrl(title.image_url, true);
  const titleWidth = integer(titleImageLayout.width_percent, 20, 100);
  const titleOffset = integer(titleImageLayout.offset_percent, -40, 40);
  const titleFont = previewLandingFont(titleStyle.font);
  const titleSize = integer(titleStyle.size, 12, 72);
  const titleColor = previewLandingColor(titleStyle.color);
  const titleAlign = previewLandingAlign(titleStyle.align);
  const descriptionText = boundedText(description.text, 1, LANDING_LIMITS.description_en);
  const descriptionHidden = boolean(description.hidden);
  const descriptionFont = previewLandingFont(descriptionStyle.font);
  const descriptionSize = integer(descriptionStyle.size, 10, 40);
  const descriptionColor = previewLandingColor(descriptionStyle.color);
  const descriptionAlign = previewLandingAlign(descriptionStyle.align);
  const backdropColor = previewLandingColor(descriptionBackdrop.color);
  const backdropAlpha = previewLandingAlpha(descriptionBackdrop.alpha);
  const cornerRadius = integer(buttons.corner_radius, 0, 32);
  const phoneLabel = boundedText(phone.label, 1, 40);
  const phoneBackground = previewLandingColor(phone.background);
  const phoneTextColor = previewLandingColor(phone.text_color);
  const phoneFont = previewLandingFont(phone.font);
  const phoneSize = integer(phone.size, 12, 24);
  const emailLabel = boundedText(email.label, 1, 40);
  const emailBackground = previewLandingColor(email.background);
  const emailTextColor = previewLandingColor(email.text_color);
  const emailFont = previewLandingFont(email.font);
  const emailSize = integer(email.size, 12, 24);
  const appleStyle = typeof apple.style === "string" && (APPEARANCE_LANDING_APPLE_STYLES as readonly string[]).includes(apple.style)
    ? apple.style as AppearanceLandingAppleStyle
    : null;
  const footerText = boundedText(footer.text, 1, 300);
  const footerBackgroundColor = previewLandingColor(footerBackground.color);
  const footerBackgroundAlpha = previewLandingAlpha(footerBackground.alpha);
  const footerFont = previewLandingFont(footerStyle.font);
  const footerSize = integer(footerStyle.size, 10, 18);
  const footerTextColor = previewLandingColor(footerStyle.color);
  const textGapValue = integer(textGap.value, 0, 200);
  const textGapUnit = previewLandingLayoutUnit(textGap.unit);
  const footerMinHeightValue = integer(footerMinHeight.value, 0, 300);
  const footerMinHeightUnit = previewLandingLayoutUnit(footerMinHeight.unit);
  const qrEnabled = boolean(qr.enabled);
  const qrBackground = previewLandingColor(qr.background);
  const qrIconColor = previewLandingColor(qr.icon_color);

  if (backgroundType === null || backgroundUrl === null || posterUrl === null || overlayColor === null || overlayAlpha === null
    || titleType === null || titleText === null || titleImageUrl === null || titleWidth === null || titleOffset === null
    || titleFont === null || titleSize === null || titleColor === null || titleAlign === null
    || descriptionText === null || descriptionHidden === null || descriptionFont === null || descriptionSize === null || descriptionColor === null
    || descriptionAlign === null || backdropColor === null || backdropAlpha === null || cornerRadius === null
    || phoneLabel === null || phoneBackground === null || phoneTextColor === null || phoneFont === null || phoneSize === null
    || emailLabel === null || emailBackground === null || emailTextColor === null || emailFont === null || emailSize === null
    || appleStyle === null || footerText === null || !appearanceFooterTextHasExactTags(footerText)
    || footerBackgroundColor === null || footerBackgroundAlpha === null || footerFont === null || footerSize === null
    || footerTextColor === null || textGapValue === null || textGapUnit === null
    || footerMinHeightValue === null || footerMinHeightUnit === null
    || qrEnabled === null || qrBackground === null || qrIconColor === null) return null;

  if (backgroundType === "image" && posterUrl !== "") return null;
  if (backgroundType === "video" && backgroundUrl === "") return null;
  if (titleType === "text" && titleImageUrl !== "") return null;
  if (titleType === "image" && (titleImageUrl === "" || titleText !== "")) return null;
  if (titleType === "none" && (titleText !== "" || titleImageUrl !== "")) return null;

  const v2: AppearancePreviewLandingV2 = {
    background: { type: backgroundType, url: backgroundUrl, poster_url: posterUrl, overlay: { color: overlayColor, alpha: overlayAlpha } },
    title: {
      type: titleType,
      text: titleText,
      image_url: titleImageUrl,
      image: { width_percent: titleWidth, offset_percent: titleOffset },
      style: { font: titleFont, size: titleSize, color: titleColor, align: titleAlign },
    },
    description: {
      text: descriptionText,
      hidden: descriptionHidden,
      style: { font: descriptionFont, size: descriptionSize, color: descriptionColor, align: descriptionAlign },
      backdrop: { color: backdropColor, alpha: backdropAlpha },
    },
    layout: {
      text_gap: { value: textGapValue, unit: textGapUnit },
      footer_min_height: { value: footerMinHeightValue, unit: footerMinHeightUnit },
    },
    buttons: {
      corner_radius: cornerRadius,
      phone: { label: phoneLabel, background: phoneBackground, text_color: phoneTextColor, font: phoneFont, size: phoneSize },
      email: { label: emailLabel, background: emailBackground, text_color: emailTextColor, font: emailFont, size: emailSize },
      apple: { style: appleStyle },
    },
    footer: {
      text: footerText,
      background: { color: footerBackgroundColor, alpha: footerBackgroundAlpha },
      style: { font: footerFont, size: footerSize, color: footerTextColor },
    },
    qr: { enabled: qrEnabled, background: qrBackground, icon_color: qrIconColor },
  };
  return {
    schema: 2,
    background: { type: backgroundType, url: backgroundUrl, poster_url: posterUrl },
    title: { type: titleType, text: titleText, image_url: titleImageUrl },
    description: descriptionText,
    v2,
  };
}

function parsePreviewLanding(value: unknown): AppearancePreviewLanding | null {
  const source = record(value);
  if (!source) return null;
  return Object.keys(source).length === 3 ? parsePreviewLandingV1(source) : parsePreviewLandingV2(source);
}

const PREVIEW_HERO_KEYS = [
  "id", "media_url", "type", "forward_url", "image_url", "destination_url",
  "title", "subtitle", "link_title", "text_style",
] as const;

function parsePreviewHeroItem(value: unknown): AppearancePreviewHeroItem | null {
  const source = record(value);
  if (!source || !exactKeys(source, PREVIEW_HERO_KEYS)) return null;
  const id = boundedText(source.id, 1, MAX_ID_LENGTH);
  const media = webUrl(source.media_url, false);
  const type = source.type === "image" || source.type === "video" ? source.type : null;
  const forward = webUrl(source.forward_url, true);
  const title = boundedText(source.title, 0, 160);
  const subtitle = boundedText(source.subtitle, 0, 160);
  const linkTitle = boundedText(source.link_title, 0, 80);
  const textStyle = parsePreviewTextStyle(source.text_style);
  if (id === null || media === null || type === null || forward === null
    || title === null || subtitle === null || linkTitle === null
    || source.image_url !== media || source.destination_url !== forward
    || textStyle === null) return null;
  return { id, media_url: media, type, forward_url: forward, title, subtitle, link_title: linkTitle, text_style: textStyle };
}

const PREVIEW_STYLE_KEYS = [
  "title_size", "title_color", "title_weight", "subtitle_size", "subtitle_color", "subtitle_weight",
] as const;

/** `AppearanceRuleService::heroStyle()` per platform: exact six keys, closed domains. */
function parsePreviewTextStyle(value: unknown): Record<AppearanceHeroPlatform, AppearancePreviewHeroStyle> | null {
  const source = record(value);
  if (!source || !exactKeys(source, ["web", "mobile"])) return null;
  const result = {} as Record<AppearanceHeroPlatform, AppearancePreviewHeroStyle>;
  for (const platform of ["web", "mobile"] as const) {
    const style = record(source[platform]);
    if (!style || !exactKeys(style, PREVIEW_STYLE_KEYS)) return null;
    const titleSize = style.title_size === null ? null : integer(style.title_size, 10, 120);
    const subtitleSize = style.subtitle_size === null ? null : integer(style.subtitle_size, 10, 120);
    const titleColor = heroColor(style.title_color);
    const subtitleColor = heroColor(style.subtitle_color);
    const weights = [style.title_weight, style.subtitle_weight];
    if ((style.title_size !== null && titleSize === null) || (style.subtitle_size !== null && subtitleSize === null)
      || titleColor === null || subtitleColor === null
      || !weights.every((weight) => typeof weight === "string" && (APPEARANCE_HERO_TEXT_WEIGHTS as readonly string[]).includes(weight))) return null;
    result[platform] = {
      title_size: titleSize,
      title_color: titleColor,
      title_weight: style.title_weight as string,
      subtitle_size: subtitleSize,
      subtitle_color: subtitleColor,
      subtitle_weight: style.subtitle_weight as string,
    };
  }
  return result;
}

function parsePreviewLandingFlat(value: unknown): AppearanceLandingDraft | null {
  const source = record(value);
  if (!source || !exactKeys(source, APPEARANCE_LANDING_KEYS)) return null;
  const landing = parseAppearanceLanding(source);
  return landing as AppearanceLandingDraft | null;
}

function parsePreviewLandingDefaults(value: unknown): AppearanceLandingDraft | null {
  const defaults = parsePreviewLandingFlat(value);
  if (!defaults) return null;
  const emptyAssetDefaults: readonly AppearanceLandingKey[] = [
    "background_url",
    "background_poster_url",
    "title_image_url",
  ];
  if (APPEARANCE_LANDING_KEYS.some((key) => defaults[key] === "" && !emptyAssetDefaults.includes(key))) return null;
  return defaults;
}

function parsePreviewLandingFlatSources(
  value: unknown,
  landingFlat: AppearanceLandingDraft,
): AppearanceLandingFlatSources | null {
  const source = record(value);
  if (!source || !exactKeys(source, APPEARANCE_LANDING_KEYS)) return null;
  const sources = {} as AppearanceLandingFlatSources;
  for (const key of APPEARANCE_LANDING_KEYS) {
    const raw = record(source[key]);
    if (!raw || !exactKeys(raw, ["scope", "rule_id"])) return null;
    const scope = typeof raw.scope === "string" && (APPEARANCE_LANDING_FLAT_SOURCE_SCOPES as readonly string[]).includes(raw.scope)
      ? raw.scope as AppearanceLandingFlatSourceScope
      : null;
    const ruleId = raw.rule_id === "" ? "" : appearanceRuleId(raw.rule_id);
    if (scope === null || ruleId === null
      || (scope === "none" ? ruleId !== "" || landingFlat[key] !== "" : ruleId === "" || landingFlat[key] === "")) return null;
    sources[key] = { scope, rule_id: ruleId };
  }
  for (const [left, right] of [
    ["background_type", "background_url"],
    ["overlay_color", "overlay_alpha"],
    ["description_backdrop_color", "description_backdrop_alpha"],
    ["footer_bg_color", "footer_bg_alpha"],
    ["text_gap_value", "text_gap_unit"],
    ["footer_min_height_value", "footer_min_height_unit"],
  ] as const) {
    const leftSet = landingFlat[left] !== "";
    const rightSet = landingFlat[right] !== "";
    if (leftSet !== rightSet) return null;
    if (leftSet && (sources[left].scope !== sources[right].scope || sources[left].rule_id !== sources[right].rule_id)) return null;
  }
  if (landingFlat.title_type === "image" && landingFlat.title_image_url === "") return null;
  return sources;
}

/** App appearance material, plus the closed Webadmin-only schema-2 flat provenance sibling. */
export function parseAppearancePreviewPayload(value: unknown): AppearancePreviewPayload | null {
  const source = record(value);
  if (!source) return null;
  const appKeys = ["revision", "content_version", "landing", "hero", "palette", "matched"] as const;
  const webadminKeys = [...appKeys, "landing_flat", "landing_flat_sources", "landing_flat_defaults"] as const;
  const webadminV2 = exactKeys(source, webadminKeys);
  if (!webadminV2 && !exactKeys(source, appKeys)) return null;
  const revision = integer(source.revision, 0, Number.MAX_SAFE_INTEGER);
  // Finding 7: Core's `content_version` is always a lowercase SHA-256 hex digest.
  const contentVersion = typeof source.content_version === "string" && CONTENT_VERSION.test(source.content_version)
    ? source.content_version
    : null;
  const landing = parsePreviewLanding(source.landing);
  const landingFlat = webadminV2 ? parsePreviewLandingFlat(source.landing_flat) : null;
  const landingFlatSources = webadminV2 && landingFlat
    ? parsePreviewLandingFlatSources(source.landing_flat_sources, landingFlat)
    : null;
  const landingFlatDefaults = webadminV2 ? parsePreviewLandingDefaults(source.landing_flat_defaults) : null;
  const palette = parseAppearanceFullPalette(source.palette);
  const matched = record(source.matched);
  if (revision === null || contentVersion === null || !landing || !palette
    || (webadminV2 && (landing.schema !== 2 || landingFlat === null || landingFlatSources === null || landingFlatDefaults === null))
    || !Array.isArray(source.hero)
    || source.hero.length > MAX_APPEARANCE_PREVIEW_HERO_ITEMS
    || !matched || !exactKeys(matched, ["scope", "rule_id", "location_source"])) return null;
  const hero: AppearancePreviewHeroItem[] = [];
  for (const raw of source.hero) {
    const item = parsePreviewHeroItem(raw);
    if (!item) return null;
    hero.push(item);
  }
  // Finding 7: `heroWire()` emits stored items, whose ids are non-empty and unique.
  if (new Set(hero.map((item) => item.id)).size !== hero.length) return null;
  const scope = typeof matched.scope === "string" && (APPEARANCE_MATCHED_SCOPES as readonly string[]).includes(matched.scope)
    ? matched.scope as AppearanceMatchedScope
    : null;
  const ruleId = matched.rule_id === "" ? "" : appearanceRuleId(matched.rule_id);
  const locationSource = typeof matched.location_source === "string"
    && (APPEARANCE_LOCATION_SOURCES as readonly string[]).includes(matched.location_source)
    ? matched.location_source as AppearanceLocationSource
    : null;
  if (scope === null || ruleId === null || locationSource === null) return null;
  // `default` = compiled defaults and no rule; every other scope names the rule that won.
  if (scope === "default" ? ruleId !== "" : ruleId === "") return null;
  // Finding 10: the default match is exactly the empty chain (revision 0); any rule match has
  // revision ≥ 1; a geo match needs real GPS or IP evidence.
  if (scope === "default" ? revision !== 0 : revision < 1) return null;
  if (scope === "geo" && locationSource === "none") return null;
  return {
    revision,
    content_version: contentVersion,
    landing,
    hero,
    palette,
    matched: { scope, rule_id: ruleId, location_source: locationSource },
    landing_flat: landingFlat,
    landing_flat_sources: landingFlatSources,
    landing_flat_defaults: landingFlatDefaults,
  };
}

/**
 * Flatten one localized presentation response back to comparable field names.
 * Amendment v1.4 parent merges use `landing_flat` instead; this helper remains
 * for saved-state comparison with Core's localized nested presentation.
 */
export function appearancePreviewLandingFields(
  landing: AppearancePreviewLanding,
  language: "en" | "hu",
): AppearanceLanding {
  const fields: AppearanceLanding = {
    background_type: landing.background.type,
    background_url: landing.background.url,
    background_poster_url: landing.background.poster_url,
    title_type: landing.title.type,
    [`title_text_${language}`]: landing.title.text,
    title_image_url: landing.title.image_url,
    [`description_${language}`]: landing.description,
  };
  const v2 = landing.v2;
  if (!v2) return fields;
  return {
    ...fields,
    overlay_color: v2.background.overlay.color,
    overlay_alpha: v2.background.overlay.alpha.toFixed(2),
    title_font: v2.title.style.font,
    title_size: String(v2.title.style.size),
    title_color: v2.title.style.color,
    title_align: v2.title.style.align,
    title_image_width_percent: String(v2.title.image.width_percent),
    title_image_offset_percent: String(v2.title.image.offset_percent),
    description_font: v2.description.style.font,
    description_size: String(v2.description.style.size),
    description_color: v2.description.style.color,
    description_align: v2.description.style.align,
    description_backdrop_color: v2.description.backdrop.color,
    description_backdrop_alpha: v2.description.backdrop.alpha.toFixed(2),
    button_corner_radius: String(v2.buttons.corner_radius),
    [`button_phone_label_${language}`]: v2.buttons.phone.label,
    button_phone_bg: v2.buttons.phone.background,
    button_phone_text_color: v2.buttons.phone.text_color,
    button_phone_font: v2.buttons.phone.font,
    button_phone_size: String(v2.buttons.phone.size),
    [`button_email_label_${language}`]: v2.buttons.email.label,
    button_email_bg: v2.buttons.email.background,
    button_email_text_color: v2.buttons.email.text_color,
    button_email_font: v2.buttons.email.font,
    button_email_size: String(v2.buttons.email.size),
    button_apple_style: v2.buttons.apple.style,
    [`footer_text_${language}`]: v2.footer.text,
    footer_bg_color: v2.footer.background.color,
    footer_bg_alpha: v2.footer.background.alpha.toFixed(2),
    footer_text_color: v2.footer.style.color,
    footer_font: v2.footer.style.font,
    footer_size: String(v2.footer.style.size),
    qr_enabled: v2.qr.enabled ? "true" : "false",
    qr_bg_color: v2.qr.background,
    qr_icon_color: v2.qr.icon_color,
    description_hidden: v2.description.hidden ? "true" : "false",
    text_gap_value: String(v2.layout.text_gap.value),
    text_gap_unit: v2.layout.text_gap.unit,
    footer_min_height_value: String(v2.layout.footer_min_height.value),
    footer_min_height_unit: v2.layout.footer_min_height.unit,
  };
}

export type AppearanceLandingDifference = {
  field: AppearanceLandingKey;
  local: string;
  core: string;
};

/** Compare only fields actually projected by this localized Core response. */
export function compareAppearanceLandingWithPreview(
  local: AppearanceLandingDraft,
  preview: AppearancePreviewLanding,
  language: "en" | "hu",
): AppearanceLandingDifference[] {
  const core = appearancePreviewLandingFields(preview, language);
  const differences: AppearanceLandingDifference[] = [];
  for (const key of APPEARANCE_LANDING_KEYS) {
    if (!Object.hasOwn(core, key)) continue;
    const coreValue = core[key] ?? "";
    if (local[key] !== coreValue) differences.push({ field: key, local: local[key], core: coreValue });
  }
  return differences;
}

/** `appearance_city_geocode` material (Amendment v1.2 §3). */
export function parseAppearanceGeocodePayload(value: unknown): AppearanceGeocodeCandidate[] | null {
  const source = record(value);
  if (!source || !exactKeys(source, ["candidates"]) || !Array.isArray(source.candidates)) return null;
  // Finding 8: Core returns 0..5 candidates de-duplicated by `place_id` (≤ 256 UTF-8 bytes),
  // each with a non-empty alpha-2 country and an integer radius in 1..500 after its ceil.
  if (source.candidates.length > MAX_APPEARANCE_GEOCODE_CANDIDATES) return null;
  const candidates: AppearanceGeocodeCandidate[] = [];
  const seen = new Set<string>();
  for (const raw of source.candidates) {
    const candidate = record(raw);
    if (!candidate || !exactKeys(candidate, ["place_id", "place_label", "country_code", "center", "radius_km"])) return null;
    const placeId = boundedText(candidate.place_id, 1, MAX_APPEARANCE_PLACE_ID_BYTES);
    const placeLabel = boundedText(candidate.place_label, 1, MAX_APPEARANCE_PLACE_LABEL_LENGTH);
    const country = typeof candidate.country_code === "string" && isAppearanceAlpha2(candidate.country_code) ? candidate.country_code : null;
    const center = parseCenter(candidate.center);
    const radius = integer(candidate.radius_km, MIN_APPEARANCE_RADIUS_KM, MAX_APPEARANCE_RADIUS_KM);
    if (placeId === null || placeLabel === null || country === null || !center || radius === null) return null;
    if (new TextEncoder().encode(placeId).length > MAX_APPEARANCE_PLACE_ID_BYTES || seen.has(placeId)) return null;
    seen.add(placeId);
    candidates.push({ place_id: placeId, place_label: placeLabel, country_code: country, center, radius_km: radius });
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Inheritance (per field down the chain, most specific first, defaults last).
// The editor cannot know the device storefront, so it layers rule → global →
// defaults; Core's preview endpoint is the authority for a concrete location.
// ---------------------------------------------------------------------------

export type AppearancePaletteSource = "rule" | "inherited" | "default";

export type ResolvedAppearancePalette = {
  values: AppearanceFullPalette;
  sources: Record<AppearancePaletteMode, Record<AppearancePaletteRole, AppearancePaletteSource>>;
};

export function resolveAppearancePalette(
  chain: readonly AppearancePalette[],
  defaults: AppearanceFullPalette,
): ResolvedAppearancePalette {
  const values = { light: { ...defaults.light }, dark: { ...defaults.dark } } as AppearanceFullPalette;
  const sources = {
    light: {} as Record<AppearancePaletteRole, AppearancePaletteSource>,
    dark: {} as Record<AppearancePaletteRole, AppearancePaletteSource>,
  };
  for (const mode of APPEARANCE_PALETTE_MODES) {
    for (const role of APPEARANCE_PALETTE_ROLES) {
      sources[mode][role] = "default";
      for (const [index, palette] of chain.entries()) {
        const hex = palette[mode][role];
        if (hex !== undefined) {
          values[mode][role] = hex;
          sources[mode][role] = index === 0 ? "rule" : "inherited";
          break;
        }
      }
    }
  }
  return { values, sources };
}

export type ResolvedAppearanceLanding = {
  backgroundType: "image" | "video";
  backgroundUrl: string;
  posterUrl: string;
  titleType: "text" | "image" | "none";
  titleText: string;
  titleImageUrl: string;
  description: string;
  descriptionHidden: boolean;
  footerText: string;
  phoneLabel: string;
  emailLabel: string;
  /** Every effective flat value, after per-field inheritance. */
  effective: AppearanceLandingDraft;
};

/** The first document in precedence order that actually supplies the field, else `""`. */
function chainField(chain: readonly AppearanceLanding[], key: AppearanceLandingKey): string {
  for (const doc of chain) {
    const value = appearanceTrim(doc[key] ?? "");
    if (value !== "") return value;
  }
  return "";
}

/** The first document in precedence order that actually supplies the field, else the compiled default. */
function landingField(chain: readonly AppearanceLanding[], defaults: AppearanceLandingDraft, key: AppearanceLandingKey): string {
  return chainField(chain, key) || appearanceTrim(defaults[key]);
}

/**
 * Released Core `AppearanceResolverService::localizedLandingField()` (T-468b
 * finding 4): the complete requested-language rule chain, then the complete
 * English rule chain, and only then the compiled default — requested language
 * first, English last. Defaults never enter either chain search.
 */
function landingText(
  chain: readonly AppearanceLanding[],
  defaults: AppearanceLandingDraft,
  key: "title_text" | "description" | "button_phone_label" | "button_email_label" | "footer_text",
  language: "en" | "hu",
): string {
  return chainField(chain, `${key}_${language}`)
    || chainField(chain, `${key}_en`)
    || appearanceTrim(defaults[`${key}_${language}`])
    || appearanceTrim(defaults[`${key}_en`]);
}

/** Resolve every flat string independently, before language projection. */
export function resolveAppearanceLandingFields(
  chain: readonly AppearanceLanding[],
  defaults: AppearanceLandingDraft,
): AppearanceLandingDraft {
  const result = {} as AppearanceLandingDraft;
  for (const key of APPEARANCE_LANDING_KEYS) result[key] = landingField(chain, defaults, key);
  return result;
}

/**
 * Amendment v1.5: every landing field inherits on its own down the chain
 * (geo → storefront → global) and then the compiled default, with the
 * localized blank-to-English fallback. The poster is part of the output only
 * when the effective background is a video.
 */
export function resolveAppearanceLanding(
  chain: readonly AppearanceLanding[],
  defaults: AppearanceLandingDraft,
  language: "en" | "hu",
): ResolvedAppearanceLanding {
  const effective = resolveAppearanceLandingFields(chain, defaults);
  const backgroundType = effective.background_type === "video" ? "video" : "image";
  const titleType = effective.title_type === "image" || effective.title_type === "none" ? effective.title_type : "text";
  return {
    backgroundType,
    backgroundUrl: effective.background_url,
    posterUrl: backgroundType === "video" ? effective.background_poster_url : "",
    titleType,
    titleText: landingText(chain, defaults, "title_text", language),
    titleImageUrl: effective.title_image_url,
    description: landingText(chain, defaults, "description", language),
    descriptionHidden: effective.description_hidden === "true",
    footerText: landingText(chain, defaults, "footer_text", language),
    phoneLabel: landingText(chain, defaults, "button_phone_label", language),
    emailLabel: landingText(chain, defaults, "button_email_label", language),
    effective,
  };
}

export type AppearanceLandingPreviewLayout = {
  textGap: number;
  footerMinHeight: number;
};

/**
 * Contract v1.7 preview maths. Points map one-to-one to CSS pixels inside the
 * exact 390×844 frame; percentages use the screen-height axis.
 */
export function appearanceLandingLayoutPixels(
  fields: AppearanceLandingDraft,
  screenHeight = APPEARANCE_LANDING_PREVIEW_HEIGHT,
): AppearanceLandingPreviewLayout {
  const height = Number.isFinite(screenHeight) && screenHeight >= 0
    ? screenHeight
    : APPEARANCE_LANDING_PREVIEW_HEIGHT;
  const pixels = (
    valueKey: "text_gap_value" | "footer_min_height_value",
    unitKey: "text_gap_unit" | "footer_min_height_unit",
    maximum: number,
    fallbackValue: number,
  ) => {
    const value = parseAppearanceLandingInteger(fields[valueKey], 0, maximum) ?? fallbackValue;
    const unit = (APPEARANCE_LANDING_LAYOUT_UNITS as readonly string[]).includes(fields[unitKey])
      ? fields[unitKey] as AppearanceLandingLayoutUnit
      : "pt";
    return unit === "percent" ? value * height / 100 : value;
  };
  return {
    textGap: pixels("text_gap_value", "text_gap_unit", 200, 24),
    footerMinHeight: pixels("footer_min_height_value", "footer_min_height_unit", 300, 0),
  };
}

/** Core `heroWire()`: the replacing rule's active items, sorted, and at most the first ten (finding 15). */
export function resolveAppearanceHero(chain: readonly AppearanceHero[]): AppearanceHeroItem[] {
  const replacing = chain.find((hero) => hero.mode === "replace");
  if (!replacing) return [];
  return [...replacing.items]
    .filter((item) => item.active)
    .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id))
    .slice(0, MAX_APPEARANCE_EFFECTIVE_HERO_ITEMS);
}

// ---------------------------------------------------------------------------
// Editor draft ↔ wire
// ---------------------------------------------------------------------------

/**
 * A title-type change touches ONLY `title_type` (T-468b finding 14): the
 * text fields and the image URL are independent per-field overrides that
 * persist until the operator clears them explicitly.
 */
export function appearanceLandingWithTitleType(landing: AppearanceLandingDraft, titleType: string): AppearanceLandingDraft {
  const next = titleType === "image" || titleType === "text" || titleType === "none" ? titleType : "";
  return next === landing.title_type ? landing : { ...landing, title_type: next };
}

/**
 * T-492: a landed logo upload switches the draft title type to `image` in the
 * same patch, so the preview shows the logo immediately and the save-time
 * coherence rule (`image` requires `title_image_url`) is satisfied. The
 * switch applies from inherit and `text`, and deliberately also from an
 * explicit `none`: the operator uploading a logo clearly wants it shown.
 * Removing the logo always returns the draft type to inherit in the same
 * patch, including after a later manual text/none choice, so removal has one
 * predictable result and no image-without-URL draft can remain.
 */
export function appearanceLandingLogoSelection(landing: AppearanceLandingDraft, url: string): AppearanceLandingDraft {
  const titleType = appearanceTrim(url) !== "" ? "image" : "";
  return landing.title_image_url === url && landing.title_type === titleType
    ? landing
    : { ...landing, title_image_url: url, title_type: titleType };
}

export type AppearanceLandingLayoutPair = "text_gap" | "footer_min_height";

/**
 * Contract v1.7 pairs are edited atomically. Setting either member fills the
 * other from the effective composition; clearing either member clears both so
 * the pair returns to inherit without a transient half-override.
 */
export function appearanceLandingLayoutPairSelection(
  landing: AppearanceLandingDraft,
  effective: AppearanceLandingDraft,
  pair: AppearanceLandingLayoutPair,
  member: "value" | "unit",
  selection: string,
): AppearanceLandingDraft {
  const valueKey = pair === "text_gap" ? "text_gap_value" : "footer_min_height_value";
  const unitKey = pair === "text_gap" ? "text_gap_unit" : "footer_min_height_unit";
  const value = selection === ""
    ? ""
    : member === "value" ? selection : landing[valueKey] || effective[valueKey];
  const unit = selection === ""
    ? ""
    : member === "unit" ? selection : landing[unitKey] || effective[unitKey];
  return landing[valueKey] === value && landing[unitKey] === unit
    ? landing
    : { ...landing, [valueKey]: value, [unitKey]: unit };
}

/**
 * T-492: the persistent hint under the logo field — a resolved logo value is
 * present yet the EFFECTIVE title type will not render it. This includes a
 * locally uploaded logo followed by a manual type change and a logo inherited
 * from another rule, because flat overrides persist independently.
 */
export function appearanceLandingLogoHintVisible(
  logoUrl: string,
  effectiveTitleType: ResolvedAppearanceLanding["titleType"],
): boolean {
  return appearanceTrim(logoUrl) !== "" && effectiveTitleType !== "image";
}

export type AppearanceLandingBackgroundType = "image" | "video";

/**
 * A background-type choice is only an upload mode until matching media exists.
 * Switching type therefore clears the stored pair atomically and returns the
 * requested uploader separately; clearing media always returns both fields to
 * inherit. The save-time coherence check remains the final guard.
 */
export function appearanceLandingBackgroundSelection(
  landing: AppearanceLandingDraft,
  selectedType: string,
): {
  draft: AppearanceLandingDraft;
  pendingType: AppearanceLandingBackgroundType | null;
} {
  const pendingType = selectedType === "image" || selectedType === "video" ? selectedType : null;
  if (pendingType !== null
    && landing.background_type === pendingType
    && appearanceTrim(landing.background_url) !== "") {
    return { draft: landing, pendingType: null };
  }
  const draft = landing.background_type === "" && landing.background_url === ""
    ? landing
    : { ...landing, background_type: "", background_url: "" };
  return { draft, pendingType };
}

export function appearanceLandingDraft(landing: AppearanceLanding): AppearanceLandingDraft {
  const draft = {} as AppearanceLandingDraft;
  for (const key of APPEARANCE_LANDING_KEYS) draft[key] = landing[key] ?? "";
  return draft;
}

/**
 * Per-field wire (Amendment v1.5): a blank editor field inherits and is
 * absent; a filled one is sent. The save-time pairing rule is built into the
 * validation refuses paired fields that are not set or inherited together
 * before the resulting sparse object can cross the proxy boundary.
 */
export function appearanceLandingWire(draft: AppearanceLandingDraft): AppearanceLanding {
  const wire: AppearanceLanding = {};
  for (const key of APPEARANCE_LANDING_KEYS) {
    const value = appearanceTrim(draft[key]);
    if (value !== "") wire[key] = value;
  }
  return wire;
}

/**
 * Validate every style-bearing draft field before it can enter the local
 * merge. Invalid values are omitted, so resolution falls back to the parent
 * chain or compiled default; callers receive the exact fields to mark invalid.
 */
export function appearanceLandingPreviewDraft(draft: AppearanceLandingDraft): {
  landing: AppearanceLanding;
  invalidFields: AppearanceLandingKey[];
} {
  const landing = appearanceLandingWire(draft);
  const invalidFields: AppearanceLandingKey[] = [];
  for (const key of APPEARANCE_LANDING_PREVIEW_STYLE_KEYS) {
    const raw = draft[key];
    const trimmed = appearanceTrim(raw);
    const invalid = !coreString(raw)
      || (trimmed !== "" && ([...trimmed].length > LANDING_LIMITS[key] || !appearanceLandingFieldValid(key, trimmed)));
    if (!invalid) continue;
    delete landing[key];
    invalidFields.push(key);
  }
  return { landing, invalidFields };
}

/**
 * Amendment v1.5 save-time coherence: `background_type` and `background_url`
 * are set together in one rule, and `title_type = image` brings its
 * `title_image_url`. Core refuses anything else with
 * `appearance-rule-landing-invalid`; the proxy refuses it first.
 */
export function appearanceLandingCoherent(landing: AppearanceLanding): boolean {
  // T-468b finding 5: a present URL key is a NON-EMPTY validated URL, never "" or whitespace.
  for (const key of ["background_url", "background_poster_url", "title_image_url"] as const) {
    if (landing[key] !== undefined && appearanceTrim(landing[key]) === "") return false;
  }
  const set = (key: AppearanceLandingKey) => appearanceTrim(landing[key] ?? "") !== "";
  if (set("background_type") !== set("background_url")) return false;
  for (const [color, alpha] of [
    ["overlay_color", "overlay_alpha"],
    ["description_backdrop_color", "description_backdrop_alpha"],
    ["footer_bg_color", "footer_bg_alpha"],
    ["text_gap_value", "text_gap_unit"],
    ["footer_min_height_value", "footer_min_height_unit"],
  ] as const) {
    if (set(color) !== set(alpha)) return false;
  }
  if (landing.title_type === "image" && !set("title_image_url")) return false;
  for (const key of ["footer_text_en", "footer_text_hu"] as const) {
    if (set(key) && !appearanceFooterTextHasExactTags(appearanceTrim(landing[key] ?? ""))) return false;
  }
  return true;
}

export function emptyAppearanceHeroItem(sortOrder: number): AppearanceHeroItem {
  return {
    id: "",
    media_url: "",
    type: "image",
    forward_url: "",
    title_en: "",
    title_hu: "",
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
    title_size_mobile: null,
    title_color_mobile: "",
    title_weight_mobile: "",
    subtitle_size_mobile: null,
    subtitle_color_mobile: "",
    subtitle_weight_mobile: "",
    sort_order: sortOrder,
    active: true,
  };
}

export type AppearanceRuleDraft = {
  id: string;
  revision: number;
  name: string;
  scope: AppearanceScope;
  storefront_country: string;
  country_code: string;
  latitude: string;
  longitude: string;
  radius_km: string;
  place_label: string;
  priority: number;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  landing: AppearanceLandingDraft;
  hero: AppearanceHero;
  palette: AppearancePalette;
};

export function appearanceRuleDraft(rule: AppearanceRule): AppearanceRuleDraft {
  return {
    id: rule.id,
    revision: rule.revision,
    name: rule.name,
    scope: rule.scope,
    storefront_country: rule.storefront_country,
    country_code: rule.country_code,
    latitude: rule.center ? String(rule.center.latitude) : "",
    longitude: rule.center ? String(rule.center.longitude) : "",
    radius_km: rule.radius_km === null ? "" : String(rule.radius_km),
    place_label: rule.place_label,
    priority: rule.priority,
    active: rule.active,
    starts_at: rule.starts_at,
    ends_at: rule.ends_at,
    landing: appearanceLandingDraft(rule.landing),
    hero: { mode: rule.hero.mode, items: rule.hero.items.map((item) => ({ ...item })) },
    palette: { light: { ...rule.palette.light }, dark: { ...rule.palette.dark } },
  };
}

export function newAppearanceRuleDraft(scope: AppearanceScope, name: string, priority: number): AppearanceRuleDraft {
  return {
    id: "",
    revision: 0,
    name,
    scope,
    storefront_country: "",
    country_code: "",
    latitude: "",
    longitude: "",
    radius_km: "",
    place_label: "",
    priority,
    active: true,
    starts_at: null,
    ends_at: null,
    landing: appearanceLandingDraft({}),
    hero: { mode: "inherit", items: [] },
    palette: { light: {}, dark: {} },
  };
}

export type AppearanceDraftError =
  | "name"
  | "storefront"
  | "geo"
  | "countryCode"
  | "priority"
  | "window"
  | "background"
  | "poster"
  | "titleImage"
  | "titleImageRequired"
  | "landingControl"
  | "landingValue"
  | "landingPair"
  | "footerTags"
  | "heroItem"
  | "heroTypography"
  | "palette";

function numberInput(value: string): number | null {
  const trimmed = appearanceTrim(value);
  if (trimmed === "" || !/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function heroItemValid(item: AppearanceHeroItem): AppearanceDraftError | null {
  if (!isAppearanceHttpsUrl(item.media_url) || !isAppearanceHttpsUrl(item.forward_url, true)) return "heroItem";
  if (boundedText(item.id, 0, MAX_ID_LENGTH) === null) return "heroItem";
  for (const [key, limit] of [
    ["title_en", 160], ["title_hu", 160], ["subtitle_en", 160], ["subtitle_hu", 160],
    ["link_title_en", 80], ["link_title_hu", 80],
  ] as const) {
    if (boundedText(item[key], 0, limit) === null) return "heroItem";
  }
  if (!Number.isInteger(item.sort_order) || item.sort_order < 0 || item.sort_order > MAX_APPEARANCE_PRIORITY) return "heroItem";
  for (const platform of ["web", "mobile"] as const) {
    for (const text of ["title", "subtitle"] as const) {
      const size = item[`${text}_size_${platform}`];
      const color = item[`${text}_color_${platform}`];
      const weight = item[`${text}_weight_${platform}`];
      if (size !== null && (!Number.isInteger(size) || size < 10 || size > 120)) return "heroTypography";
      if (heroColor(color) === null) return "heroTypography";
      if (!(APPEARANCE_HERO_TEXT_WEIGHTS as readonly string[]).includes(weight)) return "heroTypography";
    }
  }
  return null;
}

/** Conservative client validation; Core re-validates every field on save. */
export function validateAppearanceRuleDraft(draft: AppearanceRuleDraft): AppearanceDraftError | null {
  if (boundedText(draft.name, 1, MAX_APPEARANCE_NAME_LENGTH) === null) return "name";
  if (draft.scope === "storefront" && !isAppearanceStorefront(draft.storefront_country)) return "storefront";
  if (draft.scope === "geo") {
    const latitude = numberInput(draft.latitude);
    const longitude = numberInput(draft.longitude);
    const radius = numberInput(draft.radius_km);
    if (latitude === null || longitude === null || radius === null
      || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
      || radius < MIN_APPEARANCE_RADIUS_KM || radius > MAX_APPEARANCE_RADIUS_KM
      || boundedText(draft.place_label, 1, MAX_APPEARANCE_PLACE_LABEL_LENGTH) === null) return "geo";
    if (draft.country_code !== "" && !isAppearanceAlpha2(draft.country_code)) return "countryCode";
  }
  if (!Number.isInteger(draft.priority) || draft.priority < 0 || draft.priority > MAX_APPEARANCE_PRIORITY) return "priority";
  if (!appearanceTimestampsOrdered(draft.starts_at, draft.ends_at)) return "window";
  const landing = draft.landing;
  // T-468b finding 22: controls on the ORIGINAL draft strings are refused for every landing
  // key before `appearanceLandingWire()` could trim them away (Core's `normalizeLanding()`).
  for (const key of APPEARANCE_LANDING_KEYS) {
    if (!coreString(landing[key])) return "landingControl";
  }
  if (!isAppearanceHttpsUrl(landing.background_url, true)) return "background";
  if (!isAppearanceHttpsUrl(landing.background_poster_url, true)) return "poster";
  if (landing.title_type === "image" && appearanceTrim(landing.title_image_url) === "") return "titleImageRequired";
  if (!isAppearanceHttpsUrl(landing.title_image_url, true)) return "titleImage";
  for (const key of ["footer_text_en", "footer_text_hu"] as const) {
    const footer = appearanceTrim(landing[key]);
    if (footer !== "" && !appearanceFooterTextHasExactTags(footer)) return "footerTags";
  }
  const landingWire = appearanceLandingWire(landing);
  const parsedLanding = parseAppearanceLanding(landingWire);
  if (parsedLanding === null) return "landingValue";
  if (!appearanceLandingCoherent(parsedLanding)) return "landingPair";
  if (draft.hero.mode === "replace") {
    if (draft.hero.items.length > MAX_APPEARANCE_HERO_ITEMS) return "heroItem";
    for (const item of draft.hero.items) {
      const error = heroItemValid(item);
      if (error) return error;
    }
  }
  if (parseAppearancePalette(draft.palette) === null) return "palette";
  return null;
}

/** The exact fourteen-key save body for a valid draft (`null` when it is not valid). */
export function appearanceRuleInputFromDraft(draft: AppearanceRuleDraft): AppearanceRuleInput | null {
  if (validateAppearanceRuleDraft(draft) !== null) return null;
  const isGeo = draft.scope === "geo";
  const input: AppearanceRuleInput = {
    name: appearanceTrim(draft.name),
    scope: draft.scope,
    storefront_country: draft.scope === "storefront" ? draft.storefront_country : "",
    country_code: isGeo ? draft.country_code : "",
    center: isGeo ? { latitude: Number(draft.latitude), longitude: Number(draft.longitude) } : null,
    radius_km: isGeo ? Number(draft.radius_km) : null,
    place_label: isGeo ? appearanceTrim(draft.place_label) : "",
    priority: draft.priority,
    active: draft.active,
    starts_at: draft.starts_at,
    ends_at: draft.ends_at,
    landing: appearanceLandingWire(draft.landing),
    hero: draft.hero.mode === "replace"
      ? {
        mode: "replace",
        items: draft.hero.items.map((item) => ({
          ...item,
          media_url: appearanceTrim(item.media_url),
          forward_url: appearanceTrim(item.forward_url),
        })),
      }
      : { mode: "inherit", items: [] },
    palette: { light: { ...draft.palette.light }, dark: { ...draft.palette.dark } },
  };
  return parseAppearanceRuleInput(input);
}

// ---------------------------------------------------------------------------
// Proxy body normalization (`app/api/admin/[action]/route.ts`)
// ---------------------------------------------------------------------------

export function isAppearanceAction(action: string): action is AppearanceAction {
  return (APPEARANCE_ACTIONS as readonly string[]).includes(action);
}

export type AppearancePreviewRequest = {
  storefront_country?: string;
  latitude?: number;
  longitude?: number;
  ip?: string;
  lang?: "en" | "hu";
  appearance_schema?: 1 | 2;
  exclude_rule_id?: string;
  location_mode?: "auto" | "none";
};

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_HEXTET = /^[0-9A-Fa-f]{1,4}$/;

/**
 * Exact textual IPv4 or IPv6 address (RFC 4291 §2.2: hextets of 1–4 hex
 * digits, at most one `::` compression, an optional trailing embedded dotted
 * quad counting as two hextets, exactly eight hextets without compression and
 * at most seven with it). No zone ids, prefixes, ports or brackets.
 */
export function parseAppearanceIpAddress(value: string): string | null {
  const ip = appearanceTrim(value);
  if (IPV4.test(ip)) return ip;
  if (!ip.includes(":") || ip.length > 45 || /[^0-9A-Fa-f:.]/.test(ip)) return null;
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const compressed = halves.length === 2;
  const head = halves[0] === "" ? [] : halves[0]!.split(":");
  const tail = compressed ? (halves[1] === "" ? [] : halves[1]!.split(":")) : [];
  // The dotted quad stands for the final 32 bits, so it may only be the very
  // last textual group: the last of the tail, or the last of the head when
  // nothing is compressed. A quad followed by `::` (`192.0.2.1::`) is refused.
  const finalGroups = compressed ? tail : head;
  let hextets = 0;
  for (const [position, group] of [...head, ...tail].entries()) {
    const isFinal = finalGroups.length > 0 && position === head.length + tail.length - 1;
    if (group.includes(".")) {
      if (!isFinal || !IPV4.test(group)) return null;
      hextets += 2;
      continue;
    }
    if (!IPV6_HEXTET.test(group)) return null;
    hextets += 1;
  }
  if (compressed ? hextets > 7 : hextets !== 8) return null;
  return ip;
}

function parsePreviewRequest(body: Record<string, unknown>): AppearancePreviewRequest | null {
  if (!subsetKeys(body, ["storefront_country", "latitude", "longitude", "ip", "lang", "appearance_schema", "exclude_rule_id", "location_mode"])) return null;
  const request: AppearancePreviewRequest = {};
  if (Object.hasOwn(body, "location_mode")) {
    if (body.location_mode !== "auto" && body.location_mode !== "none") return null;
    if (body.location_mode === "none"
      && ["latitude", "longitude", "ip"].some((key) => Object.hasOwn(body, key))) return null;
    request.location_mode = body.location_mode;
  }
  if (Object.hasOwn(body, "storefront_country") && body.storefront_country !== "") {
    if (typeof body.storefront_country !== "string" || !isAppearanceStorefront(body.storefront_country)) return null;
    request.storefront_country = body.storefront_country;
  }
  const hasLatitude = Object.hasOwn(body, "latitude") && body.latitude !== "" && body.latitude !== null;
  const hasLongitude = Object.hasOwn(body, "longitude") && body.longitude !== "" && body.longitude !== null;
  if (hasLatitude !== hasLongitude) return null;
  if (hasLatitude) {
    const latitude = finite(body.latitude, -90, 90);
    const longitude = finite(body.longitude, -180, 180);
    if (latitude === null || longitude === null) return null;
    request.latitude = latitude;
    request.longitude = longitude;
  }
  if (Object.hasOwn(body, "ip") && body.ip !== "") {
    if (typeof body.ip !== "string") return null;
    const ip = parseAppearanceIpAddress(body.ip);
    if (ip === null) return null;
    request.ip = ip;
  }
  if (Object.hasOwn(body, "lang") && body.lang !== "") {
    if (body.lang !== "en" && body.lang !== "hu") return null;
    request.lang = body.lang;
  }
  if (Object.hasOwn(body, "appearance_schema")) {
    if (body.appearance_schema !== 1 && body.appearance_schema !== 2) return null;
    request.appearance_schema = body.appearance_schema;
  }
  if (Object.hasOwn(body, "exclude_rule_id")) {
    const excluded = appearanceRuleId(body.exclude_rule_id);
    if (excluded === null) return null;
    request.exclude_rule_id = excluded;
  }
  return request;
}

/**
 * `undefined` = not an appearance action (leave the body alone); `null` =
 * refuse with 400; otherwise the exact body forwarded to Core. `coreCall`
 * JSON-encodes the nested `rule` into one form field.
 */
export function normalizeAppearanceProxyBody(
  action: string,
  body: Record<string, unknown>,
): Record<string, unknown> | null | undefined {
  if (!isAppearanceAction(action)) return undefined;
  switch (action) {
    case "appearance_rules_list":
      return {};
    case "appearance_rules_save": {
      if (!exactKeys(body, ["id", "expected_revision", "rule"])) return null;
      // Finding 6: only a create target is empty; an update names a stored rule id.
      const id = body.id === "" ? "" : appearanceRuleId(body.id);
      const expectedRevision = integer(body.expected_revision, 0, Number.MAX_SAFE_INTEGER);
      const rule = parseAppearanceRuleInput(body.rule);
      if (id === null || expectedRevision === null || !rule) return null;
      if ((id === "") !== (expectedRevision === 0)) return null;
      return { id, expected_revision: expectedRevision, rule };
    }
    case "appearance_rules_delete": {
      if (!exactKeys(body, ["id", "expected_revision"])) return null;
      const id = appearanceRuleId(body.id);
      const expectedRevision = integer(body.expected_revision, 1, Number.MAX_SAFE_INTEGER);
      if (id === null || expectedRevision === null) return null;
      return { id, expected_revision: expectedRevision };
    }
    case "appearance_rules_preview": {
      const request = parsePreviewRequest(body);
      return request === null ? null : { ...request };
    }
    case "appearance_city_geocode": {
      if (!exactKeys(body, ["query"], ["lang"])) return null;
      const query = boundedText(body.query, 1, MAX_APPEARANCE_GEOCODE_QUERY_LENGTH);
      if (query === null) return null;
      if (Object.hasOwn(body, "lang") && body.lang !== "en" && body.lang !== "hu") return null;
      return Object.hasOwn(body, "lang") ? { query, lang: body.lang } : { query };
    }
    default:
      return null;
  }
}

/** Precedence order for the operator's list: geo → storefront → global. */
export function sortAppearanceRules(rules: readonly AppearanceRule[]): AppearanceRule[] {
  const rank: Record<AppearanceScope, number> = { geo: 0, storefront: 1, global: 2 };
  return [...rules].sort((left, right) =>
    rank[left.scope] - rank[right.scope]
    || right.priority - left.priority
    || left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id));
}

export function appearanceRuleIsLive(rule: AppearanceRule, now: number): boolean {
  if (!rule.active) return false;
  if (rule.starts_at !== null && Date.parse(rule.starts_at) > now) return false;
  if (rule.ends_at !== null && Date.parse(rule.ends_at) <= now) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Response decoding. Every browser path evaluates Core's exact legacy envelope
// (`lib/webadminEnvelope.ts`) or the bridge's exact refusal before any domain
// material is trusted, and every write success is bound to its target.
// ---------------------------------------------------------------------------

/** Core (or the bridge) answered with a machine-named refusal: the write did not land. */
export type AppearanceRefusal = { ok: false; kind: "refused"; error: string; status: number };
/** No usable answer: transport loss, timeout, unreachable Core or an unrecognised shape. A write may have landed. */
export type AppearanceUncertain = { ok: false; kind: "uncertain"; error: string };
export type AppearanceDecode<T> = { ok: true; value: T } | AppearanceRefusal | AppearanceUncertain;

const CORE_VALIDATION_REFUSALS = [
  "appearance-rule-request-invalid", "appearance-rule-id-invalid", "appearance-rule-revision-invalid",
  "appearance-rule-invalid", "appearance-rule-field-unknown", "appearance-rule-name-invalid",
  "appearance-rule-scope-invalid", "appearance-rule-priority-invalid", "appearance-rule-active-invalid",
  "appearance-rule-date-invalid", "appearance-rule-date-window-invalid", "appearance-rule-storefront-invalid",
  "appearance-rule-scope-fields-invalid", "appearance-rule-country-invalid", "appearance-rule-geo-invalid",
  "appearance-rule-landing-invalid", "appearance-rule-landing-field-unknown",
  "appearance-rule-background-type-invalid", "appearance-rule-title-type-invalid", "appearance-rule-url-invalid",
  "appearance-schema-invalid",
  "appearance-rule-hero-invalid", "appearance-rule-hero-mode-invalid", "appearance-rule-hero-inherit-items-invalid",
  "appearance-rule-hero-item-invalid", "appearance-rule-hero-text-invalid", "appearance-rule-hero-text-size-invalid",
  "appearance-rule-hero-text-color-invalid", "appearance-rule-hero-text-weight-invalid",
  "appearance-rule-palette-invalid", "appearance-rule-palette-color-invalid",
  "appearance-preview-invalid", "appearance-preview-field-unknown", "appearance-preview-storefront-invalid",
  "appearance-preview-geo-invalid", "appearance-preview-ip-invalid", "appearance-preview-language-invalid",
  "appearance-city-query-invalid", "appearance-city-language-invalid",
] as const;

/**
 * Closed Core refusal vocabulary, bound from the published T-467 fixture
 * manifest (`tests/fixtures/appearance_rules_wire/manifest.json`,
 * `control_plane_error_statuses`): every machine name with its exact
 * `status_code`. Together with the 503 family below it must equal that map
 * exactly (pinned by `tests/appearanceRulesWire.test.mts`). A refusal proves
 * the write did not land. It is consulted ONLY after the exact legacy Core
 * envelope parsed — a Core name inside a bridge-shaped envelope is never a
 * refusal.
 */
export const APPEARANCE_CORE_REFUSAL_STATUSES: ReadonlyMap<string, number> = new Map<string, number>([
  ...CORE_VALIDATION_REFUSALS.map((error): [string, number] => [error, 422]),
  ["appearance-rule-conflict", 409],
  ["appearance-rule-global-protected", 409],
  ["appearance-rule-not-found", 404],
  ["admin-write-required", 403],
  ["admin-session-invalid", 401],
  ["unauthorized", 401],
  ["admin-revoked", 403],
]);

/** Core answers after which a write may still have landed (the 503 family). */
export const APPEARANCE_CORE_UNCERTAIN_STATUSES: ReadonlyMap<string, number> = new Map<string, number>([
  ["appearance-rule-admin-unavailable", 503],
  ["appearance-rule-schema-unavailable", 503],
  ["appearance-rule-stored-invalid", 503],
  ["appearance-rule-write-failed", 503],
  ["appearance-rule-read-failed", 503],
  ["appearance-rule-audit-write-failed", 503],
  ["appearance-city-geocode-unavailable", 503],
]);

/**
 * Closed bridge refusal vocabulary (`app/api/admin/[action]/route.ts`), bound
 * to exact statuses and consulted ONLY after the exact three-key bridge
 * envelope parsed. Every bridge refusal is answered before Core is called.
 */
export const APPEARANCE_BRIDGE_REFUSAL_STATUSES: ReadonlyMap<string, number> = new Map<string, number>([
  ["invalid-input", 400],
  ["auth-required", 401],
  ["bad-origin", 403],
  ["admin-write-required", 403],
  ["not-found", 404],
  ["too-large", 413],
]);

/** The bridge's transport trio: Core was called and its answer is unknown. */
export const APPEARANCE_BRIDGE_UNCERTAIN_STATUSES: ReadonlyMap<string, number> = new Map<string, number>([
  ["core-timeout", 504],
  ["core-unavailable", 502],
  ["invalid-core-response", 502],
]);

function uncertain(error: string): AppearanceUncertain {
  return { ok: false, kind: "uncertain", error };
}

function classifyRefusal(
  error: string,
  status: number,
  refusals: ReadonlyMap<string, number>,
  uncertains: ReadonlyMap<string, number>,
): AppearanceRefusal | AppearanceUncertain {
  if (refusals.get(error) === status) return { ok: false, kind: "refused", error, status };
  if (uncertains.get(error) === status) return uncertain(error);
  return uncertain("unknown-refusal");
}

const APPEARANCE_FIELD_REFUSAL_FIELDS: ReadonlySet<string> = new Set([
  ...APPEARANCE_LANDING_KEYS,
  "exclude_rule_id",
  "location_mode",
]);

/**
 * Envelope-source and material closure: the bridge map applies only to the
 * exact three-key bridge envelope, the Core map only to the exact legacy trio
 * envelope WITHOUT `data`, or to Core's one closed
 * `appearance-rule-invalid` + `field` shape. A known Core error carrying
 * additive `data` is uncertain, never a proven no-land; anything else is
 * malformed.
 */
function decodeRefusal(value: unknown): AppearanceRefusal | AppearanceUncertain | null {
  const bridge = adminBridgeErrorEnvelope(value);
  if (bridge) {
    return classifyRefusal(bridge.error, bridge.status_code, APPEARANCE_BRIDGE_REFUSAL_STATUSES, APPEARANCE_BRIDGE_UNCERTAIN_STATUSES);
  }
  const core = webadminErrorEnvelope(value, "forbidden");
  if (core) {
    return classifyRefusal(core.error, core.status_code, APPEARANCE_CORE_REFUSAL_STATUSES, APPEARANCE_CORE_UNCERTAIN_STATUSES);
  }
  const fieldCore = webadminEnvelope(value, false, ["error", "field"]);
  if (fieldCore && fieldCore.error === "appearance-rule-invalid"
    && typeof fieldCore.field === "string" && APPEARANCE_FIELD_REFUSAL_FIELDS.has(fieldCore.field)) {
    return classifyRefusal(fieldCore.error, fieldCore.status_code, APPEARANCE_CORE_REFUSAL_STATUSES, APPEARANCE_CORE_UNCERTAIN_STATUSES);
  }
  return webadminErrorEnvelope(value, "required") ? uncertain("refusal-with-data") : null;
}

function decodeMaterial<T>(value: unknown, parse: (data: unknown) => T | null): AppearanceDecode<T> {
  if (value === null || value === undefined) return uncertain("no-response");
  const success = webadminDataSuccessEnvelope(value);
  if (success) {
    const parsed = parse(success.data);
    return parsed === null ? uncertain("malformed-material") : { ok: true, value: parsed };
  }
  return decodeRefusal(value) ?? uncertain("malformed-envelope");
}

export function decodeAppearanceListResponse(value: unknown): AppearanceDecode<AppearanceListPayload> {
  return decodeMaterial(value, parseAppearanceListPayload);
}

export function decodeAppearancePreviewResponse(value: unknown): AppearanceDecode<AppearancePreviewPayload> {
  return decodeMaterial(value, parseAppearancePreviewPayload);
}

export function decodeAppearanceGeocodeResponse(value: unknown): AppearanceDecode<AppearanceGeocodeCandidate[]> {
  return decodeMaterial(value, parseAppearanceGeocodePayload);
}

/** The fourteen-key material of a stored rule, for comparison with a submitted body. */
export function appearanceRuleInputOf(rule: AppearanceRule): AppearanceRuleInput {
  return {
    name: rule.name,
    scope: rule.scope,
    storefront_country: rule.storefront_country,
    country_code: rule.country_code,
    center: rule.center ? { ...rule.center } : null,
    radius_km: rule.radius_km,
    place_label: rule.place_label,
    priority: rule.priority,
    active: rule.active,
    starts_at: rule.starts_at,
    ends_at: rule.ends_at,
    landing: { ...rule.landing },
    hero: { mode: rule.hero.mode, items: rule.hero.items.map((item) => ({ ...item })) },
    palette: { light: { ...rule.palette.light }, dark: { ...rule.palette.dark } },
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const source = record(value);
  if (source) {
    return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * True when a stored rule carries exactly the submitted material. Core mints
 * ids for hero items submitted without one, so those ids are the only field
 * excluded from the comparison — and only where the submission left them empty.
 */
export function appearanceRuleMaterialMatches(rule: AppearanceRule, submitted: AppearanceRuleInput): boolean {
  const stored = appearanceRuleInputOf(rule);
  if (stored.hero.items.length !== submitted.hero.items.length) return false;
  const storedItems = stored.hero.items.map((item, index) => (submitted.hero.items[index]?.id === "" ? { ...item, id: "" } : item));
  return canonicalJson({ ...stored, hero: { mode: stored.hero.mode, items: storedItems } }) === canonicalJson(submitted);
}

export type AppearanceUpdateReconciliation = {
  /**
   * `landed`: the authoritative row carries the submitted material — the write
   * (or an identical later one) is in place; adopt it.
   * `not-landed`: the row is still at the attempted revision with other
   * material — proof that nothing was written; a deliberate retry at the SAME
   * expected revision is valid.
   * `conflict`: the immediate successor revision carries someone else's
   * material — this write did not land and the operator must reopen the
   * authoritative row; the stale draft is never rebased.
   * `superseded`: a later revision carries other material — ambiguous
   * (this write may have landed and been overwritten); never retry, adopt.
   * `missing`: the row is gone.
   */
  outcome: "landed" | "not-landed" | "conflict" | "superseded" | "missing";
  /** Whether the stale draft may be retried unchanged (only `not-landed`). */
  retry: boolean;
  /** The authoritative row the operator must adopt/reopen instead of the stale draft. */
  adopt: AppearanceRule | null;
};

/**
 * T-468b finding 21: revision-aware reconciliation of an uncertain UPDATE
 * against the authoritative list. The attempted `expected_revision` is part
 * of the pending identity; a newer mismatching row is never a safe rebase of
 * the stale submitted material.
 */
export function reconcileAppearanceUpdate(
  attempted: { id: string; expected_revision: number; input: AppearanceRuleInput },
  authoritative: AppearanceRule | null,
): AppearanceUpdateReconciliation {
  if (!authoritative || authoritative.id !== attempted.id) return { outcome: "missing", retry: false, adopt: null };
  if (appearanceRuleMaterialMatches(authoritative, attempted.input)) return { outcome: "landed", retry: false, adopt: authoritative };
  if (authoritative.revision === attempted.expected_revision) return { outcome: "not-landed", retry: true, adopt: null };
  if (authoritative.revision === attempted.expected_revision + 1) return { outcome: "conflict", retry: false, adopt: authoritative };
  return { outcome: "superseded", retry: false, adopt: authoritative };
}

export type AppearanceCreateReconciliation = {
  /** `landed`: a NEW row (absent from the pre-request baseline) carries the submitted material; `not-landed`: no such row. */
  outcome: "landed" | "not-landed";
  /** The newly observed row to adopt; `null` when the create did not land. */
  adopt: AppearanceRule | null;
};

/**
 * T-468b finding 25: reconciliation of an uncertain CREATE against the
 * authoritative list. Core has no uniqueness for non-global material, so a
 * material-equal row proves the create only when its id was ABSENT from the
 * set of ids observed immediately before the request; a pre-existing match
 * is never evidence. The minted-empty-hero-id exception inside
 * `appearanceRuleMaterialMatches` is thereby bound to the new identity.
 */
export function reconcileAppearanceCreate(
  attempted: { input: AppearanceRuleInput; baseline_ids: readonly string[] },
  rules: readonly AppearanceRule[],
): AppearanceCreateReconciliation {
  const baseline = new Set(attempted.baseline_ids);
  const landed = rules.find((rule) => !baseline.has(rule.id) && appearanceRuleMaterialMatches(rule, attempted.input)) ?? null;
  return landed ? { outcome: "landed", adopt: landed } : { outcome: "not-landed", adopt: null };
}

/**
 * `appearance_rules_save`: exact success envelope, `data: { rule }`, and the
 * returned rule bound to the submitted target on BOTH create and update
 * (T-468b finding 11): the same id on an update (a create adopts the minted
 * one), the same fourteen-key material (Core-minted empty hero ids excepted)
 * and exactly the CAS successor revision `expected_revision + 1` (a create
 * moves 0 → 1). Anything else is an uncertain malformed success that must be
 * reconciled through the authoritative list, never adopted.
 */
export function decodeAppearanceSaveResponse(
  value: unknown,
  submitted: { id: string; expected_revision: number; input: AppearanceRuleInput },
): AppearanceDecode<AppearanceRule> {
  const decoded = decodeMaterial(value, (data) => {
    const source = record(data);
    if (!source || !exactKeys(source, ["rule"])) return null;
    return parseAppearanceRule(source.rule);
  });
  if (!decoded.ok) return decoded;
  const rule = decoded.value;
  if (submitted.id !== "" && rule.id !== submitted.id) return uncertain("unbound-target");
  if (!appearanceRuleMaterialMatches(rule, submitted.input)) return uncertain("unbound-material");
  if (rule.revision !== submitted.expected_revision + 1) return uncertain("unbound-revision");
  return decoded;
}

/** `appearance_rules_delete`: exact success envelope with `data: { id }` naming the submitted rule. */
export function decodeAppearanceDeleteResponse(value: unknown, submittedId: string): AppearanceDecode<{ id: string }> {
  const decoded = decodeMaterial(value, (data) => {
    const source = record(data);
    if (!source || !exactKeys(source, ["id"])) return null;
    const id = appearanceRuleId(source.id);
    return id === null ? null : { id };
  });
  if (!decoded.ok) return decoded;
  return decoded.value.id === submittedId ? decoded : uncertain("unbound-target");
}
