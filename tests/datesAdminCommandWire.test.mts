import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

// T-891: the receipts of the Dates console's commands, as Core serves them.
// Vendored byte-identically from the Core lane opus-core-fix, branch
// claude/core-hardening-20261002, tip 33265e469650a48202eb21c25a171bc2aea09139
// (git objects; hand-over team/chat/20261002T233953Z-opus-core-fix-to-opus-admin-p2-t891-core-pin.md).
// Every body is the answer to a real form-encoded HTTP POST into Core's front
// controller, checked by the generator against storage, audit and the durable
// command receipt, and captured twice. The REQUESTS are in the generator
// (tests/dates_admin_command_fixture_dump.php at that tip, digest pinned below):
// each request / answer pair the tests of this console use is transcribed from
// it at the place it is used, with its line.
const DIRECTORY = new URL("./fixtures/dates_admin_command_wire/", import.meta.url);
const SOURCE = "7353371a821b26762ff0f993cf252250a408217f";
const MANIFEST_SHA = "63bbcc6ed3801deb6395c2beb891dbb2c69319943f2a906022729956bc003c94";
const GENERATOR_SHA = "7d3efa7632333bc96824895321b93769f34737b01a84f60681d1a549e73fc4e0";
const SET_SHA = "80c762f2b64f0e99de0a8d702b52400b7e80787c7f5e98c6c253446f7b02d135";
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, DIRECTORY), "utf8"));

/** Every body of the corpus, by route, as the generator names them. */
export const COMMAND_CORPUS: Record<string, { successes: string[]; refusals: Record<string, [string, number]> }> = {
  dates_moderation_legal_hold: {
    successes: ["hold-place", "hold-place-unchanged", "hold-place-replay", "hold-amend", "hold-release", "hold-release-unchanged",
      "hold-selected-placed", "hold-selected-unchanged", "hold-selected-amended", "hold-selected-released", "hold-selected-release-unchanged"],
    refusals: { "hold-release-open": ["dates-legal-hold-case-open", 409], "hold-viewer": ["dates-admin-capability-required", 403],
      "hold-selected-stale": ["dates-admin-stale-revision", 409], "hold-selected-malformed": ["dates-admin-revision-required", 422] },
  },
  dates_moderation_trail_evidence: {
    successes: ["trail-capture", "trail-capture-replay", "trail-capture-existing", "trail-selected-capture", "trail-selected-capture-replay", "trail-selected-existing"],
    refusals: { "trail-capture-stale": ["dates-admin-stale-revision", 409], "trail-capture-viewer": ["dates-admin-capability-required", 403],
      "trail-selected-version": ["dates-admin-contract-version-invalid", 422] },
  },
  dates_activity_host_transfer: {
    successes: ["host-transfer", "host-transfer-replay", "host-transfer-selected", "host-transfer-selected-replay"],
    refusals: { "host-transfer-stale": ["dates-stale-revision", 409], "host-transfer-administrator": ["dates-admin-capability-required", 403] },
  },
  dates_activity_update: {
    successes: ["activity-update", "activity-update-replay"],
    refusals: { "activity-update-stale": ["dates-admin-stale-revision", 409], "activity-update-viewer": ["dates-admin-capability-required", 403] },
  },
  dates_activity_command: {
    successes: ["activity-end", "activity-end-replay", "activity-cancel", "activity-soft-delete", "activity-restore", "activity-purge"],
    refusals: { "activity-command-stale": ["dates-admin-stale-revision", 409], "activity-command-viewer": ["dates-admin-capability-required", 403],
      "activity-purge-administrator": ["dates-admin-capability-required", 403], "activity-purge-repeat": ["dates-admin-activity-unavailable", 404] },
  },
  dates_configuration_save: {
    successes: ["configuration-save", "configuration-save-first", "configuration-save-first-replay"],
    refusals: { "configuration-save-stale": ["dates-admin-stale-revision", 409], "configuration-save-viewer": ["dates-admin-capability-required", 403] },
  },
  dates_activity_type_save: {
    successes: ["activity-type-save", "activity-type-save-replay"],
    refusals: { "activity-type-save-stale": ["dates-admin-stale-revision", 409], "activity-type-save-viewer": ["dates-admin-capability-required", 403] },
  },
  dates_reason_deactivate: {
    successes: ["reason-deactivate", "reason-deactivate-replay"],
    refusals: { "reason-deactivate-stale": ["dates-admin-stale-revision", 409], "reason-deactivate-viewer": ["dates-admin-capability-required", 403] },
  },
  dates_moderation_resolve: {
    successes: ["resolve-dismiss", "resolve-dismiss-replay"],
    refusals: { "resolve-stale": ["dates-admin-stale-revision", 409], "resolve-viewer": ["dates-admin-capability-required", 403] },
  },
};

