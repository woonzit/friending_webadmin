import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { datesExternalDraftInput } from "../lib/datesExternalInput.ts";
import { decodeDatesActivityOriginDetail, decodeDatesExternalDetail, decodeDatesExternalList, decodeDatesExternalReceipt, datesExternalRefusal } from "../lib/datesExternalAdmin.ts";
import { prepareDatesExternalPending, readDatesExternalPending, runDatesExternalMutation } from "../lib/datesExternalMutations.ts";
import {
  DATES_INTAKE_REFUSALS, DATES_INTAKE_REJECT_REASONS, DATES_INTAKE_STATUSES, DATES_INTAKE_VOCABULARIES,
  datesAiUsageShare, datesIntakeAffordances, datesIntakeCapabilityRefused, datesIntakeCompleteFlag, datesIntakeCompletion, datesIntakeEditorDraft, datesIntakeEditorGaps,
  datesIntakeImageBytes, datesIntakeInProgress, datesIntakePublishableEvents, datesIntakeReferenceHref, datesIntakeRefusal, datesIntakeUnreadableEvents,
  datesIntakeAskFields, datesIntakeAskState, datesIntakeAskValid, datesIntakeMemberNote, datesSuggestionConsent, decodeDatesIntakeAskReceipt,
  decodeDatesIntakeCreateReceipt, decodeDatesIntakeImage, decodeDatesIntakeLeaseReceipt, decodeDatesIntakePublishReceipt,
  decodeDatesIntakeRejectReceipt, projectDatesAiUsage, projectDatesIntakeDetail, projectDatesIntakeQueue, DATES_AI_AMBIGUOUS_SOURCES,
  type DatesIntakeLeaseAction,
} from "../lib/datesIntakeAdmin.ts";

// T-865 P2a + P2b. The event-intake Admin wire, vendored byte-identically from the
// Core lane's tip 62cee304c68eaeda456ddf0b042cb340b8702d48 (T-886 rebased onto
// Core main 33265e46, D-143, D-145; its bodies are those of 8a621565, the manifest
// is rebound on the no-usage fix 2034a93a): 161 genuine bodies captured as real HTTP
// POSTs encoded the way lib/core.ts encodes them, every console request carrying
// the Admin intake contract selector. Against the pin before it (b5b2b299, 159
// bodies, set 008719da...): the three usage reads gained the calls whose cost is
// not known (`ambiguous_calls`, `ambiguous_micro_usd`, `ambiguous_runs`, and
// `ambiguous_calls` per row) and `admin-usage-ambiguous` is new; the two
// selector-less details of an AI-assisted event are now refusals (`-denied`,
// `dates-external-intake-contract-required`, 426) and the selector-less activity
// list of that event is new. Nothing else changed.
// The set digest and the source commit are transcribed from the Core hand-over
// (team/chat/20261003T025530Z-opus-core-p2-to-opus-admin-p2-p2-core-rebased.md and
// 20261003T033201Z-opus-core-p2-to-opus-admin-p2-p2-intake-corpus-4415fcb2.md);
// the manifest digest, the source checksum and the generator digest were read
// from the Core lane's git objects at that tip, not from the vendored copy.
// Rows marked DERIVED are built from a genuine body for a branch no genuine
// body carries; they are named in the lane's report.
const DIRECTORY = new URL("./fixtures/dates_event_intake_admin_wire/", import.meta.url);
const SOURCE = "2034a93a03b1a7d221add795bce7bab15058ef59";
const SOURCE_SHA = "e22c768ad4fed10c3f2c64d96709f76b342bfa783b30c588789c0bbf510c445c";
const MANIFEST_SHA = "f50c8d90fd9bf3cedd0b4499924b36e5c75e8f951b1eae835699a5aacc118bef";
const GENERATOR_SHA = "33191975d3212cd3c7e58f2ebdf3a70daadd71b9c18e8d9af75a69a0afb1ce98";
const SET_SHA = "4415fcb2f85025205eda028fa1e10591b457355e688627e5f438648843fbe79c";
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, DIRECTORY), "utf8"));
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const xin = (number: number) => "xin_" + number.toString(16).padStart(32, "0");

const LISTS = ["all", "channel", "empty", "in-review", "member-channel", "moderator", "page-two", "rejected", "second-look"];
// D-143: the P1 routes as Core serves them with the selector (`manual`, `configuration`) and, for the released console,
// without it (`released-console`; its two details of an AI-assisted event are refusals since D-145, below); and the
// receipt and the two refusals of saving an intake setting.
const SELECTOR_BODIES = ["external-detail-manual", "external-list-manual", "configuration", "configuration-save",
  "external-list-released-console", "activity-list-released-console", "configuration-released-console"];
const DETAILS = ["awaiting-budget", "duplicate", "expired", "extracting", "extracting-retry", "failed-ai-not-configured", "failed-ai-refused",
  "failed-image", "failed-source", "in-review-ambiguous-venue", "in-review-country-unavailable", "in-review-fallback", "in-review-images",
  "in-review-multi", "in-review-needs-info", "in-review-official", "in-review-partial", "in-review-private-address", "in-review-text",
  "in-review-url", "in-review-venue-unavailable", "leased-by-other", "published", "purged", "received", "rejected", "rejected-not-an-event",
  "rejected-prohibited", "rejected-screening", "screening", "screening-retry", "validating", "validating-retry",
  // the two system outcomes Core added with this pin
  "failed-ai-budget-overrun", "published-rest-started"];
// A member's suggestion as the reviewer is served it (P2b).
const MEMBER_DETAILS = ["confirming", "in-review", "asked", "answered", "published", "rejected", "banned", "re-review", "duplicate", "unchecked",
  "unanswered", "withdrawn", "erased", "auto-published"].map((name) => `member-${name}`);
const CREATES = ["text", "text-replay", "url", "url-again", "url-existing", "images", "images-with-text"];
const ASKS = ["ask-member", "ask-member-replay"];
const MEMBER_DECISIONS = ["reject-member-spam", "duplicate-of-event"];
const EXTERNAL_DETAILS = ["external-detail-ai-assisted", "external-detail-member-credit", "external-detail-auto-published"];
const LEASES = ["claim", "heartbeat", "release", "release-idle"];
const REJECT_SUCCESSES = [...DATES_INTAKE_REJECT_REASONS.map((reason) => reason.replaceAll("_", "-")), "replay"];
const PUBLISHES = ["publish", "publish-replay", "publish-partial", "publish-complete", "publish-places-venue", "publish-member"];
const USAGES = ["month", "empty", "earlier-month", "ambiguous"];
// Refusal name => [Core's machine error, logical status], as tests/support/dates_event_intake_admin_wire_contract.php lists them.
const REFUSALS: Record<string, [string, number]> = {
  unauthorized: ["unauthorized", 401], revoked: ["admin-revoked", 403], "create-moderator": ["dates-admin-capability-required", 403],
  "create-drafts-disabled": ["dates-intake-admin-drafts-disabled", 403], "create-kind-invalid": ["dates-intake-kind-invalid", 422],
  "create-input-invalid": ["dates-intake-input-invalid", 422], "create-url-invalid": ["dates-intake-url-invalid", 422],
  "create-source-not-readable": ["dates-intake-source-not-readable", 422], "create-text-invalid": ["dates-intake-text-invalid", 422],
  "create-locale-invalid": ["dates-intake-locale-invalid", 422], "create-origin-invalid": ["dates-intake-origin-invalid", 422],
  "create-image-invalid": ["dates-intake-image-invalid", 422], "create-idempotency-invalid": ["dates-admin-idempotency-invalid", 422],
  "create-key-conflict": ["dates-admin-idempotency-conflict", 409], "list-viewer": ["dates-admin-capability-required", 403],
  "list-filter-invalid": ["dates-intake-filter-invalid", 422], "detail-id-invalid": ["dates-intake-id-invalid", 422],
  "detail-not-found": ["dates-intake-unavailable", 404], "image-unavailable": ["dates-intake-image-unavailable", 404],
  "lease-invalid": ["dates-intake-lease-invalid", 422], "lease-revision-invalid": ["dates-intake-revision-invalid", 422],
  "lease-conflict": ["dates-intake-conflict", 409], "lease-claimed": ["dates-intake-claimed", 409], "lease-lost": ["dates-intake-lease-lost", 409],
  "lease-owner-required": ["dates-intake-lease-owner-required", 403], "reject-reason-invalid": ["dates-intake-reason-invalid", 422],
  "reject-note-required": ["dates-admin-reason-required", 422], "reject-lease-required": ["dates-intake-lease-required", 409],
  "reject-conflict": ["dates-intake-conflict", 409], "reject-state-invalid": ["dates-intake-state-invalid", 409],
  "publish-moderator": ["dates-admin-capability-required", 403], "publish-input-invalid": ["dates-intake-input-invalid", 422],
  "publish-lease-required": ["dates-intake-lease-required", 409], "publish-event-unavailable": ["dates-intake-event-unavailable", 409],
  "publish-conflict": ["dates-intake-conflict", 409], "publish-confirmation-required": ["dates-external-confirmation-required", 422],
  "publish-source-required": ["dates-external-source-required", 422], "publish-publishing-disabled": ["dates-external-publishing-disabled", 403],
  "publish-drafts-disabled": ["dates-intake-admin-drafts-disabled", 403], "usage-filter-invalid": ["dates-intake-filter-invalid", 422],
  // the member channel (P2b)
  "ask-member-input-invalid": ["dates-intake-input-invalid", 422], "ask-member-viewer": ["dates-admin-capability-required", 403],
  "ask-member-lease-required": ["dates-intake-lease-required", 409], "ask-member-state-invalid": ["dates-intake-state-invalid", 409],
  "ask-member-not-a-suggestion": ["dates-intake-state-invalid", 409], "ask-member-suggestions-disabled": ["dates-intake-suggestions-disabled", 403],
  "publish-suggestions-disabled": ["dates-intake-suggestions-disabled", 403],
  "reject-duplicate-event-unavailable": ["dates-intake-duplicate-event-unavailable", 409], "reject-duplicate-invalid": ["dates-intake-input-invalid", 422],
  // D-143: an intake setting is not saveable without the selector; a consent version needs a text in this release.
  "configuration-save-released-console": ["dates-configuration-key-invalid", 422], "configuration-save-consent-text-missing": ["dates-configuration-value-invalid", 422],
  // D-145: what a request WITHOUT the selector gets for an event the released console cannot represent.
  "external-detail-released-console": ["dates-external-intake-contract-required", 426], "activity-detail-released-console": ["dates-external-intake-contract-required", 426],
};

test("intake corpus is the complete 148-response genuine capture with independent provenance pins", () => {
  const manifest = fixture("manifest");
  assert.equal(hash(readFileSync(new URL("manifest.json", DIRECTORY))), MANIFEST_SHA);
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.contract, "dates-event-intake-admin-v1");
  assert.equal(manifest.source_commit, SOURCE);
  assert.equal(manifest.source_checksum, SOURCE_SHA);
  assert.equal(manifest.provenance.generator, "tests/dates_event_intake_admin_fixture_dump.php");
  assert.equal(manifest.provenance.generator_sha256, GENERATOR_SHA);
  assert.match(manifest.provenance.transport, /real HTTP.*application\/x-www-form-urlencoded/s);
  assert.equal(manifest.fixture_count, 161);
  assert.equal(manifest.provenance.source_paths.length, 287);
  assert.equal(manifest.fixture_set_sha256, SET_SHA);
  const names = [...LISTS.map((name) => `admin-list-${name}.json`), ...[...DETAILS, ...MEMBER_DETAILS].map((name) => `admin-detail-${name}.json`),
    ...CREATES.map((name) => `admin-create-${name}.json`), ...LEASES.map((name) => `admin-lease-${name}.json`),
    ...REJECT_SUCCESSES.map((name) => `admin-reject-${name}.json`), ...[...PUBLISHES, ...ASKS, ...MEMBER_DECISIONS, ...EXTERNAL_DETAILS].map((name) => `admin-${name}.json`),
    ...USAGES.map((name) => `admin-usage-${name}.json`), "admin-image-read.json",
    "admin-activity-detail-ai-assisted.json", "admin-external-list-ai-assisted.json", ...Object.keys(REFUSALS).map((name) => `admin-${name}-denied.json`),
    ...SELECTOR_BODIES.map((name) => `admin-${name}.json`), "member-ai-assisted-detail.json", "member-ai-assisted-discover.json"].sort();
  assert.equal(names.length, 161);
  assert.deepEqual(manifest.fixtures.map((entry: { file: string }) => entry.file), names);
  assert.deepEqual(readdirSync(DIRECTORY).sort(), ["manifest.json", ...names].sort());
  const lines = manifest.fixtures.map((entry: { file: string; sha256: string; consumer: string; http_status: number; status_code: number }) => {
    const bytes = readFileSync(new URL(entry.file, DIRECTORY));
    // The two member bodies are the iOS lane's; they are vendored only so that the set digest can be recomputed.
    assert.equal(entry.consumer, entry.file.startsWith("member-") ? "ios" : "webadmin", entry.file);
    assert.equal(entry.http_status, 200);
    assert.equal(hash(bytes), entry.sha256, entry.file);
    assert.equal(JSON.parse(bytes.toString()).status_code, entry.status_code, entry.file);
    return `${entry.file}\0${entry.sha256}`;
  });
  assert.equal(hash(lines.join("\n")), SET_SHA);
  assert.equal(manifest.fixtures.filter((entry: { status_code: number }) => entry.status_code === 200).length, 108);
  assert.equal(manifest.fixtures.filter((entry: { status_code: number }) => entry.status_code !== 200).length, 53);
});

