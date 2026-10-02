import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { decodeDatesActivityList, decodeDatesActivityOriginDetail, decodeDatesExternalDetail, decodeDatesExternalList,
  decodeDatesExternalPlaces, decodeDatesExternalReceipt, datesExternalRefusal,
  type DatesExternalMutationBaseline } from "../lib/datesExternalAdmin.ts";
import { datesCaseDetail, datesConsoleCommandReceipt, datesEvidenceRead, datesLegalHoldReceipt, datesModerationQueue } from "../lib/datesModerationRead.ts";
import { datesExternalResolutionReceipt, prepareDatesExternalResolution, runDatesExternalResolution } from "../lib/datesExternalModeration.ts";
import { datesConfigurationRawValue, datesSettingEffectiveText, permittedResolutionActions } from "../lib/datesAdmin.ts";
import { DATES_RUNTIME_HELP_GROUPS } from "../lib/datesRuntimeHelp.ts";
import { prepareDatesExternalPending, readDatesExternalPending, runDatesExternalMutation } from "../lib/datesExternalMutations.ts";

// Actual Router/Webadmin capture, byte-identical to Core 285b14a87c2e9977130d4b8a0bae19cb8bbb18b9 (T-884, P2a).
// Three pins of the same directory are kept apart, so that a change cannot hide behind the newest set digest:
// - the current set (Core 285b14a8);
// - the previous one (Core 06c8c3ea), from which exactly 23 bodies differ, each by ONE appended key:
//   nine list bodies whose rows gained `ai_assisted: false`, thirteen detail bodies and the external
//   activity detail whose event gained `intake: null`; the other 115 are byte-identical;
// - the accepted P1 pin (Core 51140a6f, set d84a3e16...), from which the two configuration reads also
//   differ (they gained the eight intake settings); 113 bodies are byte-identical to it.
// The generator is the P1 one, unchanged. The source/generator pin is independent of the vendored manifest.
const DIRECTORY = new URL("./fixtures/dates_external_admin_wire/", import.meta.url);
// Pin of 2026-10-02 16:00Z (Core lane tip 32d418cf, T-886): only the two configuration reads changed against the
// pin before it - nine settings of the member channel follow the eight of the admin channel.
const SOURCE = "7dfe04317524f3929b572a3d2a995f57147f10ed";
const SOURCE_SHA = "9c8c01070670d12d42b67046a3dd7a1597b02601e990136b1737f818c4af0c03";
const MANIFEST_SHA = "a2db85433852e9de45ef1df9ad1ba68c6fe80a8bc5bd9128bd97cb308a45dd41";
const GENERATOR_SHA = "51e746e0946ddac4319b56cdff0adcc7107a320ed08e1ca1a1f70fa7d90fbf3d";
const SET_SHA = "72d12289a517cfb4a3f312274396a24e13d22f8ff7abe7f7a7e137e85827369f";
// The set digest of the pin before this one, and the digests its manifest held for the two configuration reads
// (41 settings each; read from this branch's own history at 8770a02a): with them in place of today's two, that
// digest comes back.
const P2A_SET_SHA = "112db40de1134bffbfebda663b8f4d79e09e9d9e87fc312b3ec7c3c225911958";
const P2A_CONFIGURATION: Record<string, string> = {
  "admin-configuration-default-off.json": "990116b1b5247aad9cf2fee57445659805983a928e667d04bd3b0e892e309162",
  "admin-configuration-publishing-on.json": "be38ab3485244460eeb559e3dc79e8bb96e616e020273e7e0a6dfcfe8ccab66b",
};
// The set digest of the pin before that (Core 06c8c3ea), announced by the Core lane at 06:28Z.
const PREVIOUS_SET_SHA = "9ac34b0ba9b466c199d5984d7f1a607fadc9d9bb18d0cb27b4a75a48357c29a3";
// The body set of the accepted P1 pin with the 25 bodies P2a changed taken out: 113 entries
// (computed from the P1 manifest at Webadmin 7825bc13).
const P1_UNCHANGED_SET_SHA = "390d733b3ac98ee850735087c90863411aa0cef37dd2cda4826f9bebbd5cd631";
const CONFIGURATION_CHANGED = ["admin-configuration-default-off.json", "admin-configuration-publishing-on.json"];
const LIST_GAINED_LABEL = ["admin-held-list.json", "admin-list-admin.json", "admin-list-canceled.json", "admin-list-viewer.json",
  ...["match", "pacific", "paid", "participation", "sensitive"].map((name) => `admin-variety-${name}-list.json`)];
