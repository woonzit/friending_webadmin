import test from "node:test";
import assert from "node:assert/strict";
import { decodeResearchDefaults, decodeResearchOverview, decodeResearchRunList } from "../lib/datesResearchAdmin.ts";
import { normalizeDatesResearchProxyBody, researchDomainsValid } from "../lib/datesResearchProxy.ts";
import { decodeResearchCommandReceipt, prepareResearchCommand, runResearchCommand } from "../lib/datesResearchConsole.ts";
import { projectDatesAdminBody } from "../lib/datesAdminProjection.ts";
import { datesAdminResearchContractParams } from "../lib/datesAdminContract.ts";
import { DERIVED_OVERVIEW, DERIVED_ENVELOPE, GENUINE_AREA, GENUINE_DEFAULTS, GENUINE_RUN } from "./support/datesResearchCorpus.ts";

// DERIVED mutations of the genuine P3a models against the frozen P3b contract.
// These are NOT P3b provider captures; held d8e22071 is not adopted here.
const models = { openai: "derived-openai-model", gemini: "derived-gemini-model" };
const domain = { domain: "events.example.org", type: "official" as const };
const admission = { openai_admitted: true, openai_reason: null, gemini_admitted: false, gemini_reason: "unbounded_search_queries", pause: null };
const component = { monthly_checks: 2, monthly_cost_micro_usd: null, basis: "unmeasured", last_run_id: null, last_run_cost_micro_usd: null };
const overview = () => ({ ...structuredClone(DERIVED_OVERVIEW), defaults: { ...GENUINE_DEFAULTS, research_models: models, domains: [domain] },
  limits: { ...DERIVED_OVERVIEW.limits, domains: { min: 0, max: 100 } },
  research_model_options: { openai: [models.openai], gemini: [models.gemini] }, discovery_admission: admission,
  estimate: { ...DERIVED_OVERVIEW.estimate, area: component, source: { ...component, monthly_cost_micro_usd: 10, basis: "last_completed_run", last_run_id: GENUINE_RUN.run_id, last_run_cost_micro_usd: 5 } } });
