import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { withDatesAdminContract } from "../lib/datesAdminContract.ts";
import { projectDatesAdminBody } from "../lib/datesAdminProjection.ts";
import {
  datesExternalCorrections, datesExternalRechecks, datesExternalRefusal, decodeDatesExternalCorrectionDecision, decodeDatesExternalCorrectionList,
  decodeDatesExternalDetail, decodeDatesExternalList, decodeDatesExternalReceipt, decodeDatesExternalReviewReceipt,
} from "../lib/datesExternalAdmin.ts";
import { datesExternalCorrectionPrefill, datesExternalReviewRefusalKey } from "../lib/datesExternalReview.ts";

// D-149 (T-908): Core-B's GENUINE review console bodies (tests/fixtures/dates_external_review_wire/provenance.txt).
const DIR = new URL("./fixtures/dates_external_review_wire/", import.meta.url);
const bytes = (file: string) => readFileSync(new URL(file, DIR));
const body = (file: string) => JSON.parse(bytes(file).toString("utf8"));
type Entry = { file: string; consumer: "ios" | "webadmin"; route: string; http_status: number; status_code: number; sha256: string };
const manifest = body("manifest.json") as { contract: string; source_commit: string; fixture_set_sha256: string; selectors: Record<string, Record<string, number>>;
  provenance: { selector_variants: Record<string, string> }; fixtures: Entry[] };
