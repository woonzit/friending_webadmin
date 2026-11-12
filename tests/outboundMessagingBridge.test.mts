import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as actions from "../lib/adminActions.ts";
import { ADMIN_MEMBERSHIP_UNCONFIRMED, classifyAdminMembership } from "../lib/adminMembership.ts";
import { adminBridgeCoreTransportError } from "../lib/adminBridge.ts";
import { webadminErrorEnvelope } from "../lib/webadminEnvelope.ts";
import { isTrustedAdminRequest } from "../lib/requestGuard.ts";
import { withDatesAdminContract } from "../lib/datesAdminContract.ts";
import { readBoundedText } from "../lib/boundedStream.ts";
import {
  OUTBOUND_MESSAGING_ERROR_STATUSES,
  normalizeOutboundMessagingProxyBody,
  normalizeOutboundMessagingResponse,
  outboundHistoryDetailPayload,
  outboundHistoryPayload,
  outboundMessagingAccess,
  outboundMessagingProxyCapabilityAuthorized,
  outboundPreviewPayload,
  outboundRecipientPreviewResponse,
  outboundSendPayload,
  type OutboundSendPayload,
} from "../lib/outboundMessaging.ts";
import { MEMBERSHIP_EMAIL, MEMBERSHIP_MEMBER } from "./support/adminMembershipCases.mts";
import { requestBody } from "./support/requestBody.mts";

/**
 * The bridge for the four outbound routes: the production POST of app/api/admin/[action]/route.ts, run with
 * controlled session, membership and Core adapters (the tests/friendinggo.test.mts technique) and this
 * feature's real normalizers. Core's capability block, not the role, admits each route; what reaches the
 * browser is only the parsed answer or a known refusal.
 */

type Json = Record<string, any>;
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/outbound_messaging_contract_v1.json", import.meta.url), "utf8")) as Record<string, Json>;
const clone = <T,>(value: T): T => structuredClone(value);
const SENDER = { contract_version: 1, contract_ready: true, capabilities: ["outbound_messages_history_read", "outbound_messages_send"] };
const VIEWER = { contract_version: 1, contract_ready: true, capabilities: ["outbound_messages_history_read"] };
const HEADERS = { origin: "https://admin.example.test", host: "admin.example.test", "sec-fetch-site": "same-origin", "x-friending-admin-request": "1" };
const TRIO = { message: 200, status: 200, can_send: 0 };
const refusal = (error: string, status_code = OUTBOUND_MESSAGING_ERROR_STATUSES[error as keyof typeof OUTBOUND_MESSAGING_ERROR_STATUSES]) =>
  ({ success: false, status_code, error, ...TRIO });

const preview = outboundPreviewPayload([42])!;
const history = outboundHistoryPayload(42)!;
const detail = outboundHistoryDetailPayload(42, "64f000000000000000000001")!;
const send: OutboundSendPayload = (() => {
  const parsed = outboundRecipientPreviewResponse(fixtures.preview_one, preview)!;
  const result = outboundSendPayload(parsed, [42], {
    channel: "push", contentSource: "custom", templateId: "", templateRevision: 0, subject: "Profile reminder",
    body: "Add a little more about yourself.", allowPartial: 0, auditReason: "Approved reminder",
  }, "123e4567-e89b-42d3-a456-426614174000", parsed.evaluated_at + 10);
  assert.ok(result.ok);
  return result.value;
})();
const ROUTES = {
  outbound_message_preview: { body: preview, answer: fixtures.preview_one },
  send_message: { body: send, answer: fixtures.send_one },
  user_history: { body: history, answer: fixtures.history_page },
  user_history_detail: { body: detail, answer: fixtures.history_detail_email },
} as const;
type Route = keyof typeof ROUTES;

