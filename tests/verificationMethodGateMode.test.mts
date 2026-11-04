import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { WAITING_ROOM_COMPILED_COPY } from "../lib/forcedVerification.ts";
import {
  VERIFICATION_GATE_MODES,
  VERIFICATION_GATE_MODE_ABSENT,
  VERIFICATION_GATE_MODE_CLIENT_SELECTOR,
  VERIFICATION_METHOD_ACTIONS,
  VERIFICATION_METHOD_CONFIRMATION_PHRASE,
  VERIFICATION_METHOD_ERROR_STATUSES,
  defaultVerificationGateModePolicy,
  gateModeChoice,
  gateModeOnlyStorefronts,
  isDefaultGateModePolicy,
  normalizeVerificationMethodProxyBody,
  resolveGateMode,
  validateVerificationMethodDraft,
  verificationGateModePolicy,
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
  verificationMethodPhotoCopyGuidance,
  verificationMethodShouldRetainMutation,
  withGateModeChoice,
  type VerificationGateModePolicy,
  type VerificationMethodDocument,
} from "../lib/verificationMethod.ts";

/**
 * D-151 (T-927) — the method console's contract v2 (`team/handoffs/
 * verification-explore-contract.md` §8.4–§8.6, IMPLEMENTED at Core 41013052):
 * the gate mode inside the `verification_method_policy` document, the v1
 * fallback for an older Core (detected by asking for v2: `admin_me` is
 * unchanged), and the canonical-omission rule (an absent mode is Full block;
 * the console never writes a mode the operator did not choose).
 *
 * `fixtures/verification_method_gate_mode_wire/`: `webadmin-console-v2.json`
 * is Core's generated body, copied byte for byte from
 * `tests/fixtures/verification_explore_wire/`. Every other body is
 * HAND-WRITTEN for a case Core's corpus does not capture; the manifest marks
 * each row's origin.
 */

type Json = Record<string, any>;

const LEGACY = { message: 200, status: 200, can_send: 0 } as const;
const REQUEST_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const FINGERPRINT = "b".repeat(64);
const FIXTURE_DIRECTORY = new URL("./fixtures/verification_method_gate_mode_wire/", import.meta.url);
/** Core `tests/fixtures/verification_explore_wire/manifest.json`, row `webadmin-console-v2.json`. */
const CORE_CONSOLE_V2_SHA256 = "704cd4499b7616fa25db18a1ddf3778b7cba21a123dba73cdfeb75bc6b1ed625";
const CORE_FIXTURE_COMMIT = "707e0b974604bb00528878b2cc5f05e7c143c226";

function success(data: unknown) {
  return { ...LEGACY, success: true, status_code: 200, data };
}

function refusal(error: string, status_code: number, data?: unknown) {
  return data === undefined
    ? { ...LEGACY, success: false, status_code, error }
    : { ...LEGACY, success: false, status_code, error, data };
}

function copy(locale: "en" | "hu") {
  return { ...WAITING_ROOM_COMPILED_COPY[locale] };
}

/** A v1 (three-key) document. */
function v1Document(overrides: Partial<VerificationMethodDocument> = {}): VerificationMethodDocument {
  return {
    global: "persona",
    overrides: {},
    waiting_room_copy: { default: { en: copy("en"), hu: copy("hu") }, overrides: {} },
    ...overrides,
  };
}

/** A v2 document; `gate` defaults to the materialized Full block. */
function v2Document(
  gate: VerificationGateModePolicy = { global: "full_block", overrides: {} },
  overrides: Partial<VerificationMethodDocument> = {},
): VerificationMethodDocument {
  return { ...v1Document(overrides), gate_mode: gate };
}

async function fixture(file: string): Promise<Json> {
  return JSON.parse(await readFile(new URL(file, FIXTURE_DIRECTORY), "utf8")) as Json;
}

// ---------------------------------------------------------------------------
// Vocabulary and discovery
// ---------------------------------------------------------------------------

