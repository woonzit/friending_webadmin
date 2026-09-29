import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

/**
 * T-863 S11 (P-007, D-135): the gesture photo selfie, the third verification
 * method. The Webadmin half of Core's `profile-verification-photo-v1` wire
 * corpus is vendored byte for byte from Core `63240043` — the last Core commit
 * that touched `tests/fixtures/profile_verification_photo_wire/` (its manifest
 * rebind; every `webadmin-*` body is unchanged since the corpus commit
 * `b52fa634`, the manifest's `source_commit`). Core `main` 60b7814e, the live
 * release, carries the same bytes.
 *
 * Only the `webadmin-*` bodies and the manifest are copied. The manifest still
 * lists the iOS rows, so the fixture-set digest is recomputed over every row
 * while only the Webadmin bodies are hashed from disk.
 */

type Json = Record<string, any>;

const FIXTURE_DIRECTORY = new URL("./fixtures/profile_verification_photo_wire/", import.meta.url);
const FIXTURE_CONTRACT = "profile-verification-photo-v1";
const FIXTURE_COPIED_FROM = "63240043";
const FIXTURE_SOURCE_COMMIT = "b52fa634e99f66fae0ef31678fb858143e0eea81";
const FIXTURE_SET_SHA256 = "583f8d0d5060aa736474f97ec1236bab4998803f0911f883be031dc487b8ebcc";
const FIXTURE_GENERATOR_SHA256 = "93b0001a834a05cc4b741d8fc9e8cb79e7bb4d5773fcf78ccfa9b5d89a6ecb98";
const FIXTURE_MANIFEST_SHA256 = "8e1ce7734655aa66331528fce142cbc6f75c3e57211b9c8202cbef17290a14b4";
const WEBADMIN_FILES = [
  "webadmin-config.json",
  "webadmin-decision-photo-approved.json",
  "webadmin-detail-photo.json",
  "webadmin-method-console-photo-blocked.json",
  "webadmin-method-console-photo-ready.json",
  "webadmin-method-refusal-verification-method-photo-unavailable.json",
  "webadmin-queue-photo.json",
  "webadmin-refusal-evidence-kind-invalid.json",
  "webadmin-refusal-profile-verification-config-invalid.json",
  "webadmin-refusal-profile-verification-decision-invalid.json",
  "webadmin-refusal-profile-verification-evidence-not-found.json",
  "webadmin-refusal-profile-verification-gestures-insufficient.json",
  "webadmin-request-save-config.json",
] as const;

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function manifest(): Promise<Json> {
  return JSON.parse(await readFile(new URL("manifest.json", FIXTURE_DIRECTORY), "utf8")) as Json;
}

test(`the photo corpus is Core ${FIXTURE_COPIED_FROM}'s Webadmin half, byte for byte`, async () => {
  const raw = await readFile(new URL("manifest.json", FIXTURE_DIRECTORY));
  assert.equal(sha256(raw), FIXTURE_MANIFEST_SHA256, "the manifest itself is the copied bytes");
  const parsed = await manifest();
  assert.equal(parsed.schema_version, 1);
  assert.equal(parsed.contract, FIXTURE_CONTRACT);
  assert.equal(parsed.source_commit, FIXTURE_SOURCE_COMMIT);
  assert.equal(parsed.fixture_set_sha256, FIXTURE_SET_SHA256);
  assert.equal(parsed.provenance.generator, "tests/profile_verification_photo_fixture_dump.php");
  assert.equal(parsed.provenance.generator_sha256, FIXTURE_GENERATOR_SHA256);
  assert.deepEqual(parsed.provenance.webadmin_wire_adapters, {
    profile_verification: "Friending\\Support\\Webadmin::reply",
    verification_method: "Friending\\Support\\Webadmin::noStoreReply",
  });

  const rows = parsed.fixtures as Json[];
  const files = rows.map((row) => row.file as string);
  assert.deepEqual(files, [...files].sort(), "the manifest lists fixtures in sorted order");
  assert.equal(new Set(files).size, files.length);
  // The digest covers the whole corpus (iOS rows included) as `file\0sha256` lines.
  assert.equal(
    sha256(rows.map((row) => `${row.file}\0${row.sha256}`).join("\n")),
    FIXTURE_SET_SHA256,
    "the fixture-set hash is the sha256 over `file\\0sha256` rows",
  );

  const webadmin = rows.filter((row) => row.consumer === "webadmin");
  assert.deepEqual(webadmin.map((row) => row.file), [...WEBADMIN_FILES]);
  assert.deepEqual((await readdir(FIXTURE_DIRECTORY)).sort(), [...WEBADMIN_FILES, "manifest.json"].sort(),
    "exactly the Webadmin bodies and the manifest are vendored");
  for (const row of webadmin) {
    const wire = await readFile(new URL(row.file, FIXTURE_DIRECTORY));
    assert.equal(sha256(wire), row.sha256, `${row.file} must match its published byte hash`);
    assert.match(row.route, /^\/v1\/webadmin\/[a-z_]+$/u);
    // Every Webadmin answer rides on HTTP 200; the logical status is in the envelope.
    assert.equal(row.http_status, 200, row.file);
  }
});

