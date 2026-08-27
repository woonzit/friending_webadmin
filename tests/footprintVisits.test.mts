import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  FOOTPRINT_VISITS_ACTIONS,
  FOOTPRINT_VISITS_CAPABILITIES,
  FOOTPRINT_VISITS_ERROR_STATUSES,
  FOOTPRINT_VISITS_PENDING_STORAGE_KEY,
  FOOTPRINT_VISITS_TARGET,
  footprintVisitsAdminMe,
  footprintVisitsConflictResponse,
  footprintVisitsConflictSatisfiesPending,
  footprintVisitsError,
  footprintVisitsErrorKey,
  footprintVisitsMutationConverged,
  footprintVisitsMutationResponse,
  footprintVisitsPendingFrom,
  footprintVisitsPendingMutation,
  footprintVisitsPersistBeforeMutation,
  footprintVisitsProxyCapabilityAuthorized,
  footprintVisitsReasonIsValid,
  footprintVisitsShouldRetainMutation,
  footprintVisitsStateResponse,
  normalizeFootprintVisitsProxyBody,
  type FootprintVisitsRole,
} from "../lib/footprintVisits.ts";
import {
  ADMIN_ACTIONS,
  adminActionAccess,
  adminPrincipalFrom,
  isAdminBridgeActionAuthorized,
} from "../lib/adminActions.ts";
import { FOOTPRINTS_VISITS_CONTRACT_READY } from "../lib/contractReadiness.ts";

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

function state(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    visits_enabled: true,
    revision: 4,
    updated_at: 1_787_800_000,
    updated_by: "owner@friending.com",
    ...overrides,
  };
}

function adminMeBlock(
  role: FootprintVisitsRole,
  ready: boolean,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const capabilities = role === "viewer"
    ? ["footprints_visits_read"]
    : ["footprints_visits_read", "footprints_visits_edit"];
  const actions = ready
    ? FOOTPRINT_VISITS_ACTIONS.filter((action) => action === "footprints_visits_get"
      || capabilities.includes("footprints_visits_edit"))
    : [];
  return {
    contract_version: 1,
    contract_ready: ready,
    visits_enabled: true,
    revision: 4,
    principal: { role, capabilities },
    actions,
    ...overrides,
  };
}

function setBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contract_version: 1,
    visits_enabled: "false",
    expected_revision: 4,
    reason: "owner decided",
    request_id: UUID,
    ...overrides,
  };
}

test("the dormant v1 vocabulary and conditional proxy surface are exact", () => {
  assert.deepEqual([...FOOTPRINT_VISITS_ACTIONS], ["footprints_visits_get", "footprints_visits_set"]);
  assert.deepEqual([...FOOTPRINT_VISITS_CAPABILITIES], [
    "footprints_visits_read",
    "footprints_visits_edit",
  ]);
  // Dormant: neither action is reachable through the proxy allow-list, and the
  // local switch is the reviewed activation because the panel has no route of
  // its own to gate instead.
  assert.equal(FOOTPRINTS_VISITS_CONTRACT_READY, false);
  for (const action of FOOTPRINT_VISITS_ACTIONS) {
    assert.equal((ADMIN_ACTIONS as readonly string[]).includes(action), FOOTPRINTS_VISITS_CONTRACT_READY);
    assert.equal(adminActionAccess(action), null);
  }
});

