import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import {
  AUDIENCE_VISIBILITY_ADMIN_ACTIONS,
  AUDIENCE_VISIBILITY_CAPABILITIES,
  AUDIENCE_VISIBILITY_GENDERS,
  AUDIENCE_VISIBILITY_INITIAL_INTENT_KEYS,
  AUDIENCE_VISIBILITY_LEGACY_TYPES,
  AUDIENCE_VISIBILITY_MUTATION_ACTIONS,
  AUDIENCE_VISIBILITY_PENDING_STORAGE_KEY,
  AUDIENCE_VISIBILITY_VALUES,
  audienceVisibilityAdminMe,
  audienceVisibilityCatalogResponse,
  audienceVisibilityConflict,
  audienceVisibilityConflictMatchesPending,
  audienceVisibilityError,
  audienceVisibilityGroupDraft,
  audienceVisibilityGroupMutationResponse,
  audienceVisibilityIntentMutationResponse,
  audienceVisibilityMemberDetailResponse,
  audienceVisibilityMutationConverged,
  audienceVisibilityPendingFrom,
  audienceVisibilityPendingMutation,
  audienceVisibilityPersistBeforeMutation,
  audienceVisibilityProxyCapabilityAuthorized,
  audienceVisibilityShouldRetainMutation,
  audienceVisibilityTab,
  normalizeAudienceVisibilityProxyBody,
} from "../lib/audienceVisibilityAdmin.ts";
import {
  ADMIN_ACTIONS,
  adminActionAccess,
  adminPrincipalFrom,
  isAdminBridgeActionAuthorized,
} from "../lib/adminActions.ts";
import { AUDIENCE_VISIBILITY_CONTRACT_READY } from "../lib/contractReadiness.ts";
import { adminHelpPageForPath } from "../lib/adminHelp.ts";

type Json = Record<string, any>;

const UUID = "12345678-1234-4234-8234-123456789abc";
const FIXTURE_DIRECTORY = new URL("./fixtures/audience_visibility_admin_wire/", import.meta.url);
const IDS = Array.from({ length: 8 }, (_, index) => (index + 1).toString(16).padStart(24, "0"));
const PROTECTED = [
  ["male_for_male", "man", "male", "male_gay"],
  ["male_for_female", "man", "female", "male_hetero"],
  ["male_for_both", "man", "both", "male_bisexual"],
  ["female_for_male", "woman", "male", "female_hetero"],
  ["female_for_female", "woman", "female", "female_lesbian"],
  ["female_for_both", "woman", "both", "female_bisexual"],
  ["nonbinary_for_both", "nonbinary", "both", "other"],
] as const;

function success(data: unknown): Json {
  return { success: true, status_code: 200, data, message: 200, status: 200, can_send: 0 };
}

function refusal(error: string, statusCode: number, data?: unknown): Json {
  return data === undefined
    ? { success: false, status_code: statusCode, error, message: 200, status: 200, can_send: 0 }
    : { success: false, status_code: statusCode, error, data, message: 200, status: 200, can_send: 0 };
}

function group(index: number): Json {
  const [key, gender, visibleTo, legacy] = PROTECTED[index];
  return {
    id: IDS[index],
    key,
    labels: { en: `Group ${index + 1}`, hu: `${index + 1}. csoport` },
    rules: [{ genders: [gender], visible_to: [visibleTo] }],
    legacy_segment: legacy,
    sort_order: index + 1,
    active: true,
    protected: true,
    revision: 1,
    editable_fields: ["labels", "sort_order"],
  };
}

const INTENT_LABELS: Record<string, [string, string]> = {
  people_to_meet_irl: ["People to meet IRL", "Élőben találkozni"],
  couple_friends: ["Couple friends", "Páros barátok"],
  gaming: ["Gaming", "Gaming"],
  volunteer: ["Volunteer", "Önkénteskedés"],
  workouts_sports: ["Workouts & Sports", "Edzés és sport"],
  travel: ["Travel", "Utazás"],
  live_music: ["Live music", "Élő zene"],
  nights_out: ["Nights out", "Esti programok"],
  coworking: ["Coworking", "Coworking"],
  faith_studies: ["Faith studies", "Hitélet"],
  arts_culture: ["Arts & Culture", "Művészet és kultúra"],
  roommate: ["Roommate", "Lakótárs"],
  kid_playdates: ["Kid playdates", "Gyerekprogramok"],
  anything: ["Anything", "Bármi"],
};

function intents(): Json {
  return {
    schema_version: 2,
    title: { en: "What are you looking for?", hu: "Mit keresel?" },
    intents_revision: 4,
    selection_min: 0,
    selection_max: 5,
    items: AUDIENCE_VISIBILITY_INITIAL_INTENT_KEYS.map((key, index) => ({
      key,
      labels: { en: INTENT_LABELS[key][0], hu: INTENT_LABELS[key][1] },
      sort_order: index + 1,
      archived: false,
    })),
  };
}

