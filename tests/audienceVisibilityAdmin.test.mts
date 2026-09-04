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
import { signupPagesPayload } from "../lib/signupPages.ts";

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

test("the T-669 Core corpus is pinned beside the deployed one and every body still decodes", async () => {
  // The SECOND pinned corpus. `audience_visibility_admin_wire` stays the
  // DEPLOYED Core (`364c89e8`), byte-identical and untouched; this directory is
  // the same 59 Webadmin bodies plus the identity fragment and the two signup
  // catalogues, taken from the published T-669 release (`api` cde98f52) with its
  // own manifest. Until Core deploys, the console must satisfy BOTH — which is what
  // pinning both, rather than replacing one, is for.
  const directory = new URL("./fixtures/audience_visibility_admin_wire_t669/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8"));
  assert.deepEqual(Object.keys(manifest), [
    "schema_version",
    "source_commit",
    "fixture_set_sha256",
    "provenance",
    "fixtures",
  ]);
  assert.equal(manifest.schema_version, 1);
  // `cde98f52` is the PUBLISHED T-669 source commit ("retire legacy identity
  // answers end to end") on `api` main — the commit whose regeneration produced
  // this body set. T-771 re-pinned it from the lane commit `9cf5c142`, which
  // carried the same work before the rebase and is not an ancestor of `api` main,
  // so its provenance could not be verified against any Core release. Regenerating
  // with the pinned generator at `cde98f52` reproduces every body and the whole
  // manifest byte for byte apart from this line.
  assert.equal(manifest.source_commit, "cde98f523a45eae8b16aa9f1a4005c905c591973");
  assert.equal(
    manifest.fixture_set_sha256,
    "e8546d3d84110d52c1aaa362c44e98df001a80c7d46374bcc1202a38f609d815",
  );
  assert.equal(manifest.provenance.generator, "tests/audience_visibility_fixture_dump.php");
  assert.equal(manifest.provenance.admin_wire_adapter, "Friending\\Support\\Webadmin::noStoreReply");
  // The two corpora are two different Cores, not a copy of one.
  const deployed = JSON.parse(await readFile(
    new URL("manifest.json", FIXTURE_DIRECTORY),
    "utf8",
  ));
  assert.notEqual(manifest.source_commit, deployed.source_commit);
  assert.notEqual(manifest.fixture_set_sha256, deployed.fixture_set_sha256);

  const rows = manifest.fixtures.filter((row: Json) => row.consumer === "webadmin");
  assert.equal(rows.length, 59, "the Webadmin surface neither grew nor shrank under T-669");
  const deployedRows = deployed.fixtures.filter((row: Json) => row.consumer === "webadmin");
  assert.deepEqual(
    rows.map((row: Json) => row.file),
    deployedRows.map((row: Json) => row.file),
    "the same 59 cases, so a body that changed changed because Core changed it",
  );
  const extra = ["owner-profile-fields-identity.json", "signup-catalog-en.json", "signup-catalog-hu.json"];
  assert.deepEqual(
    (await readdir(directory)).sort(),
    [...rows.map((row: Json) => row.file), ...extra, "manifest.json"].sort(),
  );

  // Every body is manifest-bound and decodes by case, exactly as the deployed
  // corpus does — the same branches, so a shape this console cannot read is a
  // failure here rather than a blank panel in production.
  const changed: string[] = [];
  for (const row of [...rows, ...extra.map((file) => ({ file }))]) {
    const bytes = await readFile(new URL(row.file, directory));
    const published = manifest.fixtures.find((entry: Json) => entry.file === row.file);
    assert.ok(published, row.file);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      published.sha256,
      `${row.file} changed after Core publication`,
    );
    const deployedBytes = await readFile(new URL(row.file, FIXTURE_DIRECTORY)).catch(() => null);
    if (deployedBytes !== null && !deployedBytes.equals(bytes)) changed.push(row.file);
    if (extra.includes(row.file)) continue;
    const body = JSON.parse(bytes.toString("utf8"));
    if (row.file === "admin-catalog.json") {
      assert.ok(audienceVisibilityCatalogResponse(body), row.file);
    } else if (row.file.startsWith("admin-me-identity-")) {
      assert.ok(audienceVisibilityIdentityAdminMe(body.data?.audience_visibility_identity), row.file);
    } else if (row.file.startsWith("admin-me-")) {
      assert.ok(audienceVisibilityAdminMe(body.data?.audience_visibility), row.file);
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

  // What T-669 actually moved on this surface, named exactly. Anything else
  // differing between the two corpora is drift this task did not intend.
  assert.deepEqual(changed.sort(), [
    // `selection_required_min`, additive on the intents row — a LATER Core
    // change than the deployed corpus, unrelated to T-669 and not re-pinned
    // here (the decoder already treats an absent minimum as 0).
    "admin-intent-archive.json",
    "admin-intent-conflict.json",
    "admin-intent-create.json",
    "admin-intent-edit.json",
    "admin-intent-limit.json",
    "admin-intent-noop.json",
    "admin-intent-replay.json",
    "admin-intent-restore.json",
    // The retired identity pair leaves `memberProjection()`.
    "admin-member-binary.json",
    "admin-member-canonical.json",
    "admin-member-identity-conflict.json",
    // `identity-gender-detail-invalid` / `-mismatch` (422) become
    // `feature-retired` (410).
    "admin-member-identity-error-detail-mismatch.json",
    "admin-member-identity-error-detail.json",
    "admin-member-identity-noop.json",
    "admin-member-identity-replay.json",
    "admin-member-identity-save.json",
    "admin-member-nonbinary.json",
    "admin-member-unresolved.json",
    // `{gender, subgender, subgender_selected, updated_at}` → `{gender, updated_at}`.
    "owner-profile-fields-identity.json",
  ]);
});