test("the manifest pins the vocabularies this console decodes", async () => {
  const parsed = await manifest();
  assert.deepEqual(parsed.methods, ["persona", "video", "photo", "none"]);
  assert.deepEqual(parsed.photo_availability_reasons, [
    "deployment_unlock_disabled", "service_config_disabled", "processing_unavailable", "catalogue_insufficient",
  ]);
  assert.deepEqual(parsed.evidence_kinds, [
    "video", "avatar_snapshot",
    ...Array.from({ length: 10 }, (_, index) => `photo_${index + 1}`),
  ]);
  assert.deepEqual(parsed.control_plane_error_statuses, {
    "profile-verification-config-invalid": 422,
    "profile-verification-decision-invalid": 422,
    "profile-verification-evidence-invalid": 422,
    "profile-verification-evidence-not-found": 409,
    "profile-verification-gestures-insufficient": 409,
    "verification-method-photo-unavailable": 409,
  });
});

// ---------------------------------------------------------------------------
// 1. Method scopes: `photo` in the one method-scopes table (D-092a, D-135)
// ---------------------------------------------------------------------------

async function fixture(file: string): Promise<Json> {
  return JSON.parse(await readFile(new URL(file, FIXTURE_DIRECTORY), "utf8")) as Json;
}

/**
 * Core's generator re-reads every body with `json_decode($bytes, true)`, which
 * turns each empty JSON object into `[]`. On the live wire
 * `VerificationMethodPolicy::wireDocument` emits `{}` (stdClass) for both
 * override maps and for every override's locale containers, and the console
 * decoder keeps refusing a list where an object belongs. The test restores
 * exactly those positions — nothing else — before decoding.
 */
function restoreMethodPolicyObjects(body: Json): Json {
  const copy = structuredClone(body);
  const emptyObject = (value: unknown) => (Array.isArray(value) && value.length === 0 ? {} : value);
  for (const snapshot of [copy.data.policy.draft, copy.data.policy.live]) {
    const document = snapshot.document;
    document.overrides = emptyObject(document.overrides);
    document.waiting_room_copy.overrides = emptyObject(document.waiting_room_copy.overrides);
    for (const locales of Object.values(document.waiting_room_copy.overrides) as Json[]) {
      locales.en = emptyObject(locales.en);
      locales.hu = emptyObject(locales.hu);
    }
  }
  return copy;
}

test("the photo-blocked console decodes: a photo draft, the named blocker and the catalogue reason", async () => {
  const {
    documentUsesMethod,
    verificationMethodConsoleResponse,
  } = await import("../lib/verificationMethod.ts");
  const raw = await fixture("webadmin-method-console-photo-blocked.json");
  assert.equal(verificationMethodConsoleResponse(raw), null, "the generator's `[]` for an empty map stays refused");
  const parsed = verificationMethodConsoleResponse(restoreMethodPolicyObjects(raw));
  assert.ok(parsed);
  assert.equal(parsed.policy.draft.document.global, "photo");
  assert.equal(parsed.policy.live.document.global, "persona");
  assert.equal(documentUsesMethod(parsed.policy.draft.document, "photo"), true);
  assert.equal(documentUsesMethod(parsed.policy.live.document, "photo"), false);
  assert.deepEqual(parsed.method_availability.photo, {
    method: "photo", policy_enable_allowed: false, new_start_available: false, reason: "catalogue_insufficient",
  });
  assert.deepEqual(parsed.publish_guard, { ready: false, blocking_codes: ["verification-method-photo-unavailable"] });
});