function catalog(): Json {
  return {
    contract_version: 1,
    gender_values: [...AUDIENCE_VISIBILITY_GENDERS],
    visible_to_values: [...AUDIENCE_VISIBILITY_VALUES],
    groups: PROTECTED.map((_, index) => group(index)),
    group_manifest_sha256: "1".repeat(64),
    retirement_manifest: {
      sha256: "2".repeat(64),
      matching_orientation: "retired",
      layer1_intent: "retired",
      legacy_catalogue_types: [...AUDIENCE_VISIBILITY_LEGACY_TYPES],
      profile_questions: [
        { key: "dick_size", labels: { en: "Penis size", hu: "Péniszméret" }, reason: "sex_or_anatomy", state: "retired" },
        { key: "circumcision", labels: { en: "Circumcision", hu: "Körülmetélés" }, reason: "sex_or_anatomy", state: "retired" },
        { key: "sexual_position", labels: { en: "Position", hu: "Pozíció" }, reason: "sex_or_anatomy", state: "retired" },
        { key: "safer_sex", labels: { en: "Safer sex", hu: "Biztonságosabb szex" }, reason: "sex_or_anatomy", state: "retired" },
      ],
      retained_questions: [{
        key: "body_hair",
        labels: { en: "Body hair", hu: "Testszőrzet" },
        state: "active",
        change: "neutral_general_all_groups",
      }],
    },
    intents: intents(),
  };
}

function editorAdminMe(ready = true): Json {
  return {
    contract_version: 1,
    contract_ready: ready,
    principal: { role: "editor", capabilities: [...AUDIENCE_VISIBILITY_CAPABILITIES] },
    actions: ready ? [...AUDIENCE_VISIBILITY_ADMIN_ACTIONS] : [],
  };
}

function catalogueAdminMe(role: "viewer" | "editor" | "approver" | "owner"): Json {
  const writable = role !== "viewer";
  return {
    contract_version: 1,
    contract_ready: true,
    principal: {
      role,
      capabilities: writable
        ? [...AUDIENCE_VISIBILITY_CAPABILITIES]
        : AUDIENCE_VISIBILITY_CAPABILITIES.slice(0, 2),
    },
    actions: writable
      ? [...AUDIENCE_VISIBILITY_ADMIN_ACTIONS]
      : AUDIENCE_VISIBILITY_ADMIN_ACTIONS.slice(0, 2),
  };
}

test("the released v1 vocabulary pins seven actions, four capabilities, and the D-019 axes", () => {
  // T-539 flipped the cutover switch. The vocabulary itself is unchanged; what
  // changes is that the seven actions now reach the proxy allow-list and the
  // access ladder. Core remains authoritative on every one of them.
  assert.equal(AUDIENCE_VISIBILITY_CONTRACT_READY, true);
  assert.deepEqual(AUDIENCE_VISIBILITY_GENDERS, ["man", "woman", "nonbinary"]);
  assert.deepEqual(AUDIENCE_VISIBILITY_VALUES, ["male", "female", "both"]);
  assert.deepEqual(AUDIENCE_VISIBILITY_CAPABILITIES, [
    "audience_visibility_catalog_read",
    "audience_visibility_member_read",
    "audience_visibility_group_write",
    "audience_visibility_intent_write",
  ]);
  assert.equal(AUDIENCE_VISIBILITY_ADMIN_ACTIONS.length, 7);
  assert.deepEqual(
    ADMIN_ACTIONS.filter((action) => AUDIENCE_VISIBILITY_ADMIN_ACTIONS.includes(action as any)),
    [...AUDIENCE_VISIBILITY_ADMIN_ACTIONS],
  );
  // The two reads must stay reads, so a viewer keeps catalogue and member
  // access; the five mutations must stay writes, so a viewer never reaches one.
  assert.equal(adminActionAccess("audience_visibility_catalog"), "read");
  assert.equal(adminActionAccess("audience_visibility_member_detail"), "read");
  for (const action of AUDIENCE_VISIBILITY_MUTATION_ACTIONS) {
    assert.equal(adminActionAccess(action), "write", action);
  }
  for (const action of AUDIENCE_VISIBILITY_ADMIN_ACTIONS) {
    assert.ok(adminActionAccess(action), `${action} must be classified`);
  }
});

test("admin_me ignores unknown fields, stays role-derived, action-ordered, and contract-ready gated", () => {
  assert.ok(audienceVisibilityAdminMe(editorAdminMe()));
  assert.ok(audienceVisibilityAdminMe(editorAdminMe(false)));
  assert.deepEqual(
    audienceVisibilityAdminMe({ ...editorAdminMe(), extra: true }),
    audienceVisibilityAdminMe(editorAdminMe()),
  );
  assert.equal(audienceVisibilityAdminMe({ ...editorAdminMe(), actions: [...AUDIENCE_VISIBILITY_ADMIN_ACTIONS].reverse() }), null);
  assert.equal(audienceVisibilityAdminMe({ ...editorAdminMe(false), actions: ["audience_visibility_catalog"] }), null);

  const viewer = {
    contract_version: 1,
    contract_ready: true,
    principal: { role: "viewer", capabilities: AUDIENCE_VISIBILITY_CAPABILITIES.slice(0, 2) },
    actions: AUDIENCE_VISIBILITY_ADMIN_ACTIONS.slice(0, 2),
  };
  assert.ok(audienceVisibilityAdminMe(viewer));
  assert.equal(audienceVisibilityAdminMe({ ...viewer, principal: { ...viewer.principal, capabilities: [] } }), null);
  assert.equal(audienceVisibilityAdminMe({
    contract_version: 1,
    contract_ready: false,
    principal: { role: "", capabilities: [] },
    actions: [],
  })?.principal.role, "");
});

