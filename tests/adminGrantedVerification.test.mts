import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import {
  ADMIN_GRANTED_VERIFICATION_ACTIONS,
  ADMIN_GRANTED_VERIFICATION_CAPABILITIES,
  ADMIN_GRANTED_VERIFICATION_ERROR_STATUSES,
  ADMIN_GRANTED_VERIFICATION_LEVELS,
  ADMIN_GRANTED_VERIFICATION_METHODS,
  ADMIN_GRANTED_VERIFICATION_PENDING_STORAGE_KEY,
  ADMIN_GRANTED_VERIFICATION_SOURCES,
  ADMIN_GRANTED_VERIFICATION_STATUSES,
  adminGrantedVerificationAdminMe,
  adminGrantedVerificationConflictMatchesPending,
  adminGrantedVerificationConflictResponse,
  adminGrantedVerificationError,
  adminGrantedVerificationErrorKey,
  adminGrantedVerificationLegacyReceiptRetryAuthorized,
  adminGrantedVerificationMutationConverged,
  adminGrantedVerificationMutationResponse,
  adminGrantedVerificationNormalizeReason,
  adminGrantedVerificationPendingFrom,
  adminGrantedVerificationPendingMutation,
  adminGrantedVerificationPersistBeforeMutation,
  adminGrantedVerificationProxyCapabilityAuthorized,
  adminGrantedVerificationReasonSha256,
  adminGrantedVerificationResource,
  adminGrantedVerificationResourceConverged,
  adminGrantedVerificationSelectedReadAuthorized,
  adminGrantedVerificationSelectedDetailResponse,
  adminGrantedVerificationShouldRetainMutation,
  normalizeAdminGrantedVerificationProxyBody,
  type AdminGrantedVerificationRole,
} from "../lib/adminGrantedVerification.ts";
import {
  ADMIN_ACTIONS,
  adminActionAccess,
} from "../lib/adminActions.ts";
import { ADMIN_GRANTED_VERIFICATION_CONTRACT_READY } from "../lib/contractReadiness.ts";
import {
  normalizeVerificationProxyBody,
  verificationAdminMe,
  verificationConsoleFixture,
  verificationGrantMutationResponse,
  verificationUserDetailResponse,
  verificationUserFixture,
} from "../lib/verificationAdmin.ts";
import {
  personaConflictResponse,
  personaMemberMutationResponse,
} from "../lib/personaAdmin.ts";

type Json = Record<string, any>;

const UUID = "12345678-1234-4234-8234-123456789abc";
const EVALUATED_AT = 1_787_692_800;
const REASON = "Support decision 👩‍💻";
const FIXTURE_DIRECTORY = new URL("./fixtures/admin_granted_verification_wire/", import.meta.url);

// Body identity is the 44 published wire blobs plus their aggregate set hash.
// Manifest provenance is pinned separately because an overlapping Core source
// path can legitimately advance source_commit without changing a wire byte.
const FIXTURE_SOURCE_COMMIT = "4657d1e12ab99927b4d3bab5393a33db27191e12";
const FIXTURE_GENERATOR_COMMIT = "6bf17e492877ee252599cdac6fff393fa52a298a";
const FIXTURE_GENERATOR_SHA256 = "7bbb7986bdd7474af6826d12274e980c33a49dcae5bc2cbae124e8d0af22b0f1";
const FIXTURE_SET_SHA256 = "889888940225bf1bb9b2f5d0b9049fe6a16406e17334b16aeb89c733abf2e088";
const FIXTURE_BODY_COUNT = 44;

const FIXTURE_BODY_FILES = [
  "admin-me-dormant-viewer.json",
  "admin-me-ready-viewer.json",
  "admin-me-dormant-admin.json",
  "admin-me-ready-admin.json",
  "admin-me-dormant-owner.json",
  "admin-me-ready-owner.json",
  "admin-me-revoked-actor.json",
  "compat-admin-me-verification-block.json",
  "compat-user-detail-unselected.json",
  "compat-grant-save-success.json",
  "compat-grant-remove-success.json",
  "compat-persona-apply-success.json",
  "compat-persona-revoke-success.json",
  "compat-persona-apply-idempotent-success.json",
  "compat-persona-apply-replay.json",
  "selected-absent.json",
  "selected-active-video.json",
  "selected-active-persona.json",
  "selected-expired.json",
  "selected-revoked.json",
  "mutation-grant-create.json",
  "mutation-grant-update.json",
  "mutation-grant-method-change.json",
  "mutation-revoke-disabled-after-grant.json",
  "mutation-completed-replay.json",
  "mutation-write-uncertainty-converged.json",
  "refusal-request-id-conflict.json",
  "refusal-request-in-progress.json",
  "refusal-stale-over-tombstone.json",
  "refusal-method-mismatch.json",
  "refusal-method-disabled.json",
  "refusal-grant-not-active.json",
  "refusal-audit-write-failed.json",
  "refusal-write-failed.json",
  "persona-active-video-conflict.json",
  "persona-dual-revision-race-conflict.json",
  "selected-provider-wins.json",
  "selected-import-wins.json",
  "selected-provider-tie.json",
  "selected-import-tie.json",
  "selected-provider-survives-revoke.json",
  "ios-own-provider.json",
  "ios-own-admin-granted.json",
  "ios-external-list-equivalence.json",
] as const;