test("the photo-ready console decodes: photo live in one storefront, the guard ready", async () => {
  const {
    photoStorefronts,
    resolveMandatoryMethod,
    verificationMethodConsoleResponse,
  } = await import("../lib/verificationMethod.ts");
  const parsed = verificationMethodConsoleResponse(restoreMethodPolicyObjects(await fixture("webadmin-method-console-photo-ready.json")));
  assert.ok(parsed);
  assert.deepEqual(photoStorefronts(parsed.policy.live.document), ["HUN"]);
  assert.equal(resolveMandatoryMethod(parsed.policy.live.document, "HUN"), "photo");
  assert.equal(resolveMandatoryMethod(parsed.policy.live.document, "USA"), "persona");
  assert.deepEqual(parsed.method_availability.photo, {
    method: "photo", policy_enable_allowed: true, new_start_available: true, reason: null,
  });
  assert.deepEqual(parsed.publish_guard, { ready: true, blocking_codes: [] });
});

test("the publish refusal decodes as the photo blocker: terminal, never retained for a retry", async () => {
  const {
    VERIFICATION_METHOD_PHOTO_UNAVAILABLE,
    verificationMethodErrorResponse,
    verificationMethodShouldRetainMutation,
  } = await import("../lib/verificationMethod.ts");
  const error = verificationMethodErrorResponse(await fixture("webadmin-method-refusal-verification-method-photo-unavailable.json"));
  assert.equal(error, VERIFICATION_METHOD_PHOTO_UNAVAILABLE);
  assert.equal(verificationMethodShouldRetainMutation(error), false, "a 409 proves nothing became live");
});

test("the scopes table names the photo blocker, points at the catalogue editor and warns about the iOS rollout", async () => {
  const [table, lib] = await Promise.all([
    readFile(new URL("../components/VerificationMethodScopesTable.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/verificationMethod.ts", import.meta.url), "utf8"),
  ]);
  assert.match(lib, /VERIFICATION_METHOD_PHOTO_CATALOGUE_HREF = `\/configuration#\$\{VERIFICATION_METHOD_PHOTO_CATALOGUE_ANCHOR\}`/);
  assert.match(table, /const consoleBlockers = guardRevision === data\.policy\.revision \? data\.publish_guard\.blocking_codes : \[\];/,
    "the console guard is shown only for the revision it was computed for");
  assert.match(table, /consoleBlockers\.includes\(VERIFICATION_METHOD_PHOTO_UNAVAILABLE\)/,
    "the console guard over the saved draft shows the blocker before any preview");
  assert.match(table, /draftUsesPhoto && !availability\.photo\.policy_enable_allowed/,
    "an unsaved photo draft learns about the catalogue before pressing anything");
  assert.match(table, /if \(error === VERIFICATION_METHOD_PHOTO_UNAVAILABLE\) setPhotoRefused\(true\);/);
  assert.match(table, /href=\{VERIFICATION_METHOD_PHOTO_CATALOGUE_HREF\}/);
  assert.match(table, /data-verification-method-photo-rollout="true"/);
  assert.match(table, /photo: shared\("preview\.primaryPhoto"\)/);
});

// ---------------------------------------------------------------------------
// 2. The gesture catalogue editor (profile_verification_config)
// ---------------------------------------------------------------------------

