import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ADMIN_ACTIONS,
  adminActionBodyLimit,
  adminPrincipalFrom,
  isAdminActionAllowed,
  isAdminActionAuthorized,
} from "../lib/adminActions.ts";
import { VERIFICATION_CONTRACT_READY } from "../lib/contractReadiness.ts";
import {
  ADMIN_REQUEST_HEADER,
  ADMIN_REQUEST_HEADER_VALUE,
  isTrustedAdminRequest,
} from "../lib/requestGuard.ts";
import {
  MAX_VERIFICATION_BADGE_BYTES,
  MAX_VERIFICATION_BADGE_FORM_BYTES,
  MAX_VERIFICATION_BADGE_DIMENSION,
  MIN_VERIFICATION_BADGE_DIMENSION,
  VERIFICATION_ACTION_CAPABILITY,
  VERIFICATION_ADMIN_ACTIONS,
  VERIFICATION_BADGE_SLOTS,
  VERIFICATION_CAPABILITIES,
  VERIFICATION_ERROR_STATUSES,
  VERIFICATION_FEATURE_KEYS,
  VERIFICATION_GATE_VARIANTS,
  VERIFICATION_GRANT_CAPABILITIES,
  VERIFICATION_LEVELS,
  VERIFICATION_LOCALES,
  VERIFICATION_METHODS,
  VERIFICATION_MUTATION_ACTIONS,
  VERIFICATION_PENDING_STORAGE_KEY,
  VERIFICATION_POLICY_OPERATIONS,
  VERIFICATION_TAB_KEYS,
  normalizeVerificationProxyBody,
  verificationAccess,
  verificationAdminMe,
  verificationBadgeMutationResponse,
  verificationCityDetailResponse,
  verificationCitySearchResponse,
  verificationConflictResponse,
  verificationConsoleFixture,
  verificationConsoleResponse,
  verificationCopyMutationResponse,
  verificationErrorResponse,
  verificationGrantDraftError,
  verificationGrantMutationResponse,
  verificationGrantPreviewResponse,
  verificationMaxLevel,
  verificationPendingFrom,
  verificationPendingMutation,
  verificationPendingSettingsMutationResponse,
  verificationPendingSummaryResponse,
  verificationPersistBeforeMutation,
  verificationPngBytesError,
  verificationPolicyImpactPreviewResponse,
  verificationPolicyLifecycle,
  verificationPolicyMutationResponse,
  verificationPolicyOperationsFor,
  verificationProxyCapabilityAuthorized,
  verificationShouldRetainMutation,
  verificationSimulationResponse,
  verificationTabKey,
  verificationTextLength,
  verificationUserDetailResponse,
  verificationUserFixture,
  type VerificationConsoleData,
  type VerificationGrantPreviewData,
  type VerificationPendingSummaryData,
  type VerificationPolicyImpactPreviewData,
  type VerificationSimulationData,
  type VerificationSimulationInput,
  type VerificationUserProjection,
} from "../lib/verificationAdmin.ts";

const ROOT = process.cwd();
const UUID = "00000000-0000-4000-8000-000000000000";
const NOW = 1_787_692_800;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function success(data: unknown) {
  return { success: true, status_code: 200, data, message: 200, status: 200, can_send: 0 };
}

function refusal(error: string, statusCode: number, data?: unknown) {
  return data === undefined
    ? { success: false, status_code: statusCode, error, message: 200, status: 200, can_send: 0 }
    : { success: false, status_code: statusCode, error, data, message: 200, status: 200, can_send: 0 };
}

function pngHeader(width = 16, height = width): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const write = (offset: number, value: number) => {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
  };
  write(16, width);
  write(20, height);
  return bytes;
}

function simulationInput(): VerificationSimulationInput {
  return {
    video: { status: "not_started", pending_age_seconds: null, attempt: null, retry_available: true },
    persona: { status: "not_started", pending_age_seconds: null, attempt: null, retry_available: true },
    imported_level: "none",
    imported_method_hint: null,
    grant_level: "none",
    badge_visible: true,
  };
}

function simulationData(blockFirst = false): VerificationSimulationData {
  const fixture = verificationConsoleFixture();
  return {
    contract_version: 1,
    principal: fixture.principal,
    evaluated_at: NOW,
    scope: clone(fixture.policies[0].scope),
    enabled_methods: ["persona"],
    startable_methods: ["persona"],
    tier_language: false,
    method_statuses: { video: "not_started", persona: "not_started" },
    derived_level: "none",
    imported_level: "none",
    granted_level: "none",
    effective_level: "none",
    effective_source: "derived",
    external_seal_would_show: false,
    feature_access: VERIFICATION_FEATURE_KEYS.map((feature, index) => {
      if (!blockFirst || index !== 0) {
        return {
          feature,
          configured_requirement: "none",
          required_tier: "none",
          allowed: true,
          missing_methods: [],
          next_method: null,
          copy_key: null,
          modal: null,
        };
      }
      return {
        feature,
        configured_requirement: "light",
        required_tier: "light",
        allowed: false,
        missing_methods: ["persona"],
        next_method: "persona",
        copy_key: "default.persona",
        modal: {
          kind: "persona",
          icon: { kind: "asset", asset_key: "verification.persona" },
          steps: [{ position: 1, method: "persona", state: "current" }],
          current_step: 1,
          title: "Verify to continue",
          subtitle: "",
          description: "",
          attention_note: null,
          reason: null,
          attempt: null,
          max_attempts: null,
          manual_review_available: false,
          primary_action: { kind: "start_persona", label: "Start", url: null },
          secondary_action: null,
          cancel_label: "Not now",
          provider_attribution: "Persona",
        },
      };
    }) as VerificationSimulationData["feature_access"],
  };
}

