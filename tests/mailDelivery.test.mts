import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
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
  type MailDelivery,
  type MailDeliveryFilters,
} from "../lib/mailDelivery.ts";
import { MailDeliveryView, type MailDeliveryLoad } from "../components/MailDeliveryConsole.tsx";
import { MEMBERSHIP_EMAIL, MEMBERSHIP_MEMBER } from "./support/adminMembershipCases.mts";

type Json = Record<string, any>;

/**
 * Friending Core's genuine `/v1/webadmin/mail_delivery` response bodies, byte for byte: written by
 * Core's committed `mail_delivery_events_storage_test` (c9f55b08, `MAIL_DELIVERY_WIRE_CAPTURE_DIR`)
 * against the read of e7673d0f (+ comment-only 4fdee6b1), Core tip 355b8ae4. Timestamps are real
 * time, so a regeneration changes the bytes but not the shape; re-vendor with the new hashes.
 *
 * - owner-30-days: an owner, `days=30`. A support request to a mixed-case stored address, an erased
 *   member (empty recipient, domain `?`), a queued `other`, a never-sent code with its send error, a
 *   1.2 s delivery after one temporary refusal (an issue without code or text), a 550 bounce, the
 *   634 s delivery a 421 held back, and an old pending code.
 * - viewer-30-days-slow: a viewer, `days=30`, `state=slow`: the 634 s delivery, address masked (the
 *   bullet escaped as • on the wire).
 * - refusal-invalid-input: an owner, `days=365`.
 */
const WIRE = new URL("./fixtures/mail_delivery_wire/", import.meta.url);
const CORE_SOURCE_COMMIT = "e7673d0f";
const CAPTURES = {
  "owner-30-days.json": "d941a083eb2a9f50e15a86d3307a5994d9ad2374353b09b585b6ceb3baccf2b4",
  "viewer-30-days-slow.json": "9eace120a792af3e7352a49f73aef56a1420f95c02edf409279dbcad94dfd435",
  "refusal-invalid-input.json": "4289c574e2487a28aa491a01071a45a2d71d39db36f78acc70726149d8b951cf",
} as const;
const raw = (name: keyof typeof CAPTURES) => readFileSync(new URL(name, WIRE));
const OWNER = JSON.parse(raw("owner-30-days.json").toString("utf8")) as Json;
const VIEWER = JSON.parse(raw("viewer-30-days-slow.json").toString("utf8")) as Json;
const REFUSAL = JSON.parse(raw("refusal-invalid-input.json").toString("utf8")) as Json;
const OWNER_FILTERS: MailDeliveryFilters = { ...DEFAULT_MAIL_DELIVERY_FILTERS, days: 30 };
const VIEWER_FILTERS: MailDeliveryFilters = { ...OWNER_FILTERS, state: "slow" };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
/** Core's `MailDeliveryReadService::mask`: at most two leading characters, the mask, then `@domain`. */
function mask(address: string): string {
  const at = address.lastIndexOf("@");
  return at < 0 ? "" : `${[...address.slice(0, at)].slice(0, 2).join("")}•••${address.slice(at)}`;
}
/** The owner capture as Core would answer a viewer (the same rows, addresses masked). */
function maskedOwner(): Json {
  const body = clone(OWNER);
  body.data.can_see_addresses = false;
  for (const row of body.data.rows) row.recipient = mask(row.recipient);
  return body;
}
function variant(change: (data: Json, body: Json) => void, base: Json = OWNER): Json {
  const body = clone(base);
  change(body.data, body);
  return body;
}
function refused(change: (data: Json, body: Json) => void, why: string, filters = OWNER_FILTERS, base: Json = OWNER): void {
  assert.equal(mailDelivery(variant(change, base), filters), null, why);
}
function accepted(change: (data: Json, body: Json) => void, why: string, filters = OWNER_FILTERS, base: Json = OWNER): MailDelivery {
  const parsed = mailDelivery(variant(change, base), filters);
  assert.ok(parsed, why);
  return parsed;
}

