import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as actions from "../lib/adminActions.ts";
import { isTrustedAdminRequest } from "../lib/requestGuard.ts";
import { adminBridgeCoreTransportError } from "../lib/adminBridge.ts";
import { datesAvailabilityWriteIsRetired } from "../lib/datesAdmin.ts";
import { withDatesAdminContract } from "../lib/datesAdminContract.ts";
import { datesExternalProxyCapabilityAuthorized, normalizeDatesExternalProxyBody } from "../lib/datesExternalAdmin.ts";
import { datesExternalResolutionAuthorized, normalizeDatesExternalResolutionProxyBody } from "../lib/datesExternalModeration.ts";

// Execute the production POST function, not a reimplementation. Session/Core
// I/O and NextResponse are controlled adapters; unrelated domain predicates
// return undefined. These are source-handler tests, not a mounted HTTP server.
const source = readFileSync(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
const body = tree.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(tree)).join("\n");
const compile = (input: string) => ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const coreSource = readFileSync(new URL("../lib/core.ts", import.meta.url), "utf8");
const coreTree = ts.createSourceFile("core.ts", coreSource, ts.ScriptTarget.Latest, true);
const merge = coreTree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "mergeCoreParams");
assert.ok(merge);
const email = "operator@example.test";
const caps = ["dates_external_event_read", "dates_external_event_manage"];
const membership = () => ({ success: true, role: "admin", dates: { email, role: "administrator", rank: 40,
  linked_uid: null, sensitive_location: false, break_glass: false, capabilities: [...caps] } });
const externalId = "xev_" + "a".repeat(32);
const command = () => ({ external_event_id: externalId, expected_revision: 1, action: "cancel", reason: "Confirmed cancellation", idempotency_key: "external-proxy:000000000001" });
function harness() {
  const state = { session: { email } as { email: string } | null, member: { status: 200, data: membership() } as any,
    response: { status: 200, data: { success: true, status_code: 200 } } as any, calls: [] as Array<{ action: string; body: any }> };
  // Parsing shares the production helpers' realm, so their plain-object guard
  // is tested without the artificial vm Object.prototype mismatch.
  // D-143: the route adds the Admin intake contract selector to Dates requests itself (the real function, as it is).
  const context: any = { exports: {}, Buffer, JSON, ...actions, isTrustedAdminRequest, adminBridgeCoreTransportError, withDatesAdminContract,
    datesAvailabilityWriteIsRetired, datesExternalProxyCapabilityAuthorized, normalizeDatesExternalProxyBody,
    datesExternalResolutionAuthorized, normalizeDatesExternalResolutionProxyBody,
    ADMIN_GRANTED_VERIFICATION_CONTRACT_READY: true,
    readAdminSession: async () => state.session,
    coreCall: async (action: string, body: any) => { state.calls.push({ action, body }); return action === "admin_me" ? state.member : state.response; },
    NextResponse: { json: (value: unknown, options: ResponseInit) => new Response(JSON.stringify(value), { ...options, headers: { ...options.headers, "Content-Type": "application/json" } }) },
    isReservedCoreParam: (key: string) => ["secret", "admin_email"].includes(key),
  };
  for (const node of tree.statements) {
    if (!ts.isImportDeclaration(node) || !node.importClause?.namedBindings || !ts.isNamedImports(node.importClause.namedBindings)) continue;
    for (const element of node.importClause.namedBindings.elements) {
      const name = element.name.text;
      if (context[name] !== undefined || name === "mergeCoreParams" || name === "NextRequest") continue;
      assert.match(name, /^(normalize|[A-Za-z]+(?:Authorized|RetryAuthorized))/, `unreviewed dependency ${name}`);
      context[name] = () => undefined;
    }
  }
  vm.runInNewContext(compile(`${merge.getText(coreTree)}\n${body}`), context);
  async function send(action = "dates_external_event_command", payload: unknown = command(), overrides: Record<string, string | null> = {}, raw?: string) {
    const headers = new Headers({ origin: "https://admin.example.test", host: "admin.example.test", "sec-fetch-site": "same-origin", "x-friending-admin-request": "1" });
    for (const [key, value] of Object.entries(overrides)) value === null ? headers.delete(key) : headers.set(key, value);
    const response = await context.exports.POST({ headers, text: async () => raw ?? JSON.stringify(payload) }, { params: Promise.resolve({ action }) }) as Response;
    assert.equal(response.headers.get("cache-control"), "no-store");
    return { status: response.status, body: await response.json() };
  }
  return { state, send };
}