const DETAIL_GAINED_INTAKE = ["admin-detail-admin.json", "admin-detail-canceled.json", "admin-detail-estimated.json", "admin-detail-viewer.json",
  "admin-held-detail.json", "admin-held-detail-canceled.json", "admin-held-detail-reverified.json", "admin-held-detail-updated.json",
  ...["match", "pacific", "paid", "participation", "sensitive"].map((name) => `admin-variety-${name}-detail.json`), "admin-activity-detail-external.json"];
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
  "moderation-action-invalid", "moderation-claim-viewer", "moderation-conflict", "moderation-dismiss-held", "moderation-evidence-viewer", "moderation-hold-open",
  "moderation-hold-viewer", "moderation-key-conflict", "moderation-resolve-viewer", "moderation-restore-terminal", "moderation-revision-invalid",
  "moderation-revision-missing", "moderation-revision-stale", "moderation-target-invalid"];
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, DIRECTORY), "utf8"));
const HELD_DETAILS = ["detail", "detail-updated", "detail-reverified", "detail-canceled"];
const HELD_WRITES = ["update", "update-replay", "reverify", "reverify-replay", "cancel", "cancel-replay"];
const CHAT_REVIEW = ["queue", "detail", "evidence", "claim", "claim-replay", "claimed", "stale-denied", "resolve", "resolve-replay", "resolved"];