test("the corpus configuration decodes with its catalogue, count and eighteen photo sentences", async () => {
  const {
    PROFILE_VERIFICATION_PHOTO_FLOW_KEYS,
    normalizeProfileVerificationConfig,
    photoCatalogueSufficient,
    profileVerificationConfigIssues,
    profileVerificationResponseData,
  } = await import("../lib/profileVerification.ts");
  const body = await fixture("webadmin-config.json");
  const parsed = normalizeProfileVerificationConfig(profileVerificationResponseData(body));
  assert.ok(parsed);
  assert.equal(parsed.photo_gesture_count, 3);
  assert.deepEqual(parsed.photo_gestures.map((row) => row.id), [1, 2, 3, 4].map((n) => String(n).padStart(32, "0")));
  assert.equal(parsed.photo_gestures[0].title.hu, "Felfelé mutató hüvelykujj");
  assert.deepEqual(Object.keys(parsed.copy.photo_flow), [...PROFILE_VERIFICATION_PHOTO_FLOW_KEYS]);
  assert.equal(PROFILE_VERIFICATION_PHOTO_FLOW_KEYS.length, 18);
  assert.deepEqual(Object.keys(parsed.copy.photo_flow), Object.keys(body.data.copy.photo_flow), "Core's field order");
  assert.equal(photoCatalogueSufficient(parsed.photo_gestures, parsed.photo_gesture_count), true);
  assert.deepEqual(profileVerificationConfigIssues(parsed), [], "Core's own document has no field problem");
});

test("the save body is exactly the corpus request: copy with photo_flow, prompts, gestures, count", async () => {
  const {
    normalizeProfileVerificationConfig,
    profileVerificationResponseData,
    profileVerificationSavePayload,
  } = await import("../lib/profileVerification.ts");
  const request = await fixture("webadmin-request-save-config.json");
  const parsed = normalizeProfileVerificationConfig(profileVerificationResponseData(await fixture("webadmin-config.json")));
  assert.ok(parsed);
  const payload = profileVerificationSavePayload(parsed);
  assert.deepEqual(payload, request.form_fields.configuration_json);
  assert.deepEqual(Object.keys(payload), Object.keys(request.form_fields.configuration_json));
  // Core SAVE_REQUIRED_KEYS + the two catalogue keys; `enabled` is derived and never sent.
  assert.deepEqual(request.required_configuration_keys, ["copy", "prompts"]);
  assert.deepEqual(request.optional_configuration_keys, ["enabled", "photo_gesture_count", "photo_gestures"]);
  assert.equal("enabled" in payload, false);
  for (const key of Object.keys(payload)) {
    assert.ok([...request.required_configuration_keys, ...request.optional_configuration_keys].includes(key), key);
  }
});

test("the two save refusals keep their Core statuses and the editor maps each one", async () => {
  const invalid = await fixture("webadmin-refusal-profile-verification-config-invalid.json");
  const insufficient = await fixture("webadmin-refusal-profile-verification-gestures-insufficient.json");
  assert.deepEqual([invalid.error, invalid.status_code, "data" in invalid], ["profile-verification-config-invalid", 422, false]);
  assert.deepEqual([insufficient.error, insufficient.status_code, "data" in insufficient], ["profile-verification-gestures-insufficient", 409, false]);
  const editor = await readFile(new URL("../components/ProfileVerificationConfiguration.tsx", import.meta.url), "utf8");
  assert.match(editor, /error === "profile-verification-gestures-insufficient"[\s\S]{0,200}setCountRefused\(true\)/);
  assert.match(editor, /error === "profile-verification-config-invalid"[\s\S]{0,300}setShowIssues\(true\)/);
  assert.match(editor, /error === "admin-write-required"/);
});

// ---------------------------------------------------------------------------
// 3. Whole-set case review (profile_verification_detail / _decision / _evidence)
// ---------------------------------------------------------------------------

