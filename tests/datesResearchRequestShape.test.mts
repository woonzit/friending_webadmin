import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as actions from "../lib/adminActions.ts";
import { adminBridgeCoreTransportError } from "../lib/adminBridge.ts";
import { datesAvailabilityWriteIsRetired } from "../lib/datesAdmin.ts";
import { withDatesAdminContract } from "../lib/datesAdminContract.ts";
import { isDatesAdminRoute, projectDatesAdminResponse } from "../lib/datesAdminProjection.ts";
import { datesIntakeProxyCapabilityAuthorized, normalizeDatesIntakeProxyBody } from "../lib/datesIntakeAdmin.ts";
import { datesResearchProxyCapabilityAuthorized, normalizeDatesResearchProxyBody } from "../lib/datesResearchProxy.ts";
import { isTrustedAdminRequest } from "../lib/requestGuard.ts";
import { GENUINE_AREA, GENUINE_DEFAULTS, DERIVED_ENVELOPE, DERIVED_OVERVIEW, DERIVED_RUN, GENUINE_SOURCE } from "./support/datesResearchCorpus.ts";

// The production JSON bridge -> coreCall -> fetch form bytes. No provider or
// socket is reached. Response substitutions/missing Part B branches are DERIVED,
// not provider captures; datesResearchCorpus.test.mts checks the unchanged corpus.
const empty = "data:text/javascript,";
type NextResolve = (specifier: string, context: unknown) => unknown;
const modules = nodeModule as unknown as { registerHooks?: (hooks: { resolve: (specifier: string, context: unknown, next: NextResolve) => unknown }) => void; register?: (specifier: string, parent: string) => void };
if (modules.registerHooks) modules.registerHooks({ resolve(specifier, context, next) { return specifier === "server-only" ? { url: empty, shortCircuit: true, format: "module" } : next(specifier, context); } });
else if (modules.register) modules.register("data:text/javascript," + encodeURIComponent(`export function resolve(s,c,n){return s === "server-only" ? {url:${JSON.stringify(empty)},shortCircuit:true,format:"module"}:n(s,c)}`), import.meta.url);
else throw new Error("module resolution hook unavailable");
const fakeSecret = "test-research-api-secret-000000000000";
process.env.WEBADMIN_API_SECRET = fakeSecret; process.env.CORE_API_BASE = "https://core.invalid";
const { coreCall, mergeCoreParams } = await import("../lib/core.ts");
const actor = "operator@example.test", key = "research-wire-test-command-0001";
const member = { success: true, role: "admin", dates: { email: actor, role: "administrator", rank: 40, linked_uid: null, sensitive_location: false, break_glass: false,
  capabilities: ["dates_external_event_review", "dates_external_event_manage"] } };
