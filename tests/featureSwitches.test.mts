import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  FEATURE_SWITCHES,
  FEATURE_SWITCHES_ACTIONS,
  FEATURE_SWITCHES_CAPABILITIES,
  FEATURE_SWITCHES_ERROR_STATUSES,
  FEATURE_SWITCHES_PENDING_STORAGE_KEY,
  featureSwitchesAdminMe,
  featureSwitchesConflictResponse,
  featureSwitchesConflictSatisfiesPending,
  featureSwitchesError,
  featureSwitchesErrorKey,
  featureSwitchesMutationConverged,
  featureSwitchesMutationResponse,
  featureSwitchesPendingFrom,
  featureSwitchesPendingMutation,
  featureSwitchesPersistBeforeMutation,
  featureSwitchesProvenance,
  featureSwitchesProxyCapabilityAuthorized,
  featureSwitchesReasonIsValid,
  featureSwitchesShouldRetainMutation,
  featureSwitchesStateConverged,
  featureSwitchesStateResponse,
  featureSwitchesTarget,
  featureSwitchesValue,
  normalizeFeatureSwitchesProxyBody,
  type FeatureSwitch,
  type FeatureSwitchesRole,
  type FeatureSwitchesState,
} from "../lib/featureSwitches.ts";
import {
  ADMIN_ACTIONS,
  adminActionAccess,
  adminPrincipalFrom,
  isAdminBridgeActionAuthorized,
} from "../lib/adminActions.ts";
import { FEATURE_SWITCHES_CONTRACT_READY } from "../lib/contractReadiness.ts";

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_UUID = "7b5f2a11-2c3d-4e5f-8a9b-0c1d2e3f4a5b";

function envelope(data: unknown, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    success: true,
    status_code: 200,
    data,
    message: 200,
    status: 200,
    can_send: 0,
    ...overrides,
  };
}

function errorEnvelope(error: string, status: number, data?: unknown): Record<string, unknown> {
  return {
    success: false,
    status_code: status,
    error,
    ...(data === undefined ? {} : { data }),
    message: 200,
    status: 200,
    can_send: 0,
  };
}

function switchState(enabled: boolean, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled,
    updated_at: 1_787_800_000,
    updated_by: "owner@friending.com",
    ...overrides,
  };
}

function state(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contract_version: 1,
    hey: switchState(true),
    footprints: switchState(true),
    revision: 4,
    ...overrides,
  };
}

function adminMeBlock(
  role: FeatureSwitchesRole,
  ready: boolean,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const capabilities = role === "viewer"
    ? ["feature_switches_read"]
    : ["feature_switches_read", "feature_switches_edit"];
  const actions = ready
    ? FEATURE_SWITCHES_ACTIONS.filter((action) => action === "feature_switches_get"
      ? capabilities.includes("feature_switches_read")
      : capabilities.includes("feature_switches_edit"))
    : [];
  return {
    contract_version: 1,
    contract_ready: ready,
    hey_enabled: true,
    footprints_enabled: false,
    revision: 4,
    principal: { role, capabilities },
    actions,
    ...overrides,
  };
}

function setBody(
  selectedSwitch: FeatureSwitch = "footprints",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    contract_version: 1,
    switch: selectedSwitch,
    enabled: "false",
    expected_revision: 4,
    reason: "owner decided",
    request_id: UUID,
    ...overrides,
  };
}

function parsedState(overrides: Partial<FeatureSwitchesState> = {}): FeatureSwitchesState {
  return {
    contract_version: 1,
    hey: { enabled: true, updated_at: 1, updated_by: "a@b.c" },
    footprints: { enabled: true, updated_at: 1, updated_by: "a@b.c" },
    revision: 4,
    ...overrides,
  };
}

test("the dormant family vocabulary and conditional proxy surface are exact", () => {
  assert.deepEqual([...FEATURE_SWITCHES], ["hey", "footprints"]);
  assert.deepEqual([...FEATURE_SWITCHES_ACTIONS], ["feature_switches_get", "feature_switches_set"]);
  assert.deepEqual([...FEATURE_SWITCHES_CAPABILITIES], [
    "feature_switches_read",
    "feature_switches_edit",
  ]);
  assert.equal(FEATURE_SWITCHES_CONTRACT_READY, false);
  for (const action of FEATURE_SWITCHES_ACTIONS) {
    assert.equal((ADMIN_ACTIONS as readonly string[]).includes(action), false);
    assert.equal(adminActionAccess(action), null);
  }
});

