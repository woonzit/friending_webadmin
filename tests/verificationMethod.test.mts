import test from "node:test";
import assert from "node:assert/strict";
import {
  FORCED_STOREFRONTS,
  WAITING_ROOM_COMPILED_COPY,
  WAITING_ROOM_HELP_URL_MAX_BYTES,
  emptyWaitingRoomCopyOverrideDraft,
  forcedCopyTrim,
  forcedStorefrontName,
  hasBoundaryWhitespace,
  isForcedStorefront,
  localizedForcedStorefronts,
  previewWaitingRoomCopy,
  waitingRoomCopyDraft,
  waitingRoomHelpUrlByteLength,
  waitingRoomHelpUrlIssue,
  waitingRoomTextLength,
  type WaitingRoomCopyDraft,
} from "../lib/forcedVerification.ts";
import {
  MANDATORY_METHODS,
  VERIFICATION_METHOD_ACTIONS,
  VERIFICATION_METHOD_CONFIRMATION_PHRASE,
  VERIFICATION_METHOD_ERROR_STATUSES,
  VERIFICATION_METHOD_MAX_OVERRIDES,
  VERIFICATION_METHOD_PENDING_STORAGE_KEY,
  liveNonVideoStorefronts,
  liveVideoStorefronts,
  normalizeVerificationMethodProxyBody,
  resolveMandatoryMethod,
  validateVerificationMethodDraft,
  verificationMethodAccess,
  verificationMethodAdminMe,
  verificationMethodConflictResponse,
  verificationMethodConsoleResponse,
  verificationMethodDocument,
  verificationMethodDocumentFromDraft,
  verificationMethodDocumentsEqual,
  verificationMethodDraft,
  verificationMethodErrorResponse,
  verificationMethodImpactResponse,
  verificationMethodMutationResponse,
  verificationMethodPendingFrom,
  verificationMethodPendingMutation,
  verificationMethodPersistBeforeMutation,
  verificationMethodPolicy,
  verificationMethodProxyCapabilityAuthorized,
  verificationMethodReason,
  verificationMethodShouldRetainMutation,
  type MandatoryMethod,
  type VerificationMethodDocument,
} from "../lib/verificationMethod.ts";
import { ADMIN_ACTIONS, adminActionAccess } from "../lib/adminActions.ts";

/**
 * T-617 unified verification-method console (contract
 * `handoffs/verification-method-console-contract.md`, D-092 / D-092a / D-092b),
 * bound to deployed Core `b988f05`.
 *
 * This file replaces `tests/forcedVerification.test.mts`: it carries every
 * protection that file established for the shared Waiting Room copy plane —
 * the storefront catalogue, the exact `copyText` control class, PHP-compatible
 * trimming, Unicode boundary whitespace, UTF-16 well-formedness, the Core
 * c0a4212 `help_url` acceptance/refusal vectors, per-field compiled-copy
 * degradation and locale-container discipline — restated against the scalar
 * `persona | video | none` row model, plus the new endpoint surface.
 */

const LEGACY = { message: 200, status: 200, can_send: 0 } as const;
const REQUEST_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_REQUEST_ID = "0f4b6d2a-9c1e-4a7b-8d3f-1e2a3b4c5d6e";
const FINGERPRINT = "a".repeat(64);
const BEL = "\u0007";
const NEL = "\u0085";
const TAB = "\t";
const LF = "\n";
const BACKSLASH = "\\";
const LONE_SURROGATE = String.fromCharCode(0xd83d);
const HELP_PREFIX = "https://help.friending.com/";
const HELP_URL = `${HELP_PREFIX}verification`;
const HELP_URL_AT_LIMIT = HELP_PREFIX.padEnd(WAITING_ROOM_HELP_URL_MAX_BYTES, "a");

function success(data: unknown) {
  return { ...LEGACY, success: true, status_code: 200, data };
}

function refusal(error: string, status_code: number, data?: unknown) {
  return data === undefined
    ? { ...LEGACY, success: false, status_code, error }
    : { ...LEGACY, success: false, status_code, error, data };
}

function bridge(error: string, status_code: number) {
  return { success: false, error, status_code };
}

function copy(locale: "en" | "hu") {
  return { ...WAITING_ROOM_COMPILED_COPY[locale] };
}

function document(overrides: Partial<VerificationMethodDocument> = {}): VerificationMethodDocument {
  return {
    global: "none",
    overrides: {},
    waiting_room_copy: { default: { en: copy("en"), hu: copy("hu") }, overrides: {} },
    ...overrides,
  };
}

/** A document with one storefront row carrying both a method and a copy container. */
function withRow(
  storefront: string,
  method: MandatoryMethod,
  localeOverrides: { en?: Record<string, unknown>; hu?: Record<string, unknown> } = {},
  base = document(),
): VerificationMethodDocument {
  return {
    ...base,
    overrides: { ...base.overrides, [storefront]: method },
    waiting_room_copy: {
      default: base.waiting_room_copy.default,
      overrides: {
        ...base.waiting_room_copy.overrides,
        [storefront]: { en: localeOverrides.en ?? {}, hu: localeOverrides.hu ?? {} } as never,
      },
    },
  };
}

function withDefaultHelp(base: VerificationMethodDocument, help: unknown): unknown {
  return {
    ...base,
    waiting_room_copy: {
      ...base.waiting_room_copy,
      default: { ...base.waiting_room_copy.default, en: { ...base.waiting_room_copy.default.en, help_url: help } },
    },
  };
}

function withOverrideHelp(base: VerificationMethodDocument, help: unknown): unknown {
  const row = withRow("USA", "persona", {}, base);
  return {
    ...row,
    waiting_room_copy: {
      ...row.waiting_room_copy,
      overrides: { USA: { en: { help_url: help }, hu: {} } },
    },
  };
}

const AVAILABILITY = {
  video: { method: "video", policy_enable_allowed: false, new_start_available: false, reason: "deployment_unlock_disabled" },
  persona: { method: "persona", policy_enable_allowed: true, new_start_available: true, reason: null },
} as const;

const PRINCIPAL = {
  role: "owner",
  capabilities: [
    "verification_badge_edit", "verification_copy_edit", "verification_grant_edit", "verification_grant_read",
    "verification_pending_read", "verification_policy_edit", "verification_policy_publish",
    "verification_policy_read", "verification_simulate",
  ],
} as const;

function policyPayload(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    revision: 4,
    draft: { document: document({ global: "persona" }), saved_at: 1_800_000_000, saved_by: "owner@friending.com" },
    live: { document: document(), published_at: 1_799_000_000, published_by: "owner@friending.com" },
    updated_at: 1_800_000_000,
    updated_by: "owner@friending.com",
    ...overrides,
  };
}

function consolePayload(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: 1,
    principal: PRINCIPAL,
    evaluated_at: 1_800_000_000,
    policy: policyPayload(),
    method_availability: AVAILABILITY,
    publish_guard: { ready: true, blocking_codes: [] },
    compiled_defaults: { waiting_room_copy: { en: copy("en"), hu: copy("hu") } },
    storefront_catalogue_hint: "alpha-3",
    ...overrides,
  };
}

const ZERO_COUNTS = {
  members_seen: 0, currently_gated: 0, would_be_gated: 0, satisfied: 0, newly_gated: 0, newly_released: 0,
};

