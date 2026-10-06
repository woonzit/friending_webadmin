import test from "node:test";
import assert from "node:assert/strict";
import { adminPostForwardError } from "../lib/adminPostForward.ts";
import { MEMBERSHIP_CASES, MEMBERSHIP_EMAIL, MEMBERSHIP_LEGACY, membershipRefusal } from "./support/adminMembershipCases.mts";
import { DerivedNextResponse, serverModule, sessionHarness, writerRequest, WRITER_ROUTES } from "./support/adminMembershipServerHarness.mts";

// DERIVED production-route execution. The live membership/session gate is
// real; valid media normalization/capability and the Core socket are controlled
// to reach each post-forward branch. No upload, audit or provider capture.
const cases = [
  { name: "complete session-invalid", status: 401, data: membershipRefusal(401, "admin-session-invalid"), expected: 401, error: "auth-required" },
  { name: "complete revoked", status: 403, data: membershipRefusal(403, "admin-revoked"), expected: 401, error: "auth-required" },
  { name: "complete write-role 403", status: 403, data: membershipRefusal(403, "admin-write-required"), expected: 403, error: "admin-write-required" },
  { name: "complete owner-role 403", status: 403, data: membershipRefusal(403, "owner-required"), expected: 403, error: "owner-required" },
  { name: "bare 401", status: 401, data: null, expected: 502 },
  { name: "service 401", status: 401, data: membershipRefusal(401, "unauthorized"), expected: 502 },
  { name: "malformed 401", status: 401, data: { success: false, error: "admin-session-invalid" }, expected: 502 },
  { name: "malformed 403", status: 403, data: { success: false, error: "admin-revoked" }, expected: 502 },
  { name: "partial role 403", status: 403, data: { success: false, error: "admin-write-required" }, expected: 502 },
  { name: "unknown complete 403", status: 403, data: membershipRefusal(403, "unknown"), expected: 502 },
  { name: "wrong negative status pair", status: 403, data: membershipRefusal(403, "admin-session-invalid"), expected: 502 },
  { name: "Core 5xx", status: 500, data: membershipRefusal(500, "query-failed"), expected: 502 },
  { name: "HTTP 5xx logical success", status: 503, data: { ...MEMBERSHIP_LEGACY, success: true, status_code: 200 }, expected: 502 },
  { name: "timeout", status: 504, data: { success: false, error: "core-timeout" }, expected: 502, error: "core-timeout" },
  { name: "transport unavailable", status: 502, data: { success: false, error: "core-unavailable" }, expected: 502, error: "core-unavailable" },
  { name: "null 200", status: 200, data: null, expected: 502 },
  { name: "truthy success 200", status: 200, data: { ...MEMBERSHIP_LEGACY, success: "true", status_code: 200 }, expected: 502 },
  { name: "late positive", status: 200, data: { ...MEMBERSHIP_LEGACY, success: true, status_code: 200 }, expected: 502, error: "core-timeout", abandoned: true },
  { name: "late revocation", status: 403, data: membershipRefusal(403, "admin-revoked"), expected: 502, error: "core-timeout", abandoned: true },
] as const;

for (const route of WRITER_ROUTES.filter((route) => route !== "profile-verification-evidence")) for (const row of cases) {
  test(`DERIVED post-forward ${route}: ${row.name}`, async () => {
    const h = await sessionHarness(MEMBERSHIP_CASES[0]), incoming = writerRequest(h.controller.signal); let forwarded = 0;
    const file = new File(["DERIVED controlled normalization input"], route === "upload-video" ? "derived.mp4" : "derived.png",
      { type: route === "upload-video" ? "video/mp4" : "image/png" });
    incoming.request.formData = async () => { const form = new FormData(); form.set("image", file); form.set("icon", file); form.set("video", file);
      form.set("variant", "light"); form.set("uid", "123"); form.set("request_id", "3f2504e0-4f89-41d3-9a0c-0305e82c3301"); return form; };
    incoming.request.text = async () => JSON.stringify({ uid: "123" });
    const forward = async (_action: string, payload: Record<string, unknown>, ...args: unknown[]) => {
      forwarded++; assert.equal(payload.admin_email, MEMBERSHIP_EMAIL);
      const options = args.at(-1) as { signal: AbortSignal; strictResponse: boolean };
      assert.equal(options.signal, h.controller.signal); assert.equal(options.strictResponse, true);
      if ("abandoned" in row && row.abandoned) h.controller.abort();
      return { status: row.status, data: row.data };
    };
    const normalized = { buffer: Buffer.from("DERIVED normalized bytes"), mime: route === "upload-video" ? "video/mp4" : "image/png" };
    const module = await serverModule(`app/api/admin/${route}/route.ts`, { NextResponse: DerivedNextResponse,
      requireAdminWriter: h.api.requireAdminWriter, coreCall: forward, coreMultipartCall: forward,
      normalizeAdminImage: async () => normalized, normalizeSupportImage: async () => normalized,
      validateAdminVideo: () => normalized, validateAdminProfileIcon: () => normalized,
      personaAdminCapabilitiesFrom: () => ({}), personaCapabilityAllows: () => true });
    const response = await module.POST(incoming.request) as Response, data = await response.json();
    assert.equal(h.calls.length, 1, "own positive membership check precedes the feature forward"); assert.equal(forwarded, 1);
    assert.equal(response.status, row.expected); assert.equal(data.success, false); assert.equal(data.error, "error" in row ? row.error : "invalid-core-response");
    assert.notEqual(data.error, "admin-membership-unconfirmed", "a forwarded action is never presented as a definite pre-forward refusal");
    assert.equal(data.media_url, undefined); assert.equal(data.data, undefined);
  });
}
test("DERIVED post-forward classifier: complete ordinary successes and named input/conflict refusals stay the feature handler's responsibility", () => {
  assert.equal(adminPostForwardError({ status: 200, data: { ...MEMBERSHIP_LEGACY, success: true, status_code: 200, media_url: "https://media.example.test/derived" } }, MEMBERSHIP_EMAIL), null);
  for (const status of [400, 409, 422]) assert.equal(adminPostForwardError({ status, data: membershipRefusal(status, "derived-feature-refusal") }, MEMBERSHIP_EMAIL), null);
});