function pendingSummary(): VerificationPendingSummaryData {
  const fixture = verificationConsoleFixture();
  return {
    contract_version: 1,
    principal: fixture.principal,
    evaluated_at: NOW,
    total: 0,
    in_sla: 0,
    overdue: 0,
    average_wait_seconds: null,
    methods: [
      { method: "video", total: 0, in_sla: 0, overdue: 0, average_wait_seconds: null, oldest_pending_at: null },
      { method: "persona", total: 0, in_sla: 0, overdue: 0, average_wait_seconds: null, oldest_pending_at: null },
    ],
  };
}

function impactPreview(): VerificationPolicyImpactPreviewData {
  const fixture = verificationConsoleFixture();
  return {
    contract_version: 1,
    principal: fixture.principal,
    evaluated_at: NOW,
    scope_key: "global",
    operation: "publish",
    expected_revision: 1,
    normalized_fingerprint: "0".repeat(64),
    confirmation_phrase: "PUBLISH global",
    method_availability: clone(fixture.method_availability),
    activation_guard: clone(fixture.activation_guard),
    impact: {
      members_evaluated: 12,
      members_changed: 0,
      newly_blocked: 0,
      newly_unblocked: 0,
      descendant_scope_count: 0,
      features: VERIFICATION_FEATURE_KEYS.map((feature) => ({
        feature,
        configured_before: "none",
        configured_after: "none",
        effective_before: "none",
        effective_after: "none",
        affected_members: 0,
        newly_blocked: 0,
        newly_unblocked: 0,
      })),
    },
  };
}

function grantPreview(level: "light" | "strong" = "light"): VerificationGrantPreviewData {
  const fixture = verificationConsoleFixture();
  const current = verificationUserFixture();
  return {
    contract_version: 1,
    principal: fixture.principal,
    evaluated_at: current.evaluated_at,
    current,
    preview: {
      granted_level: level,
      effective_level: level,
      effective_source: "granted",
      external_seal_would_show: true,
      changes_effective_level: true,
      newly_allowed_features: [],
      still_blocked_features: [],
      strong_grant_warning: level === "strong",
    },
  };
}

test("the accepted contract vocabulary and released seventeen-action bridge are exact", () => {
  assert.equal(VERIFICATION_CONTRACT_READY, true);
  assert.deepEqual(VERIFICATION_METHODS, ["video", "persona"]);
  assert.deepEqual(VERIFICATION_LEVELS, ["none", "light", "strong"]);
  assert.deepEqual(VERIFICATION_BADGE_SLOTS, ["light", "strong", "pending"]);
  assert.deepEqual(VERIFICATION_LOCALES, ["en", "hu"]);
  assert.deepEqual(VERIFICATION_TAB_KEYS, ["scopes", "requirements", "messages", "badges", "simulator"]);
  assert.deepEqual(VERIFICATION_POLICY_OPERATIONS, ["publish", "deactivate", "tombstone", "restore"]);
  assert.deepEqual(VERIFICATION_GATE_VARIANTS, ["video", "persona", "both", "pending", "rejected"]);
  assert.deepEqual(VERIFICATION_FEATURE_KEYS, [
    "people.list",
    "profile.view",
    "chat.send",
    "friend.request",
    "dates.access",
    "dates.create",
    "dates.join",
    "footprints.send",
    "pinger.send",
    "album.private_request",
  ]);
  assert.equal((VERIFICATION_FEATURE_KEYS as readonly string[]).includes("chat.start"), false);
  assert.equal((VERIFICATION_FEATURE_KEYS as readonly string[]).includes("profile.public_link"), false);
  assert.equal(VERIFICATION_ADMIN_ACTIONS.length, 17);
  assert.equal(new Set(VERIFICATION_ADMIN_ACTIONS).size, 17);
  assert.equal(VERIFICATION_MUTATION_ACTIONS.length, 9);
  assert.equal(VERIFICATION_GRANT_CAPABILITIES.join(","), "verification_grant_edit,verification_grant_read");
  assert.deepEqual([...VERIFICATION_CAPABILITIES], [...VERIFICATION_CAPABILITIES].sort());
  assert.deepEqual(
    ADMIN_ACTIONS.filter((action) => action.startsWith("verification_")),
    VERIFICATION_ADMIN_ACTIONS,
  );
  const viewerReads = new Set([
    "verification_console",
    "verification_simulate",
    "verification_pending_summary",
    "verification_user_detail",
  ]);
  const ownerOnly = new Set([
    "verification_policy_impact_preview",
    "verification_policy_apply",
  ]);

  for (const action of VERIFICATION_ADMIN_ACTIONS) {
    assert.equal(ADMIN_ACTIONS.includes(action as never), true, `${action} must be in the live bridge`);
    assert.equal(isAdminActionAllowed(action), true);
    assert.equal(isAdminActionAuthorized(action, adminPrincipalFrom({ role: "viewer" })), viewerReads.has(action), `${action} viewer floor`);
    assert.equal(isAdminActionAuthorized(action, adminPrincipalFrom({ role: "admin" })), !ownerOnly.has(action), `${action} editor floor`);
    assert.equal(isAdminActionAuthorized(action, adminPrincipalFrom({ role: "owner" })), true);
  }
});

test("A1 pins the active badge-upload ceiling while every other verification action keeps the default", () => {
  assert.equal(MAX_VERIFICATION_BADGE_BYTES, 2_097_152);
  assert.equal(MAX_VERIFICATION_BADGE_FORM_BYTES, 3_145_728);
  assert.equal(MIN_VERIFICATION_BADGE_DIMENSION, 16);
  assert.equal(MAX_VERIFICATION_BADGE_DIMENSION, 2_048);
  assert.equal(adminActionBodyLimit("verification_badge_upload"), 3_145_728);
  for (const action of VERIFICATION_ADMIN_ACTIONS) {
    if (action === "verification_badge_upload") continue;
    assert.equal(adminActionBodyLimit(action), 256_000, action);
  }
});