test("the console's closed vocabularies are exactly the ones Core's manifest publishes", () => {
  const manifest = fixture("manifest");
  assert.deepEqual(Object.keys(DATES_INTAKE_VOCABULARIES).sort(), Object.keys(manifest.vocabularies).sort());
  for (const [name, values] of Object.entries(DATES_INTAKE_VOCABULARIES)) assert.deepEqual([...values], manifest.vocabularies[name], name);
  // Every refusal token of the contract has a status here, and the corpus agrees with each one it carries.
  assert.equal(Object.keys(DATES_INTAKE_REFUSALS).length, 26);
  for (const [error, status] of Object.values(REFUSALS)) if (error.startsWith("dates-intake-")) assert.equal(DATES_INTAKE_REFUSALS[error], status, error);
});

// ---------------------------------------------------------------- queue

for (const name of LISTS) test(`genuine intake list ${name} decodes row for row with its controls`, () => {
  const body = fixture(`admin-list-${name}`);
  const queue = projectDatesIntakeQueue(body, { page: body.page, limit: body.limit });
  assert.ok(queue);
  assert.deepEqual(queue.unreadable_rows, []);
  assert.equal(queue.intakes.length, body.intakes.length);
  queue.intakes.forEach((row, index) => {
    const { controls, unreadable_fields, ...served } = row;
    assert.deepEqual(served, body.intakes[index]);
    assert.equal(controls, true); assert.deepEqual(unreadable_fields, []);
  });
  assert.deepEqual(queue.status_counts, body.status_counts);
  assert.deepEqual(Object.keys(queue.status_counts), [...DATES_INTAKE_STATUSES]);
  assert.equal(queue.drafts_enabled, true);
  // The reply to another page or page size is never adopted.
  assert.equal(projectDatesIntakeQueue(body, { page: body.page + 1, limit: body.limit }), null);
  assert.equal(projectDatesIntakeQueue(body, { page: body.page, limit: body.limit === 40 ? 20 : 40 }), null);
});

test("genuine review queue is ordered soonest event first and offers a hold only to a reviewer", () => {
  const body = fixture("admin-list-in-review"), queue = projectDatesIntakeQueue(body, { page: 1, limit: body.limit })!;
  assert.ok(queue.intakes.length >= 2);
  assert.ok(queue.intakes.every((row) => row.status === "in_review"));
  const starts = queue.intakes.map((row) => row.earliest_start_at ?? Infinity);
  assert.deepEqual(starts, [...starts].sort((left, right) => left - right));
  const reviewer = { review: true, manage: false, superadmin: false, draftsEnabled: true };
  for (const row of queue.intakes) {
    assert.deepEqual(datesIntakeAffordances(row, reviewer), { claim: true, release: false, overrideRelease: false, reject: false, publish: false });
    assert.deepEqual(Object.values(datesIntakeAffordances(row, { ...reviewer, review: false })), [false, false, false, false, false]);
  }
  // A moderator's queue carries the review capability but not the manage one.
  const moderator = fixture("admin-list-moderator");
  assert.ok(moderator.capabilities.includes("dates_external_event_review"));
  assert.equal(moderator.capabilities.includes("dates_external_event_manage"), false);
});

test("DERIVED: a damaged row is named, an unusable revision or hold removes its controls, the rest of the page renders", () => {
  const base = fixture("admin-list-all");
  const expected = { page: base.page, limit: base.limit };
  const damage = (mutate: (rows: any[]) => void) => { const body = copy(base); mutate(body.intakes); return projectDatesIntakeQueue(body, expected)!; };
  // An unreadable display field marks the row and nothing else.
  for (const [field, value] of [["first_title", 7], ["source_host", {}], ["channel", "partner_feed"], ["hard_fails", ["not_a_reason"]],
    ["warning_count", -1], ["provider", "mistral"], ["dedupe_decision", "maybe"], ["created_at", "yesterday"]] as const) {
    const queue = damage((rows) => { rows[1][field] = value; });
    assert.equal(queue.intakes.length, base.intakes.length, field);
    assert.deepEqual(queue.intakes[1].unreadable_fields, [field]);
    assert.equal(queue.intakes[1][field], null); assert.equal(queue.intakes[1].controls, true);
    assert.deepEqual(queue.intakes[0].unreadable_fields, []); assert.deepEqual(queue.unreadable_rows, []);
  }
  // An invalid revision or hold keeps the row and removes every action.
  const all = { review: true, manage: true, superadmin: true, draftsEnabled: true };
  for (const [field, value] of [["revision", 0], ["revision", "9"], ["lease", { holder: "a@example.test", until: 5, active: false, mine: false }],
    ["lease", { holder: null, until: 0, active: false }], ["lease", { holder: null, until: 0, active: true, mine: true }]] as const) {
    const queue = damage((rows) => { rows[0][field] = value; });
    assert.equal(queue.intakes[0].controls, false, field); assert.equal(queue.intakes[0][field], null);
    assert.deepEqual(Object.values(datesIntakeAffordances(queue.intakes[0], all)), [false, false, false, false, false]);
    assert.equal(queue.intakes[1].controls, true);
  }
  // A row whose identity or status cannot be trusted, or that lacks one of its fields, is reported, never shown as a normal row.
  for (const mutate of [(rows: any[]) => { rows[0].intake_id = "xin_1"; }, (rows: any[]) => { rows[0].status = "paused"; },
    (rows: any[]) => { delete rows[0].lease; }, (rows: any[]) => { delete rows[0].created_at; }, (rows: any[]) => { rows[0] = null; }]) {
    const queue = damage(mutate);
    assert.equal(queue.intakes.length, base.intakes.length - 1);
    assert.equal(queue.unreadable_rows.length, 1); assert.equal(queue.unreadable_rows[0].index, 0);
  }
  const twins = damage((rows) => { rows[1].intake_id = rows[0].intake_id; });
  assert.deepEqual(twins.unreadable_rows.map((row) => row.index), [0, 1]);
  assert.equal(twins.intakes.length, base.intakes.length - 2);
  // The page is bound on its fields: a missing switch or count, or a wrong type, is not a queue.
  for (const mutate of [(body: any) => { delete body.suggestions_enabled; }, (body: any) => { delete body.status_counts.merged; },
    (body: any) => { body.status_counts.merged = "0"; }, (body: any) => { body.drafts_enabled = 1; }, (body: any) => { body.total = "6"; },
    (body: any) => { body.capabilities = ["users_read"]; }, (body: any) => { body.success = false; }]) {
    const body = copy(base); mutate(body); assert.equal(projectDatesIntakeQueue(body, expected), null);
  }
  // D-143: a key this console does not know is tolerated - at the top, on a row, and a count of a status it does not
  // know (the filter lists the statuses it knows; the count of another one is simply not shown).
  for (const widen of [(body: any) => { body.next_cursor = "x"; }, (body: any) => { body.status_counts.paused = 0; }, (body: any) => { body.intakes[0].submitter_uid = 12; },
    (body: any) => { body.intakes[0].lease.future = 1; }]) {
    const body = copy(base); widen(body);
    const queue = projectDatesIntakeQueue(body, expected);
    assert.ok(queue, widen.toString()); assert.equal(queue.intakes.length, base.intakes.length); assert.deepEqual(queue.unreadable_rows, []);
  }
  // DERIVED: the three statuses no P2a writer produces still decode as rows.
  for (const status of ["member_confirming", "merged", "withdrawn"]) {
    const queue = damage((rows) => { rows[0].status = status; });
    assert.equal(queue.intakes[0].status, status); assert.deepEqual(queue.intakes[0].unreadable_fields, []);
  }
});

// ---------------------------------------------------------------- detail

const STATUS_OF: Record<string, string> = {
  "awaiting-budget": "awaiting_budget", duplicate: "duplicate", expired: "expired", extracting: "extracting", "extracting-retry": "extracting",
  "failed-ai-not-configured": "failed", "failed-ai-refused": "failed", "failed-image": "failed", "failed-source": "failed",
  "leased-by-other": "in_review", published: "published", purged: "expired", received: "received", rejected: "rejected",
  "rejected-not-an-event": "rejected", "rejected-prohibited": "rejected", "rejected-screening": "rejected", screening: "screening",
  "screening-retry": "screening", validating: "validating", "validating-retry": "validating",
  "failed-ai-budget-overrun": "failed", "published-rest-started": "published",
  "member-confirming": "member_confirming", "member-asked": "member_confirming", "member-published": "published", "member-rejected": "rejected",
  "member-banned": "rejected", "member-duplicate": "duplicate", "member-withdrawn": "withdrawn", "member-erased": "published",
  "member-auto-published": "published",
};

for (const name of [...DETAILS, ...MEMBER_DETAILS]) test(`genuine intake detail ${name} decodes whole, with no unreadable part`, () => {
  const body = fixture(`admin-detail-${name}`);
  const read = projectDatesIntakeDetail(body, body.intake.intake_id);
  assert.ok(read);
  const intake = read.intake;
  assert.deepEqual(intake.unreadable_sections, []); assert.deepEqual(intake.unreadable_fields, []); assert.equal(intake.controls, true);
  assert.equal(intake.status, STATUS_OF[name] ?? "in_review");
  // Everything Core served is carried through value for value.
  for (const key of ["revision", "channel", "status_detail", "input_kind", "source_host", "image_count", "provider", "event_count", "published_count",
    "first_title", "earliest_start_at", "hard_fails", "warning_count", "dedupe_decision", "lease", "decision_action", "created_at", "updated_at",
    "admin_principal", "fetch", "result", "result_note", "prohibited_category", "prompt_injection_suspected", "validated_at", "decision",
    "duplicate_of", "budget_waiting_since", "images_delete_after", "retention_until", "content_purged_at"] as const)
    assert.deepEqual(intake[key], body.intake[key], key);
  assert.deepEqual(intake.inputs && { ...intake.inputs, images: intake.inputs.images.items }, body.intake.inputs);
  assert.deepEqual(intake.inputs?.images.unreadable, []);
  assert.deepEqual(intake.source_texts, { items: body.intake.source_texts, unreadable: [] });
  assert.deepEqual(intake.ai_runs, { items: body.intake.ai_runs, unreadable: [] });
  // The member's side: absent for an operator's draft, carried through value for value for a suggestion.
  assert.equal(body.intake.member !== null, name.startsWith("member-")); assert.equal(body.intake.channel === "member_suggestion", name.startsWith("member-"));
  if (body.intake.member === null) assert.equal(intake.member, null);
  else {
    assert.ok(intake.member); assert.deepEqual(intake.member.unreadable, []); assert.deepEqual(intake.member.corrections.unreadable, []);
    const { unreadable: _unreadable, corrections, ...served } = intake.member;
    assert.deepEqual({ ...served, corrections: corrections.items }, body.intake.member);
  }
  assert.equal(intake.events.length, body.intake.events.length);
  intake.events.forEach((event, index) => {
    assert.ok(event, `event ${index}`);
    const { editor_unreadable, ...served } = event;
    assert.deepEqual(served, body.intake.events[index]); assert.equal(editor_unreadable, false);
  });
  assert.deepEqual(read.capabilities, body.capabilities); assert.equal(read.server_now, body.server_now);
  // Another intake's detail is never adopted for this page.
  assert.equal(projectDatesIntakeDetail(body, xin(0xfff)), null);
  assert.equal(projectDatesIntakeDetail(body, "xin_1"), null);
  // Only an intake in review can be acted on, and never without a hold.
  const all = { review: true, manage: true, superadmin: true, draftsEnabled: true };
  const can = datesIntakeAffordances(intake, all);
  if (intake.status !== "in_review") {
    assert.deepEqual(Object.values(can), [false, false, false, false, false]);
    assert.deepEqual(datesIntakePublishableEvents(intake), []);
    assert.ok(intake.events.every((event) => event!.editor_input === null), "Core offers no prefill outside review");
  }
  assert.equal(datesIntakeInProgress(intake.status), ["received", "screening", "extracting", "validating", "awaiting_budget"].includes(intake.status));
});

