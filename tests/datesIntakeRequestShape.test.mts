import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as actions from "../lib/adminActions.ts";
import { adminBridgeCoreTransportError } from "../lib/adminBridge.ts";
import { datesAvailabilityWriteIsRetired } from "../lib/datesAdmin.ts";
import { DATES_ADMIN_INTAKE_CONTRACT_SELECTOR, datesAdminContractParams, withDatesAdminContract } from "../lib/datesAdminContract.ts";
import { isDatesAdminRoute, projectDatesAdminResponse } from "../lib/datesAdminProjection.ts";
import { datesExternalProxyCapabilityAuthorized, normalizeDatesExternalProxyBody } from "../lib/datesExternalAdmin.ts";
import { datesExternalDraftInput } from "../lib/datesExternalInput.ts";
import { datesExternalResolutionAuthorized, normalizeDatesExternalResolutionProxyBody } from "../lib/datesExternalModeration.ts";
import { prepareDatesExternalPending } from "../lib/datesExternalMutations.ts";
import {
  DATES_INTAKE_CHANNELS, DATES_INTAKE_LEASE_ACTIONS, DATES_INTAKE_REJECT_REASONS, DATES_INTAKE_STATUSES, datesIntakeEditorDraft,
  datesIntakeProxyCapabilityAuthorized, normalizeDatesIntakeProxyBody, projectDatesIntakeDetail,
} from "../lib/datesIntakeAdmin.ts";
import { serveDatesIntakeCreate, serveDatesIntakeMedia } from "../lib/datesIntakeBridge.ts";
import { prepareDatesIntakeAsk, prepareDatesIntakeReject } from "../lib/datesIntakeConsole.ts";
import { isTrustedAdminRequest } from "../lib/requestGuard.ts";

// What the console REALLY sends to Core for each intake route, compared with
// what Core's parsers accept (T-884 fix 74de1259, Core tip 06c8c3ea; the Core
// lane's own counterpart is tests/dates_event_intake_form_encoding_storage_test.php).
//
// The path under test is the production one end to end: the browser's JSON
// body -> the actual POST function of app/api/admin/[action]/route.ts (or the
// two dedicated routes) -> the real coreCall / coreMultipartFilesCall -> the
// bytes handed to fetch. Only the session, the membership read and the socket
// are controlled. The grammars below are transcribed from Core's source
// (DatesEventIntakeAdminService, DatesEventIntakePolicy, DatesAdminAuditService,
// DatesConfigurationAdminService::strictBoolean), not from the console.
const CORE = {
  intakeId: /^xin_[a-f0-9]{32}$/,
  revision: /^[1-9][0-9]{0,17}$/,
  eventIndex: /^(?:0|[1-9][0-9]?)$/,
  strictBoolean: /^(?:1|true|yes|on|0|false|no|off)$/i,
  positiveInteger: /^[1-9][0-9]*$/,
  idempotencyKey: /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/,
  requestId: /^[A-Za-z0-9._:-]{8,96}$/,
  month: /^20\d{2}-(?:0[1-9]|1[0-2])$/,
};

const EMPTY_MODULE_URL = "data:text/javascript,";
type ResolveNext = (specifier: string, context: unknown) => unknown;
const moduleApi = nodeModule as unknown as { registerHooks?: (hooks: { resolve: (specifier: string, context: unknown, next: ResolveNext) => unknown }) => void;
  register?: (specifier: string, parentURL: string) => void };
if (typeof moduleApi.registerHooks === "function") moduleApi.registerHooks({ resolve(specifier, context, next) {
  return specifier === "server-only" ? { url: EMPTY_MODULE_URL, shortCircuit: true, format: "module" } : next(specifier, context); } });
else if (typeof moduleApi.register === "function") moduleApi.register("data:text/javascript," + encodeURIComponent(
  `export function resolve(specifier, context, next) { if (specifier === "server-only") return { url: ${JSON.stringify(EMPTY_MODULE_URL)}, shortCircuit: true, format: "module" }; return next(specifier, context); }`), import.meta.url);
else throw new Error("no module resolution hook API available");
const secret = "test-webadmin-api-secret-0000000000";
process.env.WEBADMIN_API_SECRET = secret;
process.env.CORE_API_BASE = "https://core.invalid";
const { coreCall, coreMultipartFilesCall, mergeCoreParams, isReservedCoreParam } = await import("../lib/core.ts");

