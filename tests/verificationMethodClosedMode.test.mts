import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import {
  VERIFICATION_CLOSED_BELOW_EVENTS_DEFAULT,
  VERIFICATION_CLOSED_BELOW_EVENTS_MAX,
  VERIFICATION_CLOSED_BELOW_EVENTS_MIN,
  VERIFICATION_CLOSED_BELOW_EVENTS_OFF,
  VERIFICATION_CLOSED_MODE_CLIENT_SELECTOR,
  VERIFICATION_CLOSED_MODE_RADIUS_MILES,
  VERIFICATION_METHOD_CONFIRMATION_PHRASE,
  VERIFICATION_METHOD_CONTRACT_VERSIONS,
  VERIFICATION_METHOD_PREFERRED_CONTRACT_VERSION,
  closedModeThresholdApplies,
  closedModeThresholdChangedBySave,
  closedModeThresholdResetOnSave,
  loadVerificationMethodConsole,
  normalizeVerificationMethodProxyBody,
  validateVerificationMethodDraft,
  verificationClosedBelowEvents,
  verificationGateModePolicy,
  verificationMethodApplyCommand,
  verificationMethodCommandVersion,
  verificationMethodConflictResponse,
  verificationMethodConsoleResponse,
  verificationMethodDocument,
  verificationMethodDocumentFromDraft,
  verificationMethodDocumentsEqual,
  verificationMethodDraft,
  verificationMethodDraftMatchesVersion,
  verificationMethodDraftWithStorefront,
  verificationMethodDraftWithoutStorefront,
  verificationMethodImpactResponse,
  verificationMethodMutationOutcome,
  verificationMethodMutationResponse,
  verificationMethodOlderContractVersion,
  verificationMethodOutcomeProvesV2,
  verificationMethodPendingFrom,
  verificationMethodPendingMutation,
  verificationMethodPhotoCopyGuidance,
  verificationMethodPolicy,
  verificationMethodPolicyStoresClosedThreshold,
  verificationMethodShouldRetainMutation,
  withClosedBelowEvents,
  withGateModeChoice,
  type VerificationGateModePolicy,
  type VerificationMethodContractVersion,
} from "../lib/verificationMethod.ts";

/**
 * D-152 (T-933) — the method console's contract v3
 * (`team/handoffs/verification-explore-closed-contract.md` §6, §7, §10 and the
 * lead rulings of §12a): the Closed mode threshold `gate_mode.closed_below_events`
 * (0..50, absent ≡ 3, 0 = never close), the v3 → v2 → v1 probe, the v2
 * byte-identity (v2 never names the key) and the Q10 all-Full-block reset.
 *
 * `fixtures/verification_method_closed_mode_wire/`: `webadmin-console-v3.json`
 * and `webadmin-impact-v3.json` are Core's generated bodies, copied byte for
 * byte from `tests/fixtures/verification_explore_mode_wire/` (Core lane tip
 * fc3b83e8; console from 824093ec, impact re-captured in 2e37ca9d).
 * Every other body is HAND-WRITTEN from contract §7 for a case Core's corpus
 * does not capture; the manifest marks each row's origin. Version-independent
 * refusal bodies are read from the D-151 corpus.
 */

type Json = Record<string, any>;

const LEGACY = { message: 200, status: 200, can_send: 0 } as const;
const REQUEST_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const FIXTURE_DIRECTORY = new URL("./fixtures/verification_method_closed_mode_wire/", import.meta.url);
const D151_DIRECTORY = new URL("./fixtures/verification_method_gate_mode_wire/", import.meta.url);
/** Core `tests/fixtures/verification_explore_mode_wire/manifest.json`, rows `webadmin-console-v3.json` / `webadmin-impact-v3.json`. */
const CORE_CONSOLE_V3_SHA256 = "68dfa9760bc9613a6b272996722576fd80382ecb03ef606f8d2e6c3e88243664";
const CORE_IMPACT_V3_SHA256 = "59f89c4608e78bf1ed94b3e80419d4e1799267c1c50fc423414e7abe8c0bfd0f";
/** The Core commit that last touched each body (`git log -1 -- <file>` at the lane tip). */
const CORE_CONSOLE_V3_COMMIT = "824093eca0bdf0b67ad38df67fbe46fd214447c6";
const CORE_IMPACT_V3_COMMIT = "2e37ca9dd1411079f82732d2706791ee746b89f9";
const CORE_GENERATOR_SOURCE_COMMIT = "2e296f90f1702d08f9237ed56a668cb644bdc8ec";
const CORE_COPIED_AT_TIP = "fc3b83e86419e19018080680240bd99a5a7bc1fb";
/** Core's manifest `reference_clock`: every captured time field is shifted onto it. */
const CORE_REFERENCE_CLOCK = 1794700800;

function success(data: unknown) {
  return { ...LEGACY, success: true, status_code: 200, data };
}

function refusal(error: string, status_code: number, data?: unknown) {
  return data === undefined
    ? { ...LEGACY, success: false, status_code, error }
    : { ...LEGACY, success: false, status_code, error, data };
}

async function fixture(file: string, directory: URL = FIXTURE_DIRECTORY): Promise<Json> {
  return JSON.parse(await readFile(new URL(file, directory), "utf8")) as Json;
}