test("admin_me is exact, role-derived, action-ordered, and readiness-gated", () => {
  const owner = footprintVisitsAdminMe(adminMeBlock("owner", true));
  assert.deepEqual(owner?.actions, ["footprints_visits_get", "footprints_visits_set"]);
  assert.deepEqual(owner?.principal.capabilities, ["footprints_visits_read", "footprints_visits_edit"]);

  const viewer = footprintVisitsAdminMe(adminMeBlock("viewer", true));
  assert.deepEqual(viewer?.actions, ["footprints_visits_get"]);

  // Dormant keeps the capabilities the role implies but offers no action.
  const dormant = footprintVisitsAdminMe(adminMeBlock("owner", false));
  assert.deepEqual(dormant?.actions, []);
  assert.equal(dormant?.contract_ready, false);
  assert.deepEqual(dormant?.principal.capabilities, ["footprints_visits_read", "footprints_visits_edit"]);

  // A block that claims more than its role earns is refused outright, rather
  // than being silently trimmed to what the role allows.
  assert.equal(footprintVisitsAdminMe(adminMeBlock("viewer", true, {
    principal: { role: "viewer", capabilities: ["footprints_visits_read", "footprints_visits_edit"] },
  })), null);
  assert.equal(footprintVisitsAdminMe(adminMeBlock("viewer", true, {
    actions: ["footprints_visits_get", "footprints_visits_set"],
  })), null);
  // Declaration order is part of the contract.
  assert.equal(footprintVisitsAdminMe(adminMeBlock("owner", true, {
    actions: ["footprints_visits_set", "footprints_visits_get"],
  })), null);
  // Additive, missing, and loosely typed material all fail closed.
  assert.equal(footprintVisitsAdminMe({ ...adminMeBlock("owner", true), extra: 1 }), null);
  assert.equal(footprintVisitsAdminMe(adminMeBlock("owner", true, { visits_enabled: "true" })), null);
  assert.equal(footprintVisitsAdminMe(adminMeBlock("owner", true, { revision: -1 })), null);
  assert.equal(footprintVisitsAdminMe(adminMeBlock("owner", true, { contract_version: 2 })), null);
  assert.equal(footprintVisitsAdminMe(null), null);
  assert.equal(footprintVisitsAdminMe(undefined), null);
});

test("the bridge trusts only the exact visits capability block and keeps other floors", () => {
  const owner = { footprints_visits: adminMeBlock("owner", true) };
  const viewer = { footprints_visits: adminMeBlock("viewer", true) };
  const dormant = { footprints_visits: adminMeBlock("owner", false) };

  assert.equal(footprintVisitsProxyCapabilityAuthorized("footprints_visits_get", owner), true);
  assert.equal(footprintVisitsProxyCapabilityAuthorized("footprints_visits_set", owner), true);
  assert.equal(footprintVisitsProxyCapabilityAuthorized("footprints_visits_set", viewer), false);
  assert.equal(footprintVisitsProxyCapabilityAuthorized("footprints_visits_get", dormant), false);
  assert.equal(footprintVisitsProxyCapabilityAuthorized("footprints_visits_get", {}), false);
  // A different family is not this family's business.
  assert.equal(footprintVisitsProxyCapabilityAuthorized("overview", owner), null);

  // A global owner role must not stand in for the Core-authored capability.
  const principal = adminPrincipalFrom({ role: "owner", email: "owner@friending.com" });
  assert.equal(isAdminBridgeActionAuthorized("footprints_visits_set", principal, null, null, false), false);
  assert.equal(isAdminBridgeActionAuthorized("footprints_visits_set", principal, null, null, null), false);
  assert.equal(isAdminBridgeActionAuthorized("footprints_visits_set", principal, null, null, true), true);
  // Other families keep the generic floor and are unaffected by the new argument.
  assert.equal(isAdminBridgeActionAuthorized("overview", principal, null, null, false), true);
});

test("state decoding is exact and provenance is all-or-nothing", () => {
  assert.deepEqual(footprintVisitsStateResponse(envelope(state())), {
    visits_enabled: true,
    revision: 4,
    updated_at: 1_787_800_000,
    updated_by: "owner@friending.com",
  });

  // A1: the never-set shape a live database that predates the switch produces.
  assert.deepEqual(footprintVisitsStateResponse(envelope(state({
    visits_enabled: true,
    revision: 3,
    updated_at: 0,
    updated_by: "",
  }))), { visits_enabled: true, revision: 3, updated_at: 0, updated_by: "" });

  // Half-present provenance is a shape Core does not produce, so it is not a
  // state to render — it is a decode failure.
  assert.equal(footprintVisitsStateResponse(envelope(state({ updated_at: 0 }))), null);
  assert.equal(footprintVisitsStateResponse(envelope(state({ updated_by: "" }))), null);

  assert.equal(footprintVisitsStateResponse(envelope(state({ visits_enabled: "false" }))), null);
  assert.equal(footprintVisitsStateResponse(envelope(state({ revision: 1.5 }))), null);
  assert.equal(footprintVisitsStateResponse(envelope(state({ updated_at: -1 }))), null);
  assert.equal(footprintVisitsStateResponse(envelope({ ...state(), extra: true })), null);
  const { revision: _dropped, ...withoutRevision } = state();
  assert.equal(footprintVisitsStateResponse(envelope(withoutRevision)), null);
  // The transport envelope itself is part of the contract.
  assert.equal(footprintVisitsStateResponse(envelope(state(), { can_send: 1 })), null);
  assert.equal(footprintVisitsStateResponse(envelope(state(), { status_code: 201 })), null);
  assert.equal(footprintVisitsStateResponse({ data: state() }), null);
});

