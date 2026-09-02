import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { FeatureSwitchesCardGrid } from "../components/FeatureSwitchesPanel.tsx";
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
const FIXTURE_DIRECTORY = new URL("./fixtures/feature_switches_wire/", import.meta.url);
const RENDER_MESSAGES = {
  en: JSON.parse(readFileSync(new URL("../messages/en.json", import.meta.url), "utf8")),
  hu: JSON.parse(readFileSync(new URL("../messages/hu.json", import.meta.url), "utf8")),
};

// Copied byte-identically from the lead-accepted Core tip. Body identity is
// pinned separately so provenance-only manifest moves cannot be mistaken for
// changes to the 50 released wire blobs.
const FIXTURE_ACCEPTED_CORE_TIP = "73894b68386f5d57b0a091fcb87bc0dff490f548";
const FIXTURE_SOURCE_COMMIT = "229b7891567ab6697e552180b7d324f1f02c1ef5";
const FIXTURE_CONTRACT_MANIFEST_SHA256 = "c854019e6be2046ad81af294719774beca04346d5f078b746daba313a787f083";
const FIXTURE_GENERATOR_SHA256 = "7d4588c7336808f90f778c837ca15b61268594641709f489180a7b1d6a9f913f";
const FIXTURE_SET_SHA256 = "f8af93a1dee24a7c83cfd8deb03757bead16d0c2fd13494a73dbfc778db1fd8b";
const FIXTURE_MANIFEST_SHA256 = "28a1d34a701557cba55c603b3abea06284048b7bc8236cdac6a7be399940a0dd";
const FIXTURE_BODY_COUNT = 50;

const FIXTURE_BODY_FILES = [
  "admin_me-dormant-owner.json",
  "admin_me-ready-admin.json",
  "admin_me-ready-owner.json",
  "admin_me-ready-viewer.json",
  "admin_me-revoked.json",
  "appconfig-hey-off-footprints-off-likes-off.json",
  "appconfig-hey-off-footprints-off-likes-on.json",
  "appconfig-hey-off-footprints-on-likes-off.json",
  "appconfig-hey-off-footprints-on-likes-on.json",
  "appconfig-hey-on-footprints-off-likes-off.json",
  "appconfig-hey-on-footprints-off-likes-on.json",
  "appconfig-hey-on-footprints-on-likes-off.json",
  "appconfig-hey-on-footprints-on-likes-on.json",
  "error-admin-revoked.json",
  "error-admin-session-invalid.json",
  "error-feature-switches-audit-write-failed.json",
  "error-feature-switches-contract-version-invalid.json",
  "error-feature-switches-contract-version-required.json",
  "error-feature-switches-edit-required.json",
  "error-feature-switches-read-failed.json",
  "error-feature-switches-read-required.json",
  "error-feature-switches-reason-invalid.json",
  "error-feature-switches-receipt-write-failed.json",
  "error-feature-switches-request-id-conflict.json",
  "error-feature-switches-request-id-invalid.json",
  "error-feature-switches-request-in-progress.json",
  "error-feature-switches-request-invalid.json",
  "error-feature-switches-revision-invalid.json",
  "error-feature-switches-schema-unavailable.json",
  "error-feature-switches-stored-invalid.json",
  "error-feature-switches-switch-invalid.json",
  "error-feature-switches-value-invalid.json",
  "error-feature-switches-write-failed.json",
  "error-unauthorized.json",
  "get-never-set.json",
  "member-footprint-disabled.json",
  "member-hey-disabled.json",
  "member-likes-disabled-feed.json",
  "member-likes-disabled-write.json",
  "push-footprint-en.json",
  "push-footprint-hu.json",
  "push-hey-en.json",
  "push-hey-hu.json",
  "push-mutual-hey-none.json",
  "set-conflict.json",
  "set-footprints-off.json",
  "set-hey-off.json",
  "set-likes-off.json",
  "set-no-change.json",
  "set-replayed.json",
] as const;

