import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as actions from "../lib/adminActions.ts";
import { isTrustedAdminRequest } from "../lib/requestGuard.ts";
import { adminBridgeCoreTransportError } from "../lib/adminBridge.ts";
import { webadminErrorEnvelope } from "../lib/webadminEnvelope.ts";
import { ADMIN_MEMBERSHIP_UNCONFIRMED, classifyAdminMembership } from "../lib/adminMembership.ts";
import { MEMBERSHIP_MEMBER, membershipRefusal } from "./support/adminMembershipCases.mts";
import { datesAvailabilityWriteIsRetired } from "../lib/datesAdmin.ts";
import { withDatesAdminContract } from "../lib/datesAdminContract.ts";
import { isDatesAdminRoute, projectDatesAdminResponse } from "../lib/datesAdminProjection.ts";
import { datesExternalProxyCapabilityAuthorized, normalizeDatesExternalProxyBody } from "../lib/datesExternalAdmin.ts";
import { datesExternalResolutionAuthorized, normalizeDatesExternalResolutionProxyBody } from "../lib/datesExternalModeration.ts";
import { normalizeDatesEventIconsProxyBody } from "../lib/datesEventIcons.ts";
import { normalizeDatesExternalPinsProxyBody } from "../lib/datesExternalPins.ts";
import { normalizeDatesLeaderboardProxyBody } from "../lib/datesSuggestionLeaderboard.ts";

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
const membership = () => ({ ...MEMBERSHIP_MEMBER, dates: { email, role: "administrator", rank: 40,
  linked_uid: null, sensitive_location: false, break_glass: false, capabilities: [...caps] } });
const externalId = "xev_" + "a".repeat(32);
const command = () => ({ external_event_id: externalId, expected_revision: 1, action: "cancel", reason: "Confirmed cancellation", idempotency_key: "external-proxy:000000000001" });
function harness() {
  const state = { session: { email } as { email: string } | null, member: { status: 200, data: membership() } as any,
    response: { status: 200, data: { success: true, status_code: 200 } } as any, calls: [] as Array<{ action: string; body: any }> };
  // Parsing shares the production helpers' realm, so their plain-object guard
  // is tested without the artificial vm Object.prototype mismatch.
  // D-143: the route adds the Admin intake contract selector to Dates requests itself (the real function, as it is).
  const context: any = { exports: {}, Buffer, JSON, ...actions, isTrustedAdminRequest, adminBridgeCoreTransportError, webadminErrorEnvelope, ADMIN_MEMBERSHIP_UNCONFIRMED, classifyAdminMembership, withDatesAdminContract,
    // The route hands the browser the projection of a Dates body (lead's ruling on D-143): the real functions, as they are.
    isDatesAdminRoute, projectDatesAdminResponse,
    datesAvailabilityWriteIsRetired, datesExternalProxyCapabilityAuthorized, normalizeDatesExternalProxyBody,
    datesExternalResolutionAuthorized, normalizeDatesExternalResolutionProxyBody, normalizeDatesEventIconsProxyBody,
    normalizeDatesExternalPinsProxyBody, normalizeDatesLeaderboardProxyBody,
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
  h.state.member = { status: 403, data: membershipRefusal(403, "admin-revoked") };
  assert.equal((await h.send()).status, 401);
  assert.equal(h.state.calls.filter((call) => call.action === "admin_me").length, 3);
  assert.equal(h.state.calls.filter((call) => call.action !== "admin_me").length, 1);
  const owner = harness(); owner.state.member.data = { ...MEMBERSHIP_MEMBER, role: "owner" };
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
  h.state.response = { status: 403, data: membershipRefusal(403, "admin-revoked") };
  assert.equal((await h.send()).status, 401);
});

test("external resolve proxy freshly requires both capabilities and forwards the two independent revisions", async () => {
  const payload = { case_id: "cas_" + "b".repeat(32), expected_revision: 2, expected_external_revision: 7, action: "remove_content",
    reason: "Checked source and report", user_visible_reason_en: "Removed", user_visible_reason_hu: "Eltávolítva",
    expires_at: null, break_glass: false, idempotency_key: "external-review:000000000001" };
  const h = harness(); h.state.member.data.dates.capabilities = ["dates_case_resolve", "dates_external_event_review"];
  assert.equal((await h.send("dates_moderation_resolve", payload)).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.calls[1].body)), { ...payload, admin_email: email, dates_event_intake_admin_contract_version: 1, dates_event_media_contract_version: 1 });
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

test("icon catalogue proxy forwards only the closed read and save shapes, with the server's own selector", async () => {
  const row = { key: "yoga", activity_type: "sport", emoji: "🧘", image_url: null, marker_background_color: "#8A72D8", name_en: "Yoga", name_hu: "Jóga", enabled: true, is_default: true, order: 10 };
  const save = { icons: JSON.stringify([row]), expected_revision: 3, reason: "Yoga pin colour", idempotency_key: "event-icons:000000000001" };
  const h = harness();
  assert.equal((await h.send("dates_event_icons", {})).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.calls.at(-1)!.body)),
    { admin_email: email, dates_event_intake_admin_contract_version: 1, dates_event_icon_contract_version: 2 });
  assert.equal((await h.send("dates_event_icons_save", save)).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.calls.at(-1)!.body)),
    { ...save, admin_email: email, dates_event_intake_admin_contract_version: 1, dates_event_icon_contract_version: 2 });
  const forwarded = h.state.calls.length;
  for (const body of [{ ...save, dates_event_icon_contract_version: 1 }, { ...save, admin_email: "other@example.test" }, { ...save, expected_revision: "3" },
    { ...save, reason: "" }, { ...save, icons: [row] }, { ...save, icons: JSON.stringify([{ ...row, name_en: "Yoga\u00A0" }]) },
    { ...save, icons: JSON.stringify([{ ...row, marker_background_color: "#8a72d8" }]) }, { ...save, icons: JSON.stringify([{ ...row, extra: 1 }]) }]) {
    assert.deepEqual(await h.send("dates_event_icons_save", body), { status: 400, body: { success: false, status_code: 400, error: "invalid-input" } });
  }
  assert.deepEqual(await h.send("dates_event_icons", { page: 2 }), { status: 400, body: { success: false, status_code: 400, error: "invalid-input" } });
  // Each refused request cost one fresh membership check and reached no icon route.
  assert.deepEqual(h.state.calls.slice(forwarded).map((call) => call.action), Array(9).fill("admin_me"));
});

