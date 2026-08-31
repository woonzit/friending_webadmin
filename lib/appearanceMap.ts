/**
 * Google Maps picker plumbing for the Appearance & placements editor.
 *
 * The Maps JavaScript API is loaded only inside its own same-origin document
 * (`/appearance-map`), which is the one route whose response headers carry
 * Google's documented allow-list CSP and an origin-bearing referrer policy.
 * The editor embeds that document in an iframe and exchanges a closed set of
 * messages with it; nothing here widens the console's global policy.
 */

export const APPEARANCE_MAP_FRAME_PATH = "/appearance-map";

/** Handler name the async Maps loader invokes once the API is ready. */
export const APPEARANCE_MAP_READY_CALLBACK = "__friendingAppearanceMapReady";

/** Budapest — the editor's starting viewport when a rule has no centre yet. */
export const APPEARANCE_MAP_DEFAULT_CENTER = { latitude: 47.4979, longitude: 19.0402 } as const;
/**
 * The console is dark-only, so the roadmap is initialised with Google's
 * documented FIXED dark colour scheme — never FOLLOW_SYSTEM (T-468b finding 18;
 * https://developers.google.com/maps/documentation/javascript/mapcolorscheme).
 */
export const APPEARANCE_MAP_COLOR_SCHEME = "DARK" as const;
export const APPEARANCE_MAP_DEFAULT_ZOOM = 9;

export type AppearanceMapOptions = {
  center: { lat: number; lng: number };
  zoom: number;
  mapTypeControl: false;
  streetViewControl: false;
  fullscreenControl: false;
  clickableIcons: false;
  gestureHandling: "greedy";
  colorScheme: typeof APPEARANCE_MAP_COLOR_SCHEME;
};

/** The exact options the frame hands to `google.maps.Map` — pinned by `tests/appearanceMap.test.mts`. */
export function appearanceMapOptions(center: { lat: number; lng: number }): AppearanceMapOptions {
  return {
    center,
    zoom: APPEARANCE_MAP_DEFAULT_ZOOM,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    clickableIcons: false,
    gestureHandling: "greedy",
    colorScheme: APPEARANCE_MAP_COLOR_SCHEME,
  };
}

export type AppearanceMapLanguage = "en" | "hu";

/**
 * The browser key is public by design (website-restricted on Google's side)
 * and reaches the bundle at build time through `NEXT_PUBLIC_*`. Only a value
 * shaped like an API key is used; anything else counts as "no key" so a
 * mis-set variable cannot inject into the script URL.
 */
export function googleMapsBrowserKey(): string {
  const raw = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? "";
  return validGoogleMapsBrowserKey(raw) ? raw.trim() : "";
}

export function validGoogleMapsBrowserKey(value: string): boolean {
  return /^[A-Za-z0-9_-]{20,128}$/.test(value.trim());
}

export function googleMapsScriptUrl(key: string, language: AppearanceMapLanguage): string | null {
  if (!validGoogleMapsBrowserKey(key)) return null;
  const params = new URLSearchParams({
    key: key.trim(),
    v: "weekly",
    loading: "async",
    language,
    callback: APPEARANCE_MAP_READY_CALLBACK,
  });
  return `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
}

export type AppearanceMapCenter = { latitude: number; longitude: number };

/** Editor → frame: the state the marker and circle must show. */
export type AppearanceMapParentMessage = {
  type: "friending.appearance-map.set";
  center: AppearanceMapCenter | null;
  radiusKm: number | null;
  language: AppearanceMapLanguage;
};

/** Frame → editor: the map is ready, or the operator moved the marker. */
export type AppearanceMapFrameMessage =
  | { type: "friending.appearance-map.ready" }
  | { type: "friending.appearance-map.moved"; center: AppearanceMapCenter };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  // Cross-frame messages stay exact because unknown fields may change the parent/frame security protocol.
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function center(value: unknown): AppearanceMapCenter | null {
  const source = record(value);
  if (!source || !exactKeys(source, ["latitude", "longitude"])) return null;
  const { latitude, longitude } = source;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

export function parseAppearanceMapParentMessage(value: unknown): AppearanceMapParentMessage | null {
  const source = record(value);
  if (!source || !exactKeys(source, ["type", "center", "radiusKm", "language"])) return null;
  if (source.type !== "friending.appearance-map.set") return null;
  const parsedCenter = source.center === null ? null : center(source.center);
  if (source.center !== null && parsedCenter === null) return null;
  const radius = source.radiusKm;
  if (radius !== null && (typeof radius !== "number" || !Number.isFinite(radius) || radius < 1 || radius > 500)) return null;
  if (source.language !== "en" && source.language !== "hu") return null;
  return { type: "friending.appearance-map.set", center: parsedCenter, radiusKm: radius, language: source.language };
}

export function parseAppearanceMapFrameMessage(value: unknown): AppearanceMapFrameMessage | null {
  const source = record(value);
  if (!source) return null;
  if (source.type === "friending.appearance-map.ready") {
    return exactKeys(source, ["type"]) ? { type: "friending.appearance-map.ready" } : null;
  }
  if (source.type === "friending.appearance-map.moved") {
    if (!exactKeys(source, ["type", "center"])) return null;
    const parsedCenter = center(source.center);
    return parsedCenter ? { type: "friending.appearance-map.moved", center: parsedCenter } : null;
  }
  return null;
}

/**
 * Both sides accept a message only from this origin AND from the one window
 * they are talking to (the embedding window for the frame, the frame's window
 * for the editor). A same-origin message from any other window — another
 * tab's script, a sibling frame — is ignored before its body is even parsed.
 */
/**
 * T-468b finding 23: a trusted `moved` message mutates the draft only while
 * the picker is enabled. The picker consults its CURRENT disabled state (a
 * ref updated on every render) so a message that originated or queued before
 * the lock can never change the draft after the request body was fixed.
 */
export function appearanceMapMoveAccepted(message: AppearanceMapFrameMessage, disabled: boolean): AppearanceMapCenter | null {
  if (message.type !== "friending.appearance-map.moved" || disabled) return null;
  return message.center;
}

export function isTrustedAppearanceMapEvent(
  event: { origin: string; source: unknown },
  expectedOrigin: string,
  expectedSource: unknown,
): boolean {
  return expectedOrigin !== ""
    && event.origin === expectedOrigin
    && expectedSource !== null
    && expectedSource !== undefined
    && event.source === expectedSource;
}

/** Round a dragged coordinate to six decimals (about 11 cm) so the form stays readable. */
export function roundAppearanceCoordinate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