function impactPayload(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: 1,
    principal: PRINCIPAL,
    evaluated_at: 1_800_000_000,
    expected_revision: 4,
    normalized_fingerprint: FINGERPRINT,
    confirmation_phrase: VERIFICATION_METHOD_CONFIRMATION_PHRASE,
    method_availability: AVAILABILITY,
    publish_guard: { ready: true, blocking_codes: [] },
    impact: {
      by_storefront: [
        { storefront: "HUN", live_method: "none", draft_method: "persona", ...ZERO_COUNTS, members_seen: 7, would_be_gated: 5, satisfied: 2, newly_gated: 5 },
        { storefront: "USA", live_method: "none", draft_method: "none", ...ZERO_COUNTS, members_seen: 3, satisfied: 3 },
      ],
      unknown_storefront: { live_method: "none", draft_method: "persona", ...ZERO_COUNTS, members_seen: 2, would_be_gated: 2, newly_gated: 2 },
      totals: { members_seen: 12, currently_gated: 0, would_be_gated: 7, satisfied: 5, newly_gated: 7, newly_released: 0 },
    },
    ...overrides,
  };
}

function mutationPayload(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: 1,
    principal: PRINCIPAL,
    policy: policyPayload({ revision: 5 }),
    method_availability: AVAILABILITY,
    replayed: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Storefront catalogue (shared with Core's closed 249-entry vocabulary)
// ---------------------------------------------------------------------------

test("the storefront catalogue is ISO alpha-3 only, sorted, localized, and exactly Core's size", () => {
  assert.equal(FORCED_STOREFRONTS.length, VERIFICATION_METHOD_MAX_OVERRIDES, "Core's AuthPolicyVocabulary::STOREFRONT_COUNT");
  assert.ok(FORCED_STOREFRONTS.every((country) => /^[A-Z]{3}$/.test(country.alpha3) && /^[A-Z]{2}$/.test(country.alpha2)));
  assert.deepEqual(FORCED_STOREFRONTS.map((c) => c.alpha3), [...FORCED_STOREFRONTS.map((c) => c.alpha3)].sort());
  assert.equal(isForcedStorefront("USA"), true);
  assert.equal(isForcedStorefront("usa"), false);
  assert.equal(isForcedStorefront("US"), false);
  assert.equal(isForcedStorefront("XXX"), false);
  assert.equal(isForcedStorefront(""), false);
  const hu = localizedForcedStorefronts("hu");
  const en = localizedForcedStorefronts("en");
  assert.equal(hu.length, FORCED_STOREFRONTS.length);
  assert.equal(en.find((c) => c.alpha3 === "HUN")?.name, "Hungary");
  assert.equal(hu.find((c) => c.alpha3 === "HUN")?.name, "Magyarország");
  assert.equal(forcedStorefrontName("DEU", "en"), "Germany");
  assert.equal(forcedStorefrontName("DEU", "hu"), "Németország");
  assert.equal(forcedStorefrontName("XXX", "en"), "XXX");
});

// ---------------------------------------------------------------------------
// Document parser
// ---------------------------------------------------------------------------

test("the document parser is a scalar row model with identical method and copy override key sets", () => {
  const valid = withRow("USA", "video", { en: { title: "Verify to continue" }, hu: { description: "Rövid magyar leírás." } },
    withRow("DEU", "none", {}, document({ global: "persona" })));
  assert.deepEqual(verificationMethodDocument(valid), valid);
  assert.deepEqual(Object.keys(verificationMethodDocument(valid)!.overrides), ["DEU", "USA"], "keys are re-sorted");

  assert.equal(verificationMethodDocument(null), null);
  assert.equal(verificationMethodDocument([]), null);
  assert.equal(verificationMethodDocument({ ...valid, global: "both" }), null, "`both` is not a mandatory method");
  assert.equal(verificationMethodDocument({ ...valid, global: "inherit" }), null);
  assert.equal(verificationMethodDocument({ ...valid, global: null }), null);
  assert.equal(verificationMethodDocument({ ...valid, overrides: { US: "persona" } }), null, "alpha-2 is not a storefront");
  assert.equal(verificationMethodDocument({ ...valid, overrides: { USA: true } }), null);
  assert.equal(verificationMethodDocument({ ...valid, overrides: [] }), null, "an array is not the override map");

  // The two override key sets MUST be identical — Core refuses a mismatch with
  // `verification-method-storefront-invalid`, so the console never renders one.
  const methodOnly = { ...valid, overrides: { ...valid.overrides, FRA: "persona" } };
  assert.equal(verificationMethodDocument(methodOnly), null, "a method row without its copy container");
  const copyOnly = {
    ...valid,
    waiting_room_copy: {
      ...valid.waiting_room_copy,
      overrides: { ...valid.waiting_room_copy.overrides, FRA: { en: {}, hu: {} } },
    },
  };
  assert.equal(verificationMethodDocument(copyOnly), null, "a copy row without its method");

  // Additive server fields are ignored on a READ; command material stays exact.
  assert.deepEqual(verificationMethodDocument({ ...valid, extra: 1 }), verificationMethodDocument(valid));
  assert.equal(verificationMethodDocument({ ...valid, extra: 1 }, "exact"), null);
  assert.equal(verificationMethodDocument({ global: "none", overrides: {} }), null, "missing waiting_room_copy");
});

test("more than the catalogue's storefronts is refused, and one of each method resolves", () => {
  const stored = withRow("USA", "video", {}, withRow("DEU", "none", {}, document({ global: "persona" })));
  assert.equal(resolveMandatoryMethod(stored, null), "persona", "unknown storefront → global");
  assert.equal(resolveMandatoryMethod(stored, "FRA"), "persona", "no override → global");
  assert.equal(resolveMandatoryMethod(stored, "DEU"), "none", "an explicit none override is not inheritance");
  assert.equal(resolveMandatoryMethod(stored, "USA"), "video");
  assert.deepEqual(liveVideoStorefronts(stored), ["USA"]);
  assert.deepEqual(liveNonVideoStorefronts(stored), ["DEU"]);

  const tooMany: Record<string, string> = {};
  const tooManyCopy: Record<string, unknown> = {};
  for (const country of FORCED_STOREFRONTS) {
    tooMany[country.alpha3] = "none";
    tooManyCopy[country.alpha3] = { en: {}, hu: {} };
  }
  assert.ok(verificationMethodDocument({
    ...document(), overrides: tooMany,
    waiting_room_copy: { default: document().waiting_room_copy.default, overrides: tooManyCopy },
  }), "the whole catalogue fits exactly");
  assert.equal(verificationMethodDocument({
    ...document(), overrides: { ...tooMany, ZZZ: "none" },
    waiting_room_copy: { default: document().waiting_room_copy.default, overrides: { ...tooManyCopy, ZZZ: { en: {}, hu: {} } } },
  }), null, "one over the catalogue, and an invalid code");
});

// ---------------------------------------------------------------------------
// Policy, console, impact and mutation material
// ---------------------------------------------------------------------------

test("the policy carries one revision over draft and live and refuses a partial snapshot", () => {
  const parsed = verificationMethodPolicy(policyPayload());
  assert.ok(parsed);
  assert.equal(parsed.revision, 4);
  assert.equal(parsed.draft.document.global, "persona");
  assert.equal(parsed.live.document.global, "none");
  assert.equal(verificationMethodPolicy({ ...policyPayload(), schema_version: 2 }), null);
  assert.equal(verificationMethodPolicy({ ...policyPayload(), revision: 0 }), null);
  assert.equal(verificationMethodPolicy({ ...policyPayload(), revision: "4" }), null);
  assert.equal(verificationMethodPolicy({ ...policyPayload(), draft: { document: document(), saved_at: 1 } }), null, "a snapshot without its actor");
  assert.equal(verificationMethodPolicy({ ...policyPayload(), live: { document: document(), saved_at: 1, saved_by: "x" } }), null, "the live snapshot uses published_at/by");
  assert.equal(verificationMethodPolicy({ ...policyPayload(), updated_by: "" }), null);
});

test("the console material is exact, fails closed, and the publish guard agrees with itself", () => {
  const parsed = verificationMethodConsoleResponse(success(consolePayload()));
  assert.ok(parsed);
  assert.equal(parsed.policy.revision, 4);
  assert.equal(parsed.method_availability.video.policy_enable_allowed, false);
  assert.equal(parsed.method_availability.video.reason, "deployment_unlock_disabled");
  assert.equal(parsed.storefront_catalogue_hint, "alpha-3");
  assert.deepEqual(parsed.compiled_defaults.waiting_room_copy.en, WAITING_ROOM_COMPILED_COPY.en);
  assert.deepEqual(
    verificationMethodConsoleResponse(success({ ...consolePayload(), extra: 1 })),
    verificationMethodConsoleResponse(success(consolePayload())),
    "additive server fields are ignored on a read",
  );
  assert.equal(verificationMethodConsoleResponse(null), null);
  assert.equal(verificationMethodConsoleResponse(success({ ...consolePayload(), storefront_catalogue_hint: "alpha-2" })), null);
  assert.equal(verificationMethodConsoleResponse(success({ ...consolePayload(), contract_version: 2 })), null, "a v2 contract fails closed");
  assert.equal(verificationMethodConsoleResponse(refusal("verification-method-unavailable", 503)), null, "a refusal is never console material");
  assert.equal(
    verificationMethodConsoleResponse(success({ ...consolePayload(), publish_guard: { ready: true, blocking_codes: ["verification-method-video-unavailable"] } })),
    null,
    "`ready` must equal the empty-blocking-codes fact",
  );
  assert.ok(verificationMethodConsoleResponse(success({
    ...consolePayload(),
    publish_guard: { ready: false, blocking_codes: ["verification-method-persona-unavailable", "verification-method-video-unavailable"] },
  })), "both blocking codes, in the sorted order Core emits");
  assert.equal(verificationMethodConsoleResponse(success({
    ...consolePayload(),
    publish_guard: { ready: false, blocking_codes: ["verification-method-video-unavailable", "verification-method-persona-unavailable"] },
  })), null, "an unsorted code list is not proven material");
  assert.equal(verificationMethodConsoleResponse(success({
    ...consolePayload(), method_availability: { video: AVAILABILITY.video },
  })), null, "both methods are required");
  assert.equal(verificationMethodConsoleResponse(success({
    ...consolePayload(),
    method_availability: { ...AVAILABILITY, persona: { ...AVAILABILITY.persona, reason: "provider_unconfigured" } },
  })), null, "a reason with new_start_available=true contradicts itself");
});

test("the impact material is counts-only and its totals must add up", () => {
  const parsed = verificationMethodImpactResponse(success(impactPayload()));
  assert.ok(parsed);
  assert.deepEqual(parsed.impact.by_storefront.map((row) => row.storefront), ["HUN", "USA"]);
  assert.equal(parsed.impact.by_storefront[0].newly_gated, 5);
  assert.equal(parsed.impact.unknown_storefront.draft_method, "persona");
  assert.equal(parsed.impact.totals.members_seen, 12);
  assert.equal(parsed.confirmation_phrase, VERIFICATION_METHOD_CONFIRMATION_PHRASE);

  const payload = impactPayload();
  assert.equal(verificationMethodImpactResponse(success({
    ...payload, impact: { ...payload.impact, totals: { ...payload.impact.totals, members_seen: 13 } },
  })), null, "a total that does not add up is not a proven count");
  assert.equal(verificationMethodImpactResponse(success({ ...payload, normalized_fingerprint: "z".repeat(64) })), null);
  assert.equal(verificationMethodImpactResponse(success({ ...payload, confirmation_phrase: "PUBLISH" })), null);
  assert.equal(verificationMethodImpactResponse(success({
    ...payload,
    impact: { ...payload.impact, by_storefront: [payload.impact.by_storefront[1], payload.impact.by_storefront[0]] },
  })), null, "rows must be ascending ALPHA3");
  assert.equal(verificationMethodImpactResponse(success({
    ...payload,
    impact: { ...payload.impact, by_storefront: [{ ...payload.impact.by_storefront[0], satisfied: 99 }] },
  })), null, "a count above members_seen is refused");
  const uidLeak = { ...payload.impact.by_storefront[0], uid: 1 };
  assert.deepEqual(
    verificationMethodImpactResponse(success({ ...payload, impact: { ...payload.impact, by_storefront: [uidLeak, payload.impact.by_storefront[1]] } }))?.impact.by_storefront[0],
    parsed.impact.by_storefront[0],
    "an additive field is ignored and never surfaces",
  );
});

test("mutation material carries the authoritative policy, the replay flag and the principal", () => {
  const parsed = verificationMethodMutationResponse(success(mutationPayload()));
  assert.ok(parsed);
  assert.equal(parsed.policy.revision, 5);
  assert.equal(parsed.replayed, false);
  assert.equal(verificationMethodMutationResponse(success(mutationPayload({ replayed: 1 }))), null);
  assert.equal(verificationMethodMutationResponse(success({ ...mutationPayload(), principal: { role: "root", capabilities: [] } })), null);
  assert.equal(verificationMethodMutationResponse(success({ ...mutationPayload(), policy: undefined })), null);
  assert.equal(verificationMethodMutationResponse(refusal("verification-method-conflict", 409, { contract_version: 1 })), null);
});

test("only the two declared 409 bodies carry conflict data, and it is decoded strictly", () => {
  const data = { contract_version: 1, policy: policyPayload({ revision: 9 }), method_availability: AVAILABILITY };
  const conflict = verificationMethodConflictResponse(refusal("verification-method-conflict", 409, data));
  assert.ok(conflict);
  assert.equal(conflict.error, "verification-method-conflict");
  assert.equal(conflict.data.policy.revision, 9);
  assert.equal(verificationMethodConflictResponse(refusal("verification-method-preview-stale", 409, data))?.error, "verification-method-preview-stale");
  assert.equal(verificationMethodConflictResponse(refusal("verification-method-request-in-progress", 409, data)), null, "no other refusal carries data");
  assert.equal(verificationMethodConflictResponse(refusal("verification-method-conflict", 409)), null, "the declared body must actually carry it");
  assert.equal(verificationMethodConflictResponse(refusal("verification-method-conflict", 422, data)), null, "the status is bound too");
  assert.equal(verificationMethodConflictResponse(refusal("verification-method-conflict", 409, { ...data, contract_version: 2 })), null);
});

// ---------------------------------------------------------------------------
// Refusal vocabulary and retention
// ---------------------------------------------------------------------------

test("the refusal vocabulary equals Core's errorStatus map exactly and is status-bound", () => {
  const coreCodes = Object.entries(VERIFICATION_METHOD_ERROR_STATUSES)
    .filter(([name]) => name.startsWith("verification-method-"))
    .sort(([left], [right]) => left.localeCompare(right));
  assert.deepEqual(coreCodes, [
    ["verification-method-audit-write-failed", 503],
    ["verification-method-confirmation-invalid", 422],
    ["verification-method-conflict", 409],
    ["verification-method-contract-version", 409],
    ["verification-method-copy-default-invalid", 422],
    ["verification-method-copy-overrides-invalid", 422],
    ["verification-method-document-invalid", 422],
    ["verification-method-forbidden", 403],
    ["verification-method-persona-unavailable", 409],
    ["verification-method-preview-stale", 409],
    ["verification-method-read-failed", 503],
    ["verification-method-request-id-conflict", 409],
    ["verification-method-request-id-invalid", 422],
    ["verification-method-request-in-progress", 409],
    ["verification-method-request-invalid", 422],
    ["verification-method-revision-invalid", 422],
    ["verification-method-storefront-invalid", 422],
    ["verification-method-unavailable", 503],
    ["verification-method-video-unavailable", 409],
    ["verification-method-write-failed", 503],
  ]);
  assert.equal(verificationMethodErrorResponse(refusal("verification-method-conflict", 409)), "verification-method-conflict");
  assert.equal(verificationMethodErrorResponse(refusal("verification-method-conflict", 422)), null, "a known name at the wrong status is not a refusal");
  assert.equal(verificationMethodErrorResponse(refusal("verification-forced-read-only", 409)), null, "the retired family never decodes here");
  assert.equal(
    verificationMethodErrorResponse(refusal("verification-method-conflict", 409, { contract_version: 1 })),
    null,
    "a body carrying `data` belongs to the conflict parser; the plain error parser declines it so a versioned conflict is never flattened into a bare code",
  );
  assert.equal(verificationMethodErrorResponse(bridge("core-timeout", 504)), "core-timeout");
  assert.equal(verificationMethodErrorResponse(bridge("verification-capability-required", 403)), "verification-capability-required");
  assert.equal(verificationMethodErrorResponse(success(consolePayload())), null);
  assert.equal(verificationMethodErrorResponse(null), null);

  // Only genuinely unknown outcomes keep the retained command.
  assert.equal(verificationMethodShouldRetainMutation(null), true, "no decodable answer at all");
  assert.equal(verificationMethodShouldRetainMutation("verification-method-write-failed"), true);
  assert.equal(verificationMethodShouldRetainMutation("verification-method-audit-write-failed"), true);
  assert.equal(verificationMethodShouldRetainMutation("verification-method-request-in-progress"), true);
  assert.equal(verificationMethodShouldRetainMutation("core-timeout"), true);
  assert.equal(verificationMethodShouldRetainMutation("core-unavailable"), true);
  for (const terminal of [
    "verification-method-conflict", "verification-method-preview-stale", "verification-method-document-invalid",
    "verification-method-confirmation-invalid", "verification-method-video-unavailable",
    "verification-method-request-id-conflict", "verification-method-forbidden", "invalid-input",
  ] as const) {
    assert.equal(verificationMethodShouldRetainMutation(terminal), false, terminal);
  }
});

// ---------------------------------------------------------------------------
// Capability projection
// ---------------------------------------------------------------------------

test("the admin_me sibling is the ONLY authority for navigation and every action", () => {
  const ready = { contract_version: 1, contract_ready: true, actions: [...VERIFICATION_METHOD_ACTIONS] };
  assert.deepEqual(verificationMethodAdminMe(ready), ready);
  assert.deepEqual(verificationMethodAccess(verificationMethodAdminMe(ready)), {
    visible: true, editable: true, previewable: true, publishable: true,
  });
  const viewer = { contract_version: 1, contract_ready: true, actions: ["verification_method_console"] };
  assert.deepEqual(verificationMethodAccess(verificationMethodAdminMe(viewer)), {
    visible: true, editable: false, previewable: false, publishable: false,
  });
  const admin = { contract_version: 1, contract_ready: true, actions: ["verification_method_console", "verification_method_save"] };
  assert.deepEqual(verificationMethodAccess(verificationMethodAdminMe(admin)), {
    visible: true, editable: true, previewable: false, publishable: false,
  });

  assert.equal(verificationMethodAdminMe(undefined), null);
  assert.equal(verificationMethodAdminMe({ contract_version: 2, contract_ready: true, actions: [] }), null);
  assert.equal(verificationMethodAdminMe({ contract_version: 1, contract_ready: false, actions: ["verification_method_console"] }), null, "not ready implies no actions");
  assert.equal(verificationMethodAdminMe({ contract_version: 1, contract_ready: true, actions: ["verification_forced_console"] }), null, "a foreign action name");
  assert.equal(verificationMethodAdminMe({ contract_version: 1, contract_ready: true, actions: ["verification_method_console", "verification_method_console"] }), null, "duplicates");
  assert.equal(verificationMethodAdminMe({ contract_version: 1, contract_ready: true, actions: ["verification_method_save", "verification_method_console"] }), null, "Core sorts the list; an unsorted list is not proven material");
  assert.deepEqual(verificationMethodAccess(null), { visible: false, editable: false, previewable: false, publishable: false });

  const membership = { verification_method: ready, verification: { contract_version: 1, contract_ready: true, actions: ["verification_console"] }, role: "owner" };
  for (const action of VERIFICATION_METHOD_ACTIONS) {
    assert.equal(verificationMethodProxyCapabilityAuthorized(action, membership), true, action);
    assert.equal(verificationMethodProxyCapabilityAuthorized(action, { verification_method: viewer }), action === "verification_method_console", action);
    assert.equal(verificationMethodProxyCapabilityAuthorized(action, { role: "owner" }), false, "no sibling block means no action, whatever the role says");
    assert.equal(verificationMethodProxyCapabilityAuthorized(action, { verification_forced: { contract_version: 1, contract_ready: true, actions: [] } }), false, "the retired block never grants a method action");
  }
  assert.equal(verificationMethodProxyCapabilityAuthorized("verification_console", membership), null, "outside the family");
});

// ---------------------------------------------------------------------------
// Draft ↔ document
// ---------------------------------------------------------------------------

test("the draft is ONE row model: method and copy override travel together", () => {
  const stored = withRow("USA", "video", { en: { title: "Verify to continue" }, hu: { description: "Rövid magyar leírás." } },
    withRow("DEU", "none", {}, document({ global: "persona" })));
  const draft = verificationMethodDraft(stored);
  assert.equal(draft.global, "persona");
  assert.deepEqual(draft.overrides.map((row) => [row.storefront, row.method]), [["DEU", "none"], ["USA", "video"]]);
  const usa = draft.overrides.find((row) => row.storefront === "USA")!;
  assert.equal(usa.copy.en.title, "Verify to continue");
  assert.equal(usa.copy.en.subtitle, "", "an absent override field is a blank editor field");
  assert.equal(usa.copy.hu.description, "Rövid magyar leírás.");
  const rebuilt = verificationMethodDocumentFromDraft(draft);
  assert.ok(rebuilt);
  assert.deepEqual(rebuilt, stored);
  assert.equal(verificationMethodDocumentsEqual(rebuilt, stored), true);

  // A method-only row keeps its empty copy container: Core compares the two key sets.
  draft.overrides.reverse();
  usa.copy.en.title = "  Verify to continue  ";
  const canonical = verificationMethodDocumentFromDraft(draft)!;
  assert.deepEqual(Object.keys(canonical.overrides), ["DEU", "USA"], "storefront keys are sorted");
  assert.deepEqual(Object.keys(canonical.waiting_room_copy.overrides), ["DEU", "USA"], "the two override key sets stay identical");
  assert.deepEqual(canonical.waiting_room_copy.overrides.DEU, { en: {}, hu: {} }, "a method-only row is an empty container, never a dropped row");
  assert.equal(canonical.waiting_room_copy.overrides.USA.en?.title, "Verify to continue", "trimmed");
  assert.equal(verificationMethodDocumentsEqual(canonical, stored), true);
  assert.ok(verificationMethodDocument(canonical), "the canonical document passes the strict reader");
});

test("draft validation mirrors the contract limits and every issue has a stable code", () => {
  const draft = verificationMethodDraft(document());
  assert.equal(validateVerificationMethodDraft(draft), null);
  draft.overrides.push({ storefront: "", method: "persona", copy: emptyWaitingRoomCopyOverrideDraft() });
  assert.equal(validateVerificationMethodDraft(draft), "storefront");
  draft.overrides[0].storefront = "USA";
  draft.overrides.push({ storefront: "USA", method: "none", copy: emptyWaitingRoomCopyOverrideDraft() });
  assert.equal(validateVerificationMethodDraft(draft), "duplicateStorefront");
  draft.overrides.pop();
  draft.copy_default.hu.title = "   ";
  assert.equal(validateVerificationMethodDraft(draft), "copyRequired");
  draft.copy_default.hu.title = "x".repeat(61);
  assert.equal(validateVerificationMethodDraft(draft), "copyTooLong");
  draft.copy_default.hu.title = "Két\nsor";
  assert.equal(validateVerificationMethodDraft(draft), "copyControl", "no line break in a title");
  draft.copy_default.hu.title = "Cím";
  draft.copy_default.hu.description = "Első sor\nMásodik sor";
  assert.equal(validateVerificationMethodDraft(draft), null, "a description may break lines");
  draft.copy_default.hu.description = `tab${TAB}here`;
  assert.equal(validateVerificationMethodDraft(draft), null, "a tab is not a control character Core refuses");
  for (const [label, value] of [
    ["BEL", `bell${BEL}here`],
    ["interior NEL (C1)", `sor${NEL}sor`],
    ["the last C1 control U+009F", "sor\u009Fsor"],
    ["DEL", "sor\u007Fsor"],
  ] as const) {
    draft.copy_default.hu.description = value;
    assert.equal(validateVerificationMethodDraft(draft), "copyControl", label);
  }
  draft.copy_default.hu.description = "sor\u00A0sor";
  assert.equal(validateVerificationMethodDraft(draft), null, "U+00A0 is past the class: interior NBSP stays content");
  draft.copy_default.hu.description = "Rendben.";
  draft.overrides[0].copy.en.subtitle = "x".repeat(91);
  assert.equal(validateVerificationMethodDraft(draft), "copyTooLong", "an override field is bounded too");
  draft.overrides[0].copy.en.subtitle = "";
  assert.equal(validateVerificationMethodDraft(draft), null, "blank override fields are fine");
  assert.equal(verificationMethodDocumentFromDraft({
    ...draft, overrides: [{ storefront: "US", method: "persona", copy: emptyWaitingRoomCopyOverrideDraft() }],
  }), null, "an invalid draft never becomes a document");
});

test("Waiting Room copy is well-formed UTF-16 on every default and storefront text field", () => {
  const high = String.fromCharCode(0xd83d);
  const low = String.fromCharCode(0xde42);
  const astralPair = `${high}${low}`;
  for (const field of ["title", "subtitle", "description"] as const) {
    for (const locale of ["en", "hu"] as const) {
      for (const [label, malformed] of [["lone high surrogate", high], ["lone low surrogate", low]] as const) {
        const defaultDraft = verificationMethodDraft(document());
        defaultDraft.copy_default[locale][field] = `copy${malformed}`;
        assert.equal(validateVerificationMethodDraft(defaultDraft), "copyMalformedText", `default ${locale}.${field}: ${label}`);
        const defaultWire = document();
        defaultWire.waiting_room_copy.default[locale][field] = `copy${malformed}`;
        assert.equal(verificationMethodDocument(defaultWire), null, `published default ${locale}.${field}: ${label}`);

        const overrideDraft = verificationMethodDraft(withRow("USA", "persona"));
        overrideDraft.overrides[0].copy[locale][field] = `copy${malformed}`;
        assert.equal(validateVerificationMethodDraft(overrideDraft), "copyMalformedText", `override ${locale}.${field}: ${label}`);
        const overrideWire = withRow("USA", "persona", { [locale]: { [field]: `copy${malformed}` } });
        assert.equal(verificationMethodDocument(overrideWire), null, `published override ${locale}.${field}: ${label}`);
      }
    }
  }
  const validDraft = verificationMethodDraft(withRow("USA", "persona"));
  for (const locale of ["en", "hu"] as const) {
    for (const field of ["title", "subtitle", "description"] as const) {
      validDraft.copy_default[locale][field] = `Default ${astralPair}`;
      validDraft.overrides[0].copy[locale][field] = `Override ${astralPair}`;
    }
  }
  assert.equal(validateVerificationMethodDraft(validDraft), null, "a valid astral surrogate pair passes every text field");
  const validWire = verificationMethodDocumentFromDraft(validDraft);
  assert.ok(validWire && verificationMethodDocument(validWire), "the astral pair survives canonicalization and strict parsing");
});

test("copy whitespace mirrors Core: PHP trim, Unicode boundary whitespace refused, interior NBSP kept", () => {
  assert.equal(forcedCopyTrim(" \t\n\r\0\x0BCím \t\n\r\0\x0B"), "Cím", "PHP trim strips exactly its ASCII set");
  assert.equal(forcedCopyTrim("\u00A0Cím\u00A0"), "\u00A0Cím\u00A0", "PHP trim never strips Unicode whitespace");
  assert.equal(hasBoundaryWhitespace("Nem\u00A0törhető"), false, "interior NBSP is not boundary whitespace");
  for (const edge of ["\u00A0", "\u1680", "\u2000", "\u2003", "\u200A", "\u2028", "\u2029", "\u202F", "\u205F", "\u3000", "\u0085", "\uFEFF"]) {
    const label = `U+${edge.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
    assert.equal(hasBoundaryWhitespace(`${edge}Cim`), true, `leading ${label}`);
    assert.equal(hasBoundaryWhitespace(`Cim${edge}`), true, `trailing ${label}`);
    assert.equal(hasBoundaryWhitespace(`Ci${edge}m`), false, `interior ${label}`);
  }

  const draft = verificationMethodDraft(withRow("USA", "persona"));
  for (const [label, value, issue] of [
    ["leading NBSP", "\u00A0Cím", "copyWhitespace"],
    ["trailing NBSP", "Cím\u00A0", "copyWhitespace"],
    ["NBSP-only is a whitespace refusal, not a blank field", "\u00A0", "copyWhitespace"],
    ["Unicode-whitespace-only after the ASCII edges are trimmed", " \u00A0\u2003 ", "copyWhitespace"],
    ["BOM edge", "\uFEFFCím", "copyWhitespace"],
    ["an edge NEL is boundary whitespace AND a C1 control; the control refusal wins", "Cím\u0085", "copyControl"],
    ["interior NEL", "Cí\u0085m", "copyControl"],
  ] as const) {
    draft.copy_default.hu.title = value;
    assert.equal(validateVerificationMethodDraft(draft), issue, label);
  }
  draft.copy_default.hu.title = " \tNem\u00A0törhető cím\r\n";
  assert.equal(validateVerificationMethodDraft(draft), null, "ASCII edges are trimmed, never refused");
  const canonical = verificationMethodDocumentFromDraft(draft)!;
  assert.equal(canonical.waiting_room_copy.default.hu.title, "Nem\u00A0törhető cím", "the canonical text keeps the interior NBSP");
  assert.equal(waitingRoomTextLength(forcedCopyTrim(" a\u00A0b ")), 3, "the editor counter counts the NBSP");

  draft.copy_default.hu.title = "Cím";
  draft.overrides[0].copy.en.title = "Verify\u00A0";
  assert.equal(validateVerificationMethodDraft(draft), "copyWhitespace", "override copy: trailing NBSP");
  draft.overrides[0].copy.en.title = "\u00A0";
  assert.equal(validateVerificationMethodDraft(draft), "copyWhitespace", "an override made only of NBSP is refused, not dropped as blank");
  draft.overrides[0].copy.en.title = "Verify\u00A0to continue";
  assert.equal(validateVerificationMethodDraft(draft), null);
  assert.equal(verificationMethodDocumentFromDraft(draft)!.waiting_room_copy.overrides.USA.en?.title, "Verify\u00A0to continue");

  const withTitle = (title: string) => {
    const base = document();
    return { ...base, waiting_room_copy: { ...base.waiting_room_copy, default: { ...base.waiting_room_copy.default, en: { ...base.waiting_room_copy.default.en, title } } } };
  };
  for (const [label, title] of [
    ["leading NBSP", "\u00A0Verify"],
    ["trailing NBSP", "Verify\u00A0"],
    ["NBSP-only", "\u00A0"],
    ["untrimmed ASCII edge", " Verify"],
    ["NEL edge", `Verify${NEL}`],
    ["interior NEL: a C1 control", `Ver${NEL}ify`],
    ["interior U+009F", "Ver\u009Fify"],
  ] as const) {
    assert.equal(verificationMethodDocument(withTitle(title)), null, `published ${label} fails closed`);
  }
  assert.ok(verificationMethodDocument(withTitle("Verify\u00A0now")), "published interior NBSP is content");
  assert.equal(verificationMethodDocument(withRow("USA", "persona", { en: { subtitle: `Ver${NEL}ify` } })), null, "an override text carries the same control class");
});

test("a storefront copy override requires both locale containers and ignores unknown locales on read", () => {
  const full = withRow("HUN", "persona", { en: { title: "Verify to continue" }, hu: { title: "Hitelesíts a folytatáshoz" } });
  assert.ok(verificationMethodDocument(full), "both containers parse");
  assert.ok(verificationMethodDocument(withRow("HUN", "persona")), "two empty containers are the valid inherit-everything shape");
  const partial = { ...full, waiting_room_copy: { ...full.waiting_room_copy, overrides: { HUN: { en: { title: "Verify to continue" } } } } };
  assert.equal(verificationMethodDocument(partial), null, "a missing hu container is never proven state");
  assert.equal(verificationMethodDocument({ ...full, waiting_room_copy: { ...full.waiting_room_copy, overrides: { HUN: {} } } }), null, "neither locale");
  const additiveLocale = { ...full, waiting_room_copy: { ...full.waiting_room_copy, overrides: { HUN: { en: {}, hu: {}, de: {} } } } };
  assert.deepEqual(verificationMethodDocument(additiveLocale), verificationMethodDocument(withRow("HUN", "persona")), "an unknown locale is ignored on a read");
  assert.equal(verificationMethodDocument(additiveLocale, "exact"), null, "the outbound document stays exact");
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_save", {
    contract_version: 1, draft_json: partial, expected_revision: 1, request_id: REQUEST_ID,
  }), null, "the proxy refuses to forward a partial locale container");
});

// ---------------------------------------------------------------------------
// help_url (Core c0a4212 vectors)
// ---------------------------------------------------------------------------

test("help_url validator agrees with every Core c0a4212 acceptance and refusal vector", () => {
  const coreMaximumHelpUrl = "https://friending.com/help/".padEnd(WAITING_ROOM_HELP_URL_MAX_BYTES, "a");
  const accepted = [
    "https://friending.com/help/verification",
    "https://xn--sg-fka.friending.com:8443/p/%C3%BA?q=1&r=2#top",
    coreMaximumHelpUrl,
    "https://friending.com:443/help",
    "https://friending.com:1/",
    "https://friending.com:65535",
    "https://friending.com/help?next=:1x#:+1",
  ] as const;
  const refused: ReadonlyArray<readonly [string, unknown]> = [
    ["null is not a URL string", null],
    ["wrong type", 123],
    ["empty", ""],
    ["http scheme", "http://friending.com/help"],
    ["uppercase scheme", "HTTPS://friending.com/help"],
    ["scheme only", "https://"],
    ["credentials", "https://user:secret@friending.com/help"],
    ["empty user-info", "https://@friending.com/help"],
    ["one byte over the limit", `${coreMaximumHelpUrl}a`],
    ["C0 control character", `https://friending.com/help${BEL}`],
    ["C1 control character", `https://friending.com/help${NEL}`],
    ["interior whitespace", "https://friending.com/help page"],
    ["boundary whitespace", " https://friending.com/help"],
    ["trailing newline", `https://friending.com/help${LF}`],
    ["raw non-ASCII path", "https://friending.com/súgó"],
    ["raw IDN host", "https://súgó.friending.com/"],
    ["malformed percent escape", "https://friending.com/%zz"],
    ["invalid host label", "https://-friending.com/"],
    ["IPv6 host", "https://[2001:db8::1]/help"],
    ["empty authority", "https:///help"],
    ["empty host before a port", "https://:443/"],
    ["invalid port", "https://friending.com:abc/"],
    ["empty port", "https://friending.com:/"],
    ["port zero", "https://friending.com:0/"],
    ["port above 65535", "https://friending.com:65536/"],
    ["two ports", "https://friending.com:443:1/"],
    ["port with a trailing letter", "https://friending.com:1x/"],
    ["signed port", "https://friending.com:+1/"],
    ["fractional port", "https://friending.com:1.5/"],
    ["exponent port", "https://friending.com:1e2/"],
    ["leading-zero port", "https://friending.com:0443/"],
    ["credentials after a port", "https://friending.com:443@evil.test/"],
    ["backslash in a path", `https://friending.com${BACKSLASH}help`],
    ["credentials behind a backslash", `https://example.com${BACKSLASH}@evil.test/`],
  ];

  const base = document();
  for (const value of accepted) {
    assert.equal(waitingRoomHelpUrlIssue(value), null, `Core accepts ${value.slice(0, 80)}`);
    assert.ok(verificationMethodDocument(withDefaultHelp(base, value)), `published default accepts ${value.slice(0, 80)}`);
    assert.ok(verificationMethodDocument(withOverrideHelp(base, value)), `published override accepts ${value.slice(0, 80)}`);
  }
  for (const [label, value] of refused) {
    assert.notEqual(waitingRoomHelpUrlIssue(value), null, `Core refuses: ${label}`);
    assert.equal(verificationMethodDocument(withOverrideHelp(base, value)), null, `published override refuses: ${label}`);
    if (value !== null) assert.equal(verificationMethodDocument(withDefaultHelp(base, value)), null, `published default refuses: ${label}`);
  }
  assert.equal(verificationMethodDocument(withOverrideHelp(base, null)), null, "an override inherits by omitting the key, never with null");
  assert.equal(verificationMethodDocument(withDefaultHelp(base, null)) !== null, true, "null on the global default is the explicit no-button form");
  assert.equal(WAITING_ROOM_COMPILED_COPY.en.help_url, null, "the compiled default has no help button");
  assert.equal(waitingRoomHelpUrlByteLength(" https://é.example "), 20, "bytes of the raw value, not code points");
  assert.equal(waitingRoomHelpUrlIssue(HELP_URL_AT_LIMIT), null, "exactly 2048 bytes fits");
  for (const suffix of ["/@x", "/?@x", "/#@x", "?@x", "#@x"]) {
    assert.equal(waitingRoomHelpUrlIssue(`${HELP_PREFIX.slice(0, -1)}${suffix}`), null, `an @ after ${JSON.stringify(suffix[0])} is not a credential`);
  }
});

test("help_url: draft round trip keeps null / URL / inherit and every refusal has a stable issue code", () => {
  const stored = withRow("USA", "persona", { en: { help_url: `${HELP_PREFIX}us` }, hu: { title: "Cím" } });
  stored.waiting_room_copy.default.en.help_url = HELP_URL;
  const draft = verificationMethodDraft(stored);
  assert.equal(draft.copy_default.en.help_url, HELP_URL);
  assert.equal(draft.copy_default.hu.help_url, "", "null edits as a blank field");
  const usa = draft.overrides[0];
  assert.equal(usa.copy.en.help_url, `${HELP_PREFIX}us`);
  assert.equal(usa.copy.hu.help_url, "", "an absent override URL is a blank (inherit) field");
  const rebuilt = verificationMethodDocumentFromDraft(draft)!;
  assert.deepEqual(rebuilt, stored, "round trip");
  assert.deepEqual(Object.keys(rebuilt.waiting_room_copy.default.hu), ["title", "subtitle", "description", "help_url"], "help_url last, the order Core compares");
  assert.equal(rebuilt.waiting_room_copy.default.hu.help_url, null, "the global default always carries the key: null = no button");
  assert.deepEqual(waitingRoomCopyDraft(WAITING_ROOM_COMPILED_COPY.en), { ...WAITING_ROOM_COMPILED_COPY.en, help_url: "" });
  assert.deepEqual(emptyWaitingRoomCopyOverrideDraft().hu, { title: "", subtitle: "", description: "", help_url: "" });

  draft.copy_default.en.help_url = ` ${HELP_URL}`;
  assert.equal(validateVerificationMethodDraft(draft), "copyHelpUrlInvalid", "the validator never repairs a Core-invalid boundary space");
  assert.equal(verificationMethodDocumentFromDraft(draft), null);
  draft.copy_default.en.help_url = "";
  assert.equal(verificationMethodDocumentFromDraft(draft)!.waiting_room_copy.default.en.help_url, null, "a blank global URL is explicit null");
  usa.copy.en.help_url = "";
  assert.equal(Object.hasOwn(verificationMethodDocumentFromDraft(draft)!.waiting_room_copy.overrides.USA.en, "help_url"), false, "a blank override URL is an absent key (inherit)");
  usa.copy.hu.title = "";
  assert.deepEqual(
    verificationMethodDocumentFromDraft(draft)!.waiting_room_copy.overrides.USA,
    { en: {}, hu: {} },
    "a row that overrides no copy at all keeps its empty containers — the key sets must match",
  );

  for (const [value, issue] of [
    ["http://help.friending.com/", "copyHelpUrlInvalid"],
    ["help.friending.com", "copyHelpUrlInvalid"],
    ["https://", "copyHelpUrlInvalid"],
    [`https:${BACKSLASH}${BACKSLASH}help.friending.com`, "copyHelpUrlInvalid"],
    ["https:help.friending.com", "copyHelpUrlInvalid"],
    [`${HELP_URL_AT_LIMIT}a`, "copyHelpUrlTooLong"],
    [`${HELP_PREFIX}${"é".repeat(1011)}`, "copyHelpUrlTooLong"],
    [`${HELP_PREFIX}${BEL}`, "copyHelpUrlControl"],
    [`${HELP_PREFIX}a${TAB}b`, "copyHelpUrlControl"],
    [`${HELP_PREFIX}${NEL}`, "copyHelpUrlControl"],
    [`${HELP_PREFIX}${LONE_SURROGATE}`, "copyHelpUrlControl"],
    [`${HELP_PREFIX}súgó`, "copyHelpUrlInvalid"],
    [`${HELP_PREFIX}bad%zz`, "copyHelpUrlInvalid"],
    ["https://-help.friending.com/", "copyHelpUrlInvalid"],
    ["https://help.friending.com:65536/", "copyHelpUrlInvalid"],
    ["https://help.friending.com:0443/", "copyHelpUrlInvalid"],
    ["https://user:secret@help.friending.com/", "copyHelpUrlCredentials"],
    ["https://user@help.friending.com/", "copyHelpUrlCredentials"],
    ["https://@help.friending.com/", "copyHelpUrlCredentials"],
    [`https://example.com${BACKSLASH}@evil.test/`, "copyHelpUrlInvalid"],
  ] as const) {
    assert.equal(waitingRoomHelpUrlIssue(value), issue, JSON.stringify(value.slice(0, 40)));
    draft.copy_default.en.help_url = value;
    assert.equal(validateVerificationMethodDraft(draft), issue, `global: ${issue}`);
    assert.equal(verificationMethodDocumentFromDraft(draft), null, "an invalid draft never becomes a document");
    draft.copy_default.en.help_url = "";
    usa.copy.hu.help_url = value;
    assert.equal(validateVerificationMethodDraft(draft), issue, `override: ${issue}`);
    usa.copy.hu.help_url = "";
  }
  assert.equal(validateVerificationMethodDraft(draft), null);
});

test("preview: a malformed value degrades to the compiled text per field while the method stands", () => {
  const compiled = { en: copy("en"), hu: copy("hu") };
  const draft = verificationMethodDraft(withRow("USA", "video", {}, document({ global: "persona" })));
  const globalHu: WaitingRoomCopyDraft = draft.copy_default.hu;
  globalHu.title = "x".repeat(61);
  assert.equal(validateVerificationMethodDraft(draft), "copyTooLong", "the draft is not saveable");
  assert.equal(draft.global, "persona", "copy is presentation; it never touches the method");
  assert.equal(draft.overrides[0].method, "video");

  const hu = previewWaitingRoomCopy(null, globalHu, "hu", compiled);
  assert.deepEqual(hu.compiledFields, ["title"]);
  assert.equal(hu.copy.title, compiled.hu.title, "the over-limit title degrades to the compiled title");
  assert.equal(hu.copy.subtitle, globalHu.subtitle, "valid fields keep the draft text");
  assert.deepEqual(previewWaitingRoomCopy(null, draft.copy_default.en, "en", compiled).compiledFields, [], "the other locale is untouched");

  const usaEn = draft.overrides[0].copy.en;
  usaEn.title = "  Verify  ";
  usaEn.subtitle = "\u00A0";
  const usa = previewWaitingRoomCopy(usaEn, draft.copy_default.en, "en", compiled);
  assert.equal(usa.copy.title, "Verify", "a valid override is PHP-trimmed and used");
  assert.equal(usa.copy.subtitle, compiled.en.subtitle, "an NBSP-only override degrades to the compiled subtitle");
  assert.equal(usa.copy.description, draft.copy_default.en.description, "a blank override inherits the global default");
  assert.deepEqual(usa.compiledFields, ["subtitle"]);
  draft.copy_default.en.description = "";
  assert.deepEqual(previewWaitingRoomCopy(usaEn, draft.copy_default.en, "en", compiled).compiledFields, ["subtitle", "description"], "a missing default is a degraded field too");
  assert.deepEqual(previewWaitingRoomCopy(null, draft.copy_default.en, "en", compiled).compiledFields, ["description"], "a row without overrides degrades only the missing default");
});

test("help_url preview: inherit resolution and the button-only-with-a-URL rule", () => {
  const compiled = { en: copy("en"), hu: copy("hu") };
  const stored = withRow("USA", "persona", { en: { help_url: `${HELP_PREFIX}us` } },
    withRow("DEU", "persona", { en: { title: "Verify" } }));
  stored.waiting_room_copy.default.en.help_url = HELP_URL;
  const draft = verificationMethodDraft(stored);
  const deu = draft.overrides.find((row) => row.storefront === "DEU")!;
  const usa = draft.overrides.find((row) => row.storefront === "USA")!;
  assert.equal(previewWaitingRoomCopy(usa.copy.en, draft.copy_default.en, "en", compiled).copy.help_url, `${HELP_PREFIX}us`, "an override URL wins");
  assert.equal(previewWaitingRoomCopy(deu.copy.en, draft.copy_default.en, "en", compiled).copy.help_url, HELP_URL, "an override without help_url inherits the global URL");
  const none = previewWaitingRoomCopy(usa.copy.hu, draft.copy_default.hu, "hu", compiled);
  assert.equal(none.copy.help_url, null, "the English URL never leaks into Hungarian, whose default is null");
  assert.deepEqual(none.compiledFields, [], "no button is a legitimate state, not a degraded field");
  usa.copy.en.help_url = ` ${HELP_PREFIX}us`;
  const untrimmed = previewWaitingRoomCopy(usa.copy.en, draft.copy_default.en, "en", compiled);
  assert.equal(untrimmed.copy.help_url, null, "the preview never repairs a Core-invalid URL");
  assert.deepEqual(untrimmed.compiledFields, ["help_url"]);
  usa.copy.en.help_url = "http://help.friending.com/us";
  const degraded = previewWaitingRoomCopy(usa.copy.en, draft.copy_default.en, "en", compiled);
  assert.equal(degraded.copy.help_url, null, "a malformed override URL degrades to no button — never to the global URL");
  assert.deepEqual(degraded.compiledFields, ["help_url"]);
  usa.copy.en.help_url = "";
  draft.copy_default.en.help_url = "https://user:pw@help.friending.com/";
  const degradedDefault = previewWaitingRoomCopy(deu.copy.en, draft.copy_default.en, "en", compiled);
  assert.equal(degradedDefault.copy.help_url, null);
  assert.deepEqual(degradedDefault.compiledFields, ["help_url"]);
  assert.equal(degradedDefault.copy.title, "Verify", "the texts stand; copy is presentation only");
});

// ---------------------------------------------------------------------------
// Proxy normalization, allow-list and retained commands
// ---------------------------------------------------------------------------

test("the proxy forwards only exact bodies and the four actions are allow-listed with their role floors", () => {
  const valid = withRow("USA", "video", { en: { help_url: `${HELP_PREFIX}us` } }, document({ global: "persona" }));
  assert.deepEqual(normalizeVerificationMethodProxyBody("verification_method_console", { contract_version: 1 }), { contract_version: 1 });
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_console", {}), null, "contract_version is required on every action");
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_console", { contract_version: 1, page: 1 }), null);

  const save = { contract_version: 1, draft_json: valid, expected_revision: 4, request_id: REQUEST_ID };
  assert.deepEqual(normalizeVerificationMethodProxyBody("verification_method_save", save), save);
  assert.deepEqual(
    Object.keys((normalizeVerificationMethodProxyBody("verification_method_save", save) as { draft_json: VerificationMethodDocument }).draft_json.waiting_room_copy.default.en),
    ["title", "subtitle", "description", "help_url"],
    "the forwarded copy block keeps help_url last",
  );
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_save", { ...save, expected_revision: 0 }), null, "revision below 1");
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_save", { ...save, expected_revision: "4" }), null, "string revision");
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_save", { ...save, draft_json: JSON.stringify(valid) }), null, "the browser sends an object; lib/core serialises it");
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_save", { ...save, request_id: "not-a-uuid" }), null);
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_save", { ...save, request_id: REQUEST_ID.toUpperCase() }), null, "Core requires lowercase UUID v4");
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_save", { ...save, admin_email: "x" }), null, "reserved key");
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_save", { ...save, draft_json: { ...valid, revision: 1 } }), null, "the revision is Core-owned, never inside the document");

  assert.deepEqual(normalizeVerificationMethodProxyBody("verification_method_impact", { contract_version: 1, expected_revision: 4 }), { contract_version: 1, expected_revision: 4 });
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_impact", { contract_version: 1, expected_revision: 4, draft_json: valid }), null, "the impact previews the SAVED draft; it never carries one");

  const apply = {
    contract_version: 1, expected_revision: 4, normalized_fingerprint: FINGERPRINT,
    confirmation_phrase: VERIFICATION_METHOD_CONFIRMATION_PHRASE, reason: "Rollout to HUN", request_id: REQUEST_ID,
  };
  assert.deepEqual(normalizeVerificationMethodProxyBody("verification_method_apply", apply), apply);
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_apply", { ...apply, confirmation_phrase: "publish verification method" }), null, "the phrase is case-sensitive");
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_apply", { ...apply, normalized_fingerprint: "A".repeat(64) }), null, "lowercase hex only");
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_apply", { ...apply, reason: "  " }), null);
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_apply", { ...apply, reason: "x".repeat(301) }), null);
  assert.equal((normalizeVerificationMethodProxyBody("verification_method_apply", { ...apply, reason: "  Rollout  " }) as { reason: string }).reason, "Rollout", "Core NFC-normalizes and trims; the console sends what Core accepts");
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_apply", { ...apply, reason: `bad${BEL}reason` }), null);
  assert.equal(normalizeVerificationMethodProxyBody("verification_console", { anything: 1 }), undefined, "other families untouched");

  assert.equal(verificationMethodReason("Café"), "Café", "NFC");
  assert.equal(verificationMethodReason(""), null);
  assert.equal(verificationMethodReason(123), null);

  for (const action of VERIFICATION_METHOD_ACTIONS) {
    assert.equal((ADMIN_ACTIONS as readonly string[]).includes(action), true, `${action} is allow-listed`);
  }
  assert.equal(adminActionAccess("verification_method_console"), "read");
  assert.equal(adminActionAccess("verification_method_save"), "write");
  assert.equal(adminActionAccess("verification_method_impact"), "owner");
  assert.equal(adminActionAccess("verification_method_apply"), "owner");
  for (const retired of ["verification_forced_console", "verification_forced_save", "verification_forced_impact_preview"]) {
    assert.equal((ADMIN_ACTIONS as readonly string[]).includes(retired), false, `${retired} is no longer callable`);
    assert.equal(adminActionAccess(retired), null);
  }
});

test("the retained command is canonical, durable and replayed byte-for-byte", async () => {
  const save = { contract_version: 1, draft_json: document({ global: "persona" }), expected_revision: 4, request_id: REQUEST_ID };
  const pending = verificationMethodPendingMutation("verification_method_save", save);
  assert.ok(pending);
  assert.deepEqual(pending, { version: 1, action: "verification_method_save", payload: save });
  assert.equal(verificationMethodPendingMutation("verification_method_save", { ...save, expected_revision: 0 }), null, "an invalid command is never retained");

  assert.deepEqual(verificationMethodPendingFrom(JSON.parse(JSON.stringify(pending))), pending, "it survives a JSON round trip");
  assert.equal(verificationMethodPendingFrom({ ...pending, version: 2 }), null);
  assert.equal(verificationMethodPendingFrom({ ...pending, action: "verification_method_console" }), null, "a read is never a retained mutation");
  assert.equal(verificationMethodPendingFrom({ ...pending, extra: 1 }), null, "the persisted identity is exact");
  assert.equal(verificationMethodPendingFrom({ version: 1, action: "verification_method_save", payload: { ...save, request_id: "x" } }), null);

  const writes: Array<[string, string]> = [];
  const persisted = await verificationMethodPersistBeforeMutation(
    { setItem: (key: string, value: string) => { writes.push([key, value]); } },
    pending,
    async () => "sent",
  );
  assert.deepEqual(persisted, { ok: true, response: "sent" });
  assert.equal(writes.length, 1, "the command is written BEFORE the request leaves");
  assert.equal(writes[0][0], VERIFICATION_METHOD_PENDING_STORAGE_KEY);
  assert.deepEqual(JSON.parse(writes[0][1]), pending);

  let called = false;
  const refusedStorage = await verificationMethodPersistBeforeMutation(
    { setItem: () => { throw new Error("blocked"); } },
    pending,
    async () => { called = true; return "sent"; },
  );
  assert.deepEqual(refusedStorage, { ok: false });
  assert.equal(called, false, "with no durable receipt the mutation is never sent");

  const applyPending = verificationMethodPendingMutation("verification_method_apply", {
    contract_version: 1, expected_revision: 4, normalized_fingerprint: FINGERPRINT,
    confirmation_phrase: VERIFICATION_METHOD_CONFIRMATION_PHRASE, reason: "Rollout", request_id: OTHER_REQUEST_ID,
  });
  assert.ok(applyPending);
  assert.equal((applyPending.payload as { request_id: string }).request_id, OTHER_REQUEST_ID);
});

test("every mandatory method is a closed scalar and `both` is gone from the vocabulary", () => {
  assert.deepEqual([...MANDATORY_METHODS], ["persona", "video", "none"]);
  assert.equal((MANDATORY_METHODS as readonly string[]).includes("both"), false);
  const draft = verificationMethodDraft(document());
  for (const method of MANDATORY_METHODS) {
    draft.global = method;
    const built = verificationMethodDocumentFromDraft(draft);
    assert.equal(built?.global, method, method);
  }
});