const source = readFileSync(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
const code = ts.transpileModule(tree.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(tree)).join("\n"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const imports: string[] = [];
for (const node of tree.statements) {
  if (!ts.isImportDeclaration(node) || !node.importClause?.namedBindings || !ts.isNamedImports(node.importClause.namedBindings)) continue;
  for (const item of node.importClause.namedBindings.elements) imports.push(item.name.text);
}
function NextResponseStub(body: BodyInit, init: ResponseInit) { return new Response(body, init); }
NextResponseStub.json = (value: unknown, init: ResponseInit) => new Response(JSON.stringify(value), init);

async function bridge(action: string, options: {
  role?: string; block?: unknown; body?: unknown; answer?: { status: number; data: unknown };
  session?: boolean; headers?: Record<string, string>;
} = {}) {
  const forwarded: Array<Record<string, unknown>> = [];
  const route = ROUTES[action as Route];
  const context: any = {
    exports: {}, Buffer, JSON, readBoundedText, ...actions, ADMIN_MEMBERSHIP_UNCONFIRMED, classifyAdminMembership, adminBridgeCoreTransportError,
    webadminErrorEnvelope, isTrustedAdminRequest, withDatesAdminContract, ADMIN_GRANTED_VERIFICATION_CONTRACT_READY: true,
    normalizeOutboundMessagingProxyBody, normalizeOutboundMessagingResponse, outboundMessagingProxyCapabilityAuthorized,
    readAdminSession: async () => (options.session === false ? null : { email: MEMBERSHIP_EMAIL }),
    coreCall: async (name: string, payload: Record<string, unknown>) => {
      assert.equal(payload.admin_email, MEMBERSHIP_EMAIL);
      if (name === "admin_me") {
        return { status: 200, data: { ...MEMBERSHIP_MEMBER, role: options.role ?? "admin", ...(options.block === undefined ? {} : { outbound_messaging: options.block }) } };
      }
      assert.equal(name, action);
      forwarded.push({ ...payload });
      return options.answer ?? { status: 200, data: route.answer };
    },
    mergeCoreParams: (input: Record<string, unknown>, owned: Record<string, unknown>) => ({ ...input, ...owned }),
    datesAvailabilityWriteIsRetired: () => false, isDatesAdminRoute: () => false, NextResponse: NextResponseStub,
  };
  for (const name of imports) if (context[name] === undefined && name !== "NextRequest") context[name] = () => undefined;
  vm.runInNewContext(code, context);
  const response = await context.exports.POST({
    headers: new Headers(options.headers ?? HEADERS), signal: new AbortController().signal,
    body: requestBody(JSON.stringify(options.body ?? route?.body ?? {})).body,
  }, { params: Promise.resolve({ action }) }) as Response;
  return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control"), forwarded };
}

test("DERIVED bridge: each route forwards exactly its closed fields and returns only the parsed answer", async () => {
  for (const action of Object.keys(ROUTES) as Route[]) {
    const result = await bridge(action, { block: SENDER });
    assert.equal(result.status, 200, action);
    assert.equal(result.cache, "no-store");
    assert.deepEqual(result.forwarded, [{ ...ROUTES[action].body, admin_email: MEMBERSHIP_EMAIL }], `${action} forwards its closed body and the session's actor`);
    assert.equal(result.body.success, true);
    assert.deepEqual(Object.keys(result.body).sort(), ["can_send", "data", "message", "status", "status_code", "success"]);
  }
  // Fields Core might add (an address, a phone, a token) never reach the browser: the answer is rebuilt from the parse.
  const leaky = clone(fixtures.preview_one);
  leaky.data.recipients[0].email = "ada@example.com"; leaky.data.recipients[0].channels.token = "fcm-private"; leaky.data.provider = "twilio";
  const projected = await bridge("outbound_message_preview", { block: SENDER, answer: { status: 200, data: leaky } });
  assert.equal(JSON.stringify(projected.body).includes("ada@example.com"), false);
  assert.equal(JSON.stringify(projected.body).includes("fcm-private"), false);
  assert.equal(JSON.stringify(projected.body).includes("twilio"), false);
  const leakyHistory = clone(fixtures.history_page); leakyHistory.data.messages[1].recipient = "+36301234567";
  assert.equal(JSON.stringify((await bridge("user_history", { block: VIEWER, role: "viewer", answer: { status: 200, data: leakyHistory } })).body).includes("+3630"), false);
});

test("DERIVED bridge: a guest, a foreign origin and a bad body reach nothing", async () => {
  for (const action of Object.keys(ROUTES) as Route[]) {
    const guest = await bridge(action, { block: SENDER, session: false });
    assert.deepEqual([guest.status, guest.body.error, guest.forwarded.length], [401, "auth-required", 0], action);
    const foreign = await bridge(action, { block: SENDER, headers: { ...HEADERS, origin: "https://hostile.example.test", "sec-fetch-site": "cross-site" } });
    assert.deepEqual([foreign.status, foreign.body.error, foreign.forwarded.length], [403, "bad-origin", 0], action);
    const extra = await bridge(action, { block: SENDER, body: { ...ROUTES[action].body, admin_email: "attacker@example.test" } });
    assert.deepEqual([extra.status, extra.body.error, extra.forwarded.length], [400, "invalid-input", 0], `${action}: an undeclared field`);
  }
  const loose = await bridge("send_message", { block: SENDER, body: { ...send, allow_partial: true } });
  assert.deepEqual([loose.status, loose.forwarded.length], [400, 0], "the send travels only in its canonical form");
});

test("DERIVED bridge: Core's capability block admits each route, never the role alone", async () => {
  for (const action of Object.keys(ROUTES) as Route[]) {
    const historyRead = action === "user_history" || action === "user_history_detail";
    // A viewer: history yes, preview and send refused before Core with Core's own name.
    const viewer = await bridge(action, { role: "viewer", block: VIEWER });
    assert.equal(viewer.status, historyRead ? 200 : 403, `viewer ${action}`);
    if (!historyRead) assert.deepEqual([viewer.body.error, viewer.forwarded.length], ["outbound-message-send-required", 0]);
    // An owner whose block grants only history (Core's read-only stored role) cannot preview or send either.
    const owner = await bridge(action, { role: "owner", block: VIEWER });
    assert.equal(owner.status, historyRead ? 200 : 403, `history-only owner ${action}`);
    // Without a ready version-1 block nothing is forwarded.
    for (const block of [undefined, { ...SENDER, contract_ready: false }, { ...SENDER, contract_version: 2 }, { ...SENDER, capabilities: ["outbound_messages_send"] }]) {
      const absent = await bridge(action, { role: "owner", block });
      assert.equal(absent.status, 403, `${action} ${JSON.stringify(block)}`);
      assert.equal(absent.body.error, historyRead ? "outbound-message-history-read-required" : "outbound-message-send-required");
      assert.deepEqual(absent.forwarded, []);
    }
  }
  assert.equal(outboundMessagingProxyCapabilityAuthorized("go_preorders", { outbound_messaging: SENDER }), null, "other routes are not this gate's");
  assert.deepEqual(outboundMessagingAccess({ outbound_messaging: SENDER }), { kind: "ready", canSend: true });
  assert.deepEqual(outboundMessagingAccess({ outbound_messaging: VIEWER }), { kind: "ready", canSend: false });
  assert.deepEqual(outboundMessagingAccess({}), { kind: "absent" });
  assert.deepEqual(outboundMessagingAccess({ outbound_messaging: { ...SENDER, contract_version: "1" } }), { kind: "invalid" });
  assert.deepEqual(outboundMessagingAccess({ outbound_messaging: { ...SENDER, capabilities: [...SENDER.capabilities, SENDER.capabilities[0]] } }), { kind: "invalid" });
  assert.deepEqual(outboundMessagingAccess(null), { kind: "invalid" });
});

test("DERIVED bridge: each Core refusal reaches the page as its closed name; a malformed body fails closed", async () => {
  const perAction: Record<Route, string[]> = {
    outbound_message_preview: ["outbound-message-uids-invalid", "outbound-message-recipient-limit", "outbound-message-send-required", "outbound-message-read-failed", "outbound-message-recipient-read-failed", "outbound-message-contract-version-invalid", "outbound-message-parameter-invalid"],
    send_message: Object.keys(OUTBOUND_MESSAGING_ERROR_STATUSES).filter((error) => error.startsWith("outbound-message-")
      && !["outbound-message-recipient-conflict", "outbound-message-cursor-invalid", "outbound-message-message-id-invalid", "outbound-message-not-found", "outbound-message-history-read-required"].includes(error)),
    user_history: ["outbound-message-cursor-invalid", "outbound-message-uids-invalid", "outbound-message-history-read-required", "outbound-message-read-failed", "outbound-message-stored-invalid"],
    user_history_detail: ["outbound-message-not-found", "outbound-message-message-id-invalid", "outbound-message-read-failed", "outbound-message-stored-invalid"],
  };
  for (const [action, errors] of Object.entries(perAction) as Array<[Route, string[]]>) {
    for (const error of errors) {
      const answer = refusal(error);
      const result = await bridge(action, { block: SENDER, answer: { status: 200, data: { ...answer, trace: "internal" } } });
      assert.equal(result.status, 200, `${action} ${error}`);
      assert.deepEqual(result.body, answer, `${action} ${error}: only the envelope's known keys are rebuilt`);
    }
  }
  // The recipient conflict carries Core's fresh preview, parsed; without a parseable one it is not forwarded.
  const conflict = await bridge("send_message", { block: SENDER, answer: { status: 200, data: fixtures.recipient_conflict } });
  assert.equal(conflict.body.error, "outbound-message-recipient-conflict");
  assert.deepEqual(conflict.body.data.preview.recipients[0].channels, { email: "available", sms: "channel_absent", push: "opted_out" });
  const brokenConflict = clone(fixtures.recipient_conflict); brokenConflict.data.preview.recipients[0].uid = 43;
  assert.equal((await bridge("send_message", { block: SENDER, answer: { status: 200, data: brokenConflict } })).body.error, "invalid-core-response");

  const malformed: Array<[Route, (value: Json) => void]> = [
    ["outbound_message_preview", (value) => { value.data.expires_at += 1; }],
    ["outbound_message_preview", (value) => { value.data.principal.capabilities = ["outbound_messages_history_read"]; }],
    ["send_message", (value) => { value.data.request_id = "223e4567-e89b-42d3-a456-426614174000"; }],
    ["send_message", (value) => { value.data.queued = 0; }],
    ["user_history", (value) => { value.data.total = 9; }],
    ["user_history", (value) => { value.data.messages[0].status = "delivered"; }],
    ["user_history_detail", (value) => { value.data.message.body = "<script>alert(1)</script>"; }],
    ["user_history_detail", (value) => { value.data.message.content_sha256 = "0".repeat(64); }],
  ];
  for (const [action, mutate] of malformed) {
    const answer = clone(ROUTES[action].answer) as Json; mutate(answer);
    const result = await bridge(action, { block: SENDER, answer: { status: 200, data: answer } });
    assert.deepEqual([result.status, result.body], [502, { success: false, status_code: 502, error: "invalid-core-response" }], `${action} ${mutate}`);
  }
  for (const data of [refusal("outbound-message-body-invalid", 500), refusal("outbound-message-something-new", 409), { success: false, status_code: 409, error: "outbound-message-preview-expired" }, null, []]) {
    const result = await bridge("send_message", { block: SENDER, answer: { status: 200, data } });
    assert.equal(result.body.error, data === null ? "core-unavailable" : "invalid-core-response", JSON.stringify(data));
  }
  assert.match(source, /if \(outboundMessagingProxyCapabilityAuthorized\(action, membership\.data\) === false\) \{/);
  assert.ok(source.indexOf("outboundMessagingProxyCapabilityAuthorized(action, membership.data)") < source.indexOf("readBoundedText(request.body"), "the gate is decided before the body is read");
  assert.match(source, /const projected = await normalizeOutboundMessagingResponse\(action, result\.data, normalizedOutboundBody\);\s*if \(!projected\) return bridgeError\("invalid-core-response", 502\);/);
});

test("the projection is the parse: a success re-parses to itself in the browser, a refusal keeps its status", async () => {
  for (const action of Object.keys(ROUTES) as Route[]) {
    const body = Object.assign(Object.create(null), ROUTES[action].body);
    const once = await normalizeOutboundMessagingResponse(action, ROUTES[action].answer, body);
    assert.ok(once, action);
    const twice = await normalizeOutboundMessagingResponse(action, once.body, body);
    assert.deepEqual(twice, once, `${action}: the page's parser accepts the bridge's answer unchanged`);
  }
  assert.equal(await normalizeOutboundMessagingResponse("go_preorders", fixtures.preview_one, {}), null);
  assert.deepEqual(await normalizeOutboundMessagingResponse("user_history", refusal("outbound-message-cursor-invalid"), history),
    { status_code: 422, body: refusal("outbound-message-cursor-invalid") });
  assert.equal(await normalizeOutboundMessagingResponse("user_history", fixtures.history_page, { ...history, page_size: 2 }), null, "an answer to another request");
  assert.ok(normalizeOutboundMessagingProxyBody("send_message", { ...send }));
});
