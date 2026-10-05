import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeResearchOverview, decodeResearchRunList, decodeResearchRunDetail, decodeResearchBatchReceipt, DATES_RESEARCH_MODES, DATES_RESEARCH_NOT_RUNNING_REASONS,
  DATES_RESEARCH_ROBOTS_STATES, DATES_RESEARCH_SOURCE_TYPES, DATES_RESEARCH_RUN_STATUSES, DATES_RESEARCH_DROP_REASONS, DATES_RESEARCH_CANDIDATE_OUTCOMES } from "../lib/datesResearchAdmin.ts";
import { researchCost, researchDistanceUnit, researchDistanceToKm, researchDistanceFromKm, researchTimeFromHours, researchTimeToHours, researchEffective,
  researchEffectiveValues, researchRunningState, researchStock, researchMonthlyEstimate, researchEditsAfterConflict, researchValuesIssue } from "../lib/datesResearchView.ts";
import { normalizeDatesResearchProxyBody, datesResearchProxyCapabilityAuthorized } from "../lib/datesResearchProxy.ts";
import { prepareResearchCommand, runResearchCommand, readResearchOverview, decodeResearchCommandReceipt } from "../lib/datesResearchConsole.ts";
import { projectDatesAdminBody } from "../lib/datesAdminProjection.ts";
import { datesAdminResearchContractParams, withDatesAdminContract } from "../lib/datesAdminContract.ts";
import { normalizeDatesIntakeProxyBody, projectDatesIntakeQueue } from "../lib/datesIntakeAdmin.ts";
import { SELF_MADE_OVERVIEW, SELF_MADE_ENVELOPE, SELF_MADE_AREA, SELF_MADE_SOURCE, SELF_MADE_RUN, SELF_MADE_CANDIDATE,
  SELF_MADE_DEFAULTS, SELF_MADE_LIMITS } from "./support/datesResearchSELF_MADE.ts";

// Every body here is SELF-MADE. Genuine Core capture tests replace this support module in part 2.
const copy = <T>(value: T): T => structuredClone(value);
const actor = "operator@example.test", key = "research-test-request-0001";
const identity = { success: true, dates: { email: actor, role: "administrator", rank: 40, linked_uid: null, sensitive_location: false, break_glass: false,
  capabilities: ["dates_external_event_review", "dates_external_event_manage"] } };