test("the proxy capability decision trusts only the additive admin_me block", () => {
  const membership = { success: true, role: "viewer", audience_visibility: editorAdminMe() };
  for (const action of AUDIENCE_VISIBILITY_ADMIN_ACTIONS) {
    assert.equal(audienceVisibilityProxyCapabilityAuthorized(action, membership), true);
  }
  assert.equal(audienceVisibilityProxyCapabilityAuthorized("overview", membership), null);
  assert.equal(audienceVisibilityProxyCapabilityAuthorized("save_audience_visibility_group", {
    ...membership,
    audience_visibility: editorAdminMe(false),
  }), false);
  assert.equal(audienceVisibilityProxyCapabilityAuthorized("audience_visibility_catalog", {
    ...membership,
    audience_visibility: { ...editorAdminMe(), extra: true },
  }), true);
});

test("bridge authorization composes the independent catalogue role without weakening other families", () => {
  const globalViewer = adminPrincipalFrom({ role: "viewer" });
  for (const catalogueRole of ["editor", "approver", "owner"] as const) {
    const membership = {
      success: true,
      role: "viewer",
      audience_visibility: catalogueAdminMe(catalogueRole),
    };
    for (const action of AUDIENCE_VISIBILITY_ADMIN_ACTIONS) {
      const capability = audienceVisibilityProxyCapabilityAuthorized(action, membership);
      assert.equal(capability, true, `${catalogueRole} capability for ${action}`);
      assert.equal(
        isAdminBridgeActionAuthorized(action, globalViewer, capability),
        true,
        `top-level viewer with catalogue ${catalogueRole} may ${action}`,
      );
    }
  }

  const catalogueViewer = {
    success: true,
    role: "viewer",
    audience_visibility: catalogueAdminMe("viewer"),
  };
  for (const [index, action] of AUDIENCE_VISIBILITY_ADMIN_ACTIONS.entries()) {
    const capability = audienceVisibilityProxyCapabilityAuthorized(action, catalogueViewer);
    assert.equal(capability, index < 2);
    assert.equal(isAdminBridgeActionAuthorized(action, globalViewer, capability), index < 2);
  }

  const absentCapability = audienceVisibilityProxyCapabilityAuthorized(
    "save_audience_visibility_group",
    { success: true, role: "viewer" },
  );
  assert.equal(absentCapability, false);
  assert.equal(isAdminBridgeActionAuthorized("save_audience_visibility_group", globalViewer, absentCapability), false);
  const additiveCapability = audienceVisibilityProxyCapabilityAuthorized(
    "save_audience_visibility_group",
    { success: true, role: "viewer", audience_visibility: { ...catalogueAdminMe("editor"), extra: true } },
  );
  assert.equal(additiveCapability, true);
  assert.equal(isAdminBridgeActionAuthorized("save_audience_visibility_group", globalViewer, additiveCapability), true);

  assert.equal(isAdminBridgeActionAuthorized("save_hero", globalViewer, true), false);
});

test("the complete catalogue ignores unknown fields while semantic surprises fail closed", () => {
  const fixture = catalog();
  const parsed = audienceVisibilityCatalogResponse(success(fixture));
  assert.ok(parsed);
  assert.equal(parsed.groups.length, 7);
  assert.equal(parsed.groups[2].legacy_segment, "male_bisexual");
  assert.equal(parsed.groups[5].legacy_segment, "female_bisexual");
  assert.equal(parsed.intents.selection_min, 0);
  assert.equal(parsed.intents.selection_max, 5);

  const additive = structuredClone(fixture);
  additive.extra = true;
  additive.groups[0].future = true;
  additive.groups[0].labels.future = "ignored";
  additive.groups[0].rules[0].future = true;
  additive.retirement_manifest.future = true;
  additive.retirement_manifest.profile_questions[0].future = true;
  additive.intents.future = true;
  additive.intents.title.future = "ignored";
  additive.intents.items[0].future = true;
  assert.deepEqual(audienceVisibilityCatalogResponse({ ...success(additive), trace: "no" }), parsed);
  const loose = structuredClone(fixture);
  loose.groups[0].revision = "1";
  assert.equal(audienceVisibilityCatalogResponse(success(loose)), null);
  const wrongProtected = structuredClone(fixture);
  wrongProtected.groups[2].legacy_segment = "male_bi";
  assert.equal(audienceVisibilityCatalogResponse(success(wrongProtected)), null);
  const impossibleNonbinary = structuredClone(fixture);
  impossibleNonbinary.groups[6].rules[0].visible_to = ["male"];
  assert.equal(audienceVisibilityCatalogResponse(success(impossibleNonbinary)), null);
  const missingIntent = structuredClone(fixture);
  missingIntent.intents.items.pop();
  assert.equal(audienceVisibilityCatalogResponse(success(missingIntent)), null);
  const wrongRetirement = structuredClone(fixture);
  wrongRetirement.retirement_manifest.profile_questions[0].state = "active";
  assert.equal(audienceVisibilityCatalogResponse(success(wrongRetirement)), null);
});

