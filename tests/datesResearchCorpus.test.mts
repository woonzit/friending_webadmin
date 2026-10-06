import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { decodeResearchArea, decodeResearchBatchReceipt, decodeResearchDefaults, decodeResearchOverview, decodeResearchRunDetail, decodeResearchRunList, decodeResearchSource,
  DATES_RESEARCH_MODES, DATES_RESEARCH_SCOPE_KINDS, DATES_RESEARCH_SOURCE_TYPES, DATES_RESEARCH_NOT_RUNNING_REASONS,
  DATES_RESEARCH_ROBOTS_STATES, DATES_RESEARCH_RUN_KINDS, DATES_RESEARCH_RUN_TRIGGERS, DATES_RESEARCH_RUN_STATUSES,
  DATES_RESEARCH_CANDIDATE_OUTCOMES, DATES_RESEARCH_DROP_REASONS, DATES_RESEARCH_BATCH_OUTCOMES } from "../lib/datesResearchAdmin.ts";
import { projectDatesAdminBody } from "../lib/datesAdminProjection.ts";
import { datesIntakeRefusal, projectDatesIntakeQueue } from "../lib/datesIntakeAdmin.ts";
import { decodeResearchCommandReceipt, prepareResearchCommand, runResearchCommand } from "../lib/datesResearchConsole.ts";
import { researchDefaultValues, researchRunningState, researchStock } from "../lib/datesResearchView.ts";
import { GENUINE_AREA, GENUINE_DEFAULTS, researchFixture } from "./support/datesResearchCorpus.ts";