test("the genuine corpus carries a detail for each of the thirteen statuses that have a writer and each of the three input kinds", () => {
  const seen = new Set<string>(), kinds = new Set<string>(), operator = new Set<string>();
  for (const name of [...DETAILS, ...MEMBER_DETAILS]) { const body = fixture(`admin-detail-${name}`); seen.add(body.intake.status); kinds.add(body.intake.input_kind); }
  for (const name of DETAILS) operator.add(fixture(`admin-detail-${name}`).intake.status);
  assert.deepEqual([...seen].sort(), fixture("manifest").coverage.status.covered.sort());
  assert.equal(seen.size, 13); assert.equal(operator.size, 11, "member_confirming and withdrawn are the member channel's");
  assert.deepEqual(DATES_INTAKE_STATUSES.filter((status) => !seen.has(status)), ["merged"], "the one status no body carries");
  assert.deepEqual([...kinds].sort(), ["images", "text", "url"]);
});

test("genuine in-review drafts: evidence, checks, venue and the P1 editor prefill", () => {
  // A link with an official source: every quote found, the venue resolved through Places.
  const official = projectDatesIntakeDetail(fixture("admin-detail-in-review-official"), xin(4))!.intake, event = official.events[0]!;
  assert.equal(event.validation!.tier, "official");
  assert.ok(Object.values(event.field_evidence!).every((state) => state.quoted && state.verified));
  assert.equal(event.validation!.venue!.place_id, "ChIJ4-4EKkDcQUcRPGkz1ExWaWg");
  assert.deepEqual(event.validation!.warnings, ["start_is_doors_time", "price_unclear", "end_estimated"]);
  assert.equal(event.validation!.auto_publishable, false);
  assert.deepEqual(datesIntakePublishableEvents(official), [0]);
  assert.deepEqual(datesIntakeEditorGaps(event.editor_input!), []);
  const draft = datesIntakeEditorDraft(event.editor_input!);
  assert.equal(draft.title, event.editor_input!.title); assert.equal(draft.timezone, "Europe/Budapest");
  assert.equal(draft.startLocal, "2026-10-03T23:00:00"); assert.equal(draft.startOffset, "+02:00");
  // Core's estimated end is not a claim: the editor is given none.
  assert.equal(draft.endLocal, ""); assert.equal(draft.sourceUrl, "https://akvariumklub.hu/programok/acidarab/");
  for (const key of ["confirmSource", "confirmPublicVenue", "confirmTimezone", "confirmContentSafe"] as const) assert.equal(draft[key], false);
  // The prefill is not publishable until the reviewer ticks the four confirmations...
  assert.deepEqual(datesExternalDraftInput(draft), { ok: false, error: "confirmations" });
  // ...and then it is exactly Core's document with the confirmations a person gave.
  const confirmed = datesExternalDraftInput({ ...draft, confirmSource: true, confirmPublicVenue: true, confirmTimezone: true, confirmContentSafe: true });
  assert.ok(confirmed.ok);
  const { confirmations, summary, ...facts } = confirmed.event, { confirmations: fresh, summary: served, ...prefill } = event.editor_input!;
  assert.deepEqual(facts, prefill); assert.deepEqual(summary, { en: served.en, hu: served.hu });
  assert.deepEqual(confirmations, { source: true, public_venue: true, timezone: true, content_safe: true });
  assert.deepEqual(fresh, { source: false, public_venue: false, timezone: false, content_safe: false });
});

test("genuine in-review drafts Core could not complete leave the gaps to the reviewer", () => {
  // "szombaton": a relative date at midnight. Core serves no start, and the editor refuses to guess one.
  const needsInfo = projectDatesIntakeDetail(fixture("admin-detail-in-review-needs-info"), fixture("admin-detail-in-review-needs-info").intake.intake_id)!.intake;
  const vague = needsInfo.events[0]!;
  assert.deepEqual([...vague.validation!.hard_fails].sort(), ["relative_date_unconfirmed", "time_missing"]);
  assert.equal(vague.validation!.needs_more_info, true);
  const gaps = datesIntakeEditorGaps(vague.editor_input!);
  assert.ok(gaps.length > 0);
  const draft = datesIntakeEditorDraft(vague.editor_input!);
  for (const gap of gaps) {
    if (gap === "start") assert.equal(draft.startLocal, "");
    if (gap === "venue") { assert.equal(draft.venueName, ""); assert.equal(draft.latitude, ""); }
    if (gap === "organizer") assert.equal(draft.organizerName, "");
    if (gap === "source") assert.equal(draft.sourceUrl, "");
  }
  const confirmed = datesExternalDraftInput({ ...draft, confirmSource: true, confirmPublicVenue: true, confirmTimezone: true, confirmContentSafe: true });
  assert.equal(confirmed.ok, false, "an incomplete prefill is never a publishable event");
  // Every genuine prefill becomes a draft without inventing a value.
  let prefills = 0;
  for (const name of DETAILS) for (const event of projectDatesIntakeDetail(fixture(`admin-detail-${name}`), fixture(`admin-detail-${name}`).intake.intake_id)!.intake.events) {
    if (!event?.editor_input) continue;
    prefills++;
    const made = datesIntakeEditorDraft(event.editor_input), input = event.editor_input;
    assert.equal(made.venueName, input.venue?.name ?? ""); assert.equal(made.organizerName, input.organizer.name ?? "");
    assert.equal(made.startLocal === "", input.start_at === null || input.timezone === null);
    assert.equal(made.isFree, input.is_free === true); assert.equal(made.sourceUrl, input.source_url ?? "");
  }
  assert.equal(prefills, 18);
});

test("genuine multi-event intake is published one event at a time until complete", () => {
  const multi = projectDatesIntakeDetail(fixture("admin-detail-in-review-multi"), xin(6))!.intake;
  assert.equal(multi.events.length, 4); assert.equal(multi.result, "multiple_events");
  assert.deepEqual(datesIntakePublishableEvents(multi), [0, 1, 2, 3]);
  // After the first publication Core serves the published event without a prefill and keeps the other three open.
  const partial = projectDatesIntakeDetail(fixture("admin-detail-in-review-partial"), xin(6))!.intake;
  assert.equal(partial.status, "in_review"); assert.equal(partial.published_count, 1);
  assert.equal(partial.events[0]!.published_external_event_id, "xev_" + "2".padStart(32, "0"));
  assert.equal(partial.events[0]!.editor_input, null);
  assert.deepEqual(datesIntakePublishableEvents(partial), [1, 2, 3]);
  // Core refuses to reject an intake an event already came of; the console does not offer it.
  const mine = { ...partial, lease: { holder: "admin@example.test", until: 1790000300, active: true, mine: true } };
  const can = datesIntakeAffordances(mine, { review: true, manage: true, superadmin: false, draftsEnabled: true });
  assert.equal(can.publish, true); assert.equal(can.reject, false); assert.equal(can.release, true);
});

test("review finding: an event the console could not read is unknown, so publishing a sibling never closes the intake by itself", () => {
  const read = (name: string, mutate: (intake: any) => void = () => undefined) => {
    const body = copy(fixture(name)); mutate(body.intake); return projectDatesIntakeDetail(body, body.intake.intake_id)!.intake;
  };
  // Genuine: a one-event intake - publishing it is plainly the last publication.
  const counted = ({ question: _question, ...rest }: ReturnType<typeof datesIntakeCompletion>) => rest;
  const single = datesIntakeCompletion(read("admin-detail-in-review-official"), 0);
  assert.deepEqual(single, { remaining: 0, unreadable: 0, mode: "last", question: "0|1|last||" });
  assert.equal(datesIntakeCompleteFlag(single, false), true);
  // Genuine: four readable events - the reviewer may say which one is the last; the default keeps the intake open.
  const multi = datesIntakeCompletion(read("admin-detail-in-review-multi"), 0);
  assert.deepEqual(multi, { remaining: 3, unreadable: 0, mode: "choice", question: "0|4|choice|1.2.3|" });
  assert.deepEqual([datesIntakeCompleteFlag(multi, false), datesIntakeCompleteFlag(multi, true)], [false, true]);
  // Genuine: after one publication three remain.
  assert.deepEqual(counted(datesIntakeCompletion(read("admin-detail-in-review-partial"), 1)), { remaining: 2, unreadable: 0, mode: "choice" });
  // DERIVED - the reviewer's scenario: two events, event 0 readable, event 1 carrying a value this console cannot decode.
  const twoEvents = (mutate: (second: any) => void) => read("admin-detail-in-review-multi", (intake) => {
    intake.events = intake.events.slice(0, 2); intake.event_count = 2; mutate(intake.events[1]);
  });
  const damaged = twoEvents((second) => { second.draft.category = "hackathon"; });
  assert.equal(damaged.events![1], null);
  assert.deepEqual(datesIntakePublishableEvents(damaged), [0], "only one event can be opened in the editor...");
  assert.deepEqual(datesIntakeUnreadableEvents(damaged), [1], "...and the other is unknown, not absent");
  const completion = datesIntakeCompletion(damaged, 0);
  assert.deepEqual(completion, { remaining: 0, unreadable: 1, mode: "unreadable", question: "0|2|unreadable||1" });
  // The default leaves the intake open; closing it is only ever the reviewer's explicit choice.
  assert.equal(datesIntakeCompleteFlag(completion, false), false);
  assert.equal(datesIntakeCompleteFlag(completion, true), true);
  // The same when only the editor prefill of the sibling is unreadable.
  const prefill = twoEvents((second) => { second.editor_input.confirmations.source = true; });
  assert.equal(prefill.events![1]!.editor_unreadable, true);
  assert.deepEqual(counted(datesIntakeCompletion(prefill, 0)), { remaining: 0, unreadable: 1, mode: "unreadable" });
  // With one unreadable and two readable siblings the mode is still "unreadable": nothing implicit, both numbers known.
  const mixed = read("admin-detail-in-review-multi", (intake) => { intake.events[3].validation.tier = "platinum"; });
  assert.deepEqual(datesIntakeCompletion(mixed, 0), { remaining: 2, unreadable: 1, mode: "unreadable", question: "0|4|unreadable|1.2|3" });
  assert.equal(datesIntakeCompleteFlag(datesIntakeCompletion(mixed, 0), false), false);
  // A readable sibling Core offers no prefill for (already published) is known, not unknown.
  const published = read("admin-detail-in-review-partial");
  assert.deepEqual(datesIntakeUnreadableEvents(published), []);
});

test("genuine hold of another reviewer leaves nothing but the superadmin's release", () => {
  const body = fixture("admin-detail-leased-by-other"), intake = projectDatesIntakeDetail(body, body.intake.intake_id)!.intake;
  assert.deepEqual(intake.lease, { holder: "moderator@example.test", until: 1790000300, active: true, mine: false });
  const reviewer = { review: true, manage: true, superadmin: false, draftsEnabled: true };
  assert.deepEqual(datesIntakeAffordances(intake, reviewer), { claim: false, release: false, overrideRelease: false, reject: false, publish: false });
  assert.deepEqual(datesIntakeAffordances(intake, { ...reviewer, superadmin: true }),
    { claim: false, release: false, overrideRelease: true, reject: false, publish: false });
  // With the reviewer's own hold: a reviewer rejects, a manager also publishes - and not while drafting is switched off.
  const mine = { ...intake, lease: { ...intake.lease!, mine: true } };
  assert.deepEqual(datesIntakeAffordances(mine, { ...reviewer, manage: false }), { claim: false, release: true, overrideRelease: false, reject: true, publish: false });
  assert.equal(datesIntakeAffordances(mine, reviewer).publish, true);
  assert.equal(datesIntakeAffordances(mine, { ...reviewer, draftsEnabled: false }).publish, false);
});

