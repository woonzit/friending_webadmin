import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { projectDatesAdminBody } from "../lib/datesAdminProjection.ts";
import {
  datesActivityCommandReceipt, datesActivityTypeSaveReceipt, datesActivityUpdateReceipt, datesCaseResolutionReceipt, datesHostTransferReceipt,
  datesReasonDeactivateReceipt, datesSettingSaveReceipt,
} from "../lib/datesCommandReceipts.ts";
import { datesCommandOutcome } from "../lib/datesExternalAdmin.ts";

// T-891: the receipts of the Dates console's commands, as Core serves them.
// Vendored byte-identically from the Core lane opus-core-fix, branch
// claude/core-hardening-20261002, commit 754b9eb310016abdcca11584e44ad525a1bee34b
// (git objects; hand-overs team/chat/20261002T233953Z-opus-core-fix-to-opus-admin-p2-t891-core-pin.md and
// 20261003T023124Z-opus-core-fix-to-lead-t891-core-pin-evidence.md). Against the first pin (33265e46, 61 bodies,
// set 80c762f2...) three evidence reads were added - after a legal hold was placed, amended and released - and no
// body changed.
// Every body is the answer to a real form-encoded HTTP POST into Core's front
// controller, checked by the generator against storage, audit and the durable
// command receipt, and captured twice. The REQUESTS are in the generator
// (tests/dates_admin_command_fixture_dump.php at that tip, digest pinned below):
// each request / answer pair the tests of this console use is transcribed from
// it at the place it is used, with its line.
const DIRECTORY = new URL("./fixtures/dates_admin_command_wire/", import.meta.url);
const SOURCE = "11a999d63da00a076ed967b8862680acffe969e0";
const MANIFEST_SHA = "093f15bc218b84b7d72cb0dd899fa8aac3f1410ed402728ea255903e4ab3e28c";
const GENERATOR_SHA = "d65e9154ecdf5e3b0ffd0813bbee1c20f9d05f5ed8fe13a15b7dac62428e6945";
const SET_SHA = "b9b921db4a15684bd4df0d4a9a9e9b8a50dd625c33c472c8e82b415149e2b126";
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
  // A read, not a command: the case's evidence after a legal hold was placed, amended and released (commit 754b9eb3).
  dates_moderation_evidence: { successes: ["evidence-hold-placed", "evidence-hold-amended", "evidence-hold-released"], refusals: {} },
};

test("the command corpus is Core's capture at the pinned commit: 64 bodies, each against its digest, pinned independently of its manifest", () => {
  const raw = readFileSync(new URL("manifest.json", DIRECTORY)), manifest = JSON.parse(raw.toString());
  assert.equal(hash(raw), MANIFEST_SHA);
  assert.deepEqual([manifest.schema_version, manifest.contract, manifest.source_commit], [1, "dates-admin-command-v1", SOURCE]);
  assert.equal(manifest.provenance.generator, "tests/dates_admin_command_fixture_dump.php");
  assert.equal(manifest.provenance.generator_sha256, GENERATOR_SHA);
  assert.equal(manifest.provenance.source_paths.length, 174);
  assert.equal(manifest.fixture_set_sha256, SET_SHA);
  // The released console's requests get the released keys; the `selected` bodies answer requests that carry a selector.
  assert.match(manifest.provenance.released_console, /without expected_revision/);
  assert.match(manifest.provenance.released_console, /without dates_admin_command_contract_version/);
  const names = Object.values(COMMAND_CORPUS).flatMap(({ successes, refusals }) =>
    [...successes.map((name) => `admin-${name}.json`), ...Object.keys(refusals).map((name) => `admin-${name}-denied.json`)]).sort();
  assert.equal(names.length, 64);
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
  assert.equal(manifest.fixtures.filter((entry: { status_code: number }) => entry.status_code === 200).length, 41);
  // Each refusal is Core's: its token, its status and the legacy envelope; nothing else in it.
  for (const { refusals } of Object.values(COMMAND_CORPUS)) for (const [name, [error, status]] of Object.entries(refusals))
    assert.deepEqual(fixture(`admin-${name}-denied`), { success: false, status_code: status, error, message: 200, status: 200, can_send: 0 }, name);
  // Each success is Core's envelope around the receipt (the three evidence reads are reads: no idempotency flag).
  for (const [route, { successes }] of Object.entries(COMMAND_CORPUS)) for (const name of successes) {
    if (route === "dates_moderation_evidence") continue;
    const body = fixture(`admin-${name}`);
    assert.deepEqual([body.success, body.status_code, body.message, body.status, body.can_send, body.server_now], [true, 200, 200, 200, 0, 1790000000], name);
    assert.equal(typeof body.idempotency_replayed, "boolean", name); assert.match(body.audit_id, /^aud_[0-9a-f]{32}$/, name);
    assert.equal(body.idempotency_replayed, name.endsWith("-replay"), name);
  }
});