test("mutation and conflict decoders accept only exact complete authoritative fields", () => {
  const mutation = footprintVisitsMutationResponse(envelope({
    ...state({ visits_enabled: false, revision: 5 }),
    no_change: false,
    replayed: false,
  }));
  assert.equal(mutation?.visits_enabled, false);
  assert.equal(mutation?.revision, 5);
  assert.equal(mutation?.no_change, false);
  assert.equal(mutation?.replayed, false);

  assert.equal(footprintVisitsMutationResponse(envelope({ ...state(), no_change: false })), null);
  assert.equal(footprintVisitsMutationResponse(envelope({
    ...state(), no_change: "false", replayed: false,
  })), null);
  assert.equal(footprintVisitsMutationResponse(envelope(state())), null);

  const conflict = footprintVisitsConflictResponse(errorEnvelope(
    "footprints-visits-conflict",
    409,
    { current: state({ visits_enabled: false, revision: 5 }) },
  ));
  assert.equal(conflict?.current.revision, 5);
  assert.equal(conflict?.current.visits_enabled, false);

  // A conflict without decodable current state cannot be adopted.
  assert.equal(footprintVisitsConflictResponse(errorEnvelope("footprints-visits-conflict", 409, {})), null);
  assert.equal(footprintVisitsConflictResponse(errorEnvelope("footprints-visits-conflict", 409, {
    current: null,
  })), null);
  assert.equal(footprintVisitsConflictResponse(errorEnvelope("footprints-visits-conflict", 422, {
    current: state(),
  })), null);
  assert.equal(footprintVisitsConflictResponse(errorEnvelope("footprints-visits-write-failed", 409, {
    current: state(),
  })), null);
});

test("internal reasons preserve valid Unicode while refusing noncanonical controls and bounds", () => {
  assert.equal(footprintVisitsReasonIsValid("owner  decided"), true);
  assert.equal(footprintVisitsReasonIsValid("kikapcsolva a tulajdonos kérésére"), true);
  assert.equal(footprintVisitsReasonIsValid("x".repeat(300)), true);
  assert.equal(footprintVisitsReasonIsValid("x".repeat(301)), false);
  assert.equal(footprintVisitsReasonIsValid(""), false);
  assert.equal(footprintVisitsReasonIsValid(" padded"), false);
  assert.equal(footprintVisitsReasonIsValid("padded "), false);
  assert.equal(footprintVisitsReasonIsValid("a\tb"), false);
  assert.equal(footprintVisitsReasonIsValid("a\u0007b"), false);
  assert.equal(footprintVisitsReasonIsValid("a\u009fb"), false);
  // Decomposed input is not canonical; the same text in NFC is.
  assert.equal(footprintVisitsReasonIsValid("e\u0301rte\u0301k"), false);
  assert.equal(footprintVisitsReasonIsValid("e\u0301rte\u0301k".normalize("NFC")), true);
  assert.equal(footprintVisitsReasonIsValid(42), false);
});