test("admin readiness and user-detail access projections are exact, sorted, and capability-bound", () => {
  const principal = verificationConsoleFixture().principal;
  const actions = [...VERIFICATION_ADMIN_ACTIONS].sort();
  const ready = { contract_version: 1, contract_ready: true, principal, actions };
  assert.ok(verificationAdminMe(ready));
  assert.equal(verificationAdminMe({ ...ready, extra: true }), null);
  assert.equal(verificationAdminMe({ ...ready, actions: [...actions].reverse() }), null);

  const insufficient = clone(ready);
  insufficient.principal.capabilities = ["verification_policy_read"];
  assert.equal(verificationAdminMe(insufficient), null, "an advertised action must carry its capability");
  assert.ok(verificationAdminMe({ contract_version: 1, contract_ready: false, principal, actions: [] }));
  assert.equal(verificationAdminMe({ contract_version: 1, contract_ready: false, principal, actions: ["verification_console"] }), null);

  assert.ok(verificationAccess({ contract_version: 1, contract_ready: true, capabilities: [...VERIFICATION_GRANT_CAPABILITIES] }));
  assert.equal(verificationAccess({ contract_version: 1, contract_ready: true, capabilities: [...VERIFICATION_GRANT_CAPABILITIES].reverse() }), null);
  assert.ok(verificationAccess({ contract_version: 1, contract_ready: false, capabilities: [] }));
  assert.equal(verificationAccess({ contract_version: 1, contract_ready: false, capabilities: ["verification_grant_read"] }), null);
});

test("the per-request proxy capability decision trusts only the exact Core projection", () => {
  const capabilities = VERIFICATION_CAPABILITIES.filter((capability) => [
    "verification_grant_read",
    "verification_pending_read",
    "verification_policy_read",
    "verification_simulate",
  ].includes(capability));
  const actions = [
    "verification_console",
    "verification_pending_summary",
    "verification_simulate",
    "verification_user_detail",
  ].sort();
  const verification = {
    contract_version: 1,
    contract_ready: true,
    principal: { role: "viewer", capabilities },
    actions,
  };
  assert.equal(verificationProxyCapabilityAuthorized("verification_console", { verification }), true);
  assert.equal(verificationProxyCapabilityAuthorized("verification_policy_save_draft", { verification }), false);
  assert.equal(verificationProxyCapabilityAuthorized("overview", { verification }), null);
  assert.equal(verificationProxyCapabilityAuthorized("verification_console", { verification: { ...verification, contract_ready: false, actions: [] } }), false);
  assert.equal(verificationProxyCapabilityAuthorized("verification_console", { verification: { ...verification, extra: true } }), false);
  assert.equal(VERIFICATION_ACTION_CAPABILITY.verification_policy_apply, "verification_policy_publish");
});

test("same-origin and custom-header checks reject guests' cross-site request material before any Core work", () => {
  const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name.toLowerCase()] ?? null });
  assert.equal(isTrustedAdminRequest(headers({
    host: "friendingapp.com",
    origin: "https://friendingapp.com",
    "sec-fetch-site": "same-origin",
    [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE,
  })), true);
  assert.equal(isTrustedAdminRequest(headers({
    host: "friendingapp.com",
    origin: "https://evil.invalid",
    "sec-fetch-site": "cross-site",
    [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE,
  })), false);
  assert.equal(isTrustedAdminRequest(headers({ host: "friendingapp.com", origin: "https://friendingapp.com" })), false);
});

test("the console parser accepts the exact all-None launch fixture and rejects structural or semantic drift", () => {
  const fixture = verificationConsoleFixture();
  const parsed = verificationConsoleResponse(success(fixture));
  assert.ok(parsed);
  assert.equal(parsed.policies[0].scope_key, "global");
  assert.deepEqual(parsed.feature_keys, VERIFICATION_FEATURE_KEYS);
  assert.equal(parsed.pending_settings.overdue_after_seconds, 1_800);
  assert.equal(parsed.import_health.evaluated_at, parsed.evaluated_at);
  assert.equal(parsed.activation_guard.non_none_publish_ready, false);

  assert.equal(verificationConsoleResponse({ ...success(fixture), extra: true }), null);
  assert.equal(verificationConsoleResponse(success({ ...fixture, extra: true })), null);
  const missingFeature = clone(fixture);
  missingFeature.feature_keys.pop();
  assert.equal(verificationConsoleResponse(success(missingFeature)), null);
  const badReason = clone(fixture);
  badReason.method_availability.video.reason = "unknown" as never;
  assert.equal(verificationConsoleResponse(success(badReason)), null);
  const badGuard = clone(fixture);
  badGuard.activation_guard.non_none_publish_ready = true;
  assert.equal(verificationConsoleResponse(success(badGuard)), null);
  const wrongBadgeOrder = clone(fixture);
  wrongBadgeOrder.badges.reverse();
  assert.equal(verificationConsoleResponse(success(wrongBadgeOrder)), null);
  const staleHealthClock = clone(fixture);
  staleHealthClock.import_health.evaluated_at += 1;
  assert.equal(verificationConsoleResponse(success(staleHealthClock)), null);

  const lastPage = clone(fixture);
  lastPage.total_policies = 2;
  lastPage.next_cursor = null;
  assert.ok(verificationConsoleResponse(success(lastPage)), "a last page need not contain the total census");
});