const DIRECTORY = new URL("./fixtures/dates_event_intake_admin_wire/", import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, DIRECTORY), "utf8"));
const xin = (number: number) => "xin_" + number.toString(16).padStart(32, "0");
const email = "operator@example.test";
const membership = { success: true, role: "admin", dates: { email, role: "administrator", rank: 40, linked_uid: null, sensitive_location: false,
  break_glass: false, capabilities: ["dates_external_event_read", "dates_external_event_review", "dates_external_event_manage"] } };

// The production POST function of the generic bridge, as datesExternalProxy.test.mts runs it.
const routeSource = readFileSync(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8");
const routeTree = ts.createSourceFile("route.ts", routeSource, ts.ScriptTarget.Latest, true);
const routeBody = routeTree.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(routeTree)).join("\n");
const routeCode = ts.transpileModule(routeBody, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

type Sent = { url: string; form: URLSearchParams | null; multipart: FormData | null; contentType: string | null };
/** Runs `task` with fetch captured; Core's membership read is answered, every other call is recorded and answered with `answer`. */
async function capture<T>(answer: unknown, task: (core: typeof coreCall) => Promise<T>): Promise<{ result: T; sent: Sent[] }> {
  const realFetch = globalThis.fetch, sent: Sent[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input), body = init?.body;
    if (url.endsWith("/admin_me")) return { status: 200, json: async () => membership } as Response;
    const headers = new Headers(init?.headers as HeadersInit);
    sent.push({ url, form: typeof body === "string" ? new URLSearchParams(body) : null, multipart: body instanceof FormData ? body : null, contentType: headers.get("content-type") });
    return { status: 200, json: async () => answer } as Response;
  }) as typeof globalThis.fetch;
  try { return { result: await task(coreCall), sent }; } finally { globalThis.fetch = realFetch; }
}
/** What the route wrote to the server log during the last `bridge` call. */
let serverLog: string[] = [];
/** The browser's request to the generic bridge, through the actual route handler and the real coreCall. */
async function bridge(action: string, browserBody: unknown, answer: unknown = { success: true, status_code: 200 }) {
  serverLog = [];
  // The projection writes a denied key to the server log itself (`console.warn`); the log is captured for the call.
  const realWarn = console.warn;
  console.warn = (line: unknown) => { serverLog.push(String(line)); };
  try { return await forward(action, browserBody, answer); } finally { console.warn = realWarn; }
}
async function forward(action: string, browserBody: unknown, answer: unknown) {
  return capture(answer, async (core) => {
    const context: any = { exports: {}, Buffer, JSON, ...actions, isTrustedAdminRequest, adminBridgeCoreTransportError, datesAvailabilityWriteIsRetired, withDatesAdminContract,
      isDatesAdminRoute, projectDatesAdminResponse,
      datesExternalProxyCapabilityAuthorized, normalizeDatesExternalProxyBody, datesExternalResolutionAuthorized, normalizeDatesExternalResolutionProxyBody,
      datesIntakeProxyCapabilityAuthorized, normalizeDatesIntakeProxyBody, ADMIN_GRANTED_VERIFICATION_CONTRACT_READY: true,
      readAdminSession: async () => ({ email }), coreCall: core, mergeCoreParams, isReservedCoreParam,
      NextResponse: { json: (value: unknown, options: ResponseInit) => new Response(JSON.stringify(value), { ...options, headers: { ...options.headers, "Content-Type": "application/json" } }) } };
    for (const node of routeTree.statements) {
      if (!ts.isImportDeclaration(node) || !node.importClause?.namedBindings || !ts.isNamedImports(node.importClause.namedBindings)) continue;
      for (const element of node.importClause.namedBindings.elements) {
        const name = element.name.text;
        if (context[name] !== undefined || name === "NextRequest") continue;
        assert.match(name, /^(normalize|[A-Za-z]+(?:Authorized|RetryAuthorized))/, `unreviewed dependency ${name}`);
        context[name] = () => undefined;
      }
    }
    vm.runInNewContext(routeCode, context);
    const headers = new Headers({ origin: "https://admin.example.test", host: "admin.example.test", "sec-fetch-site": "same-origin", "x-friending-admin-request": "1" });
    const response = await context.exports.POST({ headers, text: async () => JSON.stringify(browserBody) }, { params: Promise.resolve({ action }) }) as Response;
    return { status: response.status, body: await response.json() };
  });
}
const fields = (form: URLSearchParams) => Object.fromEntries(form.entries());
/** The server-owned selector as the form carries it (D-143); empty until the Core lane announces its name. */
const owned = (action: string) => Object.fromEntries(Object.entries(datesAdminContractParams(action)).map(([key, value]) => [key, String(value)]));
function common(sent: Sent, action: string, names: string[]) {
  assert.equal(sent.url, `https://core.invalid/v1/webadmin/${action}`);
  assert.equal(sent.contentType, "application/x-www-form-urlencoded;charset=UTF-8");
  const form = sent.form!;
  // D-143: the Admin intake contract selector is server-owned and goes with every Dates Admin request - once Core has
  // announced it (until then the constant is null and nothing is added).
  const selector = datesAdminContractParams(action);
  assert.deepEqual([...form.keys()].sort(), [...names, "admin_email", "secret", ...Object.keys(selector)].sort(), "exactly these parameters, each once");
  for (const [key, value] of Object.entries(selector)) assert.equal(form.get(key), String(value), "the selector, set by the server");
  assert.equal(new Set(form.keys()).size, [...form.keys()].length, "no repeated parameter name");
  assert.equal(form.get("admin_email"), email, "the session's actor, set by the server");
  assert.equal(form.get("secret"), secret);
  assert.equal([...form.keys()].at(-1), "secret", "the credential is written last");
  // Core refuses bracketed form fields for a structured value; the console never produces one.
  assert.equal([...form.keys()].some((key) => /[\[\].]/.test(key)), false);
  return fields(form);
}
function confirmedEvent() {
  const prefill = projectDatesIntakeDetail(fixture("admin-detail-in-review-official"), xin(4))!.intake.events[0]!.editor_input!;
  const made = datesExternalDraftInput({ ...datesIntakeEditorDraft(prefill), confirmSource: true, confirmPublicVenue: true, confirmTimezone: true, confirmContentSafe: true });
  assert.ok(made.ok);
  return made.event;
}