test("the photo case detail decodes: the mode everywhere, the ordered set, the frozen bilingual gestures", async () => {
  const {
    profileVerificationDetail,
    profileVerificationPhotoSetComplete,
    profileVerificationResponseData,
  } = await import("../lib/profileVerification.ts");
  const parsed = profileVerificationDetail(profileVerificationResponseData(await fixture("webadmin-detail-photo.json")));
  assert.ok(parsed);
  assert.equal(parsed.state.verification_mode, "photo");
  assert.equal(parsed.case?.verification_mode, "photo");
  assert.equal(parsed.case?.has_avatar_snapshot, true, "the set is reviewed beside the case-time avatar snapshot");
  assert.ok(parsed.submission);
  assert.equal(parsed.submission.verification_mode, "photo");
  assert.equal(parsed.submission.photo_gesture_count, 3);
  assert.equal(parsed.submission.has_video, false);
  assert.deepEqual(parsed.submission.photos.map((photo) => [photo.kind, photo.position]), [["photo_1", 1], ["photo_2", 2], ["photo_3", 3]]);
  assert.deepEqual(parsed.submission.photos[0].gesture.title, { en: "Hand on chin", hu: "Kéz az állon" });
  assert.equal(parsed.submission.photos[0].gesture.preferred_example, "female");
  assert.ok(parsed.submission.photos.every((photo) => photo.has_photo && photo.mime === "image/jpeg" && /^[a-f0-9]{64}$/u.test(photo.sha256)));
  assert.equal(profileVerificationPhotoSetComplete(parsed.submission), true);
  assert.equal(parsed.history[0].event_type, "photos_submitted");
});

