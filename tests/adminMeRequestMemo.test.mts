import test from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import { createSessionToken } from "../lib/sessionCodec.ts";
import { MEMBERSHIP_LEGACY } from "./support/adminMembershipCases.mts";
import { serverModule, serverReact } from "./support/adminMembershipServerHarness.mts";

// lib/session.ts's adminMe() through the React and Flight renderer that serve the console in production (Next's
// app-page runtime), with React's real `cache`. A "request" here is what it is in Next: one Flight render, in which
// the dashboard layout and the page are two server components that each call adminMe(). The cookie of each request
// comes from an AsyncLocalStorage, as Next's own request store does; Core answers per address.

const secret = "test-membership-session-secret-0000000000";
const { React, Flight } = serverReact();
const member = (email: string, role: string) => ({ ...MEMBERSHIP_LEGACY, success: true, status_code: 200, email, role });

async function harness(answers: Record<string, { status: number; data: unknown }>) {
  const cookie = new AsyncLocalStorage<string>(), calls: string[] = [];
  const api = await serverModule("lib/session.ts", {
    cache: React.cache,
    cookies: async () => ({ get: () => ({ value: cookie.getStore() ?? "" }) }),
    coreCall: async (action: string, payload: Record<string, unknown>, _timeout: unknown, options: { membershipCheck?: boolean }) => {
      assert.equal(action, "admin_me"); assert.equal(options.membershipCheck, true);
      const email = String(payload.admin_email); calls.push(email);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return answers[email];
    },
  }) as typeof import("../lib/session.ts");
  /** One server request: the layout and the page both ask, as app/(dashboard)/layout.tsx and the six pages do. */
  async function request(token: string, between?: () => void) {
    const seen: Record<string, unknown> = {};
    const ask = async (who: string) => { try { seen[who] = await api.adminMe(); } catch (error) { seen[who] = error; } };
    async function Page() { await ask("page"); return React.createElement("p", null, "page"); }
    async function Layout() { await ask("layout"); between?.(); return React.createElement("main", null, React.createElement(Page)); }
    await cookie.run(token, () => new Promise<void>((resolve, reject) => {
      const sink = new Writable({ write(_chunk, _encoding, done) { done(); }, final(done) { resolve(); done(); } });
      Flight.renderToPipeableStream(React.createElement(Layout), {}, { onError: reject }).pipe(sink);
    }));
    return seen as { layout: any; page: any };
  }
  return { api, calls, cookie, request };
}
const tokenOf = (email: string) => createSessionToken(email, secret);

test("one request: the layout and the page share one Core check and one answer", async () => {
  const h = await harness({ "ana@example.test": { status: 200, data: member("ana@example.test", "owner") } });
  const seen = await h.request(tokenOf("ana@example.test"));
  assert.deepEqual(h.calls, ["ana@example.test"]);
  assert.equal(seen.layout.email, "ana@example.test"); assert.equal(seen.page, seen.layout);
});

test("two requests of one session make two Core checks: an answer is never kept for the next request", async () => {
  const answers = { "ana@example.test": { status: 200, data: member("ana@example.test", "owner") } as { status: number; data: unknown } };
  const h = await harness(answers), token = tokenOf("ana@example.test");
  const first = await h.request(token);
  answers["ana@example.test"] = { status: 403, data: { ...MEMBERSHIP_LEGACY, success: false, status_code: 403, error: "admin-revoked" } };
  const second = await h.request(token);
  assert.deepEqual(h.calls, ["ana@example.test", "ana@example.test"]);
  assert.equal(first.layout.role, "owner"); assert.equal(second.layout, null, "the revocation takes effect on the next render"); assert.equal(second.page, null);
});

test("two sessions at the same time never see each other's answer", async () => {
  const h = await harness({ "ana@example.test": { status: 200, data: member("ana@example.test", "owner") },
    "bea@example.test": { status: 200, data: member("bea@example.test", "viewer") } });
  const [ana, bea] = await Promise.all([h.request(tokenOf("ana@example.test")), h.request(tokenOf("bea@example.test"))]);
  assert.deepEqual(h.calls.sort(), ["ana@example.test", "bea@example.test"]);
  assert.deepEqual([ana.layout.email, ana.layout.role, ana.page.email], ["ana@example.test", "owner", "ana@example.test"]);
  assert.deepEqual([bea.layout.email, bea.layout.role, bea.page.email], ["bea@example.test", "viewer", "bea@example.test"]);
});

