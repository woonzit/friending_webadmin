import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, useLocale, useTranslations, createTranslator } from "next-intl";
import vm from "node:vm";
import ts from "typescript";
import * as research from "../lib/datesResearchAdmin.ts";
import { projectDatesAdminBody } from "../lib/datesAdminProjection.ts";
import { datesIntakeRefusal, projectDatesIntakeQueue } from "../lib/datesIntakeAdmin.ts";
import { decodeResearchCommandReceipt, prepareResearchCommand, runResearchCommand } from "../lib/datesResearchConsole.ts";
import { researchDefaultValues, researchCost } from "../lib/datesResearchView.ts";
import { formatDate, formatNumber } from "../lib/format.ts";
import { ResearchAreaRunButtons, ResearchDiscoveryAdmissionPanel, ResearchDomainEditor, ResearchEstimateComponents } from "../components/DatesResearchDiscovery.tsx";
import { P3B_EMPTY_OVERVIEW, P3B_MANIFEST as manifest, p3bResearchFixture as fixture } from "./support/datesResearchP3bCorpus.ts";

const directory = new URL("./fixtures/dates_event_research_p3b_admin_wire/", import.meta.url);
const bytes = (file: string) => readFileSync(new URL(file, directory));
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const pin = JSON.parse(readFileSync(new URL("./support/datesResearchP3bProviderPin.json", import.meta.url), "utf8"));
const fixtures: { file: string; body: any; sha256: string; status_code: number }[] = manifest.fixtures.map((entry: any) => ({ ...entry, body: fixture(entry.file) }));
function route(file: string, body: any): research.DatesResearchAction | "dates_event_intake_list" {
  if (body.intakes || file.startsWith("admin-intake-list-")) return "dates_event_intake_list";
  if (body.results || file.startsWith("admin-batch-")) return "dates_event_intake_batch_decide";
  if (body.runs || file.startsWith("admin-run-list-")) return "dates_event_research_run_list";
  if (body.run) return "dates_event_research_run_detail";
  if (body.run_id) return body.area_id ? "dates_event_research_area_run_now" : "dates_event_research_source_run_now";
  if (file.startsWith("admin-discovery-resume-")) return "dates_event_research_discovery_resume";
  if (file.startsWith("admin-area-run-")) return "dates_event_research_area_run_now";
  if (file.startsWith("admin-source-run-")) return "dates_event_research_source_run_now";
  if (body.areas || file.startsWith("admin-overview-") || file.startsWith("admin-read-")) return "dates_event_research_overview";
  if (body.area || file.startsWith("admin-area-") || file.startsWith("admin-client-geometry-") || file.startsWith("admin-place-")) return "dates_event_research_area_save";
  if (body.source || file.startsWith("admin-source-") || file.startsWith("admin-aggregator-")) return "dates_event_research_source_save";
  return "dates_event_research_defaults_save";
}
test("GENUINE accepted P3b pin: complete 200-body inventory, independent manifest/source/generator/set hashes", () => {
  assert.equal(pin.provider_commit, "5f03015b57c516285b76f2d1a8d3f7f26f16b1a6");
  assert.equal(hash(bytes("manifest.json")), pin.manifest_sha256);
  for (const key of ["contract", "source_commit", "source_checksum", "fixture_count", "fixture_set_sha256"]) assert.equal(manifest[key], pin[key], key);
  assert.equal(manifest.provenance.generator_sha256, pin.generator_sha256);
  assert.equal(fixtures.length, 200); assert.deepEqual(readdirSync(directory).sort(), ["manifest.json", ...fixtures.map(entry => entry.file)].sort());
  for (const entry of fixtures) assert.equal(hash(bytes(entry.file)), entry.sha256, entry.file);
  assert.equal(hash(fixtures.map(entry => `${entry.file}\0${entry.sha256}`).join("\n")), pin.fixture_set_sha256);
  assert.match(manifest.provenance.transport, /Real loopback HTTP POSTs/);
  assert.ok(manifest.provenance.provider_boundary.includes("synthetic self-made data"), "HTTP provenance is not live geocoding/provider evidence");
});
for (const { file, body, status_code } of fixtures) test(`GENUINE P3b production projection/decoder: ${file}`, () => {
  const action = route(file, body);
  assert.equal(body.status_code, status_code); assert.deepEqual(projectDatesAdminBody(action, body), body, "no served named field is lost");
  if (body.success === false) {
    assert.deepEqual(datesIntakeRefusal(body), { kind: "core", error: body.error, status: body.status_code });
    if (body.current) assert.ok((body.current.source_id ? research.decodeResearchSource : body.current.area_id ? research.decodeResearchArea : research.decodeResearchDefaults)(body.current));
    return;
  }
  if (body.runs) {
    const read = research.decodeResearchRunList(body)!; assert.ok(read); assert.equal(read.unreadable.length, 0); assert.equal(read.rows.length, body.runs.length);
    for (const row of read.rows) assert.deepEqual(row.discovery_tool_usage, body.runs.find((raw: any) => raw.run_id === row.run_id).discovery_tool_usage);
    return;
  }
  if (body.run) {
    const read = research.decodeResearchRunDetail(body, body.run.run_id)!; assert.ok(read); assert.ok(read.candidates);
    assert.equal(read.candidates.unreadable.length, 0); assert.equal(read.candidates.rows.length, body.run.candidates.length);
    assert.deepEqual(read.run.discovery_tool_usage, body.run.discovery_tool_usage); return;
  }
  if (body.intakes) {
    const read = projectDatesIntakeQueue(body, { page: body.page, limit: body.limit })!; assert.ok(read); assert.equal(read.unreadable_rows.length, 0);
    assert.equal(read.intakes.length, body.intakes.length); return;
  }
  if (body.results) { assert.deepEqual(research.decodeResearchBatchReceipt(body, body.results.map((row: any) => row.intake_id)), body.results); return; }
  if (body.areas) {
    const read = research.decodeResearchOverview(body)!; assert.ok(read); assert.ok(read.defaults);
    assert.equal(read.areas.unreadable.length, 0); assert.equal(read.sources.unreadable.length, 0);
    assert.equal(read.areas.rows.length, body.areas.length); assert.equal(read.sources.rows.length, body.sources.length);
    assert.deepEqual(read.discovery_admission, body.discovery_admission); assert.deepEqual(read.research_model_options, body.research_model_options);
    assert.deepEqual(read.limits.domains, body.limits.domains); assert.deepEqual(read.estimate, body.estimate); return;
  }
  // DERIVED matching input for an UNCHANGED genuine receipt. This proves
  // consumer binding, not a claim about the capture's original request.
  let request: Record<string, unknown>;
  if (body.run_id) request = body.area_id ? { area_id: body.area_id, expected_revision: body.area_revision - 1, dry_run: body.dry_run }
    : { source_id: body.source_id, expected_revision: body.source_revision - 1, dry_run: body.dry_run };
  else if (body.defaults) {
    assert.ok(research.decodeResearchDefaults(body.defaults));
    request = action === "dates_event_research_discovery_resume" ? { expected_revision: body.defaults.revision - 1 }
      : { expected_revision: body.defaults.revision - 1, values: { ...researchDefaultValues(body.defaults), enabled: body.defaults.enabled, auto_cities_enabled: body.defaults.auto_cities_enabled,
        research_models: body.defaults.research_models, domains: body.defaults.domains } };
  } else if (body.area) {
    assert.ok(research.decodeResearchArea(body.area)); request = { ...(body.area.revision === 1 ? { place_id: body.area.place_id } : { area_id: body.area.area_id, expected_revision: body.area.revision - 1 }), mode: body.area.mode, overrides: body.area.overrides };
  } else {
    assert.ok(research.decodeResearchSource(body.source)); request = Object.fromEntries(["url", "label", "type", "area_id", "cadence_hours", "max_events", "window_days", "autopublish", "enabled", "archived"].map(key => [key, body.source[key]]));
    if (body.source.revision !== 1) Object.assign(request, { source_id: body.source.source_id, expected_revision: body.source.revision - 1 });
  }
  const command = prepareResearchCommand("admin@example.test", action as research.DatesResearchAction, { ...request,
    ...(!body.run_id ? { reason: "Derived matching input for genuine receipt" } : {}) });
  assert.ok(command, file); assert.equal(decodeResearchCommandReceipt(command, body)?.kind, "success", file);
});
test("GENUINE P3b vocabulary: every declared closed value is observed in captures, not only a manifest claim", () => {
  assert.equal(manifest.coverage.stage, "p3b_final"); assert.deepEqual(manifest.coverage.pending_part_b, []); assert.deepEqual(manifest.coverage.pending_p3b, []);
  const declared: Record<string, readonly string[]> = { mode: research.DATES_RESEARCH_MODES, scope_kind: research.DATES_RESEARCH_SCOPE_KINDS, source_type: research.DATES_RESEARCH_SOURCE_TYPES,
    not_running_reason: research.DATES_RESEARCH_NOT_RUNNING_REASONS, robots_state: research.DATES_RESEARCH_ROBOTS_STATES, run_kind: research.DATES_RESEARCH_RUN_KINDS,
    run_trigger: research.DATES_RESEARCH_RUN_TRIGGERS, run_status: research.DATES_RESEARCH_RUN_STATUSES, candidate_outcome: research.DATES_RESEARCH_CANDIDATE_OUTCOMES,
    drop_reason: research.DATES_RESEARCH_DROP_REASONS, batch_outcome: research.DATES_RESEARCH_BATCH_OUTCOMES };
  const observed = Object.fromEntries(Object.keys(declared).map(key => [key, new Set<string>()]));
  const add = (key: string, value: string | null | undefined) => { if (value != null) observed[key].add(value); };
  const scope = (row: any) => { if (row?.scope) add("scope_kind", row.scope.kind); };
  const area = (row: any) => { add("mode", row.mode); add("not_running_reason", row.not_running_reason); scope(row.overrides); scope(row.effective); };
  const source = (row: any) => { add("source_type", row.type); add("robots_state", row.robots.state); };
  const run = (row: any) => { add("run_kind", row.kind); add("run_trigger", row.trigger); add("run_status", row.status);
    for (const item of row.dropped) add("drop_reason", item.reason); for (const item of row.candidates ?? []) { add("candidate_outcome", item.outcome); add("drop_reason", item.reason); } };
  for (const { body } of fixtures.filter(entry => entry.body.success === true)) {
    scope(body.defaults); if (body.area) area(body.area); for (const row of body.areas ?? []) area(row);
    if (body.source) source(body.source); for (const row of body.sources ?? []) source(row);
    if (body.run) run(body.run); for (const row of body.runs ?? []) run(row); for (const row of body.results ?? []) add("batch_outcome", row.outcome);
  }
  for (const [key, values] of Object.entries(declared)) { assert.deepEqual([...observed[key]].sort(), [...values].sort(), key); assert.deepEqual([...observed[key]].sort(), [...manifest.coverage.covered_values[key]].sort(), key); }
});
test("GENUINE virtual revision-zero defaults: empty policy remains usable; OFF and unmeasured are not invented failures/zero cost", () => {
  const read = P3B_EMPTY_OVERVIEW; assert.ok(read); assert.equal(read.defaults!.revision, 0); assert.deepEqual(read.defaults!.domains!.rows, []);
  assert.deepEqual(read.limits.domains, { min: 0, max: 100 }); assert.equal(read.defaults!.enabled, false); assert.equal(read.defaults!.auto_cities_enabled, false);
  assert.equal(read.areas.rows.length, 0); assert.equal(read.sources.rows.length, 0); assert.equal(read.estimate.monthly_cost_micro_usd, null);
  assert.equal(read.estimate.area!.monthly_cost_micro_usd, null); assert.equal(read.estimate.source!.monthly_cost_micro_usd, null);
  assert.equal(read.discovery_admission!.gemini_admitted, false); assert.equal(read.discovery_admission!.gemini_reason, "unbounded_search_queries");
});
test("GENUINE area historical/open/scheduled aliases keep IDs, mode, revision and nullable scheduled audit; the body is retried unchanged", async () => {
  for (const mode of ["dry", "real"]) {
    const queued = fixture(`admin-area-run-${mode}-queued.json`), command = prepareResearchCommand("admin@example.test", "dates_event_research_area_run_now",
      { area_id: queued.area_id, expected_revision: queued.area_revision - 1, dry_run: queued.dry_run })!;
    for (const suffix of ["same-key-replay", "open-new-key-replay", "completed-new-key-replay", "master-off-historical-replay"]) {
      const replay = fixture(`admin-area-run-${mode}-${suffix}.json`); assert.equal(replay.replayed, true);
      assert.equal(decodeResearchCommandReceipt(command, replay)?.kind, "success"); assert.equal(replay.run_id, queued.run_id);
    }
    const seen: unknown[] = []; const send = async (_action: string, body: unknown) => { seen.push(structuredClone(body)); if (seen.length === 1) throw new Error("DERIVED lost reply"); return queued; };
    assert.equal((await runResearchCommand(send, command)).kind, "uncertain"); assert.equal((await runResearchCommand(send, command)).kind, "success"); assert.deepEqual(seen[0], seen[1]);
  }
  const scheduled = fixture("admin-area-run-scheduled-open-replay.json"); assert.equal(scheduled.audit_id, null); assert.equal(scheduled.replayed, true);
});
test("GENUINE pause/resume: both reasons are exposed, OFF resume is audited, same/new-key receipts remain identical", () => {
  for (const reason of ["reservation-exceeded", "tool-bound-exceeded"]) {
    const before = research.decodeResearchOverview(fixture(`admin-overview-discovery-${reason}.json`))!;
    assert.equal(before.discovery_admission!.openai_admitted, false); assert.equal(before.discovery_admission!.pause!.reason, reason.replaceAll("-", "_"));
    const receipt = fixture(`admin-discovery-resume-${reason}.json`); assert.equal(receipt.defaults.enabled, false); assert.ok(receipt.audit_id);
    const command = prepareResearchCommand("admin@example.test", "dates_event_research_discovery_resume", { expected_revision: receipt.defaults.revision - 1, reason: "Reviewed hard project limit" })!;
    for (const suffix of ["", "-same-key-replay", "-new-key-replay"]) {
      const answer = fixture(`admin-discovery-resume-${reason}${suffix}.json`); assert.equal(decodeResearchCommandReceipt(command, answer)?.kind, "success");
      assert.deepEqual(answer.defaults, receipt.defaults); assert.equal(answer.audit_id, receipt.audit_id);
    }
    const stale = fixture(`admin-discovery-resume-${reason}-stale-denied.json`); assert.equal(stale.error, "dates-research-conflict"); assert.ok(research.decodeResearchDefaults(stale.current));
  }
});
test("GENUINE P3b refusal settlement: transactional area/resume refusals settle; required-data/model validation and authority failures retain identity", async () => {
  const queued = fixture("admin-area-run-real-queued.json"), area = prepareResearchCommand("admin@example.test", "dates_event_research_area_run_now",
    { area_id: queued.area_id, expected_revision: queued.area_revision - 1, dry_run: false })!;
  for (const file of ["admin-area-run-paused-reservation-exceeded.json", "admin-area-run-paused-tool-bound-exceeded.json"]) {
    assert.deepEqual(await runResearchCommand(async () => fixture(file), area), { kind: "refused", error: "dates-research-area-disabled" });
  }
  const resume = prepareResearchCommand("admin@example.test", "dates_event_research_discovery_resume", { expected_revision: 0, reason: "Reviewed admission" })!;
  assert.deepEqual(await runResearchCommand(async () => fixture("admin-discovery-resume-not-paused.json"), resume), { kind: "refused", error: "dates-research-discovery-not-paused" });
  const stale = await runResearchCommand(async () => fixture("admin-discovery-resume-tool-bound-exceeded-stale-denied.json"), resume);
  assert.equal(stale.kind, "conflict"); if (stale.kind === "conflict") assert.equal(stale.cause, "revision");
  for (const file of ["admin-defaults-domain-type-denied.json", "admin-defaults-research-model-denied.json", "admin-area-run-real-capability-denied.json",
    "admin-discovery-resume-tool-bound-exceeded-capability-denied.json", "admin-revoked-denied.json", "admin-key-reuse-denied.json"]) {
    assert.equal((await runResearchCommand(async () => fixture(file), file.includes("area-run") ? area : resume)).kind, "uncertain", file);
  }
});
for (const locale of ["en", "hu"]) test(`GENUINE-input static P3b render ${locale}: revision-zero policy, pause/resume, unmeasured components and no Gemini discovery`, () => {
  const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")), errors: string[] = [];
  const read = P3B_EMPTY_OVERVIEW, props = { actor: "admin@example.test", manage: true, reload: async () => {} };
  const paused = research.decodeResearchOverview(fixture("admin-overview-discovery-tool-bound-exceeded.json"))!;
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages, timeZone: "UTC", onError: error => errors.push(String(error)) },
    createElement(ResearchDomainEditor, { ...props, defaults: read.defaults!, options: read.research_model_options, limits: read.limits }),
    createElement(ResearchEstimateComponents, { estimate: read.estimate, onRun: () => {} }),
    createElement(ResearchDiscoveryAdmissionPanel, { ...props, admission: paused.discovery_admission!, defaults: paused.defaults }),
    createElement(ResearchAreaRunButtons, { row: paused.areas.rows[0], defaults: paused.defaults, admission: paused.discovery_admission, manage: true,
      command: { busy: false, retained: false } as any })));
  assert.deepEqual(errors, []); assert.ok(html.includes("gpt-6.1-sol")); assert.ok(html.includes("gemini-3.8-flash"));
  const escaped = (text: string) => text.replaceAll("&", "&amp;").replaceAll("'", "&#x27;");
  for (const text of [messages.datesAdmin.research.discovery.geminiUnavailable, messages.datesAdmin.research.discovery.resume,
    messages.datesAdmin.research.discovery.pauseReasons.tool_bound_exceeded, messages.datesAdmin.research.notMeasured]) assert.ok(html.includes(escaped(text)));
  assert.equal(html.includes(escaped(messages.datesAdmin.research.discovery.policyUnavailable)), false); assert.match(html, /type="button"[^>]*disabled=""/);
});
for (const locale of ["en", "hu"]) test(`GENUINE-input / DERIVED hook adapter ${locale}: area history/detail displays requested cap and each actual action count, never raw provider data`, () => {
  const body = fixture("admin-area-run-real-completed.json"), detail = research.decodeResearchRunDetail(body, body.run.run_id)!;
  const list = research.decodeResearchRunList(fixture("admin-area-run-real-history.json"))!;
  const slots = ["", "", "", null, [], list, false, false, detail.run.run_id, detail, false, false]; let index = 0;
  const path = "../components/DatesResearchRuns.tsx", source = readFileSync(new URL(path, import.meta.url), "utf8"), tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const context: any = { exports: {}, React, useLocale, useTranslations, formatDate, formatNumber, researchCost,
    DATES_RESEARCH_RUN_KINDS: research.DATES_RESEARCH_RUN_KINDS, useState: () => [slots[index++], () => assert.fail("static render changes no state")],
    useRef: (value: unknown) => ({ current: value }), useCallback: (fn: unknown) => fn, useEffect: () => {},
    Link: ({ href, children }: any) => createElement("a", { href }, children), ResearchHelp: () => null, ErrorPanel: () => null, LoadingPanel: () => null,
    readResearchRun: () => assert.fail("no automatic request during static render"), readResearchRuns: () => assert.fail("no automatic request during static render") };
  const code = tree.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(tree)).join("\n");
  vm.runInNewContext(ts.transpileModule(code, { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
  const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")), errors: string[] = [];
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages, timeZone: "UTC", onError: error => errors.push(String(error)) },
    createElement(context.exports.default, { areas: [], sources: [], focusRunId: null, refresh: 0 })));
  assert.deepEqual(errors, []); assert.equal(index, slots.length);
  const usage = detail.run.discovery_tool_usage!, t = createTranslator({ locale, messages });
  const text = t("datesAdmin.research.discovery.toolUsage", { requested: usage.requested_cap, echoed: usage.echoed_cap === null ? t("datesAdmin.research.discovery.notReported") : formatNumber(usage.echoed_cap, locale),
    total: usage.tool_items, search: usage.action_counts.search, open: usage.action_counts.open_page, find: usage.action_counts.find_in_page, unknown: usage.action_counts.unknown });
  assert.ok(html.includes(text.replaceAll("&", "&amp;").replaceAll("'", "&#x27;")), "all actual per-action counts and requested/echoed caps are displayed");
  assert.ok(html.includes(t("datesAdmin.research.runKinds.area"))); assert.ok(html.includes(detail.run.run_id));
  assert.doesNotMatch(html, /raw_provider|discovery_work|search_queries/);
});
