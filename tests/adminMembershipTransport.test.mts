import test from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { classifyAdminMembership } from "../lib/adminMembership.ts";
import { MEMBERSHIP_EMAIL, MEMBERSHIP_MEMBER, membershipRefusal } from "./support/adminMembershipCases.mts";

// Real server-only transport with a controlled socket, no Core service call.
type NextResolve = (specifier: string, context: unknown) => unknown;
const modules = nodeModule as unknown as { registerHooks: (hooks: { resolve: (specifier: string, context: unknown, next: NextResolve) => unknown }) => void };
modules.registerHooks({ resolve(specifier, context, next) { return specifier === "server-only" ? { url: "data:text/javascript,", shortCircuit: true, format: "module" } : next(specifier, context); } });
process.env.WEBADMIN_API_SECRET = "test-membership-api-secret-000000000000";
process.env.CORE_API_BASE = "https://core.invalid";
const { coreCall, coreMultipartCall } = await import("../lib/core.ts");
const realFetch = globalThis.fetch;

test("DERIVED membership transport: an HTTP error cannot be overridden by a successful or revoked logical body", async () => {
  try {
    for (const status of [401, 403, 500, 502, 503, 504]) for (const data of [MEMBERSHIP_MEMBER, membershipRefusal(403, "admin-revoked")]) {
      globalThis.fetch = (async () => ({ status, json: async () => data })) as typeof fetch;
      const answer = await coreCall("admin_me", { admin_email: MEMBERSHIP_EMAIL }, 10_000, { membershipCheck: true });
      assert.equal(answer.status, status);
      // An exact HTTP 403 + logical 403 negative remains definite; all other
      // HTTP errors are unconfirmed, including every positive body.
      assert.equal(classifyAdminMembership(answer, MEMBERSHIP_EMAIL).kind, status === 403 && data !== MEMBERSHIP_MEMBER ? "revoked" : "unconfirmed");
    }
  } finally { globalThis.fetch = realFetch; }
});
test("DERIVED membership transport: cancellation before fetch, during fetch, and while parsing discards late grants and revocations", async () => {
  try {
    for (const phase of ["before", "fetch", "json"]) for (const data of [MEMBERSHIP_MEMBER, membershipRefusal(403, "admin-revoked")]) {
      const controller = new AbortController(); let calls = 0;
      if (phase === "before") controller.abort();
      globalThis.fetch = (async (_url, options) => {
        calls++; assert.equal(options?.signal?.aborted, false);
        if (phase === "fetch") controller.abort();
        return { status: 200, json: async () => { if (phase === "json") controller.abort(); return data; } } as Response;
      }) as typeof fetch;
      const answer = await coreCall("admin_me", { admin_email: MEMBERSHIP_EMAIL }, 10_000, { membershipCheck: true, signal: controller.signal });
      assert.equal(answer.status, 504); assert.equal(classifyAdminMembership(answer, MEMBERSHIP_EMAIL).kind, "unconfirmed");
      assert.equal(calls, phase === "before" ? 0 : 1);
    }
  } finally { globalThis.fetch = realFetch; }
});
test("DERIVED membership transport: the deadline includes a late JSON body from a transport ignoring cancellation", async () => {
  try {
    globalThis.fetch = (async () => ({ status: 200, json: async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return MEMBERSHIP_MEMBER; } })) as typeof fetch;
    const answer = await coreCall("admin_me", { admin_email: MEMBERSHIP_EMAIL }, 1, { membershipCheck: true });
    assert.equal(answer.status, 504); assert.equal(classifyAdminMembership(answer, MEMBERSHIP_EMAIL).kind, "unconfirmed");
  } finally { globalThis.fetch = realFetch; }
});

test("DERIVED post-forward transport: opt-in JSON and multipart calls preserve real HTTP failures and discard late body answers", async () => {
  try {
    const call = (multipart: boolean, signal?: AbortSignal, timeout = 10_000) => multipart
      ? coreMultipartCall("upload_pinger_icon", { admin_email: MEMBERSHIP_EMAIL }, { buffer: Buffer.from("DERIVED"), mime: "image/png", filename: "derived.png" }, timeout, { signal, strictResponse: true })
      : coreCall("upload_image", { admin_email: MEMBERSHIP_EMAIL }, timeout, { signal, strictResponse: true });
    for (const multipart of [false, true]) {
      for (const status of [401, 403, 500, 503]) {
        globalThis.fetch = (async () => ({ status, json: async () => MEMBERSHIP_MEMBER })) as typeof fetch;
        assert.equal((await call(multipart)).status, status);
      }
      const controller = new AbortController();
      globalThis.fetch = (async () => ({ status: 200, json: async () => { controller.abort(); return MEMBERSHIP_MEMBER; } })) as typeof fetch;
      assert.equal((await call(multipart, controller.signal)).status, 504);
      globalThis.fetch = (async () => ({ status: 200, json: async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return MEMBERSHIP_MEMBER; } })) as typeof fetch;
      assert.equal((await call(multipart, undefined, 1)).status, 504);
    }
  } finally { globalThis.fetch = realFetch; }
});
