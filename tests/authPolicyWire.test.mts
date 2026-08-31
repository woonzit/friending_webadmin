import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import {
  phoneDialFormatRefusal,
  phoneDialMaskValid,
} from "../lib/authPolicyConfiguration.ts";

/**
 * T-506's production-generated wire corpus, copied byte-identically from the
 * lead-accepted Core tip. These pins bind the Webadmin decoder to the exact
 * provider bytes and preserve the app-facing inert-format witnesses.
 */
const FIXTURE_DIRECTORY = new URL("./fixtures/auth_policy_wire/", import.meta.url);
const FIXTURE_ACCEPTED_CORE_TIP = "50c4dc0b060d9a9da7ff8a135a65d942c39fe621";
const FIXTURE_SOURCE_COMMIT = "5c17f1db41bb5a9875b4fed080e8b2f4092a9749";
const FIXTURE_GENERATOR_SHA256 = "72225dbf0a8578fc5ee4fa0e16f3dee558c0770c81a77a52ec80a2d0fc894a65";
const FIXTURE_SET_SHA256 = "bc4d066f8ec3b14d7290899dc6116faaa272eb5f559f27330810c012979b9f7d";
const FIXTURE_MANIFEST_SHA256 = "33aec55c8bcaa0fe67eab1a75a44721d37df699c8b44dc31f6cec1a340d3679e";
const FIXTURE_BODY_FILES = [
  "appconfig-default-hun.json",
  "appconfig-malformed-storefront.json",
  "appconfig-no-phone-formats.json",
  "appconfig-override-gbr.json",
  "appconfig-override-usa.json",
  "appconfig-unknown-alpha3.json",
  "refusal-email-method.json",
  "refusal-phone-dial-code.json",
  "refusal-phone-format-code-four-digits.json",
  "refusal-phone-format-code.json",
  "refusal-phone-format-duplicate-code.json",
  "refusal-phone-format-entry-shape.json",
  "refusal-phone-format-mask-character.json",
  "refusal-phone-format-mask-country-code.json",
  "refusal-phone-format-mask-empty.json",
  "refusal-phone-format-mask-leading-plus.json",
  "refusal-phone-format-mask-missing-star.json",
  "refusal-phone-format-mask-too-long.json",
  "refusal-phone-format-not-list.json",
  "refusal-phone-method.json",
] as const;
const FIXTURE_SOURCE_PATHS = [
  "src/Core/Response.php",
  "src/Http/Controllers/AppController.php",
  "src/Http/Controllers/UserController.php",
  "src/Http/Controllers/WebadminController.php",
  "src/Support/AppSettings.php",
  "src/Support/AuthMethodPolicy.php",
  "src/Support/EmailAuthPolicy.php",
  "src/Support/Webadmin.php",
  "tests/auth_policy_fixture_dump.php",
] as const;

const EXPECTED_WEBADMIN_REFUSALS = {
  "refusal-phone-format-code-four-digits.json": { field: "code", index: 0 },
  "refusal-phone-format-code.json": { field: "code", index: 0 },
  "refusal-phone-format-duplicate-code.json": { field: "code", index: 1 },
  "refusal-phone-format-entry-shape.json": { field: "phone_dial_formats", index: null },
  "refusal-phone-format-mask-character.json": { field: "mask", index: 0 },
  "refusal-phone-format-mask-country-code.json": { field: "mask", index: 0 },
  "refusal-phone-format-mask-empty.json": { field: "mask", index: 0 },
  "refusal-phone-format-mask-leading-plus.json": { field: "mask", index: 0 },
  "refusal-phone-format-mask-missing-star.json": { field: "mask", index: 0 },
  "refusal-phone-format-mask-too-long.json": { field: "mask", index: 0 },
  "refusal-phone-format-not-list.json": { field: "phone_dial_formats", index: null },
} as const;

type Json = Record<string, any>;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function fixture(file: string): Promise<Json> {
  return JSON.parse(await readFile(new URL(file, FIXTURE_DIRECTORY), "utf8"));
}

async function fixtureManifest(): Promise<Json> {
  return fixture("manifest.json");
}