test("the gate-mode vocabulary is closed and an absent mode is Full block", () => {
  assert.deepEqual([...VERIFICATION_GATE_MODES], ["explore", "full_block"], "Core's catalogue order; Off is the method none");
  assert.equal(VERIFICATION_GATE_MODE_ABSENT, "full_block");
  assert.deepEqual(defaultVerificationGateModePolicy(), { global: "full_block", overrides: {} });
  assert.equal(VERIFICATION_GATE_MODE_CLIENT_SELECTOR, "forced_verification_contract_version");
  assert.equal(VERIFICATION_METHOD_ERROR_STATUSES["verification-method-gate-mode-invalid"], 422);
  assert.equal(verificationMethodErrorResponse(refusal("verification-method-gate-mode-invalid", 422)), "verification-method-gate-mode-invalid");
  assert.equal(verificationMethodShouldRetainMutation("verification-method-gate-mode-invalid"), false, "a 422 proves nothing was written");
});

test("admin_me is unchanged: v2 is never read from it, so the console asks for v2 itself", () => {
  const base = { contract_version: 1, contract_ready: true, actions: [...VERIFICATION_METHOD_ACTIONS] };
  assert.deepEqual(verificationMethodAdminMe(base), base, "Core 41013052 serves the released block byte for byte");
  assert.deepEqual(verificationMethodAdminMe({ ...base, contract_versions: [1, 2] }), base,
    "an additive key is tolerated and ignored, never a capability");
  assert.deepEqual(Object.keys(verificationMethodAccess(verificationMethodAdminMe(base))).sort(),
    ["editable", "previewable", "publishable", "visible"], "access carries no wire version");
});

// ---------------------------------------------------------------------------
// Document decoder (strict keys, closed values, the omission rule)
// ---------------------------------------------------------------------------

test("a v2 read materializes an absent gate_mode as Full block and decodes a present one exactly", () => {
  const absent = verificationMethodDocument(v1Document(), "server", 2);
  assert.ok(absent);
  assert.deepEqual(absent.gate_mode, { global: "full_block", overrides: {} }, "missing field = Full block");

  const served = verificationMethodDocument(v2Document({ global: "explore", overrides: { USA: "full_block", HUN: "explore" } }), "server", 2);
  assert.ok(served);
  assert.deepEqual(served.gate_mode, { global: "explore", overrides: { HUN: "explore", USA: "full_block" } });
  assert.deepEqual(Object.keys(served.gate_mode!.overrides), ["HUN", "USA"], "storefronts ascending, like Core's ksort");
  assert.deepEqual(Object.keys(served), ["global", "overrides", "waiting_room_copy", "gate_mode"]);

  const invalid: Array<[string, unknown]> = [
    ["an extra key inside gate_mode", { global: "explore", overrides: {}, default: "explore" }],
    ["global missing", { overrides: {} }],
    ["overrides missing", { global: "explore" }],
    ["Off is not a stored mode", { global: "off", overrides: {} }],
    ["the member-side gate word is not a mode", { global: "waiting_room", overrides: {} }],
    ["unknown storefront mode", { global: "explore", overrides: { HUN: "none" } }],
    ["alpha-2 storefront", { global: "explore", overrides: { HU: "explore" } }],
    ["unknown storefront code", { global: "explore", overrides: { ZZZ: "explore" } }],
    ["overrides as a list", { global: "explore", overrides: [] }],
    ["null", null],
    ["a string", "explore"],
  ];
  for (const [label, gate] of invalid) {
    assert.equal(verificationMethodDocument({ ...v1Document(), gate_mode: gate }, "server", 2), null, label);
    assert.equal(verificationGateModePolicy(gate), null, label);
  }
});

test("a v1 read never yields gate_mode, whatever the body carries", () => {
  const parsed = verificationMethodDocument(v2Document({ global: "explore", overrides: {} }), "server", 1);
  assert.ok(parsed, "a v1 read keeps tolerating additive keys");
  assert.equal(Object.hasOwn(parsed, "gate_mode"), false);
  assert.deepEqual(Object.keys(parsed), ["global", "overrides", "waiting_room_copy"]);
  assert.deepEqual(verificationMethodDocument(v1Document()), parsed, "the default reader is v1");
});

test("a save command is exact: v2 carries exactly four keys, v1 exactly three", () => {
  assert.ok(verificationMethodDocument(v2Document(), "exact", 2));
  assert.equal(verificationMethodDocument(v1Document(), "exact", 2), null, "a v2 save always states its modes (Core: draft_json must have the 4 keys)");
  assert.equal(verificationMethodDocument({ ...v2Document(), revision: 1 }, "exact", 2), null, "five keys");
  assert.equal(verificationMethodDocument(v2Document(), "exact", 1), null, "a v1 save never names gate_mode");
  assert.ok(verificationMethodDocument(v1Document(), "exact", 1));
});