test("external proxy rejects foreign/missing origin and guest before reaching a Core mutation", async () => {
  for (const headers of [{ origin: "https://attacker.example" }, { origin: null }, { "x-friending-admin-request": null }, { "sec-fetch-site": "cross-site" }]) {
    const h = harness(); assert.equal((await h.send(undefined, undefined, headers)).status, 403); assert.equal(h.state.calls.length, 0);
  }
  const h = harness(); h.state.session = null;
  assert.equal((await h.send()).status, 401); assert.equal(h.state.calls.length, 0);
});
test("external proxy checks current membership and explicit Dates capability on every call", async () => {
  const h = harness(); assert.equal((await h.send()).status, 200);
  h.state.member.data.dates.capabilities = ["dates_external_event_read"];
  assert.equal((await h.send()).body.error, "dates-admin-capability-required");
  h.state.member = { status: 200, data: { success: false, error: "admin-revoked" } };
  assert.equal((await h.send()).status, 401);
  assert.equal(h.state.calls.filter((call) => call.action === "admin_me").length, 3);
  assert.equal(h.state.calls.filter((call) => call.action !== "admin_me").length, 1);
  const owner = harness(); owner.state.member.data = { success: true, role: "owner" };
  assert.equal((await owner.send()).status, 403, "top-level owner does not invent Dates capability");
});
test("external reads permit a current viewer; mutations retain both role and capability gates", async () => {
  const h = harness(); h.state.member.data.role = "viewer";
  h.state.member.data.dates = { ...h.state.member.data.dates, role: "support_viewer", rank: 10, capabilities: ["dates_external_event_read"] };
  assert.equal((await h.send("dates_external_event_list", { page: 1, limit: 40 })).status, 200);
  assert.equal((await h.send("dates_external_event_detail", { external_event_id: externalId })).status, 200);
  assert.equal((await h.send()).status, 403);
  h.state.member.data.dates.capabilities = [...caps];
  assert.equal((await h.send()).body.error, "admin-write-required", "even an inconsistent member projection cannot widen the bridge role");
});
test("all six exact external routes forward only validated input and the authenticated server identity", async () => {
  const event = JSON.parse(readFileSync(new URL("./fixtures/dates_external_admin_wire/admin-detail-admin.json", import.meta.url), "utf8")).event.editor_input;
  event.confirmations = { source: true, public_venue: true, timezone: true, content_safe: true };
  const write = { event, reason: "Confirmed source and venue", idempotency_key: "external-proxy:000000000002" };
  const bodies: Record<string, unknown> = { dates_external_event_list: { page: 1, limit: 40 }, dates_external_event_detail: { external_event_id: externalId },
    dates_external_event_publish: write, dates_external_event_update: { ...write, external_event_id: externalId, expected_revision: 1 },
    dates_external_event_command: command(), dates_external_event_place_search: { query: "Public square", language: "hu" } };
  for (const [action, payload] of Object.entries(bodies)) {
    const h = harness(); assert.equal((await h.send(action, payload)).status, 200, action);
    assert.equal(h.state.calls[0].action, "admin_me");
    const sent = h.state.calls[1]; assert.equal(sent.action, action);
    // D-143: the server adds the Admin intake contract selector to every Dates Admin request, beside the actor.
    assert.deepEqual(JSON.parse(JSON.stringify(sent.body)), { ...payload as object, admin_email: email, dates_event_intake_admin_contract_version: 1 });
    assert.equal(Object.hasOwn(sent.body, "secret"), false);
  }
});
test("closed external request bodies reject identity/credential injection, malformed JSON and oversized requests", async () => {
  for (const payload of [[], null, { ...command(), admin_email: "other@example.test" }, { ...command(), secret: "synthetic-untrusted-value" },
    { ...command(), expected_revision: "01" }, { ...command(), action: "purge" }, { ...command(), private_field: true }]) {
    const h = harness(); assert.equal((await h.send(undefined, payload)).status, 400); assert.equal(h.state.calls.length, 1);
  }
  const h = harness(); assert.equal((await h.send(undefined, undefined, {}, "{")).status, 400);
  assert.equal((await h.send(undefined, undefined, { "content-length": "99999999" })).status, 413);
  assert.equal((await h.send("dates_external_event_republish", {})).status, 404);
  assert.equal(h.state.calls.length, 1);
});
test("proxy retains Core logical refusal bytes and normalizes only transport/session errors", async () => {
  const h = harness(); const refusal = JSON.parse(readFileSync(new URL("./fixtures/dates_external_admin_wire/admin-publishing-disabled-denied.json", import.meta.url), "utf8"));
  h.state.response = { status: 200, data: refusal };
  assert.deepEqual(await h.send(), { status: 200, body: refusal });
  for (const [error, status] of [["core-unavailable", 502], ["core-timeout", 504], ["invalid-core-response", 502]] as const) {
    h.state.response = { status, data: { success: false, error } };
    assert.deepEqual(await h.send(), { status, body: { success: false, status_code: status, error } });
  }
  h.state.response = { status: 403, data: { success: false, error: "admin-revoked" } };
  assert.equal((await h.send()).status, 401);
});