test("admin_me is exact, capability-authored, action-ordered, and readiness-gated", () => {
  const owner = featureSwitchesAdminMe(adminMeBlock("owner", true));
  assert.deepEqual(owner?.actions, ["feature_switches_get", "feature_switches_set"]);
  assert.equal(owner?.hey_enabled, true);
  assert.equal(owner?.footprints_enabled, false);

  const viewer = featureSwitchesAdminMe(adminMeBlock("viewer", true));
  assert.deepEqual(viewer?.actions, ["feature_switches_get"]);

  const dormant = featureSwitchesAdminMe(adminMeBlock("owner", false));
  assert.deepEqual(dormant?.actions, []);
  assert.deepEqual(dormant?.principal.capabilities, [...FEATURE_SWITCHES_CAPABILITIES]);

  // The provider's revoked projection is a capability-less viewer. It parses,
  // but advertises no action and therefore authorizes nothing.
  const revoked = featureSwitchesAdminMe(adminMeBlock("viewer", true, {
    principal: { role: "viewer", capabilities: [] },
    actions: [],
  }));
  assert.deepEqual(revoked?.principal.capabilities, []);
  assert.deepEqual(revoked?.actions, []);

  assert.equal(featureSwitchesAdminMe(adminMeBlock("viewer", true, {
    principal: { role: "viewer", capabilities: ["feature_switches_edit"] },
  })), null);
  assert.equal(featureSwitchesAdminMe(adminMeBlock("admin", true, {
    principal: { role: "admin", capabilities: ["feature_switches_read"] },
  })), null);
  assert.equal(featureSwitchesAdminMe(adminMeBlock("viewer", true, {
    actions: ["feature_switches_get", "feature_switches_set"],
  })), null);
  assert.equal(featureSwitchesAdminMe(adminMeBlock("owner", true, {
    actions: ["feature_switches_set", "feature_switches_get"],
  })), null);
  assert.equal(featureSwitchesAdminMe({ ...adminMeBlock("owner", true), extra: 1 }), null);
  assert.equal(featureSwitchesAdminMe(adminMeBlock("owner", true, { hey_enabled: "true" })), null);
  assert.equal(featureSwitchesAdminMe(adminMeBlock("owner", true, { revision: -1 })), null);
});

test("the bridge trusts only the exact family capability block and keeps other floors", () => {
  const owner = { feature_switches: adminMeBlock("owner", true) };
  const viewer = { feature_switches: adminMeBlock("viewer", true) };
  const dormant = { feature_switches: adminMeBlock("owner", false) };
  const revoked = { feature_switches: adminMeBlock("viewer", true, {
    principal: { role: "viewer", capabilities: [] }, actions: [],
  }) };

  assert.equal(featureSwitchesProxyCapabilityAuthorized("feature_switches_get", owner), true);
  assert.equal(featureSwitchesProxyCapabilityAuthorized("feature_switches_set", owner), true);
  assert.equal(featureSwitchesProxyCapabilityAuthorized("feature_switches_set", viewer), false);
  assert.equal(featureSwitchesProxyCapabilityAuthorized("feature_switches_get", dormant), false);
  assert.equal(featureSwitchesProxyCapabilityAuthorized("feature_switches_get", revoked), false);
  assert.equal(featureSwitchesProxyCapabilityAuthorized("feature_switches_get", {}), false);
  assert.equal(featureSwitchesProxyCapabilityAuthorized("overview", owner), null);

  const principal = adminPrincipalFrom({ role: "owner", email: "owner@friending.com" });
  assert.equal(isAdminBridgeActionAuthorized("feature_switches_set", principal, null, null, false), false);
  assert.equal(isAdminBridgeActionAuthorized("feature_switches_set", principal, null, null, null), false);
  assert.equal(isAdminBridgeActionAuthorized("feature_switches_set", principal, null, null, true), true);
  assert.equal(isAdminBridgeActionAuthorized("overview", principal, null, null, false), true);
});