// ---------------------------------------------------------------------------
// Response decoders
// ---------------------------------------------------------------------------

test("the v2 console decodes the default and the Explore draft corpus, and only as v2", async () => {
  const defaultBody = await fixture("webadmin-method-console-v2-default.json");
  const parsed = verificationMethodConsoleResponse(defaultBody, 2);
  assert.ok(parsed);
  assert.equal(parsed.contract_version, 2);
  assert.deepEqual(parsed.policy.live.document.gate_mode, { global: "full_block", overrides: {} });
  assert.deepEqual(parsed.policy.draft.document.gate_mode, { global: "full_block", overrides: {} });
  assert.deepEqual(parsed.compiled_defaults.gate_mode, { global: "full_block", overrides: {} });
  assert.deepEqual(parsed.gate_mode_catalogue, {
    modes: ["explore", "full_block"], recommended: "explore", client_selector: "forced_verification_contract_version",
  });
  assert.equal(verificationMethodConsoleResponse(defaultBody), null, "a v2 body is not v1 material");
  assert.equal(verificationMethodConsoleResponse(defaultBody, 1), null);

  const explore = verificationMethodConsoleResponse(await fixture("webadmin-method-console-v2-explore-draft.json"), 2);
  assert.ok(explore);
  assert.deepEqual(explore.policy.draft.document.gate_mode, { global: "explore", overrides: { HUN: "full_block" } });
  assert.equal(resolveGateMode(explore.policy.draft.document.gate_mode!, "HUN"), "full_block");
  assert.equal(resolveGateMode(explore.policy.draft.document.gate_mode!, "USA"), "explore");
  assert.equal(resolveGateMode(explore.policy.draft.document.gate_mode!, null), "explore");

  const data = defaultBody.data as Json;
  const variants: Array<[string, Json]> = [
    ["catalogue missing", { ...data, gate_mode_catalogue: undefined }],
    ["a third mode", { ...data, gate_mode_catalogue: { ...data.gate_mode_catalogue, modes: ["explore", "full_block", "off"] } }],
    ["modes reordered", { ...data, gate_mode_catalogue: { ...data.gate_mode_catalogue, modes: ["full_block", "explore"] } }],
    ["recommended outside the list", { ...data, gate_mode_catalogue: { ...data.gate_mode_catalogue, recommended: "off" } }],
    ["another selector", { ...data, gate_mode_catalogue: { ...data.gate_mode_catalogue, client_selector: "verification_method_contract_version" } }],
    ["compiled mode missing", { ...data, compiled_defaults: { waiting_room_copy: data.compiled_defaults.waiting_room_copy } }],
    ["contract_version 1 on a v2 call", { ...data, contract_version: 1 }],
  ];
  for (const [label, variant] of variants) {
    assert.equal(verificationMethodConsoleResponse(success(variant), 2), null, label);
  }
  // A v2 console tolerates a served document without gate_mode (absent = Full block).
  const withoutKey = structuredClone(data);
  delete withoutKey.policy.live.document.gate_mode;
  assert.deepEqual(verificationMethodConsoleResponse(success(withoutKey), 2)?.policy.live.document.gate_mode, { global: "full_block", overrides: {} });
});

/**
 * Core's generator (`tests/verification_explore_storage_test.php`) captures
 * `VerificationMethodAdminService::console()` itself, not the controller's
 * `Webadmin::noStoreReply()`, whose `encodedReply()` appends the legacy trio
 * `message: 200` (when unset), `status: 200`, `can_send: 0` to every Webadmin
 * answer. The test applies exactly that step — nothing else — before decoding.
 */
function throughWebadminReply(payload: Json): Json {
  return { ...payload, message: payload.message ?? 200, status: 200, can_send: 0 };
}