const source = readFileSync(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
const bodyCode = tree.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(tree)).join("\n");
const code = ts.transpileModule(bodyCode, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
async function bridge(action: string, browser: unknown, answer: unknown = DERIVED_ENVELOPE, identity: unknown = member) {
  const fetchBefore = globalThis.fetch, sent: { url: string; form: URLSearchParams; headers: Headers; cache: RequestCache | undefined }[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (String(input).endsWith("/admin_me")) return { status: 200, json: async () => identity } as Response;
    assert.equal(typeof init?.body, "string");
    sent.push({ url: String(input), form: new URLSearchParams(init?.body as string), headers: new Headers(init?.headers), cache: init?.cache });
    return { status: 200, json: async () => answer } as Response;
  }) as typeof globalThis.fetch;
  try {
    const context: any = { exports: {}, Buffer, JSON, ...actions, isTrustedAdminRequest, adminBridgeCoreTransportError, datesAvailabilityWriteIsRetired, withDatesAdminContract,
      isDatesAdminRoute, projectDatesAdminResponse, datesIntakeProxyCapabilityAuthorized, normalizeDatesIntakeProxyBody, datesResearchProxyCapabilityAuthorized, normalizeDatesResearchProxyBody,
      ADMIN_GRANTED_VERIFICATION_CONTRACT_READY: true, readAdminSession: async () => ({ email: actor }), coreCall, mergeCoreParams,
      NextResponse: { json: (value: unknown, options: ResponseInit) => new Response(JSON.stringify(value), { ...options, headers: { ...options.headers, "Content-Type": "application/json" } }) } };
    for (const node of tree.statements) {
      if (!ts.isImportDeclaration(node) || !node.importClause?.namedBindings || !ts.isNamedImports(node.importClause.namedBindings)) continue;
      for (const item of node.importClause.namedBindings.elements) {
        const name = item.name.text; if (context[name] !== undefined || name === "NextRequest") continue;
        assert.match(name, /^(normalize|[A-Za-z]+(?:Authorized|RetryAuthorized))/, `unreviewed route dependency ${name}`); context[name] = () => undefined;
      }
    }
    vm.runInNewContext(code, context);
    const headers = new Headers({ origin: "https://admin.example.test", host: "admin.example.test", "sec-fetch-site": "same-origin", "x-friending-admin-request": "1" });
    const result = await context.exports.POST({ headers, text: async () => JSON.stringify(browser) }, { params: Promise.resolve({ action }) }) as Response;
    return { status: result.status, headers: result.headers, body: await result.json(), sent };
  } finally { globalThis.fetch = fetchBefore; }
}
function formOf(result: Awaited<ReturnType<typeof bridge>>, action: string, fields: string[]) {
  assert.equal(result.status, 200); assert.equal(result.sent.length, 1);
  const { form, url, headers, cache } = result.sent[0];
  assert.equal(url, `https://core.invalid/v1/webadmin/${action}`); assert.equal(cache, "no-store"); assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal(headers.get("content-type"), "application/x-www-form-urlencoded;charset=UTF-8");
  assert.deepEqual([...form.keys()].sort(), [...fields, "secret", "admin_email", "dates_event_intake_admin_contract_version", "dates_event_research_admin_contract_version"].sort());
  assert.equal(new Set(form.keys()).size, [...form.keys()].length); assert.equal([...form.keys()].some((name) => /[\[\].]/.test(name)), false);
  assert.equal(form.get("secret"), fakeSecret); assert.equal(form.get("admin_email"), actor); assert.equal([...form.keys()].at(-1), "secret");
  assert.equal(form.get("dates_event_research_admin_contract_version"), "1"); assert.equal(form.get("dates_event_intake_admin_contract_version"), "1");
  assert.equal(JSON.stringify(result.body).includes(fakeSecret), false);
  return Object.fromEntries(form);
}
const values = { enabled: GENUINE_DEFAULTS.enabled, auto_cities_enabled: GENUINE_DEFAULTS.auto_cities_enabled, cadence_hours: GENUINE_DEFAULTS.cadence_hours,
  scope: GENUINE_DEFAULTS.scope, member_threshold: GENUINE_DEFAULTS.member_threshold, target_events: GENUINE_DEFAULTS.target_events,
  window_days: GENUINE_DEFAULTS.window_days, autopublish: GENUINE_DEFAULTS.autopublish };
const sourceInput = { url: GENUINE_SOURCE.url, label: GENUINE_SOURCE.label, type: GENUINE_SOURCE.type, area_id: GENUINE_SOURCE.area_id,
  cadence_hours: GENUINE_SOURCE.cadence_hours, max_events: GENUINE_SOURCE.max_events, window_days: null, autopublish: null, enabled: true, archived: false, reason: "Reviewed", idempotency_key: key };