test("DERIVED P3b: optional policy, admission and separate estimates decode without altering P3a fallback", () => {
  const old = decodeResearchOverview(DERIVED_OVERVIEW)!;
  assert.equal(Object.hasOwn(old, "discovery_admission"), false);
  const next = decodeResearchOverview(overview())!;
  assert.deepEqual(next.defaults!.research_models, models); assert.deepEqual(next.defaults!.domains!.rows, [domain]);
  assert.deepEqual(next.limits.domains, { min: 0, max: 100 });
  assert.deepEqual(next.discovery_admission, admission); assert.equal(next.estimate.area!.monthly_cost_micro_usd, null);
  assert.equal(next.estimate.source!.monthly_cost_micro_usd, 10); assert.equal(next.estimate.monthly_cost_micro_usd, null);
  const damaged: any = overview(); damaged.defaults.domains.push({ domain: "future.example.org", type: "future" });
  const partial = decodeResearchDefaults(damaged.defaults)!;
  assert.deepEqual(partial.domains!.rows, [domain]); assert.deepEqual(partial.domains!.unreadable, [{ index: 1, id: "future.example.org" }]);
  damaged.discovery_admission = { ...admission, pause: { reason: "future-pause", run_id: GENUINE_RUN.run_id, at: 10 } };
  assert.equal(decodeResearchOverview(damaged)!.discovery_admission, null, "only admission-dependent features become unavailable");
});
test("DERIVED P3b: additive domain limits do not become a stored-row ceiling or break legacy overview reads", () => {
  const body = overview(); body.defaults.domains = Array.from({ length: 101 }, (_, index) => ({ ...domain, domain: `events${index}.example.org` }));
  assert.equal(decodeResearchOverview(body)!.defaults!.domains!.rows.length, 101, "read all valid stored rows even above the current request limit");
  assert.equal(decodeResearchOverview(DERIVED_OVERVIEW)!.limits.domains, undefined);
  for (const range of [null, { min: -1, max: 100 }, { min: 0, max: 1.5 }, { min: 2, max: 1 }, { min: "0", max: 100 }]) {
    const decoded = decodeResearchOverview({ ...body, limits: { ...body.limits, domains: range } })!;
    assert.ok(decoded); assert.equal(decoded.limits.domains, null); assert.equal(decoded.defaults!.domains!.rows.length, 101);
  }
});
test("DERIVED P3b: selected projection keeps public policy/counts, never native queries or private state", () => {
  const body = overview(), extra: any = structuredClone(body);
  extra.defaults.members = [123]; extra.defaults.discovery_pause = { holder: "private" };
  extra.discovery_admission.pause = null; extra.discovery_admission.queries = ["private query"];
  extra.research_model_options.secret = "derived-private";
  assert.deepEqual(projectDatesAdminBody("dates_event_research_overview", extra), body);
  const run = { ...GENUINE_RUN, kind: "area", source_id: null, area_revision_before: 2, area_revision_after: 3,
    discovery_tool_usage: { requested_cap: 3, echoed_cap: 3, tool_items: 4, action_counts: { search: 4, open_page: 0, find_in_page: 0, unknown: 0 } } };
  const history = { ...DERIVED_ENVELOPE, runs: [run], next_cursor: null };
  const privateHistory = { ...history, runs: [{ ...run, work: { pages: "private" }, discovery_tool_usage: { ...run.discovery_tool_usage, queries: ["private"], raw_provider_body: {} } }] };
  assert.deepEqual(projectDatesAdminBody("dates_event_research_run_list", privateHistory), history);
  assert.deepEqual(decodeResearchRunList(history)!.rows[0].discovery_tool_usage, run.discovery_tool_usage, "above requested cap is not rejected by the consumer");
  const future = { ...run, status: "future" };
  assert.equal(decodeResearchRunList({ ...history, runs: [run, { ...future, run_id: "different" }] })!.unreadable.length, 1);
});
test("DERIVED P3b: policy saves are optional additions, domain validation is closed and ordinary Save cannot resume", () => {
  const values = { enabled: false, auto_cities_enabled: false, cadence_hours: 168, scope: { kind: "city", radius_km: null }, member_threshold: 5, target_events: 15, window_days: 30, autopublish: false };
  const request = { expected_revision: 0, values, reason: "Reviewed configuration", idempotency_key: "derived-research-key-0001" };
  assert.deepEqual(normalizeDatesResearchProxyBody("dates_event_research_defaults_save", request), request);
  const policy = { ...request, values: { ...values, research_models: models, domains: [domain] } };
  assert.deepEqual(normalizeDatesResearchProxyBody("dates_event_research_defaults_save", policy), policy);
  assert.equal(normalizeDatesResearchProxyBody("dates_event_research_defaults_save", { ...policy, values: { ...policy.values, resume_discovery: true } }), null);
  assert.equal(researchDomainsValid([{ domain: " EVENTS.EXAMPLE.ORG ", type: "blocked" }, domain]), false);
  for (const host of ["https://events.example.org", "events.example.org/path", "localhost", "bad_.example.org"])
    assert.equal(researchDomainsValid([{ ...domain, domain: host }]), false);
  assert.equal(researchDomainsValid([{ ...domain, type: "future" }]), false);
});
test("DERIVED P3b: area commands keep exact identity and bind historical/scheduled receipts to area, revision and mode", async () => {
  const command = prepareResearchCommand("admin@example.test", "dates_event_research_area_run_now", { area_id: GENUINE_AREA.area_id, expected_revision: 2, dry_run: false })!;
  const receipt = { ...DERIVED_ENVELOPE, replayed: true, audit_id: null, run_id: GENUINE_RUN.run_id, area_id: GENUINE_AREA.area_id, area_revision: 2, dry_run: false };
  assert.equal(decodeResearchCommandReceipt(command, receipt)?.kind, "success");
  const stale = prepareResearchCommand("admin@example.test", command.action, { area_id: GENUINE_AREA.area_id, expected_revision: 5, dry_run: false })!;
  assert.equal(decodeResearchCommandReceipt(stale, { ...receipt, area_revision: 7 })?.kind, "success", "explicit same-mode replay need not match the page revision");
  assert.equal(decodeResearchCommandReceipt(stale, { ...receipt, area_revision: 7, replayed: false, audit_id: "aud_derived" }), null, "a new intent must still advance its page revision exactly once");
  const replay = decodeResearchCommandReceipt(command, receipt)!; if (replay.kind === "success") assert.equal(replay.replayed, true);
  for (const change of [{ area_id: "foreign" }, { area_revision: 1 }, { dry_run: true }, { replayed: false }, { audit_id: "" }])
    assert.equal(decodeResearchCommandReceipt(command, { ...receipt, ...change }), null);
  const seen: unknown[] = [];
  const send = async (_action: string, body: unknown) => { seen.push(structuredClone(body)); if (seen.length === 1) throw new Error("derived timeout"); return receipt; };
  assert.equal((await runResearchCommand(send, command)).kind, "uncertain");
  assert.equal((await runResearchCommand(send, command)).kind, "success"); assert.deepEqual(seen[0], seen[1]);
  assert.deepEqual(datesAdminResearchContractParams(command.action), { dates_event_research_admin_contract_version: 1 });
});
test("DERIVED P3b: discovery resume requires its own audited defaults-revision receipt even with master OFF", () => {
  const command = prepareResearchCommand("admin@example.test", "dates_event_research_discovery_resume", { expected_revision: 0, reason: "Reviewed project limit and paused discovery" })!;
  assert.ok(command);
  const receipt = { ...DERIVED_ENVELOPE, replayed: false, audit_id: "aud_derived", defaults: { ...GENUINE_DEFAULTS, revision: 1 } };
  assert.equal(decodeResearchCommandReceipt(command, receipt)?.kind, "success");
  assert.equal(decodeResearchCommandReceipt(command, { ...receipt, audit_id: null, replayed: true }), null);
  assert.equal(decodeResearchCommandReceipt(command, { ...receipt, defaults: { ...receipt.defaults, revision: 2 } }), null);
  assert.equal(normalizeDatesResearchProxyBody(command.action, { ...command.body, resume_discovery: true }), null);
});