for (const complete of [false, true]) test(`request shape: publish (complete ${complete}) as the journal prepares it and coreCall encodes it`, async () => {
  const receipt = fixture(complete ? "admin-publish-complete" : "admin-publish");
  // The command exactly as the review page hands it to the journal, idempotency key included.
  const pending = prepareDatesExternalPending(email, "dates_event_intake_publish", { intake_id: receipt.intake.intake_id, intake_revision: receipt.intake.revision - 1,
    event_index: complete ? 2 : 0, complete, event: confirmedEvent(), reason: "Source and public venue verified." }, null, 1790000000)!;
  const { result, sent } = await bridge("dates_event_intake_publish", pending.body, receipt);
  assert.equal(result.status, 200); assert.deepEqual(result.body, receipt);
  assert.equal(sent.length, 1);
  const form = common(sent[0], "dates_event_intake_publish", ["intake_id", "intake_revision", "event_index", "complete", "event", "reason", "idempotency_key"]);
  assert.match(form.intake_id, CORE.intakeId);
  assert.match(form.intake_revision, CORE.revision); assert.equal(form.intake_revision, String(receipt.intake.revision - 1));
  // The defect T-884 fixed: a form body cannot carry a PHP int or bool. Core now reads the canonical decimal string and its strict boolean.
  assert.match(form.event_index, CORE.eventIndex); assert.equal(form.event_index, complete ? "2" : "0");
  assert.match(form.complete, CORE.strictBoolean); assert.equal(form.complete, complete ? "1" : "0");
  assert.match(form.idempotency_key, CORE.idempotencyKey);
  assert.ok(form.reason.trim() !== "" && Array.from(form.reason).length <= 1000);
  // The P1 editor document: ONE JSON string within Core's 32,000 bytes, its numbers JSON numbers and its confirmations JSON booleans
  // (Core refuses a numeric string or "true" inside it).
  assert.ok(Buffer.byteLength(form.event, "utf8") <= 32_000);
  const event = JSON.parse(form.event);
  assert.deepEqual(Object.keys(event).sort(), ["age_restriction", "all_day", "attendee_list", "category", "confirmations", "end_at", "is_free", "links", "organizer",
    "price_text", "sensitive", "source_url", "start_at", "summary", "timezone", "title", "venue"]);
  assert.equal(typeof event.start_at, "number"); assert.equal(typeof event.venue.latitude, "number"); assert.equal(typeof event.all_day, "boolean");
  assert.deepEqual(event.confirmations, { source: true, public_venue: true, timezone: true, content_safe: true });
  // Nothing of the AI provenance is claimed by the browser: Core records the intake on the ledger itself.
  assert.doesNotMatch(form.event, /ai_assisted|intake|place_id/);
  assert.equal(Object.hasOwn(form, "origin"), false);
});

