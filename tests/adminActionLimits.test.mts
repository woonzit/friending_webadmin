import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import {
  ADMIN_ACTIONS,
  adminActionBodyLimit,
  adminActionTimeoutMs,
} from "../lib/adminActions.ts";

// `lib/core.ts` carries the shared Core credential and is therefore a `server-only` module. Plain
// Node has no React Server Component resolution condition, so the marker package is pointed at an
// empty module for this test. Nothing else about the module under test is replaced.
const EMPTY_MODULE_URL = "data:text/javascript,";
const LOADER_SOURCE = `export function resolve(specifier, context, next) {
  if (specifier === "server-only") {
    return { url: ${JSON.stringify(EMPTY_MODULE_URL)}, shortCircuit: true, format: "module" };
  }
  return next(specifier, context);
}`;

type ResolveNext = (specifier: string, context: unknown) => unknown;
type ResolveHook = (specifier: string, context: unknown, next: ResolveNext) => unknown;

const moduleApi = nodeModule as unknown as {
  registerHooks?: (hooks: { resolve: ResolveHook }) => void;
  register?: (specifier: string, parentURL: string) => void;
};

if (typeof moduleApi.registerHooks === "function") {
  moduleApi.registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "server-only") {
        return { url: EMPTY_MODULE_URL, shortCircuit: true, format: "module" };
      }
      return next(specifier, context);
    },
  });
} else if (typeof moduleApi.register === "function") {
  moduleApi.register("data:text/javascript," + encodeURIComponent(LOADER_SOURCE), import.meta.url);
} else {
  throw new Error("no module resolution hook API available");
}

// Obvious placeholder, never a real credential. Only its length matters.
process.env.WEBADMIN_API_SECRET = "test-webadmin-api-secret-0000000000";
process.env.CORE_API_BASE = "https://core.invalid";

const { coreCall } = await import("../lib/core.ts");

const realFetch = globalThis.fetch;

/** The five catalogue paths that traverse the migrated 627-item catalogue. */
const BULK_ACTIONS = [
  "profile_tag_catalogs",
  "profile_tag_catalog_preview",
  "save_profile_tag_catalog",
  "profile_presentation",
  "save_profile_presentation",
  // Core decodes the JPEG and writes six files before it answers.
  "admin_replace_image",
];

test("the per-action timeout table raises only the measured bulk catalogue paths", () => {
  for (const action of BULK_ACTIONS) {
    assert.equal(adminActionTimeoutMs(action), 30_000, action);
  }
  for (const action of ADMIN_ACTIONS) {
    if (BULK_ACTIONS.includes(action)) continue;
    assert.equal(adminActionTimeoutMs(action), 10_000, action);
  }
  // An action nobody classified gets the conservative default, never the generous one.
  assert.equal(adminActionTimeoutMs("not_an_action"), 10_000);
  assert.equal(adminActionTimeoutMs("__proto__"), 10_000);
  assert.equal(adminActionTimeoutMs("constructor"), 10_000);
});

// Every raised ceiling is named here so adding one is a deliberate edit to this
// table and not a silent consequence of allow-listing an action.
const RAISED_BODY_LIMITS: Partial<Record<(typeof ADMIN_ACTIONS)[number], number>> = {
  save_profile_tag_catalog: 1_100_000,
  // A full 249-country selection collapses to ALL; the true maximum is every
  // storefront selecting 248 countries plus all 205 derived calling codes.
  set_settings: 694_000,
  // The invitation policy can cover all ISO storefronts and up to twenty
  // bounded localized templates per rule.
  save_invite_configuration: 16_000_000,
  // A re-cropped picture travels as base64, which costs about a third on top of
  // the JPEG. Core refuses a decoded image over 8 MiB.
  admin_replace_image: 6_000_000,
  // Verification A1 carries a bounded 2 MiB PNG as base64 in the JSON body.
  verification_badge_upload: 3_145_728,
  // D-052: a rule may replace the hero carousel with 100 bounded items, about
  // 750 KB at the caps, so the save shares the tag-catalogue ceiling.
  appearance_rules_save: 1_100_000,
  // T-617: the method policy's `draft_json` may name all 249 storefronts with a
  // scalar method AND a copy override at every contract cap; the browser JSON at
  // those maxima is derived and built below. The impact preview and the
  // publication carry only a revision, so they keep the default ceiling.
  verification_method_save: 2_400_000,
};