// ---------------------------------------------------------------- the seven receipt checks

/**
 * The requests of the genuine pairs, TRANSCRIBED from the generator (tests/dates_admin_command_fixture_dump.php at
 * 33265e46, lines named per entry) in the types the console's pages send them: revisions and uids as numbers, the
 * break-glass flag as a boolean. `admin_email`, `secret` and the selector are the bridge's, not the page's.
 */
const act = (number: number) => `act_${number.toString(16).padStart(32, "0")}`;
const PAIRS: Array<{ route: string; check: (value: unknown, request: Record<string, unknown>) => unknown; request: Record<string, unknown>; bodies: string[] }> = [
  // 433-437
  { route: "dates_activity_update", check: datesActivityUpdateReceipt, bodies: ["activity-update", "activity-update-replay"],
    request: { activity_id: act(11), expected_revision: 1, changes: { maximum_people: 12 }, reason: "Synthetic capacity correction.", idempotency_key: "dates-activity-update:command-0031" } },
  // 443-461
  ...([["end", 12, 1, ["activity-end", "activity-end-replay"]], ["cancel", 13, 1, ["activity-cancel"]], ["soft_delete", 14, 1, ["activity-soft-delete"]],
    ["restore", 14, 2, ["activity-restore"]], ["purge", 14, 4, ["activity-purge"]]] as const).map(([action, activity, expected, bodies]) => ({
    route: "dates_activity_command", check: datesActivityCommandReceipt, bodies: [...bodies],
    request: { activity_id: act(activity), expected_revision: expected, action, reason: `Synthetic ${action.replace("_", " ")}.`, idempotency_key: `dates-activity-${action}:command-0041` } })),
  // 466-470 (released shape) and 528-531 (with the command contract selector)
  { route: "dates_activity_host_transfer", check: datesHostTransferReceipt, bodies: ["host-transfer", "host-transfer-replay"],
    request: { activity_id: act(15), target_uid: 70315, expected_revision: 1, reason: "Synthetic transfer to the confirmed participant.", idempotency_key: "dates-host-transfer:command-0051" } },
  { route: "dates_activity_host_transfer", check: datesHostTransferReceipt, bodies: ["host-transfer-selected", "host-transfer-selected-replay"],
    request: { activity_id: act(16), target_uid: 70316, expected_revision: 1, reason: "Synthetic transfer to the confirmed participant.", idempotency_key: "dates-host-transfer:command-0103" } },
  // 476-482: an existing row, and the first save of a setting that had none
  { route: "dates_configuration_save", check: datesSettingSaveReceipt, bodies: ["configuration-save"],
    request: { key: "dates_report_sla_hours", value: 12, expected_revision: 1, reason: "Synthetic queue tuning.", idempotency_key: "dates-configuration-save:command-0061" } },
  { route: "dates_configuration_save", check: datesSettingSaveReceipt, bodies: ["configuration-save-first", "configuration-save-first-replay"],
    request: { key: "dates_reinvite_cooldown_hours", value: 72, expected_revision: 0, reason: "Synthetic first save.", idempotency_key: "dates-configuration-save:command-0063" } },
  // 485-489
  { route: "dates_activity_type_save", check: datesActivityTypeSaveReceipt, bodies: ["activity-type-save", "activity-type-save-replay"],
    request: { key: "sport", name_en: "Sports activity", name_hu: "Sportprogram", order: 5, active: true, expected_revision: 1, reason: "Synthetic label correction.",
      idempotency_key: "dates-activity-type-save:command-0071" } },
  // 493-496
  { route: "dates_reason_deactivate", check: datesReasonDeactivateReceipt, bodies: ["reason-deactivate", "reason-deactivate-replay"],
    request: { reason_id: "reason_activity_fixture_one", expected_revision: 1, reason: "Synthetic retirement of a reason.", idempotency_key: "dates-reason-deactivate:command-0081" } },
  // 504-510
  { route: "dates_moderation_resolve", check: datesCaseResolutionReceipt, bodies: ["resolve-dismiss", "resolve-dismiss-replay"],
    request: { case_id: `cas_${"4".padStart(32, "0")}`, expected_revision: 2, action: "dismiss", reason: "Synthetic review: no violation found.",
      user_visible_reason_en: "No violation was found.", user_visible_reason_hu: "Nem találtunk szabálysértést.", expires_at: null, break_glass: false,
      idempotency_key: "dates-case-resolve:command-0092" } },
];
const accepted = (value: unknown) => value === true || (value !== null && typeof value === "object");