test("the approve and refusal bodies: approve acts on the set, an incomplete set is a 409, no replacement for a set", async () => {
  const approved = await fixture("webadmin-decision-photo-approved.json");
  assert.equal(approved.success, true);
  assert.deepEqual([approved.data.verification_mode, approved.data.status, approved.data.decision], ["photo", "approved", "approve"]);
  const incomplete = await fixture("webadmin-refusal-profile-verification-evidence-not-found.json");
  assert.deepEqual([incomplete.error, incomplete.status_code], ["profile-verification-evidence-not-found", 409]);
  assert.equal(incomplete.data.verification_mode, "photo", "the refusal carries the case it refused");
  const invalid = await fixture("webadmin-refusal-profile-verification-decision-invalid.json");
  assert.deepEqual([invalid.error, invalid.status_code], ["profile-verification-decision-invalid", 422]);
  const page = await readFile(new URL("../app/(dashboard)/profile-verification/[caseId]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /error === "profile-verification-evidence-not-found" && photoCase\(current\)\) return t\("photo\.evidenceIncomplete"\)/);
  assert.match(page, /error === "profile-verification-decision-invalid" && photoCase\(current\)\) return t\("photo\.wholeSetDecision"\)/);
  assert.match(page, /text: decisionRefusal\(String\(response\?\.error \|\| "core-unavailable"\), detail\)/);
});

test("the evidence route takes photo_1..photo_10 as JPEG and keeps the S3/S9 request guard first", async () => {
  const {
    PROFILE_VERIFICATION_EVIDENCE_KINDS,
    isProfileVerificationEvidenceKind,
    profileVerificationEvidenceContentType,
    profileVerificationEvidenceUrl,
  } = await import("../lib/profileVerification.ts");
  const parsed = await manifest();
  assert.deepEqual([...PROFILE_VERIFICATION_EVIDENCE_KINDS], parsed.evidence_kinds, "the manifest's closed kind list");
  for (const kind of PROFILE_VERIFICATION_EVIDENCE_KINDS) {
    assert.equal(isProfileVerificationEvidenceKind(kind), true, kind);
    assert.equal(profileVerificationEvidenceContentType(kind), kind === "video" ? "video/mp4" : "image/jpeg", kind);
  }
  for (const kind of ["photo_0", "photo_11", "PHOTO_1", " photo_1", "photo_01", "photo", "avatar", ""]) {
    assert.equal(isProfileVerificationEvidenceKind(kind), false, kind);
  }
  const caseId = "6".repeat(32);
  assert.equal(profileVerificationEvidenceUrl(caseId, "photo_10"), `/api/admin/profile-verification-evidence?case_id=${caseId}&kind=photo_10`);
  assert.equal(profileVerificationEvidenceUrl(caseId, "photo_11" as never), "");
  assert.deepEqual(await fixture("webadmin-refusal-evidence-kind-invalid.json"), {
    success: false, status_code: 422, error: "profile-verification-evidence-invalid", message: 200, status: 200, can_send: 0,
  });

  const route = await readFile(new URL("../app/api/admin/profile-verification-evidence/route.ts", import.meta.url), "utf8");
  const guard = route.indexOf("if (!isTrustedAdminMediaRead(request.headers))");
  assert.ok(guard > 0 && guard < route.indexOf("requireAdminWriter()") && guard < route.indexOf("coreBinaryCall("),
    "the same-origin / Fetch Metadata guard still runs before the session and Core");
  assert.match(route, /if \(!CASE_ID\.test\(caseId\) \|\| !isProfileVerificationEvidenceKind\(kind\)\) \{\s+return jsonError\("profile-verification-evidence-invalid", 422\);/);
  assert.match(route, /const expectedType = profileVerificationEvidenceContentType\(kind\);/);
  assert.match(route, /!contentType\.toLowerCase\(\)\.startsWith\(expectedType\)/, "a photo must come back as image/jpeg");
  assert.doesNotMatch(route, /\["video", "avatar_snapshot"\]/);
});

test("the case page reviews the whole set, gates Approve on every loaded photo and hides the replacement request", async () => {
  const page = await readFile(new URL("../app/(dashboard)/profile-verification/[caseId]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /return \(current\?\.case\?\.verification_mode \?\? current\?\.submission\?\.verification_mode\) === "photo";/,
    "the case projection decides, even when the submission row is gone");
  assert.match(page, /if \(!current \|\| !currentCase \|\| !evidenceOpen \|\| !profileVerificationPhotoSetComplete\(current\.submission\)\) return false;\s+return allProfileVerificationPhotosLoaded\(currentCase\.case_id, current\.submission\?\.photos \?\? \[\], loadedPhotos\);/);
  // Approve is refused at prepare time, at execute time and by the disabled button.
  assert.match(page, /if \(action === "approve" && photoCase\(detail\) && !photosReadyFor\(detail\)\) \{/);
  assert.match(page, /if \(confirmation\.action === "approve" && photoCase\(detail\) && !photosReadyFor\(detail\)\) \{/);
  assert.match(page, /disabled=\{busy \|\| \(action === "approve" && \(profileIncomplete \|\| \(isPhoto && !photosReady\)\)\)\}/);
  assert.match(page, /\.filter\(\(value\) => !isPhoto \|\| value !== "request_new_video"\)/);
  assert.match(page, /if \(photoCase\(detail\) && action === "request_new_video"\) \{/);
  assert.match(page, /isPhoto && photos\.map\(\(photo\) => <PhotoVerificationEvidence key=\{`\$\{item\.case_id\}-\$\{photo\.kind\}`\} caseId=\{item\.case_id\}/);
  // A route change forgets every rendered photo, so another case can never unlock Approve.
  const reset = page.slice(page.indexOf("useEffect(() => {\n    setState(\"loading\");"));
  assert.ok(reset.slice(0, 400).includes("setLoadedPhotos({})"));
  assert.match(page, /\{detail\.submission && !isPhoto && <div className="verification-challenge-sequence">/);
});

// ---------------------------------------------------------------------------
// 4. The queue names each case's review
// ---------------------------------------------------------------------------

test("the corpus queue decodes a photo set and a video row, and a row without a mode fails closed", async () => {
  const { profileVerificationQueue, profileVerificationResponseData } = await import("../lib/profileVerification.ts");
  const body = await fixture("webadmin-queue-photo.json");
  const parsed = profileVerificationQueue(profileVerificationResponseData(body));
  assert.ok(parsed);
  assert.deepEqual(parsed.items.map((row) => [row.uid, row.verification_mode]), [[995480, "photo"], [995481, "video"]]);
  for (const mode of [undefined, "photo_selfie", "", null]) {
    const broken = structuredClone(body.data);
    if (mode === undefined) delete broken.items[0].verification_mode; else broken.items[0].verification_mode = mode;
    assert.equal(profileVerificationQueue(broken), null, String(mode));
  }
  const page = await readFile(new URL("../app/(dashboard)/profile-verification/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<th>\{t\("mode"\)\}<\/th>/);
  assert.match(page, /data-verification-mode=\{row\.verification_mode\}>\{t\(`modes\.\$\{row\.verification_mode\}`\)\}/);
});