test("genuine terminal and waiting intakes explain themselves", () => {
  const read = (name: string) => { const body = fixture(`admin-detail-${name}`); return projectDatesIntakeDetail(body, body.intake.intake_id)!.intake; };
  const duplicate = read("duplicate");
  assert.equal(duplicate.status_detail, "duplicate-source");
  assert.deepEqual(duplicate.duplicate_of, { kind: "intake", id: xin(2) });
  assert.equal(datesIntakeReferenceHref(duplicate.duplicate_of!), `/dates/intakes/${xin(2)}`);
  assert.equal(duplicate.ai_runs.items.length, 0, "no AI was spent on a known source");
  const waiting = read("awaiting-budget");
  assert.equal(waiting.budget_waiting_since, 1790928000); assert.equal(waiting.events.length, 0);
  assert.equal(read("expired").status_detail, "start-passed"); assert.equal(read("expired").decision!.by, "system");
  assert.equal(read("failed-source").status_detail, "source-unreachable");
  assert.equal(read("failed-image").status_detail, "image-unreadable");
  assert.equal(read("failed-ai-refused").status_detail, "ai-refused");
  assert.equal(read("failed-ai-not-configured").status_detail, "ai-not-configured");
  assert.equal(read("rejected-screening").decision!.action, "screening_rejected");
  assert.equal(read("rejected-screening").inputs!.images.items[0].safe_search!.adult, "LIKELY");
  assert.equal(read("rejected-prohibited").prohibited_category, "crypto_seminar");
  assert.equal(read("rejected-not-an-event").result, "not_an_event");
  const rejected = read("rejected");
  assert.equal(rejected.decision!.reason_code, "not_an_event"); assert.ok(rejected.decision!.statement!.hu.length > 20);
  assert.ok(rejected.images_delete_after! < rejected.retention_until!);
  const published = read("published");
  assert.equal(published.decision!.action, "published"); assert.equal(published.events[0]!.published_external_event_id, "xev_" + "1".padStart(32, "0"));
  // After the content purge only the place id is left of a venue; the page still decodes.
  const purged = read("purged");
  assert.equal(purged.content_purged_at, 1794380401);
  assert.equal(purged.source_texts.items.length, 0);
  const venue = purged.events[0]?.validation?.venue;
  if (venue) { assert.equal(typeof venue.place_id, "string"); assert.equal(venue.name, null); assert.equal(venue.latitude, null); }
  // Planted instructions are flagged and stay flagged.
  assert.ok(DETAILS.some((name) => read(name).prompt_injection_suspected));
});

test("DERIVED: an unreadable part of a detail is named and never shown as empty, and removes only its own controls", () => {
  const base = fixture("admin-detail-in-review-multi"), id = base.intake.intake_id;
  const read = (mutate: (intake: any) => void) => { const body = copy(base); mutate(body.intake); return projectDatesIntakeDetail(body, id); };
  // One damaged event: the other three are still shown and still publishable.
  const event = read((intake) => { intake.events[1].draft.category = "seminar"; })!.intake;
  assert.equal(event.events[1], null); assert.ok(event.events[0] && event.events[2] && event.events[3]);
  assert.deepEqual(datesIntakePublishableEvents(event), [0, 2, 3]);
  // An event whose index is not its position has no identity towards Core's publish route.
  assert.equal(read((intake) => { intake.events[2].index = 0; })!.intake.events[2], null);
  // A prefill with a ticked confirmation is not Core's prefill: the event is shown, the editor is not offered.
  const ticked = read((intake) => { intake.events[0].editor_input.confirmations.source = true; })!.intake;
  assert.equal(ticked.events[0]!.editor_input, null); assert.equal(ticked.events[0]!.editor_unreadable, true);
  assert.deepEqual(datesIntakePublishableEvents(ticked), [1, 2, 3]);
  // Sections degrade one by one.
  for (const [key, value] of [["decision", { by: "x" }], ["fetch", { final_url: 1 }], ["duplicate_of", { kind: "page", id: "x" }],
    ["result", "maybe"], ["validated_at", "now"], ["source_texts", "none"], ["ai_runs", {}], ["events", null], ["inputs", { kind: "fax" }]] as const) {
    const intake = read((source) => { source[key] = value; })!.intake;
    assert.deepEqual(intake.unreadable_sections, [key], key);
    assert.equal(intake.intake_id, id); assert.equal(intake.controls, true);
    // Review finding: a list that cannot be read is null - unknown - and never an empty list the page would word as "none".
    if (key === "events" || key === "ai_runs" || key === "source_texts") assert.equal(intake[key], null, key);
  }
  const whole = read((source) => { source.events = { rows: source.events }; source.ai_runs = "20 calls"; source.source_texts = null; })!.intake;
  assert.deepEqual([whole.events, whole.ai_runs, whole.source_texts], [null, null, null]);
  assert.deepEqual([...whole.unreadable_sections].sort(), ["ai_runs", "events", "source_texts"]);
  assert.deepEqual(datesIntakePublishableEvents(whole), []); assert.deepEqual(datesIntakeUnreadableEvents(whole), []);
  // Genuinely empty lists stay empty lists.
  const empty = projectDatesIntakeDetail(fixture("admin-detail-received"), fixture("admin-detail-received").intake.intake_id)!.intake;
  assert.deepEqual([empty.events, empty.ai_runs, empty.source_texts], [[], { items: [], unreadable: [] }, { items: [], unreadable: [] }]);
  const runs = read((intake) => { intake.ai_runs.push({ provider: "mistral" }); })!.intake;
  assert.deepEqual(runs.ai_runs.unreadable, [base.intake.ai_runs.length]); assert.equal(runs.ai_runs.items.length, base.intake.ai_runs.length);
  const texts = read((intake) => { intake.source_texts[0].label = "pdf:1"; })!.intake;
  assert.deepEqual(texts.source_texts.unreadable, [0]);
  // A suspected injection that cannot be read is treated as suspected.
  assert.equal(read((intake) => { intake.prompt_injection_suspected = "no"; })!.intake.prompt_injection_suspected, true);
  // Revision or hold unreadable: the page renders, nothing can be changed from it.
  const stale = read((intake) => { intake.revision = null; })!.intake;
  assert.equal(stale.controls, false);
  assert.deepEqual(Object.values(datesIntakeAffordances(stale, { review: true, manage: true, superadmin: true, draftsEnabled: true })), [false, false, false, false, false]);
  // The detail is bound on its fields: a missing one, another identity or an unknown status is not this intake.
  assert.equal(read((intake) => { delete intake.retention_until; }), null);
  // D-143: a key this console does not know is tolerated - on the intake, on an event, in a section - and the detail
  // still reads whole.
  const wider = read((intake) => { intake.submitter_uid = 12; intake.events[0].future = 1; intake.inputs.future = 2; intake.fetch && (intake.fetch.future = 3); })!.intake;
  assert.deepEqual(wider.unreadable_sections, []); assert.deepEqual(wider.unreadable_fields, []); assert.ok(wider.events![0]);
  assert.equal(read((intake) => { intake.status = "paused"; }), null);
  // DERIVED vocabulary no genuine body carries: a review-grade duplicate candidate that is a published event,
  // a disagreeing witness, a dropped link, and the third provider.
  const rich = read((intake) => {
    intake.events[0].dedupe = { decision: "review", candidates: [{ kind: "event", id: "xev_" + "9".padStart(32, "0"), similarity: 0.62, verdict: "review" }] };
    intake.events[0].validation.checks.witness = { present: true, date: "agrees", time: "disagrees", venue: "absent" };
    intake.events[0].validation.links.dropped = [{ field: "ticket_url", reason: "domain_not_allowed" }];
    intake.ai_runs[0].provider = "anthropic"; intake.ai_runs[0].outcome = "not_configured";
  })!.intake;
  assert.deepEqual(rich.unreadable_sections, []);
  assert.equal(datesIntakeReferenceHref(rich.events[0]!.dedupe!.candidates[0]), "/dates/external/xev_" + "9".padStart(32, "0"));
  assert.equal(rich.events[0]!.validation!.checks.witness.time, "disagrees");
  assert.equal(datesIntakeReferenceHref({ kind: "event", id: "../admin" }), null);
});

// ---------------------------------------------------------------- receipts

for (const name of CREATES) test(`genuine create ${name} is a receipt bound to its intake, with the two markers`, () => {
  const body = fixture(`admin-create-${name}`), receipt = decodeDatesIntakeCreateReceipt(body);
  assert.deepEqual(receipt, body);
  assert.equal(receipt!.replayed, name.endsWith("-replay"));
  // `existing`: not a new draft and not an error - the operator's own open draft of the same source, as it is now.
  assert.equal(receipt!.existing, name.endsWith("-existing"));
  if (receipt!.existing) assert.deepEqual(receipt!.intake, { intake_id: xin(2), revision: 9, status: "in_review" });
  else assert.deepEqual([receipt!.intake.revision, receipt!.intake.status], [1, "received"]);
  // What identifies the command is bound; a key the console does not know is tolerated (no exact-key-set check).
  assert.deepEqual(decodeDatesIntakeCreateReceipt({ ...body, extra: 1, intake: { ...body.intake, extra: 2 } }), { ...body, extra: 1, intake: { ...body.intake, extra: 2 } });
  const { existing: _existing, ...unmarked } = body, { replayed: _replayed, ...unreplayed } = body;
  for (const changed of [unmarked, unreplayed, { ...body, existing: "true" }, { ...body, existing: 1 }, { ...body, replayed: "no" }, { ...body, audit_id: null },
    { ...body, success: false }, { ...body, status_code: 409 }, { ...body, intake: { intake_id: body.intake.intake_id } }, { ...body, intake: { ...body.intake, intake_id: "xin_1" } },
    { ...body, intake: { ...body.intake, revision: 0 } }, { ...body, intake: { ...body.intake, status: "sleeping" } },
    // A new draft is revision 1 and `received`; an existing one is open - never one that already ended.
    ...(body.existing ? ["published", "rejected", "duplicate", "failed", "withdrawn", "expired", "merged"].map((status) => ({ ...body, intake: { ...body.intake, status } }))
      : [{ ...body, intake: { ...body.intake, status: "in_review" } }, { ...body, intake: { ...body.intake, revision: 2 } }])])
    assert.equal(decodeDatesIntakeCreateReceipt(changed), null, JSON.stringify(changed).slice(0, 120));
  // An existing draft may be anywhere in the pipeline, at any revision.
  if (body.existing) for (const status of ["received", "screening", "extracting", "validating", "member_confirming", "awaiting_budget", "in_review"])
    assert.ok(decodeDatesIntakeCreateReceipt({ ...body, intake: { ...body.intake, status, revision: 1 } }), status);
});

for (const name of LEASES) test(`genuine lease ${name} answers exactly its request`, () => {
  const body = fixture(`admin-lease-${name}`), action = name.split("-")[0] as DatesIntakeLeaseAction;
  const request = { intake_id: body.intake.intake_id, expected_revision: body.intake.revision - 1, action };
  assert.deepEqual(decodeDatesIntakeLeaseReceipt(body, request), body);
  assert.equal(body.audit_id === null, action === "heartbeat", "a heartbeat is not audited; a claim and a release are");
  assert.equal(body.intake.lease.mine, action !== "release");
  // The receipt of another intake, another revision or another action is refused.
  assert.equal(decodeDatesIntakeLeaseReceipt(body, { ...request, intake_id: xin(0xabc) }), null);
  assert.equal(decodeDatesIntakeLeaseReceipt(body, { ...request, expected_revision: request.expected_revision + 1 }), null);
  for (const other of ["claim", "heartbeat", "release"] as const) if (other !== action)
    assert.equal(decodeDatesIntakeLeaseReceipt(body, { ...request, action: other }), null, `${name} read as ${other}`);
  // Bound, not exact-key: a key this console does not know is tolerated (at the top and in the intake) ...
  const wider = { ...body, extra: true, intake: { ...body.intake, extra: 1, lease: { ...body.intake.lease, extra: 2 } } };
  assert.deepEqual(decodeDatesIntakeLeaseReceipt(wider, request), wider);
  // The four facts of the lease are still all required, and have to say what the action leaves.
  const { until: _until, ...timeless } = body.intake.lease;
  for (const lease of [timeless, { ...body.intake.lease, mine: "yes" }, { ...body.intake.lease, active: !body.intake.lease.active }])
    assert.equal(decodeDatesIntakeLeaseReceipt({ ...body, intake: { ...body.intake, lease } }, request), null, JSON.stringify(lease));
  const { server_now: _now, message: _message, status: _status, can_send: _send, ...core } = body;
  assert.deepEqual(decodeDatesIntakeLeaseReceipt(core, request), core, "Core's clock and the legacy envelope are not what identifies the command");
  // ... and each thing that does identify it is required.
  const { audit_id: _audit, ...unaudited } = body, { lease: _lease, ...unleased } = body.intake;
  for (const changed of [{ ...body, success: false }, { ...body, status_code: 409 }, { ...body, success: "true" }, unaudited, { ...body, audit_id: "aud_1" },
    { ...body, intake: unleased }, { ...body, intake: { ...body.intake, status: "rejected" } }, { ...body, intake: { ...body.intake, revision: "10" } }])
    assert.equal(decodeDatesIntakeLeaseReceipt(changed, request), null, JSON.stringify(changed).slice(0, 120));
});

