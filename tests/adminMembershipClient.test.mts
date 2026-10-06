import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import AdminMembershipNotice from "../components/AdminMembershipNotice.tsx";
import { ADMIN_ACTIONS, adminActionAccess } from "../lib/adminActions.ts";
import { ADMIN_MEMBERSHIP_UNCONFIRMED, classifyAdminMembership } from "../lib/adminMembership.ts";
import { createAdminMembershipRecovery } from "../lib/adminMembershipRecovery.ts";
import { ADMIN_REQUEST_HEADER, ADMIN_REQUEST_HEADER_VALUE } from "../lib/requestGuard.ts";
import { MEMBERSHIP_CASES, MEMBERSHIP_MEMBER } from "./support/adminMembershipCases.mts";
import { membershipClock } from "./support/adminMembershipClock.mts";

// Production client functions and recovery coordinator; DERIVED browser/socket
// and timer adapters, not a mounted Next browser or real Core integration.
const source = readFileSync(new URL("../lib/adminClient.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("client.ts", source, ts.ScriptTarget.Latest, true);
const code = ts.transpileModule(tree.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(tree)).join("\n"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const unknown = { status: 503, data: { success: false, status_code: 503, error: ADMIN_MEMBERSHIP_UNCONFIRMED } };
const signedOut = { status: 401, data: { success: false, status_code: 401, error: "auth-required" } };
const good = { status: 200, data: MEMBERSHIP_MEMBER };
type Answer = { status: number; data: unknown };
function client(initial: Answer = good) {
  const time = membershipClock(), redirects: string[] = [], calls: { url: string; options: RequestInit }[] = [];
  const state = { answer: initial, hook: undefined as undefined | ((url: string, options: RequestInit) => Promise<Response>) };
  const context: any = { exports: {}, JSON, File, FormData, AbortSignal, adminActionAccess, ADMIN_MEMBERSHIP_UNCONFIRMED, classifyAdminMembership,
    ADMIN_REQUEST_HEADER, ADMIN_REQUEST_HEADER_VALUE, window: { location: { assign: (url: string) => redirects.push(url) } },
    createAdminMembershipRecovery: (probe: Parameters<typeof createAdminMembershipRecovery>[0], redirect: () => void) => createAdminMembershipRecovery(probe, redirect, time.clock),
    fetch: async (url: string, options: RequestInit) => {
      calls.push({ url, options }); assert.equal(options.cache, "no-store"); assert.equal(new Headers(options.headers).get(ADMIN_REQUEST_HEADER), ADMIN_REQUEST_HEADER_VALUE);
      if (state.hook) return state.hook(url, options);
      return new Response(JSON.stringify(state.answer.data), { status: state.answer.status });
    },
  };
  vm.runInNewContext(code, context);
  const api = context.exports as typeof import("../lib/adminClient.ts");
  const file = new File(["DERIVED upload bytes"], "derived.png", { type: "image/png" });
  const entries = [
    ["JSON write", (signal?: AbortSignal) => api.adminCall("set_settings", { draft: "keep", request_id: "keep-this-identity" }, signal)],
    ["image upload", (signal?: AbortSignal) => api.adminUploadImage(file, signal)],
    ["video upload", (signal?: AbortSignal) => api.adminUploadVideo(file, signal)],
    ["profile icon upload", (signal?: AbortSignal) => api.adminUploadProfileIcon(file, signal)],
    ["pinger icon upload", (signal?: AbortSignal) => api.adminUploadPingerIcon(file, "light", signal)],
    ["support image upload", (signal?: AbortSignal) => api.adminUploadSupportImage(123, file, "keep-this-identity", signal)],
    ["direct intake", (signal?: AbortSignal) => api.adminIntakeCreate(new FormData(), signal)],
  ] as const;
  return { api, state, time, redirects, calls, entries };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

for (const row of MEMBERSHIP_CASES) test(`DERIVED client table / every write and upload: ${row.name}`, async () => {
  const answer = row.kind === "unconfirmed" ? unknown : row.kind === "revoked" ? signedOut : good;
  for (let index = 0; index < 7; index++) {
    const h = client(answer), [name, invoke] = h.entries[index];
    const result = await invoke(); assert.equal(h.calls.length, 1, name);
    assert.deepEqual(h.redirects, row.kind === "revoked" ? ["/login"] : [], name);
    assert.equal(h.api.adminMembershipRecovery.getSnapshot(), row.kind === "unconfirmed", name);
    if (row.kind === "unconfirmed") {
      assert.equal(result?.error, ADMIN_MEMBERSHIP_UNCONFIRMED, name);
      await invoke(); assert.equal(h.calls.length, 1, `${name}: repeated click while unconfirmed is refused locally`);
      h.state.answer = good; await h.time.tick();
      assert.equal(h.api.adminMembershipRecovery.getSnapshot(), false); assert.equal(h.calls.length, 2);
      assert.equal(h.calls[1].url, "/api/admin/admin_me", `${name}: recovery never repeats the write/upload`);
      assert.deepEqual(h.redirects, []);
      await invoke(); assert.equal(h.calls.length, 3, `${name}: only a new explicit operator attempt sends it`);
    }
  }
});
test("DERIVED client: automatic retry is limited to read-only requests and each retry still uses the protected bridge", async () => {
  for (const action of ["overview", "dates_event_research_overview"]) {
    const h = client(unknown); let settled = false;
    const pending = h.api.adminCall(action).then((result) => { settled = true; return result; }); await flush();
    assert.equal(settled, false); assert.equal(h.calls.length, 1); assert.deepEqual(h.redirects, []);
    h.state.answer = good; await h.time.tick(); assert.equal((await pending)?.success, true);
    assert.deepEqual(h.calls.map((call) => call.url), [`/api/admin/${action}`, "/api/admin/admin_me", `/api/admin/${action}`]);
  }
});
test("DERIVED client: unknown, owner-only and every classified mutating action has no automatic retry queue", async () => {
  const h = client(); h.api.adminMembershipRecovery.markUnconfirmed();
  for (const action of [...ADMIN_ACTIONS, "unclassified_action"]) {
    const access = adminActionAccess(action); if (access === "read" || access === "dates_read") continue;
    assert.equal((await h.api.adminCall(action, { request_id: "retained-original" }))?.error, ADMIN_MEMBERSHIP_UNCONFIRMED, action);
  }
  assert.equal(h.calls.length, 0);
});
test("DERIVED client: malformed 200 membership responses and service/unknown 401s never redirect", async () => {
  // A wrong actor is refused by the server bridge, tested row-by-row above.
  // The browser has no HttpOnly-session identity with which to compare an
  // otherwise canonical email, and never uses this parse to grant a request.
  for (const row of MEMBERSHIP_CASES.filter((row) => row.kind === "unconfirmed" && !row.abandoned && row.name !== "foreign email")) {
    const h = client({ status: row.status, data: row.data }), controller = new AbortController();
    const pending = h.api.adminCall("admin_me", {}, controller.signal); await flush();
    assert.equal(h.api.adminMembershipRecovery.getSnapshot(), true, row.name); assert.deepEqual(h.redirects, []);
    controller.abort(); assert.equal(await pending, null); assert.equal(h.api.adminMembershipRecovery.getSnapshot(), true);
  }
});
test("DERIVED client: late positive, outage and definite 401 bodies from abandoned reads/writes/uploads have no effect", async () => {
  for (const phase of ["before", "fetch", "json"] as const) for (const answer of [good, unknown, signedOut]) for (let index = 0; index < 8; index++) {
    const h = client(), controller = new AbortController(); if (phase === "before") controller.abort();
    h.state.hook = async () => {
      if (phase === "fetch") controller.abort();
      return { status: answer.status, json: async () => { if (phase === "json") controller.abort(); return answer.data; } } as Response;
    };
    const result = index === 7 ? await h.api.adminCall("admin_me", {}, controller.signal) : await h.entries[index][1](controller.signal);
    assert.equal(result, null); assert.equal(h.api.adminMembershipRecovery.getSnapshot(), false);
    assert.deepEqual(h.redirects, []); assert.equal(h.time.jobs.size, 0);
    assert.equal(h.calls.length, phase === "before" ? 0 : 1);
  }
});
test("DERIVED client: a lost write reply and later account change never replay the original write", async () => {
  const h = client(); let first = true;
  h.state.hook = async (_url) => { if (first) { first = false; throw new Error("DERIVED lost reply"); }
    return new Response(JSON.stringify({ ...MEMBERSHIP_MEMBER, email: "other@example.test" }), { status: 200 }); };
  assert.equal(await h.entries[0][1](), null); await h.time.tick();
  assert.deepEqual(h.calls.map((call) => call.url), ["/api/admin/set_settings", "/api/admin/admin_me"]);
  assert.deepEqual(JSON.parse(h.calls[0].options.body as string), { draft: "keep", request_id: "keep-this-identity" });
  assert.deepEqual(h.redirects, []);
});
test("DERIVED client: ordinary feature failures and valid-role refusals are not automatic retry or logout signals", async () => {
  for (const answer of [{ status: 403, data: { success: false, error: "admin-write-required" } },
    { status: 401, data: { success: false, error: "unauthorized" } }, { status: 503, data: { success: false, error: "feature-unavailable" } }]) {
    const h = client(answer); assert.equal((await h.api.adminCall("set_settings"))?.success, false);
    assert.deepEqual(h.redirects, []); assert.equal(h.calls.length, 1); assert.equal(h.time.jobs.size, 0);
  }
});
for (const locale of ["en", "hu"]) test(`DERIVED static render ${locale}: the membership notice states refusal, retention, backoff and explicit write retry`, () => {
  const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")), errors: string[] = [];
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages, timeZone: "UTC", onError: (error: unknown) => errors.push(String(error)) },
    createElement(AdminMembershipNotice, { visible: true })));
  for (const value of Object.values(messages.adminMembership) as string[]) assert.ok(html.includes(value.replaceAll("&", "&amp;").replaceAll("'", "&#x27;")));
  assert.deepEqual(errors, []); assert.match(html, /role="status"/); assert.match(html, /type="button"/);
});
test("DERIVED source boundary: recovery hides but never conditionally replaces existing page children or touches retained storage", () => {
  const shell = readFileSync(new URL("../components/Shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /<div className="membership-retained" hidden=\{membershipUnconfirmed\}>\{children\}<\/div>/);
  assert.doesNotMatch(source, /sessionStorage|localStorage|router\.refresh|router\.push|router\.replace/);
  const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(styles, /\.membership-retained\[hidden\]\s*\{\s*display: none !important/);
});