test("the vendored captures are byte-identical to Core's", () => {
  for (const [name, sha] of Object.entries(CAPTURES)) {
    assert.equal(createHash("sha256").update(raw(name as keyof typeof CAPTURES)).digest("hex"), sha,
      `tests/fixtures/mail_delivery_wire/${name} must stay byte-identical to Core's capture (read source ${CORE_SOURCE_COMMIT})`);
  }
  assert.equal(OWNER.data.rows.length, 8);
  assert.ok(raw("viewer-30-days-slow.json").toString("utf8").includes("be\\u2022\\u2022\\u2022@zsakmany.hu"), "the mask arrives escaped");
  assert.deepEqual(REFUSAL, { success: false, status_code: 422, error: "invalid-input", message: 200, status: 200, can_send: 0 });
});

test("Core's captures are read in full, nothing added or dropped", () => {
  assert.deepEqual(mailDelivery(OWNER, OWNER_FILTERS), OWNER.data);
  assert.deepEqual(mailDelivery(VIEWER, VIEWER_FILTERS, { viewer: true }), VIEWER.data);
  assert.equal(mailDelivery(VIEWER, VIEWER_FILTERS)?.rows[0]?.recipient, "be•••@zsakmany.hu");
  assert.equal(mailDelivery(OWNER, OWNER_FILTERS, { viewer: true }), null, "the viewer floor refuses unmasked addresses");
  assert.ok(mailDelivery(maskedOwner(), OWNER_FILTERS, { viewer: true }), "the same rows masked");
  const { message: _message, status: _status, can_send: _canSend, ...withoutTrio } = OWNER;
  assert.ok(mailDelivery(withoutTrio, OWNER_FILTERS), "with and without the legacy trio");
  assert.equal(mailDelivery(REFUSAL, OWNER_FILTERS), null);
  assert.equal(mailDeliveryFailure(REFUSAL), "invalid");
});

test("the cases Core listed are accepted: erased members, zero seconds, one-character masks, bounces, whole numbers", () => {
  // An erased member: no recipient in either view, counted under domain `?`.
  const owner = mailDelivery(OWNER, OWNER_FILTERS)!;
  const erased = owner.rows.find((row) => row.recipient === "")!;
  assert.equal(erased.recipient_domain, "");
  assert.ok(owner.summary.by_domain.some((entry) => entry.domain === "?"));
  assert.equal(mailDelivery(maskedOwner(), OWNER_FILTERS)!.rows.find((row) => row.id === erased.id)!.recipient, "");
  // A delivery stamped before Core's own acceptance reads 0 seconds, never negative.
  const zero = accepted((data) => {
    const row = data.rows.find((entry: Json) => entry.recipient === "anna@gmail.com");
    row.handed_at = 1793636809.4; row.delivered_at = 1793636809; row.delivery_seconds = 0;
    const gmail = data.summary.by_domain.find((entry: Json) => entry.domain === "gmail.com");
    gmail.median_seconds = 0; gmail.max_seconds = 0;
  }, "zero seconds");
  assert.equal(zero.rows.find((row) => row.recipient === "anna@gmail.com")!.delivery_seconds, 0);
  // A one-character local part masks as one character.
  const one = (data: Json) => { data.rows.find((entry: Json) => entry.recipient === "queued@example.test").recipient = "q@example.test"; };
  accepted(one, "one character, unmasked");
  const masked = accepted((data) => {
    data.can_see_addresses = false;
    for (const row of data.rows) row.recipient = mask(row.recipient === "queued@example.test" ? "q@example.test" : row.recipient);
  }, "one character, masked");
  assert.ok(masked.rows.some((row) => row.recipient === "q•••@example.test"));
  // A delayed bounce: failed, with its delivery time kept.
  const bounce = accepted((data) => {
    data.rows.find((entry: Json) => entry.recipient === "bela@zsakmany.hu").state = "failed";
    data.summary.counts.delivered -= 1; data.summary.counts.failed += 1;
  }, "a delayed bounce");
  const bounced = bounce.rows.find((row) => row.recipient === "bela@zsakmany.hu")!;
  assert.equal(bounced.state, "failed");
  assert.equal(bounced.delivery_seconds, 634);
  // Whole numbers arrive without a fraction; Core's acceptance is an integer, Mailgun's a fraction.
  const bela = owner.rows.find((row) => row.recipient === "bela@zsakmany.hu")!;
  assert.ok(Number.isInteger(bela.delivery_seconds) && Number.isInteger(bela.handed_at));
  assert.equal(owner.rows.find((row) => row.recipient === "anna@gmail.com")!.handed_at, 1793636807.8);
  // A temporary refusal can leave an issue without a code or text.
  assert.deepEqual(owner.rows.find((row) => row.recipient === "anna@gmail.com")!.issue, { code: null, message: "" });
  // Before the first complete poll; and after a later failed one.
  accepted((data) => { data.synced_at = null; data.sync_attempted_at = null; }, "never polled");
  accepted((data) => { data.sync_attempted_at = data.synced_at + 60; data.sync_failed_at = data.synced_at + 60; }, "a later failed poll");
  accepted((data) => { data.synced_at = null; data.sync_failed_at = data.sync_attempted_at; }, "only failed polls");
});