test("policy, copy, pending and badge mutation parsers close every material object", () => {
  const fixture = verificationConsoleFixture();
  const policy = fixture.policies[0];
  const pair = fixture.copy_pairs.find((row) => row.copy_key === "default.video");
  assert.ok(pair);
  assert.ok(verificationPolicyMutationResponse(success({ contract_version: 1, principal: fixture.principal, policy, replayed: false })));
  assert.ok(verificationCopyMutationResponse(success({ contract_version: 1, principal: fixture.principal, copy_pair: pair, replayed: true })));
  assert.ok(verificationPendingSettingsMutationResponse(success({ contract_version: 1, principal: fixture.principal, pending_settings: fixture.pending_settings, replayed: false })));
  assert.ok(verificationBadgeMutationResponse(success({ contract_version: 1, principal: fixture.principal, badge: fixture.badges[0], replayed: false })));

  const noEffectivePolicy = clone(policy);
  noEffectivePolicy.effective = null;
  assert.equal(verificationPolicyMutationResponse(success({ contract_version: 1, principal: fixture.principal, policy: noEffectivePolicy, replayed: false })), null);

  const wrongAsset = clone(pair);
  wrongAsset.behavior.icon.asset_key = "verification.persona";
  assert.equal(verificationCopyMutationResponse(success({ contract_version: 1, principal: fixture.principal, copy_pair: wrongAsset, replayed: false })), null);

  const urlPair = clone(pair);
  urlPair.behavior.primary_action = "url";
  urlPair.behavior.primary_url = "https://example.com";
  const parsedUrl = verificationCopyMutationResponse(success({ contract_version: 1, principal: fixture.principal, copy_pair: urlPair, replayed: false }));
  assert.equal(parsedUrl?.copy_pair.behavior.primary_url, "https://example.com/");
  urlPair.behavior.primary_url = "http://example.com";
  assert.equal(verificationCopyMutationResponse(success({ contract_version: 1, principal: fixture.principal, copy_pair: urlPair, replayed: false })), null);

  const activeWithoutMedia = clone(fixture.badges[0]);
  activeWithoutMedia.active = true;
  assert.equal(verificationBadgeMutationResponse(success({ contract_version: 1, principal: fixture.principal, badge: activeWithoutMedia, replayed: false })), null);
});

test("A7 and A8 keep draft-only publish and tombstone restore separate", () => {
  const fixture = verificationConsoleFixture();
  const draftOnly = {
    ...clone(fixture.policies[0]),
    scope_key: "country:HU",
    scope: { kind: "country" as const, country_code: "HU", place_id: null, display: "Hungary" },
    revision: 2,
    active: false,
    deleted_at: null,
    live: null,
    effective: null,
  };
  const parsedDraftOnly = verificationPolicyMutationResponse(success({
    contract_version: 1,
    principal: fixture.principal,
    policy: draftOnly,
    replayed: false,
  }));
  assert.ok(parsedDraftOnly);
  assert.equal(verificationPolicyLifecycle(parsedDraftOnly.policy), "draft_only");
  assert.deepEqual(verificationPolicyOperationsFor(parsedDraftOnly.policy), ["publish", "tombstone"]);

  const tombstonedDraftOnly = { ...draftOnly, revision: 3, deleted_at: NOW };
  const parsedTombstone = verificationPolicyMutationResponse(success({
    contract_version: 1,
    principal: fixture.principal,
    policy: tombstonedDraftOnly,
    replayed: false,
  }));
  assert.ok(parsedTombstone);
  assert.equal(verificationPolicyLifecycle(parsedTombstone.policy), "tombstoned_draft_only");
  assert.deepEqual(verificationPolicyOperationsFor(parsedTombstone.policy), ["restore"]);

  const restoredDraftOnly = { ...draftOnly, revision: 4 };
  const parsedRestore = verificationPolicyMutationResponse(success({
    contract_version: 1,
    principal: fixture.principal,
    policy: restoredDraftOnly,
    replayed: false,
  }));
  assert.ok(parsedRestore);
  assert.equal(parsedRestore.policy.active, false, "restore must not activate a never-published override");
  assert.equal(parsedRestore.policy.live, null, "restore must not manufacture a live block");
  assert.equal(verificationPolicyLifecycle(parsedRestore.policy), "draft_only");
  assert.deepEqual(verificationPolicyOperationsFor(parsedRestore.policy), ["publish", "tombstone"]);

  const draftOnlyImpact = impactPreview();
  draftOnlyImpact.scope_key = "country:HU";
  draftOnlyImpact.confirmation_phrase = "PUBLISH country:HU";
  draftOnlyImpact.impact.features[0].configured_before = "none";
  draftOnlyImpact.impact.features[0].effective_before = "light";
  const parsedImpact = verificationPolicyImpactPreviewResponse(success(draftOnlyImpact));
  assert.ok(parsedImpact);
  assert.equal(
    parsedImpact.impact.features[0].effective_before,
    "light",
    "the console must preserve Core's parent-derived effective-before value",
  );
});

test("impact, Places and aggregate parsers accept only their exact bounded shapes", () => {
  const fixture = verificationConsoleFixture();
  const impact = impactPreview();
  assert.ok(verificationPolicyImpactPreviewResponse(success(impact)));
  const stalePhrase = clone(impact);
  stalePhrase.confirmation_phrase = "publish global";
  assert.equal(verificationPolicyImpactPreviewResponse(success(stalePhrase)), null);
  const missingImpactFeature = clone(impact);
  missingImpactFeature.impact.features.pop();
  assert.equal(verificationPolicyImpactPreviewResponse(success(missingImpactFeature)), null);

  const search = {
    contract_version: 1,
    principal: fixture.principal,
    search_token: UUID,
    suggestions: [{ place_id: "ChIJ123", display: "Budapest", secondary: "Hungary", country_code: "HU" }],
  };
  assert.ok(verificationCitySearchResponse(success(search)));
  assert.equal(verificationCitySearchResponse(success({ ...search, suggestions: [...search.suggestions, search.suggestions[0]] })), null);
  const detail = {
    contract_version: 1,
    principal: fixture.principal,
    city: { scope_key: "city:ChIJ123", kind: "city", place_id: "ChIJ123", display: "Budapest", country_code: "HU", place_token: "opaque_token", expires_at: NOW + 600 },
  };
  assert.ok(verificationCityDetailResponse(success(detail)));
  assert.equal(verificationCityDetailResponse(success({ ...detail, city: { ...detail.city, scope_key: "city:other" } })), null);

  const summary = pendingSummary();
  assert.ok(verificationPendingSummaryResponse(success(summary)));
  const badSummary = clone(summary);
  badSummary.total = 1;
  assert.equal(verificationPendingSummaryResponse(success(badSummary)), null);
});