test("the T-669 signup identity catalogue is terminal, and the composer tolerates the deployed one", async () => {
  // D-103 §6.4 in the wire Core actually serves: `groups` is exactly `gender`
  // and `v2.identity` carries `genders` alone — no `gender_details`, no
  // `gender_detail_note`, no `relationship_statuses`.
  const directory = new URL("./fixtures/audience_visibility_admin_wire_t669/", import.meta.url);
  for (const file of ["signup-catalog-en.json", "signup-catalog-hu.json"]) {
    const data = JSON.parse(await readFile(new URL(file, directory), "utf8")).data;
    assert.deepEqual(data.groups.map((group: Json) => group.key), ["gender"], file);
    assert.deepEqual(Object.keys(data.v2.identity), ["genders"], file);
    assert.deepEqual(
      data.v2.identity.genders.map((row: Json) => row.key).sort(),
      ["man", "woman"],
      `${file}: the D-097 #1 gender vocabulary itself is untouched`,
    );
  }

  // The console's own composer read (`list_signup_options`) carries the same
  // catalogue under `catalog.groups`, which T-669 shrinks from nine groups to
  // one. `signupPagesPayload` decodes the additive composer blocks and ignores
  // that sibling entirely, so BOTH catalogues produce the same page layout.
  const envelopes = JSON.parse(await readFile(
    new URL("./fixtures/signup_pages_handoff/t689-signup-composer-envelopes.json", import.meta.url),
    "utf8",
  ));
  for (const key of ["list_signup_options.empty", "list_signup_options.composed"]) {
    const deployedEnvelope = envelopes[key];
    assert.equal(
      deployedEnvelope.catalog.groups.length,
      9,
      `${key}: the deployed catalogue still carries the retired groups`,
    );
    const terminalEnvelope = structuredClone(deployedEnvelope);
    terminalEnvelope.catalog.groups = deployedEnvelope.catalog.groups.filter(
      (group: Json) => group.key === "gender",
    );
    assert.deepEqual(
      signupPagesPayload(terminalEnvelope),
      signupPagesPayload(deployedEnvelope),
      `${key}: the composer reads the same layout on either catalogue`,
    );
    assert.ok(signupPagesPayload(terminalEnvelope), key);
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

test("the T-653 member identity decodes on BOTH the deployed and the T-669 Core shapes", () => {
  const base = {
    contract_version: 1,
    uid: 7001,
    gender: "woman",
    visible_to: "both",
    revision: 3,
    group: { id: IDS[5], key: "female_for_both", legacy_segment: "female_bisexual" },
  };

  // TERMINAL (T-669, Core 1d108591): `identity_revision` alone.
  assert.deepEqual(
    audienceVisibilityMemberDetailResponse(success({ ...base, identity_revision: 4 })),
    { ...base, identity: { identity_revision: 4 } },
  );

  // DEPLOYED (Core 364c89e8): the same axis with the retired pair beside it.
  // The detail is carried as `legacy_gender_detail` only so the save can echo
  // it back to a Core that still requires the field; nothing renders it.
  const served = { identity_revision: 4, gender_detail: "trans_woman", show_gender_detail: true };
  assert.deepEqual(
    audienceVisibilityMemberDetailResponse(success({ ...base, ...served })),
    { ...base, identity: { identity_revision: 4, legacy_gender_detail: "trans_woman" } },
  );

  // 0 is the revision a member with no canonical document echoes back, and the
  // one that creates it — on either shape.
  const created = { identity_revision: 0, gender_detail: null, show_gender_detail: false };
  assert.deepEqual(
    audienceVisibilityMemberDetailResponse(success({ ...base, ...created })),
    { ...base, identity: { identity_revision: 0, legacy_gender_detail: null } },
  );
  assert.deepEqual(
    audienceVisibilityMemberDetailResponse(success({ ...base, identity_revision: 0 })),
    { ...base, identity: { identity_revision: 0 } },
  );

  // A Core that predates T-653 serves no block at all: the row still decodes
  // and the panel stays read-only.
  assert.deepEqual(
    audienceVisibilityMemberDetailResponse(success(base)),
    { ...base, identity: null },
  );

  // Widening the accepted set did NOT weaken validation of a served pair: a
  // partial, malformed, or internally impossible one still fails the whole
  // decode rather than rendering half a payload as a proven state.
  for (const broken of [
    { identity_revision: 4, gender_detail: "trans_woman" },
    { identity_revision: 4, show_gender_detail: true },
    { gender_detail: "trans_woman", show_gender_detail: true },
    { ...served, identity_revision: -1 },
    { ...served, identity_revision: "4" },
    { ...served, gender_detail: "Trans_Woman" },
    { ...served, gender_detail: 7 },
    { ...served, show_gender_detail: "true" },
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
  assert.ok(audienceVisibilityMemberDetailResponse(success({ ...unresolved, identity_revision: 0 })));
  assert.equal(
    audienceVisibilityMemberDetailResponse(success({ ...unresolved, ...served })),
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
    /<AudienceVisibilityUserPanel uid=\{uid\} onIdentitySaved=\{load\} \/>/,
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

test("the identity save posts the eight terminal fields, or the deployed nine, chosen by what Core SERVED", () => {
  const SAVE = AUDIENCE_VISIBILITY_IDENTITY_ACTIONS[0];
  const memberBase = {
    contract_version: 1,
    uid: 880124,
    gender: "woman",
    visible_to: "female",
    revision: 2,
    group: { id: IDS[4], key: "female_for_female", legacy_segment: "female_lesbian" },
    identity_revision: 4,
  };
  const draft = {
    gender: "man",
    visible_to: "male",
    audit_reason: "Support ticket 4711: member asked for the correction",
  } as const;
  const common = {
    contract_version: 1,
    request_id: UUID,
    expected_revision: 2,
    expected_identity_revision: 4,
    audit_reason: draft.audit_reason,
    uid: 880124,
    gender: "man",
  };

  // TERMINAL Core (1d108591): eight fields, no `gender_detail`. Sending the
  // key there is refused `feature-retired` (410), because T-669 moved it into
  // `AudienceVisibilityAdminPolicy::RETIRED_IDENTITY_FIELDS`.
  const terminal = audienceVisibilityMemberDetailResponse(success(memberBase));
  assert.ok(terminal);
  const terminalBody = audienceVisibilityMemberIdentityBody(terminal, draft, UUID);
  assert.deepEqual({ ...terminalBody }, { ...common, visible_to: "male" });
  assert.deepEqual(Object.keys(terminalBody ?? {}), [
    "contract_version", "request_id", "expected_revision", "expected_identity_revision",
    "audit_reason", "uid", "gender", "visible_to",
  ]);

  // DEPLOYED Core (364c89e8): nine fields. `strictRequired` there lists
  // `gender_detail`, so the eight-field body is refused
  // `audience-visibility-request-invalid`. The console echoes the SERVED value
  // rather than inventing or clearing one — it no longer has a control for it.
  const deployed = audienceVisibilityMemberDetailResponse(success({
    ...memberBase,
    gender_detail: "trans_woman",
    show_gender_detail: true,
  }));
  assert.ok(deployed);
  const deployedBody = audienceVisibilityMemberIdentityBody(deployed, draft, UUID);
  assert.deepEqual({ ...deployedBody }, { ...common, gender_detail: "trans_woman", visible_to: "male" });
  assert.deepEqual(Object.keys(deployedBody ?? {}), [
    "contract_version", "request_id", "expected_revision", "expected_identity_revision",
    "audit_reason", "uid", "gender", "gender_detail", "visible_to",
  ]);
  // A member the deployed Core serves with no detail echoes the empty string,
  // which is how the absent detail travels on a form body.
  const deployedNoDetail = audienceVisibilityMemberDetailResponse(success({
    ...memberBase,
    gender_detail: null,
    show_gender_detail: false,
  }));
  assert.ok(deployedNoDetail);
  assert.equal(
    audienceVisibilityMemberIdentityBody(deployedNoDetail, draft, UUID)?.gender_detail,
    "",
  );

  // Both axes come from the payload the panel is displaying, so the command a
  // stale console builds is refused by Core, not silently repaired here.
  assert.equal(terminalBody?.expected_revision, terminal.revision);
  assert.equal(terminalBody?.expected_identity_revision, terminal.identity?.identity_revision);

  // The proxy forwards BOTH bodies unchanged and refuses every drift on each.
  for (const body of [terminalBody, deployedBody]) {
    assert.deepEqual(
      { ...normalizeAudienceVisibilityProxyBody(SAVE, body as Record<string, unknown>) },
      { ...body },
    );
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
      { gender: "man " },
      { gender: "male" },
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
    // 0 is the create path on either shape.
    assert.ok(normalizeAudienceVisibilityProxyBody(
      SAVE,
      { ...body, expected_identity_revision: 0 } as Record<string, unknown>,
    ));
  }
  // Widening did not weaken the retired field's own validation: a malformed
  // echo is still refused, and the empty string is still the absent detail.
  assert.equal(
    normalizeAudienceVisibilityProxyBody(
      SAVE,
      { ...deployedBody, gender_detail: "Trans_Man" } as Record<string, unknown>,
    ),
    null,
  );
  assert.ok(normalizeAudienceVisibilityProxyBody(
    SAVE,
    { ...deployedBody, gender_detail: "" } as Record<string, unknown>,
  ));
  // The proxy accepts either exact body, so the CHOICE is the builder's alone:
  // it is the only place that knows which shape Core served.
  assert.equal(Object.hasOwn(terminalBody ?? {}, "gender_detail"), false);
  assert.equal(Object.hasOwn(deployedBody ?? {}, "gender_detail"), true);

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
      gender: "man", visible_to: "male", audit_reason: "Reviewed",
    }, UUID),
    null,
  );
  // An unresolved member has no gender chosen yet, and an unusable reason is
  // refused before a receipt is spent.
  assert.equal(
    audienceVisibilityMemberIdentityBody(terminal, {
      gender: "", visible_to: "male", audit_reason: "Reviewed",
    }, UUID),
    null,
  );
  assert.equal(
    audienceVisibilityMemberIdentityBody(terminal, {
      gender: "man", visible_to: "male", audit_reason: "x".repeat(301),
    }, UUID),
    null,
  );

  // An exact no-op is not offered: it would spend a receipt and an audit row
  // for nothing. The retired detail is echoed, never edited, so it plays no
  // part in the comparison on either shape.
  for (const member of [terminal, deployed]) {
    assert.equal(audienceVisibilityIdentityUnchanged(member, {
      gender: "woman", visible_to: "female", audit_reason: "Reviewed",
    }), true);
    assert.equal(audienceVisibilityIdentityUnchanged(member, {
      gender: "man", visible_to: "female", audit_reason: "Reviewed",
    }), false);
    assert.equal(audienceVisibilityIdentityUnchanged(member, {
      gender: "woman", visible_to: "both", audit_reason: "Reviewed",
    }), false);
  }
  // A member with no canonical document is never "unchanged".
  assert.equal(audienceVisibilityIdentityUnchanged(preAmendment, {
    gender: "woman", visible_to: "female", audit_reason: "Reviewed",
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
  // The T-669 Core answers the same mutation with the terminal member body.
  const terminalCanonical = {
    contract_version: 1,
    uid: 880124,
    gender: "man",
    visible_to: "male",
    revision: 3,
    group: { id: IDS[1], key: "male_for_male", legacy_segment: "male_gay" },
    identity_revision: 5,
  };
  const saved = audienceVisibilityMemberIdentityMutationResponse(success({
    contract_version: 1, member: canonical, replayed: false,
  }));
  assert.equal(saved?.replayed, false);
  assert.equal(saved?.member.identity?.identity_revision, 5);
  assert.equal(
    audienceVisibilityMemberIdentityMutationResponse(success({
      contract_version: 1, member: terminalCanonical, replayed: false,
    }))?.member.identity?.identity_revision,
    5,
    "the terminal mutation body is adopted exactly as the deployed one is",
  );
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

test("the retired detailed-gender vocabulary and its cross-walk are gone from the console", async () => {
  const lib = await readFile(new URL("../lib/audienceVisibilityAdmin.ts", import.meta.url), "utf8");
  // The detail vocabulary was always Core's; T-669 removes the console's last
  // reason to name any of it. `AUDIENCE_VISIBILITY_LEGACY_GENDER` existed only
  // to filter the served `identity_options` for the detail select that is now
  // retired, so it goes with the control.
  assert.doesNotMatch(lib, /cis_woman|trans_woman|transfeminine|genderqueer/u);
  assert.doesNotMatch(lib, /AUDIENCE_VISIBILITY_LEGACY_GENDER/u);
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
  // T-669: the panel neither renders nor edits the retired detail, so it needs
  // no catalogue from the page and offers no detail control.
  assert.doesNotMatch(panel, /identityGroups|detailOptions|gender_detail/u);
  assert.doesNotMatch(editor, /detailOptions|gender_detail|show_gender_detail/u);
  assert.match(page, /<AudienceVisibilityUserPanel uid=\{uid\} onIdentitySaved=\{load\} \/>/);
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
