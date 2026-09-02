import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { ADMIN_ACTIONS } from "../lib/adminActions.ts";
import { verificationAdminMe } from "../lib/verificationAdmin.ts";
import {
  VERIFICATION_METHOD_ACTIONS,
  verificationMethodAccess,
  verificationMethodAdminMe,
  verificationMethodConsoleResponse,
  verificationMethodErrorResponse,
  verificationMethodMutationResponse,
  verificationMethodProxyCapabilityAuthorized,
} from "../lib/verificationMethod.ts";

/**
 * The production-generated wire corpus of the mandatory-verification plane,
 * copied byte-identically from Core `b988f05` (`tests/fixtures/
 * verification_forced_wire/`).
 *
 * T-617 re-pin. The corpus moved for three reasons and this file pins all
 * three:
 *
 * 1. `verification_forced_save` is now a hard refusal — Core answers
 *    `verification-forced-read-only` (logical 409) and no longer writes. The
 *    `webadmin-save.json` body is therefore byte-identical to the new
 *    `webadmin-refusal-verification-forced-read-only.json`, the corpus grew
 *    from 36 to 37 bodies, and the published control-plane map gained that
 *    code. The T-617 Admin calls none of the three forced actions.
 * 2. `admin_me` gained the sibling `verification_method` block, which is the
 *    ONLY authority for the new console's navigation and actions.
 * 3. The three own-profile reads gained the member sibling
 *    `data.verification_method`, while `data.verification_forced` keeps its
 *    exact key set for the installed app.
 *
 * The mutation proof at the end pins the direction of (1) and (2): the
 * pre-T-617 bodies, replayed through the T-617 decoders, must fail exactly
 * where the design says they should.
 */
const FIXTURE_DIRECTORY = new URL("./fixtures/verification_forced_wire/", import.meta.url);
const FIXTURE_CONTRACT = "forced-verification-waiting-room-v1.5";
/** Core `2b97662` "Regenerate verification policy and grant corpora", released in `b988f05`. */
const FIXTURE_SOURCE_COMMIT = "2b97662d83346de3722fdcbf6f3903bb2ff4a367";
/** Was `59e521560ecdd90a6efd836a9ebe055aee4dc731b2b4ddb4ee3d058552792c0e` before T-617. */
const FIXTURE_SET_SHA256 = "885c464a5748d534df784590ff69486bcf2619186c873f784951580244e443f1";
const FIXTURE_GENERATOR_SHA256 = "9359842f8a4ae09f5cc3b72ee02132507f341e52c371ad6675b8667973c6cfc9";
const FIXTURE_MANIFEST_SHA256 = "c4af296af127f14e2ae8e9b970df134764eca1824af609862c74554b6e880f02";
/** The legacy `data.verification` block's own hash on all three own reads (it moved with T-617; see below). */
const FIXTURE_COMPATIBILITY_SHA256 = "87793955d01bc71e63f2ac0d37fcf58009b3a85b4dad719c24e65da3855d2d26";
const FIXTURE_BODY_COUNT = 37;
const FIXTURE_SOURCE_PATH_COUNT = 39;

/** Core's published control-plane map, which the T-617 Admin no longer calls but still pins. */
const PUBLISHED_CONTROL_PLANE: Readonly<Record<string, number>> = {
  "admin-session-invalid": 401,
  "admin-revoked": 403,
  "admin-write-required": 403,
  "verification-forced-conflict": 409,
  "verification-forced-read-only": 409,
  "verification-forced-invalid": 422,
  "verification-forced-default-invalid": 422,
  "verification-forced-overrides-invalid": 422,
  "verification-forced-copy-default-invalid": 422,
  "verification-forced-copy-overrides-invalid": 422,
  "verification-forced-revision-invalid": 422,
  "verification-forced-write-failed": 503,
  "verification-forced-unavailable": 503,
};

type Json = Record<string, any>;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fixtureManifest(): Promise<Json> {
  return JSON.parse(await readFile(new URL("manifest.json", FIXTURE_DIRECTORY), "utf8"));
}

async function fixture(file: string): Promise<Json> {
  return JSON.parse(await readFile(new URL(file, FIXTURE_DIRECTORY), "utf8"));
}

test("the re-pinned corpus is byte-identical, complete, and traceable to the Core source commit", async () => {
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
  assert.ok(Array.isArray(manifest.provenance.source_paths));
  assert.equal(manifest.provenance.source_paths.length, FIXTURE_SOURCE_PATH_COUNT);
  for (const path of [
    "src/Http/Controllers/ForcedVerificationAdminController.php",
    "src/Support/ForcedVerificationAdminPolicy.php",
    // T-617: the unified method policy now decides what this corpus contains,
    // so its capability vocabulary joined the generating source set.
    "src/Support/VerificationMethodAdminPolicy.php",
  ]) {
    assert.ok(manifest.provenance.source_paths.includes(path), `${path} generates this corpus`);
  }
  assert.deepEqual(manifest.compatibility_verification_sha256, {
    "get-own-profile-data": FIXTURE_COMPATIBILITY_SHA256,
    "get-user-own": FIXTURE_COMPATIBILITY_SHA256,
    "get-user-profile": FIXTURE_COMPATIBILITY_SHA256,
  }, "the legacy data.verification block stays byte-identical ACROSS the three own reads");
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
  assert.deepEqual(Object.fromEntries([...consumerCounts].sort()), { ios: 18, webadmin: 19 });
  assert.equal(sha256(aggregateRows.join("\n")), FIXTURE_SET_SHA256, "the fixture-set hash is the sha256 over `file\\0sha256` rows");
});