for (const action of DATES_INTAKE_LEASE_ACTIONS) test(`request shape: lease ${action}`, async () => {
  const receipt = fixture(`admin-lease-${action}`);
  const { result, sent } = await bridge("dates_event_intake_lease", { intake_id: receipt.intake.intake_id, expected_revision: receipt.intake.revision - 1, action }, receipt);
  assert.equal(result.status, 200);
  const form = common(sent[0], "dates_event_intake_lease", ["intake_id", "action", "expected_revision"]);
  assert.match(form.intake_id, CORE.intakeId); assert.match(form.expected_revision, CORE.revision); assert.equal(form.action, action);
});

test("request shape: reject, as the console prepares it", async () => {
  const receipt = fixture("admin-reject-unverifiable");
  const command = prepareDatesIntakeReject({ intake_id: receipt.intake.intake_id, revision: receipt.intake.revision - 1 }, "unverifiable", " No reliable source names the date. ")!;
  const { result, sent } = await bridge("dates_event_intake_reject", command, receipt);
  assert.equal(result.status, 200);
  const form = common(sent[0], "dates_event_intake_reject", ["intake_id", "expected_revision", "reason_code", "reason", "idempotency_key"]);
  assert.match(form.intake_id, CORE.intakeId); assert.match(form.expected_revision, CORE.revision); assert.match(form.idempotency_key, CORE.idempotencyKey);
  assert.ok((DATES_INTAKE_REJECT_REASONS as readonly string[]).includes(form.reason_code));
  assert.equal(form.reason, "No reliable source names the date.");
});

test("request shape: a rejection that names the event already there", async () => {
  const receipt = fixture("admin-duplicate-of-event"), event = fixture("admin-detail-member-duplicate").intake.duplicate_of.id;
  const command = prepareDatesIntakeReject({ intake_id: receipt.intake.intake_id, revision: receipt.intake.revision - 1 }, "duplicate", "Already listed.", event)!;
  const { result, sent } = await bridge("dates_event_intake_reject", command, receipt);
  assert.equal(result.status, 200);
  const form = common(sent[0], "dates_event_intake_reject", ["intake_id", "expected_revision", "reason_code", "reason", "idempotency_key", "duplicate_of_external_event_id"]);
  // Core: DatesId::isValid($duplicateOf, 'xev'), and only with reason_code duplicate.
  assert.match(form.duplicate_of_external_event_id, /^xev_[a-f0-9]{32}$/); assert.equal(form.reason_code, "duplicate");
  // Not named: the field is not sent at all (Core reads an empty one as "not given"; the console sends nothing).
  const plain = prepareDatesIntakeReject({ intake_id: receipt.intake.intake_id, revision: receipt.intake.revision - 1 }, "duplicate", "Already listed.")!;
  const unnamed = await bridge("dates_event_intake_reject", plain, fixture("admin-reject-duplicate"));
  common(unnamed.sent[0], "dates_event_intake_reject", ["intake_id", "expected_revision", "reason_code", "reason", "idempotency_key"]);
});

