import { getCountryDataList } from "countries-list";

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

export const APPEARANCE_LANDING_KEYS = [
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
export type AppearanceLandingKey = (typeof APPEARANCE_LANDING_KEYS)[number];
/** Wire form: only the keys a rule sets are present; an absent key inherits. */
export type AppearanceLanding = Partial<Record<AppearanceLandingKey, string>>;
/** Editor form: every key present, blank = inherit (the legacy App landing semantics). */
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
};

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
  created_at: string | null;
  updated_at: string | null;
  updated_by: string;
  migrated_from: "country" | null;
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

export type AppearancePreviewLanding = {
  background: { type: "image" | "video"; url: string; poster_url: string };
  title: { type: "text" | "image"; text: string; image_url: string };
  description: string;
};

export type AppearancePreviewHeroItem = {
  id: string;
  media_url: string;
  type: "image" | "video";
  forward_url: string;
  title: string;
  subtitle: string;
  link_title: string;
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
const MAX_URL_LENGTH = 2048;

// ---------------------------------------------------------------------------
// Country catalogue (store countries are App Store storefronts, ISO 3166-1
// alpha-3; geo place metadata is alpha-2). `countries-list` ships both codes.
// ---------------------------------------------------------------------------

export type AppearanceCountry = { alpha2: string; alpha3: string };
export type LocalizedAppearanceCountry = AppearanceCountry & { name: string };

const COUNTRY_SOURCE = getCountryDataList().filter((country) => !country.userAssigned);
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

function boundedText(value: unknown, minimum: number, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const length = [...trimmed].length;
  if (length < minimum || length > maximum || CONTROL_CHARACTERS.test(trimmed)) return null;
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
  const trimmed = value.trim().toUpperCase();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return /^#[0-9A-F]{6}$/.test(withHash) ? withHash : null;
}

/** Hero typography colours stay lowercase `#rrggbb` (the legacy hero contract). */
function heroColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return "";
  return /^#[0-9a-f]{6}$/.test(trimmed) ? trimmed : null;
}

function webUrl(value: unknown, allowEmpty: boolean): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return allowEmpty ? "" : null;
  if (trimmed.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.hostname ? trimmed : null;
  } catch {
    return null;
  }
}

export function isAppearanceHttpsUrl(value: string, optional = false): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return optional;
  if (trimmed.length > MAX_URL_LENGTH) return false;
  try {
    return new URL(trimmed).protocol === "https:";
  } catch {
    return false;
  }
}

const WIRE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Exact UTC wire timestamp (`YYYY-MM-DDTHH:MM:SSZ`) that round-trips through Date. */
export function parseAppearanceTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !WIRE_TIMESTAMP.test(value)) return null;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return null;
  return new Date(millis).toISOString().replace(/\.\d{3}Z$/, "Z") === value ? value : null;
}

function nullableTimestamp(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
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
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) return undefined;
  const date = new Date(trimmed);
  if (!Number.isFinite(date.getTime())) return undefined;
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