const FIXTURE_SOURCE_PATHS = [
  "config/routes.php",
  "src/Core/Response.php",
  "src/Http/Controllers/AppController.php",
  "src/Http/Controllers/FootprintController.php",
  "src/Http/Controllers/PingerController.php",
  "src/Http/Controllers/ProfileMediaController.php",
  "src/Http/Controllers/RelationController.php",
  "src/Http/Controllers/WebadminController.php",
  "src/Http/Controllers/WebadminFeatureSwitchesController.php",
  "src/Services/FeatureSwitchesAdminException.php",
  "src/Services/FeatureSwitchesAdminService.php",
  "src/Services/FeatureSwitchesReadinessService.php",
  "src/Services/FeatureSwitchesService.php",
  "src/Services/FootprintService.php",
  "src/Services/ProfileVisitDeferralService.php",
  "src/Services/SocketNotifyService.php",
  "src/Support/FeatureSwitchesAdminPolicy.php",
  "src/Support/Webadmin.php",
] as const;

type Json = Record<string, any>;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function fixtureManifest(): Promise<Json> {
  return JSON.parse(await readFile(new URL("manifest.json", FIXTURE_DIRECTORY), "utf8"));
}

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
    likes: switchState(true),
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
    likes_enabled: true,
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
    likes: { enabled: true, updated_at: 1, updated_by: "a@b.c" },
    revision: 4,
    ...overrides,
  };
}

function renderCards(current: FeatureSwitchesState, locale: "en" | "hu"): string {
  return renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale, messages: RENDER_MESSAGES[locale], timeZone: "UTC" },
    createElement(FeatureSwitchesCardGrid, {
      current,
      canEdit: true,
      reasons: { hey: "owner decided", footprints: "owner decided", likes: "owner decided" },
      pending: null,
      busy: false,
      onReasonChange() {},
      onSubmit() {},
    }),
  ));
}