test("the per-action body ceiling is raised only where it is named", () => {
  for (const [action, limit] of Object.entries(RAISED_BODY_LIMITS)) {
    assert.equal(adminActionBodyLimit(action), limit, action);
  }
  for (const action of ADMIN_ACTIONS) {
    if (action in RAISED_BODY_LIMITS) continue;
    assert.equal(adminActionBodyLimit(action), 256_000, action);
  }
  assert.equal(adminActionBodyLimit("not_an_action"), 256_000);
  assert.equal(adminActionBodyLimit("__proto__"), 256_000);
});

/**
 * `save_signup_photo_config` is deliberately absent from `RAISED_BODY_LIMITS`. Rather than assert
 * that by comment, build the largest document the editor can produce — twelve tip cards, every
 * string filled to its cap with four-byte characters and both image URLs at the maximum length —
 * and check that the request body the browser would send still fits under the default ceiling.
 * Raising a cap far enough to break that fails here instead of turning into a silent 413.
 */
test("the largest signup photo document fits under the default body ceiling", async () => {
  const {
    MAX_CAPTION_LENGTH,
    MAX_LINK_TITLE_LENGTH,
    MAX_MODERATION_TEXT_LENGTH,
    MAX_SUBTITLE_LENGTH,
    MAX_TIP_ITEMS,
    MAX_TIP_KEY_LENGTH,
    MAX_TITLE_LENGTH,
    MAX_URL_LENGTH,
    signupPhotoSavePayload,
  } = await import("../lib/signupPhotoConfig.ts");

  // U+1D518 is four bytes in UTF-8 and one code point, which is what the length caps count.
  const wide = (codePoints: number) => "\u{1D518}".repeat(codePoints);
  const map = (codePoints: number) => ({ en: wide(codePoints), hu: wide(codePoints) });
  const imagePrefix = "https://img.friending.co/api/cache/";
  const longUrl = `${imagePrefix}${"a".repeat(MAX_URL_LENGTH - imagePrefix.length)}`;
  assert.equal(longUrl.length, MAX_URL_LENGTH);

  const payload = signupPhotoSavePayload({
    revision: 999_999,
    min_photos: 1,
    max_photos: 6,
    moderation: {
      enabled: true,
      text: map(MAX_MODERATION_TEXT_LENGTH),
      link_title: map(MAX_LINK_TITLE_LENGTH),
      link_url: longUrl,
    },
    avatar: { title: map(MAX_TITLE_LENGTH), subtitle: map(MAX_SUBTITLE_LENGTH) },
    tips: {
      title: map(MAX_TITLE_LENGTH),
      items: Array.from({ length: MAX_TIP_ITEMS }, (_, index) => ({
        uid: `tip-row-${index}`,
        key: `${"a".repeat(MAX_TIP_KEY_LENGTH - 2)}${String(index).padStart(2, "0")}`,
        caption: map(MAX_CAPTION_LENGTH),
        verdict: "good" as const,
        sort_order: 100_000,
        image_female: longUrl,
        image_male: longUrl,
      })),
    },
  });

  // `adminClient.adminCall` sends exactly this, and the bridge measures the UTF-8 byte length.
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  assert.ok(bytes > 0);
  assert.ok(
    bytes < adminActionBodyLimit("save_signup_photo_config"),
    `maximal signup photo body is ${bytes} bytes`,
  );
  assert.equal(adminActionBodyLimit("save_signup_photo_config"), 256_000);
  assert.equal(adminActionBodyLimit("signup_photo_config"), 256_000);
});