test("the accepted auth-policy corpus is byte-identical, inventory-exact, and provenance-bound", async () => {
  const manifestWire = await readFile(new URL("manifest.json", FIXTURE_DIRECTORY), "utf8");
  assert.equal(sha256(manifestWire), FIXTURE_MANIFEST_SHA256);
  const manifest = JSON.parse(manifestWire) as Json;
  assert.deepEqual(Object.keys(manifest).sort(), [
    "fixture_set_sha256",
    "fixtures",
    "provenance",
    "schema_version",
    "source_commit",
  ]);
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.source_commit, FIXTURE_SOURCE_COMMIT);
  assert.equal(manifest.fixture_set_sha256, FIXTURE_SET_SHA256);
  assert.deepEqual(Object.keys(manifest.provenance).sort(), [
    "generator",
    "generator_sha256",
    "source_paths",
    "wire_adapter",
  ]);
  assert.equal(manifest.provenance.generator, "tests/auth_policy_fixture_dump.php");
  assert.equal(manifest.provenance.generator_sha256, FIXTURE_GENERATOR_SHA256);
  assert.equal(manifest.provenance.wire_adapter, "Friending\\Core\\Response::wirePayload");
  assert.deepEqual(manifest.provenance.source_paths, FIXTURE_SOURCE_PATHS);

  assert.deepEqual(manifest.fixtures.map((row: Json) => row.file), [...FIXTURE_BODY_FILES]);
  assert.deepEqual(
    (await readdir(FIXTURE_DIRECTORY)).sort(),
    [...FIXTURE_BODY_FILES, "manifest.json"].sort(),
  );

  const consumerCounts = new Map<string, number>();
  const aggregateRows: string[] = [];
  for (const row of manifest.fixtures as Json[]) {
    assert.deepEqual(Object.keys(row).sort(), ["case", "consumer", "file", "route", "sha256"]);
    assert.match(row.file, /^[a-z0-9-]+\.json$/u);
    assert.equal(typeof row.case, "string");
    assert.ok(row.case.length > 0);
    if (row.consumer === "webadmin") {
      assert.equal(row.route, "/v1/webadmin/set_settings");
    } else {
      assert.equal(row.consumer, "ios");
      assert.ok([
        "/v1/app/ios_appconfig",
        "/v1/iosuser/check_signin_mailcode",
        "/v1/iosuser/init_signup_phonenumber",
        "/v1/iosuser/init_signin_phonenumber",
      ].includes(row.route), row.file);
    }
    const wire = await readFile(new URL(row.file, FIXTURE_DIRECTORY), "utf8");
    assert.equal(sha256(wire), row.sha256, row.file);
    assert.doesNotThrow(() => JSON.parse(wire));
    assert.doesNotMatch(
      wire,
      /WEBADMIN_(?:API|SESSION)_SECRET|MONGODB_URI|review_code|verification_code/iu,
      row.file,
    );
    consumerCounts.set(row.consumer, (consumerCounts.get(row.consumer) ?? 0) + 1);
    aggregateRows.push(`${row.file}\0${row.sha256}`);
  }
  assert.deepEqual(Object.fromEntries([...consumerCounts].sort()), { ios: 9, webadmin: 11 });
  assert.equal(sha256(aggregateRows.join("\n")), FIXTURE_SET_SHA256);
  assert.match(FIXTURE_ACCEPTED_CORE_TIP, /^[0-9a-f]{40}$/u);
  assert.notEqual(FIXTURE_ACCEPTED_CORE_TIP, FIXTURE_SOURCE_COMMIT);
});

test("every published phone-format refusal passes the production dotted-field decoder", async () => {
  const manifest = await fixtureManifest();
  const webadminFiles = manifest.fixtures
    .filter((row: Json) => row.consumer === "webadmin")
    .map((row: Json) => row.file);
  assert.deepEqual(webadminFiles, Object.keys(EXPECTED_WEBADMIN_REFUSALS));

  for (const [file, expected] of Object.entries(EXPECTED_WEBADMIN_REFUSALS)) {
    assert.deepEqual(phoneDialFormatRefusal(await fixture(file)), expected, file);
  }
});

test("every appconfig publishes sorted valid formats and preserves inert masks", async () => {
  const manifest = await fixtureManifest();
  const appconfigFiles = manifest.fixtures
    .filter((row: Json) => row.route === "/v1/app/ios_appconfig")
    .map((row: Json) => row.file);
  assert.deepEqual(appconfigFiles, FIXTURE_BODY_FILES.slice(0, 6));

  for (const file of appconfigFiles) {
    const body = await fixture(file);
    const policy = body.data?.auth_policy as Json;
    assert.deepEqual(Object.keys(policy).sort(), [
      "apple",
      "email",
      "phone",
      "phone_dial_codes",
      "phone_formats",
      "revision",
      "storefront",
    ]);
    assert.ok(Array.isArray(policy.phone_formats), file);
    const codes: string[] = [];
    for (const row of policy.phone_formats as Json[]) {
      assert.deepEqual(Object.keys(row).sort(), ["code", "mask"]);
      assert.equal(typeof row.code, "string");
      assert.ok(row.code.length >= 1 && row.code.length <= 3, file);
      assert.notEqual(row.code[0], "0", file);
      assert.doesNotMatch(row.code, /[^0-9]/u, file);
      assert.equal(phoneDialMaskValid(row.mask), true, file);
      codes.push(row.code);
    }
    assert.equal(new Set(codes).size, codes.length, file);
    assert.deepEqual(codes, [...codes].sort((left, right) => Number(left) - Number(right)), file);
  }

  const empty = (await fixture("appconfig-no-phone-formats.json")).data.auth_policy;
  assert.deepEqual(empty.phone_formats, []);
  const usa = (await fixture("appconfig-override-usa.json")).data.auth_policy;
  assert.deepEqual(usa.phone_dial_codes, ["1"]);
  assert.deepEqual(usa.phone_formats.map((row: Json) => row.code), ["1", "36", "44"]);
});