test("the simulator parser validates the frozen evaluator semantics and closed modal contract", () => {
  assert.ok(verificationSimulationResponse(success(simulationData())));
  assert.ok(verificationSimulationResponse(success(simulationData(true))));

  const badSource = simulationData();
  badSource.effective_source = "granted";
  assert.equal(verificationSimulationResponse(success(badSource)), null);
  const impossibleSeal = simulationData();
  impossibleSeal.external_seal_would_show = true;
  assert.equal(verificationSimulationResponse(success(impossibleSeal)), null);
  const nonUrlWithUrl = simulationData(true);
  nonUrlWithUrl.feature_access[0].modal!.primary_action!.url = "https://example.com";
  assert.equal(verificationSimulationResponse(success(nonUrlWithUrl)), null);
  const additiveModal = simulationData(true);
  (additiveModal.feature_access[0].modal as unknown as Record<string, unknown>).provider_payload = "forbidden";
  assert.equal(verificationSimulationResponse(success(additiveModal)), null);
});

test("member projection, imports, grants and previews preserve max/source/expiry semantics", () => {
  const fixture = verificationConsoleFixture();
  const user = verificationUserFixture(7001);
  assert.ok(verificationUserDetailResponse(success({ contract_version: 1, principal: fixture.principal, verification: user })));

  const wrongScope = clone(user);
  wrongScope.scope.scope_key = "country:HU";
  assert.equal(verificationUserDetailResponse(success({ contract_version: 1, principal: fixture.principal, verification: wrongScope })), null);
  const wrongDerived = clone(user);
  wrongDerived.derived_level = "light";
  assert.equal(verificationUserDetailResponse(success({ contract_version: 1, principal: fixture.principal, verification: wrongDerived })), null);

  const imported = clone(user);
  imported.imported = { level: "strong", method_hint: "persona", imported_from: "apifriending", imported_at: NOW - 100 };
  imported.import_integrity = "valid";
  imported.effective_level = "strong";
  imported.effective_source = "imported";
  imported.external_seal_would_show = true;
  assert.ok(verificationUserDetailResponse(success({ contract_version: 1, principal: fixture.principal, verification: imported })));
  imported.imported.level = "light";
  assert.equal(verificationUserDetailResponse(success({ contract_version: 1, principal: fixture.principal, verification: imported })), null);

  const granted = clone(user);
  granted.grant = { level: "light", reason: "Support decision", granted_by: "owner@friending.com", granted_at: NOW - 50, expires_at: null, revision: 1, status: "active", evaluated_at: NOW };
  granted.grant_revision = 1;
  granted.effective_level = "light";
  granted.effective_source = "granted";
  granted.external_seal_would_show = true;
  assert.ok(verificationGrantMutationResponse(success({ contract_version: 1, principal: fixture.principal, verification: granted, replayed: false })));
  const wrongGrantClock = clone(granted);
  wrongGrantClock.grant!.evaluated_at -= 1;
  assert.equal(verificationGrantMutationResponse(success({ contract_version: 1, principal: fixture.principal, verification: wrongGrantClock, replayed: false })), null);
  const impossibleStartable = clone(user);
  impossibleStartable.startable_methods = [];
  assert.equal(verificationUserDetailResponse(success({ contract_version: 1, principal: fixture.principal, verification: impossibleStartable })), null);
  granted.grant_revision = 2;
  assert.equal(verificationGrantMutationResponse(success({ contract_version: 1, principal: fixture.principal, verification: granted, replayed: false })), null);

  const preview = grantPreview();
  assert.ok(verificationGrantPreviewResponse(success(preview)));
  const strong = grantPreview("strong");
  assert.ok(verificationGrantPreviewResponse(success(strong)));
  strong.preview.strong_grant_warning = false;
  assert.equal(verificationGrantPreviewResponse(success(strong)), null);
});

