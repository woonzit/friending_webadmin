import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { decodeDatesActivityList, decodeDatesActivityOriginDetail, decodeDatesExternalDetail, decodeDatesExternalList,
  decodeDatesExternalPlaces, decodeDatesExternalReceipt, datesExternalRefusal,
  type DatesExternalMutationBaseline } from "../lib/datesExternalAdmin.ts";
import { datesCaseDetail, datesConsoleCommandReceipt, datesEvidenceRead, datesLegalHoldReceipt, datesModerationQueue } from "../lib/datesModerationRead.ts";
import { datesExternalResolutionReceipt, prepareDatesExternalResolution, runDatesExternalResolution } from "../lib/datesExternalModeration.ts";
import { datesConfigurationRawValue, datesSettingEffectiveText } from "../lib/datesAdmin.ts";
import { DATES_RUNTIME_HELP_GROUPS } from "../lib/datesRuntimeHelp.ts";

// Actual Router/Webadmin capture, byte-identical to Core b522827c9b10745610dcdef52777e56e951c1401.
// The source/generator pin is intentionally independent of the vendored manifest.
const DIRECTORY = new URL("./fixtures/dates_external_admin_wire/", import.meta.url);
const SOURCE = "83872f97d70ff8bfa381fd98c9ee47578febfabc";
const SOURCE_SHA = "e07353485e3c68eb3bc419c8c116c8ff461d4f9cacc3cfdec3bcd32cf46fca2f";
const MANIFEST_SHA = "6ee836e010de97868bdc3988cfe92ebe65d7b50c34b3b95d69dcf71393dd128b";
const GENERATOR_SHA = "8a63d3657be4c35240c120144a6f19f4e3da71585316fac9548154c9870737d8";
const SET_SHA = "8a0b8fac6340a2d28c119e46f5bd2be3863c073b18c49368710b95ceb214775c";
const LISTS = ["admin", "canceled", "empty", "filter-empty", "page-empty", "viewer"];
const DETAILS = ["admin", "canceled", "estimated", "viewer"];
const PLACES = ["available", "empty", "rate-limited", "unavailable"];
const WRITES = ["publish", "publish-replay", "update", "update-replay", "official-update", "official-update-replay", "reverify", "cancel", "withdraw"];
const REFUSALS = ["command-invalid", "command-state", "confirmation-required", "duplicate", "filter-invalid", "id-invalid", "input-invalid",
  "key-conflict", "not-found", "place-query-invalid", "place-viewer", "publish-viewer", "publishing-disabled", "revision-invalid", "revoked",
  "source-required", "text-invalid", "unauthorized", "update-conflict"];
const ACTIVITY_WRITES = ["end", "end-replay", "soft-delete", "soft-delete-replay", "restore", "restore-replay", "purge", "purge-replay"];
const MODERATION_DETAILS = ["claimed", "closed", "purged", "viewer"];
const MODERATION_DECISIONS = ["resolve", "resolve-replay", "restore", "cancel", "remove-activity", "dismiss"];
const CONSOLE_REFUSALS = ["activity-command-stale", "activity-command-viewer", "activity-purge-hold", "activity-purge-open-case", "activity-purge-retention",
  "moderation-action-invalid", "moderation-claim-viewer", "moderation-conflict", "moderation-evidence-viewer", "moderation-hold-open",
  "moderation-hold-viewer", "moderation-key-conflict", "moderation-resolve-viewer", "moderation-restore-terminal", "moderation-revision-invalid",
  "moderation-revision-missing", "moderation-revision-stale", "moderation-target-invalid"];
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, DIRECTORY), "utf8"));