test("external resolve proxy freshly requires both capabilities and forwards the two independent revisions", async () => {
  const payload = { case_id: "cas_" + "b".repeat(32), expected_revision: 2, expected_external_revision: 7, action: "remove_content",
    reason: "Checked source and report", user_visible_reason_en: "Removed", user_visible_reason_hu: "Eltávolítva",
    expires_at: null, break_glass: false, idempotency_key: "external-review:000000000001" };
  const h = harness(); h.state.member.data.dates.capabilities = ["dates_case_resolve", "dates_external_event_review"];
  assert.equal((await h.send("dates_moderation_resolve", payload)).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.calls[1].body)), { ...payload, admin_email: email, dates_event_intake_admin_contract_version: 1 });
  for (const missing of ["dates_case_resolve", "dates_external_event_review"]) {
    h.state.member.data.dates.capabilities = ["dates_case_resolve", "dates_external_event_review"].filter((cap) => cap !== missing);
    assert.equal((await h.send("dates_moderation_resolve", payload)).body.error, "dates-admin-capability-required");
  }
  h.state.member.data.dates.capabilities = ["dates_case_resolve", "dates_external_event_review"];
  for (const change of [{ expected_external_revision: "7" }, { expected_revision: 0 }, { action: "warn" }, { subject_uid: 0 }])
    assert.equal((await h.send("dates_moderation_resolve", { ...payload, ...change })).status, 400);
  assert.equal(h.state.calls.filter((call) => call.action === "dates_moderation_resolve").length, 1);
  // The member path retains its existing request hash/shape without the new CAS.
  const member: any = { ...payload, action: "warn" }; delete member.expected_external_revision;
  h.state.member.data.dates.capabilities = ["dates_case_resolve"];
  assert.equal((await h.send("dates_moderation_resolve", member)).status, 200);
  assert.equal(Object.hasOwn(h.state.calls.at(-1)!.body, "expected_external_revision"), false);
});
