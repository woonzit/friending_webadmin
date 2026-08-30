import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import {
  FORCED_BRIDGE_REFUSAL_STATUSES,
  FORCED_BRIDGE_UNCERTAIN_STATUSES,
  FORCED_CORE_REFUSAL_STATUSES,
  FORCED_CORE_UNCERTAIN_STATUSES,
  FORCED_VERIFICATION_ACTIONS,
  WAITING_ROOM_COMPILED_COPY,
  decodeForcedConsoleResponse,
  decodeForcedImpactResponse,
  decodeForcedSaveResponse,
  forcedMethodList,
  forcedVerificationAccess,
  forcedVerificationDocumentFromDraft,
  forcedVerificationDocumentsEqual,
  forcedVerificationDraft,
  forcedVerificationProxyCapabilityAuthorized,
  normalizeForcedVerificationProxyBody,
  parseForcedVerificationAdminMe,
  resolveForcedMethods,
  resolveWaitingRoomCopy,
} from "../lib/forcedVerification.ts";
import { verificationAdminMe } from "../lib/verificationAdmin.ts";

/**
 * T-470's production-generated wire corpus (released Core tip
 * `3fcde8bd929a4ba0f71dc33d9fd501e8eb97ce92`, `tests/fixtures/verification_forced_wire/`),
 * copied byte-identically. The production decoders must accept every Webadmin body exactly as
 * Core publishes it and classify every refusal by the manifest's closed status maps.
 */
const FIXTURE_DIRECTORY = new URL("./fixtures/verification_forced_wire/", import.meta.url);
// T-484: re-pinned to the released Core tip that advertises the Verification console (T-483, D-060;
// behaviour commit ba639d4…). Two of the 36 bodies move — `webadmin-admin-me-{admin,viewer}` now carry
// `verification.contract_ready: true` and the role's action list — so the fixture-set and manifest hashes
// move with them. Every other body, the generator, the status maps and the 129 exempt / 35 public route
// table are unchanged; a leaf-level diff of both files showed no change outside `contract_ready`/`actions`.
const FIXTURE_CONTRACT = "forced-verification-waiting-room-v1.5";
const FIXTURE_SOURCE_COMMIT = "ba639d4d28edd104222fadc8d9da44500bbbe280";
const FIXTURE_SET_SHA256 = "59e521560ecdd90a6efd836a9ebe055aee4dc731b2b4ddb4ee3d058552792c0e";
const FIXTURE_GENERATOR_SHA256 = "c3961b1731aee55f3f7dcb94d87da24839f2033fa9a8a669520a6ef1a586e055";
const FIXTURE_MANIFEST_SHA256 = "b0251c8dc726db2ca4ce4207a2ae8c53ead183256d7884e52bcd6c26987bf42d";
const FIXTURE_COMPATIBILITY_SHA256 = "6ea71b641912153c5c0e6368dd426d7e44ef84a212395a1672139ca8d9681705";
const FIXTURE_BODY_COUNT = 36;

const WEBADMIN_REFUSAL_FILES: ReadonlyArray<[string, string, number]> = [
  ["webadmin-refusal-admin-revoked.json", "admin-revoked", 403],
  ["webadmin-refusal-admin-session-invalid.json", "admin-session-invalid", 401],
  ["webadmin-refusal-admin-write-required.json", "admin-write-required", 403],
  ["webadmin-refusal-unauthorized.json", "unauthorized", 401],
  ["webadmin-refusal-verification-forced-conflict.json", "verification-forced-conflict", 409],
  ["webadmin-refusal-verification-forced-copy-default-invalid.json", "verification-forced-copy-default-invalid", 422],
  ["webadmin-refusal-verification-forced-copy-overrides-invalid.json", "verification-forced-copy-overrides-invalid", 422],
  ["webadmin-refusal-verification-forced-default-invalid.json", "verification-forced-default-invalid", 422],
  ["webadmin-refusal-verification-forced-invalid.json", "verification-forced-invalid", 422],
  ["webadmin-refusal-verification-forced-overrides-invalid.json", "verification-forced-overrides-invalid", 422],
  ["webadmin-refusal-verification-forced-revision-invalid.json", "verification-forced-revision-invalid", 422],
  ["webadmin-refusal-verification-forced-unavailable.json", "verification-forced-unavailable", 503],
  ["webadmin-refusal-verification-forced-write-failed.json", "verification-forced-write-failed", 503],
];