const CONSOLE = manifest.fixtures.filter((entry) => entry.consumer === "webadmin");
const route = (entry: Entry) => entry.route.replace(/^\/v1\/webadmin\//, "");
/** The note-only correction Core serves with `"proposed": []` (see provenance.txt): these bodies carry it. */
const PROPOSED_ARRAY = ["webadmin-correction-list-pending.json", "webadmin-external-detail.json", "webadmin-external-detail-after-correction.json"];
const XEV = "xev_00000000000000000000000000000001";

test("the corpus is Core's, byte for byte: every body has the sha256 its manifest names, and nothing else is here", () => {
  assert.equal(manifest.contract, "friending-dates-external-review-wire-v1");
  assert.equal(manifest.source_commit, "4b58099cdd25b9bf41eaa3d37110fdaabf32a0ff");
  assert.equal(manifest.fixture_set_sha256, "0001c70c30ce50fb8798126766563bf969d679521e62c76eb7122913ea001e2f");
  const lines = manifest.fixtures.map(({ file, sha256 }) => {
    assert.equal(createHash("sha256").update(bytes(file)).digest("hex"), sha256, file);
    return `${file}\0${sha256}`;
  });
  assert.equal(createHash("sha256").update(lines.join("\n")).digest("hex"), manifest.fixture_set_sha256);
  assert.deepEqual(readdirSync(DIR).sort(), [...manifest.fixtures.map((entry) => entry.file), "manifest.json", "provenance.txt"].sort());
  assert.equal(manifest.fixtures.length, 47); assert.equal(CONSOLE.length, 30);
});

test("the console's bridge sends exactly the selectors Core captured with, on every console route of the corpus", () => {
  assert.deepEqual(manifest.selectors.webadmin, { dates_event_intake_admin_contract_version: 1, dates_external_admin_contract_version: 2 });
  for (const entry of CONSOLE) {
    const sent = { ...withDatesAdminContract(route(entry), Object.assign(Object.create(null), { admin_email: "admin@example.test" })) };
    assert.deepEqual(sent, { admin_email: "admin@example.test", ...manifest.selectors.webadmin }, entry.file);
  }
});

test("every console success body projects to itself (bar the known proposed: [] bodies), and its decoder reads it", () => {
  for (const entry of CONSOLE) {
    const value = body(entry.file), lines: string[] = [];
    const projected = projectDatesAdminBody(route(entry), value, (line) => lines.push(line));
    assert.deepEqual(lines, [], entry.file);
    if (PROPOSED_ARRAY.includes(entry.file)) {
      // Only the `proposed` of the note-only correction is not passed on: an array is not the named object.
      const rows = (route(entry) === "dates_external_correction_list" ? value.corrections : value.event.corrections) as Array<Record<string, unknown>>;
      const sent = (route(entry) === "dates_external_correction_list" ? (projected as any).corrections : (projected as any).event.corrections) as Array<Record<string, unknown>>;
      rows.forEach((row, index) => assert.deepEqual(sent[index], Array.isArray(row.proposed) ? (({ proposed: _p, ...rest }) => rest)(row) : row, `${entry.file} #${index}`));
      continue;
    }
    assert.deepEqual(projected, value, entry.file);
  }
  for (const file of ["webadmin-external-list-not-reviewed.json", "webadmin-external-list-reviewed.json", "webadmin-external-list-released.json"]) {
    const value = body(file), list = decodeDatesExternalList(value, { page: value.page, limit: value.limit });
    assert.ok(list, file);
    const review = list.events[0].admin_review;
    if (file.endsWith("released.json")) assert.equal(review, undefined, "the released console's row has no review fields");
    else assert.equal(review?.reviewed, !file.includes("not-reviewed"), file);
  }
  const detail = decodeDatesExternalDetail(body("webadmin-external-detail.json"), XEV)!;
  assert.ok(detail); assert.deepEqual(datesExternalRechecks(detail.event, detail.server_now), { rows: [], unreadable: [] });
  const released = decodeDatesExternalDetail(body("webadmin-external-detail-released.json"), XEV)!;
  assert.equal(released.event.admin_review, undefined); assert.equal(datesExternalCorrections(released.event, released.server_now), null);
  for (const [file, status] of [["webadmin-correction-list-approved.json", "approved"], ["webadmin-correction-list-rejected.json", "rejected"]] as const) {
    const value = body(file), list = decodeDatesExternalCorrectionList(value, { page: value.page, status })!;
    assert.ok(list, file); assert.deepEqual(list.unreadable, [], file); assert.ok(list.rows.every((row) => row.status === status && row.decided_at !== null), file);
  }
});

test("known Core defect: a note-only correction served as proposed: [] is listed as unreadable, its neighbours stay", () => {
  const value = body("webadmin-correction-list-pending.json");
  const list = decodeDatesExternalCorrectionList(projectDatesAdminBody("dates_external_correction_list", value), { page: value.page, status: "pending" })!;
  assert.equal(list.rows.length, 2); assert.deepEqual(list.unreadable.map((row) => row.id), ["cor_00000000000000000000000000000003"]);
  assert.deepEqual(value.corrections[2].proposed, []); assert.equal(value.corrections[2].note, "Check number 1.");
  // Encoded as Core's contract says - an empty object - the same row reads.
  const fixed = structuredClone(value); fixed.corrections[2].proposed = {};
  assert.deepEqual(decodeDatesExternalCorrectionList(projectDatesAdminBody("dates_external_correction_list", fixed), { page: value.page, status: "pending" })!.unreadable, []);
  for (const file of ["webadmin-external-detail.json", "webadmin-external-detail-after-correction.json"]) {
    const detail = decodeDatesExternalDetail(projectDatesAdminBody("dates_external_event_detail", body(file)), XEV)!;
    assert.ok(detail, `${file}: the event and its editor stay`);
    assert.equal(datesExternalCorrections(detail.event, detail.server_now)!.unreadable.length, 1, file);
  }
});

test("receipts of the genuine mark, decision and approving update bind; their refusals are read as Core meant them", () => {
  const review = (file: string, expected: number) => {
    const value = body(file);
    return decodeDatesExternalReviewReceipt(value, { external_event_id: value.external_event_id, expected_revision: expected, action: value.action },
      { external_event_id: value.external_event_id, activity_id: value.activity_id, revision: expected, status: value.event_status });
  };
  for (const file of ["webadmin-command-mark-reviewed.json", "webadmin-command-mark-reviewed-replay.json", "webadmin-command-clear-reviewed.json"]) {
    const value = body(file);
    assert.equal(review(file, value.revision - 1), true, file); assert.equal(review(file, value.revision), false, `${file}: a stale baseline`);
  }
  for (const file of ["webadmin-correction-decide-reject.json", "webadmin-correction-decide-reject-replay.json"]) {
    const value = body(file);
    assert.deepEqual(decodeDatesExternalCorrectionDecision(value, { correction_id: value.correction_id }), { correction_id: value.correction_id, status: "rejected" }, file);
  }
  for (const file of ["webadmin-update-with-correction.json", "webadmin-update-with-correction-replay.json"]) {
    const value = body(file);
    const baseline = { external_event_id: value.external_event_id, activity_id: value.activity_id, revision: value.revision - 1, activity_revision: value.activity_revision - 1,
      status: value.event_status, lifecycle: "active" as const, soft_deleted: false };
    const request = { external_event_id: value.external_event_id, expected_revision: value.revision - 1, correction_id: value.correction.correction_id };
    assert.ok(decodeDatesExternalReceipt(value, "dates_external_event_update", request, baseline), file);
    assert.equal(decodeDatesExternalReceipt(value, "dates_external_event_update", { ...request, correction_id: "cor_" + "9".repeat(32) }, baseline), null, file);
  }
  // Each refusal Core raises before writing settles the request; a capability or contract refusal does not prove that.
  const expected: Record<string, "refused" | "uncertain"> = {
    "webadmin-command-clear-reviewed-reason-denied.json": "refused", "webadmin-command-mark-reviewed-selector-denied.json": "refused",
    "webadmin-command-mark-reviewed-state-denied.json": "refused", "webadmin-command-mark-reviewed-moderator-denied.json": "uncertain",
    "webadmin-correction-decide-note-required-denied.json": "refused", "webadmin-correction-decide-reason-denied.json": "refused",
    "webadmin-correction-decide-state-denied.json": "refused", "webadmin-correction-list-filter-denied.json": "refused",
    "webadmin-correction-list-selector-denied.json": "uncertain", "webadmin-correction-list-viewer-denied.json": "uncertain",
    "webadmin-external-list-filter-denied.json": "refused", "webadmin-update-with-correction-moderator-denied.json": "uncertain",
    "webadmin-update-with-correction-other-event-denied.json": "refused", "webadmin-update-with-correction-state-denied.json": "refused",
  };
  const refusals = CONSOLE.filter((entry) => body(entry.file).success !== true).map((entry) => entry.file).sort();
  assert.deepEqual(refusals, Object.keys(expected).sort());
  for (const file of refusals) assert.equal(datesExternalRefusal(body(file)).kind, expected[file], file);
  // The ones a moderator meets in the review workflow have their own words.
  for (const file of ["webadmin-command-mark-reviewed-state-denied.json", "webadmin-correction-decide-state-denied.json", "webadmin-correction-decide-note-required-denied.json",
    "webadmin-correction-decide-reason-denied.json", "webadmin-update-with-correction-other-event-denied.json", "webadmin-command-mark-reviewed-moderator-denied.json"])
    assert.notEqual(datesExternalReviewRefusalKey(body(file).error), "other", file);
});

test("approve and edit on a genuine pending correction: the proposed title, start and venue reach the editor or its hints", () => {
  const detail = decodeDatesExternalDetail(body("webadmin-external-detail.json"), XEV)!;
  const pending = datesExternalCorrections(detail.event, detail.server_now)!.rows.find((row) => row.status === "pending" && Object.hasOwn(row.proposed, "title"))!;
  assert.ok(pending);
  const prefill = datesExternalCorrectionPrefill(detail.event.editor_input, pending);
  assert.equal(prefill.draft.title, pending.proposed.title);
  assert.equal(prefill.draft.startLocal, `${pending.proposed.starts_local}:00`);
  assert.match(prefill.draft.startOffset, /^\+0[12]:00$/, "Europe/Budapest has one offset at that wall time");
  assert.equal(prefill.venue, pending.proposed.venue); assert.equal(prefill.draft.venueName, detail.event.editor_input.venue.name);
  assert.deepEqual([prefill.draft.confirmSource, prefill.draft.confirmPublicVenue, prefill.draft.confirmTimezone, prefill.draft.confirmContentSafe], [false, false, false, false]);
});