test("proxy bodies normalize one exact command and refuse loose or caller-owned material", () => {
  assert.deepEqual(
    { ...normalizeFootprintVisitsProxyBody("footprints_visits_get", { contract_version: 1 }) },
    { contract_version: 1 },
  );
  assert.equal(normalizeFootprintVisitsProxyBody("footprints_visits_get", {}), null);
  // A read carrying mutation material is not a read.
  assert.equal(normalizeFootprintVisitsProxyBody("footprints_visits_get", setBody()), null);

  assert.deepEqual({ ...normalizeFootprintVisitsProxyBody("footprints_visits_set", setBody()) }, {
    contract_version: 1,
    visits_enabled: "false",
    expected_revision: 4,
    reason: "owner decided",
    request_id: UUID,
  });

  // The closed value vocabulary is the exact strings. Sending a looser form
  // would earn a Core request-invalid that looks like operator error.
  for (const loose of [true, false, 1, 0, "1", "0", "on", "yes", "TRUE", "False", "", " true"]) {
    assert.equal(
      normalizeFootprintVisitsProxyBody("footprints_visits_set", setBody({ visits_enabled: loose })),
      null,
      `loose boolean accepted: ${String(loose)}`,
    );
  }
  assert.equal(normalizeFootprintVisitsProxyBody("footprints_visits_set", setBody({ expected_revision: "4" })), null);
  assert.equal(normalizeFootprintVisitsProxyBody("footprints_visits_set", setBody({ expected_revision: -1 })), null);
  assert.equal(normalizeFootprintVisitsProxyBody("footprints_visits_set", setBody({ reason: "" })), null);
  assert.equal(normalizeFootprintVisitsProxyBody("footprints_visits_set", setBody({ request_id: "nope" })), null);
  assert.equal(
    normalizeFootprintVisitsProxyBody("footprints_visits_set", setBody({ request_id: UUID.toUpperCase() })),
    null,
  );
  // Reserved/caller-owned names never reach Core through this family.
  assert.equal(
    normalizeFootprintVisitsProxyBody("footprints_visits_set", { ...setBody(), admin_email: "x@y.z" }),
    null,
  );
  assert.equal(normalizeFootprintVisitsProxyBody("footprints_visits_set", { ...setBody(), secret: "s" }), null);
  // A revision of 0 is legitimate: the singleton may never have been written.
  assert.ok(normalizeFootprintVisitsProxyBody("footprints_visits_set", setBody({ expected_revision: 0 })));
  // Another family is left alone.
  assert.equal(normalizeFootprintVisitsProxyBody("overview", {}), undefined);
});

test("pending identity is target-bound and persisted before the first request", async () => {
  const pending = footprintVisitsPendingMutation(FOOTPRINT_VISITS_TARGET, setBody());
  assert.ok(pending);
  assert.equal(pending?.action, "footprints_visits_set");
  assert.equal(pending?.target, FOOTPRINT_VISITS_TARGET);

  // A target the contract does not name cannot carry a command.
  assert.equal(footprintVisitsPendingMutation("footprint_settings:other", setBody()), null);
  assert.equal(footprintVisitsPendingMutation(FOOTPRINT_VISITS_TARGET, setBody({ reason: "" })), null);

  // A restored draft is re-validated, not trusted.
  assert.deepEqual(footprintVisitsPendingFrom(JSON.parse(JSON.stringify(pending))), pending);
  assert.equal(footprintVisitsPendingFrom({ ...pending, version: 2 }), null);
  assert.equal(footprintVisitsPendingFrom({ ...pending, action: "footprints_visits_get" }), null);
  assert.equal(footprintVisitsPendingFrom({
    ...pending,
    payload: { ...setBody(), visits_enabled: true },
  }), null);

  const order: string[] = [];
  const storage = {
    setItem(key: string, value: string) {
      assert.equal(key, FOOTPRINT_VISITS_PENDING_STORAGE_KEY);
      assert.deepEqual(JSON.parse(value), JSON.parse(JSON.stringify(pending)));
      order.push("persist");
    },
  };
  const result = await footprintVisitsPersistBeforeMutation(storage, pending!, async () => {
    order.push("request");
    return "sent";
  });
  assert.deepEqual(order, ["persist", "request"]);
  assert.deepEqual(result, { ok: true, response: "sent" });

  // If the identity cannot be stored, the request must not be sent at all.
  let sent = false;
  const failing = await footprintVisitsPersistBeforeMutation(
    { setItem() { throw new Error("quota"); } },
    pending!,
    async () => { sent = true; return "sent"; },
  );
  assert.deepEqual(failing, { ok: false });
  assert.equal(sent, false);
});