/**
 * Core's generator (`tests/verification_explore_mode_storage_test.php`)
 * captures `VerificationMethodAdminService` itself, not the controller's
 * `Webadmin::noStoreReply()`, whose `encodedReply()` appends the legacy trio
 * `message: 200` (when unset), `status: 200`, `can_send: 0` to every Webadmin
 * answer. This applies exactly that step — nothing else — as the D-151 test does.
 */
function throughWebadminReply(payload: Json): Json {
  return { ...payload, message: payload.message ?? 200, status: 200, can_send: 0 };
}

/** Core's v3 console (revision 4, Explore everywhere, threshold 3 materialized), as the Webadmin bridge receives it. */
async function coreConsole(): Promise<Json> {
  return throughWebadminReply(await fixture("webadmin-console-v3.json"));
}

/** Core's v3 impact (live 3, draft 0), as the Webadmin bridge receives it. */
async function coreImpact(): Promise<Json> {
  return throughWebadminReply(await fixture("webadmin-impact-v3.json"));
}

function gate(global: "explore" | "full_block", threshold: number, overrides: Record<string, "explore" | "full_block"> = {}): VerificationGateModePolicy {
  return { global, overrides, closed_below_events: threshold };
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

test("the threshold vocabulary is Core's: 0..50, 3 by default, 0 never closes, 100 mi, its own client selector", () => {
  assert.deepEqual([...VERIFICATION_METHOD_CONTRACT_VERSIONS], [1, 2, 3]);
  assert.equal(VERIFICATION_METHOD_PREFERRED_CONTRACT_VERSION, 3);
  assert.equal(VERIFICATION_CLOSED_BELOW_EVENTS_DEFAULT, 3);
  assert.equal(VERIFICATION_CLOSED_BELOW_EVENTS_MIN, 0);
  assert.equal(VERIFICATION_CLOSED_BELOW_EVENTS_MAX, 50);
  assert.equal(VERIFICATION_CLOSED_BELOW_EVENTS_OFF, 0);
  assert.equal(VERIFICATION_CLOSED_MODE_RADIUS_MILES, 100);
  assert.equal(VERIFICATION_CLOSED_MODE_CLIENT_SELECTOR, "explore_mode_contract_version",
    "lead ruling Q1: a separate selector, not forced_verification_contract_version 3");
  assert.equal(verificationMethodOlderContractVersion(3), 2);
  assert.equal(verificationMethodOlderContractVersion(2), 1);
  assert.equal(verificationMethodOlderContractVersion(1), null);
  for (const [payload, version] of [
    [{ contract_version: 3 }, 3], [{ contract_version: 2 }, 2], [{ contract_version: 1 }, 1],
    [{ contract_version: "3" }, 1], [{}, 1],
  ] as Array<[Record<string, unknown>, VerificationMethodContractVersion]>) {
    assert.equal(verificationMethodCommandVersion(payload), version, JSON.stringify(payload));
  }
});

test("contract §6.2/§7.2: the threshold is a JSON integer 0..50, nothing else", () => {
  for (const value of [0, 1, 3, 5, 49, 50]) assert.equal(verificationClosedBelowEvents(value), value);
  for (const value of ["5", "3", 5.5, true, false, null, undefined, -1, 51, Number.NaN, Number.POSITIVE_INFINITY, [5], { value: 5 }]) {
    assert.equal(verificationClosedBelowEvents(value), null, String(value));
  }
});

// ---------------------------------------------------------------------------
// gate_mode and document decoders
// ---------------------------------------------------------------------------

test("a v3 gate_mode is exactly {global, overrides, closed_below_events}; v2 stays exactly two keys", () => {
  assert.deepEqual(verificationGateModePolicy({ global: "explore", overrides: { USA: "full_block" }, closed_below_events: 5 }, 3),
    { global: "explore", overrides: { USA: "full_block" }, closed_below_events: 5 });
  assert.deepEqual(Object.keys(verificationGateModePolicy({ closed_below_events: 0, overrides: {}, global: "explore" }, 3)!),
    ["global", "overrides", "closed_below_events"], "the decoded object always has Core's key order");
  const invalid: Array<[string, unknown]> = [
    ["threshold missing (Core materializes it on every v3 read)", { global: "explore", overrides: {} }],
    ["a string", { global: "explore", overrides: {}, closed_below_events: "5" }],
    ["a fraction", { global: "explore", overrides: {}, closed_below_events: 2.5 }],
    ["true", { global: "explore", overrides: {}, closed_below_events: true }],
    ["null", { global: "explore", overrides: {}, closed_below_events: null }],
    ["-1", { global: "explore", overrides: {}, closed_below_events: -1 }],
    ["51", { global: "explore", overrides: {}, closed_below_events: 51 }],
    ["an extra key", { global: "explore", overrides: {}, closed_below_events: 3, radius_miles: 100 }],
    ["a bad mode beside a good threshold", { global: "off", overrides: {}, closed_below_events: 3 }],
  ];
  for (const [label, value] of invalid) assert.equal(verificationGateModePolicy(value, 3), null, label);

  assert.equal(verificationGateModePolicy({ global: "explore", overrides: {}, closed_below_events: 3 }, 2), null,
    "§7.4: a v2 gate_mode that names the threshold is refused, so v2 stays exactly two keys");
  assert.equal(verificationGateModePolicy({ global: "explore", overrides: {}, closed_below_events: 3 }), null, "the default reader is v2");
  assert.deepEqual(verificationGateModePolicy({ global: "explore", overrides: {} }, 2), { global: "explore", overrides: {} });
});

test("the v3 console decodes the default and the §7.1 corpus; a v2 body is not v3 material and the reverse", async () => {
  const defaultBody = await coreConsole();
  const parsed = verificationMethodConsoleResponse(defaultBody, 3);
  assert.ok(parsed);
  assert.equal(parsed.contract_version, 3);
  assert.deepEqual(parsed.policy.draft.document.gate_mode, gate("explore", 3), "today's live document: no stored threshold, 3 materialized");
  assert.deepEqual(parsed.policy.live.document.gate_mode, gate("explore", 3));
  assert.deepEqual(parsed.compiled_defaults.gate_mode, gate("full_block", 3));
  assert.deepEqual(parsed.gate_mode_catalogue, {
    modes: ["explore", "full_block"], recommended: "explore", client_selector: "forced_verification_contract_version",
    closed_below_events: { default: 3, minimum: 0, maximum: 50, off: 0, radius_miles: 100, client_selector: "explore_mode_contract_version" },
  });
  for (const version of [1, 2] as const) {
    assert.equal(verificationMethodConsoleResponse(defaultBody, version), null, `a v3 body is not v${version} material`);
  }

  const closed = verificationMethodConsoleResponse(await fixture("webadmin-method-console-v3-closed-draft.json"), 3);
  assert.ok(closed);
  assert.equal(closed.policy.revision, 5);
  assert.equal(closed.policy.draft.document.gate_mode?.closed_below_events, 5);
  assert.equal(closed.policy.live.document.gate_mode?.closed_below_events, 3);

  const v2 = await fixture("webadmin-method-console-v2-default.json", D151_DIRECTORY);
  assert.equal(verificationMethodConsoleResponse(v2, 3), null, "a v2 body (contract_version 2, no threshold) is not v3 material");
  assert.ok(verificationMethodConsoleResponse(v2, 2), "and the D-151 decoder still reads it");
});

test("the v3 console refuses every malformed threshold, catalogue or version", async () => {
  const data = (await fixture("webadmin-method-console-v3-closed-draft.json")).data as Json;
  const catalogue = data.gate_mode_catalogue;
  const closed = catalogue.closed_below_events;
  const variants: Array<[string, Json]> = [
    ["catalogue without the threshold bounds", { ...data, gate_mode_catalogue: { ...catalogue, closed_below_events: undefined } }],
    ["another default", { ...data, gate_mode_catalogue: { ...catalogue, closed_below_events: { ...closed, default: 5 } } }],
    ["another minimum", { ...data, gate_mode_catalogue: { ...catalogue, closed_below_events: { ...closed, minimum: 1 } } }],
    ["another maximum", { ...data, gate_mode_catalogue: { ...catalogue, closed_below_events: { ...closed, maximum: 100 } } }],
    ["another off value", { ...data, gate_mode_catalogue: { ...catalogue, closed_below_events: { ...closed, off: -1 } } }],
    ["another radius", { ...data, gate_mode_catalogue: { ...catalogue, closed_below_events: { ...closed, radius_miles: 50 } } }],
    ["the member gate selector instead of the mode selector", { ...data, gate_mode_catalogue: { ...catalogue, closed_below_events: { ...closed, client_selector: "forced_verification_contract_version" } } }],
    ["a bound as a string", { ...data, gate_mode_catalogue: { ...catalogue, closed_below_events: { ...closed, maximum: "50" } } }],
    ["compiled gate_mode without the threshold", { ...data, compiled_defaults: { ...data.compiled_defaults, gate_mode: { global: "full_block", overrides: {} } } }],
    ["contract_version 2 on a v3 call", { ...data, contract_version: 2 }],
  ];
  for (const [label, variant] of variants) {
    assert.equal(verificationMethodConsoleResponse(success(variant), 3), null, label);
  }
  for (const side of ["draft", "live"] as const) {
    for (const [label, value] of [["missing", undefined], ["out of range", 51], ["a string", "5"]] as const) {
      const body = structuredClone(data);
      if (value === undefined) delete body.policy[side].document.gate_mode.closed_below_events;
      else body.policy[side].document.gate_mode.closed_below_events = value;
      assert.equal(verificationMethodConsoleResponse(success(body), 3), null, `${side}: ${label}`);
    }
  }
});

// ---------------------------------------------------------------------------
// The probe: v3, then v2, then v1 — one step per named refusal
// ---------------------------------------------------------------------------

type ConsoleCall = { contract_version: number };

function scripted(...answers: unknown[]) {
  const calls: ConsoleCall[] = [];
  const call = async (_action: "verification_method_console", body: { contract_version: VerificationMethodContractVersion }) => {
    calls.push({ ...body });
    return answers.shift();
  };
  return { calls, call };
}

function v1ConsoleBody(v2: Json): Json {
  const body = structuredClone(v2);
  body.data.contract_version = 1;
  delete body.data.gate_mode_catalogue;
  delete body.data.compiled_defaults.gate_mode;
  for (const snapshot of [body.data.policy.draft, body.data.policy.live]) delete snapshot.document.gate_mode;
  return body;
}

test("the console probe asks for v3 first and steps down exactly one version per named 409", async () => {
  const v3 = await coreConsole();
  const v2 = await fixture("webadmin-method-console-v2-default.json", D151_DIRECTORY);
  const refused = await fixture("webadmin-method-refusal-contract-version.json", D151_DIRECTORY);

  const current = scripted(v3);
  const loaded = await loadVerificationMethodConsole(current.call, VERIFICATION_METHOD_PREFERRED_CONTRACT_VERSION);
  assert.equal(loaded.ok && loaded.version, 3);
  assert.deepEqual(current.calls, [{ contract_version: 3 }]);

  const d151 = scripted(refused, v2);
  const onD151 = await loadVerificationMethodConsole(d151.call, 3);
  assert.equal(onD151.ok, true);
  assert.equal(onD151.version, 2, "a D-151 Core: the session speaks v2, exactly the released console");
  assert.deepEqual(d151.calls.map((call) => call.contract_version), [3, 2]);

  const older = scripted(refused, refused, v1ConsoleBody(v2));
  const onOlder = await loadVerificationMethodConsole(older.call, 3);
  assert.equal(onOlder.ok && onOlder.version, 1, "a pre-D-151 Core: v1");
  assert.deepEqual(older.calls.map((call) => call.contract_version), [3, 2, 1]);

  const brokenStep = scripted(refused, refusal("verification-method-read-failed", 503));
  assert.deepEqual(await loadVerificationMethodConsole(brokenStep.call, 3), { ok: false, version: 2, error: "verification-method-read-failed" });
  assert.equal(brokenStep.calls.length, 2, "a 503 on the v2 step is an error, never a reason to try v1");

  const unavailable = scripted(refusal("verification-method-unavailable", 503));
  assert.deepEqual(await loadVerificationMethodConsole(unavailable.call, 3), { ok: false, version: 3, error: "verification-method-unavailable" });
  assert.equal(unavailable.calls.length, 1);

  const malformed = scripted(success({ ...(v3.data as Json), gate_mode_catalogue: { ...(v3.data as Json).gate_mode_catalogue, closed_below_events: { default: 3 } } }));
  assert.deepEqual(await loadVerificationMethodConsole(malformed.call, 3), { ok: false, version: 3, error: null });
  assert.equal(malformed.calls.length, 1, "a malformed v3 success never falls back to v2");

  const v2Answer = scripted(v2);
  assert.deepEqual(await loadVerificationMethodConsole(v2Answer.call, 3), { ok: false, version: 3, error: null },
    "a v2 body answering a v3 call is not proven material and is no refusal either");
  assert.equal(v2Answer.calls.length, 1);

  const lost = scripted(null);
  assert.deepEqual(await loadVerificationMethodConsole(lost.call, 3), { ok: false, version: 3, error: null });
});

// ---------------------------------------------------------------------------
// Draft ↔ document
// ---------------------------------------------------------------------------

test("an untouched v3 draft round-trips to exactly what Core served; the threshold is the third gate_mode key", async () => {
  for (const file of ["webadmin-console-v3.json", "webadmin-method-console-v3-closed-draft.json"]) {
    const body = file === "webadmin-console-v3.json" ? await coreConsole() : await fixture(file);
    const parsed = verificationMethodConsoleResponse(body, 3)!;
    const draft = verificationMethodDraft(parsed.policy.draft.document);
    assert.equal(verificationMethodDraftMatchesVersion(draft, 3), true);
    assert.equal(verificationMethodDraftMatchesVersion(draft, 2), false);
    assert.equal(verificationMethodDraftMatchesVersion(draft, 1), false);
    const rebuilt = verificationMethodDocumentFromDraft(draft);
    assert.ok(rebuilt);
    assert.deepEqual(JSON.parse(JSON.stringify(rebuilt)), body.data.policy.draft.document, `${file}: byte-equivalent save material`);
    assert.equal(verificationMethodDocumentsEqual(rebuilt, parsed.policy.draft.document), true, "not dirty");
    assert.deepEqual(Object.keys(rebuilt.gate_mode!), ["global", "overrides", "closed_below_events"]);
    assert.ok(verificationMethodDocument(rebuilt, "exact", 3), "the save command passes the strict v3 reader");
    assert.equal(verificationMethodDocument(rebuilt, "exact", 2), null, "and could never go out as a v2 save");
  }
  const v2Draft = verificationMethodDraft(verificationMethodConsoleResponse(
    await fixture("webadmin-method-console-v2-default.json", D151_DIRECTORY), 2)!.policy.draft.document);
  assert.equal(verificationMethodDraftMatchesVersion(v2Draft, 2), true);
  assert.equal(verificationMethodDraftMatchesVersion(v2Draft, 3), false);
  assert.equal(Object.hasOwn(v2Draft.gate_mode!, "closed_below_events"), false, "a v2 draft never gains a threshold");
});

test("only the operator's pick changes the threshold, and every mode edit carries it over unchanged", async () => {
  const parsed = verificationMethodConsoleResponse(await fixture("webadmin-method-console-v3-closed-draft.json"), 3)!;
  const draft = verificationMethodDraft(parsed.policy.draft.document);
  const base = draft.gate_mode!;
  assert.deepEqual(withClosedBelowEvents(base, 0), { global: "explore", overrides: {}, closed_below_events: 0 });
  assert.deepEqual(base, gate("explore", 5), "the input is never mutated");
  assert.deepEqual(withClosedBelowEvents({ global: "explore", overrides: {} }, 7), { global: "explore", overrides: {} },
    "a v2 policy cannot carry a threshold");

  assert.equal(withGateModeChoice(base, null, "full_block").closed_below_events, 5);
  assert.equal(withGateModeChoice(base, "HUN", "full_block").closed_below_events, 5);
  assert.deepEqual(withGateModeChoice(withGateModeChoice(base, "HUN", "full_block"), "HUN", "inherit"), base);
  assert.deepEqual(Object.keys(withGateModeChoice(base, "HUN", "full_block")), ["global", "overrides", "closed_below_events"]);

  const added = verificationMethodDraftWithStorefront(draft, "USA")!;
  assert.deepEqual(added.gate_mode, base, "adding a row writes no mode and keeps the threshold");
  const pinned = { ...added, gate_mode: withGateModeChoice(added.gate_mode!, "USA", "full_block") };
  const removed = verificationMethodDraftWithoutStorefront(pinned, "USA");
  assert.equal(removed.draft.gate_mode?.closed_below_events, 5, "removing a row keeps it too");
});

test("a threshold outside 0..50 is a draft issue, and no document is built from it", async () => {
  const parsed = verificationMethodConsoleResponse(await fixture("webadmin-method-console-v3-closed-draft.json"), 3)!;
  const draft = verificationMethodDraft(parsed.policy.draft.document);
  assert.equal(validateVerificationMethodDraft(draft), null);
  for (const value of [-1, 51, 2.5, Number.NaN]) {
    const bad = { ...draft, gate_mode: { ...draft.gate_mode!, closed_below_events: value } };
    assert.equal(validateVerificationMethodDraft(bad), "closedBelowEvents", String(value));
    assert.equal(verificationMethodDocumentFromDraft(bad), null, String(value));
  }
  for (const value of [0, 50]) {
    assert.equal(validateVerificationMethodDraft({ ...draft, gate_mode: { ...draft.gate_mode!, closed_below_events: value } }), null);
  }
});

// ---------------------------------------------------------------------------
// Disabled control, the Q10 note and the rollback indicator
// ---------------------------------------------------------------------------

test("the control applies only while some scope is not Full block, and Q10 says when a save returns it to 3", () => {
  assert.equal(closedModeThresholdApplies(gate("explore", 3)), true);
  assert.equal(closedModeThresholdApplies(gate("full_block", 3, { HUN: "explore" })), true, "one Explore storefront is enough");
  assert.equal(closedModeThresholdApplies(gate("full_block", 5)), false, "no scope in Explore: Core stores no gate_mode");
  assert.equal(closedModeThresholdApplies(gate("full_block", 3, { HUN: "full_block" })), false);
  assert.equal(closedModeThresholdApplies({ global: "explore", overrides: {} }), false, "a v2 policy has no threshold control");
  assert.equal(closedModeThresholdApplies(null), false, "v1");

  assert.equal(closedModeThresholdResetOnSave(gate("full_block", 5)), true, "Q10: every scope Full block with a non-default value");
  assert.equal(closedModeThresholdResetOnSave(gate("full_block", 0)), true, "0 goes back to 3 as well");
  assert.equal(closedModeThresholdResetOnSave(gate("full_block", 3)), false, "already 3: the save changes nothing");
  assert.equal(closedModeThresholdResetOnSave(gate("explore", 5)), false, "kept while some scope explores");
  assert.equal(closedModeThresholdResetOnSave({ global: "full_block", overrides: {} }), false);
  assert.equal(closedModeThresholdResetOnSave(null), false);
});

test("after a save: the stored threshold that differs from the sent one, for the success notice (Q10)", async () => {
  const request = await fixture("webadmin-request-save-v3.json");
  const sent = verificationMethodDocument(request.draft_json, "exact", 3)!.gate_mode;
  const stored = verificationMethodMutationResponse(await fixture("webadmin-method-save-v3.json"), 3)!;
  assert.equal(closedModeThresholdChangedBySave(sent, stored.policy.draft.document.gate_mode), null, "Core kept 5");

  const allFull = structuredClone(request);
  allFull.draft_json.gate_mode.global = "full_block";
  const allFullSent = verificationMethodDocument(allFull.draft_json, "exact", 3)!.gate_mode;
  assert.equal(closedModeThresholdResetOnSave(allFullSent!), true, "the save preview warned before the save");
  const answer = verificationMethodMutationResponse(await fixture("webadmin-method-save-v3-all-full-block.json"), 3);
  assert.ok(answer);
  assert.deepEqual(answer.policy.draft.document.gate_mode, gate("full_block", 3), "Core dropped gate_mode; the v3 read materializes 3");
  assert.equal(closedModeThresholdChangedBySave(allFullSent, answer.policy.draft.document.gate_mode), 3);
  assert.equal(closedModeThresholdChangedBySave(undefined, answer.policy.draft.document.gate_mode), null, "a v1 save names no threshold");
  assert.equal(closedModeThresholdChangedBySave({ global: "explore", overrides: {} }, { global: "explore", overrides: {} }), null, "v2");
});

test("the rollback indicator: a threshold other than 3 stored in the saved draft OR the live document", async () => {
  const body = await fixture("webadmin-method-console-v3-closed-draft.json");
  const policy = (draft: VerificationGateModePolicy, live: VerificationGateModePolicy) => {
    const raw = structuredClone(body.data.policy);
    raw.draft.document.gate_mode = draft;
    raw.live.document.gate_mode = live;
    return verificationMethodPolicy(raw, 3)!;
  };
  assert.equal(verificationMethodPolicyStoresClosedThreshold(policy(gate("explore", 3), gate("explore", 3))), false, "at 3 Core stores nothing");
  assert.equal(verificationMethodPolicyStoresClosedThreshold(policy(gate("explore", 5), gate("explore", 3))), true,
    "a draft alone is enough: an older Core normalizes both documents (§6.2)");
  assert.equal(verificationMethodPolicyStoresClosedThreshold(policy(gate("explore", 3), gate("explore", 0))), true);
  assert.equal(verificationMethodPolicyStoresClosedThreshold(policy(gate("full_block", 3), gate("full_block", 3))), false);
  assert.equal(verificationMethodPolicyStoresClosedThreshold(verificationMethodConsoleResponse(
    await fixture("webadmin-method-console-v2-default.json", D151_DIRECTORY), 2)!.policy), false, "v2 cannot tell");
});

// ---------------------------------------------------------------------------
// Impact, mutations, conflicts
// ---------------------------------------------------------------------------

test("Core's generated v3 console and impact decode as served, through the Webadmin reply adapter, and only as v3", async () => {
  const rawConsole = await fixture("webadmin-console-v3.json");
  const rawImpact = await fixture("webadmin-impact-v3.json");
  assert.equal(verificationMethodConsoleResponse(rawConsole, 3), null,
    "the service-level capture has no legacy trio; the strict envelope keeps refusing that");
  assert.equal(verificationMethodImpactResponse(rawImpact, 3), null);

  const consoleBody = throughWebadminReply(rawConsole);
  const parsed = verificationMethodConsoleResponse(consoleBody, 3);
  assert.ok(parsed, "Core's bytes, through the wire adapter, decode as v3");
  assert.equal(parsed.contract_version, 3);
  assert.equal(parsed.policy.revision, 4);
  assert.deepEqual(parsed.policy.draft.document.gate_mode, gate("explore", 3));
  assert.deepEqual(parsed.policy.live.document.gate_mode, gate("explore", 3));
  assert.deepEqual(parsed.compiled_defaults.gate_mode, gate("full_block", 3));
  assert.deepEqual(parsed.gate_mode_catalogue?.closed_below_events, {
    default: 3, minimum: 0, maximum: 50, off: 0, radius_miles: 100, client_selector: "explore_mode_contract_version",
  });
  assert.equal(verificationMethodConsoleResponse(consoleBody, 2), null, "never v2 material");
  assert.equal(verificationMethodConsoleResponse(consoleBody, 1), null, "never v1 material");
  assert.deepEqual(Object.keys(consoleBody.data.policy.draft.document), ["global", "overrides", "waiting_room_copy", "gate_mode"]);
  assert.deepEqual(Object.keys(consoleBody.data.policy.draft.document.gate_mode), ["global", "overrides", "closed_below_events"],
    "Core's key order is the order the console writes back");
  assert.equal(closedModeThresholdApplies(parsed.policy.draft.document.gate_mode!), true, "Explore is on: the control is enabled");
  assert.equal(verificationMethodPolicyStoresClosedThreshold(parsed.policy), false, "3 is the canonical omission");

  const draft = verificationMethodDraft(parsed.policy.draft.document);
  const rebuilt = verificationMethodDocumentFromDraft(draft);
  assert.ok(rebuilt);
  assert.deepEqual(JSON.parse(JSON.stringify(rebuilt)), consoleBody.data.policy.draft.document, "byte-equivalent save material");
  assert.ok(normalizeVerificationMethodProxyBody("verification_method_save", {
    contract_version: 3, draft_json: rebuilt, expected_revision: parsed.policy.revision, request_id: REQUEST_ID,
  }));
  assert.ok(normalizeVerificationMethodProxyBody("verification_method_save", {
    contract_version: 3, draft_json: verificationMethodDocumentFromDraft({ ...draft, gate_mode: withClosedBelowEvents(draft.gate_mode!, 0) }),
    expected_revision: parsed.policy.revision, request_id: REQUEST_ID,
  }), "the operator's Never close goes out as the integer 0");

  assert.equal(parsed.evaluated_at, CORE_REFERENCE_CLOCK, "Core's normalized capture clock");

  const impactBody = throughWebadminReply(rawImpact);
  const impact = verificationMethodImpactResponse(impactBody, 3);
  assert.ok(impact, "Core's impact, through the wire adapter, decodes as v3");
  assert.equal(impact.contract_version, 3);
  assert.equal(impact.evaluated_at, CORE_REFERENCE_CLOCK,
    "Core 2e37ca9d: the re-captured impact sits exactly on the reference clock (the 824093ec capture was one second late)");
  assert.equal(impact.expected_revision, 5);
  assert.deepEqual(impact.impact.closed_below_events, { live: 3, draft: 0 }, "Core's capture: the draft says Never close");
  assert.deepEqual(impact.impact.by_storefront, []);
  assert.equal(impact.impact.unknown_storefront.live_gate_mode, "explore", "v3 rows keep the v2 mode fields");
  assert.equal(impact.impact.unknown_storefront.draft_gate_mode, "explore");
  assert.deepEqual(impact.impact.totals, impactBody.data.impact.totals, "the counts are Core's, unchanged");
  assert.equal(verificationMethodImpactResponse(impactBody, 2), null, "never v2 material");
  assert.equal(verificationMethodImpactResponse(impactBody, 1), null, "never v1 material");
});

test("the v3 impact refuses a malformed threshold pair; v1 and v2 never yield one", async () => {
  const data = (await coreImpact()).data as Json;
  for (const [label, value] of [
    ["missing", undefined],
    ["draft missing", { live: 3 }],
    ["an extra key", { live: 3, draft: 0, radius_miles: 100 }],
    ["out of range", { live: 3, draft: 51 }],
    ["negative", { live: -1, draft: 0 }],
    ["a string", { live: "3", draft: 0 }],
    ["null", null],
  ] as const) {
    const variant = structuredClone(data);
    if (value === undefined) delete variant.impact.closed_below_events;
    else variant.impact.closed_below_events = value;
    assert.equal(verificationMethodImpactResponse(success(variant), 3), null, label);
  }
  for (const version of [1, 2] as const) {
    const older = structuredClone(data);
    older.contract_version = version;
    const parsed = verificationMethodImpactResponse(success(older), version);
    assert.ok(parsed, `v${version} decoding tolerates the additive key`);
    assert.equal(Object.hasOwn(parsed.impact, "closed_below_events"), false, `but never yields it on v${version}`);
  }
});

test("v3 save, apply and conflict bodies decode only as v3, and gate_mode_hidden never rides on v3", async () => {
  const save = await fixture("webadmin-method-save-v3.json");
  const parsed = verificationMethodMutationResponse(save, 3);
  assert.ok(parsed);
  assert.equal(parsed.policy.draft.document.gate_mode?.closed_below_events, 5);
  assert.equal(verificationMethodMutationResponse(save, 2), null);
  assert.equal(verificationMethodMutationResponse(success({ ...save.data, gate_mode_hidden: true }), 3), null,
    "§7.4: no hidden flag on v2 or v3");
  assert.equal(verificationMethodMutationResponse(success({ ...save.data, gate_mode_hidden: false }), 3), null);

  const apply = verificationMethodMutationResponse(await fixture("webadmin-method-apply-v3.json"), 3);
  assert.ok(apply);
  assert.equal(apply.policy.live.document.gate_mode?.closed_below_events, 5, "publish makes the draft threshold live");

  const conflict = verificationMethodConflictResponse(await fixture("webadmin-method-conflict-v3.json"), 3);
  assert.ok(conflict);
  assert.equal(conflict.error, "verification-method-conflict");
  assert.equal(conflict.data.policy.draft.document.gate_mode?.closed_below_events, 7, "the other operator's threshold is adopted");
  assert.equal(verificationMethodConflictResponse(await fixture("webadmin-method-conflict-v3.json"), 2), null);
});

test("v3 mutation outcomes: Core's threshold refusal is terminal, never retained, and proves nothing about the wire", async () => {
  const gateInvalid = await fixture("webadmin-method-refusal-gate-mode-invalid.json", D151_DIRECTORY);
  assert.deepEqual(verificationMethodMutationOutcome(gateInvalid, 3),
    { kind: "refused", error: "verification-method-gate-mode-invalid", retain: false },
    "§7.2: missing/extra key, wrong type or range → 422 without data");
  assert.equal(verificationMethodShouldRetainMutation("verification-method-gate-mode-invalid"), false);
  assert.deepEqual(verificationMethodMutationOutcome(await fixture("webadmin-method-refusal-contract-version.json", D151_DIRECTORY), 3),
    { kind: "refused", error: "verification-method-contract-version", retain: false }, "Core downgraded under an open v3 console");
  assert.deepEqual(verificationMethodMutationOutcome(refusal("verification-method-write-failed", 503), 3),
    { kind: "refused", error: "verification-method-write-failed", retain: true },
    "§6.3: a non-default save before the validator upgrade fails at Mongo (503): retained, replayed exactly");
  assert.equal(verificationMethodMutationOutcome(await fixture("webadmin-method-save-v3.json"), 3).kind, "success");
  assert.equal(verificationMethodMutationOutcome(await fixture("webadmin-method-conflict-v3.json"), 3).kind, "conflict");
  const persona = await fixture("webadmin-method-refusal-explore-requires-persona.json", D151_DIRECTORY);
  assert.equal(verificationMethodMutationOutcome(persona, 3).kind, "gate-mode-conflict", "the Persona rule is unchanged on v3");
  assert.equal(verificationMethodOutcomeProvesV2(verificationMethodMutationOutcome(persona, 3), 3), false, "already on v3");
});

// ---------------------------------------------------------------------------
// Proxy, retained command, publish command
// ---------------------------------------------------------------------------

test("the proxy forwards exact v3 bodies and refuses what Core would refuse", async () => {
  assert.deepEqual(normalizeVerificationMethodProxyBody("verification_method_console", { contract_version: 3 }), { contract_version: 3 });
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_console", { contract_version: 4 }), null);
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_console", { contract_version: "3" }), null);

  const request = await fixture("webadmin-request-save-v3.json");
  assert.deepEqual(normalizeVerificationMethodProxyBody("verification_method_save", request), request, "the corpus request passes unchanged");
  const withThreshold = (value: unknown) => ({
    ...request, draft_json: { ...request.draft_json, gate_mode: { ...request.draft_json.gate_mode, closed_below_events: value } },
  });
  for (const value of [0, 50]) assert.ok(normalizeVerificationMethodProxyBody("verification_method_save", withThreshold(value)), String(value));
  for (const value of ["5", 5.5, true, null, -1, 51]) {
    assert.equal(normalizeVerificationMethodProxyBody("verification_method_save", withThreshold(value)), null, String(value));
  }
  const twoKeys = structuredClone(request);
  delete twoKeys.draft_json.gate_mode.closed_below_events;
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_save", twoKeys), null, "a v3 save always states the threshold");
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_save", { ...request, contract_version: 2 }), null,
    "§7.4: a v2 save that names the threshold is refused before Core");
  assert.deepEqual(normalizeVerificationMethodProxyBody("verification_method_save", { ...twoKeys, contract_version: 2 }),
    { ...twoKeys, contract_version: 2 }, "the released v2 save is unchanged");
  const extra = structuredClone(request);
  extra.draft_json.gate_mode.radius_miles = 100;
  assert.equal(normalizeVerificationMethodProxyBody("verification_method_save", extra), null);

  assert.deepEqual(normalizeVerificationMethodProxyBody("verification_method_impact", { contract_version: 3, expected_revision: 5 }),
    { contract_version: 3, expected_revision: 5 });
  const impact = verificationMethodImpactResponse(await coreImpact(), 3)!;
  const apply = verificationMethodApplyCommand(impact, "Never close while research fills the areas", REQUEST_ID);
  assert.deepEqual(apply, {
    contract_version: 3,
    expected_revision: 5,
    normalized_fingerprint: "8b8568e19aed152796f8afc665cd6143f43043911024db229427c687e761f8aa",
    confirmation_phrase: VERIFICATION_METHOD_CONFIRMATION_PHRASE,
    reason: "Never close while research fills the areas",
    request_id: REQUEST_ID,
  }, "§7.3: Core's v3 fingerprint binds the threshold; version and fingerprint come from the same impact");
  assert.deepEqual(normalizeVerificationMethodProxyBody("verification_method_apply", apply), apply);
});