test("the command corpus is Core's capture at the pinned tip: 61 bodies, each against its digest, pinned independently of its manifest", () => {
  const raw = readFileSync(new URL("manifest.json", DIRECTORY)), manifest = JSON.parse(raw.toString());
  assert.equal(hash(raw), MANIFEST_SHA);
  assert.deepEqual([manifest.schema_version, manifest.contract, manifest.source_commit], [1, "dates-admin-command-v1", SOURCE]);
  assert.equal(manifest.provenance.generator, "tests/dates_admin_command_fixture_dump.php");
  assert.equal(manifest.provenance.generator_sha256, GENERATOR_SHA);
  assert.equal(manifest.provenance.source_paths.length, 173);
  assert.equal(manifest.fixture_set_sha256, SET_SHA);
  // The released console's requests get the released keys; the `selected` bodies answer requests that carry a selector.
  assert.match(manifest.provenance.released_console, /without expected_revision/);
  assert.match(manifest.provenance.released_console, /without dates_admin_command_contract_version/);
  const names = Object.values(COMMAND_CORPUS).flatMap(({ successes, refusals }) =>
    [...successes.map((name) => `admin-${name}.json`), ...Object.keys(refusals).map((name) => `admin-${name}-denied.json`)]).sort();
  assert.equal(names.length, 61);
  assert.deepEqual(manifest.fixtures.map((entry: { file: string }) => entry.file), names);
  assert.deepEqual(readdirSync(DIRECTORY).sort(), ["manifest.json", ...names].sort());
  const lines = manifest.fixtures.map((entry: { file: string; sha256: string; consumer: string; http_status: number; status_code: number }) => {
    const bytes = readFileSync(new URL(entry.file, DIRECTORY));
    assert.deepEqual([entry.consumer, entry.http_status], ["webadmin", 200], entry.file);
    assert.equal(hash(bytes), entry.sha256, entry.file);
    assert.equal(JSON.parse(bytes.toString()).status_code, entry.status_code, entry.file);
    return `${entry.file}\0${entry.sha256}`;
  });
  assert.equal(hash(lines.join("\n")), SET_SHA);
  assert.equal(manifest.fixtures.filter((entry: { status_code: number }) => entry.status_code === 200).length, 38);
  // Each refusal is Core's: its token, its status and the legacy envelope; nothing else in it.
  for (const { refusals } of Object.values(COMMAND_CORPUS)) for (const [name, [error, status]] of Object.entries(refusals))
    assert.deepEqual(fixture(`admin-${name}-denied`), { success: false, status_code: status, error, message: 200, status: 200, can_send: 0 }, name);
  // Each success is Core's envelope around the receipt.
  for (const { successes } of Object.values(COMMAND_CORPUS)) for (const name of successes) {
    const body = fixture(`admin-${name}`);
    assert.deepEqual([body.success, body.status_code, body.message, body.status, body.can_send, body.server_now], [true, 200, 200, 200, 0, 1790000000], name);
    assert.equal(typeof body.idempotency_replayed, "boolean", name); assert.match(body.audit_id, /^aud_[0-9a-f]{32}$/, name);
    assert.equal(body.idempotency_replayed, name.endsWith("-replay"), name);
  }
});