test("Email delivery: a partial, loosely typed or self-contradicting answer is never a list", () => {
  for (const value of [null, [], { success: false }, { ...OWNER, status_code: 422 }, { ...OWNER, status_code: undefined },
    { ...OWNER, error: "x" }, { ...OWNER, success: "true" }, { ...OWNER, data: [] }]) {
    assert.equal(mailDelivery(value, OWNER_FILTERS), null, JSON.stringify(value)?.slice(0, 60));
  }
  // By id: a masked view no longer carries the address. bela@zsakmany.hu (634 s, 421) and the queued `other`.
  const bela = (data: Json) => data.rows.find((row: Json) => row.id === "6ae8ba2cb1e77fd9630cc363");
  const queued = (data: Json) => data.rows.find((row: Json) => row.id === "6ae8ba2cb1e77fd9630cc371");
  refused((data) => { delete data.rows; }, "rows missing");
  refused((data) => { delete data.sync_failed_at; }, "the review fix's sync fields are required");
  refused((data) => { data.synced_at = "now"; }, "a loosely typed time");
  refused((data) => { data.synced_at += 0.5; }, "a fractional poll time");
  refused((data) => { data.sync_failed_at = data.synced_at; }, "a failure no newer than the last complete poll");
  refused((data) => { data.sync_attempted_at = data.synced_at - 1; }, "an attempt older than the poll it made");
  refused((data) => { data.sync_attempted_at = null; }, "a poll without an attempt");
  refused((data) => { data.can_see_addresses = "yes"; }, "a loose masking flag");
  refused((data) => { data.slow_seconds = 0; }, "no slow limit");
  refused((data) => { data.has_more = true; }, "more pages behind a short page");
  refused((data) => { data.rows = Array.from({ length: 51 }, () => data.rows[0]); }, "an oversized page");
  refused((data) => { data.rows[1] = data.rows[0]; }, "a duplicate row");
  refused((data) => { data.rows.reverse(); }, "rows not newest first");
  refused((data) => { data.rows[0].id = "../x"; }, "an unsafe id");
  refused((data) => { data.rows[0].state = "lost"; }, "an unknown state");
  refused((data) => { data.rows[0].kind = "moderation_report"; }, "a Freelove kind Friending Core reports as other");
  refused((data) => { bela(data).delivery_seconds = 10; }, "a delivery time that is not delivered minus handed");
  refused((data) => { bela(data).delivery_seconds = -1; }, "a negative delivery time");
  refused((data) => { queued(data).delivery_seconds = 5; }, "a delivery time without a delivery");
  refused((data) => { bela(data).send_error = "rejected"; }, "a send error on a handed email");
  refused((data) => { bela(data).issue = { code: 421 }; }, "an issue without its answer");
  refused((data) => { bela(data).issue.message = "é".repeat(201); }, "an issue over 200 characters");
  refused((data) => { bela(data).temporary_failures = -1; }, "a negative count");
  refused((data) => { bela(data).created_at = 0; }, "a row without a creation time");
  refused((data) => { bela(data).recipient = "be•••@zsakmany.hu"; }, "a mask in an unmasked view");
  refused((data) => { bela(data).recipient = "bela@zsakmany.hu"; }, "an address in a masked view", OWNER_FILTERS, maskedOwner());
  refused((data) => { data.rows[0].recipient = "no-at-sign"; }, "a recipient that is not an address");
  refused((data) => { bela(data).recipient_domain = "Zsakmany.HU"; }, "a domain Core did not normalize");
  refused((data) => { delete data.summary.counts.not_sent; }, "a missing state count");
  refused((data) => { data.summary.counts.lost = 0; }, "an unknown state count");
  refused((data) => { data.summary.total = 9; }, "a total that is not the sum of the states");
  refused((data) => { data.summary.median_seconds = 700; }, "a median above the slowest");
  refused((data) => { data.summary.p90_seconds = null; }, "a missing percentile beside the others");
  refused((data) => { data.summary.slow = 0; }, "a slow delivery that is not counted");
  refused((data) => { data.summary.by_domain[0].slow = 2; }, "more slow than delivered in a domain");
  refused((data) => { data.summary.by_domain[1].domain = "zsakmany.hu"; }, "a repeated domain");
  refused((data) => { data.summary.by_domain[2].median_seconds = 5; }, "a domain median without a delivery");
  refused((data) => { data.summary.by_domain.push({ ...data.summary.by_domain[4], domain: "x.hu" }); }, "domains over the total");
});