test("request shape: asking the member, as the console prepares it - the fields arrive as the one JSON list Core reads", async () => {
  const receipt = fixture("admin-ask-member");
  const command = prepareDatesIntakeAsk({ intake_id: receipt.intake.intake_id, revision: receipt.intake.revision - 1 }, ["starts_local", "venue_address"],
    " Biztosan reggel 9-kor kezdődik? ", " The flyer and the text disagree on the start. ")!;
  const { result, sent } = await bridge("dates_event_intake_ask_member", command, receipt);
  assert.equal(result.status, 200); assert.deepEqual(result.body, receipt);
  const form = common(sent[0], "dates_event_intake_ask_member", ["intake_id", "expected_revision", "fields", "reason", "idempotency_key", "member_note"]);
  assert.match(form.intake_id, CORE.intakeId); assert.match(form.expected_revision, CORE.revision); assert.match(form.idempotency_key, CORE.idempotencyKey);
  // TRANSCRIBED from DatesEventIntakeAdminService::askMember (Core 32d418cf): a string of at most 512 bytes that starts
  // with "[" and decodes (depth 2) to a non-empty list of distinct editable field names.
  assert.ok(Buffer.byteLength(form.fields) <= 512 && form.fields.startsWith("["));
  const decoded = JSON.parse(form.fields);
  assert.deepEqual(decoded, ["starts_local", "venue_address"]);
  assert.ok(Array.isArray(decoded) && decoded.length > 0 && decoded.every((field: unknown) => typeof field === "string") && new Set(decoded).size === decoded.length);
  assert.equal(form.member_note, "Biztosan reggel 9-kor kezdődik?"); assert.equal(form.reason, "The flyer and the text disagree on the start.");
  // All eight fields still fit Core's 512-byte bound.
  const all = prepareDatesIntakeAsk({ intake_id: receipt.intake.intake_id, revision: 5 }, ["title", "starts_local", "ends_local", "venue_name", "venue_address", "venue_city", "price_text", "is_free"], "", "why")!;
  const whole = await bridge("dates_event_intake_ask_member", all, receipt);
  const every = common(whole.sent[0], "dates_event_intake_ask_member", ["intake_id", "expected_revision", "fields", "reason", "idempotency_key"]);
  assert.ok(Buffer.byteLength(every.fields) <= 512); assert.equal(JSON.parse(every.fields).length, 8);
  assert.equal(Object.hasOwn(every, "member_note"), false, "no note: the field is not sent");
  // The browser cannot widen the request: an unknown field, a string for the list, or a ninth name is refused before Core.
  for (const body of [{ ...command, submitter_uid: 19601 }, { ...command, fields: '["title"]' }, { ...command, fields: [...all.fields, "summary"] }, { ...command, admin_email: "owner@example.test" }]) {
    const refused = await bridge("dates_event_intake_ask_member", body);
    assert.equal(refused.result.status, 400); assert.equal(refused.sent.length, 0);
  }
});

test("request shape: queue, detail and usage reads never send a present-but-empty number", async () => {
  // The queue page's default body carries an empty channel; the bridge sends no filter at all rather than an empty one.
  const list = await bridge("dates_event_intake_list", { status: "in_review", channel: "", page: 1, limit: 40 }, fixture("admin-list-in-review"));
  const queue = common(list.sent[0], "dates_event_intake_list", ["status", "page", "limit"]);
  assert.ok((DATES_INTAKE_STATUSES as readonly string[]).includes(queue.status));
  assert.match(queue.page, CORE.positiveInteger); assert.match(queue.limit, CORE.positiveInteger); assert.ok(Number(queue.limit) <= 100);
  const all = await bridge("dates_event_intake_list", { status: "", channel: "", page: 2, limit: 3 }, fixture("admin-list-page-two"));
  assert.deepEqual(common(all.sent[0], "dates_event_intake_list", ["page", "limit"]), { page: "2", limit: "3", admin_email: email, secret, ...owned("dates_event_intake_list") });
  // The queue's channel filter, as the page sends it for members' suggestions.
  const suggestions = await bridge("dates_event_intake_list", { status: "in_review", channel: "member_suggestion", page: 1, limit: 40 }, fixture("admin-list-member-channel"));
  assert.equal(common(suggestions.sent[0], "dates_event_intake_list", ["status", "channel", "page", "limit"]).channel, "member_suggestion");
  const channel = await bridge("dates_event_intake_list", { channel: "admin_draft", page: 1, limit: 40 }, fixture("admin-list-channel"));
  assert.ok((DATES_INTAKE_CHANNELS as readonly string[]).includes(common(channel.sent[0], "dates_event_intake_list", ["channel", "page", "limit"]).channel));
  // The access probe of the detail and usage pages.
  const probe = await bridge("dates_event_intake_list", { page: 1, limit: 1 }, fixture("admin-list-empty"));
  assert.deepEqual(common(probe.sent[0], "dates_event_intake_list", ["page", "limit"]), { page: "1", limit: "1", admin_email: email, secret, ...owned("dates_event_intake_list") });
  const detail = await bridge("dates_event_intake_detail", { intake_id: xin(4) }, fixture("admin-detail-in-review-official"));
  assert.match(common(detail.sent[0], "dates_event_intake_detail", ["intake_id"]).intake_id, CORE.intakeId);
  const current = await bridge("dates_event_intake_usage", {}, fixture("admin-usage-month"));
  common(current.sent[0], "dates_event_intake_usage", []);
  const month = await bridge("dates_event_intake_usage", { month: "2026-09" }, fixture("admin-usage-earlier-month"));
  assert.match(common(month.sent[0], "dates_event_intake_usage", ["month"]).month, CORE.month);
});