test("third-party pin proxy forwards only the closed read and save shapes, with no selector beyond the Dates one", async () => {
  const types = ["sport", "music", "party", "festival", "arts", "learning", "market", "food", "community", "outdoor", "other"];
  const rows = types.map((key, index) => ({ key, emoji: "🎟️", image_url: null, marker_background_color: index === 0 ? "#FF2D95" : null, name_en: `Type ${index}`, name_hu: `Típus ${index}`, order: (index + 1) * 10 }));
  const save = { pins: JSON.stringify(rows), default_marker_background_color: "#6D5BD0", expected_revision: 3, reason: "Pin colours", idempotency_key: "external-pins:000000000001" };
  const h = harness();
  assert.equal((await h.send("dates_external_pins", {})).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.calls.at(-1)!.body)), { admin_email: email, dates_event_intake_admin_contract_version: 1 });
  assert.equal((await h.send("dates_external_pins_save", save)).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.calls.at(-1)!.body)), { ...save, admin_email: email, dates_event_intake_admin_contract_version: 1 });
  const forwarded = h.state.calls.length;
  for (const body of [{ ...save, admin_email: "other@example.test" }, { ...save, expected_revision: "3" }, { ...save, reason: "" }, { ...save, pins: rows },
    { ...save, default_marker_background_color: null }, { ...save, default_marker_background_color: "#6d5bd0" }, { ...save, pins: JSON.stringify(rows.slice(1)) },
    { ...save, pins: JSON.stringify(rows.map((row) => ({ ...row, categories: ["concert"] }))) }, { ...save, pins: JSON.stringify([{ ...rows[0], name_en: "Sports " }, ...rows.slice(1)]) }]) {
    assert.deepEqual(await h.send("dates_external_pins_save", body), { status: 400, body: { success: false, status_code: 400, error: "invalid-input" } });
  }
  assert.deepEqual(await h.send("dates_external_pins", { page: 2 }), { status: 400, body: { success: false, status_code: 400, error: "invalid-input" } });
  // Each refused request cost one fresh membership check and reached no pin route.
  assert.deepEqual(h.state.calls.slice(forwarded).map((call) => call.action), Array(10).fill("admin_me"));
  // A viewer of AreYouIn reads the catalogue and cannot save it.
  h.state.member.data.dates = { ...h.state.member.data.dates, role: "support_viewer", rank: 10 };
  assert.equal((await h.send("dates_external_pins", {})).status, 200);
  assert.equal((await h.send("dates_external_pins_save", save)).status, 403);
});

test("a leaderboard setting is forwarded only in its closed value; every other Dates setting travels as before", async () => {
  const base = { expected_revision: 0, reason: "Leaderboard for Hungary", idempotency_key: "leaderboard:000000000001" };
  const h = harness();
  for (const command of [{ ...base, key: "dates_suggestion_leaderboard_scope_overrides", value: '{"HUN":"city"}' }, { ...base, key: "dates_suggestion_leaderboard_enabled_overrides", value: '{"HUN":true}' },
    { ...base, key: "dates_suggestion_leaderboard_enabled", value: true }, { ...base, key: "dates_suggestion_leaderboard_scope", value: "city" }]) {
    assert.equal((await h.send("dates_configuration_save", command)).status, 200);
    assert.deepEqual(JSON.parse(JSON.stringify(h.state.calls.at(-1)!.body)), { ...command, admin_email: email, dates_event_intake_admin_contract_version: 1 });
  }
  // The generic editor's save of another setting is not this check's business.
  const generic = { key: "dates_report_sla_hours", value: 12, expected_revision: 1, reason: "SLA", idempotency_key: "dates-configuration-save:1" };
  assert.equal((await h.send("dates_configuration_save", generic)).status, 200);
  const forwarded = h.state.calls.length;
  for (const body of [{ ...base, key: "dates_suggestion_leaderboard_enabled", value: "true" }, { ...base, key: "dates_suggestion_leaderboard_scope", value: "world" },
    { ...base, key: "dates_suggestion_leaderboard_enabled_overrides", value: { HUN: true } }, { ...base, key: "dates_suggestion_leaderboard_enabled_overrides", value: '{"hun":true}' },
    { ...base, key: "dates_suggestion_leaderboard_scope_overrides", value: '{"HUN":true}' }, { ...base, key: "dates_suggestion_leaderboard_enabled", value: true, reason: "" }]) {
    assert.deepEqual(await h.send("dates_configuration_save", body), { status: 400, body: { success: false, status_code: 400, error: "invalid-input" } });
  }
  assert.deepEqual(h.state.calls.slice(forwarded).map((call) => call.action), Array(6).fill("admin_me"));
});
