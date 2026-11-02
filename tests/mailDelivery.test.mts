import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as actions from "../lib/adminActions.ts";
import { ADMIN_MEMBERSHIP_UNCONFIRMED, classifyAdminMembership } from "../lib/adminMembership.ts";
import { adminBridgeCoreTransportError } from "../lib/adminBridge.ts";
import { isAdminClientReadAction } from "../lib/adminClientReadActions.ts";
import { webadminErrorEnvelope } from "../lib/webadminEnvelope.ts";
import { isTrustedAdminRequest } from "../lib/requestGuard.ts";
import { withDatesAdminContract } from "../lib/datesAdminContract.ts";
import {
  DEFAULT_MAIL_DELIVERY_FILTERS,
  MAIL_DELIVERY_KINDS,
  MAIL_DELIVERY_ROW_STATES,
  MAIL_DELIVERY_STATES,
  mailDelivery,
  mailDeliveryAddress,
  mailDeliveryFailure,
  normalizeMailDeliveryProxyBody,
  normalizeMailDeliveryResponse,
  type MailDeliveryFilters,
} from "../lib/mailDelivery.ts";
import { MEMBERSHIP_EMAIL, MEMBERSHIP_MEMBER } from "./support/adminMembershipCases.mts";

type Json = Record<string, any>;

/**
 * DERIVED answer in the shape of Freelove Core's `MailDeliveryReadService::read` (8eb62bd3, with the
 * review fix's `sync_attempted_at` / `sync_failed_at`): a delivered code a receiving server held
 * back once with a 421, a queued admin code still waiting, and an email that was never sent.
 */
const ROWS = [
  {
    id: "6720f0c2a1b2c3d4e5f60718", kind: "email_auth_verification", recipient: "bela@example.hu", recipient_domain: "example.hu",
    created_at: 1793499000, handed_at: 1793499000.2, delivered_at: 1793499634.2, delivery_seconds: 634, state: "delivered",
    send_error: "", delivery_attempts: 2, temporary_failures: 1, issue: { code: 421, message: "4.4.2 Connection timed out for <address>" },
  },
  {
    id: "6720f0c2a1b2c3d4e5f60719", kind: "admin_login_verification", recipient: "anna@gmail.com", recipient_domain: "gmail.com",
    created_at: 1793498000, handed_at: 1793498012.5, delivered_at: null, delivery_seconds: null, state: "pending",
    send_error: "", delivery_attempts: null, temporary_failures: 0, issue: null,
  },
  {
    id: "6720f0c2a1b2c3d4e5f6071a", kind: "other", recipient: "", recipient_domain: "",
    created_at: 1793497000, handed_at: null, delivered_at: null, delivery_seconds: null, state: "not_sent",
    send_error: "provider_rejected", delivery_attempts: null, temporary_failures: 0, issue: null,
  },
];
const MASKED = ["be•••@example.hu", "an•••@gmail.com", ""];
const DATA = {
  filters: { days: 1, kind: "", state: "", email: "" },
  summary: {
    total: 3, counts: { delivered: 1, pending: 1, retrying: 0, failed: 0, not_sent: 1 },
    median_seconds: 634, p90_seconds: 634, max_seconds: 634, slow: 1,
    by_domain: [
      { domain: "example.hu", total: 1, delivered: 1, median_seconds: 634, max_seconds: 634, slow: 1 },
      { domain: "gmail.com", total: 1, delivered: 0, median_seconds: null, max_seconds: null, slow: 0 },
      { domain: "?", total: 1, delivered: 0, median_seconds: null, max_seconds: null, slow: 0 },
    ],
  },
  rows: ROWS, page: 1, has_more: false, slow_seconds: 60,
  synced_at: 1793500000, sync_attempted_at: 1793500060, sync_failed_at: 1793500060, can_see_addresses: true,
};
const ANSWER = { success: true, status_code: 200, data: DATA, message: 200, status: 200, can_send: 0 };
const FILTERS: MailDeliveryFilters = { ...DEFAULT_MAIL_DELIVERY_FILTERS };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function masked(): Json {
  const body = clone(ANSWER) as Json;
  body.data.can_see_addresses = false;
  body.data.rows.forEach((row: Json, index: number) => { row.recipient = MASKED[index]; });
  return body;
}
function refused(change: (data: Json, body: Json) => void, why: string, filters = FILTERS, base: Json = ANSWER): void {
  const body = clone(base) as Json;
  change(body.data, body);
  assert.equal(mailDelivery(body, filters), null, why);
}