test("Core's generated v2 console decodes as served and round-trips without inventing a change", async () => {
  const raw = await fixture("webadmin-console-v2.json");
  assert.equal(verificationMethodConsoleResponse(raw, 2), null,
    "the service-level capture has no legacy trio; the strict envelope keeps refusing that");
  const body = throughWebadminReply(raw);
  const parsed = verificationMethodConsoleResponse(body, 2);
  assert.ok(parsed, "Core's bytes, through the wire adapter, decode as v2");
  assert.equal(parsed.contract_version, 2);
  assert.deepEqual(parsed.policy.draft.document.gate_mode, { global: "explore", overrides: {} });
  assert.deepEqual(parsed.policy.live.document.gate_mode, { global: "explore", overrides: {} });
  assert.deepEqual(parsed.compiled_defaults.gate_mode, { global: "full_block", overrides: {} });
  assert.equal(parsed.gate_mode_catalogue?.recommended, "explore");
  assert.equal(isDefaultGateModePolicy(parsed.policy.live.document.gate_mode), false, "Explore is stored: an older Core could not read it");
  assert.equal(verificationMethodConsoleResponse(body), null, "never v1 material");
  assert.deepEqual(Object.keys(body.data.policy.draft.document), ["global", "overrides", "waiting_room_copy", "gate_mode"],
    "Core's key order is the order the console writes back");
  assert.deepEqual(Object.keys(body.data.policy.draft.document.gate_mode), ["global", "overrides"]);

  const draft = verificationMethodDraft(parsed.policy.draft.document);
  const rebuilt = verificationMethodDocumentFromDraft(draft);
  assert.ok(rebuilt);
  assert.deepEqual(JSON.parse(JSON.stringify(rebuilt)), body.data.policy.draft.document, "byte-equivalent save material");
  assert.ok(normalizeVerificationMethodProxyBody("verification_method_save", {
    contract_version: 2, draft_json: rebuilt, expected_revision: parsed.policy.revision, request_id: REQUEST_ID,
  }));
});

test("the v1 console keeps today's shape: no catalogue, no gate_mode", () => {
  const v1 = {
    contract_version: 1,
    principal: { role: "owner", capabilities: [] },
    evaluated_at: 1_800_000_000,
    policy: {
      schema_version: 1, revision: 2,
      draft: { document: v1Document(), saved_at: 1, saved_by: "owner@friending.com" },
      live: { document: v1Document(), published_at: 1, published_by: "owner@friending.com" },
      updated_at: 1, updated_by: "owner@friending.com",
    },
    method_availability: {
      video: { method: "video", policy_enable_allowed: true, new_start_available: true, reason: null },
      persona: { method: "persona", policy_enable_allowed: true, new_start_available: true, reason: null },
      photo: { method: "photo", policy_enable_allowed: true, new_start_available: true, reason: null },
    },
    publish_guard: { ready: true, blocking_codes: [] },
    compiled_defaults: { waiting_room_copy: { en: copy("en"), hu: copy("hu") } },
    storefront_catalogue_hint: "alpha-3",
  };
  const parsed = verificationMethodConsoleResponse(success(v1));
  assert.ok(parsed);
  assert.equal(parsed.contract_version, 1);
  assert.equal(Object.hasOwn(parsed, "gate_mode_catalogue"), false);
  assert.equal(Object.hasOwn(parsed.compiled_defaults, "gate_mode"), false);
  assert.equal(Object.hasOwn(parsed.policy.draft.document, "gate_mode"), false);
  assert.equal(verificationMethodConsoleResponse(success(v1), 2), null, "a v1 body is not v2 material");
});