test("all 43 published Core Webadmin fixtures are unchanged, manifest-bound, and decode by case", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", FIXTURE_DIRECTORY), "utf8"));
  assert.deepEqual(Object.keys(manifest), [
    "schema_version",
    "source_commit",
    "fixture_set_sha256",
    "provenance",
    "fixtures",
  ]);
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.source_commit, "624fd8cf46391e109b365f56270bf5ef5ade2ada");
  assert.equal(manifest.fixture_set_sha256, "7ba888e46cd6b7bc6322cd70eb04b47f102445a3fdea20ce7e00cb06563656e2");
  assert.equal(manifest.provenance.generator, "tests/audience_visibility_fixture_dump.php");
  assert.equal(manifest.provenance.admin_wire_adapter, "Friending\\Support\\Webadmin::noStoreReply");

  const rows = manifest.fixtures.filter((row: Json) => row.consumer === "webadmin");
  assert.equal(rows.length, 43);
  const expectedFiles = [
    "admin-me-dormant-editor.json",
    "admin-me-ready-viewer.json",
    "admin-me-ready-editor.json",
    "admin-me-ready-approver.json",
    "admin-me-ready-owner.json",
    "admin-me-revoked.json",
    "admin-catalog.json",
    "admin-member-binary.json",
    "admin-member-nonbinary.json",
    "admin-member-unresolved.json",
    "admin-group-create.json",
    "admin-group-update.json",
    "admin-group-noop.json",
    "admin-group-archive.json",
    "admin-group-restore.json",
    "admin-group-replay.json",
    "admin-group-conflict.json",
    "admin-group-protected.json",
    "admin-intent-create.json",
    "admin-intent-edit.json",
    "admin-intent-noop.json",
    "admin-intent-archive.json",
    "admin-intent-restore.json",
    "admin-intent-limit.json",
    "admin-intent-replay.json",
    "admin-intent-conflict.json",
    "admin-error-unauthorized.json",
    "admin-error-session-invalid.json",
    "admin-error-revoked.json",
    "admin-error-capability.json",
    "admin-error-version-required.json",
    "admin-error-version-invalid.json",
    "admin-error-request-invalid.json",
    "admin-error-request-id-invalid.json",
    "admin-error-request-id-conflict.json",
    "admin-error-request-in-progress.json",
    "admin-error-group-invalid.json",
    "admin-error-group-not-found.json",
    "admin-error-member-not-found.json",
    "admin-error-stored-invalid.json",
    "admin-error-schema-unavailable.json",
    "admin-error-write-failed.json",
    "admin-error-audit-write-failed.json",
  ];
  assert.deepEqual(rows.map((row: Json) => row.file), expectedFiles);
  assert.deepEqual((await readdir(FIXTURE_DIRECTORY)).sort(), [...expectedFiles, "manifest.json"].sort());

  for (const row of rows) {
    assert.deepEqual(Object.keys(row), ["file", "route", "case", "consumer", "sha256"]);
    const bytes = await readFile(new URL(row.file, FIXTURE_DIRECTORY));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), row.sha256, `${row.file} changed after Core publication`);
    const body = JSON.parse(bytes.toString("utf8"));
    if (row.file === "admin-catalog.json") {
      assert.ok(audienceVisibilityCatalogResponse(body), row.file);
    } else if (row.file.startsWith("admin-me-")) {
      assert.ok(audienceVisibilityAdminMe(body.data?.audience_visibility), row.file);
    } else if (row.file === "admin-group-conflict.json" || row.file === "admin-intent-conflict.json") {
      assert.ok(audienceVisibilityConflict(body), row.file);
    } else if (row.file.startsWith("admin-group-") && row.file !== "admin-group-protected.json") {
      assert.ok(audienceVisibilityGroupMutationResponse(body), row.file);
    } else if (row.file.startsWith("admin-intent-")) {
      assert.ok(audienceVisibilityIntentMutationResponse(body), row.file);
    } else if (row.file.startsWith("admin-member-")) {
      assert.ok(audienceVisibilityMemberDetailResponse(body), row.file);
    } else {
      assert.ok(audienceVisibilityError(body), row.file);
    }
  }
});

test("custom group material enforces canonical rules and the nonbinary fixed state", () => {
  const valid = {
    key: "friends_in_budapest",
    labels: { en: "Friends in Budapest", hu: "Budapesti barátok" },
    rules: [
      { genders: ["man", "woman"], visible_to: ["male", "female", "both"] },
      { genders: ["nonbinary"], visible_to: ["both"] },
    ],
    sort_order: 20,
    active: true,
  };
  assert.deepEqual(audienceVisibilityGroupDraft(valid), valid);
  assert.equal(audienceVisibilityGroupDraft({ ...valid, extra: true }), null);
  assert.equal(audienceVisibilityGroupDraft({ ...valid, rules: [{ genders: ["woman", "man"], visible_to: ["both"] }] }), null);
  assert.equal(audienceVisibilityGroupDraft({ ...valid, rules: [{ genders: ["nonbinary"], visible_to: ["male", "both"] }] }), null);
  assert.equal(audienceVisibilityGroupDraft({ ...valid, labels: { en: " x", hu: "x" } }), null);
  assert.equal(audienceVisibilityGroupDraft({ ...valid, labels: { en: "Two  spaces", hu: "Két szóköz" } }), null);
});