test("Email delivery: Core's complete answer is read in full, nothing added or dropped", () => {
  const parsed = mailDelivery(ANSWER, FILTERS);
  assert.ok(parsed);
  assert.deepEqual(parsed, DATA);
  assert.ok(mailDelivery(masked(), FILTERS), "a viewer's masked answer");
  const { message: _message, status: _status, can_send: _canSend, ...withoutTrio } = ANSWER;
  assert.ok(mailDelivery(withoutTrio, FILTERS), "with and without the legacy trio");
  // Before the first complete poll; and a later good poll that cleared the failure.
  refusedNot((data) => { data.synced_at = null; data.sync_attempted_at = null; data.sync_failed_at = null; });
  refusedNot((data) => { data.synced_at = 1793500120; data.sync_attempted_at = 1793500120; data.sync_failed_at = null; });
  refusedNot((data) => { data.synced_at = null; data.sync_attempted_at = 1793500060; data.sync_failed_at = 1793500060; });
});

function refusedNot(change: (data: Json) => void): void {
  const body = clone(ANSWER) as Json;
  change(body.data);
  assert.ok(mailDelivery(body, FILTERS), JSON.stringify(body.data).slice(0, 60));
}

test("Email delivery: a partial, loosely typed or self-contradicting answer is never a list", () => {
  for (const value of [null, [], { success: false }, { ...ANSWER, status_code: 422 }, { ...ANSWER, status_code: undefined },
    { ...ANSWER, error: "x" }, { ...ANSWER, success: "true" }, { ...ANSWER, data: [] }]) {
    assert.equal(mailDelivery(value, FILTERS), null, JSON.stringify(value)?.slice(0, 60));
  }
  refused((data) => { delete data.rows; }, "rows missing");
  refused((data) => { delete data.sync_failed_at; }, "the review fix's sync fields are required");
  refused((data) => { data.synced_at = "now"; }, "a loosely typed time");
  refused((data) => { data.synced_at = 1793500060.5; }, "a fractional poll time");
  refused((data) => { data.sync_failed_at = data.synced_at; }, "a failure no newer than the last complete poll");
  refused((data) => { data.sync_attempted_at = data.synced_at - 1; data.sync_failed_at = null; }, "an attempt older than the poll it made");
  refused((data) => { data.sync_attempted_at = null; }, "a poll without an attempt");
  refused((data) => { data.can_see_addresses = "yes"; }, "a loose masking flag");
  refused((data) => { data.slow_seconds = 0; }, "no slow limit");
  refused((data) => { data.has_more = true; }, "more pages behind a short page");
  refused((data) => { data.rows = [...data.rows, ...data.rows].slice(0, 51); }, "an oversized page");
  refused((data) => { data.rows[1] = data.rows[0]; }, "a duplicate row");
  refused((data) => { data.rows.reverse(); }, "rows not newest first");
  refused((data) => { data.rows[0].id = "../x"; }, "an unsafe id");
  refused((data) => { data.rows[0].state = "lost"; }, "an unknown state");
  refused((data) => { data.rows[0].kind = "newsletter"; }, "a kind Core reports as other");
  refused((data) => { data.rows[0].delivery_seconds = 10; }, "a delivery time that is not delivered minus handed");
  refused((data) => { data.rows[1].delivery_seconds = 5; }, "a delivery time without a delivery");
  refused((data) => { data.rows[0].send_error = "rejected"; }, "a send error on a handed email");
  refused((data) => { data.rows[0].issue = { code: 421 }; }, "an issue without its answer");
  refused((data) => { data.rows[0].issue.message = "é".repeat(201); }, "an issue over 200 characters");
  refused((data) => { data.rows[0].temporary_failures = -1; }, "a negative count");
  refused((data) => { data.rows[0].recipient = "be•••@example.hu"; }, "a mask in an unmasked view");
  refused((data) => { data.rows[0].recipient = "bela@example.hu"; }, "an address in a masked view", FILTERS, masked());
  refused((data) => { delete data.summary.counts.not_sent; }, "a missing state count");
  refused((data) => { data.summary.counts.lost = 0; }, "an unknown state count");
  refused((data) => { data.summary.total = 4; }, "a total that is not the sum of the states");
  refused((data) => { data.summary.median_seconds = 700; }, "a median above the slowest");
  refused((data) => { data.summary.p90_seconds = null; }, "a missing percentile beside the others");
  refused((data) => { data.summary.slow = 0; }, "a slow delivery that is not counted");
  refused((data) => { data.summary.by_domain[0].slow = 2; }, "more slow than delivered in a domain");
  refused((data) => { data.summary.by_domain[1].domain = "example.hu"; }, "a repeated domain");
  refused((data) => { data.summary.by_domain[1].median_seconds = 5; }, "a domain median without a delivery");
  refused((data) => { data.summary.by_domain.push({ ...data.summary.by_domain[1], domain: "x.hu" }); }, "domains over the total");
});

