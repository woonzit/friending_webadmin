import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { decodeDatesActivityList, decodeDatesExternalDetail, decodeDatesExternalList,
  decodeDatesExternalPlaces, decodeDatesExternalReceipt, datesExternalRefusal,
  type DatesExternalMutationBaseline } from "../lib/datesExternalAdmin.ts";

// Actual Router/Webadmin capture, byte-identical to Core 0893e25edf31fc281427f492869bfebd0e6681fb.
// The source/generator pin is intentionally independent of the vendored manifest.
const DIRECTORY = new URL("./fixtures/dates_external_admin_wire/", import.meta.url);
const SOURCE = "bc0a69a36a325b21a3eac9d5e2a3c4d169da1755";
const SOURCE_SHA = "2fe4788bd3698e4464522749efd042c4d70c78c4c8c724f29e5167a32e02ec40";
const MANIFEST_SHA = "bb998ba0acb750f2e2e16435ebf9783ea34f681727eca645c277c080701ef8cf";
const GENERATOR_SHA = "5178d5e8c01e58065f3016e2c3430031487d0e65102852b3b856b2750467414a";
const SET_SHA = "2935f5df31e7003d395da8a386ec2def6e01e7be0824b2ccc02f78e22c058610";
const LISTS = ["admin", "canceled", "empty", "filter-empty", "page-empty", "viewer"];
const DETAILS = ["admin", "canceled", "estimated", "viewer"];
const PLACES = ["available", "empty", "rate-limited", "unavailable"];
const WRITES = ["publish", "publish-replay", "update", "update-replay", "official-update", "official-update-replay", "reverify", "cancel", "withdraw"];
const REFUSALS = ["command-invalid", "command-state", "confirmation-required", "duplicate", "filter-invalid", "id-invalid", "input-invalid",
  "key-conflict", "not-found", "place-query-invalid", "place-viewer", "publish-viewer", "publishing-disabled", "revision-invalid", "revoked",
  "source-required", "text-invalid", "unauthorized", "update-conflict"];
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, DIRECTORY), "utf8"));

test("external editor corpus is the complete 43-response genuine capture with independent provenance pins", () => {
  const manifest = fixture("manifest");
  assert.equal(hash(readFileSync(new URL("manifest.json", DIRECTORY))), MANIFEST_SHA);
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.contract, "dates-external-admin-v1");
  assert.equal(manifest.source_commit, SOURCE);
  assert.equal(manifest.source_checksum, SOURCE_SHA);
  assert.equal(manifest.provenance.generator, "tests/dates_external_admin_fixture_dump.php");
  assert.equal(manifest.provenance.generator_sha256, GENERATOR_SHA);
  assert.equal(manifest.fixture_count, 43);
  assert.equal(manifest.fixture_set_sha256, SET_SHA);
  const names = ["admin-activity-list-external.json", ...LISTS.map((name) => `admin-list-${name}.json`),
    ...DETAILS.map((name) => `admin-detail-${name}.json`), ...PLACES.map((name) => `admin-places-${name}.json`),
    ...WRITES.map((name) => `admin-${name}.json`), ...REFUSALS.map((name) => `admin-${name}-denied.json`)].sort();
  assert.deepEqual(manifest.fixtures.map((entry: { file: string }) => entry.file), names);
  assert.deepEqual(readdirSync(DIRECTORY).sort(), ["manifest.json", ...names].sort());
  const lines = manifest.fixtures.map((entry: { file: string; sha256: string; consumer: string; http_status: number; status_code: number }) => {
    const bytes = readFileSync(new URL(entry.file, DIRECTORY));
    assert.equal(entry.consumer, "webadmin");
    assert.equal(entry.http_status, 200);
    assert.equal(hash(bytes), entry.sha256, entry.file);
    assert.equal(JSON.parse(bytes.toString()).status_code, entry.status_code, entry.file);
    return `${entry.file}\0${entry.sha256}`;
  });
  assert.equal(hash(lines.join("\n")), SET_SHA);
});