test("the forced action family is read-only on Core and absent from this Admin", async () => {
  const manifest = await fixtureManifest();
  assert.deepEqual(manifest.control_plane_error_statuses, PUBLISHED_CONTROL_PLANE);
  assert.deepEqual(manifest.boundary_error_statuses, { unauthorized: 401 });
  assert.deepEqual(manifest.member_error_statuses, { "verification-forced-waiting-room": 403 }, "the member refusal is the app's, never the console's");
  assert.equal(manifest.control_plane_error_statuses["verification-forced-read-only"], 409, "the save is a named refusal, not a 5xx");

  // The save fixture IS the read-only refusal: Core stopped writing this plane.
  const save = await fixture("webadmin-save.json");
  const readOnly = await fixture("webadmin-refusal-verification-forced-read-only.json");
  assert.deepEqual(save, readOnly);
  assert.deepEqual(save, {
    success: false, status_code: 409, error: "verification-forced-read-only",
    message: 200, status: 200, can_send: 0,
  });

  // Contract §6.1: this Admin calls none of the three, so none is allow-listed
  // and no decoder in the tree can adopt one of their bodies.
  for (const action of ["verification_forced_console", "verification_forced_save", "verification_forced_impact_preview"]) {
    assert.equal((ADMIN_ACTIONS as readonly string[]).includes(action), false, `${action} is no longer callable`);
  }
  for (const file of ["webadmin-console.json", "webadmin-impact.json", "webadmin-save.json"]) {
    const body = await fixture(file);
    assert.equal(verificationMethodConsoleResponse(body), null, `${file} is not method-console material`);
    assert.equal(verificationMethodMutationResponse(body), null, `${file} is not method-mutation material`);
  }
  assert.equal(
    verificationMethodErrorResponse(await fixture("webadmin-save.json")),
    null,
    "a forced-plane refusal name never decodes in the method vocabulary",
  );
});

test("the admin_me fixtures bind the new verification_method sibling beside the two legacy blocks", async () => {
  const admin = await fixture("webadmin-admin-me-admin.json");
  const viewer = await fixture("webadmin-admin-me-viewer.json");
  const legacyActions: Record<string, string[]> = {
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
    assert.deepEqual(Object.keys(body.data).sort(), ["verification", "verification_forced", "verification_method"]);
    const legacy = verificationAdminMe(body.data.verification);
    assert.ok(legacy, "the closed admin_me.verification block still parses under its own reader");
    assert.equal(legacy.contract_ready, true);
    assert.deepEqual(legacy.actions, legacyActions[legacy.principal.role]);
    for (const action of legacy.actions) {
      assert.ok(
        !action.startsWith("verification_method") && !action.startsWith("verification_forced"),
        `no sibling action name leaks into the legacy block (${action})`,
      );
    }
  }

  const adminBlock = verificationMethodAdminMe(admin.data.verification_method);
  assert.deepEqual(adminBlock, {
    contract_version: 1,
    contract_ready: true,
    actions: ["verification_method_console", "verification_method_save"],
  }, "an editor may draft but not publish: impact and apply are owner-only");
  assert.deepEqual(verificationMethodAccess(adminBlock), { visible: true, editable: true, previewable: false, publishable: false });
  const viewerBlock = verificationMethodAdminMe(viewer.data.verification_method);
  assert.deepEqual(viewerBlock, { contract_version: 1, contract_ready: true, actions: ["verification_method_console"] });
  assert.deepEqual(verificationMethodAccess(viewerBlock), { visible: true, editable: false, previewable: false, publishable: false });
  for (const action of VERIFICATION_METHOD_ACTIONS) {
    assert.equal(
      verificationMethodProxyCapabilityAuthorized(action, admin.data),
      action === "verification_method_console" || action === "verification_method_save",
      `admin ${action}`,
    );
    assert.equal(
      verificationMethodProxyCapabilityAuthorized(action, viewer.data),
      action === "verification_method_console",
      `viewer ${action}`,
    );
  }
});