/**
 * T-475 B4, restated for T-617. The mandatory-method save sits above the default ceiling, which
 * would refuse a document that is valid at every contract cap. Derive the maximum from the caps
 * alone, build that document, prove the proxy parser admits it, and pin both sides of the ceiling:
 * the maximum fits with the documented margin, and one byte over the ceiling fails the exact
 * predicate the bridge applies (`Buffer.byteLength(raw, "utf8") > bodyLimit` -> 413).
 */
test("the largest method-policy document fits its own ceiling and one byte over is refused", async () => {
  const {
    FORCED_STOREFRONTS,
    WAITING_ROOM_COPY_LIMITS,
    WAITING_ROOM_HELP_URL_MAX_BYTES,
  } = await import("../lib/forcedVerification.ts");
  const {
    VERIFICATION_METHOD_REVISION_MAX,
    normalizeVerificationMethodProxyBody,
  } = await import("../lib/verificationMethod.ts");

  // The contract counts text in code points; U+1D518 is one code point and four UTF-8 bytes.
  const wide = (codePoints: number) => "\u{1D518}".repeat(codePoints);
  // Core admits only RFC 3986 ASCII in a help URL, so its 2048-byte cap is 2048 JSON bytes as well.
  const helpPrefix = "https://help.friending.com/";
  const helpUrl = `${helpPrefix}${"a".repeat(WAITING_ROOM_HELP_URL_MAX_BYTES - helpPrefix.length)}`;
  const block = {
    title: wide(WAITING_ROOM_COPY_LIMITS.title),
    subtitle: wide(WAITING_ROOM_COPY_LIMITS.subtitle),
    description: wide(WAITING_ROOM_COPY_LIMITS.description),
    help_url: helpUrl,
  };
  // `persona` is the longest method literal.
  const method = "persona";
  const storefronts = FORCED_STOREFRONTS.map((storefront) => storefront.alpha3);
  assert.equal(storefronts.length, 249);
  const requestId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const draft = {
    global: method,
    overrides: Object.fromEntries(storefronts.map((code) => [code, method])),
    waiting_room_copy: {
      default: { en: block, hu: block },
      overrides: Object.fromEntries(storefronts.map((code) => [code, { en: block, hu: block }])),
    },
  };
  const body = {
    contract_version: 1,
    draft_json: draft,
    expected_revision: VERIFICATION_METHOD_REVISION_MAX,
    request_id: requestId,
  };
  // Valid at every cap: the proxy parser forwards it unchanged.
  assert.deepEqual(normalizeVerificationMethodProxyBody("verification_method_save", body), body);

  // The same figure from the caps alone. `adminClient.adminCall` sends `JSON.stringify(body)`:
  // no whitespace, non-ASCII text raw (four bytes per code point here), the URL byte for byte.
  const count = storefronts.length;
  const textBytes = 4 * (WAITING_ROOM_COPY_LIMITS.title + WAITING_ROOM_COPY_LIMITS.subtitle + WAITING_ROOM_COPY_LIMITS.description);
  const blockBytes = '{"title":"","subtitle":"","description":"","help_url":""}'.length + textBytes + WAITING_ROOM_HELP_URL_MAX_BYTES;
  const localesBytes = '{"en":,"hu":}'.length + 2 * blockBytes;
  const methodBytes = JSON.stringify(method).length;
  const mapBytes = (entryBytes: number) => "{}".length + count * ('"XXX":'.length + entryBytes) + (count - 1);
  const copyBytes = '{"default":,"overrides":}'.length + localesBytes + mapBytes(localesBytes);
  const documentBytes = '{"global":,"overrides":,"waiting_room_copy":}'.length
    + methodBytes + mapBytes(methodBytes) + copyBytes;
  const derived = '{"contract_version":1,"draft_json":,"expected_revision":,"request_id":""}'.length
    + documentBytes + String(VERIFICATION_METHOD_REVISION_MAX).length + requestId.length;

  const raw = JSON.stringify(body);
  const bytes = Buffer.byteLength(raw, "utf8");
  assert.equal(bytes, derived, "the built document is exactly the derived maximum");

  const limit = adminActionBodyLimit("verification_method_save");
  assert.equal(limit, 2_400_000);
  assert.equal(adminActionBodyLimit("verification_method_impact"), 256_000, "the preview carries only a revision");
  assert.equal(adminActionBodyLimit("verification_method_apply"), 256_000, "the publication carries only a revision, a fingerprint and a bounded reason");
  assert.ok(bytes > 256_000, "the default ceiling would refuse this valid document");
  assert.ok(bytes <= limit, `maximal method body is ${bytes} bytes`);
  assert.ok(limit - bytes >= Math.floor(bytes / 10), "about ten percent of headroom over the proven maximum");

  // The bridge's predicate on both sides of the ceiling: exactly at it admitted, one byte over refused.
  const atLimit = raw + " ".repeat(limit - bytes);
  const overLimit = `${atLimit} `;
  assert.equal(Buffer.byteLength(atLimit, "utf8"), limit);
  assert.equal(Buffer.byteLength(atLimit, "utf8") > limit, false);
  assert.equal(Buffer.byteLength(overLimit, "utf8"), limit + 1);
  assert.equal(Buffer.byteLength(overLimit, "utf8") > limit, true, "one byte over the ceiling is a 413 before any parsing");
});