test("convergence distinguishes a real transition from a receipted no-op", () => {
  const disable = footprintVisitsPendingMutation(FOOTPRINT_VISITS_TARGET, setBody())!;

  // A transition advances the shared revision by exactly one.
  assert.equal(footprintVisitsMutationConverged(disable, {
    visits_enabled: false, revision: 5, updated_at: 1, updated_by: "a@b.c",
    no_change: false, replayed: false,
  }), true);
  // A no-op leaves it where it was.
  assert.equal(footprintVisitsMutationConverged(disable, {
    visits_enabled: false, revision: 4, updated_at: 1, updated_by: "a@b.c",
    no_change: true, replayed: false,
  }), true);
  // A no-op that moved the revision, or a transition that did not, is not the
  // command's own outcome.
  assert.equal(footprintVisitsMutationConverged(disable, {
    visits_enabled: false, revision: 5, updated_at: 1, updated_by: "a@b.c",
    no_change: true, replayed: false,
  }), false);
  assert.equal(footprintVisitsMutationConverged(disable, {
    visits_enabled: false, revision: 4, updated_at: 1, updated_by: "a@b.c",
    no_change: false, replayed: false,
  }), false);
  // The value must be the one that was asked for.
  assert.equal(footprintVisitsMutationConverged(disable, {
    visits_enabled: true, revision: 5, updated_at: 1, updated_by: "a@b.c",
    no_change: false, replayed: false,
  }), false);

  // A conflict satisfies the intent only when the authoritative state already
  // holds the requested value.
  assert.equal(footprintVisitsConflictSatisfiesPending(disable, {
    current: { visits_enabled: false, revision: 9, updated_at: 1, updated_by: "a@b.c" },
  }), true);
  assert.equal(footprintVisitsConflictSatisfiesPending(disable, {
    current: { visits_enabled: true, revision: 9, updated_at: 1, updated_by: "a@b.c" },
  }), false);
});

test("every refusal has an exact logical status, localized class, and safe retry policy", async () => {
  const [enRaw, huRaw] = await Promise.all([
    readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
    readFile(new URL("../messages/hu.json", import.meta.url), "utf8"),
  ]);
  const en = JSON.parse(enRaw);
  const hu = JSON.parse(huRaw);

  const keys = new Set<string>();
  for (const [error, status] of Object.entries(FOOTPRINT_VISITS_ERROR_STATUSES)) {
    // The status must match, or the envelope is not the refusal it claims.
    assert.equal(footprintVisitsError(errorEnvelope(error, status)), error);
    assert.equal(footprintVisitsError(errorEnvelope(error, status === 409 ? 422 : 409)), null);
    const key = footprintVisitsErrorKey(error);
    assert.notEqual(key, "generic", `unclassified refusal: ${error}`);
    keys.add(key);
    assert.equal(typeof en.footprintVisits.errors[key], "string", `missing EN copy: ${key}`);
    assert.equal(typeof hu.footprintVisits.errors[key], "string", `missing HU copy: ${key}`);
  }
  keys.add("generic");
  assert.deepEqual(Object.keys(en.footprintVisits.errors).sort(), [...keys].sort());
  assert.equal(footprintVisitsErrorKey("footprints-visits-invented"), "generic");
  assert.equal(footprintVisitsError(errorEnvelope("footprints-visits-invented", 422)), null);

  // Uncertain outcomes keep the durable identity; terminal ones release it.
  for (const uncertain of [
    null,
    "footprints-visits-request-in-progress",
    "footprints-visits-audit-write-failed",
    "footprints-visits-receipt-write-failed",
    "footprints-visits-write-failed",
    "footprints-visits-stored-invalid",
    "core-unavailable",
    "core-timeout",
    "something-nobody-declared",
  ]) {
    assert.equal(footprintVisitsShouldRetainMutation(uncertain), true, `should retain: ${uncertain}`);
  }
  for (const terminal of [
    "footprints-visits-conflict",
    "footprints-visits-request-id-conflict",
    "footprints-visits-value-invalid",
    "footprints-visits-reason-invalid",
    "footprints-visits-revision-invalid",
    "footprints-visits-edit-required",
    "admin-revoked",
    "bad-origin",
  ]) {
    assert.equal(footprintVisitsShouldRetainMutation(terminal), false, `should release: ${terminal}`);
  }

  // A conflict is a 409 with data, which the plain error decoder must still read.
  assert.equal(
    footprintVisitsError(errorEnvelope("footprints-visits-conflict", 409, { current: state() })),
    "footprints-visits-conflict",
  );
  // The same-origin bridge vocabulary is understood without becoming a Core alias.
  assert.equal(footprintVisitsError({ success: false, status_code: 401, error: "auth-required" }), "auth-required");
});