export function parseAppearanceLanding(value: unknown): AppearanceLanding | null {
  const source = record(value);
  if (!source || !subsetKeys(source, APPEARANCE_LANDING_KEYS)) return null;
  const landing: AppearanceLanding = {};
  for (const key of APPEARANCE_LANDING_KEYS) {
    if (!Object.hasOwn(source, key)) continue;
    const raw = source[key];
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if ([...trimmed].length > LANDING_LIMITS[key] || CONTROL_CHARACTERS.test(trimmed)) return null;
    if (key === "background_type" && trimmed !== "image" && trimmed !== "video") return null;
    if (key === "title_type" && trimmed !== "text" && trimmed !== "image") return null;
    if (key === "background_url" || key === "background_poster_url" || key === "title_image_url") {
      if (webUrl(trimmed, true) === null) return null;
    }
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

function parseScopeFields(scope: AppearanceScope, source: Record<string, unknown>): ScopeFields | null {
  const neutral = (value: unknown) => value === null || value === "" || value === undefined;
  if (scope === "storefront") {
    const storefront = typeof source.storefront_country === "string" ? source.storefront_country : "";
    if (!isAppearanceStorefront(storefront)) return null;
    if (!neutral(source.country_code) || !neutral(source.center) || !neutral(source.radius_km) || !neutral(source.place_label)) return null;
    return { storefront_country: storefront, country_code: "", center: null, radius_km: null, place_label: "" };
  }
  if (scope === "geo") {
    if (!neutral(source.storefront_country)) return null;
    let country = "";
    if (!neutral(source.country_code)) {
      if (typeof source.country_code !== "string" || !isAppearanceAlpha2(source.country_code)) return null;
      country = source.country_code;
    }
    const center = parseCenter(source.center);
    const radius = finite(source.radius_km, MIN_APPEARANCE_RADIUS_KM, MAX_APPEARANCE_RADIUS_KM);
    const placeLabel = boundedText(source.place_label, 1, MAX_APPEARANCE_PLACE_LABEL_LENGTH);
    if (!center || radius === null || placeLabel === null) return null;
    return { storefront_country: "", country_code: country, center, radius_km: radius, place_label: placeLabel };
  }
  for (const field of ["storefront_country", "country_code", "center", "radius_km", "place_label"] as const) {
    if (!neutral(source[field])) return null;
  }
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
  if (!scopeFields || !landing || !hero || !palette) return null;
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
  return parseRuleInputFields(source);
}

/** One stored rule exactly as Core projects it. */
export function parseAppearanceRule(value: unknown): AppearanceRule | null {
  const source = record(value);
  if (!source || !exactKeys(source, RULE_WIRE_KEYS, ["migrated_from"])) return null;
  const input = parseRuleInputFields(source);
  const id = boundedText(source.id, 1, MAX_ID_LENGTH);
  const revision = integer(source.revision, 1, Number.MAX_SAFE_INTEGER);
  const createdAt = nullableTimestamp(source.created_at);
  const updatedAt = nullableTimestamp(source.updated_at);
  const updatedBy = typeof source.updated_by === "string" ? source.updated_by : null;
  if (!input || id === null || revision === null || createdAt === undefined || updatedAt === undefined || updatedBy === null) return null;
  if (Object.hasOwn(source, "migrated_from") && source.migrated_from !== "country") return null;
  return {
    id,
    ...input,
    revision,
    created_at: createdAt,
    updated_at: updatedAt,
    updated_by: updatedBy,
    migrated_from: source.migrated_from === "country" ? "country" : null,
  };
}

function parseLandingDefaults(value: unknown): AppearanceLandingDraft | null {
  const source = record(value);
  if (!source || !exactKeys(source, APPEARANCE_LANDING_KEYS)) return null;
  const landing = parseAppearanceLanding(source);
  if (!landing) return null;
  if (landing.background_type === undefined || landing.title_type === undefined) return null;
  return { ...APPEARANCE_DEFAULT_LANDING, ...landing } as AppearanceLandingDraft;
}

/**
 * `appearance_rules_list` material. `defaults` is Core's compiled default (the
 * same §1 palette this module compiles); when Core omits it the compiled table
 * is used so the editor's inheritance preview still has its last level.
 */
export function parseAppearanceListPayload(value: unknown): AppearanceListPayload | null {
  const source = record(value);
  if (!source || !exactKeys(source, ["rules"], ["defaults"])) return null;
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
  if (globalCount > 1) return null;
  let defaults: AppearanceListPayload["defaults"] = {
    palette: APPEARANCE_DEFAULT_PALETTE,
    landing: APPEARANCE_DEFAULT_LANDING,
  };
  if (Object.hasOwn(source, "defaults")) {
    const defaultsSource = record(source.defaults);
    if (!defaultsSource || !exactKeys(defaultsSource, ["palette", "landing"])) return null;
    const palette = parseAppearanceFullPalette(defaultsSource.palette);
    const landing = parseLandingDefaults(defaultsSource.landing);
    if (!palette || !landing) return null;
    defaults = { palette, landing };
  }
  return { rules, defaults };
}

function parsePreviewLanding(value: unknown): AppearancePreviewLanding | null {
  const source = record(value);
  if (!source || !exactKeys(source, ["background", "title", "description"])) return null;
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
  return {
    background: { type: backgroundType, url: backgroundUrl, poster_url: posterUrl },
    title: { type: titleType, text: titleText, image_url: titleImage },
    description,
  };
}

const PREVIEW_HERO_KEYS = [
  "id", "media_url", "type", "forward_url", "image_url", "destination_url",
  "title", "subtitle", "link_title", "text_style",
] as const;

function parsePreviewHeroItem(value: unknown): AppearancePreviewHeroItem | null {
  const source = record(value);
  if (!source || !exactKeys(source, PREVIEW_HERO_KEYS)) return null;
  const id = boundedText(source.id, 0, MAX_ID_LENGTH);
  const media = webUrl(source.media_url, false);
  const type = source.type === "image" || source.type === "video" ? source.type : null;
  const forward = webUrl(source.forward_url, true);
  const title = boundedText(source.title, 0, 160);
  const subtitle = boundedText(source.subtitle, 0, 160);
  const linkTitle = boundedText(source.link_title, 0, 80);
  if (id === null || media === null || type === null || forward === null
    || title === null || subtitle === null || linkTitle === null
    || source.image_url !== media || source.destination_url !== forward
    || record(source.text_style) === null) return null;
  return { id, media_url: media, type, forward_url: forward, title, subtitle, link_title: linkTitle };
}

/** `appearance_rules_preview` material = the app's `POST /v1/app/appearance` payload. */
export function parseAppearancePreviewPayload(value: unknown): AppearancePreviewPayload | null {
  const source = record(value);
  if (!source || !exactKeys(source, ["revision", "content_version", "landing", "hero", "palette", "matched"])) return null;
  const revision = integer(source.revision, 0, Number.MAX_SAFE_INTEGER);
  const contentVersion = typeof source.content_version === "string" && source.content_version.trim() !== ""
    ? source.content_version.trim()
    : Number.isSafeInteger(source.content_version) && (source.content_version as number) >= 0
      ? String(source.content_version)
      : null;
  const landing = parsePreviewLanding(source.landing);
  const palette = parseAppearanceFullPalette(source.palette);
  const matched = record(source.matched);
  if (revision === null || contentVersion === null || !landing || !palette || !Array.isArray(source.hero)
    || !matched || !exactKeys(matched, ["scope", "rule_id", "location_source"])) return null;
  const hero: AppearancePreviewHeroItem[] = [];
  for (const raw of source.hero) {
    const item = parsePreviewHeroItem(raw);
    if (!item) return null;
    hero.push(item);
  }
  const scope = typeof matched.scope === "string" && (APPEARANCE_MATCHED_SCOPES as readonly string[]).includes(matched.scope)
    ? matched.scope as AppearanceMatchedScope
    : null;
  const ruleId = boundedText(matched.rule_id, 0, MAX_ID_LENGTH);
  const locationSource = typeof matched.location_source === "string"
    && (APPEARANCE_LOCATION_SOURCES as readonly string[]).includes(matched.location_source)
    ? matched.location_source as AppearanceLocationSource
    : null;
  if (scope === null || ruleId === null || locationSource === null) return null;
  if (scope === "default" && ruleId !== "") return null;
  return {
    revision,
    content_version: contentVersion,
    landing,
    hero,
    palette,
    matched: { scope, rule_id: ruleId, location_source: locationSource },
  };
}

/** `appearance_city_geocode` material (Amendment v1.2 §3). */
export function parseAppearanceGeocodePayload(value: unknown): AppearanceGeocodeCandidate[] | null {
  const source = record(value);
  if (!source || !exactKeys(source, ["candidates"]) || !Array.isArray(source.candidates)) return null;
  const candidates: AppearanceGeocodeCandidate[] = [];
  for (const raw of source.candidates) {
    const candidate = record(raw);
    if (!candidate || !exactKeys(candidate, ["place_id", "place_label", "country_code", "center", "radius_km"])) return null;
    const placeId = boundedText(candidate.place_id, 1, 512);
    const placeLabel = boundedText(candidate.place_label, 1, MAX_APPEARANCE_PLACE_LABEL_LENGTH);
    const country = candidate.country_code === "" ? ""
      : typeof candidate.country_code === "string" && isAppearanceAlpha2(candidate.country_code) ? candidate.country_code : null;
    const center = parseCenter(candidate.center);
    const radius = finite(candidate.radius_km, MIN_APPEARANCE_RADIUS_KM, MAX_APPEARANCE_RADIUS_KM);
    if (placeId === null || placeLabel === null || country === null || !center || radius === null) return null;
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
  titleType: "text" | "image";
  titleText: string;
  titleImageUrl: string;
  description: string;
};

function landingText(doc: AppearanceLanding, key: "title_text" | "description", language: "en" | "hu"): string {
  const local = doc[`${key}_${language}`]?.trim() ?? "";
  if (local) return local;
  return doc[`${key}_en`]?.trim() ?? "";
}

/** Legacy `AppLandingService` semantics: a document wins a field only when it actually supplies it. */
export function resolveAppearanceLanding(
  chain: readonly AppearanceLanding[],
  defaults: AppearanceLandingDraft,
  language: "en" | "hu",
): ResolvedAppearanceLanding {
  const background = chain.find((doc) => (doc.background_url ?? "").trim() !== "");
  const title = chain.find((doc) => {
    if (doc.title_type === "image") return (doc.title_image_url ?? "").trim() !== "";
    return landingText(doc, "title_text", language) !== "";
  });
  const description = chain.find((doc) => landingText(doc, "description", language) !== "");
  const backgroundSource = background ?? defaults;
  return {
    backgroundType: backgroundSource.background_type === "video" ? "video" : "image",
    backgroundUrl: background?.background_url?.trim() ?? defaults.background_url,
    posterUrl: background ? (background.background_poster_url?.trim() ?? "") : defaults.background_poster_url,
    titleType: title ? (title.title_type === "image" ? "image" : "text") : (defaults.title_type === "image" ? "image" : "text"),
    titleText: title ? landingText(title, "title_text", language) : landingText(defaults, "title_text", language),
    titleImageUrl: title ? (title.title_image_url?.trim() ?? "") : defaults.title_image_url,
    description: description ? landingText(description, "description", language) : landingText(defaults, "description", language),
  };
}

export function resolveAppearanceHero(chain: readonly AppearanceHero[]): AppearanceHeroItem[] {
  const replacing = chain.find((hero) => hero.mode === "replace");
  if (!replacing) return [];
  return [...replacing.items]
    .filter((item) => item.active)
    .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));
}

// ---------------------------------------------------------------------------
// Editor draft ↔ wire
// ---------------------------------------------------------------------------

export function appearanceLandingDraft(landing: AppearanceLanding): AppearanceLandingDraft {
  return {
    background_type: landing.background_type === "video" ? "video" : "image",
    background_url: landing.background_url ?? "",
    background_poster_url: landing.background_poster_url ?? "",
    title_type: landing.title_type === "image" ? "image" : "text",
    title_text_en: landing.title_text_en ?? "",
    title_text_hu: landing.title_text_hu ?? "",
    title_image_url: landing.title_image_url ?? "",
    description_en: landing.description_en ?? "",
    description_hu: landing.description_hu ?? "",
  };
}

/** Blank editor groups inherit: only the groups the operator filled reach the wire. */
export function appearanceLandingWire(draft: AppearanceLandingDraft): AppearanceLanding {
  const wire: AppearanceLanding = {};
  if (draft.background_url.trim() !== "") {
    wire.background_type = draft.background_type;
    wire.background_url = draft.background_url.trim();
    if (draft.background_type === "video" && draft.background_poster_url.trim() !== "") {
      wire.background_poster_url = draft.background_poster_url.trim();
    }
  }
  if (draft.title_type === "image") {
    if (draft.title_image_url.trim() !== "") {
      wire.title_type = "image";
      wire.title_image_url = draft.title_image_url.trim();
    }
  } else if (draft.title_text_en.trim() !== "" || draft.title_text_hu.trim() !== "") {
    wire.title_type = "text";
    wire.title_text_en = draft.title_text_en.trim();
    wire.title_text_hu = draft.title_text_hu.trim();
  }
  if (draft.description_en.trim() !== "" || draft.description_hu.trim() !== "") {
    wire.description_en = draft.description_en.trim();
    wire.description_hu = draft.description_hu.trim();
  }
  return wire;
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
    landing: { ...APPEARANCE_DEFAULT_LANDING, title_text_en: "", title_text_hu: "", description_en: "", description_hu: "" },
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
  | "heroItem"
  | "heroTypography"
  | "palette";

function numberInput(value: string): number | null {
  const trimmed = value.trim();
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
      || (latitude === 0 && longitude === 0)
      || radius < MIN_APPEARANCE_RADIUS_KM || radius > MAX_APPEARANCE_RADIUS_KM
      || boundedText(draft.place_label, 1, MAX_APPEARANCE_PLACE_LABEL_LENGTH) === null) return "geo";
    if (draft.country_code !== "" && !isAppearanceAlpha2(draft.country_code)) return "countryCode";
  }
  if (!Number.isInteger(draft.priority) || draft.priority < 0 || draft.priority > MAX_APPEARANCE_PRIORITY) return "priority";
  if (!appearanceTimestampsOrdered(draft.starts_at, draft.ends_at)) return "window";
  const landing = draft.landing;
  if (!isAppearanceHttpsUrl(landing.background_url, true)) return "background";
  if (!isAppearanceHttpsUrl(landing.background_poster_url, true)) return "poster";
  if (landing.title_type === "image" && landing.title_image_url.trim() !== "" && !isAppearanceHttpsUrl(landing.title_image_url)) return "titleImage";
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
    name: draft.name.trim(),
    scope: draft.scope,
    storefront_country: draft.scope === "storefront" ? draft.storefront_country : "",
    country_code: isGeo ? draft.country_code : "",
    center: isGeo ? { latitude: Number(draft.latitude), longitude: Number(draft.longitude) } : null,
    radius_km: isGeo ? Number(draft.radius_km) : null,
    place_label: isGeo ? draft.place_label.trim() : "",
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
          media_url: item.media_url.trim(),
          forward_url: item.forward_url.trim(),
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
};

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6 = /^[0-9A-Fa-f:.]{2,45}$/;

function parsePreviewRequest(body: Record<string, unknown>): AppearancePreviewRequest | null {
  if (!subsetKeys(body, ["storefront_country", "latitude", "longitude", "ip", "lang"])) return null;
  const request: AppearancePreviewRequest = {};
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
    const ip = body.ip.trim();
    if (!IPV4.test(ip) && !(ip.includes(":") && IPV6.test(ip))) return null;
    request.ip = ip;
  }
  if (Object.hasOwn(body, "lang") && body.lang !== "") {
    if (body.lang !== "en" && body.lang !== "hu") return null;
    request.lang = body.lang;
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
      const id = boundedText(body.id, 0, MAX_ID_LENGTH);
      const expectedRevision = integer(body.expected_revision, 0, Number.MAX_SAFE_INTEGER);
      const rule = parseAppearanceRuleInput(body.rule);
      if (id === null || expectedRevision === null || !rule) return null;
      if ((id === "") !== (expectedRevision === 0)) return null;
      return { id, expected_revision: expectedRevision, rule };
    }
    case "appearance_rules_delete": {
      if (!exactKeys(body, ["id", "expected_revision"])) return null;
      const id = boundedText(body.id, 1, MAX_ID_LENGTH);
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