test("Email delivery: the answer belongs to the filters that asked, row by row", () => {
  refused((data) => { data.filters.days = 7; }, "another period");
  refused((data) => { data.page = 2; }, "another page");
  refused((data) => { data.filters.extra = 1; }, "an unknown echo");
  const kind = { ...FILTERS, kind: "email_auth_verification" as const };
  refused((data) => { data.filters.kind = kind.kind; }, "a row of another kind", kind);
  const slow = { ...FILTERS, state: "slow" as const };
  refused((data) => { data.filters.state = "slow"; }, "a row that is not slow", slow);
  const slowAnswer = clone(ANSWER) as Json;
  slowAnswer.data.filters.state = "slow";
  slowAnswer.data.rows = [slowAnswer.data.rows[0]];
  assert.ok(mailDelivery(slowAnswer, slow), "the slow row alone");
  const email = { ...FILTERS, email: "anna@gmail.com" };
  refused((data) => { data.filters.email = email.email; }, "a row for another address", email);
  // A masked view cannot show the address the filter matched; Core's own filter is the authority there.
  const maskedEmail = masked();
  maskedEmail.data.filters.email = email.email;
  assert.ok(mailDelivery(maskedEmail, email));
  // Without a state filter the list never outnumbers the summary's population.
  refused((data) => { data.summary.total = 2; data.summary.counts.not_sent = 0; data.summary.by_domain.pop(); }, "rows beyond the summary");
});