test("D-143: the selector is the server's - a browser value under its name is overwritten, and it is not sent on a route that is not a Dates Admin route", async () => {
  // The real merge of the bridge, with a stand-in selector (the real constant is null until Core announces the name).
  const standIn = { dates_event_intake_admin_contract_version: 1 };
  const merged = mergeCoreParams({ intake_id: xin(1), dates_event_intake_admin_contract_version: 99, admin_email: "owner@example.test" }, { admin_email: email, ...standIn });
  assert.deepEqual({ ...merged }, { intake_id: xin(1), dates_event_intake_admin_contract_version: 1, admin_email: email });
  // The production helper: every `dates_*` action, and only those.
  if (DATES_ADMIN_INTAKE_CONTRACT_SELECTOR === null) assert.deepEqual(datesAdminContractParams("dates_event_intake_list"), {});
  else assert.deepEqual(Object.keys(datesAdminContractParams("dates_event_intake_list")), [DATES_ADMIN_INTAKE_CONTRACT_SELECTOR.parameter]);
  for (const action of ["admin_me", "users_list", "date_x", "xdates_event_intake_list"]) assert.deepEqual(datesAdminContractParams(action), {}, action);
  // What the route really forwards today for a Dates read: the browser's fields, the actor, the credential - and the selector when there is one.
  const list = await bridge("dates_event_intake_list", { page: 1, limit: 1 }, fixture("admin-list-empty"));
  assert.deepEqual(common(list.sent[0], "dates_event_intake_list", ["page", "limit"]), { page: "1", limit: "1", admin_email: email, secret, ...owned("dates_event_intake_list") });
  // A browser cannot smuggle a selector-like field through a closed request shape either.
  const forged = await bridge("dates_event_intake_list", { page: 1, limit: 1, dates_event_intake_admin_contract_version: 1 });
  assert.equal(forged.result.status, 400); assert.equal(forged.sent.length, 0);
});

test("response shape: the browser receives the named fields of a Dates body through the real bridge - an unknown key is dropped, a denied one is dropped and logged by name", async () => {
  // The generic bridge, as it is: Core's genuine queue body with a key the console does not name, a member's number on a
  // row (deny-list) and a nested unknown key.
  const genuine = fixture("admin-list-in-review");
  const leaking = JSON.parse(JSON.stringify(genuine));
  leaking.future_envelope_key = { trace: "UNNAMED-VALUE" }; leaking.intakes[0].submitter_uid = 4242777; leaking.intakes[0].lease.future = "UNNAMED-VALUE";
  const list = await bridge("dates_event_intake_list", { status: "in_review", page: 1, limit: 40 }, leaking);
  assert.equal(list.result.status, 200);
  assert.deepEqual(list.result.body, genuine, "what the browser receives is the genuine body: named fields only");
  assert.doesNotMatch(JSON.stringify(list.result.body), /UNNAMED-VALUE|4242777|submitter_uid|future/);
  // One warning on the server log, with the route, the family and the key's name - not the member's number.
  assert.deepEqual(serverLog, ["webadmin.dates_denied_key route=dates_event_intake_list family=intake-queue key=intakes[].submitter_uid count=1"]);
  // The detail of a member's suggestion: the stored consent record and the origin hint never leave the server; the member block stays what the contract serves.
  const detail = fixture("admin-detail-member-in-review"), wider = JSON.parse(JSON.stringify(detail));
  wider.intake.consent = { version: 1, accepted_at: 1790000000, ip: "203.0.113.9" }; wider.intake.inputs.origin_hint = { latitude: 47.4979, longitude: 19.0402 };
  wider.intake.member.email = "member@example.test"; wider.intake.member.future = 1;
  const read = await bridge("dates_event_intake_detail", { intake_id: detail.intake.intake_id }, wider);
  assert.deepEqual(read.result.body, detail);
  assert.doesNotMatch(JSON.stringify(read.result.body), /203\.0\.113\.9|47\.4979|member@example\.test/);
  assert.deepEqual([...serverLog].sort(), ["intake.consent", "intake.inputs.origin_hint", "intake.member.email"].map((key) =>
    `webadmin.dates_denied_key route=dates_event_intake_detail family=intake key=${key} count=1`));
  assert.doesNotMatch(serverLog.join("\n"), /203\.0\.113\.9|47\.4979|member@example\.test/);
  // A genuine body logs nothing; a refusal is Core's six keys; a receipt is its named fields.
  const clean = await bridge("dates_event_intake_list", { status: "in_review", page: 1, limit: 40 }, genuine);
  assert.deepEqual(clean.result.body, genuine); assert.deepEqual(serverLog, []);
  const refusal = fixture("admin-list-viewer-denied");
  const refused = await bridge("dates_event_intake_list", { page: 1, limit: 40 }, { ...refusal, debug: "UNNAMED-VALUE" });
  assert.deepEqual(refused.result.body, refusal, "Core's refusal travels as it came, minus what is not a refusal key");
  assert.equal(refused.result.status, refusal.status_code);
  const receipt = fixture("admin-lease-claim");
  const claimed = await bridge("dates_event_intake_lease", { intake_id: receipt.intake.intake_id, expected_revision: receipt.intake.revision - 1, action: "claim" },
    { ...receipt, holder_session: "UNNAMED-VALUE" });
  assert.deepEqual(claimed.result.body, receipt);
  // A P1 route through the same bridge: the external detail with the AI provider behind its intake reference.
  const external = fixture("admin-external-detail-ai-assisted"), named = JSON.parse(JSON.stringify(external));
  named.event.intake.provider = "openai"; named.event._id = "65f0c0ffee";
  const event = await bridge("dates_external_event_detail", { external_event_id: external.event.external_event_id }, named);
  assert.deepEqual(event.result.body, external);
  assert.deepEqual([...serverLog].sort(), ["event._id", "event.intake.provider"].map((key) => `webadmin.dates_denied_key route=dates_external_event_detail family=external-event key=${key} count=1`));
});