type Json = Record<string, any>;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fixtureManifest(): Promise<Json> {
  return JSON.parse(await readFile(new URL("manifest.json", FIXTURE_DIRECTORY), "utf8"));
}

async function fixture(file: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(file, FIXTURE_DIRECTORY), "utf8"));
}

test("the published forced-verification corpus is byte-identical, complete, and traceable to the Core source commit", async () => {
  const manifestBytes = await readFile(new URL("manifest.json", FIXTURE_DIRECTORY));
  assert.equal(sha256(manifestBytes), FIXTURE_MANIFEST_SHA256, "manifest.json must match its published byte hash");
  const manifest = await fixtureManifest();
  assert.deepEqual(Object.keys(manifest).sort(), [
    "boundary_error_statuses",
    "compatibility_verification_sha256",
    "contract",
    "control_plane_error_statuses",
    "fixture_set_sha256",
    "fixtures",
    "member_error_statuses",
    "provenance",
    "route_tags",
    "schema_version",
    "source_commit",
  ]);
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.contract, FIXTURE_CONTRACT);
  assert.equal(manifest.source_commit, FIXTURE_SOURCE_COMMIT);
  assert.equal(manifest.fixture_set_sha256, FIXTURE_SET_SHA256);
  assert.deepEqual(Object.keys(manifest.provenance).sort(), [
    "evaluated_at", "generator", "generator_sha256", "ios_wire_adapter", "member_shaper", "source_paths", "webadmin_wire_adapter",
  ]);
  assert.equal(manifest.provenance.generator, "tests/forced_verification_fixture_dump.php");
  assert.equal(manifest.provenance.generator_sha256, FIXTURE_GENERATOR_SHA256);
  assert.equal(manifest.provenance.webadmin_wire_adapter, "Friending\\Support\\Webadmin::noStoreReply");
  assert.equal(manifest.provenance.ios_wire_adapter, "Friending\\Core\\Response::wirePayload");
  assert.ok(Array.isArray(manifest.provenance.source_paths) && manifest.provenance.source_paths.length === 38);
  assert.ok(manifest.provenance.source_paths.includes("src/Http/Controllers/ForcedVerificationAdminController.php"));
  assert.ok(manifest.provenance.source_paths.includes("src/Support/ForcedVerificationAdminPolicy.php"));
  assert.deepEqual(manifest.compatibility_verification_sha256, {
    "get-own-profile-data": FIXTURE_COMPATIBILITY_SHA256,
    "get-user-own": FIXTURE_COMPATIBILITY_SHA256,
    "get-user-profile": FIXTURE_COMPATIBILITY_SHA256,
  }, "the legacy data.verification block stays byte-identical on all three own reads (Amendment v1.3)");
  assert.ok(Array.isArray(manifest.route_tags.forced_gate_exempt) && manifest.route_tags.forced_gate_exempt.length > 0);
  for (const route of ["POST /v1/app/ios_appconfig", "POST /v1/iosuser/get_user_own", "POST /v1/iosuser/get_own_profile_data", "POST /v1/iosuser/get_user_profile"]) {
    assert.ok(manifest.route_tags.forced_gate_exempt.includes(route), `${route} is exempt`);
  }

  const rows = manifest.fixtures as Json[];
  assert.equal(rows.length, FIXTURE_BODY_COUNT);
  const files = rows.map((row) => row.file as string);
  assert.deepEqual(files, [...files].sort(), "the manifest lists fixtures in sorted order");
  assert.equal(new Set(files).size, files.length);
  const inventory = (await readdir(FIXTURE_DIRECTORY)).sort();
  assert.deepEqual(inventory, [...files, "manifest.json"].sort());

  const consumerCounts = new Map<string, number>();
  const aggregateRows: string[] = [];
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).filter((key) => key !== "compatibility_group").sort(), ["case", "consumer", "file", "http_status", "kind", "route", "sha256"]);
    assert.match(row.file, /^[a-z0-9-]+\.json$/u);
    assert.ok(["webadmin", "ios"].includes(row.consumer), row.file);
    if (row.consumer === "webadmin") {
      assert.match(row.route, /^\/v1\/webadmin\/(?:admin_me|verification_forced_(?:console|save|impact_preview))$/u);
      assert.equal(row.http_status, 200, "Webadmin control-plane answers ride on HTTP 200 (legacy envelope)");
    } else {
      assert.ok(["/v1/iosuser/verification_gate", "/v1/iosuser/get_user_own", "/v1/iosuser/get_own_profile_data", "/v1/iosuser/get_user_profile", "/v1/people/list"].includes(row.route), row.route);
    }
    const wire = await readFile(new URL(row.file, FIXTURE_DIRECTORY));
    assert.equal(sha256(wire), row.sha256, `${row.file} must match its published byte hash`);
    assert.doesNotThrow(() => JSON.parse(wire.toString("utf8")));
    consumerCounts.set(row.consumer, (consumerCounts.get(row.consumer) ?? 0) + 1);
    aggregateRows.push(`${row.file}\0${row.sha256}`);
  }
  assert.deepEqual(Object.fromEntries([...consumerCounts].sort()), { ios: 18, webadmin: 18 });
  assert.equal(sha256(aggregateRows.join("\n")), FIXTURE_SET_SHA256, "the fixture-set hash is the sha256 over `file\\0sha256` rows");
});