test("Email delivery: the bridge forwards only the closed filters, canonical and with defaults left out", () => {
  assert.deepEqual(normalizeMailDeliveryProxyBody("mail_delivery", {}), { days: 1, page: 1 });
  assert.deepEqual(normalizeMailDeliveryProxyBody("mail_delivery", { ...DEFAULT_MAIL_DELIVERY_FILTERS }), { days: 1, page: 1 });
  assert.deepEqual(
    normalizeMailDeliveryProxyBody("mail_delivery", { days: 7, kind: "email_auth_verification", state: "slow", email: " Anna@Gmail.com ", page: 2 }),
    { days: 7, page: 2, kind: "email_auth_verification", state: "slow", email: "anna@gmail.com" },
  );
  for (const body of [{ days: 2 }, { days: "7" }, { kind: "everything" }, { state: "lost" }, { email: "not an address" }, { email: "a@b" },
    { email: 1 }, { page: 0 }, { page: 1.5 }, { page: 10000 }, { extra: 1 }, { admin_email: "x@example.test" }, { days: null }]) {
    assert.equal(normalizeMailDeliveryProxyBody("mail_delivery", body as Json), null, JSON.stringify(body));
  }
  assert.equal(normalizeMailDeliveryProxyBody("list_users", { anything: 1 }), undefined);
  assert.equal(mailDeliveryAddress(" Name.Surname+tag@Example.co.uk "), "name.surname+tag@example.co.uk");
  for (const value of ["", "name", "name@", "@example.com", "a b@example.com", "név@example.hu", `${"a".repeat(65)}@example.com`]) {
    assert.equal(mailDeliveryAddress(value), null, value);
  }
  assert.deepEqual(MAIL_DELIVERY_STATES.filter((state) => state !== "slow"), [...MAIL_DELIVERY_ROW_STATES]);
});

test("Email delivery: an allow-listed read any active administrator may run, never a recovery loader", () => {
  assert.equal(actions.ADMIN_ACTIONS.filter((action) => action === "mail_delivery").length, 1);
  assert.equal(actions.adminActionAccess("mail_delivery"), "read");
  for (const role of ["viewer", "admin", "owner"]) {
    assert.equal(actions.isAdminActionAuthorized("mail_delivery", actions.adminPrincipalFrom({ role })), true, role);
  }
  assert.equal(isAdminClientReadAction("mail_delivery"), true);
});