test("the v2 impact names each scope's live and draft mode; its counts still have to add up", async () => {
  const body = await fixture("webadmin-method-impact-v2.json");
  const parsed = verificationMethodImpactResponse(body, 2);
  assert.ok(parsed);
  assert.equal(parsed.contract_version, 2);
  assert.deepEqual(parsed.impact.by_storefront.map((row) => [row.storefront, row.live_gate_mode, row.draft_gate_mode]), [
    ["HUN", "full_block", "full_block"],
    ["USA", "full_block", "explore"],
  ]);
  assert.equal(parsed.impact.unknown_storefront.draft_gate_mode, "explore");
  assert.equal(verificationMethodImpactResponse(body), null, "not v1 material");

  const data = body.data as Json;
  const row = data.impact.by_storefront[0];
  const withRow = (next: Json) => success({ ...data, impact: { ...data.impact, by_storefront: [next, data.impact.by_storefront[1]] } });
  assert.equal(verificationMethodImpactResponse(withRow({ ...row, draft_gate_mode: undefined }), 2), null, "both modes are required on v2");
  assert.equal(verificationMethodImpactResponse(withRow({ ...row, live_gate_mode: "off" }), 2), null, "closed values");
  assert.equal(verificationMethodImpactResponse(success({
    ...data, impact: { ...data.impact, unknown_storefront: { ...data.impact.unknown_storefront, live_gate_mode: null } },
  }), 2), null, "the unknown row too");
  assert.equal(verificationMethodImpactResponse(success({
    ...data, impact: { ...data.impact, totals: { ...data.impact.totals, members_seen: 1 } },
  }), 2), null);

  // v1 rows never carry modes, even when a body has them.
  const v1 = verificationMethodImpactResponse(success({ ...data, contract_version: 1 }));
  assert.ok(v1);
  assert.equal(Object.hasOwn(v1.impact.by_storefront[0], "draft_gate_mode"), false);
});

test("v2 mutation and conflict bodies carry v2 policies and decode only as the version asked for", async () => {
  const save = await fixture("webadmin-method-save-v2.json");
  const parsed = verificationMethodMutationResponse(save, 2);
  assert.ok(parsed);
  assert.deepEqual(parsed.policy.draft.document.gate_mode, { global: "explore", overrides: { HUN: "full_block" } });
  assert.equal(verificationMethodMutationResponse(save), null);

  const conflict = verificationMethodConflictResponse(await fixture("webadmin-method-conflict-v2.json"), 2);
  assert.ok(conflict);
  assert.equal(conflict.error, "verification-method-conflict");
  assert.equal(conflict.data.policy.revision, 5);
  assert.equal(verificationMethodConflictResponse(await fixture("webadmin-method-conflict-v2.json")), null);
});

test("an older Core's answer to a v2 call is the named contract-version refusal, terminal and never retained", async () => {
  const error = verificationMethodErrorResponse(await fixture("webadmin-method-refusal-contract-version.json"));
  assert.equal(error, "verification-method-contract-version");
  assert.equal(verificationMethodShouldRetainMutation(error), false);
  assert.equal(verificationMethodErrorResponse(await fixture("webadmin-method-refusal-gate-mode-invalid.json")), "verification-method-gate-mode-invalid");
});

// ---------------------------------------------------------------------------
// Draft ↔ document: the omission rule
// ---------------------------------------------------------------------------

test("an untouched v2 draft round-trips to exactly what Core served; no mode is invented", () => {
  for (const gate of [
    { global: "full_block", overrides: {} },
    { global: "explore", overrides: {} },
    { global: "explore", overrides: { HUN: "full_block" } },
  ] as VerificationGateModePolicy[]) {
    const served = v2Document(gate, {
      overrides: { USA: "persona" },
      waiting_room_copy: { default: { en: copy("en"), hu: copy("hu") }, overrides: { USA: { en: {}, hu: {} } } },
    });
    const draft = verificationMethodDraft(served);
    const rebuilt = verificationMethodDocumentFromDraft(draft);
    assert.ok(rebuilt);
    assert.deepEqual(rebuilt, served, JSON.stringify(gate));
    assert.equal(verificationMethodDocumentsEqual(rebuilt, served), true, "not dirty");
    assert.equal(Object.hasOwn(rebuilt.gate_mode!.overrides, "USA"), false, "an inheriting storefront row has no key");
    assert.deepEqual(Object.keys(rebuilt), ["global", "overrides", "waiting_room_copy", "gate_mode"], "gate_mode is the fourth key");
    assert.deepEqual(Object.keys(rebuilt.gate_mode!), ["global", "overrides"]);
    assert.ok(verificationMethodDocument(rebuilt, "exact", 2), "the save command passes the strict v2 reader");
  }
});

test("a v1 draft never emits gate_mode", () => {
  const draft = verificationMethodDraft(v1Document());
  assert.equal(draft.gate_mode, null);
  const rebuilt = verificationMethodDocumentFromDraft(draft);
  assert.ok(rebuilt);
  assert.equal(Object.hasOwn(rebuilt, "gate_mode"), false);
  assert.deepEqual(Object.keys(rebuilt), ["global", "overrides", "waiting_room_copy"]);
  assert.ok(verificationMethodDocument(rebuilt, "exact", 1));
});