test("member detail exposes only canonical known fields and one protected group", () => {
  const resolved = {
    contract_version: 1,
    uid: 7001,
    gender: "woman",
    visible_to: "both",
    revision: 3,
    group: { id: IDS[5], key: "female_for_both", legacy_segment: "female_bisexual" },
  };
  assert.deepEqual(audienceVisibilityMemberDetailResponse(success(resolved)), resolved);
  const unresolved = { ...resolved, gender: null, visible_to: "both", group: null };
  assert.deepEqual(audienceVisibilityMemberDetailResponse(success(unresolved)), unresolved);
  assert.equal(audienceVisibilityMemberDetailResponse(success({ ...unresolved, visible_to: "male" })), null);
  assert.equal(audienceVisibilityMemberDetailResponse(success({ ...resolved, group: { ...resolved.group, key: "female_for_male" } })), null);
  assert.deepEqual(
    audienceVisibilityMemberDetailResponse(success({ ...resolved, orientation: "bisexual", group: { ...resolved.group, future: true } })),
    resolved,
  );
});

test("group and intent mutation responses ignore unknown fields and conflicts adopt canonical resources", () => {
  const groupResult = { contract_version: 1, group: group(0), replayed: false };
  const intentResult = { contract_version: 1, intents: intents(), replayed: true };
  assert.ok(audienceVisibilityGroupMutationResponse(success(groupResult)));
  assert.ok(audienceVisibilityIntentMutationResponse(success(intentResult)));
  assert.equal(audienceVisibilityGroupMutationResponse(success({ ...groupResult, replayed: 0 })), null);
  assert.deepEqual(
    audienceVisibilityIntentMutationResponse(success({ ...intentResult, extra: true })),
    audienceVisibilityIntentMutationResponse(success(intentResult)),
  );

  assert.deepEqual(audienceVisibilityConflict(refusal("audience-visibility-conflict", 409, {
    contract_version: 1,
    group: group(1),
  }))?.kind, "group");
  assert.deepEqual(audienceVisibilityConflict(refusal("audience-visibility-conflict", 409, {
    contract_version: 1,
    intents: intents(),
  }))?.kind, "intents");
  assert.deepEqual(audienceVisibilityConflict(refusal("audience-visibility-conflict", 409, {
    contract_version: 1,
    group: group(1),
    draft: {},
  })), audienceVisibilityConflict(refusal("audience-visibility-conflict", 409, {
    contract_version: 1,
    group: group(1),
  })));
  assert.equal(audienceVisibilityConflict(refusal("audience-visibility-conflict", 409, {
    contract_version: 1,
    group: group(1),
    intents: intents(),
  })), null, "recognized sibling branches remain mutually exclusive");
});

test("success and conflict adoption are bound to the exact persisted target and material", () => {
  const currentGroup = group(0);
  const groupPending = audienceVisibilityPendingMutation("save_audience_visibility_group", currentGroup.id, {
    contract_version: 1,
    request_id: UUID,
    expected_revision: 1,
    audit_reason: "Reviewed no-op",
    id: currentGroup.id,
    group_key: currentGroup.key,
    labels_json: currentGroup.labels,
    rules_json: currentGroup.rules,
    sort_order: currentGroup.sort_order,
    active: currentGroup.active,
  });
  assert.ok(groupPending);
  const groupResult = { contract_version: 1 as const, group: currentGroup as any, replayed: false };
  assert.equal(audienceVisibilityMutationConverged(groupPending, groupResult), true);
  assert.equal(audienceVisibilityMutationConverged(groupPending, {
    ...groupResult,
    group: { ...currentGroup, labels: { en: "Wrong", hu: "Hibás" } } as any,
  }), false);
  assert.equal(audienceVisibilityConflictMatchesPending(groupPending, { kind: "group", group: currentGroup as any }), true);
  assert.equal(audienceVisibilityConflictMatchesPending(groupPending, { kind: "group", group: group(1) as any }), false);

  const intentPending = audienceVisibilityPendingMutation("archive_audience_visibility_intent", "gaming", {
    contract_version: 1,
    request_id: UUID,
    expected_intents_revision: 4,
    audit_reason: "Reviewed archive",
    key: "gaming",
    archived: true,
  });
  assert.ok(intentPending);
  const archivedIntents = intents();
  archivedIntents.intents_revision = 5;
  archivedIntents.items.find((row: Json) => row.key === "gaming").archived = true;
  const intentResult = { contract_version: 1 as const, intents: archivedIntents as any, replayed: false };
  assert.equal(audienceVisibilityMutationConverged(intentPending, intentResult), true);
  archivedIntents.items.find((row: Json) => row.key === "gaming").archived = false;
  assert.equal(audienceVisibilityMutationConverged(intentPending, intentResult), false);
  assert.equal(audienceVisibilityConflictMatchesPending(intentPending, { kind: "intents", intents: intents() as any }), true);
  assert.equal(audienceVisibilityConflictMatchesPending(intentPending, { kind: "group", group: currentGroup as any }), false);
});