test("external console corpus is the complete 88-response genuine capture with independent provenance pins", () => {
  const manifest = fixture("manifest");
  assert.equal(hash(readFileSync(new URL("manifest.json", DIRECTORY))), MANIFEST_SHA);
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.contract, "dates-external-admin-v1");
  assert.equal(manifest.source_commit, SOURCE);
  assert.equal(manifest.source_checksum, SOURCE_SHA);
  assert.equal(manifest.provenance.generator, "tests/dates_external_admin_fixture_dump.php");
  assert.equal(manifest.provenance.generator_sha256, GENERATOR_SHA);
  assert.equal(manifest.fixture_count, 88);
  assert.equal(manifest.fixture_set_sha256, SET_SHA);
  const names = ["admin-activity-list-external.json", ...LISTS.map((name) => `admin-list-${name}.json`),
    ...DETAILS.map((name) => `admin-detail-${name}.json`), ...PLACES.map((name) => `admin-places-${name}.json`),
    ...WRITES.map((name) => `admin-${name}.json`), ...REFUSALS.map((name) => `admin-${name}-denied.json`),
    "admin-activity-detail-external.json", ...ACTIVITY_WRITES.map((name) => `admin-activity-${name}.json`),
    "admin-configuration-default-off.json", "admin-configuration-publishing-on.json",
    ...MODERATION_DETAILS.map((name) => `admin-moderation-detail-${name}.json`),
    ...["queue", "evidence", "claim", "claim-replay", "hold-place", "hold-release", ...MODERATION_DECISIONS].map((name) => `admin-moderation-${name}.json`),
    ...CONSOLE_REFUSALS.map((name) => `admin-${name}-denied.json`)].sort();
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

test("genuine existing activity detail binds the linked external facts without inventing a member host", () => {
  const body = fixture("admin-activity-detail-external");
  const result = decodeDatesActivityOriginDetail(body, "act_" + "03".padStart(32, "0"), ["dates_external_event_read", "dates_external_event_manage"]);
  assert.deepEqual(result, { activity: body.activity, external: body.external_event });
});
for (const name of ACTIVITY_WRITES) test(`genuine lifecycle ${name} uses activity CAS and keeps ledger CAS separate`, () => {
  const action = name.replace(/-replay$/, "").replaceAll("-", "_");
  const revision = { end: 1, soft_delete: 2, restore: 3, purge: 5 }[action]!;
  const baseline: DatesExternalMutationBaseline = { external_event_id: "xev_" + "03".padStart(32, "0"), activity_id: "act_" + "03".padStart(32, "0"),
    revision, activity_revision: revision, status: action === "end" ? "published" : "ended", lifecycle: action === "end" ? "active" : "ended",
    soft_deleted: action === "restore" || action === "purge" };
  const body = fixture(`admin-activity-${name}`);
  assert.deepEqual(decodeDatesExternalReceipt(body, "dates_activity_command", { activity_id: baseline.activity_id, expected_revision: revision, action }, baseline), body);
});
for (const name of ["default-off", "publishing-on"]) test(`genuine configuration ${name} exposes all six exact P1 settings`, () => {
  const body = fixture(`admin-configuration-${name}`), group = DATES_RUNTIME_HELP_GROUPS.find((item) => item.id === "externalEvents")!;
  assert.equal(body.settings.length, 33);
  const expected: Record<string, unknown> = { dates_external_events_enabled: true, dates_external_events_enabled_overrides: [],
    dates_external_publishing_enabled: name === "publishing-on", dates_event_invite_daily_limit: 20, dates_event_invite_per_event_limit: 10, dates_event_lookahead_days: 180 };
  assert.deepEqual([...group.settingKeys].sort(), Object.keys(expected).sort());
  for (const key of group.settingKeys) {
    const setting = body.settings.find((row: any) => row.key === key); assert.ok(setting, key); assert.deepEqual(setting.value, expected[key], key);
    assert.notEqual(datesConfigurationRawValue(setting.type, setting.value), "[object Object]");
    assert.notEqual(datesSettingEffectiveText(setting.type, setting.effective_value), "—");
    if (key === "dates_external_publishing_enabled") assert.equal(setting.default_value, false);
  }
});
for (const name of MODERATION_DETAILS) test(`genuine external moderation ${name} has safe non-member case metadata`, () => {
  const body = fixture(`admin-moderation-detail-${name}`), result = datesCaseDetail(body, "cas_" + "01".padStart(32, "0"));
  assert.ok(result); assert.deepEqual(result.case, body.case); assert.deepEqual(result.decisions, body.decisions);
  assert.deepEqual(result.reports[0].reason_label_snapshot, { locale: "hu", label: "Hibás adatok" });
  assert.equal(result.case.target_uid, 0);
  if (name === "purged") { assert.equal(result.case.external_revision, null); assert.deepEqual(result.case.allowed_actions, []); }
});
test("genuine external queue, evidence and claim/replay use the existing moderated routes", () => {
  const queue = fixture("admin-moderation-queue"); assert.deepEqual(datesModerationQueue(queue, { page: 1, limit: 40 })?.cases, queue.cases);
  const caseId = "cas_" + "01".padStart(32, "0"), evidence = fixture("admin-moderation-evidence");
  assert.deepEqual(datesEvidenceRead(evidence, { case_id: caseId, appeal_id: null, include_sensitive_location: false, break_glass: false })?.evidence, evidence.evidence);
  for (const name of ["claim", "claim-replay"]) assert.ok(datesConsoleCommandReceipt(fixture(`admin-moderation-${name}`), "dates_moderation_claim", caseId, 1));
});
test("genuine explicit legal holds retain their separate receipt shape and target binding", () => {
  const caseId = "cas_" + "01".padStart(32, "0");
  for (const action of ["place", "release"]) {
    const body = fixture(`admin-moderation-hold-${action}`), reviewAt = action === "place" ? 1790086400 : null;
    assert.equal(datesLegalHoldReceipt(body, caseId, action, reviewAt), true);
    for (const change of [{ break_glass_used: false }, { case_id: "cas_" + "ff".padStart(32, "0") }, { legal_hold: !body.legal_hold }, { evidence_count: "1" }])
      assert.equal(datesLegalHoldReceipt({ ...body, ...change }, caseId, action, reviewAt), false);
  }
});
const moderationContext = {
  resolve: { case: "01", event: "04", revision: 1, action: "remove_content" },
  restore: { case: "02", event: "04", revision: 2, action: "restore_content" },
  cancel: { case: "03", event: "04", revision: 3, action: "cancel_activity" },
  "remove-activity": { case: "04", event: "04", revision: 4, action: "remove_activity" },
  dismiss: { case: "05", event: "05", revision: 1, action: "dismiss" },
};
function moderationPending(name = "resolve") {
  const ctx = moderationContext[name as keyof typeof moderationContext];
  return prepareDatesExternalResolution("mod@example.test", { case_id: "cas_" + ctx.case.padStart(32, "0"), expected_revision: 2,
    expected_external_revision: ctx.revision, action: ctx.action, reason: "The public event details were reviewed.",
    user_visible_reason_en: "The event details have been reviewed.", user_visible_reason_hu: "Ellenőriztük az esemény adatait.",
    idempotency_key: "console-moderation-resolve", expires_at: null, break_glass: false }, {
    external_event_id: "xev_" + ctx.event.padStart(32, "0"), activity_id: "act_" + ctx.event.padStart(32, "0"), activity_revision: ctx.revision }, 1790000000)!;
}
for (const name of MODERATION_DECISIONS) test(`genuine external ${name} binds the independent case/content CAS and exact effect`, () => {
  const body = fixture(`admin-moderation-${name}`); assert.deepEqual(datesExternalResolutionReceipt(body, moderationPending(name.replace(/-replay$/, ""))), body);
});
for (const name of CONSOLE_REFUSALS) test(`genuine console ${name} is never a successful case, content or decision`, async () => {
  const body = fixture(`admin-${name}-denied`);
  assert.equal(datesCaseDetail(body, moderationPending().body.case_id), null);
  assert.equal(decodeDatesExternalReceipt(body, "dates_external_event_publish", {}, null), null);
  assert.equal(datesExternalResolutionReceipt(body, moderationPending()), null);
  if (name.startsWith("moderation-") && !/claim-|evidence-|hold-/.test(name)) {
    const rows = new Map<string, string>(), storage = { getItem: (key: string) => rows.get(key) ?? null,
      setItem: (key: string, value: string) => { rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } };
    const result = await runDatesExternalResolution(moderationPending(), storage, 1790000000, async () => body);
    const uncertain = /viewer|key-conflict|moderation-conflict/.test(name);
    assert.equal(result.kind, uncertain ? "uncertain" : "refused"); assert.equal(rows.size, uncertain ? 1 : 0);
  }
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
