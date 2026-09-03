import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import {
  AUDIENCE_VISIBILITY_ADMIN_ACTIONS,
  AUDIENCE_VISIBILITY_CAPABILITIES,
  AUDIENCE_VISIBILITY_GENDERS,
  AUDIENCE_VISIBILITY_IDENTITY_ACTIONS,
  AUDIENCE_VISIBILITY_IDENTITY_CAPABILITIES,
  AUDIENCE_VISIBILITY_INITIAL_INTENT_KEYS,
  AUDIENCE_VISIBILITY_LEGACY_GENDER,
  AUDIENCE_VISIBILITY_LEGACY_TYPES,
  AUDIENCE_VISIBILITY_MUTATION_ACTIONS,
  AUDIENCE_VISIBILITY_PENDING_STORAGE_KEY,
  AUDIENCE_VISIBILITY_RETIRED_PROFILE_QUESTION_KEYS,
  AUDIENCE_VISIBILITY_VALUES,
  audienceVisibilityAdminMe,
  audienceVisibilityCatalogResponse,
  audienceVisibilityConflict,
  audienceVisibilityConflictMatchesPending,
  audienceVisibilityError,
  audienceVisibilityGroupDraft,
  audienceVisibilityGroupMutationResponse,
  audienceVisibilityIdentityAdminMe,
  audienceVisibilityIdentityUnchanged,
  audienceVisibilityIntentMutationResponse,
  audienceVisibilityMemberDetailResponse,
  audienceVisibilityMemberIdentityBody,
  audienceVisibilityMemberIdentityMutationResponse,
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

// Core catalogue labels of the eleven D-095 questions, in the owner's ruling order.
const RETIRED_QUESTION_LABELS: Record<string, [string, string]> = {
  piercings: ["Piercings", "Piercingek"],
  tattoos: ["Tattoos", "Tetoválások"],
  beard: ["Facial hair", "Arcszőrzet"],
  sexual_position: ["Position", "Pozíció"],
  safer_sex: ["Safer sex", "Biztonságosabb szex"],
  circumcision: ["Circumcision", "Körülmetélés"],
  dick_size: ["Penis size", "Péniszméret"],
  body_hair: ["Body hair", "Testszőrzet"],
  hair_color: ["Hair color", "Hajszín"],
  eye_color: ["Eye color", "Szemszín"],
  body_type: ["Body type", "Testalkat"],
};

// T-632 manifest: every dating-specific question retired, nothing retained.
function retirementManifest(): Json {
  return {
    sha256: "2".repeat(64),
    matching_orientation: "retired",
    layer1_intent: "retired",
    legacy_catalogue_types: [...AUDIENCE_VISIBILITY_LEGACY_TYPES],
    profile_questions: AUDIENCE_VISIBILITY_RETIRED_PROFILE_QUESTION_KEYS.map((key) => ({
      key,
      labels: { en: RETIRED_QUESTION_LABELS[key][0], hu: RETIRED_QUESTION_LABELS[key][1] },
    })),
    retained_questions: [],
  };
}

// Pre-T-632 (D-019) manifest, accepted until T-634 removes the transition branch.
function legacyRetirementManifest(): Json {
  return {
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
  };
}

function catalog(): Json {
  return {
    contract_version: 1,
    gender_values: [...AUDIENCE_VISIBILITY_GENDERS],
    visible_to_values: [...AUDIENCE_VISIBILITY_VALUES],
    groups: PROTECTED.map((_, index) => group(index)),
    group_manifest_sha256: "1".repeat(64),
    retirement_manifest: retirementManifest(),
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
  // T-567 retired the spent cutover switch. The seven released actions are
  // permanent members of the proxy allow-list and access ladder, while Core
  // remains authoritative on every one of them.
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

test("the retirement manifest accepts eleven retired questions with nothing retained, and the pre-T-632 shape in transition", () => {
  const withManifest = (manifest: Json): Json => ({ ...catalog(), retirement_manifest: manifest });
  const decode = (manifest: Json) => audienceVisibilityCatalogResponse(success(withManifest(manifest)))?.retirement_manifest ?? null;

  // T-632 (D-095): 1..11 rows within the eleven, labels from the payload, served order kept, retained list empty.
  const current = decode(retirementManifest());
  assert.ok(current);
  assert.equal(current.sha256, "2".repeat(64));
  assert.deepEqual(current.profile_questions.map((row) => row.key), [...AUDIENCE_VISIBILITY_RETIRED_PROFILE_QUESTION_KEYS]);
  assert.equal(current.profile_questions.length, 11);
  assert.deepEqual(current.profile_questions[0], { key: "piercings", labels: { en: "Piercings", hu: "Piercingek" }, state: "retired" });
  assert.deepEqual(current.profile_questions[10], { key: "body_type", labels: { en: "Body type", hu: "Testalkat" }, state: "retired" });
  assert.deepEqual(current.retained_questions, []);

  const served = retirementManifest();
  served.profile_questions = [...served.profile_questions].reverse().slice(0, 3);
  assert.deepEqual(decode(served)?.profile_questions.map((row) => row.key), ["body_type", "eye_color", "hair_color"]);

  const annotated = retirementManifest();
  annotated.profile_questions = annotated.profile_questions.map((row: Json) => ({ ...row, reason: "dating_specific", state: "retired", future: true }));
  assert.deepEqual(decode(annotated)?.profile_questions[3], { key: "sexual_position", labels: { en: "Position", hu: "Pozíció" }, reason: "dating_specific", state: "retired" });

  const unknownKey = retirementManifest();
  unknownKey.profile_questions[0].key = "smoking";
  assert.equal(decode(unknownKey), null);
  const duplicateKey = retirementManifest();
  duplicateKey.profile_questions[1].key = "piercings";
  assert.equal(decode(duplicateKey), null);
  const empty = retirementManifest();
  empty.profile_questions = [];
  assert.equal(decode(empty), null);
  const twelve = retirementManifest();
  twelve.profile_questions.push({ key: "body_type", labels: { en: "Body type", hu: "Testalkat" } });
  assert.equal(decode(twelve), null);
  const notRetired = retirementManifest();
  notRetired.profile_questions[0].state = "active";
  assert.equal(decode(notRetired), null);
  const unlabeled = retirementManifest();
  delete unlabeled.profile_questions[0].labels;
  assert.equal(decode(unlabeled), null);
  const emptyReason = retirementManifest();
  emptyReason.profile_questions[0].reason = "";
  assert.equal(decode(emptyReason), null);
  const contradiction = retirementManifest();
  contradiction.retained_questions = legacyRetirementManifest().retained_questions;
  assert.equal(decode(contradiction), null);
  const twoRetained = legacyRetirementManifest();
  twoRetained.retained_questions.push(twoRetained.retained_questions[0]);
  assert.equal(decode(twoRetained), null);
  const badHash = retirementManifest();
  badHash.sha256 = "2".repeat(63);
  assert.equal(decode(badHash), null);

  // Pre-T-632 (D-019): four exact rows plus the neutral body_hair row, matched exactly as before.
  const legacy = decode(legacyRetirementManifest());
  assert.ok(legacy);
  assert.deepEqual(legacy.profile_questions.map((row) => row.key), ["dick_size", "circumcision", "sexual_position", "safer_sex"]);
  assert.deepEqual(legacy.profile_questions[0], { key: "dick_size", labels: { en: "Penis size", hu: "Péniszméret" }, reason: "sex_or_anatomy", state: "retired" });
  assert.deepEqual(legacy.retained_questions, [{
    key: "body_hair",
    labels: { en: "Body hair", hu: "Testszőrzet" },
    state: "active",
    change: "neutral_general_all_groups",
  }]);
  const legacyDrift = legacyRetirementManifest();
  legacyDrift.profile_questions[0].labels.en = "Penis";
  assert.equal(decode(legacyDrift), null);
  const legacyReordered = legacyRetirementManifest();
  legacyReordered.profile_questions.reverse();
  assert.equal(decode(legacyReordered), null);
  const legacyShort = legacyRetirementManifest();
  legacyShort.profile_questions.pop();
  assert.equal(decode(legacyShort), null);
  const legacyEleven = legacyRetirementManifest();
  legacyEleven.profile_questions = retirementManifest().profile_questions;
  assert.equal(decode(legacyEleven), null);
  const legacyRetainedDrift = legacyRetirementManifest();
  legacyRetainedDrift.retained_questions[0].change = "neutral_general";
  assert.equal(decode(legacyRetainedDrift), null);
});

test("all 59 published Core Webadmin fixtures are unchanged, manifest-bound, and decode by case", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", FIXTURE_DIRECTORY), "utf8"));
  assert.deepEqual(Object.keys(manifest), [
    "schema_version",
    "source_commit",
    "fixture_set_sha256",
    "provenance",
    "fixtures",
  ]);
  assert.equal(manifest.schema_version, 1);
  // Re-pinned by T-716 from Core `9e418b3`. The six compatibility segment
  // keys are unchanged; only their owner-facing English/Hungarian labels in
  // `admin-catalog.json` moved to neutral gender-plus-audience wording. The
  // remaining curated rows retain their previously published body hashes.
  assert.equal(manifest.source_commit, "9e418b323b9183e9c2bc9d7ad8bb74a57967bc5f");
  assert.equal(manifest.fixture_set_sha256, "956909cab7a0e2371aa4f343ead6388d9d6095a91b7d4d795adf544388aa6622");
  assert.equal(manifest.provenance.generator, "tests/audience_visibility_fixture_dump.php");
  assert.equal(manifest.provenance.generator_sha256, "a7521674eb451bc83538b1ab8b657eb05570efe46749fd175dd04e337c8ccba4");
  assert.equal(manifest.provenance.admin_wire_adapter, "Friending\\Support\\Webadmin::noStoreReply");

  const fixtureRows = new Map(manifest.fixtures.map((row: Json) => [row.file, row]));
  assert.equal(fixtureRows.get("signup-catalog-en.json")?.sha256, "b9d70fd142721fdcc5adb3ba58a86dc59caeab1644067768cac34b1e0884eb19");
  assert.equal(fixtureRows.get("signup-catalog-hu.json")?.sha256, "7f8db750786413df804070a38cf2fd8a4ff90ff3a06747e66a458ba07e60f53c");

  const rows = manifest.fixtures.filter((row: Json) => row.consumer === "webadmin");
  assert.equal(rows.length, 59);
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
    "admin-member-canonical.json",
    "admin-member-identity-save.json",
    "admin-member-identity-noop.json",
    "admin-member-identity-replay.json",
    "admin-member-identity-conflict.json",
    "admin-member-identity-error-retired.json",
    "admin-member-identity-error-gender.json",
    "admin-member-identity-error-detail.json",
    "admin-member-identity-error-detail-mismatch.json",
    "admin-member-identity-error-fixed.json",
    "admin-member-identity-error-unresolved.json",
    "admin-me-identity-dormant-editor.json",
    "admin-me-identity-ready-viewer.json",
    "admin-me-identity-ready-editor.json",
    "admin-me-identity-ready-owner.json",
    "admin-me-identity-revoked.json",
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
  // T-641 added the single `consumer: "ios"` body this repository holds:
  // `owner-profile-fields-identity.json`, the normative post-D-019 identity
  // block, decoded by `tests/profileFields.test.mts`. Its manifest row and
  // sha256 were already published in the copied manifest, so the set needed the
  // body alone and no manifest edit; the row is verified there.
  assert.deepEqual(
    (await readdir(FIXTURE_DIRECTORY)).sort(),
    [...expectedFiles, "owner-profile-fields-identity.json", "manifest.json"].sort(),
  );

  for (const row of rows) {
    assert.deepEqual(Object.keys(row), ["file", "route", "case", "consumer", "sha256"]);
    const bytes = await readFile(new URL(row.file, FIXTURE_DIRECTORY));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), row.sha256, `${row.file} changed after Core publication`);
    const body = JSON.parse(bytes.toString("utf8"));
    if (row.file === "admin-catalog.json") {
      assert.ok(audienceVisibilityCatalogResponse(body), row.file);
    } else if (row.file.startsWith("admin-me-identity-")) {
      // The T-653 sibling block, decoded by its own parser. The block beside it
      // is absent from these bodies, which is exactly what a console reading
      // one block must tolerate in the other.
      assert.ok(audienceVisibilityIdentityAdminMe(body.data?.audience_visibility_identity), row.file);
      assert.equal(audienceVisibilityAdminMe(body.data?.audience_visibility), null, row.file);
    } else if (row.file.startsWith("admin-me-")) {
      assert.ok(audienceVisibilityAdminMe(body.data?.audience_visibility), row.file);
      // The four/seven arrays did not grow: the existing block still decodes
      // and the sibling key is not on these bodies.
      assert.equal(body.data?.audience_visibility_identity, undefined, row.file);
    } else if (row.file === "admin-member-identity-conflict.json") {
      assert.equal(audienceVisibilityConflict(body)?.kind, "member", row.file);
    } else if (row.file.startsWith("admin-member-identity-error-")) {
      assert.ok(audienceVisibilityError(body), row.file);
    } else if (row.file.startsWith("admin-member-identity-")) {
      assert.ok(audienceVisibilityMemberIdentityMutationResponse(body), row.file);
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
  // A Core that predates T-653 serves none of the three identity keys; the row
  // still decodes and the panel has nothing to guard a write with.
  assert.deepEqual(
    audienceVisibilityMemberDetailResponse(success(resolved)),
    { ...resolved, identity: null },
  );
  const unresolved = { ...resolved, gender: null, visible_to: "both", group: null };
  assert.deepEqual(
    audienceVisibilityMemberDetailResponse(success(unresolved)),
    { ...unresolved, identity: null },
  );
  assert.equal(audienceVisibilityMemberDetailResponse(success({ ...unresolved, visible_to: "male" })), null);
  assert.equal(audienceVisibilityMemberDetailResponse(success({ ...resolved, group: { ...resolved.group, key: "female_for_male" } })), null);
  assert.deepEqual(
    audienceVisibilityMemberDetailResponse(success({ ...resolved, orientation: "bisexual", group: { ...resolved.group, future: true } })),
    { ...resolved, identity: null },
  );
});

test("the three T-653 member keys decode all together, or not at all", () => {
  const base = {
    contract_version: 1,
    uid: 7001,
    gender: "woman",
    visible_to: "both",
    revision: 3,
    group: { id: IDS[5], key: "female_for_both", legacy_segment: "female_bisexual" },
  };
  const identity = { identity_revision: 4, gender_detail: "trans_woman", show_gender_detail: true };
  assert.deepEqual(
    audienceVisibilityMemberDetailResponse(success({ ...base, ...identity })),
    { ...base, identity },
  );
  // 0 is the revision a member with no canonical document echoes back, and the
  // one that creates it.
  const created = { identity_revision: 0, gender_detail: null, show_gender_detail: false };
  assert.deepEqual(
    audienceVisibilityMemberDetailResponse(success({ ...base, ...created })),
    { ...base, identity: created },
  );

  // Partial, malformed, or internally impossible sets fail the whole decode
  // rather than rendering half a payload as a proven state.
  for (const broken of [
    { identity_revision: 4, gender_detail: "trans_woman" },
    { identity_revision: 4, show_gender_detail: true },
    { gender_detail: "trans_woman", show_gender_detail: true },
    { ...identity, identity_revision: -1 },
    { ...identity, identity_revision: "4" },
    { ...identity, gender_detail: "Trans_Woman" },
    { ...identity, gender_detail: 7 },
    { ...identity, show_gender_detail: "true" },
    { identity_revision: 4, gender_detail: null, show_gender_detail: true },
  ]) {
    assert.equal(
      audienceVisibilityMemberDetailResponse(success({ ...base, ...broken })),
      null,
      JSON.stringify(broken),
    );
  }

  // An unresolved member has no canonical gender, so Core projects no detail.
  const unresolved = { ...base, gender: null, group: null };
  assert.ok(audienceVisibilityMemberDetailResponse(success({ ...unresolved, ...created })));
  assert.equal(
    audienceVisibilityMemberDetailResponse(success({ ...unresolved, ...identity })),
    null,
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

test("released routes and panels rely on Core capability gates without a second build gate", async () => {
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
  assert.match(page, /if \(!me\?\.audienceVisibilityConsoleReady\) notFound\(\)/);
  assert.match(shell, /item\.key !== "audienceVisibility" \|\| audienceVisibilityConsoleReady/);
  // T-565: the two replaced pages are gone, not conditionally hidden. The
  // clause that removed them on the build constant ALONE — the one site that
  // was not ANDed with `audienceVisibilityConsoleReady`, so a dormant Core left
  // an operator with neither surface — went with them.
  assert.doesNotMatch(shell, /key: "userGroups"|key: "layer2Intents"/);
  assert.doesNotMatch(shell, /"\/user-groups"|"\/layer2-intents"/);
  assert.match(shell, /\{ href: "\/audience-visibility", key: "audienceVisibility", icon: "userGroups" \}/);
  assert.match(bridge, /audienceVisibilityProxyCapabilityAuthorized/);
  assert.match(bridge, /normalizeAudienceVisibilityProxyBody/);
  assert.match(session, /audienceVisibilityAdminMe\(result\.data\.audience_visibility\)/);
  assert.match(
    session,
    /audienceVisibilityConsoleReady: audienceVisibility\?\.contract_ready === true\s+&& audienceVisibility\.actions\.includes\("audience_visibility_catalog"\)/,
  );
  assert.match(actions, /\.\.\.AUDIENCE_VISIBILITY_ADMIN_ACTIONS/);
  assert.doesNotMatch(actions, /ACTIVE_AUDIENCE_VISIBILITY_ADMIN_ACTIONS/);
  assert.match(
    memberPage,
    /<AudienceVisibilityUserPanel uid=\{uid\} identityGroups=\{identityGroups\} onIdentitySaved=\{load\} \/>/,
  );
  assert.match(memberPanel, /audience_visibility_member_detail/);
  assert.doesNotMatch(memberPanel, /user_detail/);
  assert.match(consoleSource, /audienceVisibilityPersistBeforeMutation/);
  assert.match(consoleSource, /sessionStorage/);
  assert.match(consoleSource, /archive_audience_visibility_group/);
  assert.match(consoleSource, /set_audience_visibility_intent_limit/);
  assert.doesNotMatch(consoleSource, /visibility_mode|reciprocal_set_id|layer1_json|orientationChoices/);
  assert.match(help, /route: "\/audience-visibility"/);
  assert.equal(adminHelpPageForPath("/audience-visibility")?.ready, undefined);
  assert.equal(
    adminHelpPageForPath("/audience-visibility")?.consoleReady,
    "audienceVisibilityConsoleReady",
  );

  const enMessages = JSON.parse(en);
  const huMessages = JSON.parse(hu);
  assert.equal(enMessages.audienceVisibilityAdmin.visibleTo.male, "Men");
  assert.equal(huMessages.audienceVisibilityAdmin.visibleTo.male, "Férfiak");
  assert.equal(enMessages.audienceVisibilityAdmin.visibleTo.female, "Women");
  assert.equal(huMessages.audienceVisibilityAdmin.visibleTo.female, "Nők");
  assert.equal(enMessages.audienceVisibilityAdmin.visibleTo.both, "Everyone");
  assert.equal(huMessages.audienceVisibilityAdmin.visibleTo.both, "Mindenki");
  assert.equal(enMessages.userDetail.audienceVisibility.title, "Who can see my profile");
  // T-651: the app calls this setting "Ki láthatja az adatlapomat" (D-099,
  // T-645), so the console names it the same way. The English half is
  // unchanged.
  assert.equal(huMessages.userDetail.audienceVisibility.title, "Ki láthatja az adatlapomat");
  assert.equal(
    huMessages.adminHelp.pages.userDetail.sections.audienceVisibility.title,
    "Ki láthatja az adatlapomat",
  );
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

  // Every action only those two pages or the now-retired profile-section gate
  // called is gone from the allow-list, so the proxy rejects it as an unknown
  // path instead of forwarding a call Core answers with 410.
  for (const action of [
    "user_cast_groups",
    "save_user_cast_group",
    "archive_user_cast_group",
    "layer2_catalog",
    "save_layer2_item",
    "archive_layer2_item",
    "set_layer2_selection_limit",
  ]) {
    assert.equal(ADMIN_ACTIONS.includes(action as never), false, `${action} must be retired`);
    assert.equal(adminActionAccess(action), null, `${action} must have no access class`);
    assert.doesNotMatch(actions, new RegExp(`"${action}"|\\b${action}:`, "u"));
  }

  const profileFields = await readFile(
    new URL("../app/(dashboard)/profile-fields/page.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(profileFields, /layer2_catalog|Layer2|layer2|layoutGate/);

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

/**
 * T-653. The member-identity write, its SIBLING `admin_me` block and the three
 * additive member keys. The load-bearing fact for every test here is that the
 * existing `audience_visibility` block is pinned by an EXACT ORDERED match, so
 * the new capability could not be appended to it: a fifth capability or an
 * eighth action would make `audienceVisibilityAdminMe()` answer `null` on every
 * deployed build and darken the whole workspace.
 */
test("the sibling identity block is decoded on its own and never widens the pinned block", () => {
  const identity = (role: string, ready: boolean, actions: string[], capabilities: string[]) => ({
    contract_version: 1,
    contract_ready: ready,
    principal: { role, capabilities },
    actions,
  });
  const WRITE = AUDIENCE_VISIBILITY_IDENTITY_CAPABILITIES[0];
  const SAVE = AUDIENCE_VISIBILITY_IDENTITY_ACTIONS[0];

  // Editor, approver and owner hold the capability; a ready contract publishes
  // the one action to them.
  for (const role of ["editor", "approver", "owner"]) {
    const block = audienceVisibilityIdentityAdminMe(identity(role, true, [SAVE], [WRITE]));
    assert.deepEqual(block, {
      contract_version: 1,
      contract_ready: true,
      principal: { role, capabilities: [WRITE] },
      actions: [SAVE],
    });
  }
  // Viewer and a revoked principal hold nothing at all.
  for (const role of ["viewer", ""]) {
    assert.deepEqual(
      audienceVisibilityIdentityAdminMe(identity(role, true, [], [])),
      { contract_version: 1, contract_ready: true, principal: { role, capabilities: [] }, actions: [] },
    );
    assert.equal(audienceVisibilityIdentityAdminMe(identity(role, true, [SAVE], [WRITE])), null);
  }
  // Dormant keeps the capability and empties the actions, exactly as §2 says
  // for the block beside it.
  assert.deepEqual(
    audienceVisibilityIdentityAdminMe(identity("editor", false, [], [WRITE]))?.actions,
    [],
  );
  assert.equal(audienceVisibilityIdentityAdminMe(identity("editor", false, [SAVE], [WRITE])), null);

  // Absent, malformed, and drifted blocks all fail closed — which is the
  // "editor hidden" state, never an optimistic grant.
  for (const broken of [
    undefined,
    null,
    {},
    identity("editor", true, [SAVE, "save_audience_visibility_group"], [WRITE]),
    identity("editor", true, [SAVE], [WRITE, "audience_visibility_group_write"]),
    identity("admin", true, [SAVE], [WRITE]),
    { ...identity("editor", true, [SAVE], [WRITE]), contract_version: 2 },
  ]) {
    assert.equal(audienceVisibilityIdentityAdminMe(broken), null, JSON.stringify(broken ?? null));
  }

  // The two blocks are independent: a payload carrying only one decodes it and
  // reports nothing about the other.
  const ready = {
    audience_visibility: {
      contract_version: 1,
      contract_ready: true,
      principal: { role: "editor", capabilities: [...AUDIENCE_VISIBILITY_CAPABILITIES] },
      actions: [...AUDIENCE_VISIBILITY_ADMIN_ACTIONS],
    },
    audience_visibility_identity: identity("editor", true, [SAVE], [WRITE]),
  };
  assert.ok(audienceVisibilityAdminMe(ready.audience_visibility));
  assert.equal(audienceVisibilityProxyCapabilityAuthorized(SAVE, ready), true);
  assert.equal(
    audienceVisibilityProxyCapabilityAuthorized(SAVE, { audience_visibility: ready.audience_visibility }),
    false,
    "the four-capability block must never authorize the identity write",
  );
  assert.equal(
    audienceVisibilityProxyCapabilityAuthorized("audience_visibility_catalog", ready),
    true,
    "the sibling key must not disturb the block beside it",
  );
  assert.equal(
    audienceVisibilityProxyCapabilityAuthorized(SAVE, {
      ...ready,
      audience_visibility_identity: identity("viewer", true, [], []),
    }),
    false,
  );
  assert.equal(audienceVisibilityProxyCapabilityAuthorized("save_user_profile_identity", ready), null);

  // The role floor is composed with the capability, never replaced by it.
  const viewer = adminPrincipalFrom({ role: "viewer" });
  const admin = adminPrincipalFrom({ role: "admin" });
  assert.equal(isAdminBridgeActionAuthorized(SAVE, admin, true), true);
  assert.equal(isAdminBridgeActionAuthorized(SAVE, admin, false), false);
  assert.equal(isAdminBridgeActionAuthorized(SAVE, viewer, true), true, "Core's block is the authority");
  assert.equal(ADMIN_ACTIONS.includes(SAVE as never), true);
  assert.equal(adminActionAccess(SAVE), "write");
});

test("the identity save posts exactly the nine contract fields, and nothing else reaches Core", () => {
  const SAVE = AUDIENCE_VISIBILITY_IDENTITY_ACTIONS[0];
  const member = audienceVisibilityMemberDetailResponse(success({
    contract_version: 1,
    uid: 880124,
    gender: "woman",
    visible_to: "female",
    revision: 2,
    group: { id: IDS[4], key: "female_for_female", legacy_segment: "female_lesbian" },
    identity_revision: 4,
    gender_detail: "trans_woman",
    show_gender_detail: true,
  }));
  assert.ok(member);
  const body = audienceVisibilityMemberIdentityBody(member, {
    gender: "man",
    gender_detail: "trans_man",
    visible_to: "male",
    audit_reason: "Support ticket 4711: member asked for the correction",
  }, UUID);
  assert.deepEqual({ ...body }, {
    contract_version: 1,
    request_id: UUID,
    expected_revision: 2,
    expected_identity_revision: 4,
    audit_reason: "Support ticket 4711: member asked for the correction",
    uid: 880124,
    gender: "man",
    gender_detail: "trans_man",
    visible_to: "male",
  });
  // Both axes come from the payload the panel is displaying, so the command a
  // stale console builds is refused by Core, not silently repaired here.
  assert.equal(body?.expected_revision, member.revision);
  assert.equal(body?.expected_identity_revision, member.identity?.identity_revision);

  // The proxy forwards this body unchanged and refuses every drift.
  assert.deepEqual({ ...normalizeAudienceVisibilityProxyBody(SAVE, body as Record<string, unknown>) }, { ...body });
  for (const drift of [
    { orientation: "bisexual" },
    { relationship_status: "single" },
    { subgender: "trans_man" },
    { show_gender_detail: true },
    { lang: "hu" },
    { admin_email: "someone@friending.com" },
  ]) {
    assert.equal(
      normalizeAudienceVisibilityProxyBody(SAVE, { ...body, ...drift } as Record<string, unknown>),
      null,
      JSON.stringify(drift),
    );
  }
  for (const drift of [
    { gender: "man ", },
    { gender: "male" },
    { gender_detail: "Trans_Man" },
    { visible_to: "everyone" },
    { expected_revision: 0 },
    { expected_identity_revision: -1 },
    { request_id: "not-a-uuid" },
    { audit_reason: "" },
    { audit_reason: " padded" },
    { uid: 0 },
    { gender: "nonbinary", visible_to: "male" },
  ]) {
    assert.equal(
      normalizeAudienceVisibilityProxyBody(SAVE, { ...body, ...drift } as Record<string, unknown>),
      null,
      JSON.stringify(drift),
    );
  }
  // The empty string is the absent detail, and 0 is the create path.
  assert.ok(normalizeAudienceVisibilityProxyBody(SAVE, { ...body, gender_detail: "" } as Record<string, unknown>));
  assert.ok(normalizeAudienceVisibilityProxyBody(SAVE, { ...body, expected_identity_revision: 0 } as Record<string, unknown>));

  // No T-653 keys on the member means no revisions to guard with, so no command.
  const preAmendment = audienceVisibilityMemberDetailResponse(success({
    contract_version: 1,
    uid: 880124,
    gender: "woman",
    visible_to: "female",
    revision: 2,
    group: { id: IDS[4], key: "female_for_female", legacy_segment: "female_lesbian" },
  }));
  assert.ok(preAmendment);
  assert.equal(preAmendment.identity, null);
  assert.equal(
    audienceVisibilityMemberIdentityBody(preAmendment, {
      gender: "man", gender_detail: "", visible_to: "male", audit_reason: "Reviewed",
    }, UUID),
    null,
  );
  // An unresolved member has no gender chosen yet, and an unusable reason is
  // refused before a receipt is spent.
  assert.equal(
    audienceVisibilityMemberIdentityBody(member, {
      gender: "", gender_detail: "", visible_to: "male", audit_reason: "Reviewed",
    }, UUID),
    null,
  );
  assert.equal(
    audienceVisibilityMemberIdentityBody(member, {
      gender: "man", gender_detail: "", visible_to: "male", audit_reason: "x".repeat(301),
    }, UUID),
    null,
  );

  // An exact no-op is not offered: it would spend a receipt and an audit row
  // for nothing. A member with no canonical document is never "unchanged".
  assert.equal(audienceVisibilityIdentityUnchanged(member, {
    gender: "woman", gender_detail: "trans_woman", visible_to: "female", audit_reason: "Reviewed",
  }), true);
  assert.equal(audienceVisibilityIdentityUnchanged(member, {
    gender: "woman", gender_detail: "", visible_to: "female", audit_reason: "Reviewed",
  }), false);
  assert.equal(audienceVisibilityIdentityUnchanged(preAmendment, {
    gender: "woman", gender_detail: "", visible_to: "female", audit_reason: "Reviewed",
  }), false);
});

test("the identity mutation, its conflict and its six refusals are decoded by name", () => {
  const canonical = {
    contract_version: 1,
    uid: 880124,
    gender: "man",
    visible_to: "male",
    revision: 3,
    group: { id: IDS[1], key: "male_for_male", legacy_segment: "male_gay" },
    identity_revision: 5,
    gender_detail: "trans_man",
    show_gender_detail: false,
  };
  const saved = audienceVisibilityMemberIdentityMutationResponse(success({
    contract_version: 1, member: canonical, replayed: false,
  }));
  assert.equal(saved?.replayed, false);
  assert.equal(saved?.member.identity?.identity_revision, 5);
  assert.equal(
    audienceVisibilityMemberIdentityMutationResponse(success({
      contract_version: 1, member: canonical, replayed: true,
    }))?.replayed,
    true,
    "a replay is reported as one, not as a second write",
  );
  assert.equal(audienceVisibilityMemberIdentityMutationResponse(success({
    contract_version: 1, member: { ...canonical, revision: 0 }, replayed: false,
  })), null);
  assert.equal(audienceVisibilityMemberIdentityMutationResponse(success({
    contract_version: 1, member: canonical, replayed: "no",
  })), null);

  // The conflict carries the canonical member; the panel adopts it and asks
  // for a fresh gesture instead of merging or forcing.
  const conflict = audienceVisibilityConflict(refusal("audience-visibility-conflict", 409, {
    contract_version: 1,
    member: canonical,
  }));
  assert.equal(conflict?.kind, "member");
  assert.equal(conflict?.kind === "member" ? conflict.member.revision : null, 3);
  assert.equal(audienceVisibilityConflict(refusal("audience-visibility-conflict", 409, {
    contract_version: 1,
    member: canonical,
    group: group(1),
  })), null, "recognized sibling branches remain mutually exclusive");

  // Every new refusal is bound to its exact logical status, and a status that
  // does not match its name is not a refusal this console will report.
  for (const [error, status] of [
    ["feature-retired", 410],
    ["identity-gender-invalid", 422],
    ["identity-gender-detail-invalid", 422],
    ["identity-gender-detail-mismatch", 422],
    ["profile-visibility-fixed", 422],
    ["audience-visibility-member-unresolved", 409],
  ] as const) {
    assert.equal(audienceVisibilityError(refusal(error, status)), error);
    assert.equal(audienceVisibilityError(refusal(error, 500)), null);
    // None of them is retryable with the same command: a member whose
    // onboarding owns their identity record, or a value Core will refuse
    // again, is not an uncertain outcome.
    assert.equal(audienceVisibilityShouldRetainMutation(error), false, error);
  }
  // An uncertain outcome still keeps the durable identity.
  assert.equal(audienceVisibilityShouldRetainMutation(null), true);
  assert.equal(audienceVisibilityShouldRetainMutation("audience-visibility-request-in-progress"), true);
  assert.equal(audienceVisibilityShouldRetainMutation("audience-visibility-stored-invalid"), true);
});

test("the console crosses between the V2 and legacy gender vocabularies in exactly one place", async () => {
  // Core's `IdentityV2Policy::legacyGender()`, mirrored so the panel can filter
  // the served `identity_options` — whose `audiences` carry the legacy tokens —
  // without pinning the 25 detail keys themselves.
  assert.deepEqual(AUDIENCE_VISIBILITY_LEGACY_GENDER, { man: "male", woman: "female", nonbinary: "other" });
  for (const gender of AUDIENCE_VISIBILITY_GENDERS) {
    assert.equal(typeof AUDIENCE_VISIBILITY_LEGACY_GENDER[gender], "string");
  }
  const lib = await readFile(new URL("../lib/audienceVisibilityAdmin.ts", import.meta.url), "utf8");
  // The detail vocabulary stays Core's. A pinned list here would be a second
  // authority in the browser and a re-pin on every catalogue change.
  assert.doesNotMatch(lib, /cis_woman|trans_woman|transfeminine|genderqueer/u);
});

test("the users detail panel gates the editor on the sibling block and the page feeds it Core's catalogue", async () => {
  const [panel, editor, page, session] = await Promise.all([
    readFile(new URL("../components/AudienceVisibilityUserPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/AudienceVisibilityIdentityEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(dashboard)/users/[uid]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/session.ts", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /audienceVisibilityIdentityAdminMe\(meResponse\?\.audience_visibility_identity\)/);
  assert.match(panel, /canWrite && detail\.identity/);
  assert.match(panel, /requestRef\.current \?\? crypto\.randomUUID\(\)/);
  // The panel never invents a second logical action after an uncertain answer.
  assert.match(panel, /audienceVisibilityShouldRetainMutation\(error\)\) requestRef\.current = null/);
  assert.doesNotMatch(panel, /save_user_profile_identity|orientation/u);
  // The read capability still comes from the block beside it, unchanged.
  assert.match(panel, /audienceVisibilityAdminMe\(meResponse\?\.audience_visibility\)/);
  assert.match(page, /identityGroups=\{identityGroups\}/);
  // T-653 §2a: the server session decodes the sibling block, tolerantly.
  assert.match(session, /audienceVisibilityIdentityWriteAuthorized\(result\.data\)/);
  assert.match(session, /audience_visibility_identity\?: unknown/);
  // The editor offers the two genders D-097 #1 rules on, in the owner's order,
  // and never a third.
  assert.match(editor, /AUDIENCE_VISIBILITY_OFFERED_GENDERS = \["woman", "man"\] as const/);
  assert.match(editor, /AUDIENCE_VISIBILITY_OFFERED_AUDIENCES = \["female", "male", "both"\] as const/);
  assert.doesNotMatch(editor, /"nonbinary",/u);
});

test("the operator copy for the identity editor exists in both locales", async () => {
  const [en, hu] = await Promise.all([
    readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
    readFile(new URL("../messages/hu.json", import.meta.url), "utf8"),
  ]);
  const enMessages = JSON.parse(en);
  const huMessages = JSON.parse(hu);
  const enEditor = enMessages.userDetail.audienceVisibility.editor;
  const huEditor = huMessages.userDetail.audienceVisibility.editor;
  assert.deepEqual(Object.keys(enEditor).sort(), Object.keys(huEditor).sort());
  // Every refusal the editor can meet has real copy, not a bare code.
  for (const error of [
    "feature-retired",
    "identity-gender-invalid",
    "identity-gender-detail-invalid",
    "identity-gender-detail-mismatch",
    "profile-visibility-fixed",
    "audience-visibility-member-unresolved",
  ]) {
    for (const [locale, block] of [["en", enEditor], ["hu", huEditor]] as const) {
      const copy = block.errors[error];
      assert.equal(typeof copy, "string", `${locale}.${error}`);
      assert.ok(copy.length > 20 && !copy.includes(error), `${locale}.${error} must read as copy`);
    }
  }
  // The owner's own words for the three controls (D-097 #1, D-099).
  assert.equal(huEditor.visibleTo, "Ki láthatja az adatlapomat");
  assert.equal(huMessages.userDetail.audienceVisibility.genders.woman, "Nő");
  assert.equal(huMessages.userDetail.audienceVisibility.genders.man, "Férfi");
  assert.equal(huMessages.userDetail.audienceVisibility.visibleToValues.female, "Nők");
  assert.equal(huMessages.userDetail.audienceVisibility.visibleToValues.male, "Férfiak");
  assert.equal(huMessages.userDetail.audienceVisibility.visibleToValues.both, "Mindenki");
  // T-651's "an editor for them is being built" is no longer true anywhere.
  for (const [locale, messages] of [["en", enMessages], ["hu", huMessages]] as const) {
    assert.doesNotMatch(
      messages.userProfileEditor.identityReadOnlyCopy,
      /being built|készül/u,
      `${locale} must not still promise an editor that shipped`,
    );
  }
});
