import test from "node:test";
import assert from "node:assert/strict";
import { MEMBERSHIP_EMAIL, MEMBERSHIP_MEMBER } from "./support/adminMembershipCases.mts";
import { DerivedNextResponse, serverModule } from "./support/adminMembershipServerHarness.mts";

// The profile-verification evidence bridge (GET /api/admin/profile-verification-evidence), as it runs: a <video>
// cancels Range requests all the time while it seeks, and the read of Core now stops with the browser's request,
// as the wall-media bridge's does. It stays authenticated, no-store and Range-capable.

process.env.CORE_API_BASE = "http://127.0.0.1:9"; // never reached: fetch is replaced below
process.env.WEBADMIN_API_SECRET = "evidence-bridge-test-secret-000000000000";
const CASE = "c".repeat(32);
const writer = { ok: true, session: { email: MEMBERSHIP_EMAIL }, role: "owner", membership: { ...MEMBERSHIP_MEMBER, role: "owner" } };
type Binary = (action: string, payload: Record<string, unknown>, range: string | null, timeoutMs?: number, signal?: AbortSignal) => Promise<Response | null>;

function evidenceRequest(signal: AbortSignal, range?: string) {
  return { signal, headers: new Headers({ host: "admin.example.test", "sec-fetch-site": "same-origin", "sec-fetch-dest": "video", ...(range ? { range } : {}) }),
    nextUrl: { searchParams: new URLSearchParams({ case_id: CASE, kind: "video" }) } };
}
async function bridge(binary: Binary, gate: unknown = writer) {
  const calls: Parameters<Binary>[] = [];
  const route = await serverModule("app/api/admin/profile-verification-evidence/route.ts", { NextResponse: DerivedNextResponse, Headers,
    requireAdminWriter: async () => gate, coreBinaryCall: (...args: Parameters<Binary>) => { calls.push(args); return binary(...args); } });
  return { GET: route.GET as (request: unknown) => Promise<Response>, calls };
}
const PRIVATE = { "cache-control": "private, no-store, max-age=0" };

test("the browser's own signal reaches Core's read; a cancelled read keeps nothing of a late answer", async () => {
  const browser = new AbortController();
  let cancelled = 0, sawAbort = false;
  const { GET, calls } = await bridge((_action, _payload, _range, _timeout, signal) => new Promise((resolve) => {
    signal!.addEventListener("abort", () => {
      sawAbort = true;
      // Core answers anyway, late: its bytes must be dropped, not streamed to nobody.
      resolve(new Response(new ReadableStream({ pull(sink) { sink.enqueue(new Uint8Array(1024)); }, cancel() { cancelled++; } }),
        { status: 206, headers: { "content-type": "video/mp4" } }));
    });
  }));
  const pending = GET(evidenceRequest(browser.signal, "bytes=0-"));
  await new Promise((resolve) => setTimeout(resolve, 5));
  browser.abort();
  const response = await pending;
  assert.equal(calls.length, 1); assert.equal(calls[0][4], browser.signal, "the request's own signal"); assert.equal(calls[0][3], undefined, "the 30 s default stays");
  assert.equal(sawAbort, true);
  assert.equal(response.status, 504); assert.deepEqual(await response.json(), { success: false, error: "core-timeout" });
  assert.equal(response.headers.get("cache-control"), PRIVATE["cache-control"]); assert.equal(cancelled, 1);
});

test("the transport: the fetch to Core is aborted when the browser's request is", async () => {
  const { coreBinaryCall } = await import("../lib/core.ts");
  const original = globalThis.fetch, seen: AbortSignal[] = [];
  globalThis.fetch = ((_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
    const signal = init!.signal!; seen.push(signal);
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  })) as typeof fetch;
  try {
    const browser = new AbortController();
    const { GET } = await bridge(coreBinaryCall as Binary);
    const pending = GET(evidenceRequest(browser.signal, "bytes=100-199"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(seen.length, 1); assert.equal(seen[0].aborted, false);
    browser.abort();
    const response = await pending;
    assert.equal(seen[0].aborted, true, "Core's read stops with the browser's request");
    assert.equal(response.status, 504);
  } finally { globalThis.fetch = original; }
});

test("a Range read that is not cancelled is served as before: authenticated, no-store, Range-capable", async () => {
  const bytes = new Uint8Array(100).map((_, index) => index);
  const { GET, calls } = await bridge(async () => new Response(bytes, { status: 206,
    headers: { "content-type": "video/mp4", "content-length": "100", "content-range": "bytes 100-199/5000" } }));
  const browser = new AbortController(), response = await GET(evidenceRequest(browser.signal, "bytes=100-199"));
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].slice(0, 3))), ["profile_verification_evidence", { admin_email: MEMBERSHIP_EMAIL, case_id: CASE, kind: "video" }, "bytes=100-199"]);
  assert.equal(response.status, 206); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  for (const [name, value] of Object.entries({ ...PRIVATE, "content-type": "video/mp4", "accept-ranges": "bytes", "content-length": "100",
    "content-range": "bytes 100-199/5000", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin", "referrer-policy": "no-referrer", "content-disposition": "inline", pragma: "no-cache" })) {
    assert.equal(response.headers.get(name), value, name);
  }
  // Core's refusal keeps its status; a non-writer, a foreign origin and an abandoned request never reach Core.
  const refused = await bridge(async () => new Response(JSON.stringify({ success: false, status_code: 409, error: "profile-verification-evidence-not-found" }),
    { headers: { "content-type": "application/json" } }));
  const answer = await refused.GET(evidenceRequest(new AbortController().signal));
  assert.equal(answer.status, 409); assert.equal((await answer.json()).error, "profile-verification-evidence-not-found");
  const viewer = await bridge(async () => assert.fail("no read"), { ok: false, error: "admin-write-required", status: 403 });
  assert.equal((await viewer.GET(evidenceRequest(new AbortController().signal))).status, 403);
  const foreign = await bridge(async () => assert.fail("no read"));
  assert.equal((await foreign.GET({ ...evidenceRequest(new AbortController().signal), headers: new Headers({ host: "admin.example.test", origin: "https://elsewhere.example" }) })).status, 403);
  const gone = new AbortController(); gone.abort();
  const early = await bridge(async () => assert.fail("no read"));
  assert.equal((await early.GET(evidenceRequest(gone.signal))).status, 503);
});
