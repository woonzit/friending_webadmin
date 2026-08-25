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
  // The invitation policy can cover all ISO storefronts and up to twenty
  // bounded localized templates per rule.
  save_invite_configuration: 16_000_000,
  // A re-cropped picture travels as base64, which costs about a third on top of
  // the JPEG. Core refuses a decoded image over 8 MiB.
  admin_replace_image: 6_000_000,
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
  assert.match(route, /adminActionTimeoutMs\(action\)/);
  // The literals used to live in the route; they belong with the rest of the per-action policy.
  assert.doesNotMatch(route, /256_000|1_100_000|10_000/);
});