test("Email delivery: the answer belongs to the filters that asked, row by row", () => {
  refused((data) => { data.filters.days = 7; }, "another period");
  refused((data) => { data.page = 2; }, "another page");
  refused((data) => { data.filters.extra = 1; }, "an unknown echo");
  assert.equal(mailDelivery(OWNER, { ...OWNER_FILTERS, days: 1 }), null, "an answer for another period");
  const kind = { ...OWNER_FILTERS, kind: "email_auth_verification" as const };
  refused((data) => { data.filters.kind = kind.kind; }, "a row of another kind", kind);
  // The slow view: Core's own capture holds the one slow row; a faster one beside it is refused.
  refused((data) => {
    const anna = OWNER.data.rows.find((row: Json) => row.recipient === "anna@gmail.com");
    data.rows = [{ ...anna, recipient: mask(anna.recipient) }, ...data.rows];
  }, "a row that is not slow", VIEWER_FILTERS, VIEWER);
  // Core matches the address in any letter case and shows it as the outbox stored it.
  const email = { ...OWNER_FILTERS, email: "mixed.case@example.test" };
  const stored = variant((data) => { data.filters.email = email.email; data.rows = [data.rows[0]]; });
  assert.equal(mailDelivery(stored, email)?.rows[0]?.recipient, "Mixed.Case@Example.TEST", "the stored letter case");
  refused((data) => { data.filters.email = "mixed.case@example.tes"; data.rows = [data.rows[0]]; }, "another address",
    { ...OWNER_FILTERS, email: "mixed.case@example.tes" });
  // A masked view cannot show the address the filter matched; Core's own filter is the authority there.
  const maskedEmail = variant((data) => { data.filters.email = email.email; data.rows = [data.rows[0]]; }, maskedOwner());
  assert.ok(mailDelivery(maskedEmail, email));
  // Without a state filter the list never outnumbers the summary's population.
  refused((data) => { data.summary.total = 7; data.summary.counts.not_sent = 2; data.summary.by_domain.pop(); }, "rows beyond the summary");
});