for (const reason of DATES_INTAKE_REJECT_REASONS) test(`genuine rejection ${reason} carries Core's statement in both languages`, () => {
  const body = fixture(`admin-reject-${reason.replaceAll("_", "-")}`);
  const request = { intake_id: body.intake.intake_id, expected_revision: body.intake.revision - 1, reason_code: reason };
  const receipt = decodeDatesIntakeRejectReceipt(body, request);
  assert.deepEqual(receipt, body);
  assert.ok(receipt!.decision.statement.en.length > 10 && receipt!.decision.statement.hu.length > 10);
  assert.notEqual(receipt!.decision.statement.en, receipt!.decision.statement.hu);
  const other = DATES_INTAKE_REJECT_REASONS.find((code) => code !== reason)!;
  assert.equal(decodeDatesIntakeRejectReceipt(body, { ...request, reason_code: other }), null);
  assert.equal(decodeDatesIntakeRejectReceipt(body, { ...request, expected_revision: request.expected_revision - 1 }), null);
  assert.equal(decodeDatesIntakeRejectReceipt({ ...body, intake: { ...body.intake, status: "in_review" } }, request), null);
  // Bound, not exact-key: unknown keys are tolerated; what identifies the command is required, and both echoes of
  // the outcome must say "rejected" for a request that named no event.
  const wider = { ...body, extra: 1, intake: { ...body.intake, extra: 2 }, decision: { ...body.decision, extra: 3 } };
  assert.deepEqual(decodeDatesIntakeRejectReceipt(wider, request), wider);
  const { audit_id: _audit, ...unaudited } = body, { replayed: _replayed, ...unmarked } = body;
  for (const changed of [{ ...body, success: false }, { ...body, status_code: 409 }, unaudited, unmarked, { ...body, audit_id: null }, { ...body, replayed: "no" },
    { ...body, intake: { ...body.intake, status: "duplicate" } }, { ...body, decision: { ...body.decision, action: "duplicate" } },
    { ...body, intake: { ...body.intake, status: "duplicate" }, decision: { ...body.decision, action: "duplicate" } },
    { ...body, intake: { ...body.intake, intake_id: xin(0xabc) } }, { ...body, decision: { ...body.decision, action: "published" } }])
    assert.equal(decodeDatesIntakeRejectReceipt(changed, request), null, JSON.stringify(changed).slice(0, 140));
});

test("genuine member decisions: a strike rejection is a rejection; naming the event that is already there ends the suggestion as a duplicate of it", () => {
  const spam = fixture("admin-reject-member-spam");
  const spamRequest = { intake_id: spam.intake.intake_id, expected_revision: spam.intake.revision - 1, reason_code: "spam_or_fake" };
  assert.deepEqual(decodeDatesIntakeRejectReceipt(spam, spamRequest), spam);
  assert.deepEqual([spam.intake.status, spam.decision.action, spam.decision.reason_code], ["rejected", "rejected", "spam_or_fake"]);
  // The strike is Core's and is on the audit record; the receipt does not carry it, and the console does not look for it.
  assert.doesNotMatch(JSON.stringify(spam), /strike|banned/);
  const duplicate = fixture("admin-duplicate-of-event"), event = fixture("admin-detail-member-duplicate").intake.duplicate_of.id;
  const request = { intake_id: duplicate.intake.intake_id, expected_revision: duplicate.intake.revision - 1, reason_code: "duplicate", duplicate_of_external_event_id: event };
  assert.match(event, /^xev_[a-f0-9]{32}$/);
  assert.deepEqual(decodeDatesIntakeRejectReceipt(duplicate, request), duplicate);
  assert.deepEqual([duplicate.intake.status, duplicate.decision.action, duplicate.decision.reason_code], ["duplicate", "duplicate", "duplicate"]);
  // The outcome is bound to what was asked: a request that named an event is answered by `duplicate` only, one that
  // named none by `rejected` only - the genuine P2a receipt of the reason "duplicate" among them.
  const { duplicate_of_external_event_id: _named, ...unnamed } = request;
  assert.equal(decodeDatesIntakeRejectReceipt(duplicate, unnamed), null, "a duplicate receipt is not the answer to a plain rejection");
  const plain = fixture("admin-reject-duplicate");
  const plainRequest = { intake_id: plain.intake.intake_id, expected_revision: plain.intake.revision - 1, reason_code: "duplicate" };
  assert.deepEqual(decodeDatesIntakeRejectReceipt(plain, plainRequest), plain);
  assert.equal(decodeDatesIntakeRejectReceipt(plain, { ...plainRequest, duplicate_of_external_event_id: event }), null, "a plain rejection is not the answer to a named duplicate");
  for (const changed of [{ ...duplicate, intake: { ...duplicate.intake, status: "rejected" } }, { ...duplicate, decision: { ...duplicate.decision, action: "rejected" } },
    { ...duplicate, decision: { ...duplicate.decision, reason_code: "spam_or_fake" } }, { ...duplicate, intake: { ...duplicate.intake, revision: duplicate.intake.revision + 1 } }])
    assert.equal(decodeDatesIntakeRejectReceipt(changed, request), null, JSON.stringify(changed).slice(0, 140));
  // The detail after it names the event, and the page links to it.
  const after = projectDatesIntakeDetail(fixture("admin-detail-member-duplicate"), duplicate.intake.intake_id)!.intake;
  assert.deepEqual([after.status, after.decision?.action, after.duplicate_of], ["duplicate", "duplicate", { kind: "event", id: event }]);
  assert.equal(datesIntakeReferenceHref(after.duplicate_of!), `/dates/external/${event}`);
});

for (const name of ASKS) test(`genuine ${name}: the draft is with the member, bound to the intake, the revision and the fields that were asked about`, () => {
  const body = fixture(`admin-${name}`);
  const request = { intake_id: body.intake.intake_id, expected_revision: body.intake.revision - 1, fields: ["starts_local", "venue_address"] };
  assert.deepEqual(decodeDatesIntakeAskReceipt(body, request), body);
  assert.equal(body.replayed, name.endsWith("-replay")); assert.equal(body.intake.status, "member_confirming");
  assert.deepEqual(body.asked, { fields: ["starts_local", "venue_address"], due_at: 1790259200 });
  // The same fields in another order are the same question; another set is another command's receipt.
  assert.ok(decodeDatesIntakeAskReceipt(body, { ...request, fields: ["venue_address", "starts_local"] }));
  for (const fields of [["starts_local"], ["starts_local", "venue_address", "title"], ["starts_local", "title"], []])
    assert.equal(decodeDatesIntakeAskReceipt(body, { ...request, fields }), null, JSON.stringify(fields));
  assert.equal(decodeDatesIntakeAskReceipt(body, { ...request, intake_id: xin(0xabc) }), null);
  assert.equal(decodeDatesIntakeAskReceipt(body, { ...request, expected_revision: request.expected_revision + 1 }), null);
  // Bound, not exact-key.
  const wider = { ...body, extra: 1, intake: { ...body.intake, extra: 2 }, asked: { ...body.asked, round: 2 } };
  assert.deepEqual(decodeDatesIntakeAskReceipt(wider, request), wider);
  const { audit_id: _audit, ...unaudited } = body, { asked: _asked, ...unasked } = body, { replayed: _replayed, ...unmarked } = body;
  for (const changed of [{ ...body, success: false }, { ...body, status_code: 409 }, unaudited, unasked, unmarked, { ...body, audit_id: null },
    { ...body, intake: { ...body.intake, status: "in_review" } }, { ...body, asked: { ...body.asked, due_at: "soon" } }, { ...body, asked: { fields: body.asked.fields } },
    { ...body, asked: { ...body.asked, fields: ["starts_local", "password"] } }])
    assert.equal(decodeDatesIntakeAskReceipt(changed, request), null, JSON.stringify(changed).slice(0, 140));
  // It is the receipt of this command only.
  assert.equal(decodeDatesIntakeRejectReceipt(body, { intake_id: request.intake_id, expected_revision: request.expected_revision, reason_code: "duplicate" }), null);
  assert.equal(decodeDatesIntakeLeaseReceipt(body, { intake_id: request.intake_id, expected_revision: request.expected_revision, action: "release" }), null);
});

test("the second look: Core marks the rows that wait for one and counts them; a Core that does not serve the mark is read as none", () => {
  // The genuine filtered queue: one row, a member's suggestion back in review, marked; the count beside the page.
  const waiting = fixture("admin-list-second-look"), queue = projectDatesIntakeQueue(waiting, { page: waiting.page, limit: waiting.limit })!;
  assert.equal(queue.second_look_count, 1); assert.equal(waiting.second_look_count, 1);
  assert.deepEqual(queue.intakes.map((row) => [row.channel, row.status, row.second_look]), [["member_suggestion", "in_review", true]]);
  assert.deepEqual(queue.unreadable_rows, []); assert.deepEqual(queue.intakes[0].unreadable_fields, []);
  assert.equal(Object.keys(waiting.intakes[0]).at(-1), "second_look");
  // Every other genuine queue read: the count is served (0 in these captures) and no row is marked.
  for (const name of LISTS.filter((item) => item !== "second-look")) {
    const body = fixture(`admin-list-${name}`), read = projectDatesIntakeQueue(body, { page: body.page, limit: body.limit })!;
    assert.equal(read.second_look_count, body.second_look_count, name); assert.equal(typeof body.second_look_count, "number", name);
    assert.ok(read.intakes.every((row) => row.second_look === false), name);
  }
  // Every genuine detail carries the mark on its row keys, and it is what the member block says: asked for, not decided, still in review.
  let marked = 0;
  for (const name of [...DETAILS, ...MEMBER_DETAILS]) {
    const body = fixture(`admin-detail-${name}`), intake = projectDatesIntakeDetail(body, body.intake.intake_id)!.intake;
    assert.equal(intake.second_look, body.intake.second_look, name);
    assert.equal(intake.second_look, intake.status === "in_review" && intake.member?.re_review != null && intake.member.re_review.decided_at === null, name);
    if (intake.second_look) marked++;
  }
  assert.equal(marked, 1, "member-re-review");
  // DERIVED: a Core that does not serve the two keys (D-143: additions are optional) - no mark, the count not known.
  const older = copy(waiting); delete older.second_look_count; delete older.intakes[0].second_look;
  const before = projectDatesIntakeQueue(older, { page: older.page, limit: older.limit })!;
  assert.equal(before.second_look_count, null); assert.equal(before.intakes[0].second_look, false); assert.deepEqual(before.intakes[0].unreadable_fields, []);
  // DERIVED: served in a shape this console cannot read - the row says so and is not marked; the count is not known. Never a guess.
  for (const value of ["yes", 1, null, "true"]) {
    const odd = copy(waiting); odd.intakes[0].second_look = value;
    const read = projectDatesIntakeQueue(odd, { page: odd.page, limit: odd.limit })!;
    assert.equal(read.intakes[0].second_look, false, String(value)); assert.deepEqual(read.intakes[0].unreadable_fields, ["second_look"], String(value));
    assert.equal(read.intakes[0].controls, true, "an unreadable mark removes no action");
  }
  for (const value of ["1", -1, 1.5, null, { n: 1 }]) {
    const odd = copy(waiting); odd.second_look_count = value;
    assert.equal(projectDatesIntakeQueue(odd, { page: odd.page, limit: odd.limit })!.second_look_count, null, JSON.stringify(value));
  }
});

test("the consent text's state: served with the selector, in a closed vocabulary; absent is silence and anything else is unreadable", () => {
  // Genuine, with the selector: version 1, still a draft. Without it (the released console's read): not served at all.
  assert.deepEqual(datesSuggestionConsent(fixture("admin-configuration")), { kind: "known", required_version: 1, text_status: "draft" });
  assert.deepEqual(fixture("admin-configuration").event_suggestion_consent, { required_version: 1, text_status: "draft" });
  assert.deepEqual(datesSuggestionConsent(fixture("admin-configuration-released-console")), { kind: "absent" });
  assert.deepEqual(fixture("manifest").vocabularies.consent_text_status, ["missing", "draft", "approved"]);
  // DERIVED: the two states no genuine body carries (they need another release state; the Core lane did not fabricate them).
  const body = fixture("admin-configuration");
  for (const text_status of ["missing", "approved"] as const)
    assert.deepEqual(datesSuggestionConsent({ ...body, event_suggestion_consent: { required_version: 2, text_status } }), { kind: "known", required_version: 2, text_status });
  // A key Core might add beside the two is tolerated.
  assert.deepEqual(datesSuggestionConsent({ ...body, event_suggestion_consent: { required_version: 1, text_status: "draft", approved_by: "counsel" } }),
    { kind: "known", required_version: 1, text_status: "draft" });
  // A status this console does not know, or a broken block, is unreadable - never read as approved, never as silence.
  for (const served of [{ required_version: 1, text_status: "pending" }, { required_version: 1 }, { text_status: "approved" }, { required_version: 0, text_status: "draft" },
    { required_version: "1", text_status: "draft" }, null, "draft", []]) assert.deepEqual(datesSuggestionConsent({ ...body, event_suggestion_consent: served }), { kind: "unreadable" }, JSON.stringify(served));
  for (const odd of [null, "x", [], {}]) assert.deepEqual(datesSuggestionConsent(odd), { kind: "absent" });
});