test("all seven proxy bodies normalize one exact canonical command and reject caller-owned or loose material", () => {
  const custom = {
    key: "local_friends",
    labels: { en: "Local friends", hu: "Helyi barátok" },
    rules: [{ genders: ["man", "woman"], visible_to: ["both"] }],
    sort_order: 50,
    active: true,
  };
  const bodies: Record<string, Json> = {
    audience_visibility_catalog: { contract_version: 1 },
    audience_visibility_member_detail: { contract_version: 1, uid: 7001 },
    save_audience_visibility_group: {
      contract_version: 1,
      request_id: UUID,
      expected_revision: 0,
      audit_reason: "Create reviewed content group",
      id: "",
      group_key: custom.key,
      labels_json: custom.labels,
      rules_json: custom.rules,
      sort_order: custom.sort_order,
      active: true,
    },
    archive_audience_visibility_group: {
      contract_version: 1,
      request_id: UUID,
      expected_revision: 2,
      audit_reason: "Pause retired campaign audience",
      id: IDS[7],
      archived: true,
    },
    save_audience_visibility_intent: {
      contract_version: 1,
      request_id: UUID,
      expected_intents_revision: 4,
      audit_reason: "Clarify translated label",
      key: "gaming",
      labels_json: { en: "Gaming", hu: "Játék" },
      sort_order: 3,
    },
    archive_audience_visibility_intent: {
      contract_version: 1,
      request_id: UUID,
      expected_intents_revision: 4,
      audit_reason: "Temporarily unavailable",
      key: "gaming",
      archived: true,
    },
    set_audience_visibility_intent_limit: {
      contract_version: 1,
      request_id: UUID,
      expected_intents_revision: 4,
      audit_reason: "Align current app selector",
      selection_max: 4,
    },
  };

  for (const action of AUDIENCE_VISIBILITY_ADMIN_ACTIONS) {
    const body = bodies[action];
    const normalized = normalizeAudienceVisibilityProxyBody(action, body);
    assert.ok(normalized, `${action} must accept its exact body`);
    assert.equal(normalizeAudienceVisibilityProxyBody(action, { ...body, admin_email: "caller@example.com" }), null);
    assert.equal(normalizeAudienceVisibilityProxyBody(action, { ...body, secret: "caller" }), null);
    assert.equal(normalizeAudienceVisibilityProxyBody(action, { ...body, contract_version: "1" }), null);
  }
  assert.equal(normalizeAudienceVisibilityProxyBody("overview", {}), undefined);
  assert.equal(normalizeAudienceVisibilityProxyBody("save_audience_visibility_group", {
    ...bodies.save_audience_visibility_group,
    labels_json: '{"hu":"Helyi barátok","en":"Local friends"}',
  }), null);
  assert.equal(normalizeAudienceVisibilityProxyBody("save_audience_visibility_group", {
    ...bodies.save_audience_visibility_group,
    rules_json: [{ genders: ["nonbinary"], visible_to: ["female"] }],
  }), null);
  assert.equal(normalizeAudienceVisibilityProxyBody("set_audience_visibility_intent_limit", {
    ...bodies.set_audience_visibility_intent_limit,
    selection_max: 6,
  }), null);
  assert.equal(normalizeAudienceVisibilityProxyBody("archive_audience_visibility_intent", {
    ...bodies.archive_audience_visibility_intent,
    request_id: UUID.toUpperCase(),
  }), null);
});

test("pending mutation identity is canonical, target-bound, and persisted before the first call", async () => {
  const payload = {
    contract_version: 1,
    request_id: UUID,
    expected_intents_revision: 4,
    audit_reason: "Reviewed archive",
    key: "gaming",
    archived: true,
  };
  const pending = audienceVisibilityPendingMutation("archive_audience_visibility_intent", "gaming", payload);
  assert.ok(pending);
  assert.deepEqual(audienceVisibilityPendingFrom(JSON.parse(JSON.stringify(pending))), pending);
  assert.equal(audienceVisibilityPendingFrom({ ...pending, extra: true }), null);
  assert.equal(audienceVisibilityPendingFrom({ ...pending, payload: { ...payload, key: "travel" } }), null);
  assert.equal(audienceVisibilityPendingFrom({ ...pending, payload: { ...payload, admin_email: "caller@example.com" } }), null);

  const order: string[] = [];
  let stored = "";
  const result = await audienceVisibilityPersistBeforeMutation({
    setItem(key: string, value: string) {
      assert.equal(key, AUDIENCE_VISIBILITY_PENDING_STORAGE_KEY);
      stored = value;
      order.push("stored");
    },
  }, pending!, async () => {
    order.push("called");
    return "response";
  });
  assert.deepEqual(order, ["stored", "called"]);
  assert.deepEqual(result, { ok: true, response: "response" });
  assert.deepEqual(audienceVisibilityPendingFrom(JSON.parse(stored)), pending);

  let called = false;
  const failed = await audienceVisibilityPersistBeforeMutation({ setItem() { throw new Error("private mode"); } }, pending!, async () => {
    called = true;
  });
  assert.deepEqual(failed, { ok: false });
  assert.equal(called, false);
});