test("all seventeen proxy normalizers accept one exact request and reject actor, secret, additive, and loose fields", () => {
  const fixture = verificationConsoleFixture();
  const policy = fixture.policies[0];
  const stored = { enabled_methods: clone(policy.draft.enabled_methods), feature_requirements: clone(policy.draft.feature_requirements) };
  const override = {
    enabled_methods: "inherit",
    feature_requirements: Object.fromEntries(VERIFICATION_FEATURE_KEYS.map((feature) => [feature, "inherit"])),
  };
  const pair = fixture.copy_pairs.find((row) => row.copy_key === "default.video")!;
  const featureCopy = { copy_key: "feature.people.list.video", behavior: clone(pair.behavior), locales: clone(pair.locales) };
  const png = Buffer.from(pngHeader()).toString("base64");
  const valid: Record<(typeof VERIFICATION_ADMIN_ACTIONS)[number], Record<string, unknown>> = {
    verification_console: { contract_version: 1, scope_kind: "all", page_size: 50, cursor: "cursor_1" },
    verification_policy_save_draft: { contract_version: 1, scope_key: "global", draft_json: stored, expected_revision: 1, request_id: UUID },
    verification_policy_impact_preview: { contract_version: 1, scope_key: "global", operation: "publish", expected_revision: 1 },
    verification_policy_apply: { contract_version: 1, scope_key: "global", operation: "publish", expected_revision: 1, normalized_fingerprint: "0".repeat(64), confirmation_phrase: "PUBLISH global", reason: "Reviewed rollout", request_id: UUID },
    verification_copy_save: { contract_version: 1, copy_json: featureCopy, expected_revision: 0, request_id: UUID },
    verification_copy_remove: { contract_version: 1, copy_key: "feature.people.list.video", reason: "Remove override", expected_revision: 1, request_id: UUID },
    verification_pending_settings_save: { contract_version: 1, overdue_after_seconds: 1_800, queue_average_long_copy_enabled: false, queue_average_threshold_seconds: 1_800, expected_revision: 1, request_id: UUID },
    verification_badge_upload: { contract_version: 1, slot: "light", png_base64: png, expected_revision: 1, request_id: UUID },
    verification_badge_remove: { contract_version: 1, slot: "light", reason: "Remove asset", expected_revision: 1, request_id: UUID },
    verification_places_city_search: { contract_version: 1, search_token: UUID, query: "Budapest", country_code: "HU" },
    verification_places_city_detail: { contract_version: 1, search_token: UUID, place_id: "ChIJ123" },
    verification_simulate: { contract_version: 1, scope_key: "global", locale: "en", simulation_json: simulationInput() },
    verification_pending_summary: { contract_version: 1 },
    verification_user_detail: { contract_version: 1, uid: 7001 },
    verification_grant_preview: { contract_version: 1, uid: 7001, level: "light", reason: "Support decision", expected_revision: 0 },
    verification_grant_save: { contract_version: 1, uid: 7001, level: "light", reason: "Support decision", expected_revision: 0, request_id: UUID },
    verification_grant_remove: { contract_version: 1, uid: 7001, reason: "Support decision ended", expected_revision: 1, request_id: UUID },
  };

  assert.deepEqual(Object.keys(valid).sort(), [...VERIFICATION_ADMIN_ACTIONS].sort());
  for (const action of VERIFICATION_ADMIN_ACTIONS) {
    const normalized = normalizeVerificationProxyBody(action, valid[action]);
    assert.ok(normalized, `${action} exact request must normalize`);
    assert.equal(normalizeVerificationProxyBody(action, { ...valid[action], admin_email: "owner@friending.com" }), null, `${action} rejects actor`);
    assert.equal(normalizeVerificationProxyBody(action, { ...valid[action], secret: "not-a-secret" }), null, `${action} rejects secret`);
    assert.equal(normalizeVerificationProxyBody(action, { ...valid[action], extra: true }), null, `${action} rejects additive fields`);
    assert.equal(normalizeVerificationProxyBody(action, { ...valid[action], contract_version: "1" }), null, `${action} rejects loose v1`);
  }
  assert.equal(normalizeVerificationProxyBody("overview", {}), undefined);

  assert.ok(normalizeVerificationProxyBody("verification_policy_save_draft", {
    contract_version: 1,
    scope_key: "city:ChIJ123",
    draft_json: override,
    place_token: "opaque_token",
    expected_revision: 0,
    request_id: UUID,
  }));
  assert.equal(normalizeVerificationProxyBody("verification_policy_save_draft", {
    contract_version: 1,
    scope_key: "city:ChIJ123",
    draft_json: override,
    expected_revision: 0,
    request_id: UUID,
  }), null, "new city requires its detail token");
  assert.equal(normalizeVerificationProxyBody("verification_policy_save_draft", {
    contract_version: 1,
    scope_key: "city:ChIJ123",
    draft_json: override,
    place_token: "opaque_token",
    expected_revision: 2,
    request_id: UUID,
  }), null, "an existing city must not accept a new identity token");
  assert.equal(normalizeVerificationProxyBody("verification_copy_remove", { ...valid.verification_copy_remove, copy_key: "default.video" }), null);
  assert.equal(normalizeVerificationProxyBody("verification_badge_remove", { ...valid.verification_badge_remove, expected_revision: 0 }), null);
  assert.equal(normalizeVerificationProxyBody("verification_pending_settings_save", { ...valid.verification_pending_settings_save, queue_average_long_copy_enabled: "0" }), null);
  assert.equal(normalizeVerificationProxyBody("verification_pending_settings_save", { ...valid.verification_pending_settings_save, queue_average_long_copy_enabled: true }), null, "A9 refuses enabling the inert v1 toggle");
  assert.equal(normalizeVerificationProxyBody("verification_simulate", {
    ...valid.verification_simulate,
    simulation_json: { ...simulationInput(), imported_method_hint: "unknown" },
  }), null);
});

test("PNG preflight checks signature, IHDR, decoded size and square dimensions before upload", () => {
  const valid = pngHeader();
  assert.equal(verificationPngBytesError(valid), null);
  assert.equal(verificationPngBytesError(valid, MAX_VERIFICATION_BADGE_BYTES + 1), "size");
  assert.equal(verificationPngBytesError(new Uint8Array()), "empty");
  const badSignature = clone(valid);
  badSignature[0] = 0;
  assert.equal(verificationPngBytesError(badSignature), "signature");
  assert.equal(verificationPngBytesError(pngHeader(15)), "dimensions");
  assert.equal(verificationPngBytesError(pngHeader(16, 17)), "dimensions");
  assert.equal(verificationPngBytesError(pngHeader(2_049)), "dimensions");
});

