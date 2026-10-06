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
  for (const data of [null, { success: "true" }, { success: true, message: { smid: 91 } }]) {
    assert.equal(adminPostForwardError({ status: 200, data }, MEMBERSHIP_EMAIL), null, "feature success shape is never judged by the AUTH classifier");
  }
});

// DERIVED from immutable Core main 7f86b941: WebadminController uploadImage
// 1581, uploadProfileIcon 1639, uploadVideo 1692, supportSend 3051 /
// helpSupportReply 3169, userDetail 6020; PingerAdminController::uploadIcon /
// respond, SupportThreadService::messageWire / capabilities. Webadmin::encodedReply preserves
// handler-owned message. These are not authenticated provider captures.
const realSuccessShapes = {
  "upload-image": { ...MEMBERSHIP_LEGACY, success: true, status_code: 200, media_url: "https://media.example.test/derived.jpg", mime: "image/jpeg", width: 96, height: 96, size_bytes: 1234 },
  "upload-video": { ...MEMBERSHIP_LEGACY, success: true, status_code: 200, media_url: "https://media.example.test/derived.webm", mime: "video/webm", size_bytes: 1234 },
  "upload-profile-icon": { ...MEMBERSHIP_LEGACY, success: true, status_code: 200, media_url: "https://media.example.test/derived.png", mime: "image/png", size_bytes: 321 },
  "upload-pinger-icon": { ...MEMBERSHIP_LEGACY, success: true, status_code: 200, data: { media_url: "https://media.example.test/derived.png", variant: "light" } },
  "support-media": { success: true, status_code: 200, message: { id: "507f1f77bcf86cd799439011", smid: 91, sender: "admin", kind: "image", body: "", created_at: 1791201600,
    request_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", image_url: null, image_width: 96, image_height: 96, image_removed: true, client_context: null },
    replayed: false, capabilities: { support_media: true, client_context_schema: 1 }, status: 200, can_send: 0 },
  "persona-member": { ...MEMBERSHIP_LEGACY, success: true, status_code: 200, profile: { uid: 123, display_name: "DERIVED member" }, images: [], persona_admin: { contract_version: 1, revision: 3 } },
};
for (const route of Object.keys(realSuccessShapes) as (keyof typeof realSuccessShapes)[]) test(`DERIVED Core-source real success after forward: ${route}`, async () => {
  const h = await sessionHarness(MEMBERSHIP_CASES[0]), incoming = writerRequest(h.controller.signal); let forwards = 0;
  const file = new File(["DERIVED controlled normalization input"], route === "upload-video" ? "derived.mp4" : "derived.png", { type: route === "upload-video" ? "video/mp4" : "image/png" });
  incoming.request.formData = async () => { const form = new FormData(); for (const field of ["image", "icon", "video"]) form.set(field, file);
    form.set("variant", "light"); form.set("uid", "123"); form.set("request_id", "3f2504e0-4f89-41d3-9a0c-0305e82c3301"); return form; };
  incoming.request.text = async () => JSON.stringify({ uid: "123" });
  const forward = async () => { forwards++; return { status: 200, data: realSuccessShapes[route] }; };
  const normalized = { buffer: Buffer.from("DERIVED normalized bytes"), mime: route === "upload-video" ? "video/mp4" : "image/png" };
  const module = await serverModule(`app/api/admin/${route}/route.ts`, { NextResponse: DerivedNextResponse, requireAdminWriter: h.api.requireAdminWriter,
    coreCall: forward, coreMultipartCall: forward, normalizeAdminImage: async () => normalized, normalizeSupportImage: async () => normalized,
    validateAdminVideo: () => normalized, validateAdminProfileIcon: () => normalized, personaAdminCapabilitiesFrom: () => ({}), personaCapabilityAllows: () => true });
  const response = await module.POST(incoming.request) as Response, body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.success, true); assert.equal(forwards, 1); assert.equal(h.calls.length, 1);
  if (route === "upload-pinger-icon") assert.deepEqual(body, { success: true, ...realSuccessShapes[route].data });
  else if (route === "persona-member") assert.deepEqual(body, { success: true, status_code: 200, data: { uid: 123, display_name: "DERIVED member", revision: 3 } });
  else assert.deepEqual(body, realSuccessShapes[route]);
});