const FIXTURE_KINDS = [
  "admin_me",
  "compatibility",
  "selected_read",
  "mutation_success",
  "conflict",
  "refusal",
  "ios_wire",
] as const;

const IOS_FORBIDDEN_KEYS = [
  "method_hint",
  "granted_by",
  "granted_at",
  "reason_length",
  "reason_sha256",
  "import_provenance",
  "request_id",
  "persona_inquiry_id",
] as const;

const FIXTURE_SOURCE_PATHS = [
  "config/routes.php",
  "src/Core/Response.php",
  "src/Http/Controllers/VerificationAdminController.php",
  "src/Http/Controllers/WebadminController.php",
  "src/Services/AdminGrantedVerificationService.php",
  "src/Services/AdminGrantedVerificationTransaction.php",
  "src/Services/MongoVerificationPolicyDataSource.php",
  "src/Services/PersonaAdminService.php",
  "src/Services/VerificationAdminActorService.php",
  "src/Services/VerificationAdminException.php",
  "src/Services/VerificationAdminMemberService.php",
  "src/Services/VerificationAdminMutationExecutor.php",
  "src/Services/VerificationAdminProjectionService.php",
  "src/Services/VerificationAdminReadService.php",
  "src/Services/VerificationAdminSchemaService.php",
  "src/Services/VerificationGrantService.php",
  "src/Services/VerificationPolicySchemaService.php",
  "src/Services/VerificationPolicyService.php",
  "src/Services/VerificationRequestContext.php",
  "src/Services/WebadminMutationCommand.php",
  "src/Services/WebadminMutationService.php",
  "src/Support/AdminGrantedVerificationPolicy.php",
  "src/Support/PersonaPolicy.php",
  "src/Support/VerificationAdminPolicy.php",
  "src/Support/VerificationMemberEvaluator.php",
  "src/Support/VerificationPolicy.php",
  "src/Support/Webadmin.php",
  "src/Support/WebadminMutationPolicy.php",
] as const;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function containsKey(value: unknown, needle: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsKey(entry, needle));
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, entry]) => key === needle || containsKey(entry, needle));
}

async function fixtureManifest(): Promise<Json> {
  return JSON.parse(await readFile(new URL("manifest.json", FIXTURE_DIRECTORY), "utf8"));
}

function success(data: unknown): Json {
  return { success: true, status_code: 200, data, message: 200, status: 200, can_send: 0 };
}

function refusal(error: string, statusCode: number, data?: unknown): Json {
  return data === undefined
    ? { success: false, status_code: statusCode, error, message: 200, status: 200, can_send: 0 }
    : { success: false, status_code: statusCode, error, data, message: 200, status: 200, can_send: 0 };
}

function block(role: AdminGrantedVerificationRole, ready = true): Json {
  const capabilities = role === "viewer"
    ? ["verification_grant_read"]
    : [...ADMIN_GRANTED_VERIFICATION_CAPABILITIES];
  return {
    contract_version: 1,
    contract_ready: ready,
    principal: { role, capabilities },
    actions: ready && role !== "viewer" ? [...ADMIN_GRANTED_VERIFICATION_ACTIONS] : [],
  };
}

function absentResource(overrides: Json = {}): Json {
  return {
    schema_version: 1,
    uid: 41,
    evaluated_at: EVALUATED_AT,
    enabled_methods: ["video", "persona"],
    grant_revision: 0,
    admin_grant: null,
    effective_level: "none",
    effective_source: "derived",
    external_seal_would_show: false,
    ...overrides,
  };
}

function seal(overrides: Json = {}): Json {
  const method = overrides.method ?? "persona";
  const reason = overrides.reason ?? REASON;
  return {
    method,
    level: method === "video" ? "light" : "strong",
    method_hint: "admin_granted",
    reason_length: [...reason].length,
    reason_sha256: sha256(reason),
    granted_by: "owner@friending.com",
    granted_at: EVALUATED_AT - 60,
    expires_at: null,
    revision: 3,
    status: "active",
    evaluated_at: EVALUATED_AT,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "reason")),
  };
}

function activeResource(overrides: Json = {}): Json {
  const adminGrant = overrides.admin_grant ?? seal();
  return absentResource({
    grant_revision: adminGrant.revision,
    admin_grant: adminGrant,
    effective_level: adminGrant.status === "active" ? adminGrant.level : "none",
    effective_source: adminGrant.status === "active" ? "granted" : "derived",
    external_seal_would_show: adminGrant.status === "active",
    ...overrides,
  });
}

function selected(resource: Json): Json {
  return success({
    contract_version: 1,
    principal: verificationConsoleFixture().principal,
    verification: verificationUserFixture(resource.uid),
    admin_granted_verification: resource,
  });
}

function mutation(resource: Json, replayed = false): Json {
  return success({
    contract_version: 1,
    principal: block("admin").principal,
    admin_granted_verification: resource,
    replayed,
  });
}

function command(action: "verification_grant" | "verification_revoke", overrides: Json = {}): Json {
  return {
    contract_version: 1,
    uid: 41,
    method: "persona",
    reason: REASON,
    request_id: UUID,
    expected_revision: action === "verification_grant" ? 2 : 3,
    ...overrides,
  };
}