const reads: [string, Record<string, unknown>, unknown][] = [
  ["dates_event_research_overview", {}, DERIVED_OVERVIEW],
  ["dates_event_research_run_list", { source_id: GENUINE_SOURCE.source_id, area_id: GENUINE_AREA.area_id, kind: "source", cursor: "opaque:+/page=2", limit: 17 }, { ...DERIVED_ENVELOPE, runs: [DERIVED_RUN], next_cursor: null, limit: 17 }],
  ["dates_event_research_run_detail", { run_id: DERIVED_RUN.run_id }, { ...DERIVED_ENVELOPE, run: { ...DERIVED_RUN, candidates: [] } }],
];
for (const [action, input, answer] of reads) test(`DERIVED transport: ${action} has exact server-owned selectors and filters`, async () => {
  const fields = formOf(await bridge(action, input, answer), action, Object.keys(input));
  for (const [name, value] of Object.entries(input)) assert.equal(fields[name], String(value));
});
test("DERIVED transport: defaults revision zero and one JSON values object", async () => {
  const action = "dates_event_research_defaults_save", input = { expected_revision: 0, values, reason: "Reviewed", idempotency_key: key };
  const fields = formOf(await bridge(action, input, { ...DERIVED_ENVELOPE, defaults: { ...GENUINE_DEFAULTS, revision: 1 }, replayed: false, audit_id: "aud_derived" }), action, Object.keys(input));
  assert.equal(fields.expected_revision, "0"); assert.deepEqual(JSON.parse(fields.values), values); assert.equal(typeof JSON.parse(fields.values).enabled, "boolean");
});
for (const update of [false, true]) test(`DERIVED transport: city ${update ? "update" : "create"} sends identity, never geometry`, async () => {
  const action = "dates_event_research_area_save", input = { ...(update ? { area_id: GENUINE_AREA.area_id, expected_revision: 1, label: "Budapest" } : { place_id: GENUINE_AREA.place_id }),
    mode: "auto", overrides: GENUINE_AREA.overrides, reason: "Reviewed", idempotency_key: key };
  const fields = formOf(await bridge(action, input), action, Object.keys(input)); assert.deepEqual(JSON.parse(fields.overrides), GENUINE_AREA.overrides);
  assert.equal(Object.hasOwn(fields, "center"), false); assert.equal(Object.hasOwn(fields, "country_code"), false);
});
for (const update of [false, true]) test(`DERIVED transport: source ${update ? "update" : "create"} preserves null inheritance and booleans`, async () => {
  const action = "dates_event_research_source_save", input = { ...sourceInput, ...(update ? { source_id: GENUINE_SOURCE.source_id, expected_revision: 1 } : {}) };
  const fields = formOf(await bridge(action, input), action, Object.keys(input));
  assert.equal(fields.enabled, "1"); assert.equal(fields.archived, "0"); assert.equal(fields.window_days, ""); assert.equal(fields.autopublish, "");
});
for (const dry_run of [false, true]) test(`DERIVED transport: source run (dry ${dry_run}) fences revision and carries one key`, async () => {
  const action = "dates_event_research_source_run_now", input = { source_id: GENUINE_SOURCE.source_id, expected_revision: 1, dry_run, idempotency_key: key };
  const fields = formOf(await bridge(action, input), action, Object.keys(input)); assert.equal(fields.dry_run, dry_run ? "1" : "0"); assert.equal(fields.expected_revision, "1");
});
for (const action of ["publish", "reject"]) test(`DERIVED transport: batch ${action} carries JSON list, revision map and confirmations once`, async () => {
  const route = "dates_event_intake_batch_decide", ids = ["xin_" + "1".repeat(32), "xin_" + "2".repeat(32)];
  const input = { intake_ids: ids, expected_revisions: { [ids[0]]: 2, [ids[1]]: 3 }, action, reason: "Reviewed both", idempotency_key: key,
    ...(action === "publish" ? { confirmations: { source: true, public_venue: true, timezone: true, content_safe: true } } : { reason_code: "unverifiable" }) };
  const fields = formOf(await bridge(route, input), route, Object.keys(input));
  assert.deepEqual(JSON.parse(fields.intake_ids), ids); assert.deepEqual(JSON.parse(fields.expected_revisions), input.expected_revisions);
  if (action === "publish") assert.deepEqual(JSON.parse(fields.confirmations), input.confirmations);
});
test("research queue transport adds its selector only for the selected run/channel", async () => {
  const action = "dates_event_intake_list", input = { research_run_id: DERIVED_RUN.run_id, channel: "ai_research", page: 1, limit: 40 };
  formOf(await bridge(action, input), action, Object.keys(input));
  const old = await bridge(action, { page: 1, limit: 40 }); assert.equal(old.status, 200);
  assert.equal(old.sent[0].form.has("dates_event_research_admin_contract_version"), false);
});
test("research transport denies browser-owned selectors, actors, unknown fields and geometry before Core", async () => {
  for (const extra of [{ secret: "fake" }, { admin_email: "other@example.test" }, { dates_event_research_admin_contract_version: 1 }, { dates_event_intake_admin_contract_version: 1 }, { unknown: true }]) {
    const result = await bridge("dates_event_research_source_save", { ...sourceInput, ...extra }); assert.equal(result.status, 400); assert.equal(result.sent.length, 0);
  }
  const city = { place_id: "place", mode: "auto", overrides: GENUINE_AREA.overrides, reason: "Reviewed", idempotency_key: key };
  for (const extra of [{ center: { latitude: 47, longitude: 19 } }, { bounds: null }, { country_code: "HU" }]) {
    const result = await bridge("dates_event_research_area_save", { ...city, ...extra }); assert.equal(result.status, 400); assert.equal(result.sent.length, 0);
  }
});
test("research transport checks review for reads and manage for writes on every call", async () => {
  const reviewer = { ...member, dates: { ...member.dates, capabilities: ["dates_external_event_review"] } };
  assert.equal((await bridge("dates_event_research_overview", {}, DERIVED_OVERVIEW, reviewer)).status, 200);
  const denied = await bridge("dates_event_research_source_save", sourceInput, DERIVED_ENVELOPE, reviewer); assert.equal(denied.status, 403); assert.equal(denied.sent.length, 0);
  const noReview = { ...member, dates: { ...member.dates, capabilities: ["dates_external_event_manage"] } };
  assert.equal((await bridge("dates_event_research_overview", {}, DERIVED_OVERVIEW, noReview)).status, 403);
});
