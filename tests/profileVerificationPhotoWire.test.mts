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