test("publishing a member's suggestion is offered under the member channel's switch, an operator's draft under the draft switch", () => {
  const held = (name: string) => { const body = fixture(`admin-detail-${name}`), intake = projectDatesIntakeDetail(body, body.intake.intake_id)!.intake;
    return { ...intake, lease: { holder: "admin@example.test", until: 1790000300, active: true, mine: true } }; };
  const manager = { review: true, manage: true, superadmin: false };
  const suggestion = held("member-in-review"), draft = held("in-review-official");
  assert.deepEqual([suggestion.channel, draft.channel], ["member_suggestion", "admin_draft"]);
  // Each channel follows its own switch and ignores the other's.
  assert.equal(datesIntakeAffordances(suggestion, { ...manager, draftsEnabled: false, suggestionsEnabled: true }).publish, true);
  assert.equal(datesIntakeAffordances(suggestion, { ...manager, draftsEnabled: true, suggestionsEnabled: false }).publish, false);
  assert.equal(datesIntakeAffordances(draft, { ...manager, draftsEnabled: true, suggestionsEnabled: false }).publish, true);
  assert.equal(datesIntakeAffordances(draft, { ...manager, draftsEnabled: false, suggestionsEnabled: true }).publish, false);
  // Unknown is not "off" (a caller that does not say): Core answers with its own refusal - the genuine one of this corpus.
  assert.equal(datesIntakeAffordances(suggestion, { ...manager, draftsEnabled: false }).publish, true);
  assert.deepEqual(datesIntakeRefusal(fixture("admin-publish-suggestions-disabled-denied")), { kind: "core", error: "dates-intake-suggestions-disabled", status: 403 });
  // The rest is the same for both channels: a reviewer without the management capability rejects but does not publish.
  for (const intake of [suggestion, draft])
    assert.deepEqual(datesIntakeAffordances(intake, { review: true, manage: false, superadmin: false, draftsEnabled: true, suggestionsEnabled: true }),
      { claim: false, release: true, overrideRelease: false, reject: true, publish: false });
  // With the switch off a suggestion can still be rejected (Core's reject does not read the switch).
  assert.equal(datesIntakeAffordances(suggestion, { ...manager, draftsEnabled: true, suggestionsEnabled: false }).reject, true);
});

test("what a reviewer may ask: one to eight of the editable fields, none twice; a note Core would accept or none", () => {
  const all = [...DATES_INTAKE_VOCABULARIES.member_editable_field];
  assert.deepEqual(all, ["title", "starts_local", "ends_local", "venue_name", "venue_address", "venue_city", "price_text", "is_free"]);
  assert.ok(datesIntakeAskFields(all)); assert.ok(datesIntakeAskFields(["title"]));
  for (const fields of [[], ["title", "title"], [...all, "title"], ["summary"], ["title", 1], "title", null, { 0: "title" }])
    assert.equal(datesIntakeAskFields(fields), false, JSON.stringify(fields));
  // Core: optional; when given not blank, no control character but tab and line breaks, at most 500 graphemes after trimming.
  for (const note of ["Biztosan reggel 9-kor kezdődik?", "two\nlines\tand a tab", "x".repeat(500), `  ${"é".repeat(500)}  `, "👩‍👩‍👧‍👦".repeat(500)])
    assert.equal(datesIntakeMemberNote(note), true, note.slice(0, 20));
  for (const note of ["", "   ", "\n\t", "x".repeat(501), "bell\u0007", "escape\u001b[0m", "delete\u007f", "null\u0000", 5, null, undefined])
    assert.equal(datesIntakeMemberNote(note), false, JSON.stringify(note)?.slice(0, 20));
  assert.equal(datesIntakeAskValid(["title"], "", "why"), true); assert.equal(datesIntakeAskValid(["title"], "   ", "why"), true, "a blank note is no note");
  assert.equal(datesIntakeAskValid(["title"], "Look at the date, please.", "why"), true);
  for (const [fields, note, reason] of [[[], "", "why"], [["title"], "", ""], [["title"], "", "   "], [["title"], "x".repeat(501), "why"], [["title"], "bell\u0007", "why"],
    [["nope"], "", "why"], [["title"], "", "x".repeat(1001)]] as const) assert.equal(datesIntakeAskValid(fields, note, reason), false, JSON.stringify([fields, reason]).slice(0, 60));
});

test("asking the member is offered on a member's suggestion in review only, and allowed only as Core's can_ask, the switch and the hold say", () => {
  const reviewer = { review: true, suggestionsEnabled: true };
  const held = (name: string) => { const body = fixture(`admin-detail-${name}`), intake = projectDatesIntakeDetail(body, body.intake.intake_id)!.intake;
    return { ...intake, lease: { holder: "admin@example.test", until: 1790000300, active: true, mine: true } }; };
  // Every genuine detail: an operator's draft is never offered it; a suggestion only while it is in review.
  for (const name of [...DETAILS, ...MEMBER_DETAILS]) {
    const intake = held(name), state = datesIntakeAskState(intake, reviewer);
    assert.equal(state.offered, intake.channel === "member_suggestion" && intake.status === "in_review", name);
    if (state.offered) assert.deepEqual(state, intake.member!.can_ask ? { offered: true, allowed: true } : { offered: true, allowed: false, why: "notAskable" }, name);
  }
  // Core's word per genuine suggestion in review: fresh from the member and a second look may be asked; one that was
  // already asked (answered or not) may not.
  assert.deepEqual(Object.fromEntries(MEMBER_DETAILS.map((name) => [name, held(name)]).filter(([, intake]) => (intake as any).status === "in_review")
    .map(([name, intake]) => [name, (intake as any).member.can_ask])),
    { "member-in-review": true, "member-answered": false, "member-re-review": true, "member-unchecked": true, "member-unanswered": false });
  const askable = held("member-in-review");
  assert.deepEqual(datesIntakeAskState(askable, { review: false, suggestionsEnabled: true }), { offered: false });
  assert.deepEqual(datesIntakeAskState(askable, { review: true, suggestionsEnabled: false }), { offered: true, allowed: false, why: "switchOff" });
  // Unknown is not "off": Core answers with its own refusal.
  assert.deepEqual(datesIntakeAskState(askable, { review: true, suggestionsEnabled: null }), { offered: true, allowed: true });
  const genuine = fixture("admin-detail-member-in-review"), unheld = projectDatesIntakeDetail(genuine, genuine.intake.intake_id)!.intake;
  assert.deepEqual(datesIntakeAskState(unheld, reviewer), { offered: true, allowed: false, why: "holdFirst" });
  assert.deepEqual(datesIntakeAskState({ ...askable, lease: { ...askable.lease, mine: false } }, reviewer), { offered: true, allowed: false, why: "holdFirst" });
  assert.deepEqual(datesIntakeAskState({ ...askable, controls: false }, reviewer), { offered: true, allowed: false, why: "holdFirst" });
  // A member block the console could not read whole is never a reason to ask - and never "no member".
  for (const change of [{ confirmation: { state: "sleeping" } }, { standing: "good" }, { re_review: [] }, { corrections: "none" }]) {
    const body = copy(genuine); Object.assign(body.intake.member, change); body.intake.lease = { holder: "admin@example.test", until: 1790000300, active: true, mine: true };
    const intake = projectDatesIntakeDetail(body, body.intake.intake_id)!.intake;
    assert.equal(intake.member!.can_ask, false, JSON.stringify(change)); assert.equal(intake.member!.unreadable.length, 1);
    assert.deepEqual(datesIntakeAskState(intake, reviewer), { offered: true, allowed: false, why: "unreadable" }, JSON.stringify(change));
  }
  const broken = copy(genuine); broken.intake.member.submitter_uid = "19601"; broken.intake.lease = { holder: "admin@example.test", until: 1790000300, active: true, mine: true };
  const unread = projectDatesIntakeDetail(broken, broken.intake.intake_id)!.intake;
  assert.equal(unread.member, null); assert.ok(unread.unreadable_sections.includes("member"));
  assert.deepEqual(datesIntakeAskState(unread, reviewer), { offered: true, allowed: false, why: "unreadable" });
});
test("genuine rejection replay is the first receipt again", () => {
  const body = fixture("admin-reject-replay"), first = fixture("admin-reject-not-an-event");
  assert.equal(body.replayed, true);
  assert.deepEqual({ ...body, replayed: false }, first);
  assert.ok(decodeDatesIntakeRejectReceipt(body, { intake_id: body.intake.intake_id, expected_revision: body.intake.revision - 1, reason_code: "not_an_event" }));
});

const PUBLISH_REQUEST: Record<string, { complete: boolean; status: string; count: number }> = {
  publish: { complete: false, status: "published", count: 1 }, "publish-replay": { complete: false, status: "published", count: 1 },
  "publish-partial": { complete: false, status: "in_review", count: 1 }, "publish-complete": { complete: true, status: "published", count: 2 },
  "publish-places-venue": { complete: false, status: "published", count: 1 }, "publish-member": { complete: false, status: "published", count: 1 },
};
function memoryStorage() {
  const rows = new Map<string, string>();
  return { rows, storage: { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); },
    removeItem: (key: string) => { rows.delete(key); } } };
}
/** The editor document a reviewer confirmed, built from a genuine Core prefill. */
function confirmedEvent() {
  const prefill = projectDatesIntakeDetail(fixture("admin-detail-in-review-official"), xin(4))!.intake.events[0]!.editor_input!;
  const made = datesExternalDraftInput({ ...datesIntakeEditorDraft(prefill), confirmSource: true, confirmPublicVenue: true, confirmTimezone: true, confirmContentSafe: true });
  assert.ok(made.ok);
  return made.event;
}
function publishPending(body: any, complete: boolean) {
  return prepareDatesExternalPending("admin@example.test", "dates_event_intake_publish", { intake_id: body.intake.intake_id,
    intake_revision: body.intake.revision - 1, event_index: 0, complete, event: confirmedEvent(), reason: "Source and public venue verified." }, null, 1790000000)!;
}

for (const name of PUBLISHES) test(`genuine intake ${name} is the P1 publish receipt plus what became of the intake, through the P1 journal`, async () => {
  const body = fixture(`admin-${name}`), expected = PUBLISH_REQUEST[name];
  const request = { intake_id: body.intake.intake_id, intake_revision: body.intake.revision - 1, event_index: 0, complete: expected.complete };
  assert.deepEqual(decodeDatesIntakePublishReceipt(body, request), body);
  assert.equal(body.intake.status, expected.status); assert.equal(body.intake.published_count, expected.count);
  assert.equal(body.replayed, name.endsWith("-replay"));
  // The same receipt is refused for another intake or revision, and as the receipt of a manual publication.
  assert.equal(decodeDatesIntakePublishReceipt(body, { ...request, intake_id: xin(0xabc) }), null);
  assert.equal(decodeDatesIntakePublishReceipt(body, { ...request, intake_revision: request.intake_revision + 1 }), null);
  assert.equal(decodeDatesExternalReceipt(body, "dates_external_event_publish", {}, null), null);
  const { audit_id: _audit, ...unaudited } = body, { external_event_id: _event, ...unnamed } = body;
  for (const changed of [{ ...body, revision: 0 }, { ...body, revision: "1" }, { ...body, activity_revision: 0 }, { ...body, event_status: "in_review" },
    { ...body, intake: { ...body.intake, status: "rejected" } }, { ...body, intake: { ...body.intake, published_count: 0 } }, { ...body, success: false },
    { ...body, status_code: 409 }, unaudited, unnamed, { ...body, external_event_id: "xev_1" }, { ...body, activity_id: "act_1" }, { ...body, audit_id: null }])
    assert.equal(decodeDatesIntakePublishReceipt(changed, request), null, JSON.stringify(changed).slice(0, 120));
  // Bound, not exact-key: unknown keys are tolerated at the top and in the intake.
  const wider = { ...body, extra: 1, intake: { ...body.intake, extra: 2 } };
  assert.deepEqual(decodeDatesIntakePublishReceipt(wider, request), wider);
  // "This was the last one" must finish the intake.
  if (body.intake.status === "in_review") assert.equal(decodeDatesIntakePublishReceipt(body, { ...request, complete: true }), null);
  // Through the journal: the exact command is persisted before it leaves and cleared only by this receipt.
  const pending = publishPending(body, expected.complete), memory = memoryStorage();
  assert.ok(pending);
  assert.equal(typeof pending.body.event_index, "number"); assert.equal(typeof pending.body.complete, "boolean");
  let stored = 0;
  const outcome = await runDatesExternalMutation(pending, memory.storage, 1790000000, async (action, sent) => {
    stored = memory.rows.size;
    assert.equal(action, "dates_event_intake_publish"); assert.deepEqual(sent, pending.body);
    return body;
  });
  assert.equal(stored, 1, "saved before dispatch");
  assert.equal(outcome.kind, "success"); assert.equal(memory.rows.size, 0);
  assert.equal(readDatesExternalPending(memory.storage, "admin@example.test").kind, "empty");
});