test("closed refusals, conflicts and uncertain-response retention never manufacture success", () => {
  for (const error of [
    "verification-request-id-invalid",
    "verification-request-in-progress",
    "verification-policy-preview-stale",
    "verification-badge-too-large",
    "verification-audit-write-failed",
  ] as const) {
    assert.equal(verificationErrorResponse(refusal(error, VERIFICATION_ERROR_STATUSES[error])), error);
  }
  assert.equal(verificationErrorResponse({ success: false, status_code: 403, error: "bad-origin" }), "bad-origin");
  assert.equal(verificationErrorResponse(refusal("verification-request-id-invalid", 409)), null);
  assert.equal(verificationErrorResponse({ ...refusal("verification-request-id-invalid", 422), extra: true }), null);
  assert.equal(verificationErrorResponse(refusal("unknown-error", 422)), null);

  assert.equal(verificationShouldRetainMutation(null), true);
  assert.equal(verificationShouldRetainMutation("verification-request-in-progress"), true);
  assert.equal(verificationShouldRetainMutation("verification-write-failed"), true);
  assert.equal(verificationShouldRetainMutation("core-timeout"), true);
  assert.equal(verificationShouldRetainMutation("verification-request-invalid"), false);

  const fixture = verificationConsoleFixture();
  const conflicts = [
    [{ contract_version: 1, policy: fixture.policies[0] }, "policy"],
    [{ contract_version: 1, copy_pair: fixture.copy_pairs[0] }, "copy"],
    [{ contract_version: 1, pending_settings: fixture.pending_settings }, "pending"],
    [{ contract_version: 1, badge: fixture.badges[0] }, "badge"],
    [{ contract_version: 1, verification: verificationUserFixture() }, "grant"],
  ] as const;
  for (const [data, kind] of conflicts) {
    assert.equal(verificationConflictResponse(refusal("verification-conflict", 409, data))?.kind, kind);
  }
  assert.equal(verificationConflictResponse(refusal("verification-conflict", 409, { contract_version: 1, policy: fixture.policies[0], extra: true })), null);
  assert.equal(verificationErrorResponse(refusal("verification-conflict", 409, { contract_version: 1, policy: fixture.policies[0] })), null);
});

test("receipt material is canonicalized and persisted before the first mutation attempt", async () => {
  const body = {
    contract_version: 1,
    uid: 7001,
    level: "light",
    reason: "Support decision",
    expected_revision: 0,
    request_id: UUID,
  };
  const pending = verificationPendingMutation("verification_grant_save", "uid:7001", body);
  assert.ok(pending);
  assert.equal(pending.action, "verification_grant_save");
  assert.equal(verificationPendingFrom({ ...pending, extra: true }), null);

  let stored = "";
  let mutations = 0;
  const result = await verificationPersistBeforeMutation({
    setItem(key, value) {
      assert.equal(key, VERIFICATION_PENDING_STORAGE_KEY);
      assert.equal(mutations, 0, "storage must happen before the request callback");
      stored = value;
    },
  }, pending, async () => {
    mutations += 1;
    return "response";
  });
  assert.deepEqual(result, { ok: true, response: "response" });
  assert.equal(mutations, 1);
  assert.deepEqual(verificationPendingFrom(JSON.parse(stored)), pending);

  mutations = 0;
  const refused = await verificationPersistBeforeMutation({ setItem() { throw new Error("disabled"); } }, pending, async () => {
    mutations += 1;
  });
  assert.deepEqual(refused, { ok: false });
  assert.equal(mutations, 0);
});

test("small presentation helpers keep Unicode bounds, expiry, tabs and max-level semantics exact", () => {
  assert.equal(verificationTabKey("badges"), "badges");
  assert.equal(verificationTabKey("unknown"), "scopes");
  assert.equal(verificationTextLength("a😀"), 2);
  assert.equal(verificationMaxLevel("none", "strong", "light"), "strong");
  assert.equal(verificationGrantDraftError({ level: "light", reason: "Support", expiresAt: null }, NOW), null);
  assert.equal(verificationGrantDraftError({ level: "none", reason: "Support", expiresAt: null }, NOW), "level");
  assert.equal(verificationGrantDraftError({ level: "light", reason: " ", expiresAt: null }, NOW), "reason");
  assert.equal(verificationGrantDraftError({ level: "light", reason: "Support", expiresAt: NOW }, NOW), "expiry");
  assert.equal(verificationGrantDraftError({ level: "strong", reason: "Support", expiresAt: NOW + 1 }, NOW), null);
});