test("closed errors and uncertain response policy never manufacture success", () => {
  assert.equal(audienceVisibilityError(refusal("audience-visibility-group-invalid", 422)), "audience-visibility-group-invalid");
  assert.equal(audienceVisibilityError(refusal("audience-visibility-group-invalid", 409)), null);
  assert.equal(audienceVisibilityError(refusal("unknown", 503)), null);
  assert.equal(audienceVisibilityError({ success: false, status_code: 403, error: "admin-write-required" }), "admin-write-required");
  assert.equal(audienceVisibilityError({ success: false, status_code: 504, error: "core-timeout" }), "core-timeout");
  assert.equal(audienceVisibilityShouldRetainMutation("audience-visibility-request-in-progress"), true);
  assert.equal(audienceVisibilityShouldRetainMutation("audience-visibility-write-failed"), true);
  assert.equal(audienceVisibilityShouldRetainMutation("audience-visibility-stored-invalid"), true);
  assert.equal(audienceVisibilityShouldRetainMutation("core-timeout"), true);
  assert.equal(audienceVisibilityShouldRetainMutation(null), true);
  assert.equal(audienceVisibilityShouldRetainMutation("audience-visibility-group-invalid"), false);
  assert.equal(audienceVisibilityShouldRetainMutation("audience-visibility-request-id-conflict"), false);
  assert.equal(audienceVisibilityShouldRetainMutation("admin-write-required"), false);
});

test("tabs are closed and invalid input falls back to the safe inventory", () => {
  assert.equal(audienceVisibilityTab("retirement"), "retirement");
  assert.equal(audienceVisibilityTab("intents"), "intents");
  assert.equal(audienceVisibilityTab("orientation"), "groups");
  assert.equal(audienceVisibilityTab(["groups"]), "groups");
});

test("route, shell, bridge, console, member panel, and Help share one cutover switch", async () => {
  const [page, shell, bridge, session, actions, consoleSource, memberPage, memberPanel, help, en, hu] = await Promise.all([
    readFile(new URL("../app/(dashboard)/audience-visibility/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/Shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/session.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/adminActions.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/AudienceVisibilityAdminConsole.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(dashboard)/users/[uid]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/AudienceVisibilityUserPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/adminHelp.ts", import.meta.url), "utf8"),
    readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
    readFile(new URL("../messages/hu.json", import.meta.url), "utf8"),
  ]);
  assert.match(page, /if \(!AUDIENCE_VISIBILITY_CONTRACT_READY\) notFound\(\)/);
  assert.match(page, /audienceVisibilityConsoleReady/);
  assert.match(shell, /item\.key !== "audienceVisibility" \|\| audienceVisibilityConsoleReady/);
  // T-565: the two replaced pages are gone, not conditionally hidden. The
  // clause that removed them on the build constant ALONE — the one site that
  // was not ANDed with `audienceVisibilityConsoleReady`, so a dormant Core left
  // an operator with neither surface — went with them.
  assert.doesNotMatch(shell, /key: "userGroups"|key: "layer2Intents"/);
  assert.doesNotMatch(shell, /"\/user-groups"|"\/layer2-intents"/);
  // The only remaining use of the constant in the shell is the one that OPENS
  // the replacement, so a dormant Core can no longer remove a working entry.
  assert.equal((shell.match(/AUDIENCE_VISIBILITY_CONTRACT_READY/gu) ?? []).length, 2);
  assert.match(shell, /ready: AUDIENCE_VISIBILITY_CONTRACT_READY/);
  assert.match(bridge, /audienceVisibilityProxyCapabilityAuthorized/);
  assert.match(bridge, /normalizeAudienceVisibilityProxyBody/);
  assert.match(session, /audienceVisibilityAdminMe\(result\.data\.audience_visibility\)/);
  assert.match(actions, /ACTIVE_AUDIENCE_VISIBILITY_ADMIN_ACTIONS/);
  assert.match(memberPage, /AUDIENCE_VISIBILITY_CONTRACT_READY \? <AudienceVisibilityUserPanel/);
  assert.match(memberPanel, /audience_visibility_member_detail/);
  assert.doesNotMatch(memberPanel, /user_detail/);
  assert.match(consoleSource, /audienceVisibilityPersistBeforeMutation/);
  assert.match(consoleSource, /sessionStorage/);
  assert.match(consoleSource, /archive_audience_visibility_group/);
  assert.match(consoleSource, /set_audience_visibility_intent_limit/);
  assert.doesNotMatch(consoleSource, /visibility_mode|reciprocal_set_id|layer1_json|orientationChoices/);
  assert.match(help, /route: "\/audience-visibility"/);

  const enMessages = JSON.parse(en);
  const huMessages = JSON.parse(hu);
  assert.equal(enMessages.audienceVisibilityAdmin.visibleTo.male, "Men");
  assert.equal(huMessages.audienceVisibilityAdmin.visibleTo.male, "Férfiak");
  assert.equal(enMessages.audienceVisibilityAdmin.visibleTo.female, "Women");
  assert.equal(huMessages.audienceVisibilityAdmin.visibleTo.female, "Nők");
  assert.equal(enMessages.audienceVisibilityAdmin.visibleTo.both, "Everyone");
  assert.equal(huMessages.audienceVisibilityAdmin.visibleTo.both, "Mindenki");
  assert.equal(enMessages.userDetail.audienceVisibility.title, "Who can see my profile");
  assert.equal(huMessages.userDetail.audienceVisibility.title, "Ki láthatja a profilomat");
  assert.equal(Object.keys(enMessages.adminHelp.pages.audienceVisibility.sections).length, 8);
  assert.deepEqual(
    Object.keys(enMessages.audienceVisibilityAdmin).sort(),
    Object.keys(huMessages.audienceVisibilityAdmin).sort(),
  );
});