// The actual production POST, run with controlled session, membership and Core adapters (the
// tests/adminMembershipBridge.test.mts technique), and this feature's real normalizers.
const routeSource = readFileSync(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8");
const routeTree = ts.createSourceFile("route.ts", routeSource, ts.ScriptTarget.Latest, true);
const routeCode = ts.transpileModule(routeTree.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(routeTree)).join("\n"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

async function bridge(role: string, body: unknown, answer: { status: number; data: unknown }) {
  const forwarded: Array<Record<string, unknown>> = [];
  const context: any = {
    exports: {}, Buffer, JSON, ...actions, ADMIN_MEMBERSHIP_UNCONFIRMED, classifyAdminMembership, adminBridgeCoreTransportError,
    webadminErrorEnvelope, isTrustedAdminRequest, withDatesAdminContract, ADMIN_GRANTED_VERIFICATION_CONTRACT_READY: true,
    normalizeMailDeliveryProxyBody, normalizeMailDeliveryResponse,
    readAdminSession: async () => ({ email: MEMBERSHIP_EMAIL }),
    coreCall: async (name: string, payload: Record<string, unknown>) => {
      assert.equal(payload.admin_email, MEMBERSHIP_EMAIL);
      if (name === "admin_me") return { status: 200, data: { ...MEMBERSHIP_MEMBER, role } };
      assert.equal(name, "mail_delivery");
      forwarded.push(payload);
      return answer;
    },
    mergeCoreParams: (input: Record<string, unknown>, owned: Record<string, unknown>) => ({ ...input, ...owned }),
    datesAvailabilityWriteIsRetired: () => false, isDatesAdminRoute: () => false,
    NextResponse: { json: (value: unknown, options: ResponseInit) => new Response(JSON.stringify(value), options) },
  };
  for (const node of routeTree.statements) {
    if (!ts.isImportDeclaration(node) || !node.importClause?.namedBindings || !ts.isNamedImports(node.importClause.namedBindings)) continue;
    for (const item of node.importClause.namedBindings.elements) {
      if (context[item.name.text] === undefined && item.name.text !== "NextRequest") context[item.name.text] = () => undefined;
    }
  }
  vm.runInNewContext(routeCode, context);
  const headers = new Headers({ origin: "https://admin.example.test", host: "admin.example.test", "sec-fetch-site": "same-origin", "x-friending-admin-request": "1" });
  const response = await context.exports.POST({ headers, signal: new AbortController().signal, text: async () => JSON.stringify(body) },
    { params: Promise.resolve({ action: "mail_delivery" }) }) as Response;
  return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control"), forwarded };
}

test("DERIVED bridge: the browser receives only the parsed answer for the filters it sent", async () => {
  const result = await bridge("owner", { ...DEFAULT_MAIL_DELIVERY_FILTERS }, { status: 200, data: ANSWER });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { success: true, status_code: 200, data: DATA }, "no legacy trio, no unparsed key");
  assert.equal(result.cache, "no-store");
  assert.deepEqual(result.forwarded, [{ days: 1, page: 1, admin_email: MEMBERSHIP_EMAIL }]);
  const extra = clone(ANSWER) as Json;
  extra.data.rows[0].internal_note = "never forwarded";
  assert.equal(JSON.stringify((await bridge("admin", {}, { status: 200, data: extra })).body).includes("internal_note"), false);
  const searched = await bridge("admin", { days: 30, state: "failed", email: "Anna@Gmail.com", page: 3 }, { status: 200, data: ANSWER });
  assert.deepEqual(searched.forwarded, [{ days: 30, page: 3, state: "failed", email: "anna@gmail.com", admin_email: MEMBERSHIP_EMAIL }]);
  assert.deepEqual(searched.body, { success: false, status_code: 502, error: "invalid-core-response" }, "an answer for other filters");
});

test("DERIVED bridge: a viewer never receives unmasked addresses, whatever Core sends", async () => {
  const leak = await bridge("viewer", {}, { status: 200, data: ANSWER });
  assert.equal(leak.status, 502);
  assert.deepEqual(leak.body, { success: false, status_code: 502, error: "invalid-core-response" });
  assert.equal(JSON.stringify(leak.body).includes("bela@example.hu"), false);
  const fine = await bridge("viewer", {}, { status: 200, data: masked() });
  assert.equal(fine.status, 200);
  assert.equal(fine.body.data.can_see_addresses, false);
  assert.equal(fine.body.data.rows[0].recipient, "be•••@example.hu");
});

test("DERIVED bridge: bad filters never reach Core; a malformed success is unknown; a named refusal is kept", async () => {
  for (const body of [{ days: 2 }, { email: "nope" }, { extra: 1 }, { admin_email: "other@example.test" }]) {
    const result = await bridge("owner", body, { status: 200, data: ANSWER });
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.deepEqual(result.forwarded, []);
  }
  const broken = clone(ANSWER) as Json;
  broken.data.summary.total = 99;
  for (const answer of [{ status: 200, data: broken }, { status: 201, data: ANSWER }]) {
    const result = await bridge("owner", {}, answer);
    assert.deepEqual(result.body, { success: false, status_code: 502, error: "invalid-core-response" });
  }
  const refusal = { success: false, status_code: 422, error: "invalid-input", message: 200, status: 200, can_send: 0 };
  const result = await bridge("owner", {}, { status: 200, data: refusal });
  assert.deepEqual(result.body, refusal);
  assert.equal(mailDeliveryFailure(result.body), "invalid");
  assert.equal(mailDeliveryFailure({ success: false, status_code: 502, error: "invalid-core-response" }), "error");
  assert.equal(mailDeliveryFailure(null), "error");
});

test("DERIVED bridge projection: the route wires the normalizers and refuses before forwarding", () => {
  assert.match(routeSource, /const mailDeliveryBody = normalizeMailDeliveryProxyBody\(action, body\);\s*if \(mailDeliveryBody === null\) \{\s*return bridgeError\("invalid-input", 400\);/);
  assert.match(routeSource, /normalizeMailDeliveryResponse\(result\.data, mailDeliveryBody, \{ viewer: principal\.role !== "owner" && principal\.role !== "admin" \}\)/);
  assert.ok(routeSource.indexOf("normalizeMailDeliveryProxyBody(action, body)") < routeSource.indexOf("const result = await coreCall("));
});