function renderedCard(markup: string, selectedSwitch: FeatureSwitch): string {
  const marker = `data-feature-switch="${selectedSwitch}"`;
  const markerIndex = markup.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${selectedSwitch} card is missing`);
  const start = markup.lastIndexOf("<article", markerIndex);
  const end = markup.indexOf("</article>", markerIndex);
  assert.ok(start >= 0 && end > start, `${selectedSwitch} card is incomplete`);
  return markup.slice(start, end + "</article>".length);
}

test("the released Core corpus is manifest-bound with body identity kept separate", async () => {
  const manifestWire = await readFile(new URL("manifest.json", FIXTURE_DIRECTORY), "utf8");
  assert.equal(sha256(manifestWire), FIXTURE_MANIFEST_SHA256);
  const manifest = JSON.parse(manifestWire) as Json;
  assert.deepEqual(Object.keys(manifest).sort(), [
    "app_contract_version",
    "contract_manifest_sha256",
    "contract_version",
    "fixture_set_sha256",
    "fixtures",
    "provenance",
    "schema_version",
    "source_commit",
  ]);
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.contract_version, 1);
  assert.equal(manifest.app_contract_version, 2);
  assert.equal(manifest.source_commit, FIXTURE_SOURCE_COMMIT);
  assert.equal(manifest.contract_manifest_sha256, FIXTURE_CONTRACT_MANIFEST_SHA256);
  assert.equal(manifest.fixture_set_sha256, FIXTURE_SET_SHA256);

  const provenance = manifest.provenance;
  assert.deepEqual(Object.keys(provenance).sort(), [
    "cache_policy",
    "evaluated_at",
    "generator",
    "generator_sha256",
    "source_paths",
    "wire_adapters",
  ]);
  assert.equal(provenance.generator, "tests/feature_switches_fixture_dump.php");
  assert.equal(provenance.generator_sha256, FIXTURE_GENERATOR_SHA256);
  assert.equal(provenance.evaluated_at, 1_787_800_000);
  assert.deepEqual(provenance.source_paths, FIXTURE_SOURCE_PATHS);
  assert.deepEqual(provenance.wire_adapters, {
    admin_me: "Friending\\Support\\Webadmin::reply",
    versioned_actions: "Friending\\Support\\Webadmin::noStoreReply",
    member_routes: "Friending\\Core\\Response::wirePayload",
  });
  assert.deepEqual(provenance.cache_policy, {
    admin_me: "pre-version-route-default",
    versioned_actions: "no-store",
    member_routes: "route-default",
  });

  assert.ok(Array.isArray(manifest.fixtures));
  assert.equal(FIXTURE_BODY_FILES.length, FIXTURE_BODY_COUNT);
  assert.equal(manifest.fixtures.length, FIXTURE_BODY_COUNT);
  assert.deepEqual(
    manifest.fixtures.map((row: Json) => row.file),
    [...FIXTURE_BODY_FILES],
  );
  const inventory = (await readdir(FIXTURE_DIRECTORY)).sort();
  assert.deepEqual(
    inventory.filter((file) => file !== "manifest.json"),
    [...FIXTURE_BODY_FILES].sort(),
  );
  assert.deepEqual(inventory.filter((file) => file === "manifest.json"), ["manifest.json"]);

  const seenFiles = new Set<string>();
  const seenCases = new Set<string>();
  const consumerCounts = new Map<string, number>();
  const aggregateRows: string[] = [];
  for (const row of manifest.fixtures as Json[]) {
    assert.deepEqual(Object.keys(row).sort(), ["case", "consumer", "file", "route", "sha256", "valid"]);
    assert.equal(typeof row.file, "string");
    assert.match(row.file, /^[a-z0-9_-]+\.json$/u);
    assert.equal(typeof row.case, "string");
    assert.equal(row.case.length > 0 && row.case === row.case.trim(), true);
    assert.ok(["webadmin", "ios", "push"].includes(row.consumer));
    assert.equal(typeof row.valid, "boolean");
    assert.equal(row.valid, row.consumer !== "push");
    assert.match(row.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(seenFiles.has(row.file), false, `duplicate fixture file ${row.file}`);
    assert.equal(seenCases.has(row.case), false, `duplicate fixture case ${row.case}`);
    seenFiles.add(row.file);
    seenCases.add(row.case);
    consumerCounts.set(row.consumer, (consumerCounts.get(row.consumer) ?? 0) + 1);

    if (row.consumer === "webadmin") {
      assert.match(row.route, /^\/v1\/webadmin\/(?:admin_me|feature_switches_(?:get|set))$/u);
    } else if (row.consumer === "ios") {
      assert.ok([
        "/v1/app/ios_appconfig",
        "/v1/footprints/photo-likes",
        "/v1/footprints/send",
        "/v1/iosuser/like",
        "/v1/profile/photos/like",
      ].includes(row.route));
    } else {
      assert.ok(["push://footprint", "push://new_hey"].includes(row.route));
    }

    const wire = await readFile(new URL(row.file, FIXTURE_DIRECTORY), "utf8");
    assert.equal(sha256(wire), row.sha256, `${row.file} must match its released byte hash`);
    assert.doesNotThrow(() => JSON.parse(wire), `${row.file} must remain JSON`);
    aggregateRows.push(`${row.file}\0${row.sha256}`);
  }
  assert.deepEqual(
    Object.fromEntries([...consumerCounts].sort(([left], [right]) => left.localeCompare(right))),
    { ios: 12, push: 5, webadmin: 33 },
  );
  assert.equal(sha256(aggregateRows.join("\n")), FIXTURE_SET_SHA256);
  assert.match(FIXTURE_ACCEPTED_CORE_TIP, /^[0-9a-f]{40}$/);
  assert.notEqual(FIXTURE_ACCEPTED_CORE_TIP, FIXTURE_SOURCE_COMMIT, "the accepted provenance tip follows its source commit");
});

test("every released corpus body is run through the production Webadmin decoders", async () => {
  const manifest = await fixtureManifest();
  for (const row of manifest.fixtures as Json[]) {
    const body = JSON.parse(await readFile(new URL(row.file, FIXTURE_DIRECTORY), "utf8")) as Json;
    const decoders = {
      admin_me: featureSwitchesAdminMe(body.feature_switches),
      state: featureSwitchesStateResponse(body),
      mutation: featureSwitchesMutationResponse(body),
      conflict: featureSwitchesConflictResponse(body),
      error: featureSwitchesError(body),
    };
    const accepted = Object.entries(decoders)
      .filter(([, value]) => value !== null)
      .map(([name]) => name);

    if (row.consumer !== "webadmin") {
      assert.deepEqual(accepted, [], `${row.file} must not enter a Webadmin decoder`);
      continue;
    }

    let expected: keyof typeof decoders;
    if (row.route === "/v1/webadmin/admin_me") {
      expected = body.success === true ? "admin_me" : "error";
    } else if (row.route === "/v1/webadmin/feature_switches_get") {
      expected = "state";
    } else if (body.success === true) {
      expected = "mutation";
    } else if (body.error === "feature-switches-conflict") {
      expected = "conflict";
    } else {
      expected = "error";
    }
    assert.deepEqual(accepted, [expected], `${row.file} must satisfy exactly its production decoder`);
  }
});

test("the dormant family vocabulary and conditional proxy surface are exact", () => {
  assert.deepEqual([...FEATURE_SWITCHES], ["hey", "footprints", "likes"]);
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

test("admin_me requires known fields, is capability-authored, action-ordered, and readiness-gated", () => {
  const owner = featureSwitchesAdminMe(adminMeBlock("owner", true));
  assert.deepEqual(owner?.actions, ["feature_switches_get", "feature_switches_set"]);
  assert.equal(owner?.hey_enabled, true);
  assert.equal(owner?.footprints_enabled, false);
  assert.equal(owner?.likes_enabled, true);

  const legacyOwnerWire = adminMeBlock("owner", true);
  delete legacyOwnerWire.likes_enabled;
  const legacyOwner = featureSwitchesAdminMe(legacyOwnerWire);
  assert.equal(legacyOwner?.likes_enabled, null, "a pre-T-659 Core remains readable");

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
  assert.deepEqual(
    featureSwitchesAdminMe({ ...adminMeBlock("owner", true), extra: 1 }),
    featureSwitchesAdminMe(adminMeBlock("owner", true)),
  );
  assert.equal(featureSwitchesAdminMe(adminMeBlock("owner", true, { hey_enabled: "true" })), null);
  assert.equal(featureSwitchesAdminMe(adminMeBlock("owner", true, { likes_enabled: "true" })), null);
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

test("state decoding ignores additive fields, stays versioned, and keeps provenance all-or-nothing", () => {
  assert.deepEqual(featureSwitchesStateResponse(envelope(state())), state());
  const legacyWire = state();
  delete legacyWire.likes;
  assert.deepEqual(featureSwitchesStateResponse(envelope(legacyWire)), {
    ...legacyWire,
    likes: null,
  }, "a pre-T-659 Core decodes with Likes explicitly unavailable");
  const neverSet = state({
    hey: switchState(true, { updated_at: 0, updated_by: "" }),
    footprints: switchState(true, { updated_at: 0, updated_by: "" }),
    likes: switchState(true, { updated_at: 0, updated_by: "" }),
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
  assert.equal(featureSwitchesStateResponse(envelope(state({
    likes: switchState(true, { enabled: "true" }),
  }))), null, "a served known switch keeps strict value validation");
  assert.equal(featureSwitchesStateResponse(envelope(state({ contract_version: 2 }))), null);
  assert.equal(featureSwitchesStateResponse(envelope(state({ revision: 1.5 }))), null);
  const additive = state();
  Object.assign(additive, { extra: true });
  Object.assign(additive.hey, { future_provenance: true });
  Object.assign(additive.likes, { future_provenance: true });
  assert.deepEqual(featureSwitchesStateResponse(envelope(additive)), featureSwitchesStateResponse(envelope(state())));
  assert.equal(featureSwitchesStateResponse(envelope({
    contract_version: 1,
    hey_enabled: true,
    footprints_enabled: false,
    likes_enabled: true,
    revision: 4,
  })), null, "the pre-provider flattened lookalike must fail closed");
  assert.equal(featureSwitchesStateResponse(envelope(state(), { can_send: 1 })), null);
  assert.equal(featureSwitchesStateResponse({ data: state() }), null);
});

test("the Feature switches panel renders Photo likes when served and disables it for a pre-T-659 Core", () => {
  const servedMarkup = renderCards(parsedState(), "en");
  assert.equal(servedMarkup.match(/data-feature-switch=/gu)?.length, 3);
  const servedLikes = renderedCard(servedMarkup, "likes");
  assert.match(servedLikes, /data-served="true"/u);
  assert.match(servedLikes, />Photo likes</u);
  assert.match(servedLikes, /photos cannot be liked and the like counter disappears/u);
  assert.match(servedLikes, />Turn photo likes off</u);
  assert.doesNotMatch(servedLikes, /<button[^>]*disabled/u);

  const hungarianLikes = renderedCard(renderCards(parsedState(), "hu"), "likes");
  assert.match(hungarianLikes, />Fotó-kedvelés \(like\)</u);
  assert.match(
    hungarianLikes,
    /Ha ki van kapcsolva, a fotók nem kedvelhetők és a kedvelés-számláló eltűnik; a Látogatók lista mindig elérhető\./u,
  );

  const legacyMarkup = renderCards(parsedState({ likes: null }), "en");
  const unavailableLikes = renderedCard(legacyMarkup, "likes");
  assert.match(unavailableLikes, /data-served="false"/u);
  assert.match(unavailableLikes, /Not served by Core/u);
  assert.match(unavailableLikes, /<input[^>]*disabled/u);
  assert.match(unavailableLikes, /<button[^>]*disabled[^>]*>Not served by Core<\/button>/u);
  assert.match(renderedCard(legacyMarkup, "hey"), /data-served="true"/u);
  assert.match(renderedCard(legacyMarkup, "footprints"), /data-served="true"/u);
});

test("mutation and conflict decoders accept complete authoritative known state", () => {
  const mutation = featureSwitchesMutationResponse(envelope({
    ...state({ footprints: switchState(false), revision: 5 }),
    no_change: false,
    replayed: false,
  }));
  assert.equal(mutation?.footprints.enabled, false);
  assert.equal(mutation?.likes?.enabled, true);
  assert.equal(mutation?.revision, 5);
  assert.equal(mutation?.no_change, false);
  assert.equal(mutation?.replayed, false);

  const likesMutation = featureSwitchesMutationResponse(envelope({
    ...state({ likes: switchState(false), revision: 5 }),
    no_change: false,
    replayed: false,
  }));
  assert.equal(likesMutation?.likes?.enabled, false);

  const legacyMutationState = state({ footprints: switchState(false), revision: 5 });
  delete legacyMutationState.likes;
  const legacyMutation = featureSwitchesMutationResponse(envelope({
    ...legacyMutationState,
    no_change: false,
    replayed: false,
  }));
  assert.equal(legacyMutation?.likes, null, "pre-T-659 mutation replies remain readable");

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
  assert.equal(conflict?.current.likes?.enabled, true);

  assert.equal(featureSwitchesConflictResponse(errorEnvelope("feature-switches-conflict", 409, {})), null);
  assert.deepEqual(
    featureSwitchesConflictResponse(errorEnvelope("feature-switches-conflict", 409, {
      current: { ...state(), extra: true },
    })),
    featureSwitchesConflictResponse(errorEnvelope("feature-switches-conflict", 409, { current: state() })),
  );
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

test("proxy bodies serialize one exact switch command and reject loose or caller-owned material", () => {
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
  assert.equal(
    normalizeFeatureSwitchesProxyBody("feature_switches_set", setBody("likes"))?.switch,
    "likes",
  );
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

  const likesPending = featureSwitchesPendingMutation(
    featureSwitchesTarget("likes"),
    setBody("likes"),
  )!;
  assert.equal(likesPending.target, "feature_switches:v1:likes");
  assert.equal(featureSwitchesMutationConverged(likesPending, {
    ...parsedState({ likes: { enabled: false, updated_at: 2, updated_by: "likes@friending.com" }, revision: 5 }),
    no_change: false,
    replayed: false,
  }), true);
  assert.equal(featureSwitchesStateConverged(likesPending, parsedState({ likes: null, revision: 5 })), false);
  assert.equal(featureSwitchesValue(parsedState({ likes: null }), "likes"), null);
  assert.equal(featureSwitchesProvenance(parsedState({ likes: null }), "likes"), null);
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
  assert.match(bridge, /adminBridgeCoreTransportError\(result\.status, result\.data\)/);
  assert.match(bridge, /bridgeError\(transportError\.error, transportError\.status_code\)/);
  assert.match(bridge, /isAdminBridgeActionAuthorized\([\s\S]+featureSwitchesAuthorized/);

  assert.match(panel, /featureSwitchesPersistBeforeMutation\([\s\S]+adminCall\(command!\.action/);
  assert.match(panel, /adminCall\(existing\.action, existing\.payload\)/);
  assert.match(panel, /export function FeatureSwitchesCardGrid/);
  assert.match(panel, /featureSwitchesStateConverged\(candidate, parsed\)/);
  assert.match(panel, /await load\(\)/);
  assert.match(panel, /setLoadFailure\(error \? featureSwitchesErrorKey\(error\) : null\)/);
  assert.match(panel, /loadFailure \? t\(`errors\.\$\{loadFailure\}`\) : t\("live\.unknownError"\)/);
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
  for (const selectedSwitch of FEATURE_SWITCHES) {
    assert.deepEqual(
      Object.keys(en.featureSwitches.switches[selectedSwitch]).sort(),
      Object.keys(hu.featureSwitches.switches[selectedSwitch]).sort(),
    );
  }

  assert.match(help, /route: "\/configuration"/);
  assert.match(help, /"featureSwitches"/);
  assert.match(help, /route: "\/footprints"/);
  assert.match(help, /"featureSwitchesPointer"/);
  assert.match(en.adminHelp.pages.configuration.sections.featureSwitches.guidance, /Photo likes off/);
  assert.match(en.adminHelp.pages.configuration.sections.featureSwitches.guidance, /Visitors is always available/);
  assert.match(en.adminHelp.pages.configuration.sections.featureSwitches.guidance, /one family revision/);
  assert.match(en.adminHelp.pages.footprints.sections.featureSwitchesPointer.guidance, /Configuration/);
  assert.match(en.adminHelp.pages.footprints.sections.featureSwitchesPointer.guidance, /Visitors list remain available/);
  assert.match(en.featureSwitches.switches.footprints.consequenceOff, /Visitors list remain available/);
  assert.match(en.featureSwitches.switches.footprints.consequenceOff, /Photo likes follow their own switch/);
  assert.equal(en.featureSwitches.switches.likes.title, "Photo likes");
  assert.equal(hu.featureSwitches.switches.likes.title, "Fotó-kedvelés (like)");
  assert.equal(
    hu.featureSwitches.switches.likes.summary,
    "Ha ki van kapcsolva, a fotók nem kedvelhetők és a kedvelés-számláló eltűnik; a Látogatók lista mindig elérhető.",
  );
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