test("there is no member mutation action in the closed surface", () => {
  assert.equal(AUDIENCE_VISIBILITY_ADMIN_ACTIONS.some((action) => action.includes("member") && !action.endsWith("detail")), false);
  assert.equal(AUDIENCE_VISIBILITY_ADMIN_ACTIONS.some((action) => action.includes("orientation")), false);
  assert.equal(AUDIENCE_VISIBILITY_ADMIN_ACTIONS.some((action) => action.includes("layer1")), false);
});

/**
 * T-565. `/user-groups` and `/layer2-intents` are the two surfaces the v2
 * workspace replaces, and Core retired their actions server-side before the
 * console did: `WebadminController::userCastGroups` and its two writes answer
 * `cast-group-contract-retired` (410) while `AudienceVisibilityAdminService`
 * is ready, and `Layer2CatalogAdminService::stored()` throws
 * `catalog-layer2-retired` (410) as soon as the singleton is not schema 1 —
 * which the D-019 migration made it. Half-retiring them in the console left an
 * operator a page that loads and then reports a refusal.
 */
test("the two replaced surfaces are retired outright, not hidden", async () => {
  const [help, actions, shell, en, hu] = await Promise.all([
    readFile(new URL("../lib/adminHelp.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/adminActions.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/Shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
    readFile(new URL("../messages/hu.json", import.meta.url), "utf8"),
  ]);

  for (const route of ["/user-groups", "/layer2-intents"]) {
    assert.equal(adminHelpPageForPath(route), null, `${route} must have no help entry`);
    assert.doesNotMatch(help, new RegExp(`route: "${route}"`, "u"));
    assert.doesNotMatch(shell, new RegExp(`"${route}"`, "u"));
  }

  // Every action only those two pages called is gone from the allow-list, so
  // the proxy rejects it as an unknown path instead of forwarding a call Core
  // answers with 410.
  for (const action of [
    "user_cast_groups",
    "save_user_cast_group",
    "archive_user_cast_group",
    "save_layer2_item",
    "archive_layer2_item",
    "set_layer2_selection_limit",
  ]) {
    assert.equal(ADMIN_ACTIONS.includes(action as never), false, `${action} must be retired`);
    assert.equal(adminActionAccess(action), null, `${action} must have no access class`);
    assert.doesNotMatch(actions, new RegExp(`"${action}"|\\b${action}:`, "u"));
  }

  // `layer2_catalog` is NOT retired: `/profile-fields` still calls it to list
  // the intent keys a profile section may be gated on. Removing it with the
  // editor would have broken a page nobody was retiring.
  assert.ok(ADMIN_ACTIONS.includes("layer2_catalog" as never));
  assert.equal(adminActionAccess("layer2_catalog"), "read");
  const profileFields = await readFile(
    new URL("../app/(dashboard)/profile-fields/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(profileFields, /adminCall\("layer2_catalog", \{\}\)/);

  // The operator copy goes with the pages; nothing may reference a namespace
  // that no longer exists.
  for (const [locale, raw] of [["en", en], ["hu", hu]] as const) {
    const messages = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    for (const key of ["userGroups", "layer2"]) {
      assert.equal(messages[key], undefined, `${locale}.${key} must be retired`);
    }
    for (const key of ["userGroups", "layer2Intents"]) {
      assert.equal(messages.nav[key], undefined, `${locale}.nav.${key} must be retired`);
      assert.equal(
        (messages.adminHelp as { pages: Record<string, unknown> }).pages[key],
        undefined,
        `${locale}.adminHelp.pages.${key} must be retired`,
      );
    }
  }
});

test("the cast-group vocabulary survives its editor, because four live consoles read it", async () => {
  // `lib/userCastGroups.ts` decodes the audience vocabulary that profile
  // fields, profile tags, icebreakers and signup options embed in their own
  // catalogue payloads. Only the EDITOR was retired; deleting the decoder
  // would have taken the audience picker out of four pages nobody retired.
  const consumers = [
    "../lib/profileFields.ts",
    "../lib/icebreakers.ts",
    "../lib/memberAudience.ts",
    "../components/MemberAudienceSelector.tsx",
  ];
  for (const consumer of consumers) {
    const source = await readFile(new URL(consumer, import.meta.url), "utf8");
    assert.match(source, /userCastGroup|UserCastGroup/u, `${consumer} still reads the vocabulary`);
  }
});