test("a v3 save is retained and replayed byte for byte, and photo guidance reads it as v3", async () => {
  const request = await fixture("webadmin-request-save-v3.json");
  const pending = verificationMethodPendingMutation("verification_method_save", request);
  assert.ok(pending);
  assert.deepEqual(verificationMethodPendingFrom(JSON.parse(JSON.stringify(pending))), pending);
  assert.equal(verificationMethodCommandVersion(pending.payload), 3);

  const photo = structuredClone(request);
  photo.draft_json.global = "photo";
  photo.draft_json.gate_mode.global = "full_block";
  assert.equal(
    verificationMethodPhotoCopyGuidance("verification-method-copy-default-invalid", verificationMethodPendingMutation("verification_method_save", photo)),
    "default",
  );
});

// ---------------------------------------------------------------------------
// The corpus: Core's bytes plus the hand-written cases Core does not capture
// ---------------------------------------------------------------------------

test("the corpus pins Core's two v3 bodies and marks every hand-written body", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", FIXTURE_DIRECTORY), "utf8")) as Json;
  assert.equal(manifest.contract, "verification-method-console-v3");
  assert.equal(manifest.core_corpus.path, "tests/fixtures/verification_explore_mode_wire/");
  assert.equal(manifest.core_corpus.manifest_contract, "verification-explore-mode-v1");
  assert.equal(manifest.core_corpus.generator_source_commit, CORE_GENERATOR_SOURCE_COMMIT);
  assert.equal(manifest.core_corpus.copied_at_tip, CORE_COPIED_AT_TIP);
  assert.equal(manifest.core_corpus.reference_clock, CORE_REFERENCE_CLOCK);
  assert.equal(Object.hasOwn(manifest.core_corpus, "fixture_commit"), false, "each Core row names its own commit");
  const rows = manifest.files as Array<{ file: string; sha256: string; origin: string; case?: string; fixture_commit?: string }>;
  const files = rows.map((row) => row.file);
  assert.deepEqual(files, [...files].sort());
  assert.deepEqual((await readdir(FIXTURE_DIRECTORY)).sort(), [...files, "manifest.json"].sort());
  assert.deepEqual(rows.filter((row) => row.origin === "core").map((row) => [row.file, row.sha256, row.fixture_commit]), [
    ["webadmin-console-v3.json", CORE_CONSOLE_V3_SHA256, CORE_CONSOLE_V3_COMMIT],
    ["webadmin-impact-v3.json", CORE_IMPACT_V3_SHA256, CORE_IMPACT_V3_COMMIT],
  ], "Core's bytes, Core's hashes, the commit that last touched each");
  assert.ok(rows.every((row) => row.origin === "core" || !Object.hasOwn(row, "fixture_commit")), "hand-written rows name no Core commit");
  assert.deepEqual(rows.filter((row) => row.origin === "hand-written").map((row) => row.file), [
    "webadmin-method-apply-v3.json",
    "webadmin-method-conflict-v3.json",
    "webadmin-method-console-v3-closed-draft.json",
    "webadmin-method-save-v3-all-full-block.json",
    "webadmin-method-save-v3.json",
    "webadmin-request-save-v3.json",
  ], "exactly these remain hand-written; replace each with Core bytes once Core captures its case");
  assert.ok(rows.every((row) => row.origin === "core" || (row.origin === "hand-written" && typeof row.case === "string" && row.case !== "")));
  for (const row of rows) {
    const bytes = await readFile(new URL(row.file, FIXTURE_DIRECTORY));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), row.sha256, row.file);
  }
});
