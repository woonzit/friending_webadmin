import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { decodeResearchArea, decodeResearchDefaults, decodeResearchOverview, decodeResearchSource,
  DATES_RESEARCH_MODES, DATES_RESEARCH_SCOPE_KINDS, DATES_RESEARCH_SOURCE_TYPES, DATES_RESEARCH_NOT_RUNNING_REASONS,
  DATES_RESEARCH_ROBOTS_STATES, DATES_RESEARCH_RUN_KINDS, DATES_RESEARCH_RUN_TRIGGERS, DATES_RESEARCH_RUN_STATUSES,
  DATES_RESEARCH_CANDIDATE_OUTCOMES, DATES_RESEARCH_DROP_REASONS } from "../lib/datesResearchAdmin.ts";
import { projectDatesAdminBody } from "../lib/datesAdminProjection.ts";
import { datesIntakeRefusal } from "../lib/datesIntakeAdmin.ts";
import { decodeResearchCommandReceipt, prepareResearchCommand, runResearchCommand } from "../lib/datesResearchConsole.ts";
import { researchDefaultValues, researchRunningState, researchStock } from "../lib/datesResearchView.ts";
import { GENUINE_DEFAULTS, researchFixture } from "./support/datesResearchCorpus.ts";

const directory = new URL("./fixtures/dates_event_research_admin_wire/", import.meta.url);
const bytes = (file: string) => readFileSync(new URL(file, directory));
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const manifest = JSON.parse(bytes("manifest.json").toString());
const pin = JSON.parse(readFileSync(new URL("./support/datesResearchProviderPin.json", import.meta.url), "utf8"));
const fixtures: { file: string; body: any; status_code: number; sha256: string }[] = manifest.fixtures.map((entry: any) => ({ ...entry, body: JSON.parse(bytes(entry.file).toString()) }));
// Part A captures four selected routes. Refusals without a payload use the
// defaults save's identical refusal envelope; current rows identify their save.
function route(file: string, body: any): string {
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
    if (body.current) assert.ok(decodeResearchDefaults(body.current), "authoritative conflict row decodes");
    return;
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
test("genuine Part A vocabulary coverage is observed, not inferred from declarations; Part B is explicitly pending", () => {
  const expected = { mode: DATES_RESEARCH_MODES, scope_kind: DATES_RESEARCH_SCOPE_KINDS, source_type: DATES_RESEARCH_SOURCE_TYPES,
    not_running_reason: DATES_RESEARCH_NOT_RUNNING_REASONS, robots_state: DATES_RESEARCH_ROBOTS_STATES, run_trigger: DATES_RESEARCH_RUN_TRIGGERS,
    run_status: DATES_RESEARCH_RUN_STATUSES, candidate_outcome: DATES_RESEARCH_CANDIDATE_OUTCOMES, drop_reason: DATES_RESEARCH_DROP_REASONS };
  for (const [key, values] of Object.entries(expected)) assert.deepEqual([...manifest.vocabularies[key]].sort(), [...values].sort(), key);
  assert.deepEqual(manifest.vocabularies.run_kind.filter((kind: string) => kind !== "area"), [...DATES_RESEARCH_RUN_KINDS]);
  assert.equal(manifest.coverage.stage, "part_a"); assert.equal(manifest.coverage.pending_part_b.length, 3); assert.ok(manifest.coverage.pending_p3b.length);
  const observed: Record<string, Set<string>> = Object.fromEntries(Object.keys(manifest.coverage.covered_values).map((key) => [key, new Set<string>()]));
  const scope = (row: any) => { if (row?.scope) observed.scope_kind.add(row.scope.kind); };
  const area = (row: any) => { observed.mode.add(row.mode); if (row.not_running_reason) observed.not_running_reason.add(row.not_running_reason); scope(row.overrides); scope(row.effective); };
  const source = (row: any) => { observed.source_type.add(row.type); observed.robots_state.add(row.robots.state); };
  for (const { body } of fixtures) {
    if (!body.success) continue;
    scope(body.defaults); if (body.area) area(body.area); for (const row of body.areas ?? []) area(row);
    if (body.source) source(body.source); for (const row of body.sources ?? []) source(row);
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
test("DERIVED conflict projection keeps only the selected public row, and no arbitrary refusal current block", () => {
  const body = researchFixture("admin-defaults-stale-denied.json"), changed = structuredClone(body);
  changed.current.members = [{ uid: 123 }]; changed.current.secret = "derived-not-a-secret";
  assert.deepEqual(projectDatesAdminBody("dates_event_research_defaults_save", changed), body);
  assert.equal(Object.hasOwn(projectDatesAdminBody("dates_configuration_save", body) as object, "current"), false);
  assert.equal(Object.hasOwn(projectDatesAdminBody("dates_event_research_defaults_save", { ...changed, error: "future-refusal" }) as object, "current"), false);
});