test("Email delivery: the bridge forwards only the closed filters, canonical and with defaults left out", () => {
  assert.deepEqual(normalizeMailDeliveryProxyBody("mail_delivery", {}), { days: 1, page: 1 });
  assert.deepEqual(normalizeMailDeliveryProxyBody("mail_delivery", { ...DEFAULT_MAIL_DELIVERY_FILTERS }), { days: 1, page: 1 });
  assert.deepEqual(
    normalizeMailDeliveryProxyBody("mail_delivery", { days: 7, kind: "email_auth_verification", state: "slow", email: " Anna@Gmail.com ", page: 2 }),
    { days: 7, page: 2, kind: "email_auth_verification", state: "slow", email: "anna@gmail.com" },
  );
  for (const body of [{ days: 2 }, { days: 365 }, { days: "7" }, { kind: "everything" }, { state: "lost" }, { email: "not an address" },
    { email: "a@b" }, { email: 1 }, { page: 0 }, { page: 1.5 }, { page: 10000 }, { extra: 1 }, { admin_email: "x@example.test" }, { days: null }]) {
    assert.equal(normalizeMailDeliveryProxyBody("mail_delivery", body as Json), null, JSON.stringify(body));
  }
  assert.equal(normalizeMailDeliveryProxyBody("list_users", { anything: 1 }), undefined);
  assert.equal(mailDeliveryAddress(" Name.Surname+tag@Example.co.uk "), "name.surname+tag@example.co.uk");
  for (const value of ["", "name", "name@", "@example.com", "a b@example.com", "név@example.hu", `${"a".repeat(65)}@example.com`]) {
    assert.equal(mailDeliveryAddress(value), null, value);
  }
  assert.deepEqual(MAIL_DELIVERY_STATES.filter((state) => state !== "slow"), [...MAIL_DELIVERY_ROW_STATES]);
});

test("Email delivery: the type filter is Friending Core's closed outbox vocabulary, not Freelove's", () => {
  // MailDeliveryReadService::KINDS in Friending Core. Freelove's moderation_report and legacy_engagement are not
  // Friending kinds; Core reports any kind outside its list as `other`.
  assert.deepEqual([...MAIL_DELIVERY_KINDS], [
    "email_auth_verification", "email_change_verification", "admin_login_verification", "admin_outbound_message",
    "user_report", "moderation_footprint_report", "support_request",
  ]);
  for (const kind of ["moderation_report", "legacy_engagement"]) {
    assert.equal(normalizeMailDeliveryProxyBody("mail_delivery", { kind }), null, kind);
  }
  for (const row of OWNER.data.rows) assert.ok([...MAIL_DELIVERY_KINDS, "other"].includes(row.kind), row.kind);
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
  const result = await bridge("owner", { ...OWNER_FILTERS }, { status: 200, data: OWNER });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { success: true, status_code: 200, data: OWNER.data }, "no legacy trio, no unparsed key");
  assert.equal(result.cache, "no-store");
  assert.deepEqual(result.forwarded, [{ days: 30, page: 1, admin_email: MEMBERSHIP_EMAIL }]);
  const extra = variant((data) => { data.rows[0].internal_note = "never forwarded"; });
  assert.equal(JSON.stringify((await bridge("admin", { days: 30 }, { status: 200, data: extra })).body).includes("internal_note"), false);
  const searched = await bridge("admin", { days: 30, state: "failed", email: "Anna@Gmail.com", page: 3 }, { status: 200, data: OWNER });
  assert.deepEqual(searched.forwarded, [{ days: 30, page: 3, state: "failed", email: "anna@gmail.com", admin_email: MEMBERSHIP_EMAIL }]);
  assert.deepEqual(searched.body, { success: false, status_code: 502, error: "invalid-core-response" }, "an answer for other filters");
});

test("DERIVED bridge: a viewer never receives unmasked addresses, whatever Core sends", async () => {
  const leak = await bridge("viewer", { days: 30 }, { status: 200, data: OWNER });
  assert.equal(leak.status, 502);
  assert.deepEqual(leak.body, { success: false, status_code: 502, error: "invalid-core-response" });
  assert.equal(JSON.stringify(leak.body).includes("bela@zsakmany.hu"), false);
  const fine = await bridge("viewer", { days: 30, state: "slow" }, { status: 200, data: VIEWER });
  assert.equal(fine.status, 200);
  assert.deepEqual(fine.body, { success: true, status_code: 200, data: VIEWER.data });
  assert.equal(fine.body.data.rows[0].recipient, "be•••@zsakmany.hu");
});

