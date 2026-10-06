import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { serveDatesIntakeCreate, serveDatesIntakeMedia } from "../lib/datesIntakeBridge.ts";
import { MEMBERSHIP_CASES, MEMBERSHIP_EMAIL, MEMBERSHIP_MEMBER, membershipRefusal, type MembershipCase } from "./support/adminMembershipCases.mts";
import { DerivedNextResponse, serverModule, sessionHarness, writerRequest } from "./support/adminMembershipServerHarness.mts";

// Actual dedicated handlers + injected Next/cookie/socket adapters. All test
// answers, including adaptations of older wire samples, are DERIVED; no new
// provider capture, private media, server or network integration is claimed.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/dates_event_intake_admin_wire/${name}.json`, import.meta.url), "utf8"));
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const imageSample = fixture("admin-image-read");
const image = { ...imageSample, image: { ...imageSample.image, data_base64: jpeg.toString("base64") } };
const receipt = fixture("admin-create-text"), key = "t899-original-intake-key-0001";
function membership(row: MembershipCase) {
  if (row.kind !== "confirmed") return row;
  const viewer = (row.data as { role: string }).role === "viewer";
  return { ...row, data: { ...(row.data as object), dates: { email: MEMBERSHIP_EMAIL, role: viewer ? "support_viewer" : "administrator", rank: viewer ? 10 : 40,
    linked_uid: null, sensitive_location: false, break_glass: false, capabilities: viewer ? [] : ["dates_external_event_review", "dates_external_event_manage"] } } };
}
async function request(route: "create" | "media", row: MembershipCase, config: { guest?: boolean; membershipThrows?: boolean; abandonForm?: boolean;
  feature?: { status: number; data: unknown }; abandonFeature?: boolean } = {}) {
  const h = await sessionHarness(membership(row)), incoming = writerRequest(h.controller.signal); let forwarded = 0, forms = 0;
  if (config.guest) h.state.token = "";
  incoming.request.nextUrl.searchParams = new URLSearchParams({ intake_id: "xin_" + "0".repeat(31) + "1", index: "1" });
  incoming.request.formData = async () => { forms++; if (config.abandonForm) h.controller.abort();
    const form = new FormData(); form.set("kind", "text"); form.set("text", "DERIVED public event input"); form.set("locale", "en"); form.set("idempotency_key", key); return form; };
  const call = async (action: string, payload: Record<string, unknown>, _timeout: unknown, options: { signal: AbortSignal; membershipCheck?: boolean; strictResponse?: boolean }) => {
    assert.equal(payload.admin_email, MEMBERSHIP_EMAIL); assert.equal(options.signal, h.controller.signal);
    if (action === "admin_me") {
      assert.equal(options.membershipCheck, true); if (config.membershipThrows) throw new Error("DERIVED transport failure");
      if (row.abandoned) h.controller.abort(); return { status: row.status, data: membership(row).data };
    }
    forwarded++; assert.equal(options.strictResponse, true); if (config.abandonFeature) h.controller.abort();
    return config.feature ?? { status: 200, data: route === "create" ? receipt : image };
  };
  const module = await serverModule(`app/api/admin/dates-intake-${route}/route.ts`, { NextResponse: DerivedNextResponse,
    randomUUID: () => "t899-derived-request-id", readAdminSession: h.api.readAdminSession, coreCall: call,
    coreMultipartFilesCall: async () => { forwarded++; assert.fail("text/media path cannot upload files"); } });
  const response = await (module.POST ?? module.GET)(incoming.request) as Response;
  const body = response.headers.get("content-type")?.includes("application/json") ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, body, forwarded, forms };
}

for (const row of MEMBERSHIP_CASES) for (const route of ["create", "media"] as const) test(`DERIVED direct intake ${route} gate: ${row.name}`, async () => {
  const result = await request(route, row);
  const viewer = (row.data as { role?: string } | null)?.role === "viewer";
  const expected = row.kind === "unconfirmed" ? 503 : row.kind === "revoked" ? 401 : viewer ? 403 : 200;
  assert.equal(result.status, expected); assert.match(result.headers.get("cache-control")!, /private, no-store/);
  assert.equal(result.forwarded, expected === 200 ? 1 : 0);
  if (expected !== 200) { assert.equal(Buffer.isBuffer(result.body), false); assert.equal(result.forms, 0); assert.equal(result.body.intake, undefined); assert.equal(result.body.image, undefined); }
  if (expected === 503) assert.equal(result.body.error, "admin-membership-unconfirmed");
  if (expected === 401) assert.equal(result.body.error, "auth-required");
  if (expected === 200 && route === "media") assert.deepEqual(result.body, jpeg);
});
test("DERIVED direct intake gates: guest and transport exceptions grant no read, upload or write", async () => {
  for (const route of ["create", "media"] as const) for (const config of [{ guest: true }, { membershipThrows: true }]) {
    const result = await request(route, MEMBERSHIP_CASES[0], config); assert.equal(result.status, "guest" in config ? 401 : 503);
    assert.equal(result.forwarded, 0); assert.equal(result.forms, 0);
  }
});
test("DERIVED direct intake: an abandoned form after a positive membership read sends nothing", async () => {
  const result = await request("create", MEMBERSHIP_CASES[0], { abandonForm: true });
  assert.equal(result.status, 503); assert.equal(result.forwarded, 0); assert.equal(result.forms, 1);
});
test("DERIVED direct intake: late forwarded receipts and private bytes are discarded as unknown outcomes, never pre-forward refusals", async () => {
  for (const route of ["create", "media"] as const) {
    const result = await request(route, MEMBERSHIP_CASES[0], { abandonFeature: true });
    assert.equal(result.status, 504); assert.equal(result.forwarded, 1); assert.equal(result.body.error, "core-timeout");
    assert.equal(Buffer.isBuffer(result.body), false); assert.equal(result.body.intake, undefined); assert.equal(result.body.image, undefined);
  }
});
test("DERIVED direct intake: only complete definite post-forward nonmembership can force login; service/malformed negatives cannot", async () => {
  for (const route of ["create", "media"] as const) for (const feature of [
    { status: 401, data: membershipRefusal(401, "admin-session-invalid"), expected: 401 },
    { status: 403, data: membershipRefusal(403, "admin-revoked"), expected: 401 },
    { status: 401, data: membershipRefusal(401, "unauthorized"), expected: 502 },
    { status: 401, data: { success: false, error: "admin-session-invalid" }, expected: 502 },
    { status: 403, data: { success: false, error: "admin-revoked" }, expected: 502 },
    { status: 503, data: route === "create" ? receipt : image, expected: 502 },
  ]) {
    const result = await request(route, MEMBERSHIP_CASES[0], { feature }); assert.equal(result.status, feature.expected); assert.equal(result.forwarded, 1);
    assert.equal(result.body.intake, undefined); assert.equal(result.body.image, undefined); assert.equal(Buffer.isBuffer(result.body), false);
  }
});
test("DERIVED direct intake shared helper: cookie exceptions and late checks cannot use a previous positive member", async () => {
  for (const invoke of [serveDatesIntakeCreate, serveDatesIntakeMedia]) {
    const headers = writerRequest(new AbortController().signal).request.headers;
    const reply = await (invoke as any)({ headers, form: async () => new FormData(), searchParams: new URLSearchParams() }, {
      session: async () => { throw new Error("DERIVED cookie failure"); }, core: async () => assert.fail(), coreFiles: async () => assert.fail(), requestId: () => key });
    assert.equal(reply.status, 503);
  }
});
