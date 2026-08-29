import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  APPEARANCE_MAP_FRAME_PATH,
  APPEARANCE_MAP_READY_CALLBACK,
  googleMapsBrowserKey,
  googleMapsScriptUrl,
  isTrustedAppearanceMapEvent,
  parseAppearanceMapFrameMessage,
  parseAppearanceMapParentMessage,
  roundAppearanceCoordinate,
  validGoogleMapsBrowserKey,
  APPEARANCE_MAP_COLOR_SCHEME,
  appearanceMapMoveAccepted,
  appearanceMapOptions,
} from "../lib/appearanceMap.ts";

type HeaderEntry = { source: string; headers: Array<{ key: string; value: string }> };

/** The console policy as shipped before T-468; the global entry must not drift. */
const GLOBAL_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "media-src 'self' https:",
].join("; ");

/**
 * Google's "Allowlist CSP" sample for the Maps JavaScript API (developers.google.com/maps/
 * documentation/javascript/content-security-policy, lines 98-110, page updated 2026-08-25),
 * `'unsafe-eval'` included: the API does not execute without it. It is acceptable only on the
 * isolated map document, which renders nothing but the map and never sees a secret.
 */
const GOOGLE_MAPS_ORIGINS = {
  "script-src": ["'unsafe-eval'", "https://*.googleapis.com", "https://*.gstatic.com", "*.google.com", "https://*.ggpht.com", "*.googleusercontent.com", "blob:"],
  "img-src": ["https://*.googleapis.com", "https://*.gstatic.com", "*.google.com", "*.googleusercontent.com", "data:"],
  "frame-src": ["*.google.com"],
  "connect-src": ["https://*.googleapis.com", "*.google.com", "https://*.gstatic.com", "data:", "blob:"],
  "font-src": ["https://fonts.gstatic.com"],
  "style-src": ["https://fonts.googleapis.com"],
  "worker-src": ["blob:"],
} as const;

function directives(policy: string): Map<string, string[]> {
  return new Map(policy.split(";").map((part) => {
    const [name, ...sources] = part.trim().split(/\s+/);
    return [name ?? "", sources];
  }));
}

async function headerEntries(): Promise<HeaderEntry[]> {
  const config = (await import("../next.config.mjs")) as unknown as {
    default: { headers(): Promise<HeaderEntry[]> };
  };
  return config.default.headers();
}

