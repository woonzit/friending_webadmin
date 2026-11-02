import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { withDatesAdminContract } from "../lib/datesAdminContract.ts";
import { projectDatesAdminBody } from "../lib/datesAdminProjection.ts";
import {
  datesExternalCorrections, datesExternalRechecks, datesExternalRefusal, decodeDatesExternalCorrectionDecision, decodeDatesExternalCorrectionList,
  decodeDatesExternalDetail, decodeDatesExternalList, decodeDatesExternalRecheckReceipt, decodeDatesExternalReceipt, decodeDatesExternalReviewReceipt,
} from "../lib/datesExternalAdmin.ts";
import { datesExternalReviewRefusalKey } from "../lib/datesExternalReview.ts";
import { projectDatesIntakeDetail, projectDatesIntakeQueue } from "../lib/datesIntakeAdmin.ts";
import { decodeResearchRunDetail } from "../lib/datesResearchAdmin.ts";

// D-149 (T-908): Core-B's GENUINE review corpus (tests/fixtures/dates_external_review_wire/provenance.txt), held whole.
const DIR = new URL("./fixtures/dates_external_review_wire/", import.meta.url);
const bytes = (file: string) => readFileSync(new URL(file, DIR));
const body = (file: string) => JSON.parse(bytes(file).toString("utf8"));
type Entry = { file: string; consumer: "ios" | "webadmin"; route: string; http_status: number; status_code: number; sha256: string };
const manifest = body("manifest.json") as { contract: string; source_commit: string; fixture_set_sha256: string; selectors: Record<string, Record<string, number>>; fixtures: Entry[] };
const CONSOLE = manifest.fixtures.filter((entry) => entry.consumer === "webadmin");
const route = (entry: Entry) => entry.route.replace(/^\/v1\/webadmin\//, "");

test("the corpus is Core's, byte for byte: every body has the sha256 its manifest names, and nothing else is here", () => {
  assert.equal(manifest.contract, "friending-dates-external-review-wire-v1");
  // Re-pinned to the D-149 yield lane (Core ef10bc77): `drop_detail` on the run detail, and the span / ongoing / date-only details.
  assert.equal(manifest.source_commit, "d9f54d599012d648dfbf1c42e82821748c4f76a1");
  assert.equal(manifest.fixture_set_sha256, "c8660e08dbec515cb6e40577fa2de0a8315c0d1d56d4bffb056644b57081d78e");
  const lines = manifest.fixtures.map(({ file, sha256 }) => {
    assert.equal(createHash("sha256").update(bytes(file)).digest("hex"), sha256, file);
    return `${file}\0${sha256}`;
  });
  assert.equal(createHash("sha256").update(lines.join("\n")).digest("hex"), manifest.fixture_set_sha256);
  assert.deepEqual(readdirSync(DIR).sort(), [...manifest.fixtures.map((entry) => entry.file), "manifest.json", "provenance.txt"].sort());
  assert.equal(manifest.fixtures.length, 90); assert.equal(CONSOLE.length, 58);
});

test("the console's bridge sends the selectors Core captured with on every console route of the corpus (research routes keep their own beside them)", () => {
  assert.deepEqual(manifest.selectors.webadmin, { dates_event_intake_admin_contract_version: 1, dates_external_admin_contract_version: 2 });
  for (const entry of CONSOLE) {
    const sent: Record<string, unknown> = { ...withDatesAdminContract(route(entry), Object.assign(Object.create(null), { admin_email: "admin@example.test" })) };
    const research = route(entry) === "dates_event_research_run_detail" ? { dates_event_research_admin_contract_version: 1 } : {};
    assert.deepEqual(sent, { admin_email: "admin@example.test", ...manifest.selectors.webadmin, ...research }, entry.file);
  }
});

test("every console success body projects to itself, and its decoder reads it whole", () => {
  for (const entry of CONSOLE) {
    const value = body(entry.file), lines: string[] = [];
    assert.deepEqual(projectDatesAdminBody(route(entry), value, (line) => lines.push(line)), value, entry.file); assert.deepEqual(lines, [], entry.file);
    if (value.success !== true) continue;
    const r = route(entry);
    if (r === "dates_external_event_list") {
      const list = decodeDatesExternalList(value, { page: value.page, limit: value.limit });
      assert.ok(list, entry.file);
      assert.equal(list.events[0].admin_review === undefined, entry.file.endsWith("-released.json"), entry.file);
    } else if (r === "dates_external_event_detail") {
      const detail = decodeDatesExternalDetail(value, value.event.external_event_id);
      assert.ok(detail, entry.file);
      const jobs = datesExternalRechecks(detail.event, detail.server_now), corrections = datesExternalCorrections(detail.event, detail.server_now);
      if (entry.file.endsWith("-released.json")) { assert.equal(jobs, null); assert.equal(corrections, null); }
      else { assert.deepEqual(jobs?.unreadable, [], entry.file); assert.deepEqual(corrections?.unreadable, [], entry.file); }
    } else if (r === "dates_external_correction_list") {
      const status = (["pending", "approved", "rejected"] as const).find((name) => entry.file.endsWith(`-${name}.json`))!;
      assert.deepEqual(decodeDatesExternalCorrectionList(value, { page: value.page, status })?.unreadable, [], entry.file);
    } else if (r === "dates_event_intake_list") {
      const queue = projectDatesIntakeQueue(value, { page: value.page, limit: value.limit })!;
      assert.deepEqual(queue.unreadable_rows, []); assert.deepEqual(queue.intakes.flatMap((row) => row.unreadable_fields), [], entry.file);
      assert.equal(Object.hasOwn(queue.intakes[0], "system_closure"), !entry.file.endsWith("-released.json"), entry.file);
    } else if (r === "dates_event_intake_detail") {
      const detail = projectDatesIntakeDetail(value, value.intake.intake_id)!;
      assert.ok(detail, entry.file); assert.deepEqual(detail.intake.unreadable_sections, [], entry.file); assert.deepEqual(detail.intake.unreadable_fields, [], entry.file);
      assert.equal(detail.intake.system_closure === undefined, entry.file.endsWith("-released.json"), entry.file);
    } else if (r === "dates_event_research_run_detail") {
      const run = decodeResearchRunDetail(value, value.run.run_id)!;
      assert.ok(run, entry.file); assert.deepEqual(run.candidates?.unreadable, [], entry.file);
      assert.equal(run.candidates!.rows.some((row) => Object.hasOwn(row, "system_closure")), !entry.file.endsWith("-released.json"), entry.file);
    }
  }
});

test("receipts of the genuine mark, re-research, decision and three approvals bind", () => {
  for (const file of ["webadmin-command-mark-reviewed.json", "webadmin-command-mark-reviewed-replay.json", "webadmin-command-clear-reviewed.json"]) {
    const value = body(file), expected = value.revision - 1;
    const request = { external_event_id: value.external_event_id, expected_revision: expected, action: value.action };
    const target = { external_event_id: value.external_event_id, activity_id: value.activity_id, revision: expected, status: value.event_status };
    assert.equal(decodeDatesExternalReviewReceipt(value, request, target), true, file);
    assert.equal(decodeDatesExternalReviewReceipt(value, { ...request, expected_revision: value.revision }, { ...target, revision: value.revision }), false, `${file}: a stale baseline`);
  }
  for (const file of ["webadmin-recheck-queued.json", "webadmin-recheck-queued-replay.json"]) {
    const value = body(file);
    assert.equal(decodeDatesExternalRecheckReceipt(value, { external_event_id: value.external_event_id })?.recheck_id, value.recheck.recheck_id, file);
  }
  for (const file of ["webadmin-correction-decide-reject.json", "webadmin-correction-decide-reject-replay.json"]) {
    const value = body(file);
    assert.ok(decodeDatesExternalCorrectionDecision(value, { correction_id: value.correction_id }), file);
  }
  for (const [file, action, extra] of [["webadmin-update-with-correction.json", "dates_external_event_update", {}], ["webadmin-update-with-correction-replay.json", "dates_external_event_update", {}],
    ["webadmin-command-cancel-with-correction.json", "dates_external_event_command", { action: "cancel" }],
    ["webadmin-command-official-update-with-correction.json", "dates_external_event_command", { action: "official_update" }]] as const) {
    const value = body(file);
    const baseline = { external_event_id: value.external_event_id, activity_id: value.activity_id, revision: value.revision - 1, activity_revision: value.activity_revision - 1,
      status: "published" as const, lifecycle: "active" as const, soft_deleted: false };
    assert.ok(decodeDatesExternalReceipt(value, action, { external_event_id: value.external_event_id, expected_revision: value.revision - 1, ...extra,
      correction_id: value.correction.correction_id }, baseline), file);
  }
});

test("every genuine refusal is read as Core meant it: a no-write refusal settles a request, a capability or contract refusal does not", () => {
  const expected: Record<string, "refused" | "uncertain"> = {
    "webadmin-command-clear-reviewed-reason-denied.json": "refused", "webadmin-command-mark-reviewed-moderator-denied.json": "uncertain",
    "webadmin-command-mark-reviewed-selector-denied.json": "refused", "webadmin-command-mark-reviewed-state-denied.json": "refused",
    "webadmin-command-withdraw-with-correction-denied.json": "refused",
    "webadmin-correction-decide-note-required-denied.json": "refused", "webadmin-correction-decide-reason-denied.json": "refused",
    "webadmin-correction-decide-state-denied.json": "refused", "webadmin-correction-list-filter-denied.json": "refused",
    "webadmin-correction-list-selector-denied.json": "uncertain", "webadmin-correction-list-viewer-denied.json": "uncertain",
    "webadmin-external-list-filter-denied.json": "refused",
    "webadmin-recheck-budget-paused-denied.json": "refused", "webadmin-recheck-instructions-denied.json": "refused", "webadmin-recheck-moderator-denied.json": "uncertain",
    "webadmin-recheck-open-denied.json": "refused", "webadmin-recheck-selector-denied.json": "uncertain", "webadmin-recheck-unavailable-denied.json": "refused",
    "webadmin-update-with-correction-moderator-denied.json": "uncertain", "webadmin-update-with-correction-no-change-denied.json": "refused",
    "webadmin-update-with-correction-other-event-denied.json": "refused", "webadmin-update-with-correction-state-denied.json": "refused",
  };
  const refusals = CONSOLE.filter((entry) => body(entry.file).success !== true).map((entry) => entry.file).sort();
  assert.deepEqual(refusals, Object.keys(expected).sort());
  for (const file of refusals) assert.equal(datesExternalRefusal(body(file)).kind, expected[file], file);
  // What a moderator meets in the review workflow has its own words.
  for (const file of refusals.filter((name) => !name.includes("selector") && !name.includes("filter")))
    assert.notEqual(datesExternalReviewRefusalKey(body(file).error), "other", file);
});