test("request shape: nothing the browser adds reaches Core - not an actor, not a credential, not a typed-only or unknown field", async () => {
  const id = xin(1), key = "dates-intake-reject:00000000-0000-4000-8000-000000000001";
  const cases: Array<[string, Record<string, unknown>]> = [
    ["dates_event_intake_lease", { intake_id: id, action: "claim", expected_revision: 9, admin_email: "owner@example.test" }],
    ["dates_event_intake_lease", { intake_id: id, action: "claim", expected_revision: 9, secret: "x".repeat(40) }],
    ["dates_event_intake_lease", { intake_id: id, action: "claim", expected_revision: "09" }],
    ["dates_event_intake_lease", { intake_id: id, action: "claim", expected_revision: "" }],
    ["dates_event_intake_reject", { intake_id: id, expected_revision: 9, reason_code: "duplicate", reason: "x", idempotency_key: key, admin_request_id: "forged-request-id" }],
    ["dates_event_intake_list", { page: "", limit: 40 }], ["dates_event_intake_list", { page: 1, limit: 40, origin: { latitude: 1, longitude: 1 } }],
    ["dates_event_intake_detail", { intake_id: id, admin_email: "owner@example.test" }], ["dates_event_intake_usage", { month: "2026-9" }],
    ["dates_event_intake_publish", { intake_id: id, intake_revision: 9, event_index: 0, complete: false, event: confirmedEvent(), reason: "ok", idempotency_key: key, origin: {} }],
    ["dates_event_intake_publish", { intake_id: id, intake_revision: 9, event_index: 0, event: confirmedEvent(), reason: "ok", idempotency_key: key }],
  ];
  for (const [action, body] of cases) {
    const { result, sent } = await bridge(action, body);
    assert.equal(result.status, 400, `${action} ${JSON.stringify(Object.keys(body))}`); assert.deepEqual(result.body, { success: false, status_code: 400, error: "invalid-input" });
    assert.equal(sent.length, 0, "refused before Core");
  }
  // Creating an intake and reading a flyer are not generic actions at all.
  for (const action of ["dates_event_intake_create", "dates_event_intake_image"]) {
    const { result, sent } = await bridge(action, { intake_id: id, index: 1 });
    assert.equal(result.status, 404); assert.equal(sent.length, 0);
  }
});

const requestHeaders = (extra: Record<string, string>) => new Headers({ origin: "https://admin.example.test", host: "admin.example.test", "sec-fetch-site": "same-origin",
  "x-friending-admin-request": "1", ...extra });
const deps = (core: typeof coreCall) => ({ session: async () => ({ email }), core, coreFiles: coreMultipartFilesCall, requestId: () => crypto.randomUUID() });
const KEY = "dates-intake-create:00000000-0000-4000-8000-000000000001";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