test("external console corpus is the complete 138-response genuine capture with independent provenance pins", () => {
  const manifest = fixture("manifest");
  assert.equal(hash(readFileSync(new URL("manifest.json", DIRECTORY))), MANIFEST_SHA);
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.contract, "dates-external-admin-v1");
  assert.equal(manifest.source_commit, SOURCE);
  assert.equal(manifest.source_checksum, SOURCE_SHA);
  assert.equal(manifest.provenance.generator, "tests/dates_external_admin_fixture_dump.php");
  assert.equal(manifest.provenance.generator_sha256, GENERATOR_SHA);
  assert.equal(manifest.fixture_count, 138);
  assert.equal(manifest.provenance.source_paths.length, 325);
  assert.equal(manifest.fixture_set_sha256, SET_SHA);
  const names = ["admin-activity-list-external.json", ...LISTS.map((name) => `admin-list-${name}.json`),
    ...DETAILS.map((name) => `admin-detail-${name}.json`), ...PLACES.map((name) => `admin-places-${name}.json`),
    ...WRITES.map((name) => `admin-${name}.json`), ...REFUSALS.map((name) => `admin-${name}-denied.json`),
    "admin-activity-detail-external.json", ...ACTIVITY_WRITES.map((name) => `admin-activity-${name}.json`),
    "admin-configuration-default-off.json", "admin-configuration-publishing-on.json",
    ...MODERATION_DETAILS.map((name) => `admin-moderation-detail-${name}.json`),
    ...["queue", "evidence", "claim", "claim-replay", "hold-place", "hold-release", ...MODERATION_DECISIONS].map((name) => `admin-moderation-${name}.json`),
    ...CONSOLE_REFUSALS.map((name) => `admin-${name}-denied.json`),
    "admin-reason-list-external.json", "admin-reason-save-external.json", "admin-reason-save-external-replay.json",
    ...["cohort", "member-cohort", "mixed", "save-viewer"].map((name) => `admin-reason-${name}-denied.json`),
    ...["list", ...HELD_DETAILS, ...HELD_WRITES].map((name) => `admin-held-${name}.json`),
    ...["approve", "reject"].flatMap((action) => CHAT_REVIEW.map((name) => `admin-chat-${action}-${name}.json`)),
    "admin-chat-withdrawn-unavailable.json",
    ...["match", "participation", "paid", "sensitive", "pacific"].flatMap((name) => ["list", "detail"].map((action) => `admin-variety-${name}-${action}.json`))].sort();
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
  // Against the pin before this one: the two configuration reads changed and the other 136 bodies are
  // byte-identical - with the two digests that pin held, its set digest comes back.
  assert.deepEqual(Object.keys(P2A_CONFIGURATION), CONFIGURATION_CHANGED);
  const atP2a = lines.map((line: string) => { const file = line.split("\0")[0]; return Object.hasOwn(P2A_CONFIGURATION, file) ? `${file}\0${P2A_CONFIGURATION[file]}` : line; });
  assert.equal(atP2a.filter((line: string, index: number) => line !== lines[index]).length, 2);
  assert.equal(hash(atP2a.join("\n")), P2A_SET_SHA);
  // Against the pin before that: exactly 23 bodies changed, each by one appended key, and 115 are byte-identical.
  // Taking that one key out of the raw bytes of each of the 23 gives the previous set digest back.
  const gained = [...LIST_GAINED_LABEL, ...DETAIL_GAINED_INTAKE];
  assert.equal(LIST_GAINED_LABEL.length, 9); assert.equal(DETAIL_GAINED_INTAKE.length, 14); assert.equal(new Set(gained).size, 23);
  const appended = /,\n\s*"(?:ai_assisted": false|intake": null)(?=\n\s*\})/g;
  let changed = 0;
  const previous = manifest.fixtures.map((entry: { file: string; sha256: string }) => {
    const raw = readFileSync(new URL(entry.file, DIRECTORY), "utf8"), without = raw.replace(appended, "");
    const removed = (raw.match(appended) ?? []).length;
    if (gained.includes(entry.file)) {
      changed++;
      const body = JSON.parse(raw);
      if (LIST_GAINED_LABEL.includes(entry.file)) {
        // Every row ends with the label; these are all manually entered events.
        assert.ok(body.events.length > 0 && removed === body.events.length, entry.file);
        for (const row of body.events) { assert.equal(Object.keys(row).at(-1), "ai_assisted"); assert.equal(row.ai_assisted, false); }
      } else {
        const event = body.event ?? body.external_event;
        assert.equal(removed, 1, entry.file); assert.equal(Object.keys(event).at(-1), "intake"); assert.equal(event.intake, null);
      }
    } else assert.equal(removed, 0, `${entry.file} carries neither appended key`);
    // The two configuration reads are taken as that earlier pin held them (no appended key touches them).
    return `${entry.file}\0${P2A_CONFIGURATION[entry.file] ?? hash(without)}`;
  });
  assert.equal(changed, 23); assert.equal(lines.length - changed, 115);
  assert.equal(hash(previous.join("\n")), PREVIOUS_SET_SHA);
  // Against the accepted P1 pin: the same 23 and the two configuration reads; the other 113 hash to what P1 held.
  const sinceP1 = [...gained, ...CONFIGURATION_CHANGED];
  assert.equal(hash(lines.filter((line: string) => !sinceP1.includes(line.split("\0")[0])).join("\n")), P1_UNCHANGED_SET_SHA);
  assert.equal(lines.length - sinceP1.length, 113);
  assert.equal(manifest.fixtures.filter((entry: { status_code: number }) => entry.status_code === 200).length, 94);
  assert.equal(manifest.fixtures.filter((entry: { status_code: number }) => entry.status_code !== 200).length, 44);
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
  // The 33 P1 rows, in their P1 order, followed by the eight intake settings (P2a) and the nine of the member channel (P2b).
  assert.equal(body.settings.length, 50);
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
  // P2a: every row carries the label; none of these P1 events was drafted by the AI.
  for (const row of body.events) assert.equal(row.ai_assisted, false);
});
for (const name of DETAILS) test(`genuine external detail ${name} passes the production decoder unchanged`, () => {
  const body = fixture(`admin-detail-${name}`);
  assert.deepEqual(decodeDatesExternalDetail(body, body.event.external_event_id), body);
  assert.ok(Object.values(body.event.editor_input.confirmations).every((value) => value === false));
  assert.equal(body.event.can_edit, name === "admin" || name === "estimated");
  assert.equal(body.event.editor_input.end_at === null, name === "estimated" || name === "canceled");
  assert.equal(body.event.ai_assisted, false);
  assert.equal(body.event.intake, null, "a manually entered event was published from no intake");
  assert.deepEqual([body.event.venue.place_id, body.event.venue.resolved_by], [null, "admin_pin"]);
  assert.deepEqual(body.event.credit, { channel: "admin", submitted_by_uid: null, anonymous: true, first_submitter_uid: null });
});
test("genuine held list permits corrections without treating pending content as approved", () => {
  const body = fixture("admin-held-list");
  assert.deepEqual(decodeDatesExternalList(body, { page: 1, limit: 40 }), body);
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].can_edit, true);
  assert.equal(body.events[0].status, "in_review");
  assert.equal(body.events[0].moderation_state, "pending");
  for (const change of [{ can_edit: false }, { can_edit: "true" }, { status: "new_review_state" },
    { lifecycle: "ended" }, { soft_deleted: true }]) {
    const invalid = structuredClone(body); Object.assign(invalid.events[0], change);
    assert.equal(decodeDatesExternalList(invalid, { page: 1, limit: 40 }), null, JSON.stringify(change));
  }
  const viewer = structuredClone(body);
  viewer.capabilities = viewer.capabilities.filter((cap: string) => cap !== "dates_external_event_manage");
  assert.equal(decodeDatesExternalList(viewer, { page: 1, limit: 40 }), null);
  viewer.events[0].can_edit = false;
  assert.deepEqual(decodeDatesExternalList(viewer, { page: 1, limit: 40 }), viewer);
});
for (const [index, name] of HELD_DETAILS.entries()) test(`genuine held ${name} preserves pending moderation after correction or cancellation`, () => {
  const body = fixture(`admin-held-${name}`), canceled = name === "detail-canceled";
  assert.deepEqual(decodeDatesExternalDetail(body, body.event.external_event_id), body);
  assert.equal(body.event.revision, index + 1);
  assert.equal(body.event.activity_revision, index + 1);
  assert.equal(body.event.status, canceled ? "canceled_upstream" : "in_review");
  assert.equal(body.event.lifecycle, canceled ? "canceled" : "active");
  assert.equal(body.event.moderation_state, "pending");
  assert.equal(body.event.can_edit, !canceled);
  assert.ok(Object.values(body.event.editor_input.confirmations).every((value) => value === false));
});
for (const name of HELD_WRITES) test(`genuine held ${name} receipt binds current CAS and never implicitly approves`, () => {
  const command = name.replace(/-replay$/, ""), before = command === "update" ? "detail" : command === "reverify" ? "detail-updated" : "detail-reverified";
  const baseline = fixture(`admin-held-${before}`).event as DatesExternalMutationBaseline;
  const request = { external_event_id: baseline.external_event_id, expected_revision: baseline.revision, action: command };
  const action = command === "update" ? "dates_external_event_update" : "dates_external_event_command";
  const body = fixture(`admin-held-${name}`);
  assert.deepEqual(decodeDatesExternalReceipt(body, action, request, baseline), body);
  assert.equal(body.replayed, name.endsWith("-replay"));
  assert.equal(body.event_status, command === "cancel" ? "canceled_upstream" : "in_review");
  for (const change of [{ event_status: "published" }, { revision: baseline.revision }, { activity_revision: baseline.activity_revision },
    { external_event_id: "xev_" + "f".repeat(32) }])
    assert.equal(decodeDatesExternalReceipt({ ...body, ...change }, action, request, baseline), null, JSON.stringify(change));
});
for (const command of ["update", "reverify", "cancel"] as const) test(`genuine held ${command} runs the durable journal and identical lost-response replay`, async () => {
  const before = fixture(`admin-held-${command === "update" ? "detail" : command === "reverify" ? "detail-updated" : "detail-reverified"}`);
  assert.ok(decodeDatesExternalDetail(before, before.event.external_event_id));
  const { external_event_id, activity_id, revision, activity_revision, status, lifecycle, soft_deleted } = before.event;
  const baseline = { external_event_id, activity_id, revision, activity_revision, status, lifecycle, soft_deleted };
  const actor = "held-journal@example.test", now = before.server_now;
  const action = command === "update" ? "dates_external_event_update" : "dates_external_event_command";
  const confirmations = { source: true, public_venue: true, timezone: true, content_safe: true };
  const body = { external_event_id, expected_revision: revision, reason: "Confirmed held-event correction",
    ...(command === "update" ? { event: { ...before.event.editor_input, confirmations } }
      : { action: command, ...(command === "reverify" ? { confirmations } : {}) }) };
  for (const lostResponse of [false, true]) {
    const pending = prepareDatesExternalPending(actor, action, body, baseline, now);
    assert.ok(pending, "a genuine editable held detail can prepare the complete command");
    const values = new Map<string, string>();
    const store = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    const sends: string[] = [];
    const first = await runDatesExternalMutation(pending, store, now, async (sentAction, sentBody) => {
      assert.deepEqual(readDatesExternalPending(store, actor), { kind: "pending", pending }, "persisted before dispatch");
      sends.push(JSON.stringify({ action: sentAction, body: sentBody }));
      if (lostResponse) throw Error("lost response after Core committed");
      return fixture(`admin-held-${command}`);
    });
    if (lostResponse) {
      assert.equal(first.kind, "uncertain");
      const recovered = readDatesExternalPending(store, actor); assert.equal(recovered.kind, "pending");
      assert.ok(recovered.kind === "pending");
      const replay = await runDatesExternalMutation(recovered.pending, store, now + 60, async (sentAction, sentBody) => {
        sends.push(JSON.stringify({ action: sentAction, body: sentBody })); return fixture(`admin-held-${command}-replay`);
      });
      assert.equal(replay.kind, "success");
      assert.ok(replay.kind === "success" && !replay.retained);
      assert.equal(new Set(sends).size, 1, "reload keeps the original request bytes and identity");
    } else {
      assert.equal(first.kind, "success"); assert.ok(first.kind === "success" && !first.retained);
    }
    assert.deepEqual(readDatesExternalPending(store, actor), { kind: "empty" });
  }
  assert.equal(prepareDatesExternalPending(actor, action, { ...body, expected_revision: revision + 1 }, baseline, now), null);
  for (const changed of [{ ...baseline, soft_deleted: true }, { ...baseline, lifecycle: "canceled" as const },
    { ...baseline, status: "withdrawn" as const }])
    assert.equal(prepareDatesExternalPending(actor, action, body, changed, now), null);
});
test("held withdraw can prepare without inventing a capture; held official updates remain read-only", () => {
  const { external_event_id, activity_id, revision, activity_revision, status, lifecycle, soft_deleted } = fixture("admin-held-detail").event;
  const baseline = { external_event_id, activity_id, revision, activity_revision, status, lifecycle, soft_deleted };
  const body = { external_event_id, expected_revision: revision, reason: "Safety withdrawal" };
  assert.ok(prepareDatesExternalPending("held-journal@example.test", "dates_external_event_command", { ...body, action: "withdraw" }, baseline, 1_790_000_000));
  assert.equal(prepareDatesExternalPending("held-journal@example.test", "dates_external_event_command",
    { ...body, action: "official_update", text: "Public official update" }, baseline, 1_790_000_000), null);
});
test("genuine held case offers explicit approval or safety decisions, never a stranding dismissal", () => {
  const body = fixture("admin-moderation-detail-claimed"), detail = datesCaseDetail(body, body.case.case_id)!;
  const principal = { capabilities: ["dates_case_resolve", "dates_external_event_review"] };
  assert.deepEqual(permittedResolutionActions(detail.case, principal), ["restore_content", "remove_content", "cancel_activity", "remove_activity"]);
  assert.equal(permittedResolutionActions(detail.case, principal).includes("dismiss"), false);
  const queue = fixture("admin-moderation-queue"), cases = datesModerationQueue(queue, { page: 1, limit: 40 })!.cases;
  assert.ok(cases.length > 0);
  for (const item of cases) assert.equal(permittedResolutionActions(item, principal).includes("dismiss"), false);
  const refusal = fixture("admin-moderation-dismiss-held-denied");
  assert.deepEqual(datesExternalRefusal(refusal), { kind: "refused", status: 409, error: "dates-external-command-state-invalid" });
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