test("route, navigation, page, console and user panel preserve every security and retry boundary", async () => {
  const [route, page, shell, layout, session, consoleSource, userPanel, userPage, actions, core] = await Promise.all([
    readFile(`${ROOT}/app/api/admin/[action]/route.ts`, "utf8"),
    readFile(`${ROOT}/app/(dashboard)/verification/page.tsx`, "utf8"),
    readFile(`${ROOT}/components/Shell.tsx`, "utf8"),
    readFile(`${ROOT}/app/(dashboard)/layout.tsx`, "utf8"),
    readFile(`${ROOT}/lib/session.ts`, "utf8"),
    readFile(`${ROOT}/components/VerificationAdminConsole.tsx`, "utf8"),
    readFile(`${ROOT}/components/VerificationUserPanel.tsx`, "utf8"),
    readFile(`${ROOT}/app/(dashboard)/users/[uid]/page.tsx`, "utf8"),
    readFile(`${ROOT}/lib/adminActions.ts`, "utf8"),
    readFile(`${ROOT}/lib/core.ts`, "utf8"),
  ]);

  assert.ok(route.indexOf("isTrustedAdminRequest") < route.indexOf("readAdminSession"));
  assert.ok(route.indexOf("isAdminActionAllowed") < route.indexOf("readAdminSession"));
  assert.ok(route.indexOf("verificationProxyCapabilityAuthorized") < route.indexOf("coreCall(\n    action"));
  assert.match(route, /normalizeVerificationProxyBody\(action, body\)/);
  assert.match(route, /Cache-Control": "no-store"/);
  assert.match(route, /mergeCoreParams\(body, \{ admin_email: session\.email \}\)/);
  assert.doesNotMatch(route, /CORE_API_BASE|WEBADMIN_API_SECRET/);
  assert.match(core, /if \(typeof value === "boolean"\) return value \? "1" : "0"/);

  assert.match(page, /if \(!VERIFICATION_CONTRACT_READY\) notFound\(\)/);
  assert.match(page, /if \(!me\?\.verificationConsoleReady\) notFound\(\)/);
  assert.match(session, /verificationAdminMe\(result\.data\.verification\)/);
  assert.match(session, /verification\.actions\.includes\("verification_console"\)/);
  assert.match(shell, /item\.key !== "verificationSettings" \|\| verificationConsoleReady/);
  assert.match(layout, /verificationConsoleReady=\{me\.verificationConsoleReady\}/);
  assert.match(actions, /ACTIVE_VERIFICATION_ADMIN_ACTIONS = VERIFICATION_CONTRACT_READY/);
  assert.match(actions, /\.\.\.ACTIVE_VERIFICATION_ADMIN_ACTIONS/);

  for (const action of VERIFICATION_ADMIN_ACTIONS) {
    assert.match(`${actions}\n${consoleSource}\n${userPanel}`, new RegExp(`"${action}"`), action);
  }
  assert.match(consoleSource, /verificationPersistBeforeMutation/);
  assert.ok(consoleSource.indexOf("verificationPersistBeforeMutation") < consoleSource.indexOf("persisted.response"));
  assert.match(consoleSource, /window\.sessionStorage\.getItem\(VERIFICATION_PENDING_STORAGE_KEY\)/);
  assert.match(consoleSource, /crypto\.randomUUID\(\)/);
  assert.match(consoleSource, /VERIFICATION_COPY_KEYS/);
  assert.match(consoleSource, /normalized_fingerprint: impact\.normalized_fingerprint/);
  assert.match(consoleSource, /confirmation !== impact\.confirmation_phrase/);
  assert.match(consoleSource, /verificationPolicyOperationsFor/);
  assert.match(consoleSource, /feature\.effective_before/);
  assert.match(consoleSource, /queue_average_long_copy_enabled: false/);
  assert.doesNotMatch(consoleSource, /queue_average_long_copy_enabled:\s*pendingLongCopy/);
  assert.match(consoleSource, /type="checkbox" checked=\{pendingLongCopy\} disabled/);
  assert.doesNotMatch(consoleSource, /setPendingLongCopy\(event\.target\.checked\)/);
  assert.match(consoleSource, /live\.longCopyV1Unavailable/);
  assert.match(consoleSource, /copyEditorLocale/);
  assert.match(consoleSource, /policy_enable_allowed/);
  assert.match(consoleSource, /completePolicyPage/);
  assert.match(consoleSource, /parsed\?\.search_token === token/);
  assert.match(consoleSource, /parsed\?\.city\.place_id === place/);
  assert.match(consoleSource, /verification-gate-preview/);
  assert.match(consoleSource, /\(\[16, 24, 40\] as const\)/);
  assert.match(consoleSource, /simulation\.badge_visible/);
  assert.match(userPanel, /verification_user_detail/);
  assert.match(userPanel, /verification_grant_preview/);
  assert.match(userPanel, /verification_grant_save/);
  assert.match(userPanel, /verification_grant_remove/);
  assert.match(userPanel, /strongConfirmed/);
  assert.match(userPage, /VERIFICATION_CONTRACT_READY \? <VerificationUserPanel/);
  assert.doesNotMatch(`${consoleSource}\n${userPanel}`, /https:\/\/core\.friending\.com|WEBADMIN_API_SECRET|fetch\(\s*["'`]https:/);
});

test("English and Hungarian UI and eleven Help topics stay key-identical and cover every rollout rule", async () => {
  const [english, hungarian] = await Promise.all([
    readFile(`${ROOT}/messages/en.json`, "utf8").then(JSON.parse),
    readFile(`${ROOT}/messages/hu.json`, "utf8").then(JSON.parse),
  ]) as [Record<string, unknown>, Record<string, unknown>];

  const keyPaths = (value: unknown, prefix = "", output: string[] = []): string[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return output;
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const path = prefix ? `${prefix}.${key}` : key;
      output.push(path);
      keyPaths((value as Record<string, unknown>)[key], path, output);
    }
    return output;
  };
  assert.deepEqual(keyPaths(english), keyPaths(hungarian));

  const en = english as { adminHelp: { pages: { verification: { sections: Record<string, unknown> } } }; verificationAdmin: unknown; userDetail: { verificationGrant: unknown } };
  const hu = hungarian as typeof en;
  const expectedSections = [
    "overview",
    "methodsAndLevels",
    "scopePrecedence",
    "scopeEditing",
    "featureMatrix",
    "gateMessages",
    "badges",
    "simulator",
    "teamGrant",
    "conflictsAndRetry",
    "privacyAndAudit",
  ];
  assert.deepEqual(Object.keys(en.adminHelp.pages.verification.sections), expectedSections);
  assert.deepEqual(Object.keys(hu.adminHelp.pages.verification.sections), expectedSections);
  assert.deepEqual(keyPaths(en.verificationAdmin), keyPaths(hu.verificationAdmin));
  assert.deepEqual(keyPaths(en.userDetail.verificationGrant), keyPaths(hu.userDetail.verificationGrant));
  assert.match(JSON.stringify(en.verificationAdmin), /Not available in v1/);
  assert.match(JSON.stringify(hu.verificationAdmin), /Az 1\. verzióban nem érhető el/);

  const help = `${JSON.stringify(en.adminHelp.pages.verification)}\n${JSON.stringify(hu.adminHelp.pages.verification)}`;
  for (const evidence of [
    "registration or IP country",
    "draft",
    "fingerprint",
    "30 minutes",
    "2 MiB",
    "pink seal",
    "max(derived",
    "request id",
    "provider keys",
    "all-None",
    "parent-derived effective-before",
    "not available in v1",
    "regisztrációs vagy IP-országát",
    "fingerprinthez",
    "30 perc",
    "rózsaszín pecsét",
  ]) assert.match(help, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), evidence);
  assert.doesNotMatch(help, /all eleven|mind a tizenegy|dormant|nyugalmi|local calculation|helyi számítás/i);
});