test("the production refusal maps equal Core's published control-plane and boundary maps exactly", async () => {
  const manifest = await fixtureManifest();
  const published = { ...manifest.control_plane_error_statuses, ...manifest.boundary_error_statuses } as Record<string, number>;
  assert.equal(Object.keys(manifest.control_plane_error_statuses).length, 12);
  assert.deepEqual(manifest.boundary_error_statuses, { unauthorized: 401 });
  assert.deepEqual(manifest.member_error_statuses, { "verification-forced-waiting-room": 403 }, "the member refusal is the app's, never the console's");
  const local = new Map<string, number>([...FORCED_CORE_REFUSAL_STATUSES, ...FORCED_CORE_UNCERTAIN_STATUSES]);
  assert.equal(local.size, FORCED_CORE_REFUSAL_STATUSES.size + FORCED_CORE_UNCERTAIN_STATUSES.size, "no name is both refused and uncertain");
  assert.deepEqual(
    [...local].sort(([left], [right]) => left.localeCompare(right)),
    Object.entries(published).sort(([left], [right]) => left.localeCompare(right)),
  );
  // Only the 503 family is uncertain; everything else Core publishes proves a no-land.
  for (const [error, status] of Object.entries(published)) {
    assert.equal(FORCED_CORE_UNCERTAIN_STATUSES.has(error), status === 503, error);
  }
  assert.equal(local.has("verification-forced-waiting-room"), false, "the member refusal never reaches the console maps");
  // The bridge vocabulary is the console's own and never overlaps Core's, except the shared editor gate.
  const overlap = [...FORCED_BRIDGE_REFUSAL_STATUSES.keys(), ...FORCED_BRIDGE_UNCERTAIN_STATUSES.keys()].filter((name) => local.has(name));
  assert.deepEqual(overlap, ["admin-write-required"]);
});