const refusal = (error: string, status_code = 409) => ({ success: false, status_code, message: 200, status: 200, can_send: 0, error });
test("SELF-MADE: overview accepts extra keys, projects counts only and separates unreadable rows", () => {
  const input: any = copy(SELF_MADE_OVERVIEW); input.debug = { member_id: 100 }; input.areas[0].members = [{ uid: 100, latitude: 47 }]; input.areas[0].effective.future_value = true;
  const projected = projectDatesAdminBody("dates_event_research_overview", input);
  assert.deepEqual(projected, SELF_MADE_OVERVIEW);
  const read = decodeResearchOverview(projected)!;
  assert.equal(read.defaults!.revision, 0); assert.equal(read.areas.rows.length, 1); assert.equal(read.areas.unreadable.length, 0);
  assert.equal(read.sources.rows.length, 1); assert.equal(read.estimate.monthly_cost_micro_usd, null);
  for (const [field, bad] of [["mode", "future"], ["not_running_reason", "future"], ["scope", { kind: "future", radius_km: null }]] as const) {
    const damaged: any = copy(SELF_MADE_OVERVIEW); if (field === "scope") damaged.areas[0].effective.scope = bad; else damaged.areas[0][field] = bad;
    damaged.areas.push({ ...copy(SELF_MADE_AREA), area_id: "another-area" });
    const value = decodeResearchOverview(damaged)!; assert.equal(value.areas.rows.length, 1); assert.equal(value.areas.unreadable.length, 1); assert.equal(value.sources.rows.length, 1);
  }
});
test("SELF-MADE: all draft mode, stop-reason, source and robots vocabularies decode", () => {
  for (const mode of DATES_RESEARCH_MODES) { const value = copy(SELF_MADE_OVERVIEW); value.areas[0].mode = mode; assert.equal(decodeResearchOverview(value)!.areas.rows.length, 1); }
  for (const reason of DATES_RESEARCH_NOT_RUNNING_REASONS) { const value = copy(SELF_MADE_OVERVIEW); value.areas[0].not_running_reason = reason; assert.equal(decodeResearchOverview(value)!.areas.rows[0].not_running_reason, reason); }
  for (const type of DATES_RESEARCH_SOURCE_TYPES) { const value = copy(SELF_MADE_OVERVIEW); value.sources[0].type = type; assert.equal(decodeResearchOverview(value)!.sources.rows[0].type, type); }
  for (const state of DATES_RESEARCH_ROBOTS_STATES) { const value = copy(SELF_MADE_OVERVIEW); value.sources[0].robots.state = state; assert.equal(decodeResearchOverview(value)!.sources.rows[0].robots.state, state); }
});
test("SELF-MADE: duplicate identities and unknown source vocabularies affect only their rows", () => {
  const input: any = copy(SELF_MADE_OVERVIEW); input.areas.push(copy(input.areas[0])); input.sources.push({ ...copy(input.sources[0]), source_id: "other", type: "future" });
  const value = decodeResearchOverview(input)!; assert.equal(value.areas.rows.length, 0); assert.equal(value.areas.unreadable.length, 2); assert.equal(value.sources.rows.length, 1); assert.equal(value.sources.unreadable.length, 1);
  input.defaults.scope.kind = "future"; assert.equal(decodeResearchOverview(input)!.defaults, null);
});
test("SELF-MADE: server limits are not decoder storage ceilings and the editor uses the supplied limits", () => {
  const input = copy(SELF_MADE_OVERVIEW); input.areas[0].overrides.scope = { kind: "radius", radius_km: 159.999999999 }; input.areas[0].effective.scope = { kind: "radius", radius_km: 159.999999999 };
  input.limits.radius_km.max = 100; assert.equal(decodeResearchOverview(input)!.areas.rows.length, 1);
  assert.equal(researchValuesIssue(input.areas[0].effective, input.limits), "radius_km");
  input.limits.radius_km.max = 200; assert.equal(researchValuesIssue(input.areas[0].effective, input.limits), null);
});
test("SELF-MADE: history decodes every status and drop reason, a damaged run stays a single unavailable row", () => {
  for (const status of DATES_RESEARCH_RUN_STATUSES) assert.equal(decodeResearchRunList({ ...SELF_MADE_ENVELOPE, runs: [{ ...SELF_MADE_RUN, status }], next_cursor: null })!.rows[0].status, status);
  for (const reason of DATES_RESEARCH_DROP_REASONS) assert.equal(decodeResearchRunList({ ...SELF_MADE_ENVELOPE, runs: [{ ...SELF_MADE_RUN, dropped: [{ reason, count: 1 }] }], next_cursor: "opaque" })!.rows.length, 1);
  const value = decodeResearchRunList({ ...SELF_MADE_ENVELOPE, runs: [SELF_MADE_RUN, { ...SELF_MADE_RUN, run_id: "other", status: "future" }], next_cursor: null })!;
  assert.equal(value.rows.length, 1); assert.equal(value.unreadable.length, 1);
});
test("SELF-MADE: candidates degrade separately and every outcome is represented", () => {
  for (const outcome of DATES_RESEARCH_CANDIDATE_OUTCOMES) {
    const value = decodeResearchRunDetail({ ...SELF_MADE_ENVELOPE, run: { ...SELF_MADE_RUN, candidates: [{ ...SELF_MADE_CANDIDATE, outcome }, { ...SELF_MADE_CANDIDATE, outcome: "future" }] } }, SELF_MADE_RUN.run_id)!;
    assert.equal(value.candidates!.rows.length, 1); assert.equal(value.candidates!.unreadable.length, 1);
  }
  assert.equal(decodeResearchRunDetail({ ...SELF_MADE_ENVELOPE, run: { ...SELF_MADE_RUN, candidates: null } }, SELF_MADE_RUN.run_id)!.candidates, null);
  assert.equal(decodeResearchRunDetail({ ...SELF_MADE_ENVELOPE, run: SELF_MADE_RUN }, "wrong-run"), null);
});
test("effective values preserve false overrides and identify their source", () => {
  const defaults = { ...SELF_MADE_DEFAULTS, autopublish: true }, overrides = { ...SELF_MADE_AREA.overrides, autopublish: false, cadence_hours: 12 };
  assert.deepEqual(researchEffective(defaults, overrides, "autopublish"), { value: false, source: "own" });
  assert.deepEqual(researchEffective(defaults, overrides, "window_days"), { value: 30, source: "global" });
  assert.equal(researchEffectiveValues(defaults, overrides).cadence_hours, 12);
});
test("miles and days are display conversions, including fractional values and untouched precision", () => {
  assert.equal(researchDistanceUnit("US"), "mi"); assert.equal(researchDistanceUnit("gb"), "mi"); assert.equal(researchDistanceUnit("HU"), "km");
  for (const km of [1, 1.609344, 17.123456789, 160]) assert.ok(Math.abs(researchDistanceToKm(researchDistanceFromKm(km, "mi"), "mi") - km) < 1e-12);
  assert.equal(researchTimeFromHours(6, "days"), .25); assert.equal(researchTimeToHours(.25, "days"), 6);
  const source = readFileSync(new URL("../components/DatesResearchControls.tsx", import.meta.url), "utf8");
  assert.match(source, /onChange=\{\(event\) => setUnit\(event\.target\.value as ResearchTimeUnit\)\}/);
  assert.match(source, /onChange=\{\(event\) => onUnit\(event\.target\.value as ResearchDistanceUnit\)\}/);
});
test("stock and estimate distinguish met stock, zero spend and not measured", () => {
  assert.deepEqual(researchStock(20, 15), { upcoming: 20, target: 15, missing: 0, met: true, share: 1 });
  assert.equal(researchMonthlyEstimate(SELF_MADE_OVERVIEW.estimate, SELF_MADE_OVERVIEW.budget).measured, false);
  assert.equal(researchMonthlyEstimate({ ...SELF_MADE_OVERVIEW.estimate, monthly_cost_micro_usd: 0 }, SELF_MADE_OVERVIEW.budget).measured, true);
  assert.match(researchCost(1234567, "en"), /1\.2346/);
});
test("running-state preview obeys master, mode, section, budget, auto-city and threshold gates", () => {
  const defaults = { enabled: true, auto_cities_enabled: true }, area = { mode: "auto" as const, member_count: 5 }, values = SELF_MADE_AREA.effective;
  assert.deepEqual(researchRunningState(defaults, area, values, true, false), { running: true, reason: null });
  assert.equal(researchRunningState({ ...defaults, enabled: false }, { ...area, mode: "off" }, values, false, true).reason, "research_off");
  assert.equal(researchRunningState(defaults, { ...area, mode: "off" }, values, false, true).reason, "mode_off");
  assert.equal(researchRunningState(defaults, area, values, false, true).reason, "section_unavailable");
  assert.equal(researchRunningState(defaults, area, values, true, true).reason, "budget_paused");
  assert.equal(researchRunningState({ ...defaults, auto_cities_enabled: false }, { ...area, member_count: 0 }, values, true, false).reason, "auto_cities_off");
  assert.equal(researchRunningState(defaults, { ...area, member_count: 4 }, values, true, false).reason, "below_threshold");
  assert.deepEqual(researchRunningState({ ...defaults, auto_cities_enabled: false }, { mode: "on", member_count: 0 }, values, true, false), { running: true, reason: null });
});
test("revision conflict keeps changed fields over fresh authority, including independent city overrides", () => {
  const before = { label: "Old", mode: "auto", overrides: { ...SELF_MADE_AREA.overrides, target_events: 15 } };
  const draft = copy(before); draft.overrides.target_events = 19;
  const stored = { ...copy(before), label: "Fresh", mode: "on", overrides: { ...before.overrides, cadence_hours: 48 } };
  assert.deepEqual(researchEditsAfterConflict(before, draft, stored), { ...stored, overrides: { ...stored.overrides, target_events: 19 } });
  const inherited = { overrides: { target_events: null as number | null, cadence_hours: null as number | null } };
  const invalid = { overrides: { target_events: NaN, cadence_hours: null } };
  const fresh = { overrides: { target_events: 17, cadence_hours: 48 } };
  const kept = researchEditsAfterConflict(inherited, invalid, fresh);
  assert.equal(Number.isNaN(kept.overrides.target_events), true, "an erased own value is not mistaken for unchanged inheritance");
  assert.equal(kept.overrides.cadence_hours, 48);
});
test("research selector is added by the server and cannot change existing request selectors", () => {
  assert.deepEqual(datesAdminResearchContractParams("dates_configuration"), {});
  assert.deepEqual(datesAdminResearchContractParams("dates_event_intake_list"), {});
  const params = withDatesAdminContract("dates_event_research_overview", { dates_event_research_admin_contract_version: 99 });
  assert.equal(params.dates_event_research_admin_contract_version, 1); assert.equal(params.dates_event_intake_admin_contract_version, 1);
  assert.equal(withDatesAdminContract("dates_event_intake_list", { research_run_id: "run" }).dates_event_research_admin_contract_version, 1);
  assert.equal(normalizeDatesResearchProxyBody("dates_event_research_overview", { dates_event_research_admin_contract_version: 99 }), null);
});
test("research proxy refuses client identity, geometry and wrong capabilities", () => {
  assert.equal(datesResearchProxyCapabilityAuthorized("dates_event_research_overview", identity), true);
  assert.equal(datesResearchProxyCapabilityAuthorized("dates_event_research_defaults_save", { ...identity, dates: { ...identity.dates, capabilities: ["dates_external_event_review"] } }), false);
  const body = { place_id: "place", mode: "auto", overrides: SELF_MADE_AREA.overrides, reason: "Reviewed", idempotency_key: key };
  assert.ok(normalizeDatesResearchProxyBody("dates_event_research_area_save", body));
  for (const extra of [{ center: { latitude: 0, longitude: 0 } }, { country_code: "US" }, { admin_email: actor }, { secret: "not-a-secret" }])
    assert.equal(normalizeDatesResearchProxyBody("dates_event_research_area_save", { ...body, ...extra }), null);
});
test("SELF-MADE: same command, key and revision survive all unknown outcomes until a bound receipt", async () => {
  const command = prepareResearchCommand(actor, "dates_event_research_source_run_now", { source_id: SELF_MADE_SOURCE.source_id, expected_revision: 1, dry_run: true })!;
  const seen: Record<string, unknown>[] = [], answers: unknown[] = [null, refusal("dates-admin-command-in-progress"), { success: false, status_code: 504, error: "core-timeout" }, { success: true },
    { ...SELF_MADE_ENVELOPE, replayed: true, audit_id: "aud_self_made", source_id: SELF_MADE_SOURCE.source_id, source_revision: 2, dry_run: true, run_id: SELF_MADE_RUN.run_id }];
  const send = async (_action: string, body: Record<string, unknown>) => { seen.push(copy(body)); return answers.shift(); };
  for (let i = 0; i < 4; i++) assert.equal((await runResearchCommand(send, command)).kind, "uncertain");
  assert.equal((await runResearchCommand(send, command)).kind, "success");
  assert.equal(new Set(seen.map((body) => body.idempotency_key)).size, 1); assert.ok(seen.every((body) => body.expected_revision === 1 && body.dry_run === true));
  assert.equal(decodeResearchCommandReceipt(command, { ...SELF_MADE_ENVELOPE, replayed: true, audit_id: "aud_self_made", source_id: "wrong", source_revision: 2, dry_run: true, run_id: SELF_MADE_RUN.run_id }), null);
});
test("SELF-MADE: Core without research yields one unavailable state; transport failure stays unknown", async () => {
  assert.equal((await readResearchOverview(async (action) => action === "admin_me" ? identity : refusal("not-found", 404))).kind, "unavailable");
  assert.equal((await readResearchOverview(async (action) => action === "admin_me" ? identity : null)).kind, "unconfirmed");
  assert.equal((await readResearchOverview(async (action) => action === "admin_me" ? identity : SELF_MADE_OVERVIEW)).kind, "ready");
});
test("SELF-MADE: batch results are bound to every chosen intake and mixed refusal is not a page failure", () => {
  const ids = ["xin_" + "1".repeat(32), "xin_" + "2".repeat(32)];
  const body = { ...SELF_MADE_ENVELOPE, results: [{ intake_id: ids[0], outcome: "published", refusal: null, external_event_id: "xev_test" }, { intake_id: ids[1], outcome: "refused", refusal: "stale", external_event_id: null }] };
  assert.equal(decodeResearchBatchReceipt(body, ids, "publish")!.length, 2);
  assert.equal(decodeResearchBatchReceipt({ ...body, results: [body.results[0], body.results[0]] }, ids, "publish"), null);
  assert.equal(decodeResearchBatchReceipt(body, ids, "reject"), null);
  const request = { intake_ids: ids, expected_revisions: { [ids[0]]: 2, [ids[1]]: 3 }, action: "publish", confirmations: { source: true, public_venue: true, timezone: true, content_safe: true }, reason: "Reviewed both", idempotency_key: key };
  assert.ok(normalizeDatesResearchProxyBody("dates_event_intake_batch_decide", request));
  assert.equal(normalizeDatesResearchProxyBody("dates_event_intake_batch_decide", { ...request, expected_revisions: { [ids[0]]: 2 } }), null);
});
test("research run filter and additive queue row preserve the released queue shape", () => {
  const input: any = JSON.parse(readFileSync(new URL("./fixtures/dates_event_intake_admin_wire/admin-list-in-review.json", import.meta.url), "utf8"));
  const before = projectDatesIntakeQueue(input, { page: input.page, limit: input.limit })!;
  assert.equal(Object.hasOwn(before.intakes[0], "research_run_id"), false);
  input.intakes[0].research_run_id = SELF_MADE_RUN.run_id;
  assert.equal(projectDatesIntakeQueue(input, { page: input.page, limit: input.limit })!.intakes[0].research_run_id, SELF_MADE_RUN.run_id);
  assert.deepEqual(normalizeDatesIntakeProxyBody("dates_event_intake_list", { page: 1, limit: 40, research_run_id: SELF_MADE_RUN.run_id }), { page: 1, limit: 40, research_run_id: SELF_MADE_RUN.run_id });
});