for (const [name, [error, status]] of Object.entries(REFUSALS).filter(([name]) => name.startsWith("publish-"))) test(`genuine ${name} refusal through the P1 journal`, async () => {
  const body = fixture(`admin-${name}-denied`), pending = publishPending(fixture("admin-publish"), false), memory = memoryStorage();
  assert.deepEqual(body, { success: false, status_code: status, error, message: 200, status: 200, can_send: 0 });
  assert.equal(decodeDatesIntakePublishReceipt(body, pending.body), null);
  const outcome = await runDatesExternalMutation(pending, memory.storage, 1790000000, async () => body);
  // A capability refusal precedes Core's receipt lookup, so it does not prove an earlier attempt did not land.
  const definite = error !== "dates-admin-capability-required";
  assert.equal(outcome.kind, definite ? "refused" : "uncertain", error);
  assert.equal(memory.rows.size, definite ? 0 : 1);
  assert.deepEqual(datesExternalRefusal(body), { kind: definite ? "refused" : "uncertain", error, status });
});

test("the publish journal refuses a command it would not send and keeps an unanswered one", async () => {
  const body = fixture("admin-publish"), base = publishPending(body, false).body;
  const without = ({ idempotency_key: _key, ...rest }: Record<string, unknown>) => rest;
  for (const change of [{ event_index: "0" }, { event_index: -1 }, { event_index: 100 }, { complete: "1" }, { complete: 1 }, { intake_id: "xin_1" },
    { intake_revision: 0 }, { reason: "   " }, { origin: { latitude: 47.5, longitude: 19 } }, { event: { ...base.event as object, confirmations: { source: false, public_venue: true, timezone: true, content_safe: true } } }])
    assert.equal(prepareDatesExternalPending("admin@example.test", "dates_event_intake_publish", { ...without(base), ...change }, null, 1790000000), null, JSON.stringify(Object.keys(change)));
  // A baseline belongs to an update; a publication from an intake has none.
  assert.equal(prepareDatesExternalPending("admin@example.test", "dates_event_intake_publish", without(base),
    { external_event_id: "xev_" + "a".repeat(32), activity_id: "act_" + "b".repeat(32), revision: 1, activity_revision: 1, status: "published", lifecycle: "active", soft_deleted: false }, 1790000000), null);
  const pending = publishPending(body, false), memory = memoryStorage();
  for (const response of [null, { success: true }, { success: false, status_code: 503, error: "dates-admin-unavailable", message: 200, status: 200, can_send: 0 }]) {
    const outcome = await runDatesExternalMutation(pending, memory.storage, 1790000000, async () => response);
    assert.equal(outcome.kind, "uncertain"); assert.equal(memory.rows.size, 1);
  }
  // The retry sends the identical command and is settled by the replayed receipt.
  const replay = await runDatesExternalMutation(pending, memory.storage, 1790000000, async (_action, sent) => { assert.deepEqual(sent, pending.body); return fixture("admin-publish-replay"); });
  assert.equal(replay.kind, "success"); assert.equal(memory.rows.size, 0);
});

// ---------------------------------------------------------------- refusals

for (const [name, [error, status]] of Object.entries(REFUSALS)) test(`genuine refusal ${name} is Core's closed envelope and never a success of any route`, () => {
  const body = fixture(`admin-${name}-denied`);
  assert.deepEqual(datesIntakeRefusal(body), { kind: "core", error, status });
  assert.equal(datesIntakeCapabilityRefused(datesIntakeRefusal(body)), error === "dates-admin-capability-required");
  assert.equal(projectDatesIntakeQueue(body, { page: 1, limit: 40 }), null);
  assert.equal(projectDatesIntakeDetail(body, xin(1)), null);
  assert.equal(projectDatesAiUsage(body, null), null);
  assert.equal(decodeDatesIntakeCreateReceipt(body), null);
  assert.equal(decodeDatesIntakeImage(body, 1), null);
  assert.equal(decodeDatesIntakeLeaseReceipt(body, { intake_id: xin(1), expected_revision: 9, action: "claim" }), null);
  assert.equal(decodeDatesIntakeRejectReceipt(body, { intake_id: xin(1), expected_revision: 9, reason_code: "duplicate" }), null);
  assert.equal(decodeDatesIntakeAskReceipt(body, { intake_id: xin(1), expected_revision: 9, fields: ["title"] }), null);
  assert.equal(decodeDatesIntakePublishReceipt(body, { intake_id: xin(1), intake_revision: 9, complete: false }), null);
});
test("a refusal that is not Core's closed envelope is not reported as Core's word", () => {
  const core = fixture("admin-lease-claimed-denied");
  assert.deepEqual(datesIntakeRefusal({ success: false, status_code: 403, error: "dates-admin-capability-required" }),
    { kind: "bridge", error: "dates-admin-capability-required", status: 403 });
  assert.equal(datesIntakeCapabilityRefused(datesIntakeRefusal({ success: false, status_code: 403, error: "dates-admin-capability-required" })), true);
  const { can_send: _send, ...partial } = core;
  for (const value of [null, "refused", partial, { ...core, status_code: 200 }, { ...core, error: "Not Found" }, { ...core, message: 500 },
    { success: false, error: "core-unavailable" }]) assert.deepEqual(datesIntakeRefusal(value), { kind: "unreadable" });
  // D-143: Core's refusal is bound on its token, its status and the legacy envelope; another key does not unmake it.
  assert.deepEqual(datesIntakeRefusal({ ...core, extra: 1 }), { kind: "core", error: core.error, status: core.status_code });
  assert.deepEqual(datesIntakeRefusal({ success: false, status_code: 502, error: "core-unavailable", detail: "x" }), { kind: "bridge", error: "core-unavailable", status: 502 });
  assert.equal(datesIntakeCapabilityRefused({ kind: "unreadable" }), false);
});

// ---------------------------------------------------------------- usage

for (const name of USAGES) test(`genuine AI usage ${name} decodes with every row`, () => {
  const body = fixture(`admin-usage-${name}`), read = projectDatesAiUsage(body, name === "earlier-month" ? "2026-09" : null);
  assert.ok(read);
  // Every served key as served, the rows whole, and the calls whose cost is not known read (D-145).
  assert.deepEqual({ ...read.usage, rows: read.usage.rows }, { ...body.usage, unreadable_rows: [], ambiguous: { kind: "known", calls: body.usage.ambiguous_calls,
    micro_usd: body.usage.ambiguous_micro_usd, runs: body.usage.ambiguous_runs, unreadable_runs: [] } });
  assert.equal(read.drafts_enabled, true);
  assert.equal(projectDatesAiUsage(body, "2026-01"), null, "the reply for another month is never adopted");
  assert.equal(read.usage.cap_usd, 50);
});
test("genuine month-to-date usage: spend against the cap by provider, model, task and channel", () => {
  const usage = projectDatesAiUsage(fixture("admin-usage-month"), "2026-10")!.usage;
  assert.equal(usage.spent_micro_usd, 216588); assert.equal(usage.calls, 26); assert.equal(usage.alert, false); assert.equal(usage.exhausted, false);
  assert.deepEqual(usage.rows.map((row) => `${row.provider}/${row.model}/${row.task}/${row.channel}`), [
    "gemini/gemini-3.8-flash/flyer_extract/admin_draft", "gemini/gemini-3.8-flash/text_extract/admin_draft", "openai/gpt-6.1-sol/flyer_extract/admin_draft",
    "openai/gpt-6.1-sol/text_extract/admin_draft", "openai/gpt-6.1-sol/url_extract/admin_draft"]);
  assert.equal(usage.rows.reduce((sum, row) => sum + row.cost_micro_usd, 0), usage.spent_micro_usd);
  assert.equal(usage.rows.find((row) => row.task === "text_extract" && row.provider === "openai")!.unanswered_calls, 3);
  assert.ok(Math.abs(datesAiUsageShare(usage)! - 216588 / 50_000_000) < 1e-12);
  // The read capability is enough for the usage; the genuine body was served to a support viewer.
  assert.deepEqual(fixture("admin-usage-month").capabilities.filter((item: string) => item.startsWith("dates_external")), ["dates_external_event_read"]);
});
test("D-145: a call whose cost is not known is money that may have been spent - counted, listed, and never read as none", () => {
  // Genuine: one call that timed out after it was sent, booked at its whole reservation; it is in the month's spend.
  const body = fixture("admin-usage-ambiguous"), usage = projectDatesAiUsage(body, null)!.usage;
  assert.deepEqual(usage.ambiguous, { kind: "known", calls: 1, micro_usd: 149243, runs: [{ provider: "openai", model: "gpt-6.1-sol", task: "text_extract",
    channel: "admin_draft", source: "transport", failure: "curl-28", booked_micro_usd: 149243, at: 1790000000 }], unreadable_runs: [] });
  assert.equal(usage.rows.reduce((sum, row) => sum + row.cost_micro_usd, 0), usage.spent_micro_usd, "the booked reservation is part of the spend");
  assert.deepEqual(usage.rows.map((row) => row.ambiguous_calls), [1, 0]);
  assert.ok(DATES_AI_AMBIGUOUS_SOURCES.includes(usage.ambiguous.kind === "known" ? usage.ambiguous.runs[0].source as never : "x" as never));
  // The other genuine reads say none, as numbers.
  for (const name of ["month", "empty", "earlier-month"]) {
    const read = projectDatesAiUsage(fixture(`admin-usage-${name}`), name === "earlier-month" ? "2026-09" : null)!.usage;
    assert.deepEqual([read.ambiguous.kind, read.ambiguous.kind === "known" && read.ambiguous.calls], ["known", 0], name);
  }
  // DERIVED: a Core before D-145 serves none of the three keys - that is "absent", not "none"; rows without the key read.
  const before = copy(body); delete before.usage.ambiguous_calls; delete before.usage.ambiguous_micro_usd; delete before.usage.ambiguous_runs;
  for (const row of before.usage.rows) delete row.ambiguous_calls;
  const absent = projectDatesAiUsage(before, null)!.usage;
  assert.deepEqual(absent.ambiguous, { kind: "absent" }); assert.equal(absent.unreadable_rows.length, 0);
  // DERIVED: served but not readable - a part of the three, a figure of the wrong type - is "unreadable", never a zero.
  for (const change of [{ ambiguous_calls: "1" }, { ambiguous_micro_usd: -1 }, { ambiguous_runs: "none" }, { ambiguous_calls: undefined }]) {
    const odd = copy(body); Object.assign(odd.usage, change);
    if (change.ambiguous_calls === undefined && "ambiguous_calls" in change) delete odd.usage.ambiguous_calls;
    assert.deepEqual(projectDatesAiUsage(odd, null)!.usage.ambiguous, { kind: "unreadable" }, JSON.stringify(change));
  }
  // A listed run that cannot be read is counted, not dropped silently; an unknown source is kept for the page to show raw.
  const damaged = copy(body); damaged.usage.ambiguous_runs.push({ provider: "openai" }, { ...damaged.usage.ambiguous_runs[0], source: "watchdog", failure: "" });
  const read = projectDatesAiUsage(damaged, null)!.usage.ambiguous;
  assert.ok(read.kind === "known" && read.runs.length === 2 && read.runs[1].source === "watchdog" && read.unreadable_runs.length === 1);
  // A row's figure of the wrong type makes that row unreadable.
  const row = copy(body); row.usage.rows[0].ambiguous_calls = "1";
  assert.deepEqual(projectDatesAiUsage(row, null)!.usage.unreadable_rows, [0]);
});