test("only an operator choice changes a mode, and it changes exactly that scope", () => {
  const base: VerificationGateModePolicy = { global: "full_block", overrides: { HUN: "explore" } };
  assert.equal(gateModeChoice(base, null), "full_block");
  assert.equal(gateModeChoice(base, "HUN"), "explore");
  assert.equal(gateModeChoice(base, "USA"), "inherit");

  assert.deepEqual(withGateModeChoice(base, null, "explore"), { global: "explore", overrides: { HUN: "explore" } });
  assert.deepEqual(withGateModeChoice(base, null, "inherit"), base, "the global row has no inherit");
  assert.deepEqual(withGateModeChoice(base, "USA", "full_block"), { global: "full_block", overrides: { HUN: "explore", USA: "full_block" } },
    "an explicit Full block pins a storefront against a later global flip");
  assert.deepEqual(withGateModeChoice(base, "HUN", "inherit"), { global: "full_block", overrides: {} }, "inherit removes the key");
  assert.deepEqual(base, { global: "full_block", overrides: { HUN: "explore" } }, "the input is never mutated");

  assert.equal(isDefaultGateModePolicy(undefined), true);
  assert.equal(isDefaultGateModePolicy({ global: "full_block", overrides: {} }), true);
  assert.equal(isDefaultGateModePolicy({ global: "full_block", overrides: { HUN: "full_block" } }), false, "an explicit pin is stored");
  assert.equal(isDefaultGateModePolicy({ global: "explore", overrides: {} }), false);

  // Adding a method row (what the table's "Add" does) leaves the modes alone.
  const draft = verificationMethodDraft(v2Document());
  draft.overrides.push({ storefront: "DEU", method: "persona", copy: { en: { title: "", subtitle: "", description: "", help_url: "" }, hu: { title: "", subtitle: "", description: "", help_url: "" } } });
  assert.deepEqual(verificationMethodDocumentFromDraft(draft)?.gate_mode, { global: "full_block", overrides: {} });

  // The rollback the console tells the operator to do: every scope back to Full block.
  let flipped = withGateModeChoice({ global: "explore", overrides: { HUN: "explore" } }, null, "full_block");
  flipped = withGateModeChoice(flipped, "HUN", "inherit");
  assert.equal(isDefaultGateModePolicy(flipped), true, "Core then stores the three-key document again");
});

test("a mode-only storefront is shown and preserved, and an invalid mode entry is a draft issue", () => {
  const served = v2Document({ global: "explore", overrides: { HUN: "full_block", USA: "explore" } }, {
    overrides: { USA: "video" },
    waiting_room_copy: { default: { en: copy("en"), hu: copy("hu") }, overrides: { USA: { en: {}, hu: {} } } },
  });
  const draft = verificationMethodDraft(served);
  assert.deepEqual(gateModeOnlyStorefronts(draft), ["HUN"], "USA has a method row; HUN carries a mode only");
  assert.deepEqual(verificationMethodDocumentFromDraft(draft), served);
  assert.deepEqual(gateModeOnlyStorefronts(verificationMethodDraft(v1Document())), []);

  assert.equal(validateVerificationMethodDraft({ ...draft, gate_mode: { global: "explore", overrides: { ZZZ: "explore" } } }), "gateMode");
  assert.equal(validateVerificationMethodDraft({ ...draft, gate_mode: { global: "off" as never, overrides: {} } }), "gateMode");
  assert.equal(verificationMethodDocumentFromDraft({ ...draft, gate_mode: { global: "explore", overrides: { HU: "explore" } } }), null);
  assert.equal(validateVerificationMethodDraft(draft), null);
});

// ---------------------------------------------------------------------------
// Proxy and the retained command
// ---------------------------------------------------------------------------