const directory = new URL("./fixtures/dates_event_research_admin_wire/", import.meta.url);
const bytes = (file: string) => readFileSync(new URL(file, directory));
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const manifest = JSON.parse(bytes("manifest.json").toString());
const pin = JSON.parse(readFileSync(new URL("./support/datesResearchProviderPin.json", import.meta.url), "utf8"));
const fixtures: { file: string; body: any; status_code: number; sha256: string }[] = manifest.fixtures.map((entry: any) => ({ ...entry, body: JSON.parse(bytes(entry.file).toString()) }));
// Payloads identify their selected action. Refusal filenames identify their
// originating route; common boundary refusals share the same envelope.
function route(file: string, body: any): string {
  if (body.intakes || file.startsWith("admin-intake-list-")) return "dates_event_intake_list";
  if (body.results || file.startsWith("admin-batch-")) return "dates_event_intake_batch_decide";
  if (body.runs || file.startsWith("admin-run-list-")) return "dates_event_research_run_list";
  if (typeof body.run_id === "string" || file.startsWith("admin-source-run-")) return "dates_event_research_source_run_now";
  if (body.run || file.startsWith("admin-run-")) return "dates_event_research_run_detail";
  if (body.areas || file.startsWith("admin-overview-") || file.startsWith("admin-read-")) return "dates_event_research_overview";
  if (body.area || file.startsWith("admin-area-") || file.startsWith("admin-client-geometry-") || file.startsWith("admin-place-")) return "dates_event_research_area_save";
  if (body.source || file.startsWith("admin-source-") || file.startsWith("admin-aggregator-")) return "dates_event_research_source_save";
  return "dates_event_research_defaults_save";
}
test("genuine research pin: immutable manifest, complete inventory and every body hash match the independent consumer pin", () => {
  assert.equal(hash(bytes("manifest.json")), pin.manifest_sha256);
  for (const key of ["contract", "source_commit", "source_checksum", "fixture_count", "fixture_set_sha256"]) assert.equal(manifest[key], pin[key], key);
  assert.equal(manifest.provenance.generator_sha256, pin.generator_sha256);
  assert.equal(fixtures.length, pin.fixture_count);
  assert.deepEqual(readdirSync(directory).sort(), ["manifest.json", ...fixtures.map((entry) => entry.file)].sort());
  assert.equal(hash(fixtures.map((entry) => `${entry.file}\0${entry.sha256}`).join("\n")), pin.fixture_set_sha256);
  for (const entry of fixtures) assert.equal(hash(bytes(entry.file)), entry.sha256, entry.file);
  assert.match(manifest.provenance.transport, /Real loopback HTTP POSTs/);
  assert.ok(manifest.provenance.provider_boundary.includes("synthetic self-made data"), "genuine HTTP projection is not claimed as genuine geocoding/AI evidence");
});
for (const { file, body, status_code } of fixtures) test(`GENUINE research body: ${file}`, () => {
  assert.equal(body.status_code, status_code);
  assert.deepEqual(projectDatesAdminBody(route(file, body), body), body, "no named genuine field is lost by the production bridge projection");
  if (body.success === false) {
    assert.deepEqual(datesIntakeRefusal(body), { kind: "core", error: body.error, status: body.status_code });
    if (body.current) {
      const decode = body.current.source_id ? decodeResearchSource : body.current.area_id ? decodeResearchArea : decodeResearchDefaults;
      assert.ok(decode(body.current), "authoritative conflict row decodes");
    }
    return;
  }
  if (body.runs) {
    const value = decodeResearchRunList(body)!; assert.ok(value);
    assert.equal(value.unreadable.length, 0); assert.equal(value.rows.length, body.runs.length);
    assert.equal(value.next_cursor, body.next_cursor); return;
  }
  if (body.run) {
    const value = decodeResearchRunDetail(body, body.run.run_id)!; assert.ok(value);
    assert.ok(value.candidates); assert.equal(value.candidates.unreadable.length, 0);
    assert.equal(value.candidates.rows.length, body.run.candidates.length); return;
  }
  if (body.intakes) {
    const value = projectDatesIntakeQueue(body, { page: body.page, limit: body.limit })!; assert.ok(value);
    assert.equal(value.unreadable_rows.length, 0); assert.equal(value.intakes.length, body.intakes.length);
    for (const row of value.intakes) {
      assert.deepEqual(row.lease, body.intakes.find((raw: any) => raw.intake_id === row.intake_id).lease);
      assert.equal(row.research_run_id, body.intakes.find((raw: any) => raw.intake_id === row.intake_id).research_run_id);
    }
    return;
  }
  if (body.results) {
    const ids = body.results.map((row: any) => row.intake_id);
    assert.deepEqual(decodeResearchBatchReceipt(body, ids), body.results); return;
  }
  if (body.run_id) {
    // DERIVED matching input for this unchanged genuine receipt: decoding and
    // echoed identity, not a claim about the capture's original request.
    const command = prepareResearchCommand("admin@example.test", "dates_event_research_source_run_now", {
      source_id: body.source_id, expected_revision: body.source_revision - 1, dry_run: body.dry_run,
    });
    assert.ok(command); assert.equal(decodeResearchCommandReceipt(command!, body)?.kind, "success"); return;
  }
  if (body.areas) {
    const value = decodeResearchOverview(body)!; assert.ok(value); assert.ok(value.defaults);
    assert.equal(value.areas.unreadable.length, 0); assert.equal(value.sources.unreadable.length, 0);
    assert.equal(value.areas.rows.length, body.areas.length); assert.equal(value.sources.rows.length, body.sources.length);
    for (const area of value.areas.rows) {
      assert.deepEqual(researchRunningState(value.defaults!, area, area.effective, area.not_running_reason !== "section_unavailable", value.budget.research_paused),
        { running: area.running, reason: area.not_running_reason }, "running preview agrees with Core's genuine stored/count/budget state");
      assert.equal(researchStock(area.stock.upcoming, area.stock.target).missing, area.stock.missing);
    }
    for (const source of value.sources.rows) assert.equal(researchStock(source.stock.upcoming, source.stock.max).missing, source.stock.missing);
  } else {
    const row = body.defaults ? decodeResearchDefaults(body.defaults) : body.area ? decodeResearchArea(body.area) : decodeResearchSource(body.source);
    assert.ok(row);
    const action = route(file, body) as "dates_event_research_defaults_save" | "dates_event_research_area_save" | "dates_event_research_source_save";
    const request = body.defaults ? { expected_revision: row.revision - 1, values: { ...researchDefaultValues(body.defaults), enabled: body.defaults.enabled, auto_cities_enabled: body.defaults.auto_cities_enabled } }
      : body.area ? { ...(body.area.revision === 1 ? { place_id: body.area.place_id } : { area_id: body.area.area_id, expected_revision: body.area.revision - 1 }), mode: body.area.mode, overrides: body.area.overrides }
        : Object.fromEntries(["url", "label", "type", "area_id", "cadence_hours", "max_events", "window_days", "autopublish", "enabled", "archived"].map((key) => [key, body.source[key]]));
    if (body.source && body.source.revision !== 1) Object.assign(request, { source_id: body.source.source_id, expected_revision: body.source.revision - 1 });
    const command = prepareResearchCommand("admin@example.test", action, { ...request, reason: "Derived request for genuine receipt decoding" });
    assert.ok(command); assert.equal(decodeResearchCommandReceipt(command!, body)?.kind, "success", "unchanged genuine receipt binds to its row/revision");
  }
});
test("genuine pinned vocabulary coverage is observed, not inferred from declarations; pending stages are explicit", () => {
  const expected = { mode: DATES_RESEARCH_MODES, scope_kind: DATES_RESEARCH_SCOPE_KINDS, source_type: DATES_RESEARCH_SOURCE_TYPES,
    not_running_reason: DATES_RESEARCH_NOT_RUNNING_REASONS, robots_state: DATES_RESEARCH_ROBOTS_STATES, run_trigger: DATES_RESEARCH_RUN_TRIGGERS,
    run_status: DATES_RESEARCH_RUN_STATUSES, candidate_outcome: DATES_RESEARCH_CANDIDATE_OUTCOMES, drop_reason: DATES_RESEARCH_DROP_REASONS,
    run_kind: DATES_RESEARCH_RUN_KINDS, batch_outcome: DATES_RESEARCH_BATCH_OUTCOMES };
  for (const [key, values] of Object.entries(expected)) {
    if (key !== "run_kind" && (key !== "batch_outcome" || manifest.vocabularies.batch_outcome))
      assert.deepEqual([...manifest.vocabularies[key]].sort(), [...values].sort(), key);
  }
  assert.deepEqual(manifest.vocabularies.run_kind.filter((kind: string) => kind !== "area"), [...DATES_RESEARCH_RUN_KINDS]);
  const stage = pin.coverage_stage ?? "part_a";
  assert.equal(manifest.coverage.stage, stage); assert.ok(manifest.coverage.pending_p3b.length);
  if (stage === "part_a") assert.equal(manifest.coverage.pending_part_b.length, 3);
  else {
    assert.equal(stage, "p3a_final"); assert.deepEqual(manifest.coverage.pending_part_b, []);
    for (const [key, values] of Object.entries(expected)) assert.deepEqual([...manifest.coverage.covered_values[key]].sort(), [...values].sort(), key);
  }
  const observed: Record<string, Set<string>> = Object.fromEntries(Object.keys(manifest.coverage.covered_values).map((key) => [key, new Set<string>()]));
  const add = (key: string, value: string | null | undefined) => { if (value != null) observed[key]?.add(value); };
  const scope = (row: any) => { if (row?.scope) add("scope_kind", row.scope.kind); };
  const area = (row: any) => { add("mode", row.mode); add("not_running_reason", row.not_running_reason); scope(row.overrides); scope(row.effective); };
  const source = (row: any) => { add("source_type", row.type); add("robots_state", row.robots.state); };
  const run = (row: any) => {
    add("run_kind", row.kind); add("run_trigger", row.trigger); add("run_status", row.status);
    for (const entry of row.dropped) add("drop_reason", entry.reason);
    for (const candidate of row.candidates ?? []) { add("candidate_outcome", candidate.outcome); add("drop_reason", candidate.reason); }
  };
  for (const { body } of fixtures) {
    if (!body.success) continue;
    scope(body.defaults); if (body.area) area(body.area); for (const row of body.areas ?? []) area(row);
    if (body.source) source(body.source); for (const row of body.sources ?? []) source(row);
    if (body.run) run(body.run); for (const row of body.runs ?? []) run(row);
    for (const row of body.results ?? []) add("batch_outcome", row.outcome);
  }
  for (const [key, values] of Object.entries(observed)) assert.deepEqual([...values].sort(), [...manifest.coverage.covered_values[key]].sort(), key);
});
test("genuine conflict is a definite conflict; verified no-write validation refuses while capability, revoked and key-reuse retain identity", async () => {
  const command = prepareResearchCommand("admin@example.test", "dates_event_research_defaults_save", {
    expected_revision: 0, values: { ...researchDefaultValues(GENUINE_DEFAULTS), enabled: false, auto_cities_enabled: false }, reason: "Reviewed defaults",
  })!;
  assert.equal((await runResearchCommand(async () => researchFixture("admin-defaults-stale-denied.json"), command)).kind, "conflict");
  for (const name of ["admin-values-denied.json", "admin-key-denied.json", "admin-reason-denied.json", "admin-source-url-denied.json", "admin-query-denied.json"])
    assert.equal((await runResearchCommand(async () => researchFixture(name), command)).kind, "refused", name);
  for (const name of ["admin-write-capability-denied.json", "admin-revoked-denied.json", "admin-key-reuse-denied.json", "admin-secret-denied.json"])
    assert.equal((await runResearchCommand(async () => researchFixture(name), command)).kind, "uncertain", name);
  const unexpectedStatus = { ...researchFixture("admin-values-denied.json"), status_code: 409 };
  assert.equal((await runResearchCommand(async () => unexpectedStatus, command)).kind, "uncertain", "a familiar token at an unverified status is not proof of no write");
});
test("GENUINE place-unavailable 503 is a definite pre-transaction refusal, not a generic server failure", async () => {
  const command = prepareResearchCommand("admin@example.test", "dates_event_research_area_save", {
    place_id: "derived_city", mode: "auto", overrides: GENUINE_AREA.overrides, reason: "Choose a city with usable boundaries",
  })!;
  const body = researchFixture("admin-place-unavailable-denied.json");
  assert.equal(body.status_code, 503);
  assert.deepEqual(await runResearchCommand(async () => body, command), { kind: "refused", error: "dates-research-place-unavailable" });
  for (const change of [{ error: "server-unavailable" }, { status_code: 500 }, { status_code: 504 }])
    assert.equal((await runResearchCommand(async () => ({ ...body, ...change }), command)).kind, "uncertain");
});
test("GENUINE FINAL no-write witnesses settle source gates and top-level batch validation, never child or authority refusals", async () => {
  const queued = researchFixture("admin-source-dry-queued.json");
  const source = prepareResearchCommand("admin@example.test", "dates_event_research_source_run_now", {
    source_id: queued.source_id, expected_revision: 1, dry_run: true,
  })!;
  const mixed = researchFixture("admin-batch-publish-mixed.json"), queue = researchFixture("admin-intake-list-run-populated.json");
  const ids = mixed.results.map((row: any) => row.intake_id);
  const batch = prepareResearchCommand("admin@example.test", "dates_event_intake_batch_decide", {
    intake_ids: ids, expected_revisions: Object.fromEntries(queue.intakes.map((row: any) => [row.intake_id, row.revision])),
    action: "publish", reason: "Reviewed actual facts-only worker drafts.",
    confirmations: { source: true, public_venue: true, timezone: true, content_safe: true },
  })!;
  // Classification of unchanged genuine responses. The invalid original
  // requests cannot be prepared by our validating consumer. Core's pinned
  // generator snapshots all research, intake, receipt and audit rows around
  // each of these top-level refusals; no database mutation is claimed here.
  for (const [command, names] of [[source, ["admin-source-run-disabled-denied.json", "admin-source-run-archived-real-denied.json",
    "admin-source-run-archived-preview-denied.json", "admin-source-run-master-off-real-denied.json", "admin-source-run-master-off-preview-denied.json"]],
  [batch, ["admin-batch-ids-denied.json", "admin-batch-revisions-denied.json", "admin-batch-nested-revision-denied.json",
    "admin-batch-action-denied.json", "admin-batch-confirmations-denied.json"]]] as const) {
    for (const name of names) {
      const body = researchFixture(name);
      assert.deepEqual(await runResearchCommand(async () => body, command), { kind: "refused", error: body.error }, name);
      const wrongStatus = { ...body, status_code: body.status_code === 409 ? 422 : 409 };
      assert.equal((await runResearchCommand(async () => wrongStatus, command)).kind, "uncertain", `${name}: status is part of the proof`);
    }
  }
  for (const name of ["admin-batch-key-reuse-denied.json", "admin-batch-write-capability-denied.json", "admin-batch-selector-denied.json"])
    assert.equal((await runResearchCommand(async () => researchFixture(name), batch)).kind, "uncertain", name);
  const child = researchFixture("admin-batch-row-revision-refused.json");
  const id = child.results[0].intake_id;
  const single = prepareResearchCommand("admin@example.test", "dates_event_intake_batch_decide", {
    ...batch.body, intake_ids: [id], expected_revisions: { [id]: 1 },
  })!;
  assert.equal((await runResearchCommand(async () => child, single)).kind, "success", "a committed per-child refusal is a successful batch receipt");
});
test("GENUINE permanent source receipts bind the original generation and open alias after later completions", async () => {
  const queued = researchFixture("admin-source-dry-queued.json");
  // Original valid request values are in the pinned capturePartB generator;
  // only the opaque key is consumer-minted, never inferred from a newer row.
  for (const [expected_revision, names] of [[1, ["admin-source-run-same-key-replay.json", "admin-source-run-completed-same-key-replay.json",
    "admin-source-run-completed-new-key-replay.json"]], [2, ["admin-source-run-open-new-key-replay.json", "admin-source-run-open-alias-completed-replay.json"]]] as const) {
    const command = prepareResearchCommand("admin@example.test", "dates_event_research_source_run_now", {
      source_id: queued.source_id, expected_revision, dry_run: true,
    })!;
    for (const name of names) {
      const body = researchFixture(name), result = decodeResearchCommandReceipt(command, body);
      assert.equal(result?.kind, "success", name); assert.equal(body.run_id, queued.run_id);
      assert.equal(body.source_revision, queued.source_revision); assert.equal(body.replayed, true);
    }
  }
  const command = prepareResearchCommand("admin@example.test", "dates_event_research_source_run_now", {
    source_id: queued.source_id, expected_revision: 1, dry_run: true,
  })!;
  const requests: unknown[] = [];
  const send = async (_action: string, body: unknown) => {
    requests.push(structuredClone(body)); if (requests.length === 1) throw new Error("DERIVED lost response");
    return researchFixture("admin-source-run-completed-same-key-replay.json");
  };
  assert.equal((await runResearchCommand(send, command)).kind, "uncertain");
  const settled = await runResearchCommand(send, command);
  assert.equal(settled.kind, "success"); if (settled.kind === "success") assert.equal(settled.runId, queued.run_id);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal((await runResearchCommand(async () => researchFixture("admin-source-run-stale-other-admin-denied.json"), command)).kind, "conflict");
  const fresh = researchFixture("admin-source-run-next-dry-intent-queued.json");
  assert.notEqual(fresh.run_id, queued.run_id); assert.equal(fresh.replayed, false);
  assert.equal(decodeResearchCommandReceipt(command, fresh), null, "an old command cannot adopt a fresh generation");
  assert.equal(decodeResearchCommandReceipt(prepareResearchCommand("admin@example.test", command.action, {
    source_id: fresh.source_id, expected_revision: 9, dry_run: true,
  })!, fresh)?.kind, "success");
});
test("GENUINE scheduled and master-OFF replay receipts settle without creating another intent", () => {
  for (const [name, expected_revision] of [["admin-source-run-scheduled-open-replay.json", 2],
    ["admin-source-run-scheduled-alias-completed-replay.json", 2], ["admin-source-run-master-off-open-replay.json", 2],
    ["admin-source-run-master-off-historical-replay.json", 1]] as const) {
    const body = researchFixture(name);
    const command = prepareResearchCommand("admin@example.test", "dates_event_research_source_run_now", {
      source_id: body.source_id, expected_revision, dry_run: body.dry_run,
    })!;
    assert.equal(decodeResearchCommandReceipt(command, body)?.kind, "success", name);
    assert.equal(body.replayed, true);
    if (name.includes("scheduled")) assert.equal(body.audit_id, null);
  }
  const scheduled = researchFixture("admin-source-run-scheduled-open-replay.json");
  const next = researchFixture("admin-source-run-next-scheduled-intent-queued.json");
  assert.notEqual(next.run_id, scheduled.run_id); assert.equal(next.replayed, false); assert.ok(next.audit_id);
  assert.equal(decodeResearchCommandReceipt(prepareResearchCommand("admin@example.test", "dates_event_research_source_run_now", {
    source_id: next.source_id, expected_revision: 3, dry_run: false,
  })!, next)?.kind, "success");
});
test("GENUINE batch mixed results, permanent replay and opposite terminal requests retain actual outcomes and leases", () => {
  const queueBody = researchFixture("admin-intake-list-run-populated.json");
  const queue = projectDatesIntakeQueue(queueBody, { page: queueBody.page, limit: queueBody.limit })!;
  const mixed = researchFixture("admin-batch-publish-mixed.json"), ids = mixed.results.map((row: any) => row.intake_id);
  const command = prepareResearchCommand("admin@example.test", "dates_event_intake_batch_decide", {
    intake_ids: ids, expected_revisions: Object.fromEntries(queue.intakes.map((row) => [row.intake_id, row.revision])),
    action: "publish", reason: "Reviewed actual facts-only worker drafts.",
    confirmations: { source: true, public_venue: true, timezone: true, content_safe: true },
  })!;
  assert.equal(queue.total, 3); assert.ok(queue.intakes.every((row) => row.lease.active && row.lease.mine));
  assert.deepEqual(mixed.results.map((row: any) => row.refusal), [null, "dates-research-organizer-unverified", "dates-research-price-unverified"]);
  for (const name of ["admin-batch-publish-mixed.json", "admin-batch-same-key-replay.json", "admin-batch-new-key-replay.json"]) {
    const body = researchFixture(name), receipt = decodeResearchCommandReceipt(command, body);
    assert.equal(receipt?.kind, "success"); if (receipt?.kind === "success") assert.deepEqual(receipt.results, mixed.results);
    assert.equal(Object.hasOwn(body, "audit_id"), false, "Core audits children, not a parent");
  }
  for (const [name, action, outcome] of [["admin-batch-opposite-returns-published.json", "reject", "published"],
    ["admin-batch-opposite-returns-rejected.json", "publish", "rejected"]] as const) {
    const body = researchFixture(name), id = body.results[0].intake_id;
    const opposite = prepareResearchCommand("admin@example.test", command.action, {
      intake_ids: [id], expected_revisions: { [id]: 1 }, action, reason: "Opposite-action lost-response retry.",
      ...(action === "reject" ? { reason_code: "not_an_event" } : { confirmations: command.body.confirmations }),
    })!;
    const receipt = decodeResearchCommandReceipt(opposite, body);
    assert.equal(receipt?.kind, "success"); if (receipt?.kind === "success") assert.equal(receipt.results![0].outcome, outcome);
  }
  const afterBody = researchFixture("admin-intake-list-run-after-decisions.json");
  const after = projectDatesIntakeQueue(afterBody, { page: afterBody.page, limit: afterBody.limit })!;
  for (const row of after.intakes) {
    assert.equal(row.research_run_id, queue.intakes[0].research_run_id);
    if (row.status === "published" || row.status === "rejected") assert.equal(row.lease.active, false);
    else assert.equal(row.lease.mine, true, "sparse undecided intake retains its reviewer hold");
  }
});
test("GENUINE history pagination, dry-run candidates and selected intake filtering remain exact", () => {
  const pages = ["admin-run-list-page-one.json", "admin-run-list-page-two.json", "admin-run-list-page-last.json"].map(researchFixture);
  const rows = pages.flatMap((body) => decodeResearchRunList(body)!.rows);
  assert.equal(rows.length, 3); assert.equal(new Set(rows.map((row) => row.run_id)).size, 3);
  assert.ok(rows.every((row) => row.source_id === rows[0].source_id));
  assert.ok(pages[0].next_cursor && pages[1].next_cursor); assert.equal(pages[2].next_cursor, null);
  assert.ok(rows[0].started_at! > rows[1].started_at! && rows[1].started_at! > rows[2].started_at!);
  const dryBody = researchFixture("admin-run-dry-completed.json"), dry = decodeResearchRunDetail(dryBody, dryBody.run.run_id)!;
  assert.equal(dry.run.dry_run, true); assert.equal(dry.run.imported, 0);
  assert.deepEqual(dry.candidates!.rows.map((row) => row.outcome), ["would_import", "dropped", "dropped", "dropped"]);
  assert.ok(dry.candidates!.rows.every((row) => row.intake_id === null));
  assert.equal(dryBody.run.source_revision_after, dryBody.run.source_revision_before + 1);
  const emptyBody = researchFixture("admin-intake-list-run-empty.json");
  const empty = projectDatesIntakeQueue(emptyBody, { page: emptyBody.page, limit: emptyBody.limit })!;
  assert.equal(empty.total, 0); assert.deepEqual(empty.intakes, []);
});
test("DERIVED conflict projection keeps only the selected public row, and no arbitrary refusal current block", () => {
  const body = researchFixture("admin-defaults-stale-denied.json"), changed = structuredClone(body);
  changed.current.members = [{ uid: 123 }]; changed.current.secret = "derived-not-a-secret";
  assert.deepEqual(projectDatesAdminBody("dates_event_research_defaults_save", changed), body);
  assert.equal(Object.hasOwn(projectDatesAdminBody("dates_configuration_save", body) as object, "current"), false);
  assert.equal(Object.hasOwn(projectDatesAdminBody("dates_event_research_defaults_save", { ...changed, error: "future-refusal" }) as object, "current"), false);
});