test("the global console headers are unchanged: strict CSP, no-referrer, never framed", async () => {
  const entries = await headerEntries();
  const global = entries.find((entry) => entry.source === "/(.*)");
  assert.ok(global);
  const byKey = new Map(global.headers.map((header) => [header.key, header.value]));
  assert.equal(byKey.get("Content-Security-Policy"), GLOBAL_CSP);
  assert.equal(byKey.get("Referrer-Policy"), "no-referrer");
  assert.equal(byKey.get("X-Frame-Options"), "DENY");
  assert.equal(byKey.get("X-Content-Type-Options"), "nosniff");
  assert.equal(byKey.get("Strict-Transport-Security"), "max-age=31536000; includeSubDomains");
  assert.equal(byKey.get("Permissions-Policy"), "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  assert.equal(entries[0], global, "the global entry must come first so the route entry can override it");
});

test("only the map document carries Google's Maps allow-list, a same-origin frame ancestor and an origin referrer", async () => {
  const entries = await headerEntries();
  assert.equal(entries.length, 2, "exactly one route-scoped entry exists");
  const frame = entries[1];
  assert.ok(frame);
  assert.equal(frame.source, APPEARANCE_MAP_FRAME_PATH);
  assert.equal(frame.source, "/appearance-map", "an exact path, not a pattern: no other route inherits the wider policy");
  const byKey = new Map(frame.headers.map((header) => [header.key, header.value]));
  assert.deepEqual([...byKey.keys()].sort(), ["Cache-Control", "Content-Security-Policy", "Referrer-Policy", "X-Frame-Options"]);
  assert.equal(byKey.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(byKey.get("X-Frame-Options"), "SAMEORIGIN");
  assert.equal(byKey.get("Cache-Control"), "no-store");

  const policy = directives(byKey.get("Content-Security-Policy") ?? "");
  assert.deepEqual(policy.get("frame-ancestors"), ["'self'"]);
  assert.deepEqual(policy.get("default-src"), ["'self'"]);
  assert.deepEqual(policy.get("object-src"), ["'none'"]);
  assert.deepEqual(policy.get("base-uri"), ["'self'"]);
  assert.deepEqual(policy.get("form-action"), ["'self'"]);
  for (const [directive, origins] of Object.entries(GOOGLE_MAPS_ORIGINS)) {
    const sources = policy.get(directive);
    assert.ok(sources, `${directive} is declared`);
    for (const origin of origins) {
      assert.ok(sources.includes(origin), `${directive} allows ${origin}`);
    }
  }
  // The map document never needs the console's wide media/image grants.
  assert.ok(!(policy.get("img-src") ?? []).includes("https:"), "img-src is limited to Google's hosts");
  assert.deepEqual(policy.get("media-src"), ["'self'"]);
  for (const [directive, sources] of policy) {
    assert.ok(!sources.includes("*"), `${directive}: no wildcard grant`);
    if (directive !== "script-src") assert.ok(!sources.includes("'unsafe-eval'"), `${directive}: eval only where Google requires it`);
  }
  // The console document never gets eval: the grant is confined to the map frame.
  const globalPolicy = directives(GLOBAL_CSP);
  for (const sources of globalPolicy.values()) assert.ok(!sources.includes("'unsafe-eval'"));
});

/**
 * Next applies every matching `headers()` entry in declaration order and, for a
 * repeated key, the value set last wins (next.config.js `headers` reference:
 * "the last header key will override the first"). The merge below reproduces
 * that rule over the entries that match the map document so the effective
 * header set is asserted, not only the entry's own values.
 */
function effectiveHeaders(entries: HeaderEntry[], pathname: string): Map<string, string> {
  const merged = new Map<string, string>();
  for (const entry of entries) {
    const matches = entry.source === pathname
      || (entry.source === "/(.*)");
    if (!matches) continue;
    for (const header of entry.headers) merged.set(header.key, header.value);
  }
  return merged;
}

test("the map document's effective headers override the global ones in Next's emitted order, and nothing else changes", async () => {
  const entries = await headerEntries();
  const frame = effectiveHeaders(entries, APPEARANCE_MAP_FRAME_PATH);
  assert.equal(frame.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(frame.get("X-Frame-Options"), "SAMEORIGIN");
  assert.equal(frame.get("Cache-Control"), "no-store");
  assert.ok(frame.get("Content-Security-Policy")?.includes("frame-ancestors 'self'"));
  assert.ok(frame.get("Content-Security-Policy")?.includes("https://*.googleapis.com"));
  // Inherited, untouched by the route entry.
  assert.equal(frame.get("X-Content-Type-Options"), "nosniff");
  assert.equal(frame.get("Strict-Transport-Security"), "max-age=31536000; includeSubDomains");
  assert.equal(frame.get("Permissions-Policy"), "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  assert.equal(frame.get("X-Robots-Tag"), "noindex, nofollow, noarchive");

  for (const pathname of ["/appearance", "/", "/users", "/appearance-map/anything", "/appearance-maps"]) {
    const other = effectiveHeaders(entries, pathname);
    assert.equal(other.get("Content-Security-Policy"), GLOBAL_CSP, pathname);
    assert.equal(other.get("Referrer-Policy"), "no-referrer", pathname);
    assert.equal(other.get("X-Frame-Options"), "DENY", pathname);
    assert.equal(other.has("Cache-Control"), false, pathname);
  }
});

test("a map message is trusted only from this origin and from the one expected window", () => {
  const frameWindow = { id: "frame" };
  const otherWindow = { id: "other" };
  const origin = "https://friendingapp.com";
  assert.equal(isTrustedAppearanceMapEvent({ origin, source: frameWindow }, origin, frameWindow), true);
  assert.equal(isTrustedAppearanceMapEvent({ origin, source: otherWindow }, origin, frameWindow), false, "same origin, foreign window");
  assert.equal(isTrustedAppearanceMapEvent({ origin: "https://evil.example", source: frameWindow }, origin, frameWindow), false, "foreign origin");
  assert.equal(isTrustedAppearanceMapEvent({ origin: "null", source: frameWindow }, origin, frameWindow), false, "opaque origin");
  assert.equal(isTrustedAppearanceMapEvent({ origin, source: null }, origin, null), false, "no expected window yet");
  assert.equal(isTrustedAppearanceMapEvent({ origin, source: undefined }, origin, undefined), false);
  assert.equal(isTrustedAppearanceMapEvent({ origin: "", source: frameWindow }, "", frameWindow), false, "an empty origin never matches");
});

test("the Maps script URL is built only from a key-shaped value and pins the async loader contract", () => {
  const key = "AIzaSyD-example_key_0123456789abcdefghi";
  assert.equal(validGoogleMapsBrowserKey(key), true);
  const url = googleMapsScriptUrl(key, "hu");
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://maps.googleapis.com");
  assert.equal(parsed.pathname, "/maps/api/js");
  assert.equal(parsed.searchParams.get("key"), key);
  assert.equal(parsed.searchParams.get("v"), "weekly");
  assert.equal(parsed.searchParams.get("loading"), "async");
  assert.equal(parsed.searchParams.get("language"), "hu");
  assert.equal(parsed.searchParams.get("callback"), APPEARANCE_MAP_READY_CALLBACK);
  assert.deepEqual([...parsed.searchParams.keys()].sort(), ["callback", "key", "language", "loading", "v"]);

  assert.equal(googleMapsScriptUrl("", "en"), null, "no key, no script");
  assert.equal(googleMapsScriptUrl("short", "en"), null);
  assert.equal(googleMapsScriptUrl("AIza&callback=alert(1)%00", "en"), null, "an injected value is not a key");
  assert.equal(validGoogleMapsBrowserKey("x".repeat(129)), false);
});

test("the build-time browser key is read only from NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY and only when key-shaped", () => {
  const previous = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  try {
    delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
    assert.equal(googleMapsBrowserKey(), "", "absent key ⇒ the picker renders its notice and the inputs stay usable");
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY = "  AIzaSyD-example_key_0123456789abcdefghi  ";
    assert.equal(googleMapsBrowserKey(), "AIzaSyD-example_key_0123456789abcdefghi");
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY = "not a key";
    assert.equal(googleMapsBrowserKey(), "");
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
    else process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY = previous;
  }
});

test("the parent → frame and frame → parent vocabularies are closed", () => {
  assert.deepEqual(
    parseAppearanceMapParentMessage({ type: "friending.appearance-map.set", center: { latitude: 47.5, longitude: 19.04 }, radiusKm: 25, language: "hu" }),
    { type: "friending.appearance-map.set", center: { latitude: 47.5, longitude: 19.04 }, radiusKm: 25, language: "hu" },
  );
  assert.deepEqual(
    parseAppearanceMapParentMessage({ type: "friending.appearance-map.set", center: null, radiusKm: null, language: "en" }),
    { type: "friending.appearance-map.set", center: null, radiusKm: null, language: "en" },
  );
  assert.equal(parseAppearanceMapParentMessage({ type: "friending.appearance-map.set", center: null, radiusKm: 0.5, language: "en" }), null);
  assert.equal(parseAppearanceMapParentMessage({ type: "friending.appearance-map.set", center: { latitude: 95, longitude: 0 }, radiusKm: null, language: "en" }), null);
  assert.equal(parseAppearanceMapParentMessage({ type: "friending.appearance-map.set", center: null, radiusKm: null, language: "de" }), null);
  assert.equal(parseAppearanceMapParentMessage({ type: "friending.appearance-map.set", center: null, radiusKm: null, language: "en", extra: 1 }), null);
  assert.equal(parseAppearanceMapParentMessage({ type: "friending.appearance-map.moved", center: { latitude: 1, longitude: 1 } }), null, "direction matters");
  assert.equal(parseAppearanceMapParentMessage("friending.appearance-map.set"), null);

  assert.deepEqual(parseAppearanceMapFrameMessage({ type: "friending.appearance-map.ready" }), { type: "friending.appearance-map.ready" });
  assert.deepEqual(
    parseAppearanceMapFrameMessage({ type: "friending.appearance-map.moved", center: { latitude: 47.5, longitude: 19.04 } }),
    { type: "friending.appearance-map.moved", center: { latitude: 47.5, longitude: 19.04 } },
  );
  assert.equal(parseAppearanceMapFrameMessage({ type: "friending.appearance-map.ready", extra: true }), null);
  assert.equal(parseAppearanceMapFrameMessage({ type: "friending.appearance-map.moved", center: { latitude: "47", longitude: 19 } }), null);
  assert.equal(parseAppearanceMapFrameMessage({ type: "friending.appearance-map.set", center: null, radiusKm: null, language: "en" }), null);
  assert.equal(parseAppearanceMapFrameMessage(null), null);

  assert.equal(roundAppearanceCoordinate(47.49791234567), 47.497912);
  assert.equal(roundAppearanceCoordinate(-0.0000004), -0);
});

test("the embedded map is initialised with Google's fixed DARK colour scheme and nothing else changes", () => {
  const options = appearanceMapOptions({ lat: 47.4979, lng: 19.0402 });
  assert.equal(options.colorScheme, "DARK");
  assert.equal(APPEARANCE_MAP_COLOR_SCHEME, "DARK");
  assert.deepEqual(options, {
    center: { lat: 47.4979, lng: 19.0402 },
    zoom: 9,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    clickableIcons: false,
    gestureHandling: "greedy",
    colorScheme: "DARK",
  });
  const frame = readFileSync(new URL("../components/AppearanceMapFrame.tsx", import.meta.url), "utf8");
  assert.match(frame, /new google\.maps\.Map\(element, appearanceMapOptions\(start\)\)/, "the frame hands exactly the pinned options to google.maps.Map");
  assert.doesNotMatch(frame, /FOLLOW_SYSTEM|colorScheme: "LIGHT"/);
});

test("a trusted moved message reaches the draft only while the picker is enabled, and the lock is read live", () => {
  const moved = { type: "friending.appearance-map.moved" as const, center: { latitude: 47.5, longitude: 19.04 } };
  const ready = { type: "friending.appearance-map.ready" as const };
  assert.deepEqual(appearanceMapMoveAccepted(moved, false), moved.center, "enabled: the move is applied");
  assert.equal(appearanceMapMoveAccepted(moved, true), null, "disabled: the move is ignored");
  assert.equal(appearanceMapMoveAccepted(ready, false), null, "ready is never a move");
  // disabled -> enabled -> disabled sequence: every decision reads the current flag, none a captured one.
  const sequence = [true, false, true].map((disabled) => appearanceMapMoveAccepted(moved, disabled) !== null);
  assert.deepEqual(sequence, [false, true, false]);
  const picker = readFileSync(new URL("../components/AppearanceMapPicker.tsx", import.meta.url), "utf8");
  assert.match(picker, /const disabledRef = useRef\(disabled\);\s*\n\s*disabledRef\.current = disabled;/, "the lock lives in a ref updated on every render");
  assert.match(picker, /appearanceMapMoveAccepted\(message, disabledRef\.current\)/, "the message handler consults the live ref, not the prop closure");
  assert.match(picker, /tabIndex=\{disabled \? -1 : 0\}/, "a locked frame is not focusable");
  assert.match(picker, /aria-disabled=\{disabled\}/, "accessible disabled indication");
  assert.match(picker, /is-disabled/, "the disabled class carries the pointer-events rule");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.appearance-map-iframe\.is-disabled \{[^}]*pointer-events: none/, "a locked frame is not pointer-interactive");
});