test("the proxy forwards exact v1 and v2 bodies and nothing else", async () => {
  assert.deepEqual(normalizeVerificationMethodProxyBody("verification_method_console", { contract_version: 2 }), { contract_version: 2 });
  assert.deepEqual(normalizeVerificationMethodProxyBody("verification_method_console", { contract_version: 1 }), { contract_version: 1 });
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_console", { contract_version: 3 }), null);
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_console", { contract_version: "2" }), null, "the browser sends a number");

  const request = await fixture("webadmin-request-save-v2.json");
  assert.deepEqual(normalizeVerificationMethodProxyBody("verification_method_save", request), request, "the corpus request passes unchanged");
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_save", { ...request, contract_version: 1 }), null,
    "a v1 save with gate_mode is refused before Core");
  const threeKeys = { ...request.draft_json };
  delete threeKeys.gate_mode;
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_save", { ...request, draft_json: threeKeys }), null,
    "a v2 save without gate_mode is refused before Core");
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_save", {
    ...request, draft_json: { ...request.draft_json, gate_mode: { ...request.draft_json.gate_mode, extra: 1 } },
  }), null);
  assert.deepEqual(normalizeVerificationMethodProxyBody("verification_method_save", { ...request, contract_version: 1, draft_json: threeKeys }),
    { ...request, contract_version: 1, draft_json: threeKeys });

  assert.deepEqual(normalizeVerificationMethodProxyBody("verification_method_impact", { contract_version: 2, expected_revision: 4 }),
    { contract_version: 2, expected_revision: 4 });
  const apply = {
    contract_version: 2, expected_revision: 4, normalized_fingerprint: FINGERPRINT,
    confirmation_phrase: VERIFICATION_METHOD_CONFIRMATION_PHRASE, reason: "Explore mode for everyone", request_id: REQUEST_ID,
  };
  assert.deepEqual(normalizeVerificationMethodProxyBody("verification_method_apply", apply), apply, "apply fields unchanged on v2");
});

test("a v2 save is retained and replayed byte for byte, and photo guidance reads it as v2", async () => {
  const request = await fixture("webadmin-request-save-v2.json");
  const pending = verificationMethodPendingMutation("verification_method_save", request);
  assert.ok(pending);
  assert.deepEqual(verificationMethodPendingFrom(JSON.parse(JSON.stringify(pending))), pending);
  assert.equal((pending.payload as Json).contract_version, 2);

  const photo = structuredClone(request);
  photo.draft_json.global = "photo";
  assert.equal(
    verificationMethodPhotoCopyGuidance("verification-method-copy-default-invalid", verificationMethodPendingMutation("verification_method_save", photo)),
    "default",
  );
});

// ---------------------------------------------------------------------------
// The hand-written corpus
// ---------------------------------------------------------------------------

test("the corpus pins Core's console body and marks every hand-written body", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", FIXTURE_DIRECTORY), "utf8")) as Json;
  assert.equal(manifest.contract, "verification-method-console-v2");
  assert.equal(manifest.core_corpus.path, "tests/fixtures/verification_explore_wire/");
  assert.equal(manifest.core_corpus.fixture_commit, CORE_FIXTURE_COMMIT);
  const rows = manifest.files as Array<{ file: string; sha256: string; origin: string; case?: string }>;
  const files = rows.map((row) => row.file);
  assert.deepEqual(files, [...files].sort());
  assert.deepEqual((await readdir(FIXTURE_DIRECTORY)).sort(), [...files, "manifest.json"].sort());
  assert.deepEqual(rows.filter((row) => row.origin === "core").map((row) => [row.file, row.sha256]),
    [["webadmin-console-v2.json", CORE_CONSOLE_V2_SHA256]], "Core's bytes, Core's hash");
  assert.deepEqual(rows.filter((row) => row.origin === "hand-written").map((row) => row.file), [
    "webadmin-method-conflict-v2.json",
    "webadmin-method-console-v2-default.json",
    "webadmin-method-console-v2-explore-draft.json",
    "webadmin-method-impact-v2.json",
    "webadmin-method-refusal-contract-version.json",
    "webadmin-method-refusal-gate-mode-invalid.json",
    "webadmin-method-save-v2.json",
    "webadmin-request-save-v2.json",
  ], "exactly these remain hand-written; replace each with Core bytes once Core captures its case");
  assert.ok(rows.every((row) => row.origin === "core" || (row.origin === "hand-written" && typeof row.case === "string" && row.case !== "")));
  for (const row of rows) {
    const bytes = await readFile(new URL(row.file, FIXTURE_DIRECTORY));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), row.sha256, row.file);
  }
});