test("each of the seven routes: Core's genuine answer to the genuine request is its receipt - through the bridge's projection too", () => {
  const covered = new Set<string>();
  for (const { route, check, request, bodies } of PAIRS) for (const name of bodies) {
    const body = fixture(`admin-${name}`);
    assert.ok(accepted(check(body, request)), `${route}: ${name}`);
    // What the page really receives is the projection of the body: the same body, so the same receipt.
    assert.deepEqual(projectDatesAdminBody(route, body), body, name);
    assert.deepEqual(datesCommandOutcome(projectDatesAdminBody(route, body), accepted(check(projectDatesAdminBody(route, body), request)), "fresh"), { kind: "success" }, name);
    covered.add(route);
  }
  assert.deepEqual([...covered].sort(), ["dates_activity_command", "dates_activity_host_transfer", "dates_activity_type_save", "dates_activity_update",
    "dates_configuration_save", "dates_moderation_resolve", "dates_reason_deactivate"]);
  // Every genuine success of these seven routes is one of the pairs above: none is left without its request.
  const routes = new Set(covered);
  assert.deepEqual(Object.entries(COMMAND_CORPUS).filter(([route]) => routes.has(route)).flatMap(([, { successes }]) => successes).sort(),
    PAIRS.flatMap(({ bodies }) => bodies).sort());
});