test("the memo is keyed by the session: a different session within one render is checked on its own", async () => {
  const h = await harness({ "ana@example.test": { status: 200, data: member("ana@example.test", "owner") },
    "bea@example.test": { status: 200, data: member("bea@example.test", "viewer") } });
  // Not something Next does; it shows that the key, not only the request scope, separates sessions.
  let swapped = false;
  const original = h.cookie.getStore.bind(h.cookie);
  h.cookie.getStore = () => swapped ? tokenOf("bea@example.test") : original();
  const seen = await h.request(tokenOf("ana@example.test"), () => { swapped = true; });
  assert.deepEqual(h.calls, ["ana@example.test", "bea@example.test"]);
  assert.equal(seen.layout.email, "ana@example.test"); assert.equal(seen.page.email, "bea@example.test");
  // Two tokens of the same address (two sign-ins) are two sessions too.
  const twice = await harness({ "ana@example.test": { status: 200, data: member("ana@example.test", "owner") } });
  let second = false;
  const first = tokenOf("ana@example.test"), other = tokenOf("ana@example.test");
  assert.notEqual(first, other);
  const store = twice.cookie.getStore.bind(twice.cookie);
  twice.cookie.getStore = () => second ? other : store();
  await twice.request(first, () => { second = true; });
  assert.deepEqual(twice.calls, ["ana@example.test", "ana@example.test"]);
});

test("an unconfirmed answer is the same refusal for the layout and the page, from one check", async () => {
  const h = await harness({ "ana@example.test": { status: 502, data: { success: false, error: "core-unavailable" } } });
  const seen = await h.request(tokenOf("ana@example.test"));
  assert.deepEqual(h.calls, ["ana@example.test"]);
  assert.ok(seen.layout instanceof h.api.AdminMembershipUnconfirmedError); assert.equal(seen.page, seen.layout);
});

test("no session: nothing is asked, and the cookie is read on every call", async () => {
  const h = await harness({});
  const seen = await h.request("");
  assert.deepEqual(h.calls, []); assert.equal(seen.layout, null); assert.equal(seen.page, null);
});

test("outside a render - a route handler - every call asks Core, and the write gate is never memoised", async () => {
  const h = await harness({ "ana@example.test": { status: 200, data: member("ana@example.test", "owner") } });
  await h.cookie.run(tokenOf("ana@example.test"), async () => { await h.api.adminMe(); await h.api.adminMe(); });
  assert.equal(h.calls.length, 2);
  const inside = await harness({ "ana@example.test": { status: 200, data: member("ana@example.test", "owner") } });
  await inside.cookie.run(tokenOf("ana@example.test"), () => new Promise<void>((resolve, reject) => {
    async function Gate() { await inside.api.requireAdminWriter(); await inside.api.requireAdminWriter(); return React.createElement("p", null, "gate"); }
    const sink = new Writable({ write(_chunk, _encoding, done) { done(); }, final(done) { resolve(); done(); } });
    Flight.renderToPipeableStream(React.createElement(Gate), {}, { onError: reject }).pipe(sink);
  }));
  assert.equal(inside.calls.length, 2);
});

test("the layout and the six pages that ask adminMe() ask lib/session.ts's one function", () => {
  for (const path of ["app/(dashboard)/layout.tsx", "app/(dashboard)/verification/page.tsx", "app/(dashboard)/persona/page.tsx", "app/(dashboard)/audience-visibility/page.tsx",
    "app/(dashboard)/friendinggo/page.tsx", "app/(dashboard)/friendinggo/email/page.tsx", "app/(dashboard)/friendinggo/sent/page.tsx"]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, /import \{ adminMe, AdminMembershipUnconfirmedError \} from "@\/lib\/session";/, path);
    assert.match(source, /me = await adminMe\(\);/, path);
  }
  const session = readFileSync(new URL("../lib/session.ts", import.meta.url), "utf8");
  assert.match(session, /^import \{ cache \} from "react";$/m);
  assert.match(session, /const confirmedIdentity = cache\(async \(email: string, nonce: string, signal: AbortSignal \| undefined\)/);
  assert.match(session, /return confirmedIdentity\(session\.email, session\.nonce, signal\);/);
  assert.doesNotMatch(session, /requireAdminWriter = cache|cache\(async function requireAdminWriter/);
});