for (const name of LISTS) test(`genuine external list ${name} passes the production decoder unchanged`, () => {
  const body = fixture(`admin-list-${name}`);
  assert.deepEqual(decodeDatesExternalList(body, { page: body.page, limit: body.limit }), body);
});
for (const name of DETAILS) test(`genuine external detail ${name} passes the production decoder unchanged`, () => {
  const body = fixture(`admin-detail-${name}`);
  assert.deepEqual(decodeDatesExternalDetail(body, body.event.external_event_id), body);
  assert.ok(Object.values(body.event.editor_input.confirmations).every((value) => value === false));
  assert.equal(body.event.can_edit, name === "admin" || name === "estimated");
  assert.equal(body.event.editor_input.end_at === null, name === "estimated" || name === "canceled");
  assert.equal(body.event.ai_assisted, false);
  assert.deepEqual(body.event.credit, { channel: "admin", submitted_by_uid: null, anonymous: true, first_submitter_uid: null });
});
for (const name of PLACES) test(`genuine Places ${name} keeps provider provenance and manual fallback`, () => {
  const body = fixture(`admin-places-${name}`);
  assert.deepEqual(decodeDatesExternalPlaces(body), body);
  assert.equal(body.manual_entry, true);
});
test("genuine populated activity origin row has no member host or finite capacity", () => {
  const body = fixture("admin-activity-list-external");
  assert.deepEqual(decodeDatesActivityList(body, { page: body.page, limit: body.limit }), body);
  assert.equal(body.activities[0].host, null);
  assert.equal(body.activities[0].maximum_people, null);
  assert.equal(body.activities[0].can_host_transfer, false);
});

// Request baselines follow the provider generator's explicit command sequence;
// they are consumer request context, never modified/fabricated response bodies.
const contexts = {
  update: { id: "01", revision: 1, activity_revision: 1 },
  "official-update": { id: "01", revision: 2, activity_revision: 2 },
  reverify: { id: "01", revision: 3, activity_revision: 3 },
  cancel: { id: "01", revision: 4, activity_revision: 4 },
  withdraw: { id: "02", revision: 1, activity_revision: 1 },
} as const;
for (const name of WRITES) test(`genuine ${name} receipt binds the submitted command and both revisions`, () => {
  const body = fixture(`admin-${name}`);
  const command = name.replace(/-replay$/, "");
  if (command === "publish") {
    assert.deepEqual(decodeDatesExternalReceipt(body, "dates_external_event_publish", {}, null), body);
    return;
  }
  const context = contexts[command as keyof typeof contexts];
  const baseline: DatesExternalMutationBaseline = { external_event_id: `xev_${context.id.padStart(32, "0")}`,
    activity_id: `act_${context.id.padStart(32, "0")}`, revision: context.revision, activity_revision: context.activity_revision,
    status: "published", lifecycle: "active", soft_deleted: false };
  const request = { external_event_id: baseline.external_event_id, expected_revision: baseline.revision, action: command.replaceAll("-", "_") };
  assert.deepEqual(decodeDatesExternalReceipt(body, command === "update" ? "dates_external_event_update" : "dates_external_event_command", request, baseline), body);
});
for (const name of REFUSALS) test(`genuine ${name} refusal cannot be adopted as success`, () => {
  const body = fixture(`admin-${name}-denied`);
  assert.equal(decodeDatesExternalList(body, { page: 1, limit: 40 }), null);
  assert.equal(decodeDatesExternalPlaces(body), null);
  assert.equal(decodeDatesExternalReceipt(body, "dates_external_event_publish", {}, null), null);
  const result = datesExternalRefusal(body);
  assert.equal(result.error, body.error);
  assert.equal(result.status, body.status_code);
  const uncertain = ["key-conflict", "place-viewer", "publish-viewer", "revoked", "unauthorized", "place-query-invalid"].includes(name);
  assert.equal(result.kind, uncertain ? "uncertain" : "refused");
});
