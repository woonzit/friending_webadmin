import test from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { classifyAdminMembership } from "../lib/adminMembership.ts";
import { MEMBERSHIP_EMAIL, MEMBERSHIP_MEMBER, membershipRefusal } from "./support/adminMembershipCases.mts";

// Real server-only transport with a controlled socket, no Core service call.
type NextResolve = (specifier: string, context: unknown) => unknown;
const EMPTY_MODULE_URL = "data:text/javascript,";
const moduleApi = nodeModule as unknown as {
  registerHooks?: (hooks: { resolve: (specifier: string, context: unknown, next: NextResolve) => unknown }) => void;
  register?: (specifier: string, parentURL: string) => void;
};
if (typeof moduleApi.registerHooks === "function") {
  moduleApi.registerHooks({
    resolve(specifier, context, next) {
      return specifier === "server-only" ? { url: EMPTY_MODULE_URL, shortCircuit: true, format: "module" } : next(specifier, context);
    },
  });
} else if (typeof moduleApi.register === "function") {
  // Node 20 has the asynchronous loader API, but not registerHooks.
  moduleApi.register("data:text/javascript," + encodeURIComponent(
    `export function resolve(specifier, context, next) { if (specifier === "server-only") return { url: ${JSON.stringify(EMPTY_MODULE_URL)}, shortCircuit: true, format: "module" }; return next(specifier, context); }`), import.meta.url);
} else {
  throw new Error("no module resolution hook API available");
}
process.env.WEBADMIN_API_SECRET = "test-membership-api-secret-000000000000";
process.env.CORE_API_BASE = "https://core.invalid";
const { coreCall, coreMultipartCall, coreMultipartFilesCall } = await import("../lib/core.ts");
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

test("DERIVED post-forward transport: opt-in JSON and both multipart calls preserve real HTTP failures and discard late body answers", async () => {
  try {
    const call = (mode: "json" | "image" | "files", signal?: AbortSignal, timeout = 10_000) => mode === "files"
      ? coreMultipartFilesCall("dates_event_intake_create", { admin_email: MEMBERSHIP_EMAIL }, [{ field: "flyer_1", bytes: new Uint8Array([68, 69, 82, 73, 86, 69, 68]), mime: "image/png", filename: "derived.png" }], timeout, { signal, strictResponse: true })
      : mode === "image"
        ? coreMultipartCall("upload_pinger_icon", { admin_email: MEMBERSHIP_EMAIL }, { buffer: Buffer.from("DERIVED"), mime: "image/png", filename: "derived.png" }, timeout, { signal, strictResponse: true })
        : coreCall("upload_image", { admin_email: MEMBERSHIP_EMAIL }, timeout, { signal, strictResponse: true });
    for (const mode of ["json", "image", "files"] as const) {
      for (const status of [401, 403, 500, 503]) {
        globalThis.fetch = (async () => ({ status, json: async () => MEMBERSHIP_MEMBER })) as typeof fetch;
        assert.equal((await call(mode)).status, status);
      }
      const controller = new AbortController();
      globalThis.fetch = (async () => ({ status: 200, json: async () => { controller.abort(); return MEMBERSHIP_MEMBER; } })) as typeof fetch;
      assert.equal((await call(mode, controller.signal)).status, 504);
      globalThis.fetch = (async () => ({ status: 200, json: async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return MEMBERSHIP_MEMBER; } })) as typeof fetch;
      assert.equal((await call(mode, undefined, 1)).status, 504);
    }
  } finally { globalThis.fetch = realFetch; }
});

test("DERIVED strict transport: elapsed deadlines discard late JSON even before a blocked event loop delivers its abort timer", async () => {
  try {
    for (const mode of ["membership", "json", "image", "files"] as const) for (const data of [MEMBERSHIP_MEMBER, membershipRefusal(403, "admin-revoked")]) {
      globalThis.fetch = (async () => ({ status: 200, json: async () => {
        const until = performance.now() + 15;
        while (performance.now() < until) { /* DERIVED event-loop stall, not a network call. */ }
        return data;
      } })) as typeof fetch;
      const payload = { admin_email: MEMBERSHIP_EMAIL };
      const answer = mode === "membership" ? await coreCall("admin_me", payload, 1, { membershipCheck: true })
        : mode === "json" ? await coreCall("upload_image", payload, 1, { strictResponse: true })
          : mode === "image" ? await coreMultipartCall("upload_pinger_icon", payload, { buffer: Buffer.from("DERIVED"), mime: "image/png", filename: "derived.png" }, 1, { strictResponse: true })
            : await coreMultipartFilesCall("dates_event_intake_create", payload, [], 1, { strictResponse: true });
      assert.equal(answer.status, 504, `${mode} must not accept a result after its own elapsed deadline`);
      assert.equal(classifyAdminMembership(answer, MEMBERSHIP_EMAIL).kind, "unconfirmed");
    }
  } finally { globalThis.fetch = realFetch; }
});