test("state decoding is exact, nested, versioned, and provenance is per-switch all-or-nothing", () => {
  assert.deepEqual(featureSwitchesStateResponse(envelope(state())), state());
  const neverSet = state({
    hey: switchState(true, { updated_at: 0, updated_by: "" }),
    footprints: switchState(true, { updated_at: 0, updated_by: "" }),
    revision: 0,
  });
  assert.deepEqual(featureSwitchesStateResponse(envelope(neverSet)), neverSet);

  assert.equal(featureSwitchesStateResponse(envelope(state({
    hey: switchState(true, { updated_at: 0 }),
  }))), null);
  assert.equal(featureSwitchesStateResponse(envelope(state({
    footprints: switchState(true, { updated_by: "" }),
  }))), null);
  assert.equal(featureSwitchesStateResponse(envelope(state({
    hey: switchState(true, { enabled: "true" }),
  }))), null);
  assert.equal(featureSwitchesStateResponse(envelope(state({ contract_version: 2 }))), null);
  assert.equal(featureSwitchesStateResponse(envelope(state({ revision: 1.5 }))), null);
  assert.equal(featureSwitchesStateResponse(envelope({ ...state(), extra: true })), null);
  assert.equal(featureSwitchesStateResponse(envelope({
    contract_version: 1,
    hey_enabled: true,
    footprints_enabled: false,
    revision: 4,
  })), null, "the pre-provider flattened lookalike must fail closed");
  assert.equal(featureSwitchesStateResponse(envelope(state(), { can_send: 1 })), null);
  assert.equal(featureSwitchesStateResponse({ data: state() }), null);
});

test("mutation and conflict decoders accept only complete authoritative family state", () => {
  const mutation = featureSwitchesMutationResponse(envelope({
    ...state({ footprints: switchState(false), revision: 5 }),
    no_change: false,
    replayed: false,
  }));
  assert.equal(mutation?.footprints.enabled, false);
  assert.equal(mutation?.revision, 5);
  assert.equal(mutation?.no_change, false);
  assert.equal(mutation?.replayed, false);

  assert.equal(featureSwitchesMutationResponse(envelope({ ...state(), no_change: false })), null);
  assert.equal(featureSwitchesMutationResponse(envelope({
    ...state(), no_change: "false", replayed: false,
  })), null);

  const conflictBody = errorEnvelope("feature-switches-conflict", 409, {
    current: state({ footprints: switchState(false), revision: 5 }),
  });
  const conflict = featureSwitchesConflictResponse(conflictBody);
  assert.equal(conflict?.current.revision, 5);
  assert.equal(conflict?.current.footprints.enabled, false);

  assert.equal(featureSwitchesConflictResponse(errorEnvelope("feature-switches-conflict", 409, {})), null);
  assert.equal(featureSwitchesConflictResponse(errorEnvelope("feature-switches-conflict", 409, {
    current: { ...state(), extra: true },
  })), null);
  assert.equal(featureSwitchesConflictResponse(errorEnvelope("feature-switches-conflict", 422, {
    current: state(),
  })), null);
  // T-424 B1: a data-bearing conflict is parsed only by the exact conflict
  // decoder. Malformed conflict data remains unknown and retains the command.
  assert.equal(featureSwitchesError(conflictBody), null);
  assert.equal(featureSwitchesError(errorEnvelope("feature-switches-conflict", 409, {})), null);
  assert.equal(featureSwitchesShouldRetainMutation(featureSwitchesError(conflictBody)), true);
});

test("internal reasons use Unicode scalar bounds without an HTML maxlength shortcut", () => {
  assert.equal(featureSwitchesReasonIsValid("owner  decided"), true);
  assert.equal(featureSwitchesReasonIsValid("kikapcsolva a tulajdonos kérésére"), true);
  assert.equal(featureSwitchesReasonIsValid("😀".repeat(300)), true);
  assert.equal(featureSwitchesReasonIsValid("😀".repeat(301)), false);
  assert.equal(featureSwitchesReasonIsValid(""), false);
  assert.equal(featureSwitchesReasonIsValid(" padded"), false);
  assert.equal(featureSwitchesReasonIsValid("padded "), false);
  assert.equal(featureSwitchesReasonIsValid("a\tb"), false);
  assert.equal(featureSwitchesReasonIsValid("a\u009fb"), false);
  assert.equal(featureSwitchesReasonIsValid("e\u0301rte\u0301k"), false);
  assert.equal(featureSwitchesReasonIsValid("e\u0301rte\u0301k".normalize("NFC")), true);
  assert.equal(featureSwitchesReasonIsValid(42), false);
});