test("every published Webadmin body decodes through the production decoders with target binding", async () => {
  const consoleBody = decodeForcedConsoleResponse(await fixture("webadmin-console.json"));
  assert.ok(consoleBody.ok, "console");
  const console_ = consoleBody.value;
  assert.equal(console_.revision, 7);
  assert.equal(console_.storefront_catalogue_hint, "alpha-3");
  assert.deepEqual(console_.document.default, { persona: true, video: false });
  assert.deepEqual(Object.keys(console_.document.overrides), ["DEU", "HUN", "USA"], "storefront keys arrive and stay sorted");
  assert.deepEqual(console_.document.overrides.DEU, { persona: false, video: false }, "an empty replacement disables the global rule");
  // v1.5 corpus: the console scenario carries a saved help URL; everything else in the copy
  // still equals the pinned compiled copy, and help_url is null or an https URL per locale.
  const seededWithoutHelp = Object.fromEntries(
    Object.entries(console_.document.copy_default).map(([locale, copy]) => {
      const { help_url: _helpUrl, ...rest } = copy as Record<string, unknown>;
      return [locale, rest];
    }),
  );
  const compiledWithoutHelp = Object.fromEntries(
    Object.entries(WAITING_ROOM_COMPILED_COPY).map(([locale, copy]) => {
      const { help_url: _helpUrl, ...rest } = copy as Record<string, unknown>;
      return [locale, rest];
    }),
  );
  assert.deepEqual(seededWithoutHelp, compiledWithoutHelp, "Core's seeded copy equals the pinned compiled copy apart from help_url");
  for (const [locale, copy] of Object.entries(console_.document.copy_default)) {
    const helpUrl = (copy as Record<string, unknown>).help_url;
    assert.ok(helpUrl === null || (typeof helpUrl === "string" && helpUrl.startsWith("https://")), `${locale} help_url is null or https`);
  }
  // Amendment v1.5 corpus (Core T-477): every copy block carries `help_url` explicitly; the compiled default is null.
  assert.equal(console_.compiled_defaults.copy.en.help_url, null);
  assert.equal(console_.compiled_defaults.copy.hu.help_url, null);
  assert.deepEqual(console_.compiled_defaults.copy, WAITING_ROOM_COMPILED_COPY, "Core's compiled defaults equal the pinned contract §6 / v1.1 copy");
  assert.deepEqual(console_.document.copy_overrides, {
    HUN: {
      en: { subtitle: "Hungary fixture subtitle" },
      hu: { description: "Magyarországi fixture leírás.", help_url: "https://friending.com/hu/help/verification-hungary" },
    },
  });

  // Resolution over the published document agrees with the iOS gate fixtures' storefront semantics.
  assert.deepEqual(forcedMethodList(resolveForcedMethods(console_.document, null)), ["persona"], "unknown storefront → global Persona");
  assert.deepEqual(forcedMethodList(resolveForcedMethods(console_.document, "DEU")), [], "DEU empty replacement → not forced");
  assert.deepEqual(forcedMethodList(resolveForcedMethods(console_.document, "USA")), ["video"], "USA full replacement → video only");
  assert.deepEqual(forcedMethodList(resolveForcedMethods(console_.document, "HUN")), ["persona", "video"]);
  const hunHu = resolveWaitingRoomCopy(console_.document, "HUN", "hu");
  assert.equal(hunHu.description, "Magyarországi fixture leírás.");
  assert.equal(hunHu.subtitle, WAITING_ROOM_COMPILED_COPY.hu.subtitle, "the English-only subtitle override does not leak into Hungarian");
  assert.equal(resolveWaitingRoomCopy(console_.document, "HUN", "en").subtitle, "Hungary fixture subtitle");

  // The editor round-trips the published document exactly.
  const draft = forcedVerificationDraft(console_.document);
  const rebuilt = forcedVerificationDocumentFromDraft(draft);
  assert.ok(rebuilt && forcedVerificationDocumentsEqual(rebuilt, console_.document));

  // The save fixture is the atomic answer for that document at the console's revision: bound by material and by revision.
  const saveBody = await fixture("webadmin-save.json");
  const saved = decodeForcedSaveResponse(saveBody, { expected_revision: console_.revision, document: console_.document });
  assert.ok(saved.ok, "save bound by material at the observed revision");
  assert.equal(saved.value.revision, 8);
  assert.deepEqual(decodeForcedSaveResponse(saveBody, { expected_revision: 8, document: console_.document }), { ok: false, kind: "uncertain", error: "unbound-revision" }, "a stale expected revision never adopts the answer");
  const otherDocument = { ...console_.document, default: { persona: false, video: false } };
  assert.deepEqual(decodeForcedSaveResponse(saveBody, { expected_revision: 7, document: otherDocument }), { ok: false, kind: "uncertain", error: "unbound-material" }, "another document never adopts the answer");
  // What the console would send back for this document is exactly the body Core accepts.
  const roundTrip = normalizeForcedVerificationProxyBody("verification_forced_save", { expected_revision: console_.revision, document: console_.document });
  assert.deepEqual(roundTrip, { expected_revision: 7, document: console_.document });
  assert.deepEqual(normalizeForcedVerificationProxyBody("verification_forced_impact_preview", { document: console_.document }), { document: console_.document });

  const impact = decodeForcedImpactResponse(await fixture("webadmin-impact.json"));
  assert.ok(impact.ok, "impact");
  assert.deepEqual(impact.value.by_storefront.map((row) => row.storefront), ["HUN", "USA"]);
  assert.deepEqual(impact.value.by_storefront[1], { storefront: "USA", members_seen: 7, would_be_gated: 5, satisfied: 2 });
  assert.deepEqual(impact.value.unknown_storefront, { members_seen: 2, would_be_gated: 2, satisfied: 0 });
  assert.equal(impact.value.computed_at, "2027-01-15T08:00:00Z");

  // Every published refusal classifies by the manifest map: 4xx proves a no-land, 503 stays uncertain.
  for (const [file, error, status] of WEBADMIN_REFUSAL_FILES) {
    const body = await fixture(file);
    for (const decoded of [
      decodeForcedConsoleResponse(body),
      decodeForcedSaveResponse(body, { expected_revision: 7, document: console_.document }),
      decodeForcedImpactResponse(body),
    ]) {
      assert.equal(decoded.ok, false, file);
      if (!decoded.ok) {
        if (status === 503) assert.deepEqual(decoded, { ok: false, kind: "uncertain", error }, file);
        else assert.deepEqual(decoded, { ok: false, kind: "refused", error, status }, file);
      }
    }
  }
});