test("DERIVED bridge: bad filters never reach Core; a malformed success is unknown; a named refusal is kept", async () => {
  for (const body of [{ days: 2 }, { days: 365 }, { email: "nope" }, { extra: 1 }, { admin_email: "other@example.test" }]) {
    const result = await bridge("owner", body, { status: 200, data: OWNER });
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.deepEqual(result.forwarded, []);
  }
  const broken = variant((data) => { data.summary.total = 99; });
  for (const answer of [{ status: 200, data: broken }, { status: 201, data: OWNER }]) {
    const result = await bridge("owner", { days: 30 }, answer);
    assert.deepEqual(result.body, { success: false, status_code: 502, error: "invalid-core-response" });
  }
  // Core's genuine refusal, at HTTP 200 as Core sends it, reaches the page unchanged.
  const result = await bridge("owner", {}, { status: 200, data: REFUSAL });
  assert.deepEqual(result.body, REFUSAL);
  assert.equal(mailDeliveryFailure(result.body), "invalid");
  // Core's own read failure keeps its name and status through the bridge.
  const unavailable = { success: false, status_code: 503, error: "mail-delivery-unavailable", message: 200, status: 200, can_send: 0 };
  const down = await bridge("owner", {}, { status: 200, data: unavailable });
  assert.deepEqual(down.body, unavailable);
  assert.equal(mailDeliveryFailure(down.body), "unavailable");
  for (const value of [{ success: false, status_code: 502, error: "invalid-core-response" }, { success: false, status_code: 200, error: "invalid-input" },
    { success: false, status_code: 500, error: "mail-delivery-unavailable" }, OWNER, null]) {
    assert.equal(mailDeliveryFailure(value), "error", JSON.stringify(value)?.slice(0, 60));
  }
});

test("DERIVED bridge projection: the route wires the normalizers and refuses before forwarding", () => {
  assert.match(routeSource, /const mailDeliveryBody = normalizeMailDeliveryProxyBody\(action, body\);\s*if \(mailDeliveryBody === null\) \{\s*return bridgeError\("invalid-input", 400\);/);
  assert.match(routeSource, /normalizeMailDeliveryResponse\(result\.data, mailDeliveryBody, \{ viewer: principal\.role !== "owner" && principal\.role !== "admin" \}\)/);
  assert.ok(routeSource.indexOf("normalizeMailDeliveryProxyBody(action, body)") < routeSource.indexOf("const result = await coreCall("));
});

const MESSAGES = {
  en: JSON.parse(readFileSync(new URL("../messages/en.json", import.meta.url), "utf8")),
  hu: JSON.parse(readFileSync(new URL("../messages/hu.json", import.meta.url), "utf8")),
};

// PageHeader relies on the automatic JSX runtime of the Next build; tsx compiles it to React.createElement.
(globalThis as { React?: typeof React }).React = React;

function render(locale: "en" | "hu", data: MailDelivery | null, load: MailDeliveryLoad, filters = OWNER_FILTERS): string {
  const noop = () => undefined;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale, messages: MESSAGES[locale], timeZone: "UTC", onError: (error: Error) => { throw error; },
  }, createElement(MailDeliveryView, { data, load, filters, onFilters: noop, onReload: noop })));
}