test("proxy bodies normalize one exact switch command and reject loose or caller-owned material", () => {
  assert.deepEqual(
    { ...normalizeFeatureSwitchesProxyBody("feature_switches_get", { contract_version: 1 }) },
    { contract_version: 1 },
  );
  assert.equal(normalizeFeatureSwitchesProxyBody("feature_switches_get", {}), null);
  assert.equal(normalizeFeatureSwitchesProxyBody("feature_switches_get", setBody()), null);

  for (const selectedSwitch of FEATURE_SWITCHES) {
    assert.deepEqual({ ...normalizeFeatureSwitchesProxyBody(
      "feature_switches_set",
      setBody(selectedSwitch),
    ) }, setBody(selectedSwitch));
  }
  for (const loose of [true, false, 1, 0, "1", "0", "on", "yes", "TRUE", "False", "", " true"]) {
    assert.equal(normalizeFeatureSwitchesProxyBody(
      "feature_switches_set",
      setBody("footprints", { enabled: loose }),
    ), null, `loose boolean accepted: ${String(loose)}`);
  }
  for (const invalidSwitch of ["visits", "pinger", "photo_likes", "", true]) {
    assert.equal(normalizeFeatureSwitchesProxyBody(
      "feature_switches_set",
      setBody("footprints", { switch: invalidSwitch }),
    ), null);
  }
  assert.equal(normalizeFeatureSwitchesProxyBody(
    "feature_switches_set", setBody("hey", { expected_revision: "4" }),
  ), null);
  assert.equal(normalizeFeatureSwitchesProxyBody(
    "feature_switches_set", setBody("hey", { expected_revision: -1 }),
  ), null);
  assert.equal(normalizeFeatureSwitchesProxyBody(
    "feature_switches_set", setBody("hey", { reason: "" }),
  ), null);
  assert.equal(normalizeFeatureSwitchesProxyBody(
    "feature_switches_set", setBody("hey", { request_id: UUID.toUpperCase() }),
  ), null);
  assert.equal(normalizeFeatureSwitchesProxyBody(
    "feature_switches_set", { ...setBody(), admin_email: "x@y.z" },
  ), null);
  assert.equal(normalizeFeatureSwitchesProxyBody(
    "feature_switches_set", { ...setBody(), secret: "s" },
  ), null);
  assert.ok(normalizeFeatureSwitchesProxyBody(
    "feature_switches_set", setBody("hey", { expected_revision: 0 }),
  ));
  assert.equal(normalizeFeatureSwitchesProxyBody("overview", {}), undefined);
});

test("pending identity is switch-target-bound and persisted before the first request", async () => {
  for (const selectedSwitch of FEATURE_SWITCHES) {
    const pending = featureSwitchesPendingMutation(
      featureSwitchesTarget(selectedSwitch),
      setBody(selectedSwitch),
    );
    assert.ok(pending);
    assert.equal(pending?.target, `feature_switches:v1:${selectedSwitch}`);
    assert.deepEqual(featureSwitchesPendingFrom(JSON.parse(JSON.stringify(pending))), pending);
    const other = selectedSwitch === "hey" ? "footprints" : "hey";
    assert.equal(featureSwitchesPendingMutation(featureSwitchesTarget(other), setBody(selectedSwitch)), null);
  }

  const pending = featureSwitchesPendingMutation(featureSwitchesTarget("footprints"), setBody())!;
  assert.equal(featureSwitchesPendingFrom({ ...pending, version: 2 }), null);
  assert.equal(featureSwitchesPendingFrom({ ...pending, action: "feature_switches_get" }), null);
  assert.equal(featureSwitchesPendingFrom({
    ...pending, payload: { ...setBody(), enabled: true },
  }), null);

  const order: string[] = [];
  const result = await featureSwitchesPersistBeforeMutation({
    setItem(key: string, value: string) {
      assert.equal(key, FEATURE_SWITCHES_PENDING_STORAGE_KEY);
      assert.deepEqual(JSON.parse(value), JSON.parse(JSON.stringify(pending)));
      order.push("persist");
    },
  }, pending, async () => {
    order.push("request");
    return "sent";
  });
  assert.deepEqual(order, ["persist", "request"]);
  assert.deepEqual(result, { ok: true, response: "sent" });

  let sent = false;
  const failing = await featureSwitchesPersistBeforeMutation(
    { setItem() { throw new Error("quota"); } },
    pending,
    async () => { sent = true; return "sent"; },
  );
  assert.deepEqual(failing, { ok: false });
  assert.equal(sent, false);
});