test("DERIVED: the 80% alert, an exhausted cap, a zero cap and a damaged row of the usage read", () => {
  const base = fixture("admin-usage-month");
  const read = (change: Record<string, unknown>) => projectDatesAiUsage({ ...base, usage: { ...base.usage, ...change } }, null);
  const alert = read({ spent_micro_usd: 41_000_000, remaining_micro_usd: 9_000_000, alert: true, alert_at: 1790500000 })!.usage;
  assert.equal(alert.alert, true); assert.equal(alert.alert_at, 1790500000); assert.ok(datesAiUsageShare(alert)! > 0.8);
  const exhausted = read({ spent_micro_usd: 49_900_000, reserved_micro_usd: 400_000, remaining_micro_usd: 0, alert: true, exhausted: true })!.usage;
  assert.equal(datesAiUsageShare(exhausted), 1);
  assert.equal(datesAiUsageShare(read({ cap_usd: 0, remaining_micro_usd: 0, exhausted: true })!.usage), null, "a cap of 0 is the AI switched off, not 100%");
  // Core's figures are shown as served: a total that does not add up is not a decoding error.
  assert.ok(read({ calls: 1, spent_micro_usd: 5 }));
  const damaged = read({ rows: [...base.usage.rows, { provider: "openai" }] })!.usage;
  assert.equal(damaged.rows.length, base.usage.rows.length); assert.deepEqual(damaged.unreadable_rows, [base.usage.rows.length]);
  // A provider or task this console does not know is still a row (Core does not declare the ledger's values closed).
  assert.equal(read({ rows: [{ ...base.usage.rows[0], provider: "mistral", task: "research_area" }] })!.usage.rows[0].provider, "mistral");
  for (const change of [{ month: "2026-13" }, { cap_usd: -1 }, { alert: "no" }, { rows: "none" }, { calls: undefined }]) assert.equal(read(change), null);
  // D-143: a key this console does not know is tolerated in the usage read and on a row.
  assert.ok(read({ extra: 1 })); assert.equal(read({ rows: [{ ...base.usage.rows[0], extra: 1 }] })!.usage.unreadable_rows.length, 0);
});

// ---------------------------------------------------------------- flyer read

test("genuine flyer read is an audited JPEG read bound on its fields; its bytes are checked where they are decoded", () => {
  const body = fixture("admin-image-read"), read = decodeDatesIntakeImage(body, 1);
  assert.deepEqual(read, body);
  assert.equal(read!.image.mime, "image/jpeg"); assert.match(read!.audit_id, /^aud_[a-f0-9]{32}$/);
  assert.equal(decodeDatesIntakeImage(body, 2), null, "the receipt of another flyer");
  for (const change of [{ mime: "image/png" }, { index: 3 }, { sha256: "abc" }, { data_base64: undefined }])
    assert.equal(decodeDatesIntakeImage({ ...body, image: { ...body.image, ...change } }, 1), null);
  // D-143: a key this console does not know is tolerated; the route still serves only the decoded JPEG bytes, never an address.
  assert.ok(decodeDatesIntakeImage({ ...body, image: { ...body.image, url: "https://cdn.example/flyer.jpg" } }, 1));
  // The corpus normalises the bytes to a placeholder (they depend on the encoder build), which is not a JPEG.
  assert.match(body.image.data_base64, /^<base64 of the JPEG/);
  assert.equal(datesIntakeImageBytes(read!), null);
  // DERIVED: the same receipt with real JPEG bytes in place of the placeholder.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
  const derived = decodeDatesIntakeImage({ ...body, image: { ...body.image, data_base64: jpeg.toString("base64") } }, 1)!;
  assert.deepEqual(Buffer.from(datesIntakeImageBytes(derived)!), jpeg);
  for (const bytes of [Buffer.from("<svg onload=alert(1)>"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("GIF89a")])
    assert.equal(datesIntakeImageBytes({ ...derived, image: { ...derived.image, data_base64: bytes.toString("base64") } }), null, "only a JPEG leaves the route");
});

// ---------------------------------------------------------------- the published event

test("genuine external list with an AI-assisted row carries the label on the row", () => {
  const body = fixture("admin-external-list-ai-assisted");
  assert.deepEqual(decodeDatesExternalList(body, { page: body.page, limit: body.limit }), body);
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].ai_assisted, true); assert.equal(Object.keys(body.events[0]).at(-1), "ai_assisted");
  // The row is the event the two AI-assisted details describe.
  assert.equal(body.events[0].external_event_id, fixture("admin-external-detail-ai-assisted").event.external_event_id);
  // The label, when served, is a strict boolean.
  for (const change of [{ ai_assisted: "true" }, { ai_assisted: 1 }, { ai_assisted: null }]) {
    const value = copy(body); Object.assign(value.events[0], change);
    assert.equal(decodeDatesExternalList(value, { page: body.page, limit: body.limit }), null, JSON.stringify(change));
  }
  // D-143: without the selector Core serves the released P1 row - no label at all. It decodes; absent reads as "not AI-assisted".
  const released = copy(body); delete released.events[0].ai_assisted;
  assert.deepEqual(decodeDatesExternalList(released, { page: body.page, limit: body.limit }), released);
  assert.equal(decodeDatesExternalList(released, { page: body.page, limit: body.limit })!.events[0].ai_assisted === true, false);
  // ... and a key this console does not know on a row is tolerated.
  const wider = copy(body); wider.events[0].intake = { intake_id: xin(5), channel: "admin_draft", event_index: 0 };
  assert.deepEqual(decodeDatesExternalList(wider, { page: body.page, limit: body.limit }), wider);
});
for (const name of ["member-credit", "auto-published"]) test(`genuine external detail ${name}: an event from a member's suggestion decodes whole, with the confirmations as they were given`, () => {
  const body = fixture(`admin-external-detail-${name}`), reviewed = name === "member-credit";
  assert.deepEqual(decodeDatesExternalDetail(body, body.event.external_event_id), body);
  assert.equal(body.event.intake.channel, "member_suggestion"); assert.equal(body.event.credit_channel, "member_suggestion"); assert.equal(body.event.ai_assisted, true);
  // A reviewer published the one; Core published the other by itself (the autopublish switch): it carries the tier
  // its evidence supports and no confirmation that nobody gave.
  assert.equal(body.event.verification_tier, reviewed ? "admin" : "single_source");
  assert.deepEqual(body.event.verification.admin_confirmations, { source: reviewed, public_venue: reviewed, timezone: reviewed, content_safe: reviewed });
  // Each confirmation is a boolean and all four are there.
  for (const change of [{ source: "yes" }, { source: null }, { content_safe: 1 }, { timezone: undefined }]) {
    const value = copy(body); value.event.verification.admin_confirmations = { ...body.event.verification.admin_confirmations, ...change };
    assert.equal(decodeDatesExternalDetail(value, body.event.external_event_id), null, JSON.stringify(change));
  }
});
test("genuine external detail of an event published from an intake: AI-assisted, its Places venue, and the intake it came from", () => {
  const body = fixture("admin-external-detail-ai-assisted");
  assert.deepEqual(decodeDatesExternalDetail(body, body.event.external_event_id), body);
  assert.equal(body.event.ai_assisted, true);
  assert.deepEqual([body.event.venue.resolved_by, body.event.venue.place_id], ["places", "ChIJ4-4EKkDcQUcRPGkz1ExWaWg"]);
  assert.equal(body.event.verification_tier, "admin"); assert.equal(body.event.credit_channel, "admin");
  // The event names the intake, its channel and which of the intake's events it was - and nothing else of it.
  assert.deepEqual(body.event.intake, { intake_id: xin(5), channel: "admin_draft", event_index: 0 });
  assert.equal(Object.keys(body.event).at(-1), "intake");
  assert.doesNotMatch(JSON.stringify(body), /provider|admin_principal|source_texts|openai|gemini/);
  // The reference is bound on its three fields, and it goes with the label: Core derives both from one ledger record.
  for (const change of [null, { intake_id: xin(5), channel: "admin_draft" },
    { intake_id: "xin_5", channel: "admin_draft", event_index: 0 }, { intake_id: xin(5), channel: "partner_feed", event_index: 0 },
    { intake_id: xin(5), channel: "admin_draft", event_index: -1 }, { intake_id: xin(5), channel: "admin_draft", event_index: "0" }]) {
    const value = copy(body); value.event.intake = change;
    assert.equal(decodeDatesExternalDetail(value, body.event.external_event_id), null, JSON.stringify(change));
  }
  const unlabelled = copy(body); unlabelled.event.ai_assisted = false;
  assert.equal(decodeDatesExternalDetail(unlabelled, body.event.external_event_id), null, "an intake reference on an event that is not AI-assisted");
  // D-143: a key Core might add to the reference is tolerated (the panel prints the three named fields only) ...
  const widened = copy(body); widened.event.intake = { ...body.event.intake, provider: "openai" };
  assert.deepEqual(decodeDatesExternalDetail(widened, body.event.external_event_id), widened);
  // ... and without the selector the reference is not served at all: the event still decodes, with no link back.
  const dropped = copy(body); delete dropped.event.intake;
  assert.deepEqual(decodeDatesExternalDetail(dropped, body.event.external_event_id), dropped);
  // DERIVED: the two channels P2b and P3 will write decode as references too.
  for (const channel of ["member_suggestion", "ai_research"]) {
    const value = copy(body); value.event.intake = { intake_id: xin(9), channel, event_index: 3 };
    assert.ok(decodeDatesExternalDetail(value, body.event.external_event_id), channel);
  }
  assert.ok(Object.values(body.event.editor_input.confirmations).every((value) => value === false));
  // A Places venue without its id, or a pin that claims one, is not Core's ledger.
  for (const change of [{ place_id: null }, { resolved_by: "admin_pin" }]) {
    const value = copy(body); Object.assign(value.event.venue, change);
    assert.equal(decodeDatesExternalDetail(value, body.event.external_event_id), null);
  }
});
test("genuine activity detail of an AI-assisted event binds the same ledger", () => {
  const body = fixture("admin-activity-detail-ai-assisted");
  const read = decodeDatesActivityOriginDetail(body, body.activity.activity_id, ["dates_external_event_read", "dates_external_event_manage"]);
  assert.deepEqual(read, { activity: body.activity, external: body.external_event });
  assert.equal(body.activity.ai_assisted, true); assert.equal(body.external_event.ai_assisted, true);
  // The embedded event carries the same reference as the external detail.
  assert.deepEqual(read!.external!.intake, { intake_id: xin(5), channel: "admin_draft", event_index: 0 });
  assert.deepEqual(body.external_event.intake, fixture("admin-external-detail-ai-assisted").event.intake);
  const value = copy(body); value.external_event.intake = null;
  assert.equal(decodeDatesActivityOriginDetail(value, body.activity.activity_id, ["dates_external_event_read", "dates_external_event_manage"]), null);
  // Review finding (T-885, 3f6eb526): the label is one ledger fact. An activity that says "not AI" beside an
  // intake-backed event - or the reverse - is contradictory provenance and is refused, whichever side is flipped.
  const caps = ["dates_external_event_read", "dates_external_event_manage"];
  const activityOff = copy(body); activityOff.activity.ai_assisted = false;
  assert.equal(decodeDatesActivityOriginDetail(activityOff, body.activity.activity_id, caps), null, "activity says manual, the event names its intake");
  // The nested event made self-consistently manual (no label, no reference) while the activity still says AI-assisted.
  const eventOff = copy(body); eventOff.external_event.ai_assisted = false; eventOff.external_event.intake = null;
  assert.equal(decodeDatesExternalDetail({ ...fixture("admin-external-detail-ai-assisted"), event: eventOff.external_event }, eventOff.external_event.external_event_id) !== null, true,
    "the nested event alone is a valid manual event, so only the cross-check can refuse the pair");
  assert.equal(decodeDatesActivityOriginDetail(eventOff, body.activity.activity_id, caps), null, "activity says AI-assisted, the event is manual");
  // The same check on a genuine manual pair: flipping the activity's label alone is refused.
  const manual = JSON.parse(readFileSync(new URL("./fixtures/dates_external_admin_wire/admin-activity-detail-external.json", import.meta.url), "utf8"));
  assert.ok(decodeDatesActivityOriginDetail(manual, manual.activity.activity_id, caps));
  const manualOn = copy(manual); manualOn.activity.ai_assisted = true;
  assert.equal(decodeDatesActivityOriginDetail(manualOn, manual.activity.activity_id, caps), null);
});
test("the two member bodies of the corpus are not the console's to decode", () => {
  for (const name of ["member-ai-assisted-detail", "member-ai-assisted-discover"]) {
    const body = fixture(name), text = JSON.stringify(body);
    assert.match(text, /"ai_assisted":true/);
    assert.doesNotMatch(text, /xin_|intake|place_id/);
    assert.equal(projectDatesIntakeDetail(body, xin(1)), null); assert.equal(projectDatesIntakeQueue(body, { page: 1, limit: 40 }), null);
  }
});