test("the member sibling arrives beside the exact-key legacy blocks the installed app decodes", async () => {
  const manifest = await fixtureManifest();
  const ownReads = (manifest.fixtures as Json[])
    .filter((row) => row.file.startsWith("ios-own-") && row.file.endsWith("-after.json"))
    .map((row) => row.file as string);
  assert.equal(ownReads.length, 3, "the three own reads");
  for (const file of ownReads) {
    const body = await fixture(file);
    assert.ok(Object.hasOwn(body.data, "verification_method"), `${file} carries the new sibling`);
    assert.deepEqual(Object.keys(body.data.verification_method).sort(), [
      "mandatory_method", "revision", "satisfied", "satisfied_by", "schema_version", "storefront",
    ]);
    assert.ok(["persona", "video", "none"].includes(body.data.verification_method.mandatory_method));
    assert.ok(Object.hasOwn(body.data, "verification_forced"), `${file} keeps the D-053 block`);
    assert.ok(Object.hasOwn(body.data, "verification"), `${file} keeps the Verification Policy block`);
  }
});

test("the iOS bodies never enter a Webadmin decoder", async () => {
  const manifest = await fixtureManifest();
  for (const row of (manifest.fixtures as Json[]).filter((entry) => entry.consumer === "ios")) {
    const body = await fixture(row.file);
    assert.equal(verificationMethodConsoleResponse(body), null, `${row.file} must not decode as a console`);
    assert.equal(verificationMethodMutationResponse(body), null, `${row.file} must not decode as a mutation`);
    assert.equal(
      verificationMethodAdminMe((body as Json).data?.verification_method),
      null,
      `${row.file} carries the member projection, not the admin capability block`,
    );
  }
});

/**
 * Mutation proof, T-605 pattern. The pre-T-617 bodies are replayed through the
 * decoders this release ships. Each must fail exactly where the design says it
 * should, and the released body must pass — so the re-pin is a real contract
 * move, not a hash that was merely typed in again.
 */
test("pre-T-617 bodies fail the T-617 decoders where the design says they must", async () => {
  // 1. `admin_me` without the sibling block: the console is invisible and every
  //    action is denied. Nothing is inferred from the role or the legacy blocks.
  const preAdminMe = {
    ...(await fixture("webadmin-admin-me-admin.json")),
    data: {
      verification: (await fixture("webadmin-admin-me-admin.json")).data.verification,
      verification_forced: (await fixture("webadmin-admin-me-admin.json")).data.verification_forced,
    },
  };
  assert.equal(Object.hasOwn(preAdminMe.data, "verification_method"), false, "the pre-T-617 shape");
  assert.equal(verificationMethodAdminMe(preAdminMe.data.verification_method), null);
  assert.deepEqual(verificationMethodAccess(verificationMethodAdminMe(preAdminMe.data.verification_method)), {
    visible: false, editable: false, previewable: false, publishable: false,
  });
  for (const action of VERIFICATION_METHOD_ACTIONS) {
    assert.equal(verificationMethodProxyCapabilityAuthorized(action, preAdminMe.data), false, `${action} is denied without the sibling`);
  }
  // The released body passes, with exactly the actions the role earns.
  const released = await fixture("webadmin-admin-me-admin.json");
  assert.ok(verificationMethodAdminMe(released.data.verification_method));
  assert.equal(verificationMethodProxyCapabilityAuthorized("verification_method_save", released.data), true);

  // 2. The pre-T-617 `verification_forced_save` SUCCESS body, replayed today.
  //    It is a two-boolean document under a bare `revision`; no T-617 decoder
  //    can adopt it, and Core no longer produces it at all.
  const preSaveSuccess = {
    success: true, status_code: 200, message: 200, status: 200, can_send: 0,
    data: {
      revision: 8,
      default: { persona: true, video: false },
      overrides: { HUN: { persona: true, video: true } },
      copy_default: (await fixture("webadmin-console.json")).data.copy_default,
      copy_overrides: {},
    },
  };
  assert.equal(verificationMethodMutationResponse(preSaveSuccess), null, "the retired save material is not a method mutation");
  assert.equal(verificationMethodConsoleResponse(preSaveSuccess), null);
  assert.equal(verificationMethodErrorResponse(preSaveSuccess), null, "a success body is not a refusal either");
  // The released body for that same request is the named read-only refusal,
  // and it decodes as a refusal in the forced vocabulary Core publishes.
  const releasedSave = await fixture("webadmin-save.json");
  assert.equal(releasedSave.success, false);
  assert.equal(releasedSave.error, "verification-forced-read-only");
  assert.equal(releasedSave.status_code, PUBLISHED_CONTROL_PLANE["verification-forced-read-only"]);

  // 3. The pre-T-617 control-plane map lacked the read-only code, so a Core
  //    that answers it would have been classified as an unknown refusal.
  const preControlPlane = { ...PUBLISHED_CONTROL_PLANE } as Record<string, number>;
  delete preControlPlane["verification-forced-read-only"];
  assert.equal(Object.keys(preControlPlane).length, 12, "the pre-T-617 map had twelve codes");
  assert.equal(Object.keys(PUBLISHED_CONTROL_PLANE).length, 13);
});