test("success and authoritative-read convergence bind target value and exact family revision", () => {
  const disable = featureSwitchesPendingMutation(featureSwitchesTarget("footprints"), setBody())!;
  assert.equal(featureSwitchesMutationConverged(disable, {
    ...parsedState({ footprints: { enabled: false, updated_at: 1, updated_by: "a@b.c" }, revision: 5 }),
    no_change: false, replayed: false,
  }), true);
  assert.equal(featureSwitchesMutationConverged(disable, {
    ...parsedState({ footprints: { enabled: false, updated_at: 1, updated_by: "a@b.c" } }),
    no_change: true, replayed: false,
  }), true);
  assert.equal(featureSwitchesMutationConverged(disable, {
    ...parsedState({ footprints: { enabled: false, updated_at: 1, updated_by: "a@b.c" }, revision: 5 }),
    no_change: true, replayed: false,
  }), false);
  assert.equal(featureSwitchesMutationConverged(disable, {
    ...parsedState({ footprints: { enabled: true, updated_at: 1, updated_by: "a@b.c" }, revision: 5 }),
    no_change: false, replayed: false,
  }), false);

  assert.equal(featureSwitchesStateConverged(disable, parsedState({
    footprints: { enabled: false, updated_at: 1, updated_by: "a@b.c" }, revision: 5,
  })), true);
  assert.equal(featureSwitchesStateConverged(disable, parsedState({
    footprints: { enabled: false, updated_at: 1, updated_by: "a@b.c" }, revision: 4,
  })), true);
  assert.equal(featureSwitchesStateConverged(disable, parsedState({
    footprints: { enabled: false, updated_at: 1, updated_by: "a@b.c" }, revision: 6,
  })), false);
  assert.equal(featureSwitchesStateConverged(disable, parsedState({ revision: 5 })), false);

  assert.equal(featureSwitchesConflictSatisfiesPending(disable, {
    current: parsedState({
      footprints: { enabled: false, updated_at: 1, updated_by: "a@b.c" }, revision: 9,
    }),
  }), true);
  assert.equal(featureSwitchesConflictSatisfiesPending(disable, {
    current: parsedState({ revision: 9 }),
  }), false);

  const live = parsedState({
    hey: { enabled: false, updated_at: 2, updated_by: "hey@friending.com" },
  });
  assert.equal(featureSwitchesValue(live, "hey"), false);
  assert.deepEqual(featureSwitchesProvenance(live, "hey"), {
    updated_at: 2, updated_by: "hey@friending.com",
  });
});

test("every no-data refusal has an exact status, localized class, and safe retry policy", async () => {
  const [enRaw, huRaw] = await Promise.all([
    readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
    readFile(new URL("../messages/hu.json", import.meta.url), "utf8"),
  ]);
  const en = JSON.parse(enRaw);
  const hu = JSON.parse(huRaw);
  const keys = new Set<string>();
  for (const [error, status] of Object.entries(FEATURE_SWITCHES_ERROR_STATUSES)) {
    if (error === "feature-switches-conflict") continue;
    assert.equal(featureSwitchesError(errorEnvelope(error, status)), error);
    assert.equal(featureSwitchesError(errorEnvelope(error, status === 409 ? 422 : 409)), null);
    const key = featureSwitchesErrorKey(error);
    assert.notEqual(key, "generic", `unclassified refusal: ${error}`);
    keys.add(key);
    assert.equal(typeof en.featureSwitches.errors[key], "string", `missing EN copy: ${key}`);
    assert.equal(typeof hu.featureSwitches.errors[key], "string", `missing HU copy: ${key}`);
  }
  keys.add("generic");
  keys.add("conflict");
  assert.deepEqual(Object.keys(en.featureSwitches.errors).sort(), [...keys].sort());
  assert.equal(featureSwitchesErrorKey("feature-switches-invented"), "generic");
  assert.equal(featureSwitchesError(errorEnvelope("feature-switches-invented", 422)), null);

  for (const uncertain of [
    null,
    "feature-switches-request-in-progress",
    "feature-switches-audit-write-failed",
    "feature-switches-receipt-write-failed",
    "feature-switches-write-failed",
    "feature-switches-stored-invalid",
    "feature-switches-read-failed",
    "core-unavailable",
    "core-timeout",
    "something-nobody-declared",
  ]) assert.equal(featureSwitchesShouldRetainMutation(uncertain), true, `should retain: ${uncertain}`);

  for (const terminal of [
    "feature-switches-conflict",
    "feature-switches-request-id-conflict",
    "feature-switches-switch-invalid",
    "feature-switches-value-invalid",
    "feature-switches-reason-invalid",
    "feature-switches-revision-invalid",
    "feature-switches-edit-required",
    "admin-revoked",
    "bad-origin",
  ]) assert.equal(featureSwitchesShouldRetainMutation(terminal), false, `should release: ${terminal}`);
});