test("request shape: create from a link and from a line of text is a form body with string fields only", async () => {
  for (const [source, receipt] of [[{ kind: "url", url: "https://akvariumklub.hu/programok/acidarab/" }, "admin-create-url"],
    [{ kind: "text", text: "Fradi–Újpest szombaton a Groupama Arénában" }, "admin-create-text"]] as const) {
    const browser = new FormData();
    for (const [key, value] of Object.entries({ ...source, locale: "hu", idempotency_key: KEY })) browser.set(key, value);
    const { result, sent } = await capture(fixture(receipt), (core) => serveDatesIntakeCreate({ headers: requestHeaders({ "content-length": "512" }), form: async () => browser }, deps(core)));
    assert.equal(result.status, 200);
    const form = common(sent[0], "dates_event_intake_create", ["kind", source.kind, "locale", "idempotency_key", "admin_request_id"]);
    assert.equal(form.kind, source.kind); assert.ok(["hu", "en"].includes(form.locale));
    assert.match(form.idempotency_key, CORE.idempotencyKey); assert.match(form.admin_request_id, CORE.requestId);
    // No origin hint, and no empty field standing in for a source that was not given.
    assert.equal(Object.values(form).some((value) => value === ""), false);
  }
});

test("request shape: create from flyers is real multipart with image_1 / image_2 and the same string fields", async () => {
  const browser = new FormData();
  for (const [key, value] of Object.entries({ kind: "images", text: "Városligeti programok novemberben", locale: "hu", idempotency_key: KEY })) browser.set(key, value);
  browser.set("image_1", new Blob([JPEG]), "IMG_0001.HEIC"); browser.set("image_2", new Blob([JPEG]), "C:\\Users\\me\\Desktop\\poster.jpg");
  const { result, sent } = await capture(fixture("admin-create-images-with-text"), (core) =>
    serveDatesIntakeCreate({ headers: requestHeaders({ "content-length": "4096" }), form: async () => browser }, deps(core)));
  assert.equal(result.status, 200); assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://core.invalid/v1/webadmin/dates_event_intake_create");
  assert.equal(sent[0].form, null); assert.equal(sent[0].contentType, null, "fetch writes the multipart boundary itself");
  const body = sent[0].multipart!;
  assert.deepEqual([...new Set(body.keys())].sort(), ["admin_email", "admin_request_id", "dates_event_intake_admin_contract_version", "idempotency_key", "image_1", "image_2",
    "kind", "locale", "secret", "text"]);
  assert.equal(body.get("dates_event_intake_admin_contract_version"), "1", "the Admin intake contract selector, set by the server (D-143)");
  assert.deepEqual([body.get("kind"), body.get("locale"), body.get("text"), body.get("admin_email"), body.get("secret")],
    ["images", "hu", "Városligeti programok novemberben", email, secret]);
  assert.match(String(body.get("idempotency_key")), CORE.idempotencyKey); assert.match(String(body.get("admin_request_id")), CORE.requestId);
  for (const [index, field] of ["image_1", "image_2"].entries()) {
    const file = body.get(field) as File;
    assert.ok(file instanceof File); assert.equal(file.type, "image/jpeg");
    // The operator's own file name and path never leave the console.
    assert.equal(file.name, `flyer-${index + 1}.jpg`);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), JPEG, "the bytes Core re-encodes are the bytes that were uploaded");
  }
  assert.equal(body.has("image"), false, "Core's intake route reads image_1 and image_2 only");
});

test("request shape: the flyer read sends the intake, the flyer's number and a request id Core's audit accepts", async () => {
  const { result, sent } = await capture(fixture("admin-image-unavailable-denied"), (core) => serveDatesIntakeMedia({
    headers: new Headers({ host: "admin.example.test", "sec-fetch-site": "same-origin", "sec-fetch-dest": "image" }),
    searchParams: new URLSearchParams(`intake_id=${xin(5)}&index=2`) }, deps(core)));
  assert.equal(result.status, 404);
  const form = common(sent[0], "dates_event_intake_image", ["intake_id", "index", "admin_request_id"]);
  assert.match(form.intake_id, CORE.intakeId); assert.match(form.index, CORE.positiveInteger); assert.ok(Number(form.index) <= 2);
  assert.match(form.admin_request_id, CORE.requestId);
});