test("each receipt binds on what identifies its command: another target, action or revision is not this command's receipt", () => {
  const ALTERED: Record<string, Array<Record<string, unknown>>> = {
    dates_activity_update: [{ activity_id: act(99) }, { revision: 1 }, { revision: 3 }, { moderation_state: "" }],
    dates_activity_command: [{ activity_id: act(99) }, { revision: 99 }, { action: "cancel" }, { lifecycle: "active" }, { soft_deleted: true }, { lifecycle: "archived" }],
    dates_activity_host_transfer: [{ activity_id: act(99) }, { target_uid: 1 }, { transfer_status: "accepted" }, { transfer_id: "trf_1" }, { expires_at: null }, { activity_revision: 1 },
      { activity_revision: 3 }, { activity_revision: "2" }],
    dates_configuration_save: [{ setting: { key: "dates_enabled", value: 12, revision: 2 } }, { setting: { key: "dates_report_sla_hours", value: 12, revision: 1 } },
      { setting: { key: "dates_report_sla_hours", value: 12, revision: 3 } }, { setting: { key: "dates_report_sla_hours", revision: 2 } }, { setting: null }],
    dates_activity_type_save: [{ revision: 3 }, { activity_type: { key: "other", revision: 2 } }, { activity_type: { key: "sport", revision: 1 } }],
    dates_reason_deactivate: [{ reason_id: "reason_activity_fixture_two" }, { active: true }, { revision: 1 }],
    dates_moderation_resolve: [{ case_id: `cas_${"5".padStart(32, "0")}` }, { action: "warn" }, { revision: 2 }, { decision_id: null }, { case_status: "" }],
  };
  const COMMON = [{ success: false }, { status_code: 201 }, { audit_id: "aud_1" }, { idempotency_replayed: "false" }];
  for (const { route, check, request, bodies } of PAIRS) {
    const body = fixture(`admin-${bodies[0]}`);
    for (const change of [...ALTERED[route], ...COMMON]) {
      // Only alterations that apply to this body's shape (a purge has no `action`, a released transfer no `activity_revision`).
      if (!Object.keys(change).every((key) => Object.hasOwn(body, key))) continue;
      // An "alteration" to the value the body already has is none.
      if (Object.entries(change).every(([key, value]) => JSON.stringify(body[key]) === JSON.stringify(value))) continue;
      const altered = { ...body, ...change };
      assert.equal(accepted(check(altered, request)), false, `${route} ${bodies[0]}: ${JSON.stringify(change)}`);
      // ... and so the page calls the outcome not known: never success, never failure.
      assert.equal(datesCommandOutcome(altered, false, "fresh").kind, "uncertain");
    }
    // A key this console does not know is tolerated, at the top and inside a nested receipt part.
    assert.ok(accepted(check({ ...body, already_in_place: false, future: { x: 1 } }, request)), `${route}: an added key`);
    // A missing binding field is not.
    const { audit_id: _audit, ...unaudited } = body;
    assert.equal(accepted(check(unaudited, request)), false, `${route}: no audit id`);
    // A request this console could not have sent binds nothing.
    assert.equal(accepted(check(body, { ...request, expected_revision: "1" })), false, `${route}: a revision that is not a number`);
    for (const value of [null, undefined, "ok", [], { success: true }]) assert.equal(accepted(check(value, request)), false, route);
  }
  // The same body answers only its own request: the receipt of one pair is not the receipt of another pair's request.
  for (const left of PAIRS) for (const right of PAIRS) {
    if (left === right || left.route !== right.route) continue;
    assert.equal(accepted(left.check(fixture(`admin-${left.bodies[0]}`), right.request)), false, `${left.bodies[0]} answers ${right.bodies[0]}'s request`);
  }
  // Refusals are never receipts.
  for (const [route, { refusals }] of Object.entries(COMMAND_CORPUS)) {
    const pair = PAIRS.find((item) => item.route === route);
    if (!pair) continue;
    for (const name of Object.keys(refusals)) assert.equal(accepted(pair.check(fixture(`admin-${name}-denied`), pair.request)), false, name);
  }
});

test("the purge names the revision it removed; the transfer adopts the activity revision only when Core serves it", () => {
  const purge = PAIRS.find((pair) => pair.bodies[0] === "activity-purge")!;
  assert.equal(fixture("admin-activity-purge").revision, purge.request.expected_revision);
  assert.equal(accepted(purge.check({ ...fixture("admin-activity-purge"), revision: 5 }, purge.request)), false);
  assert.equal(accepted(purge.check({ ...fixture("admin-activity-purge"), purged: false }, purge.request)), false);
  const released = PAIRS.find((pair) => pair.bodies[0] === "host-transfer")!, selected = PAIRS.find((pair) => pair.bodies[0] === "host-transfer-selected")!;
  assert.deepEqual(datesHostTransferReceipt(fixture("admin-host-transfer"), released.request), { transfer_id: fixture("admin-host-transfer").transfer_id, activity_revision: null });
  assert.deepEqual(datesHostTransferReceipt(fixture("admin-host-transfer-selected"), selected.request), { transfer_id: fixture("admin-host-transfer-selected").transfer_id, activity_revision: 2 });
  assert.equal(Object.hasOwn(fixture("admin-host-transfer"), "activity_revision"), false, "the released shape: no activity revision");
  // The first save of a setting: from revision 0 to 1, its replay the same.
  assert.deepEqual([fixture("admin-configuration-save-first").setting.revision, fixture("admin-configuration-save-first-replay").setting.revision], [1, 1]);
});