test("the published Core corpus is manifest-bound, inventory-exact, and privacy-safe", async () => {
  const manifest = await fixtureManifest();
  assert.deepEqual(Object.keys(manifest).sort(), [
    "contract",
    "fixture_set_sha256",
    "fixtures",
    "generator_commit",
    "provenance",
    "schema_version",
    "source_commit",
  ]);
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.contract, "admin-granted-verification-v1");
  assert.equal(manifest.source_commit, FIXTURE_SOURCE_COMMIT);
  assert.equal(manifest.generator_commit, FIXTURE_GENERATOR_COMMIT);
  assert.equal(manifest.fixture_set_sha256, FIXTURE_SET_SHA256);

  const provenance = manifest.provenance;
  assert.deepEqual(Object.keys(provenance).sort(), [
    "evaluated_at",
    "generator",
    "generator_sha256",
    "ios_wire_adapter",
    "resource_shaper",
    "source_paths",
    "webadmin_wire_adapter",
  ]);
  assert.equal(provenance.generator, "tests/admin_granted_verification_fixture_dump.php");
  assert.equal(provenance.generator_sha256, FIXTURE_GENERATOR_SHA256);
  assert.equal(provenance.webadmin_wire_adapter, "Friending\\Support\\Webadmin::noStoreReply");
  assert.equal(provenance.ios_wire_adapter, "Friending\\Core\\Response::wirePayload");
  assert.equal(
    provenance.resource_shaper,
    "Friending\\Services\\AdminGrantedVerificationService::resourceFromProjection",
  );
  assert.equal(provenance.evaluated_at, 1_800_000_000);
  assert.deepEqual(provenance.source_paths, FIXTURE_SOURCE_PATHS);

  assert.ok(Array.isArray(manifest.fixtures));
  assert.equal(FIXTURE_BODY_FILES.length, FIXTURE_BODY_COUNT);
  assert.equal(manifest.fixtures.length, FIXTURE_BODY_COUNT);
  assert.deepEqual(manifest.fixtures.map((row: Json) => row.file), FIXTURE_BODY_FILES);
  const fixtureInventory = (await readdir(FIXTURE_DIRECTORY)).sort();
  assert.deepEqual(
    fixtureInventory.filter((file) => file !== "manifest.json"),
    [...FIXTURE_BODY_FILES].sort(),
  );
  assert.deepEqual(
    fixtureInventory.filter((file) => file === "manifest.json"),
    ["manifest.json"],
  );

  const seenFiles = new Set<string>();
  const seenCases = new Set<string>();
  const kindCounts = new Map<string, number>();
  const bodies = new Map<string, Json>();
  const aggregateRows: string[] = [];
  for (const row of manifest.fixtures as Json[]) {
    assert.deepEqual(Object.keys(row).sort(), ["case", "file", "kind", "route", "sha256"]);
    assert.equal(typeof row.file, "string");
    assert.equal(typeof row.case, "string");
    assert.match(row.case, /^[a-z0-9_]+$/u);
    assert.equal(typeof row.route, "string");
    assert.match(row.route, /^\/v1\/(?:webadmin|iospeople|iosuser)\//u);
    assert.ok((FIXTURE_KINDS as readonly string[]).includes(row.kind));
    assert.match(row.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(seenFiles.has(row.file), false, `duplicate fixture file ${row.file}`);
    assert.equal(seenCases.has(row.case), false, `duplicate fixture case ${row.case}`);
    seenFiles.add(row.file);
    seenCases.add(row.case);
    kindCounts.set(row.kind, (kindCounts.get(row.kind) ?? 0) + 1);

    const wire = await readFile(new URL(row.file, FIXTURE_DIRECTORY), "utf8");
    assert.equal(sha256(wire), row.sha256, `${row.file} must match its published byte hash`);
    aggregateRows.push(`${row.file}\0${row.sha256}`);
    const body = JSON.parse(wire) as Json;
    bodies.set(row.file, body);

    const sibling = body.data?.admin_granted_verification;
    if (sibling !== undefined) {
      assert.equal(containsKey(sibling, "reason"), false, `${row.file} exposed a raw reason`);
      assert.equal(containsKey(sibling, "request_id"), false, `${row.file} exposed a request id`);
    }
    if (row.kind === "ios_wire") {
      for (const key of IOS_FORBIDDEN_KEYS) {
        assert.equal(containsKey(body, key), false, `${row.file} exposed ${key}`);
      }
    }
  }
  assert.deepEqual(
    Object.fromEntries([...kindCounts].sort(([left], [right]) => left.localeCompare(right))),
    {
      admin_me: 6,
      compatibility: 10,
      conflict: 4,
      ios_wire: 3,
      mutation_success: 6,
      refusal: 5,
      selected_read: 10,
    },
  );
  assert.equal(sha256(aggregateRows.join("\n")), FIXTURE_SET_SHA256);

  const provider = bodies.get("ios-own-provider.json")?.data?.verification;
  const granted = bodies.get("ios-own-admin-granted.json")?.data?.verification;
  assert.deepEqual(granted?.self_badge, provider?.self_badge);
  assert.deepEqual(granted?.external_seal, provider?.external_seal);
  const members = bodies.get("ios-external-list-equivalence.json")?.data?.members;
  assert.ok(Array.isArray(members));
  assert.equal(members.length, 2);
  assert.equal(members[0]?.profile_verified, true);
  assert.equal(members[1]?.profile_verified, true);
  assert.deepEqual(members[1]?.verification_seal, members[0]?.verification_seal);
});

test("every published Webadmin corpus case passes its production decoder", async () => {
  const manifest = await fixtureManifest();
  const failures: string[] = [];
  for (const row of manifest.fixtures as Json[]) {
    if (row.kind === "ios_wire") continue;
    const body = JSON.parse(await readFile(new URL(row.file, FIXTURE_DIRECTORY), "utf8")) as Json;
    let parsed = false;
    if (row.kind === "admin_me") {
      parsed = adminGrantedVerificationAdminMe(body.admin_granted_verification) !== null;
    } else if (row.kind === "selected_read") {
      parsed = adminGrantedVerificationSelectedDetailResponse(body) !== null;
    } else if (row.kind === "mutation_success") {
      parsed = adminGrantedVerificationMutationResponse(body) !== null;
    } else if (row.kind === "conflict") {
      parsed = adminGrantedVerificationConflictResponse(body) !== null;
    } else if (row.kind === "refusal") {
      parsed = adminGrantedVerificationError(body) === body.error;
    } else if (row.kind === "compatibility") {
      if (row.case === "old_verification_block_unchanged") {
        parsed = verificationAdminMe(body.verification) !== null
          && adminGrantedVerificationAdminMe(body.admin_granted_verification) !== null;
      } else if (row.case === "old_v1_unselected_exact_shape") {
        parsed = verificationUserDetailResponse(body) !== null;
      } else if (row.case === "old_grant_save_success" || row.case === "old_grant_remove_success") {
        parsed = verificationGrantMutationResponse(body) !== null;
      } else if (
        row.case === "persona_alias_active_video_conflict"
        || row.case === "persona_alias_dual_revision_race_loser"
      ) {
        parsed = personaConflictResponse(body) !== null;
      } else if (typeof row.case === "string" && row.case.startsWith("persona_alias_")) {
        parsed = personaMemberMutationResponse(body) !== null;
      }
    }
    if (!parsed) failures.push(`${row.file} (${row.case})`);
  }
  assert.deepEqual(failures, [], "published fixtures must satisfy the shipped strict decoders");
});

test("the T-219 vocabulary and proxy surface remain dormant behind one explicit local switch", async () => {
  assert.equal(ADMIN_GRANTED_VERIFICATION_CONTRACT_READY, false);
  assert.deepEqual(ADMIN_GRANTED_VERIFICATION_ACTIONS, ["verification_grant", "verification_revoke"]);
  assert.deepEqual(ADMIN_GRANTED_VERIFICATION_CAPABILITIES, [
    "verification_grant_edit",
    "verification_grant_read",
  ]);
  assert.deepEqual(ADMIN_GRANTED_VERIFICATION_METHODS, ["video", "persona"]);
  assert.deepEqual(ADMIN_GRANTED_VERIFICATION_LEVELS, ["none", "light", "strong"]);
  assert.deepEqual(ADMIN_GRANTED_VERIFICATION_SOURCES, ["derived", "imported", "granted"]);
  assert.deepEqual(ADMIN_GRANTED_VERIFICATION_STATUSES, ["active", "expired", "revoked"]);
  assert.deepEqual(
    ADMIN_ACTIONS.filter((action) => ADMIN_GRANTED_VERIFICATION_ACTIONS.includes(action as any)),
    [],
  );
  for (const action of ADMIN_GRANTED_VERIFICATION_ACTIONS) assert.equal(adminActionAccess(action), null);

  const selector = {
    contract_version: 1,
    uid: 41,
    admin_granted_verification_contract_version: 1,
  };
  assert.equal(normalizeVerificationProxyBody("verification_user_detail", selector), null);
  assert.deepEqual(
    { ...normalizeVerificationProxyBody("verification_user_detail", selector, true) },
    selector,
  );
  assert.equal(normalizeVerificationProxyBody("verification_user_detail", {
    ...selector,
    admin_granted_verification_contract_version: "1",
  }, true), null);

  const page = await readFile(new URL("../app/(dashboard)/users/[uid]/page.tsx", import.meta.url), "utf8");
  const legacyPanel = await readFile(new URL("../components/VerificationUserPanel.tsx", import.meta.url), "utf8");
  assert.match(page, /ADMIN_GRANTED_VERIFICATION_CONTRACT_READY \? <AdminGrantedVerificationPanel key=\{`admin-granted-verification-\$\{uid\}`\} uid=\{uid\}/);
  assert.match(legacyPanel, /const legacyEditorTransitioned = ADMIN_GRANTED_VERIFICATION_CONTRACT_READY/);
  assert.match(legacyPanel, /const canEdit = !legacyEditorTransitioned/);
});

test("admin_me is exact, sorted, role-derived, and independently readiness-gated", () => {
  for (const role of ["viewer", "admin", "owner"] as const) {
    assert.deepEqual(adminGrantedVerificationAdminMe(block(role)), block(role));
    assert.deepEqual(adminGrantedVerificationAdminMe(block(role, false)), block(role, false));
  }
  assert.equal(adminGrantedVerificationAdminMe({ ...block("admin"), extra: true }), null);
  assert.equal(adminGrantedVerificationAdminMe({
    ...block("admin"),
    principal: { role: "admin", capabilities: [...ADMIN_GRANTED_VERIFICATION_CAPABILITIES].reverse() },
  }), null);
  assert.equal(adminGrantedVerificationAdminMe({
    ...block("viewer"),
    principal: { role: "viewer", capabilities: [] },
  }), null);
  assert.equal(adminGrantedVerificationAdminMe({
    ...block("owner"),
    actions: [...ADMIN_GRANTED_VERIFICATION_ACTIONS].reverse(),
  }), null);
  assert.equal(adminGrantedVerificationAdminMe({
    ...block("owner", false),
    actions: ["verification_grant"],
  }), null);
});

test("the proxy trusts only the new exact capability block and never the old Verification role", () => {
  for (const action of ADMIN_GRANTED_VERIFICATION_ACTIONS) {
    assert.equal(adminGrantedVerificationProxyCapabilityAuthorized(action, {
      success: true,
      role: "admin",
      admin_granted_verification: block("admin"),
    }), true);
    assert.equal(adminGrantedVerificationProxyCapabilityAuthorized(action, {
      success: true,
      role: "owner",
      verification: { contract_ready: true, principal: block("admin").principal },
    }), false);
    assert.equal(adminGrantedVerificationProxyCapabilityAuthorized(action, {
      success: true,
      role: "owner",
      admin_granted_verification: block("admin", false),
    }), false);
    assert.equal(adminGrantedVerificationProxyCapabilityAuthorized(action, {
      success: true,
      role: "owner",
      admin_granted_verification: { ...block("admin"), extra: true },
    }), false);
    assert.equal(adminGrantedVerificationProxyCapabilityAuthorized(action, {
      success: true,
      role: "owner",
      admin_granted_verification: block("viewer"),
    }), false);
  }
  assert.equal(adminGrantedVerificationProxyCapabilityAuthorized("verification_user_detail", {}), null);
  assert.equal(adminGrantedVerificationSelectedReadAuthorized({
    admin_granted_verification: block("viewer"),
  }), true);
  assert.equal(adminGrantedVerificationSelectedReadAuthorized({
    verification: block("admin"),
  }), false);
  assert.equal(adminGrantedVerificationSelectedReadAuthorized({
    admin_granted_verification: block("admin", false),
  }), false);
  assert.equal(adminGrantedVerificationLegacyReceiptRetryAuthorized(
    "verification_grant_save",
    { admin_granted_verification: block("admin") },
  ), true);
  assert.equal(adminGrantedVerificationLegacyReceiptRetryAuthorized(
    "verification_grant_remove",
    { admin_granted_verification: block("viewer") },
  ), false);
  assert.equal(adminGrantedVerificationLegacyReceiptRetryAuthorized(
    "admin_apply_fake_persona",
    { admin_granted_verification: block("admin") },
  ), true);
  assert.equal(adminGrantedVerificationLegacyReceiptRetryAuthorized(
    "admin_revoke_fake_persona",
    { admin_granted_verification: block("admin") },
  ), true);
  assert.equal(adminGrantedVerificationLegacyReceiptRetryAuthorized(
    "verification_grant_preview",
    { admin_granted_verification: block("admin") },
  ), null);
});

test("the selected resource parser enforces every closed field and cross-field invariant", () => {
  assert.deepEqual(adminGrantedVerificationResource(absentResource()), absentResource());
  assert.deepEqual(adminGrantedVerificationResource(activeResource()), activeResource());

  const disabledAfterGrant = activeResource({ enabled_methods: ["video"] });
  assert.ok(adminGrantedVerificationResource(disabledAfterGrant), "an active Persona grant may outlive method enablement");
  assert.ok(adminGrantedVerificationResource(activeResource({
    enabled_methods: [],
    external_seal_would_show: false,
  })));

  const expiredSeal = seal({ expires_at: EVALUATED_AT, status: "expired" });
  assert.ok(adminGrantedVerificationResource(activeResource({
    admin_grant: expiredSeal,
    grant_revision: expiredSeal.revision,
    effective_level: "none",
    effective_source: "derived",
    external_seal_would_show: false,
  })));
  const revokedSeal = seal({ expires_at: EVALUATED_AT + 60, status: "revoked" });
  assert.ok(adminGrantedVerificationResource(activeResource({
    admin_grant: revokedSeal,
    grant_revision: revokedSeal.revision,
    effective_level: "light",
    effective_source: "derived",
    external_seal_would_show: true,
  })));

  for (const invalid of [
    { ...absentResource(), extra: true },
    { ...absentResource(), uid: "41" },
    { ...absentResource(), enabled_methods: ["persona", "video"] },
    { ...absentResource(), enabled_methods: ["video", "video"] },
    { ...absentResource(), grant_revision: 1 },
    { ...activeResource(), grant_revision: 2 },
    activeResource({ admin_grant: { ...seal(), method_hint: "persona" } }),
    activeResource({ admin_grant: { ...seal(), method: "video", level: "strong" } }),
    activeResource({ admin_grant: { ...seal(), reason_sha256: "A".repeat(64) } }),
    activeResource({ admin_grant: { ...seal(), reason_length: 0 } }),
    activeResource({ admin_grant: { ...seal(), granted_by: "Owner@friending.com" } }),
    activeResource({ admin_grant: { ...seal(), granted_at: EVALUATED_AT + 1 } }),
    activeResource({ admin_grant: { ...seal(), expires_at: EVALUATED_AT, status: "active" } }),
    activeResource({ admin_grant: { ...seal(), expires_at: null, status: "expired" } }),
    activeResource({ effective_level: "light", effective_source: "granted" }),
    { ...absentResource(), effective_source: "imported" },
    { ...absentResource(), external_seal_would_show: true },
    activeResource({ enabled_methods: [], external_seal_would_show: true }),
    activeResource({ admin_grant: { ...seal(), reason: "forbidden text" } }),
    activeResource({ admin_grant: { ...seal(), inquiry_id: "forbidden" } }),
  ]) assert.equal(adminGrantedVerificationResource(invalid), null);
});

test("selected detail proves the unchanged legacy projection and exact additive sibling", () => {
  const body = selected(absentResource({ enabled_methods: ["persona"] }));
  const parsed = adminGrantedVerificationSelectedDetailResponse(body);
  assert.ok(parsed);
  assert.equal(parsed.verification.uid, 41);
  assert.equal(parsed.admin_granted_verification.uid, 41);
  assert.equal(adminGrantedVerificationSelectedDetailResponse({ ...body, trace: "extra" }), null);
  assert.equal(adminGrantedVerificationSelectedDetailResponse(success({ ...body.data, extra: true })), null);
  assert.equal(adminGrantedVerificationSelectedDetailResponse(success({
    ...body.data,
    verification: { ...body.data.verification, extra: true },
  })), null);
  assert.equal(adminGrantedVerificationSelectedDetailResponse(success({
    ...body.data,
    admin_granted_verification: { ...body.data.admin_granted_verification, uid: 42 },
  })), null);
  assert.equal(adminGrantedVerificationSelectedDetailResponse(success({
    ...body.data,
    principal: { role: "viewer", capabilities: ["verification_policy_read"] },
  })), null);
  assert.equal(adminGrantedVerificationSelectedDetailResponse(success({
    ...body.data,
    admin_granted_verification: {
      ...body.data.admin_granted_verification,
      effective_level: "light",
      effective_source: "derived",
      external_seal_would_show: true,
    },
  })), null);
  assert.equal(adminGrantedVerificationSelectedDetailResponse({
    ...body,
    status_code: 201,
  }), null);
});

test("mutation and conflict envelopes are exact, authoritative, and data-shape closed", () => {
  const resource = activeResource();
  assert.deepEqual(adminGrantedVerificationMutationResponse(mutation(resource)), {
    contract_version: 1,
    principal: block("admin").principal,
    admin_granted_verification: resource,
    replayed: false,
  });
  assert.equal(adminGrantedVerificationMutationResponse(success({
    ...mutation(resource).data,
    extra: true,
  })), null);
  assert.equal(adminGrantedVerificationMutationResponse(success({
    ...mutation(resource).data,
    replayed: 0,
  })), null);
  assert.equal(adminGrantedVerificationMutationResponse(success({
    ...mutation(resource).data,
    principal: block("viewer").principal,
  })), null);
  assert.equal(adminGrantedVerificationMutationResponse({ ...mutation(resource), debug: true }), null);

  for (const error of [
    "verification-method-not-enabled",
    "verification-grant-not-active",
    "verification-conflict",
  ] as const) {
    const body = refusal(error, 409, {
      contract_version: 1,
      admin_granted_verification: resource,
    });
    assert.deepEqual(adminGrantedVerificationConflictResponse(body), {
      error,
      contract_version: 1,
      admin_granted_verification: resource,
    });
    assert.equal(adminGrantedVerificationError(body), error);
    assert.equal(adminGrantedVerificationConflictResponse({ ...body, extra: true }), null);
    assert.equal(adminGrantedVerificationConflictResponse(refusal(error, 409, {
      ...body.data,
      extra: true,
    })), null);
    assert.equal(adminGrantedVerificationConflictResponse(refusal(error, 422, body.data)), null);
  }
  assert.equal(adminGrantedVerificationConflictResponse(refusal(
    "verification-request-id-conflict",
    409,
    { contract_version: 1, admin_granted_verification: resource },
  )), null);
});

test("the closed error vocabulary binds every name to its exact logical status", () => {
  const bridge = new Set([
    "auth-required", "bad-origin", "admin-write-required", "not-found", "invalid-input",
    "too-large", "core-unavailable", "invalid-core-response", "core-timeout",
  ]);
  const conflicts = new Set([
    "verification-method-not-enabled", "verification-grant-not-active", "verification-conflict",
  ]);
  for (const [error, status] of Object.entries(ADMIN_GRANTED_VERIFICATION_ERROR_STATUSES)) {
    const body = conflicts.has(error)
      ? refusal(error, status, {
        contract_version: 1,
        admin_granted_verification: absentResource(),
      })
      : bridge.has(error)
        ? { success: false, status_code: status, error }
        : refusal(error, status);
    assert.equal(adminGrantedVerificationError(body), error, error);
    const wrong = status === 409 ? 422 : 409;
    const wrongBody = conflicts.has(error)
      ? refusal(error, wrong, {
        contract_version: 1,
        admin_granted_verification: absentResource(),
      })
      : bridge.has(error)
        ? { success: false, status_code: wrong, error }
        : refusal(error, wrong);
    assert.equal(adminGrantedVerificationError(wrongBody), null, `${error} wrong status`);
    assert.notEqual(adminGrantedVerificationErrorKey(error), "generic", error);
  }
  assert.equal(adminGrantedVerificationError(refusal("future-error", 409)), null);
  assert.equal(adminGrantedVerificationErrorKey("future-error"), "generic");
});

test("proxy commands normalize exactly six browser fields and reject loose or caller-owned material", () => {
  assert.deepEqual(
    { ...normalizeAdminGrantedVerificationProxyBody("verification_grant", command("verification_grant")) },
    command("verification_grant"),
  );
  assert.deepEqual(
    { ...normalizeAdminGrantedVerificationProxyBody("verification_revoke", command("verification_revoke")) },
    command("verification_revoke"),
  );
  const normalized = normalizeAdminGrantedVerificationProxyBody("verification_grant", command(
    "verification_grant",
    { reason: "  De\u0301cision 👩‍💻  " },
  ));
  assert.equal(normalized?.reason, "Décision 👩‍💻");

  for (const mutate of [
    (body: Json) => ({ ...body, extra: true }),
    (body: Json) => ({ ...body, contract_version: "1" }),
    (body: Json) => ({ ...body, uid: "41" }),
    (body: Json) => ({ ...body, uid: 2_147_483_648 }),
    (body: Json) => ({ ...body, method: "manual" }),
    (body: Json) => ({ ...body, reason: "line\nbreak" }),
    (body: Json) => ({ ...body, reason: "control\u0085" }),
    (body: Json) => ({ ...body, reason: "A".repeat(301) }),
    (body: Json) => ({ ...body, request_id: UUID.toUpperCase() }),
    (body: Json) => ({ ...body, expected_revision: -1 }),
    (body: Json) => ({ ...body, expected_revision: -0 }),
    (body: Json) => ({ ...body, admin_email: "caller@example.com" }),
    (body: Json) => ({ ...body, secret: "caller" }),
  ]) assert.equal(normalizeAdminGrantedVerificationProxyBody(
    "verification_grant",
    mutate(command("verification_grant")),
  ), null);
  assert.equal(normalizeAdminGrantedVerificationProxyBody(
    "verification_revoke",
    command("verification_revoke", { expected_revision: 0 }),
  ), null);
  assert.equal(normalizeAdminGrantedVerificationProxyBody("overview", {}), undefined);
  assert.equal(adminGrantedVerificationNormalizeReason("  De\u0301cision  "), "Décision");
  assert.equal(adminGrantedVerificationNormalizeReason("\ud800"), null);
});

test("the reason witness hashes normalized UTF-8 bytes and counts Unicode scalars", async () => {
  const normalized = "Decision 👩‍💻";
  assert.equal(await adminGrantedVerificationReasonSha256(normalized), sha256(normalized));
  assert.equal(await adminGrantedVerificationReasonSha256("  Decision 👩‍💻  "), sha256(normalized));
  assert.equal([...normalized].length, 12);
  assert.equal(await adminGrantedVerificationReasonSha256("line\nbreak"), null);
});

test("durable pending identity stores the complete normalized command before first send", async () => {
  const pending = adminGrantedVerificationPendingMutation("verification_grant", command(
    "verification_grant",
    { reason: "  De\u0301cision  " },
  ));
  assert.ok(pending);
  assert.equal(pending.target, "uid:41");
  assert.equal(pending.payload.reason, "Décision");
  assert.deepEqual(adminGrantedVerificationPendingFrom(JSON.parse(JSON.stringify(pending))), pending);
  assert.equal(adminGrantedVerificationPendingFrom({ ...pending, target: "uid:42" }), null);
  assert.equal(adminGrantedVerificationPendingFrom({ ...pending, extra: true }), null);

  const order: string[] = [];
  let stored = "";
  const result = await adminGrantedVerificationPersistBeforeMutation(
    {
      setItem(key: string, value: string) {
        assert.equal(key, ADMIN_GRANTED_VERIFICATION_PENDING_STORAGE_KEY);
        stored = value;
        order.push("persist");
      },
    },
    pending,
    async () => {
      assert.notEqual(stored, "");
      order.push("send");
      return "response";
    },
  );
  assert.deepEqual(order, ["persist", "send"]);
  assert.deepEqual(result, { ok: true, response: "response" });
  assert.equal(JSON.parse(stored).payload.reason, "Décision");
  for (const forbidden of ["evidence", "inquiry", "provider_payload", "phone", "email", "media"] as const) {
    assert.equal(Object.hasOwn(JSON.parse(stored).payload, forbidden), false);
  }
  const refused = await adminGrantedVerificationPersistBeforeMutation(
    { setItem() { throw new Error("blocked"); } },
    pending,
    async () => { throw new Error("must not send"); },
  );
  assert.deepEqual(refused, { ok: false });
});

test("success and authoritative-read convergence bind target, action, method, revision, and grant material", async () => {
  const grantPending = adminGrantedVerificationPendingMutation(
    "verification_grant",
    command("verification_grant"),
  );
  assert.ok(grantPending);
  const granted = activeResource({ admin_grant: seal({ revision: 3 }), grant_revision: 3 });
  const parsedMutation = adminGrantedVerificationMutationResponse(mutation(granted));
  assert.ok(parsedMutation);
  assert.equal(await adminGrantedVerificationMutationConverged(grantPending, parsedMutation), true);
  assert.equal(await adminGrantedVerificationResourceConverged(grantPending, granted), true);
  assert.equal(await adminGrantedVerificationResourceConverged(grantPending, activeResource({
    admin_grant: seal({ revision: 4 }),
    grant_revision: 4,
  })), false);
  assert.equal(await adminGrantedVerificationResourceConverged(grantPending, activeResource({
    admin_grant: seal({ method: "video", revision: 3 }),
    grant_revision: 3,
  })), false);
  assert.equal(await adminGrantedVerificationResourceConverged(grantPending, activeResource({
    admin_grant: seal({ revision: 3, reason_sha256: "0".repeat(64) }),
    grant_revision: 3,
  })), false);

  const revokePending = adminGrantedVerificationPendingMutation(
    "verification_revoke",
    command("verification_revoke"),
  );
  assert.ok(revokePending);
  const revokedSeal = seal({ revision: 4, expires_at: EVALUATED_AT, status: "revoked" });
  const revoked = activeResource({
    admin_grant: revokedSeal,
    grant_revision: 4,
    effective_level: "none",
    effective_source: "derived",
    external_seal_would_show: false,
  });
  assert.equal(await adminGrantedVerificationResourceConverged(revokePending, revoked), true);
  assert.equal(await adminGrantedVerificationResourceConverged(revokePending, granted), false);
});

test("conflicts are target-bound and only uncertainty retains the exact pending identity", () => {
  const pending = adminGrantedVerificationPendingMutation(
    "verification_grant",
    command("verification_grant"),
  );
  assert.ok(pending);
  const matching = adminGrantedVerificationConflictResponse(refusal(
    "verification-conflict",
    409,
    { contract_version: 1, admin_granted_verification: absentResource() },
  ));
  const other = adminGrantedVerificationConflictResponse(refusal(
    "verification-conflict",
    409,
    { contract_version: 1, admin_granted_verification: absentResource({ uid: 42 }) },
  ));
  assert.ok(matching && other);
  assert.equal(adminGrantedVerificationConflictMatchesPending(pending, matching), true);
  assert.equal(adminGrantedVerificationConflictMatchesPending(pending, other), false);

  for (const error of [
    null,
    "future-error",
    "verification-request-in-progress",
    "verification-audit-write-failed",
    "verification-write-failed",
    "verification-read-failed",
    "verification-schema-unavailable",
    "verification-stored-invalid",
    "verification-capability-required",
    "admin-write-required",
    "auth-required",
    "not-found",
    "core-timeout",
    "core-unavailable",
    "invalid-core-response",
  ]) assert.equal(adminGrantedVerificationShouldRetainMutation(error), true, String(error));
  for (const error of [
    "verification-contract-version-invalid",
    "verification-request-invalid",
    "verification-request-id-invalid",
    "verification-grant-invalid",
    "verification-user-not-found",
    "verification-method-not-enabled",
    "verification-grant-not-active",
    "verification-conflict",
    "verification-request-id-conflict",
  ]) assert.equal(adminGrantedVerificationShouldRetainMutation(error), false, error);
});

test("the panel is same-origin, explicit-confirmation, durable-retry, and no-optimism by construction", async () => {
  const source = await readFile(
    new URL("../components/AdminGrantedVerificationPanel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /adminCall\("admin_me", \{\}\)/);
  assert.match(source, /admin_granted_verification_contract_version: 1/);
  assert.match(source, /adminGrantedVerificationPersistBeforeMutation/);
  assert.match(source, /mutationInFlightRef\.current/);
  assert.match(source, /pendingRef\.current = next;[\s\S]*?return adminCall\(next\.action, next\.payload\)/);
  assert.match(source, /crypto\.randomUUID\(\)/);
  assert.match(source, /checked=\{confirmed\}/);
  assert.match(source, /action === "verification_revoke" \? activeGrant\?\.method : method/);
  assert.match(source, /adminGrantedVerificationMutationConverged/);
  assert.match(source, /adminGrantedVerificationResourceConverged/);
  assert.match(source, /if \(conflict\) \{[\s\S]*?adminGrantedVerificationConflictMatchesPending[\s\S]*?live\.unknownError/);
  assert.match(source, /sessionStorage\.getItem\(VERIFICATION_PENDING_STORAGE_KEY\)/);
  assert.match(source, /sessionStorage\.getItem\(PERSONA_PENDING_STORAGE_KEY\)/);
  assert.match(source, /restored\?\.action === "admin_apply_fake_persona"/);
  assert.match(source, /restored\?\.action === "admin_revoke_fake_persona"/);
  assert.match(source, /if \(!mutation\.replayed[\s\S]*?adopt\(mutation\.admin_granted_verification\)/);
  assert.match(source, /if \(cleared && mutation\.replayed[\s\S]*?await load\(\)/);
  assert.doesNotMatch(source, /https:\/\/core\.friending\.com/);
  assert.doesNotMatch(source, /provider_payload|inquiry_id|evidence_url|video_url/);
  const send = source.indexOf("response = persisted.response");
  const adopt = source.indexOf("adopt(mutation.admin_granted_verification)");
  assert.ok(send >= 0 && adopt > send, "authoritative response precedes state adoption");
});