test("the admin_me fixtures bind the v1.2 capability projection beside the released verification block", async () => {
  const admin = (await fixture("webadmin-admin-me-admin.json")) as Json;
  const viewer = (await fixture("webadmin-admin-me-viewer.json")) as Json;
  const legacyActions: Record<string, string[]> = {
    // T-483 released the Verification console contract (D-060), so the legacy
    // block now advertises the caller's own actions instead of an empty list.
    admin: [
      "verification_badge_remove",
      "verification_badge_upload",
      "verification_console",
      "verification_copy_remove",
      "verification_copy_save",
      "verification_grant_preview",
      "verification_grant_remove",
      "verification_grant_save",
      "verification_pending_settings_save",
      "verification_pending_summary",
      "verification_places_city_detail",
      "verification_places_city_search",
      "verification_policy_save_draft",
      "verification_simulate",
      "verification_user_detail",
    ],
    viewer: ["verification_console", "verification_pending_summary", "verification_simulate", "verification_user_detail"],
  };
  for (const body of [admin, viewer]) {
    assert.deepEqual(Object.keys(body).sort(), ["can_send", "data", "message", "status", "status_code", "success"]);
    assert.deepEqual(Object.keys(body.data).sort(), ["verification", "verification_forced"]);
    const legacy = verificationAdminMe(body.data.verification);
    assert.ok(legacy, "the admin_me.verification block still parses under its own closed reader");
    assert.equal(legacy.contract_ready, true);
    assert.deepEqual(legacy.actions, legacyActions[legacy.principal.role]);
    for (const action of legacy.actions) {
      assert.ok(
        !action.startsWith("verification_forced"),
        `no forced action name leaks into the legacy block (${action})`,
      );
    }
  }
  const adminBlock = parseForcedVerificationAdminMe(admin.data.verification_forced);
  assert.deepEqual(adminBlock, { contract_version: 1, contract_ready: true, actions: [...FORCED_VERIFICATION_ACTIONS] });
  assert.deepEqual(forcedVerificationAccess(adminBlock), { visible: true, editable: true });
  const viewerBlock = parseForcedVerificationAdminMe(viewer.data.verification_forced);
  assert.deepEqual(viewerBlock, { contract_version: 1, contract_ready: true, actions: ["verification_forced_console"] });
  assert.deepEqual(forcedVerificationAccess(viewerBlock), { visible: true, editable: false });
  for (const action of FORCED_VERIFICATION_ACTIONS) {
    assert.equal(forcedVerificationProxyCapabilityAuthorized(action, admin.data), true, `admin ${action}`);
    assert.equal(forcedVerificationProxyCapabilityAuthorized(action, viewer.data), action === "verification_forced_console", `viewer ${action}`);
  }
});

test("the iOS bodies never enter a Webadmin decoder", async () => {
  const manifest = await fixtureManifest();
  const consoleBody = decodeForcedConsoleResponse(await fixture("webadmin-console.json"));
  assert.ok(consoleBody.ok);
  for (const row of (manifest.fixtures as Json[]).filter((entry) => entry.consumer === "ios")) {
    const body = await fixture(row.file);
    for (const [name, decoded] of Object.entries({
      console: decodeForcedConsoleResponse(body),
      save: decodeForcedSaveResponse(body, { expected_revision: 7, document: consoleBody.value.document }),
      impact: decodeForcedImpactResponse(body),
    })) {
      assert.equal(decoded.ok, false, `${row.file} must not decode as ${name}`);
    }
    assert.equal(parseForcedVerificationAdminMe((body as Json).data?.verification_forced), null, `${row.file} carries the member projection, not the admin block`);
  }
});