test("the panel, proxy, locales and Help share one dormant cutover", async () => {
  const [page, panel, bridge, actions, readiness, help, enRaw, huRaw] = await Promise.all([
    readFile(new URL("../app/(dashboard)/footprints/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/FootprintsVisitsPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/adminActions.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/contractReadiness.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/adminHelp.ts", import.meta.url), "utf8"),
    readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
    readFile(new URL("../messages/hu.json", import.meta.url), "utf8"),
  ]);

  // The panel does not render at all while the local switch is false.
  assert.match(page, /\{FOOTPRINTS_VISITS_CONTRACT_READY \? <FootprintsVisitsPanel \/> : null\}/);
  assert.match(readiness, /export const FOOTPRINTS_VISITS_CONTRACT_READY: boolean = false;/);
  assert.match(actions, /ACTIVE_FOOTPRINT_VISITS_ACTIONS/);

  assert.match(bridge, /footprintVisitsProxyCapabilityAuthorized/);
  assert.match(bridge, /normalizeFootprintVisitsProxyBody/);
  assert.match(bridge, /isAdminBridgeActionAuthorized\([\s\S]+footprintVisitsAuthorized/);

  // Durable identity before the first request, and no second logical command.
  assert.match(panel, /footprintVisitsPersistBeforeMutation\([\s\S]+adminCall\(command!\.action/);
  assert.match(panel, /window\.sessionStorage/);
  assert.match(panel, /adminCall\(existing\.action, existing\.payload\)/);
  assert.doesNotMatch(panel, /dangerouslySetInnerHTML|localStorage|console\.(?:log|info|warn|error)/);
  // A failed read must never render as a proven "off".
  assert.match(panel, /setCurrent\(null\);\n\s+setState\("error"\)/);

  // The badge half of the page is untouched by this contract.
  assert.match(page, /save_footprint_settings/);
  assert.doesNotMatch(panel, /save_footprint_settings|footprints_admin|footprint_reports/);

  const en = JSON.parse(enRaw);
  const hu = JSON.parse(huRaw);
  assert.deepEqual(Object.keys(en.footprintVisits).sort(), Object.keys(hu.footprintVisits).sort());
  assert.deepEqual(Object.keys(en.footprintVisits.live).sort(), Object.keys(hu.footprintVisits.live).sort());
  assert.deepEqual(Object.keys(en.footprintVisits.errors).sort(), Object.keys(hu.footprintVisits.errors).sort());

  // Contextual Help exists in both locales and says what the switch does not cover.
  assert.match(help, /route: "\/footprints"/);
  assert.ok(Object.keys(en.adminHelp.pages.footprints.sections).includes("visits"));
  assert.deepEqual(
    Object.keys(en.adminHelp.pages.footprints.sections).sort(),
    Object.keys(hu.adminHelp.pages.footprints.sections).sort(),
  );
  assert.match(en.adminHelp.pages.footprints.sections.visits.guidance, /photo likes/);
  assert.match(en.adminHelp.pages.footprints.sections.visits.guidance, /share one revision/);
  // The panel copy has to make the scope unmissable before anyone flips it.
  assert.match(en.footprintVisits.scopeNote, /profile visits only/);
  assert.match(en.footprintVisits.consequenceOff, /never reconstructed/);
});

test("a saved command survives an unknown outcome and replays the same identity", () => {
  const first = footprintVisitsPendingMutation(FOOTPRINT_VISITS_TARGET, setBody())!;
  const restored = footprintVisitsPendingFrom(JSON.parse(JSON.stringify(first)))!;
  // Same UUID, same revision, same value, same reason after a reload.
  assert.deepEqual(restored.payload, first.payload);
  assert.equal(restored.payload.request_id, UUID);

  // A different UUID is a different logical command, not a retry.
  const second = footprintVisitsPendingMutation(FOOTPRINT_VISITS_TARGET, setBody({ request_id: OTHER_UUID }))!;
  assert.notEqual(second.payload.request_id, first.payload.request_id);

  // The replayed result of the original command still converges.
  assert.equal(footprintVisitsMutationConverged(restored, {
    visits_enabled: false, revision: 5, updated_at: 1, updated_by: "a@b.c",
    no_change: false, replayed: true,
  }), true);
});