function escaped(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

test("the page renders Core's owner capture in both locales: cards, domains, rows and the receiving servers' answers", () => {
  const data = mailDelivery(OWNER, OWNER_FILTERS)!;
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].mailDelivery;
    const html = render(locale, data, "ready");
    for (const text of [copy.title, copy.byDomain.title, copy.list.title, copy.state.delivered, copy.state.pending, copy.state.failed,
      copy.state.not_sent, copy.kind.support_request, copy.kind.admin_login_verification, copy.kind.other, copy.byDomain.unknown]) {
      assert.ok(html.includes(escaped(text)), `${locale}: ${text}`);
    }
    // Every option of the closed filters has its label.
    for (const kind of MAIL_DELIVERY_KINDS) assert.ok(html.includes(escaped(copy.kind[kind])), `${locale}: ${kind}`);
    for (const state of MAIL_DELIVERY_STATES) assert.ok(html.includes(escaped(copy.stateFilter[state])), `${locale}: ${state}`);
    assert.ok(html.includes("Mixed.Case@Example.TEST"), "the stored letter case");
    assert.ok(html.includes("<code>421</code> 4.4.2 Connection timed out for &lt;address&gt;"));
    assert.ok(html.includes("<code>550</code> mailbox unavailable"));
    assert.ok(html.includes("<code>configuration-missing</code>"));
    assert.ok(html.includes(locale === "en" ? "10 min 34 s" : "10 perc 34 mp"), "634 s");
    assert.ok(html.includes(locale === "en" ? "2 attempts" : "2 próbálkozás"));
    assert.ok(html.includes(locale === "en" ? "1 temporary refusal" : "1 átmeneti elutasítás"));
    assert.ok(html.includes(locale === "en" ? "71 h 59 min before Mailgun accepted it" : "71 óra 59 perc telt el, mire a Mailgun átvette"),
      "the old code's queue wait");
    assert.equal([...html.matchAll(/<table/g)].length, 2);
    assert.doesNotMatch(html, /mail-delivery-sync-alert/, "the capture's last poll succeeded");
    assert.doesNotMatch(html, new RegExp(escaped(copy.maskedNote)));
    assert.doesNotMatch(html, /role="alert"/);
    const failedPoll = render(locale, mailDelivery(variant((d) => { d.sync_attempted_at += 60; d.sync_failed_at = d.sync_attempted_at; }), OWNER_FILTERS)!, "ready");
    assert.ok(failedPoll.includes('class="alert alert-warning mail-delivery-sync-alert"'), "a failed poll is told apart");
  }
});

test("a viewer's page says the addresses are masked; an empty page is not a failure", () => {
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].mailDelivery;
    const html = render(locale, mailDelivery(VIEWER, VIEWER_FILTERS)!, "ready", VIEWER_FILTERS);
    assert.ok(html.includes(escaped(copy.maskedNote)));
    assert.ok(html.includes("be•••@zsakmany.hu"));
    assert.equal(html.includes("bela@zsakmany.hu"), false);
    const empty = variant((data) => {
      Object.assign(data, { rows: [], summary: { total: 0, counts: { delivered: 0, pending: 0, retrying: 0, failed: 0, not_sent: 0 },
        median_seconds: null, p90_seconds: null, max_seconds: null, slow: 0, by_domain: [] } });
    });
    const emptyHtml = render(locale, mailDelivery(empty, OWNER_FILTERS)!, "ready");
    assert.ok(emptyHtml.includes(escaped(copy.list.empty)));
    assert.equal([...emptyHtml.matchAll(/<table/g)].length, 0);
  }
});

test("a failed read says why and never renders cards, tables or zeros", () => {
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].mailDelivery;
    for (const load of ["invalid", "unavailable", "error"] as const) {
      const html = render(locale, null, load);
      assert.ok(html.includes(escaped(copy.failures[load])), `${locale} ${load}`);
      assert.doesNotMatch(html, /<table|stat-card/u);
    }
    const loading = render(locale, null, "loading");
    assert.match(loading, /loading-state/);
    assert.doesNotMatch(loading, /<table|stat-card/u);
  }
});

test("the page is one read per filter change, never a recovery loader, and is in the navigation", () => {
  const console = readFileSync(new URL("../components/MailDeliveryConsole.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(console, /useAdminReadRecovery/);
  assert.match(console, /adminCall\("mail_delivery", \{ \.\.\.filters \}, controller\.signal\)/);
  assert.match(console, /onFilters=\{\(next\) => \{ setData\(null\); setFilters\(next\); \}\}/, "an answer is never shown under other filters");
  const page = readFileSync(new URL("../app/(dashboard)/mail-delivery/page.tsx", import.meta.url), "utf8");
  assert.match(page, /return <MailDeliveryConsole \/>;/);
  const shell = readFileSync(new URL("../components/Shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /\{ href: "\/mail-delivery", key: "mailDelivery", icon: "mail" \}/);
  for (const locale of ["en", "hu"] as const) assert.equal(typeof MESSAGES[locale].nav.mailDelivery, "string", locale);
});