test("a Core timeout is reported distinctly from an unreachable Core", async () => {
  // `AbortSignal.timeout` rejects with a TimeoutError DOMException.
  globalThis.fetch = (async () => {
    const error = new Error("timed out");
    error.name = "TimeoutError";
    throw error;
  }) as unknown as typeof globalThis.fetch;
  try {
    const timedOut = await coreCall("overview", {});
    assert.equal(timedOut.status, 504);
    assert.deepEqual(timedOut.data, { success: false, error: "core-timeout" });
  } finally {
    globalThis.fetch = realFetch;
  }

  // A caller-supplied abort lands in the same class: the write may still have applied.
  globalThis.fetch = (async () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  }) as unknown as typeof globalThis.fetch;
  try {
    const aborted = await coreCall("overview", {});
    assert.equal(aborted.status, 504);
    assert.deepEqual(aborted.data, { success: false, error: "core-timeout" });
  } finally {
    globalThis.fetch = realFetch;
  }

  // Anything else stays `core-unavailable`, so the existing wait-and-retry copy is unchanged.
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as unknown as typeof globalThis.fetch;
  try {
    const unavailable = await coreCall("overview", {});
    assert.equal(unavailable.status, 502);
    assert.deepEqual(unavailable.data, { success: false, error: "core-unavailable" });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("504 does not send the operator back to the login page", async () => {
  const { invalidatesAdminSession } = await import("../lib/adminActions.ts");
  assert.equal(invalidatesAdminSession(504, "core-timeout"), false);
  assert.equal(invalidatesAdminSession(502, "core-unavailable"), false);
  assert.equal(invalidatesAdminSession(401, undefined), true);
});

test("the bridge applies both per-action tables rather than a hardcoded constant", async () => {
  const route = await readFile(
    new URL("../app/api/admin/[action]/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /adminActionBodyLimit\(action\)/);
  // The predicate the body-ceiling regressions above mirror: strictly greater than the ceiling.
  assert.match(route, /Buffer\.byteLength\(raw, "utf8"\) > bodyLimit/);
  assert.match(route, /adminActionTimeoutMs\(action\)/);
  // The literals used to live in the route; they belong with the rest of the per-action policy.
  assert.doesNotMatch(route, /256_000|1_100_000|10_000/);
});