test("the panel, proxy, locales and Help share one dormant family cutover", async () => {
  const [configuration, footprints, panel, bridge, actions, readiness, help, enRaw, huRaw] = await Promise.all([
    readFile(new URL("../app/(dashboard)/configuration/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(dashboard)/footprints/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/FeatureSwitchesPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/adminActions.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/contractReadiness.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/adminHelp.ts", import.meta.url), "utf8"),
    readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
    readFile(new URL("../messages/hu.json", import.meta.url), "utf8"),
  ]);

  assert.match(configuration, /FEATURE_SWITCHES_CONTRACT_READY \? <FeatureSwitchesPanel \/> : null/);
  assert.match(footprints, /href="\/configuration#feature-switches"/);
  assert.match(readiness, /export const FEATURE_SWITCHES_CONTRACT_READY: boolean = false;/);
  assert.match(actions, /ACTIVE_FEATURE_SWITCHES_ACTIONS/);
  assert.match(bridge, /featureSwitchesProxyCapabilityAuthorized/);
  assert.match(bridge, /normalizeFeatureSwitchesProxyBody/);
  assert.match(bridge, /isAdminBridgeActionAuthorized\([\s\S]+featureSwitchesAuthorized/);

  assert.match(panel, /featureSwitchesPersistBeforeMutation\([\s\S]+adminCall\(command!\.action/);
  assert.match(panel, /adminCall\(existing\.action, existing\.payload\)/);
  assert.match(panel, /featureSwitchesStateConverged\(candidate, parsed\)/);
  assert.match(panel, /await load\(\)/);
  assert.doesNotMatch(panel, /maxLength=/, "M1: UTF-16 HTML maxlength must not bound Unicode scalars");
  assert.doesNotMatch(panel, /dangerouslySetInnerHTML|localStorage|console\.(?:log|info|warn|error)/);
  assert.match(panel, /setCurrent\(null\);\n\s+setState\("error"\)/);

  assert.match(footprints, /save_footprint_settings/);
  assert.doesNotMatch(panel, /save_footprint_settings|footprints_admin|footprint_reports/);

  const en = JSON.parse(enRaw);
  const hu = JSON.parse(huRaw);
  assert.deepEqual(Object.keys(en.featureSwitches).sort(), Object.keys(hu.featureSwitches).sort());
  assert.deepEqual(Object.keys(en.featureSwitches.live).sort(), Object.keys(hu.featureSwitches.live).sort());
  assert.deepEqual(Object.keys(en.featureSwitches.errors).sort(), Object.keys(hu.featureSwitches.errors).sort());
  assert.deepEqual(
    Object.keys(en.featureSwitches.switches).sort(),
    Object.keys(hu.featureSwitches.switches).sort(),
  );

  assert.match(help, /route: "\/configuration"/);
  assert.match(help, /"featureSwitches"/);
  assert.match(help, /route: "\/footprints"/);
  assert.match(help, /"featureSwitchesPointer"/);
  assert.match(en.adminHelp.pages.configuration.sections.featureSwitches.guidance, /photo-like gesture/);
  assert.match(en.adminHelp.pages.configuration.sections.featureSwitches.guidance, /one family revision/);
  assert.match(en.adminHelp.pages.footprints.sections.featureSwitchesPointer.guidance, /Configuration/);
  assert.match(en.featureSwitches.switches.footprints.consequenceOff, /photo-like gesture/);
  assert.match(en.featureSwitches.switches.footprints.consequenceOff, /collector tab/);
  assert.match(en.featureSwitches.launchPosture, /keep Hey on/);
  assert.match(en.featureSwitches.launchPosture, /explicitly turn Footprints off/);
});

test("a saved command survives an unknown outcome and reuses the same durable identity", () => {
  const first = featureSwitchesPendingMutation(featureSwitchesTarget("footprints"), setBody())!;
  const restored = featureSwitchesPendingFrom(JSON.parse(JSON.stringify(first)))!;
  assert.deepEqual(restored.payload, first.payload);
  assert.equal(restored.payload.request_id, UUID);
  const second = featureSwitchesPendingMutation(
    featureSwitchesTarget("footprints"),
    setBody("footprints", { request_id: OTHER_UUID }),
  )!;
  assert.notEqual(second.payload.request_id, first.payload.request_id);
  assert.equal(featureSwitchesMutationConverged(restored, {
    ...parsedState({
      footprints: { enabled: false, updated_at: 1, updated_by: "a@b.c" },
      revision: 5,
    }),
    no_change: false,
    replayed: true,
  }), true);
});
